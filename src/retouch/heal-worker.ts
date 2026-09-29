/// <reference lib="webworker" />

import { brushCoverage, cutPatch, findSource, heal, type Brush } from './heal'

/**
 * Healing, off the main thread. Each job is a few milliseconds on a preview,
 * but an export heals the same strokes at full resolution, and a long stroke
 * there is a membrane over a hundred thousand pixels.
 */
interface PlanRequest {
  kind: 'plan'
  id: number
  rgba: Uint8ClampedArray
  width: number
  height: number
  brush: Brush
}

interface HealRequest {
  kind: 'heal'
  id: number
  rgba: Uint8ClampedArray
  width: number
  height: number
  brush: Brush
  dx: number
  dy: number
}

self.addEventListener('message', (event: MessageEvent<PlanRequest | HealRequest>) => {
  const request = event.data
  try {
    const img = { data: request.rgba, width: request.width, height: request.height }
    const alpha = brushCoverage(request.brush, request.width, request.height)

    if (request.kind === 'plan') {
      const plan = findSource(img, alpha, request.brush.radius)
      self.postMessage({ id: request.id, ok: true, plan })
      return
    }

    const patch = cutPatch(heal(img, alpha, request.dx, request.dy), alpha, request.width, request.height)
    self.postMessage({ id: request.id, ok: true, patch }, patch ? [patch.data.buffer] : [])
  } catch (err) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : 'the heal failed',
    })
  }
})
