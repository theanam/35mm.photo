import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INPUT_SPACE,
  INPUT_SPACES,
  guessInputSpace,
  inputSpaceDef,
  srgbDecode,
  srgbEncode,
} from './inputSpace'

describe('sRGB transfer', () => {
  it('round-trips', () => {
    for (const v of [0, 0.002, 0.04, 0.18, 0.5, 0.9, 1]) {
      expect(srgbDecode(srgbEncode(v))).toBeCloseTo(v, 6)
    }
  })

  it('anchors black and white', () => {
    expect(srgbEncode(0)).toBeCloseTo(0, 9)
    expect(srgbEncode(1)).toBeCloseTo(1, 6)
  })

  it('puts 18% scene grey near the middle of the code range', () => {
    expect(srgbEncode(0.18)).toBeGreaterThan(0.4)
    expect(srgbEncode(0.18)).toBeLessThan(0.55)
  })
})

describe('every input space', () => {
  it.each(INPUT_SPACES.map((s) => [s.id, s] as const))(
    '%s encodes monotonically over the scene range',
    (_id, space) => {
      let previous = -Infinity
      for (let i = 0; i <= 128; i++) {
        const v = space.encode(i / 128)
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = v
      }
    },
  )

  it.each(INPUT_SPACES.map((s) => [s.id, s] as const))(
    '%s lands 18%% grey inside the code range',
    (_id, space) => {
      const grey = space.encode(0.18)
      expect(grey).toBeGreaterThan(0.05)
      expect(grey).toBeLessThan(0.95)
    },
  )

  it('places log greys higher than the display-referred ones', () => {
    // The point of a log curve: mid grey sits well above where sRGB puts it,
    // which is why feeding sRGB straight into a log LUT looks washed out.
    const srgb = inputSpaceDef('srgb').encode(0.18)
    for (const id of ['slog3', 'vlog', 'clog3', 'logc3'] as const) {
      expect(inputSpaceDef(id).encode(0.18)).toBeLessThan(srgb)
    }
  })

  it('has a distinct name and blurb for each entry', () => {
    const names = INPUT_SPACES.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const space of INPUT_SPACES) expect(space.blurb.length).toBeGreaterThan(0)
  })
})

describe('inputSpaceDef', () => {
  it('falls back to the default for an unset or unknown id', () => {
    expect(inputSpaceDef(undefined).id).toBe(DEFAULT_INPUT_SPACE)
    expect(inputSpaceDef('nonsense' as never).id).toBe(DEFAULT_INPUT_SPACE)
  })
})

describe('guessInputSpace', () => {
  it.each([
    ['Kodak_2383_SLog3.cube', 'slog3'],
    ['sony s-log3 to rec709.cube', 'slog3'],
    ['VLog_to_709.cube', 'vlog'],
    ['Panasonic V-LOG film.cube', 'vlog'],
    ['Canon CLog3 neutral.cube', 'clog3'],
    ['C-Log-3 daylight.cube', 'clog3'],
    ['ARRI LogC.cube', 'logc3'],
    ['Alexa_LogC_K1S1.cube', 'logc3'],
    ['Rec709 contrast.cube', 'rec709'],
  ])('reads %s as %s', (name, expected) => {
    expect(guessInputSpace(name)).toBe(expected)
  })

  it('assumes sRGB for an ordinary photo LUT', () => {
    expect(guessInputSpace('Warm Portrait.cube')).toBe('srgb')
    expect(guessInputSpace('Faded Film 04.cube')).toBe('srgb')
  })

  it('looks at the embedded title as well as the filename', () => {
    expect(guessInputSpace('preset-07.cube', 'Bleach Bypass (S-Log3)')).toBe('slog3')
  })

  it('tolerates missing text', () => {
    expect(guessInputSpace(undefined, undefined)).toBe(DEFAULT_INPUT_SPACE)
  })
})
