import type { UpscaleBackend } from './tiles'

/**
 * The main-thread side of upscaling: which backend this browser has, where
 * the model lives, and a call that hands a bitmap to the worker and gets a
 * bigger one back.
 */

/**
 * WebGPU when this browser can actually hand out an adapter, the CPU
 * otherwise. `navigator.gpu` existing says nothing — it is there with WebGPU
 * switched off — so the adapter is asked for, once. Until that answer is in,
 * the guess is the optimistic one; the worker checks again for itself and
 * says which backend it actually used.
 */
let probed: UpscaleBackend | null | undefined
let probing: Promise<UpscaleBackend | null> | null = null

/** The one WebGPU call made here, typed locally: the DOM lib has no WebGPU types. */
type GpuNavigator = Navigator & { gpu?: { requestAdapter(): Promise<object | null> } }

export function probeUpscaleBackend(): Promise<UpscaleBackend | null> {
  if (probed !== undefined) return Promise.resolve(probed)
  if (!probing) {
    probing = (async () => {
      const guess = upscaleBackend()
      if (guess !== 'webgpu') return (probed = guess)
      try {
        const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter()
        probed = adapter ? 'webgpu' : typeof WebAssembly !== 'undefined' ? 'wasm' : null
      } catch {
        probed = typeof WebAssembly !== 'undefined' ? 'wasm' : null
      }
      return probed
    })()
  }
  return probing
}

export function upscaleBackend(): UpscaleBackend | null {
  if (probed !== undefined) return probed
  if (typeof navigator === 'undefined') return null
  if ((navigator as GpuNavigator).gpu) return 'webgpu'
  if (typeof WebAssembly !== 'undefined') return 'wasm'
  return null
}

export function upscaleModelUrl(): string {
  return new URL('models/realesr-general-x4v3.onnx', new URL(import.meta.env.BASE_URL, self.location.href))
    .href
}

/** Whether the weights are already on this machine, so the offer can say what it costs. */
export async function isUpscaleModelCached(): Promise<boolean> {
  if (warm) return true
  if (typeof caches === 'undefined') return false
  try {
    return Boolean(await caches.match(upscaleModelUrl()))
  } catch {
    return false
  }
}

let warm = false
let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./upscale-worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

export function disposeUpscaler(): void {
  worker?.terminate()
  worker = null
}

/** Long, because a large picture on the CPU is minutes — but progress resets it, so a hang is still caught. */
const SILENCE_TIMEOUT_MS = 120_000

export interface UpscaleResult {
  bitmap: ImageBitmap
  backend: UpscaleBackend
}

/**
 * Upscale a bitmap by `factor`. The bitmap is handed to the worker and is
 * unusable afterwards — the caller is giving it up for the bigger one.
 */
export async function upscaleBitmap(
  bitmap: ImageBitmap,
  factor: 2 | 4,
  onProgress?: (fraction: number, backend: UpscaleBackend) => void,
): Promise<UpscaleResult> {
  const backend = upscaleBackend()
  if (!backend) throw new Error('this browser cannot run the upscaler')
  const active = getWorker()
  const id = crypto.randomUUID()

  return new Promise<UpscaleResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const fail = (message: string) => {
      clearTimeout(timer)
      active.removeEventListener('message', onMessage)
      reject(new Error(message))
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        disposeUpscaler()
        fail('the upscaler stopped responding')
      }, SILENCE_TIMEOUT_MS)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      if (typeof event.data.progress === 'number') {
        arm()
        onProgress?.(event.data.progress, event.data.backend)
        return
      }
      clearTimeout(timer)
      active.removeEventListener('message', onMessage)
      if (event.data.ok) {
        warm = true
        resolve({ bitmap: event.data.bitmap as ImageBitmap, backend: event.data.backend })
      } else {
        reject(new Error(event.data.error ?? 'could not upscale the photo'))
      }
    }

    arm()
    active.addEventListener('message', onMessage)
    active.postMessage({ kind: 'upscale', id, modelUrl: upscaleModelUrl(), bitmap, factor, backend }, [bitmap])
  })
}
