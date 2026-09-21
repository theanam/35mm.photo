import { describe, expect, it } from 'vitest'
import {
  applyMat3Point,
  buildPerspective,
  buildUprightTransform,
  buildUvTransform,
  mat3Identity,
  mat3Invert,
  mat3Mul,
  effectiveCrop,
  frameLayout,
  insetCropForAngle,
  outputSize,
  padToAspect,
  uprightSize,
} from './transform'
import { defaultEdits } from '../edit-stack/defaults'
import type { FrameState } from '../edit-stack/types'

/** Apply a column-major mat3 to a uv, with the perspective divide. */
function apply(m: Float32Array, u: number, v: number) {
  const x = m[0] * u + m[3] * v + m[6]
  const y = m[1] * u + m[4] * v + m[7]
  const w = m[2] * u + m[5] * v + m[8]
  return { u: x / w, v: y / w, w }
}

const crop = () => defaultEdits().crop

describe('mat3', () => {
  it('multiplies by the identity without changing anything', () => {
    const m = new Float32Array([2, 0, 0, 0, 3, 0, 0.5, 0.25, 1])
    expect([...mat3Mul(m, mat3Identity())]).toEqual([...m])
    expect([...mat3Mul(mat3Identity(), m)]).toEqual([...m])
  })
})

describe('buildUvTransform', () => {
  it('is the identity for an untouched crop', () => {
    const m = buildUvTransform(1000, 500, crop())
    for (const [u, v] of [[0, 0], [1, 1], [0.37, 0.82]]) {
      const out = apply(m, u, v)
      expect(out.u).toBeCloseTo(u, 6)
      expect(out.v).toBeCloseTo(v, 6)
    }
  })

  it('maps the output corners onto the crop rectangle', () => {
    const m = buildUvTransform(1000, 500, { ...crop(), x: 0.25, y: 0.1, w: 0.5, h: 0.4 })
    expect(apply(m, 0, 0).u).toBeCloseTo(0.25, 6)
    expect(apply(m, 0, 0).v).toBeCloseTo(0.1, 6)
    expect(apply(m, 1, 1).u).toBeCloseTo(0.75, 6)
    expect(apply(m, 1, 1).v).toBeCloseTo(0.5, 6)
  })

  it('mirrors horizontally on flipH', () => {
    const m = buildUvTransform(800, 800, { ...crop(), flipH: true })
    expect(apply(m, 0, 0.5).u).toBeCloseTo(1, 6)
    expect(apply(m, 1, 0.5).u).toBeCloseTo(0, 6)
  })

  it('keeps the centre fixed while straightening', () => {
    const m = buildUvTransform(1000, 1000, { ...crop(), angle: 12 })
    const c = apply(m, 0.5, 0.5)
    expect(c.u).toBeCloseTo(0.5, 6)
    expect(c.v).toBeCloseTo(0.5, 6)
  })
})

describe('sizes', () => {
  it('swaps axes for a quarter turn', () => {
    expect(outputSize(1000, 500, { ...crop(), rotate90: 1 })).toEqual({ width: 500, height: 1000 })
  })

  it('reports upright dimensions for a transposing orientation', () => {
    expect(uprightSize(6000, 4000, 6)).toEqual({ width: 4000, height: 6000 })
    expect(uprightSize(6000, 4000, 1)).toEqual({ width: 6000, height: 4000 })
  })
})

describe('buildPerspective', () => {
  const neutral = () => defaultEdits().perspective

  it('is the identity when nothing is set', () => {
    expect([...buildPerspective(neutral(), 1.5)]).toEqual([...mat3Identity()])
  })

  it('holds the centre still under keystone', () => {
    const m = buildPerspective({ ...neutral(), vertical: 80 }, 1.5)
    const c = apply(m, 0.5, 0.5)
    expect(c.u).toBeCloseTo(0.5, 6)
    expect(c.v).toBeCloseTo(0.5, 6)
  })

  it('is genuinely projective — w varies across the frame', () => {
    const m = buildPerspective({ ...neutral(), vertical: 80 }, 1.5)
    const top = apply(m, 0.5, 0)
    const bottom = apply(m, 0.5, 1)
    expect(top.w).not.toBeCloseTo(bottom.w, 3)
    // An affine matrix would leave w at 1 everywhere; this must not.
    expect(Math.abs(top.w - 1)).toBeGreaterThan(0.01)
  })

  it('moves the top and bottom edges in opposite directions', () => {
    const m = buildPerspective({ ...neutral(), vertical: 80 }, 1.5)
    const topWidth = apply(m, 1, 0).u - apply(m, 0, 0).u
    const bottomWidth = apply(m, 1, 1).u - apply(m, 0, 1).u
    expect(topWidth).not.toBeCloseTo(bottomWidth, 3)
  })

  it('reverses with the sign of the slider', () => {
    const a = buildPerspective({ ...neutral(), vertical: 60 }, 1.5)
    const b = buildPerspective({ ...neutral(), vertical: -60 }, 1.5)
    const wa = apply(a, 1, 0).u - apply(a, 0, 0).u
    const wb = apply(b, 1, 0).u - apply(b, 0, 0).u
    expect(Math.sign(wa - 1)).toBe(-Math.sign(wb - 1))
  })

  it('samples a smaller source region as scale goes up', () => {
    const wide = buildPerspective({ ...neutral(), scale: 100 }, 1)
    const zoomed = buildPerspective({ ...neutral(), scale: 150 }, 1)
    const span = (m: Float32Array) => apply(m, 1, 0.5).u - apply(m, 0, 0.5).u
    expect(span(zoomed)).toBeLessThan(span(wide))
  })

  it('stretches one axis against the other', () => {
    const m = buildPerspective({ ...neutral(), aspect: 100 }, 1)
    const horizontal = apply(m, 1, 0.5).u - apply(m, 0, 0.5).u
    const vertical = apply(m, 0.5, 1).v - apply(m, 0.5, 0).v
    expect(horizontal).toBeLessThan(vertical)
  })

  it('composes into the uv transform without disturbing an untouched frame', () => {
    const m = buildUvTransform(1000, 500, crop(), 1, neutral())
    const out = apply(m, 0.42, 0.63)
    expect(out.u).toBeCloseTo(0.42, 6)
    expect(out.v).toBeCloseTo(0.63, 6)
  })

  /*
   * A keystone asks for source the picture does not have — that is the whole
   * point of it, and it is why the colour pass carries a coverage matte rather
   * than clamping. Clamping instead smeared the last row of the photo down
   * over the bottom tenth of the frame.
   */
  it('reaches past the source once the keystone is strong', () => {
    const m = buildUvTransform(1500, 2000, crop(), 1, { ...neutral(), vertical: -100 })

    expect(apply(m, 0.5, 0.5).v).toBeCloseTo(0.5, 6)
    expect(apply(m, 0.5, 1).v).toBeGreaterThan(1)
    expect(apply(m, 0, 1).u).toBeLessThan(0)
    expect(apply(m, 1, 1).u).toBeGreaterThan(1)
  })

  it('stays inside the source when scale pushes the frame back out', () => {
    const m = buildUvTransform(1500, 2000, crop(), 1, {
      ...neutral(),
      vertical: -100,
      scale: 150,
    })

    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 1]] as const) {
      const out = apply(m, u, v)
      expect(out.u).toBeGreaterThanOrEqual(0)
      expect(out.u).toBeLessThanOrEqual(1)
      expect(out.v).toBeGreaterThanOrEqual(0)
      expect(out.v).toBeLessThanOrEqual(1)
    }
  })
})

describe('mat3Invert', () => {
  it('round-trips a point through a projective transform', () => {
    const m = buildUprightTransform(
      3000,
      2000,
      { ...crop(), x: 0.2, y: 0.1, w: 0.5, h: 0.6, angle: 7, rotate90: 1, flipH: true },
      { vertical: 40, horizontal: -20, aspect: 10, scale: 105 },
    )
    const inverse = mat3Invert(m)
    expect(inverse).not.toBeNull()

    for (const [u, v] of [[0, 0], [1, 1], [0.37, 0.82], [0.5, 0.5]]) {
      const [x, y] = applyMat3Point(m, u, v)
      const [bu, bv] = applyMat3Point(inverse!, x, y)
      expect(bu).toBeCloseTo(u, 5)
      expect(bv).toBeCloseTo(v, 5)
    }
  })

  it('returns null for a matrix that collapses the plane', () => {
    expect(mat3Invert(new Float32Array([1, 2, 3, 2, 4, 6, 0, 0, 0]))).toBeNull()
  })
})

describe('buildUprightTransform', () => {
  it('leaves the EXIF step to buildUvTransform', () => {
    const c = { ...crop(), x: 0.1, y: 0.2, w: 0.4, h: 0.5, angle: -4 }
    const upright = buildUprightTransform(2000, 3000, c)
    // Orientation 1 stores the pixels the right way up, so the two agree.
    const withExif = buildUvTransform(2000, 3000, c, 1)
    expect([...upright]).toEqual([...withExif])
  })

  it('keeps a mask anchored to the picture when the crop moves', () => {
    // A point on the subject, in upright uv. Whatever the crop does, asking
    // the transform for that point must give back the same place.
    const subject: [number, number] = [0.62, 0.41]

    const find = (c: ReturnType<typeof crop>) => {
      const inverse = mat3Invert(buildUprightTransform(3000, 2000, c))!
      return applyMat3Point(inverse, subject[0], subject[1])
    }

    const wide = find({ ...crop() })
    const tight = find({ ...crop(), x: 0.25, y: 0.2, w: 0.5, h: 0.5 })

    // Same content, so the output position shifts exactly as the crop does.
    expect(tight[0]).toBeCloseTo((wide[0] - 0.25) / 0.5, 6)
    expect(tight[1]).toBeCloseTo((wide[1] - 0.2) / 0.5, 6)
  })
})

/**
 * Straighten constrains the crop; it does not rewrite it. The distinction is
 * invisible until the angle comes back, which is why it went unnoticed: the box
 * used to be shrunk to fit and the shrink written into the stored rect, so
 * every pass of the slider could only subtract and the frame was never returned.
 */
describe('straighten and the crop', () => {
  const W = 6000
  const H = 4000
  const full = (angle: number) => ({ ...crop(), angle })

  it('holds the box inside the rotated frame', () => {
    const c = effectiveCrop(W, H, full(10))
    const inset = insetCropForAngle(1, 1, 10, W / H)

    expect(c.w).toBeCloseTo(inset.w, 6)
    expect(c.h).toBeCloseTo(inset.h, 6)
    expect(c.w).toBeLessThan(1)
    // Shrunk about the centre, so it still frames what it framed.
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 6)
    expect(c.y + c.h / 2).toBeCloseTo(0.5, 6)
  })

  it('gives the whole frame back at zero', () => {
    expect(effectiveCrop(W, H, full(0))).toEqual(crop())
  })

  it('treats left and right as the same amount of turn', () => {
    const left = effectiveCrop(W, H, full(-7))
    const right = effectiveCrop(W, H, full(7))

    expect(left.w).toBeCloseTo(right.w, 10)
    expect(left.h).toBeCloseTo(right.h, 10)
  })

  /** The reported bug: the crop shrank a little on every pass of the slider. */
  it('does not ratchet when straightened back and forth', () => {
    const stored = crop()
    const sizes: number[] = []
    for (const angle of [0, 6, -6, 12, -12, 3, -3, 0, 9, -9, 0]) {
      // What the slider writes: the angle, and nothing else.
      sizes.push(effectiveCrop(W, H, { ...stored, angle }).w)
    }

    // Back at zero the whole frame is there, however much turning came first.
    expect(sizes[0]).toBe(1)
    expect(sizes[7]).toBe(1)
    expect(sizes[10]).toBe(1)
    // And one angle always gives one answer, whatever preceded it.
    expect(sizes[1]).toBeCloseTo(sizes[2], 10)
    expect(sizes[3]).toBeCloseTo(sizes[4], 10)
  })

  it('leaves a box that already fits completely alone', () => {
    const small = { ...crop(), x: 0.3, y: 0.3, w: 0.4, h: 0.4, angle: 8 }
    expect(effectiveCrop(W, H, small)).toEqual(small)
  })

  it('reports the constrained size, not the stored one', () => {
    const straight = outputSize(W, H, full(0))
    const turned = outputSize(W, H, full(10))

    expect(straight).toEqual({ width: W, height: H })
    expect(turned.width).toBeLessThan(W)
    // And coming back gives the full frame again, rather than a smaller one.
    expect(outputSize(W, H, full(0))).toEqual(straight)
  })

  it('samples inside the picture once straightened', () => {
    // Every corner of the output must land within the source, or the crop is
    // showing the empty wedge the rotation leaves behind.
    const m = buildUvTransform(W, H, full(12))
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const p = apply(m, u, v)
      expect(p.u).toBeGreaterThanOrEqual(-1e-6)
      expect(p.u).toBeLessThanOrEqual(1 + 1e-6)
      expect(p.v).toBeGreaterThanOrEqual(-1e-6)
      expect(p.v).toBeLessThanOrEqual(1 + 1e-6)
    }
  })
})

describe('frameLayout', () => {
  const frame = (patch: Partial<FrameState> = {}): FrameState => ({
    top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', link: 'all', ...patch,
  })

  it('is a no-op when every side is zero', () => {
    const out = frameLayout(1800, 1200, frame())
    expect(out.framed).toBe(false)
    expect(out.width).toBe(1800)
    expect(out.height).toBe(1200)
  })

  it('treats a missing frame as no frame', () => {
    expect(frameLayout(1800, 1200, null).framed).toBe(false)
    expect(frameLayout(1800, 1200, undefined).width).toBe(1800)
  })

  it('keeps the picture whole and adds the border around it', () => {
    // 10% of the shorter edge (1200) = 120px per side.
    const out = frameLayout(1800, 1200, frame({ top: 10, right: 10, bottom: 10, left: 10 }))
    expect(out.photo).toEqual({ width: 1800, height: 1200 })
    expect(out.inset).toEqual({ top: 120, right: 120, bottom: 120, left: 120 })
    expect(out.width).toBe(2040)
    expect(out.height).toBe(1440)
  })

  it('measures every side against the shorter edge, so equal reads equal', () => {
    const landscape = frameLayout(1800, 1200, frame({ top: 5, right: 5, bottom: 5, left: 5 }))
    const portrait = frameLayout(1200, 1800, frame({ top: 5, right: 5, bottom: 5, left: 5 }))
    expect(landscape.inset.top).toBe(portrait.inset.top)
    expect(landscape.inset.left).toBe(portrait.inset.left)
  })

  it('keeps the sides and the middle adding up exactly, at any size', () => {
    // The invariant the frame pass rests on: the inner rectangle is exactly the
    // photo texture's size, so the copy is one texel to one pixel with no
    // resample. A single pixel of disagreement is a soft seam on all four edges.
    const f = frame({ top: 7.5, right: 3.25, bottom: 11, left: 0.5, link: 'free' })
    for (const [w, h] of [[1800, 1200], [391, 1043], [17, 3], [4096, 4096], [1, 1]]) {
      const out = frameLayout(w, h, f)
      expect(out.width, `${w}x${h} width`).toBe(out.photo.width + out.inset.left + out.inset.right)
      expect(out.height, `${w}x${h} height`).toBe(out.photo.height + out.inset.top + out.inset.bottom)
    }
  })

  it('survives a half-written frame rather than producing NaN', () => {
    // What an older sidecar or a hand-edited preset can hand over.
    const broken = { top: undefined, right: 4, color: '#fff' } as unknown as FrameState
    const out = frameLayout(1000, 1000, broken)
    expect(Number.isFinite(out.width)).toBe(true)
    expect(out.inset.top).toBe(0)
    expect(out.inset.right).toBe(40)
  })
})

describe('padToAspect', () => {
  it('adds height to a picture that is too wide', () => {
    const out = padToAspect(1600, 900, 1)
    expect(out.left).toBe(0)
    expect(out.right).toBe(0)
    expect(out.top).toBeCloseTo(out.bottom, 10)
    expect(out.top).toBeGreaterThan(0)
  })

  it('adds width to a picture that is too tall', () => {
    const out = padToAspect(900, 1600, 1)
    expect(out.top).toBe(0)
    expect(out.bottom).toBe(0)
    expect(out.left).toBeCloseTo(out.right, 10)
  })

  it('adds nothing to a picture already at the ratio', () => {
    expect(padToAspect(1200, 1200, 1)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('actually reaches the target ratio, within the rounding', () => {
    for (const [w, h] of [[1600, 900], [900, 1600], [4000, 3000], [1024, 768]]) {
      for (const ratio of [1, 4 / 5, 16 / 9]) {
        const sides = padToAspect(w, h, ratio)
        const out = frameLayout(w, h, {
          ...sides, color: '#ffffff', link: 'free',
        })
        // Within a pixel: each side rounds on its own, which is the price of the
        // inner rectangle landing on whole pixels.
        expect(Math.abs(out.width / out.height - ratio), `${w}x${h} -> ${ratio}`).toBeLessThan(0.002)
      }
    }
  })

  it('refuses nonsense rather than producing an infinite mat', () => {
    expect(padToAspect(0, 100, 1)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(padToAspect(100, 100, 0)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(padToAspect(100, 100, NaN)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})
