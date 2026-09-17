import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { pickFiles } from '../io/file-system'
import type { Frame } from '../editor/edit-stack/types'

type Filter = 'all' | 'raw' | 'rendered'

/**
 * What to call the non-raw tab. A folder of raw shot alongside JPEG is the
 * common case and deserves its own name, but the same tab also holds PNG and
 * WEBP, so it only claims a format when every file in it agrees.
 */
function renderedLabel(frames: Frame[]): string {
  const exts = new Set(frames.map((f) => (f.meta.ext === 'jpg' ? 'jpeg' : f.meta.ext)))
  return exts.size === 1 ? [...exts][0].toUpperCase() : 'Photos'
}

export function Filmstrip() {
  const frames = useEditor((s) => s.frames)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  const selectFrame = useEditor((s) => s.selectFrame)
  const openFiles = useEditor((s) => s.openFiles)
  const [filter, setFilter] = useState<Filter>('all')

  const raw = frames.filter((f) => f.meta.isRaw)
  const rendered = frames.filter((f) => !f.meta.isRaw)
  const mixed = raw.length > 0 && rendered.length > 0

  // A folder with only one kind of file has nothing to filter, so the tabs go
  // away — and the filter goes with them, or it would still be in force the
  // next time a mixed folder opened.
  useEffect(() => {
    if (!mixed) setFilter('all')
  }, [mixed])

  const active: Filter = mixed ? filter : 'all'
  const visible = active === 'raw' ? raw : active === 'rendered' ? rendered : frames

  const addPhotos = () => void pickFiles().then(openFiles)

  const tabs: [Filter, string, number][] = [
    ['all', 'All', frames.length],
    ['raw', 'RAW', raw.length],
    ['rendered', renderedLabel(rendered), rendered.length],
  ]

  return (
    <nav className="filmstrip" aria-label="Photos in this folder">
      <header className="filmstrip__header">
        <span>FOLDER</span>
        <span className="filmstrip__count">
          <span className="mono">{visible.length}</span>
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

      {mixed && (
        <div className="filmstrip__tabs" role="tablist" aria-label="Filter by file type">
          {tabs.map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              className="filmstrip__tab"
              data-active={active === id || undefined}
              aria-selected={active === id}
              onClick={() => setFilter(id)}
              title={`${label} · ${count}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <ol className="filmstrip__list">
        {visible.map((frame) => (
          <li key={frame.id}>
            <button
              className="thumb"
              data-active={frame.id === activeFrameId || undefined}
              data-error={Boolean(frame.error) || undefined}
              onClick={() => selectFrame(frame.id)}
              title={
                frame.error
                  ? `${frame.meta.name} — ${frame.error}`
                  : frame.unsaved
                    ? `${frame.meta.name} — edited, not yet written to a sidecar`
                    : frame.meta.name
              }
            >
              {frame.thumbUrl ? (
                <img src={frame.thumbUrl} alt="" loading="lazy" />
              ) : (
                <span className="thumb__placeholder" aria-hidden />
              )}
              {frame.error && <span className="thumb__badge">!</span>}
              {!frame.error && frame.unsaved && (
                <span className="thumb__edited" aria-hidden />
              )}
              <span className="visually-hidden">
                {frame.meta.name}
                {frame.unsaved ? ` — ${frame.editCount} unsaved edits` : ''}
              </span>
            </button>
          </li>
        ))}

        {frames.length === 0 &&
          [0, 1, 2].map((i) => <li key={i} className="thumb thumb--empty" aria-hidden />)}
      </ol>

      {frames.length > 0 && (
        <button className="filmstrip__add-row" onClick={addPhotos}>
          + Add photos…
        </button>
      )}
    </nav>
  )
}
