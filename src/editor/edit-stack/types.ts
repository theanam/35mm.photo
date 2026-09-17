/**
 * The edit stack is the single source of truth (spec §3.1): every edit is a
 * parameter, never a baked pixel. `EditState` is plain JSON so it round-trips
 * through IndexedDB and `.35mm.json` sidecars without a custom serialiser.
 */

import type { Orientation } from '../../io/exif'

export interface CurvePoint {
  /** Input level, 0..1. */
  x: number
  /** Output level, 0..1. */
  y: number
}

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b'

export type Curves = Record<CurveChannel, CurvePoint[]>

/** The 8 Lightroom-style colour bands of the mixer panel. */
export const HSL_BANDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const

export type HslBand = (typeof HSL_BANDS)[number]

export interface HslAdjustment {
  /** −100..100, degrees of hue rotation scaled to ±30°. */
  hue: number
  /** −100..100. */
  sat: number
  /** −100..100. */
  lum: number
}

export interface CropState {
  /** Normalised crop rect against the straightened image, 0..1. */
  x: number
  y: number
  w: number
  h: number
  /** Aspect lock id, or null for a free crop. */
  aspect: string | null
  /** Straighten angle in degrees, −15..15. */
  angle: number
  /** 90° steps, 0..3. */
  rotate90: number
  flipH: boolean
  flipV: boolean
}

export interface LookState {
  /** Id from the look catalogue, or null for no look. */
  id: string | null
  /** 0..100 blend against the un-looked pipeline output. */
  strength: number
}

/**
 * One zone of the colour grader. Hue is a full turn in degrees rather than a
 * −100..100 nudge, because a grading zone names an absolute colour — "warm
 * highlights at 40°" — where the mixer only ever bends a hue that is already
 * there.
 */
export interface GradeZone {
  hue: number // 0..360
  sat: number // 0..100
  lum: number // −100..100
}

/**
 * Split toning and colour grading (spec §6). Lightroom's legacy Split Toning
 * and its newer Color Grading are the same control with a different face: the
 * old one is shadows and highlights alone, the new one adds midtones and a
 * global wheel. Modelling the new shape covers both, and an imported legacy
 * preset simply leaves midtones and global neutral.
 */
export interface ColorGrade {
  shadows: GradeZone
  midtones: GradeZone
  highlights: GradeZone
  /** Applied everywhere, on top of the three zones. */
  global: GradeZone
  /** Slides the shadow/highlight crossover, −100..100. */
  balance: number
  /** How far neighbouring zones overlap, 0..100. */
  blending: number
}

export const GRADE_ZONES = ['shadows', 'midtones', 'highlights', 'global'] as const
export type GradeZoneId = (typeof GRADE_ZONES)[number]

export interface EditState {
  /* Light */
  exposure: number // −5..5 EV
  contrast: number // −100..100
  highlights: number // −100..100
  shadows: number // −100..100
  whites: number // −100..100
  blacks: number // −100..100

  /* Colour */
  temperature: number // 2000..12000 K
  tint: number // −100..100
  vibrance: number // −100..100
  saturation: number // −100..100

  /* Tone shaping */
  curves: Curves
  hsl: Record<HslBand, HslAdjustment>
  colorGrade: ColorGrade

  /* Look */
  look: LookState

  /* Detail */
  clarity: number // −100..100
  sharpen: number // 0..100
  denoiseLuma: number // 0..100
  denoiseChroma: number // 0..100

  /* Finishing */
  grain: number // 0..100
  grainSize: number // 0..100
  vignette: number // −100..100

  /* Geometry */
  crop: CropState
}

/** Metadata about the opened file. Never edited, only displayed. */
export interface ImageMeta {
  name: string
  /** Lowercase extension without the dot. */
  ext: string
  /** True for camera raw formats (spec §4.1). */
  isRaw: boolean
  /**
   * Upright dimensions — the picture the right way up, with EXIF applied. These
   * are what the crop, the export and the UI all work in.
   */
  width: number
  height: number
  /**
   * EXIF orientation of the stored pixels, 1–8. The render graph undoes it; no
   * other layer should need to know about it.
   */
  orientation: Orientation
  bytes: number
  /** As-shot values when the decoder can supply them. */
  iso?: number
  lens?: string
  camera?: string
  shotAt?: number
}

/** One entry in the filmstrip — a file the user opened or dropped. */
export interface Frame {
  id: string
  meta: ImageMeta
  /** Object URL of a small preview, for the filmstrip and recents grid. */
  thumbUrl?: string
  /** Set when the file could not be decoded in this browser. */
  error?: string
}
