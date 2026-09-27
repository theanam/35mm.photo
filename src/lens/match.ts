import type { DbCamera, DbLensIndex, DbMount, LensDbIndex } from './types'

/**
 * Finding a photo's camera and lens in the database.
 *
 * What the camera wrote and what the database calls the same thing rarely
 * agree letter for letter: "FUJIFILM" and "Fujifilm", "FE 24-70mm F2.8 GM"
 * and "FE 24-70mm f/2.8 GM", "24.0-70.0 mm f/2.8" and "Nikon AF-S Nikkor
 * 24-70mm f/2.8G ED". So both sides are boiled down to tokens, and the tokens
 * that identify a lens — its focal range and its aperture — count for more
 * than the ones that decorate it.
 */

/** What a photo tells us, as the decoders read it. */
export interface Shot {
  make?: string
  model?: string
  lensMake?: string
  lens?: string
  focal?: number
  aperture?: number
  /** Focal length in 35 mm terms, which gives the crop factor when present. */
  focal35?: number
}

export type Confidence = 'high' | 'ambiguous' | 'none'

export interface LensCandidate {
  lens: DbLensIndex
  /** 0..1 — how much of what the camera said the candidate accounts for. */
  score: number
}

/* ───────────────────────── normalisation ───────────────────────── */

/** Corporate suffixes that makers append and nobody means. */
const NOISE = /\b(corporation|corp|company|co|ltd|inc|imaging|camera ag|ag|techwin|computer|optical|solutions)\b\.?/g

const MAKER_ALIASES: Record<string, string> = {
  'konica minolta': 'konica minolta',
  minolta: 'minolta',
  'om digital': 'om system',
  'om system': 'om system',
  olympus: 'olympus',
  'carl zeiss': 'zeiss',
  'eastman kodak': 'kodak',
  'asahi': 'pentax',
  'ricoh': 'ricoh',
  'leica': 'leica',
  'panasonic': 'panasonic',
  'lumix': 'panasonic',
}

export function normalizeMaker(s: string | undefined): string {
  if (!s) return ''
  let m = s.toLowerCase().replace(/[.,]/g, ' ').replace(NOISE, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
  for (const [key, alias] of Object.entries(MAKER_ALIASES)) {
    if (m === key || m.startsWith(key + ' ')) return alias
  }
  // "nikon corporation" → "nikon"; "sony" → "sony". The first word is the brand.
  m = m.split(' ')[0] ?? m
  return m
}

/** Lowercase, punctuation to spaces, and the maker's own name dropped from the front. */
export function normalizeModel(model: string | undefined, maker: string | undefined): string {
  if (!model) return ''
  let m = model.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const brand = normalizeMaker(maker)
  const rawBrand = (maker ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  for (const prefix of [rawBrand, brand]) {
    if (prefix && m.startsWith(prefix + ' ')) m = m.slice(prefix.length + 1)
  }
  return m
}

export interface LensTokens {
  /** Every token, for overlap. */
  all: Set<string>
  /** "24-70" or "85", the focal range, when one is written. */
  focal?: string
  /** "f2.8-4" or "f4", the aperture, when one is written. */
  aperture?: string
}

const DROP = new Set(['lens', 'mm', 'and', 'the'])

/**
 * "XF18-55mmF2.8-4 R LM OIS" → { xf, 18-55, f2.8-4, r, lm, ois }.
 *
 * Numbers keep their ranges and their decimals; "24.0-70.0" becomes "24-70";
 * "f/2.8" and "F2.8" both become "f2.8"; letters and digits are split apart
 * so "RF24-105mm" reads as "rf", "24-105".
 */
export function lensTokens(s: string | undefined): LensTokens {
  const all = new Set<string>()
  const out: LensTokens = { all }
  if (!s) return out
  let t = s.toLowerCase()
  t = t.replace(/f\s*\/\s*(\d)/g, 'f$1') // f/2.8 → f2.8
  t = t.replace(/(\d)\s*mm/g, '$1 ') // 24mm → 24; 55mmF2.8 → 55 f2.8
  t = t.replace(/(\d+)\.0\b/g, '$1') // 24.0 → 24
  t = t.replace(/\s*-\s*/g, '-') // 24 - 70 → 24-70
  const re = /f\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?|\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?|[a-z]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const tok = m[0]
    if (DROP.has(tok)) continue
    all.add(tok)
    if (!out.aperture && /^f\d/.test(tok)) out.aperture = tok
    else if (!out.focal && /^\d/.test(tok) && !tok.startsWith('0')) out.focal = tok
  }
  return out
}

/* ───────────────────────── cameras ───────────────────────── */

export function matchCamera(index: LensDbIndex, shot: Shot): DbCamera | null {
  const maker = normalizeMaker(shot.make)
  const model = normalizeModel(shot.model, shot.make)
  if (!model) return null

  let fallback: DbCamera | null = null
  for (const c of index.cameras) {
    const cModel = normalizeModel(c.model, c.maker)
    if (cModel !== model) continue
    if (normalizeMaker(c.maker) === maker) return c
    // The same model name under a differently spelt maker is almost always
    // the same camera; keep it in case nothing better turns up.
    fallback ??= c
  }
  return fallback
}

/** The crop factor, from the camera when it is known, else from the focal lengths. */
export function cropFactorOf(camera: DbCamera | null, shot: Shot): number | null {
  if (camera) return camera.crop
  if (shot.focal && shot.focal35 && shot.focal > 0) return shot.focal35 / shot.focal
  return null
}

/* ───────────────────────── lenses ───────────────────────── */

function compatibleMounts(index: LensDbIndex, mount: string): Set<string> {
  const out = new Set([mount, 'Generic'])
  const entry: DbMount | undefined = index.mounts.find((m) => m.name === mount)
  for (const c of entry?.compat ?? []) out.add(c)
  return out
}

const FOCAL_SLACK = 0.12

function coversFocal(lens: DbLensIndex, focal: number | undefined): boolean {
  if (!focal || !lens.maxFocal) return true
  return lens.minFocal * (1 - FOCAL_SLACK) <= focal && focal <= lens.maxFocal * (1 + FOCAL_SLACK)
}

/**
 * Every lens that could have taken the photo, best first.
 *
 * Mount and focal length are hard filters, where they are known: a lens that
 * does not fit the camera, or cannot reach the focal length, is not a
 * candidate however well its name matches. Among the rest, the score is how
 * much of the lens string the camera wrote is accounted for, focal and
 * aperture counting for more than the rest, less a little for every word the
 * candidate has that the camera did not write — so "GM" outranks "GM II" when
 * the camera said "GM".
 */
export function rankLenses(index: LensDbIndex, shot: Shot, camera: DbCamera | null): LensCandidate[] {
  const mounts = camera ? compatibleMounts(index, camera.mount) : null
  const wanted = lensTokens(shot.lens)
  const exact = normalizeLensName(shot.lens)
  // A maker's name inside the lens string — "Viltrox 85mm F1.4 FE" — names the
  // maker as surely as the LensMake tag does, and a Sony 85mm f/1.4 is not it.
  const makers = new Set(index.lenses.map((l) => normalizeMaker(l.maker)))
  const namedMaker = [...wanted.all].find((t) => makers.has(t))
  const wantedMaker = normalizeMaker(shot.lensMake) || namedMaker || ''

  const weight = (tok: string) =>
    tok === wanted.focal ? 3 : tok === wanted.aperture ? 2 : 1
  const total = [...wanted.all].reduce((n, t) => n + weight(t), 0)

  const out: LensCandidate[] = []
  for (const lens of index.lenses) {
    if (mounts && !lens.mounts.some((m) => mounts.has(m))) continue
    if (!coversFocal(lens, shot.focal)) continue

    let score = 0
    if (wanted.all.size) {
      const names = [lens.model, lens.name].filter((n): n is string => Boolean(n))
      let best = 0
      for (const name of names) {
        if (normalizeLensName(name) === exact) {
          best = 1
          break
        }
        const have = lensTokens(name)
        // The maker's name in the candidate is not a word the camera failed to
        // write; it is the database being explicit.
        const brand = normalizeMaker(lens.maker)
        let matched = 0
        for (const t of wanted.all) if (have.all.has(t)) matched += weight(t)
        let extra = 0
        for (const t of have.all) if (!wanted.all.has(t) && t !== brand) extra++
        // Short of exact, which is reserved for the string itself.
        const s = Math.min(0.99, total ? matched / total - extra * 0.04 : 0)
        if (s > best) best = s
      }
      score = best
      // A lens that names its maker: disagreeing is disqualifying.
      if (wantedMaker && wantedMaker !== normalizeMaker(lens.maker)) {
        if (!lens.model.toLowerCase().includes(wantedMaker)) score -= 0.5
      }
      // A word the camera wrote that the candidate lacks — "Art", "Macro", a
      // maker — is a lens that is not quite this one, however the numbers
      // agree. Numbers and two-letter marks like "II" or "GM" are not held to
      // this, since they are what the score already weighs.
      if (score < 1) {
        const have = lensTokens(`${lens.maker} ${lens.model} ${lens.name ?? ''}`).all
        const missingWord = [...wanted.all].some((t) => /^[a-z]{3,}$/.test(t) && !have.has(t))
        if (missingWord) score = Math.min(score, 0.79)
      }
    } else if (camera && mounts) {
      // No lens string at all — a fixed-lens camera, usually. Anything on its
      // mount is a candidate, and there is usually exactly one.
      score = lens.mounts.includes(camera.mount) ? 0.5 : 0
    }
    if (score > 0) out.push({ lens, score: Math.min(1, score) })
  }
  return out.sort((a, b) => b.score - a.score || a.lens.model.localeCompare(b.lens.model))
}

function normalizeLensName(s: string | undefined): string {
  return [...lensTokens(s).all].sort().join(' ')
}

/**
 * How sure to be about the top candidate. High applies silently; ambiguous
 * applies but asks; none leaves the picker open and the sliders manual.
 */
export function confidenceOf(ranked: LensCandidate[], shot: Shot): Confidence {
  const [best, next] = ranked
  if (!best) return 'none'
  if (!shot.lens) {
    // Fixed lens: one candidate on the mount is a certainty, more is a question.
    return ranked.length === 1 ? 'high' : 'ambiguous'
  }
  // The database spells it exactly as the camera did: that is the lens.
  if (best.score >= 1) return 'high'
  if (best.score >= 0.8 && (!next || best.score - next.score >= 0.12)) return 'high'
  if (best.score >= 0.4) return 'ambiguous'
  return 'none'
}
