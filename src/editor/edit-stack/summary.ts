import { NEUTRAL_TEMPERATURE } from './defaults'
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
}

const signed = (v: number, digits = 0) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`

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
    edits.whites !== 0 || edits.blacks !== 0
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

export function hasFinishEdits(edits: EditState): boolean {
  return edits.grain !== 0 || edits.vignette !== 0 || edits.halation !== 0
}

/**
 * The "YOUR EDITS" strip. The chips are derived from the edit state in pipeline
 * order rather than stored separately — the parameters are the source of truth,
 * so the strip cannot drift out of sync with what the photo actually shows.
 */
export function buildStack(edits: EditState, meta: ImageMeta | null): StackChip[] {
  const chips: StackChip[] = []

  if (meta?.isRaw) {
    chips.push({ id: 'raw', label: 'RAW develop', value: 'auto', panel: 'raw' })
  }

  if (edits.temperature !== NEUTRAL_TEMPERATURE || edits.tint !== 0) {
    const value =
      edits.temperature !== NEUTRAL_TEMPERATURE
        ? `${Math.round(edits.temperature)}K`
        : `tint ${signed(edits.tint)}`
    chips.push({ id: 'wb', label: 'White balance', value, panel: 'light' })
  }

  if (edits.exposure !== 0) {
    chips.push({ id: 'exposure', label: 'Exposure', value: signed(edits.exposure, 2), panel: 'light' })
  }

  if (hasToneEdits(edits)) {
    const value = edits.contrast !== 0 ? signed(edits.contrast) : 'shaped'
    chips.push({ id: 'tone', label: 'Tone', value, panel: 'light' })
  }

  if (edits.vibrance !== 0 || edits.saturation !== 0) {
    const value = edits.vibrance !== 0 ? signed(edits.vibrance) : signed(edits.saturation)
    chips.push({ id: 'colour', label: 'Colour', value, panel: 'light' })
  }

  if (hasCurveEdits(edits)) {
    chips.push({ id: 'curves', label: 'Curves', value: 'custom', panel: 'curves' })
  }

  if (hasMixerEdits(edits)) {
    const count = HSL_BANDS.filter((b) => {
      const a = edits.hsl[b]
      return a.hue || a.sat || a.lum
    }).length
    chips.push({ id: 'mixer', label: 'Colour mixer', value: `${count} band${count === 1 ? '' : 's'}`, panel: 'mixer' })
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
    })
  }

  if (hasCropEdits(edits)) {
    const value =
      edits.crop.aspect && edits.crop.aspect !== 'original' && edits.crop.aspect !== 'free'
        ? edits.crop.aspect
        : edits.crop.angle !== 0
          ? `${signed(edits.crop.angle, 1)}°`
          : 'custom'
    chips.push({ id: 'crop', label: 'Crop', value, panel: 'crop' })
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
    chips.push({ id: 'lens', label: 'Optics', value, panel: 'lens' })
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
    chips.push({ id: 'detail', label: 'Detail', value, panel: 'detail' })
  }

  if (hasMaskEdits(edits)) {
    const count = edits.masks.filter(maskIsActive).length
    chips.push({
      id: 'masks',
      label: 'Masks',
      value: `${count} local`,
      panel: 'masks',
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
    })
  }

  if (hasFinishEdits(edits)) {
    const value =
      edits.grain !== 0
        ? `grain ${Math.round(edits.grain)}`
        : edits.halation !== 0
          ? `halation ${Math.round(edits.halation)}`
          : `vignette ${signed(edits.vignette)}`
    chips.push({ id: 'grain', label: 'Grain & vignette', value, panel: 'grain' })
  }

  return chips
}

/** Count used in the recents grid ("5 edits · yesterday"). */
export function countEdits(edits: EditState): number {
  return buildStack(edits, null).length
}
