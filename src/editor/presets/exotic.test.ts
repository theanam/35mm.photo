import { describe, expect, it } from 'vitest'
import { buildLookLut, sampleLut } from './lut3d'
import { LOOKS, LOOKS_BY_ID } from './looks'

/**
 * The exotic looks are the ones whose whole point is a specific, checkable
 * colour behaviour — "foliage goes red" is a claim, not a taste. Screenshots
 * cannot settle it either: the first frame these were judged on was a winter
 * landscape with no green in it at all, where a working infrared transform
 * looks like it is doing nothing.
 */

const look = (id: string) => {
  const config = LOOKS_BY_ID.get(id)
  if (!config) throw new Error(`no look "${id}"`)
  return buildLookLut(config)
}

type Rgb = [number, number, number]

/** Hue in degrees, or −1 for a neutral. */
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

/** Distance round the wheel, so "is this magenta" survives the wrap at 360°. */
function nearHue(h: number, target: number, within: number): boolean {
  const d = Math.abs(h - target) % 360
  return Math.min(d, 360 - d) <= within
}

const FOLIAGE: Rgb = [0.22, 0.42, 0.16]
const SPRING: Rgb = [0.35, 0.6, 0.22]
const SKY: Rgb = [0.35, 0.55, 0.9]
const SKIN: Rgb = [0.8, 0.6, 0.5]
const GREY: Rgb = [0.5, 0.5, 0.5]
const RED: Rgb = [0.75, 0.15, 0.15]

describe('Infrared', () => {
  const lut = look('infrared')
  const through = (rgb: Rgb) => sampleLut(lut, ...rgb) as Rgb

  it('turns foliage magenta-red, which is the entire point', () => {
    for (const green of [FOLIAGE, SPRING]) {
      const out = through(green)
      expect(nearHue(hueOf(out), 335, 30), `${green} landed at ${hueOf(out)}°`).toBe(true)
      expect(satOf(out)).toBeGreaterThan(0.6)
    }
  })

  it('makes foliage more luminous, not merely redder', () => {
    // Infrared film renders leaves luminous because chlorophyll reflects
    // infrared strongly. A balanced matrix would have turned a dull leaf into a
    // dull crimson, which is a hue shift rather than the look.
    //
    // Measured on the strongest channel rather than on luma, which cannot
    // answer this question: Rec.709 luma is 71% green, so turning a green into
    // a magenta lowers it whatever the magenta does. The first version of this
    // test asserted luma and failed against a transform that was working.
    const peak = (rgb: Rgb) => Math.max(...rgb)
    expect(peak(through(SPRING))).toBeGreaterThan(peak(SPRING))
    expect(peak(through(FOLIAGE))).toBeGreaterThan(peak(FOLIAGE))
  })

  it('turns the sky cyan', () => {
    expect(nearHue(hueOf(through(SKY)), 185, 25)).toBe(true)
  })

  it('renders a red subject yellow-green', () => {
    // The tell that this is false colour rather than a red filter: red light
    // exposes the green-sensitive layer, so a red flower comes out yellow.
    expect(nearHue(hueOf(through(RED)), 80, 35)).toBe(true)
  })

  it('leaves skin recognisable, and waxy', () => {
    const out = through(SKIN)
    expect(nearHue(hueOf(out), 25, 25)).toBe(true)
    expect(satOf(out)).toBeLessThan(satOf(SKIN))
  })

  it('casts neutrals only faintly', () => {
    // A magenta cast on grey is characteristic and must stay a cast.
    expect(satOf(through(GREY))).toBeLessThan(0.2)
  })
})

describe('Frost', () => {
  const lut = look('frost')
  const through = (rgb: Rgb) => sampleLut(lut, ...rgb) as Rgb

  it('is the Wood effect: bright leaves against a dark sky', () => {
    // The negative blue weight is what does this, and it is the one look here
    // that is derived rather than approximated.
    expect(lumaOf(through(FOLIAGE))).toBeGreaterThan(lumaOf(through(SKY)) + 0.15)
  })

  it('leaves no colour behind', () => {
    for (const rgb of [FOLIAGE, SKY, SKIN]) expect(satOf(through(rgb))).toBeLessThan(0.12)
  })
})

describe('Cyanotype', () => {
  const lut = look('cyanotype')
  const through = (rgb: Rgb) => sampleLut(lut, ...rgb) as Rgb

  it('puts blue in the shadows whatever colour went in', () => {
    for (const rgb of [FOLIAGE, SKIN, RED]) {
      const shadow = through([rgb[0] * 0.3, rgb[1] * 0.3, rgb[2] * 0.3])
      expect(shadow[2]).toBeGreaterThan(shadow[0])
    }
  })

  it('keeps the highlights near paper', () => {
    const paper = through([0.95, 0.95, 0.95])
    expect(satOf(paper)).toBeLessThan(0.2)
    expect(lumaOf(paper)).toBeGreaterThan(0.8)
  })
})

describe('Sabattier', () => {
  const lut = look('sabattier')
  const level = (v: number) => lumaOf(sampleLut(lut, v, v, v) as Rgb)

  it('reverses: past the turn, brighter light prints darker', () => {
    expect(level(0.65)).toBeGreaterThan(level(0.5))
    expect(level(1.0)).toBeLessThan(level(0.65))
    // And the reversal is deep enough to read as one rather than as a rolloff.
    expect(level(0.65) - level(1.0)).toBeGreaterThan(0.25)
  })

  it('leaves the shadows the right way up', () => {
    expect(level(0.3)).toBeGreaterThan(level(0.1))
  })
})

describe('the exotic section', () => {
  it('has every look in it building to a cube that stays in range', () => {
    const exotic = LOOKS.filter((l) => l.group === 'exotic')
    expect(exotic.length).toBeGreaterThanOrEqual(5)
    for (const config of exotic) {
      for (const v of buildLookLut(config, 9).data) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
