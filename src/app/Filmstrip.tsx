import { useEditor } from '../editor/edit-stack/store'

export function Filmstrip() {
  const frames = useEditor((s) => s.frames)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  const selectFrame = useEditor((s) => s.selectFrame)

  return (
    <nav className="filmstrip" aria-label="Photos in this folder">
      <header className="filmstrip__header">
        <span>FOLDER</span>
        <span className="mono">{frames.length}</span>
      </header>

      <ol className="filmstrip__list">
        {frames.map((frame) => (
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
        ))}

        {frames.length === 0 &&
          [0, 1, 2].map((i) => <li key={i} className="thumb thumb--empty" aria-hidden />)}
      </ol>
    </nav>
  )
}
