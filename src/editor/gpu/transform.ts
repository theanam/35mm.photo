import type { CropState, FrameState, PerspectiveState } from '../edit-stack/types'
import { swapsAxes, type Orientation } from '../../io/exif'

/** Column-major 3×3, the layout `uniformMatrix3fv` wants with transpose=false. */
export type Mat3 = Float32Array

export function mat3Identity(): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
}

/** `out = a · b` — b applied first. */
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Float32Array(9)
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]
    }
  }
  return o
}

function translate(x: number, y: number): Mat3 {
  return new Float32Array([1, 0, 0, 0, 1, 0, x, y, 1])
}

function scale(x: number, y: number): Mat3 {
  return new Float32Array([x, 0, 0, 0, y, 0, 0, 0, 1])
}

function rotate(rad: number): Mat3 {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return new Float32Array([c, s, 0, -s, c, 0, 0, 0, 1])
}

/** Source dimensions after the 90° steps, i.e. what the user sees as the frame. */
export function displaySize(width: number, height: number, rotate90: number) {
  return rotate90 % 2 === 0 ? { width, height } : { width: height, height: width }
}

/** Pixel dimensions of the final cropped output at full resolution. */
export function outputSize(imgW: number, imgH: number, crop: CropState) {
  const c = effectiveCrop(imgW, imgH, crop)
  const d = displaySize(imgW, imgH, c.rotate90)
  return {
    width: Math.max(1, Math.round(d.width * c.w)),
    height: Math.max(1, Math.round(d.height * c.h)),
  }
}

export interface FrameLayout {
  /** The picture itself, unchanged by the border. */
  photo: { width: number; height: number }
  /** The whole thing, picture plus border — the size of the file. */
  width: number
  height: number
  /** Border thickness per side, in whole pixels of the framed output. */
  inset: { top: number; right: number; bottom: number; left: number }
  /** False when there is no border at all, so callers can skip the work. */
  framed: boolean
}

/**
 * Where the picture sits inside its border, in whole pixels.
 *
 * The one place these numbers are worked out. Everything downstream — the canvas
 * the preview allocates, the canvas an export allocates, the dimensions the
 * export dialog promises, the uniforms the frame shader gets — reads them from
 * here rather than recomputing, because `width` has to equal
 * `photo.width + left + right` *exactly*. Derive the two independently and they
 * disagree by a pixel on some crops, which makes the inner rectangle a fraction
 * off the photo's own resolution and puts a resample through a picture that
 * should have been copied straight across.
 *
 * `scale` is how big this render is against the exported file — 1 at full size,
 * 0.25 for a quarter-size preview. Percentages do not need it, because they are
 * read against whatever short edge is in front of them and shrink along with it.
 * A pixel width does: it names a thickness in the file, and the only way a
 * quarter-size preview can tell the truth about a 64px border is to draw 16.
 */
export function frameLayout(
  photoW: number,
  photoH: number,
  frame: FrameState | null | undefined,
  scale = 1,
): FrameLayout {
  const photo = { width: Math.max(1, Math.round(photoW)), height: Math.max(1, Math.round(photoH)) }
  const none = {
    photo,
    width: photo.width,
    height: photo.height,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
    framed: false,
  }
  if (!frame) return none

  const short = Math.min(photo.width, photo.height)
  // Guarded rather than trusted: a sidecar written by an older build can carry a
  // half-filled frame, and NaN here would reach the shader as a blank screen.
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1
  const px = (value: number) => {
    const v = Number.isFinite(value) ? value : 0
    return Math.max(0, Math.round(frame.unit === 'pixel' ? v * k : (v / 100) * short))
  }

  const inset = {
    top: px(frame.top),
    right: px(frame.right),
    bottom: px(frame.bottom),
    left: px(frame.left),
  }
  if (!inset.top && !inset.right && !inset.bottom && !inset.left) return none

  return {
    photo,
    width: photo.width + inset.left + inset.right,
    height: photo.height + inset.top + inset.bottom,
    inset,
    framed: true,
  }
}

/**
 * The dimensions of an exported file: the picture, brought down to any long-edge
 * limit, with its mat around it.
 *
 * The limit is measured against the *framed* size, because that is the file —
 * asking for a long edge of 2048 and getting 2048 plus a border back would make
 * the number mean nothing. The picture is then scaled and the mat laid out
 * around the scaled picture, rather than the framed size being scaled and split
 * back up, so the sides and the middle stay whole pixels that add up. A mat
 * asked for in percentages lands within a pixel of the limit rather than exactly
 * on it; that pixel is the price of the copy being exact.
 */
export function exportLayout(
  photoW: number,
  photoH: number,
  crop: CropState,
  frame: FrameState | null | undefined,
  maxEdge?: number | null,
): FrameLayout {
  const full = outputSize(photoW, photoH, crop)
  const framed = frameLayout(full.width, full.height, frame)
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(framed.width, framed.height)) : 1
  if (scale >= 1) return framed
  const outW = Math.max(1, Math.round(full.width * scale))
  const outH = Math.max(1, Math.round(full.height * scale))
  // `outW / full.width` rather than `scale`: the rounding above has already
  // happened, and a pixel border must be measured against the picture that was
  // actually produced, not the one that was asked for.
  return frameLayout(outW, outH, frame, outW / full.width)
}

/**
 * The four widths that pad a picture out to `ratio` (width ÷ height), as
 * percentages of its shorter edge — what the "pad to square" buttons write.
 *
 * Whichever axis is short of the target grows, split evenly between its two
 * sides; the other axis is left alone. Computed once and stored as plain widths
 * rather than kept as a live target, so that nudging a side afterwards does not
 * fight a rule, and changing the crop later does not silently re-pad a picture
 * the user has already finished with.
 */
export function padToAspect(
  photoW: number,
  photoH: number,
  ratio: number,
): { top: number; right: number; bottom: number; left: number } {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 }
  if (!(photoW > 0) || !(photoH > 0) || !(ratio > 0) || !Number.isFinite(ratio)) return zero

  const short = Math.min(photoW, photoH)
  const current = photoW / photoH

  // Too wide for the target: it needs height, so the mat goes above and below.
  if (current > ratio) {
    const pad = (photoW / ratio - photoH) / 2
    return { ...zero, top: (pad / short) * 100, bottom: (pad / short) * 100 }
  }
  if (current < ratio) {
    const pad = (photoH * ratio - photoW) / 2
    return { ...zero, left: (pad / short) * 100, right: (pad / short) * 100 }
  }
  return zero
}

/**
 * The crop as it is actually rendered: the stored rect, held within the largest
 * box of its own shape that fits inside the straightened frame.
 *
 * Straighten *constrains* the crop rather than editing it, and the distinction
 * is the whole point of this function. The constraint used to be written back
 * into the stored rect every time the angle moved, which meant each pass could
 * only ever take away — straighten one way and back again and the box came home
 * smaller than it left, a little more with every nudge of the slider. Holding
 * the rect here instead leaves what the user set alone, so an angle always
 * produces the same box, and returning to zero returns the whole frame.
 */
export function effectiveCrop(imgW: number, imgH: number, crop: CropState): CropState {
  if (crop.angle === 0) return crop

  const d = displaySize(imgW, imgH, crop.rotate90)
  const boxAspect = (crop.w * d.width) / (crop.h * d.height)
  if (!Number.isFinite(boxAspect) || boxAspect <= 0) return crop

  const inset = insetCropForAngle(1, 1, crop.angle, boxAspect)
  if (crop.w <= inset.w && crop.h <= inset.h) return crop

  const w = Math.min(crop.w, inset.w)
  const h = Math.min(crop.h, inset.h)
  // Shrink about the centre, so a constrained box stays over what it framed.
  return {
    ...crop,
    w,
    h,
    x: clamp01(crop.x + (crop.w - w) / 2, w),
    y: clamp01(crop.y + (crop.h - h) / 2, h),
  }
}

function clamp01(v: number, size: number) {
  return Math.min(Math.max(v, 0), Math.max(0, 1 - size))
}

/**
 * Upright dimensions of a stored image once its EXIF orientation is honoured.
 * Everything above the render graph works in these terms, so the rest of the app
 * never has to think about how the file happens to be stored.
 */
export function uprightSize(
  storedW: number,
  storedH: number,
  orientation: Orientation = 1,
): { width: number; height: number } {
  return swapsAxes(orientation)
    ? { width: storedH, height: storedW }
    : { width: storedW, height: storedH }
}

/**
 * Keystone, stretch and zoom as one projective matrix, in output → source
 * direction.
 *
 * The third row is what makes it projective: w varies across the frame, so the
 * divide the fragment shader does at the end shifts samples by an amount that
 * depends on where they are. That is the whole difference between leaning a
 * building upright and merely skewing it — a skew moves the top sideways, a
 * keystone also changes how much of the source each output row covers.
 *
 * Built in centred, aspect-corrected coordinates so the effect is symmetric
 * about the middle of the picture and does not depend on the frame's shape.
 */
export function buildPerspective(p: PerspectiveState, aspect: number): Mat3 {
  const neutral = p.vertical === 0 && p.horizontal === 0 && p.aspect === 0 && p.scale === 100
  if (neutral) return mat3Identity()

  const kx = (p.horizontal / 100) * 0.45
  const ky = (p.vertical / 100) * 0.45
  const stretch = (p.aspect / 100) * 0.3
  // Output → source, so a larger zoom samples a smaller piece of the source.
  const z = 100 / Math.max(p.scale, 1)

  const sx = z * (1 - stretch)
  const sy = z * (1 + stretch)

  // Column-major. Row three carries the keystone terms.
  const k = new Float32Array([sx, 0, kx, 0, sy, ky, 0, 0, 1])

  return mat3Mul(
    translate(0.5, 0.5),
    mat3Mul(scale(1 / aspect, 1), mat3Mul(k, mat3Mul(scale(aspect, 1), translate(-0.5, -0.5)))),
  )
}

/**
 * Builds the output-UV → source-UV matrix. Reading right to left: place the
 * output inside the crop rect, undo the straighten rotation, undo the flips,
 * undo the 90° steps, then undo the EXIF orientation to land in the stored
 * texture.
 *
 * `imgW`/`imgH` are the *upright* dimensions — the picture as the user sees it.
 */
export function buildUvTransform(
  imgW: number,
  imgH: number,
  crop: CropState,
  orientation: Orientation = 1,
  perspective?: PerspectiveState,
): Mat3 {
  const m = buildUprightTransform(imgW, imgH, crop, perspective)
  // Last: upright uv → the uv of the pixels as they are actually stored.
  return orientation === 1 ? m : mat3Mul(ORIENTATION_INVERSE[orientation], m)
}

/**
 * Output UV → *upright image* UV: every step of `buildUvTransform` except the
 * EXIF one, stopping at the picture the right way up rather than carrying on
 * into however the file happens to store it.
 *
 * This is the space masks are defined in, and the reason they are: it is the
 * only frame of reference that survives a re-crop, a straighten and a quarter
 * turn. Inverted (`mat3Invert`) it also takes a mask's geometry back out to
 * the viewport, which is how the overlay draws handles in the right place.
 */
export function buildUprightTransform(
  imgW: number,
  imgH: number,
  stored: CropState,
  perspective?: PerspectiveState,
): Mat3 {
  // Everything below reads the constrained rect, never the stored one — see
  // `effectiveCrop`. The straighten slider writes only the angle.
  const crop = effectiveCrop(imgW, imgH, stored)
  const d = displaySize(imgW, imgH, crop.rotate90)
  const aspect = d.width / d.height

  // Output uv → straightened-display uv.
  let m = mat3Mul(translate(crop.x, crop.y), scale(crop.w, crop.h))

  // Undo straighten, rotating in aspect-corrected space so the turn is circular.
  // Negated because this matrix runs output → source: to turn the picture
  // clockwise (the positive direction everyone expects from a straighten
  // slider) the sampling has to turn the other way.
  if (crop.angle !== 0) {
    const rad = (-crop.angle * Math.PI) / 180
    const unstraighten = mat3Mul(
      translate(0.5, 0.5),
      mat3Mul(
        scale(1 / aspect, 1),
        mat3Mul(rotate(rad), mat3Mul(scale(aspect, 1), translate(-0.5, -0.5))),
      ),
    )
    m = mat3Mul(unstraighten, m)
  }

  // Perspective corrects the whole frame, so it belongs on display coordinates —
  // after the crop rectangle has placed the output inside the frame, before the
  // flips and quarter turns that only relabel the axes.
  if (perspective) m = mat3Mul(buildPerspective(perspective, aspect), m)

  if (crop.flipH) m = mat3Mul(mat3Mul(translate(1, 0), scale(-1, 1)), m)
  if (crop.flipV) m = mat3Mul(mat3Mul(translate(0, 1), scale(1, -1)), m)

  const k = ((crop.rotate90 % 4) + 4) % 4
  if (k !== 0) m = mat3Mul(ROT90_INVERSE[k], m)

  return m
}

/**
 * Apply a projective 3×3 to a point, doing the divide the vertex shader leaves
 * to the fragment stage. Straight lines stay straight under this, which is why
 * the overlay can map a mask's outline by its corners and let SVG join them up.
 */
export function applyMat3Point(m: Mat3, x: number, y: number): [number, number] {
  const w = m[2] * x + m[5] * y + m[8]
  const d = Math.abs(w) < 1e-9 ? 1e-9 : w
  return [(m[0] * x + m[3] * y + m[6]) / d, (m[1] * x + m[4] * y + m[7]) / d]
}

/**
 * Inverse of a projective 3×3, or null if it is singular. A projective matrix
 * is only defined up to scale, so the result is left unnormalised — the divide
 * in `applyMat3Point` cancels whatever scale comes out.
 */
export function mat3Invert(m: Mat3): Mat3 | null {
  // Column-major: m[c * 3 + r].
  const a = m[0], b = m[1], c = m[2]
  const d = m[3], e = m[4], f = m[5]
  const g = m[6], h = m[7], i = m[8]

  const A = e * i - f * h
  const B = f * g - d * i
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null

  const inv = 1 / det
  return new Float32Array([
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ])
}

/**
 * Upright uv → stored uv, per EXIF orientation. Each is the inverse of the
 * transform the tag asks a viewer to perform:
 *
 *   2 mirror · 3 rotate 180 · 4 flip · 5 transpose
 *   6 rotate 90 CW · 7 transverse · 8 rotate 270 CW
 */
const ORIENTATION_INVERSE: Record<number, Mat3> = {
  2: new Float32Array([-1, 0, 0, 0, 1, 0, 1, 0, 1]), // (u,v) → (1−u, v)
  3: new Float32Array([-1, 0, 0, 0, -1, 0, 1, 1, 1]), // → (1−u, 1−v)
  4: new Float32Array([1, 0, 0, 0, -1, 0, 0, 1, 1]), // → (u, 1−v)
  5: new Float32Array([0, 1, 0, 1, 0, 0, 0, 0, 1]), // → (v, u)
  6: new Float32Array([0, -1, 0, 1, 0, 0, 0, 1, 1]), // → (v, 1−u)
  7: new Float32Array([0, -1, 0, -1, 0, 0, 1, 1, 1]), // → (1−v, 1−u)
  8: new Float32Array([0, 1, 0, -1, 0, 0, 1, 0, 1]), // → (1−v, u)
}

/**
 * Display uv → source uv for each 90° step. k=1 is one clockwise quarter turn
 * of the image, which means sampling the source transposed.
 */
const ROT90_INVERSE: Record<number, Mat3> = {
  1: new Float32Array([0, -1, 0, 1, 0, 0, 0, 1, 1]), // (dx,dy) → (dy, 1−dx)
  2: new Float32Array([-1, 0, 0, 0, -1, 0, 1, 1, 1]), // → (1−dx, 1−dy)
  3: new Float32Array([0, 1, 0, -1, 0, 0, 1, 0, 1]), // → (1−dy, dx)
}

/**
 * Largest axis-aligned rect of the given aspect that fits inside the frame once
 * it is rotated by `angle`. Straightening without this leaves empty corners.
 */
export function insetCropForAngle(
  frameW: number,
  frameH: number,
  angleDeg: number,
  aspect: number,
): { w: number; h: number } {
  const rad = Math.abs((angleDeg * Math.PI) / 180)
  if (rad < 1e-6) return { w: 1, h: 1 }

  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // Target rect is aspect · h wide by h tall, in pixels.
  const w = aspect
  const h = 1
  // Rotated bounding box of a w×h rect must fit within frameW×frameH.
  const boundW = w * cos + h * sin
  const boundH = w * sin + h * cos
  const s = Math.min(frameW / boundW, frameH / boundH)

  return {
    w: Math.min(1, (w * s) / frameW),
    h: Math.min(1, (h * s) / frameH),
  }
}
