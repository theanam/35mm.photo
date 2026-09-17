import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import {
  DEFAULT_SYNC_GROUPS,
  SYNC_GROUPS,
  SYNC_GROUP_LABEL,
  type SyncGroup,
} from '../editor/edit-stack/sync'

export function SyncDialog() {
  const open = useEditor((s) => s.syncOpen)
  const setOpen = useEditor((s) => s.setSyncOpen)
  const selection = useEditor((s) => s.selection)
  const photo = useEditor((s) => s.photo)
  const syncToSelection = useEditor((s) => s.syncToSelection)
  const toast = useEditor((s) => s.toast)

  const [groups, setGroups] = useState<SyncGroup[]>(DEFAULT_SYNC_GROUPS)
  const [busy, setBusy] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, setOpen])

  if (!open) return null

  const toggle = (g: SyncGroup) =>
    setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]))

  const run = async () => {
    setBusy(true)
    try {
      const count = await syncToSelection(groups)
      toast(`Settings copied to ${count} photo${count === 1 ? '' : 's'}`)
      setOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not copy those settings', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Sync settings">
      <div className="modal__scrim" onClick={() => !busy && setOpen(false)} />
      <div className="modal__panel" ref={panelRef} tabIndex={-1}>
        <header className="modal__header">
          <h2>Sync settings</h2>
          <button className="icon-button" onClick={() => setOpen(false)} disabled={busy} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal__body">
          <p className="modal__note">
            Copy from <strong>{photo?.meta.name ?? 'the open photo'}</strong> onto{' '}
            <strong>{selection.length}</strong> selected photo
            {selection.length === 1 ? '' : 's'}. Anything left unticked stays as it is on each
            of them.
          </p>

          <div className="sync__groups">
            {SYNC_GROUPS.map((g) => (
              <label key={g} className="sync__group">
                <input type="checkbox" checked={groups.includes(g)} onChange={() => toggle(g)} />
                <span>{SYNC_GROUP_LABEL[g]}</span>
              </label>
            ))}
          </div>

          <p className="modal__note">
            Crop is off by default because it frames one picture, not a set. White balance
            travels well under one light and badly across a day — untick it when the set moves.
          </p>
        </div>

        <footer className="modal__footer">
          <button className="link-button" onClick={() => setGroups([...SYNC_GROUPS])} disabled={busy}>
            All
          </button>
          <button className="link-button" onClick={() => setGroups([])} disabled={busy}>
            None
          </button>
          <div className="modal__spacer" />
          <button className="button" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
          <button
            className="button button--accent"
            onClick={run}
            disabled={busy || !groups.length || !selection.length}
          >
            {busy ? 'Copying…' : `Sync ${selection.length}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
