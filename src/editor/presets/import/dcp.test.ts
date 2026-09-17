import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dcpToLut3D, parseDcp, type DcpProfile } from './dcp'

/* ───────────────────────────── a DCP, by hand ───────────────────────────── */

const TYPE = { ascii: 2, long: 4, float: 11 } as const

interface Tag {
  tag: number
  type: number
  values: number[] | string
}

/**
 * Write a minimal DNG camera profile. Doing this by hand rather than checking
 * in a binary keeps the fixture readable and lets each test state exactly the
 * structure it is asserting about.
 */
function buildDcp(tags: Tag[], opts: { little?: boolean; magic?: number } = {}): Uint8Array {
  const little = opts.little ?? true
  const magic = opts.magic ?? 0x4352

  const payloads: { tag: Tag; bytes: Uint8Array; count: number }[] = tags.map((tag) => {
    if (typeof tag.values === 'string') {
      const s = tag.values + '\0'
      const bytes = new Uint8Array(s.length)
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
      return { tag, bytes, count: s.length }
    }
    const size = tag.type === TYPE.long || tag.type === TYPE.float ? 4 : 1
    const bytes = new Uint8Array(tag.values.length * size)
    const view = new DataView(bytes.buffer)
    tag.values.forEach((v, i) => {
      if (tag.type === TYPE.float) view.setFloat32(i * 4, v, little)
      else view.setUint32(i * 4, v, little)
    })
    return { tag, bytes, count: tag.values.length }
  })

  const headerSize = 8
  const ifdSize = 2 + payloads.length * 12 + 4
  let heapAt = headerSize + ifdSize
  const heap: Uint8Array[] = []

  const total = payloads.reduce((n, p) => n + (p.bytes.length > 4 ? p.bytes.length : 0), 0)
  const out = new Uint8Array(headerSize + ifdSize + total)
  const view = new DataView(out.buffer)

  out[0] = little ? 0x49 : 0x4d
  out[1] = little ? 0x49 : 0x4d
  view.setUint16(2, magic, little)
  view.setUint32(4, headerSize, little)
  view.setUint16(headerSize, payloads.length, little)

  payloads.forEach((p, i) => {
    const at = headerSize + 2 + i * 12
    view.setUint16(at, p.tag.tag, little)
    view.setUint16(at + 2, p.tag.type, little)
    view.setUint32(at + 4, p.count, little)
    if (p.bytes.length > 4) {
      view.setUint32(at + 8, heapAt, little)
      heap.push(p.bytes)
      heapAt += p.bytes.length
    } else {
      out.set(p.bytes, at + 8)
    }
  })

  let write = headerSize + ifdSize
  for (const block of heap) {
    out.set(block, write)
    write += block.length
  }
  return out
}

/** A table that shifts every hue by `hueShift` and scales sat/value flat. */
function flatTable(hue: number, sat: number, val: number, h = 4, s = 2, v = 1): number[] {
  const out: number[] = []
  for (let i = 0; i < h * s * v; i++) out.push(hue, sat, val)
  return out
}

const NEUTRAL = { tag: 50936, type: TYPE.ascii, values: 'Test Profile' } as Tag

describe('parseDcp', () => {
  it('reads a profile name and a look table', () => {
    const bytes = buildDcp([
      NEUTRAL,
      { tag: 50981, type: TYPE.long, values: [4, 2, 1] },
      { tag: 50982, type: TYPE.float, values: flatTable(0, 1, 1) },
    ])
    const p = parseDcp(bytes)
    expect(p.name).toBe('Test Profile')
    expect(p.lookTable).toBeDefined()
    expect(p.lookTable?.hueDivisions).toBe(4)
    expect(p.lookTable?.satDivisions).toBe(2)
    expect(p.lookTable?.valDivisions).toBe(1)
  })

  it('accepts both byte orders', () => {
    const tags: Tag[] = [
      NEUTRAL,
      { tag: 50981, type: TYPE.long, values: [4, 2, 1] },
      { tag: 50982, type: TYPE.float, values: flatTable(12, 1, 1) },
    ]
    for (const little of [true, false]) {
      const p = parseDcp(buildDcp(tags, { little }))
      expect(p.lookTable?.hueDivisions).toBe(4)
      expect(p.lookTable?.data[0]).toBeCloseTo(12, 4)
    }
  })

  it('accepts TIFF magic as well as the profile magic', () => {
    const tags: Tag[] = [
      NEUTRAL,
      { tag: 50981, type: TYPE.long, values: [4, 2, 1] },
      { tag: 50982, type: TYPE.float, values: flatTable(0, 1, 1) },
    ]
    expect(() => parseDcp(buildDcp(tags, { magic: 42 }))).not.toThrow()
    expect(() => parseDcp(buildDcp(tags, { magic: 0x4352 }))).not.toThrow()
  })

  it('rejects something that is not a profile at all', () => {
    expect(() => parseDcp(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a DNG camera profile/)
  })

  it('rejects a profile carrying only colour matrices', () => {
    // 50721 is ColorMatrix1 — real, but nothing this pipeline can use.
    const bytes = buildDcp([NEUTRAL, { tag: 50721, type: TYPE.long, values: [1, 2, 3] }])
    expect(() => parseDcp(bytes)).toThrow(/carries no look/)
  })

  it('ignores a table whose data is shorter than its dimensions claim', () => {
    const bytes = buildDcp([
      NEUTRAL,
      { tag: 50981, type: TYPE.long, values: [8, 4, 2] }, // wants 192 floats
      { tag: 50982, type: TYPE.float, values: flatTable(0, 1, 1, 2, 2, 1) }, // has 12
      { tag: 50940, type: TYPE.float, values: [0, 0, 1, 1] },
    ])
    const p = parseDcp(bytes)
    expect(p.lookTable).toBeUndefined()
    expect(p.toneCurve).toBeDefined()
  })
})

describe('dcpToLut3D', () => {
  const identity = (): DcpProfile => ({ name: 'x' })

  it('builds an identity cube when the profile changes nothing', () => {
    const lut = dcpToLut3D({ ...identity(), lookTable: undefined }, 9)
    const n = lut.size
    for (const [r, g, b] of [[0, 0, 0], [8, 8, 8], [4, 2, 7]]) {
      const i = ((b * n + g) * n + r) * 3
      expect(lut.data[i]).toBeCloseTo(r / (n - 1), 4)
      expect(lut.data[i + 1]).toBeCloseTo(g / (n - 1), 4)
      expect(lut.data[i + 2]).toBeCloseTo(b / (n - 1), 4)
    }
  })

  it('leaves greys alone when only hue is shifted', () => {
    const profile: DcpProfile = {
      name: 'hue',
      lookTable: {
        hueDivisions: 4, satDivisions: 2, valDivisions: 1,
        data: new Float32Array(flatTable(90, 1, 1)), encoding: 1,
      },
    }
    const lut = dcpToLut3D(profile, 9)
    const n = lut.size
    // A grey has no saturation, so rotating hue must do nothing to it.
    for (const step of [0, 4, 8]) {
      const i = ((step * n + step) * n + step) * 3
      expect(lut.data[i]).toBeCloseTo(step / (n - 1), 4)
      expect(lut.data[i + 1]).toBeCloseTo(step / (n - 1), 4)
      expect(lut.data[i + 2]).toBeCloseTo(step / (n - 1), 4)
    }
  })

  it('desaturates when the table says to', () => {
    const profile: DcpProfile = {
      name: 'flat',
      lookTable: {
        hueDivisions: 4, satDivisions: 2, valDivisions: 1,
        data: new Float32Array(flatTable(0, 0, 1)), encoding: 1,
      },
    }
    const lut = dcpToLut3D(profile, 9)
    const n = lut.size
    // Pure red at full value becomes grey: all three channels equal.
    const i = ((0 * n + 0) * n + (n - 1)) * 3
    expect(lut.data[i + 1]).toBeCloseTo(lut.data[i], 3)
    expect(lut.data[i + 2]).toBeCloseTo(lut.data[i], 3)
  })

  it('applies the tone curve', () => {
    // Maps everything to half brightness.
    const profile: DcpProfile = { name: 'tone', toneCurve: new Float32Array([0, 0, 1, 0.5]) }
    const lut = dcpToLut3D(profile, 9)
    const n = lut.size
    const i = (((n - 1) * n + (n - 1)) * n + (n - 1)) * 3
    expect(lut.data[i]).toBeCloseTo(0.5, 3)
  })

  it('stays inside 0..1 even when a table pushes past it', () => {
    const profile: DcpProfile = {
      name: 'hot',
      lookTable: {
        hueDivisions: 4, satDivisions: 2, valDivisions: 1,
        data: new Float32Array(flatTable(0, 4, 4)), encoding: 1,
      },
    }
    const lut = dcpToLut3D(profile, 7)
    for (const v of lut.data) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

/* ──────────────────── against profiles on this machine ──────────────────── */

const REAL_DIR = '/Applications/RawTherapee.app/Contents/Resources/share/dcpprofiles'
const realFiles = existsSync(REAL_DIR)
  ? readdirSync(REAL_DIR).filter((f) => f.toLowerCase().endsWith('.dcp')).slice(0, 6)
  : []

describe.skipIf(realFiles.length === 0)('real camera profiles', () => {
  it('parses shipped profiles and bakes usable cubes', () => {
    for (const name of realFiles) {
      const profile = parseDcp(new Uint8Array(readFileSync(`${REAL_DIR}/${name}`)))
      expect(profile.name.length).toBeGreaterThan(0)

      // Every profile worth importing carries at least one of these.
      expect(
        Boolean(profile.hueSatMap || profile.lookTable || profile.toneCurve),
      ).toBe(true)

      for (const t of [profile.hueSatMap, profile.lookTable]) {
        if (!t) continue
        expect(t.data.length).toBe(t.hueDivisions * t.satDivisions * t.valDivisions * 3)
        // Saturation and value are scale factors; a negative one is nonsense.
        for (let i = 1; i < t.data.length; i += 3) expect(t.data[i]).toBeGreaterThanOrEqual(0)
      }

      const lut = dcpToLut3D(profile, 17)
      expect(lut.size).toBe(17)
      expect(lut.data.length).toBe(17 ** 3 * 3)
      expect(lut.data.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true)
    }
  })

  it('keeps neutrals neutral, which is what a camera profile must not break', () => {
    const profile = parseDcp(new Uint8Array(readFileSync(`${REAL_DIR}/${realFiles[0]}`)))
    const lut = dcpToLut3D(profile, 17)
    const n = lut.size
    for (const step of [4, 8, 12]) {
      const i = ((step * n + step) * n + step) * 3
      const [r, g, b] = [lut.data[i], lut.data[i + 1], lut.data[i + 2]]
      // A profile may shift the tone of a grey, but not its colour.
      expect(Math.abs(r - g)).toBeLessThan(0.02)
      expect(Math.abs(g - b)).toBeLessThan(0.02)
    }
  })
})
