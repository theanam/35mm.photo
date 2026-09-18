import type { LibRawSettings } from 'libraw-wasm'
import type { RawDevelopState } from '../editor/edit-stack/types'

/**
 * Translate the five develop controls into the flags LibRaw actually takes.
 *
 * Kept apart from `decode-raw.ts` and free of any I/O so the mapping can be
 * asserted directly: these are the numbers that decide what a photograph looks
 * like before anything else in the app gets to touch it, and a typo in one of
 * them would be invisible until someone noticed their highlights were wrong.
 */

/** Settings that are not the user's to change, and why. */
const FIXED = {
  /** 16 bits per channel; the preview is knocked down to 8, export is not. */
  outputBps: 16,
  /**
   * sRGB primaries. Not exposed: the whole render graph, every look and the
   * histogram assume this space, so changing it here would quietly invalidate
   * all of them. A wider space is a colour-managed-pipeline project, not a
   * dropdown.
   */
  outputColor: 1,
  /**
   * Leave the exposure alone. LibRaw's auto-brighten stretches the histogram by
   * a clipped-pixel percentile, which is a per-file guess — the Light tool and
   * `tools/auto.ts` are where that decision belongs.
   */
  noAutoBright: true,
  /**
   * Let LibRaw apply the camera's rotation. Every vendor records it somewhere
   * different, and RAF in particular is not a TIFF container, so `io/exif.ts`
   * cannot be trusted to find the tag. The pixels arrive upright and the meta
   * reports orientation 1 rather than asking the render graph to rotate twice.
   */
  userFlip: -1,
} as const

/**
 * Demosaic algorithms, by what they cost rather than by name. Measured on a
 * 50 MP frame: fast 3.0s, standard 4.4s, best 8.2s.
 *
 * X-Trans never reaches these — LibRaw routes it to Markesteijn regardless —
 * but it reads a quality above 10 as the signal for the slower three-pass
 * variant, so "best" is meaningfully slower and better there too.
 */
const DEMOSAIC: Record<RawDevelopState['demosaic'], number> = {
  fast: 0, // bilinear
  standard: 3, // AHD
  best: 11, // DHT
}

/**
 * LibRaw's `-H`. Clipping is the honest default: the other modes invent the
 * missing channel, and how convincingly depends on the picture.
 */
const HIGHLIGHTS: Record<RawDevelopState['highlights'], number> = {
  clip: 0,
  unclip: 1,
  blend: 2,
  // 3..9 all rebuild, with rising aggressiveness; 5 is the usual middle.
  rebuild: 5,
}

const NOISE: Record<RawDevelopState['noiseReduction'], number> = {
  off: 0,
  light: 1,
  full: 2,
}

export function librawSettings(raw: RawDevelopState): LibRawSettings {
  return {
    ...FIXED,
    // Exactly one of these may be true. Neither means LibRaw falls back to the
    // camera-neutral multipliers it derived itself, which is what "neutral"
    // asks for.
    useCameraWb: raw.whiteBalance === 'camera',
    useAutoWb: raw.whiteBalance === 'auto',
    userQual: DEMOSAIC[raw.demosaic],
    highlight: HIGHLIGHTS[raw.highlights],
    fbddNoiserd: NOISE[raw.noiseReduction],
    halfSize: raw.draft,
  }
}

/**
 * A short, stable fingerprint of the settings, for the develop cache key.
 *
 * Order-independent by construction — the fields are listed here rather than
 * enumerated from the object — so adding a field to `RawDevelopState` without
 * adding it here would silently serve a stale develop. The test asserts that
 * every field moves the fingerprint.
 */
export function developFingerprint(raw: RawDevelopState): string {
  return [
    raw.whiteBalance,
    raw.demosaic,
    raw.highlights,
    raw.noiseReduction,
    raw.draft ? 'draft' : 'full',
  ].join('-')
}
