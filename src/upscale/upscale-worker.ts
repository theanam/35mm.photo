/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/webgpu'
import { MODEL_SCALE, planTiles, type UpscaleBackend } from './tiles'

/**
 * Super-resolution, off the main thread.
 *
 * Real-ESRGAN's compact general model takes an RGB picture and returns it
 * four times the size on each edge. It is a plain stack of 3×3 convolutions,
 * which is what makes it small enough to ship and fast enough to run here —
 * about a quarter of a second per 512² tile on WebGPU, thirteen on the CPU.
 *
 * The picture is cut into tiles because the model's memory grows with the
 * picture and a whole photo would exhaust a GPU; each tile is read with a
 * margin of its neighbours and only the middle is kept, so the seams are
 * invisible. ×2 is the same ×4 pass with each tile halved on the way out: the
 * model has no ×2 head, and halving a ×4 result is sharper than any ×2 would
 * be.
 */

interface UpscaleRequest {
  kind: 'upscale'
  id: string
  /** Where to fetch the model from, resolved against the build's base path. */
  modelUrl: string
  bitmap: ImageBitmap
  factor: 2 | 4
  /** What the page believes is available; the worker falls back if it is wrong. */
  backend: UpscaleBackend
}

/** Bigger tiles are faster per pixel on the GPU; smaller ones keep the CPU's progress honest. */
const TILE: Record<UpscaleBackend, number> = { webgpu: 256, wasm: 192 }
/** Real-ESRGAN's own tile padding is 10; a little more costs little and never shows. */
const OVERLAP = 16

let session: Promise<ort.InferenceSession> | null = null
let sessionBackend: UpscaleBackend | null = null

function load(modelUrl: string, backend: UpscaleBackend): Promise<ort.InferenceSession> {
  if (session && sessionBackend === backend) return session

  // No wasmPaths, for the reasons `subject-worker.ts` gives: the entry point
  // references its WebAssembly as a module asset, the bundler emits it beside
  // everything else, and it is fetched from our own origin. This is the WebGPU
  // build, 27 MB against the detector's 14, and fetched separately — the two
  // share nothing but their name.
  ort.env.wasm.numThreads = 1
  ort.env.logLevel = 'error'

  const attempt = ort.InferenceSession.create(modelUrl, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  })
  attempt.catch(() => {
    if (session === attempt) session = null
  })
  session = attempt
  sessionBackend = backend
  return attempt
}

/** The session on the backend asked for, or on the CPU if that is all there is. */
async function sessionFor(
  modelUrl: string,
  wanted: UpscaleBackend,
): Promise<{ model: ort.InferenceSession; backend: UpscaleBackend }> {
  if (wanted === 'webgpu') {
    try {
      return { model: await load(modelUrl, 'webgpu'), backend: 'webgpu' }
    } catch (err) {
      console.warn('[35mm] WebGPU upscaling unavailable here; using the CPU', err)
    }
  }
  return { model: await load(modelUrl, 'wasm'), backend: 'wasm' }
}

self.addEventListener('message', async (event: MessageEvent<UpscaleRequest>) => {
  const { id, modelUrl, bitmap, factor } = event.data

  try {
    const { model, backend } = await sessionFor(modelUrl, event.data.backend)
    self.postMessage({ id, backend, progress: 0 })

    const width = bitmap.width
    const height = bitmap.height
    const source = new OffscreenCanvas(width, height)
    const sctx = source.getContext('2d', { willReadFrequently: true })
    if (!sctx) throw new Error('no 2D context in the worker')
    sctx.drawImage(bitmap, 0, 0)
    bitmap.close()

    const out = new OffscreenCanvas(width * factor, height * factor)
    const octx = out.getContext('2d')
    if (!octx) throw new Error('no 2D context for the result')

    const tiles = planTiles(width, height, TILE[backend], OVERLAP)
    const inputName = model.inputNames[0]
    const outputName = model.outputNames[0]

    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]
      const read = sctx.getImageData(t.sx, t.sy, t.sw, t.sh)

      // NCHW in 0..1, alpha dropped: the model is RGB and a photo is opaque.
      const plane = t.sw * t.sh
      const input = new Float32Array(3 * plane)
      const px = read.data
      for (let p = 0; p < plane; p++) {
        input[p] = px[p * 4] / 255
        input[plane + p] = px[p * 4 + 1] / 255
        input[2 * plane + p] = px[p * 4 + 2] / 255
      }

      const result = await model.run({
        [inputName]: new ort.Tensor('float32', input, [1, 3, t.sh, t.sw]),
      })
      const tensor = result[outputName]
      const data = tensor.data as Float32Array
      const [, , oh4, ow4] = tensor.dims
      if (ow4 !== t.sw * MODEL_SCALE || oh4 !== t.sh * MODEL_SCALE) {
        throw new Error(`the model returned ${ow4} × ${oh4} for a ${t.sw} × ${t.sh} tile`)
      }

      // The clean middle of the ×4 result, as bytes.
      const cx = t.ox * MODEL_SCALE
      const cy = t.oy * MODEL_SCALE
      const cw = t.ow * MODEL_SCALE
      const ch = t.oh * MODEL_SCALE
      const outPlane = ow4 * oh4
      const rgba = new Uint8ClampedArray(cw * ch * 4)
      for (let y = 0; y < ch; y++) {
        const row = (cy + y) * ow4 + cx
        for (let x = 0; x < cw; x++) {
          const s = row + x
          const d = (y * cw + x) * 4
          rgba[d] = data[s] * 255 + 0.5
          rgba[d + 1] = data[outPlane + s] * 255 + 0.5
          rgba[d + 2] = data[2 * outPlane + s] * 255 + 0.5
          rgba[d + 3] = 255
        }
      }

      if (factor === MODEL_SCALE) {
        octx.putImageData(new ImageData(rgba, cw, ch), t.dx * MODEL_SCALE, t.dy * MODEL_SCALE)
      } else {
        // ×2: a 2×2 box over the ×4 result. Exact, and free of whatever the
        // canvas would choose to resample with.
        const hw = cw / 2
        const hh = ch / 2
        const half = new Uint8ClampedArray(hw * hh * 4)
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < hw; x++) {
            const a = ((2 * y) * cw + 2 * x) * 4
            const b = a + 4
            const c = a + cw * 4
            const e = c + 4
            const d = (y * hw + x) * 4
            half[d] = (rgba[a] + rgba[b] + rgba[c] + rgba[e] + 2) >> 2
            half[d + 1] = (rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[e + 1] + 2) >> 2
            half[d + 2] = (rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[e + 2] + 2) >> 2
            half[d + 3] = 255
          }
        }
        octx.putImageData(new ImageData(half, hw, hh), t.dx * 2, t.dy * 2)
      }

      self.postMessage({ id, backend, progress: (i + 1) / tiles.length })
    }

    const upscaled = out.transferToImageBitmap()
    self.postMessage({ id, ok: true, backend, bitmap: upscaled }, [upscaled])
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'could not upscale the photo',
    })
  }
})
