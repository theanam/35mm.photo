import { describe, expect, it } from 'vitest'
import {
  MAX_EDGE_SHIFT,
  REFINE_EPS,
  REFINE_RADIUS,
  boxBlur,
  edgeOptions,
  guidedFilter,
  refineMask,
  resample,
  shiftEdge,
} from './refine'
import { cachedSubject, forgetSubjects, rememberSubject, subjectMapsFor } from './detect'
import { createMask } from '../editor/edit-stack/masks'
import type { Mask, SubjectMask } from '../editor/edit-stack/types'

/** A guide with one hard vertical edge: dark on the left, bright on the right. */
function edgeGuide(size: number, at = size / 2): Float32Array {
  const g = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) g[y * size + x] = x < at ? 0.1 : 0.9
  return g
}

describe('boxBlur', () => {
  it('leaves a flat field flat', () => {
    const src = new Float32Array(16 * 16).fill(0.25)
    const out = boxBlur(src, 16, 16, 3)
    for (const v of out) expect(v).toBeCloseTo(0.25, 6)
  })

  /**
   * Normalised by the window that fits, not by its nominal size — otherwise
   * every edge of the image darkens towards zero, and the guided filter reads
   * that as an edge that is not there.
   */
  it('does not darken the borders', () => {
    const src = new Float32Array(9 * 9).fill(1)
    const out = boxBlur(src, 9, 9, 2)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(out[8]).toBeCloseTo(1, 6)
    expect(out[out.length - 1]).toBeCloseTo(1, 6)
  })

  it('averages a single spike over its window', () => {
    const src = new Float32Array(9 * 9)
    src[4 * 9 + 4] = 1
    const out = boxBlur(src, 9, 9, 1)
    // A 3×3 window fully inside the image, so the spike is spread over nine.
    expect(out[4 * 9 + 4]).toBeCloseTo(1 / 9, 6)
    // And nothing is lost — the total is preserved.
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4)
  })
})

describe('resample', () => {
  it('holds a constant map at any size', () => {
    const src = new Uint8ClampedArray(8 * 8).fill(128)
    const out = resample(src, 8, 32)
    for (const v of out) expect(v).toBeCloseTo(128 / 255, 3)
  })

  it('returns 0..1, not 0..255', () => {
    const src = new Uint8ClampedArray(4 * 4).fill(255)
    const out = resample(src, 4, 8)
    expect(Math.max(...out)).toBeCloseTo(1, 6)
  })

  it('keeps the two ends of a ramp at the two ends', () => {
    const n = 8
    const src = new Uint8ClampedArray(n * n)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) src[y * n + x] = Math.round((x / (n - 1)) * 255)
    const out = resample(src, n, 32)
    expect(out[0]).toBeLessThan(0.1)
    expect(out[31]).toBeGreaterThan(0.9)
  })
})

describe('guidedFilter', () => {
  /**
   * The whole point. A coverage map that crosses an edge in the wrong place
   * should be pulled onto the edge the picture actually has — which is how a
   * 320px map ends up following branches it never resolved.
   */
  it('snaps a misplaced boundary onto the edge in the guide', () => {
    const size = 64
    const guide = edgeGuide(size, 32)

    // Input steps over at 40, eight pixels past where the picture changes.
    const input = new Float32Array(size * size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) input[y * size + x] = x < 40 ? 0 : 1

    const out = guidedFilter(guide, input, size, size, 8, 1e-6)

    const row = 32 * size
    // Well inside the dark side it is still off, and inside the bright side on.
    expect(out[row + 8]).toBeLessThan(0.25)
    expect(out[row + 56]).toBeGreaterThan(0.75)
    // And the crossing has moved back towards the guide's edge at 32.
    let crossing = -1
    for (let x = 1; x < size; x++) {
      if (out[row + x - 1] < 0.5 && out[row + x] >= 0.5) { crossing = x; break }
    }
    expect(crossing).toBeGreaterThan(0)
    expect(Math.abs(crossing - 32)).toBeLessThan(Math.abs(40 - 32))
  })

  it('leaves a constant map alone whatever the guide does', () => {
    const size = 32
    const input = new Float32Array(size * size).fill(0.6)
    const out = guidedFilter(edgeGuide(size), input, size, size, 4, 1e-4)
    for (const v of out) expect(v).toBeCloseTo(0.6, 3)
  })

  it('never leaves the 0..1 range', () => {
    const size = 32
    const guide = edgeGuide(size)
    const input = new Float32Array(size * size)
    for (let i = 0; i < input.length; i++) input[i] = i % 7 === 0 ? 1 : 0
    const out = guidedFilter(guide, input, size, size, 6, 1e-6)
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('refineMask', () => {
  it('returns bytes at the guide-s resolution, not the detector-s', () => {
    const coarse = new Uint8ClampedArray(16 * 16).fill(200)
    const out = refineMask(coarse, 16, new Float32Array(64 * 64).fill(0.5), 64)

    expect(out).toBeInstanceOf(Uint8ClampedArray)
    expect(out.length).toBe(64 * 64)
  })

  it('carries a uniform map through unchanged', () => {
    const coarse = new Uint8ClampedArray(16 * 16).fill(255)
    const out = refineMask(coarse, 16, new Float32Array(64 * 64).fill(0.3), 64)
    for (const v of out) expect(v).toBeGreaterThan(250)
  })

  it('finds the picture-s edge from a map that is far too soft for it', () => {
    const size = 64
    const guide = edgeGuide(size, 32)

    // What a low-resolution detector actually hands over: a gradual ramp
    // instead of the hard boundary the photograph has.
    const coarse = new Uint8ClampedArray(16 * 16)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) coarse[y * 16 + x] = Math.round(Math.min(1, Math.max(0, (x - 4) / 8)) * 255)
    }

    const out = refineMask(coarse, 16, guide, size)
    const row = 32 * size
    // The ramp becomes a step, and it lands on the edge rather than beside it.
    expect(out[row + 4]).toBeLessThan(90)
    expect(out[row + 60]).toBeGreaterThan(165)
    expect(out[row + 60] - out[row + 4]).toBeGreaterThan(90)
  })
})

/**
 * Channel order. `packMasks` assigns a texture channel by position among the
 * subject masks, and the renderer writes the maps into the atlas in the order
 * this returns them — so if the two ever disagree, an adjustment lands on
 * another mask's subject.
 */
describe('subjectMapsFor', () => {
  const map = (v: number) => ({ data: new Uint8ClampedArray(4).fill(v), size: 2 })
  const subject = () => createMask('subject', 1) as SubjectMask

  /*
   * What the viewport gets is the *refined* map, made in a worker there is
   * none of here, so these can only check the shape of the answer and that
   * the model's own answer is filed under the right photo. The refinement
   * itself is tested on `refineMask` above.
   */
  it('returns one entry per subject mask, in list order', () => {
    forgetSubjects()
    const a = subject()
    const b = subject()
    const masks: Mask[] = [createMask('radial', 1), a, createMask('colour', 1), b]
    // Two subject masks in, two slots out — the radial and colour take none.
    expect(subjectMapsFor(masks, 'frame-1')).toHaveLength(2)
  })

  it('gives null for a subject not yet found, rather than shifting the rest along', () => {
    forgetSubjects()
    const masks = [subject(), subject()]
    const maps = subjectMapsFor(masks, 'frame-2')

    expect(maps).toHaveLength(2)
    expect(maps[0]).toBeNull()
    expect(maps[1]).toBeNull()
  })

  it('has nothing to say about a photo that is not open', () => {
    expect(subjectMapsFor([subject()], null)).toEqual([null])
  })

  it('does not hand one photo-s subject to another', () => {
    forgetSubjects()
    const a = subject()
    rememberSubject('frame-a', a.model, map(200), false)

    expect(cachedSubject('frame-a', a.model)).not.toBeNull()
    expect(cachedSubject('frame-b', a.model)).toBeNull()
  })

  it('forgets one photo without forgetting the others', () => {
    forgetSubjects()
    const a = subject()
    rememberSubject('keep', a.model, map(1), false)
    rememberSubject('drop', a.model, map(1), false)

    forgetSubjects('drop')
    expect(cachedSubject('keep', a.model)).not.toBeNull()
    expect(cachedSubject('drop', a.model)).toBeNull()
  })
})

describe('edgeOptions', () => {
  it('lands on the constants at the default, so an untouched mask is unchanged', () => {
    const at = edgeOptions(50, 0)
    expect(at.radius).toBe(REFINE_RADIUS)
    expect(at.eps).toBeCloseTo(REFINE_EPS, 10)
    expect(at.shift).toBe(0)
  })

  it('follows finer structure as detail rises: smaller window, less tolerance', () => {
    const lo = edgeOptions(0, 0)
    const mid = edgeOptions(50, 0)
    const hi = edgeOptions(100, 0)
    expect(lo.radius).toBeGreaterThan(mid.radius)
    expect(mid.radius).toBeGreaterThan(hi.radius)
    expect(lo.eps).toBeGreaterThan(mid.eps)
    expect(mid.eps).toBeGreaterThan(hi.eps)
    expect(hi.radius).toBeGreaterThanOrEqual(1)
  })

  it('reaches the full shift at a hundred, in either direction', () => {
    expect(edgeOptions(50, 100).shift).toBe(MAX_EDGE_SHIFT)
    expect(edgeOptions(50, -100).shift).toBe(-MAX_EDGE_SHIFT)
    expect(edgeOptions(50, 50).shift).toBe(MAX_EDGE_SHIFT / 2)
  })

  it('shrugs off a value that is not a number', () => {
    const o = edgeOptions(Number.NaN, Number.NaN)
    expect(o.radius).toBe(REFINE_RADIUS)
    expect(o.shift).toBe(0)
  })
})

describe('shiftEdge', () => {
  /** A 4×4 block of coverage in the middle of a 16×16 field. */
  const block = () => {
    const m = new Float32Array(16 * 16)
    for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) m[y * 16 + x] = 1
    return m
  }
  const covered = (m: Float32Array) => m.reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0)

  it('grows the region by the radius on every side', () => {
    const out = shiftEdge(block(), 16, 16, 2)
    // 4 wide + 2 either side = 8, squared.
    expect(covered(out)).toBe(64)
  })

  it('shrinks it likewise', () => {
    const out = shiftEdge(block(), 16, 16, -1)
    expect(covered(out)).toBe(4)
  })

  it('does nothing at zero, and hands back the very same array', () => {
    const src = block()
    expect(shiftEdge(src, 16, 16, 0)).toBe(src)
  })

  it('keeps a soft edge soft rather than cutting it', () => {
    const m = new Float32Array(16 * 16)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) m[y * 16 + x] = x / 15
    const out = shiftEdge(m, 16, 16, 3)
    // Every value is still one the input had; nothing has been thresholded.
    for (const v of out) expect(m.includes(v)).toBe(true)
    // And a ramp shifted outward is the same ramp, three pixels earlier.
    expect(out[8 * 16 + 4]).toBeCloseTo(m[8 * 16 + 7], 6)
  })
})

describe('refineMask with an edge shift', () => {
  const size = 32
  const coarseSize = 8
  /** Coarse coverage on the right half, matching the guide's bright half. */
  const coarse = () => {
    const c = new Uint8ClampedArray(coarseSize * coarseSize)
    for (let y = 0; y < coarseSize; y++) for (let x = coarseSize / 2; x < coarseSize; x++) c[y * coarseSize + x] = 255
    return c
  }
  const covered = (m: Uint8ClampedArray) => m.reduce((n, v) => n + (v > 127 ? 1 : 0), 0)

  it('covers more when grown and less when shrunk, and the same at zero', () => {
    const guide = edgeGuide(size)
    const base = refineMask(coarse(), coarseSize, guide, size, edgeOptions(50, 0))
    const grown = refineMask(coarse(), coarseSize, guide, size, edgeOptions(50, 100))
    const shrunk = refineMask(coarse(), coarseSize, guide, size, edgeOptions(50, -100))
    const untouched = refineMask(coarse(), coarseSize, guide, size)
    expect(covered(grown)).toBeGreaterThan(covered(base))
    expect(covered(shrunk)).toBeLessThan(covered(base))
    expect(Array.from(untouched)).toEqual(Array.from(base))
  })
})
