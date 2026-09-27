import { describe, expect, it } from 'vitest'
import { confidenceOf, cropFactorOf, lensTokens, matchCamera, normalizeMaker, normalizeModel, rankLenses } from './match'
import type { DbLensIndex, LensDbIndex } from './types'

const lens = (maker: string, model: string, mounts: string[], min: number, max: number, name?: string): DbLensIndex => ({
  id: `${maker}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  maker,
  model,
  ...(name ? { name } : {}),
  mounts,
  minFocal: min,
  maxFocal: max,
  crop: 1,
  has: ['distortion'],
  shard: 'x',
})

/** A slice of the real database, spelt the way it spells things. */
const INDEX: LensDbIndex = {
  commit: 'test',
  generated: '2026-09-27',
  mounts: [
    { name: 'Fujifilm X', compat: ['M42', 'Generic'] },
    { name: 'Sony E', compat: ['Generic'] },
    { name: 'Nikon F AF', compat: ['Nikon F'] },
    { name: 'Nikon Z', compat: ['Nikon F AF', 'Nikon F'] },
    { name: 'Canon RF', compat: ['Canon EF', 'Canon EF-S'] },
    { name: 'fujix100v2', compat: [] },
  ],
  cameras: [
    { maker: 'Fujifilm', model: 'X-T4', mount: 'Fujifilm X', crop: 1.534 },
    { maker: 'Sony', model: 'ILCE-6700', mount: 'Sony E', crop: 1.534 },
    { maker: 'Sony', model: 'ILCE-7M4', mount: 'Sony E', crop: 1 },
    { maker: 'Nikon', model: 'Nikon Z 6', mount: 'Nikon Z', crop: 1 },
    { maker: 'Canon', model: 'Canon EOS R6', mount: 'Canon RF', crop: 1 },
    { maker: 'Fujifilm', model: 'X100V', mount: 'fujix100v2', crop: 1.53 },
    { maker: 'Ricoh Imaging Company, Ltd.', model: 'Ricoh GR III', mount: 'ricohGRIII', crop: 1.53 },
  ],
  lenses: [
    lens('Fujifilm', 'XF18-55mmF2.8-4 R LM OIS', ['Fujifilm X'], 18, 55, 'XF 18-55mm f/2.8-4 R LM OIS'),
    lens('Fujifilm', 'XF18-135mmF3.5-5.6R LM OIS WR', ['Fujifilm X'], 18, 135),
    lens('Fujifilm', 'XF23mmF1.4 R', ['Fujifilm X'], 23, 23),
    lens('Fujifilm', 'XF23mmF2 R WR', ['Fujifilm X'], 23, 23),
    lens('Fujifilm', 'Fujifilm X100V & X100VI', ['fujix100v2'], 23, 23),
    lens('Sony', 'FE 24-70mm f/2.8 GM', ['Sony E'], 24, 70),
    lens('Sony', 'FE 24-70mm f/2.8 GM II', ['Sony E'], 24, 70),
    lens('Sony', 'FE 24-70mm f/4 ZA OSS', ['Sony E'], 24, 70),
    lens('Sony', 'E 18-135mm f/3.5-5.6 OSS', ['Sony E'], 18, 135),
    lens('Viltrox', 'Viltrox 16mm F1.8 FE', ['Sony E', 'Nikon Z'], 16, 16, 'Viltrox AF 16mm F1.8 FE/L/Z'),
    lens('Sigma', 'Sigma 85mm f/1.4 DG DN Art', ['Sony E', 'Leica L'], 85, 85),
    lens('Sony', 'FE 85mm f/1.4 GM', ['Sony E'], 85, 85),
    lens('Sony', 'FE 85mm f/1.8', ['Sony E'], 85, 85),
    lens('Nikon', 'Nikkor Z 24-70mm f/2.8 S', ['Nikon Z'], 24, 70),
    lens('Nikon', 'Nikon AF-S Nikkor 24-70mm f/2.8G ED', ['Nikon F AF'], 24, 70),
    lens('Nikon', 'Nikon AF-S Nikkor 24-120mm f/4G ED VR', ['Nikon F AF'], 24, 120),
    lens('Canon', 'Canon RF 24-105mm F4L IS USM', ['Canon RF'], 24, 105),
    lens('Canon', 'Canon RF 24-105mm F4-7.1 IS STM', ['Canon RF'], 24, 105),
  ],
}

describe('normalising what the camera wrote', () => {
  it('boils makers down to the brand', () => {
    expect(normalizeMaker('FUJIFILM')).toBe('fujifilm')
    expect(normalizeMaker('NIKON CORPORATION')).toBe('nikon')
    expect(normalizeMaker('Ricoh Imaging Company, Ltd.')).toBe('ricoh')
    expect(normalizeMaker('OLYMPUS IMAGING CORP.')).toBe('olympus')
    expect(normalizeMaker('OM Digital Solutions')).toBe('om system')
    expect(normalizeMaker('Carl Zeiss')).toBe('zeiss')
  })

  it('drops the brand a model repeats', () => {
    expect(normalizeModel('Canon EOS R6', 'Canon')).toBe('eos r6')
    expect(normalizeModel('NIKON Z 6', 'NIKON CORPORATION')).toBe('z 6')
    expect(normalizeModel('ILCE-7M4', 'SONY')).toBe('ilce 7m4')
  })

  it('tokenises lens names the way both sides write them', () => {
    const fuji = lensTokens('XF18-55mmF2.8-4 R LM OIS')
    expect(fuji.focal).toBe('18-55')
    expect(fuji.aperture).toBe('f2.8-4')
    expect(fuji.all).toEqual(new Set(['xf', '18-55', 'f2.8-4', 'r', 'lm', 'ois']))

    expect(lensTokens('FE 24-70mm F2.8 GM').all).toEqual(lensTokens('FE 24-70mm f/2.8 GM').all)
    expect(lensTokens('24.0-70.0 mm f/2.8').focal).toBe('24-70')
    expect(lensTokens('RF24-105mm F4 L IS USM').all).toEqual(new Set(['rf', '24-105', 'f4', 'l', 'is', 'usm']))
    expect(lensTokens('Viltrox 85mm F1.4 FE').focal).toBe('85')
  })
})

describe('matching the camera', () => {
  it('finds a body however the maker is capitalised', () => {
    expect(matchCamera(INDEX, { make: 'FUJIFILM', model: 'X-T4' })?.crop).toBe(1.534)
    expect(matchCamera(INDEX, { make: 'SONY', model: 'ILCE-6700' })?.mount).toBe('Sony E')
    expect(matchCamera(INDEX, { make: 'Canon', model: 'Canon EOS R6' })?.mount).toBe('Canon RF')
    expect(matchCamera(INDEX, { make: 'NIKON CORPORATION', model: 'NIKON Z 6' })?.mount).toBe('Nikon Z')
    expect(matchCamera(INDEX, { make: 'RICOH IMAGING COMPANY, LTD.', model: 'RICOH GR III' })?.crop).toBe(1.53)
  })

  it('gives up rather than guess', () => {
    expect(matchCamera(INDEX, { make: 'Sony', model: 'ILCE-9999' })).toBeNull()
  })

  it('reads the crop factor from the camera, or from the 35 mm equivalent', () => {
    expect(cropFactorOf(matchCamera(INDEX, { make: 'Sony', model: 'ILCE-6700' }), {})).toBe(1.534)
    expect(cropFactorOf(null, { focal: 50, focal35: 75 })).toBe(1.5)
    expect(cropFactorOf(null, { focal: 50 })).toBeNull()
  })
})

describe('matching the lens', () => {
  const on = (make: string, model: string) => matchCamera(INDEX, { make, model })

  it('is certain about a string the database spells the same way', () => {
    const shot = { make: 'FUJIFILM', model: 'X-T4', lens: 'XF18-55mmF2.8-4 R LM OIS', focal: 23 }
    const ranked = rankLenses(INDEX, shot, on('FUJIFILM', 'X-T4'))
    expect(ranked[0].lens.model).toBe('XF18-55mmF2.8-4 R LM OIS')
    expect(confidenceOf(ranked, shot)).toBe('high')
  })

  it('forgives the aperture spelt differently', () => {
    const shot = { make: 'SONY', model: 'ILCE-7M4', lens: 'FE 24-70mm F2.8 GM', focal: 35, aperture: 4 }
    const ranked = rankLenses(INDEX, shot, on('SONY', 'ILCE-7M4'))
    expect(ranked[0].lens.model).toBe('FE 24-70mm f/2.8 GM')
    expect(confidenceOf(ranked, shot)).toBe('high')
  })

  it('prefers the version the camera named over the one it did not', () => {
    const shot = { make: 'SONY', model: 'ILCE-7M4', lens: 'FE 24-70mm F2.8 GM II', focal: 35 }
    expect(rankLenses(INDEX, shot, on('SONY', 'ILCE-7M4'))[0].lens.model).toBe('FE 24-70mm f/2.8 GM II')
  })

  it('reads a Nikon F string that is only numbers, with the mount narrowing it', () => {
    const shot = { make: 'NIKON CORPORATION', model: 'NIKON Z 6', lens: '24.0-70.0 mm f/2.8', focal: 50 }
    const ranked = rankLenses(INDEX, shot, on('NIKON CORPORATION', 'NIKON Z 6'))
    // Both 24-70 f/2.8 lenses fit a Z body; the string cannot tell them apart.
    expect(ranked.slice(0, 2).map((r) => r.lens.model).sort()).toEqual([
      'Nikkor Z 24-70mm f/2.8 S',
      'Nikon AF-S Nikkor 24-70mm f/2.8G ED',
    ])
    expect(confidenceOf(ranked, shot)).toBe('ambiguous')
  })

  it('reads Canon\'s run-together RF names', () => {
    const shot = { make: 'Canon', model: 'Canon EOS R6', lens: 'RF24-105mm F4 L IS USM', focal: 50 }
    const ranked = rankLenses(INDEX, shot, on('Canon', 'Canon EOS R6'))
    expect(ranked[0].lens.model).toBe('Canon RF 24-105mm F4L IS USM')
    expect(confidenceOf(ranked, shot)).toBe('high')
  })

  it('rules out a lens that cannot reach the focal length', () => {
    const shot = { make: 'FUJIFILM', model: 'X-T4', lens: 'XF23mmF1.4 R', focal: 23 }
    const ranked = rankLenses(INDEX, shot, on('FUJIFILM', 'X-T4'))
    expect(ranked.every((r) => r.lens.minFocal <= 23 * 1.12)).toBe(true)
    expect(ranked[0].lens.model).toBe('XF23mmF1.4 R')
  })

  it('rules out a lens that does not fit the mount', () => {
    const shot = { make: 'FUJIFILM', model: 'X-T4', lens: 'FE 24-70mm F2.8 GM', focal: 35 }
    const ranked = rankLenses(INDEX, shot, on('FUJIFILM', 'X-T4'))
    expect(ranked.some((r) => r.lens.maker === 'Sony')).toBe(false)
    expect(confidenceOf(ranked, shot)).toBe('none')
  })

  it('knows a fixed-lens camera by its body alone', () => {
    const shot = { make: 'FUJIFILM', model: 'X100V' }
    const ranked = rankLenses(INDEX, shot, on('FUJIFILM', 'X100V'))
    expect(ranked).toHaveLength(1)
    expect(confidenceOf(ranked, shot)).toBe('high')
  })

  it('takes the lens maker into account for third-party glass', () => {
    const shot = { make: 'SONY', model: 'ILCE-6700', lensMake: 'Viltrox', lens: 'Viltrox 16mm F1.8 FE', focal: 16 }
    const ranked = rankLenses(INDEX, shot, on('SONY', 'ILCE-6700'))
    expect(ranked[0].lens.maker).toBe('Viltrox')
    expect(confidenceOf(ranked, shot)).toBe('high')
  })

  it('does not hand a third-party lens to the maker\'s own, however the numbers agree', () => {
    // LibRaw gives no LensMake for this file; the maker is only in the string.
    const shot = { make: 'SONY', model: 'ILCE-7C', lens: 'Viltrox 85mm F1.4 FE', focal: 85, aperture: 1.4 }
    const ranked = rankLenses(INDEX, shot, on('SONY', 'ILCE-7M4'))
    // The Sony may still be the nearest thing on the list, but not by enough.
    expect(ranked[0]?.score ?? 0).toBeLessThan(0.4)
    expect(confidenceOf(ranked, shot)).toBe('none')
  })

  it('is never certain while a word the camera wrote is unaccounted for', () => {
    const shot = { make: 'SONY', model: 'ILCE-7M4', lens: '85mm F1.4 Art', focal: 85 }
    const ranked = rankLenses(INDEX, shot, on('SONY', 'ILCE-7M4'))
    expect(ranked[0].lens.maker).toBe('Sigma')
    expect(confidenceOf(ranked, shot)).not.toBe('none')
    const sony = { make: 'SONY', model: 'ILCE-7M4', lens: '85mm F1.4 Macro', focal: 85 }
    expect(confidenceOf(rankLenses(INDEX, sony, on('SONY', 'ILCE-7M4')), sony)).toBe('ambiguous')
  })

  it('says nothing about a lens the database has never seen', () => {
    const shot = { make: 'SONY', model: 'ILCE-6700', lensMake: 'Viltrox', lens: 'Viltrox 15mm F1.7 E', focal: 15 }
    const ranked = rankLenses(INDEX, shot, on('SONY', 'ILCE-6700'))
    expect(confidenceOf(ranked, shot)).toBe('none')
  })

  it('still ranks without a camera match, over every lens', () => {
    const shot = { lens: 'Sigma 85mm f/1.4 DG DN Art', focal: 85 }
    const ranked = rankLenses(INDEX, shot, null)
    expect(ranked[0].lens.maker).toBe('Sigma')
  })
})
