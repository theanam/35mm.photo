import { describe, expect, it } from 'vitest'
import { parseCube } from './cube'
import { inputSpaceDef, srgbDecode } from './inputSpace'
import {
  LUT_SIZE,
  MAX_IMPORT_LUT_SIZE,
  REDOMAIN_SIZE,
  cubeToLut3d,
  identityLut,
  lut1dTo3d,
  redomainLut,
  sampleLut,
} from './lut3d'

describe('identityLut', () => {
  it('returns each grid point unchanged', () => {
    const lut = identityLut(5)
    expect(lut.size).toBe(5)
    expect(lut.data.length).toBe(5 ** 3 * 3)
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const [r, g, b] = sampleLut(lut, v, v, v)
      expect(r).toBeCloseTo(v, 6)
      expect(g).toBeCloseTo(v, 6)
      expect(b).toBeCloseTo(v, 6)
    }
  })
})

describe('sampleLut', () => {
  it('interpolates between grid points', () => {
    const lut = identityLut(9)
    // 0.137 falls between grid points, so this only holds if it interpolates.
    for (const v of [0.137, 0.421, 0.938]) {
      expect(sampleLut(lut, v, v, v)[0]).toBeCloseTo(v, 6)
    }
  })

  it('keeps the channels independent', () => {
    const [r, g, b] = sampleLut(identityLut(9), 0.25, 0.75, 0.1)
    expect(r).toBeCloseTo(0.25, 6)
    expect(g).toBeCloseTo(0.75, 6)
    expect(b).toBeCloseTo(0.1, 6)
  })

  it('clamps out-of-range coordinates to the edge rather than wrapping', () => {
    const lut = identityLut(5)
    expect(sampleLut(lut, -1, -1, -1)[0]).toBeCloseTo(0, 6)
    expect(sampleLut(lut, 2, 2, 2)[0]).toBeCloseTo(1, 6)
  })

  it('reads a cube whose channels are swapped', () => {
    // Build red↔blue directly so a wrong index order would show up.
    const size = 4
    const data = new Float32Array(size ** 3 * 3)
    let i = 0
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          data[i++] = b / (size - 1)
          data[i++] = g / (size - 1)
          data[i++] = r / (size - 1)
        }
      }
    }
    const [r, g, b] = sampleLut({ size, data }, 1, 0, 0)
    expect(r).toBeCloseTo(0, 6)
    expect(g).toBeCloseTo(0, 6)
    expect(b).toBeCloseTo(1, 6)
  })
})

describe('lut1dTo3d', () => {
  it('applies an inverting ramp to every channel', () => {
    const lut = lut1dTo3d(Float32Array.from([1, 1, 1, 0, 0, 0]), 2)
    expect(lut.size).toBe(LUT_SIZE)
    expect(sampleLut(lut, 0, 0, 0)[0]).toBeCloseTo(1, 5)
    expect(sampleLut(lut, 1, 1, 1)[0]).toBeCloseTo(0, 5)
  })

  it('keeps per-channel curves separate', () => {
    // Red passes through, green halves, blue is pinned to zero.
    const samples = Float32Array.from([0, 0, 0, 1, 0.5, 0])
    const [r, g, b] = sampleLut(lut1dTo3d(samples, 2), 1, 1, 1)
    expect(r).toBeCloseTo(1, 5)
    expect(g).toBeCloseTo(0.5, 5)
    expect(b).toBeCloseTo(0, 5)
  })
})

describe('cubeToLut3d', () => {
  it('passes a 3D cube through at its own size', () => {
    const body: string[] = []
    for (let i = 0; i < 8; i++) body.push('0.25 0.5 0.75')
    const lut = cubeToLut3d(parseCube(`LUT_3D_SIZE 2\n${body.join('\n')}`))
    expect(lut.size).toBe(2)
    expect([...lut.data.slice(0, 3)]).toEqual([0.25, 0.5, 0.75])
  })

  it('expands a 1D cube into a full grid', () => {
    const lut = cubeToLut3d(parseCube('LUT_1D_SIZE 2\n1 1 1\n0 0 0'))
    expect(lut.size).toBe(LUT_SIZE)
    expect(sampleLut(lut, 0, 0, 0)[0]).toBeCloseTo(1, 5)
  })

  it('refuses a grid larger than the renderer will take', () => {
    const size = MAX_IMPORT_LUT_SIZE + 1
    const fake = {
      kind: '3d' as const,
      size,
      data: new Float32Array(size ** 3 * 3),
      domainMin: [0, 0, 0] as [number, number, number],
      domainMax: [1, 1, 1] as [number, number, number],
    }
    expect(() => cubeToLut3d(fake)).toThrow(new RegExp(`${MAX_IMPORT_LUT_SIZE}`))
  })
})

describe('redomainLut', () => {
  it('is a no-op for sRGB input, without copying', () => {
    const lut = identityLut(17)
    expect(redomainLut(lut, 'srgb')).toBe(lut)
  })

  it('re-indexes an identity cube through the log curve', () => {
    // Feeding identity through the re-domaining should produce exactly the
    // encode curve: sRGB in, linearise, re-encode as the LUT expects.
    const out = redomainLut(identityLut(33), 'slog3', 16)
    const { encode } = inputSpaceDef('slog3')
    for (const i of [0, 4, 8, 12, 15]) {
      const u = i / 15
      expect(sampleLut(out, u, u, u)[0]).toBeCloseTo(encode(srgbDecode(u)), 2)
    }
  })

  it('resamples onto the larger grid by default', () => {
    expect(redomainLut(identityLut(17), 'vlog').size).toBe(REDOMAIN_SIZE)
  })

  it('undoes a log LUT, leaving roughly the identity', () => {
    // A cube that decodes S-Log3 back to display. Re-domained for sRGB input it
    // should be close to a no-op, which is the whole contract of the feature.
    const { encode } = inputSpaceDef('slog3')
    const size = 33
    const data = new Float32Array(size ** 3 * 3)
    let i = 0
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          data[i++] = decodeSlog3ToDisplay(r / (size - 1))
          data[i++] = decodeSlog3ToDisplay(g / (size - 1))
          data[i++] = decodeSlog3ToDisplay(b / (size - 1))
        }
      }
    }
    const out = redomainLut({ size, data }, 'slog3')
    for (const v of [0.2, 0.4, 0.6, 0.8]) {
      expect(sampleLut(out, v, v, v)[0]).toBeCloseTo(v, 1)
    }

    /** Invert the encode numerically, then re-encode for display. */
    function decodeSlog3ToDisplay(code: number): number {
      let lo = 0
      let hi = 20
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2
        if (encode(mid) < code) lo = mid
        else hi = mid
      }
      const linear = (lo + hi) / 2
      return Math.min(1, Math.max(0, srgbEncodeLocal(linear)))
    }
    function srgbEncodeLocal(x: number) {
      return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055
    }
  })

  it('keeps every output value inside 0..1', () => {
    const out = redomainLut(identityLut(33), 'logc3', 24)
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
