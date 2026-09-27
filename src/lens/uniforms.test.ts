import { describe, expect, it } from 'vitest'
import { neutralLens } from '../editor/edit-stack/defaults'
import { IDENTITY_LENS, isIdentityLens, lensUniforms } from './uniforms'
import type { ResolvedLens } from './resolve'

const profile = (over: Partial<ResolvedLens> = {}): ResolvedLens => ({
  source: 'lensfun',
  camera: null,
  crop: 1.5,
  lens: null,
  confidence: 'high',
  candidates: [],
  chosen: false,
  rectilinear: true,
  distortion: { c: [0, -0.02, 0, 0], calibCrop: 1.5, calibAspect: 1.5, clamped: false },
  tca: { red: [1.0006, 0, -0.0002], blue: [0.9998, 0, 0.0002], calibCrop: 1.5, calibAspect: 1.5, clamped: false },
  vignetting: { k: [-0.4, 0.1, 0], calibCrop: 1.5, clamped: false },
  focal: 23,
  aperture: 4,
  ...over,
})

describe('lens uniforms', () => {
  it('are the identity with nothing to do', () => {
    expect(isIdentityLens(lensUniforms(null, neutralLens(), true, 6000, 4000))).toBe(true)
    expect(isIdentityLens(IDENTITY_LENS)).toBe(true)
  })

  it('carry the profile through on the frame it was made for', () => {
    const u = lensUniforms(profile(), neutralLens(), true, 6000, 4000)
    expect(u.distK[1]).toBeCloseTo(-0.02, 10)
    expect(u.tcaR).toEqual([1.0006, 0, -0.0002])
    expect(u.vigK[0]).toBeCloseTo(-0.4 / Math.hypot(1.5, 1) ** 2, 10)
    expect(u.vigAmount).toBe(1)
    // Barrel straightened: zoomed out a little to keep every corner.
    expect(u.zoom).toBeLessThan(1)
  })

  it('applies to raw files only under auto, and to everything under on', () => {
    const lens = neutralLens()
    expect(isIdentityLens(lensUniforms(profile(), lens, false, 6000, 4000))).toBe(true)
    lens.correction.mode = 'on'
    expect(isIdentityLens(lensUniforms(profile(), lens, false, 6000, 4000))).toBe(false)
    lens.correction.mode = 'off'
    expect(isIdentityLens(lensUniforms(profile(), lens, true, 6000, 4000))).toBe(true)
  })

  it('scales each correction by its amount and honours its switch', () => {
    const lens = neutralLens()
    lens.correction.distortionAmount = 50
    lens.correction.tca = false
    lens.correction.vignettingAmount = 200
    const u = lensUniforms(profile(), lens, true, 6000, 4000)
    expect(u.distK[1]).toBeCloseTo(-0.01, 10)
    expect(u.tcaR).toEqual([1, 0, 0])
    expect(u.vigAmount).toBe(2)
  })

  it('adds the manual sliders on top, in the same units as before', () => {
    const lens = neutralLens()
    lens.distortion = 100
    lens.ca = 100
    lens.correction.constrain = false
    const u = lensUniforms(null, lens, true, 6000, 4000)
    // 0.35 on a half-height-½ radius is 0.35/4 on a half-height-1 radius.
    expect(u.distK[1]).toBeCloseTo(0.0875, 10)
    expect(u.tcaR[2]).toBeCloseTo(0.00525, 10)
    expect(u.tcaB[2]).toBeCloseTo(-0.00525, 10)
    expect(u.zoom).toBe(1)
  })

  it('leaves distortion alone on a fisheye, but still corrects its colour', () => {
    const u = lensUniforms(profile({ rectilinear: false }), neutralLens(), true, 6000, 4000)
    expect(u.distK).toEqual([0, 0, 0, 0])
    expect(u.vigAmount).toBe(1)
  })

  it('treats a portrait texture by its short side, like the sensor does', () => {
    const land = lensUniforms(profile(), neutralLens(), true, 6000, 4000)
    const port = lensUniforms(profile(), neutralLens(), true, 4000, 6000)
    expect(port.distK).toEqual(land.distK)
    expect(port.zoom).toBeCloseTo(land.zoom, 10)
  })
})
