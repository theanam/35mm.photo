/**
 * Transfer functions for the input space an imported LUT expects (spec §4.3).
 *
 * A large share of `.cube` files sold as "cinematic looks" are built for log
 * footage — S-Log3, V-Log, C-Log3, LogC — not for the display-referred pixels
 * this pipeline hands the look stage. Feeding sRGB into a log LUT produces the
 * familiar washed-out, milky result, so every imported LUT carries the space it
 * was authored for and is resampled into sRGB input at load time.
 *
 * Each `encode` maps scene-linear reflectance (0.18 = mid grey, 1.0 = diffuse
 * white) to the 0..1 code value the LUT is indexed by.
 */

export type InputSpace = 'srgb' | 'rec709' | 'slog3' | 'vlog' | 'clog3' | 'logc3'

export interface InputSpaceDef {
  id: InputSpace
  name: string
  /** Shown under the picker so the choice is not a guess. */
  blurb: string
  /** Scene-linear → code value. Identity-ish for the display-referred spaces. */
  encode: (x: number) => number
}

const log10 = (x: number) => Math.log(x) / Math.LN10

/** sRGB EOTF⁻¹ — also how this app's pixels are already encoded. */
export function srgbEncode(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055
}

export function srgbDecode(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

/** BT.709 OETF. Close to sRGB but not the same curve; some LUTs assume it. */
function rec709Encode(x: number): number {
  return x < 0.018 ? 4.5 * x : 1.099 * Math.pow(Math.max(x, 0), 0.45) - 0.099
}

/** Sony S-Log3, from Sony's published white paper. */
function slog3Encode(x: number): number {
  return x >= 0.01125
    ? (420 + log10((x + 0.01) / (0.18 + 0.01)) * 261.5) / 1023
    : (x * (171.2102946929 - 95) / 0.01125 + 95) / 1023
}

/** Panasonic V-Log. */
function vlogEncode(x: number): number {
  const b = 0.00873
  const c = 0.241514
  const d = 0.598206
  return x < 0.01 ? 5.6 * x + 0.125 : c * log10(x + b) + d
}

/** Canon Log 3, normalised form. */
function clog3Encode(x: number): number {
  if (x < -0.014) return -0.42889912 * log10(-x * 14.98325 + 1) + 0.07623209
  if (x <= 0.014) return 2.3069815 * x + 0.073059361
  return 0.42889912 * log10(x * 14.98325 + 1) + 0.069886632
}

/** ARRI LogC3 at EI 800 — the exposure index nearly every LogC LUT assumes. */
function logc3Encode(x: number): number {
  const cut = 0.010591
  return x > cut
    ? 0.247190 * log10(5.555556 * x + 0.052272) + 0.385537
    : 5.367655 * x + 0.092809
}

export const INPUT_SPACES: InputSpaceDef[] = [
  {
    id: 'srgb',
    name: 'sRGB',
    blurb: 'Ordinary photo LUTs. The right choice unless the LUT says otherwise.',
    encode: srgbEncode,
  },
  {
    id: 'rec709',
    name: 'Rec.709',
    blurb: 'Video-authored LUTs. Slightly flatter mids than sRGB.',
    encode: rec709Encode,
  },
  { id: 'slog3', name: 'S-Log3', blurb: 'Sony log footage.', encode: slog3Encode },
  { id: 'vlog', name: 'V-Log', blurb: 'Panasonic log footage.', encode: vlogEncode },
  { id: 'clog3', name: 'C-Log3', blurb: 'Canon log footage.', encode: clog3Encode },
  { id: 'logc3', name: 'LogC3', blurb: 'ARRI log footage, EI 800.', encode: logc3Encode },
]

export const INPUT_SPACES_BY_ID = new Map(INPUT_SPACES.map((s) => [s.id, s]))

export const DEFAULT_INPUT_SPACE: InputSpace = 'srgb'

export function inputSpaceDef(id: InputSpace | undefined): InputSpaceDef {
  return INPUT_SPACES_BY_ID.get(id ?? DEFAULT_INPUT_SPACE) ?? INPUT_SPACES[0]
}

/**
 * Names that show up in LUT filenames when the file expects log input. Only
 * ever used to *suggest* a space — the picker is what decides.
 */
const HINTS: [RegExp, InputSpace][] = [
  [/s-?log-?3|slog3/i, 'slog3'],
  [/v-?log/i, 'vlog'],
  [/c-?log-?3|clog3/i, 'clog3'],
  [/log-?c|logc3|alexa|arri/i, 'logc3'],
  [/rec\.?709|bt\.?709/i, 'rec709'],
]

/** Best guess at a LUT's input space from its filename and title. */
export function guessInputSpace(...text: (string | undefined)[]): InputSpace {
  const haystack = text.filter(Boolean).join(' ')
  for (const [re, space] of HINTS) if (re.test(haystack)) return space
  return DEFAULT_INPUT_SPACE
}
