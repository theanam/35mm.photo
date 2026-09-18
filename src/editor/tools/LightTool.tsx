import { Slider, formatSigned } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { NEUTRAL_TEMPERATURE } from '../edit-stack/defaults'
import { autoAdjust } from './auto'

export function LightTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const histogram = useEditor((s) => s.histogram)
  const toast = useEditor((s) => s.toast)

  const onAuto = () => {
    if (!histogram) {
      toast('Waiting for the histogram — try again in a moment', 'error')
      return
    }
    update(autoAdjust(edits, histogram), 'auto')
  }

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Tone</span>
            <button className="link-button" onClick={onAuto}>
              Auto
            </button>
          </header>
          <Slider
            label="Exposure"
            value={edits.exposure}
            min={-5}
            max={5}
            step={0.01}
            resetTo={0}
            format={(v) => formatSigned(v, 0.01)}
            onChange={(v) => update({ exposure: v }, 'exposure')}
          />
          <Slider
            label="Contrast"
            value={edits.contrast}
            min={-100}
            max={100}
            onChange={(v) => update({ contrast: v }, 'contrast')}
          />
          <Slider
            label="Highlights"
            value={edits.highlights}
            min={-100}
            max={100}
            onChange={(v) => update({ highlights: v }, 'highlights')}
          />
          <Slider
            label="Shadows"
            value={edits.shadows}
            min={-100}
            max={100}
            onChange={(v) => update({ shadows: v }, 'shadows')}
          />
          <Slider
            label="Dynamic range"
            value={edits.dynamicRange}
            min={-100}
            max={100}
            onChange={(v) => update({ dynamicRange: v }, 'dynamic-range')}
          />
          <Slider
            label="Whites"
            value={edits.whites}
            min={-100}
            max={100}
            onChange={(v) => update({ whites: v }, 'whites')}
          />
          <Slider
            label="Blacks"
            value={edits.blacks}
            min={-100}
            max={100}
            onChange={(v) => update({ blacks: v }, 'blacks')}
          />
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Colour</span>
          </header>
          <Slider
            label="Warmth"
            value={edits.temperature}
            min={2000}
            max={12000}
            step={10}
            resetTo={NEUTRAL_TEMPERATURE}
            trackGradient="linear-gradient(90deg,#3f5a86,#8a7a5e)"
            format={(v) => `${Math.round(v)}K`}
            onChange={(v) => update({ temperature: v }, 'temperature')}
          />
          <Slider
            label="Tint"
            value={edits.tint}
            min={-100}
            max={100}
            resetTo={0}
            trackGradient="linear-gradient(90deg,#4b7a4e,#8a5580)"
            onChange={(v) => update({ tint: v }, 'tint')}
          />
          <Slider
            label="Vibrance"
            value={edits.vibrance}
            min={-100}
            max={100}
            onChange={(v) => update({ vibrance: v }, 'vibrance')}
          />
          <Slider
            label="Saturation"
            value={edits.saturation}
            min={-100}
            max={100}
            onChange={(v) => update({ saturation: v }, 'saturation')}
          />
          <p className="tool__hint">
            <strong>Dynamic range</strong> opens shadows and holds highlights by reading the
            area around each pixel rather than the pixel alone, so a face in shadow can lift
            without the sky behind it lifting too.
          </p>
          <p className="tool__hint">
            Double-click or alt-click any slider to put it back where it started.
          </p>
        </section>
      </div>
    </div>
  )
}
