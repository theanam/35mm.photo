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

  const p02 = percentile(luma, total, 0.02) / 255
  const p98 = percentile(luma, total, 0.98) / 255
  const exposure = autoExposure(histogram)

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

/**
 * The exposure change, in stops, that would put the image's median at a touch
 * below middle grey — 0.45 reads better than a mathematically centred result
 * on most photographs. Zero when there is nothing to measure or the median is
 * pinned at an end, where a log would say something absurd.
 *
 * On its own this is what "auto-expose" means: the one move a camera's JPEG
 * makes that an honest raw develop does not, without the contrast and
 * recovery the full auto adds on top.
 */
export function autoExposure(histogram: HistogramData): number {
  const { luma } = histogram
  const total = luma.reduce((a, b) => a + b, 0)
  if (!total) return 0
  const median = percentile(luma, total, 0.5) / 255
  if (median <= 0.01 || median >= 0.99) return 0
  return clamp(Math.log2(0.45 / median), -2, 2)
}

/**
 * The lift a raw gets on opening, when asked for: what the camera's JPEG did
 * to the same frame, roughly, and no more.
 *
 * Not the full auto. That aims the median at middle grey, which is right for
 * a button somebody presses and wrong for a night scene that opens on its
 * own — a dark frame is meant to be dark, and two stops on it blows every
 * light in it. So this goes halfway to the target, only ever upward, and
 * never past a stop. Whatever the lift would push past white is handed to
 * highlight recovery, sized by how much of the picture that is, since a
 * camera's curve rolls the top off rather than clipping it.
 */
export function openingLift(histogram: HistogramData): Partial<EditState> {
  const { luma } = histogram
  const total = luma.reduce((a, b) => a + b, 0)
  if (!total) return {}
  const median = percentile(luma, total, 0.5) / 255
  if (median <= 0.01 || median >= 0.45) return {}

  const exposure = round2(clamp(0.5 * Math.log2(0.45 / median), 0, 1))
  if (exposure < 0.05) return {}

  // The share of pixels that would land at or above white after the lift.
  const whiteAfter = Math.ceil(255 / Math.pow(2, exposure))
  let above = 0
  for (let i = whiteAfter; i < luma.length; i++) above += luma[i]
  const wouldClip = above / total
  const highlights = wouldClip > 0.005 ? -clamp(Math.round(wouldClip * 600), 10, 50) : 0

  return highlights ? { exposure, highlights } : { exposure }
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
