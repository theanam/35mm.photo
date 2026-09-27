/**
 * The Lensfun database, as this app carries it.
 *
 * Lensfun ships as C code plus an XML database. Only the data is used here —
 * converted at build time into an index small enough to precache and shards
 * fetched by lens maker on first use. The shapes below are what the build
 * script emits and what the matcher and the models read; nothing of the C
 * library's own types survives.
 */

export interface DbMount {
  name: string
  /** Mounts whose lenses also fit, by adapter or by design. */
  compat: string[]
}

export interface DbCamera {
  maker: string
  model: string
  /** Sub-model text the maker puts after the model name, when present. */
  variant?: string
  mount: string
  /** Sensor crop factor against full frame. */
  crop: number
}

/** The part of a lens the index carries: enough to match on, nothing to render with. */
export interface DbLensIndex {
  id: string
  maker: string
  model: string
  /** The English display name where the database gives one. */
  name?: string
  mounts: string[]
  minFocal: number
  maxFocal: number
  /** Widest aperture at the short end, when known. */
  minAperture?: number
  crop: number
  /** Projection. Anything but rectilinear gets colour corrections only. */
  type?: string
  /** Which corrections at least one calibration set provides. */
  has: ('distortion' | 'tca' | 'vignetting')[]
  /** The shard file holding this lens's calibrations. */
  shard: string
}

export type DistortionModel = 'poly3' | 'poly5' | 'ptlens'
export type TcaModel = 'linear' | 'poly3'
export type VignettingModel = 'pa'

export interface CalibDistortion {
  model: DistortionModel
  focal: number
  /** The measured focal length, where the calibrator recorded one. */
  realFocal?: number
  /** poly3: [k1]; poly5: [k1, k2]; ptlens: [a, b, c]. */
  terms: number[]
}

export interface CalibTca {
  model: TcaModel
  focal: number
  /** linear: [kr, kb]; poly3: [vr, vb, cr, cb, br, bb] — Lensfun's own order. */
  terms: number[]
}

export interface CalibVignetting {
  model: VignettingModel
  focal: number
  aperture: number
  distance: number
  terms: [number, number, number]
}

/**
 * One set of measurements, made on one sensor. A lens can carry several,
 * for the different crop factors it has been calibrated on.
 */
export interface CalibrationSet {
  crop: number
  /** Width ÷ height of the calibration frames. */
  aspect: number
  distortion: CalibDistortion[]
  tca: CalibTca[]
  vignetting: CalibVignetting[]
}

export interface DbLens extends DbLensIndex {
  calibrations: CalibrationSet[]
}

export interface LensDbIndex {
  /** The lensfun/lensfun commit the data was taken from. */
  commit: string
  generated: string
  mounts: DbMount[]
  cameras: DbCamera[]
  lenses: DbLensIndex[]
}

/** A shard: calibrations by lens id, for every lens of one maker. */
export type LensDbShard = Record<string, CalibrationSet[]>
