import type { CurvePoint } from '../edit-stack/types'

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
