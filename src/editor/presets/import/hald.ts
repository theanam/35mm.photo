import { MAX_IMPORT_LUT_SIZE } from '../lut3d'
import type { Lut3D } from '../types'

/**
 * LUTs shipped as images: HALD CLUTs and the tiled "LUT strip" PNGs that game
 * engines and most free filter packs use (spec §4.3.1).
 *
 * Two layouts pack the same cube differently:
 *
 * - **HALD** — pixels in raster order *are* the LUT entries, r fastest. A
 *   level-n Hald is n³ × n³ pixels holding an n²-edge cube, so 512×512 is a
 *   64³ LUT.
 * - **Tiled** — the cube sliced by blue into edge×edge tiles laid out in a
 *   grid. 1024×32 is the common horizontal strip; 512×512 as 8×8 tiles is the
 *   square one, and that collides exactly with a 512×512 Hald.
 *
 * Nothing in the file says which it is, so ambiguous images are decoded both
 * ways and scored — see `roughness`.
 */

interface Layout {
  kind: 'hald' | 'tiled'
  edge: number
  /** Tiles across, for the tiled layout. */
  tilesX: number
}

export interface ParsedLutImage {
  lut: Lut3D
  layout: 'hald' | 'tiled'
}

export async function parseLutImage(file: Blob): Promise<ParsedLutImage> {
  const { pixels, width, height } = await decode(file)
  return unpackLutImage(pixels, width, height)
}

/** The layout decision and the unpacking, with the DOM decode lifted out. */
export function unpackLutImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): ParsedLutImage {
  const candidates = layoutsFor(width, height)
  if (!candidates.length) {
    throw new Error(
      `${width}×${height} is not a LUT image — expected a HALD square (512×512) ` +
        'or a strip whose width is its height squared (1024×32)',
    )
  }

  const built = candidates.map((layout) => ({
    layout,
    lut: layout.kind === 'hald'
      ? fromHald(pixels, layout.edge)
      : fromTiled(pixels, width, layout.edge, layout.tilesX),
  }))

  // A colour cube is smooth along each of its own axes; the wrong unpacking
  // reads across unrelated cells and is visibly noisier. That difference is far
  // larger than the difference between two plausible looks, so it decides.
  const best = built.reduce((a, b) => (roughness(b.lut) < roughness(a.lut) ? b : a))
  return { lut: best.lut, layout: best.layout.kind }
}

function layoutsFor(width: number, height: number): Layout[] {
  const out: Layout[] = []

  if (width === height) {
    // HALD: width is a perfect cube, and the cube edge is its cube root squared.
    const n = Math.round(Math.cbrt(width))
    if (n ** 3 === width && n * n <= MAX_IMPORT_LUT_SIZE) {
      out.push({ kind: 'hald', edge: n * n, tilesX: 0 })
    }
    // Square tiled: edge³ = width², laid out in (width / edge) columns.
    const edge = Math.round(Math.cbrt(width * height))
    if (edge ** 3 === width * height && width % edge === 0 && edge <= MAX_IMPORT_LUT_SIZE) {
      out.push({ kind: 'tiled', edge, tilesX: width / edge })
    }
  } else if (width === height * height && height <= MAX_IMPORT_LUT_SIZE) {
    out.push({ kind: 'tiled', edge: height, tilesX: height }) // horizontal strip
  } else if (height === width * width && width <= MAX_IMPORT_LUT_SIZE) {
    out.push({ kind: 'tiled', edge: width, tilesX: 1 }) // vertical strip
  }

  return out
}

/** Raster order is LUT order, so the pixels only need de-interleaving. */
function fromHald(pixels: Uint8ClampedArray, edge: number): Lut3D {
  const count = edge ** 3
  const data = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const src = i * 4
    data[i * 3] = pixels[src] / 255
    data[i * 3 + 1] = pixels[src + 1] / 255
    data[i * 3 + 2] = pixels[src + 2] / 255
  }
  return { size: edge, data }
}

function fromTiled(
  pixels: Uint8ClampedArray,
  width: number,
  edge: number,
  tilesX: number,
): Lut3D {
  const data = new Float32Array(edge ** 3 * 3)
  for (let b = 0; b < edge; b++) {
    const ox = (b % tilesX) * edge
    const oy = Math.floor(b / tilesX) * edge
    for (let g = 0; g < edge; g++) {
      for (let r = 0; r < edge; r++) {
        const src = ((oy + g) * width + ox + r) * 4
        const dst = (r + g * edge + b * edge * edge) * 3
        data[dst] = pixels[src] / 255
        data[dst + 1] = pixels[src + 1] / 255
        data[dst + 2] = pixels[src + 2] / 255
      }
    }
  }
  return { size: edge, data }
}

/**
 * Mean absolute second difference along each axis, measured in that axis's own
 * output channel. A correctly unpacked cube is near-smooth; a mis-unpacked one
 * is an order of magnitude rougher.
 */
function roughness(lut: Lut3D): number {
  const n = lut.size
  const at = (r: number, g: number, b: number, c: number) =>
    lut.data[(r + g * n + b * n * n) * 3 + c]

  let total = 0
  let count = 0
  for (let i = 1; i < n - 1; i++) {
    for (let j = 0; j < n; j += 2) {
      for (let k = 0; k < n; k += 2) {
        total += Math.abs(at(i - 1, j, k, 0) - 2 * at(i, j, k, 0) + at(i + 1, j, k, 0))
        total += Math.abs(at(j, i - 1, k, 1) - 2 * at(j, i, k, 1) + at(j, i + 1, k, 1))
        total += Math.abs(at(j, k, i - 1, 2) - 2 * at(j, k, i, 2) + at(j, k, i + 1, 2))
        count += 3
      }
    }
  }
  return count ? total / count : 0
}

async function decode(file: Blob) {
  // Colour management would rewrite the very values the LUT encodes, so the
  // decode has to be raw.
  const bitmap = await createImageBitmap(file, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' })
    if (!ctx) throw new Error('could not read the image')
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' })
    return { pixels: data, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}
