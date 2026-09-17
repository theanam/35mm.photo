import { MAX_IMPORT_LUT_SIZE } from '../lut3d'
import type { Lut3D } from '../types'

/**
 * DNG camera profiles (`.dcp`), and the profile block embedded in a DNG.
 *
 * The file is TIFF-shaped — byte-order mark, then one IFD of tag/type/count/
 * value entries — but its magic number is 0x4352 rather than TIFF's 42, so a
 * strict TIFF reader rejects it. Both are accepted here.
 *
 * A profile carries more than this pipeline can use. The colour matrices map
 * camera RGB to XYZ, which LibRaw has already done its own way by the time an
 * image reaches us, so applying them again would be wrong twice over. What is
 * usable is the part photographers mean when they say a profile has a look:
 *
 * - **HueSatMap** — a hue/saturation/value warp describing the camera's colour
 *   rendering
 * - **LookTable** — the same shape again, carrying the creative look on top
 * - **ProfileToneCurve** — the contrast curve the profile ships with
 *
 * All three are baked into one 3D LUT, which is what the renderer already knows
 * how to apply and blend with a strength slider.
 */

const TAG = {
  uniqueCameraModel: 50708,
  profileName: 50936,
  hueSatMapDims: 50937,
  hueSatMapData1: 50938,
  hueSatMapData2: 50939,
  toneCurve: 50940,
  copyright: 50942,
  lookTableDims: 50981,
  lookTableData: 50982,
  hueSatMapEncoding: 51107,
  lookTableEncoding: 51108,
} as const

/** Bytes per component, by TIFF type code. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
}

export interface HsvTable {
  hueDivisions: number
  satDivisions: number
  valDivisions: number
  /** Triplets of (hue shift in degrees, saturation scale, value scale). */
  data: Float32Array
  /** 1 when the table's value axis is sRGB-encoded rather than linear. */
  encoding: number
}

export interface DcpProfile {
  name: string
  cameraModel?: string
  copyright?: string
  hueSatMap?: HsvTable
  lookTable?: HsvTable
  /** Control points in 0..1, as (x, y) pairs. */
  toneCurve?: Float32Array
}

class Reader {
  private view: DataView
  private little: boolean

  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const mark = this.view.getUint16(0, false)
    if (mark !== 0x4949 && mark !== 0x4d4d) throw new Error('is not a DNG camera profile')
    this.little = mark === 0x4949

    const magic = this.view.getUint16(2, this.little)
    // 42 is TIFF's; 0x4352 is what the DNG profile writer uses instead.
    if (magic !== 42 && magic !== 0x4352) throw new Error('is not a DNG camera profile')
  }

  u16 = (at: number) => this.view.getUint16(at, this.little)
  u32 = (at: number) => this.view.getUint32(at, this.little)
  i32 = (at: number) => this.view.getInt32(at, this.little)
  f32 = (at: number) => this.view.getFloat32(at, this.little)
  get bytes() {
    return this.view.byteLength
  }
}

interface Entry {
  type: number
  count: number
  /** Where the payload starts — inline in the entry, or at an offset. */
  at: number
}

export function parseDcp(bytes: Uint8Array): DcpProfile {
  const r = new Reader(bytes)
  const ifd = r.u32(4)
  if (ifd + 2 > r.bytes) throw new Error('is truncated')

  const count = r.u16(ifd)
  const entries = new Map<number, Entry>()
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12
    if (at + 12 > r.bytes) break
    const tag = r.u16(at)
    const type = r.u16(at + 2)
    const n = r.u32(at + 4)
    const size = (TYPE_SIZE[type] ?? 1) * n
    // Four bytes or fewer live in the entry itself; anything larger is a pointer.
    entries.set(tag, { type, count: n, at: size <= 4 ? at + 8 : r.u32(at + 8) })
  }

  const ascii = (tag: number): string | undefined => {
    const e = entries.get(tag)
    if (!e || e.type !== 2) return undefined
    let out = ''
    for (let i = 0; i < e.count; i++) {
      const ch = new DataView(bytes.buffer, bytes.byteOffset).getUint8(e.at + i)
      if (ch === 0) break
      out += String.fromCharCode(ch)
    }
    return out || undefined
  }

  const longs = (tag: number): number[] | undefined => {
    const e = entries.get(tag)
    if (!e || (e.type !== 4 && e.type !== 3)) return undefined
    const out: number[] = []
    for (let i = 0; i < e.count; i++) {
      out.push(e.type === 4 ? r.u32(e.at + i * 4) : r.u16(e.at + i * 2))
    }
    return out
  }

  const floats = (tag: number): Float32Array | undefined => {
    const e = entries.get(tag)
    if (!e || e.type !== 11) return undefined
    if (e.at + e.count * 4 > r.bytes) throw new Error('has a truncated table')
    const out = new Float32Array(e.count)
    for (let i = 0; i < e.count; i++) out[i] = r.f32(e.at + i * 4)
    return out
  }

  const table = (dimsTag: number, dataTag: number, encodingTag: number): HsvTable | undefined => {
    const dims = longs(dimsTag)
    const data = floats(dataTag)
    if (!dims || dims.length < 3 || !data) return undefined
    const [hueDivisions, satDivisions, valDivisions] = dims
    const expected = hueDivisions * satDivisions * valDivisions * 3
    if (expected === 0 || data.length < expected) return undefined
    return {
      hueDivisions,
      satDivisions,
      valDivisions,
      data,
      encoding: longs(encodingTag)?.[0] ?? 0,
    }
  }

  const profile: DcpProfile = {
    name: ascii(TAG.profileName) ?? ascii(TAG.uniqueCameraModel) ?? 'Camera profile',
    cameraModel: ascii(TAG.uniqueCameraModel),
    copyright: ascii(TAG.copyright),
    hueSatMap: table(TAG.hueSatMapDims, TAG.hueSatMapData1, TAG.hueSatMapEncoding),
    lookTable: table(TAG.lookTableDims, TAG.lookTableData, TAG.lookTableEncoding),
    toneCurve: floats(TAG.toneCurve),
  }

  if (!profile.hueSatMap && !profile.lookTable && !profile.toneCurve) {
    throw new Error('carries no look — only colour matrices, which raw development already did')
  }
  return profile
}

/* ────────────────────────────── applying it ────────────────────────────── */

/**
 * Sample an HSV table.
 *
 * The DNG spec stores entries in nested loop order with value outermost, then
 * hue, then saturation innermost. Hue wraps — division 0 and division n are the
 * same angle — while saturation and value clamp at their ends.
 */
function sampleTable(t: HsvTable, h: number, s: number, v: number): [number, number, number] {
  const hScaled = (h / 360) * t.hueDivisions
  const sScaled = s * (t.satDivisions - 1)
  const vScaled = t.valDivisions > 1 ? v * (t.valDivisions - 1) : 0

  const h0 = Math.floor(hScaled)
  const s0 = Math.min(Math.floor(sScaled), Math.max(t.satDivisions - 2, 0))
  const v0 = Math.min(Math.floor(vScaled), Math.max(t.valDivisions - 2, 0))
  const hf = hScaled - h0
  const sf = sScaled - s0
  const vf = t.valDivisions > 1 ? vScaled - v0 : 0

  const at = (hi: number, si: number, vi: number) => {
    const hw = ((hi % t.hueDivisions) + t.hueDivisions) % t.hueDivisions
    const sc = Math.min(Math.max(si, 0), t.satDivisions - 1)
    const vc = Math.min(Math.max(vi, 0), Math.max(t.valDivisions - 1, 0))
    return ((vc * t.hueDivisions + hw) * t.satDivisions + sc) * 3
  }

  let hueShift = 0
  let satScale = 0
  let valScale = 0
  for (let dv = 0; dv <= (t.valDivisions > 1 ? 1 : 0); dv++) {
    for (let dh = 0; dh <= 1; dh++) {
      for (let ds = 0; ds <= 1; ds++) {
        const w =
          (dh ? hf : 1 - hf) *
          (ds ? sf : 1 - sf) *
          (t.valDivisions > 1 ? (dv ? vf : 1 - vf) : 1)
        if (w === 0) continue
        const i = at(h0 + dh, s0 + ds, v0 + dv)
        hueShift += t.data[i] * w
        satScale += t.data[i + 1] * w
        valScale += t.data[i + 2] * w
      }
    }
  }
  return [hueShift, satScale, valScale]
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m]
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

function applyTable(t: HsvTable, rgb: [number, number, number]): [number, number, number] {
  let [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2])

  // A table declared linear indexes on linear value, not on the encoded one.
  const vIndex = t.encoding === 1 ? v : toSrgb(clamp01(v))
  const [hueShift, satScale, valScale] = sampleTable(t, h, clamp01(s), clamp01(vIndex))

  h = h + hueShift
  s = clamp01(s * satScale)
  v = Math.max(v * valScale, 0)
  return hsvToRgb(h, s, v)
}

/** Evaluate the profile's tone curve, which is a list of (x, y) pairs in 0..1. */
function applyToneCurve(curve: Float32Array, value: number): number {
  const points = curve.length / 2
  if (points < 2) return value
  const x = clamp01(value)
  // The points are ordered, so a binary search finds the bracketing pair.
  let lo = 0
  let hi = points - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (curve[mid * 2] <= x) lo = mid
    else hi = mid
  }
  const x0 = curve[lo * 2]
  const y0 = curve[lo * 2 + 1]
  const x1 = curve[hi * 2]
  const y1 = curve[hi * 2 + 1]
  if (x1 === x0) return y0
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
}

/**
 * Bake the profile into a cube the renderer can sample.
 *
 * The input is display-referred sRGB, because that is what reaches the look
 * stage. A profile is defined against the camera's linear space, so this is a
 * likeness of the profile's rendering rather than a colorimetric application of
 * it — the hue and saturation warps carry over faithfully, the absolute
 * colorimetry does not.
 */
export function dcpToLut3D(profile: DcpProfile, size = 33): Lut3D {
  const n = Math.min(Math.max(size, 2), MAX_IMPORT_LUT_SIZE)
  const data = new Float32Array(n * n * n * 3)

  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        let rgb: [number, number, number] = [r / (n - 1), g / (n - 1), b / (n - 1)]

        if (profile.hueSatMap) rgb = applyTable(profile.hueSatMap, rgb)
        if (profile.lookTable) rgb = applyTable(profile.lookTable, rgb)
        if (profile.toneCurve) {
          rgb = [
            applyToneCurve(profile.toneCurve, rgb[0]),
            applyToneCurve(profile.toneCurve, rgb[1]),
            applyToneCurve(profile.toneCurve, rgb[2]),
          ]
        }

        // Blue slowest, matching how the renderer uploads a 3D texture.
        const i = ((b * n + g) * n + r) * 3
        data[i] = clamp01(rgb[0])
        data[i + 1] = clamp01(rgb[1])
        data[i + 2] = clamp01(rgb[2])
      }
    }
  }

  return { size: n, data }
}

export { toLinear as srgbToLinear }
