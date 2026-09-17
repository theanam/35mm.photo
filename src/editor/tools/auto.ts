import type { HistogramData } from '../histogram'
import type { EditState } from '../edit-stack/types'

/**
 * A single-pass auto: centre the exposure on the image's own median, then
 * recover whichever end is clipping. Deliberately conservative — an auto that
 * overreaches is worse than one the user nudges afterwards.
 */
export function autoAdjust(edits: EditState, histogram: HistogramData): Partial<EditState> {
  const { luma, clippedHighlights, clippedShadows } = histogram
  const total = luma.reduce((a, b) => a + b, 0)
  if (!total) return {}

  const median = percentile(luma, total, 0.5) / 255
  const p02 = percentile(luma, total, 0.02) / 255
  const p98 = percentile(luma, total, 0.98) / 255

  // Aim the median at 0.45 — a touch below middle grey, which reads better than
  // a mathematically centred result on most photographs.
  const target = 0.45
  let exposure = 0
  if (median > 0.01 && median < 0.99) {
    exposure = clamp(Math.log2(target / median), -2, 2)
  }

  // A flat image (narrow range) gets contrast; a contrasty one is left alone.
  const range = p98 - p02
  const contrast = clamp(Math.round((0.72 - range) * 90), 0, 30)

  const highlights = clippedHighlights > 0.01 ? -clamp(Math.round(clippedHighlights * 900), 8, 48) : 0
  const shadows = clippedShadows > 0.01 ? clamp(Math.round(clippedShadows * 900), 8, 40) : 0

  return {
    exposure: round2(edits.exposure + exposure),
    contrast,
    highlights,
    shadows,
    blacks: p02 > 0.12 ? -clamp(Math.round((p02 - 0.12) * 200), 0, 24) : 0,
    whites: p98 < 0.88 ? clamp(Math.round((0.88 - p98) * 200), 0, 24) : 0,
  }
}

function percentile(bins: Uint32Array, total: number, q: number): number {
  const goal = total * q
  let seen = 0
  for (let i = 0; i < bins.length; i++) {
    seen += bins[i]
    if (seen >= goal) return i
  }
  return bins.length - 1
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function round2(v: number) {
  return Math.round(v * 100) / 100
}
