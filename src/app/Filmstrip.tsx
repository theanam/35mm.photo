import { useEditor } from '../editor/edit-stack/store'
import { pickFiles } from '../io/file-system'
import type { Frame } from '../editor/edit-stack/types'

export function Filmstrip() {
  const frames = useEditor((s) => s.frames)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  const selectFrame = useEditor((s) => s.selectFrame)
  const openFiles = useEditor((s) => s.openFiles)

  /**
   * A folder of raw files shot alongside their JPEGs is the ordinary case, not
   * an edge one, and the two are different material: one is a negative to
   * develop, the other a print someone already made. Split them when both are
   * present, and leave a single-material folder as one flat list rather than
   * putting a lone heading above everything.
   */
  const raw = frames.filter((f) => f.meta.isRaw)
  const rendered = frames.filter((f) => !f.meta.isRaw)
  const mixed = raw.length > 0 && rendered.length > 0

  const addPhotos = () => void pickFiles().then(openFiles)

  const thumbs = (list: Frame[]) =>
    list.map((frame) => (
      <li key={frame.id}>
        <button
          className="thumb"
          data-active={frame.id === activeFrameId || undefined}
          data-error={Boolean(frame.error) || undefined}
          onClick={() => selectFrame(frame.id)}
          title={frame.error ? `${frame.meta.name} — ${frame.error}` : frame.meta.name}
        >
          {frame.thumbUrl ? (
            <img src={frame.thumbUrl} alt="" loading="lazy" />
          ) : (
            <span className="thumb__placeholder" aria-hidden />
          )}
          {frame.error && <span className="thumb__badge">!</span>}
          <span className="visually-hidden">{frame.meta.name}</span>
        </button>
      </li>
    ))

  return (
    <nav className="filmstrip" aria-label="Photos in this folder">
      <header className="filmstrip__header">
        <span>FOLDER</span>
        <span className="filmstrip__count">
          <span className="mono">{frames.length}</span>
          <button
            className="filmstrip__add"
            onClick={addPhotos}
            title="Add more photos…"
            aria-label="Add more photos"
          >
            +
          </button>
        </span>
      </header>

      {mixed ? (
        <div className="filmstrip__groups">
          <section className="filmstrip__group">
            <h2 className="filmstrip__group-title">
              RAW <span className="mono">{raw.length}</span>
            </h2>
            <ol className="filmstrip__list filmstrip__list--grouped">{thumbs(raw)}</ol>
          </section>

          <section className="filmstrip__group">
            <h2 className="filmstrip__group-title">
              PHOTOS <span className="mono">{rendered.length}</span>
            </h2>
            <ol className="filmstrip__list filmstrip__list--grouped">{thumbs(rendered)}</ol>
          </section>
        </div>
      ) : (
        <ol className="filmstrip__list">
          {thumbs(frames)}

          {frames.length === 0 &&
            [0, 1, 2].map((i) => <li key={i} className="thumb thumb--empty" aria-hidden />)}
        </ol>
      )}

      {frames.length > 0 && (
        <button className="filmstrip__add-row" onClick={addPhotos}>
          + Add photos…
        </button>
      )}
    </nav>
  )
}
