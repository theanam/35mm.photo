/** Formats the browser can decode natively (spec §4.1). */
export const NATIVE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'] as const

/**
 * Camera raw formats, tracking the extension list LibRaw itself recognises —
 * the decoder is the constraint, not this table, so anything LibRaw opens
 * should reach it rather than being turned away at the door (spec §4.1, §5).
 *
 * TIFF sits here rather than with the native formats because no browser decodes
 * it reliably, and it goes down the same path.
 */
export const RAW_EXTENSIONS = [
  // Canon, Nikon, Sony
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'arq', 'srf', 'sr2',
  // Fujifilm, Panasonic/Leica, Olympus, Pentax, Samsung
  'raf', 'rw2', 'rwl', 'raw', 'orf', 'ori', 'pef', 'ptx', 'srw',
  // Adobe, GoPro, Sigma, Minolta, Epson, Kodak
  'dng', 'gpr', 'x3f', 'mrw', 'erf', 'dcr', 'kdc', 'k25', 'dc2',
  // Medium format: Hasselblad, Phase One, Leaf, Mamiya
  '3fr', 'fff', 'iiq', 'cap', 'mos', 'mef', 'mdc',
  // Other oddities LibRaw carries decoders for
  'bay', 'bmq', 'cs1', 'drf', 'dsc', 'ia', 'kc2', 'pxn', 'qtk',
  'rdc', 'rwz', 'sti',
  'tif', 'tiff',
] as const

/** What the file picker and the empty state advertise, in the design's order. */
export const ADVERTISED_FORMATS = 'JPEG · PNG · WEBP · RAF · RW2 · CR3 · NEF · ARW · DNG'

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
