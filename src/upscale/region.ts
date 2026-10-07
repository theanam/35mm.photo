import type { EditState, ImageMeta } from '../editor/edit-stack/types'
import { applyMat3Point, buildUvTransform } from '../editor/gpu/transform'

/**
 * Which part of the stored picture the upscaler is handed.
 *
 * The upscale is the last stage of the stack, so it works on what leaves the
 * crop — but the model has to be run on *source* pixels, before the render
 * turns, keystones and corrects them, or the detail it invents would be
 * resampled on its way to the screen. So the crop is mapped back through the
 * same transform the render uses, and the source rectangle that covers it is
 * what gets upscaled. The renderer is then told where that rectangle sits,
 * and samples it in place of the whole picture.
 */

/** A rectangle of the stored picture, as fractions of its width and height. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Room past the crop's own outline, as a share of its size. Lens correction
 * and chromatic aberration reach a little outside the geometry the transform
 * describes, and the render samples with a bilinear footprint of its own;
 * a margin this size covers both and costs about a tenth more work.
 */
export const REGION_MARGIN = 0.05

/** Points sampled along each edge of the output, so a keystone's curve is followed. */
const EDGE_SAMPLES = 24

/**
 * The region the current geometry needs, snapped to whole stored pixels so
 * the cut and the mapping back agree exactly. `storedWidth`/`storedHeight`
 * are the dimensions of the bitmap being cut, which is the picture as stored
 * — not upright — and possibly a preview rather than the full file.
 */
export function regionFor(
  meta: ImageMeta,
  edits: EditState,
  storedWidth: number,
  storedHeight: number,
): Region & { px: { x: number; y: number; w: number; h: number } } {
  const m = buildUvTransform(meta.width, meta.height, edits.crop, meta.orientation, edits.perspective)

  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const take = (u: number, v: number) => {
    const [sx, sy] = applyMat3Point(m, u, v)
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
    if (sx < x0) x0 = sx
    if (sy < y0) y0 = sy
    if (sx > x1) x1 = sx
    if (sy > y1) y1 = sy
  }
  for (let i = 0; i <= EDGE_SAMPLES; i++) {
    const t = i / EDGE_SAMPLES
    take(t, 0)
    take(t, 1)
    take(0, t)
    take(1, t)
  }
  if (!Number.isFinite(x0)) {
    x0 = 0
    y0 = 0
    x1 = 1
    y1 = 1
  }

  const mx = (x1 - x0) * REGION_MARGIN
  const my = (y1 - y0) * REGION_MARGIN
  const px0 = Math.max(0, Math.floor((x0 - mx) * storedWidth))
  const py0 = Math.max(0, Math.floor((y0 - my) * storedHeight))
  const px1 = Math.min(storedWidth, Math.ceil((x1 + mx) * storedWidth))
  const py1 = Math.min(storedHeight, Math.ceil((y1 + my) * storedHeight))
  const pw = Math.max(1, px1 - px0)
  const ph = Math.max(1, py1 - py0)

  return {
    x: px0 / storedWidth,
    y: py0 / storedHeight,
    w: pw / storedWidth,
    h: ph / storedHeight,
    px: { x: px0, y: py0, w: pw, h: ph },
  }
}

/**
 * Everything the region depends on, in one string, so a change to any of it
 * is noticed and a slider that moves none of it is not. Retouch is in it
 * because the heals are baked into what the model sees.
 */
export function upscaleSignature(edits: EditState): string {
  return JSON.stringify({
    u: edits.upscale,
    c: edits.crop,
    p: edits.perspective,
    l: edits.lens,
    r: edits.retouch,
  })
}
