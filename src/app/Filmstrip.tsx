import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { prioritizeThumbnail, setThumbnailOrder, useEditor } from '../editor/edit-stack/store'
import { pickFiles } from '../io/file-system'
import { IconCross, IconSearch, MarkEdited } from './ui/icons'
import { FrameTip } from './FrameTip'
import type { Frame } from '../editor/edit-stack/types'
import {
  GROUP_LABEL,
  SORT_LABEL,
  SORT_STARTS_DESCENDING,
  isDefaultOrder,
  loadStripOrder,
  orderFrames,
  saveStripOrder,
  type StripGroup,
  type StripOrder,
  type StripSort,
} from './strip-order'

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
  const [orderOpen, setOrderOpen] = useState(false)
  const [order, setOrder] = useState<StripOrder>(loadStripOrder)
  const [query, setQuery] = useState('')
  const [tip, setTip] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout>>()
  // Once one card is up, running the pointer down the strip swaps it straight
  // across; waiting out the delay on every frame would read as lag.
  const tipWarmUntil = useRef(0)
  useEffect(() => saveStripOrder(order), [order])
  // Whichever of the two menus is open; only one ever is.
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen && !orderOpen) return
    // `pointerdown`, not `mousedown`: a tap only synthesises a mouse event
    // after it finishes, so on touch the menu stayed open until the second tap.
    const close = () => {
      setMenuOpen(false)
      setOrderOpen(false)
    }
    // Only the menu itself and the button that toggles it count as inside —
    // the rest of the header is as much "elsewhere" as the viewport is. The
    // toggle is left to its own click, or this would shut the menu and the
    // click would open it straight back.
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element
      if (menuRef.current?.contains(target) || target.closest?.('[data-menu-toggle]')) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // Capture, because the crop and mask overlays stop their pointerdowns from
    // bubbling, and a press on the photo is the most natural way to dismiss.
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, orderOpen])

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
  const edited = editedOnly ? byType.filter((f) => (f.editCount ?? 0) > 0) : byType
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle ? edited.filter((f) => f.meta.name.toLocaleLowerCase().includes(needle)) : edited
  // In the order and under the headings asked for. `visible` is the flat
  // order, which is what a shift-click range and select-all run along.
  const sections = useMemo(() => orderFrames(shown, order), [shown, order])
  const visible = useMemo(() => sections.flatMap((s) => s.frames), [sections])

  // Thumbnails fill in the order the strip is drawn. What a filter hides still
  // gets one, after everything on screen.
  useEffect(() => {
    const shownIds = new Set(visible.map((f) => f.id))
    setThumbnailOrder([...visible.map((f) => f.id), ...frames.filter((f) => !shownIds.has(f.id)).map((f) => f.id)])
  }, [visible, frames])

  // Picking the current sort again flips its direction; the arrow beside it in
  // the menu is where that shows, the next time it opens.
  const pickSort = (sort: StripSort) => {
    setOrder((o) => (o.sort === sort ? { ...o, descending: !o.descending } : { ...o, sort, descending: SORT_STARTS_DESCENDING[sort] }))
    setOrderOpen(false)
  }
  const pickGroup = (group: StripGroup) => {
    setOrder((o) => ({ ...o, group }))
    setOrderOpen(false)
  }

  const addPhotos = () => void pickFiles().then(openFiles)

  const hideTip = () => {
    clearTimeout(tipTimer.current)
    setTip((t) => {
      if (t) tipWarmUntil.current = Date.now() + 300
      return null
    })
  }
  const hoverFrame = (id: string, event: React.PointerEvent<HTMLElement>) => {
    // A touch has no hover to end, so the card would stay up over the photo.
    if (event.pointerType === 'touch') return
    const anchor = event.currentTarget.getBoundingClientRect()
    clearTimeout(tipTimer.current)
    if (Date.now() < tipWarmUntil.current) setTip({ id, anchor })
    else tipTimer.current = setTimeout(() => setTip({ id, anchor }), 450)
  }
  useEffect(() => () => clearTimeout(tipTimer.current), [])
  const tipFrame = tip ? frames.find((f) => f.id === tip.id) : undefined

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
      <header className="filmstrip__header">
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
                data-menu-toggle
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
              <div className="menu menu--strip" role="menu" ref={menuRef}>
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
                data-active={
                  !isDefaultOrder(order) || active !== 'all' || editedOnly || undefined
                }
                onClick={() => setOrderOpen((v) => !v)}
                data-menu-toggle
                aria-haspopup="menu"
                aria-expanded={orderOpen}
                title="Sort, group and filter"
                aria-label="Sort, group and filter"
              >
                ⇅
              </button>
              <button
                className="filmstrip__add"
                onClick={addPhotos}
                title="Add more photos…"
                aria-label="Add more photos"
              >
                +
              </button>
            </span>

            {orderOpen && (
              <div className="menu menu--strip" role="menu" aria-label="Sort, group and filter" ref={menuRef}>
                <div className="menu__heading">Sort</div>
                {(Object.keys(SORT_LABEL) as StripSort[]).map((sort) => (
                  <button
                    key={sort}
                    className="menu__item"
                    role="menuitemradio"
                    aria-checked={order.sort === sort}
                    data-active={order.sort === sort || undefined}
                    onClick={() => pickSort(sort)}
                  >
                    {SORT_LABEL[sort]}
                    {order.sort === sort && <span className="mono">{order.descending ? '↓' : '↑'}</span>}
                  </button>
                ))}
                <div className="menu__heading">Group</div>
                {(Object.keys(GROUP_LABEL) as StripGroup[]).map((group) => (
                  <button
                    key={group}
                    className="menu__item"
                    role="menuitemradio"
                    aria-checked={order.group === group}
                    data-active={order.group === group || undefined}
                    onClick={() => pickGroup(group)}
                  >
                    {GROUP_LABEL[group]}
                  </button>
                ))}
                {/* Only when there is something to tell apart: a folder of one
                    kind of file has nothing to filter by type. */}
                {mixed && (
                  <>
                    <div className="menu__heading">File type</div>
                    {tabs.map(([id, label, count]) => (
                      <button
                        key={id}
                        className="menu__item"
                        role="menuitemradio"
                        aria-checked={active === id}
                        data-active={active === id || undefined}
                        onClick={() => {
                          setFilter(id)
                          setOrderOpen(false)
                        }}
                      >
                        {label}
                        <span className="mono">{count}</span>
                      </button>
                    ))}
                  </>
                )}
                {editedIds.length > 0 && (
                  <>
                    <div className="menu__heading">Show</div>
                    <button
                      className="menu__item"
                      role="menuitemcheckbox"
                      aria-checked={editedOnly}
                      data-active={editedOnly || undefined}
                      onClick={() => {
                        setEditedOnly((v) => !v)
                        setOrderOpen(false)
                      }}
                    >
                      Edited only
                      <span className="mono">{editedIds.length}</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </header>

      {frames.length > 1 && (
        <label className="filmstrip__search">
          <IconSearch size={13} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // Kept from the shortcuts either way: Escape here is about this box.
              e.stopPropagation()
              if (query) setQuery('')
              else e.currentTarget.blur()
            }}
            placeholder="Search"
            aria-label="Search by file name"
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button className="filmstrip__search-clear" onClick={() => setQuery('')} aria-label="Clear the search">
              <IconCross size={11} />
            </button>
          )}
        </label>
      )}

      <ol className="filmstrip__list" onScroll={hideTip}>
        {sections.map((section, i) => (
          <Fragment key={section.label ?? i}>
            {section.label !== null && (
              <li className="filmstrip__group" title={section.label}>
                {section.label}
              </li>
            )}
            {section.frames.map((frame) => (
          <li key={frame.id} className="frame">
            <button
              className="thumb"
              data-active={frame.id === activeFrameId || undefined}
              data-selected={selection.includes(frame.id) || undefined}
              data-batch={batch.statuses[frame.id] || undefined}
              data-error={Boolean(frame.error) || undefined}
              aria-busy={(!frame.thumbUrl && !frame.error) || undefined}
              onPointerEnter={(event) => hoverFrame(frame.id, event)}
              onPointerLeave={hideTip}
              onPointerDown={hideTip}
              onClick={(event) => {
                prioritizeThumbnail(frame.id)
                // Cmd/ctrl picks one out, shift extends; a plain click opens
                // the photo, which is what clicking a thumbnail always meant.
                if (event.metaKey || event.ctrlKey) toggleFrameSelected(frame.id)
                else if (event.shiftKey) selectRangeTo(frame.id, visible.map((f) => f.id))
                else void selectFrame(frame.id)
              }}
            >
              {frame.thumbUrl ? (
                <img src={frame.thumbUrl} alt="" loading="lazy" />
              ) : (
                <span className="thumb__placeholder" data-loading={!frame.error || undefined} aria-hidden />
              )}
              {batch.statuses[frame.id] === 'working' && (
                <span className="thumb__spinner" aria-hidden />
              )}
              {batch.statuses[frame.id] === 'done' && (
                <span className="thumb__check" aria-hidden>
                  ✓
                </span>
              )}
              <span className="thumb__type" data-raw={frame.meta.isRaw || undefined} aria-hidden>
                {frame.meta.ext === 'jpeg' ? 'JPG' : frame.meta.ext.toUpperCase()}
              </span>
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
          </Fragment>
        ))}

        {frames.length > 0 && needle && visible.length === 0 && (
          <li className="filmstrip__none">No match</li>
        )}

        {frames.length === 0 &&
          [0, 1, 2].map((i) => <li key={i} className="thumb thumb--empty" aria-hidden />)}
      </ol>

      {tipFrame && tip && <FrameTip frame={tipFrame} anchor={tip.anchor} />}

      {frames.length > 0 && (
        <div className="filmstrip__footer">
          <button className="filmstrip__add-row" onClick={addPhotos}>
            + Add photos…
          </button>
          {/* Nothing on disk is touched, and edits stay filed against each
              photo, so opening the folder again brings everything back. */}
          <button
            className="filmstrip__close"
            onClick={() => {
              setQuery('')
              removeFrames(frames.map((f) => f.id))
            }}
            disabled={batch.running}
          >
            Close folder
          </button>
        </div>
      )}
    </nav>
  )
}
