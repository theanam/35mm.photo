/** Formats the browser can decode natively (spec §4.1). */
export const NATIVE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] as const

/**
 * Camera raw formats. TIFF sits here rather than with the native formats
 * because no browser decodes it reliably — it goes through the same
 * decoder-worker path as raw (spec §4.1, §5).
 */
export const RAW_EXTENSIONS = [
  'raf', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2',
  'dng', 'orf', 'rw2', 'pef', 'raw', 'x3f', 'tif', 'tiff',
] as const

/** What the file picker and the empty state advertise, in the design's order. */
export const ADVERTISED_FORMATS = 'JPEG · PNG · WEBP · AVIF · GIF · BMP'

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

export function isRawFile(name: string): boolean {
  return (RAW_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export function isSupportedFile(name: string): boolean {
  const ext = extensionOf(name)
  return (
    (NATIVE_EXTENSIONS as readonly string[]).includes(ext) ||
    (RAW_EXTENSIONS as readonly string[]).includes(ext)
  )
}

export const ACCEPT_ATTRIBUTE = [...NATIVE_EXTENSIONS, ...RAW_EXTENSIONS]
  .map((e) => `.${e}`)
  .join(',')
