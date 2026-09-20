import type {
  ColourMask,
  LinearMask,
  LuminanceMask,
  Mask,
  MaskAdjust,
  MaskKind,
  RadialMask,
} from './types'
import { DETECT_VERSION } from '../../subject/detect'

/** A mask that changes nothing yet — a fresh one starts here. */
export function neutralMaskAdjust(): MaskAdjust {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    clarity: 0,
    texture: 0,
    sharpen: 0,
    blur: 0,
  }
}

export const MASK_KIND_LABEL: Record<MaskKind, string> = {
  radial: 'Radial',
  linear: 'Linear',
  luminance: 'Luminance',
  colour: 'Colour',
  subject: 'Subject',
}

const MASK_KIND_HINT: Record<MaskKind, string> = {
  radial: 'an ellipse you place on the picture',
  linear: 'a gradient from one edge into the frame',
  luminance: 'wherever the picture sits in a band of brightness',
  colour: 'wherever the picture holds one range of hues',
  subject: 'whatever the picture is of, found for you',
}

export function maskKindHint(kind: MaskKind): string {
  return MASK_KIND_HINT[kind]
}

/**
 * A new mask, placed to be visible and adjustable straight away rather than
 * sitting on a default nobody wants. Radial and linear need the frame's shape:
 * a circle is only a circle if the radii are in proportion to it.
 *
 * `aspect` is the upright image's width ÷ height.
 */
export function createMask(kind: MaskKind, aspect: number, existing: Mask[] = []): Mask {
  const base = {
    id: crypto.randomUUID(),
    name: nextMaskName(kind, existing),
    enabled: true,
    invert: false,
    amount: 100,
    feather: 50,
    adjust: neutralMaskAdjust(),
  }

  const a = aspect > 0 ? aspect : 1

  switch (kind) {
    case 'radial': {
      // A circle covering roughly a third of the short edge. Radii are in uv,
      // so the one running along the long edge is the smaller number.
      const r = 0.3 * Math.min(1, a)
      return { ...base, kind, cx: 0.5, cy: 0.5, rx: r / a, ry: r, angle: 0 }
    }
    case 'linear':
      // Top-down: the gradient most people reach for first is a darkened sky.
      return { ...base, kind, x1: 0.5, y1: 0.08, x2: 0.5, y2: 0.45 }
    case 'luminance':
      // The top third of the tonal range — the highlights, roughly.
      return { ...base, kind, lo: 65, hi: 100 }
    case 'colour':
      return { ...base, kind, hue: 210, width: 25 }
    case 'subject':
      // No feather: the edge comes from the refinement against the real pixels,
      // and softening it further only undoes that work. `feather` instead sets
      // how hard the recovered alpha is driven to its ends — see `mask.glsl`.
      return { ...base, kind, feather: 50, model: DETECT_VERSION }
  }
}

/** "Radial 2" — numbered per kind, so the list reads as what it is. */
function nextMaskName(kind: MaskKind, existing: Mask[]): string {
  const label = MASK_KIND_LABEL[kind]
  const used = existing.filter((m) => m.kind === kind).length
  return used === 0 ? label : `${label} ${used + 1}`
}

/**
 * The starting geometry for a mask's kind, for putting one back after it has
 * been dragged off the edge of the frame. Only the shape moves — the name, the
 * adjustments and the strength are the user's, not the default's.
 */
export function defaultGeometry(mask: Mask, aspect: number): Partial<Mask> {
  const fresh = createMask(mask.kind, aspect)
  if (fresh.kind === 'radial') {
    return { cx: fresh.cx, cy: fresh.cy, rx: fresh.rx, ry: fresh.ry, angle: fresh.angle }
  }
  if (fresh.kind === 'linear') {
    return { x1: fresh.x1, y1: fresh.y1, x2: fresh.x2, y2: fresh.y2 }
  }
  // A range mask has no position to lose.
  return {}
}

/** True when this mask would do something to the picture. */
export function maskIsActive(mask: Mask): boolean {
  return mask.enabled && mask.amount > 0 && hasMaskAdjust(mask.adjust)
}

export function hasMaskAdjust(adjust: MaskAdjust): boolean {
  return Object.values(adjust).some((v) => v !== 0)
}

/** True when a mask's adjustments reach the detail pass rather than the local one. */
export function hasMaskDetail(adjust: MaskAdjust): boolean {
  return adjust.clarity !== 0 || adjust.texture !== 0 || adjust.sharpen !== 0 || adjust.blur !== 0
}

/** True when a mask's adjustments are tone and colour, which the local pass owns. */
export function hasMaskTone(adjust: MaskAdjust): boolean {
  return (
    adjust.exposure !== 0 ||
    adjust.contrast !== 0 ||
    adjust.highlights !== 0 ||
    adjust.shadows !== 0 ||
    adjust.whites !== 0 ||
    adjust.blacks !== 0 ||
    adjust.temperature !== 0 ||
    adjust.tint !== 0 ||
    adjust.saturation !== 0
  )
}

/** The value shown beside a mask in the list, and on its edit-stack chip. */
export function maskSummary(mask: Mask): string {
  if (!mask.enabled) return 'off'
  if (!hasMaskAdjust(mask.adjust)) return 'no adjustments'

  const parts: string[] = []
  const { adjust } = mask
  if (adjust.exposure !== 0) parts.push(`exposure ${signed(adjust.exposure, 2)}`)
  else if (adjust.contrast !== 0) parts.push(`contrast ${signed(adjust.contrast)}`)
  else if (adjust.highlights !== 0) parts.push(`highlights ${signed(adjust.highlights)}`)
  else if (adjust.shadows !== 0) parts.push(`shadows ${signed(adjust.shadows)}`)
  else if (adjust.temperature !== 0) parts.push(`warmth ${signed(adjust.temperature)}`)
  else if (adjust.saturation !== 0) parts.push(`saturation ${signed(adjust.saturation)}`)
  else if (adjust.clarity !== 0) parts.push(`clarity ${signed(adjust.clarity)}`)
  else if (adjust.texture !== 0) parts.push(`texture ${signed(adjust.texture)}`)
  else if (adjust.sharpen !== 0) parts.push(`sharpen ${Math.round(adjust.sharpen)}`)
  else if (adjust.blur !== 0) parts.push(`blur ${Math.round(adjust.blur)}`)
  else parts.push('adjusted')

  if (mask.invert) parts.push('inverted')
  return parts.join(' · ')
}

function signed(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(digits)}`
}

/** Patch a mask in a list without touching the others. */
export function replaceMask(masks: Mask[], id: string, patch: Partial<Mask>): Mask[] {
  return masks.map((m) => (m.id === id ? ({ ...m, ...patch } as Mask) : m))
}

export function replaceMaskAdjust(
  masks: Mask[],
  id: string,
  patch: Partial<MaskAdjust>,
): Mask[] {
  return masks.map((m) => (m.id === id ? { ...m, adjust: { ...m.adjust, ...patch } } : m))
}

/* Narrowing helpers, so the tool and the overlay can stay honest about kinds. */

export const isRadial = (m: Mask): m is RadialMask => m.kind === 'radial'
export const isLinear = (m: Mask): m is LinearMask => m.kind === 'linear'
export const isLuminance = (m: Mask): m is LuminanceMask => m.kind === 'luminance'
export const isColour = (m: Mask): m is ColourMask => m.kind === 'colour'
