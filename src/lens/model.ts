import type { CalibDistortion, CalibVignetting, CalibrationSet, DbLensIndex } from './types'

/**
 * From a lens's calibrations to the numbers the shader takes.
 *
 * Lensfun's database stores each model in "hugin units": a radius of 1 is
 * half the shorter side of the frame the calibration was made on, for
 * distortion and TCA, and half its diagonal for vignetting. Everything here
 * follows `libs/lensfun/{lens,mod-coord,mod-subpix,mod-color}.cpp` in the
 * project's own repository, which is the only place the conventions are
 * actually written down:
 *
 *   - which calibration set to use when the camera's crop factor is not the
 *     one the lens was measured on (`InterpolateDistortion`);
 *   - Hermite interpolation between focal lengths for distortion and TCA, and
 *     inverse-distance weighting over focal, aperture and distance for
 *     vignetting (`_lf_interpolate`, `__vignetting_dist`);
 *   - the renormalisation of poly3 and ptlens so that the centre of the frame
 *     keeps its scale (`rescale_polynomial_coefficients`);
 *   - how a radius in one frame maps to a radius in another when the crop
 *     factor or aspect ratio differs (`NormScale` and `hugin_scale`).
 *
 * The shader then evaluates one polynomial per correction, in the *image's*
 * hugin units — radius 1 at half this picture's shorter side — so the CPU does
 * every conversion once and the GPU does one lookup per pixel.
 */

/** Rd/Ru = 1 + c1 r + c2 r² + c3 r³ + c4 r⁴, r in hugin units of the calibration frame. */
export interface DistortionCoefficients {
  c: [number, number, number, number]
  calibCrop: number
  calibAspect: number
  /** True when the focal length fell outside the calibrated range. */
  clamped: boolean
}

/** Per channel, Rd/Ru = v + c r + b r² — Lensfun's poly3, linear being v alone. */
export interface TcaCoefficients {
  red: [number, number, number]
  blue: [number, number, number]
  calibCrop: number
  calibAspect: number
  clamped: boolean
}

/** The darkening 1 + k1 r² + k2 r⁴ + k3 r⁶, r in half-diagonals of the calibration frame. */
export interface VignettingCoefficients {
  k: [number, number, number]
  calibCrop: number
  clamped: boolean
}

/* ───────────────────────── calibration sets ───────────────────────── */

/**
 * The set measured on the sensor nearest this camera's, Lensfun's way: never
 * one made on a *larger* sensor than the photo's (the frame would reach past
 * what was calibrated), and among the rest the closest. A camera whose crop is
 * unknown is taken to be the one the lens was made for.
 */
export function pickCalibrationSet(
  sets: CalibrationSet[],
  crop: number | null,
  has: (s: CalibrationSet) => boolean,
): CalibrationSet | null {
  let best: CalibrationSet | null = null
  let bestRatio = Infinity
  for (const s of sets) {
    if (!has(s)) continue
    const r = (crop ?? s.crop) / s.crop
    if (r >= 0.96 && r < bestRatio) {
      bestRatio = r
      best = s
    }
  }
  return best
}

/* ───────────────────────── interpolation ───────────────────────── */

/** Lensfun's `_lf_interpolate`: a Hermite segment with one-sided tangents at the ends. */
export function hermite(y1: number | null, y2: number, y3: number, y4: number | null, t: number): number {
  const tg2 = y1 === null ? y3 - y2 : (y3 - y1) * 0.5
  const tg3 = y4 === null ? y3 - y2 : (y4 - y2) * 0.5
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * y2 + (t3 - 2 * t2 + t) * tg2 + (-2 * t3 + 3 * t2) * y3 + (t3 - t2) * tg3
}

/**
 * The four entries around a focal length, sorted: two below, two above, any
 * of which may be missing. An exact hit comes back on its own.
 */
function neighbours<T extends { focal: number }>(entries: T[], focal: number): { exact?: T; below: T[]; above: T[] } {
  const sorted = [...entries].sort((a, b) => a.focal - b.focal)
  const exact = sorted.find((e) => e.focal === focal)
  if (exact) return { exact, below: [], above: [] }
  const below = sorted.filter((e) => e.focal < focal).slice(-2)
  const above = sorted.filter((e) => e.focal > focal).slice(0, 2)
  return { below, above }
}

/**
 * Interpolate every term of a per-focal calibration at `focal`, scaling the
 * terms Lensfun says vary as 1/f by the focal length first — a straight line
 * through the data is then a much better guess than a curve.
 */
function interpolateTerms<T extends { focal: number; terms: number[] }>(
  entries: T[],
  focal: number,
  oneOverF: (index: number) => boolean,
): { terms: number[]; clamped: boolean; from: T } | null {
  if (!entries.length) return null
  const { exact, below, above } = neighbours(entries, focal)
  if (exact) return { terms: [...exact.terms], clamped: false, from: exact }
  if (!below.length || !above.length) {
    const nearest = below.length ? below[below.length - 1] : above[0]
    return { terms: [...nearest.terms], clamped: true, from: nearest }
  }
  const [y1, y2] = below.length === 2 ? below : [null, below[0]]
  const [y3, y4] = above.length === 2 ? above : [above[0], null]
  const t = (focal - y2.focal) / (y3.focal - y2.focal)
  const n = y2.terms.length
  const terms: number[] = []
  for (let i = 0; i < n; i++) {
    const scale = (e: T | null) => (e && oneOverF(i) ? e.focal : 1)
    const v = hermite(
      y1 ? y1.terms[i] * scale(y1) : null,
      y2.terms[i] * scale(y2),
      y3.terms[i] * scale(y3),
      y4 ? y4.terms[i] * scale(y4) : null,
      t,
    )
    terms.push(oneOverF(i) ? v / focal : v)
  }
  return { terms, clamped: false, from: y2 }
}

/* ───────────────────────── distortion ───────────────────────── */

export function distortionAt(set: CalibrationSet, focal: number): DistortionCoefficients | null {
  // One model per lens, as Lensfun assumes; the first one wins.
  const model = set.distortion[0]?.model
  const entries = set.distortion.filter((d) => d.model === model)
  const r = interpolateTerms(entries, focal, () => false)
  if (!r) return null
  return { c: toPolynomial(model, r.terms), calibCrop: set.crop, calibAspect: set.aspect, clamped: r.clamped }
}

/**
 * Every model as one polynomial in Rd/Ru, with Lensfun's renormalisation.
 *
 * The PanoTools forms shrink the centre of the frame by d = 1 − a − b − c;
 * Lensfun divides that out — a/d⁴, b/d³, c/d², and 1 for the constant — so
 * the corrected frame keeps its focal length and only the edges move. poly5
 * already has a constant of one.
 */
export function toPolynomial(model: CalibDistortion['model'], terms: number[]): [number, number, number, number] {
  switch (model) {
    case 'poly3': {
      const k1 = terms[0] ?? 0
      const d = 1 - k1
      return [0, k1 / (d * d * d), 0, 0]
    }
    case 'poly5':
      return [0, terms[0] ?? 0, 0, terms[1] ?? 0]
    case 'ptlens': {
      const [a = 0, b = 0, c = 0] = terms
      const d = 1 - a - b - c
      return [c / (d * d), b / (d * d * d), a / (d * d * d * d), 0]
    }
  }
}

/* ───────────────────────── TCA ───────────────────────── */

export function tcaAt(set: CalibrationSet, focal: number): TcaCoefficients | null {
  const model = set.tca[0]?.model
  const entries = set.tca.filter((t) => t.model === model)
  // Linear terms sit near 1 and stay put; the higher ones fall off as 1/f.
  const r = interpolateTerms(entries, focal, (i) => model === 'poly3' && i >= 2)
  if (!r) return null
  const t = r.terms
  const red: [number, number, number] = model === 'linear' ? [t[0] ?? 1, 0, 0] : [t[0] ?? 1, t[2] ?? 0, t[4] ?? 0]
  const blue: [number, number, number] = model === 'linear' ? [t[1] ?? 1, 0, 0] : [t[1] ?? 1, t[3] ?? 0, t[5] ?? 0]
  return { red, blue, calibCrop: set.crop, calibAspect: set.aspect, clamped: r.clamped }
}

/* ───────────────────────── vignetting ───────────────────────── */

/**
 * Lensfun's inverse-distance weighting, power 3.5, over a focal axis
 * normalised to the lens's range and reciprocal aperture and distance axes.
 * Subject distance is rarely in the file, so the farthest calibrated one is
 * assumed. Nothing within one unit of the shot means no answer.
 */
export function vignettingAt(
  set: CalibrationSet,
  lens: Pick<DbLensIndex, 'minFocal' | 'maxFocal'>,
  focal: number,
  aperture: number,
  distance = 1000,
): VignettingCoefficients | null {
  const entries = set.vignetting
  if (!entries.length || !(aperture > 0)) return null
  const df = lens.maxFocal - lens.minFocal
  const dist = (c: CalibVignetting) => {
    const f1 = df ? (focal - lens.minFocal) / df : 0
    const f2 = df ? (c.focal - lens.minFocal) / df : 0
    const a1 = 4 / aperture
    const a2 = 4 / c.aperture
    const d1 = 0.1 / distance
    const d2 = 0.1 / c.distance
    return Math.hypot(f2 - f1, a2 - a1, d2 - d1)
  }
  let total = 0
  let nearest = Infinity
  const k = [0, 0, 0]
  for (const c of entries) {
    const d = dist(c)
    if (d < 0.0001) return { k: [...c.terms], calibCrop: set.crop, clamped: false }
    nearest = Math.min(nearest, d)
    const w = 1 / Math.pow(d, 3.5)
    for (let i = 0; i < 3; i++) k[i] += w * c.terms[i]
    total += w
  }
  if (nearest > 1 || !total) return null
  const outside = focal < lens.minFocal || focal > lens.maxFocal
  return { k: [k[0] / total, k[1] / total, k[2] / total], calibCrop: set.crop, clamped: outside }
}

/* ───────────────────────── into the image's frame ───────────────────────── */

/**
 * The factor that turns a radius in this picture's hugin units into one in
 * the calibration frame's, for distortion and TCA.
 *
 * Lensfun measures both in millimetres on the sensor over the focal length,
 * so a frame with a different crop factor or shape only changes what one
 * unit of radius means. Half the short side of the picture is
 * diag₃₅ / crop / hypot(aspect, 1) / 2 mm; the calibration's is the same with
 * its own crop and aspect; the ratio is this.
 */
export function radiusScale(calibCrop: number, calibAspect: number, crop: number | null, aspect: number): number {
  const imageCrop = crop ?? calibCrop
  return (calibCrop / imageCrop) * (Math.hypot(calibAspect, 1) / Math.hypot(aspect, 1))
}

/** The same for vignetting, whose unit is half the diagonal rather than the short side. */
export function vignettingRadiusScale(calibCrop: number, crop: number | null, aspect: number): number {
  const imageCrop = crop ?? calibCrop
  return (calibCrop / imageCrop) / Math.hypot(aspect, 1)
}

/** A polynomial in r rescaled to one in r·s: the coefficient of rᵈ picks up sᵈ. */
export function rescalePolynomial<T extends number[]>(coeffs: T, s: number, degrees: number[]): T {
  return coeffs.map((c, i) => c * Math.pow(s, degrees[i] ?? 0)) as T
}

/* ───────────────────────── auto-scale ───────────────────────── */

/**
 * The zoom that leaves no empty corners and loses no more than it must,
 * Lensfun's way: for each of the eight points where the frame's edges and
 * corners are, find the output radius that the model sends exactly to that
 * edge, and take the largest ratio of edge to radius. Above one the frame
 * zooms in (pincushion pulled straight brings the corners inside); below one
 * it zooms out (barrel pushed straight leaves room past them). A thousandth
 * on top covers what happens between the eight points.
 *
 * `c` is in the image's own hugin units, radius 1 at half the short side, so
 * one of `halfW` and `halfH` is 1 and the other is the long side over it.
 */
export function autoScale(c: [number, number, number, number], halfW: number, halfH: number): number {
  if (c.every((v) => v === 0)) return 1
  const points: [number, number][] = [
    [halfW, 0],
    [halfW, halfH],
    [0, halfH],
    [-halfW, halfH],
    [-halfW, 0],
    [-halfW, -halfH],
    [0, -halfH],
    [halfW, -halfH],
  ]
  const rd = (ru: number) => ru * (1 + c[0] * ru + c[1] * ru * ru + c[2] * ru * ru * ru + c[3] * ru * ru * ru * ru)
  let scale = 0.01
  for (const [x, y] of points) {
    const edge = Math.hypot(x, y)
    // Newton on rd(ru) = edge, from the edge itself.
    let ru = edge
    let ok = false
    for (let i = 0; i < 50; i++) {
      const f = rd(ru) - edge
      if (Math.abs(f) < 1e-6) {
        ok = true
        break
      }
      const df = (rd(ru + 1e-4) - rd(ru)) / 1e-4
      if (!Number.isFinite(df) || Math.abs(df) < 1e-9) break
      ru -= f / df
      if (!(ru > 0)) break
    }
    if (!ok || !(ru > 0)) continue
    scale = Math.max(scale, edge / ru)
  }
  return scale * 1.001
}
