import {
  NEUTRAL_TEMPERATURE,
  identityCurves,
  neutralColorGrade,
  neutralHsl,
} from '../../edit-stack/defaults'
import { HSL_BANDS, type CurvePoint, type EditState, type HslBand } from '../../edit-stack/types'
import { evalSampled, sampleCurve } from '../curve'

/**
 * Camera Raw settings (`crs:`) → this app's edit stack.
 *
 * `.xmp` and `.lrtemplate` disagree about how they *spell* a preset but agree
 * completely on what the settings are called, so both importers funnel through
 * here. The field names line up unusually well: Exposure2012 is already EV,
 * and the tone controls and the eight HSL bands are already −100..100 on both
 * sides, in the same order.
 *
 * Everything Lightroom can do that this pipeline cannot is collected in
 * `dropped` rather than quietly discarded — a preset that half-applied without
 * saying so would be worse than one that refused.
 */

export type CrsSettings = Record<string, unknown>

export interface CrsResult {
  edits: Partial<EditState>
  /** Human-readable list of what did not come across. */
  dropped: string[]
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

function num(settings: CrsSettings, key: string): number | null {
  const raw = settings[key]
  if (raw == null) return null
  const v = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(v) ? v : null
}

/**
 * Camera Raw is not consistent about how it writes a boolean: the switches it
 * exposes as checkboxes come out as True/False, but the internal enable flags —
 * LensProfileEnable among them — are written as 1/0. Reading only "true" made
 * those flags silently invisible, so a preset with lens corrections imported
 * without ever mentioning them.
 */
function bool(settings: CrsSettings, key: string): boolean {
  const raw = settings[key]
  if (raw === true) return true
  const text = String(raw).trim().toLowerCase()
  return text === 'true' || text === '1'
}

/** True when the key is present and away from Camera Raw's own default. */
function set(settings: CrsSettings, key: string, dflt = 0): boolean {
  const v = num(settings, key)
  return v != null && v !== dflt
}

export function mapCrsSettings(settings: CrsSettings): CrsResult {
  const edits: Partial<EditState> = {}
  const dropped: string[] = []

  /* ── light ───────────────────────────────────────────────────────── */

  const exposure = num(settings, 'Exposure2012') ?? num(settings, 'Exposure')
  if (exposure != null) edits.exposure = clamp(exposure, -5, 5)

  const direct: [string, keyof EditState][] = [
    ['Contrast2012', 'contrast'],
    ['Highlights2012', 'highlights'],
    ['Shadows2012', 'shadows'],
    ['Whites2012', 'whites'],
    ['Blacks2012', 'blacks'],
    ['Vibrance', 'vibrance'],
    ['Saturation', 'saturation'],
    ['Clarity2012', 'clarity'],
  ]
  for (const [key, field] of direct) {
    const v = num(settings, key)
    if (v != null) (edits as Record<string, number>)[field] = clamp(v, -100, 100)
  }

  /* ── white balance ───────────────────────────────────────────────── */

  // Raw-derived presets carry an absolute illuminant; presets saved off a JPEG
  // carry a relative nudge. They need different arithmetic to land in Kelvin.
  const kelvin = num(settings, 'Temperature')
  const incTemp = num(settings, 'IncrementalTemperature')
  if (kelvin != null && kelvin > 1000) {
    edits.temperature = clamp(kelvin, 2000, 12000)
    dropped.push(
      'white balance is absolute Kelvin from the original raw file — check it against this photo',
    )
  } else if (incTemp != null && incTemp !== 0) {
    const span = incTemp >= 0 ? 12000 - NEUTRAL_TEMPERATURE : NEUTRAL_TEMPERATURE - 2000
    edits.temperature = clamp(NEUTRAL_TEMPERATURE + (incTemp / 100) * span, 2000, 12000)
  }

  // Both sides run green negative, magenta positive; only the range differs.
  const tint = num(settings, 'Tint') ?? num(settings, 'IncrementalTint')
  if (tint != null) edits.tint = clamp((tint * 100) / 150, -100, 100)

  /* ── detail and finishing ────────────────────────────────────────── */

  const sharpness = num(settings, 'Sharpness')
  if (sharpness != null) edits.sharpen = clamp((sharpness * 100) / 150, 0, 100)

  const lumaNr = num(settings, 'LuminanceSmoothing')
  if (lumaNr != null) edits.denoiseLuma = clamp(lumaNr, 0, 100)

  const chromaNr = num(settings, 'ColorNoiseReduction')
  if (chromaNr != null) edits.denoiseChroma = clamp(chromaNr, 0, 100)

  const grain = num(settings, 'GrainAmount')
  if (grain != null) edits.grain = clamp(grain, 0, 100)

  const grainSize = num(settings, 'GrainSize')
  if (grainSize != null) edits.grainSize = clamp(grainSize, 0, 100)

  // Lightroom counts a darkened vignette as negative; this app counts it up.
  const vignette = num(settings, 'PostCropVignetteAmount')
  if (vignette != null) edits.vignette = clamp(-vignette, -100, 100)

  /* ── tone curves ─────────────────────────────────────────────────── */

  const curves = identityCurves()
  let anyCurve = false
  const curveKeys: [string, keyof typeof curves][] = [
    ['ToneCurvePV2012', 'rgb'],
    ['ToneCurvePV2012Red', 'r'],
    ['ToneCurvePV2012Green', 'g'],
    ['ToneCurvePV2012Blue', 'b'],
  ]
  for (const [key, channel] of curveKeys) {
    const points = parseToneCurve(settings[key])
    if (points) {
      curves[channel] = points
      anyCurve = true
    }
  }
  // PV2003 files only have the one combined curve.
  if (!anyCurve) {
    const legacy = parseToneCurve(settings.ToneCurve)
    if (legacy) {
      curves.rgb = legacy
      anyCurve = true
    }
  }
  // Lightroom stacks a parametric curve on top of the point curve. There is no
  // second curve in this pipeline, so evaluate the parametric one and compose
  // it onto the point curve — the result is a single curve that does what both
  // did. Point curve first, matching the order Camera Raw applies them in.
  const parametric = parametricCurve(settings)
  if (parametric) {
    const point = sampleCurve(curves.rgb)
    curves.rgb = resample((x) => evalSampled(parametric, evalSampled(point, x)))
    anyCurve = true
  }

  if (anyCurve) edits.curves = curves

  /* ── HSL, and the black & white mix ──────────────────────────────── */

  const mono = bool(settings, 'ConvertToGrayscale')
  const hsl = neutralHsl()
  let anyHsl = false

  for (const band of HSL_BANDS) {
    const Band = capitalise(band)
    if (mono) {
      // The mixer runs before saturation in the colour pass, so a channel-
      // weighted luminance survives the desaturation below — which is exactly
      // what Lightroom's B&W mix does.
      const gray = num(settings, `GrayMixer${Band}`)
      if (gray != null && gray !== 0) {
        hsl[band as HslBand].lum = clamp(gray, -100, 100)
        anyHsl = true
      }
      continue
    }
    for (const [key, field] of [
      [`HueAdjustment${Band}`, 'hue'],
      [`SaturationAdjustment${Band}`, 'sat'],
      [`LuminanceAdjustment${Band}`, 'lum'],
    ] as const) {
      const v = num(settings, key)
      if (v != null && v !== 0) {
        hsl[band as HslBand][field] = clamp(v, -100, 100)
        anyHsl = true
      }
    }
  }
  if (anyHsl) edits.hsl = hsl
  if (mono) edits.saturation = -100

  /* ── split toning and colour grading ─────────────────────────────── */

  const grade = mapColorGrade(settings)
  if (grade) edits.colorGrade = grade

  /* ── what could not come across ──────────────────────────────────── */

  collectDropped(settings, dropped)

  return { edits, dropped }
}

/**
 * Split toning and colour grading share one destination. Lightroom writes the
 * legacy `SplitToning*` pair, the newer `ColorGrade*` set, or both — a preset
 * saved by a recent version carries the new keys and mirrors them into the old
 * ones for older readers. The new keys therefore win where both are present.
 *
 * Saturation carries the intent: a hue with no saturation paints nothing, which
 * is how Lightroom stores "this wheel is untouched".
 */
function mapColorGrade(settings: CrsSettings): EditState['colorGrade'] | null {
  const grade = neutralColorGrade()
  let any = false

  const zones: [keyof typeof grade, string, string][] = [
    ['shadows', 'ColorGradeShadow', 'SplitToningShadow'],
    ['highlights', 'ColorGradeHighlight', 'SplitToningHighlight'],
  ]
  for (const [zone, modern, legacy] of zones) {
    const hue = num(settings, `${modern}Hue`) ?? num(settings, `${legacy}Hue`)
    const sat = num(settings, `${modern}Sat`) ?? num(settings, `${legacy}Saturation`)
    const lum = num(settings, `${modern}Lum`)
    if (sat != null && sat !== 0) {
      const target = grade[zone] as EditState['colorGrade']['shadows']
      target.hue = ((hue ?? 0) % 360 + 360) % 360
      target.sat = clamp(sat, 0, 100)
      target.lum = clamp(lum ?? 0, -100, 100)
      any = true
    }
  }

  // Midtones and global exist only in the modern set.
  for (const [zone, prefix] of [
    ['midtones', 'ColorGradeMidtone'],
    ['global', 'ColorGradeGlobal'],
  ] as const) {
    const sat = num(settings, `${prefix}Sat`)
    if (sat != null && sat !== 0) {
      grade[zone].hue = ((num(settings, `${prefix}Hue`) ?? 0) % 360 + 360) % 360
      grade[zone].sat = clamp(sat, 0, 100)
      grade[zone].lum = clamp(num(settings, `${prefix}Lum`) ?? 0, -100, 100)
      any = true
    }
  }

  if (!any) return null

  const balance = num(settings, 'SplitToningBalance') ?? num(settings, 'ColorGradeBalance')
  if (balance != null) grade.balance = clamp(balance, -100, 100)
  const blending = num(settings, 'ColorGradeBlending')
  if (blending != null) grade.blending = clamp(blending, 0, 100)

  return grade
}

/**
 * Camera Raw's parametric curve: four region sliders over three split points.
 * Each slider lifts or drops its own stretch of the tone range with a raised
 * cosine falloff, so neighbouring regions blend instead of stepping. The split
 * points decide where each region sits; their defaults are Lightroom's own.
 *
 * This is a faithful-in-shape model rather than Adobe's exact curve, which is
 * not documented. It gets the direction and rough magnitude right, which is
 * what makes an imported preset look like itself.
 */
function parametricCurve(settings: CrsSettings): Float32Array | null {
  const regions = [
    num(settings, 'ParametricShadows') ?? 0,
    num(settings, 'ParametricDarks') ?? 0,
    num(settings, 'ParametricLights') ?? 0,
    num(settings, 'ParametricHighlights') ?? 0,
  ]
  if (regions.every((v) => v === 0)) return null

  const shadowSplit = (num(settings, 'ParametricShadowSplit') ?? 25) / 100
  const midSplit = (num(settings, 'ParametricMidtoneSplit') ?? 50) / 100
  const highSplit = (num(settings, 'ParametricHighlightSplit') ?? 75) / 100

  // Region centres, and a half-width that reaches its neighbours.
  const centres = [shadowSplit / 2, (shadowSplit + midSplit) / 2, (midSplit + highSplit) / 2, (1 + highSplit) / 2]
  const halfWidths = [
    Math.max(shadowSplit, 0.05),
    Math.max(midSplit - shadowSplit, 0.05),
    Math.max(highSplit - midSplit, 0.05),
    Math.max(1 - highSplit, 0.05),
  ]

  return resampleRaw((x) => {
    let y = x
    for (let i = 0; i < 4; i++) {
      if (regions[i] === 0) continue
      const d = Math.abs(x - centres[i]) / (halfWidths[i] * 1.6)
      if (d >= 1) continue
      // Raised cosine: 1 at the centre, 0 at the edge, flat where they meet.
      const w = 0.5 * (1 + Math.cos(Math.PI * d))
      y += (regions[i] / 100) * 0.25 * w
    }
    // Camera Raw anchors the parametric curve in the corners: a shadow lift
    // raises near-black without moving black itself. Without this the region
    // sliders drag the black and white points with them, which is a different
    // edit — and one the preset never asked for.
    return clamp01(y * anchor(x) + x * (1 - anchor(x)))
  })
}

/**
 * 1 across the body of the range, falling to 0 at each end. The ramp is short
 * so the regions keep their full strength everywhere except the last sliver
 * against the corners.
 */
function anchor(x: number): number {
  return smoothstep(0, 0.06, x) * smoothstep(0, 0.06, 1 - x)
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Evaluate a 0..1 function into a curve LUT. */
function resampleRaw(f: (x: number) => number, size = 256): Float32Array {
  const out = new Float32Array(size)
  for (let i = 0; i < size; i++) out[i] = f(i / (size - 1))
  return out
}

/**
 * Evaluate a function back into control points. Sixteen is plenty: the curve
 * editor re-interpolates with the same monotone spline the GPU uses, and more
 * points would only make the panel unusable to drag.
 */
function resample(f: (x: number) => number, points = 16): CurvePoint[] {
  const out: CurvePoint[] = []
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1)
    out.push({ x, y: Math.min(1, Math.max(0, f(x))) })
  }
  return out
}

function collectDropped(settings: CrsSettings, dropped: string[]) {
  const masks = [
    'MaskGroupBasedCorrections',
    'CircularGradientBasedCorrections',
    'GradientBasedCorrections',
    'PaintBasedCorrections',
  ]
  if (masks.some((k) => settings[k] != null)) {
    dropped.push('masks and local adjustments')
  }
  if (settings.Look != null || settings.LookName != null || settings.LookTable != null) {
    dropped.push('the profile this preset is built on')
  }
  if (set(settings, 'Texture')) dropped.push('texture')
  if (set(settings, 'Dehaze')) dropped.push('dehaze')
  if (
    set(settings, 'RedHue') || set(settings, 'RedSaturation') ||
    set(settings, 'GreenHue') || set(settings, 'GreenSaturation') ||
    set(settings, 'BlueHue') || set(settings, 'BlueSaturation') ||
    set(settings, 'ShadowTint')
  ) {
    dropped.push('camera calibration')
  }
  if (settings.LensProfileName != null || bool(settings, 'LensProfileEnable')) {
    dropped.push('lens corrections')
  }
  if (set(settings, 'DefringePurpleAmount') || set(settings, 'DefringeGreenAmount')) {
    dropped.push('defringe')
  }
  if (
    set(settings, 'PerspectiveVertical') || set(settings, 'PerspectiveHorizontal') ||
    set(settings, 'PerspectiveRotate')
  ) {
    dropped.push('perspective / upright')
  }
  if (Array.isArray(settings.RetouchAreas) && settings.RetouchAreas.length) {
    dropped.push('healing and retouch spots')
  }
}

/**
 * Tone curve points. XMP writes an `rdf:Seq` of `"x, y"` strings, an
 * `.lrtemplate` writes a flat array of alternating numbers, and both count in
 * 0–255.
 */
function parseToneCurve(raw: unknown): CurvePoint[] | null {
  if (!Array.isArray(raw) || !raw.length) return null

  const pairs: CurvePoint[] = []
  if (typeof raw[0] === 'string') {
    for (const entry of raw as string[]) {
      const [x, y] = String(entry).split(',').map((n) => Number.parseFloat(n.trim()))
      if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x: x / 255, y: y / 255 })
    }
  } else {
    const flat = (raw as number[]).map(Number)
    for (let i = 0; i + 1 < flat.length; i += 2) {
      if (Number.isFinite(flat[i]) && Number.isFinite(flat[i + 1])) {
        pairs.push({ x: flat[i] / 255, y: flat[i + 1] / 255 })
      }
    }
  }

  if (pairs.length < 2) return null
  pairs.sort((a, b) => a.x - b.x)

  // A straight line is Lightroom's way of saying "no curve here"; importing it
  // would mark the Curves panel as edited for nothing.
  const identity = pairs.length === 2 &&
    pairs[0].x === 0 && pairs[0].y === 0 && pairs[1].x === 1 && pairs[1].y === 1
  return identity ? null : pairs
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
