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
export type PresetFormat = 'cube' | 'hald' | 'xmp' | 'lrtemplate'

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
 * A look is a compound effect, not an overlay (spec §4.3): a base colour
 * transform baked into a 3D LUT, a tone curve, an optional monochrome mix, and
 * grain sized per look.
 */
export interface LookConfig {
  id: string
  name: string
  /** One-line description shown on hover. */
  blurb: string

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

  /** Applied after the LUT, in the look's own pass. */
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

export interface ColorTransform {
  /** Row-major 3×3 channel mixer applied in linear light. */
  matrix?: number[]
  /** Overall saturation multiplier, 1 = unchanged. */
  saturation?: number
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
