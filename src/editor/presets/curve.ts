import type { CurvePoint } from '../edit-stack/types'

/** Resolution of every 1D curve LUT handed to the GPU. */
export const CURVE_LUT_SIZE = 256

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Plain Catmull-Rom overshoots
 * between close control points, which shows up as a visible kink in the
 * highlights; this variant cannot overshoot.
 */
export function sampleCurve(points: CurvePoint[], size = CURVE_LUT_SIZE): Float32Array {
  const out = new Float32Array(size)
  const pts = [...points].sort((a, b) => a.x - b.x)

  if (pts.length === 0) {
    for (let i = 0; i < size; i++) out[i] = i / (size - 1)
    return out
  }
  if (pts.length === 1) {
    out.fill(clamp01(pts[0].y))
    return out
  }

  const n = pts.length
  const dx = new Float32Array(n - 1)
  const slope = new Float32Array(n - 1)
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    slope[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]
  }

  // Tangents: one-sided at the ends, weighted harmonic mean inside.
  const m = new Float32Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0 // local extremum — flatten to stay monotone
    } else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
    }
  }

  let seg = 0
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1)
    if (x <= pts[0].x) {
      out[i] = clamp01(pts[0].y)
      continue
    }
    if (x >= pts[n - 1].x) {
      out[i] = clamp01(pts[n - 1].y)
      continue
    }
    while (seg < n - 2 && x > pts[seg + 1].x) seg++

    const h = dx[seg]
    const t = (x - pts[seg].x) / h
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    out[i] = clamp01(
      h00 * pts[seg].y + h10 * h * m[seg] + h01 * pts[seg + 1].y + h11 * h * m[seg + 1],
    )
  }
  return out
}

/** Evaluate a sampled curve at an arbitrary 0..1 input with linear blending. */
export function evalSampled(lut: Float32Array, x: number): number {
  const f = clamp01(x) * (lut.length - 1)
  const i = Math.floor(f)
  const j = Math.min(i + 1, lut.length - 1)
  return lut[i] + (lut[j] - lut[i]) * (f - i)
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  if (points.length !== 2) return false
  const [a, b] = points
  return a.x === 0 && a.y === 0 && b.x === 1 && b.y === 1
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
