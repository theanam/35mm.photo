import LibRaw from 'libraw-wasm'
import type { DecodedImage, OnStage } from '../io/decode'
import { RawDecodeError } from '../io/decode'
import { extensionOf } from '../io/formats'

/**
 * Raw pipeline (spec §5), backed by a LibRaw build compiled to WASM.
 *
 * `libraw-wasm` runs the decode in a worker of its own, which is the reason
 * this module no longer owns one: a second worker around it would only nest
 * another message hop around the same off-thread work (spec §3.3).
 *
 * The embedded JPEG preview is still never used as the picture — §5.4 rules it
 * out, and a failed decode has to read as a failure rather than quietly handing
 * back an 8-bit camera render.
 */

/**
 * Development settings. These decide what a raw looks like the instant it
 * opens, before the edit stack touches it, so they lean neutral: the camera's
 * own white balance, no auto-exposure stretch, and LibRaw's default BT.709
 * transfer so the result is display-referred like every other format the app
 * decodes.
 */
const SETTINGS = {
  /** 16 bits per channel; the preview is knocked down to 8 below, export is not. */
  outputBps: 16,
  /** sRGB primaries, matching the working space of the render graph. */
  outputColor: 1,
  /** As-shot white balance. Without it LibRaw invents its own and every file
   *  opens on a different cast than the camera showed on the back screen. */
  useCameraWb: true,
  /**
   * Leave the exposure alone. LibRaw's auto-brighten stretches the histogram by
   * a clipped-pixel percentile, which is a per-file guess — the Light tool and
   * `tools/auto.ts` are where that decision belongs.
   */
  noAutoBright: true,
  /**
   * AHD for Bayer sensors. LibRaw routes X-Trans past this to Markesteijn
   * regardless, taking a quality above 10 as the signal for the slower 3-pass
   * variant, so this also picks 1-pass Markesteijn for Fujifilm RAF.
   */
  userQual: 3,
  /**
   * Let LibRaw apply the camera's rotation. Every vendor records it somewhere
   * different, and RAF in particular is not a TIFF container, so `io/exif.ts`
   * cannot be trusted to find the tag. The pixels therefore arrive upright and
   * the meta below reports orientation 1 rather than asking the render graph to
   * rotate them a second time.
   */
  userFlip: -1,
} as const

/**
 * Ceiling on a single decode. Generous — a 26 MP X-Trans frame takes about ten
 * seconds through Markesteijn on a laptop — because this is not a performance
 * budget. It is here because `libraw-wasm` never rejects when its worker fails
 * to start: the call simply never settles, and since it serialises every later
 * call behind that one, a decoder that cannot load would wedge the app for the
 * rest of the session with nothing on screen to say so.
 */
const DECODE_TIMEOUT_MS = 120_000

let decoder: LibRaw | null = null

function getDecoder(): LibRaw {
  if (!decoder) decoder = new LibRaw()
  return decoder
}

/** Reject rather than hang, and take the wedged worker down with it. */
function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      disposeRawDecoder()
      reject(new Error('the decoder did not respond'))
    }, DECODE_TIMEOUT_MS)

    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

let previewWorker: Worker | null = null

function getPreviewWorker(): Worker {
  if (!previewWorker) {
    previewWorker = new Worker(new URL('./preview-worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return previewWorker
}

export async function decodeRaw(file: File, onStage?: OnStage): Promise<DecodedImage> {
  const ext = extensionOf(file.name)
  onStage?.('reading')
  const bytes = new Uint8Array(await file.arrayBuffer())

  let image: Awaited<ReturnType<LibRaw['imageData']>>
  let metadata: Awaited<ReturnType<LibRaw['metadata']>>
  try {
    const libraw = getDecoder()
    onStage?.('developing')
    await withTimeout(libraw.open(bytes, SETTINGS))
    // Read the metadata first: once `imageData()` has transferred its buffer out
    // of the worker there is nothing left to ask about the file. The `true` asks
    // for the full block, which is the only one carrying `lens`.
    metadata = await withTimeout(libraw.metadata(true))
    image = await withTimeout(libraw.imageData())
  } catch (err) {
    // A camera whose compression this build has no decoder for lands here, as
    // does a truncated or misnamed file. The distinction is not ours to make.
    throw new RawDecodeError(ext, err instanceof Error ? err.message : undefined)
  }

  if (!image?.data || !image.width || !image.height) {
    throw new RawDecodeError(ext)
  }

  onStage?.('preview')
  const bitmap = await toPreviewBitmap(image)

  return {
    bitmap,
    meta: {
      name: file.name,
      ext,
      isRaw: true,
      width: image.width,
      height: image.height,
      // Already applied by LibRaw — see `userFlip` above.
      orientation: 1,
      bytes: file.size,
      ...shotDetails(metadata),
    },
  }
}

/**
 * LibRaw hands back tightly packed channels — three of them for nearly every
 * camera, four only for the sensors that carry a second green or an emerald.
 * `preview-worker.ts` does the rewrite into RGBA, off the main thread.
 *
 * The 16-bit buffer is dropped rather than kept for export, which re-renders
 * from the edit stack. Holding a second full-resolution copy of a 60 MP frame
 * to serve a path that does not read it would cost more than it buys.
 */
function toPreviewBitmap(image: {
  width: number
  height: number
  colors: number
  bits: number
  data: Uint8Array | Uint16Array
}): Promise<ImageBitmap> {
  const worker = getPreviewWorker()
  const id = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      worker.removeEventListener('message', onMessage)
      if (event.data.ok) resolve(event.data.bitmap as ImageBitmap)
      else reject(new Error(event.data.error ?? 'could not build the preview'))
    }
    worker.addEventListener('message', onMessage)

    worker.postMessage(
      {
        id,
        width: image.width,
        height: image.height,
        colors: image.colors,
        bits: image.bits,
        data: image.data,
      },
      [image.data.buffer],
    )
  })
}

/** The as-shot fields `ImageMeta` advertises, where LibRaw could read them. */
function shotDetails(metadata: Awaited<ReturnType<LibRaw['metadata']>>) {
  if (!metadata) return {}

  const camera = [metadata.camera_make, metadata.camera_model]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim()

  return {
    ...(metadata.iso_speed ? { iso: Math.round(metadata.iso_speed) } : {}),
    ...(camera ? { camera } : {}),
    ...(metadata.lens?.Lens ? { lens: String(metadata.lens.Lens).trim() } : {}),
    ...(metadata.timestamp instanceof Date && !Number.isNaN(metadata.timestamp.valueOf())
      ? { shotAt: metadata.timestamp.valueOf() }
      : {}),
  }
}

export function disposeRawDecoder() {
  decoder?.dispose()
  decoder = null
  previewWorker?.terminate()
  previewWorker = null
}
