import { describe, expect, it } from 'vitest'
import { parseLrTemplate } from './lrtemplate'
import { NEUTRAL_TEMPERATURE } from '../../edit-stack/defaults'

/** Shaped like a real pre-2018 Lightroom export, comments and all. */
const GOLDEN_HOUR = `s = {
	id = "E5F0A1C2-0000-4000-8000-000000000001",
	internalName = "Golden Hour",
	title = "Golden Hour",
	type = "Develop",
	value = {
		settings = {
			-- written by Lightroom 6
			AutoBrightness = false,
			Blacks2012 = -12,
			Clarity2012 = 8,
			Contrast2012 = 20,
			ConvertToGrayscale = false,
			Exposure2012 = -0.25,
			GrainAmount = 15,
			Highlights2012 = -35,
			IncrementalTemperature = -40,
			LuminanceAdjustmentAqua = 5,
			PostCropVignetteAmount = -10,
			SaturationAdjustmentRed = 12,
			Shadows2012 = 30,
			Sharpness = 30,
			SplitToningHighlightHue = 45,
			SplitToningHighlightSaturation = 18,
			ToneCurvePV2012 = {
				0,
				8,
				255,
				250,
			},
			["ProcessVersion"] = "6.7",
		},
		uuid = "1F7E0000-0000-4000-8000-000000000002",
	},
	version = 0,
}`

describe('parseLrTemplate', () => {
  it('takes the name from the title', () => {
    expect(parseLrTemplate(GOLDEN_HOUR).name).toBe('Golden Hour')
  })

  it('falls back through internalName to the id', () => {
    expect(parseLrTemplate('s = { internalName = "Inner", value = { settings = { Contrast2012 = 1 } } }').name)
      .toBe('Inner')
    expect(parseLrTemplate('s = { id = "abc", value = { settings = { Contrast2012 = 1 } } }').name)
      .toBe('abc')
  })

  it('has no name when the template offers none', () => {
    expect(parseLrTemplate('s = { value = { settings = { Contrast2012 = 1 } } }').name).toBeNull()
  })

  it('maps the settings through the same Camera Raw reader as .xmp', () => {
    const { edits } = parseLrTemplate(GOLDEN_HOUR)
    expect(edits.exposure).toBeCloseTo(-0.25, 6)
    expect(edits.contrast).toBe(20)
    expect(edits.highlights).toBe(-35)
    expect(edits.shadows).toBe(30)
    expect(edits.blacks).toBe(-12)
    expect(edits.clarity).toBe(8)
    expect(edits.grain).toBe(15)
  })

  it('applies the range conversions', () => {
    const { edits } = parseLrTemplate(GOLDEN_HOUR)
    expect(edits.sharpen).toBeCloseTo(20, 6) // 30 of 150
    expect(edits.vignette).toBe(10) // −10 darkening becomes +10 here
    expect(edits.temperature)
      .toBeCloseTo(NEUTRAL_TEMPERATURE - 0.4 * (NEUTRAL_TEMPERATURE - 2000), 6)
  })

  it('reads the flat numeric tone curve', () => {
    const rgb = parseLrTemplate(GOLDEN_HOUR).edits.curves!.rgb
    expect(rgb).toHaveLength(2)
    expect(rgb[0].y).toBeCloseTo(8 / 255, 6)
    expect(rgb[1].y).toBeCloseTo(250 / 255, 6)
  })

  it('reads the HSL bands', () => {
    const { hsl } = parseLrTemplate(GOLDEN_HOUR).edits
    expect(hsl!.red.sat).toBe(12)
    expect(hsl!.aqua.lum).toBe(5)
  })

  it('reads legacy split toning into the colour grade', () => {
    const grade = parseLrTemplate(GOLDEN_HOUR).edits.colorGrade!
    expect(grade.highlights).toMatchObject({ hue: 45, sat: 18 })
  })

  it('accepts settings at the top level, without the value wrapper', () => {
    const { edits } = parseLrTemplate('s = { title = "Flat", settings = { Contrast2012 = 15 } }')
    expect(edits.contrast).toBe(15)
  })

  it('rejects a template with no settings table', () => {
    expect(() => parseLrTemplate('s = { title = "x", value = { uuid = "y" } }'))
      .toThrow(/value\.settings/)
  })

  it('rejects a file that is not Lua at all', () => {
    expect(() => parseLrTemplate('<?xml version="1.0"?><x/>')).toThrow()
  })
})
