import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { pickFiles } from '../io/file-system'
import { MarkEdited } from './ui/icons'
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
  const selection = useEditor((s) => s.selection)
  const toggleFrameSelected = useEditor((s) => s.toggleFrameSelected)
  const selectRangeTo = useEditor((s) => s.selectRangeTo)
  const clearSelection = useEditor((s) => s.clearSelection)
  const setSelection = useEditor((s) => s.setSelection)
  const setSyncOpen = useEditor((s) => s.setSyncOpen)
  const batch = useEditor((s) => s.batch)
  const removeFrames = useEditor((s) => s.removeFrames)
  const [filter, setFilter] = useState<Filter>('all')
  const [editedOnly, setEditedOnly] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Nothing selected, nothing to decide about.
  useEffect(() => {
    if (!selection.length) setMenuOpen(false)
  }, [selection.length])

  const raw = frames.filter((f) => f.meta.isRaw)
  const rendered = frames.filter((f) => !f.meta.isRaw)
  const mixed = raw.length > 0 && rendered.length > 0

  // A folder with only one kind of file has nothing to filter, so the tabs go
  // away — and the filter goes with them, or it would still be in force the
  // next time a mixed folder opened.
  useEffect(() => {
    if (!mixed) setFilter('all')
  }, [mixed])

  const editedIds = frames.filter((f) => (f.editCount ?? 0) > 0).map((f) => f.id)

  // An empty strip with a filter quietly on reads as lost photos.
  useEffect(() => {
    if (!editedIds.length) setEditedOnly(false)
  }, [editedIds.length])

  /**
   * Once a selection settles on a single photo, open it.
   *
   * Narrowing down to one and then finding the editor still showing something
   * else leaves two different ideas of "the current photo" on screen. The delay
   * is what makes this bearable: a shift-drag passes through several one-photo
   * states on its way somewhere, and opening each one would decode a raw per
   * click. It fires only once the picking has stopped.
   */
  const selectedOne = selection.length === 1 ? selection[0] : null
  useEffect(() => {
    if (!selectedOne || selectedOne === activeFrameId) return
    const timer = setTimeout(() => void selectFrame(selectedOne), 320)
    return () => clearTimeout(timer)
  }, [selectedOne, activeFrameId, selectFrame])

  const active: Filter = mixed ? filter : 'all'
  const byType = active === 'raw' ? raw : active === 'rendered' ? rendered : frames
  // Composed with the type tabs rather than replacing them, so "only the raws I
  // have edited" is a thing you can ask for.
  const visible = editedOnly ? byType.filter((f) => (f.editCount ?? 0) > 0) : byType

  const addPhotos = () => void pickFiles().then(openFiles)

  const tabs: [Filter, string, number][] = [
    ['all', 'All', frames.length],
    ['raw', 'RAW', raw.length],
    ['rendered', renderedLabel(rendered), rendered.length],
  ]

  return (
    <nav className="filmstrip" aria-label="Photos in this folder">
      {/*
        The selection controls live in the header rather than in a bar of their
        own. The header is always on screen at a fixed height, so swapping what
        it holds cannot reflow anything — a panel that appeared above the list
        would shove every thumbnail down the moment a photo was picked.
      */}
      <header className="filmstrip__header" ref={headerRef}>
        {selection.length > 0 ? (
          <>
            <span>
              <span className="mono">{selection.length}</span> SELECTED
            </span>
            <span className="filmstrip__count">
              <button
                className="filmstrip__add"
                onClick={clearSelection}
                title="Clear the selection"
                aria-label="Clear the selection"
              >
                ✕
              </button>
              <button
                className="filmstrip__add"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={batch.running}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="What to do with the selection"
                aria-label="What to do with the selection"
              >
                ⋯
              </button>
            </span>

            {menuOpen && (
              <div className="menu menu--strip" role="menu">
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setSyncOpen(true)
                  }}
                >
                  Sync settings…
                </button>
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    setSelection(visible.map((f) => f.id))
                  }}
                >
                  Select all
                  <span className="mono">{visible.length}</span>
                </button>
                <button
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    removeFrames(selection)
                  }}
                >
                  Remove from filmstrip
                </button>
              </div>
            )}
          </>
        ) : (
          <>
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
          </>
        )}
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

      {editedIds.length > 0 && (
        <button
          className="filmstrip__edited-filter"
          data-active={editedOnly || undefined}
          aria-pressed={editedOnly}
          onClick={() => setEditedOnly((v) => !v)}
        >
          <MarkEdited />
          <span>Edited only</span>
          <span className="mono">{editedIds.length}</span>
        </button>
      )}

      <ol className="filmstrip__list">
        {visible.map((frame) => (
          <li key={frame.id} className="frame">
            <button
              className="thumb"
              data-active={frame.id === activeFrameId || undefined}
              data-selected={selection.includes(frame.id) || undefined}
              data-batch={batch.statuses[frame.id] || undefined}
              data-error={Boolean(frame.error) || undefined}
              onClick={(event) => {
                // Cmd/ctrl picks one out, shift extends; a plain click opens
                // the photo, which is what clicking a thumbnail always meant.
                if (event.metaKey || event.ctrlKey) toggleFrameSelected(frame.id)
                else if (event.shiftKey) selectRangeTo(frame.id, visible.map((f) => f.id))
                else void selectFrame(frame.id)
              }}
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
              {batch.statuses[frame.id] === 'working' && (
                <span className="thumb__spinner" aria-hidden />
              )}
              {batch.statuses[frame.id] === 'done' && (
                <span className="thumb__check" aria-hidden>
                  ✓
                </span>
              )}
              {frame.error && <span className="thumb__badge">!</span>}
              {!frame.error && frame.unsaved && (
                <span className="thumb__edited">
                  <MarkEdited />
                </span>
              )}
              <span className="visually-hidden">
                {frame.meta.name}
                {frame.unsaved ? ` — ${frame.editCount} unsaved edits` : ''}
              </span>
            </button>

            <button
              className="frame__remove"
              onClick={() => removeFrames([frame.id])}
              disabled={batch.running}
              title={`Remove ${frame.meta.name} from the filmstrip — the file is not deleted`}
              aria-label={`Remove ${frame.meta.name} from the filmstrip`}
            >
              ✕
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
