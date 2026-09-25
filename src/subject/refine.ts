/**
 * Sharpening a coarse coverage map against the picture it came from.
 *
 * The detector answers at 320×320 whatever it is shown, which is about one
 * value per thirty pixels of a 24 MP frame. Scaled up on its own that is a blur
 * where an edge should be: darken a sky with it and every branch wears a bright
 * halo, because the map says "not sky" in a fat band around each one.
 *
 * A guided filter (He, Sun and Tang, 2010) fixes this by refusing to invent
 * anything. It fits a local linear model between the picture's own luminance
 * and the coarse map, then evaluates that model at full resolution — so the
 * edges in the result are the edges that were already in the photograph, and
 * the model only decides which side of them is covered.
 *
 * All of it is a handful of box blurs, which is why it runs in a worker in a
 * few milliseconds rather than needing a shader of its own.
 */

/** Window radius, in pixels of the refined map, at the default detail. */
export const REFINE_RADIUS = 16

/**
 * Regularisation, at the default detail. Larger tolerates more variation
 * inside a region before it decides an edge is there; this is low, because the
 * whole point is to follow fine structure like branches and hair.
 */
export const REFINE_EPS = 1e-4

/** Where the two edge controls sit on a fresh subject mask. */
export const SUBJECT_EDGE_DEFAULTS = { detail: 50, shift: 0 } as const

/** How far, in pixels of the refined map, the edge can be pushed either way. */
export const MAX_EDGE_SHIFT = 24

export interface EdgeOptions {
  radius: number
  eps: number
  /** Pixels to grow (+) or shrink (−) the coverage by. */
  shift: number
}

/**
 * The two sliders, turned into what the filter actually takes.
 *
 * Detail runs the radius and the regularisation together, and both on a log
 * scale, because they pull the same way: a small window with little tolerance
 * follows hair and branches, a large one with more tolerance gives a clean
 * outline that ignores them. Fifty lands on the constants above, so an
 * untouched mask is the mask this app has always made. Shift is linear, in
 * pixels, so a hundred is the full reach and zero is exactly nothing.
 */
export function edgeOptions(detail: number, shift: number): EdgeOptions {
  const d = Math.min(100, Math.max(0, Number.isFinite(detail) ? detail : 50))
  const t = (d - 50) / 50 // −1 at no detail, 0 at the default, 1 at all of it
  return {
    radius: Math.max(1, Math.round(REFINE_RADIUS * Math.pow(3, -t))),
    eps: REFINE_EPS * Math.pow(10, -t),
    shift: Math.round((Math.min(100, Math.max(-100, shift || 0)) / 100) * MAX_EDGE_SHIFT),
  }
}

/**
 * Grow or shrink the covered region by `px`: a max filter to grow, a min
 * filter to shrink, each separable into a horizontal and a vertical pass.
 * Grey-level morphology rather than a threshold move, so a soft edge stays
 * soft — it is the whole edge that moves, not the point at which it is cut.
 *
 * Van Herk's sliding window (1992), so the cost is three comparisons per
 * pixel whatever the radius. The obvious loop is 2r+1 per pixel, which at the
 * full reach on a 1024² map is a hundred million — long enough that a slider
 * dragged to its end was still drawing the previous position a second later.
 */
export function shiftEdge(src: Float32Array, w: number, h: number, px: number): Float32Array {
  const r = Math.abs(Math.round(px))
  if (!r) return src
  const grow = px > 0

  const line = new Float32Array(Math.max(w, h) + 2 * r)
  const prefix = new Float32Array(line.length)
  const suffix = new Float32Array(line.length)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)

  const pass = (
    read: (i: number) => number,
    write: (i: number, v: number) => void,
    n: number,
  ) => slidingExtreme(line, prefix, suffix, read, write, n, r, grow)

  for (let y = 0; y < h; y++) {
    const row = y * w
    pass((i) => src[row + i], (i, v) => { tmp[row + i] = v }, w)
  }
  for (let x = 0; x < w; x++) {
    pass((i) => tmp[i * w + x], (i, v) => { out[i * w + x] = v }, h)
  }
  return out
}

/**
 * One line of the max or min filter with window 2r+1.
 *
 * The line is padded by r on each side with the value that can never win, so
 * every window is full width; then within blocks of the window's size a
 * running extreme is kept forwards and backwards, and any window — which
 * spans at most two blocks — is the extreme of one suffix and one prefix.
 */
function slidingExtreme(
  line: Float32Array,
  prefix: Float32Array,
  suffix: Float32Array,
  read: (i: number) => number,
  write: (i: number, v: number) => void,
  n: number,
  r: number,
  grow: boolean,
): void {
  const w = 2 * r + 1
  const total = n + 2 * r
  const neutral = grow ? -Infinity : Infinity
  for (let i = 0; i < r; i++) line[i] = neutral
  for (let i = 0; i < n; i++) line[r + i] = read(i)
  for (let i = r + n; i < total; i++) line[i] = neutral

  for (let i = 0; i < total; i++) {
    const v = line[i]
    if (i % w === 0) prefix[i] = v
    else {
      const p = prefix[i - 1]
      prefix[i] = grow ? (v > p ? v : p) : (v < p ? v : p)
    }
  }
  for (let i = total - 1; i >= 0; i--) {
    const v = line[i]
    if (i % w === w - 1 || i === total - 1) suffix[i] = v
    else {
      const q = suffix[i + 1]
      suffix[i] = grow ? (v > q ? v : q) : (v < q ? v : q)
    }
  }
  for (let i = 0; i < n; i++) {
    // Output i covers padded [i, i + 2r].
    const a = suffix[i]
    const b = prefix[i + 2 * r]
    write(i, grow ? (a > b ? a : b) : (a < b ? a : b))
  }
}

/**
 * Mean over a square window, as two sliding sums.
 *
 * Normalised by the window that actually fits, so the edges of the image are
 * an average of fewer samples rather than an average that counts zeros.
 */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)

  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = 0; x < Math.min(r + 1, w); x++) sum += src[row + x]
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      tmp[row + x] = sum / (hi - lo + 1)
      const add = x + r + 1
      const drop = x - r
      if (add < w) sum += src[row + add]
      if (drop >= 0) sum -= src[row + drop]
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = 0; y < Math.min(r + 1, h); y++) sum += tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r)
      const hi = Math.min(h - 1, y + r)
      out[y * w + x] = sum / (hi - lo + 1)
      const add = y + r + 1
      const drop = y - r
      if (add < h) sum += tmp[add * w + x]
      if (drop >= 0) sum -= tmp[drop * w + x]
    }
  }

  return out
}

/** Bilinear resample of a single-channel map into a square of `size`. */
export function resample(
  src: Uint8ClampedArray,
  from: number,
  size: number,
): Float32Array {
  const out = new Float32Array(size * size)
  const scale = from / size

  for (let y = 0; y < size; y++) {
    const sy = Math.min(from - 1, Math.max(0, (y + 0.5) * scale - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(from - 1, y0 + 1)
    const fy = sy - y0

    for (let x = 0; x < size; x++) {
      const sx = Math.min(from - 1, Math.max(0, (x + 0.5) * scale - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(from - 1, x0 + 1)
      const fx = sx - x0

      const a = src[y0 * from + x0] + (src[y0 * from + x1] - src[y0 * from + x0]) * fx
      const b = src[y1 * from + x0] + (src[y1 * from + x1] - src[y1 * from + x0]) * fx
      out[y * size + x] = (a + (b - a) * fy) / 255
    }
  }

  return out
}

/**
 * The guided filter itself. `guide` and `input` are the same size and both
 * 0..1; the result is the input re-cut along the guide's edges.
 */
export function guidedFilter(
  guide: Float32Array,
  input: Float32Array,
  w: number,
  h: number,
  radius = REFINE_RADIUS,
  eps = REFINE_EPS,
): Float32Array {
  const n = w * h
  const gp = new Float32Array(n)
  const gg = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    gp[i] = guide[i] * input[i]
    gg[i] = guide[i] * guide[i]
  }

  const meanG = boxBlur(guide, w, h, radius)
  const meanP = boxBlur(input, w, h, radius)
  const meanGp = boxBlur(gp, w, h, radius)
  const meanGg = boxBlur(gg, w, h, radius)

  // a is how strongly the map should follow the picture here; b is the offset
  // that keeps the fit honest where it should not follow at all.
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const varG = meanGg[i] - meanG[i] * meanG[i]
    const covGp = meanGp[i] - meanG[i] * meanP[i]
    a[i] = covGp / (varG + eps)
    b[i] = meanP[i] - a[i] * meanG[i]
  }

  // Averaging the coefficients, not the result: every window containing a pixel
  // has an opinion about it, and this is what stops them showing as blocks.
  const meanA = boxBlur(a, w, h, radius)
  const meanB = boxBlur(b, w, h, radius)

  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = meanA[i] * guide[i] + meanB[i]
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v
  }
  return out
}

/**
 * Coarse detector output plus the picture's luminance, in: one refined
 * coverage map, out. Both the guide and the result are square, in the same
 * stretched upright uv the detector saw, so the map can be sampled directly.
 */
export function refineMask(
  coarse: Uint8ClampedArray,
  coarseSize: number,
  guide: Float32Array,
  size: number,
  edge: EdgeOptions = edgeOptions(SUBJECT_EDGE_DEFAULTS.detail, SUBJECT_EDGE_DEFAULTS.shift),
): Uint8ClampedArray {
  const upscaled = resample(coarse, coarseSize, size)
  // Shift before the filter, not after: moved first, the edge is then re-cut
  // along the picture, so a grown mask still ends on a real boundary rather
  // than on a blurred copy of the old one.
  const moved = shiftEdge(upscaled, size, size, edge.shift)
  const refined = guidedFilter(guide, moved, size, size, edge.radius, edge.eps)

  const out = new Uint8ClampedArray(size * size)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(refined[i] * 255)
  return out
}
