import { describe, expect, it } from 'vitest'
import { brushCoverage, cutPatch, findSource, heal, type Plane } from './heal'

/** A deterministic noise field, so a test does not depend on Math.random. */
function noise(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A textured grey field, with an optional left-to-right ramp in brightness. */
function field(width: number, height: number, base = 120, ramp = 0, grain = 12): Plane {
  const rand = noise(7)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = base + (ramp * x) / width + (rand() - 0.5) * grain
      data[i] = v
      data[i + 1] = v * 0.9
      data[i + 2] = v * 0.8
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

/** Darken a disc, the way a blemish sits on skin. */
function spot(img: Plane, cx: number, cy: number, r: number, by = 60) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue
      const i = (y * img.width + x) * 4
      for (let c = 0; c < 3; c++) img.data[i + c] -= by
    }
  }
}

function meanIn(data: Uint8ClampedArray, width: number, cx: number, cy: number, r: number) {
  let sum = 0
  let n = 0
  for (let y = Math.floor(cy - r); y < cy + r; y++) {
    for (let x = Math.floor(cx - r); x < cx + r; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue
      sum += data[(y * width + x) * 4]
      n++
    }
  }
  return sum / n
}

describe('brushCoverage', () => {
  it('is full at the centre, gone past the radius, and fades between', () => {
    const alpha = brushCoverage({ points: [20, 20], radius: 10, feather: 0.5 }, 40, 40)
    expect(alpha[20 * 40 + 20]).toBe(1)
    expect(alpha[20 * 40 + 33]).toBe(0)
    const edge = alpha[20 * 40 + 27]
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
  })

  it('covers the whole length of a dragged stroke, not just its ends', () => {
    const alpha = brushCoverage({ points: [5, 20, 35, 20], radius: 4, feather: 0 }, 40, 40)
    expect(alpha[20 * 40 + 20]).toBe(1)
    expect(alpha[10 * 40 + 20]).toBe(0)
  })
})

describe('heal', () => {
  it('takes a spot out, and leaves everything the brush misses alone', () => {
    const img = field(160, 120)
    const clean = new Uint8ClampedArray(img.data)
    spot(img, 80, 60, 6)
    const alpha = brushCoverage({ points: [80, 60], radius: 9, feather: 0.3 }, 160, 120)

    const plan = findSource(img, alpha, 9)
    expect(plan).not.toBeNull()
    const out = heal(img, alpha, plan!.dx, plan!.dy)

    expect(Math.abs(meanIn(out, 160, 80, 60, 6) - meanIn(clean, 160, 80, 60, 6))).toBeLessThan(4)
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] > 0) continue
      expect(out[i * 4]).toBe(img.data[i * 4])
    }
  })

  it('matches the tone around the spot, not the tone of wherever it copied from', () => {
    // A ramp, so the source is brighter than the target by construction.
    const img = field(200, 80, 80, 90, 6)
    spot(img, 60, 40, 5)
    const alpha = brushCoverage({ points: [60, 40], radius: 8, feather: 0 }, 200, 80)
    const out = heal(img, alpha, 40, 0)

    // Twenty levels brighter at the source; the membrane takes that out.
    const ring = (meanIn(img.data, 200, 60, 40, 12) * 144 - meanIn(img.data, 200, 60, 40, 9) * 81) / 63
    expect(Math.abs(meanIn(out, 200, 60, 40, 5) - ring)).toBeLessThan(5)
  })
})

describe('findSource', () => {
  it('never heals a spot from itself', () => {
    const img = field(120, 120)
    const alpha = brushCoverage({ points: [60, 60, 70, 64], radius: 6, feather: 0 }, 120, 120)
    const plan = findSource(img, alpha, 6)!
    for (let y = 0; y < 120; y++) {
      for (let x = 0; x < 120; x++) {
        if (alpha[y * 120 + x] <= 0) continue
        const sx = x + plan.dx
        const sy = y + plan.dy
        expect(alpha[sy * 120 + sx] ?? 0).toBe(0)
      }
    }
  })

  it('heals a long stroke from beside it, not only from above or below', () => {
    // A band of water between a dark shore and a dark reflection, like a canoe
    // on a lake: the only good source is along the stroke, and a search that
    // measured every direction by its width alone could not reach past its
    // length.
    const img = field(640, 200, 140, 0, 8)
    for (let y = 0; y < 200; y++) {
      if (y >= 70 && y < 130) continue
      for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 4
        img.data[i] = 30
        img.data[i + 1] = 45
        img.data[i + 2] = 30
      }
    }
    const alpha = brushCoverage({ points: [270, 100, 370, 100], radius: 12, feather: 0.3 }, 640, 200)
    const plan = findSource(img, alpha, 12)!
    expect(Math.abs(plan.dx)).toBeGreaterThan(Math.abs(plan.dy))
    expect(plan.score).toBeLessThanOrEqual(1)
  })

  it('says a heal holds on plain texture', () => {
    const img = field(160, 160)
    spot(img, 80, 80, 5)
    const alpha = brushCoverage({ points: [80, 80], radius: 8, feather: 0.3 }, 160, 160)
    expect(findSource(img, alpha, 8)!.score).toBeLessThanOrEqual(1)
  })

  it('says a heal will not hold across an edge nothing nearby repeats', () => {
    // Dark above a line, bright below, and a brush straddling the line near a
    // corner where it bends: no nearby patch has the same edge through it.
    const img = field(160, 160, 60, 0, 4)
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 160; x++) {
        if (y > 80 + (x > 80 ? (x - 80) * 1.5 : 0)) {
          const i = (y * 160 + x) * 4
          img.data[i] = 220
          img.data[i + 1] = 200
          img.data[i + 2] = 180
        }
      }
    }
    const alpha = brushCoverage({ points: [80, 80], radius: 12, feather: 0 }, 160, 160)
    expect(findSource(img, alpha, 12)!.score).toBeGreaterThan(1)
  })
})

describe('cutPatch', () => {
  it('keeps only the rectangle the brush covers', () => {
    const img = field(50, 40)
    const alpha = brushCoverage({ points: [20, 15], radius: 5, feather: 0 }, 50, 40)
    const patch = cutPatch(img.data, alpha, 50, 40)!
    expect(patch.x).toBeGreaterThanOrEqual(14)
    expect(patch.x + patch.width).toBeLessThanOrEqual(26)
    expect(patch.data.length).toBe(patch.width * patch.height * 4)
    expect(patch.data[0]).toBe(img.data[(patch.y * 50 + patch.x) * 4])
  })
})
