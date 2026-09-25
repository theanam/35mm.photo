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
 * So the edit stack stores the *intent* — "the subject, as this model sees it"
 * — and the pixels are derived. They are cached against the file and the model
 * version, the way a developed raw is: in memory for the viewport, which cannot
 * wait on anything, and behind that in IndexedDB, so that closing a photo and
 * coming back to it — tomorrow, in a fresh tab — brings the mask back without
 * the model running again. They are re-derived only when both miss. A subject mask therefore syncs across a
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

import type { Mask } from '../editor/edit-stack/types'
import * as db from '../storage/indexeddb'

/** What the model reads. Larger inputs cost quadratically and resolve no better. */
export const DETECT_SIZE = 320

/**
 * What the refined map is stored at.
 *
 * Not the full frame. The map is sampled bilinearly by the shader and its
 * detail comes from the guided filter rather than from its own resolution, so
 * past about a thousand pixels the extra memory buys nothing anyone can see —
 * and four of these share one RGBA texture.
 */
export const REFINE_SIZE = 1024

/** Bumped whenever the model or the pre/post-processing changes, because a
 *  cached mask derived by the old one is no longer the same answer. */
export const DETECT_VERSION = 'u2netp@1'

export interface SubjectMap {
  /**
   * One byte of coverage per pixel, row-major, `size` square, in the stretched
   * upright uv the detector was shown — so uv (0..1) indexes it directly,
   * whatever the photograph's aspect.
   */
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
 * The model is served from our own origin, under whatever base the build was
 * given — the site publishes to an apex domain but a subpath build has to work
 * too, so this may not be absolute. The runtime needs no such handling: the
 * bundler emits its WebAssembly as an ordinary hashed asset.
 */
function modelUrl(): string {
  return new URL('models/u2netp.onnx', new URL(import.meta.env.BASE_URL, self.location.href)).href
}

/**
 * Whether the model has already been fetched, so the UI can tell the difference
 * between "this will cost a download" and "this is a second of compute".
 */
export async function isModelCached(): Promise<boolean> {
  // A detection already run this session is the most reliable answer, and the
  // only one available in dev — `pwa/register.ts` skips the service worker
  // there, so the Cache API is empty however many times the model has loaded.
  if (warm) return true
  if (typeof caches === 'undefined') return false
  try {
    const hit = await caches.match(modelUrl())
    return Boolean(hit)
  } catch {
    return false
  }
}

/**
 * A square copy of the photograph at a given size.
 *
 * Used twice: once small, for the model, and once larger, for the guide the
 * refinement follows. The model is never shown the full frame — it resolves
 * 320×320 whatever it is handed, so more only spends memory on an answer it
 * cannot express. The detail comes back from the guide, which is real pixels.
 */
function squareCopy(source: ImageBitmap, size: number): ImageData {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size })

  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) throw new SubjectDetectError('this browser has no 2D canvas')

  // Stretched to square rather than letterboxed, which is how U²-Net was
  // trained and evaluated. Keeping the guide in the same stretched space means
  // the refinement lines up with the map without either being resampled again.
  ctx.drawImage(source, 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size)
}

/** Rec. 709 luminance, which is what the guided filter follows. */
function lumaGuide(image: ImageData): Float32Array {
  const out = new Float32Array(image.width * image.height)
  const d = image.data
  for (let i = 0; i < out.length; i++) {
    out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
  }
  return out
}

export async function detectSubject(source: ImageBitmap): Promise<SubjectMap> {
  const image = squareCopy(source, DETECT_SIZE)
  const guide = lumaGuide(squareCopy(source, REFINE_SIZE))
  const active = getWorker()
  const id = crypto.randomUUID()

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
        {
          id,
          modelUrl: modelUrl(),
          rgba: image.data,
          size: DETECT_SIZE,
          guide,
          guideSize: REFINE_SIZE,
        },
        [image.data.buffer, guide.buffer],
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

/* ───────────────────────── derived maps, in memory ───────────────────────── */

/**
 * Coverage maps already derived this session, keyed by the photo and the model
 * that produced them.
 *
 * In memory and not in IndexedDB, deliberately for now. A durable cache would
 * mean a new object store and a schema version bump, and the last one of those
 * uncovered an `onblocked` path that left the app unable to open anything at
 * all — not a risk worth taking for a second of recompute. The cost is that
 * revisiting a photo re-runs the detector; the model itself stays loaded, so it
 * is the inference and not the download that is paid again.
 */
const derived = new Map<string, SubjectMap>()

/** Nothing here outlives the photos it describes. */
const MAX_DERIVED = 12

function cacheKey(frameId: string, model: string): string {
  return `${frameId}@${model}`
}

export function cachedSubject(frameId: string, model: string): SubjectMap | null {
  return derived.get(cacheKey(frameId, model)) ?? null
}

/**
 * Keep a map, in memory and on disk. The write-through is fire-and-forget: a
 * map that failed to persist is still the map on screen, and the worst case is
 * the detector running once more next time.
 */
export function rememberSubject(
  frameId: string,
  model: string,
  map: SubjectMap,
  persist = true,
): void {
  hold(frameId, model, map)
  if (persist) void db.saveSubject({ frameId, model, data: map.data, size: map.size })
}

function hold(frameId: string, model: string, map: SubjectMap): void {
  const key = cacheKey(frameId, model)
  derived.delete(key)
  derived.set(key, map)
  // Insertion order is iteration order, so the oldest is simply the first.
  while (derived.size > MAX_DERIVED) {
    const oldest = derived.keys().next().value
    if (oldest === undefined) break
    derived.delete(oldest)
  }
}

export function forgetSubjects(frameId?: string): void {
  if (!frameId) {
    derived.clear()
    return
  }
  for (const key of [...derived.keys()]) {
    if (key.startsWith(`${frameId}@`)) derived.delete(key)
  }
}

/** Find the subject, or hand back what was found earlier. */
/**
 * Coverage for every subject mask in a stack, in list order — which is the
 * order `packMasks` hands out texture channels in, so the two line up.
 *
 * Synchronous and cache-only, for the viewport, which redraws far too often to
 * start a model on. Anything not yet found comes back null and simply covers
 * nothing until it is.
 */
export function subjectMapsFor(masks: Mask[], frameId: string | null): (SubjectMap | null)[] {
  return masks
    .filter((m) => m.kind === 'subject')
    .map((m) => (frameId ? cachedSubject(frameId, m.model) : null))
}

/**
 * The same, but it will run the detector for anything missing.
 *
 * This is what an export calls. A mask that renders in the viewport and not in
 * the file would be the worst kind of wrong, so the resolution lives inside the
 * render path rather than at each call site where it can be forgotten — which
 * it duly was, by me, until an audit found exports dropping subject masks on
 * the floor.
 */
export async function ensureSubjectMaps(
  masks: Mask[],
  frameId: string,
  source: ImageBitmap,
): Promise<(SubjectMap | null)[]> {
  const out: (SubjectMap | null)[] = []
  for (const mask of masks) {
    if (mask.kind !== 'subject') continue
    try {
      out.push(await subjectFor(frameId, mask.model, source))
    } catch {
      // One mask that cannot be found must not fail the whole export; it
      // covers nothing, exactly as it does before it has been detected.
      out.push(null)
    }
  }
  return out
}

/** True once the model has been fetched and compiled at least once. */
export function modelIsWarm(): boolean {
  return warm
}

let warm = false

export async function subjectFor(
  frameId: string,
  model: string,
  source: ImageBitmap,
): Promise<SubjectMap> {
  const hit = cachedSubject(frameId, model) ?? (await restoreSubject(frameId, model))
  if (hit) return hit

  const map = await detectSubject(source)
  warm = true
  rememberSubject(frameId, model, map)
  return map
}

/** Bring a map back from disk into memory, if it was ever found. */
async function restoreSubject(frameId: string, model: string): Promise<SubjectMap | null> {
  const stored = await db.loadSubject(frameId, model)
  if (!stored) return null
  const map = { data: stored.data, size: stored.size }
  hold(frameId, model, map)
  return map
}

/**
 * Bring back every map a stack's subject masks were found with, and say which
 * masks are still uncovered afterwards. This is what opening a photo calls, so
 * a mask found last week draws on the first frame rather than sitting in the
 * list covering nothing — the "neither here nor there" state, where the edit is
 * plainly present and plainly not happening.
 */
export async function restoreSubjects(
  masks: Mask[],
  frameId: string,
): Promise<{ restored: number; missing: Mask[] }> {
  let restored = 0
  const missing: Mask[] = []
  for (const mask of masks) {
    if (mask.kind !== 'subject') continue
    if (cachedSubject(frameId, mask.model)) continue
    if (await restoreSubject(frameId, mask.model)) restored++
    else missing.push(mask)
  }
  return { restored, missing }
}
