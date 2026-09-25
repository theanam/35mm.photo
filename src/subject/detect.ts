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

import type { Mask, SubjectMask } from '../editor/edit-stack/types'
import * as db from '../storage/indexeddb'
import { edgeOptions, type EdgeOptions } from './refine'

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
export const DETECT_VERSION = 'u2netp@2'

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

/**
 * Run the model. What comes back is the coarse map — the model's answer at its
 * own resolution, before anything has been done to it. Refinement is a
 * separate job (`refineFor`) because it is the part that has controls.
 */
export async function detectSubject(source: ImageBitmap): Promise<SubjectMap> {
  const image = squareCopy(source, DETECT_SIZE)
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
        { kind: 'detect', id, modelUrl: modelUrl(), rgba: image.data, size: DETECT_SIZE },
        [image.data.buffer],
      )
    })
  } catch (err) {
    throw new SubjectDetectError(err instanceof Error ? err.message : undefined)
  }
}

/** Re-cut a coarse map along the picture, in the worker, with these settings. */
async function refineInWorker(
  coarse: SubjectMap,
  guide: Float32Array,
  edge: EdgeOptions,
): Promise<SubjectMap> {
  const active = getWorker()
  const id = crypto.randomUUID()
  // Copies, not transfers: both stay cached here for the next slider move.
  const coarseCopy = coarse.data.slice()
  const guideCopy = guide.slice()

  return new Promise<SubjectMap>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      clearTimeout(timer)
      active.removeEventListener('message', onMessage)
      if (event.data.ok) {
        resolve({ data: event.data.mask as Uint8ClampedArray, size: event.data.size as number })
      } else {
        reject(new Error(event.data.error ?? 'could not refine the subject'))
      }
    }
    timer = setTimeout(() => {
      active.removeEventListener('message', onMessage)
      reject(new Error('the refinement did not respond'))
    }, DETECT_TIMEOUT_MS)

    active.addEventListener('message', onMessage)
    active.postMessage(
      {
        kind: 'refine',
        id,
        coarse: coarseCopy,
        coarseSize: coarse.size,
        guide: guideCopy,
        guideSize: REFINE_SIZE,
        edge,
      },
      [coarseCopy.buffer, guideCopy.buffer],
    )
  })
}

export function disposeSubjectDetector() {
  worker?.terminate()
  worker = null
}

/* ───────────────────────── derived maps, in memory ───────────────────────── */

/**
 * Three things are kept, because they change at three different rates.
 *
 * The coarse map is the model's answer: one per photo per model, expensive,
 * and the thing that is written to IndexedDB. The guide is the picture's own
 * luminance at the refinement size: one per photo, cheap to make, too big to
 * be worth storing. The refined map is what the shader samples: one per
 * photo per model *per edge setting*, milliseconds to make, and remade every
 * time a slider moves.
 */
const derived = new Map<string, SubjectMap>()
const guides = new Map<string, Float32Array>()
const refined = new Map<string, SubjectMap>()

/**
 * The map each mask last drew with, whatever its settings were then. While a
 * new setting is still being refined the viewport draws this, so a slider
 * moves the edge rather than blinking the whole mask out and back.
 */
const latest = new Map<string, SubjectMap>()

/** Nothing here outlives the photos it describes. */
const MAX_DERIVED = 12
const MAX_REFINED = 24

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
    guides.clear()
    refined.clear()
    latest.clear()
    return
  }
  for (const key of [...derived.keys()]) {
    if (key.startsWith(`${frameId}@`)) derived.delete(key)
  }
  for (const key of [...refined.keys()]) {
    if (key.startsWith(`${frameId}@`)) refined.delete(key)
  }
  guides.delete(frameId)
  // Masks belong to one photo, and the photo is going: nothing left in here
  // will be asked for by a mask that still exists.
  latest.clear()
}

/* ───────────────────────── refinement ───────────────────────── */

function refinedKey(frameId: string, mask: SubjectMask): string {
  const edge = edgeOptions(mask.detail, mask.shift)
  return `${frameId}@${mask.model}@${edge.radius}@${edge.eps}@${edge.shift}`
}

/** The guide for a photo, made once from its pixels and kept for the session. */
function guideFor(frameId: string, source: ImageBitmap): Float32Array {
  const hit = guides.get(frameId)
  if (hit) return hit
  const guide = lumaGuide(squareCopy(source, REFINE_SIZE))
  guides.set(frameId, guide)
  return guide
}

function holdRefined(key: string, mask: SubjectMask, map: SubjectMap): void {
  refined.delete(key)
  refined.set(key, map)
  latest.set(mask.id, map)
  while (refined.size > MAX_REFINED) {
    const oldest = refined.keys().next().value
    if (oldest === undefined) break
    refined.delete(oldest)
  }
}

/**
 * The map a mask draws with, found and refined, running whatever is missing.
 * What an export and a deliberate "find the subject" call.
 */
export async function refineFor(
  mask: SubjectMask,
  frameId: string,
  source: ImageBitmap,
): Promise<SubjectMap> {
  const key = refinedKey(frameId, mask)
  const hit = refined.get(key)
  if (hit) return hit
  const coarse = await subjectFor(frameId, mask.model, source)
  const guide = guideFor(frameId, source)
  const map = await refineInWorker(coarse, guide, edgeOptions(mask.detail, mask.shift))
  holdRefined(key, mask, map)
  return map
}

/*
 * Refinement asked for by the viewport, which cannot wait. One job in flight
 * per mask and at most one waiting behind it — the most recent — so a slider
 * dragged through fifty values costs two refinements, not fifty, and the
 * second lands on where the slider stopped.
 */
const inFlight = new Set<string>()
const queued = new Map<string, { mask: SubjectMask; frameId: string }>()
const listeners = new Set<() => void>()

/** Told whenever a refined map lands, so the viewport can redraw with it. */
export function onSubjectMapsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function scheduleRefine(mask: SubjectMask, frameId: string): void {
  if (refined.has(refinedKey(frameId, mask))) return
  const coarse = cachedSubject(frameId, mask.model)
  const guide = guides.get(frameId)
  // Nothing to refine from yet; detection, or a restore, will come round again.
  if (!coarse || !guide) return

  if (inFlight.has(mask.id)) {
    queued.set(mask.id, { mask, frameId })
    return
  }
  inFlight.add(mask.id)
  const key = refinedKey(frameId, mask)
  void refineInWorker(coarse, guide, edgeOptions(mask.detail, mask.shift))
    .then((map) => {
      holdRefined(key, mask, map)
      for (const fn of listeners) fn()
    })
    .catch(() => {
      // Left uncached: the next redraw asks again, and the fallback draws
      // meanwhile.
    })
    .finally(() => {
      inFlight.delete(mask.id)
      const next = queued.get(mask.id)
      queued.delete(mask.id)
      if (next) scheduleRefine(next.mask, next.frameId)
    })
}

/**
 * Coverage for every subject mask in a stack, in list order — which is the
 * order `packMasks` hands out texture channels in, so the two line up.
 *
 * Synchronous and cache-only, for the viewport, which redraws far too often to
 * wait on anything. A mask whose settings have just changed draws with the map
 * it had while the new one is made; one not yet found comes back null and
 * simply covers nothing until it is.
 */
export function subjectMapsFor(masks: Mask[], frameId: string | null): (SubjectMap | null)[] {
  return masks
    .filter((m): m is SubjectMask => m.kind === 'subject')
    .map((m) => {
      if (!frameId) return null
      const ready = refined.get(refinedKey(frameId, m))
      if (ready) return ready
      scheduleRefine(m, frameId)
      return latest.get(m.id) ?? null
    })
}

/**
 * Make the guide for a photo and set every restored mask refining, so the
 * first frames after opening draw the mask rather than wait for a redraw
 * that nothing would trigger. The work itself is what `subjectMapsFor` would
 * have started; this only starts it sooner.
 */
export function primeSubjects(masks: Mask[], frameId: string, source: ImageBitmap): void {
  const subjects = masks.filter((m): m is SubjectMask => m.kind === 'subject')
  if (!subjects.some((m) => cachedSubject(frameId, m.model))) return
  guideFor(frameId, source)
  for (const mask of subjects) scheduleRefine(mask, frameId)
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
      out.push(await refineFor(mask, frameId, source))
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
