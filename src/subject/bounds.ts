import type { SubjectMap } from './detect'

/** A rectangle in upright image uv, the same space a crop rect lives in. */
export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The rectangle a subject occupies, for cropping to it.
 *
 * The coverage map is square, over the whole frame, in the stretched upright uv
 * the detector was shown — and a crop rect is a fraction of the same frame. So
 * a column index over the map's width *is* a uv coordinate, whatever the
 * photograph's aspect, and no conversion is needed beyond dividing by the size.
 *
 * What needs care is which pixels count. A hard threshold puts the edge of the
 * box on whichever stray pixel the model felt least sure about, and one of
 * those in a corner is enough to make the crop the whole frame. So this works
 * on *mass* instead: it sums coverage per row and per column and takes the span
 * holding all but a sliver at each end, which is stable against exactly that.
 */
export interface BoundsOptions {
  /**
   * Fraction of total coverage the box must contain. The remainder is split
   * between the two ends and discarded, so 0.98 drops the faintest 1% at each
   * edge — enough to shrug off a haze of low confidence without clipping an
   * arm.
   */
  keep?: number
  /** Breathing room, as a fraction of the box. A crop cut exactly to a subject
   *  looks like a mistake. */
  margin?: number
  /**
   * Below this much total coverage there is no subject worth cropping to —
   * measured as a fraction of the frame at full strength. Guards against
   * cropping to a few uncertain pixels on a photograph of nothing in
   * particular.
   */
  minCoverage?: number
}

export function subjectBounds(map: SubjectMap, options: BoundsOptions = {}): Bounds | null {
  const { keep = 0.98, margin = 0.06, minCoverage = 0.004 } = options
  const { data, size } = map
  if (!size || data.length < size * size) return null

  const cols = new Float64Array(size)
  const rows = new Float64Array(size)
  let total = 0

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = data[y * size + x] / 255
      if (v <= 0) continue
      cols[x] += v
      rows[y] += v
      total += v
    }
  }

  if (total < minCoverage * size * size) return null

  const drop = (total * (1 - keep)) / 2
  const span = (sums: Float64Array): [number, number] => {
    let acc = 0
    let lo = 0
    while (lo < size - 1 && acc + sums[lo] <= drop) acc += sums[lo++]
    acc = 0
    let hi = size - 1
    while (hi > lo && acc + sums[hi] <= drop) acc += sums[hi--]
    return [lo, hi]
  }

  const [x0, x1] = span(cols)
  const [y0, y1] = span(rows)

  // +1 because the span is inclusive: a subject occupying one column is one
  // column wide, not zero.
  let x = x0 / size
  let y = y0 / size
  let w = (x1 + 1 - x0) / size
  let h = (y1 + 1 - y0) / size

  if (margin > 0) {
    const mx = w * margin
    const my = h * margin
    x -= mx
    y -= my
    w += mx * 2
    h += my * 2
  }

  return clampToFrame({ x, y, w, h })
}

/**
 * Grow a box to a locked ratio about its own centre.
 *
 * `ratio` is expressed in uv — width over height *after* the frame's own aspect
 * has been divided out, which is how `CropTool` and the mask shader both carry
 * it. Growing rather than shrinking, so the subject stays inside whatever the
 * lock asks for rather than being cut to fit it.
 */
export function fitAspect(bounds: Bounds, ratio: number): Bounds {
  if (!Number.isFinite(ratio) || ratio <= 0) return bounds

  const cx = bounds.x + bounds.w / 2
  const cy = bounds.y + bounds.h / 2
  let { w, h } = bounds

  if (w / h < ratio) w = h * ratio
  else h = w / ratio

  // A box grown past the frame cannot keep both its ratio and its size; the
  // ratio is the part the user asked for, so the size gives way.
  const scale = Math.min(1, 1 / w, 1 / h)
  w *= scale
  h *= scale

  return clampToFrame({ x: cx - w / 2, y: cy - h / 2, w, h })
}

/** Slide a box back inside the frame, shrinking it only if it cannot fit. */
function clampToFrame(b: Bounds): Bounds {
  const w = Math.min(1, Math.max(1e-4, b.w))
  const h = Math.min(1, Math.max(1e-4, b.h))
  return {
    w,
    h,
    x: Math.min(Math.max(b.x, 0), 1 - w),
    y: Math.min(Math.max(b.y, 0), 1 - h),
  }
}

/**
 * Shift a box off the subject it was fitted to, as a fraction of its own size.
 *
 * Composition, not detection — which is why it is a separate step. A portrait
 * usually wants the face above centre rather than in the middle of the frame,
 * and a subject looking one way wants room on that side to look into. Measured
 * against the box rather than the frame so the same setting means the same
 * thing whether the subject is close or distant.
 */
export function offsetBounds(bounds: Bounds, dx: number, dy: number): Bounds {
  return clampToFrame({
    ...bounds,
    x: bounds.x + bounds.w * dx,
    y: bounds.y + bounds.h * dy,
  })
}
