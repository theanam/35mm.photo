/// <reference lib="webworker" />

import * as ort from 'onnxruntime-web/wasm'
import { blendThrough, brushCoverage, cutPatch, type Brush } from './heal'

/**
 * Filling, off the main thread: MI-GAN paints in what the brush covers.
 *
 * The export used here is the authors' own "pipeline" graph, which carries its
 * pre- and post-processing inside it: it takes the crop as bytes at any size,
 * finds the hole, works on a 512 square around it and pastes the answer back,
 * leaving every pixel outside the hole as it was. So there is nothing to
 * normalise or resize on this side — the one convention to get right is that
 * its mask is 255 where the picture is *known* and 0 in the hole.
 */
interface LoadRequest {
  kind: 'load'
  id: number
  modelUrl: string
}

interface FillRequest {
  kind: 'fill'
  id: number
  modelUrl: string
  rgba: Uint8ClampedArray
  width: number
  height: number
  brush: Brush
}

let session: Promise<ort.InferenceSession> | null = null

function load(modelUrl: string): Promise<ort.InferenceSession> {
  if (!session) {
    // The same settings as the subject detector, for the same reasons — see
    // `subject-worker.ts`: our own origin, one thread, the wasm-only build.
    ort.env.wasm.numThreads = 1
    ort.env.logLevel = 'error'
    const attempt = ort.InferenceSession.create(modelUrl, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    attempt.catch(() => {
      if (session === attempt) session = null
    })
    session = attempt
  }
  return session
}

self.addEventListener('message', async (event: MessageEvent<LoadRequest | FillRequest>) => {
  if (event.data.kind === 'load') {
    const { id, modelUrl } = event.data
    try {
      await load(modelUrl)
      self.postMessage({ id, ok: true })
    } catch (err) {
      self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : 'the model did not load' })
    }
    return
  }

  const { id, modelUrl, rgba, width, height, brush } = event.data
  try {
    const model = await load(modelUrl)
    const alpha = brushCoverage(brush, width, height)

    const plane = width * height
    const image = new Uint8Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      image[i] = rgba[i * 4]
      image[plane + i] = rgba[i * 4 + 1]
      image[2 * plane + i] = rgba[i * 4 + 2]
    }

    // The hole is everything the brush touches, grown by a pixel: the model
    // copies known pixels through untouched, and the brush's faintest edge
    // left on the known side would come back as a ring of the spot itself.
    const mask = new Uint8Array(plane).fill(255)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alpha[y * width + x] <= 0) continue
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox
            const ny = y + oy
            if (nx >= 0 && ny >= 0 && nx < width && ny < height) mask[ny * width + nx] = 0
          }
        }
      }
    }

    const outputs = await model.run({
      [model.inputNames[0]]: new ort.Tensor('uint8', image, [1, 3, height, width]),
      [model.inputNames[1]]: new ort.Tensor('uint8', mask, [1, 1, height, width]),
    })
    const result = outputs[model.outputNames[0]].data as Uint8Array
    if (!result || result.length < 3 * plane) throw new Error('the model returned no picture')

    const filled = new Uint8ClampedArray(plane * 4)
    for (let i = 0; i < plane; i++) {
      filled[i * 4] = result[i]
      filled[i * 4 + 1] = result[plane + i]
      filled[i * 4 + 2] = result[2 * plane + i]
      filled[i * 4 + 3] = 255
    }

    const img = { data: rgba, width, height }
    const patch = cutPatch(blendThrough(img, filled, alpha), alpha, width, height)
    self.postMessage({ id, ok: true, patch }, patch ? [patch.data.buffer] : [])
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : 'the fill failed' })
  }
})
