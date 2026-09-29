/**
 * Healing, the way a spot-healing brush does it: copy the texture from a patch
 * of the picture that matches, and take the colour from around the spot.
 *
 * Copying alone leaves a seam wherever the two patches differ in brightness or
 * hue, which on skin or sky is almost everywhere. So what is copied is the
 * source's *detail* — its pores, grain and fine structure — and the difference
 * between target and source along the edge of the brush is carried smoothly
 * across the inside (a membrane, the Laplace solution with that edge as its
 * boundary). A shift in tone between the two places therefore fades out over
 * the spot instead of stopping at a line. It is the guided interpolation of
 * Pérez et al.'s Poisson image editing, solved directly on the difference.
 *
 * Everything here is pure arithmetic on RGBA buffers, so it runs in the worker
 * and in tests alike. Coordinates are pixels of whatever buffer is handed in;
 * which part of the photograph that buffer is, and at what resolution, is the
 * caller's business.
 */

export interface Plane {
  /** RGBA, row-major, opaque. */
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface Brush {
  /** Centre line in buffer pixels, flat x, y pairs. One pair is a dab. */
  points: number[]
  /** Radius in buffer pixels. */
  radius: number
  /** How much of the radius fades, 0..1. */
  feather: number
}

/** A rectangle in buffer pixels, `x1`/`y1` exclusive. */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * How much of the brush covers each pixel, 0..1.
 *
 * Measured at pixel centres from the nearest point of the centre line, so a
 * dragged stroke is a capsule chain rather than a string of overlapping dabs
 * whose edges scallop. A hard brush still gets one pixel of antialiasing: an
 * edge that steps is an edge anyone can find.
 */
export function brushCoverage(brush: Brush, width: number, height: number): Float32Array {
  const alpha = new Float32Array(width * height)
  const { points, radius } = brush
  if (points.length < 2 || !(radius > 0)) return alpha

  const outer = radius
  const inner = Math.min(radius * (1 - clamp01(brush.feather)), radius - 1)
  const box = brushBounds(brush, width, height)

  const segments = Math.max(1, points.length / 2 - 1)
  for (let y = box.y0; y < box.y1; y++) {
    const py = y + 0.5
    for (let x = box.x0; x < box.x1; x++) {
      const px = x + 0.5
      let best = Infinity
      for (let s = 0; s < segments; s++) {
        const ax = points[s * 2]
        const ay = points[s * 2 + 1]
        const bx = points.length >= 4 ? points[s * 2 + 2] : ax
        const by = points.length >= 4 ? points[s * 2 + 3] : ay
        const d = segmentDistance2(px, py, ax, ay, bx, by)
        if (d < best) best = d
      }
      const d = Math.sqrt(best)
      if (d >= outer) continue
      alpha[y * width + x] = d <= inner ? 1 : 1 - smooth((d - inner) / (outer - inner))
    }
  }
  return alpha
}

/** The pixels the brush can reach, clipped to the buffer. */
export function brushBounds(brush: Brush, width: number, height: number): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 1 < brush.points.length; i += 2) {
    x0 = Math.min(x0, brush.points[i])
    x1 = Math.max(x1, brush.points[i])
    y0 = Math.min(y0, brush.points[i + 1])
    y1 = Math.max(y1, brush.points[i + 1])
  }
  const r = brush.radius + 1
  return {
    x0: Math.max(0, Math.floor(x0 - r)),
    y0: Math.max(0, Math.floor(y0 - r)),
    x1: Math.min(width, Math.ceil(x1 + r)),
    y1: Math.min(height, Math.ceil(y1 + r)),
  }
}

/** The smallest rectangle holding every pixel the coverage touches. */
export function coverageBounds(alpha: Float32Array, width: number, height: number): Rect | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] <= 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 }
}

export interface SourcePlan {
  /** Where to copy from, as an offset from the spot, in buffer pixels. */
  dx: number
  dy: number
  /**
   * How well a heal from there will hold, where 1 is the limit: past it the
   * edge, the tone or the texture is off by enough to show. See `EDGE_LIMIT`.
   */
  score: number
}

/** Rings of candidates, in brush radii from the spot. */
const SEARCH_RINGS = [2.2, 2.8, 3.6, 4.6, 6]
/** Directions tried on each ring. */
const SEARCH_ANGLES = 24
/** Samples a cost is estimated from. Plenty to rank candidates; cheap per try. */
const SAMPLE_BUDGET = 700

/**
 * The patch to heal from: the nearby offset whose surroundings best match the
 * spot's own, and whose texture is the same kind of busy.
 *
 * Two terms, because they fail in different ways. The edge term compares a
 * ring around the spot with the ring around the candidate, after taking out
 * the mean difference (the membrane will absorb that) — it is what stops a
 * source that runs across an edge the target does not have. The texture term
 * compares how much detail the candidate's inside carries with how much the
 * spot's surroundings do — it is what stops smooth skin being healed from a
 * patch of eyebrow that happens to share its average colour.
 *
 * Nearer sources win ties. Light, colour and texture all drift across a
 * photograph, and the nearest good match is the one least likely to have
 * drifted.
 */
export function findSource(img: Plane, alpha: Float32Array, radius: number): SourcePlan | null {
  const { width, height } = img
  const hole = coverageBounds(alpha, width, height)
  if (!hole) return null

  const lum = luma(img)
  const grad = gradient(lum, width, height)
  const dist = distanceFromHole(alpha, width, height)
  const ringWidth = Math.max(2, Math.min(8, radius * 0.5))

  const ring: number[] = []
  const inside: number[] = []
  for (let y = Math.max(0, hole.y0 - 9); y < Math.min(height, hole.y1 + 9); y++) {
    for (let x = Math.max(0, hole.x0 - 9); x < Math.min(width, hole.x1 + 9); x++) {
      const i = y * width + x
      if (alpha[i] > 0) inside.push(i)
      else if (dist[i] <= ringWidth) ring.push(i)
    }
  }
  if (!ring.length || !inside.length) return null

  const ringSample = subsample(ring, SAMPLE_BUDGET)
  const insideSample = subsample(inside, SAMPLE_BUDGET)
  const ringXY = ringSample.map((i) => [i % width, (i / width) | 0] as const)
  const insideXY = insideSample.map((i) => [i % width, (i / width) | 0] as const)

  // How busy the spot's surroundings are, which the source's inside should match.
  let ringGrad = 0
  for (const i of ringSample) ringGrad += grad[i]
  ringGrad /= ringSample.length

  const pad = Math.ceil(ringWidth) + 1
  const cost = (dx: number, dy: number): number => {
    // The source and its ring must be inside the buffer...
    if (hole.x0 + dx - pad < 0 || hole.y0 + dy - pad < 0) return Infinity
    if (hole.x1 + dx + pad > width || hole.y1 + dy + pad > height) return Infinity
    // ...and the source must not be the spot itself, or any part of it.
    for (const [x, y] of insideXY) {
      if (alpha[(y + dy) * width + x + dx] > 0) return Infinity
    }

    const d = img.data
    let sr = 0, sg = 0, sb = 0
    let qr = 0, qg = 0, qb = 0
    for (const [x, y] of ringXY) {
      const a = (y * width + x) * 4
      const b = ((y + dy) * width + x + dx) * 4
      const er = (d[a] - d[b]) / 255
      const eg = (d[a + 1] - d[b + 1]) / 255
      const eb = (d[a + 2] - d[b + 2]) / 255
      sr += er; sg += eg; sb += eb
      qr += er * er; qg += eg * eg; qb += eb * eb
    }
    const n = ringXY.length
    const shift = (sr / n) ** 2 + (sg / n) ** 2 + (sb / n) ** 2
    const edge = qr / n + qg / n + qb / n - shift

    let g = 0
    for (const [x, y] of insideXY) g += grad[(y + dy) * width + x + dx]
    g /= insideXY.length
    const texture = (g - ringGrad) ** 2 * 3

    // The membrane takes a difference in tone out, but texture scales with
    // brightness, so a source in the same light is still the better one.
    const far = Math.hypot(dx, dy) / Math.max(1, radius)
    return (Math.max(0, edge) + texture + 0.3 * shift) * (1 + 0.08 * far)
  }

  let best = { dx: 0, dy: 0, cost: Infinity }
  const consider = (dx: number, dy: number) => {
    const c = cost(dx, dy)
    if (c < best.cost) best = { dx, dy, cost: c }
  }

  // A long stroke needs to look further than a dab: a source a few radii off
  // along the stroke's own length would overlap it.
  const reach = Math.max(radius, Math.min(hole.x1 - hole.x0, hole.y1 - hole.y0) / 2)
  for (const ring of SEARCH_RINGS) {
    for (let a = 0; a < SEARCH_ANGLES; a++) {
      const t = (a / SEARCH_ANGLES) * Math.PI * 2
      consider(Math.round(Math.cos(t) * ring * reach), Math.round(Math.sin(t) * ring * reach))
    }
  }
  if (!Number.isFinite(best.cost)) return null

  // Then walk downhill from the best of them, halving the step to one pixel.
  for (let step = Math.max(1, Math.round(radius / 3)); step >= 1; step = Math.floor(step / 2)) {
    let moved = true
    while (moved) {
      moved = false
      const from = best
      for (const [ox, oy] of NEIGHBOURS) consider(from.dx + ox * step, from.dy + oy * step)
      if (best !== from) moved = true
    }
    if (step === 1) break
  }

  const edge = edgeMismatch(img, ringXY, best.dx, best.dy)
  const shift = toneShift(img, ringXY, best.dx, best.dy)
  let inner = 0
  for (const [x, y] of insideXY) inner += grad[(y + best.dy) * width + x + best.dx]
  inner /= insideXY.length
  // A busy surround healed from a flat patch reads as a smudge, however well
  // the edges agree — it is how an object on a textured ground fails.
  const flat = ringGrad > FLAT_BUSY ? FLAT_RATIO / Math.max(inner / ringGrad, 1e-3) : 0

  return {
    dx: best.dx,
    dy: best.dy,
    score: Math.max(edge / EDGE_LIMIT, shift / SHIFT_LIMIT, flat),
  }
}

/*
 * Where a heal stops holding, measured on synthetic spots and real objects in
 * photographs. Healed spots on paint, card, floor and a crease across a bonnet
 * came in at an edge mismatch of 0.003–0.10 and a tone shift under 0.06; a
 * lamp, a stretch of grille and a number plate — the things a heal smears —
 * at 0.15 and over, or with a shift of 0.2 to 0.5. The limits sit in the gap.
 */
const EDGE_LIMIT = 0.12
const SHIFT_LIMIT = 0.15
/** Surround gradient past which a flat source is suspect, and how flat is too flat. */
const FLAT_BUSY = 0.05
const FLAT_RATIO = 0.15

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const

function toneShift(img: Plane, ring: readonly (readonly [number, number])[], dx: number, dy: number) {
  const { width, data: d } = img
  const sum = [0, 0, 0]
  for (const [x, y] of ring) {
    const a = (y * width + x) * 4
    const b = ((y + dy) * width + x + dx) * 4
    for (let c = 0; c < 3; c++) sum[c] += (d[a + c] - d[b + c]) / 255
  }
  const n = ring.length || 1
  return Math.hypot(sum[0] / n, sum[1] / n, sum[2] / n) / Math.sqrt(3)
}

/** RMS edge difference once the mean offset is taken out, in 0..1 units. */
function edgeMismatch(img: Plane, ring: readonly (readonly [number, number])[], dx: number, dy: number) {
  const { width, data: d } = img
  const sum = [0, 0, 0]
  const sq = [0, 0, 0]
  for (const [x, y] of ring) {
    const a = (y * width + x) * 4
    const b = ((y + dy) * width + x + dx) * 4
    for (let c = 0; c < 3; c++) {
      const e = (d[a + c] - d[b + c]) / 255
      sum[c] += e
      sq[c] += e * e
    }
  }
  const n = ring.length || 1
  let v = 0
  for (let c = 0; c < 3; c++) v += Math.max(0, sq[c] / n - (sum[c] / n) ** 2)
  return Math.sqrt(v / 3)
}

/**
 * Heal the brushed area from the patch at (dx, dy).
 *
 * Returns a new buffer of the same size; only the pixels the brush covers
 * differ from the input.
 */
export function heal(img: Plane, alpha: Float32Array, dx: number, dy: number): Uint8ClampedArray {
  const { width, height, data } = img
  const out = new Uint8ClampedArray(data)
  const hole = coverageBounds(alpha, width, height)
  if (!hole) return out

  // The membrane is solved over the spot plus a pixel of known edge around it,
  // which is the boundary it takes its values from.
  const x0 = Math.max(0, hole.x0 - 1)
  const y0 = Math.max(0, hole.y0 - 1)
  const x1 = Math.min(width, hole.x1 + 1)
  const y1 = Math.min(height, hole.y1 + 1)
  const bw = x1 - x0
  const bh = y1 - y0

  const sample = (x: number, y: number, c: number) => {
    const sx = Math.min(width - 1, Math.max(0, x + dx))
    const sy = Math.min(height - 1, Math.max(0, y + dy))
    return data[(sy * width + sx) * 4 + c]
  }

  // The difference between target and source, known everywhere the brush is
  // not, and wanted everywhere it is.
  const known = new Uint8Array(bw * bh)
  const diff = [new Float32Array(bw * bh), new Float32Array(bw * bh), new Float32Array(bw * bh)]
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gx = x + x0
      const gy = y + y0
      const i = y * bw + x
      if (alpha[gy * width + gx] > 0) continue
      known[i] = 1
      for (let c = 0; c < 3; c++) diff[c][i] = data[(gy * width + gx) * 4 + c] - sample(gx, gy, c)
    }
  }

  for (let c = 0; c < 3; c++) membrane(diff[c], known, bw, bh)

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gx = x + x0
      const gy = y + y0
      const a = alpha[gy * width + gx]
      if (a <= 0) continue
      const o = (gy * width + gx) * 4
      for (let c = 0; c < 3; c++) {
        const healed = sample(gx, gy, c) + diff[c][y * bw + x]
        out[o + c] = data[o + c] + (healed - data[o + c]) * a
      }
    }
  }
  return out
}

/**
 * Blend a filled buffer into the original through the brush's coverage, so a
 * feathered brush fades into its surroundings whatever did the filling.
 */
export function blendThrough(original: Plane, filled: Uint8ClampedArray, alpha: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(original.data)
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i]
    if (a <= 0) continue
    const o = i * 4
    for (let c = 0; c < 3; c++) out[o + c] = original.data[o + c] + (filled[o + c] - original.data[o + c]) * a
  }
  return out
}

/**
 * Fill the unknowns of `values` with the smoothest surface through the knowns.
 *
 * Push–pull first, which gets a good answer everywhere in a handful of passes:
 * average the knowns down a pyramid until everything is covered, then bring
 * the averages back up into the gaps. That answer is smooth but faintly
 * blocky, so a few relaxation sweeps of the Laplace equation finish it — they
 * converge slowly from nothing and quickly from here.
 */
function membrane(values: Float32Array, known: Uint8Array, w: number, h: number) {
  pushPull(values, known, w, h)

  const sweeps = Math.min(60, 8 + Math.ceil(Math.max(w, h) / 4))
  const omega = 1.7
  for (let s = 0; s < sweeps; s++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        const l = values[x > 0 ? i - 1 : i]
        const r = values[x < w - 1 ? i + 1 : i]
        const u = values[y > 0 ? i - w : i]
        const d = values[y < h - 1 ? i + w : i]
        const avg = (l + r + u + d) / 4
        values[i] += omega * (avg - values[i])
      }
    }
  }
}

function pushPull(values: Float32Array, known: Uint8Array, w: number, h: number) {
  const weight = new Float32Array(w * h)
  for (let i = 0; i < weight.length; i++) weight[i] = known[i]
  const filled = pull(values, weight, w, h)
  for (let i = 0; i < values.length; i++) if (!known[i]) values[i] = filled[i]
}

/** One level of push–pull, recursively: returns a fully covered copy. */
function pull(v: Float32Array, wt: Float32Array, w: number, h: number): Float32Array {
  let complete = true
  for (let i = 0; i < wt.length; i++) if (wt[i] < 1) { complete = false; break }
  if (complete || (w <= 1 && h <= 1)) {
    const out = new Float32Array(v)
    if (!complete) {
      // A single pixel with no weight: nothing anywhere was known.
      for (let i = 0; i < out.length; i++) if (wt[i] <= 0) out[i] = 0
    }
    return out
  }

  const cw = Math.max(1, Math.ceil(w / 2))
  const ch = Math.max(1, Math.ceil(h / 2))
  const cv = new Float32Array(cw * ch)
  const cwt = new Float32Array(cw * ch)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const j = (y >> 1) * cw + (x >> 1)
      cv[j] += v[i] * wt[i]
      cwt[j] += wt[i]
    }
  }
  for (let j = 0; j < cv.length; j++) {
    if (cwt[j] > 0) cv[j] /= cwt[j]
    cwt[j] = Math.min(1, cwt[j])
  }

  const coarse = pull(cv, cwt, cw, ch)

  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      // Bilinear from the coarse level, centred on its own pixels.
      const up = bilinear(coarse, cw, ch, (x + 0.5) / 2 - 0.5, (y + 0.5) / 2 - 0.5)
      out[i] = wt[i] * v[i] + (1 - wt[i]) * up
    }
  }
  return out
}

function bilinear(v: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(w - 1, Math.max(0, x))
  const cy = Math.min(h - 1, Math.max(0, y))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const top = v[y0 * w + x0] * (1 - fx) + v[y0 * w + x1] * fx
  const bottom = v[y1 * w + x0] * (1 - fx) + v[y1 * w + x1] * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * Chamfer distance from the brushed area, in pixels, for every pixel outside
 * it. Two passes of the 3–4 mask: within a few percent of Euclidean, which is
 * all a ring width needs.
 */
function distanceFromHole(alpha: Float32Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = alpha[i] > 0 ? 0 : INF
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      }
      d[i] = v
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3
  return d
}

function luma(img: Plane): Float32Array {
  const out = new Float32Array(img.width * img.height)
  const d = img.data
  for (let i = 0; i < out.length; i++) {
    out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
  }
  return out
}

function gradient(lum: Float32Array, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const gx = lum[x < w - 1 ? i + 1 : i] - lum[x > 0 ? i - 1 : i]
      const gy = lum[y < h - 1 ? i + w : i] - lum[y > 0 ? i - w : i]
      g[i] = Math.abs(gx) + Math.abs(gy)
    }
  }
  return g
}

function subsample(list: number[], budget: number): number[] {
  if (list.length <= budget) return list
  const step = list.length / budget
  const out: number[] = []
  for (let k = 0; k < budget; k++) out.push(list[Math.floor(k * step)])
  return out
}

function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return dx * dx + dy * dy
}

function smooth(t: number) {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

export interface Patch {
  x: number
  y: number
  width: number
  height: number
  /** RGBA, `width` × `height`. */
  data: Uint8ClampedArray
}

/**
 * The part of a healed buffer that changed: the rectangle the brush covers,
 * cut out. Everything outside it is the input unchanged, and carrying it back
 * would only cost the copy and the upload.
 */
export function cutPatch(
  healed: Uint8ClampedArray,
  alpha: Float32Array,
  width: number,
  height: number,
): Patch | null {
  const box = coverageBounds(alpha, width, height)
  if (!box) return null
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((box.y0 + y) * width + box.x0) * 4
    data.set(healed.subarray(from, from + w * 4), y * w * 4)
  }
  return { x: box.x0, y: box.y0, width: w, height: h, data }
}
