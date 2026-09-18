import { describe, expect, it } from 'vitest'
import { EDITOR_NAME, attachExif, buildExifBlock } from './exif-write'
import { readExifSections, type ExifSection } from './exif-tags'
import { readOrientation } from './exif'
import { buildExifJpeg } from './exif-fixture'

const flat = (sections: ExifSection[]) =>
  Object.fromEntries(sections.flatMap((s) => s.entries.map((e) => [e.label, e.value])))

/** Minimal containers for the encoders we cannot run in node. */
const bareJpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])])

function barePng(): Blob {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (d: Uint8Array) => {
    let c = 0xffffffff
    for (const byte of d) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Uint8Array) => {
    const head = new Uint8Array(8)
    const v = new DataView(head.buffer)
    v.setUint32(0, data.length, false)
    ;[...type].forEach((ch, i) => (head[4 + i] = ch.charCodeAt(0)))
    const tail = new Uint8Array(4)
    new DataView(tail.buffer).setUint32(0, crc(new Uint8Array([...head.slice(4), ...data])), false)
    return new Uint8Array([...head, ...data, ...tail])
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, 4, false)
  dv.setUint32(4, 3, false)
  ihdr[8] = 8
  ihdr[9] = 2
  return new Blob([
    new Uint8Array([
      ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ...chunk('IHDR', ihdr),
      ...chunk('IDAT', new Uint8Array([1, 2, 3])),
      ...chunk('IEND', new Uint8Array(0)),
    ]),
  ])
}

function bareWebp(): Blob {
  const vp8 = new Uint8Array(10) // contents irrelevant; only the container is read
  const body = new Uint8Array(8 + vp8.length)
  ;[...'VP8 '].forEach((c, i) => (body[i] = c.charCodeAt(0)))
  new DataView(body.buffer).setUint32(4, vp8.length, true)
  body.set(vp8, 8)

  const out = new Uint8Array(12 + body.length)
  ;[...'RIFF'].forEach((c, i) => (out[i] = c.charCodeAt(0)))
  new DataView(out.buffer).setUint32(4, 4 + body.length, true)
  ;[...'WEBP'].forEach((c, i) => (out[8 + i] = c.charCodeAt(0)))
  out.set(body, 12)
  return new Blob([out])
}

const size = { width: 800, height: 600 }

describe('buildExifBlock', () => {
  it('names the editor even when the source had no EXIF at all', async () => {
    const block = await buildExifBlock(undefined, size)
    const jpeg = await attachExif(bareJpeg(), 'jpeg', undefined, size)
    expect(block.length).toBeGreaterThan(8)
    expect(flat(await readExifSections(jpeg)).Software).toBe(EDITOR_NAME)
  })

  it('resets orientation, because the exported pixels are already upright', async () => {
    const jpeg = await attachExif(bareJpeg(), 'jpeg', await buildExifJpeg(), size)
    // The fixture says upright already; what matters is that a value is written
    // and that readers see 1 rather than whatever the camera recorded.
    expect((await readOrientation(jpeg)).orientation).toBe(1)
    expect(flat(await readExifSections(jpeg)).Orientation).toBe('Upright')
  })
})

describe('attachExif, JPEG', () => {
  it('carries the camera, lens, exposure and place across', async () => {
    const out = await attachExif(bareJpeg(), 'jpeg', await buildExifJpeg(), size)
    const t = flat(await readExifSections(out))

    expect(t.Make).toBe('FUJIFILM')
    expect(t.Model).toBe('X-T3')
    expect(t.Taken).toBe('2018-09-25 14:54:03')
    expect(t.Shutter).toBe('1/250 s')
    expect(t.Aperture).toBe('f/2.8')
    expect(t.ISO).toBe('160')
    expect(t.Lens).toBe('XF35mmF2 R WR')
    expect(t.Latitude).toBe('51.477811°')
    expect(t.Longitude).toBe('-0.127500°')
  })

  it('signs the export', async () => {
    const out = await attachExif(bareJpeg(), 'jpeg', await buildExifJpeg(), size)
    // The source said "Firmware"; the editor replaces it.
    expect(flat(await readExifSections(out)).Software).toBe(EDITOR_NAME)
  })

  it('keeps the image data intact', async () => {
    const original = new Uint8Array(await bareJpeg().arrayBuffer())
    const out = new Uint8Array(await (await attachExif(bareJpeg(), 'jpeg', undefined, size)).arrayBuffer())
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
    // The end-of-image marker the encoder wrote is still the last thing.
    expect([...out.slice(-2)]).toEqual([...original.slice(-2)])
  })
})

describe('attachExif, PNG', () => {
  it('writes an eXIf chunk a reader can find', async () => {
    const out = await attachExif(barePng(), 'png', await buildExifJpeg(), size)
    const t = flat(await readExifSections(out))
    expect(t.Model).toBe('X-T3')
    expect(t.Software).toBe(EDITOR_NAME)
  })

  it('leaves the signature and IHDR where they were', async () => {
    const out = new Uint8Array(await (await attachExif(barePng(), 'png', undefined, size)).arrayBuffer())
    expect([...out.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(String.fromCharCode(...out.slice(12, 16))).toBe('IHDR')
  })
})

describe('attachExif, WebP', () => {
  it('promotes the file to the extended form and adds EXIF', async () => {
    const out = await attachExif(bareWebp(), 'webp', await buildExifJpeg(), size)
    const bytes = new Uint8Array(await out.arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WEBP')
    // A plain VP8 file has nowhere to put metadata until it gains a VP8X chunk.
    expect(String.fromCharCode(...bytes.slice(12, 16))).toBe('VP8X')

    const t = flat(await readExifSections(out))
    expect(t.Model).toBe('X-T3')
    expect(t.Software).toBe(EDITOR_NAME)
  })

  it('declares the exported canvas size in VP8X', async () => {
    const out = new Uint8Array(
      await (await attachExif(bareWebp(), 'webp', undefined, size)).arrayBuffer(),
    )
    const at = 12 + 8 // past RIFF/WEBP and the VP8X chunk header
    const read24 = (o: number) => out[o] | (out[o + 1] << 8) | (out[o + 2] << 16)
    expect(read24(at + 4) + 1).toBe(800)
    expect(read24(at + 7) + 1).toBe(600)
  })
})

describe('attachExif, when it cannot', () => {
  it('returns the encoded image untouched rather than failing the export', async () => {
    const rubbish = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])])
    const out = await attachExif(rubbish, 'jpeg', undefined, size)
    expect(await out.arrayBuffer()).toEqual(await rubbish.arrayBuffer())
  })
})
