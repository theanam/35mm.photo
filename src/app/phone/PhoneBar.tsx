import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../../editor/edit-stack/store'
import { saveSidecar } from '../../io/export'
import { pickFiles } from '../../io/file-system'
import { IconCross, IconDownload, IconMore, IconRedo, IconUndo } from '../ui/icons'
import { PhoneLibrary } from './PhoneLibrary'

/**
 * The one bar at the top.
 *
 * The desktop has two rows of chrome and a right rail to spend on this; a
 * phone has about 52 points. So the bar carries only what is used mid-edit —
 * leaving the photo, undo, redo and export — and everything that is used once a
 * session goes behind the overflow. Undo and redo earn their place because an
 * editor without a visible undo is a scary place to touch anything, and there
 * is no ⌘Z here.
 */
export function PhoneBar() {
  const photo = useEditor((s) => s.photo)
  const edits = useEditor((s) => s.edits)
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor((s) => s.canUndo())
  const canRedo = useEditor((s) => s.canRedo())
  const dirty = useEditor((s) => s.dirty())
  const closePhoto = useEditor((s) => s.closePhoto)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const setExifOpen = useEditor((s) => s.setExifOpen)
  const setAboutOpen = useEditor((s) => s.setAboutOpen)
  const setResetOpen = useEditor((s) => s.setResetOpen)
  const copyLook = useEditor((s) => s.copyLook)
  const pasteLook = useEditor((s) => s.pasteLook)
  const hasClipboard = useEditor((s) => s.clipboard !== null)
  const openFiles = useEditor((s) => s.openFiles)
  const toast = useEditor((s) => s.toast)
  const markSidecarSaved = useEditor((s) => s.markSidecarSaved)

  const [menuOpen, setMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const frames = useEditor((s) => s.frames)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  const meta = photo?.meta

  const run = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }

  const onSaveEdits = async () => {
    setMenuOpen(false)
    if (!meta) return
    const outcome = await saveSidecar(meta, edits)
    if (outcome === 'cancelled') return
    markSidecarSaved()
    toast(outcome === 'saved' ? 'Edit sidecar saved next to your photo' : 'Edit sidecar downloaded')
  }

  return (
    <header className="phone-bar">
      {photo && (
        <button className="icon-button icon-button--quiet" onClick={closePhoto} aria-label="Close this photo">
          <IconCross />
        </button>
      )}

      {/* The filename doubles as the way into the rest of the roll — there is
          no room for a filmstrip, and the name is already saying which of them
          you are looking at. */}
      <button
        className="phone-bar__name"
        onClick={() => setLibraryOpen(true)}
        disabled={frames.length < 2}
        aria-label={frames.length > 1 ? `${meta?.name ?? 'Photo'} — choose another photo` : undefined}
      >
        <span className="phone-bar__name-text">{meta?.name ?? '35mm'}</span>
        {frames.length > 1 && <span className="mono phone-bar__count">{frames.length}</span>}
      </button>

      {photo && (
        <>
          <button className="icon-button icon-button--quiet" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <IconUndo />
          </button>
          <button className="icon-button icon-button--quiet" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <IconRedo />
          </button>
        </>
      )}

      <div className="phone-bar__menu" ref={menuRef}>
        <button
          className="icon-button icon-button--quiet"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="More"
          aria-expanded={menuOpen}
        >
          <IconMore />
        </button>

        {menuOpen && (
          <div className="menu" role="menu">
            <button className="menu__item" onClick={run(() => void pickFiles().then(openFiles))}>
              Add photos…
            </button>
            {photo && (
              <>
                <button className="menu__item" onClick={() => void onSaveEdits()}>
                  Save edits
                </button>
                <button className="menu__item" onClick={run(() => setExifOpen(true))}>
                  Photo info
                </button>
                <button className="menu__item" onClick={run(copyLook)} disabled={!dirty}>
                  Copy look
                </button>
                <button className="menu__item" onClick={run(pasteLook)} disabled={!hasClipboard}>
                  Paste look
                </button>
                <button className="menu__item" onClick={run(() => setResetOpen(true))} disabled={!dirty}>
                  Reset everything
                </button>
              </>
            )}
            <button className="menu__item" onClick={run(() => setAboutOpen(true))}>
              About 35mm
            </button>
          </div>
        )}
      </div>

      {photo && (
        <button
          className="icon-button phone-bar__export"
          onClick={() => setExportOpen(true)}
          aria-label="Export this photo"
          title="Export"
        >
          <IconDownload />
        </button>
      )}
      {libraryOpen && <PhoneLibrary onClose={() => setLibraryOpen(false)} />}
    </header>
  )
}
