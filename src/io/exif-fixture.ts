/**
 * A JPEG carrying a full EXIF block, built byte by byte.
 *
 * Shared by the reader and writer suites. Built rather than checked in: a
 * fixture that states exactly what it contains is easier to trust than a photo
 * with something already inside it, and it keeps a binary out of the tree.
 */

type Entry = [tag: number, type: number, count: number, payload: Uint8Array | number]

const u16 = (v: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b }
const u32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b }
const rational = (n: number, d: number) => new Uint8Array([...u32(n), ...u32(d)])
const signedRational = (n: number, d: number) => {
  const b = new Uint8Array(8)
  const v = new DataView(b.buffer)
  v.setInt32(0, n, true)
  v.setInt32(4, d, true)
  return b
}
const ascii = (s: string) => new Uint8Array([...[...s].map((c) => c.charCodeAt(0)), 0])
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** One IFD, with anything over four bytes placed on a shared heap. */
function buildIfd(entries: Entry[], heapBase: number) {
  const body: Uint8Array[] = [u16(entries.length)]
  const heap: Uint8Array[] = []
  let heapAt = heapBase

  for (const [tag, type, count, payload] of entries) {
    const value =
      typeof payload === 'number'
        ? u32(payload)
        : payload.length <= 4
          ? concat([payload, new Uint8Array(4 - payload.length)])
          : u32(heapAt)
    if (typeof payload !== 'number' && payload.length > 4) {
      heap.push(payload)
      heapAt += payload.length
    }
    body.push(u16(tag), u16(type), u32(count), value)
  }
  return { body: concat(body), heap: concat(heap) }
}

const ifdSize = (n: number) => 2 + n * 12 + 4

export function buildExifJpeg(): Blob {
  const ifd0: Entry[] = [
    [0x010f, 2, 9, ascii('FUJIFILM')],
    [0x0110, 2, 5, ascii('X-T3')],
    [0x0112, 3, 1, 1],
    [0x0131, 2, 9, ascii('Firmware')],
    [0x8298, 2, 7, ascii('(c) Me')],
  ]
  const exif: Entry[] = [
    [0x829a, 5, 1, rational(1, 250)],
    [0x829d, 5, 1, rational(28, 10)],
    [0x8827, 3, 1, 160],
    [0x9003, 2, 20, ascii('2018:09:25 14:54:03')],
    [0x9204, 10, 1, signedRational(-1, 3)],
    [0x9207, 3, 1, 5],
    [0x920a, 5, 1, rational(35, 1)],
    [0xa405, 3, 1, 53],
    [0xa434, 2, 14, ascii('XF35mmF2 R WR')],
    [0xa001, 3, 1, 1],
  ]
  const gps: Entry[] = [
    [1, 2, 2, ascii('N')],
    [2, 5, 3, concat([rational(51, 1), rational(28, 1), rational(4012, 100)])],
    [3, 2, 2, ascii('W')],
    [4, 5, 3, concat([rational(0, 1), rational(7, 1), rational(3900, 100)])],
    [6, 5, 1, rational(120, 1)],
  ]

  // Offsets are measured from the start of the TIFF block, so they have to be
  // known before the IFDs are written.
  const ifd0At = 8
  const exifAt = ifd0At + ifdSize(ifd0.length + 2)
  const gpsAt = exifAt + ifdSize(exif.length)
  const heapAt = gpsAt + ifdSize(gps.length)

  const full: Entry[] = [...ifd0, [0x8769, 4, 1, exifAt], [0x8825, 4, 1, gpsAt]]
  const a = buildIfd(full, heapAt)
  const b = buildIfd(exif, heapAt + a.heap.length)
  const c = buildIfd(gps, heapAt + a.heap.length + b.heap.length)

  const tiff = concat([
    new Uint8Array([0x49, 0x49]), u16(42), u32(8),
    a.body, u32(0), b.body, u32(0), c.body, u32(0),
    a.heap, b.heap, c.heap,
  ])

  const app1 = concat([ascii('Exif'), new Uint8Array([0]), tiff])
  const length = new Uint8Array(2)
  new DataView(length.buffer).setUint16(0, app1.length + 2, false)

  // Start of image, the APP1 segment, end of image. No pixels: the reader
  // never looks at them, and a fixture that states only what it is testing is
  // easier to trust than a photo with something already inside it.
  return new Blob([concat([
    new Uint8Array([0xff, 0xd8]),
    new Uint8Array([0xff, 0xe1]), length, app1,
    new Uint8Array([0xff, 0xd9]),
  ])])
}

