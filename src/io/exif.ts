/**
 * EXIF orientation, read straight from the file bytes.
 *
 * Cameras and phones almost always record the sensor readout unrotated and note
 * how to turn it in an EXIF tag. Browsers disagree about whether
 * `createImageBitmap` applies that tag — the spec default changed from "none" to
 * "from-image" partway through — so the only way to get the same result
 * everywhere is to read the tag, ask the decoder explicitly *not* to apply it,
 * and apply it in the render graph.
 */

/** EXIF Orientation, 1–8. 1 is upright; 5–8 also swap width and height. */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface ImageOrientationInfo {
  orientation: Orientation
  /** Dimensions as stored in the file, before any rotation. Null when unknown. */
  encoded: { width: number; height: number } | null
  /**
   * Where the TIFF block begins, for readers that want more than orientation.
   * Finding it is the awkward half of reading EXIF — it hides in a JPEG APP1
   * segment, a PNG eXIf chunk or a WebP EXIF chunk — so having found it once,
   * this hands the offset on rather than making the next reader look again.
   */
  tiffStart: number | null
}

/** Orientations 5–8 exchange the two axes. */
export function swapsAxes(orientation: Orientation): boolean {
  return orientation >= 5
}

/** EXIF lives near the front of a file; no need to read a 50 MB body for it. */
export const HEADER_BYTES = 256 * 1024

export async function readOrientation(file: Blob): Promise<ImageOrientationInfo> {
  const fallback: ImageOrientationInfo = { orientation: 1, encoded: null, tiffStart: null }
  try {
    const buffer = await file.slice(0, HEADER_BYTES).arrayBuffer()
    const view = new DataView(buffer)
    if (view.byteLength < 12) return fallback

    if (view.getUint16(0) === 0xffd8) return readJpeg(view)
    if (view.getUint32(0) === 0x89504e47) return readPng(view)
    if (view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) return readWebp(view)

    // A bare TIFF, which is what most raw files are: ARW, NEF, CR2, DNG and
    // RW2 all open with a byte-order mark and put their EXIF in IFD0 directly,
    // with no container wrapped around it.
    const order = view.getUint16(0)
    if (order === 0x4949 || order === 0x4d4d) {
      return { orientation: readTiff(view, 0) ?? 1, encoded: null, tiffStart: 0 }
    }

    return fallback
  } catch {
    // A malformed header is not worth failing an open over — treat it as upright.
    return fallback
  }
}

/* ───────────────────────────── JPEG ───────────────────────────── */

/** Start-of-frame markers, which carry the encoded dimensions. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function readJpeg(view: DataView): ImageOrientationInfo {
  let orientation: Orientation = 1
  let encoded: { width: number; height: number } | null = null
  let tiffStart: number | null = null
  let offset = 2

  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset++ // resync past fill bytes rather than giving up
      continue
    }
    const marker = view.getUint8(offset + 1)
    offset += 2

    // Standalone markers carry no payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // Start of scan: compressed data follows, nothing more to read here.
    if (marker === 0xda || marker === 0xd9) break

    if (offset + 2 > view.byteLength) break
    const length = view.getUint16(offset)
    if (length < 2) break
    const dataStart = offset + 2
    const dataEnd = offset + length
    if (dataEnd > view.byteLength) break

    if (marker === 0xe1 && dataStart + 6 <= view.byteLength) {
      // "Exif\0\0". First one wins: a file that has been through several tools
      // can carry more than one APP1, and the leading block is the one every
      // decoder reads. Taking the last meant a stale block appended by earlier
      // software quietly replaced the camera's own.
      if (
        tiffStart === null &&
        view.getUint32(dataStart) === 0x45786966 &&
        view.getUint16(dataStart + 4) === 0x0000
      ) {
        tiffStart = dataStart + 6
        orientation = readTiff(view, tiffStart) ?? orientation
      }
    } else if (SOF_MARKERS.has(marker) && dataStart + 5 <= view.byteLength) {
      // precision(1) height(2) width(2)
      encoded = {
        height: view.getUint16(dataStart + 1),
        width: view.getUint16(dataStart + 3),
      }
    }

    offset = dataEnd
  }

  return { orientation, encoded, tiffStart }
}

/* ───────────────────────────── PNG ───────────────────────────── */

function readPng(view: DataView): ImageOrientationInfo {
  let orientation: Orientation = 1
  let encoded: { width: number; height: number } | null = null
  let tiffStart: number | null = null
  let offset = 8

  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset)
    const type = view.getUint32(offset + 4)
    const dataStart = offset + 8
    if (dataStart + length > view.byteLength) break

    if (type === 0x49484452 && length >= 8) {
      // IHDR
      encoded = { width: view.getUint32(dataStart), height: view.getUint32(dataStart + 4) }
    } else if (type === 0x65584966) {
      // eXIf holds a bare TIFF block; the first one wins, as with JPEG.
      if (tiffStart === null) {
        tiffStart = dataStart
        orientation = readTiff(view, dataStart) ?? orientation
      }
    } else if (type === 0x49444154) {
      break // IDAT: pixel data starts, ancillary chunks we care about are behind us
    }

    offset = dataStart + length + 4 // + CRC
  }

  return { orientation, encoded, tiffStart }
}

/* ───────────────────────────── WebP ───────────────────────────── */

function readWebp(view: DataView): ImageOrientationInfo {
  let orientation: Orientation = 1
  let encoded: { width: number; height: number } | null = null
  let found: number | null = null
  let offset = 12

  while (offset + 8 <= view.byteLength) {
    const fourcc = view.getUint32(offset)
    const size = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    if (dataStart + size > view.byteLength) break

    if (fourcc === 0x56503858 && size >= 10) {
      // VP8X: canvas size is stored minus one, 24-bit little-endian
      encoded = {
        width: readUint24LE(view, dataStart + 4) + 1,
        height: readUint24LE(view, dataStart + 7) + 1,
      }
    } else if (fourcc === 0x45584946) {
      // EXIF chunk, occasionally with the JPEG-style prefix still attached
      let tiffStart = dataStart
      if (
        dataStart + 6 <= view.byteLength &&
        view.getUint32(dataStart) === 0x45786966 &&
        view.getUint16(dataStart + 4) === 0x0000
      ) {
        tiffStart = dataStart + 6
      }
      if (found === null) {
        found = tiffStart
        orientation = readTiff(view, tiffStart) ?? orientation
      }
    }

    // RIFF chunks are padded to an even length.
    offset = dataStart + size + (size % 2)
  }

  return { orientation, encoded, tiffStart: found }
}

function readUint24LE(view: DataView, offset: number): number {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16)
}

/* ───────────────────────────── TIFF/IFD ───────────────────────────── */

const ORIENTATION_TAG = 0x0112

/** Walk IFD0 of a TIFF block for the Orientation tag. */
function readTiff(view: DataView, start: number): Orientation | null {
  if (start + 8 > view.byteLength) return null

  const byteOrder = view.getUint16(start)
  let littleEndian: boolean
  if (byteOrder === 0x4949) littleEndian = true
  else if (byteOrder === 0x4d4d) littleEndian = false
  else return null

  // 42 is TIFF's own; Panasonic writes 0x55 in an RW2 and is otherwise a TIFF.
  const magic = view.getUint16(start + 2, littleEndian)
  if (magic !== 0x002a && magic !== 0x0055) return null

  const ifdOffset = view.getUint32(start + 4, littleEndian)
  const ifd = start + ifdOffset
  if (ifd + 2 > view.byteLength) return null

  const count = view.getUint16(ifd, littleEndian)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) break

    if (view.getUint16(entry, littleEndian) !== ORIENTATION_TAG) continue

    // A SHORT value sits in the first two bytes of the value field.
    const type = view.getUint16(entry + 2, littleEndian)
    const value = type === 3 ? view.getUint16(entry + 8, littleEndian) : view.getUint32(entry + 8, littleEndian)
    return value >= 1 && value <= 8 ? (value as Orientation) : null
  }

  return null
}
