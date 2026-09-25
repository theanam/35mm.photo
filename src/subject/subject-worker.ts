/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/wasm'
import { refineMask, type EdgeOptions } from './refine'

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

/**
 * Two jobs, because they are asked for at different rates. Detection runs the
 * model once per photo and hands back the coarse map. Refinement re-cuts that
 * map along the picture, and runs again every time an edge control moves —
 * which is many times a second under a slider, and must never wait on the
 * model.
 */
interface DetectRequest {
  kind: 'detect'
  id: string
  /** Where to fetch the model from, resolved against the build's base path. */
  modelUrl: string
  /** The photo, already scaled to the detector's input and laid out as RGBA. */
  rgba: Uint8ClampedArray
  size: number
}

interface RefineRequest {
  kind: 'refine'
  id: string
  coarse: Uint8ClampedArray
  coarseSize: number
  /** Luminance of the picture, square, for refining the coarse result. */
  guide: Float32Array
  guideSize: number
  edge: EdgeOptions
}

type Request = DetectRequest | RefineRequest

/** ImageNet statistics, which is what U²-Net was trained against. */
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let session: Promise<ort.InferenceSession> | null = null

function load(modelUrl: string): Promise<ort.InferenceSession> {
  if (!session) {
    // No wasmPaths: the `onnxruntime-web/wasm` entry point references its
    // WebAssembly as a module asset, so the bundler emits it alongside
    // everything else and it is fetched from our own origin with a hash in its
    // name. Left to its own devices the default entry reaches for a CDN, which
    // the service worker will not cache and which would take the feature
    // offline with it — and tell a third party who is using it.
    //
    // That entry also matters for size: the default one carries the WebGPU
    // (jsep) build, which is 28 MB against this one's 13.6 MB, for a backend
    // nothing here asks for.
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

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { id } = event.data

  try {
    if (event.data.kind === 'refine') {
      const { coarse, coarseSize, guide, guideSize, edge } = event.data
      // Cut the coarse map along the edges the photograph already has. Without
      // this the result is unusable on anything with fine structure — see
      // `refine.ts` for what it is doing and why it is not a blur.
      const mask = refineMask(coarse, coarseSize, guide, guideSize, edge)
      self.postMessage({ id, ok: true, mask, size: guideSize }, [mask.buffer])
      return
    }

    const { modelUrl, rgba, size } = event.data
    const model = await load(modelUrl)

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

    const coarse = new Uint8ClampedArray(plane)
    for (let i = 0; i < plane; i++) {
      coarse[i] = span > 1e-6 ? Math.round(((data[i] - lo) / span) * 255) : 0
    }

    self.postMessage({ id, ok: true, mask: coarse, size }, [coarse.buffer])
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'could not find a subject',
    })
  }
})
