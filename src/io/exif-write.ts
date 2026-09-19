import { HEADER_BYTES, readOrientation } from './exif'

/**
 * Carrying EXIF across an export.
 *
 * A canvas writes pixels and nothing else, so every export used to drop the
 * camera, lens, exposure, capture date and location that the original file
 * carried. This reads the source's EXIF block, rebuilds it, and splices it into
 * the encoded output.
 *
 * Rebuilt rather than copied: every offset inside a TIFF block is measured from
 * the block's own start, so a block cannot simply be moved. The entries are
 * read out, the ones that would now be wrong are corrected, and the whole thing
 * is written again with fresh offsets.
 *
 * Two things are deliberately dropped. **IFD1** holds the camera's embedded
 * thumbnail, which is a picture of the unedited photo — keeping it would mean
 * shipping a preview that disagrees with the image. **Orientation** is reset to
 * upright, because the render graph has already applied it; leaving the
 * original value would have viewers rotate a photo that is already the right
 * way up.
 */

export const EDITOR_NAME = '35mm.photo'

const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
}

const TAG = {
  orientation: 0x0112,
  software: 0x0131,
  exifPointer: 0x8769,
  gpsPointer: 0x8825,
  pixelX: 0xa002,
  pixelY: 0xa003,
} as const

interface Entry {
  tag: number
  type: number
  count: number
  /** The value exactly as it was stored, inline or from the heap. */
  data: Uint8Array
}

/* ─────────────────────────────── reading ─────────────────────────────── */

function readEntries(view: DataView, start: number, at: number, little: boolean): Entry[] {
  const out: Entry[] = []
  if (at + 2 > view.byteLength) return out

  const count = view.getUint16(at, little)
  for (let i = 0; i < count; i++) {
    const p = at + 2 + i * 12
    if (p + 12 > view.byteLength) break

    const tag = view.getUint16(p, little)
    const type = view.getUint16(p + 2, little)
    const n = view.getUint32(p + 4, little)
    const size = (TYPE_SIZE[type] ?? 0) * n
    if (!size) continue

    const from = size <= 4 ? p + 8 : start + view.getUint32(p + 8, little)
    if (from + size > view.byteLength) continue

    out.push({
      tag,
      type,
      count: n,
      data: new Uint8Array(view.buffer, view.byteOffset + from, size).slice(),
    })
  }
  return out
}

/* ─────────────────────────────── writing ─────────────────────────────── */

const u16 = (v: number, little: boolean) => {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, v, little)
  return b
}
const u32 = (v: number, little: boolean) => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v, little)
  return b
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const ifdBytes = (n: number) => 2 + n * 12 + 4

/**
 * Serialise one IFD. Values over four bytes go on a heap whose position the
 * caller has already fixed, because the entries must name it before it exists.
 */
function writeIfd(entries: Entry[], heapAt: number, nextIfd: number, little: boolean) {
  const body: Uint8Array[] = [u16(entries.length, little)]
  const heap: Uint8Array[] = []
  let cursor = heapAt

  for (const e of entries) {
    let value: Uint8Array
    if (e.data.length <= 4) {
      value = concat([e.data, new Uint8Array(4 - e.data.length)])
    } else {
      value = u32(cursor, little)
      heap.push(e.data)
      cursor += e.data.length
      // TIFF values start on an even boundary.
      if (e.data.length % 2) {
        heap.push(new Uint8Array(1))
        cursor += 1
      }
    }
    body.push(u16(e.tag, little), u16(e.type, little), u32(e.count, little), value)
  }

  body.push(u32(nextIfd, little))
  return { body: concat(body), heap: concat(heap) }
}

const ascii = (s: string) => new Uint8Array([...[...s].map((c) => c.charCodeAt(0)), 0])

function setEntry(entries: Entry[], tag: number, type: number, count: number, data: Uint8Array) {
  const at = entries.findIndex((e) => e.tag === tag)
  const entry: Entry = { tag, type, count, data }
  if (at === -1) entries.push(entry)
  else entries[at] = entry
}

export interface ExifOptions {
  /** Dimensions of the exported image, which the original tags no longer match. */
  width: number
  height: number
}

/**
 * Build the TIFF block to embed: the source's own, corrected, or a minimal one
 * naming the editor when the source had none.
 */
export async function buildExifBlock(
  source: Blob | undefined,
  options: ExifOptions,
): Promise<Uint8Array> {
  const little = true
  let ifd0: Entry[] = []
  let exif: Entry[] = []
  let gps: Entry[] = []

  if (source) {
    try {
      const { tiffStart } = await readOrientation(source)
      if (tiffStart != null) {
        // Anchored at the block rather than at the start of the file, for the
        // reason `readIfds` gives: a HEIC keeps its EXIF as an item that can
        // sit past any window measured from zero, and an export that dropped
        // the camera and the GPS fix on the floor would be a quiet loss.
        const view = new DataView(
          await source.slice(tiffStart, tiffStart + HEADER_BYTES).arrayBuffer(),
        )
        const order = view.getUint16(0)
        const srcLittle = order === 0x4949
        if (order === 0x4949 || order === 0x4d4d) {
          const firstIfd = view.getUint32(4, srcLittle)
          ifd0 = readEntries(view, 0, firstIfd, srcLittle)

          const pointer = (tag: number) => {
            const e = ifd0.find((x) => x.tag === tag)
            if (!e || e.data.length < 4) return null
            return new DataView(e.data.buffer, e.data.byteOffset).getUint32(0, srcLittle)
          }
          const exifAt = pointer(TAG.exifPointer)
          const gpsAt = pointer(TAG.gpsPointer)
          if (exifAt) exif = readEntries(view, 0, exifAt, srcLittle)
          if (gpsAt) gps = readEntries(view, 0, gpsAt, srcLittle)

          // A block written big-endian cannot have its values reused verbatim
          // in a little-endian one, so in that case only the structure is kept
          // and the multi-byte values are left behind rather than mangled.
          if (!srcLittle) {
            const keepable = (e: Entry) => e.type === 2 || e.type === 7 || e.type === 1
            ifd0 = ifd0.filter(keepable)
            exif = exif.filter(keepable)
            gps = gps.filter(keepable)
          }
        }
      }
    } catch {
      // A source whose header cannot be read still gets the editor tag below.
      ifd0 = []
      exif = []
      gps = []
    }
  }

  // The pointers are rebuilt from scratch; the old values are meaningless now.
  ifd0 = ifd0.filter((e) => e.tag !== TAG.exifPointer && e.tag !== TAG.gpsPointer)

  setEntry(ifd0, TAG.orientation, 3, 1, u16(1, little))
  setEntry(ifd0, TAG.software, 2, EDITOR_NAME.length + 1, ascii(EDITOR_NAME))
  if (exif.length) {
    setEntry(exif, TAG.pixelX, 4, 1, u32(options.width, little))
    setEntry(exif, TAG.pixelY, 4, 1, u32(options.height, little))
  }

  // Placeholders so IFD0's size is known before the offsets are computed.
  if (exif.length) setEntry(ifd0, TAG.exifPointer, 4, 1, u32(0, little))
  if (gps.length) setEntry(ifd0, TAG.gpsPointer, 4, 1, u32(0, little))

  const header = 8
  const ifd0At = header
  const exifAt = ifd0At + ifdBytes(ifd0.length)
  const gpsAt = exifAt + (exif.length ? ifdBytes(exif.length) : 0)
  const heapAt = gpsAt + (gps.length ? ifdBytes(gps.length) : 0)

  if (exif.length) setEntry(ifd0, TAG.exifPointer, 4, 1, u32(exifAt, little))
  if (gps.length) setEntry(ifd0, TAG.gpsPointer, 4, 1, u32(gpsAt, little))

  // IFD1 is never written: it holds the camera's thumbnail of the unedited
  // photo, so the next IFD pointer is always zero.
  const a = writeIfd(ifd0, heapAt, 0, little)
  const b = exif.length
    ? writeIfd(exif, heapAt + a.heap.length, 0, little)
    : { body: new Uint8Array(0), heap: new Uint8Array(0) }
  const c = gps.length
    ? writeIfd(gps, heapAt + a.heap.length + b.heap.length, 0, little)
    : { body: new Uint8Array(0), heap: new Uint8Array(0) }

  return concat([
    new Uint8Array([0x49, 0x49]),
    u16(42, little),
    u32(ifd0At, little),
    a.body,
    b.body,
    c.body,
    a.heap,
    b.heap,
    c.heap,
  ])
}

/* ───────────────────────────── containers ───────────────────────────── */

/** Put the block into whichever container the encoder produced. */
export async function attachExif(
  encoded: Blob,
  format: 'jpeg' | 'png' | 'webp',
  source: Blob | undefined,
  options: ExifOptions,
): Promise<Blob> {
  try {
    const tiff = await buildExifBlock(source, options)
    const bytes = new Uint8Array(await encoded.arrayBuffer())

    const out =
      format === 'jpeg'
        ? spliceJpeg(bytes, tiff)
        : format === 'png'
          ? splicePng(bytes, tiff)
          : spliceWebp(bytes, tiff, options)

    // Copy into a plain ArrayBuffer: a Uint8Array over a SharedArrayBuffer is
    // not a BlobPart, and the type system cannot tell which one this is.
    return out ? new Blob([out.slice().buffer as ArrayBuffer], { type: encoded.type }) : encoded
  } catch {
    // Metadata is worth having, not worth losing the export over.
    return encoded
  }
}

/** APP1, immediately after the start-of-image marker. */
function spliceJpeg(bytes: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const payload = concat([ascii('Exif'), new Uint8Array([0]), tiff])
  const length = payload.length + 2
  if (length > 0xffff) return null

  const header = new Uint8Array(4)
  header[0] = 0xff
  header[1] = 0xe1
  new DataView(header.buffer).setUint16(2, length, false)
  return concat([bytes.slice(0, 2), header, payload, bytes.slice(2)])
}

/** An eXIf chunk, which must come before the first IDAT. */
function splicePng(bytes: Uint8Array, tiff: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 0x89504e47) return null

  let at = 8
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = view.getUint32(at + 4)
    if (type === 0x49444154) break // IDAT
    at += 12 + length
  }
  if (at + 8 > bytes.length) return null

  const chunk = concat([u32(tiff.length, false), ascii('eXIf').slice(0, 4), tiff])
  const crc = crc32(chunk.slice(4))
  return concat([bytes.slice(0, at), chunk, u32(crc, false), bytes.slice(at)])
}

/**
 * WebP has to be promoted to the extended form first: a plain VP8/VP8L file has
 * nowhere to put metadata, and the EXIF flag lives in a VP8X chunk that a
 * simple encoder does not write.
 */
function spliceWebp(bytes: Uint8Array, tiff: Uint8Array, o: ExifOptions): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null

  const chunks: Uint8Array[] = []
  let at = 12
  let hasVp8x = false
  while (at + 8 <= bytes.length) {
    const fourcc = view.getUint32(at)
    const size = view.getUint32(at + 4, true)
    const end = at + 8 + size + (size % 2)
    if (end > bytes.length) break
    if (fourcc === 0x56503858) hasVp8x = true
    // An existing EXIF chunk is replaced rather than duplicated.
    if (fourcc !== 0x45584946) chunks.push(bytes.slice(at, end))
    at = end
  }
  if (!chunks.length) return null

  const le24 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff])
  const head: Uint8Array[] = []
  if (!hasVp8x) {
    // flags: bit 3 marks EXIF present. Canvas output has no alpha or animation.
    const payload = concat([
      new Uint8Array([0x08, 0, 0, 0]),
      le24(Math.max(o.width - 1, 0)),
      le24(Math.max(o.height - 1, 0)),
    ])
    head.push(ascii('VP8X').slice(0, 4), u32(payload.length, true), payload)
  }

  const exifChunk = concat([
    ascii('EXIF').slice(0, 4),
    u32(tiff.length, true),
    tiff,
    tiff.length % 2 ? new Uint8Array(1) : new Uint8Array(0),
  ])

  const body = concat([...head, ...chunks, exifChunk])
  return concat([ascii('RIFF').slice(0, 4), u32(body.length + 4, true), ascii('WEBP').slice(0, 4), body])
}

/* PNG chunks carry a CRC-32 of their type and data. */
let crcTable: Uint32Array | null = null
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
