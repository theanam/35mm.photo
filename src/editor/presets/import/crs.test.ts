import { describe, expect, it } from 'vitest'
import { mapCrsSettings, type CrsSettings } from './crs'
import { NEUTRAL_TEMPERATURE } from '../../edit-stack/defaults'

/**
 * Camera Raw settings as the two readers hand them over: `.xmp` gives strings
 * (they arrive as XML attributes) and tone curves as `"x, y"` pairs;
 * `.lrtemplate` gives real numbers and flat arrays. Both shapes go through
 * here, so the tests use whichever a real file would.
 */
const map = (settings: CrsSettings) => mapCrsSettings(settings)

describe('light and colour', () => {
  it('passes the −100..100 controls straight through', () => {
    const { edits } = map({
      Contrast2012: '+12',
      Highlights2012: '-40',
      Shadows2012: '+25',
      Whites2012: '0',
      Blacks2012: '-8',
      Vibrance: '+18',
      Saturation: '-5',
      Clarity2012: '+6',
    })
    expect(edits).toMatchObject({
      contrast: 12,
      highlights: -40,
      shadows: 25,
      whites: 0,
      blacks: -8,
      vibrance: 18,
      saturation: -5,
      clarity: 6,
    })
  })

  it('reads exposure as EV, signed', () => {
    expect(map({ Exposure2012: '+0.35' }).edits.exposure).toBeCloseTo(0.35, 6)
    expect(map({ Exposure2012: '-1.20' }).edits.exposure).toBeCloseTo(-1.2, 6)
  })

  it('falls back to the pre-2012 exposure key', () => {
    expect(map({ Exposure: '0.5' }).edits.exposure).toBeCloseTo(0.5, 6)
  })

  it("clamps values beyond this pipeline's range", () => {
    expect(map({ Exposure2012: '12' }).edits.exposure).toBe(5)
    expect(map({ Contrast2012: '-400' }).edits.contrast).toBe(-100)
  })

  it('leaves out what the preset does not mention', () => {
    const { edits } = map({ Contrast2012: '10' })
    expect(edits.exposure).toBeUndefined()
    expect(edits.shadows).toBeUndefined()
  })

  it('maps texture and dehaze, which have their own controls now', () => {
    const { edits } = map({ Texture: '+15', Dehaze: '+30' })
    expect(edits.texture).toBe(15)
    expect(edits.dehaze).toBe(30)
  })
})

describe('white balance', () => {
  it('takes an absolute Kelvin temperature as-is, and says where it came from', () => {
    const { edits, dropped } = map({ Temperature: '7200' })
    expect(edits.temperature).toBe(7200)
    expect(dropped.join(' ')).toMatch(/absolute Kelvin/)
  })

  it('clamps an absolute temperature to the slider range', () => {
    expect(map({ Temperature: '50000' }).edits.temperature).toBe(12000)
  })

  it('warms on a positive incremental temperature', () => {
    // +20% of the way from neutral to the warm end.
    expect(map({ IncrementalTemperature: '+20' }).edits.temperature)
      .toBeCloseTo(NEUTRAL_TEMPERATURE + 0.2 * (12000 - NEUTRAL_TEMPERATURE), 6)
  })

  it('cools on a negative incremental temperature', () => {
    expect(map({ IncrementalTemperature: '-40' }).edits.temperature)
      .toBeCloseTo(NEUTRAL_TEMPERATURE - 0.4 * (NEUTRAL_TEMPERATURE - 2000), 6)
  })

  it('does not report an incremental temperature as borrowed from a raw file', () => {
    expect(map({ IncrementalTemperature: '+20' }).dropped.join(' ')).not.toMatch(/Kelvin/)
  })

  it("rescales tint from Lightroom's ±150 to this pipeline's ±100", () => {
    expect(map({ Tint: '-15' }).edits.tint).toBeCloseTo(-10, 6)
    expect(map({ Tint: '150' }).edits.tint).toBeCloseTo(100, 6)
  })
})

describe('detail and finishing', () => {
  it('rescales sharpness from 0..150 to 0..100', () => {
    expect(map({ Sharpness: '60' }).edits.sharpen).toBeCloseTo(40, 6)
    expect(map({ Sharpness: '150' }).edits.sharpen).toBeCloseTo(100, 6)
  })

  it('passes noise reduction and grain through', () => {
    const { edits } = map({
      LuminanceSmoothing: '30',
      ColorNoiseReduction: '25',
      GrainAmount: '22',
      GrainSize: '40',
    })
    expect(edits).toMatchObject({
      denoiseLuma: 30, denoiseChroma: 25, grain: 22, grainSize: 40,
    })
  })

  it('flips the sign of a vignette, which Lightroom counts downwards', () => {
    expect(map({ PostCropVignetteAmount: '-22' }).edits.vignette).toBe(22)
    expect(map({ PostCropVignetteAmount: '+15' }).edits.vignette).toBe(-15)
  })
})

describe('tone curves', () => {
  it('reads the XMP form: "x, y" strings counted in 0–255', () => {
    const rgb = map({ ToneCurvePV2012: ['0, 12', '128, 132', '255, 240'] }).edits.curves!.rgb
    expect(rgb).toHaveLength(3)
    expect(rgb[0].x).toBeCloseTo(0, 6)
    expect(rgb[0].y).toBeCloseTo(12 / 255, 6)
    expect(rgb[2].y).toBeCloseTo(240 / 255, 6)
  })

  it('reads the .lrtemplate form: a flat array of alternating numbers', () => {
    const rgb = map({ ToneCurvePV2012: [0, 8, 255, 250] }).edits.curves!.rgb
    expect(rgb).toHaveLength(2)
    expect(rgb[0].y).toBeCloseTo(8 / 255, 6)
    expect(rgb[1].y).toBeCloseTo(250 / 255, 6)
  })

  it('reads the per-channel curves', () => {
    const { curves } = map({
      ToneCurvePV2012Red: [0, 10, 255, 255],
      ToneCurvePV2012Blue: [0, 0, 255, 245],
    }).edits
    expect(curves!.r[0].y).toBeCloseTo(10 / 255, 6)
    expect(curves!.b[1].y).toBeCloseTo(245 / 255, 6)
    expect(curves!.g).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }])
  })

  it('treats a straight line as no curve at all', () => {
    expect(map({ ToneCurvePV2012: [0, 0, 255, 255] }).edits.curves).toBeUndefined()
  })

  it('falls back to the PV2003 curve when there is no PV2012 one', () => {
    expect(map({ ToneCurve: [0, 20, 255, 255] }).edits.curves!.rgb[0].y)
      .toBeCloseTo(20 / 255, 6)
  })

  it('sorts points that arrive out of order', () => {
    const rgb = map({ ToneCurvePV2012: [255, 250, 0, 8, 128, 120] }).edits.curves!.rgb
    expect(rgb.map((p) => p.x)).toEqual([...rgb.map((p) => p.x)].sort((a, b) => a - b))
  })

  it('ignores a curve with too few usable points', () => {
    expect(map({ ToneCurvePV2012: [0] }).edits.curves).toBeUndefined()
    expect(map({ ToneCurvePV2012: [] }).edits.curves).toBeUndefined()
  })
})

describe('the parametric curve', () => {
  it('lifts its own region and leaves the corners anchored', () => {
    const rgb = map({ ParametricShadows: '+40' }).edits.curves!.rgb
    expect(rgb[0].y).toBeCloseTo(0, 2)
    expect(rgb.at(-1)!.y).toBeCloseTo(1, 2)

    // Default splits put the shadow region around x = 0.125.
    const shadow = rgb.reduce((a, p) => (Math.abs(p.x - 0.125) < Math.abs(a.x - 0.125) ? p : a))
    expect(shadow.y).toBeGreaterThan(shadow.x)
  })

  it('drops its region on a negative value', () => {
    const rgb = map({ ParametricShadows: '-40' }).edits.curves!.rgb
    const shadow = rgb.reduce((a, p) => (Math.abs(p.x - 0.125) < Math.abs(a.x - 0.125) ? p : a))
    expect(shadow.y).toBeLessThan(shadow.x)
  })

  it('moves the highlights, not the shadows, for a highlight slider', () => {
    const rgb = map({ ParametricHighlights: '+40' }).edits.curves!.rgb
    const at = (x: number) => rgb.reduce((a, p) => (Math.abs(p.x - x) < Math.abs(a.x - x) ? p : a))
    expect(at(0.875).y).toBeGreaterThan(at(0.875).x)
    expect(at(0.125).y).toBeCloseTo(at(0.125).x, 2)
  })

  it('composes onto the point curve rather than replacing it', () => {
    const both = map({
      ToneCurvePV2012: [0, 0, 255, 255],
      ParametricShadows: '+40',
    }).edits.curves!.rgb
    // A point curve alone would have stayed at its own two points; the
    // parametric pass resamples, which is the evidence it ran on top.
    expect(both.length).toBeGreaterThan(2)
    expect(both.every((p) => p.y >= 0 && p.y <= 1)).toBe(true)
  })

  it('leaves the curve alone when every region is zero', () => {
    expect(map({ ParametricShadows: '0', ParametricHighlights: '0' }).edits.curves)
      .toBeUndefined()
  })
})

describe('the HSL mixer', () => {
  it('maps the eight bands onto the same eight bands', () => {
    const { hsl } = map({
      HueAdjustmentOrange: '-6',
      SaturationAdjustmentBlue: '-30',
      LuminanceAdjustmentGreen: '+12',
      SaturationAdjustmentAqua: '+8',
      HueAdjustmentMagenta: '+4',
    }).edits
    expect(hsl!.orange.hue).toBe(-6)
    expect(hsl!.blue.sat).toBe(-30)
    expect(hsl!.green.lum).toBe(12)
    expect(hsl!.aqua.sat).toBe(8)
    expect(hsl!.magenta.hue).toBe(4)
  })

  it('leaves untouched bands neutral', () => {
    const { hsl } = map({ HueAdjustmentOrange: '-6' }).edits
    expect(hsl!.red).toEqual({ hue: 0, sat: 0, lum: 0 })
  })

  it('omits the mixer entirely when no band moves', () => {
    expect(map({ HueAdjustmentRed: '0' }).edits.hsl).toBeUndefined()
  })
})

describe('black and white presets', () => {
  it('desaturates and keeps the channel mix as luminance', () => {
    const { edits } = map({
      ConvertToGrayscale: 'True',
      GrayMixerRed: '+40',
      GrayMixerBlue: '-30',
    })
    expect(edits.saturation).toBe(-100)
    expect(edits.hsl!.red.lum).toBe(40)
    expect(edits.hsl!.blue.lum).toBe(-30)
  })

  it('ignores the colour HSL keys once converted to grey', () => {
    const { edits } = map({
      ConvertToGrayscale: 'True',
      SaturationAdjustmentRed: '+50',
      GrayMixerRed: '+10',
    })
    expect(edits.hsl!.red.sat).toBe(0)
    expect(edits.hsl!.red.lum).toBe(10)
  })

  it('does not desaturate when the flag is false', () => {
    expect(map({ ConvertToGrayscale: 'False' }).edits.saturation).toBeUndefined()
  })
})

describe('split toning and colour grading', () => {
  it('reads the legacy SplitToning keys', () => {
    const grade = map({
      SplitToningShadowHue: '220',
      SplitToningShadowSaturation: '25',
      SplitToningHighlightHue: '45',
      SplitToningHighlightSaturation: '15',
      SplitToningBalance: '-20',
    }).edits.colorGrade!
    expect(grade.shadows).toMatchObject({ hue: 220, sat: 25 })
    expect(grade.highlights).toMatchObject({ hue: 45, sat: 15 })
    expect(grade.balance).toBe(-20)
  })

  it('reads the modern ColorGrade keys, including midtones and global', () => {
    const grade = map({
      ColorGradeMidtoneHue: '180',
      ColorGradeMidtoneSat: '30',
      ColorGradeMidtoneLum: '-10',
      ColorGradeGlobalHue: '30',
      ColorGradeGlobalSat: '12',
      ColorGradeBlending: '80',
    }).edits.colorGrade!
    expect(grade.midtones).toEqual({ hue: 180, sat: 30, lum: -10 })
    expect(grade.global).toMatchObject({ hue: 30, sat: 12 })
    expect(grade.blending).toBe(80)
  })

  it('prefers the modern keys when a file carries both', () => {
    const grade = map({
      SplitToningShadowHue: '220',
      SplitToningShadowSaturation: '25',
      ColorGradeShadowHue: '100',
      ColorGradeShadowSat: '40',
    }).edits.colorGrade!
    expect(grade.shadows).toMatchObject({ hue: 100, sat: 40 })
  })

  it('treats zero saturation as an untouched wheel', () => {
    // A hue with no saturation paints nothing, so no grade is written at all.
    expect(map({ SplitToningShadowHue: '220', SplitToningShadowSaturation: '0' })
      .edits.colorGrade).toBeUndefined()
  })

  it('wraps a negative hue into 0..360', () => {
    const grade = map({ ColorGradeShadowHue: '-30', ColorGradeShadowSat: '20' })
      .edits.colorGrade!
    expect(grade.shadows.hue).toBe(330)
  })
})

describe('geometry and optics', () => {
  it('reads the manual perspective sliders', () => {
    const { perspective } = map({
      PerspectiveVertical: '-25',
      PerspectiveHorizontal: '10',
      PerspectiveScale: '110',
    }).edits
    expect(perspective).toMatchObject({ vertical: -25, horizontal: 10, scale: 110 })
  })

  it('treats a scale of 100 as untouched', () => {
    expect(map({ PerspectiveScale: '100' }).edits.perspective).toBeUndefined()
  })

  it("folds Upright's rotation into the crop angle", () => {
    expect(map({ PerspectiveRotate: '5' }).edits.crop!.angle).toBe(5)
  })

  it('reads manual lens distortion', () => {
    expect(map({ LensManualDistortionAmount: '-20' }).edits.lens!.distortion).toBe(-20)
  })
})

describe('what cannot come across', () => {
  it.each([
    ['masks', { MaskGroupBasedCorrections: true }, /masks/],
    ['radial masks', { CircularGradientBasedCorrections: true }, /masks/],
    ['brush strokes', { PaintBasedCorrections: true }, /masks/],
    ['a referenced profile', { LookName: 'Adobe Color' }, /profile/],
    ['an embedded look table', { LookTable: true }, /profile/],
    ['camera calibration', { RedHue: '20' }, /calibration/],
    ['a shadow tint', { ShadowTint: '10' }, /calibration/],
    ['a lens profile', { LensProfileEnable: 'true' }, /lens profile/],
    ['defringe', { DefringePurpleAmount: '8' }, /defringe/],
    ['automatic Upright', { PerspectiveUpright: '2' }, /Upright/],
    ['retouch spots', { RetouchAreas: [{}] }, /retouch/],
  ])('reports %s', (_what, settings, pattern) => {
    expect(map(settings as CrsSettings).dropped.join(' | ')).toMatch(pattern)
  })

  it('says nothing about settings that are present but at their default', () => {
    expect(map({ RedHue: '0', DefringePurpleAmount: '0', PerspectiveUpright: '0' }).dropped)
      .toEqual([])
  })

  it('reports nothing for a preset it can fully reproduce', () => {
    expect(map({ Exposure2012: '0.5', Contrast2012: '10' }).dropped).toEqual([])
  })
})

describe('empty and malformed input', () => {
  it('returns nothing for an empty settings block', () => {
    const { edits, dropped } = map({})
    expect(edits).toEqual({})
    expect(dropped).toEqual([])
  })

  it('ignores values that are not numbers', () => {
    expect(map({ Exposure2012: 'quite bright' }).edits.exposure).toBeUndefined()
  })
})
