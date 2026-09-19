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

/** Window radius, in pixels of the refined map. */
export const REFINE_RADIUS = 16

/**
 * Regularisation. Larger tolerates more variation inside a region before it
 * decides an edge is there; this is low, because the whole point is to follow
 * fine structure like branches and hair.
 */
export const REFINE_EPS = 1e-4

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
): Uint8ClampedArray {
  const upscaled = resample(coarse, coarseSize, size)
  const refined = guidedFilter(guide, upscaled, size, size)

  const out = new Uint8ClampedArray(size * size)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(refined[i] * 255)
  return out
}
