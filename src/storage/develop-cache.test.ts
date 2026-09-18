import { describe, expect, it } from 'vitest'
import { MAX_DEVELOPS, developEvictionPlan } from './indexeddb'

const record = (key: string, usedAt: number, bytes = 10) => ({ key, bytes, usedAt })

describe('developEvictionPlan', () => {
  it('keeps everything while under both limits', () => {
    const records = [record('a', 3), record('b', 2), record('c', 1)]
    expect(developEvictionPlan(records)).toEqual([])
  })

  it('drops the least recently used first', () => {
    const records = Array.from({ length: MAX_DEVELOPS + 3 }, (_, i) => record(`k${i}`, i))
    // usedAt ascending, so k0..k2 are the oldest three.
    expect(developEvictionPlan(records).sort()).toEqual(['k0', 'k1', 'k2'])
  })

  it('bounds total bytes as well as count', () => {
    const records = [record('new', 3, 400), record('mid', 2, 400), record('old', 1, 400)]
    expect(developEvictionPlan(records, null, { maxBytes: 900 })).toEqual(['old'])
  })

  it('never evicts the entry just written, even when it alone busts the budget', () => {
    // A 100 MP frame on a machine with a small budget: dropping the thing we
    // were asked to store would mean caching nothing, forever, silently.
    const records = [record('huge', 5, 10_000), record('small', 4, 10)]
    const plan = developEvictionPlan(records, 'huge', { maxBytes: 100 })
    expect(plan).not.toContain('huge')
    expect(plan).toContain('small')
  })

  it('counts the protected entry against the budget for everything else', () => {
    const records = [record('keep', 1, 90), record('other', 9, 90)]
    const plan = developEvictionPlan(records, 'keep', { maxBytes: 100 })
    expect(plan).toEqual(['other'])
  })

  it('treats an empty cache as nothing to do', () => {
    expect(developEvictionPlan([])).toEqual([])
    expect(developEvictionPlan([], 'missing')).toEqual([])
  })
})
