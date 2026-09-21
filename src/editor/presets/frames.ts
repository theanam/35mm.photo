import type { FrameState } from '../edit-stack/types'

export interface FramePreset {
  id: string
  name: string
  blurb: string
  /** Widths and colour only — the link mode comes with them, as the shape. */
  frame: FrameState
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
]

export const FRAME_PRESETS_BY_ID = new Map(FRAME_PRESETS.map((p) => [p.id, p]))
