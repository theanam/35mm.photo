import { Renderer } from '../editor/gpu/renderer'
import type { EditState, ImageMeta } from '../editor/edit-stack/types'
import { developSource } from './develop'
import { prepareUpscale, type PreparedUpscale } from '../upscale/inline'
import { exportFilename, renderToBlob, type ExportSettings, exportLayoutFor } from './export'
import type { OpenedFile } from './file-system'

/**
 * Exporting a whole selection.
 *
 * Three things make this different from running the single-file export in a
 * loop, and all three are about not falling over halfway through a folder:
 *
 * - **One renderer.** A browser hands out a limited number of live WebGL
 *   contexts, around sixteen. Building one per photo dies partway through.
 * - **One destination.** The single-file path asks where to put each file;
 *   asked fifty times that is not a feature. A directory is chosen once.
 * - **One at a time.** Raw decoding is serialised through a single worker
 *   anyway, and a 60 MP frame is a quarter of a gigabyte as RGBA — running
 *   them in parallel would buy nothing and cost the tab.
 */

export interface BatchItem {
  frameId: string
  file: OpenedFile
  meta: ImageMeta
  edits: EditState
}

export type BatchStatus = 'pending' | 'working' | 'done' | 'failed' | 'skipped'

export interface BatchProgress {
  frameId: string
  status: BatchStatus
  /** Which stage the current file is at, for the tucked-away readout. */
  stage?: string
  error?: string
}

export interface BatchRequest {
  items: BatchItem[]
  settings: ExportSettings
  directory: FileSystemDirectoryHandle
  onProgress: (update: BatchProgress) => void
  signal?: AbortSignal
}

export interface BatchResult {
  saved: number
  failed: number
  cancelled: boolean
}

export function canBatchExport(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

/** Ask once for somewhere to put the whole run. */
export async function pickExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!canBatchExport()) return null
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    throw err
  }
}

/**
 * Make a filename unique within one run.
 *
 * Export names are built from the stem alone, so a folder holding both
 * `DSC1000.RAF` and `DSC1000.JPG` produces `DSC1000-35mm.jpg` twice. Exported
 * one at a time that is the user's business — they see each save dialog. Poured
 * into one directory by a batch, the second would silently replace the first.
 */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * The part of a batch that has nothing to do with images: run items one at a
 * time, let a failure take out only its own item, stop when asked, and count
 * what happened. Kept separate from the rendering so it can be tested without a
 * GPU — this is the logic that decides whether a folder half-exports cleanly or
 * dies on the first bad file.
 */
export async function runQueue<T extends { frameId: string }>(
  items: T[],
  process: (item: T) => Promise<void>,
  onProgress: (update: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchResult> {
  let saved = 0
  let failed = 0

  for (const item of items) {
    if (signal?.aborted) {
      onProgress({ frameId: item.frameId, status: 'skipped' })
      continue
    }

    try {
      await process(item)
      saved++
      onProgress({ frameId: item.frameId, status: 'done' })
    } catch (err) {
      failed++
      onProgress({
        frameId: item.frameId,
        status: 'failed',
        error: err instanceof Error ? err.message : 'could not be exported',
      })
    }
  }

  return { saved, failed, cancelled: Boolean(signal?.aborted) }
}

export async function runBatchExport(request: BatchRequest): Promise<BatchResult> {
  const { items, settings, directory, onProgress, signal } = request

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
  const renderer = new Renderer(canvas)
  const used = new Set<string>()

  try {
    return await runQueue(
      items,
      async (item) => {
        onProgress({ frameId: item.frameId, status: 'working', stage: 'Opening' })
        let bitmap: ImageBitmap | null = null
        let prepared: PreparedUpscale | null = null
        try {
          // Developed with the photo's own raw settings, so a batch writes
          // what the viewport showed.
          const decoded = await developSource(item.file.file, item.edits.raw)
          bitmap = decoded.bitmap

          // The upscaled view, built here as the viewport would have built
          // it: the crop's region, heals in, through the model.
          if (item.edits.upscale > 1) {
            onProgress({ frameId: item.frameId, status: 'working', stage: 'Upscaling' })
            prepared = await prepareUpscale(bitmap, decoded.meta, item.edits, item.frameId, (fraction) =>
              onProgress({ frameId: item.frameId, status: 'working', stage: `Upscaling ${Math.round(fraction * 100)}%` }),
            )
          }

          const layout = exportLayoutFor(decoded.meta, item.edits, settings.maxEdge)

          const { blob } = await renderToBlob({
            source: prepared?.source ?? bitmap,
            native: bitmap,
            region: prepared?.region,
            meta: decoded.meta,
            edits: item.edits,
            settings,
            width: layout.width,
            height: layout.height,
            frame: layout,
            renderer,
            sourceFile: item.file.file,
            // So a subject mask synced onto this photo finds *this* photo's
            // subject, and reuses it if the frame has already been opened.
            frameId: item.frameId,
            onProgress: (stage) => onProgress({ frameId: item.frameId, status: 'working', stage }),
          })
          if (!blob) throw new Error('the browser could not encode it')

          onProgress({ frameId: item.frameId, status: 'working', stage: 'Saving' })
          const name = uniqueName(exportFilename(item.meta.name, settings.format), used)
          const handle = await directory.getFileHandle(name, { create: true })
          const writable = await handle.createWritable()
          await writable.write(blob)
          await writable.close()
        } finally {
          // Release before the next decode rather than after the loop: holding
          // every frame would be gigabytes by the end of a folder.
          bitmap?.close()
          prepared?.source.close()
        }
      },
      onProgress,
      signal,
    )
  } finally {
    renderer.dispose({ loseContext: true })
  }
}
