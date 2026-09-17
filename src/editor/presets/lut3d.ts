import { clamp01, evalSampled, sampleCurve } from './curve'
import { parseCube, type ParsedCube } from './cube'
import { inputSpaceDef, srgbDecode, type InputSpace } from './inputSpace'
import type { ColorTransform, LookConfig, Lut3D, MonoConfig } from './types'

export type { Lut3D }

/** Grid resolution of synthesised LUTs. 33 is the `.cube` convention. */
export const LUT_SIZE = 33

/**
 * Grid resolution used when a LUT is resampled out of a log input space. The
 * log curve is steep in the shadows, so a 33³ destination bands there; 64³ is
 * still only 2 MB of RGBA16F and WebGL2 guarantees at least 256³.
 */
export const REDOMAIN_SIZE = 64

/** Largest grid accepted from an imported file, before any resampling. */
export const MAX_IMPORT_LUT_SIZE = 64

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

/** Trilinear sample of a LUT at an arbitrary 0..1 coordinate. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size
  const max = n - 1
  const fr = clamp01(r) * max
  const fg = clamp01(g) * max
  const fb = clamp01(b) * max

  const r0 = Math.floor(fr)
  const g0 = Math.floor(fg)
  const b0 = Math.floor(fb)
  const r1 = Math.min(r0 + 1, max)
  const g1 = Math.min(g0 + 1, max)
  const b1 = Math.min(b0 + 1, max)
  const dr = fr - r0
  const dg = fg - g0
  const db = fb - b0

  const out: [number, number, number] = [0, 0, 0]
  const at = (ri: number, gi: number, bi: number) => (ri + gi * n + bi * n * n) * 3

  for (let c = 0; c < 3; c++) {
    const c000 = lut.data[at(r0, g0, b0) + c]
    const c100 = lut.data[at(r1, g0, b0) + c]
    const c010 = lut.data[at(r0, g1, b0) + c]
    const c110 = lut.data[at(r1, g1, b0) + c]
    const c001 = lut.data[at(r0, g0, b1) + c]
    const c101 = lut.data[at(r1, g0, b1) + c]
    const c011 = lut.data[at(r0, g1, b1) + c]
    const c111 = lut.data[at(r1, g1, b1) + c]

    const c00 = c000 + (c100 - c000) * dr
    const c10 = c010 + (c110 - c010) * dr
    const c01 = c001 + (c101 - c001) * dr
    const c11 = c011 + (c111 - c011) * dr
    const c0 = c00 + (c10 - c00) * dg
    const c1 = c01 + (c11 - c01) * dg
    out[c] = c0 + (c1 - c0) * db
  }
  return out
}

/**
 * Rebuild a LUT so it can be indexed by this pipeline's sRGB pixels.
 *
 * For each sRGB grid point: linearise it to scene light, re-encode that with
 * the curve the LUT was authored against, and read the source LUT there. The
 * result is an ordinary sRGB-in cube, so the shader needs no notion of input
 * spaces at all — there is still exactly one texture fetch per pixel.
 */
export function redomainLut(lut: Lut3D, space: InputSpace, size = REDOMAIN_SIZE): Lut3D {
  if (space === 'srgb') return lut

  const { encode } = inputSpaceDef(space)
  // The encode curve is per-channel and identical for each, so build it once.
  const map = new Float32Array(size)
  for (let i = 0; i < size; i++) map[i] = clamp01(encode(srgbDecode(i / (size - 1))))

  const data = new Float32Array(size * size * size * 3)
  let i = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [cr, cg, cb] = sampleLut(lut, map[r], map[g], map[b])
        data[i++] = clamp01(cr)
        data[i++] = clamp01(cg)
        data[i++] = clamp01(cb)
      }
    }
  }
  return { size, data }
}

/** Expand three 1D channel curves into the 3D cube the renderer wants. */
export function lut1dTo3d(samples: Float32Array, count: number, size = LUT_SIZE): Lut3D {
  const curve = (c: number, x: number) => {
    const f = clamp01(x) * (count - 1)
    const i = Math.floor(f)
    const j = Math.min(i + 1, count - 1)
    const a = samples[i * 3 + c]
    return a + (samples[j * 3 + c] - a) * (f - i)
  }

  const lut = identityLut(size)
  for (let i = 0; i < lut.data.length; i += 3) {
    lut.data[i] = clamp01(curve(0, lut.data[i]))
    lut.data[i + 1] = clamp01(curve(1, lut.data[i + 1]))
    lut.data[i + 2] = clamp01(curve(2, lut.data[i + 2]))
  }
  return lut
}

/** Normalise a parsed `.cube` — 1D or 3D, any domain — into a plain `Lut3D`. */
export function cubeToLut3d(cube: ParsedCube): Lut3D {
  if (cube.size > MAX_IMPORT_LUT_SIZE && cube.kind === '3d') {
    throw new Error(
      `grid is ${cube.size}³; 35mm accepts up to ${MAX_IMPORT_LUT_SIZE}³`,
    )
  }
  if (cube.kind === '1d') return lut1dTo3d(cube.data, cube.size)

  // A non-unit domain means the file indexes on something other than 0..1.
  // Rescaling the *values* is wrong for that — the domain describes the input —
  // but a 3D `.cube` with DOMAIN_MAX above 1 is always a log LUT whose author
  // expected the grid to span its own range, which is exactly what sampling a
  // 0..1-normalised grid does. Leave the values alone.
  return { size: cube.size, data: cube.data }
}

/** Load and normalise a `.cube` file into the same shape as a synthesised LUT. */
export async function loadCubeLut(url: string): Promise<Lut3D> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load LUT ${url}: ${res.status}`)
  return cubeToLut3d(parseCube(await res.text()))
}

/** Resolve a look to its LUT, preferring a shipped `.cube` over the synthesised one. */
export async function resolveLookLut(look: LookConfig, baseUrl: string): Promise<Lut3D | null> {
  // An imported preset already carries its cube; all that is left is to move
  // it into this pipeline's input space.
  const custom = look.custom
  if (custom) {
    if (!custom.lut) return null
    return redomainLut(custom.lut, custom.inputSpace ?? 'srgb')
  }

  if (look.lut) {
    try {
      return await loadCubeLut(new URL(look.lut, baseUrl).href)
    } catch (err) {
      console.warn(`[35mm] falling back to synthesised LUT for "${look.id}"`, err)
    }
  }
  return buildLookLut(look)
}
