import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { getLook } from '../presets/catalogue'

export function GrainTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const look = getLook(edits.look.id)

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Grain</span>
            {look && !look.custom && (
              <span className="tool__note">{look.name} defaults applied</span>
            )}
          </header>
          <Slider
            label="Amount"
            value={edits.grain}
            min={0}
            max={100}
            origin={0}
            resetTo={0}
            format={(v) => formatPlain(v)}
            onChange={(v) => update({ grain: v }, 'grain')}
          />
          <Slider
            label="Size"
            value={edits.grainSize}
            min={0}
            max={100}
            origin={0}
            resetTo={50}
            disabled={edits.grain === 0}
            format={(v) => formatPlain(v)}
            onChange={(v) => update({ grainSize: v }, 'grain-size')}
          />
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Vignette</span>
          </header>
          <Slider
            label="Amount"
            value={edits.vignette}
            min={-100}
            max={100}
            onChange={(v) => update({ vignette: v }, 'vignette')}
          />
          <p className="tool__hint">
            Positive darkens the corners, negative lifts them.
          </p>
        </section>
      </div>
    </div>
  )
}
