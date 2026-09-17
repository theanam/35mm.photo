import { clamp01, evalSampled, sampleCurve } from './curve'
import { parseCube } from './cube'
import type { ColorTransform, LookConfig, MonoConfig } from './types'

/** Grid resolution of synthesised LUTs. 33 is the `.cube` convention. */
export const LUT_SIZE = 33

export interface Lut3D {
  size: number
  /** size³ RGB triples, row order r fastest → b slowest, matching `.cube`. */
  data: Float32Array
}

/** sRGB transfer, used to move in and out of linear light for the matrix step. */
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
function toSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055
}

const LUMA = [0.2126, 0.7152, 0.0722] as const

/** Build the identity LUT — the `.cube` a look with no colour transform would be. */
export function identityLut(size = LUT_SIZE): Lut3D {
  const data = new Float32Array(size * size * size * 3)
  let i = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[i++] = r / (size - 1)
        data[i++] = g / (size - 1)
        data[i++] = b / (size - 1)
      }
    }
  }
  return { size, data }
}

/**
 * Synthesise a look's 3D LUT. Everything the look does to colour lands here, so
 * the render graph only ever does one trilinear lookup regardless of how
 * elaborate the look is (spec §4.3).
 */
export function buildLookLut(look: LookConfig, size = LUT_SIZE): Lut3D {
  const lut = identityLut(size)
  const { data } = lut

  const ct = look.color
  const curveR = ct?.channelCurves?.r ? sampleCurve(ct.channelCurves.r) : null
  const curveG = ct?.channelCurves?.g ? sampleCurve(ct.channelCurves.g) : null
  const curveB = ct?.channelCurves?.b ? sampleCurve(ct.channelCurves.b) : null

  for (let i = 0; i < data.length; i += 3) {
    let rgb: [number, number, number] = [data[i], data[i + 1], data[i + 2]]

    if (ct) rgb = applyColorTransform(rgb, ct, curveR, curveG, curveB)
    if (look.mono) rgb = applyMono(rgb, look.mono)

    data[i] = clamp01(rgb[0])
    data[i + 1] = clamp01(rgb[1])
    data[i + 2] = clamp01(rgb[2])
  }

  return lut
}

function applyColorTransform(
  rgb: [number, number, number],
  ct: ColorTransform,
  curveR: Float32Array | null,
  curveG: Float32Array | null,
  curveB: Float32Array | null,
): [number, number, number] {
  let [r, g, b] = rgb

  // Channel mixing belongs in linear light; doing it on gamma-encoded values
  // skews the midtones of anything it touches.
  if (ct.matrix) {
    const m = ct.matrix
    const lr = toLinear(r)
    const lg = toLinear(g)
    const lb = toLinear(b)
    r = toSrgb(m[0] * lr + m[1] * lg + m[2] * lb)
    g = toSrgb(m[3] * lr + m[4] * lg + m[5] * lb)
    b = toSrgb(m[6] * lr + m[7] * lg + m[8] * lb)
  }

  if (ct.saturation != null && ct.saturation !== 1) {
    const luma = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
    const s = ct.saturation
    r = luma + (r - luma) * s
    g = luma + (g - luma) * s
    b = luma + (b - luma) * s
  }

  if (ct.shadowTint || ct.highlightTint) {
    const luma = clamp01(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b)
    // Smooth weights so the two tints cross over in the midtones instead of
    // meeting at a hard edge.
    const shadowW = (1 - luma) * (1 - luma)
    const highW = luma * luma
    if (ct.shadowTint) {
      r += ct.shadowTint[0] * shadowW
      g += ct.shadowTint[1] * shadowW
      b += ct.shadowTint[2] * shadowW
    }
    if (ct.highlightTint) {
      r += ct.highlightTint[0] * highW
      g += ct.highlightTint[1] * highW
      b += ct.highlightTint[2] * highW
    }
  }

  if (curveR) r = evalSampled(curveR, r)
  if (curveG) g = evalSampled(curveG, g)
  if (curveB) b = evalSampled(curveB, b)

  const lift = ct.blackLift ?? 0
  const drop = ct.whiteDrop ?? 0
  if (lift || drop) {
    const span = 1 - lift - drop
    r = lift + r * span
    g = lift + g * span
    b = lift + b * span
  }

  return [r, g, b]
}

/**
 * Contrast the channel-weighted luminance first, then desaturate — a flat
 * grayscale conversion loses the tonal separation that makes a mono look work
 * (spec §4.3.3).
 */
function applyMono(
  rgb: [number, number, number],
  mono: MonoConfig,
): [number, number, number] {
  const sum = mono.mix[0] + mono.mix[1] + mono.mix[2] || 1
  let y = (rgb[0] * mono.mix[0] + rgb[1] * mono.mix[1] + rgb[2] * mono.mix[2]) / sum

  const c = mono.contrast / 100
  if (c !== 0) {
    // Pivot around middle grey so contrast does not shift overall brightness.
    y = clamp01(0.5 + (y - 0.5) * (1 + c))
    // A touch of sigmoid on top keeps the shoulder from clipping flat.
    y = clamp01(y + c * 0.25 * Math.sin(Math.PI * 2 * y) * -0.15)
  }

  const tone = mono.tone / 100
  const warm = Math.max(tone, 0)
  const cool = Math.max(-tone, 0)
  const toneW = y * (1 - y) * 4 // strongest in the midtones

  return [
    clamp01(y + (0.05 * warm - 0.03 * cool) * toneW),
    clamp01(y + (0.015 * warm - 0.005 * cool) * toneW),
    clamp01(y + (-0.03 * warm + 0.055 * cool) * toneW),
  ]
}

/** Load and normalise a `.cube` file into the same shape as a synthesised LUT. */
export async function loadCubeLut(url: string): Promise<Lut3D> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load LUT ${url}: ${res.status}`)
  const cube = parseCube(await res.text())

  // Normalise a non-unit domain so the shader can always sample in 0..1.
  const { domainMin: lo, domainMax: hi } = cube
  const unit = lo[0] === 0 && lo[1] === 0 && lo[2] === 0 && hi[0] === 1 && hi[1] === 1 && hi[2] === 1
  if (unit) return { size: cube.size, data: cube.data }

  const data = new Float32Array(cube.data.length)
  for (let i = 0; i < data.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const span = hi[c] - lo[c] || 1
      data[i + c] = clamp01((cube.data[i + c] - lo[c]) / span)
    }
  }
  return { size: cube.size, data }
}

/** Resolve a look to its LUT, preferring a shipped `.cube` over the synthesised one. */
export async function resolveLookLut(look: LookConfig, baseUrl: string): Promise<Lut3D> {
  if (look.lut) {
    try {
      return await loadCubeLut(new URL(look.lut, baseUrl).href)
    } catch (err) {
      console.warn(`[35mm] falling back to synthesised LUT for "${look.id}"`, err)
    }
  }
  return buildLookLut(look)
}
