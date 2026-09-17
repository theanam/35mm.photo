import { describe, expect, it } from 'vitest'
import { couldBeLutImage, unpackLutImage } from './hald'
import type { Lut3D } from '../types'

/**
 * A plausible look — lifted blacks and a per-channel gamma. Smooth along each
 * axis, which is what the layout scorer relies on, and asymmetric between
 * channels, so a transposed reading cannot pass by accident.
 */
function reference(edge: number): Lut3D {
  const data = new Float32Array(edge ** 3 * 3)
  const f = (x: number, k: number) => Math.min(1, Math.max(0, 0.04 + Math.pow(x, k) * 0.94))
  let i = 0
  for (let b = 0; b < edge; b++) {
    for (let g = 0; g < edge; g++) {
      for (let r = 0; r < edge; r++) {
        data[i++] = f(r / (edge - 1), 0.88)
        data[i++] = f(g / (edge - 1), 1.0)
        data[i++] = f(b / (edge - 1), 1.14)
      }
    }
  }
  return { size: edge, data }
}

/** Raster order is LUT order. */
function haldPixels(lut: Lut3D, width: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(width * width * 4)
  for (let i = 0; i < lut.size ** 3; i++) {
    px[i * 4] = Math.round(lut.data[i * 3] * 255)
    px[i * 4 + 1] = Math.round(lut.data[i * 3 + 1] * 255)
    px[i * 4 + 2] = Math.round(lut.data[i * 3 + 2] * 255)
    px[i * 4 + 3] = 255
  }
  return px
}

/** Blue sliced into edge×edge tiles, laid out in `tilesX` columns. */
function tiledPixels(lut: Lut3D, width: number, tilesX: number) {
  const edge = lut.size
  const height = (edge * edge) / tilesX
  const px = new Uint8ClampedArray(width * height * 4)
  for (let b = 0; b < edge; b++) {
    const ox = (b % tilesX) * edge
    const oy = Math.floor(b / tilesX) * edge
    for (let g = 0; g < edge; g++) {
      for (let r = 0; r < edge; r++) {
        const src = (r + g * edge + b * edge * edge) * 3
        const dst = ((oy + g) * width + ox + r) * 4
        px[dst] = Math.round(lut.data[src] * 255)
        px[dst + 1] = Math.round(lut.data[src + 1] * 255)
        px[dst + 2] = Math.round(lut.data[src + 2] * 255)
        px[dst + 3] = 255
      }
    }
  }
  return { px, height }
}

/** Largest disagreement, in 8-bit steps. */
function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

const QUANTISATION = 1 / 255 + 1e-6

describe('unpackLutImage', () => {
  it('reads a HALD square', () => {
    const lut = reference(16)
    const got = unpackLutImage(haldPixels(lut, 64), 64, 64)
    expect(got.layout).toBe('hald')
    expect(got.lut.size).toBe(16)
    expect(maxDiff(got.lut.data, lut.data)).toBeLessThanOrEqual(QUANTISATION)
  })

  it('reads a horizontal strip', () => {
    const lut = reference(16)
    const { px, height } = tiledPixels(lut, 256, 16)
    expect(height).toBe(16)
    const got = unpackLutImage(px, 256, 16)
    expect(got.layout).toBe('tiled')
    expect(maxDiff(got.lut.data, lut.data)).toBeLessThanOrEqual(QUANTISATION)
  })

  it('reads a vertical strip', () => {
    const lut = reference(8)
    const { px, height } = tiledPixels(lut, 8, 1)
    expect(height).toBe(64)
    const got = unpackLutImage(px, 8, 64)
    expect(got.layout).toBe('tiled')
    expect(maxDiff(got.lut.data, lut.data)).toBeLessThanOrEqual(QUANTISATION)
  })

  // 64×64 satisfies both layouts exactly — a level-4 HALD and a 4×4 tiling of
  // a 16-edge cube — so nothing but the contents can tell them apart.
  describe('a square that both layouts could explain', () => {
    it('picks HALD when the pixels are a HALD', () => {
      const lut = reference(16)
      const got = unpackLutImage(haldPixels(lut, 64), 64, 64)
      expect(got.layout).toBe('hald')
      expect(maxDiff(got.lut.data, lut.data)).toBeLessThanOrEqual(QUANTISATION)
    })

    it('picks tiled when the pixels are tiled', () => {
      const lut = reference(16)
      const { px } = tiledPixels(lut, 64, 4)
      const got = unpackLutImage(px, 64, 64)
      expect(got.layout).toBe('tiled')
      expect(maxDiff(got.lut.data, lut.data)).toBeLessThanOrEqual(QUANTISATION)
    })
  })

  it('refuses dimensions that hold no cube', () => {
    expect(() => unpackLutImage(new Uint8ClampedArray(800 * 600 * 4), 800, 600)).toThrow()
  })
})

describe('couldBeLutImage', () => {
  it.each([
    [64, 64], // HALD level 4 / 4×4 tiling
    [512, 512], // HALD level 8 / 8×8 tiling
    [256, 16], // horizontal strip, 16-edge
    [1024, 32], // horizontal strip, 32-edge
    [16, 256], // vertical strip
  ])('accepts %i×%i', (w, h) => {
    expect(couldBeLutImage(w, h)).toBe(true)
  })

  it.each([
    [4032, 3024], // a phone photo
    [6000, 4000], // a camera frame
    [1920, 1080],
    [800, 600],
    [513, 513],
    [100, 100],
  ])('rejects %i×%i', (w, h) => {
    expect(couldBeLutImage(w, h)).toBe(false)
  })

  it('rejects a cube too large for the renderer', () => {
    // 4096×4096 would be a 256-edge HALD, well past the import ceiling.
    expect(couldBeLutImage(4096, 4096)).toBe(false)
  })

  it('rejects a square photo that happens to be a perfect cube of pixels', () => {
    // 1000×1000: 1000 is 10³, so the HALD branch is tempted — but a 100-edge
    // cube is over the ceiling, and nothing else fits.
    expect(couldBeLutImage(1000, 1000)).toBe(false)
  })
})
