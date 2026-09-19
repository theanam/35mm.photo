import { describe, expect, it } from 'vitest'
import { packMasks } from './mask-uniforms'
import { createMask, neutralMaskAdjust } from '../edit-stack/masks'
import { MAX_MASKS, type ColourMask, type Mask, type RadialMask } from '../edit-stack/types'

const radial = (patch: Partial<RadialMask> = {}): RadialMask => ({
  ...(createMask('radial', 1.5) as RadialMask),
  ...patch,
})

const withAdjust = (mask: Mask, patch: Partial<Mask['adjust']>): Mask => ({
  ...mask,
  adjust: { ...neutralMaskAdjust(), ...patch },
})

describe('packMasks', () => {
  it('packs a radial mask into the geometry the shader reads', () => {
    const mask = radial({ cx: 0.25, cy: 0.75, rx: 0.1, ry: 0.2, angle: 90, feather: 40 })
    const packed = packMasks([withAdjust(mask, { exposure: 1 })])

    expect(packed.count).toBe(1)
    expect(packed.kind[0]).toBe(0)
    expect([...packed.geom.slice(0, 4)]).toEqual([0.25, 0.75, 0.1, 0.2].map(Math.fround))
    expect(packed.shape[0]).toBeCloseTo(Math.PI / 2, 6)
    expect(packed.shape[1]).toBeCloseTo(0.4, 6)
    expect(packed.shape[2]).toBe(0)
    expect(packed.shape[3]).toBeCloseTo(1, 6)
  })

  it('turns a colour mask into hue and half-width in turns', () => {
    const mask = { ...(createMask('colour', 1.5) as ColourMask), hue: 180, width: 50 }
    const packed = packMasks([withAdjust(mask, { saturation: 30 })])

    expect(packed.kind[0]).toBe(3)
    expect(packed.geom[0]).toBeCloseTo(0.5, 6)
    expect(packed.geom[1]).toBeCloseTo(0.125, 6)
  })

  it('keeps a switched-off mask in place but gives it no strength', () => {
    const off = withAdjust(radial({ enabled: false }), { exposure: 2 })
    const on = withAdjust(radial(), { exposure: -1 })
    const packed = packMasks([off, on])

    // Both are packed, so an overlay can still name the second one "index 1".
    expect(packed.count).toBe(2)
    expect(packed.shape[3]).toBe(0)
    expect(packed.shape[7]).toBeCloseTo(1, 6)
    // And the off one carries no adjustment to be weighted by.
    expect(packed.toneA[0]).toBe(0)
    expect(packed.toneA[4]).toBeCloseTo(-1, 6)
  })

  it('leaves the white balance neutral for masks with no warmth of their own', () => {
    const packed = packMasks([withAdjust(radial(), { exposure: 1 })])
    expect([...packed.wb.slice(0, 3)].map((v) => Number(v.toFixed(4)))).toEqual([1, 1, 1])
    // Including the slots no mask is using.
    expect([...packed.wb.slice(3, 6)]).toEqual([1, 1, 1])
  })

  it('warms one way and cools the other', () => {
    const warm = packMasks([withAdjust(radial(), { temperature: 60 })])
    const cool = packMasks([withAdjust(radial(), { temperature: -60 })])
    expect(warm.wb[0]).toBeGreaterThan(warm.wb[2])
    expect(cool.wb[0]).toBeLessThan(cool.wb[2])
  })

  it('asks only for the blurs the masked detail actually needs', () => {
    const sharpen = packMasks([withAdjust(radial(), { sharpen: 40 })])
    expect(sharpen.hasDetail).toBe(true)
    expect(sharpen.hasTone).toBe(false)
    expect(sharpen.detailNeeds).toEqual({ wide: false, mid: false, tight: true })

    const clarity = packMasks([withAdjust(radial(), { clarity: -20 })])
    expect(clarity.detailNeeds).toEqual({ wide: true, mid: false, tight: false })

    const none = packMasks([radial()])
    expect(none.hasDetail).toBe(false)
    expect(none.detailNeeds).toEqual({ wide: false, mid: false, tight: false })
  })

  it('refuses to overrun the uniform arrays', () => {
    const many = Array.from({ length: MAX_MASKS + 4 }, () => withAdjust(radial(), { exposure: 1 }))
    const packed = packMasks(many)

    expect(packed.count).toBe(MAX_MASKS)
    expect(packed.geom).toHaveLength(MAX_MASKS * 4)
    expect(packed.kind).toHaveLength(MAX_MASKS)
  })

  it('has nothing to do with no masks at all', () => {
    const packed = packMasks([])
    expect(packed.count).toBe(0)
    expect(packed.hasTone).toBe(false)
    expect(packed.hasDetail).toBe(false)
  })
})

describe('subject masks', () => {
  const subject = (over: Partial<Mask> = {}) =>
    ({ ...createMask('subject', 1.5), ...over }) as Mask

  it('packs as kind 4', () => {
    const packed = packMasks([subject()])
    expect(packed.kind[0]).toBe(4)
  })

  /**
   * Channels are assigned in list order, and `renderer.ts` writes the maps into
   * the atlas in that same order. If the two ever disagree an adjustment lands
   * on a different mask's coverage, which is why this is pinned.
   */
  it('hands out one texture channel each, in order', () => {
    const packed = packMasks([subject(), subject(), subject()])
    expect(packed.geom[0]).toBe(0)
    expect(packed.geom[4]).toBe(1)
    expect(packed.geom[8]).toBe(2)
  })

  it('counts only subject masks when assigning channels', () => {
    const packed = packMasks([createMask('radial', 1), subject(), createMask('colour', 1), subject()])
    // The radial and the colour mask take no channel, so the two subject masks
    // are still 0 and 1 rather than 1 and 3.
    expect(packed.geom[4]).toBe(0)
    expect(packed.geom[12]).toBe(1)
  })

  it('switches off a fifth subject mask rather than aiming it at channel zero', () => {
    const packed = packMasks([subject(), subject(), subject(), subject(), subject()])
    // Four fit in an RGBA texture; the fifth has nowhere to read from.
    expect(packed.shape[3 * 4 + 3]).toBeGreaterThan(0)
    expect(packed.shape[4 * 4 + 3]).toBe(0)
  })

  it('turns feather into the two ends of the alpha remap', () => {
    const hard = packMasks([subject({ feather: 0 } as Partial<Mask>)])
    const soft = packMasks([subject({ feather: 100 } as Partial<Mask>)])

    const span = (p: typeof hard) => p.geom[2] - p.geom[1]
    expect(span(hard)).toBeLessThan(span(soft))
    // Both straddle the midpoint the guided filter leaves the map around.
    for (const p of [hard, soft]) {
      expect(p.geom[1]).toBeLessThan(0.5)
      expect(p.geom[2]).toBeGreaterThan(0.5)
    }
  })

  it('still respects enabled and amount', () => {
    const off = packMasks([subject({ enabled: false } as Partial<Mask>)])
    expect(off.shape[3]).toBe(0)
  })
})
