import { describe, expect, it } from 'vitest'
import {
  autoScale,
  distortionAt,
  hermite,
  pickCalibrationSet,
  radiusScale,
  rescalePolynomial,
  tcaAt,
  toPolynomial,
  vignettingAt,
  vignettingRadiusScale,
} from './model'
import type { CalibrationSet } from './types'

const set = (over: Partial<CalibrationSet> = {}): CalibrationSet => ({
  crop: 1.5,
  aspect: 1.5,
  distortion: [],
  tca: [],
  vignetting: [],
  ...over,
})

describe('choosing a calibration set', () => {
  it('never takes one made on a larger sensor, and prefers the nearest', () => {
    const ff = set({ crop: 1, distortion: [{ model: 'poly3', focal: 50, terms: [0.01] }] })
    const aps = set({ crop: 1.5, distortion: [{ model: 'poly3', focal: 50, terms: [0.02] }] })
    const has = (s: CalibrationSet) => s.distortion.length > 0
    // An APS-C body: both fit, APS-C is nearer.
    expect(pickCalibrationSet([ff, aps], 1.53, has)).toBe(aps)
    // A full-frame body: the APS-C set would not reach its corners.
    expect(pickCalibrationSet([ff, aps], 1, has)).toBe(ff)
    // Unknown body: the lens's own.
    expect(pickCalibrationSet([aps], null, has)).toBe(aps)
    expect(pickCalibrationSet([aps], 1, has)).toBeNull()
  })
})

describe('interpolating between focal lengths', () => {
  it('is Lensfun\'s Hermite segment', () => {
    // A straight line stays a straight line.
    expect(hermite(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5, 10)
    // Ends without a neighbour use the chord as their tangent.
    expect(hermite(null, 1, 2, null, 0.5)).toBeCloseTo(1.5, 10)
    expect(hermite(null, 0, 1, null, 0)).toBe(0)
    expect(hermite(null, 0, 1, null, 1)).toBe(1)
  })

  it('returns an exact entry untouched and clamps outside the range', () => {
    const s = set({
      distortion: [
        { model: 'ptlens', focal: 18, terms: [0.02, -0.1, 0.07] },
        { model: 'ptlens', focal: 55, terms: [0.005, -0.001, 0.014] },
      ],
    })
    const at18 = distortionAt(s, 18)!
    expect(at18.clamped).toBe(false)
    expect(at18.c).toEqual(toPolynomial('ptlens', [0.02, -0.1, 0.07]))
    const at12 = distortionAt(s, 12)!
    expect(at12.clamped).toBe(true)
    expect(at12.c).toEqual(at18.c)
    const at30 = distortionAt(s, 30)!
    expect(at30.clamped).toBe(false)
    // Between the two, and nearer 18's values than 55's at t ≈ 0.32.
    expect(at30.c[2]).toBeLessThan(at18.c[2])
    expect(at30.c[2]).toBeGreaterThan(distortionAt(s, 55)!.c[2])
  })

  it('scales the TCA terms that fall as 1/f before interpolating', () => {
    const s = set({
      tca: [
        { model: 'poly3', focal: 10, terms: [1.001, 0.999, 0, 0, -0.002, 0.002] },
        { model: 'poly3', focal: 20, terms: [1.001, 0.999, 0, 0, -0.001, 0.001] },
      ],
    })
    // b·f is constant here (−0.02), so at 15 mm b is exactly −0.02/15.
    const at15 = tcaAt(s, 15)!
    expect(at15.red[2]).toBeCloseTo(-0.02 / 15, 6)
    expect(at15.blue[2]).toBeCloseTo(0.02 / 15, 6)
    expect(at15.red[0]).toBeCloseTo(1.001, 6)
  })

  it('reads a linear TCA as a scale alone', () => {
    const s = set({ tca: [{ model: 'linear', focal: 35, terms: [1.0002, 0.9998] }] })
    expect(tcaAt(s, 35)).toMatchObject({ red: [1.0002, 0, 0], blue: [0.9998, 0, 0] })
  })
})

describe('the polynomial each model becomes', () => {
  it('renormalises poly3 and ptlens so the centre keeps its scale', () => {
    // poly3 with k1: Rd = Ru(1 − k1 + k1 Ru²) becomes Rd = Ru(1 + k1/d³ Ru²).
    const k1 = -0.05
    const d = 1 - k1
    expect(toPolynomial('poly3', [k1])).toEqual([0, k1 / d ** 3, 0, 0])
    const [a, b, c] = [0.02, -0.1, 0.07]
    const dd = 1 - a - b - c
    const p = toPolynomial('ptlens', [a, b, c])
    expect(p[0]).toBeCloseTo(c / dd ** 2, 12)
    expect(p[1]).toBeCloseTo(b / dd ** 3, 12)
    expect(p[2]).toBeCloseTo(a / dd ** 4, 12)
    expect(p[3]).toBe(0)
    expect(toPolynomial('poly5', [0.1, 0.01])).toEqual([0, 0.1, 0, 0.01])
  })
})

describe('vignetting', () => {
  const lens = { minFocal: 18, maxFocal: 55 }
  const s = set({
    vignetting: [
      { model: 'pa', focal: 18, aperture: 2.8, distance: 1000, terms: [-1, 0.9, -0.6] },
      { model: 'pa', focal: 18, aperture: 8, distance: 1000, terms: [-0.4, 0, 0] },
      { model: 'pa', focal: 55, aperture: 4, distance: 1000, terms: [-0.2, 0, 0] },
    ],
  })

  it('returns an exact entry, and weights between the rest', () => {
    expect(vignettingAt(s, lens, 18, 2.8)!.k).toEqual([-1, 0.9, -0.6])
    const mid = vignettingAt(s, lens, 18, 4)!
    expect(mid.k[0]).toBeLessThan(-0.4)
    expect(mid.k[0]).toBeGreaterThan(-1)
  })

  it('needs an aperture and gives up far from any measurement', () => {
    expect(vignettingAt(s, lens, 18, 0)).toBeNull()
    expect(vignettingAt(set({ vignetting: [{ model: 'pa', focal: 18, aperture: 22, distance: 1000, terms: [-0.1, 0, 0] }] }), lens, 55, 1.4)).toBeNull()
  })
})

describe('moving between frames', () => {
  it('is one on the calibration frame itself', () => {
    expect(radiusScale(1.5, 1.5, 1.5, 1.5)).toBe(1)
    expect(vignettingRadiusScale(1, 1, 1.5)).toBeCloseTo(1 / Math.hypot(1.5, 1), 10)
  })

  it('makes a unit of radius smaller on a smaller sensor', () => {
    // Full-frame calibration on an APS-C body: this frame's half short side is
    // 1.5× fewer millimetres, so its radius-1 is 1/1.5 of the calibration's.
    expect(radiusScale(1, 1.5, 1.5, 1.5)).toBeCloseTo(1 / 1.5, 10)
  })

  it('accounts for a 4:3 picture on a 3:2 calibration', () => {
    // Same sensor diagonal: the shorter side is longer, so radius-1 is more.
    expect(radiusScale(2, 1.5, 2, 4 / 3)).toBeCloseTo(Math.hypot(1.5, 1) / Math.hypot(4 / 3, 1), 10)
  })

  it('rescales a polynomial degree by degree', () => {
    expect(rescalePolynomial([1, 1, 1, 1], 2, [1, 2, 3, 4])).toEqual([2, 4, 8, 16])
    expect(rescalePolynomial([1, 1, 1], 2, [2, 4, 6])).toEqual([4, 16, 64])
    // The constant of a TCA polynomial is a scale, and scales are unitless.
    expect(rescalePolynomial([1.001, 1, 1], 2, [0, 1, 2])).toEqual([1.001, 2, 4])
  })
})

describe('auto-scale', () => {
  it('is one with no distortion', () => {
    expect(autoScale([0, 0, 0, 0], 1.5, 1)).toBe(1)
  })

  it('zooms in for pincushion and out for barrel', () => {
    // Pincushion: Rd > Ru, so the corners would sample past the source.
    expect(autoScale([0, 0.05, 0, 0], 1.5, 1)).toBeGreaterThan(1)
    // Barrel: Rd < Ru, so there is source past every corner to bring in.
    expect(autoScale([0, -0.05, 0, 0], 1.5, 1)).toBeLessThan(1)
  })

  it('puts the corner exactly on the source edge', () => {
    const c: [number, number, number, number] = [0, 0.05, 0, 0]
    const s = autoScale(c, 1.5, 1) / 1.001
    const corner = Math.hypot(1.5, 1)
    const ru = corner / s
    const rd = ru * (1 + c[1] * ru * ru)
    expect(rd).toBeCloseTo(corner, 4)
  })
})
