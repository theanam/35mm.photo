import { describe, expect, it } from 'vitest'
import { developFingerprint, librawSettings } from './develop-settings'
import { defaultRawDevelop } from '../editor/edit-stack/defaults'
import type { RawDevelopState } from '../editor/edit-stack/types'

const raw = (patch: Partial<RawDevelopState> = {}): RawDevelopState => ({
  ...defaultRawDevelop(),
  ...patch,
})

describe('librawSettings', () => {
  it('reproduces what the decoder was hard-coded to do', () => {
    // The defaults have to develop every raw already on disk exactly as before
    // the panel existed, or opening an old photo re-renders it.
    expect(librawSettings(raw())).toMatchObject({
      outputBps: 16,
      outputColor: 1,
      noAutoBright: true,
      userFlip: -1,
      useCameraWb: true,
      useAutoWb: false,
      userQual: 3,
      highlight: 0,
      fbddNoiserd: 0,
      halfSize: false,
    })
  })

  it('never asks for two white balances at once', () => {
    for (const whiteBalance of ['camera', 'auto', 'neutral'] as const) {
      const s = librawSettings(raw({ whiteBalance }))
      expect(s.useCameraWb && s.useAutoWb).toBe(false)
    }
    // Neither flag is the camera-neutral multipliers, which is what neutral is.
    const neutral = librawSettings(raw({ whiteBalance: 'neutral' }))
    expect(neutral.useCameraWb).toBe(false)
    expect(neutral.useAutoWb).toBe(false)
  })

  it('orders the demosaic qualities by cost', () => {
    const q = (demosaic: RawDevelopState['demosaic']) => librawSettings(raw({ demosaic })).userQual!
    expect(q('fast')).toBeLessThan(q('standard'))
    expect(q('standard')).toBeLessThan(q('best'))
    // Above 10 is what tips X-Trans into three-pass Markesteijn.
    expect(q('best')).toBeGreaterThan(10)
  })

  it('maps highlight handling onto LibRaw modes', () => {
    const h = (highlights: RawDevelopState['highlights']) =>
      librawSettings(raw({ highlights })).highlight
    expect(h('clip')).toBe(0)
    expect(h('unclip')).toBe(1)
    expect(h('blend')).toBe(2)
    expect(h('rebuild')).toBeGreaterThanOrEqual(3)
  })

  it('sends draft mode to half size', () => {
    expect(librawSettings(raw({ draft: true })).halfSize).toBe(true)
    expect(librawSettings(raw({ draft: false })).halfSize).toBe(false)
  })
})

describe('developFingerprint', () => {
  it('changes when any setting changes', () => {
    // A field left out here would serve a cached develop from the wrong
    // settings, which is a bug you would only notice by disbelieving your eyes.
    const base = developFingerprint(raw())
    const variants: Partial<RawDevelopState>[] = [
      { whiteBalance: 'auto' },
      { whiteBalance: 'neutral' },
      { demosaic: 'fast' },
      { demosaic: 'best' },
      { highlights: 'blend' },
      { highlights: 'rebuild' },
      { noiseReduction: 'light' },
      { noiseReduction: 'full' },
      { draft: true },
    ]
    const seen = new Set([base])
    for (const patch of variants) {
      const fp = developFingerprint(raw(patch))
      expect(fp, `${JSON.stringify(patch)} did not change the fingerprint`).not.toBe(base)
      seen.add(fp)
    }
    expect(seen.size).toBe(variants.length + 1)
  })

  it('is stable for the same settings', () => {
    expect(developFingerprint(raw({ demosaic: 'best' }))).toBe(
      developFingerprint(raw({ demosaic: 'best' })),
    )
  })
})
