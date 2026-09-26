import { describe, expect, it } from 'vitest'
import { autoExposure, openingLift } from './auto'
import type { HistogramData } from '../histogram-worker'

/** A histogram with every pixel at one level, plus the bookkeeping. */
function flat(level: number, count = 1000): HistogramData {
  const bins = () => {
    const b = new Uint32Array(256)
    b[level] = count
    return b
  }
  return { r: bins(), g: bins(), b: bins(), luma: bins(), clippedShadows: 0, clippedHighlights: 0 }
}

describe('autoExposure', () => {
  it('lifts a dark frame toward a touch below middle grey', () => {
    // Median at 0.25: one stop short of 0.5, and 0.45 is a little under that.
    const stops = autoExposure(flat(64))
    expect(stops).toBeGreaterThan(0.7)
    expect(stops).toBeLessThan(0.9)
  })

  it('pulls a bright frame down', () => {
    expect(autoExposure(flat(200))).toBeLessThan(-0.5)
  })

  it('leaves a frame already there alone', () => {
    expect(Math.abs(autoExposure(flat(Math.round(0.45 * 255))))).toBeLessThan(0.02)
  })

  it('never reaches past two stops either way', () => {
    expect(autoExposure(flat(8))).toBe(2)
    expect(autoExposure(flat(250))).toBeGreaterThanOrEqual(-2)
  })

  it('has nothing to say about a black, white or empty frame', () => {
    expect(autoExposure(flat(0))).toBe(0)
    expect(autoExposure(flat(255))).toBe(0)
    expect(autoExposure(flat(64, 0))).toBe(0)
  })
})

describe('openingLift', () => {
  /** Most pixels at `level`, with a few percent of highlights at `bright`. */
  function scene(level: number, bright = 240, brightShare = 0.02): HistogramData {
    const h = flat(level, 10000)
    const n = Math.round(10000 * brightShare)
    h.luma[level] -= n
    h.luma[bright] += n
    return h
  }

  it('goes halfway to the target, and never past a stop', () => {
    // Median 0.28: the full auto would say +0.68; this says half of that.
    const usual = openingLift(scene(72))
    expect(usual.exposure).toBeGreaterThan(0.3)
    expect(usual.exposure).toBeLessThan(0.4)
    // A night scene at a median of 0.06 wants +2.9 by the full rule.
    expect(openingLift(scene(15)).exposure).toBe(1)
  })

  it('never darkens', () => {
    expect(openingLift(scene(160))).toEqual({})
    expect(openingLift(scene(Math.round(0.45 * 255)))).toEqual({})
  })

  it('recovers the highlights the lift would push past white', () => {
    // Two percent of the frame at 240 goes past 255 under a stop of lift.
    const night = openingLift(scene(15, 240, 0.02))
    expect(night.highlights).toBeLessThan(0)
    // Nothing near the top, nothing to recover.
    const flatDark = openingLift(scene(15, 100, 0.02))
    expect(flatDark.highlights).toBeUndefined()
  })

  it('has nothing to say about an empty or pinned frame', () => {
    expect(openingLift(flat(64, 0))).toEqual({})
    expect(openingLift(flat(0))).toEqual({})
  })
})
