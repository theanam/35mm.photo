import { describe, expect, it } from 'vitest'
import { defaultEdits } from './defaults'
import { createMask } from './masks'
import { DEFAULT_SYNC_GROUPS, SYNC_GROUPS, applySyncScope, resetSyncScope } from './sync'
import type { EditState } from './types'

/**
 * A mask with a fixed id. `createMask` mints a fresh one per call, and `edited()`
 * is called once for the source and again for the expectation — two random ids
 * would fail a comparison that is meant to be about syncing.
 */
const FIXTURE_MASK = { ...createMask('radial', 1.5), id: 'fixture-mask' }

/**
 * A source photo with *every* field away from its default.
 *
 * Every field, not one per group, because the coverage test below compares the
 * synced result against this — and a field left at its default matches the
 * default target whether it synced or not, so it would assert nothing while
 * appearing to. The last test in this file keeps that promise honest.
 */
function edited(): EditState {
  const e = defaultEdits()
  e.temperature = 7200
  e.tint = 15
  e.exposure = 1.25
  e.contrast = 30
  e.highlights = -40
  e.shadows = 25
  e.whites = 10
  e.blacks = -15
  e.vibrance = 20
  e.saturation = -10
  e.dynamicRange = 45
  e.curves.rgb = [{ x: 0, y: 0.1 }, { x: 1, y: 1 }]
  e.hsl.red = { hue: 10, sat: -20, lum: 5 }
  e.colorGrade.shadows = { hue: 210, sat: 30, lum: 0 }
  e.perspective.vertical = 40
  e.lens.distortion = -25
  e.clarity = 18
  e.texture = 22
  e.dehaze = 12
  e.sharpen = 35
  e.denoiseLuma = 20
  e.denoiseChroma = 30
  e.halation = 35
  e.grain = 40
  e.grainSize = 70
  e.vignette = -30
  e.look = { id: 'chrome', strength: 80 }
  e.crop = { ...e.crop, x: 0.1, y: 0.2, w: 0.5, h: 0.5, angle: 3 }
  // Four different widths, so a side that syncs into the wrong slot shows up.
  e.frame = { top: 6, right: 3, bottom: 12, left: 4, color: '#101010', link: 'free' }
  e.raw = { ...e.raw, draft: !e.raw.draft }
  e.masks = [structuredClone(FIXTURE_MASK)]
  return e
}

describe('applySyncScope', () => {
  it('copies nothing when no groups are chosen', () => {
    const target = defaultEdits()
    expect(applySyncScope(target, edited(), [])).toEqual(target)
  })

  it('copies only the chosen group', () => {
    const out = applySyncScope(defaultEdits(), edited(), ['light'])
    expect(out.exposure).toBe(1.25)
    expect(out.contrast).toBe(30)
    // Not chosen, so untouched.
    expect(out.temperature).toBe(defaultEdits().temperature)
    expect(out.look.id).toBeNull()
    expect(out.crop.w).toBe(1)
  })

  it('leaves the crop alone by default, which is the whole point', () => {
    const target = defaultEdits()
    target.crop = { ...target.crop, x: 0.4, w: 0.3 }
    const out = applySyncScope(target, edited(), DEFAULT_SYNC_GROUPS)
    expect(out.crop.x).toBe(0.4)
    expect(out.crop.w).toBe(0.3)
    // Everything else did come across.
    expect(out.exposure).toBe(1.25)
    expect(out.look.id).toBe('chrome')
  })

  it('copies the crop when explicitly asked', () => {
    const out = applySyncScope(defaultEdits(), edited(), ['crop'])
    expect(out.crop.w).toBe(0.5)
    expect(out.crop.angle).toBe(3)
  })

  it('carries white balance separately from the rest of light', () => {
    const wb = applySyncScope(defaultEdits(), edited(), ['whiteBalance'])
    expect(wb.temperature).toBe(7200)
    expect(wb.exposure).toBe(0)

    const light = applySyncScope(defaultEdits(), edited(), ['light'])
    expect(light.temperature).toBe(defaultEdits().temperature)
    expect(light.exposure).toBe(1.25)
  })

  it('deep-copies, so editing one photo cannot reach into another', () => {
    const source = edited()
    const a = applySyncScope(defaultEdits(), source, SYNC_GROUPS)
    const b = applySyncScope(defaultEdits(), source, SYNC_GROUPS)

    a.hsl.red.hue = 99
    a.curves.rgb[0].y = 0.9
    a.colorGrade.shadows.sat = 1
    a.crop.x = 0.7

    expect(b.hsl.red.hue).toBe(10)
    expect(b.curves.rgb[0].y).toBeCloseTo(0.1, 6)
    expect(b.colorGrade.shadows.sat).toBe(30)
    expect(source.hsl.red.hue).toBe(10)
    expect(source.crop.x).toBe(0.1)
  })

  it('reproduces the source exactly when every group is chosen', () => {
    expect(applySyncScope(defaultEdits(), edited(), SYNC_GROUPS)).toEqual(edited())
  })

  it('covers every field of EditState across the groups', () => {
    // Guards against a new edit field being added without a home in a group,
    // which would silently never sync.
    const out = applySyncScope(defaultEdits(), edited(), SYNC_GROUPS)
    for (const key of Object.keys(defaultEdits()) as (keyof EditState)[]) {
      expect(out[key], `field "${key}" is in no sync group`).toEqual(edited()[key])
    }
  })

  it('leaves no field of the fixture at its default', () => {
    /*
     * The guard above only bites for fields `edited()` actually changes: a field
     * left at its default matches the default target whether it synced or not,
     * and the assertion passes while proving nothing. This keeps the fixture
     * honest, so adding a field to EditState and forgetting it here fails here
     * rather than silently weakening the test above.
     */
    const base = defaultEdits()
    const source = edited()
    for (const key of Object.keys(base) as (keyof EditState)[]) {
      expect(source[key], `edited() leaves "${key}" at its default`).not.toEqual(base[key])
    }
  })
})

describe('resetSyncScope', () => {
  it('returns the chosen groups to their defaults', () => {
    const out = resetSyncScope(edited(), ['light', 'finish'])
    expect(out.exposure).toBe(0)
    expect(out.contrast).toBe(0)
    expect(out.grain).toBe(0)
    expect(out.halation).toBe(0)
    // Outside the chosen groups, the edit survives.
    expect(out.temperature).toBe(7200)
    expect(out.look.id).toBe('chrome')
  })

  it('clears everything back to default when all groups are chosen', () => {
    expect(resetSyncScope(edited(), SYNC_GROUPS)).toEqual(defaultEdits())
  })
})

describe('sync coverage', () => {
  it('carries every field in the edit state when every group is on', () => {
    // The failure this catches is a new parameter added to EditState and never
    // added to a sync group: it would silently refuse to travel across a batch,
    // and nothing else in the app would notice. Asserting the whole state
    // round-trips means the mapping cannot quietly fall behind the type.
    const target = defaultEdits()
    const source: EditState = {
      ...defaultEdits(),
      exposure: 1.5,
      contrast: 20,
      highlights: -30,
      shadows: 40,
      whites: 10,
      blacks: -10,
      dynamicRange: 55,
      temperature: 7200,
      tint: 12,
      vibrance: 25,
      saturation: -15,
      clarity: 30,
      texture: 20,
      dehaze: 10,
      sharpen: 40,
      denoiseLuma: 15,
      denoiseChroma: 25,
      halation: 30,
      grain: 20,
      grainSize: 70,
      vignette: -25,
      look: { id: 'chrome', strength: 60 },
      raw: { ...defaultEdits().raw, demosaic: 'best', highlights: 'blend' },
      crop: { ...defaultEdits().crop, x: 0.1, y: 0.2, w: 0.5, h: 0.5, angle: 3 },
      perspective: { vertical: 20, horizontal: -10, aspect: 5, scale: 110 },
      lens: { distortion: 15, ca: -8 },
    }

    const synced = applySyncScope(target, source, SYNC_GROUPS)
    expect(synced).toEqual(source)
  })
})
