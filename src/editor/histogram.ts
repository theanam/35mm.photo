import type { HistogramData } from './histogram-worker'

/** Main-thread client for the histogram worker; drops stale requests. */
export class HistogramClient {
  private worker: Worker | null = null
  private latest = ''
  private pending: ((data: HistogramData) => void) | null = null

  constructor() {
    try {
      this.worker = new Worker(new URL('./histogram-worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker.addEventListener('message', (event: MessageEvent) => {
        const { id, ...data } = event.data
        // A newer request has already been posted — this result is obsolete.
        if (id !== this.latest) return
        this.pending?.(data as HistogramData)
      })
    } catch (err) {
      console.warn('[35mm] histogram worker unavailable', err)
    }
  }

  onResult(fn: (data: HistogramData) => void) {
    this.pending = fn
  }

  compute(pixels: Uint8ClampedArray) {
    if (!this.worker) return
    const id = crypto.randomUUID()
    this.latest = id
    // Copy: the caller's buffer is reused each frame, and transferring it would
    // detach it out from under the renderer.
    const copy = pixels.slice().buffer
    this.worker.postMessage({ id, pixels: copy }, [copy])
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
  }
}

export type { HistogramData }
