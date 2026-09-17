/**
 * Pixel dimensions straight out of an image header, without decoding it.
 *
 * A dropped `.png` or `.jpg` is ambiguous — it is equally plausibly a photo or
 * a LUT image — and the only honest way to tell them apart is the size. Fully
 * decoding to find that out would mean decoding every photo in a dropped folder
 * before any of them opened, so this reads the few bytes that say so instead.
 *
 * Returns null for anything it does not recognise, which callers should treat
 * as "no opinion" rather than as an answer.
 */

export interface ImageSize {
  width: number
  height: number
}

/** Enough for any header here; JPEG is the only one that can run long. */
const HEAD_BYTES = 256 * 1024

export async function readImageSize(file: Blob): Promise<ImageSize | null> {
  const buffer = await file.slice(0, HEAD_BYTES).arrayBuffer()
  const view = new DataView(buffer)
  if (view.byteLength < 16) return null

  return png(view) ?? webp(view) ?? jpeg(view) ?? gif(view)
}

/** 8-byte signature, then an IHDR chunk whose first two fields are the size. */
function png(view: DataView): ImageSize | null {
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null
  if (view.getUint32(12) !== 0x49484452) return null // 'IHDR'
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * Markers until a start-of-frame, whose payload carries the size. SOF0–SOF15
 * are all frame headers except the three that reuse the range for tables.
 */
function jpeg(view: DataView): ImageSize | null {
  if (view.getUint16(0) !== 0xffd8) return null

  let offset = 2
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset++ // fill byte or padding; resynchronise
      continue
    }
    const marker = view.getUint8(offset + 1)

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return null // scan data; no size seen

    const length = view.getUint16(offset + 2)
    if (length < 2) return null

    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      if (offset + 9 > view.byteLength) return null
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}

/** RIFF container; the size lives in whichever of the three chunks is first. */
function webp(view: DataView): ImageSize | null {
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null
  const chunk = view.getUint32(12)

  // 'VP8 ' — lossy. Past the 3-byte frame tag and the 0x9D012A sync code.
  if (chunk === 0x56503820) {
    if (view.byteLength < 30) return null
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    }
  }
  // 'VP8L' — lossless. 14 bits each, minus one, packed after the 0x2F signature.
  if (chunk === 0x5650384c) {
    if (view.byteLength < 25) return null
    const bits = view.getUint32(21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  // 'VP8X' — extended. Canvas size as two 24-bit values, each minus one.
  if (chunk === 0x56503858) {
    if (view.byteLength < 30) return null
    const read24 = (at: number) =>
      view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16)
    return { width: read24(24) + 1, height: read24(27) + 1 }
  }
  return null
}

function gif(view: DataView): ImageSize | null {
  if (view.getUint32(0) !== 0x47494638) return null // 'GIF8'
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
}
