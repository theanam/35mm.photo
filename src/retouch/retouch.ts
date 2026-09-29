/**
 * Retouching: turning the strokes in the edit stack into healed pixels.
 *
 * ## What is stored, and what is derived
 *
 * The same split as the subject mask. The edit stack holds each stroke as a
 * handful of numbers — where it runs, how big, where it heals from, and whether
 * it heals or fills — and the pixels are worked out from those against the
 * picture in hand. The preview heals the preview; an export heals the full
 * resolution file from the same numbers, rather than scaling up an answer that
 * was only ever 4096 pixels across.
 *
 * ## Why strokes chain
 *
 * Each stroke is healed from the picture as the strokes before it left it, the
 * way painting works: a second dab beside a first copies from the cleaned-up
 * skin, not from the spot the first one removed. So a stroke's result is keyed
 * by itself *and* everything under it, and changing one early stroke re-heals
 * the ones after it — which is a few milliseconds each, and a model run for
 * each fill.
 *
 * ## Heal or fill
 *
 * Healing copies texture from nearby and it is the right answer for most of
 * what a brush is put on: a spot, a speck of dust, a stray hair on skin or sky.
 * It stops working when there is nowhere nearby whose surroundings match — a
 * stroke across an edge, or over an object sitting on a busy ground — because
 * the copy then drags a seam or a smear in with it. `findSource` measures how
 * well the best source fits, and past its limit the stroke is filled by the
 * model instead. The choice is made once, when the stroke is drawn.
 */

import type { RetouchMode, RetouchStroke } from '../editor/edit-stack/types'
import type { Orientation } from '../io/exif'
import { brushBounds, type Brush, type Patch, type Rect, type SourcePlan } from './heal'
import { offsetToUpright, strokeToStored, type Picture } from './geometry'

import { FILL_MODEL, loadFillReady, saveFillReady } from './preference'

export { FILL_MODEL }

/**
 * Below this diameter, as a share of the picture's shorter edge, a stroke
 * always heals. A spot that small has surroundings a heal cannot get wrong by
 * enough to see, and a model run for it would be a second spent to change a
 * handful of pixels.
 */
const ALWAYS_HEAL_DIAMETER = 0.012

/** Context the model is shown around the hole, in multiples of its size. */
const FILL_CONTEXT = 0.75
const FILL_CONTEXT_MIN = 64

/** A patch in stored pixels of the buffer it was healed on. */
export type RetouchPatch = Patch

export interface RetouchResult {
  patches: RetouchPatch[]
  /** Changes whenever the patches do, so the renderer can skip a re-upload. */
  key: string
}

/* ─────────────────────────── workers ─────────────────────────── */

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

class Rpc {
  private worker: Worker | null = null
  private next = 1
  private pending = new Map<number, Pending>()

  constructor(private make: () => Worker) {}

  call<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker) {
      const worker = this.make()
      worker.addEventListener('message', (event: MessageEvent) => {
        const { id, ok, error, ...rest } = event.data
        const job = this.pending.get(id)
        if (!job) return
        this.pending.delete(id)
        if (ok) job.resolve(rest)
        else job.reject(new Error(error))
      })
      // A worker that fails to load never answers; fail everything waiting on
      // it and start a fresh one next time rather than hanging for good.
      worker.addEventListener('error', () => {
        for (const job of this.pending.values()) job.reject(new Error('the retouch worker stopped'))
        this.pending.clear()
        this.worker?.terminate()
        this.worker = null
      })
      this.worker = worker
    }
    const id = this.next++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.worker!.postMessage({ ...message, id }, transfer)
    })
  }
}

const healRpc = new Rpc(
  () => new Worker(new URL('./heal-worker.ts', import.meta.url), { type: 'module' }),
)
const fillRpc = new Rpc(
  () => new Worker(new URL('./fill-worker.ts', import.meta.url), { type: 'module' }),
)

function fillModelUrl(): string {
  return new URL('models/migan.onnx', new URL(import.meta.env.BASE_URL, self.location.href)).href
}

/** Set once a fill has run this session: the surest sign the model is here. */
let fillWarm = false

/**
 * Fetch the fill model and start its runtime, without filling anything. Run
 * when smart fill is switched on, so the download happens then, in view.
 */
export async function prepareFillModel(): Promise<void> {
  await tracked(fillRpc.call({ kind: 'load', modelUrl: fillModelUrl() }))
  fillWarm = true
  saveFillReady()
  // Ask the browser not to clear the model under storage pressure: it is the
  // one file here that is expensive to fetch again. Best-effort by nature.
  void navigator.storage?.persist?.().catch(() => {})
}

/** Whether the fill model has been fetched already, so asking for it costs no download. */
export async function isFillModelCached(): Promise<boolean> {
  if (fillWarm || loadFillReady()) return true
  if (typeof caches === 'undefined') return false
  try {
    return Boolean(await caches.match(fillModelUrl()))
  } catch {
    return false
  }
}

/* ─────────────────────────── busy ─────────────────────────── */

let busy = 0
const busyListeners = new Set<(busy: boolean) => void>()

/** Told when retouching starts and stops working, so the panel can say so. */
export function onRetouchBusy(listener: (busy: boolean) => void): () => void {
  busyListeners.add(listener)
  listener(busy > 0)
  return () => busyListeners.delete(listener)
}

async function tracked<T>(work: Promise<T>): Promise<T> {
  if (busy++ === 0) for (const l of busyListeners) l(true)
  try {
    return await work
  } finally {
    if (--busy === 0) for (const l of busyListeners) l(false)
  }
}

/* ─────────────────────────── pixels ─────────────────────────── */

let scratch: OffscreenCanvas | HTMLCanvasElement | null = null

/**
 * One rectangle of the picture as the strokes so far have left it: the source
 * pixels, with every earlier patch that reaches into it laid over them.
 */
function readRegion(source: ImageBitmap, rect: Rect, under: RetouchPatch[]): Uint8ClampedArray {
  const w = rect.x1 - rect.x0
  const h = rect.y1 - rect.y0
  if (!scratch) {
    scratch =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h })
  }
  if (scratch.width < w) scratch.width = w
  if (scratch.height < h) scratch.height = h
  const ctx = scratch.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!ctx) throw new Error('this browser has no 2D canvas')

  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, rect.x0, rect.y0, w, h, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  for (const p of under) {
    const x0 = Math.max(rect.x0, p.x)
    const y0 = Math.max(rect.y0, p.y)
    const x1 = Math.min(rect.x1, p.x + p.width)
    const y1 = Math.min(rect.y1, p.y + p.height)
    if (x1 <= x0 || y1 <= y0) continue
    for (let y = y0; y < y1; y++) {
      const from = ((y - p.y) * p.width + (x0 - p.x)) * 4
      data.set(p.data.subarray(from, from + (x1 - x0) * 4), ((y - rect.y0) * w + (x0 - rect.x0)) * 4)
    }
  }
  return data
}

function clip(rect: Rect, width: number, height: number): Rect {
  return {
    x0: Math.max(0, Math.floor(rect.x0)),
    y0: Math.max(0, Math.floor(rect.y0)),
    x1: Math.min(width, Math.ceil(rect.x1)),
    y1: Math.min(height, Math.ceil(rect.y1)),
  }
}

function grow(rect: Rect, by: number): Rect {
  return { x0: rect.x0 - by, y0: rect.y0 - by, x1: rect.x1 + by, y1: rect.y1 + by }
}

function union(a: Rect, b: Rect): Rect {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

function localBrush(brush: Brush, rect: Rect): Brush {
  return {
    ...brush,
    points: brush.points.map((v, i) => v - (i % 2 === 0 ? rect.x0 : rect.y0)),
  }
}

function pictureOf(source: ImageBitmap, orientation: Orientation): Picture {
  return { orientation, storedWidth: source.width, storedHeight: source.height }
}

/* ─────────────────────────── one stroke ─────────────────────────── */

async function healStroke(
  source: ImageBitmap,
  stroke: RetouchStroke,
  picture: Picture,
  under: RetouchPatch[],
): Promise<RetouchPatch | null> {
  const b = strokeToStored(stroke, picture)
  const brush = { points: b.points, radius: b.radius, feather: b.feather }
  const box = brushBounds(brush, Infinity, Infinity)
  const shifted = { x0: box.x0 + b.dx, y0: box.y0 + b.dy, x1: box.x1 + b.dx, y1: box.y1 + b.dy }
  const rect = clip(grow(union(box, shifted), 2), picture.storedWidth, picture.storedHeight)
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return null

  const rgba = readRegion(source, rect, under)
  const { patch } = await healRpc.call<{ patch: RetouchPatch | null }>(
    {
      kind: 'heal',
      rgba,
      width: rect.x1 - rect.x0,
      height: rect.y1 - rect.y0,
      brush: localBrush(brush, rect),
      dx: b.dx,
      dy: b.dy,
    },
    [rgba.buffer],
  )
  return patch ? { ...patch, x: patch.x + rect.x0, y: patch.y + rect.y0 } : null
}

async function fillStroke(
  source: ImageBitmap,
  stroke: RetouchStroke,
  picture: Picture,
  under: RetouchPatch[],
): Promise<RetouchPatch | null> {
  const b = strokeToStored(stroke, picture)
  const brush = { points: b.points, radius: b.radius, feather: b.feather }
  const box = brushBounds(brush, Infinity, Infinity)
  const size = Math.max(box.x1 - box.x0, box.y1 - box.y0)
  const rect = clip(
    grow(box, Math.max(FILL_CONTEXT_MIN, size * FILL_CONTEXT)),
    picture.storedWidth,
    picture.storedHeight,
  )
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return null

  const rgba = readRegion(source, rect, under)
  const { patch } = await fillRpc.call<{ patch: RetouchPatch | null }>(
    {
      kind: 'fill',
      modelUrl: fillModelUrl(),
      rgba,
      width: rect.x1 - rect.x0,
      height: rect.y1 - rect.y0,
      brush: localBrush(brush, rect),
    },
    [rgba.buffer],
  )
  fillWarm = true
  return patch ? { ...patch, x: patch.x + rect.x0, y: patch.y + rect.y0 } : null
}

/* ─────────────────────────── the chain ─────────────────────────── */

interface Link {
  sig: string
  patch: RetouchPatch | null
}

/** Per picture and resolution: the chain of results, in stroke order. */
const chains = new Map<string, Link[]>()
/** Enough for the open photo, its export and a couple of neighbours. */
const MAX_CHAINS = 6

const inflight = new Map<string, Promise<RetouchPatch | null>>()

/** A short, stable fingerprint of a string. FNV-1a; collisions are not a concern at this size. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** The mode a stroke is actually rendered with, given whether the model may be used. */
function effectiveMode(stroke: RetouchStroke, allowFill: boolean): RetouchMode {
  return stroke.mode === 'fill' && allowFill ? 'fill' : 'heal'
}

function chainFor(key: string): Link[] {
  let chain = chains.get(key)
  if (chain) {
    // Refresh its place: a Map iterates in insertion order, so the oldest is first.
    chains.delete(key)
    chains.set(key, chain)
    return chain
  }
  chain = []
  chains.set(key, chain)
  while (chains.size > MAX_CHAINS) chains.delete(chains.keys().next().value!)
  return chain
}

let fillFailed: ((message: string) => void) | null = null

/** Told once each time a fill has to fall back to a heal. */
export function onFillFallback(listener: (message: string) => void) {
  fillFailed = listener
}

/**
 * The healed pixels for a picture's strokes, as patches over `source`.
 *
 * `frameKey` names the picture; the resolution is taken from `source`, so the
 * preview and an export of the same photo never share an answer.
 */
export async function retouchPatches(
  source: ImageBitmap,
  orientation: Orientation,
  strokes: RetouchStroke[],
  frameKey: string,
  allowFill: boolean,
): Promise<RetouchResult> {
  if (!strokes.length) return { patches: [], key: '' }

  const picture = pictureOf(source, orientation)
  const chainKey = `${frameKey}|${source.width}x${source.height}`
  const chain = chainFor(chainKey)
  const patches: RetouchPatch[] = []
  let sig = chainKey

  return tracked(
    (async () => {
      for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i]
        const mode = effectiveMode(stroke, allowFill)
        sig = fingerprint(`${sig}|${mode}|${JSON.stringify(stroke)}`)

        let link = chain[i]
        if (!link || link.sig !== sig) {
          const job = `${chainKey}|${sig}`
          let work = inflight.get(job)
          if (!work) {
            const under = patches.slice()
            work = (async () => {
              if (mode === 'fill') {
                try {
                  return await fillStroke(source, stroke, picture, under)
                } catch (err) {
                  fillFailed?.(err instanceof Error ? err.message : 'the fill model could not run')
                }
              }
              return healStroke(source, stroke, picture, under)
            })()
            inflight.set(job, work)
            work.finally(() => inflight.delete(job)).catch(() => {})
          }
          link = { sig, patch: await work }
          chain[i] = link
        }
        if (link.patch) patches.push(link.patch)
      }
      chain.length = strokes.length
      return { patches, key: sig }
    })(),
  )
}

/* ─────────────────────────── a new stroke ─────────────────────────── */

export interface PlannedStroke {
  mode: RetouchMode
  dx: number
  dy: number
  model?: string
}

/**
 * Where a new stroke should heal from, and whether it should heal at all.
 *
 * Searched for on the picture as the strokes already there have left it, so a
 * stroke laid beside an earlier one does not copy the spot that one removed.
 */
export async function planStroke(
  source: ImageBitmap,
  orientation: Orientation,
  existing: RetouchStroke[],
  stroke: Pick<RetouchStroke, 'points' | 'size' | 'feather'>,
  frameKey: string,
  allowFill: boolean,
): Promise<PlannedStroke> {
  const picture = pictureOf(source, orientation)
  const { patches } = await retouchPatches(source, orientation, existing, frameKey, allowFill)

  const b = strokeToStored({ ...stroke, id: '', enabled: true, mode: 'heal', dx: 0, dy: 0 }, picture)
  const brush = { points: b.points, radius: b.radius, feather: b.feather }
  const box = brushBounds(brush, Infinity, Infinity)
  // As far as `findSource` will look: its outermost ring is three times the
  // stroke's extent, plus the ring it compares around the source.
  const reach = Math.max(box.x1 - box.x0, box.y1 - box.y0) * 3
  const rect = clip(grow(box, reach + 12), picture.storedWidth, picture.storedHeight)

  const rgba = readRegion(source, rect, patches)
  const { plan } = await tracked(
    healRpc.call<{ plan: SourcePlan | null }>(
      {
        kind: 'plan',
        rgba,
        width: rect.x1 - rect.x0,
        height: rect.y1 - rect.y0,
        brush: localBrush(brush, rect),
      },
      [rgba.buffer],
    ),
  )

  const at: [number, number] = [stroke.points[0] ?? 0, stroke.points[1] ?? 0]
  // Nowhere to heal from at all — a stroke over most of the frame. Something
  // has to be stored, so the fallback copies from beside the stroke.
  const offset = plan
    ? offsetToUpright(at, plan.dx, plan.dy, picture)
    : offsetToUpright(at, Math.round(b.radius * 2.5), 0, picture)

  const small = stroke.size * 2 < ALWAYS_HEAL_DIAMETER
  const holds = plan !== null && plan.score <= 1
  const mode: RetouchMode = allowFill && !small && !holds ? 'fill' : 'heal'
  return mode === 'fill' ? { mode, ...offset, model: FILL_MODEL } : { mode, ...offset }
}
