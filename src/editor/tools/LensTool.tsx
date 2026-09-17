import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'

export function LensTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)

  const perspective = edits.perspective
  const lens = edits.lens

  const setPerspective = (patch: Partial<typeof perspective>, key: string) =>
    update({ perspective: { ...perspective, ...patch } }, key)
  const setLens = (patch: Partial<typeof lens>, key: string) =>
    update({ lens: { ...lens, ...patch } }, key)

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Perspective</span>
          </header>
          <Slider
            label="Vertical"
            value={perspective.vertical}
            min={-100}
            max={100}
            onChange={(v) => setPerspective({ vertical: v }, 'persp-v')}
          />
          <Slider
            label="Horizontal"
            value={perspective.horizontal}
            min={-100}
            max={100}
            onChange={(v) => setPerspective({ horizontal: v }, 'persp-h')}
          />
          <Slider
            label="Aspect"
            value={perspective.aspect}
            min={-100}
            max={100}
            onChange={(v) => setPerspective({ aspect: v }, 'persp-aspect')}
          />
          <Slider
            label="Scale"
            value={perspective.scale}
            min={50}
            max={150}
            origin={100}
            resetTo={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => setPerspective({ scale: v }, 'persp-scale')}
          />
          <p className="tool__hint">
            Straightening converging verticals pulls the frame inward. Scale pushes it back
            out over the empty corners.
          </p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Optics</span>
          </header>
          <Slider
            label="Distortion"
            value={lens.distortion}
            min={-100}
            max={100}
            onChange={(v) => setLens({ distortion: v }, 'lens-distortion')}
          />
          <Slider
            label="Chromatic ab."
            value={lens.ca}
            min={-100}
            max={100}
            format={(v) => formatPlain(v)}
            onChange={(v) => setLens({ ca: v }, 'lens-ca')}
          />
          <p className="tool__hint">
            Corrected by eye, not from a lens profile — those live in a database that cannot
            be shipped with a web app. Negative distortion straightens barrel, positive
            straightens pincushion.
          </p>
        </section>
      </div>
    </div>
  )
}
