import { describe, expect, it } from 'vitest'
import { orderFrames } from './strip-order'
import type { Frame } from '../editor/edit-stack/types'

const frame = (name: string, over: Partial<Frame['meta']> = {}, extra: Partial<Frame> = {}): Frame => ({
  id: name,
  meta: { name, ext: 'jpg', isRaw: false, width: 1, height: 1, orientation: 1, bytes: 1, ...over },
  ...extra,
})

const DAY = 24 * 3600 * 1000
const noon = (day: number) => new Date(2026, 8, day, 12).valueOf()

const FRAMES: Frame[] = [
  frame('DSC10.ARW', { camera: 'Sony ILCE-7C', lens: 'FE 85mm f/1.4 GM', shotAt: noon(3) }, { editCount: 2 }),
  frame('DSC9.ARW', { camera: 'Sony ILCE-7C', lens: 'FE 24-70mm f/2.8 GM', shotAt: noon(1) }),
  frame('DSCF1.RAF', { camera: 'Fujifilm X-T50', lens: 'XF23mmF1.4 R', shotAt: noon(3) + 3600e3 }, { editCount: 5 }),
  frame('IMG_2.jpg', {}, { modifiedAt: noon(2) }),
]

const names = (frames: Frame[]) => frames.map((f) => f.meta.name)

describe('ordering the strip', () => {
  it('sorts names the way a person reads numbers', () => {
    const [only] = orderFrames(FRAMES, { sort: 'name', descending: false, group: 'none' })
    expect(only.label).toBeNull()
    expect(names(only.frames)).toEqual(['DSC9.ARW', 'DSC10.ARW', 'DSCF1.RAF', 'IMG_2.jpg'])
  })

  it('sorts by date, falling back to the file\'s own date, and reverses on request', () => {
    const up = orderFrames(FRAMES, { sort: 'date', descending: false, group: 'none' })[0]
    expect(names(up.frames)).toEqual(['DSC9.ARW', 'IMG_2.jpg', 'DSC10.ARW', 'DSCF1.RAF'])
    const down = orderFrames(FRAMES, { sort: 'date', descending: true, group: 'none' })[0]
    expect(names(down.frames)).toEqual(['DSCF1.RAF', 'DSC10.ARW', 'IMG_2.jpg', 'DSC9.ARW'])
  })

  it('puts the most edited first', () => {
    const [only] = orderFrames(FRAMES, { sort: 'edited', descending: false, group: 'none' })
    expect(names(only.frames).slice(0, 2)).toEqual(['DSCF1.RAF', 'DSC10.ARW'])
  })

  it('groups by lens with the unknowns last', () => {
    const sections = orderFrames(FRAMES, { sort: 'name', descending: false, group: 'lens' })
    expect(sections.map((s) => s.label)).toEqual(['FE 24-70mm f/2.8 GM', 'FE 85mm f/1.4 GM', 'XF23mmF1.4 R', '—'])
    expect(names(sections[3].frames)).toEqual(['IMG_2.jpg'])
  })

  it('groups by camera', () => {
    const sections = orderFrames(FRAMES, { sort: 'name', descending: false, group: 'camera' })
    expect(sections.map((s) => s.frames.length)).toEqual([1, 2, 1])
    expect(sections[0].label).toBe('Fujifilm X-T50')
  })

  it('groups by day in date order, two shots on one day together', () => {
    const sections = orderFrames(FRAMES, { sort: 'date', descending: false, group: 'day' })
    expect(sections.map((s) => s.frames.length)).toEqual([1, 1, 2])
    expect(names(sections[2].frames)).toEqual(['DSC10.ARW', 'DSCF1.RAF'])
    const newest = orderFrames(FRAMES, { sort: 'date', descending: true, group: 'day' })
    expect(names(newest[0].frames)).toEqual(['DSCF1.RAF', 'DSC10.ARW'])
  })

  it('does not split one camera over two spellings', () => {
    const mixed = [
      frame('a.ARW', { camera: 'Sony ILCE-7C' }),
      frame('b.ARW', { camera: 'SONY ILCE-7C' }),
    ]
    const sections = orderFrames(mixed, { sort: 'name', descending: false, group: 'camera' })
    expect(sections).toHaveLength(1)
    expect(sections[0].frames).toHaveLength(2)
  })

  it('keeps every photo exactly once whatever the grouping', () => {
    for (const group of ['none', 'camera', 'lens', 'day'] as const) {
      const all = orderFrames(FRAMES, { sort: 'date', descending: true, group }).flatMap((s) => s.frames)
      expect(all.map((f) => f.id).sort()).toEqual(FRAMES.map((f) => f.id).sort())
    }
    void DAY
  })
})
