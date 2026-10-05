import { describe, expect, it } from 'vitest'
import { CROP_GUIDES, guideTurns, nextGuide } from './crop-guides'

describe('crop guides', () => {
  it('cycle in order and wrap', () => {
    expect(nextGuide('thirds')).toBe('golden')
    expect(nextGuide('none')).toBe('thirds')
    expect(nextGuide('thirds', -1)).toBe('none')
  })

  it('visit every guide once around', () => {
    const seen = new Set<string>()
    let g = CROP_GUIDES[0].id
    for (let i = 0; i < CROP_GUIDES.length; i++) {
      seen.add(g)
      g = nextGuide(g)
    }
    expect(seen.size).toBe(CROP_GUIDES.length)
  })

  it('only let the asymmetric guides turn', () => {
    expect(guideTurns('thirds')).toBe(1)
    expect(guideTurns('triangle')).toBe(2)
    expect(guideTurns('spiral')).toBe(4)
  })
})
