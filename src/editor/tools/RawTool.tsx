import { useEditor } from '../edit-stack/store'

/** Read-only for now; the develop parameters arrive with the libraw worker (spec §5). */
export function RawTool() {
  const photo = useEditor((s) => s.photo)
  if (!photo) return null

  const { meta } = photo
  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>As shot</span>
          </header>
          <dl className="facts">
            <div>
              <dt>Camera</dt>
              <dd>{meta.camera ?? '—'}</dd>
            </div>
            <div>
              <dt>Lens</dt>
              <dd>{meta.lens ?? '—'}</dd>
            </div>
            <div>
              <dt>ISO</dt>
              <dd>{meta.iso ?? '—'}</dd>
            </div>
            <div>
              <dt>Sensor</dt>
              <dd className="mono">
                {meta.width} × {meta.height}
              </dd>
            </div>
          </dl>
        </section>
        <section className="tool__group">
          <p className="tool__hint">
            Demosaic, camera matrix and highlight recovery run once in the decoder; every tool
            here works from that developed linear data.
          </p>
        </section>
      </div>
    </div>
  )
}
