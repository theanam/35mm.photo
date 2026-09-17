import type { LookConfig } from './types'

/**
 * The built-in look catalogue. Each one is synthesised from a `ColorTransform`
 * rather than shipping a third-party `.cube`, which keeps the repo clear of the
 * LUT-licensing question the spec flags in §4.3. Set `lut: 'luts/<file>.cube'`
 * on any entry to override the synthesised transform with a real LUT.
 */
export const LOOKS: LookConfig[] = [
  {
    id: 'standard',
    name: 'Standard',
    blurb: 'Neutral rendering with a gentle S-curve.',
    color: { saturation: 1.04 },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.23 },
      { x: 0.75, y: 0.78 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 0, size: 40, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'vivid',
    name: 'Vivid',
    blurb: 'Deep saturation and hard contrast. Landscapes, bright days.',
    color: {
      saturation: 1.42,
      matrix: [1.08, -0.05, -0.03, -0.04, 1.06, -0.02, -0.02, -0.06, 1.08],
      highlightTint: [0.012, 0.0, -0.01],
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.14 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.87 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 0, size: 35, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'portrait',
    name: 'Portrait',
    blurb: 'Soft highlight rolloff, warm skin, restrained reds.',
    color: {
      saturation: 1.06,
      matrix: [1.02, 0.01, -0.01, 0.01, 1.0, -0.01, 0.0, 0.01, 0.99],
      highlightTint: [0.016, 0.006, -0.006],
      shadowTint: [0.004, 0.0, 0.006],
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.22, y: 0.22 },
      { x: 0.62, y: 0.65 },
      { x: 0.86, y: 0.89 },
      { x: 1, y: 0.985 },
    ],
    grain: { amount: 0, size: 45, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'chrome',
    name: 'Chrome',
    blurb: 'Muted, cool-shadowed documentary colour. The house look.',
    color: {
      saturation: 0.86,
      matrix: [0.98, 0.03, -0.01, -0.01, 0.97, 0.04, 0.0, 0.02, 1.0],
      shadowTint: [-0.012, -0.004, 0.022],
      highlightTint: [0.01, 0.004, -0.008],
      blackLift: 0.012,
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.18, y: 0.13 },
      { x: 0.5, y: 0.5 },
      { x: 0.82, y: 0.86 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 18, size: 42, shadowBias: 0.6 },
    defaultStrength: 78,
  },
  {
    id: 'retro-neg',
    name: 'Retro Neg',
    blurb: 'Olive shadows, amber midtones. Scanned colour negative.',
    color: {
      saturation: 0.94,
      matrix: [1.0, 0.04, -0.03, 0.0, 0.99, 0.02, 0.02, 0.05, 0.9],
      shadowTint: [-0.006, 0.014, -0.014],
      highlightTint: [0.02, 0.012, -0.018],
      blackLift: 0.026,
      whiteDrop: 0.012,
    },
    toneCurve: [
      { x: 0, y: 0.02 },
      { x: 0.2, y: 0.17 },
      { x: 0.55, y: 0.57 },
      { x: 0.85, y: 0.88 },
      { x: 1, y: 0.97 },
    ],
    grain: { amount: 26, size: 55, shadowBias: 0.65 },
    defaultStrength: 100,
  },
  {
    id: 'faded',
    name: 'Faded',
    blurb: 'Lifted blacks, dusty warmth. A print left in the window.',
    color: {
      saturation: 0.78,
      highlightTint: [0.024, 0.014, -0.004],
      shadowTint: [0.018, 0.012, 0.006],
      blackLift: 0.055,
      whiteDrop: 0.03,
    },
    toneCurve: [
      { x: 0, y: 0.055 },
      { x: 0.3, y: 0.33 },
      { x: 0.7, y: 0.72 },
      { x: 1, y: 0.955 },
    ],
    grain: { amount: 22, size: 62, shadowBias: 0.4 },
    defaultStrength: 100,
  },
  {
    id: 'neutral',
    name: 'Neutral',
    blurb: 'Low saturation, honest tone. Good base for hand grading.',
    color: {
      saturation: 0.8,
      matrix: [0.99, 0.01, 0.0, 0.0, 0.99, 0.01, 0.01, 0.0, 0.99],
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 0, size: 40, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'cine-flat',
    name: 'Cine Flat',
    blurb: 'Log-ish and desaturated with green shadows. Grades well.',
    color: {
      saturation: 0.7,
      matrix: [0.96, 0.05, -0.01, 0.0, 0.98, 0.02, 0.01, 0.06, 0.93],
      shadowTint: [-0.01, 0.012, -0.002],
      blackLift: 0.045,
      whiteDrop: 0.05,
    },
    toneCurve: [
      { x: 0, y: 0.045 },
      { x: 0.25, y: 0.3 },
      { x: 0.6, y: 0.62 },
      { x: 1, y: 0.95 },
    ],
    grain: { amount: 12, size: 48, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'mono',
    name: 'Mono',
    blurb: 'Panchromatic black and white with a hard shoulder.',
    mono: { mix: [0.28, 0.6, 0.12], contrast: 26, tone: 4 },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.15 },
      { x: 0.5, y: 0.51 },
      { x: 0.8, y: 0.88 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 34, size: 38, shadowBias: 0.55 },
    defaultStrength: 100,
  },
]

export const LOOKS_BY_ID = new Map(LOOKS.map((l) => [l.id, l]))

// Resolution by id lives in `catalogue.ts`, which merges these with whatever
// the user has imported.
