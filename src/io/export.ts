import { Renderer } from '../editor/gpu/renderer'
import { outputSize } from '../editor/gpu/transform'
import { getLut } from '../editor/presets/lutCache'
import { getLook } from '../editor/presets/catalogue'
import type { EditState, ImageMeta } from '../editor/edit-stack/types'
import { saveBlob, writeToHandle } from './file-system'
import { extensionOf } from './formats'
import { attachExif } from './exif-write'

export type ExportFormat = 'jpeg' | 'png' | 'webp'

export interface ExportSettings {
  format: ExportFormat
  /** 1..100, ignored for PNG. */
  quality: number
  /** Longest-edge cap in pixels, or null for full resolution. */
  maxEdge: number | null
}

export const DEFAULT_EXPORT: ExportSettings = { format: 'jpeg', quality: 92, maxEdge: null }

const MIME: Record<ExportFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

const EXT: Record<ExportFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/**
 * The export format a file's own extension claims, or null for a file this app
 * can open but not write.
 *
 * Which is most of them. 35mm reads every raw LibRaw handles, plus HEIC, TIFF,
 * AVIF, GIF and BMP, and encodes exactly three — so for nearly everything that
 * can be opened there is no such thing as writing it back.
 */
export function formatOfFile(name: string): ExportFormat | null {
  switch (extensionOf(name)) {
    case 'jpg':
    case 'jpeg':
      return 'jpeg'
    case 'png':
      return 'png'
    case 'webp':
      return 'webp'
    default:
      return null
  }
}

/**
 * Whether this photo can be written back over itself in the chosen format.
 *
 * The extension has to name the format being encoded, not merely be one of the
 * three that can be encoded at all. Overwriting a .RAF with a JPEG destroys a
 * negative to leave a mislabelled positive in its place, and overwriting a .jpg
 * with PNG bytes is the same mistake with less at stake: in both cases the file
 * stops being what its name says it is, and the original is not coming back.
 */
export function canOverwriteOriginal(name: string, format: ExportFormat): boolean {
  return formatOfFile(name) === format
}

export interface ExportRequest {
  /** The original full-resolution decode, not the preview. */
  source: ImageBitmap
  meta: ImageMeta
  edits: EditState
  settings: ExportSettings
  /** The file the photo came from, so its EXIF can travel to the export. */
  sourceFile?: Blob
  /** Set to overwrite the file the photo came from instead of prompting. */
  overwriteHandle?: FileSystemFileHandle
  onProgress?: (stage: string) => void
}

export interface ExportResult {
  outcome: 'saved' | 'downloaded' | 'cancelled'
  filename: string
  width: number
  height: number
  bytes: number
}

/**
 * Re-runs the whole pipeline at full resolution off-screen, then encodes
 * (spec §6, "Export"). The preview renderer is left untouched so the viewport
 * does not flicker while an export is in flight.
 */
export async function exportImage(request: ExportRequest): Promise<ExportResult> {
  const { source, meta, edits, settings, onProgress } = request

  // Refused here rather than where the button is drawn, because this is the one
  // call in the app that destroys the file it is handed and the guard belongs
  // where every caller meets it. Before the render rather than after, because
  // the answer does not depend on the pixels and a full-resolution export is
  // seconds of work to throw away.
  if (request.overwriteHandle && !canOverwriteOriginal(meta.name, settings.format)) {
    throw new Error(
      `35mm cannot write ${settings.format.toUpperCase()} over a ` +
        `.${extensionOf(meta.name).toUpperCase()} file. Export a copy instead.`,
    )
  }

  onProgress?.('Preparing')
  const full = outputSize(meta.width, meta.height, edits.crop)
  const scale = settings.maxEdge
    ? Math.min(1, settings.maxEdge / Math.max(full.width, full.height))
    : 1
  const width = Math.max(1, Math.round(full.width * scale))
  const height = Math.max(1, Math.round(full.height * scale))

  const { blob } = await renderToBlob({
    source,
    meta,
    edits,
    settings,
    width,
    height,
    onProgress,
    sourceFile: request.sourceFile,
  })
  {

    const filename = exportFilename(meta.name, settings.format)
    if (!blob) throw new Error('The browser could not encode the exported image')

    onProgress?.('Saving')
    if (request.overwriteHandle) {
      const ok = await writeToHandle(request.overwriteHandle, blob)
      if (ok) {
        return { outcome: 'saved', filename, width, height, bytes: blob.size }
      }
    }

    const outcome = await saveBlob(blob, filename, MIME[settings.format], EXT[settings.format])
    return { outcome, filename, width, height, bytes: blob.size }
  }
}

export interface RenderRequest {
  source: ImageBitmap
  meta: ImageMeta
  edits: EditState
  settings: ExportSettings
  width: number
  height: number
  onProgress?: (stage: string) => void
  /** Original file, for carrying its EXIF into the encoded output. */
  sourceFile?: Blob
  /**
   * Reuse a renderer across many exports. A browser caps how many live WebGL
   * contexts it will hand out — around sixteen — so a batch that built one per
   * photo would die partway through a folder. Left unset, one is made and
   * disposed for this single render.
   */
  renderer?: Renderer
}

/**
 * The render-and-encode half of an export, without the saving. Split out so a
 * batch can drive it directly with one renderer and one destination, rather
 * than going through the single-file path that prompts for somewhere to put
 * each photo.
 */
export async function renderToBlob(
  request: RenderRequest,
): Promise<{ blob: Blob | null; width: number; height: number }> {
  const { source, meta, edits, settings, width, height, onProgress } = request

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })

  const owned = !request.renderer
  const renderer = request.renderer ?? new Renderer(canvas)
  const surface = renderer.canvas

  // A reused renderer arrives sized for whatever it drew last.
  if (!owned) {
    surface.width = width
    surface.height = height
  }

  try {
    onProgress?.('Rendering')
    renderer.setImage(source, meta.orientation)

    // Through the cache, so the export reuses the cube the viewport already
    // built rather than resampling an imported LUT a second time.
    const look = getLook(edits.look.id)
    renderer.setLut(await getLut(edits.look.id))

    renderer.render(width, height, { edits, look })
    // The drawing buffer is only guaranteed until the next composite; encode
    // straight away rather than deferring to a later task.
    renderer.gl.finish()

    onProgress?.('Encoding')
    const blob = await encode(surface, settings)
    if (!blob) return { blob, width, height }

    // Carry the camera's own metadata across, and sign the result. A canvas
    // writes pixels alone, so without this every export silently discarded the
    // camera, lens, exposure, date and location the original carried.
    return {
      blob: await attachExif(blob, settings.format, request.sourceFile, { width, height }),
      width,
      height,
    }
  } finally {
    // Its canvas is discarded with this call, so free the context now rather
    // than letting exports pile up live contexts against the browser's cap.
    if (owned) renderer.dispose({ loseContext: true })
  }
}

async function encode(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  settings: ExportSettings,
): Promise<Blob | null> {
  const type = MIME[settings.format]
  const quality = settings.format === 'png' ? undefined : settings.quality / 100

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

export function exportFilename(sourceName: string, format: ExportFormat): string {
  const dot = sourceName.lastIndexOf('.')
  const stem = dot === -1 ? sourceName : sourceName.slice(0, dot)
  return `${stem}-35mm.${EXT[format]}`
}

/* ─────────────────── edit-state sidecars (spec §4.4) ─────────────────── */

export const SIDECAR_VERSION = 1

export interface Sidecar {
  app: '35mm'
  version: number
  savedAt: string
  source?: { name: string; width: number; height: number }
  edits: EditState
}

export function buildSidecar(meta: ImageMeta, edits: EditState): Sidecar {
  return {
    app: '35mm',
    version: SIDECAR_VERSION,
    savedAt: new Date().toISOString(),
    source: { name: meta.name, width: meta.width, height: meta.height },
    edits,
  }
}

export async function saveSidecar(meta: ImageMeta, edits: EditState) {
  const json = JSON.stringify(buildSidecar(meta, edits), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const dot = meta.name.lastIndexOf('.')
  const stem = dot === -1 ? meta.name : meta.name.slice(0, dot)
  return saveBlob(blob, `${stem}.35mm.json`, 'application/json', 'json')
}

/** Sidecars saved before the rename to 35mm are still perfectly good edit state. */
const LEGACY_APP_TAG = 'baryta'

export function parseSidecar(text: string): EditState {
  const parsed = JSON.parse(text) as Partial<Sidecar> & { app?: string }
  if ((parsed.app !== '35mm' && parsed.app !== LEGACY_APP_TAG) || !parsed.edits) {
    throw new Error('That file is not a 35mm edit sidecar')
  }
  if ((parsed.version ?? 0) > SIDECAR_VERSION) {
    throw new Error('That sidecar was written by a newer version of 35mm')
  }
  return parsed.edits
}
