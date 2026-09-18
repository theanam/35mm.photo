import { describe, expect, it } from 'vitest'
import { parseCube } from './cube'
import { LOOKS } from './looks'
import type { LookConfig } from './types'
import { inputSpaceDef, srgbDecode } from './inputSpace'
import {
  LUT_SIZE,
  buildLookLut,
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

/** A minimal look, so each test states only the thing it is about. */
const look = (patch: Partial<LookConfig>): LookConfig => ({
  id: 'test',
  name: 'Test',
  blurb: '',
  grain: { amount: 0, size: 50, shadowBias: 0.5 },
  defaultStrength: 100,
  ...patch,
})

/** Saturation of an RGB triple, the HSV definition the bands use. */
function saturationOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b)
  return max <= 1e-9 ? 0 : (max - Math.min(r, g, b)) / max
}

describe('buildLookLut tone curve', () => {
  it('applies the look tone curve', () => {
    // Regression: every built-in carried a toneCurve that nothing ever read,
    // so the looks rendered as their colour transform alone.
    const lifted = buildLookLut(
      look({ toneCurve: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] }),
    )
    expect(sampleLut(lifted, 0.5, 0.5, 0.5)[0]).toBeGreaterThan(0.7)
  })

  it('leaves the cube alone when a look has no curve', () => {
    const plain = buildLookLut(look({}))
    for (const v of [0.25, 0.5, 0.75]) {
      expect(sampleLut(plain, v, v, v)[0]).toBeCloseTo(v, 5)
    }
  })

  it('lifts the black after the curve, not before it', () => {
    // A curve pinned at 0 would undo a lift applied ahead of it, which is what
    // makes the print step the last thing in the chain.
    const faded = buildLookLut(
      look({
        color: { blackLift: 0.06 },
        toneCurve: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
      }),
    )
    expect(sampleLut(faded, 0, 0, 0)[0]).toBeCloseTo(0.06, 3)
  })
})

describe('hue bands', () => {
  it('acts on the band it names and leaves the rest alone', () => {
    const lut = buildLookLut(look({ color: { hueBands: [{ hue: 240, width: 80, sat: 0.2 }] } }))

    const blue = sampleLut(lut, 0.1, 0.2, 0.9)
    const red = sampleLut(lut, 0.9, 0.2, 0.1)
    expect(saturationOf(blue)).toBeLessThan(0.5)
    expect(saturationOf(red)).toBeGreaterThan(0.8)
  })

  it('leaves the neutral axis exactly where it was', () => {
    // Without the saturation gate a band bleeds a cast into every neutral.
    // Checked on grid points, which is where the guarantee is exact: a grey
    // that falls between cells is interpolated against the cell's coloured
    // corners, so it can drift by a fraction of a step. That is inherent to
    // sampling any hue-selective transform as a cube, LUTs from a film scanner
    // included — the next test is what bounds it in practice.
    const lut = buildLookLut(
      look({ color: { hueBands: [{ hue: 0, width: 360, sat: 2, shift: 40 }] } }),
    )
    for (const step of [8, 16, 24]) {
      const v = step / (LUT_SIZE - 1)
      const [r, g, b] = sampleLut(lut, v, v, v)
      expect(r).toBeCloseTo(v, 6)
      expect(g).toBeCloseTo(v, 6)
      expect(b).toBeCloseTo(v, 6)
    }
  })

  it('keeps an off-grid grey neutral under a band the catalogue would use', () => {
    // The strongest saturation move any built-in makes is about 1.35.
    const lut = buildLookLut(look({ color: { hueBands: [{ hue: 0, width: 90, sat: 1.35 }] } }))
    for (const v of [0.2, 0.37, 0.63, 0.86]) {
      const [r, g, b] = sampleLut(lut, v, v, v)
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.004)
    }
  })

  it('shifts hue without draining the colour', () => {
    const lut = buildLookLut(look({ color: { hueBands: [{ hue: 0, width: 60, shift: 25 }] } }))
    const [r, g, b] = sampleLut(lut, 0.9, 0.1, 0.1)
    // Red toward orange: green rises, red stays on top, blue stays put.
    expect(g).toBeGreaterThan(0.1)
    expect(r).toBeGreaterThan(g)
    expect(saturationOf([r, g, b])).toBeGreaterThan(0.7)
  })

  it('reaches zero at the edge of its width', () => {
    const lut = buildLookLut(look({ color: { hueBands: [{ hue: 0, width: 60, sat: 0.1 }] } }))
    // 120° away, well outside a 60°-wide band, so green is untouched.
    const green = sampleLut(lut, 0.1, 0.9, 0.1)
    expect(saturationOf(green)).toBeGreaterThan(0.8)
  })
})

describe('satRolloff', () => {
  it('gives the saturation boost back in the highlights', () => {
    const boosted = { saturation: 1.6 }
    const flat = buildLookLut(look({ color: boosted }))
    const rolled = buildLookLut(look({ color: { ...boosted, satRolloff: 1 } }))

    // A dark, saturated colour: both should push it about the same.
    const darkFlat = saturationOf(sampleLut(flat, 0.3, 0.12, 0.1))
    const darkRolled = saturationOf(sampleLut(rolled, 0.3, 0.12, 0.1))
    expect(darkRolled).toBeGreaterThan(darkFlat * 0.9)

    // A bright one: the rolloff should hold it back.
    const brightFlat = saturationOf(sampleLut(flat, 1, 0.85, 0.8))
    const brightRolled = saturationOf(sampleLut(rolled, 1, 0.85, 0.8))
    expect(brightRolled).toBeLessThan(brightFlat)
  })

  it('does nothing to a look that lowers saturation', () => {
    const a = buildLookLut(look({ color: { saturation: 0.5 } }))
    const b = buildLookLut(look({ color: { saturation: 0.5, satRolloff: 1 } }))
    expect(sampleLut(a, 0.9, 0.4, 0.2)).toEqual(sampleLut(b, 0.9, 0.4, 0.2))
  })
})

describe('mono looks', () => {
  it('runs the hue bands before the mix, so they act as a filter', () => {
    const mono = { mix: [0.3, 0.6, 0.1] as [number, number, number], contrast: 0, tone: 0 }
    const plain = buildLookLut(look({ mono }))
    const filtered = buildLookLut(
      look({ mono, color: { hueBands: [{ hue: 225, width: 90, lum: 0.6 }] } }),
    )

    const sky: [number, number, number] = [0.25, 0.45, 0.85]
    expect(sampleLut(filtered, ...sky)[0]).toBeLessThan(sampleLut(plain, ...sky)[0])
  })

  it('leaves no colour behind', () => {
    const lut = buildLookLut(look({ mono: { mix: [0.3, 0.6, 0.1], contrast: 0, tone: 0 } }))
    const [r, g, b] = sampleLut(lut, 0.9, 0.3, 0.1)
    expect(g).toBeCloseTo(r, 4)
    expect(b).toBeCloseTo(r, 4)
  })
})

describe('mono contrast', () => {
  it('holds both ends however hard it is pushed', () => {
    // Regression: contrast used to be a straight stretch about middle grey, so
    // a hard mono look mapped everything below 0.36 to pure black and a
    // low-key frame lost a fifth of itself before the tone curve ran.
    for (const contrast of [10, 40, 80, 100]) {
      const lut = buildLookLut(look({ mono: { mix: [0.3, 0.6, 0.1], contrast, tone: 0 } }))
      expect(sampleLut(lut, 0, 0, 0)[0]).toBeCloseTo(0, 5)
      expect(sampleLut(lut, 1, 1, 1)[0]).toBeCloseTo(1, 5)
    }
  })

  it('keeps a dark tone off the floor at the contrast the looks use', () => {
    const lut = buildLookLut(look({ mono: { mix: [0.3, 0.6, 0.1], contrast: 46, tone: 0 } }))
    // A deep shadow stays a shadow rather than becoming black.
    expect(sampleLut(lut, 0.12, 0.12, 0.12)[0]).toBeGreaterThan(0.01)
  })

  it('still steepens the middle', () => {
    const flat = buildLookLut(look({ mono: { mix: [0.3, 0.6, 0.1], contrast: 0, tone: 0 } }))
    const hard = buildLookLut(look({ mono: { mix: [0.3, 0.6, 0.1], contrast: 60, tone: 0 } }))
    const slope = (lut: ReturnType<typeof buildLookLut>) =>
      sampleLut(lut, 0.6, 0.6, 0.6)[0] - sampleLut(lut, 0.4, 0.4, 0.4)[0]
    expect(slope(hard)).toBeGreaterThan(slope(flat) * 1.3)
  })
})

describe('the built-in catalogue', () => {
  it('gives every look a unique id and a section', () => {
    const ids = LOOKS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of LOOKS) expect(l.group).toBeDefined()
  })

  it('keeps the ids saved edits already point at', () => {
    // A sidecar or an IndexedDB record stores `look.id`. Renaming one of these
    // silently drops the look off every photo that used it.
    for (const id of [
      'standard', 'vivid', 'portrait', 'chrome', 'retro-neg',
      'faded', 'neutral', 'cine-flat', 'mono',
    ]) {
      expect(LOOKS.some((l) => l.id === id)).toBe(true)
    }
  })

  it('rolls off every saturation boost', () => {
    // The rule the catalogue states about itself: anything pushing past 1 has
    // to fade out in the highlights, or bright skies go flat.
    for (const l of LOOKS) {
      const sat = l.color?.saturation
      if (sat != null && sat > 1) {
        expect(l.color?.satRolloff, `${l.id} boosts saturation without a rolloff`).toBeGreaterThan(0)
      }
    }
  })

  it('builds every look into a cube that stays in range', () => {
    for (const l of LOOKS) {
      const lut = buildLookLut(l, 9)
      for (const v of lut.data) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
