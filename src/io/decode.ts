import { extensionOf, isRawFile } from './formats'
import { readOrientation, swapsAxes, type Orientation } from './exif'
import { readShotInfo } from './exif-tags'
import type { ImageMeta } from '../editor/edit-stack/types'
import { uprightSize } from '../editor/gpu/transform'

export interface DecodedImage {
  bitmap: ImageBitmap
  meta: ImageMeta
}

export class UnsupportedFormatError extends Error {
  constructor(public readonly ext: string) {
    super(`35mm cannot open .${ext.toUpperCase()} files. Try a JPEG, PNG, WebP or AVIF.`)
    this.name = 'UnsupportedFormatError'
  }
}

/**
 * A raw file the decoder recognised but could not develop — most often a
 * compression variant missing from this LibRaw build, sometimes a truncated
 * file. Separate from `UnsupportedFormatError` so the message can say which of
 * the two happened rather than blaming the format as a whole.
 */
export class RawDecodeError extends Error {
  constructor(
    public readonly ext: string,
    public readonly detail?: string,
  ) {
    super(
      `35mm could not develop this .${ext.toUpperCase()} file` +
        (detail ? ` — ${detail}` : '. The camera may use a compression this build does not decode.'),
    )
    this.name = 'RawDecodeError'
  }
}

/**
 * Decode a file to an `ImageBitmap`. Raw files go to the LibRaw pipeline in
 * `raw/decode-raw.ts` (spec §5), which develops the sensor data rather than
 * lifting the embedded JPEG preview — §5.4 rules that out, so a raw the build
 * cannot develop fails loudly instead.
 */
/**
 * Progress callback. A raw file is seconds of work with no natural progress
 * events to report, so the loader shows which stage is running instead of a
 * percentage it would have to invent.
 */
export type DecodeStage = 'reading' | 'developing' | 'preview'
export type OnStage = (stage: DecodeStage) => void

export async function decodeFile(file: File, onStage?: OnStage): Promise<DecodedImage> {
  const ext = extensionOf(file.name)

  if (isRawFile(file.name)) {
    const { decodeRaw } = await import('../raw/decode-raw')
    return decodeRaw(file, onStage)
  }

  const { orientation, encoded } = await readOrientation(file)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, {
      colorSpaceConversion: 'default',
      // Explicit: the spec's default for this option changed from "none" to
      // "from-image", so leaving it off means a different picture per browser.
      // The render graph applies the tag, so the decoder must not.
      imageOrientation: 'none',
    })
  } catch {
    throw new UnsupportedFormatError(ext || 'unknown')
  }

  const effective = effectiveOrientation(orientation, encoded, bitmap)
  const upright = uprightSize(bitmap.width, bitmap.height, effective)

  // Raw files get camera and lens from LibRaw; everything else had none at all,
  // because this path only ever looked for the orientation tag. It is a read of
  // the header the file has already been through once, so it costs nothing to
  // pick up the rest while it is there.
  const shot = await readShotInfo(file)

  return {
    bitmap,
    meta: {
      name: file.name,
      ext,
      isRaw: false,
      ...shot,
      width: upright.width,
      height: upright.height,
      orientation: effective,
      bytes: file.size,
    },
  }
}

/**
 * Safety net for a decoder that rotated the pixels anyway. When the tag swaps
 * the axes we can tell by comparing against the dimensions recorded in the file:
 * if the bitmap already came back transposed, the rotation has been done for us
 * and applying it again would tip the photo the other way.
 */
function effectiveOrientation(
  orientation: Orientation,
  encoded: { width: number; height: number } | null,
  bitmap: ImageBitmap,
): Orientation {
  if (orientation === 1 || !encoded || !swapsAxes(orientation)) return orientation

  const alreadyRotated = bitmap.width === encoded.height && bitmap.height === encoded.width
  if (alreadyRotated) {
    console.warn('[35mm] the decoder applied EXIF orientation despite imageOrientation:"none"')
    return 1
  }
  return orientation
}

/**
 * Downscale for the filmstrip and the recents grid. These are drawn straight to
 * a 2D canvas rather than going through the render graph, so the orientation has
 * to be baked in here.
 */
export async function makeThumbnail(
  bitmap: ImageBitmap,
  orientation: Orientation = 1,
  maxEdge = 320,
): Promise<Blob | null> {
  const upright = uprightSize(bitmap.width, bitmap.height, orientation)
  const scale = Math.min(1, maxEdge / Math.max(upright.width, upright.height))
  const w = Math.max(1, Math.round(upright.width * scale))
  const h = Math.max(1, Math.round(upright.height * scale))

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h })

  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) return null

  applyOrientationTransform(ctx, orientation, w, h)
  // Drawn in pre-rotation space: for a quarter turn the axes are swapped.
  const drawW = swapsAxes(orientation) ? h : w
  const drawH = swapsAxes(orientation) ? w : h
  ctx.drawImage(bitmap, 0, 0, drawW, drawH)

  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
  }
  return new Promise((resolve) =>
    (canvas as HTMLCanvasElement).toBlob(resolve, 'image/webp', 0.8),
  )
}

/** Set up a 2D context so that drawing at the origin lands upright. */
function applyOrientationTransform(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  orientation: Orientation,
  w: number,
  h: number,
) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break
    case 6: ctx.transform(0, 1, -1, 0, w, 0); break
    case 7: ctx.transform(0, -1, -1, 0, w, h); break
    case 8: ctx.transform(0, -1, 1, 0, 0, h); break
    default: break
  }
}

/**
 * Preview decoding budget. Editing a 100 MP file at full resolution wastes GPU
 * memory for a preview nobody can see at that size; export re-renders from the
 * original (spec §5, "Performance concern").
 */
export const MAX_PREVIEW_EDGE = 4096

export async function previewBitmap(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const longest = Math.max(bitmap.width, bitmap.height)
  if (longest <= MAX_PREVIEW_EDGE) return bitmap

  const scale = MAX_PREVIEW_EDGE / longest
  return createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  })
}
