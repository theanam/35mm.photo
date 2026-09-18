import { describe, expect, it } from 'vitest'
import { formatAspect, parseAspectRatio } from './aspect'

describe('parseAspectRatio', () => {
  it('reads the presets', () => {
    expect(parseAspectRatio('3:2')).toBeCloseTo(1.5, 6)
    expect(parseAspectRatio('1:1')).toBe(1)
    expect(parseAspectRatio('4:5')).toBeCloseTo(0.8, 6)
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9, 6)
  })

  it('reads a ratio nobody registered in advance', () => {
    expect(parseAspectRatio('7:5')).toBeCloseTo(1.4, 6)
    expect(parseAspectRatio('2.39:1')).toBeCloseTo(2.39, 6)
    expect(parseAspectRatio('65:24')).toBeCloseTo(65 / 24, 6)
  })

  it('treats the unlocked ids as no ratio at all', () => {
    expect(parseAspectRatio('original')).toBeNull()
    expect(parseAspectRatio('free')).toBeNull()
    expect(parseAspectRatio(null)).toBeNull()
    expect(parseAspectRatio(undefined)).toBeNull()
  })

  it('refuses anything that is not a ratio', () => {
    for (const bad of ['', '3:', ':2', '3:0', '0:2', '-3:2', 'abc', '3:2:1', '3x2']) {
      expect(parseAspectRatio(bad), bad).toBeNull()
    }
  })

  it('ignores surrounding space', () => {
    expect(parseAspectRatio('  16:9 ')).toBeCloseTo(16 / 9, 6)
  })
})

describe('formatAspect', () => {
  it('round-trips through the parser', () => {
    for (const [w, h] of [[3, 2], [16, 9], [2.39, 1], [65, 24]]) {
      expect(parseAspectRatio(formatAspect(w, h))).toBeCloseTo(w / h, 5)
    }
  })

  it('does not write trailing zeroes', () => {
    expect(formatAspect(3, 2)).toBe('3:2')
    expect(formatAspect(2.5, 1)).toBe('2.5:1')
  })
})
