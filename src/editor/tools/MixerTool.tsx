import { useState } from 'react'
import { Slider } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { HSL_BANDS, type HslBand } from '../edit-stack/types'

/** Swatches for the 8 bands, matching the hue centres the shader uses. */
const BAND_COLOR: Record<HslBand, string> = {
  red: '#c4514a',
  orange: '#c08243',
  yellow: '#b9ab46',
  green: '#5fa85e',
  aqua: '#4fa6a6',
  blue: '#5a76bd',
  purple: '#8464bb',
  magenta: '#b25597',
}

export function MixerTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const [band, setBand] = useState<HslBand>('red')

  const value = edits.hsl[band]
  const set = (patch: Partial<typeof value>, key: string) => {
    update({ hsl: { ...edits.hsl, [band]: { ...value, ...patch } } }, `${key}-${band}`)
  }

  const touched = (b: HslBand) => {
    const a = edits.hsl[b]
    return a.hue !== 0 || a.sat !== 0 || a.lum !== 0
  }

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Band</span>
            <button
              className="link-button"
              disabled={!touched(band)}
              onClick={() =>
                update(
                  { hsl: { ...edits.hsl, [band]: { hue: 0, sat: 0, lum: 0 } } },
                  `mixer-reset-${band}`,
                )
              }
            >
              Reset {band}
            </button>
          </header>
          <div className="bands">
            {HSL_BANDS.map((b) => (
              <button
                key={b}
                className="band"
                data-active={band === b || undefined}
                data-touched={touched(b) || undefined}
                style={{ '--band': BAND_COLOR[b] } as React.CSSProperties}
                onClick={() => setBand(b)}
                title={b[0].toUpperCase() + b.slice(1)}
                aria-label={b}
                aria-pressed={band === b}
              />
            ))}
          </div>
          <p className="tool__hint">
            Editing <strong>{band}</strong>. Greys are left alone — a band only moves pixels
            that already carry that hue.
          </p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span className="mono" style={{ color: BAND_COLOR[band] }}>
              {band}
            </span>
          </header>
          <Slider
            label="Hue"
            value={value.hue}
            min={-100}
            max={100}
            onChange={(v) => set({ hue: v }, 'mixer-hue')}
          />
          <Slider
            label="Saturation"
            value={value.sat}
            min={-100}
            max={100}
            onChange={(v) => set({ sat: v }, 'mixer-sat')}
          />
          <Slider
            label="Luminance"
            value={value.lum}
            min={-100}
            max={100}
            onChange={(v) => set({ lum: v }, 'mixer-lum')}
          />
        </section>
      </div>
    </div>
  )
}
