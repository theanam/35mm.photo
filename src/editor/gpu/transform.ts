import type { CropState, PerspectiveState } from '../edit-stack/types'
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
  const d = displaySize(imgW, imgH, crop.rotate90)
  return {
    width: Math.max(1, Math.round(d.width * crop.w)),
    height: Math.max(1, Math.round(d.height * crop.h)),
  }
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

  // Last: upright uv → the uv of the pixels as they are actually stored.
  if (orientation !== 1) m = mat3Mul(ORIENTATION_INVERSE[orientation], m)

  return m
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
