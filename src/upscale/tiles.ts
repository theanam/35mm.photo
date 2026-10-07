import type { UpscaleFactor } from '../editor/edit-stack/types'

/**
 * The arithmetic around upscaling, kept apart from the model so it can be
 * tested without one: which pictures are offered it, how big the result may
 * be, how long it will take, and how a picture is cut into the tiles the
 * model actually sees.
 */

export type UpscaleBackend = 'webgpu' | 'wasm'

/** The model's own scale. ×2 is the same pass, halved on the way out. */
export const MODEL_SCALE = 4

/** A picture whose long edge is under this is offered an upscale. */
export const LOW_RES_EDGE = 2048

/**
 * Ceiling on the upscaled picture. iOS refuses a canvas much past this, and
 * everywhere else it is a memory bound: the output alone is four bytes a
 * pixel, held twice over on the way to a bitmap.
 */
export const MAX_OUTPUT_PIXELS = 16e6

/**
 * Without WebGPU the model runs on the CPU at about thirteen seconds per
 * 512² tile. A small picture is still worth that; a large one is minutes.
 */
export const MAX_WASM_INPUT_PIXELS = 1.2e6

/** Which factors this picture can take, always starting with none. */
export function factorsFor(
  width: number,
  height: number,
  backend: UpscaleBackend | null,
): UpscaleFactor[] {
  const out: UpscaleFactor[] = [1]
  if (!backend || !(width > 0) || !(height > 0)) return out
  const px = width * height
  if (backend === 'wasm' && px > MAX_WASM_INPUT_PIXELS) return out
  if (px * 4 <= MAX_OUTPUT_PIXELS) out.push(2)
  if (px * 16 <= MAX_OUTPUT_PIXELS) out.push(4)
  return out
}

/**
 * The factor to suggest for a picture, or null when there is nothing to
 * suggest: it is already large, or too large for this backend. The largest
 * factor that fits, because that is what someone with a small picture wants.
 */
export function offerFor(
  width: number,
  height: number,
  backend: UpscaleBackend | null,
): UpscaleFactor | null {
  if (Math.max(width, height) >= LOW_RES_EDGE) return null
  const factors = factorsFor(width, height, backend)
  const best = factors[factors.length - 1]
  return best > 1 ? best : null
}

/**
 * Roughly how long, in seconds — measured on an Apple M-series laptop, with
 * the overlap the smaller CPU tiles carry included.
 */
export function estimateSeconds(width: number, height: number, backend: UpscaleBackend): number {
  const tiles = (width * height) / (512 * 512)
  return backend === 'webgpu' ? 1 + 0.25 * tiles : 2 + 18 * tiles
}

export interface Tile {
  /** The region read from the source, overlap included. */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Where the clean region starts within that read, and its size. */
  ox: number
  oy: number
  ow: number
  oh: number
  /** Where the clean region lands in the picture. */
  dx: number
  dy: number
}

/**
 * Cut the picture into tiles of `tile` pixels, each read with `overlap`
 * pixels of its neighbours on every side it has one. The model is run on the
 * whole read and only the clean middle is kept, so the seam between two
 * tiles is made of pixels that both saw the same neighbourhood.
 */
export function planTiles(width: number, height: number, tile: number, overlap: number): Tile[] {
  const tiles: Tile[] = []
  for (let y = 0; y < height; y += tile) {
    for (let x = 0; x < width; x += tile) {
      const ow = Math.min(tile, width - x)
      const oh = Math.min(tile, height - y)
      const sx = Math.max(0, x - overlap)
      const sy = Math.max(0, y - overlap)
      const ex = Math.min(width, x + ow + overlap)
      const ey = Math.min(height, y + oh + overlap)
      tiles.push({ sx, sy, sw: ex - sx, sh: ey - sy, ox: x - sx, oy: y - sy, ow, oh, dx: x, dy: y })
    }
  }
  return tiles
}
