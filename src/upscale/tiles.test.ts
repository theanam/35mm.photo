import { describe, expect, it } from 'vitest'
import { LOW_RES_EDGE, estimateSeconds, factorsFor, offerFor, planTiles } from './tiles'

describe('factorsFor', () => {
  it('offers both factors to a small picture', () => {
    expect(factorsFor(1000, 667, 'webgpu')).toEqual([1, 2, 4])
  })

  it('drops ×4 once it would pass the output ceiling, then ×2', () => {
    // 2000 × 1333 ×4 is 42 MP; ×2 is 10.7 MP.
    expect(factorsFor(2000, 1333, 'webgpu')).toEqual([1, 2])
    expect(factorsFor(4000, 2667, 'webgpu')).toEqual([1])
  })

  it('refuses a large picture on the CPU, which would take minutes', () => {
    expect(factorsFor(1600, 1067, 'wasm')).toEqual([1])
    expect(factorsFor(1000, 667, 'wasm')).toEqual([1, 2, 4])
  })

  it('has nothing without a backend', () => {
    expect(factorsFor(1000, 667, null)).toEqual([1])
  })
})

describe('offerFor', () => {
  it('suggests the largest factor that fits', () => {
    expect(offerFor(800, 600, 'webgpu')).toBe(4)
    expect(offerFor(1800, 1200, 'webgpu')).toBe(2)
  })

  it('suggests nothing for a picture that is already large', () => {
    expect(offerFor(LOW_RES_EDGE, 1365, 'webgpu')).toBeNull()
    expect(offerFor(6000, 4000, 'webgpu')).toBeNull()
  })

  it('suggests nothing where the result would be too big to hold', () => {
    // Under the edge, but ×2 is 21 MP.
    expect(offerFor(2047, 2047 * 1.3, 'webgpu')).toBeNull()
  })
})

describe('estimateSeconds', () => {
  it('scales with the picture and is far slower on the CPU', () => {
    expect(estimateSeconds(512, 512, 'webgpu')).toBeCloseTo(1.25)
    expect(estimateSeconds(512, 512, 'wasm')).toBeCloseTo(20)
    expect(estimateSeconds(1024, 1024, 'webgpu')).toBeGreaterThan(estimateSeconds(512, 512, 'webgpu'))
  })
})

describe('planTiles', () => {
  it('covers the picture exactly once with its clean regions', () => {
    const w = 700
    const h = 300
    const tiles = planTiles(w, h, 256, 16)
    const seen = new Uint8Array(w * h)
    for (const t of tiles) {
      for (let y = t.dy; y < t.dy + t.oh; y++) {
        for (let x = t.dx; x < t.dx + t.ow; x++) seen[y * w + x]++
      }
    }
    expect(seen.every((n) => n === 1)).toBe(true)
  })

  it('reads overlap on every inner side and none at the picture edge', () => {
    const [first, second] = planTiles(700, 300, 256, 16)
    expect(first).toMatchObject({ sx: 0, sy: 0, sw: 272, sh: 272, ox: 0, oy: 0, ow: 256, oh: 256, dx: 0, dy: 0 })
    expect(second).toMatchObject({ sx: 240, sw: 288, ox: 16, ow: 256, dx: 256 })
  })

  it('keeps the clean region inside the read', () => {
    for (const t of planTiles(1000, 650, 128, 16)) {
      expect(t.ox + t.ow).toBeLessThanOrEqual(t.sw)
      expect(t.oy + t.oh).toBeLessThanOrEqual(t.sh)
      expect(t.sx + t.ox).toBe(t.dx)
      expect(t.sy + t.oy).toBe(t.dy)
    }
  })

  it('is one tile for a picture smaller than a tile', () => {
    expect(planTiles(100, 80, 256, 16)).toEqual([
      { sx: 0, sy: 0, sw: 100, sh: 80, ox: 0, oy: 0, ow: 100, oh: 80, dx: 0, dy: 0 },
    ])
  })
})
