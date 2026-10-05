import { describe, expect, it } from 'vitest'
import {
  MIN_CROP,
  moveCrop,
  nudgeCrop,
  resizeCrop,
  rotationAngle,
  swapOrientation,
  toggleAspectLock,
} from './crop-drag'
import { STRAIGHTEN_LIMIT } from './horizon'
import type { CropState } from './types'

const box = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }
const free = { ratio: null, fromCentre: false }

const cropOf = (patch: Partial<CropState>): CropState => ({
  x: 0, y: 0, w: 1, h: 1, aspect: 'original', angle: 0, rotate90: 0, flipH: false, flipV: false,
  ...patch,
})

describe('moveCrop', () => {
  it('moves the box against the pointer, so the picture goes with it', () => {
    const out = moveCrop(box, 0.1, -0.05)
    expect(out.x).toBeCloseTo(0.2)
    expect(out.y).toBeCloseTo(0.35)
  })

  it('stops at the edge of the frame', () => {
    expect(moveCrop(box, -0.5, 0.5)).toEqual({ x: 0.6, y: 0 })
  })
})

describe('resizeCrop', () => {
  it('moves only the dragged edge', () => {
    const out = resizeCrop('e', box, 0.1, 0.2, free)
    expect(out).toEqual({ x: 0.3, y: 0.3, w: 0.5, h: 0.4 })
  })

  it('keeps the opposite corner still', () => {
    const out = resizeCrop('nw', box, 0.1, 0.1, free)
    expect(out.x + out.w).toBeCloseTo(0.7)
    expect(out.y + out.h).toBeCloseTo(0.7)
    expect(out.w).toBeCloseTo(0.3)
  })

  it('grows about the centre from a corner with ⌥', () => {
    const out = resizeCrop('se', box, 0.05, 0.05, { ratio: null, fromCentre: true })
    expect(out).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })
  })

  it('never gets smaller than the minimum', () => {
    const out = resizeCrop('e', box, -1, 0, free)
    expect(out.w).toBe(MIN_CROP)
  })

  it('holds a ratio from a corner, driven by the width', () => {
    const out = resizeCrop('se', box, 0.1, 0, { ratio: 2, fromCentre: false })
    expect(out.w).toBeCloseTo(0.5)
    expect(out.h).toBeCloseTo(0.25)
    expect(out.x).toBe(0.3)
    expect(out.y).toBe(0.3)
  })

  it('widens evenly from a side handle under a ratio', () => {
    const out = resizeCrop('s', box, 0, 0.1, { ratio: 1, fromCentre: false })
    expect(out.h).toBeCloseTo(0.5)
    expect(out.w).toBeCloseTo(0.5)
    // Same centre as before along the axis the handle did not touch.
    expect(out.x + out.w / 2).toBeCloseTo(0.5)
  })

  it('lets the axis that runs out of room win under a ratio', () => {
    // Pulling the corner far past the frame: height hits the bottom first.
    const out = resizeCrop('se', box, 1, 1, { ratio: 1, fromCentre: false })
    expect(out.h).toBeCloseTo(0.7)
    expect(out.w).toBeCloseTo(0.7)
    expect(out.x + out.w).toBeLessThanOrEqual(1)
    expect(out.y + out.h).toBeLessThanOrEqual(1)
  })

  it('stays inside the frame when growing from the centre', () => {
    const out = resizeCrop('e', box, 1, 0, { ratio: null, fromCentre: true })
    expect(out.x).toBeGreaterThanOrEqual(0)
    expect(out.x + out.w).toBeLessThanOrEqual(1)
    expect(out.w).toBeCloseTo(1)
  })
})

describe('nudgeCrop', () => {
  it('shifts and clamps', () => {
    expect(nudgeCrop(box, 0.01, 0)).toEqual({ x: 0.31, y: 0.3 })
    expect(nudgeCrop(box, 1, 0)).toEqual({ x: 0.6, y: 0.3 })
  })
})

describe('rotationAngle', () => {
  const centre = { x: 100, y: 100 }

  it('turns clockwise with a clockwise sweep', () => {
    // From the right of the centre to below it: a quarter turn clockwise on
    // screen, clamped to the limit.
    const a = rotationAngle(0, centre, { x: 200, y: 100 }, { x: 100, y: 200 })
    expect(a).toBe(STRAIGHTEN_LIMIT)
    const b = rotationAngle(0, centre, { x: 200, y: 100 }, { x: 200, y: 110 })
    expect(b).toBeCloseTo(5.7, 1)
  })

  it('adds to the angle already set and rounds to a tenth', () => {
    const a = rotationAngle(2, centre, { x: 200, y: 100 }, { x: 200, y: 90 })
    expect(a).toBeCloseTo(-3.7, 1)
    expect(a * 10).toBeCloseTo(Math.round(a * 10))
  })

  it('takes the short way round across the seam', () => {
    const a = rotationAngle(0, centre, { x: 0, y: 101 }, { x: 0, y: 99 })
    expect(Math.abs(a)).toBeLessThan(2)
  })
})

describe('swapOrientation', () => {
  const frame = { width: 3000, height: 2000 }

  it('turns a locked ratio on its side', () => {
    const out = swapOrientation(cropOf({ aspect: '3:2' }), frame)
    expect(out.aspect).toBe('2:3')
  })

  it('turns the whole frame into the largest upright box, centred', () => {
    const out = swapOrientation(cropOf({}), frame)
    expect(out.aspect).toBe('original')
    expect(out.h).toBeCloseTo(1)
    // A 3:2 on its side is a 2:3, and the tallest one here is 1333 × 2000.
    expect(out.w).toBeCloseTo(4 / 9)
    expect(out.x).toBeCloseTo(5 / 18)
    expect(out.y).toBeCloseTo(0)
  })

  it('keeps the centre of a small box', () => {
    const out = swapOrientation(cropOf({ aspect: 'free', x: 0.1, y: 0.3, w: 0.3, h: 0.2 }), frame)
    expect(out.x! + out.w! / 2).toBeCloseTo(0.25)
    expect(out.y! + out.h! / 2).toBeCloseTo(0.4)
    // 900 × 400 px becomes 400 × 900 px.
    expect(out.w).toBeCloseTo(400 / 3000)
    expect(out.h).toBeCloseTo(900 / 2000)
  })

  it('holds a box inside the frame when its new shape would not fit', () => {
    const out = swapOrientation(cropOf({ aspect: 'free', x: 0.1, y: 0.05, w: 0.3, h: 0.2 }), frame)
    expect(out.y).toBe(0)
    expect(out.y! + out.h!).toBeLessThanOrEqual(1)
  })
})

describe('toggleAspectLock', () => {
  const frame = { width: 3000, height: 2000 }

  it('frees a locked box', () => {
    expect(toggleAspectLock(cropOf({ aspect: '16:9' }), frame)).toEqual({ aspect: 'free' })
  })

  it('locks a free box to the shape it has, in lowest terms', () => {
    expect(toggleAspectLock(cropOf({ aspect: 'free', w: 0.5, h: 0.5 }), frame)).toEqual({ aspect: '3:2' })
    expect(toggleAspectLock(cropOf({}), frame)).toEqual({ aspect: '3:2' })
  })
})
