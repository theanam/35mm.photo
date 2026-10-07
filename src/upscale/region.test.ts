import { describe, expect, it } from 'vitest'
import { defaultEdits } from '../editor/edit-stack/defaults'
import type { ImageMeta } from '../editor/edit-stack/types'
import { REGION_MARGIN, regionFor, upscaleSignature } from './region'

const meta = (orientation: ImageMeta['orientation'] = 1): ImageMeta => ({
  name: 'x.jpg',
  ext: 'jpg',
  isRaw: false,
  width: 3000,
  height: 2000,
  orientation,
  bytes: 0,
})

describe('regionFor', () => {
  it('is the whole picture for an uncropped photo', () => {
    const r = regionFor(meta(), defaultEdits(), 3000, 2000)
    expect(r).toMatchObject({ x: 0, y: 0, w: 1, h: 1 })
    expect(r.px).toEqual({ x: 0, y: 0, w: 3000, h: 2000 })
  })

  it('covers a crop with a margin on every side', () => {
    const e = defaultEdits()
    e.crop = { ...e.crop, x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    const r = regionFor(meta(), e, 3000, 2000)
    const m = 0.5 * REGION_MARGIN
    expect(r.x).toBeCloseTo(0.25 - m, 2)
    expect(r.y).toBeCloseTo(0.25 - m, 2)
    expect(r.x + r.w).toBeCloseTo(0.75 + m, 2)
    expect(r.y + r.h).toBeCloseTo(0.75 + m, 2)
    // Whole pixels, and the fractions agree with them exactly.
    expect(r.px.x / 3000).toBe(r.x)
    expect(r.px.w / 3000).toBe(r.w)
  })

  it('stays inside the picture at its edge', () => {
    const e = defaultEdits()
    e.crop = { ...e.crop, x: 0, y: 0, w: 0.3, h: 0.3 }
    const r = regionFor(meta(), e, 3000, 2000)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
  })

  it('grows to cover a straightened crop', () => {
    const e = defaultEdits()
    e.crop = { ...e.crop, x: 0.25, y: 0.25, w: 0.5, h: 0.5, angle: 10 }
    const straight = regionFor(meta(), { ...e, crop: { ...e.crop, angle: 0 } }, 3000, 2000)
    const turned = regionFor(meta(), e, 3000, 2000)
    expect(turned.w).toBeGreaterThan(straight.w)
    expect(turned.h).toBeGreaterThan(straight.h)
  })

  it('maps into the stored orientation', () => {
    // Orientation 6: the file is stored on its side, 2000 × 3000, and is
    // turned a quarter clockwise for display. A crop along the top of the
    // upright picture is along the left of the stored one.
    const e = defaultEdits()
    e.crop = { ...e.crop, x: 0.1, y: 0, w: 0.8, h: 0.3 }
    const r = regionFor(meta(6), e, 2000, 3000)
    expect(r.x).toBe(0)
    expect(r.w).toBeLessThan(0.45)
    expect(r.h).toBeGreaterThan(0.7)
  })

  it('measures against whatever bitmap is being cut', () => {
    const e = defaultEdits()
    e.crop = { ...e.crop, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    const full = regionFor(meta(), e, 3000, 2000)
    const preview = regionFor(meta(), e, 1500, 1000)
    // Snapped to whole pixels of each, so within a pixel of half.
    expect(Math.abs(preview.px.x - full.px.x / 2)).toBeLessThanOrEqual(1)
    expect(preview.x).toBeCloseTo(full.x, 3)
  })
})

describe('upscaleSignature', () => {
  it('moves with the geometry, the factor and the retouch, and nothing else', () => {
    const a = defaultEdits()
    const b = { ...a, exposure: 1.5, contrast: 30 }
    expect(upscaleSignature(a)).toBe(upscaleSignature(b))
    expect(upscaleSignature({ ...a, upscale: 2 })).not.toBe(upscaleSignature(a))
    expect(upscaleSignature({ ...a, crop: { ...a.crop, w: 0.5 } })).not.toBe(upscaleSignature(a))
    expect(upscaleSignature({ ...a, perspective: { ...a.perspective, vertical: 10 } })).not.toBe(upscaleSignature(a))
  })
})
