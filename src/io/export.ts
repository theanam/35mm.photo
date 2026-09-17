import { Renderer } from '../editor/gpu/renderer'
import { outputSize } from '../editor/gpu/transform'
import { resolveLookLut } from '../editor/presets/lut3d'
import { getLook } from '../editor/presets/looks'
import type { EditState, ImageMeta } from '../editor/edit-stack/types'
import { saveBlob, writeToHandle } from './file-system'

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

export interface ExportRequest {
  /** The original full-resolution decode, not the preview. */
  source: ImageBitmap
  meta: ImageMeta
  edits: EditState
  settings: ExportSettings
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

  onProgress?.('Preparing')
  const full = outputSize(meta.width, meta.height, edits.crop)
  const scale = settings.maxEdge
    ? Math.min(1, settings.maxEdge / Math.max(full.width, full.height))
    : 1
  const width = Math.max(1, Math.round(full.width * scale))
  const height = Math.max(1, Math.round(full.height * scale))

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })

  const renderer = new Renderer(canvas)
  try {
    onProgress?.('Rendering')
    renderer.setImage(source, meta.orientation)

    const look = getLook(edits.look.id)
    if (look) renderer.setLut(await resolveLookLut(look, document.baseURI))

    renderer.render(width, height, { edits, look })
    // The drawing buffer is only guaranteed until the next composite; encode
    // straight away rather than deferring to a later task.
    renderer.gl.finish()

    onProgress?.('Encoding')
    const blob = await encode(canvas, settings)
    if (!blob) throw new Error('The browser could not encode the exported image')

    const filename = exportFilename(meta.name, settings.format)

    onProgress?.('Saving')
    if (request.overwriteHandle) {
      const ok = await writeToHandle(request.overwriteHandle, blob)
      if (ok) {
        return { outcome: 'saved', filename, width, height, bytes: blob.size }
      }
    }

    const outcome = await saveBlob(blob, filename, MIME[settings.format], EXT[settings.format])
    return { outcome, filename, width, height, bytes: blob.size }
  } finally {
    // Its canvas is discarded with this call, so free the context now rather
    // than letting exports pile up live contexts against the browser's cap.
    renderer.dispose({ loseContext: true })
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
