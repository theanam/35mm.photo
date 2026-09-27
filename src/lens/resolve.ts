import type { ImageMeta, LensState } from '../editor/edit-stack/types'
import { swapsAxes } from '../io/exif'
import { lensUniforms, type LensUniforms } from './uniforms'
import { loadLensIndex, loadLensShard } from './db'
import { loadRemembered } from './remember'
import { confidenceOf, cropFactorOf, matchCamera, rankLenses, type Confidence, type LensCandidate, type Shot } from './match'
import {
  distortionAt,
  pickCalibrationSet,
  tcaAt,
  vignettingAt,
  type DistortionCoefficients,
  type TcaCoefficients,
  type VignettingCoefficients,
} from './model'
import type { DbCamera, DbLensIndex } from './types'

/**
 * From a photo's metadata to the corrections the database has for it.
 *
 * Done once per photo, not per frame: the answer only changes when the photo
 * does, or when the user picks a different lens. What comes back is data —
 * coefficients in the calibration's own units and the facts the panel shows —
 * and `uniforms.ts` turns it into what the shader takes.
 */

export type ResolveReason =
  | 'no-database'
  | 'no-lens-named'
  | 'unknown-lens'
  | 'no-focal-length'
  | 'no-calibration'

export interface ResolvedLens {
  source: 'lensfun' | 'none'
  camera: DbCamera | null
  /** The photo's crop factor, from the body or the 35 mm equivalent. */
  crop: number | null
  lens: DbLensIndex | null
  confidence: Confidence
  reason?: ResolveReason
  /** Best guesses for the picker, when the match is uncertain or absent. */
  candidates: LensCandidate[]
  /** Set when the user chose the lens rather than the matcher. */
  chosen: boolean
  rectilinear: boolean
  distortion: DistortionCoefficients | null
  tca: TcaCoefficients | null
  vignetting: VignettingCoefficients | null
  /** The focal length and aperture the coefficients were made for. */
  focal: number | null
  aperture: number | null
}

/** What the decoders put on `ImageMeta`, in the matcher's terms. */
export function shotOf(meta: ImageMeta): Shot {
  return {
    make: meta.make,
    model: meta.model,
    lensMake: meta.lensMake,
    lens: meta.lens,
    focal: meta.focal,
    aperture: meta.aperture,
    focal35: meta.focal35,
  }
}

/** The key a remembered choice is filed under: this body, this lens string. */
export function rememberKey(shot: Shot): string {
  return [shot.make ?? '', shot.model ?? '', shot.lensMake ?? '', shot.lens ?? ''].join('|').toLowerCase()
}

const NONE: Omit<ResolvedLens, 'reason'> = {
  source: 'none',
  camera: null,
  crop: null,
  lens: null,
  confidence: 'none',
  candidates: [],
  chosen: false,
  rectilinear: true,
  distortion: null,
  tca: null,
  vignetting: null,
  focal: null,
  aperture: null,
}

export async function resolveLens(
  shot: Shot,
  lensId: string | null,
  remembered: Record<string, string> = {},
): Promise<ResolvedLens> {
  const db = await loadLensIndex()
  if (!db) return { ...NONE, reason: 'no-database' }

  const camera = matchCamera(db, shot)
  const crop = cropFactorOf(camera, shot)
  const ranked = rankLenses(db, shot, camera)
  const candidates = ranked.slice(0, 8)

  let lens: DbLensIndex | null = null
  let confidence: Confidence = 'none'
  let chosen = false
  const choice = lensId ?? remembered[rememberKey(shot)] ?? null
  if (choice) {
    lens = db.lenses.find((l) => l.id === choice) ?? null
    if (lens) {
      confidence = 'high'
      chosen = true
    }
  }
  if (!lens) {
    confidence = confidenceOf(ranked, shot)
    if (confidence !== 'none') lens = ranked[0].lens
  }
  if (!lens) {
    return { ...NONE, camera, crop, candidates, reason: shot.lens ? 'unknown-lens' : 'no-lens-named' }
  }

  const rectilinear = !lens.type || lens.type === 'rectilinear'
  const focal = shot.focal ?? (lens.minFocal === lens.maxFocal ? lens.minFocal : null)
  const aperture = shot.aperture ?? null
  const partial = { ...NONE, camera, crop, lens, confidence, candidates, chosen, rectilinear, focal, aperture }
  if (focal === null) return { ...partial, reason: 'no-focal-length' }

  const shard = await loadLensShard(lens.shard)
  const sets = shard?.[lens.id]
  if (!sets?.length) return { ...partial, reason: shard ? 'no-calibration' : 'no-database' }

  const distortion = rectilinear
    ? (() => {
        const set = pickCalibrationSet(sets, crop, (s) => s.distortion.length > 0)
        return set ? distortionAt(set, focal) : null
      })()
    : null
  const tcaSet = pickCalibrationSet(sets, crop, (s) => s.tca.length > 0)
  const tca = tcaSet ? tcaAt(tcaSet, focal) : null
  const vigSet = pickCalibrationSet(sets, crop, (s) => s.vignetting.length > 0)
  const vignetting = vigSet && aperture ? vignettingAt(vigSet, lens, focal, aperture) : null

  if (!distortion && !tca && !vignetting) return { ...partial, reason: 'no-calibration' }
  return { ...partial, source: 'lensfun', distortion, tca, vignetting }
}

/**
 * Everything at once, for a render that has no store to ask: resolve the
 * photo's lens and pack the uniforms. What an export calls, so the file gets
 * the geometry the viewport showed rather than whatever a caller remembered
 * to pass.
 */
export async function resolveLensUniforms(meta: ImageMeta, lens: LensState): Promise<LensUniforms> {
  const profile = await resolveLens(shotOf(meta), lens.correction.lensId, loadRemembered())
  return lensUniforms(profile, lens, meta.isRaw, ...storedSize(meta))
}

/** The texture's own width and height: the upright ones, swapped back if EXIF turned them. */
export function storedSize(meta: ImageMeta): [number, number] {
  return swapsAxes(meta.orientation) ? [meta.height, meta.width] : [meta.width, meta.height]
}
