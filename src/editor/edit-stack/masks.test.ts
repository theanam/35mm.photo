import { describe, expect, it } from 'vitest'
import {
  createMask,
  defaultGeometry,
  hasMaskDetail,
  hasMaskTone,
  maskIsActive,
  maskSummary,
  neutralMaskAdjust,
  replaceMask,
  replaceMaskAdjust,
} from './masks'
import type { RadialMask } from './types'

describe('createMask', () => {
  it('starts a radial mask round on the frame it was made for', () => {
    for (const aspect of [1.5, 1, 0.667]) {
      const mask = createMask('radial', aspect) as RadialMask
      // Radii are in uv, so a circle means equal *pixel* radii: rx·width = ry·height.
      expect(mask.rx * aspect).toBeCloseTo(mask.ry, 6)
    }
  })

  it('numbers masks per kind', () => {
    const first = createMask('radial', 1.5)
    const second = createMask('radial', 1.5, [first])
    const linear = createMask('linear', 1.5, [first, second])
    expect([first.name, second.name, linear.name]).toEqual(['Radial', 'Radial 2', 'Linear'])
  })

  it('changes nothing until it is given an adjustment', () => {
    const mask = createMask('radial', 1.5)
    expect(hasMaskTone(mask.adjust)).toBe(false)
    expect(hasMaskDetail(mask.adjust)).toBe(false)
    expect(maskIsActive(mask)).toBe(false)
    expect(maskSummary(mask)).toBe('no adjustments')
  })
})

describe('maskIsActive', () => {
  const adjusted = { ...createMask('radial', 1.5), adjust: { ...neutralMaskAdjust(), exposure: 1 } }

  it('needs an adjustment, the switch on, and some strength', () => {
    expect(maskIsActive(adjusted)).toBe(true)
    expect(maskIsActive({ ...adjusted, enabled: false })).toBe(false)
    expect(maskIsActive({ ...adjusted, amount: 0 })).toBe(false)
    expect(maskIsActive({ ...adjusted, adjust: neutralMaskAdjust() })).toBe(false)
  })
})

describe('hasMaskDetail', () => {
  it('separates the adjustments the detail pass owns from the rest', () => {
    expect(hasMaskDetail({ ...neutralMaskAdjust(), exposure: 2 })).toBe(false)
    expect(hasMaskDetail({ ...neutralMaskAdjust(), sharpen: 20 })).toBe(true)
    expect(hasMaskTone({ ...neutralMaskAdjust(), sharpen: 20 })).toBe(false)
    expect(hasMaskTone({ ...neutralMaskAdjust(), temperature: -10 })).toBe(true)
  })

  it('counts blur, which the detail pass owns too', () => {
    expect(hasMaskDetail({ ...neutralMaskAdjust(), blur: 60 })).toBe(true)
    expect(hasMaskTone({ ...neutralMaskAdjust(), blur: 60 })).toBe(false)
    // A mask that only blurs still has to read as doing something, or it would
    // never reach the render at all.
    expect(maskIsActive({ ...createMask('radial', 1.5), adjust: { ...neutralMaskAdjust(), blur: 60 } })).toBe(true)
  })
})

describe('defaultGeometry', () => {
  it('moves the shape and leaves everything else alone', () => {
    const mask = { ...(createMask('radial', 1.5) as RadialMask), cx: 0.9, cy: 0.1, amount: 40 }
    const patch = defaultGeometry(mask, 1.5) as Partial<RadialMask>
    expect(Object.keys(patch).sort()).toEqual(['angle', 'cx', 'cy', 'rx', 'ry'])
    expect(patch.cx).toBe(0.5)
    expect(patch.cy).toBe(0.5)
    expect(patch.rx).toBeCloseTo(0.2, 6)
    expect(patch.ry).toBeCloseTo(0.3, 6)
    expect(patch).not.toHaveProperty('amount')
    expect(patch).not.toHaveProperty('adjust')
  })

  it('has nothing to say about a mask with no position', () => {
    expect(defaultGeometry(createMask('luminance', 1.5), 1.5)).toEqual({})
  })
})

describe('replaceMask', () => {
  const a = createMask('radial', 1.5)
  const b = createMask('linear', 1.5, [a])

  it('patches one mask and shares nothing with the others', () => {
    const next = replaceMask([a, b], a.id, { amount: 20 })
    expect(next[0].amount).toBe(20)
    expect(next[1]).toBe(b)
    expect(a.amount).toBe(100)
  })

  it('leaves the rest of an adjustment intact', () => {
    const withExposure = replaceMaskAdjust([a, b], b.id, { exposure: -1 })
    const patched = replaceMaskAdjust(withExposure, b.id, { shadows: 30 })
    expect(patched[1].adjust.exposure).toBe(-1)
    expect(patched[1].adjust.shadows).toBe(30)
    expect(b.adjust.exposure).toBe(0)
  })
})
