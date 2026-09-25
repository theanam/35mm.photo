import type { FrameState } from '../edit-stack/types'
import { padToAspect } from '../gpu/transform'

export interface FramePreset {
  id: string
  name: string
  blurb: string
  /**
   * Widths and colour only — the link mode comes with them, as the shape.
   *
   * On a preset that pads, these are the margin kept between the picture and
   * the edge of the shape, and the padding is added outside them.
   */
  frame: FrameState
  /**
   * Width ÷ height of the whole framed picture. A preset with this set is not a
   * fixed set of widths but a rule — pad this picture until it is that shape —
   * so it has to be resolved against the photo it is applied to.
   */
  pad?: number
}

/**
 * The mats worth having to hand.
 *
 * Widths are percentages of the picture's shorter edge, so every one of these
 * lands the same on a portrait as on a landscape.
 */
export const FRAME_PRESETS: FramePreset[] = [
  {
    id: 'none',
    name: 'None',
    blurb: 'No border',
    frame: { top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', link: 'all', unit: 'percent' },
  },
  {
    id: 'hairline',
    name: 'Hairline',
    blurb: 'Just enough to separate the picture from the page',
    frame: { top: 1, right: 1, bottom: 1, left: 1, color: '#ffffff', link: 'all', unit: 'percent' },
  },
  {
    id: 'keyline',
    name: 'Keyline',
    blurb: 'A thin dark rule, for a picture that ends in sky',
    frame: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5, color: '#1a1a1a', link: 'all', unit: 'percent' },
  },
  {
    id: 'print',
    name: 'Print',
    blurb: 'The classic white border of a machine print',
    frame: { top: 4, right: 4, bottom: 4, left: 4, color: '#ffffff', link: 'all', unit: 'percent' },
  },
  {
    id: 'wide',
    name: 'Wide',
    blurb: 'A generous white mat',
    frame: { top: 10, right: 10, bottom: 10, left: 10, color: '#ffffff', link: 'all', unit: 'percent' },
  },
  {
    /*
     * Deeper at the bottom than the top, which is how a mat is actually cut.
     * An evenly measured border reads as bottom-heavy — the eye puts the centre
     * of a picture slightly above the middle — so a framer takes the weight out
     * by leaving more room underneath. This is the preset that earns the four
     * sliders their keep.
     */
    id: 'gallery',
    name: 'Gallery',
    blurb: 'Weighted at the bottom, the way a mat is cut',
    frame: { top: 9, right: 9, bottom: 13, left: 9, color: '#f2efe9', link: 'free', unit: 'percent' },
  },
  {
    id: 'polaroid',
    name: 'Polaroid',
    blurb: 'Thin on three sides, deep at the foot',
    frame: { top: 6, right: 6, bottom: 20, left: 6, color: '#fbfaf7', link: 'free', unit: 'percent' },
  },
  {
    id: 'black',
    name: 'Black',
    blurb: 'A dark mat, for a photograph that ends in white',
    frame: { top: 6, right: 6, bottom: 6, left: 6, color: '#111111', link: 'all', unit: 'percent' },
  },

  /*
   * Shapes rather than widths: the picture is padded out to the frame a
   * phone screen or a feed expects, with a border kept all the way round so it
   * reads as a print in a mat rather than a picture that ran out of room.
   */
  {
    id: 'square',
    name: 'Square',
    blurb: 'Padded to a square, with a border kept all the way round',
    frame: { top: 4, right: 4, bottom: 4, left: 4, color: '#ffffff', link: 'free', unit: 'percent' },
    pad: 1,
  },
  {
    id: 'four-five',
    name: '4:5',
    blurb: 'Padded to the tall shape a feed shows largest',
    frame: { top: 4, right: 4, bottom: 4, left: 4, color: '#ffffff', link: 'free', unit: 'percent' },
    pad: 4 / 5,
  },
  {
    id: 'story',
    name: 'Story',
    blurb: 'Padded to a phone screen, 9:16, with room above and below',
    frame: { top: 5, right: 5, bottom: 5, left: 5, color: '#ffffff', link: 'free', unit: 'percent' },
    pad: 9 / 16,
  },
  {
    id: 'screen',
    name: 'Screen',
    blurb: 'Padded to a 16:9 screen, in black, so a portrait fills a television',
    frame: { top: 0, right: 0, bottom: 0, left: 0, color: '#000000', link: 'free', unit: 'percent' },
    pad: 16 / 9,
  },
]

export const FRAME_PRESETS_BY_ID = new Map(FRAME_PRESETS.map((p) => [p.id, p]))

/**
 * The widths a preset comes to on this picture.
 *
 * A fixed preset is its own answer. A padding one is worked out here, in two
 * steps, because the margin and the padding are measured against different
 * things: the margin goes on first, around the picture, and the padding then
 * fills whatever the margined picture is short of the target shape. Both come
 * back as percentages of the *photo's* shorter edge, which is what the sliders
 * and the renderer read, so the margined size is converted back before the two
 * are added.
 *
 * Stored as plain widths, not as a live rule, for the reason the pad buttons
 * give: nudging a side afterwards should not fight a target, and a later crop
 * should not silently re-pad a picture the user has finished with.
 */
export function resolveFramePreset(
  preset: FramePreset,
  photo: { width: number; height: number },
): FrameState {
  const base = preset.frame
  if (!preset.pad) return base

  const short = Math.min(photo.width, photo.height)
  if (!(short > 0)) return { ...base, link: 'free', unit: 'percent' }

  const px = (pct: number) => (pct / 100) * short
  const margined = {
    width: photo.width + px(base.left) + px(base.right),
    height: photo.height + px(base.top) + px(base.bottom),
  }
  const pad = padToAspect(margined.width, margined.height, preset.pad)
  // `padToAspect` measures against the margined picture's shorter edge.
  const k = Math.min(margined.width, margined.height) / short
  const round = (v: number) => Math.round(v * 10) / 10

  return {
    top: round(base.top + pad.top * k),
    right: round(base.right + pad.right * k),
    bottom: round(base.bottom + pad.bottom * k),
    left: round(base.left + pad.left * k),
    color: base.color,
    // Two sides wide and two sides not, and calling that "pairs" would tie the
    // narrow pair together and hide the asymmetry from the sliders.
    link: 'free',
    unit: 'percent',
  }
}
