import { describe, expect, it } from 'vitest'
import { IDENTITY_LENS, type LensUniforms } from '../lens/uniforms'
import { contentToDrawn, drawnToContent, offsetToUpright, strokeToStored } from './geometry'
import type { RetouchStroke } from '../editor/edit-stack/types'

const stroke = (patch: Partial<RetouchStroke> = {}): RetouchStroke => ({
  id: 's',
  enabled: true,
  mode: 'heal',
  points: [0.25, 0.5],
  size: 0.01,
  feather: 50,
  dx: 0.1,
  dy: 0,
  ...patch,
})

describe('strokeToStored', () => {
  it('lands on the same pixels whichever way the file is stored', () => {
    // A 400×300 upright picture, stored as-is and stored turned for EXIF 6.
    const upright = strokeToStored(stroke(), { orientation: 1, storedWidth: 400, storedHeight: 300 })
    expect(upright.points).toEqual([100, 150])
    expect(upright.radius).toBe(3)
    expect(upright.dx).toBe(40)
    expect(upright.dy).toBe(0)

    // Orientation 6 stores the picture a quarter turn anticlockwise: upright
    // (u, v) is stored (v, 1 − u), so moving right upright is moving up stored.
    const turned = strokeToStored(stroke(), { orientation: 6, storedWidth: 300, storedHeight: 400 })
    expect(turned.points[0]).toBeCloseTo(150)
    expect(turned.points[1]).toBeCloseTo(300)
    expect(turned.dx).toBe(0)
    expect(turned.dy).toBe(-40)
  })

  it('brings a stored offset back to the same upright one', () => {
    const picture = { orientation: 6 as const, storedWidth: 300, storedHeight: 400 }
    const { dx, dy } = offsetToUpright([0.25, 0.5], 0, -40, picture)
    expect(dx).toBeCloseTo(0.1)
    expect(dy).toBeCloseTo(0)
  })
})

describe('drawnToContent', () => {
  const picture = { orientation: 1 as const, storedWidth: 600, storedHeight: 400 }
  const barrel: LensUniforms = { ...IDENTITY_LENS, distK: [0, -0.04, 0, 0.01], zoom: 1.03 }

  it('is the identity without a lens correction', () => {
    expect(drawnToContent(0.1, 0.9, IDENTITY_LENS, picture)).toEqual([0.1, 0.9])
  })

  it('moves a corner by the correction, and comes back out where it went in', () => {
    const content = drawnToContent(0.05, 0.08, barrel, picture)
    expect(Math.hypot(content[0] - 0.05, content[1] - 0.08)).toBeGreaterThan(0.005)
    const back = contentToDrawn(content[0], content[1], barrel, picture)
    expect(back[0]).toBeCloseTo(0.05, 5)
    expect(back[1]).toBeCloseTo(0.08, 5)
  })
})
