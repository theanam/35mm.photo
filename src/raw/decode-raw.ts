import type { DecodedImage } from '../io/decode'
import { UnsupportedFormatError } from '../io/decode'
import { extensionOf } from '../io/formats'
import { readOrientation } from '../io/exif'
import { uprightSize } from '../editor/gpu/transform'

/**
 * Entry point for the raw pipeline (spec §5). The decoder itself is a WASM
 * libraw build running in `decoder-worker.ts`; this module owns the worker
 * lifecycle and the fallback when no build is present.
 *
 * Until that binary ships, opening a raw file fails loudly. Falling back to the
 * embedded JPEG preview would look like it worked while quietly editing an
 * 8-bit camera render instead of sensor data — explicitly ruled out by §5.4.
 */

let worker: Worker | null = null
let workerAvailable: boolean | null = null

interface DecodeResponse {
  ok: boolean
  error?: string
  width?: number
  height?: number
  /** Demosaiced linear sensor data, RGBA16. */
  pixels?: Uint16Array
  meta?: { iso?: number; camera?: string; lens?: string; shotAt?: number }
}

function getWorker(): Worker | null {
  if (workerAvailable === false) return null
  if (worker) return worker

  try {
    worker = new Worker(new URL('./decoder-worker.ts', import.meta.url), { type: 'module' })
    workerAvailable = true
    return worker
  } catch (err) {
    console.warn('[35mm] raw decoder worker unavailable', err)
    workerAvailable = false
    return null
  }
}

export async function decodeRaw(file: File): Promise<DecodedImage> {
  const ext = extensionOf(file.name)
  const w = getWorker()
  if (!w) throw new UnsupportedFormatError(ext)

  // Read the tag before the buffer is transferred to the worker.
  const { orientation } = await readOrientation(file)
  const bytes = await file.arrayBuffer()
  const response = await request(w, bytes, file.name)

  if (!response.ok || !response.pixels || !response.width || !response.height) {
    throw new UnsupportedFormatError(ext)
  }

  // 16-bit linear sensor data down to the 8-bit texture the preview pipeline
  // uploads. Export re-reads the 16-bit buffer.
  const { width, height, pixels } = response
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgba.length; i++) rgba[i] = pixels[i] >> 8
  const bitmap = await createImageBitmap(new ImageData(rgba, width, height))
  const upright = uprightSize(width, height, orientation)

  return {
    bitmap,
    meta: {
      name: file.name,
      ext,
      isRaw: true,
      width: upright.width,
      height: upright.height,
      orientation,
      bytes: file.size,
      ...response.meta,
    },
  }
}

function request(w: Worker, bytes: ArrayBuffer, name: string): Promise<DecodeResponse> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID()

    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return
      w.removeEventListener('message', onMessage)
      resolve(event.data as DecodeResponse)
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ id, type: 'decode', name, bytes }, [bytes])
  })
}

export function disposeRawDecoder() {
  worker?.terminate()
  worker = null
  workerAvailable = null
}
