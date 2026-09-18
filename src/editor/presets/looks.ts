import type { LookConfig } from './types'

/**
 * The built-in look catalogue.
 *
 * Every look is synthesised from a `ColorTransform` rather than shipping a
 * third-party `.cube`, which keeps the repo clear of the LUT-licensing question
 * the spec flags in §4.3. Set `lut: 'luts/<file>.cube'` on any entry to override
 * the synthesised transform with a real LUT.
 *
 * ── How these are built ──
 *
 * A look that only moves saturation and contrast is a filter, and it shows: it
 * lands on every photo the same way. What makes a rendering is *hue-selective*
 * behaviour, because that is what a film stock's dye layers actually do — each
 * responds to its own part of the spectrum, so reds go one way while greens go
 * another. `hueBands` is where nearly all the character here lives; saturation
 * and the tone curve only set the volume.
 *
 * Three rules the whole set follows:
 *
 *   1. Anything that pushes saturation past 1 carries a `satRolloff`, so the
 *      boost fades out in the highlights. Without it a bright sky turns into a
 *      flat block of colour, which is the single clearest tell of a cheap look.
 *   2. Skin is protected. Oranges between about 20° and 45° are left near where
 *      they started unless a look is specifically about warming them.
 *   3. Bands overlap rather than abut. The weighting is a raised cosine, so two
 *      neighbouring bands blend instead of leaving a seam across a gradient.
 *
 * ── On names ──
 *
 * These are named for what they do — the colour, the material, the process.
 * None of them is named after, or claims any relationship to, a camera maker's
 * own picture modes. Where a look lands somewhere familiar that is a matter of
 * the same physics being described twice, and the blurb says what it does
 * rather than what it resembles.
 */
export const LOOKS: LookConfig[] = [
  /* ─────────────────────────── everyday ─────────────────────────── */
  {
    id: 'standard',
    name: 'Standard',
    blurb: 'Neutral rendering with a gentle S-curve.',
    group: 'everyday',
    color: {
      saturation: 1.06,
      satRolloff: 0.4,
      // Barely there: enough to keep faces from reading grey next to a
      // saturated background, not enough to be a "warm" look.
      hueBands: [{ hue: 30, width: 60, sat: 1.03 }],
    },
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
    id: 'neutral',
    name: 'Neutral',
    blurb: 'Low saturation, honest tone. Good base for hand grading.',
    group: 'everyday',
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
    id: 'portrait',
    name: 'Portrait',
    blurb: 'Soft highlight rolloff, warm skin, restrained reds.',
    group: 'everyday',
    color: {
      saturation: 1.05,
      satRolloff: 0.55,
      hueBands: [
        // Skin: a few degrees toward orange and a touch brighter reads as
        // healthy; any more and it reads as fake tan.
        { hue: 28, width: 64, shift: 3, sat: 0.97, lum: 1.02 },
        // Lips, a red shirt, a brick wall behind the subject — all of them
        // compete with a face, so the pure reds come down.
        { hue: 0, width: 44, sat: 0.9 },
        { hue: 120, width: 80, sat: 0.92 },
      ],
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

  /* ─────────────────────────── reversal ─────────────────────────── */
  {
    id: 'vivid',
    name: 'Vivid',
    blurb: 'Deep saturation and hard contrast. Landscapes, bright days.',
    group: 'reversal',
    color: {
      saturation: 1.36,
      satRolloff: 0.45,
      matrix: [1.08, -0.05, -0.03, -0.04, 1.06, -0.02, -0.02, -0.06, 1.08],
      hueBands: [
        // A deep sky is darker as well as more saturated — that is what makes
        // slide film read as slide film rather than as a saturation slider.
        { hue: 225, width: 80, sat: 1.2, lum: 0.93 },
        // Foliage a few degrees toward yellow: spring green rather than the
        // blue-green that heavy saturation otherwise drags it to.
        { hue: 125, width: 85, shift: -5, sat: 1.14 },
        { hue: 2, width: 50, sat: 1.08 },
        { hue: 55, width: 45, sat: 1.05, lum: 1.02 },
      ],
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
    id: 'azure',
    name: 'Azure',
    blurb: 'Cool slide film. Hard skies, deep water, warmth held back.',
    group: 'reversal',
    color: {
      saturation: 1.18,
      satRolloff: 0.5,
      hueBands: [
        { hue: 222, width: 90, sat: 1.28, lum: 0.9 },
        { hue: 190, width: 70, sat: 1.2 },
        { hue: 140, width: 70, shift: 7, sat: 1.02 },
        // Pulling the warm end down is what leaves the cool end looking deep.
        // Raising the blues alone would just make the whole frame louder.
        { hue: 30, width: 55, sat: 0.85 },
        { hue: 0, width: 40, sat: 0.9 },
      ],
      shadowTint: [-0.01, -0.002, 0.014],
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.22, y: 0.17 },
      { x: 0.55, y: 0.56 },
      { x: 0.82, y: 0.87 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 0, size: 38, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'satin',
    name: 'Satin',
    blurb: 'Soft slide. Clean skin, gentle contrast, colour that stays put.',
    group: 'reversal',
    color: {
      saturation: 1.0,
      satRolloff: 0.35,
      hueBands: [
        { hue: 30, width: 60, sat: 1.06, lum: 1.02 },
        { hue: 0, width: 40, sat: 0.9 },
        { hue: 120, width: 75, sat: 0.94 },
        { hue: 225, width: 70, sat: 1.02 },
      ],
      highlightTint: [0.01, 0.005, -0.004],
    },
    toneCurve: [
      { x: 0, y: 0.006 },
      { x: 0.25, y: 0.26 },
      { x: 0.6, y: 0.62 },
      { x: 0.88, y: 0.9 },
      { x: 1, y: 0.99 },
    ],
    grain: { amount: 0, size: 42, shadowBias: 0.5 },
    defaultStrength: 100,
  },

  /* ─────────────────────────── reportage ─────────────────────────── */
  {
    id: 'chrome',
    name: 'Chrome',
    blurb: 'Muted, cool-shadowed documentary colour. The house look.',
    group: 'reportage',
    color: {
      saturation: 0.84,
      satRolloff: 0.25,
      matrix: [0.98, 0.03, -0.01, -0.01, 0.97, 0.04, 0.0, 0.02, 1.0],
      hueBands: [
        // The move that makes this look what it is: reds lose most of their
        // chroma *and* rotate toward brick. A red coat becomes part of the
        // scene instead of the subject of the photograph.
        { hue: 4, width: 48, shift: 7, sat: 0.76 },
        { hue: 52, width: 55, sat: 0.78, lum: 0.98 },
        // Greens toward olive. Grass in this look is never fresh.
        { hue: 120, width: 75, shift: 10, sat: 0.74 },
        // Blues are the exception — holding them is what keeps the picture
        // from reading as simply desaturated.
        { hue: 218, width: 85, sat: 0.98, lum: 0.97 },
      ],
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
    id: 'graphite',
    name: 'Graphite',
    blurb: 'Neutral and hard. Deep blacks, clean whites, one red that survives.',
    group: 'reportage',
    color: {
      saturation: 0.9,
      satRolloff: 0.3,
      hueBands: [
        // Everything steps back except red. A single saturated colour in an
        // otherwise restrained frame is what makes this read as deliberate
        // rather than as a photo with the colour turned down.
        { hue: 2, width: 42, sat: 1.12 },
        { hue: 225, width: 80, sat: 0.96, lum: 0.94 },
        { hue: 55, width: 50, sat: 0.8 },
        { hue: 125, width: 70, sat: 0.82 },
      ],
      shadowTint: [-0.006, -0.002, 0.008],
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.16, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.84, y: 0.89 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 10, size: 36, shadowBias: 0.55 },
    defaultStrength: 100,
  },
  {
    id: 'ochre',
    name: 'Ochre',
    blurb: 'Warm earth, cool shadows. Late afternoon on brick.',
    group: 'reportage',
    color: {
      saturation: 0.92,
      hueBands: [
        { hue: 32, width: 72, sat: 1.14, lum: 1.02 },
        { hue: 58, width: 50, sat: 1.05 },
        { hue: 228, width: 75, sat: 0.86, lum: 0.94 },
        { hue: 115, width: 65, shift: 12, sat: 0.8 },
      ],
      highlightTint: [0.022, 0.012, -0.014],
      shadowTint: [-0.01, -0.002, 0.016],
      blackLift: 0.02,
    },
    toneCurve: [
      { x: 0, y: 0.012 },
      { x: 0.22, y: 0.19 },
      { x: 0.58, y: 0.6 },
      { x: 0.86, y: 0.89 },
      { x: 1, y: 0.985 },
    ],
    grain: { amount: 16, size: 46, shadowBias: 0.6 },
    defaultStrength: 100,
  },

  /* ─────────────────────────── negative ─────────────────────────── */
  {
    id: 'retro-neg',
    name: 'Retro Neg',
    blurb: 'Olive shadows, amber midtones. Scanned colour negative.',
    group: 'negative',
    color: {
      saturation: 0.94,
      matrix: [1.0, 0.04, -0.03, 0.0, 0.99, 0.02, 0.02, 0.05, 0.9],
      hueBands: [
        { hue: 38, width: 70, sat: 1.06 },
        { hue: 110, width: 70, shift: 10, sat: 0.86 },
        { hue: 228, width: 70, sat: 0.9, lum: 0.96 },
      ],
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
    id: 'ember',
    name: 'Ember',
    blurb: 'Punchy negative. Cyan shadows, sour greens, reds that shout.',
    group: 'negative',
    color: {
      saturation: 1.08,
      satRolloff: 0.35,
      hueBands: [
        // Reds rotate *away* from orange here, toward the cold red a colour
        // negative gives you under mixed light.
        { hue: 2, width: 48, shift: -7, sat: 1.2 },
        { hue: 62, width: 60, shift: 8, sat: 1.02 },
        { hue: 188, width: 75, sat: 1.14 },
        { hue: 232, width: 65, sat: 1.05, lum: 0.9 },
        { hue: 120, width: 60, shift: 14, sat: 0.9 },
      ],
      shadowTint: [-0.014, 0.004, 0.018],
      highlightTint: [0.018, 0.012, -0.012],
      blackLift: 0.016,
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.18, y: 0.12 },
      { x: 0.5, y: 0.51 },
      { x: 0.84, y: 0.89 },
      { x: 1, y: 0.995 },
    ],
    grain: { amount: 24, size: 50, shadowBias: 0.6 },
    defaultStrength: 100,
  },
  {
    id: 'faded',
    name: 'Faded',
    blurb: 'Lifted blacks, dusty warmth. A print left in the window.',
    group: 'negative',
    color: {
      saturation: 0.78,
      hueBands: [
        { hue: 35, width: 70, sat: 1.05 },
        { hue: 225, width: 80, sat: 0.84 },
      ],
      highlightTint: [0.024, 0.014, -0.004],
      shadowTint: [0.018, 0.012, 0.006],
      blackLift: 0.055,
      whiteDrop: 0.03,
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.32 },
      { x: 0.7, y: 0.72 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 22, size: 62, shadowBias: 0.4 },
    defaultStrength: 100,
  },

  /* ─────────────────────────── cine ─────────────────────────── */
  {
    id: 'cine-flat',
    name: 'Cine Flat',
    blurb: 'Log-ish and desaturated with green shadows. Grades well.',
    group: 'cine',
    color: {
      saturation: 0.7,
      matrix: [0.96, 0.05, -0.01, 0.0, 0.98, 0.02, 0.01, 0.06, 0.93],
      shadowTint: [-0.01, 0.012, -0.002],
      blackLift: 0.045,
      whiteDrop: 0.05,
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.28 },
      { x: 0.6, y: 0.61 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 12, size: 48, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'cinder',
    name: 'Cinder',
    blurb: 'Teal shadows, warm skin, nothing quite black.',
    group: 'cine',
    color: {
      saturation: 0.84,
      hueBands: [
        // The pairing this whole look is built on: hold the warmth in faces
        // while everything neutral drifts toward teal.
        { hue: 28, width: 60, sat: 1.18, lum: 1.02 },
        { hue: 195, width: 95, sat: 1.12, lum: 0.96 },
        { hue: 130, width: 60, shift: 12, sat: 0.86 },
      ],
      shadowTint: [-0.014, 0.004, 0.012],
      highlightTint: [0.012, 0.006, -0.006],
      blackLift: 0.03,
      whiteDrop: 0.02,
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.26, y: 0.28 },
      { x: 0.62, y: 0.64 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 14, size: 50, shadowBias: 0.55 },
    defaultStrength: 100,
  },
  {
    id: 'bleach',
    name: 'Bleach',
    blurb: 'Silver left in the print: colour nearly gone, contrast way up.',
    group: 'cine',
    color: {
      saturation: 0.4,
      // What little colour survives a bleach bypass is the red end, so the one
      // band here runs against the grain of the saturation above it.
      hueBands: [{ hue: 4, width: 55, sat: 1.35 }],
      shadowTint: [-0.008, -0.002, 0.01],
    },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.18, y: 0.09 },
      { x: 0.5, y: 0.52 },
      { x: 0.82, y: 0.92 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 20, size: 40, shadowBias: 0.6 },
    defaultStrength: 100,
  },

  /* ─────────────────────────── monochrome ─────────────────────────── */
  {
    id: 'mono',
    name: 'Mono',
    blurb: 'Panchromatic black and white with a hard shoulder.',
    group: 'mono',
    // The mix and the curve each apply contrast, so neither carries the whole
    // amount. Between them they land near the shoulder this look wants without
    // closing the shadows up.
    mono: { mix: [0.28, 0.6, 0.12], contrast: 26, tone: 4 },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.2, y: 0.175 },
      { x: 0.5, y: 0.51 },
      { x: 0.8, y: 0.86 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 34, size: 38, shadowBias: 0.55 },
    defaultStrength: 100,
  },
  {
    id: 'ink',
    name: 'Ink',
    blurb: 'Hard black and white. Dark skies, bright skin, no grey mush.',
    group: 'mono',
    // The bands run *before* the mono mix, which makes them a filter over the
    // lens rather than a colour edit: dropping the blues is exactly what a red
    // filter does to a sky, and lifting the oranges is what it does to a face.
    color: {
      hueBands: [
        { hue: 225, width: 95, lum: 0.72 },
        { hue: 30, width: 60, lum: 1.1 },
      ],
    },
    // Hard, but the drama belongs to the sky rather than to a blocked-up
    // foreground: the band above darkens the blues, and the curve is left with
    // enough toe that shadow detail survives being pushed.
    mono: { mix: [0.26, 0.6, 0.14], contrast: 46, tone: 0 },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.18, y: 0.145 },
      { x: 0.5, y: 0.52 },
      { x: 0.82, y: 0.91 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 30, size: 36, shadowBias: 0.5 },
    defaultStrength: 100,
  },
  {
    id: 'selenium',
    name: 'Selenium',
    blurb: 'Cool-toned print. Long scale, blue-black shadows.',
    group: 'mono',
    color: {
      hueBands: [{ hue: 225, width: 90, lum: 0.88 }],
    },
    mono: { mix: [0.3, 0.58, 0.12], contrast: 18, tone: -42 },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.24, y: 0.225 },
      { x: 0.6, y: 0.62 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 26, size: 40, shadowBias: 0.55 },
    defaultStrength: 100,
  },
  {
    id: 'platinum',
    name: 'Platinum',
    blurb: 'Warm, long and soft. Highlights that never quite clip.',
    group: 'mono',
    // A platinum print has no true black and an unusually long scale, so the
    // contrast stays low and the print sits on a lifted base.
    color: { blackLift: 0.035, whiteDrop: 0.015 },
    mono: { mix: [0.34, 0.54, 0.12], contrast: 12, tone: 34 },
    toneCurve: [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.31 },
      { x: 0.72, y: 0.75 },
      { x: 1, y: 1 },
    ],
    grain: { amount: 22, size: 48, shadowBias: 0.45 },
    defaultStrength: 100,
  },
]

export const LOOKS_BY_ID = new Map(LOOKS.map((l) => [l.id, l]))

// Resolution by id lives in `catalogue.ts`, which merges these with whatever
// the user has imported.
