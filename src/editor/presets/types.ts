import type { CurvePoint, EditState } from '../edit-stack/types'
import type { InputSpace } from './inputSpace'

/**
 * A 3D colour cube. Lives here rather than in `lut3d.ts` so the preset types
 * can name it without importing the builder.
 */
export interface Lut3D {
  size: number
  /** size³ RGB triples, r fastest → b slowest, matching `.cube` order. */
  data: Float32Array
}

/** Import formats understood by `presets/import` (spec §4.3.1). */
export type PresetFormat = 'cube' | 'hald' | 'xmp' | 'lrtemplate' | 'dcp'

/**
 * A preset the user brought in from their own files. Two shapes hide behind
 * one record, because the two things people call a "filter" are not the same:
 *
 * - `lut` — a baked colour cube (`.cube`, HALD/strip PNG). Applied as a look,
 *   blendable with the strength slider, not otherwise editable.
 * - `parametric` — Lightroom/Camera Raw slider values (`.xmp`, `.lrtemplate`).
 *   Applied straight onto the edit stack, so every value stays adjustable.
 *
 * Stored in IndexedDB as-is: `Float32Array` is structured-cloneable, so no
 * serialiser is needed and nothing about a preset leaves the tab.
 */
export interface CustomPreset {
  /** `custom:<uuid>` — namespaced so it can never collide with a built-in id. */
  id: string
  name: string
  kind: 'lut' | 'parametric'
  format: PresetFormat
  /** The file it came from, shown in the preset's tooltip. */
  filename: string
  createdAt: number

  /** LUT presets: the cube exactly as parsed, still in its own input space. */
  lut?: Lut3D
  /** LUT presets: the space the cube expects. User-changeable after import. */
  inputSpace?: InputSpace

  /** Parametric presets: the subset of the edit stack this preset sets. */
  edits?: Partial<EditState>

  /**
   * Settings the importer recognised but cannot reproduce — masks, profiles,
   * split toning. Surfaced on import so a half-applied preset is never silent.
   */
  dropped?: string[]
}

/**
 * Sections of the looks grid. A look is chosen by the mood it is wanted for,
 * not by alphabetical order, so the grid groups by the kind of rendering each
 * one is: how a stock behaves, not who made it.
 */
export const LOOK_GROUPS = [
  'everyday',
  'reversal',
  'reportage',
  'negative',
  'cine',
  'mono',
  'exotic',
] as const

export type LookGroup = (typeof LOOK_GROUPS)[number]

export const LOOK_GROUP_LABEL: Record<LookGroup, string> = {
  everyday: 'Everyday',
  reversal: 'Reversal',
  reportage: 'Reportage',
  negative: 'Negative',
  cine: 'Cine',
  mono: 'Monochrome',
  exotic: 'Exotic',
}

/** Sits under each section heading, so the grid explains itself. */
export const LOOK_GROUP_BLURB: Record<LookGroup, string> = {
  everyday: 'Clean rendering that stays out of the way',
  reversal: 'Slide film: saturated, contrasty, white stays white',
  reportage: 'Muted colour with a firm tone curve',
  negative: 'Colour negative: lifted blacks, crossed shadows',
  cine: 'Low contrast, graded for the shadows',
  mono: 'Black and white, mixed rather than drained',
  exotic: 'Processes that were never meant to be subtle',
}

/**
 * A look is a compound effect, not an overlay (spec §4.3): a base colour
 * transform, a tone curve, an optional monochrome mix — all baked into one 3D
 * LUT — and grain sized per look.
 */
export interface LookConfig {
  id: string
  name: string
  /** One-line description shown on hover. */
  blurb: string
  /** Section of the grid. Imported presets have none — they get their own. */
  group?: LookGroup

  /**
   * Path to a `.cube` file under `public/luts/`. When present it is fetched and
   * parsed into the 3D LUT texture and `color` is ignored — this is the seam
   * for dropping in properly-built or licensed LUTs (spec §4.3, "Sourcing").
   */
  lut?: string

  /**
   * Procedural stand-in used to synthesise the 3D LUT when no `.cube` ships.
   * Every built-in look uses this so the repo carries no third-party LUT data.
   */
  color?: ColorTransform

  /**
   * The stock's density response: contrast, toe and shoulder. Baked into the
   * cube along with everything else, after the colour work and the monochrome
   * mix, so it shapes the tones the look has already decided on.
   */
  toneCurve?: CurvePoint[]

  /**
   * Monochrome looks desaturate *after* a channel-weighted contrast pass, not
   * by flattening to luma (spec §4.3.3).
   */
  mono?: MonoConfig

  grain: GrainConfig

  /** 0..100, the strength the look lands on when first applied. */
  defaultStrength: number

  /**
   * Set on looks synthesised from a user import. Its presence is what tells
   * the catalogue, the cache and the Looks grid that this is not a built-in.
   */
  custom?: CustomPreset
}

/**
 * One hue-selective adjustment, the way a film stock's dye layers respond to
 * one part of the spectrum rather than to everything at once.
 *
 * This is what separates a look from a filter. Turning every colour down by the
 * same amount gives you a muted picture; turning the reds toward brick, holding
 * the blues and letting the greens go olive gives you a *rendering*. The bands
 * cost nothing at runtime — like everything else here they are baked into the
 * 33³ cube once, and the shader still does a single lookup.
 */
export interface HueBand {
  /** Centre of the band on the wheel, 0..360 (0 red, 120 green, 240 blue). */
  hue: number
  /** Full width in degrees; influence falls to nothing at the edges. */
  width: number
  /** Degrees of rotation at the centre of the band. */
  shift?: number
  /** Saturation multiplier at the centre, 1 = unchanged. */
  sat?: number
  /** Luminance multiplier at the centre, 1 = unchanged. */
  lum?: number
}

export interface ColorTransform {
  /** Row-major 3×3 channel mixer applied in linear light. */
  matrix?: number[]
  /** Overall saturation multiplier, 1 = unchanged. */
  saturation?: number
  /**
   * How much of the saturation boost is given back in the highlights, 0..1.
   *
   * A flat multiplier is what makes a punchy look tip into a poster: the sky
   * and any bright red go to a solid, hueless block. Rolling the boost off
   * where the picture is brightest keeps the same punch in the midtones and
   * leaves the highlights somewhere a print could still go.
   */
  satRolloff?: number
  /** Hue-selective adjustments, applied in order. */
  hueBands?: HueBand[]
  /** RGB push added to the shadows, each −0.2..0.2. */
  shadowTint?: [number, number, number]
  /** RGB push added to the highlights, each −0.2..0.2. */
  highlightTint?: [number, number, number]
  /** Per-channel curves applied inside the LUT, in display space. */
  channelCurves?: { r?: CurvePoint[]; g?: CurvePoint[]; b?: CurvePoint[] }
  /** Lifts the black point, 0..0.1 — the "faded print" move. */
  blackLift?: number
  /** Pulls the white point down, 0..0.1. */
  whiteDrop?: number
}

export interface MonoConfig {
  /** Channel weights for the luminance mix; normalised at build time. */
  mix: [number, number, number]
  /** Contrast applied to the mixed luminance before desaturation, −100..100. */
  contrast: number
  /** Warm/cool tone of the print, −100 (cool) .. 100 (warm). */
  tone: number
}

export interface GrainConfig {
  /** 0..100 default grain amount for the look. */
  amount: number
  /** 0..100; larger values mean chunkier clumps. */
  size: number
  /** 0..1 — how much grain rides in the shadows vs. evenly. */
  shadowBias: number
}
