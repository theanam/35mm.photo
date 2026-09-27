import { describe, expect, it } from 'vitest'
import { buildExifJpeg } from './exif-fixture'
import { readShotInfo } from './exif-tags'
import { readOrientation } from './exif'

/**
 * A RAF is a Fujifilm header with an ordinary JPEG inside it; the header says
 * where. Wrapping the JPEG fixture the same way must read back the same EXIF.
 */
async function buildRaf(jpeg: Blob, at = 160): Promise<Blob> {
  const head = new Uint8Array(at)
  head.set(new TextEncoder().encode('FUJIFILMCCD-RAW 0201FF383030'))
  new DataView(head.buffer).setUint32(84, at)
  return new Blob([head, await jpeg.arrayBuffer()])
}

describe('a Fujifilm RAF', () => {
  it('yields the EXIF of the JPEG it carries', async () => {
    const jpeg = buildExifJpeg()
    const raf = await buildRaf(jpeg)
    const fromJpeg = await readShotInfo(jpeg)
    const fromRaf = await readShotInfo(raf)
    expect(Object.keys(fromJpeg).length).toBeGreaterThan(0)
    expect(fromRaf).toEqual(fromJpeg)
  })

  it('points at the TIFF block inside the file, not inside the JPEG', async () => {
    const jpeg = buildExifJpeg()
    const raf = await buildRaf(jpeg, 200)
    const inJpeg = (await readOrientation(jpeg)).tiffStart
    const inRaf = (await readOrientation(raf)).tiffStart
    expect(inJpeg).not.toBeNull()
    expect(inRaf).toBe((inJpeg ?? 0) + 200)
  })

  it('is treated as upright by the orientation reader, and unreadable when the offset lies', async () => {
    const bad = await buildRaf(new Blob([new Uint8Array(4)]))
    expect((await readOrientation(bad)).tiffStart).toBeNull()
  })
})
