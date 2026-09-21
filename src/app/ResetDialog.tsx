import { useEffect, useMemo, useRef } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { buildStack } from '../editor/edit-stack/summary'

/**
 * Confirmation for "reset everything".
 *
 * The button sits in the same row as undo and redo, one target away from them,
 * and clears the entire stack in a click. Undo does bring it all back — but
 * only for as long as you notice, and the toast that used to be the only
 * feedback is easy to miss on a wide screen.
 *
 * It lists what is about to go rather than asking "are you sure": the same
 * chips the toolbar shows, so the question is answered by what is on screen
 * instead of by remembering what you did.
 */
export function ResetDialog() {
  const open = useEditor((s) => s.resetOpen)
  const setOpen = useEditor((s) => s.setResetOpen)
  const resetAll = useEditor((s) => s.resetAll)
  const edits = useEditor((s) => s.edits)
  const meta = useEditor((s) => s.photo?.meta ?? null)
  const panelRef = useRef<HTMLDivElement>(null)

  const stack = useMemo(() => buildStack(edits, meta), [edits, meta])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Reset everything">
      <div className="modal__scrim" onClick={() => setOpen(false)} />
      <div className="modal__panel" ref={panelRef} tabIndex={-1}>
        <header className="modal__header">
          <h2>Reset everything?</h2>
          <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal__body">
          <p className="modal__note">
            Every adjustment on <strong>{meta?.name ?? 'this photo'}</strong> goes back to its
            default — the crop and masks along with the rest. Nothing on disk changes, and undo
            (⌘Z) brings it all back.
          </p>

          {stack.length > 0 && (
            <ul className="reset-list">
              {stack.map((chip) => (
                <li key={chip.id}>
                  <span>{chip.label}</span>
                  <span className="mono reset-list__value">{chip.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="modal__footer">
          <div className="modal__spacer" />
          <button className="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="button button--danger" onClick={resetAll}>
            Reset everything
          </button>
        </footer>
      </div>
    </div>
  )
}
