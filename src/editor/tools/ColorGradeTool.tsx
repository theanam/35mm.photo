import { useState } from 'react'
import { Slider } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { GRADE_ZONES, type GradeZoneId } from '../edit-stack/types'

const ZONE_LABEL: Record<GradeZoneId, string> = {
  shadows: 'Shadows',
  midtones: 'Midtones',
  highlights: 'Highlights',
  global: 'Global',
}

const ZONE_HINT: Record<GradeZoneId, string> = {
  shadows: 'The darker half of the frame. Where a film stock usually shows its cast.',
  midtones: 'Everything the other two zones leave behind — skin lives here.',
  highlights: 'The brighter half. Warming this while cooling the shadows is the classic split.',
  global: 'On top of all three, everywhere, whatever the brightness.',
}

/**
 * Swatch for the zone button: the zone's own hue at its own saturation, so a
 * glance at the row says which zones are carrying a tint and roughly what.
 */
function swatch(hue: number, sat: number): string {
  return sat <= 0 ? 'transparent' : `hsl(${hue} ${Math.round(40 + sat * 0.5)}% 55%)`
}

export function ColorGradeTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const [zone, setZone] = useState<GradeZoneId>('shadows')

  const grade = edits.colorGrade
  const value = grade[zone]

  const set = (patch: Partial<typeof value>, key: string) => {
    update({ colorGrade: { ...grade, [zone]: { ...value, ...patch } } }, `${key}-${zone}`)
  }

  const touched = (z: GradeZoneId) => grade[z].sat !== 0 || grade[z].lum !== 0

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Zone</span>
            <button
              className="link-button"
              disabled={!touched(zone)}
              onClick={() =>
                update(
                  { colorGrade: { ...grade, [zone]: { hue: 0, sat: 0, lum: 0 } } },
                  `grade-reset-${zone}`,
                )
              }
            >
              Reset {ZONE_LABEL[zone].toLowerCase()}
            </button>
          </header>

          <div className="grade-zones">
            {GRADE_ZONES.map((z) => (
              <button
                key={z}
                className="grade-zone"
                data-active={zone === z || undefined}
                data-touched={touched(z) || undefined}
                onClick={() => setZone(z)}
                aria-pressed={zone === z}
              >
                <span
                  className="grade-zone__dot"
                  style={{ background: swatch(grade[z].hue, grade[z].sat) }}
                  aria-hidden
                />
                {ZONE_LABEL[z]}
              </button>
            ))}
          </div>

          <p className="tool__hint">{ZONE_HINT[zone]}</p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span className="mono">{ZONE_LABEL[zone].toLowerCase()}</span>
          </header>

          {/*
            Hue is a full turn and wraps, so it has no neutral in the way the
            other sliders do — it paints nothing until saturation is up, which
            is why the track is shown but the value only bites above zero sat.
          */}
          <Slider
            label="Hue"
            value={value.hue}
            min={0}
            max={360}
            onChange={(v) => set({ hue: v }, 'grade-hue')}
          />
          <Slider
            label="Saturation"
            value={value.sat}
            min={0}
            max={100}
            onChange={(v) => set({ sat: v }, 'grade-sat')}
          />
          <Slider
            label="Luminance"
            value={value.lum}
            min={-100}
            max={100}
            onChange={(v) => set({ lum: v }, 'grade-lum')}
          />
        </section>
      </div>

      <div className="tool__footer-row">
        <Slider
          label="Balance"
          value={grade.balance}
          min={-100}
          max={100}
          onChange={(v) => update({ colorGrade: { ...grade, balance: v } }, 'grade-balance')}
        />
        <Slider
          label="Blending"
          value={grade.blending}
          min={0}
          max={100}
          onChange={(v) => update({ colorGrade: { ...grade, blending: v } }, 'grade-blending')}
        />
      </div>
    </div>
  )
}
