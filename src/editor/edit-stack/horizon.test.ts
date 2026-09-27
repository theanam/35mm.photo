import { describe, expect, it } from 'vitest'
import { horizonAngle } from './horizon'

const at = (deg: number, len = 200) => {
  const r = (deg * Math.PI) / 180
  return [Math.cos(r) * len, Math.sin(r) * len] as const
}

describe('horizonAngle', () => {
  it('leaves a level line level', () => {
    expect(horizonAngle(0, 300, 0)).toBe(0)
  })

  it('turns against a horizon that dips to the right', () => {
    // Right end lower (y down): the picture is turned clockwise; undo it.
    expect(horizonAngle(0, ...at(3))).toBe(-3)
    expect(horizonAngle(0, ...at(-2.5))).toBe(2.5)
  })

  it('does not care which end was drawn first', () => {
    expect(horizonAngle(0, ...at(183))).toBe(-3)
    expect(horizonAngle(0, ...at(-177))).toBe(-3)
  })

  it('measures from the angle already applied', () => {
    // Shown already turned by +2, still 1° off: the total is +1.
    expect(horizonAngle(2, ...at(1))).toBe(1)
  })

  it('makes a near-vertical line plumb', () => {
    // Bottom leaning right is a counter-clockwise lean; turn clockwise.
    expect(horizonAngle(0, ...at(85))).toBe(5)
    expect(horizonAngle(0, ...at(95))).toBe(-5)
    expect(horizonAngle(0, ...at(-85))).toBe(-5)
  })

  it('stops at the slider limit', () => {
    expect(horizonAngle(0, ...at(30))).toBe(-15)
    expect(horizonAngle(10, ...at(-12))).toBe(15)
  })

  it('ignores a slip', () => {
    expect(horizonAngle(4, 5, 3)).toBeNull()
  })
})
