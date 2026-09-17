import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'

export function DetailTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Sharpness</span>
          </header>
          <Slider
            label="Clarity"
            value={edits.clarity}
            min={-100}
            max={100}
            onChange={(v) => update({ clarity: v }, 'clarity')}
          />
          <Slider
            label="Sharpen"
            value={edits.sharpen}
            min={0}
            max={100}
            origin={0}
            resetTo={0}
            format={(v) => formatPlain(v)}
            onChange={(v) => update({ sharpen: v }, 'sharpen')}
          />
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Noise</span>
          </header>
          <Slider
            label="Luma NR"
            value={edits.denoiseLuma}
            min={0}
            max={100}
            origin={0}
            resetTo={0}
            format={(v) => formatPlain(v)}
            onChange={(v) => update({ denoiseLuma: v }, 'denoise-luma')}
          />
          <Slider
            label="Chroma NR"
            value={edits.denoiseChroma}
            min={0}
            max={100}
            origin={0}
            resetTo={0}
            format={(v) => formatPlain(v)}
            onChange={(v) => update({ denoiseChroma: v }, 'denoise-chroma')}
          />
          <p className="tool__hint">
            These read at 100% zoom. Fitted to the window the preview is downsampled, so
            sharpening looks weaker here than in the exported file.
          </p>
        </section>
      </div>
    </div>
  )
}
