import { describe, expect, it } from 'vitest'
import { edgeForHeight, edgeForWidth } from './export-size'
import { exportLayout } from '../editor/gpu/transform'
import { defaultEdits } from '../editor/edit-stack/defaults'

const edits = defaultEdits()
const layoutAt = (w: number, h: number, edge: number) =>
  exportLayout(w, h, edits.crop, edits.frame, edge)

describe('a custom export size', () => {
  it('lands a landscape on the width asked for', () => {
    const edge = edgeForWidth(6000, 4000, 1200)
    expect(layoutAt(6000, 4000, edge).width).toBe(1200)
  })

  it('lands a portrait on the width asked for, through its long edge', () => {
    const edge = edgeForWidth(4000, 6000, 1200)
    expect(edge).toBe(1800)
    expect(layoutAt(4000, 6000, edge).width).toBe(1200)
  })

  it('lands either shape on the height asked for', () => {
    expect(layoutAt(6000, 4000, edgeForHeight(6000, 4000, 800)).height).toBe(800)
    expect(layoutAt(4000, 6000, edgeForHeight(4000, 6000, 900)).height).toBe(900)
  })

  it('never scales up', () => {
    expect(layoutAt(6000, 4000, edgeForWidth(6000, 4000, 9000)).width).toBe(6000)
    expect(layoutAt(6000, 4000, edgeForHeight(6000, 4000, 9000)).height).toBe(4000)
  })

  it('treats nonsense as full size, and a tiny number as one pixel', () => {
    expect(edgeForWidth(6000, 4000, Number.NaN)).toBe(6000)
    expect(edgeForWidth(6000, 4000, 0)).toBe(1)
  })
})
