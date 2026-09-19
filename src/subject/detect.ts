/**
 * Finding the subject of a photograph.
 *
 * A salient object detector — U²-Netp, Apache-2.0, see `public/models` — run
 * over a 320×320 copy of the picture. What comes back is a coarse map of where
 * the subject is, which `refine.ts` sharpens against the full-resolution image
 * before anything is drawn with it.
 *
 * ## Why this is not stored as pixels
 *
 * Every other mask in 35mm is a handful of numbers, and that is what lets a
 * local adjustment ride through a sidecar, IndexedDB and a batch sync with no
 * special serialiser. A detected mask is a bitmap, and writing one into a
 * sidecar would end that property for every mask, not just this one.
 *
 * So the edit stack stores the *intent* — "the subject, as this model sees it,
 * optionally the one under this point" — and the pixels are derived. They are
 * cached against the file and the model version, the way a developed raw is,
 * and re-derived when the cache misses. A subject mask therefore syncs across a
 * batch in the only way that means anything: each photo finds its own subject,
 * rather than inheriting the shape of somebody else's.
 *
 * ## Why the model is lazily loaded
 *
 * The runtime and the weights come to about 8 MB compressed, which is an order
 * of magnitude more than the rest of the app. Nobody pays that for opening a
 * photo: the import is dynamic, the worker is started on first use, and the
 * service worker keeps both afterwards. Whether to spend it is the user's
 * decision to make, once, and `MasksTool` asks before the first detection.
 */

/** What the model reads. Larger inputs cost quadratically and resolve no better. */
export const DETECT_SIZE = 320

/** Bumped whenever the model or the pre/post-processing changes, because a
 *  cached mask derived by the old one is no longer the same answer. */
export const DETECT_VERSION = 'u2netp@1'

export interface SubjectMap {
  /** One byte of coverage per pixel, row-major, `size` square. */
  data: Uint8ClampedArray
  size: number
}

export class SubjectDetectError extends Error {
  constructor(detail?: string) {
    super(`35mm could not find a subject${detail ? ` — ${detail}` : '.'}`)
    this.name = 'SubjectDetectError'
  }
}

/**
 * Generous, and for the same reason `decode-raw.ts` gives: the first call pays
 * for fetching and compiling several megabytes of WebAssembly, and a worker
 * that fails to start never rejects on its own.
 */
const DETECT_TIMEOUT_MS = 120_000

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./subject-worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

/**
 * Both assets are served from our own origin, under whatever base the build was
 * given — the site publishes to an apex domain but a subpath build has to work
 * too, so neither path may be absolute.
 */
function assetUrls() {
  const base = new URL(import.meta.env.BASE_URL, self.location.href)
  return {
    modelUrl: new URL('models/u2netp.onnx', base).href,
    wasmPath: new URL('ort/', base).href,
  }
}

/**
 * Whether the model has already been fetched, so the UI can tell the difference
 * between "this will cost a download" and "this is a second of compute".
 */
export async function isModelCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    const { modelUrl } = assetUrls()
    const hit = await caches.match(modelUrl)
    return Boolean(hit)
  } catch {
    return false
  }
}

/**
 * Scale the photo to what the model reads.
 *
 * Deliberately not the full-resolution frame: the network resolves 320×320
 * whatever it is handed, and giving it more only spends memory on an answer it
 * cannot express. The detail comes back in refinement, which reads the real
 * pixels.
 */
export async function subjectInput(source: ImageBitmap): Promise<ImageData> {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(DETECT_SIZE, DETECT_SIZE)
      : Object.assign(document.createElement('canvas'), {
          width: DETECT_SIZE,
          height: DETECT_SIZE,
        })

  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) throw new SubjectDetectError('this browser has no 2D canvas')

  // Stretched to square rather than letterboxed, which is how U²-Net was
  // trained and evaluated. The aspect is put back when the map is sampled.
  ctx.drawImage(source, 0, 0, DETECT_SIZE, DETECT_SIZE)
  return ctx.getImageData(0, 0, DETECT_SIZE, DETECT_SIZE)
}

export async function detectSubject(source: ImageBitmap): Promise<SubjectMap> {
  const image = await subjectInput(source)
  const active = getWorker()
  const id = crypto.randomUUID()
  const { modelUrl, wasmPath } = assetUrls()

  try {
    return await new Promise<SubjectMap>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined

      const onMessage = (event: MessageEvent) => {
        if (event.data?.id !== id) return
        clearTimeout(timer)
        active.removeEventListener('message', onMessage)
        if (event.data.ok) {
          resolve({ data: event.data.mask as Uint8ClampedArray, size: event.data.size as number })
        } else {
          reject(new Error(event.data.error ?? 'could not find a subject'))
        }
      }

      timer = setTimeout(() => {
        active.removeEventListener('message', onMessage)
        disposeSubjectDetector()
        reject(new Error('the detector did not respond'))
      }, DETECT_TIMEOUT_MS)

      active.addEventListener('message', onMessage)
      active.postMessage(
        { id, modelUrl, wasmPath, rgba: image.data, size: DETECT_SIZE },
        [image.data.buffer],
      )
    })
  } catch (err) {
    throw new SubjectDetectError(err instanceof Error ? err.message : undefined)
  }
}

export function disposeSubjectDetector() {
  worker?.terminate()
  worker = null
}
