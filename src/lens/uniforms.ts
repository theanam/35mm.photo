import type { LensState } from '../editor/edit-stack/types'
import { autoScale, radiusScale, rescalePolynomial, vignettingRadiusScale } from './model'
import type { ResolvedLens } from './resolve'

/**
 * What the colour pass is handed, all in the picture's own hugin units: a
 * radius of 1 is half the shorter side of the stored texture.
 *
 *   Rd/Ru      = 1 + Σ distK[i] · r^(i+1)          source radius for an output radius
 *   red, blue  = Rd/Ru = v + c r + b r²             per-channel scale on the source radius
 *   darkening  = 1 + k1 r² + k2 r⁴ + k3 r⁶          divided out, by `vigAmount`
 *   zoom       = output radii are divided by this before the model
 */
export interface LensUniforms {
  distK: [number, number, number, number]
  zoom: number
  tcaR: [number, number, number]
  tcaB: [number, number, number]
  vigK: [number, number, number]
  vigAmount: number
}

export const IDENTITY_LENS: LensUniforms = {
  distK: [0, 0, 0, 0],
  zoom: 1,
  tcaR: [1, 0, 0],
  tcaB: [1, 0, 0],
  vigK: [0, 0, 0],
  vigAmount: 0,
}

/**
 * The manual sliders, in these units. The slider used to be a bare r² term of
 * 0.35 × amount on a radius with half-height ½; in hugin units that radius is
 * twice as long, so the same picture needs a quarter of the coefficient. CA
 * was that again at 6%, red one way and blue the other.
 */
const MANUAL_DISTORTION = 0.35 / 4
const MANUAL_CA = (0.35 * 0.06) / 4

/** Whether the profile is used on this file at all, by the mode. */
export function profileApplies(lens: LensState, isRaw: boolean): boolean {
  const mode = lens.correction.mode
  return mode === 'on' || (mode === 'auto' && isRaw)
}

export function lensUniforms(
  profile: ResolvedLens | null,
  lens: LensState,
  isRaw: boolean,
  storedWidth: number,
  storedHeight: number,
): LensUniforms {
  const w = Math.max(1, storedWidth)
  const h = Math.max(1, storedHeight)
  const longOverShort = Math.max(w, h) / Math.min(w, h)
  const c = lens.correction
  const use = profile && profile.source === 'lensfun' && profileApplies(lens, isRaw) ? profile : null

  let distK: [number, number, number, number] = [0, 0, 0, 0]
  if (use?.distortion && c.distortion && use.rectilinear) {
    const s = radiusScale(use.distortion.calibCrop, use.distortion.calibAspect, use.crop, longOverShort)
    const amount = c.distortionAmount / 100
    distK = rescalePolynomial(use.distortion.c, s, [1, 2, 3, 4]).map((v) => v * amount) as typeof distK
  }
  distK[1] += (lens.distortion / 100) * MANUAL_DISTORTION

  let tcaR: [number, number, number] = [1, 0, 0]
  let tcaB: [number, number, number] = [1, 0, 0]
  if (use?.tca && c.tca) {
    const s = radiusScale(use.tca.calibCrop, use.tca.calibAspect, use.crop, longOverShort)
    const amount = c.tcaAmount / 100
    const scaled = (t: [number, number, number]): [number, number, number] => {
      const [v, cc, b] = rescalePolynomial(t, s, [0, 1, 2])
      return [1 + (v - 1) * amount, cc * amount, b * amount]
    }
    tcaR = scaled(use.tca.red)
    tcaB = scaled(use.tca.blue)
  }
  tcaR[2] += (lens.ca / 100) * MANUAL_CA
  tcaB[2] -= (lens.ca / 100) * MANUAL_CA

  let vigK: [number, number, number] = [0, 0, 0]
  let vigAmount = 0
  if (use?.vignetting && c.vignetting) {
    const s = vignettingRadiusScale(use.vignetting.calibCrop, use.crop, longOverShort)
    vigK = rescalePolynomial(use.vignetting.k, s, [2, 4, 6])
    vigAmount = c.vignettingAmount / 100
  }

  const zoom = c.constrain ? autoScale(distK, w / Math.min(w, h), h / Math.min(w, h)) : 1

  return { distK, zoom, tcaR, tcaB, vigK, vigAmount }
}

export function isIdentityLens(u: LensUniforms): boolean {
  return (
    u.distK.every((v) => v === 0) &&
    u.zoom === 1 &&
    u.tcaR[0] === 1 && u.tcaR[1] === 0 && u.tcaR[2] === 0 &&
    u.tcaB[0] === 1 && u.tcaB[1] === 0 && u.tcaB[2] === 0 &&
    u.vigAmount === 0
  )
}
