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

/**
 * Keystone correction. There is no rotate here on purpose — straighten already
 * owns in-plane rotation on `crop.angle`, and two controls for one turn is a
 * way to end up fighting yourself.
 */
export interface PerspectiveState {
  /** Converge or diverge the verticals, −100..100. */
  vertical: number
  /** The same across the frame, −100..100. */
  horizontal: number
  /** Stretch one axis against the other, −100..100. */
  aspect: number
  /** Zoom, 50..150. Keystoning pulls the frame in; this pushes it back out. */
  scale: number
}

/**
 * Manual optical corrections. Profile-driven correction is not possible here —
 * that needs Adobe's lens profile database, which is not redistributable — so
 * these are the two a photographer can dial in by eye.
 */
export interface LensState {
  /** Barrel (negative) through pincushion (positive), −100..100. */
  distortion: number
  /** Lateral chromatic aberration: red and blue scaled apart, −100..100. */
  ca: number
}

/**
 * Local adjustments (spec §7). A mask is a shape or a colour range, not a
 * painted bitmap: everything here is a handful of numbers, so masks survive a
 * `.35mm.json` sidecar, an IndexedDB record and a batch sync with no special
 * serialiser — the same property that makes every other edit parametric.
 *
 * Geometry is stored in *upright image* coordinates, 0..1 across the photo the
 * right way up, before the crop, the quarter turns and the flips. That is what
 * makes a mask stick to the thing it was drawn over: re-crop or straighten
 * afterwards and the mask travels with the content rather than with the frame.
 */
export interface MaskAdjust {
  exposure: number // −4..4 EV
  contrast: number // −100..100
  highlights: number // −100..100
  shadows: number // −100..100
  whites: number // −100..100
  blacks: number // −100..100
  /**
   * A *shift*, −100..100, not an absolute Kelvin like the global control. Only
   * the whole frame has a light source to be described; a region has a
   * neighbourhood to be warmed or cooled relative to it.
   */
  temperature: number
  tint: number // −100..100
  saturation: number // −100..100
  clarity: number // −100..100
  texture: number // −100..100
  sharpen: number // 0..100
}

interface MaskCommon {
  id: string
  /** Shown in the mask list; editable, and defaulted from the kind. */
  name: string
  /** Off keeps the mask in the list but out of the render. */
  enabled: boolean
  /** Act everywhere the mask does not, instead of where it does. */
  invert: boolean
  /** Overall strength of the whole mask, 0..100. */
  amount: number
  /** How far the edge fades, 0..100. For a range mask, how soft its ends are. */
  feather: number
  adjust: MaskAdjust
}

/** An ellipse. Radii are in upright-uv units; the angle turns it in real space. */
export interface RadialMask extends MaskCommon {
  kind: 'radial'
  cx: number
  cy: number
  rx: number
  ry: number
  /** Degrees, clockwise. */
  angle: number
}

/**
 * A gradient running from full effect at (x1,y1) to none at (x2,y2). Two points
 * rather than an angle and a width, because that is the gesture: you drag from
 * where the effect should be strongest to where it should stop.
 */
export interface LinearMask extends MaskCommon {
  kind: 'linear'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Everything between two luminance levels, 0..100. */
export interface LuminanceMask extends MaskCommon {
  kind: 'luminance'
  lo: number
  hi: number
}

/** A slice of the colour wheel. */
export interface ColourMask extends MaskCommon {
  kind: 'colour'
  /** Centre of the slice, 0..360. */
  hue: number
  /** How much of the wheel it covers, 0..100. */
  width: number
}

/**
 * The subject of the photograph, as a salient-object model sees it.
 *
 * The only mask whose shape is not described by its own fields. What is stored
 * is the *intent* — find the subject, with this model — and the coverage map is
 * derived from the picture and cached against the file. That keeps the edit
 * stack what it has always been, a handful of numbers that ride through a
 * sidecar, IndexedDB and a batch sync with no special serialiser; a bitmap in
 * here would end that for every mask, not just this one.
 *
 * It also makes this the one mask worth syncing across a batch. A radial over a
 * face lands on whatever happens to be in that corner of the next frame, which
 * is why sync leaves geometry off by default — but "the subject" re-derives per
 * photo, and means the same thing on all of them.
 */
export interface SubjectMask extends MaskCommon {
  kind: 'subject'
  /**
   * Which detector produced the map. A cached mask from another one is a
   * different answer, so this is part of the cache key rather than decoration.
   */
  model: string
}

export type Mask = RadialMask | LinearMask | LuminanceMask | ColourMask | SubjectMask

export type MaskKind = Mask['kind']

/** Every pass evaluates every mask per pixel, so the ceiling is a real one. */
export const MAX_MASKS = 8

/**
 * Raw development (spec §5). These are not adjustments — they decide what the
 * decoder hands the pipeline in the first place, and changing one means
 * developing the file again rather than moving a slider.
 *
 * The test for whether something belongs here rather than in the edit stack is
 * whether the pipeline could do it afterwards. Exposure, contrast and white
 * balance all survive downstream, non-destructively, so they stay downstream.
 * Demosaic, highlight reconstruction and pre-demosaic noise reduction cannot:
 * by the time the render graph sees pixels, the information those need is
 * already gone.
 */
export type WhiteBalanceBasis = 'camera' | 'auto' | 'neutral'
export type DemosaicQuality = 'fast' | 'standard' | 'best'
export type HighlightMode = 'clip' | 'unclip' | 'blend' | 'rebuild'
export type RawNoiseReduction = 'off' | 'light' | 'full'

export interface RawDevelopState {
  /** Where the white point starts. The temperature slider works on top of it. */
  whiteBalance: WhiteBalanceBasis
  /** Interpolation quality. The one control here with a real time cost. */
  demosaic: DemosaicQuality
  /** What to do with channels that clipped before the file was written. */
  highlights: HighlightMode
  /** Noise reduction *before* demosaic, which post-processing cannot match. */
  noiseReduction: RawNoiseReduction
  /** Develop at half resolution — around three times faster, for triage. */
  draft: boolean
}

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

  /**
   * Local tone mapping, −100..100. Unlike highlights and shadows, which decide
   * from the pixel alone, this decides from the area around it — so it can open
   * a face in shadow without lifting the night sky behind it.
   */
  dynamicRange: number

  /* Tone shaping */
  curves: Curves
  hsl: Record<HslBand, HslAdjustment>
  colorGrade: ColorGrade

  /* Look */
  look: LookState

  /* Detail */
  clarity: number // −100..100
  /** Mid-frequency contrast: finer than clarity, coarser than sharpening. */
  texture: number // −100..100
  /** Veil removal, positive; negative adds atmosphere back. */
  dehaze: number // −100..100
  sharpen: number // 0..100
  denoiseLuma: number // 0..100
  denoiseChroma: number // 0..100

  /* Finishing */
  /** Warm bloom of bright areas into their surroundings, as film does. */
  halation: number // 0..100
  grain: number // 0..100
  grainSize: number // 0..100
  vignette: number // −100..100

  /* Raw development — ignored for a file that is not raw */
  raw: RawDevelopState

  /* Local adjustments */
  masks: Mask[]

  /* Geometry */
  crop: CropState
  perspective: PerspectiveState
  lens: LensState
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
  /** Parameter groups away from default, for the filmstrip's edited marker. */
  editCount?: number
  /**
   * True when those edits exist only inside 35mm. Cleared by writing a sidecar,
   * which is the only step that puts them somewhere another program can read.
   * Edits always survive in IndexedDB regardless — this is about the file on
   * disk, not about losing work.
   */
  unsaved?: boolean
  /** Set when the file could not be decoded in this browser. */
  error?: string
}
