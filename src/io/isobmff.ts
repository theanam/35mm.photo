/**
 * The ISO base media box tree, as far as finding an EXIF block in it.
 *
 * HEIC, HEIF and AVIF are all the same container — a tree of length-prefixed
 * boxes — and none of them keeps EXIF where `exif.ts` knows to look. There is
 * no segment at the front of the file: the metadata is an *item*, listed in a
 * `meta` box by id and then located by a second box that gives its byte range,
 * which may be anywhere in the file including behind the picture.
 *
 * So this module answers one question — where does the TIFF block start — and
 * hands the offset to the reader that already exists. Nothing here parses EXIF
 * itself.
 *
 *     ftyp
 *     meta
 *      ├── iinf ──→ infe: item 5 is of type 'Exif'
 *      ├── iloc ──→ item 5 lives at byte 3021, for 812 bytes
 *      └── idat     (occasionally the bytes are in here instead)
 *     mdat ──────→ ... the Exif payload, then the picture
 */

/** A box header, resolved to absolute offsets in the buffer it was read from. */
export interface Box {
  type: string
  /** First byte of the box, its own header included. */
  start: number
  /** First byte of the payload, past the size, type and any 64-bit escape. */
  body: number
  /** One past the last byte of the box. */
  end: number
}

/** A byte range in the file, resolved from a `meta` box. */
export interface Extent {
  offset: number
  length: number
}

function fourcc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  )
}

/** `....ftyp` — the brand box every one of these containers opens with. */
export function isIsobmff(view: DataView): boolean {
  return view.byteLength >= 12 && fourcc(view, 4) === 'ftyp'
}

/**
 * Walk the boxes between two offsets.
 *
 * A box is size(4) type(4), with two escapes: a size of 1 means the real,
 * 64-bit size follows the type, and a size of 0 means the box runs to the end
 * of its parent. Anything that does not fit its own header ends the walk —
 * a truncated header window hits this on the last box, which is expected
 * rather than exceptional.
 */
export function* boxes(view: DataView, from: number, to: number): Generator<Box> {
  const limit = Math.min(to, view.byteLength)
  let at = from

  while (at + 8 <= limit) {
    let size = view.getUint32(at)
    const type = fourcc(view, at + 4)
    let body = at + 8

    if (size === 1) {
      if (at + 16 > limit) return
      // Only the low half of a 64-bit size can address anything we could read
      // into memory; a box over 4 GiB is not one this app is going to open.
      if (view.getUint32(at + 8) !== 0) return
      size = view.getUint32(at + 12)
      body = at + 16
    } else if (size === 0) {
      size = limit - at
    }

    // A size that does not cover the header it just read is malformed.
    if (size < body - at) return

    yield { type, start: at, body, end: Math.min(at + size, limit) }
    at += size
  }
}

/** The first child box of the given type, or null. */
function child(view: DataView, parent: Box, type: string): Box | null {
  for (const box of boxes(view, parent.body, parent.end)) {
    if (box.type === type) return box
  }
  return null
}

/**
 * `meta` is a FullBox: a version byte and three flag bytes sit between the
 * header and the children. Files written against the earlier draft omit them,
 * and the two are easy to tell apart — those four bytes are either the zero of
 * a version-0 FullBox, or the non-zero size of the first child box.
 */
function metaChildren(view: DataView, meta: Box): Box {
  const versioned = meta.body + 4 <= meta.end && view.getUint32(meta.body) === 0
  return { ...meta, body: versioned ? meta.body + 4 : meta.body }
}

/** Version and flags of a FullBox, and the offset just past them. */
function fullBox(view: DataView, box: Box): { version: number; at: number } | null {
  if (box.body + 4 > box.end) return null
  return { version: view.getUint8(box.body), at: box.body + 4 }
}

/**
 * An integer of 0, 4 or 8 bytes — the widths `iloc` is allowed to use for its
 * offsets and lengths. Zero bytes means the field is absent and reads as zero.
 */
function sized(view: DataView, at: number, bytes: number, limit: number): number | null {
  if (bytes === 0) return 0
  if (at + bytes > limit) return null
  if (bytes === 4) return view.getUint32(at)
  if (bytes === 8) {
    if (view.getUint32(at) !== 0) return null // past 4 GiB; see `boxes`
    return view.getUint32(at + 4)
  }
  return null
}

/** The id of the item declared as `Exif` in the item info box. */
function exifItemId(view: DataView, iinf: Box): number | null {
  const head = fullBox(view, iinf)
  if (!head) return null

  // The entry count widens from 16 to 32 bits at version 1.
  const at = head.at + (head.version === 0 ? 2 : 4)
  if (at > iinf.end) return null

  for (const entry of boxes(view, at, iinf.end)) {
    if (entry.type !== 'infe') continue

    const infe = fullBox(view, entry)
    // The item type only appears at version 2; before that an entry could not
    // say what it held, and no file that stores EXIF this way uses version 1.
    if (!infe || infe.version < 2) continue

    const idBytes = infe.version === 2 ? 2 : 4
    // item_ID, item_protection_index(2), item_type(4)
    if (infe.at + idBytes + 6 > entry.end) continue

    const type = fourcc(view, infe.at + idBytes + 2)
    if (type !== 'Exif') continue

    return idBytes === 2 ? view.getUint16(infe.at) : view.getUint32(infe.at)
  }
  return null
}

/**
 * The byte range of one item, from the item location box.
 *
 * `construction_method` says what the offset is measured from: 0 is the file
 * itself, and 1 is the `idat` box inside `meta`, which is how a small item is
 * stored inline. The third method points at another item and is not something
 * any camera writes for EXIF.
 */
function locate(view: DataView, iloc: Box, wanted: number, idat: Box | null): Extent | null {
  const head = fullBox(view, iloc)
  if (!head) return null
  const { version } = head
  let at = head.at

  if (at + 2 > iloc.end) return null
  const widths = view.getUint16(at)
  at += 2
  const offsetBytes = (widths >> 12) & 0xf
  const lengthBytes = (widths >> 8) & 0xf
  const baseBytes = (widths >> 4) & 0xf
  // The low nibble is the index width at versions 1 and 2, reserved before.
  const indexBytes = version === 1 || version === 2 ? widths & 0xf : 0

  const countBytes = version < 2 ? 2 : 4
  if (at + countBytes > iloc.end) return null
  const count = countBytes === 2 ? view.getUint16(at) : view.getUint32(at)
  at += countBytes

  for (let i = 0; i < count; i++) {
    const idBytes = version < 2 ? 2 : 4
    if (at + idBytes > iloc.end) return null
    const id = idBytes === 2 ? view.getUint16(at) : view.getUint32(at)
    at += idBytes

    let construction = 0
    if (version === 1 || version === 2) {
      if (at + 2 > iloc.end) return null
      construction = view.getUint16(at) & 0xf
      at += 2
    }

    at += 2 // data_reference_index: a non-zero one points out of the file
    const base = sized(view, at, baseBytes, iloc.end)
    if (base === null) return null
    at += baseBytes

    if (at + 2 > iloc.end) return null
    const extents = view.getUint16(at)
    at += 2

    for (let e = 0; e < extents; e++) {
      at += indexBytes
      const offset = sized(view, at, offsetBytes, iloc.end)
      at += offsetBytes
      const length = sized(view, at, lengthBytes, iloc.end)
      at += lengthBytes
      if (offset === null || length === null) return null

      // The TIFF block starts in the first extent. EXIF split across several
      // is legal and no encoder does it; stitching would buy nothing real.
      if (id !== wanted || e !== 0) continue

      if (construction === 0) return { offset: base + offset, length }
      if (construction === 1 && idat) return { offset: idat.body + base + offset, length }
      return null
    }
  }
  return null
}

/**
 * Locate the EXIF payload of an ISOBMFF file.
 *
 * The offset is absolute in the file, and may well be past whatever header
 * window the caller has in hand — which is the point of returning a range
 * rather than the bytes.
 */
export function findExifExtent(view: DataView): Extent | null {
  if (!isIsobmff(view)) return null

  for (const box of boxes(view, 0, view.byteLength)) {
    if (box.type !== 'meta') continue

    const meta = metaChildren(view, box)
    const iinf = child(view, meta, 'iinf')
    const iloc = child(view, meta, 'iloc')
    if (!iinf || !iloc) return null

    const id = exifItemId(view, iinf)
    if (id === null) return null

    return locate(view, iloc, id, child(view, meta, 'idat'))
  }
  return null
}

/* ─────────────────────────── the payload itself ─────────────────────────── */

/** `II*\0` or `MM\0*` — the byte-order mark and magic that open a TIFF block. */
function looksLikeTiff(view: DataView, at: number): boolean {
  if (at < 0 || at + 4 > view.byteLength) return false
  const order = view.getUint16(at)
  if (order === 0x4949) return view.getUint16(at + 2, true) === 42
  if (order === 0x4d4d) return view.getUint16(at + 2, false) === 42
  return false
}

/**
 * How far into an `Exif` item's payload to scan before giving up — and so how
 * many bytes of it a caller needs in hand to call `tiffOffsetInPayload`.
 */
export const EXIF_PAYLOAD_HEAD = 64

/**
 * Where the TIFF block begins within an `Exif` item's payload.
 *
 * The payload opens with a four-byte count of the bytes between it and the
 * TIFF header. That is usually zero, and six when a converter carried the
 * JPEG-style "Exif\0\0" prefix across — but files exist that write the block
 * flat with no count at all, so the stated offset is treated as a hint and
 * confirmed against the byte-order mark rather than trusted outright.
 */
export function tiffOffsetInPayload(payload: DataView): number | null {
  const candidates: number[] = []

  if (payload.byteLength >= 4) {
    const stated = payload.getUint32(0)
    if (stated <= EXIF_PAYLOAD_HEAD) candidates.push(4 + stated)
  }
  candidates.push(4, 0)

  for (const at of candidates) {
    if (looksLikeTiff(payload, at)) return at
  }

  // Nothing where it should be: sweep the front of the payload.
  for (let at = 0; at + 4 <= Math.min(payload.byteLength, EXIF_PAYLOAD_HEAD); at++) {
    if (looksLikeTiff(payload, at)) return at
  }
  return null
}
