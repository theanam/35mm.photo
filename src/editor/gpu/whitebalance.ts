import { NEUTRAL_TEMPERATURE } from '../edit-stack/defaults'

/**
 * Approximate RGB of a blackbody illuminant at `kelvin` (Tanner Helland's fit,
 * accurate enough over 1000–12000 K for a grading control).
 */
function illuminantRgb(kelvin: number): [number, number, number] {
  const t = Math.min(Math.max(kelvin, 1000), 40000) / 100
  let r: number
  let g: number
  let b: number

  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }

  if (t >= 66) b = 255
  else if (t <= 19) b = 0
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307

  return [clamp255(r) / 255, clamp255(g) / 255, clamp255(b) / 255]
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

const NEUTRAL_RGB = illuminantRgb(NEUTRAL_TEMPERATURE)

/**
 * Linear RGB gains for a temperature/tint pair. The gains are the *inverse* of
 * the illuminant ratio, so raising the Kelvin number warms the picture — which
 * is what the slider's blue→amber track promises.
 */
export function whiteBalanceGain(
  temperature: number,
  tint: number,
): [number, number, number] {
  const target = illuminantRgb(temperature)

  let r = NEUTRAL_RGB[0] / Math.max(target[0], 1e-4)
  let g = NEUTRAL_RGB[1] / Math.max(target[1], 1e-4)
  let b = NEUTRAL_RGB[2] / Math.max(target[2], 1e-4)

  // Tint runs green (−) to magenta (+) across the perpendicular axis.
  const t = tint / 100
  g *= 1 - t * 0.28
  r *= 1 + t * 0.1
  b *= 1 + t * 0.1

  // Renormalise on luminance so white balance never doubles as an exposure change.
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (y > 1e-4) {
    r /= y
    g /= y
    b /= y
  }
  return [r, g, b]
}
