import { describe, expect, it } from 'vitest'
import { readExifSections, type ExifSection } from './exif-tags'

/* ───────────────── a JPEG with an EXIF block, built here ───────────────── */

import { buildExifJpeg } from './exif-fixture'

const fixture = buildExifJpeg

/** Every entry across every section, keyed by label. */
const flat = (sections: ExifSection[]) =>
  Object.fromEntries(sections.flatMap((s) => s.entries.map((e) => [e.label, e.value])))

describe('readExifSections', () => {
  it('finds the sections a camera fills in', async () => {
    const sections = await readExifSections(fixture())
    expect(sections.map((s) => s.id)).toEqual(['camera', 'exposure', 'lens', 'place', 'file'])
  })

  it('reads the camera and the date', async () => {
    const t = flat(await readExifSections(fixture()))
    expect(t.Make).toBe('FUJIFILM')
    expect(t.Model).toBe('X-T3')
    // EXIF writes the date half with colons; that is not a date anyone reads.
    expect(t.Taken).toBe('2018-09-25 14:54:03')
  })

  it('formats exposure the way a photographer writes it', async () => {
    const t = flat(await readExifSections(fixture()))
    expect(t.Shutter).toBe('1/250 s')
    expect(t.Aperture).toBe('f/2.8')
    expect(t.ISO).toBe('160')
    // A signed rational, and the sign has to survive.
    expect(t['Exposure bias']).toBe('-0.33 EV')
    expect(t.Metering).toBe('Pattern')
  })

  it('reads the lens from the Exif IFD, which is a pointer away from IFD0', async () => {
    const t = flat(await readExifSections(fixture()))
    expect(t.Lens).toBe('XF35mmF2 R WR')
    expect(t['Focal length']).toBe('35 mm')
    expect(t['35mm equivalent']).toBe('53 mm')
  })

  it('turns GPS degrees-minutes-seconds into a signed decimal', async () => {
    const t = flat(await readExifSections(fixture()))
    // 51°28'40.12" N
    expect(t.Latitude).toBe('51.477811°')
    // 0°7'39.00" W — west of the meridian, so negative.
    expect(t.Longitude).toBe('-0.127500°')
    expect(t.Altitude).toBe('120 m')
  })

  it('reads IFD0 strings that live out on the heap', async () => {
    const t = flat(await readExifSections(fixture()))
    expect(t.Software).toBe('Firmware')
    expect(t.Copyright).toBe('(c) Me')
    expect(t['Colour space']).toBe('sRGB')
  })
})

describe('readExifSections, without usable input', () => {
  it('returns nothing for a file with no EXIF block', async () => {
    // A bare JPEG: start of image, then end of image.
    const bare = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])])
    expect(await readExifSections(bare)).toEqual([])
  })

  it('returns nothing rather than throwing on rubbish', async () => {
    expect(await readExifSections(new Blob([new Uint8Array(64)]))).toEqual([])
  })
})
