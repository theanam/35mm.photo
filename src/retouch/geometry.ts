import { storedToUpright, uprightToStored } from '../editor/gpu/transform'
import type { Orientation } from '../io/exif'
import type { LensUniforms } from '../lens/uniforms'
import type { RetouchStroke } from '../editor/edit-stack/types'

/**
 * Where a retouch stroke is, in each of the spaces it has to be in.
 *
 * Strokes are stored on the picture's *content*: upright uv of the pixels as
 * the camera wrote them. That is one step further in than a mask, which lives
 * in upright uv of the frame as drawn and lets the lens correction shift it by
 * a pixel or two at the edge. A mask's soft edge can absorb that; a brush over
 * a speck of dust cannot, and a strong profile moves the corners by tens of
 * pixels. So the overlay puts the pointer through the lens model on the way
 * in, and back out again to draw.
 */

export interface Picture {
  orientation: Orientation
  /** The pixels as they are stored, before the EXIF turn. */
  storedWidth: number
  storedHeight: number
}

/** A stroke in stored pixels of one particular buffer, ready for the heal. */
export interface StoredBrush {
  points: number[]
  radius: number
  feather: number
  /** The heal source offset, rounded to whole pixels of this buffer. */
  dx: number
  dy: number
}

export function strokeToStored(stroke: RetouchStroke, picture: Picture): StoredBrush {
  const { storedWidth: w, storedHeight: h, orientation } = picture
  const points: number[] = []
  for (let i = 0; i + 1 < stroke.points.length; i += 2) {
    const [su, sv] = uprightToStored(stroke.points[i], stroke.points[i + 1], orientation)
    points.push(su * w, sv * h)
  }

  // The offset is a vector, so it goes through the orientation as the
  // difference of two points rather than as a point of its own.
  const [ax, ay] = uprightToStored(stroke.points[0] ?? 0, stroke.points[1] ?? 0, orientation)
  const [bx, by] = uprightToStored(
    (stroke.points[0] ?? 0) + stroke.dx,
    (stroke.points[1] ?? 0) + stroke.dy,
    orientation,
  )

  return {
    points,
    radius: Math.max(0.5, stroke.size * Math.min(w, h)),
    feather: stroke.feather / 100,
    dx: Math.round((bx - ax) * w),
    dy: Math.round((by - ay) * h),
  }
}

/** A heal offset found in stored pixels, as the upright uv the stroke keeps. */
export function offsetToUpright(
  at: [number, number],
  dx: number,
  dy: number,
  picture: Picture,
): { dx: number; dy: number } {
  const { storedWidth: w, storedHeight: h, orientation } = picture
  const [su, sv] = uprightToStored(at[0], at[1], orientation)
  const [bu, bv] = storedToUpright(su + dx / w, sv + dy / h, orientation)
  return { dx: bu - at[0], dy: bv - at[1] }
}

function isIdentity(lens: LensUniforms) {
  return lens.zoom === 1 && lens.distK.every((k) => k === 0)
}

/** The colour pass's `lensSource`, in stored uv: where an output sample reads from. */
function lensSource(u: number, v: number, lens: LensUniforms, picture: Picture): [number, number] {
  const short = Math.max(1, Math.min(picture.storedWidth, picture.storedHeight))
  const nx = (picture.storedWidth / short) * 2
  const ny = (picture.storedHeight / short) * 2
  const hx = ((u - 0.5) * nx) / lens.zoom
  const hy = ((v - 0.5) * ny) / lens.zoom
  const r = Math.hypot(hx, hy)
  const [k1, k2, k3, k4] = lens.distK
  const k = 1 + r * (k1 + r * (k2 + r * (k3 + r * k4)))
  return [0.5 + (hx * k) / nx, 0.5 + (hy * k) / ny]
}

/** The picture as drawn → the content the pixel there shows, both upright uv. */
export function drawnToContent(
  u: number,
  v: number,
  lens: LensUniforms,
  picture: Picture,
): [number, number] {
  if (isIdentity(lens)) return [u, v]
  const [su, sv] = uprightToStored(u, v, picture.orientation)
  const [cu, cv] = lensSource(su, sv, lens, picture)
  return storedToUpright(cu, cv, picture.orientation)
}

/**
 * Content → where it is drawn. The lens model only runs one way, so this
 * inverts it by fixed-point iteration, which a correction this close to the
 * identity converges on in a handful of steps.
 */
export function contentToDrawn(
  u: number,
  v: number,
  lens: LensUniforms,
  picture: Picture,
): [number, number] {
  if (isIdentity(lens)) return [u, v]
  const [tu, tv] = uprightToStored(u, v, picture.orientation)
  let x = tu
  let y = tv
  for (let i = 0; i < 12; i++) {
    const [lx, ly] = lensSource(x, y, lens, picture)
    x += tu - lx
    y += tv - ly
  }
  return storedToUpright(x, y, picture.orientation)
}
