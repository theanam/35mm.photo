import LibRaw from 'libraw-wasm'
import type { DecodedImage, OnStage } from '../io/decode'
import { RawDecodeError } from '../io/decode'
import { extensionOf } from '../io/formats'
import { librawSettings } from './develop-settings'
import { defaultRawDevelop } from '../editor/edit-stack/defaults'
import type { RawDevelopState } from '../editor/edit-stack/types'

/**
 * Raw pipeline (spec §5), backed by a LibRaw build compiled to WASM.
 *
 * What the decoder is told to do comes in as a `RawDevelopState` rather than
 * being fixed here; `develop-settings.ts` owns the translation into LibRaw's
 * own flags, and the reasoning about which of them a photographer should be
 * given at all.
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

/**
 * One decode at a time.
 *
 * There is a single LibRaw instance behind `getDecoder`, and a decode is three
 * awaited calls against it — open, metadata, then the pixels. Let a second
 * decode start in the middle of that and it replaces the file the first one is
 * still reading, which surfaces as the first photo failing with "the camera may
 * use a compression this build does not decode". A misleading error about the
 * wrong file.
 *
 * This used to be unreachable: the loading overlay covered the whole window, so
 * there was nothing to click during a develop. Now that the indicator sits in a
 * corner and leaves the filmstrip live — which is the point of it — clicking
 * another photo mid-develop is an ordinary thing to do, and it has to work.
 */
let decodeQueue: Promise<unknown> = Promise.resolve()

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  // Run whether or not the previous decode succeeded, and never let its outcome
  // reach the next caller.
  const run = decodeQueue.then(work, work)
  decodeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
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

export async function decodeRaw(
  file: File,
  onStage?: OnStage,
  develop: RawDevelopState = defaultRawDevelop(),
): Promise<DecodedImage> {
  const ext = extensionOf(file.name)
  onStage?.('reading')
  const bytes = new Uint8Array(await file.arrayBuffer())

  let image: Awaited<ReturnType<LibRaw['imageData']>>
  let metadata: Awaited<ReturnType<LibRaw['metadata']>>
  try {
    ;({ image, metadata } = await oneAtATime(async () => {
      const libraw = getDecoder()
      onStage?.('developing')
      await withTimeout(libraw.open(bytes, librawSettings(develop)))
      // Read the metadata first: once `imageData()` has transferred its buffer
      // out of the worker there is nothing left to ask about the file. The
      // `true` asks for the full block, which is the only one carrying `lens`.
      const meta = await withTimeout(libraw.metadata(true))
      return { image: await withTimeout(libraw.imageData()), metadata: meta }
    }))
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
