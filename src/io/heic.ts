import type { DecodedImage, OnStage } from './decode'
import { extensionOf } from './formats'
import { readShotInfo } from './exif-tags'

/**
 * HEIC and HEIF stills, by whichever decoder this browser can offer.
 *
 * Two of them, in order of preference:
 *
 * 1. **The browser's own.** Safari and every browser on iOS decode HEIC through
 *    the operating system — free, hardware-accelerated, already installed. HEIC
 *    being the iPhone's default, that covers a great many of the files that
 *    will ever be dropped here, and on those browsers this module costs a try
 *    and a catch.
 * 2. **libheif compiled to WASM**, fetched on demand. Chrome, Edge and Firefox
 *    have all declined to ship an HEIC decoder — the format rests on HEVC, and
 *    its licensing is the reason they carry AVIF instead — so on those there is
 *    nothing to fall back on but a decoder of our own.
 *
 * Which is why the fallback is behind a dynamic import, and the import behind a
 * worker: the megabytes of WASM are fetched only by the people who open a HEIC
 * on a browser that needs it, never as part of the initial load, and never at
 * all on a Mac. The service worker caches it on first use like any other asset,
 * so it is one download, once.
 *
 * Trying the browser first and catching the failure is deliberate, rather than
 * asking in advance whether it can. There is no honest way to ask: HEIC has no
 * `canPlayType`, and the usual trick of decoding a tiny sample costs a decode
 * to learn what the real decode is about to tell us anyway.
 */

/**
 * A HEIC neither decoder could open. Distinct from `UnsupportedFormatError`,
 * which says the format is not one we handle: this says it is, and this file
 * still did not come out.
 */
export class HeicDecodeError extends Error {
  constructor(
    public readonly ext: string,
    public readonly detail?: string,
  ) {
    super(
      `35mm could not decode this .${ext.toUpperCase()} file` +
        (detail ? ` — ${detail}` : '. It may be a burst, a video still, or damaged.'),
    )
    this.name = 'HeicDecodeError'
  }
}

/**
 * Ceiling on one decode, for the reason `decode-raw.ts` gives: a worker that
 * fails to start never rejects on its own, and a decode that simply never
 * settles leaves the app waiting with nothing on screen to say so. Lower than
 * the raw budget — a phone photo is a fraction of the work a Markesteijn
 * demosaic is — but generous enough for the first call, which pays for
 * fetching and compiling the WASM as well as for the picture.
 */
const DECODE_TIMEOUT_MS = 60_000

export async function decodeHeic(file: File, onStage?: OnStage): Promise<DecodedImage> {
  const ext = extensionOf(file.name)

  onStage?.('reading')
  let bitmap = await decodeNatively(file)

  if (!bitmap) {
    onStage?.('decoding')
    bitmap = await decodeWithLibheif(file, ext)
  }

  // The camera, lens, ISO and date, read out of the `meta` box by `exif.ts`.
  // Orientation is not among them, and deliberately: both decoders above apply
  // the container's rotation themselves, so the bitmap is already upright.
  const shot = await readShotInfo(file)

  return {
    bitmap,
    meta: {
      name: file.name,
      ext,
      isRaw: false,
      ...shot,
      width: bitmap.width,
      height: bitmap.height,
      orientation: 1,
      bytes: file.size,
    },
  }
}

/**
 * `imageOrientation: 'none'` for the same reason the JPEG path passes it — the
 * EXIF tag is the render graph's to apply, not the decoder's. It does not stop
 * a decoder applying the container's own `irot`, which is not orientation
 * metadata but part of how the item decodes.
 */
async function decodeNatively(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, {
      colorSpaceConversion: 'default',
      imageOrientation: 'none',
    })
  } catch {
    return null
  }
}

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./heic-worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

async function decodeWithLibheif(file: File, ext: string): Promise<ImageBitmap> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const active = getWorker()
  const id = crypto.randomUUID()

  try {
    return await new Promise<ImageBitmap>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      const onMessage = (event: MessageEvent) => {
        // The worker is shared, so a reply for another open is not ours.
        if (event.data?.id !== id) return
        clearTimeout(timer)
        active.removeEventListener('message', onMessage)
        if (event.data.ok) resolve(event.data.bitmap as ImageBitmap)
        else reject(new Error(event.data.error ?? 'could not decode the file'))
      }

      timer = setTimeout(() => {
        active.removeEventListener('message', onMessage)
        // Take the wedged worker down with it; the next open starts a fresh one.
        disposeHeicDecoder()
        reject(new Error('the decoder did not respond'))
      }, DECODE_TIMEOUT_MS)

      active.addEventListener('message', onMessage)

      // The bytes are transferred, so this hop costs no copy — and the buffer
      // is not read again on this side afterwards.
      active.postMessage({ id, bytes }, [bytes.buffer])
    })
  } catch (err) {
    throw new HeicDecodeError(ext, err instanceof Error ? err.message : undefined)
  }
}

export function disposeHeicDecoder() {
  worker?.terminate()
  worker = null
}
