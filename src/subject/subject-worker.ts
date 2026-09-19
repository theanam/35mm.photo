/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web'

/**
 * Salient object detection, off the main thread (spec §3.3).
 *
 * U²-Netp takes a 320×320 image and returns one probability per output pixel:
 * how much of the subject is there. It is a small network but this is still
 * hundreds of milliseconds of dense arithmetic, and on the main thread it would
 * stall the viewport for every one of them.
 *
 * What comes back is coarse on purpose — see `detect.ts` for why 320×320 is
 * enough, and what happens to it afterwards.
 */

interface DetectRequest {
  id: string
  /** Where to fetch the model and the runtime from, resolved against the base. */
  modelUrl: string
  wasmPath: string
  /** The photo, already scaled to `SIZE` and laid out as RGBA. */
  rgba: Uint8ClampedArray
  size: number
}

/** ImageNet statistics, which is what U²-Net was trained against. */
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let session: Promise<ort.InferenceSession> | null = null

function load(modelUrl: string, wasmPath: string): Promise<ort.InferenceSession> {
  if (!session) {
    // Served from our own origin — see `scripts/sync-ort.mjs`. Left unset, the
    // runtime reaches for a CDN, which the service worker will not cache and
    // which would take the feature offline with it.
    ort.env.wasm.wasmPaths = wasmPath
    // GitHub Pages cannot send the COOP/COEP headers that SharedArrayBuffer
    // needs, so threads are not available. Asking for them anyway costs a
    // failed probe and a console error on every load.
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'

    const attempt = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    // A load that failed must not be remembered as the answer; the next attempt,
    // most likely once the network is back, should get to try again.
    attempt.catch(() => {
      if (session === attempt) session = null
    })
    session = attempt
  }
  return session
}

self.addEventListener('message', async (event: MessageEvent<DetectRequest>) => {
  const { id, modelUrl, wasmPath, rgba, size } = event.data

  try {
    const model = await load(modelUrl, wasmPath)

    // NCHW, normalised. The alpha channel is dropped; a salient-object model
    // has no use for it and the source is opaque in any case.
    const plane = size * size
    const input = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        input[c * plane + i] = (rgba[i * 4 + c] / 255 - MEAN[c]) / STD[c]
      }
    }

    const outputs = await model.run({
      [model.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]),
    })

    // U²-Net emits seven maps: the fused prediction first, then one per decoder
    // stage. Only the first is the answer; the rest exist to be supervised
    // during training. The export names them numerically, so they are taken by
    // position rather than by a name that is an artefact of the conversion.
    const fused = outputs[model.outputNames[0]]
    const data = fused.data as Float32Array
    if (!data || data.length < plane) throw new Error('the model returned no map')

    // The fused map is already a sigmoid, but the paper's own post-processing
    // stretches each prediction to the full range, and without it a photo whose
    // subject is uncertain comes back uniformly grey rather than merely soft.
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < plane; i++) {
      const v = data[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = hi - lo

    const mask = new Uint8ClampedArray(plane)
    for (let i = 0; i < plane; i++) {
      mask[i] = span > 1e-6 ? Math.round(((data[i] - lo) / span) * 255) : 0
    }

    self.postMessage({ id, ok: true, mask, size }, [mask.buffer])
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'could not find a subject',
    })
  }
})
