import {
  NEUTRAL_TEMPERATURE,
  defaultRawDevelop,
  identityCurves,
  neutralColorGrade,
  neutralFrame,
  neutralHsl,
  neutralLens,
  neutralPerspective,
} from './defaults'
import { isIdentityCurve } from '../presets/curve'
import { getLook } from '../presets/catalogue'
import { maskIsActive } from './masks'
import { GRADE_ZONES, HSL_BANDS, type EditState, type ImageMeta } from './types'

/** Panels the chips can jump to — matches the right-rail group ids. */
export type PanelId =
  | 'light'
  | 'crop'
  | 'looks'
  | 'curves'
  | 'mixer'
  | 'grade'
  | 'lens'
  | 'detail'
  | 'grain'
  | 'frame'
  | 'masks'
  | 'raw'

export interface StackChip {
  id: string
  label: string
  /** Right-hand value, rendered in the mono face. */
  value: string
  panel: PanelId
  /** The look chip is tinted in the design. */
  accent?: boolean
  /**
   * The values that switch this edit off while leaving it in the stack: what
   * the renderer is handed in place of the user's when the chip's eye is shut.
   * Absent on a chip that cannot be bypassed without re-reading the file.
   */
  off?: (edits: EditState) => Partial<EditState>
}

const signed = (v: number, digits = 0) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`

/** One decimal, without a trailing '.0' on a round number. */
function round1(v: number): string {
  return String(Math.round(v * 10) / 10)
}

export function hasCropEdits(edits: EditState): boolean {
  const c = edits.crop
  return (
    c.x !== 0 || c.y !== 0 || c.w !== 1 || c.h !== 1 ||
    c.angle !== 0 || c.rotate90 !== 0 || c.flipH || c.flipV
  )
}

export function hasCurveEdits(edits: EditState): boolean {
  const { rgb, r, g, b } = edits.curves
  return !(isIdentityCurve(rgb) && isIdentityCurve(r) && isIdentityCurve(g) && isIdentityCurve(b))
}

export function hasMixerEdits(edits: EditState): boolean {
  return HSL_BANDS.some((band) => {
    const a = edits.hsl[band]
    return a.hue !== 0 || a.sat !== 0 || a.lum !== 0
  })
}

export function hasGradeEdits(edits: EditState): boolean {
  // Balance and blending only shape zones that are already tinting something,
  // so on their own they are not an edit.
  return GRADE_ZONES.some((zone) => {
    const z = edits.colorGrade[zone]
    return z.sat !== 0 || z.lum !== 0
  })
}

export function hasLensEdits(edits: EditState): boolean {
  const p = edits.perspective
  const l = edits.lens
  return (
    p.vertical !== 0 || p.horizontal !== 0 || p.aspect !== 0 || p.scale !== 100 ||
    l.distortion !== 0 || l.ca !== 0
  )
}

export function hasToneEdits(edits: EditState): boolean {
  return (
    edits.contrast !== 0 || edits.highlights !== 0 || edits.shadows !== 0 ||
    edits.whites !== 0 || edits.blacks !== 0 || edits.dynamicRange !== 0
  )
}

export function hasDetailEdits(edits: EditState): boolean {
  return (
    edits.clarity !== 0 || edits.texture !== 0 || edits.dehaze !== 0 ||
    edits.sharpen !== 0 || edits.denoiseLuma !== 0 || edits.denoiseChroma !== 0
  )
}

/**
 * A mask counts once it would change something. An empty one is a mask you are
 * still placing, and the edit stack should not claim the photo has been altered
 * because you opened the tool.
 */
export function hasMaskEdits(edits: EditState): boolean {
  return edits.masks.some(maskIsActive)
}

/** True when the decoder is being asked for something other than the default. */
export function hasRawEdits(edits: EditState): boolean {
  const base = defaultRawDevelop()
  return (Object.keys(base) as (keyof typeof base)[]).some((k) => edits.raw[k] !== base[k])
}

/** The short form shown on the RAW chip and beside the panel title. */
export function rawSummary(edits: EditState): string {
  const raw = edits.raw
  const parts: string[] = []
  if (raw.draft) parts.push('draft')
  if (raw.demosaic !== 'standard') parts.push(raw.demosaic)
  if (raw.whiteBalance !== 'camera') parts.push(`${raw.whiteBalance} WB`)
  if (raw.highlights !== 'clip') parts.push(raw.highlights)
  if (raw.noiseReduction !== 'off') parts.push(`NR ${raw.noiseReduction}`)
  return parts.length ? parts.join(' · ') : 'as shot'
}

export function hasFinishEdits(edits: EditState): boolean {
  return edits.grain !== 0 || edits.vignette !== 0 || edits.halation !== 0
}

/**
 * A colour on its own is not an edit: the border has to have a width before any
 * of it is visible, so a photo whose only non-default is a mat colour nobody can
 * see is not a photo that has been edited.
 */
export function hasFrameEdits(edits: EditState): boolean {
  const f = edits.frame
  return f.top > 0 || f.right > 0 || f.bottom > 0 || f.left > 0
}

/**
 * The "YOUR EDITS" strip. The chips are derived from the edit state in pipeline
 * order rather than stored separately — the parameters are the source of truth,
 * so the strip cannot drift out of sync with what the photo actually shows.
 */
export function buildStack(edits: EditState, meta: ImageMeta | null): StackChip[] {
  const chips: StackChip[] = []

  if (meta?.isRaw) {
    chips.push({ id: 'raw', label: 'RAW develop', value: rawSummary(edits), panel: 'raw' })
  }

  if (edits.temperature !== NEUTRAL_TEMPERATURE || edits.tint !== 0) {
    const value =
      edits.temperature !== NEUTRAL_TEMPERATURE
        ? `${Math.round(edits.temperature)}K`
        : `tint ${signed(edits.tint)}`
    chips.push({
      id: 'wb',
      label: 'White balance',
      value,
      panel: 'light',
      off: () => ({ temperature: NEUTRAL_TEMPERATURE, tint: 0 }),
    })
  }

  if (edits.exposure !== 0) {
    chips.push({
      id: 'exposure',
      label: 'Exposure',
      value: signed(edits.exposure, 2),
      panel: 'light',
      off: () => ({ exposure: 0 }),
    })
  }

  if (hasToneEdits(edits)) {
    const value =
      edits.dynamicRange !== 0
        ? `range ${signed(edits.dynamicRange)}`
        : edits.contrast !== 0
          ? signed(edits.contrast)
          : 'shaped'
    chips.push({
      id: 'tone',
      label: 'Tone',
      value,
      panel: 'light',
      off: () => ({ contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, dynamicRange: 0 }),
    })
  }

  if (edits.vibrance !== 0 || edits.saturation !== 0) {
    const value = edits.vibrance !== 0 ? signed(edits.vibrance) : signed(edits.saturation)
    chips.push({
      id: 'colour',
      label: 'Colour',
      value,
      panel: 'light',
      off: () => ({ vibrance: 0, saturation: 0 }),
    })
  }

  if (hasCurveEdits(edits)) {
    chips.push({
      id: 'curves',
      label: 'Curves',
      value: 'custom',
      panel: 'curves',
      off: () => ({ curves: identityCurves() }),
    })
  }

  if (hasMixerEdits(edits)) {
    const count = HSL_BANDS.filter((b) => {
      const a = edits.hsl[b]
      return a.hue || a.sat || a.lum
    }).length
    chips.push({
      id: 'mixer',
      label: 'Colour mixer',
      value: `${count} band${count === 1 ? '' : 's'}`,
      panel: 'mixer',
      off: () => ({ hsl: neutralHsl() }),
    })
  }

  if (hasGradeEdits(edits)) {
    const count = GRADE_ZONES.filter((z) => {
      const v = edits.colorGrade[z]
      return v.sat !== 0 || v.lum !== 0
    }).length
    chips.push({
      id: 'grade',
      label: 'Colour grading',
      value: `${count} zone${count === 1 ? '' : 's'}`,
      panel: 'grade',
      off: () => ({ colorGrade: neutralColorGrade() }),
    })
  }

  if (hasCropEdits(edits)) {
    const { aspect, angle, w, h } = edits.crop
    // A locked ratio names itself. Failing that, say how much of the frame is
    // left — "custom" was the word here before, and it describes every crop
    // that is not a preset without saying anything about any of them.
    const kept = Math.round(w * h * 100)
    const value =
      aspect && aspect !== 'original' && aspect !== 'free'
        ? aspect
        : kept < 100
          ? `${kept}% kept`
          : angle !== 0
            ? `${signed(angle, 1)}°`
            : 'full'
    chips.push({
      id: 'crop',
      label: 'Crop',
      value,
      panel: 'crop',
      // The ratio lock is a setting, not a cut; only the cut comes off.
      off: (e) => ({
        crop: { ...e.crop, x: 0, y: 0, w: 1, h: 1, angle: 0, rotate90: 0, flipH: false, flipV: false },
      }),
    })
  }

  if (hasLensEdits(edits)) {
    const p = edits.perspective
    const value =
      p.vertical !== 0
        ? `vertical ${signed(p.vertical)}`
        : p.horizontal !== 0
          ? `horizontal ${signed(p.horizontal)}`
          : edits.lens.distortion !== 0
            ? `distortion ${signed(edits.lens.distortion)}`
            : 'corrected'
    chips.push({
      id: 'lens',
      label: 'Optics',
      value,
      panel: 'lens',
      off: () => ({ perspective: neutralPerspective(), lens: neutralLens() }),
    })
  }

  if (hasDetailEdits(edits)) {
    const value =
      edits.dehaze !== 0
        ? `dehaze ${signed(edits.dehaze)}`
        : edits.texture !== 0
          ? `texture ${signed(edits.texture)}`
          : edits.sharpen !== 0
            ? `sharpen ${Math.round(edits.sharpen)}`
            : `clarity ${signed(edits.clarity)}`
    chips.push({
      id: 'detail',
      label: 'Detail',
      value,
      panel: 'detail',
      off: () => ({ clarity: 0, texture: 0, dehaze: 0, sharpen: 0, denoiseLuma: 0, denoiseChroma: 0 }),
    })
  }

  if (hasMaskEdits(edits)) {
    const count = edits.masks.filter(maskIsActive).length
    chips.push({
      id: 'masks',
      label: 'Masks',
      value: `${count} local`,
      panel: 'masks',
      off: () => ({ masks: [] }),
    })
  }

  const look = getLook(edits.look.id)
  if (look) {
    chips.push({
      id: 'look',
      label: `${look.name} look`,
      value: String(Math.round(edits.look.strength)),
      panel: 'looks',
      accent: true,
      off: (e) => ({ look: { ...e.look, id: null } }),
    })
  }

  if (hasFinishEdits(edits)) {
    const value =
      edits.grain !== 0
        ? `grain ${Math.round(edits.grain)}`
        : edits.halation !== 0
          ? `halation ${Math.round(edits.halation)}`
          : `vignette ${signed(edits.vignette)}`
    chips.push({
      id: 'grain',
      label: 'Grain & vignette',
      value,
      panel: 'grain',
      off: () => ({ grain: 0, vignette: 0, halation: 0 }),
    })
  }

  if (hasFrameEdits(edits)) {
    const f = edits.frame
    const sides = [f.top, f.right, f.bottom, f.left]
    const even = sides.every((v) => Math.abs(v - sides[0]) < 0.05)
    // One number when the mat is even, the widest side when it is not: four
    // numbers would not fit a chip, and the widest is the one you notice.
    const suffix = f.unit === 'pixel' ? 'px' : '%'
    const value = even
      ? `${round1(sides[0])}${suffix}`
      : `up to ${round1(Math.max(...sides))}${suffix}`
    chips.push({
      id: 'frame',
      label: 'Frame',
      value,
      panel: 'frame',
      off: () => ({ frame: neutralFrame() }),
    })
  }

  return chips
}

/** Count used in the recents grid ("5 edits · yesterday"). */
export function countEdits(edits: EditState): number {
  return buildStack(edits, null).length
}

/**
 * The edits as the renderer should see them: every chip whose eye is shut is
 * replaced by its off state. The user's values are untouched — this is a view
 * of the stack, never a write to it — so opening the eye again is free.
 */
export function withHidden(
  edits: EditState,
  hidden: readonly string[],
  meta: ImageMeta | null,
): EditState {
  if (!hidden.length) return edits
  let out = edits
  for (const chip of buildStack(edits, meta)) {
    if (chip.off && hidden.includes(chip.id)) out = { ...out, ...chip.off(out) }
  }
  return out
}

/**
 * The hidden set after an edit: a shut eye opens again the moment its own
 * controls are touched. Dragging exposure while exposure is switched off would
 * otherwise move a slider that changes nothing on screen, which reads as a
 * broken slider rather than a hidden edit. A chip that has left the stack is
 * forgotten too, so a stale id cannot come back to life on a later edit.
 */
export function revealTouched(
  hidden: readonly string[],
  before: EditState,
  after: EditState,
  meta: ImageMeta | null,
): readonly string[] {
  if (!hidden.length) return hidden
  const chips = new Map(buildStack(after, meta).map((c) => [c.id, c]))
  const kept = hidden.filter((id) => {
    const chip = chips.get(id)
    if (!chip?.off) return false
    // The keys a chip's off state writes are the keys it governs.
    const keys = Object.keys(chip.off(after)) as (keyof EditState)[]
    return keys.every((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]))
  })
  return kept.length === hidden.length ? hidden : kept
}
