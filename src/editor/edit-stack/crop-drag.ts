import { formatAspect, parseAspectRatio } from './aspect'
import { STRAIGHTEN_LIMIT } from './horizon'
import type { CropState } from './types'

/**
 * The geometry behind every gesture on the crop box, kept pure so each one can
 * be checked without a pointer. Everything is in the frame's normalised
 * coordinates, 0..1 along each axis, which is what the crop stores.
 *
 * The model is Lightroom's: the frame is the thing being aimed, the picture is
 * what moves. Dragging inside the frame slides the photo under it, the handles
 * reshape it, and a drag outside it turns the photo.
 */

export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Smallest the box may get along either axis, as a share of the frame. */
export const MIN_CROP = 0.05

/**
 * Dragging inside the frame moves the picture *with* the pointer, the frame
 * staying put on screen — so against the picture, the box goes the other way.
 * `dx`/`dy` are the pointer's travel as a share of the frame.
 */
export function moveCrop(start: Rect, dx: number, dy: number): Pick<Rect, 'x' | 'y'> {
  return {
    x: clamp(start.x - dx, 0, 1 - start.w),
    y: clamp(start.y - dy, 0, 1 - start.h),
  }
}

export interface ResizeOptions {
  /** Width over height in normalised units, or null for a free box. */
  ratio: number | null
  /** ⌥-drag: the box grows and shrinks about its own centre. */
  fromCentre: boolean
}

/**
 * A handle drag. The edges the handle does not touch stay where they were,
 * unless the drag is from the centre, in which case the opposite edge mirrors
 * it. With a ratio, the axis the handle drives sets the other — a corner or a
 * side handle drives its own axis — and the box can never leave the frame:
 * whichever axis runs out of room first wins, and the other follows it back.
 */
export function resizeCrop(
  handle: Handle,
  start: Rect,
  dx: number,
  dy: number,
  { ratio, fromCentre }: ResizeOptions,
): Rect {
  const hasW = handle.includes('w')
  const hasE = handle.includes('e')
  const hasN = handle.includes('n')
  const hasS = handle.includes('s')
  const cx = start.x + start.w / 2
  const cy = start.y + start.h / 2
  const right = start.x + start.w
  const bottom = start.y + start.h

  // What the pointer asks for. Pulling an edge away from the centre grows the
  // box; from the centre both edges go, so the change is doubled.
  const gain = fromCentre ? 2 : 1
  let w = start.w + gain * ((hasE ? dx : 0) - (hasW ? dx : 0))
  let h = start.h + gain * ((hasS ? dy : 0) - (hasN ? dy : 0))

  // Which edge of each axis holds still. An axis the handle does not touch is
  // centred, so a ratio can widen a box from its side handle evenly rather
  // than lopsidedly to one side.
  const xMode = fromCentre || (!hasW && !hasE) ? 'centre' : hasW ? 'right' : 'left'
  const yMode = fromCentre || (!hasN && !hasS) ? 'centre' : hasN ? 'bottom' : 'top'

  const maxW = xMode === 'left' ? 1 - start.x : xMode === 'right' ? right : 2 * Math.min(cx, 1 - cx)
  const maxH = yMode === 'top' ? 1 - start.y : yMode === 'bottom' ? bottom : 2 * Math.min(cy, 1 - cy)

  w = clamp(w, MIN_CROP, maxW)
  h = clamp(h, MIN_CROP, maxH)

  if (ratio) {
    const drivenByWidth = hasW || hasE
    if (drivenByWidth) {
      w = Math.min(w, maxH * ratio)
      w = Math.max(w, MIN_CROP, MIN_CROP * ratio)
      h = w / ratio
    } else {
      h = Math.min(h, maxW / ratio)
      h = Math.max(h, MIN_CROP, MIN_CROP / ratio)
      w = h * ratio
    }
    w = Math.min(w, maxW)
    h = Math.min(h, maxH)
  }

  const x = xMode === 'left' ? start.x : xMode === 'right' ? right - w : cx - w / 2
  const y = yMode === 'top' ? start.y : yMode === 'bottom' ? bottom - h : cy - h / 2

  return {
    x: clamp(x, 0, 1 - w),
    y: clamp(y, 0, 1 - h),
    w,
    h,
  }
}

/** The arrow keys: the box shifts by a share of the frame, held inside it. */
export function nudgeCrop(crop: Rect, dx: number, dy: number): Pick<Rect, 'x' | 'y'> {
  return {
    x: clamp(crop.x + dx, 0, 1 - crop.w),
    y: clamp(crop.y + dy, 0, 1 - crop.h),
  }
}

/**
 * Turning the picture by dragging outside the frame. The pointer sweeps
 * around the box's centre and the picture follows by the same angle, so the
 * thing under the pointer stays under it. Screen y runs down, so a growing
 * `atan2` is a clockwise sweep, which is also a positive straighten.
 */
export function rotationAngle(
  start: number,
  centre: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): number {
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x)
  const a1 = Math.atan2(to.y - centre.y, to.x - centre.x)
  let delta = ((a1 - a0) * 180) / Math.PI
  // The shortest way round: a sweep across the −180/180 seam is still small.
  if (delta > 180) delta -= 360
  else if (delta < -180) delta += 360
  const next = clamp(start + delta, -STRAIGHTEN_LIMIT, STRAIGHTEN_LIMIT)
  // The slider's own step, so the readout and the value agree.
  return Math.round(next * 10) / 10 || 0
}

/**
 * Lightroom's X: the box turns on its side. A 3:2 becomes a 2:3; a free box
 * trades its width for its height. The box keeps its centre, is scaled down
 * only if the new shape would reach past the frame, and is then held inside.
 * `frame` is the picture's size the way up it is displayed.
 */
export function swapOrientation(
  crop: CropState,
  frame: { width: number; height: number },
): Partial<CropState> {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(crop.aspect ?? '')
  const aspect = match ? formatAspect(Number(match[2]), Number(match[1])) : crop.aspect

  // Pixel width becomes pixel height, back in each axis's own share.
  let w = (crop.h * frame.height) / frame.width
  let h = (crop.w * frame.width) / frame.height
  const scale = Math.min(1, 1 / w, 1 / h)
  w *= scale
  h *= scale

  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  return {
    aspect,
    w,
    h,
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
  }
}

/**
 * Lightroom's A: the padlock. Unlocking frees the box; locking fixes it to the
 * shape it has right now, named in the smallest whole numbers that describe
 * it, so a box dragged to 1497 × 998 locks as 1497:998 and not 3:2.
 */
export function toggleAspectLock(
  crop: CropState,
  frame: { width: number; height: number },
): Partial<CropState> {
  if (parseAspectRatio(crop.aspect)) return { aspect: 'free' }
  const pw = Math.max(1, Math.round(crop.w * frame.width))
  const ph = Math.max(1, Math.round(crop.h * frame.height))
  const g = gcd(pw, ph)
  return { aspect: formatAspect(pw / g, ph / g) }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}
