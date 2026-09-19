import { HEADER_BYTES, readOrientation } from './exif'

/**
 * The rest of the EXIF block: everything `exif.ts` walks past on its way to the
 * orientation tag.
 *
 * Read on demand rather than at decode time. Opening a photo should not pay for
 * metadata nobody has asked to see, and the viewer is a click away from the
 * moment it does get asked for.
 *
 * Values are formatted here rather than in the component, because turning
 * 10/2500 into "1/250 s" needs to know the tag it came from — that is a
 * property of EXIF, not of how it happens to be displayed.
 */

export interface ExifEntry {
  label: string
  value: string
}

export interface ExifSection {
  id: 'camera' | 'exposure' | 'lens' | 'place' | 'file'
  entries: ExifEntry[]
}

/** Bytes per component, by TIFF type code. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
}

const EXIF_IFD_POINTER = 0x8769
const GPS_IFD_POINTER = 0x8825

type Raw = number | number[] | string | { n: number; d: number }[]

class Tiff {
  readonly view: DataView
  readonly start: number
  readonly little: boolean

  constructor(view: DataView, start: number) {
    this.view = view
    this.start = start
    const order = view.getUint16(start)
    if (order !== 0x4949 && order !== 0x4d4d) throw new Error('not a TIFF block')
    this.little = order === 0x4949
    const magic = view.getUint16(start + 2, this.little)
    // 42 for TIFF proper, 0x55 for Panasonic's RW2, which is otherwise one.
    if (magic !== 0x002a && magic !== 0x0055) throw new Error('not a TIFF block')
  }

  get firstIfd() {
    return this.start + this.view.getUint32(this.start + 4, this.little)
  }

  /** Every entry of one IFD, by tag. */
  readIfd(at: number): Map<number, Raw> {
    const out = new Map<number, Raw>()
    if (at + 2 > this.view.byteLength) return out

    const count = this.view.getUint16(at, this.little)
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12
      if (entry + 12 > this.view.byteLength) break

      const tag = this.view.getUint16(entry, this.little)
      const type = this.view.getUint16(entry + 2, this.little)
      const n = this.view.getUint32(entry + 4, this.little)
      const size = (TYPE_SIZE[type] ?? 0) * n
      if (!size) continue

      // Four bytes or fewer sit in the entry; anything larger is a pointer
      // measured from the start of the TIFF block, not from the file.
      const at2 = size <= 4 ? entry + 8 : this.start + this.view.getUint32(entry + 8, this.little)
      if (at2 + size > this.view.byteLength) continue

      const value = this.read(type, n, at2)
      if (value !== null) out.set(tag, value)
    }
    return out
  }

  private read(type: number, n: number, at: number): Raw | null {
    const v = this.view
    const le = this.little

    if (type === 2) {
      let s = ''
      for (let i = 0; i < n; i++) {
        const ch = v.getUint8(at + i)
        if (ch === 0) break
        s += String.fromCharCode(ch)
      }
      return s.trim()
    }

    if (type === 5 || type === 10) {
      const out: { n: number; d: number }[] = []
      for (let i = 0; i < n; i++) {
        const o = at + i * 8
        out.push(
          type === 5
            ? { n: v.getUint32(o, le), d: v.getUint32(o + 4, le) }
            : { n: v.getInt32(o, le), d: v.getInt32(o + 4, le) },
        )
      }
      return out
    }

    const nums: number[] = []
    for (let i = 0; i < n; i++) {
      const o = at + i * (TYPE_SIZE[type] ?? 1)
      if (type === 1 || type === 6 || type === 7) nums.push(v.getUint8(o))
      else if (type === 3) nums.push(v.getUint16(o, le))
      else if (type === 8) nums.push(v.getInt16(o, le))
      else if (type === 4) nums.push(v.getUint32(o, le))
      else if (type === 9) nums.push(v.getInt32(o, le))
      else if (type === 11) nums.push(v.getFloat32(o, le))
      else if (type === 12) nums.push(v.getFloat64(o, le))
      else return null
    }
    return nums.length === 1 ? nums[0] : nums
  }
}

/* ────────────────────────────── formatting ────────────────────────────── */

const ratio = (r: Raw | undefined): number | null => {
  if (!Array.isArray(r) || typeof r[0] !== 'object') return null
  const { n, d } = r[0] as { n: number; d: number }
  return d === 0 ? null : n / d
}

const text = (r: Raw | undefined): string | null =>
  typeof r === 'string' && r.length ? r : null

const int = (r: Raw | undefined): number | null =>
  typeof r === 'number' ? r : Array.isArray(r) && typeof r[0] === 'number' ? r[0] : null

/** Shutter speeds are read as fractions of a second and shown that way. */
function shutter(seconds: number): string {
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`
  return `1/${Math.round(1 / seconds)} s`
}

const ENUMS: Record<number, Record<number, string>> = {
  0x8822: {
    0: 'Not defined', 1: 'Manual', 2: 'Normal program', 3: 'Aperture priority',
    4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait', 8: 'Landscape',
  },
  0x9207: {
    0: 'Unknown', 1: 'Average', 2: 'Centre-weighted', 3: 'Spot', 4: 'Multi-spot',
    5: 'Pattern', 6: 'Partial', 255: 'Other',
  },
  0xa403: { 0: 'Auto', 1: 'Manual' },
  0xa001: { 1: 'sRGB', 0xffff: 'Uncalibrated' },
  0x0112: {
    1: 'Upright', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Flipped',
    5: 'Transposed', 6: 'Rotated 90° CW', 7: 'Transverse', 8: 'Rotated 270° CW',
  },
}

const enumText = (tag: number, r: Raw | undefined): string | null => {
  const v = int(r)
  return v == null ? null : (ENUMS[tag]?.[v] ?? String(v))
}

/** EXIF dates are "YYYY:MM:DD HH:MM:SS"; only the date half uses colons oddly. */
function dateText(r: Raw | undefined): string | null {
  const s = text(r)
  if (!s) return null
  return s.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
}

/** Degrees, minutes and seconds as three rationals, to a signed decimal. */
function coordinate(r: Raw | undefined, ref: string | null): string | null {
  if (!Array.isArray(r) || r.length < 3 || typeof r[0] !== 'object') return null
  const parts = r as { n: number; d: number }[]
  const [deg, min, sec] = parts.map((p) => (p.d === 0 ? 0 : p.n / p.d))
  const value = deg + min / 60 + sec / 3600
  const signed = ref === 'S' || ref === 'W' ? -value : value
  return `${signed.toFixed(6)}°`
}

function push(entries: ExifEntry[], label: string, value: string | null | undefined) {
  if (value != null && value !== '') entries.push({ label, value })
}

/* ─────────────────────────────── reading ─────────────────────────────── */

interface Ifds {
  ifd0: Map<number, Raw>
  exif: Map<number, Raw>
  gps: Map<number, Raw>
}

/** Locate and walk the three IFDs worth reading. Null when there is no EXIF. */
async function readIfds(file: Blob): Promise<Ifds | null> {
  const { tiffStart } = await readOrientation(file)
  if (tiffStart == null) return null

  // Read the window from the TIFF block rather than from the start of the file.
  // A JPEG keeps its EXIF near the front, so for that the two are all but the
  // same bytes — but a HEIC stores it as an item that can sit anywhere, behind
  // the picture as often as not, and a window anchored at zero would miss it
  // entirely. Anchoring at the block also spends the whole budget on EXIF
  // instead of on whatever precedes it.
  //
  // Every pointer inside a TIFF block is measured from the block itself, so
  // reading it at the start of the buffer makes the reader's base zero.
  const buffer = await file.slice(tiffStart, tiffStart + HEADER_BYTES).arrayBuffer()
  const view = new DataView(buffer)

  let tiff: Tiff
  try {
    tiff = new Tiff(view, 0)
  } catch {
    return null
  }

  const ifd0 = tiff.readIfd(tiff.firstIfd)
  const exifPointer = int(ifd0.get(EXIF_IFD_POINTER))
  const gpsPointer = int(ifd0.get(GPS_IFD_POINTER))
  return {
    ifd0,
    exif: exifPointer ? tiff.readIfd(tiff.start + exifPointer) : new Map<number, Raw>(),
    gps: gpsPointer ? tiff.readIfd(tiff.start + gpsPointer) : new Map<number, Raw>(),
  }
}

/**
 * The few fields worth showing beside the photo rather than in a dialog.
 *
 * Raw files get these from LibRaw during development; everything else had
 * nothing at all, because the native decode path only ever read orientation.
 */
export interface ShotInfo {
  camera?: string
  lens?: string
  iso?: number
  shotAt?: number
}

export async function readShotInfo(file: Blob): Promise<ShotInfo> {
  let ifds: Ifds | null = null
  try {
    ifds = await readIfds(file)
  } catch {
    return {}
  }
  if (!ifds) return {}

  const { ifd0, exif } = ifds
  const make = text(ifd0.get(0x010f))
  const model = text(ifd0.get(0x0110))
  // Most makers repeat the brand in the model ("NIKON Z 8"), and printing it
  // twice reads like a stutter.
  const camera =
    make && model
      ? model.toLowerCase().startsWith(make.toLowerCase())
        ? model
        : `${make} ${model}`
      : (model ?? make ?? undefined)

  const taken = dateText(exif.get(0x9003))
  const shotAt = taken ? Date.parse(taken.replace(' ', 'T')) : NaN

  return {
    camera: camera || undefined,
    lens: text(exif.get(0xa434)) ?? undefined,
    iso: int(exif.get(0x8827)) ?? undefined,
    shotAt: Number.isFinite(shotAt) ? shotAt : undefined,
  }
}

export async function readExifSections(file: Blob): Promise<ExifSection[]> {
  const ifds = await readIfds(file)
  if (!ifds) return []
  const { ifd0, exif, gps } = ifds

  const sections: ExifSection[] = []

  const camera: ExifEntry[] = []
  push(camera, 'Make', text(ifd0.get(0x010f)))
  push(camera, 'Model', text(ifd0.get(0x0110)))
  push(camera, 'Serial', text(exif.get(0xa431)))
  push(camera, 'Taken', dateText(exif.get(0x9003)) ?? dateText(ifd0.get(0x0132)))
  push(camera, 'Orientation', enumText(0x0112, ifd0.get(0x0112)))
  if (camera.length) sections.push({ id: 'camera', entries: camera })

  const exposure: ExifEntry[] = []
  const shutterSeconds = ratio(exif.get(0x829a))
  push(exposure, 'Shutter', shutterSeconds != null ? shutter(shutterSeconds) : null)
  const aperture = ratio(exif.get(0x829d))
  push(exposure, 'Aperture', aperture != null ? `f/${Number(aperture.toFixed(1))}` : null)
  const iso = int(exif.get(0x8827))
  push(exposure, 'ISO', iso != null ? String(iso) : null)
  const bias = ratio(exif.get(0x9204))
  push(exposure, 'Exposure bias', bias != null ? `${bias > 0 ? '+' : ''}${Number(bias.toFixed(2))} EV` : null)
  push(exposure, 'Program', enumText(0x8822, exif.get(0x8822)))
  push(exposure, 'Metering', enumText(0x9207, exif.get(0x9207)))
  push(exposure, 'White balance', enumText(0xa403, exif.get(0xa403)))
  if (exposure.length) sections.push({ id: 'exposure', entries: exposure })

  const lens: ExifEntry[] = []
  push(lens, 'Lens', text(exif.get(0xa434)))
  push(lens, 'Lens make', text(exif.get(0xa433)))
  const focal = ratio(exif.get(0x920a))
  push(lens, 'Focal length', focal != null ? `${Number(focal.toFixed(1))} mm` : null)
  const focal35 = int(exif.get(0xa405))
  push(lens, '35mm equivalent', focal35 ? `${focal35} mm` : null)
  if (lens.length) sections.push({ id: 'lens', entries: lens })

  const place: ExifEntry[] = []
  push(place, 'Latitude', coordinate(gps.get(2), text(gps.get(1))))
  push(place, 'Longitude', coordinate(gps.get(4), text(gps.get(3))))
  const altitude = ratio(gps.get(6))
  push(place, 'Altitude', altitude != null ? `${Math.round(altitude)} m` : null)
  if (place.length) sections.push({ id: 'place', entries: place })

  const fileInfo: ExifEntry[] = []
  push(fileInfo, 'Colour space', enumText(0xa001, exif.get(0xa001)))
  push(fileInfo, 'Software', text(ifd0.get(0x0131)))
  push(fileInfo, 'Artist', text(ifd0.get(0x013b)))
  push(fileInfo, 'Copyright', text(ifd0.get(0x8298)))
  if (fileInfo.length) sections.push({ id: 'file', entries: fileInfo })

  return sections
}
