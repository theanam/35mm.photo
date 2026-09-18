import { describe, expect, it } from 'vitest'
import {
  applyMat3Point,
  buildPerspective,
  buildUprightTransform,
  buildUvTransform,
  mat3Identity,
  mat3Invert,
  mat3Mul,
  outputSize,
  uprightSize,
} from './transform'
import { defaultEdits } from '../edit-stack/defaults'

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
