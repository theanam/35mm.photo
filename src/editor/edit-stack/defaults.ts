import {
  GRADE_ZONES,
  HSL_BANDS,
  type ColorGrade,
  type Curves,
  type LensState,
  type PerspectiveState,
  type EditState,
  type HslBand,
  type HslAdjustment,
} from './types'

/** A straight line — the curve that changes nothing. */
export const IDENTITY_CURVE = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

export function identityCurves(): Curves {
  return {
    rgb: IDENTITY_CURVE.map((p) => ({ ...p })),
    r: IDENTITY_CURVE.map((p) => ({ ...p })),
    g: IDENTITY_CURVE.map((p) => ({ ...p })),
    b: IDENTITY_CURVE.map((p) => ({ ...p })),
  }
}

export function neutralHsl(): Record<HslBand, HslAdjustment> {
  return Object.fromEntries(
    HSL_BANDS.map((band) => [band, { hue: 0, sat: 0, lum: 0 }]),
  ) as Record<HslBand, HslAdjustment>
}

/**
 * Blending sits at 50 and balance at 0 — the same neutral Lightroom ships, so
 * a preset that omits them lands where its author expected.
 */
export function neutralColorGrade(): ColorGrade {
  return {
    ...(Object.fromEntries(
      GRADE_ZONES.map((zone) => [zone, { hue: 0, sat: 0, lum: 0 }]),
    ) as Pick<ColorGrade, 'shadows' | 'midtones' | 'highlights' | 'global'>),
    balance: 0,
    blending: 50,
  }
}

export function neutralPerspective(): PerspectiveState {
  return { vertical: 0, horizontal: 0, aspect: 0, scale: 100 }
}

export function neutralLens(): LensState {
  return { distortion: 0, ca: 0 }
}

/** Daylight. Temperatures are absolute Kelvin, so the neutral point is a value, not zero. */
export const NEUTRAL_TEMPERATURE = 5500

export function defaultEdits(): EditState {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,

    temperature: NEUTRAL_TEMPERATURE,
    tint: 0,
    vibrance: 0,
    saturation: 0,

    curves: identityCurves(),
    hsl: neutralHsl(),
    colorGrade: neutralColorGrade(),

    look: { id: null, strength: 100 },

    clarity: 0,
    texture: 0,
    dehaze: 0,
    sharpen: 0,
    denoiseLuma: 0,
    denoiseChroma: 0,

    halation: 0,
    grain: 0,
    grainSize: 50,
    vignette: 0,

    perspective: neutralPerspective(),
    lens: neutralLens(),

    crop: {
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      aspect: 'original',
      angle: 0,
      rotate90: 0,
      flipH: false,
      flipV: false,
    },
  }
}

/** Deep clone that stays honest about the shape — edits are plain JSON by design. */
export function cloneEdits(edits: EditState): EditState {
  return structuredClone(edits)
}

function curvesEqual(a: Curves, b: Curves): boolean {
  return (['rgb', 'r', 'g', 'b'] as const).every((ch) => {
    const pa = a[ch]
    const pb = b[ch]
    return pa.length === pb.length && pa.every((p, i) => p.x === pb[i].x && p.y === pb[i].y)
  })
}

export function editsEqual(a: EditState, b: EditState): boolean {
  if (!curvesEqual(a.curves, b.curves)) return false
  return JSON.stringify({ ...a, curves: null }) === JSON.stringify({ ...b, curves: null })
}
