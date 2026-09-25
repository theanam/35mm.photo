import { describe, expect, it } from 'vitest'
import { buildLookLut, sampleLut } from './lut3d'
import { LOOKS, LOOKS_BY_ID } from './looks'

/**
 * The film looks each make one claim about a particular colour — skin goes
 * peach, greens go mint, lamps stay warm in a cold frame — and the claim is
 * what somebody is clicking the tile for. Taste is not testable; whether the
 * claimed thing happens is.
 */

const look = (id: string) => {
  const config = LOOKS_BY_ID.get(id)
  if (!config) throw new Error(`no look "${id}"`)
  return buildLookLut(config)
}

type Rgb = [number, number, number]

function hueOf([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d < 1e-6) return -1
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

function satOf([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b)
  return max <= 1e-9 ? 0 : (max - Math.min(r, g, b)) / max
}

const lumaOf = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function nearHue(h: number, target: number, within: number): boolean {
  const d = Math.abs(h - target) % 360
  return Math.min(d, 360 - d) <= within
}

const FOLIAGE: Rgb = [0.22, 0.42, 0.16]
const SKY: Rgb = [0.35, 0.55, 0.9]
const SKIN: Rgb = [0.8, 0.6, 0.5]
const GREY: Rgb = [0.5, 0.5, 0.5]
const PAPER: Rgb = [0.95, 0.95, 0.95]
const RED: Rgb = [0.75, 0.15, 0.15]
const MAGENTA: Rgb = [0.8, 0.3, 0.7]

describe('Peach', () => {
  const through = (rgb: Rgb) => sampleLut(look('peach'), ...rgb) as Rgb

  it('flatters skin without tanning it', () => {
    const out = through(SKIN)
    expect(nearHue(hueOf(out), 20, 8)).toBe(true)
    expect(lumaOf(out)).toBeGreaterThan(lumaOf(SKIN))
    expect(satOf(out)).toBeLessThan(satOf(SKIN) + 0.05)
  })

  it('holds the greens back', () => {
    expect(satOf(through(FOLIAGE))).toBeLessThan(satOf(FOLIAGE) * 0.8)
  })

  it('keeps a neutral neutral', () => {
    expect(satOf(through(GREY))).toBeLessThan(0.04)
  })
})

describe('Gold', () => {
  const through = (rgb: Rgb) => sampleLut(look('gold'), ...rgb) as Rgb

  it('warms the highlights', () => {
    const [r, , b] = through(PAPER)
    expect(r).toBeGreaterThan(b + 0.02)
  })

  it('takes the greens toward yellow, not olive', () => {
    expect(hueOf(through(FOLIAGE))).toBeLessThan(hueOf(FOLIAGE))
  })
})

describe('Mint', () => {
  const through = (rgb: Rgb) => sampleLut(look('mint'), ...rgb) as Rgb

  it('turns foliage toward cyan and brighter', () => {
    const out = through(FOLIAGE)
    expect(hueOf(out)).toBeGreaterThan(hueOf(FOLIAGE) + 5)
    expect(lumaOf(out)).toBeGreaterThan(lumaOf(FOLIAGE))
  })

  it('cannot make a magenta', () => {
    expect(satOf(through(MAGENTA))).toBeLessThan(satOf(MAGENTA) * 0.85)
  })

  it('leaves skin pale', () => {
    const out = through(SKIN)
    expect(satOf(out)).toBeLessThan(satOf(SKIN))
    expect(lumaOf(out)).toBeGreaterThan(lumaOf(SKIN))
  })
})

describe('Carmine', () => {
  const through = (rgb: Rgb) => sampleLut(look('carmine'), ...rgb) as Rgb

  it('makes a red deeper: richer and darker at once', () => {
    const out = through(RED)
    expect(satOf(out)).toBeGreaterThan(satOf(RED))
    expect(lumaOf(out)).toBeLessThan(lumaOf(RED))
  })

  it('takes the sky toward cyan and darkens it', () => {
    const out = through(SKY)
    expect(hueOf(out)).toBeLessThan(hueOf(SKY) - 5)
    expect(lumaOf(out)).toBeLessThanOrEqual(lumaOf(SKY) + 0.01)
  })
})

describe('Tungsten', () => {
  const through = (rgb: Rgb) => sampleLut(look('tungsten'), ...rgb) as Rgb

  it('casts the neutrals blue, shadows most of all', () => {
    const grey = through(GREY)
    expect(grey[2]).toBeGreaterThan(grey[0])
    const dark = through([0.1, 0.1, 0.1])
    expect(satOf(dark)).toBeGreaterThan(satOf(grey))
    expect(nearHue(hueOf(dark), 220, 30)).toBe(true)
  })

  it('leaves a red light warm and louder in a cold frame', () => {
    const out = through(RED)
    expect(nearHue(hueOf(out), 0, 15)).toBe(true)
    expect(satOf(out)).toBeGreaterThan(satOf(RED))
  })
})

describe('Sepia', () => {
  const through = (rgb: Rgb) => sampleLut(look('sepia'), ...rgb) as Rgb

  it('is brown all the way down, whatever colour went in', () => {
    for (const rgb of [FOLIAGE, SKY, SKIN, GREY, RED]) {
      const out = through(rgb)
      expect(nearHue(hueOf(out), 38, 12), `${rgb} landed at ${hueOf(out)}°`).toBe(true)
      expect(satOf(out)).toBeGreaterThan(0.12)
    }
  })

  it('keeps the paper near white', () => {
    const paper = through(PAPER)
    expect(satOf(paper)).toBeLessThan(0.1)
    expect(lumaOf(paper)).toBeGreaterThan(0.9)
  })
})

describe('Grit', () => {
  const grit = look('grit')
  const mono = look('mono')
  const level = (lut: ReturnType<typeof look>, v: number) => lumaOf(sampleLut(lut, v, v, v) as Rgb)

  it('is harder than the plain monochrome', () => {
    expect(level(grit, 0.2)).toBeLessThan(level(mono, 0.2))
    expect(level(grit, 0.8)).toBeGreaterThan(level(mono, 0.8))
  })

  it('leaves no colour behind', () => {
    for (const rgb of [FOLIAGE, SKY, SKIN, RED]) expect(satOf(sampleLut(grit, ...rgb) as Rgb)).toBeLessThan(0.05)
  })

  it('carries the heaviest grain in the catalogue', () => {
    const most = Math.max(...LOOKS.map((l) => l.grain.amount))
    expect(LOOKS_BY_ID.get('grit')!.grain.amount).toBe(most)
  })
})

describe('the catalogue', () => {
  it('has no two looks with the same id or name', () => {
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length)
    expect(new Set(LOOKS.map((l) => l.name)).size).toBe(LOOKS.length)
  })

  it('builds every look to a cube that stays in range', () => {
    for (const config of LOOKS) {
      for (const v of buildLookLut(config, 9).data) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
