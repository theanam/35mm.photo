import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { Mark } from './Mark'
import { saveSidecar } from '../io/export'
import { IconGitHub, IconHelp } from './ui/icons'
import { REPO_URL } from './AboutDialog'

export function TopBar() {
  const photo = useEditor((s) => s.photo)
  const edits = useEditor((s) => s.edits)
  const setExportOpen = useEditor((s) => s.setExportOpen)
  const closePhoto = useEditor((s) => s.closePhoto)
  const toast = useEditor((s) => s.toast)
  const markSidecarSaved = useEditor((s) => s.markSidecarSaved)
  const loading = useEditor((s) => s.loading)
  const loadingLabel = useEditor((s) => s.loadingLabel)
  const setAboutOpen = useEditor((s) => s.setAboutOpen)
  const frames = useEditor((s) => s.frames)
  const selection = useEditor((s) => s.selection)
  const exportSelection = useEditor((s) => s.exportSelection)
  const batch = useEditor((s) => s.batch)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const editedIds = frames.filter((f) => (f.editCount ?? 0) > 0).map((f) => f.id)
  // The plain Export button already covers the open photo, so the menu only
  // earns its place once there is a second thing to export.
  const batchOptions = selection.length > 1 || editedIds.length > 1

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
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

  const meta = photo?.meta

  const onSaveEdits = async () => {
    if (!meta) return
    const outcome = await saveSidecar(meta, edits)
    if (outcome === 'cancelled') return
    markSidecarSaved()
    toast(
      outcome === 'saved'
        ? 'Edit sidecar saved next to your photo'
        : 'Edit sidecar downloaded',
    )
  }

  return (
    <header className="topbar">
      <div className="topbar__lockup">
        <Mark />
        <span className="topbar__wordmark">
          35mm<span className="topbar__wordmark-tld">.photo</span>
        </span>
      </div>
      <div className="topbar__rule" />

      {meta ? (
        <div className="topbar__file">
          <span className="topbar__name">{meta.name}</span>
          {meta.isRaw && <span className="badge">RAW</span>}
          <span className="topbar__meta">{describe(meta)}</span>
        </div>
      ) : (
        <span className="topbar__idle">No photo open</span>
      )}

      <div className="topbar__spacer" />

      {loading && <span className="topbar__loading">{loadingLabel || 'Working'}…</span>}

      <div className="topbar__status">
        <span className="dot" />
        <span>{meta ? 'Edits saved locally · non-destructive' : 'Works offline · nothing to install'}</span>
      </div>

      {/* Always present, with or without a photo: the way out to the source and
          to a bug report should not depend on having opened something first. */}
      <div className="topbar__meta-actions">
        <a
          className="icon-button icon-button--quiet"
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          title="Source on GitHub"
          aria-label="Source on GitHub"
        >
          <IconGitHub size={15} />
        </a>
        <button
          className="icon-button icon-button--quiet"
          onClick={() => setAboutOpen(true)}
          title="Help and about"
          aria-label="Help and about"
        >
          <IconHelp size={16} />
        </button>
      </div>

      {meta && (
        <div className="topbar__actions">
          <button className="button" onClick={closePhoto}>
            Close
          </button>
          <button className="button" onClick={onSaveEdits}>
            Save edits
          </button>
          <div className="export-split" data-split={batchOptions || undefined} ref={menuRef}>
            <button
              className="button button--accent export-split__main"
              onClick={() => setExportOpen(true)}
            >
              Export…
            </button>

            {batchOptions && (
              <>
                <button
                  className="button button--accent export-split__more"
                  onClick={() => setMenuOpen((v) => !v)}
                  disabled={batch.running}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="More export options"
                >
                  ▾
                </button>

                {menuOpen && (
                  <div className="menu" role="menu">
                    <button
                      className="menu__item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false)
                        setExportOpen(true)
                      }}
                    >
                      Export this photo…
                    </button>

                    {selection.length > 1 && (
                      <button
                        className="menu__item"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          void exportSelection()
                        }}
                      >
                        Export selected
                        <span className="mono">{selection.length}</span>
                      </button>
                    )}

                    {editedIds.length > 1 && (
                      <button
                        className="menu__item"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          void exportSelection(editedIds)
                        }}
                      >
                        Export all edited
                        <span className="mono">{editedIds.length}</span>
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

function describe(meta: { width: number; height: number; iso?: number; lens?: string; bytes: number }) {
  const parts: string[] = []
  const mp = (meta.width * meta.height) / 1_000_000
  if (mp >= 0.1) parts.push(`${mp.toFixed(1)} MP`)
  if (meta.iso) parts.push(`ISO ${meta.iso}`)
  if (meta.lens) parts.push(meta.lens)
  parts.push(formatBytes(meta.bytes))
  return parts.join(' · ')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
