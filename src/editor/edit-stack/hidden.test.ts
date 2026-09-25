import { describe, expect, it } from 'vitest'
import { defaultEdits, neutralFrame } from './defaults'
import { buildStack, revealTouched, withHidden } from './summary'

/**
 * A shut eye is a view of the stack, not a write to it: the renderer sees the
 * off state, the panel still sees the value, and touching the control opens
 * the eye again.
 */

const edited = () => {
  const e = defaultEdits()
  e.exposure = 0.7
  e.contrast = 20
  e.frame = { ...neutralFrame(), top: 4, right: 4, bottom: 4, left: 4 }
  return e
}

describe('withHidden', () => {
  it('hands the renderer the off state and leaves the edit alone', () => {
    const edits = edited()
    const drawn = withHidden(edits, ['exposure'], null)
    expect(drawn.exposure).toBe(0)
    expect(drawn.contrast).toBe(20)
    expect(edits.exposure).toBe(0.7)
  })

  it('is the same object when nothing is hidden', () => {
    const edits = edited()
    expect(withHidden(edits, [], null)).toBe(edits)
  })

  it('takes the frame off without touching the crop', () => {
    const edits = edited()
    edits.crop = { ...edits.crop, w: 0.5, h: 0.5 }
    const drawn = withHidden(edits, ['frame'], null)
    expect(drawn.frame.top).toBe(0)
    expect(drawn.crop.w).toBe(0.5)
  })

  it('leaves the ratio lock on a hidden crop', () => {
    const edits = edited()
    edits.crop = { ...edits.crop, w: 0.5, h: 0.5, aspect: '1:1' }
    const drawn = withHidden(edits, ['crop'], null)
    expect(drawn.crop.w).toBe(1)
    expect(drawn.crop.aspect).toBe('1:1')
  })

  it('every chip that can be hidden actually changes something when it is', () => {
    const edits = edited()
    edits.temperature = 4000
    edits.vibrance = 10
    edits.curves.rgb = [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }]
    edits.hsl.red = { hue: 5, sat: 0, lum: 0 }
    edits.colorGrade.shadows = { hue: 200, sat: 20, lum: 0 }
    edits.crop = { ...edits.crop, w: 0.5 }
    edits.lens = { ...edits.lens, distortion: 10 }
    edits.clarity = 10
    edits.grain = 20
    edits.look = { id: 'peach', strength: 100 }
    for (const chip of buildStack(edits, null)) {
      if (!chip.off) continue
      const drawn = withHidden(edits, [chip.id], null)
      expect(JSON.stringify(drawn), `${chip.id} hides nothing`).not.toBe(JSON.stringify(edits))
    }
  })
})

describe('revealTouched', () => {
  it('opens the eye on a chip whose own control was moved', () => {
    const before = edited()
    const after = { ...before, exposure: 1.2 }
    expect(revealTouched(['exposure', 'frame'], before, after, null)).toEqual(['frame'])
  })

  it('keeps the eye shut when something else moved', () => {
    const before = edited()
    const after = { ...before, contrast: 40 }
    expect(revealTouched(['exposure'], before, after, null)).toEqual(['exposure'])
  })

  it('forgets a chip that has left the stack', () => {
    const before = edited()
    const after = { ...before, exposure: 0 }
    expect(revealTouched(['exposure', 'frame'], before, after, null)).toEqual(['frame'])
  })

  it('returns the same array when nothing changed, so nothing re-renders', () => {
    const hidden = ['frame']
    const before = edited()
    expect(revealTouched(hidden, before, { ...before }, null)).toBe(hidden)
  })
})
