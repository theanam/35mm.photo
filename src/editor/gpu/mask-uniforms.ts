import { NEUTRAL_TEMPERATURE } from '../edit-stack/defaults'
import { hasMaskDetail, hasMaskTone } from '../edit-stack/masks'
import { MAX_MASKS, type Mask } from '../edit-stack/types'
import { whiteBalanceGain } from './whitebalance'

/** Kind ids, matching the branches in `mask.glsl`. */
const KIND: Record<Mask['kind'], number> = {
  radial: 0,
  linear: 1,
  luminance: 2,
  colour: 3,
  subject: 4,
}

/**
 * How far a local warmth of ±100 moves the white point. A region has no light
 * source of its own to name in Kelvin, so the control is a shift — but it is
 * built from the same blackbody curve as the global slider, so warming a face
 * by +30 and warming the whole frame by the equivalent land in the same place.
 * The curve is not symmetric: cooling below daylight bites harder than warming
 * above it, which is true of the global slider too, and true of daylight.
 */
const KELVIN_PER_UNIT = 25

/** Widest slice of the wheel one colour mask can claim, either side of centre. */
const MAX_HUE_HALF_WIDTH = 0.25

/**
 * Subject coverage maps ride four to a texture, one per RGBA channel. Past the
 * fourth the mask is packed inert rather than reading somebody else's channel,
 * which would put an adjustment on the wrong part of the picture.
 */
export const MAX_SUBJECT_MASKS = 4

/**
 * How far apart the two ends of the subject alpha remap sit at feather 0 and
 * at feather 100, either side of the midpoint the guided filter leaves things
 * around. Narrow is nearly a cutout; wide hands over gently.
 */
const SUBJECT_REMAP_MID = 0.5
const SUBJECT_REMAP_MIN_SPAN = 0.04
const SUBJECT_REMAP_MAX_SPAN = 0.7

export interface PackedMasks {
  /** Masks uploaded, i.e. how far the shader loop runs. */
  count: number
  kind: Int32Array
  geom: Float32Array
  shape: Float32Array
  toneA: Float32Array
  toneB: Float32Array
  wb: Float32Array
  detail: Float32Array
  /** True when at least one mask asks the local pass for something. */
  hasTone: boolean
  /** True when at least one mask asks the detail pass for something. */
  hasDetail: boolean
  /**
   * Which pre-blurred copies those detail adjustments need. The blurs are two
   * passes apiece, so a mask that only sharpens must not drag the wide blur
   * that clarity would have wanted along with it.
   */
  detailNeeds: { wide: boolean; mid: boolean; tight: boolean; soft: boolean }
}

/**
 * Flatten the mask list into the arrays the three shaders read.
 *
 * Index is position in the list, not position among the *active* masks:
 * a mask switched off is packed with zero amount rather than dropped, so the
 * overlay can name a mask by its index without the two sides having to agree
 * on a filter. Anything past `MAX_MASKS` is ignored here as well as refused at
 * the door, so a hand-edited sidecar cannot overrun the uniform arrays.
 */
export function packMasks(masks: Mask[]): PackedMasks {
  const used = masks.slice(0, MAX_MASKS)

  const packed: PackedMasks = {
    count: used.length,
    kind: new Int32Array(MAX_MASKS),
    geom: new Float32Array(MAX_MASKS * 4),
    shape: new Float32Array(MAX_MASKS * 4),
    toneA: new Float32Array(MAX_MASKS * 4),
    toneB: new Float32Array(MAX_MASKS * 4),
    // Neutral everywhere to start: a mask with no warmth of its own must
    // multiply the picture by one, not by zero.
    wb: new Float32Array(MAX_MASKS * 3).fill(1),
    detail: new Float32Array(MAX_MASKS * 4),
    hasTone: false,
    hasDetail: false,
    detailNeeds: { wide: false, mid: false, tight: false, soft: false },
  }

  let subjectChannel = 0

  used.forEach((mask, i) => {
    const g = i * 4
    // A subject mask past the fourth has no channel to read, so it is packed
    // as present-but-inert rather than aimed at another mask's coverage.
    const overflow = mask.kind === 'subject' && subjectChannel >= MAX_SUBJECT_MASKS
    const live = mask.enabled && mask.amount > 0 && !overflow

    packed.kind[i] = KIND[mask.kind]

    switch (mask.kind) {
      case 'radial':
        packed.geom.set([mask.cx, mask.cy, mask.rx, mask.ry], g)
        packed.shape[g] = (mask.angle * Math.PI) / 180
        break
      case 'linear':
        packed.geom.set([mask.x1, mask.y1, mask.x2, mask.y2], g)
        break
      case 'luminance':
        packed.geom.set([mask.lo / 100, mask.hi / 100, 0, 0], g)
        break
      case 'colour':
        packed.geom.set(
          [mask.hue / 360, (mask.width / 100) * MAX_HUE_HALF_WIDTH, 0, 0],
          g,
        )
        break
      case 'subject': {
        // Channel is assigned by order of appearance among subject masks, which
        // is the same order `renderer.ts` writes them into the texture.
        const channel = subjectChannel++
        const span =
          SUBJECT_REMAP_MIN_SPAN +
          (mask.feather / 100) * (SUBJECT_REMAP_MAX_SPAN - SUBJECT_REMAP_MIN_SPAN)
        packed.geom.set(
          [channel, SUBJECT_REMAP_MID - span / 2, SUBJECT_REMAP_MID + span / 2, 0],
          g,
        )
        break
      }
    }

    packed.shape[g + 1] = mask.feather / 100
    packed.shape[g + 2] = mask.invert ? 1 : 0
    packed.shape[g + 3] = live ? mask.amount / 100 : 0

    if (!live) return

    const a = mask.adjust
    packed.toneA.set([a.exposure, a.contrast / 100, a.highlights / 100, a.shadows / 100], g)
    packed.toneB.set([a.whites / 100, a.blacks / 100, a.saturation / 100, 0], g)
    packed.wb.set(
      whiteBalanceGain(NEUTRAL_TEMPERATURE + a.temperature * KELVIN_PER_UNIT, a.tint),
      i * 3,
    )
    packed.detail.set([a.clarity / 100, a.texture / 100, a.sharpen / 100, a.blur / 100], g)

    if (hasMaskTone(a)) packed.hasTone = true
    if (hasMaskDetail(a)) packed.hasDetail = true
    if (a.clarity !== 0) packed.detailNeeds.wide = true
    if (a.texture !== 0) packed.detailNeeds.mid = true
    if (a.sharpen !== 0) packed.detailNeeds.tight = true
    if (a.blur !== 0) packed.detailNeeds.soft = true
  })

  return packed
}
