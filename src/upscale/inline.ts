import type { EditState, ImageMeta, UpscaleFactor } from '../editor/edit-stack/types'
import { retouchPatches, type RetouchPatch } from '../retouch/retouch'
import { fillEnabled } from '../retouch/preference'
import { regionFor, upscaleSignature, type Region } from './region'
import { upscaleBitmap } from './upscale'

/**
 * The upscaled view of a photo: the part of the stored picture the crop
 * needs, with the heals laid on, run through the model.
 *
 * Built once and kept beside the native picture. The renderer draws from it
 * in place of the whole picture — the region says where it sits — so every
 * stage after the heal works on the upscaled pixels, and the viewport shows
 * what the file will hold. The crop and retouch tools show the native
 * picture while they are open, and the view is built again when they close.
 */
export interface UpscaledView {
  /** The region, upscaled. Full resolution: what the export writes from. */
  source: ImageBitmap
  /** The same, scaled for the viewport. */
  preview: ImageBitmap
  region: Region
  factor: UpscaleFactor
  /** `upscaleSignature` of the edits this was built for. */
  sig: string
  /** The dimensions of the native bitmap the region was cut from. */
  from: { width: number; height: number }
}

export interface PreparedUpscale {
  source: ImageBitmap
  region: Region
  factor: UpscaleFactor
}

/**
 * Cut the region out of the native picture, lay the retouch patches on it,
 * and upscale it. `native` is in stored orientation and is left as it was.
 */
export async function prepareUpscale(
  native: ImageBitmap,
  meta: ImageMeta,
  edits: EditState,
  frameKey: string,
  onProgress?: (fraction: number) => void,
): Promise<PreparedUpscale> {
  const factor = edits.upscale
  if (factor === 1) throw new Error('nothing to upscale')

  const region = regionFor(meta, edits, native.width, native.height)
  const { x, y, w, h } = region.px

  // The heals, at this resolution, so what the model sees is what the viewport
  // showed: the stack runs the heal before the upscale.
  const strokes = edits.retouch.filter((s) => s.enabled)
  let patches: RetouchPatch[] = []
  if (strokes.length) {
    patches = (await retouchPatches(native, meta.orientation, strokes, frameKey, fillEnabled())).patches
  }

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D context to cut the region')
  ctx.drawImage(native, x, y, w, h, 0, 0, w, h)
  for (const p of patches) {
    // Clipped by the canvas: a patch outside the region is simply not here.
    ctx.putImageData(new ImageData(p.data as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), p.x - x, p.y - y)
  }
  const cut = canvas.transferToImageBitmap()

  const { bitmap } = await upscaleBitmap(cut, factor as 2 | 4, onProgress)
  return { source: bitmap, region: { x: region.x, y: region.y, w: region.w, h: region.h }, factor }
}

export { upscaleSignature }
