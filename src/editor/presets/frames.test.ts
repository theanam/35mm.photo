import { describe, expect, it } from 'vitest'
import { frameLayout } from '../gpu/transform'
import { FRAME_PRESETS, FRAME_PRESETS_BY_ID, resolveFramePreset } from './frames'

/**
 * The padding presets are rules rather than widths, so the thing to check is
 * the shape they leave the whole picture in — for a photo of either
 * orientation, with the margin still there once the padding is added.
 */

const preset = (id: string) => {
  const p = FRAME_PRESETS_BY_ID.get(id)
  if (!p) throw new Error(`no frame preset "${id}"`)
  return p
}

const LANDSCAPE = { width: 3000, height: 2000 }
const PORTRAIT = { width: 2000, height: 3000 }

function shapeOf(id: string, photo: { width: number; height: number }) {
  const layout = frameLayout(photo.width, photo.height, resolveFramePreset(preset(id), photo))
  return layout.width / layout.height
}

describe('padding presets', () => {
  it('bring a landscape and a portrait to the same shape', () => {
    for (const [id, ratio] of [
      ['square', 1],
      ['four-five', 4 / 5],
      ['story', 9 / 16],
      ['screen', 16 / 9],
    ] as const) {
      expect(shapeOf(id, LANDSCAPE)).toBeCloseTo(ratio, 2)
      expect(shapeOf(id, PORTRAIT)).toBeCloseTo(ratio, 2)
    }
  })

  it('keep the margin on the sides the padding did not touch', () => {
    // A landscape padded to a story gets its padding above and below, and the
    // border on the left and right is the preset's own margin, untouched.
    const story = resolveFramePreset(preset('story'), LANDSCAPE)
    expect(story.left).toBe(5)
    expect(story.right).toBe(5)
    expect(story.top).toBeGreaterThan(50)
    expect(story.top).toBe(story.bottom)
  })

  it('pad a portrait to a story on the top and bottom only when it is too wide', () => {
    // 2:3 is wider than 9:16, so it too gets height, but far less of it.
    const story = resolveFramePreset(preset('story'), PORTRAIT)
    expect(story.left).toBe(5)
    expect(story.top).toBeGreaterThan(5)
    expect(story.top).toBeLessThan(30)
  })

  it('put a portrait on a screen with black at the sides and nothing else', () => {
    const screen = resolveFramePreset(preset('screen'), PORTRAIT)
    expect(screen.top).toBe(0)
    expect(screen.bottom).toBe(0)
    expect(screen.left).toBeGreaterThan(50)
    expect(screen.left).toBe(screen.right)
    expect(screen.color).toBe('#000000')
  })

  it('come back as free, percentage widths', () => {
    const p = resolveFramePreset(preset('four-five'), LANDSCAPE)
    expect(p.link).toBe('free')
    expect(p.unit).toBe('percent')
  })

  it('leave a fixed preset exactly as written', () => {
    const print = preset('print')
    expect(resolveFramePreset(print, LANDSCAPE)).toBe(print.frame)
  })

  it('do nothing dangerous with no picture to measure', () => {
    const p = resolveFramePreset(preset('story'), { width: 0, height: 0 })
    for (const v of [p.top, p.right, p.bottom, p.left]) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('the preset list', () => {
  it('has no two presets that resolve to the same mat on a 3:2 photo', () => {
    const seen = new Set<string>()
    for (const p of FRAME_PRESETS) {
      const f = resolveFramePreset(p, LANDSCAPE)
      const key = [f.top, f.right, f.bottom, f.left, f.color].join('/')
      expect(seen.has(key), `${p.id} duplicates another preset`).toBe(false)
      seen.add(key)
    }
  })
})
