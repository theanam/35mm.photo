import { MAX_PREVIEW_EDGE, decodeFile, previewBitmap, type OnStage } from './decode'
import { isRawFile } from './formats'
import { developFingerprint } from '../raw/develop-settings'
import type { ImageMeta, RawDevelopState } from '../editor/edit-stack/types'
import * as db from '../storage/indexeddb'

/**
 * Opening a photo, with the develop cache in front of it.
 *
 * Developing a 50 MP raw takes about four and a half seconds, and every one of
 * them is spent again each time you click back onto a photo you already looked
 * at. The cache holds the developed *preview* — what the viewport and the look
 * swatches actually draw — so coming back costs about a tenth of a second.
 *
 * It deliberately does not hold full-resolution pixels. Those are ten times the
 * size for a copy only an export reads, and an export re-develops from the file
 * anyway, so nothing that leaves this app has ever been through the cache.
 */
export interface Developed {
  meta: ImageMeta
  /**
   * Full-resolution pixels — unless this came from the cache, in which case it
   * is the preview and `sourceIsPreview` says so.
   */
  source: ImageBitmap
  preview: ImageBitmap
  sourceIsPreview: boolean
}

/** `<file>@<settings>`: the same file developed two ways is two entries. */
function cacheKey(file: File, raw: RawDevelopState): string {
  return `${db.fileKey(file)}@${developFingerprint(raw)}`
}

export async function developFor(
  file: File,
  raw: RawDevelopState,
  onStage?: OnStage,
): Promise<Developed> {
  // Only raws are worth caching. Everything else decodes in milliseconds, and
  // storing those would spend the budget on the files that do not need it.
  if (!isRawFile(file.name)) {
    const decoded = await decodeFile(file, onStage)
    return {
      meta: decoded.meta,
      source: decoded.bitmap,
      preview: await previewBitmap(decoded.bitmap),
      sourceIsPreview: false,
    }
  }

  const key = cacheKey(file, raw)
  const hit = await db.loadDevelop(key)
  if (hit) {
    try {
      const bitmap = await createImageBitmap(hit.blob)
      // Source and preview are the same object here, which `closePhoto` already
      // expects — `previewBitmap` returns its input for an image small enough
      // not to need resizing.
      return { meta: hit.meta, source: bitmap, preview: bitmap, sourceIsPreview: true }
    } catch (err) {
      // A corrupt entry should cost one slow open, not every future one.
      console.warn('[35mm] a cached develop could not be read; developing again', err)
    }
  }

  const decoded = await decodeFile(file, onStage, raw)
  const preview = await previewBitmap(decoded.bitmap)

  // Written behind the photo appearing, not in front of it: encoding is a
  // couple of hundred milliseconds that the person waiting has already paid
  // for once.
  void storeDevelop(key, preview, decoded.meta)

  return { meta: decoded.meta, source: decoded.bitmap, preview, sourceIsPreview: false }
}

/**
 * Full-resolution pixels for a photo whose source came from the cache.
 * Export calls this so that what it writes is always developed from the raw.
 */
export async function developFullSource(
  file: File,
  raw: RawDevelopState,
  onStage?: OnStage,
): Promise<ImageBitmap> {
  const decoded = await decodeFile(file, onStage, raw)
  return decoded.bitmap
}

async function storeDevelop(key: string, preview: ImageBitmap, meta: ImageMeta): Promise<void> {
  try {
    const blob = await encodePreview(preview)
    if (!blob) return
    await db.saveDevelop({ key, blob, width: preview.width, height: preview.height, meta })
  } catch (err) {
    // A full disk or a private window: the app is simply slower, not broken.
    console.warn('[35mm] could not cache the developed preview', err)
  }
}

/**
 * PNG, and lossless on purpose.
 *
 * Measured on a 12.6 MP preview: raw pixels are 50 MB, lossless WebP is 10 MB
 * but takes 2.4 s to encode — more than half the develop this is meant to save
 * — and WebP at quality 0.92 is 0.3 MB but moves pixels by up to 60 levels out
 * of 255. That last one is the tempting option and the wrong one: this is the
 * image someone grades against, and a colour decision made on a compression
 * artefact is a decision made on nothing.
 */
export async function encodePreview(bitmap: ImageBitmap): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

export { MAX_PREVIEW_EDGE }
