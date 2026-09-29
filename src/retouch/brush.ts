/**
 * Brush sizes as a share of the picture's shorter edge. The slider is
 * exponential across them: a speck of dust and a stray lamp post are two
 * orders of magnitude apart, and a linear track would give the specks the
 * first millimetre of it.
 */
const SIZE_MIN = 0.002
const SIZE_MAX = 0.15

export function sizeToSlider(size: number): number {
  return (Math.log(size / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN)) * 100
}

export function sliderToSize(v: number): number {
  return SIZE_MIN * (SIZE_MAX / SIZE_MIN) ** (v / 100)
}

/** Brush size in steps of the slider, for the bracket keys. */
export function stepBrush(size: number, direction: 1 | -1): number {
  return sliderToSize(Math.min(100, Math.max(0, sizeToSlider(size) + direction * 6)))
}

/** A share of the short edge that covers a blemish on a head-and-shoulders portrait. */
export const DEFAULT_BRUSH_SIZE = 0.02
