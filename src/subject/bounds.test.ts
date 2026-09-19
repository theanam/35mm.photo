import { describe, expect, it } from 'vitest'
import { fitAspect, subjectBounds, type Bounds } from './bounds'
import type { SubjectMap } from './detect'

/** A map with one solid rectangle of coverage, given in pixel coordinates. */
function withBox(size: number, bx: number, by: number, bw: number, bh: number, v = 255): SubjectMap {
  const data = new Uint8ClampedArray(size * size)
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) data[y * size + x] = v
  }
  return { data, size }
}

const near = (b: Bounds, want: Bounds, tol = 0.02) => {
  expect(Math.abs(b.x - want.x)).toBeLessThan(tol)
  expect(Math.abs(b.y - want.y)).toBeLessThan(tol)
  expect(Math.abs(b.w - want.w)).toBeLessThan(tol)
  expect(Math.abs(b.h - want.h)).toBeLessThan(tol)
}

describe('subjectBounds', () => {
  it('finds a solid block, in uv', () => {
    // A quarter-frame block at the centre, with no margin so the numbers are
    // the block's own.
    const b = subjectBounds(withBox(100, 25, 25, 50, 50), { margin: 0 })!
    near(b, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })

  it('adds breathing room, centred on the subject', () => {
    const tight = subjectBounds(withBox(100, 40, 40, 20, 20), { margin: 0 })!
    const loose = subjectBounds(withBox(100, 40, 40, 20, 20), { margin: 0.25 })!

    expect(loose.w).toBeGreaterThan(tight.w)
    // The centre does not move.
    expect(loose.x + loose.w / 2).toBeCloseTo(tight.x + tight.w / 2, 5)
    expect(loose.y + loose.h / 2).toBeCloseTo(tight.y + tight.h / 2, 5)
  })

  /**
   * The reason this works on mass rather than a threshold. One faint pixel in
   * a corner is exactly what a soft coverage map produces, and a box drawn
   * around every non-zero pixel would be the whole frame.
   */
  it('is not dragged to the corner by a stray pixel', () => {
    const map = withBox(100, 40, 40, 20, 20)
    map.data[2 * 100 + 2] = 40 // a faint speck, far away

    const b = subjectBounds(map, { margin: 0 })!
    near(b, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 })
  })

  it('keeps a subject that is genuinely spread out', () => {
    // Two solid blocks at opposite corners: both are real coverage, so the box
    // has to hold both rather than picking one.
    const map = withBox(100, 10, 10, 20, 20)
    for (let y = 70; y < 90; y++) for (let x = 70; x < 90; x++) map.data[y * 100 + x] = 255

    const b = subjectBounds(map, { margin: 0 })!
    expect(b.x).toBeLessThan(0.15)
    expect(b.y).toBeLessThan(0.15)
    expect(b.x + b.w).toBeGreaterThan(0.85)
    expect(b.y + b.h).toBeGreaterThan(0.85)
  })

  it('declines when there is nothing worth cropping to', () => {
    expect(subjectBounds({ data: new Uint8ClampedArray(100 * 100), size: 100 })).toBeNull()
    // A handful of faint pixels is not a subject.
    expect(subjectBounds(withBox(100, 50, 50, 3, 3, 30))).toBeNull()
  })

  it('never leaves the frame, however wide the margin', () => {
    const b = subjectBounds(withBox(100, 0, 0, 100, 100), { margin: 0.5 })!
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9)
    expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('handles a subject against the edge without spilling', () => {
    const b = subjectBounds(withBox(100, 0, 40, 20, 20), { margin: 0.2 })!
    expect(b.x).toBe(0)
    expect(b.w).toBeGreaterThan(0.2)
  })
})

describe('fitAspect', () => {
  it('grows a tall box out to a wide ratio', () => {
    const b = fitAspect({ x: 0.4, y: 0.35, w: 0.2, h: 0.3 }, 2)
    expect(b.w / b.h).toBeCloseTo(2, 3)
    // Grown, not cut: the height is untouched and the width comes up to it.
    expect(b.h).toBeCloseTo(0.3, 3)
    expect(b.w).toBeCloseTo(0.6, 3)
  })

  it('grows a wide box out to a tall ratio', () => {
    const b = fitAspect({ x: 0.3, y: 0.45, w: 0.4, h: 0.1 }, 0.5)
    expect(b.w / b.h).toBeCloseTo(0.5, 3)
    expect(b.w).toBeCloseTo(0.4, 3)
    expect(b.h).toBeCloseTo(0.8, 3)
  })

  it('keeps the centre where it was', () => {
    const before = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }
    const after = fitAspect(before, 1.5)
    expect(after.x + after.w / 2).toBeCloseTo(0.4, 3)
    expect(after.y + after.h / 2).toBeCloseTo(0.4, 3)
  })

  /** A ratio cannot be honoured outside the frame, so the size gives way. */
  it('gives up size rather than ratio at the edge', () => {
    const b = fitAspect({ x: 0, y: 0.1, w: 0.9, h: 0.8 }, 3)
    expect(b.w / b.h).toBeCloseTo(3, 2)
    expect(b.w).toBeLessThanOrEqual(1 + 1e-9)
    expect(b.h).toBeLessThanOrEqual(1 + 1e-9)
    expect(b.x).toBeGreaterThanOrEqual(0)
  })

  it('leaves a box alone when it already matches, and ignores nonsense', () => {
    const square = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    near(fitAspect(square, 1), square, 1e-6)
    expect(fitAspect(square, 0)).toEqual(square)
    expect(fitAspect(square, NaN)).toEqual(square)
  })
})
