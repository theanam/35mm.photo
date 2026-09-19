import { describe, expect, it } from 'vitest'
import { buildExifHeic, buildExifTiff } from './exif-fixture'
import { findExifExtent, isIsobmff, tiffOffsetInPayload } from './isobmff'
import { HEADER_BYTES, readOrientation } from './exif'
import { readExifSections, readShotInfo, type ExifSection } from './exif-tags'
import { extensionOf, isHeifFile, isRawFile, isSupportedFile } from './formats'

const viewOf = async (blob: Blob, bytes = HEADER_BYTES) =>
  new DataView(await blob.slice(0, bytes).arrayBuffer())

const flat = (sections: ExifSection[]) =>
  Object.fromEntries(sections.flatMap((s) => s.entries.map((e) => [e.label, e.value])))

describe('isIsobmff', () => {
  it('recognises the brand box', async () => {
    expect(isIsobmff(await viewOf(buildExifHeic()))).toBe(true)
  })

  it('does not mistake a JPEG or a short buffer for one', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0])])
    expect(isIsobmff(await viewOf(jpeg))).toBe(false)
    expect(isIsobmff(new DataView(new ArrayBuffer(4)))).toBe(false)
  })
})

describe('findExifExtent', () => {
  it('locates the item the meta box declares', async () => {
    const heic = buildExifHeic()
    const extent = findExifExtent(await viewOf(heic))

    expect(extent).not.toBeNull()
    // Four bytes of stated header offset, then the block itself.
    expect(extent!.length).toBe(buildExifTiff().length + 4)
    expect(extent!.offset).toBeGreaterThan(0)
    expect(extent!.offset + extent!.length).toBeLessThanOrEqual(heic.size)
  })

  it('reports where the item really is, however deep in the file', async () => {
    const padding = 400 * 1024
    const near = findExifExtent(await viewOf(buildExifHeic()))
    const far = findExifExtent(await viewOf(buildExifHeic({ padding })))

    expect(far!.offset - near!.offset).toBe(padding)
  })

  it('returns null for a container with no EXIF item, and for other formats', async () => {
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])])
    expect(findExifExtent(await viewOf(jpeg))).toBeNull()

    // An ftyp and nothing else: a valid container, no meta box in it.
    const bare = new Blob([new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])])
    expect(findExifExtent(await viewOf(bare))).toBeNull()
  })

  it('does not run off the end of a truncated box tree', async () => {
    const whole = await buildExifHeic().arrayBuffer()
    // Every prefix of a real file, which is what a header window hands over.
    for (let n = 0; n <= whole.byteLength; n += 3) {
      expect(() => findExifExtent(new DataView(whole.slice(0, n)))).not.toThrow()
    }
  })
})

describe('tiffOffsetInPayload', () => {
  const payload = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer)
  const II = [0x49, 0x49, 42, 0]

  it('follows the stated offset', () => {
    expect(tiffOffsetInPayload(payload(0, 0, 0, 0, ...II))).toBe(4)
  })

  it('skips the "Exif\\0\\0" prefix a converter left behind', () => {
    const prefix = [0x45, 0x78, 0x69, 0x66, 0, 0]
    expect(tiffOffsetInPayload(payload(0, 0, 0, 6, ...prefix, ...II))).toBe(10)
  })

  it('finds a block written flat, with no offset field at all', () => {
    expect(tiffOffsetInPayload(payload(...II, 8, 0, 0, 0))).toBe(0)
  })

  it('reads a big-endian block as readily as a little-endian one', () => {
    expect(tiffOffsetInPayload(payload(0, 0, 0, 0, 0x4d, 0x4d, 0, 42))).toBe(4)
  })

  it('gives up rather than guessing when there is no block', () => {
    expect(tiffOffsetInPayload(payload(0, 0, 0, 0, 1, 2, 3, 4))).toBeNull()
    expect(tiffOffsetInPayload(payload(1, 2))).toBeNull()
  })
})

describe('reading EXIF out of a HEIC', () => {
  it('points at the TIFF block inside the file', async () => {
    const heic = buildExifHeic()
    const { tiffStart } = await readOrientation(heic)

    expect(tiffStart).not.toBeNull()
    const mark = new Uint8Array(await heic.slice(tiffStart!, tiffStart! + 2).arrayBuffer())
    expect([...mark]).toEqual([0x49, 0x49])
  })

  it('handles the prefixed payload too', async () => {
    const heic = buildExifHeic({ headerOffset: 6 })
    const { tiffStart } = await readOrientation(heic)

    const mark = new Uint8Array(await heic.slice(tiffStart!, tiffStart! + 2).arrayBuffer())
    expect([...mark]).toEqual([0x49, 0x49])
  })

  it('reads the camera, lens and ISO the phone recorded', async () => {
    const shot = await readShotInfo(buildExifHeic())

    expect(shot.camera).toBe('FUJIFILM X-T3')
    expect(shot.lens).toBe('XF35mmF2 R WR')
    expect(shot.iso).toBe(160)
    expect(shot.shotAt).toBe(Date.parse('2018-09-25T14:54:03'))
  })

  it('fills the same dialog sections a JPEG does', async () => {
    const sections = await readExifSections(buildExifHeic())
    expect(sections.map((s) => s.id)).toEqual(['camera', 'exposure', 'lens', 'place', 'file'])
    expect(flat(sections).Shutter).toBe('1/250 s')
  })

  /**
   * The point of the whole exercise. A phone photo's metadata trails its
   * picture, so the block sits far past any window measured from the start of
   * the file — and a reader anchored there would find nothing at all.
   */
  it('reads a block that sits past the header window', async () => {
    const heic = buildExifHeic({ padding: HEADER_BYTES + 50_000 })
    const { tiffStart } = await readOrientation(heic)

    expect(tiffStart).toBeGreaterThan(HEADER_BYTES)
    expect((await readShotInfo(heic)).camera).toBe('FUJIFILM X-T3')
  })

  /**
   * HEIF puts rotation in an `irot` property, which every decoder applies as
   * it decodes. An EXIF Orientation alongside it is the file repeating itself,
   * and acting on it would turn a photo that is already the right way up.
   */
  it('reports upright however the EXIF block is tagged', async () => {
    for (const orientation of [1, 3, 6, 8]) {
      const heic = buildExifHeic({ orientation })
      expect((await readOrientation(heic)).orientation).toBe(1)
    }

    // The tag is still reported where it is being described rather than obeyed.
    expect(flat(await readExifSections(buildExifHeic({ orientation: 6 }))).Orientation)
      .toBe('Rotated 90° CW')
  })

  it('treats a file with no EXIF item as upright and bare', async () => {
    const bare = new Blob([new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])])
    expect(await readOrientation(bare)).toEqual({ orientation: 1, encoded: null, tiffStart: null })
    expect(await readShotInfo(bare)).toEqual({})
  })
})

describe('the format registry', () => {
  it('opens HEIC, HEIF and Canon HIF', () => {
    for (const name of ['IMG_0001.HEIC', 'photo.heic', 'photo.heif', 'IMG_0002.HIF']) {
      expect(isSupportedFile(name)).toBe(true)
      expect(isHeifFile(name)).toBe(true)
    }
  })

  it('does not send them down the raw pipeline', () => {
    expect(isRawFile('photo.heic')).toBe(false)
    // `.hif` is Canon's HEIF still, and must not be confused with `.tif`.
    expect(extensionOf('IMG.HIF')).toBe('hif')
    expect(isRawFile('IMG.HIF')).toBe(false)
  })

  it('leaves everything else where it was', () => {
    expect(isHeifFile('photo.jpg')).toBe(false)
    expect(isHeifFile('photo.avif')).toBe(false)
    expect(isRawFile('photo.raf')).toBe(true)
  })
})
