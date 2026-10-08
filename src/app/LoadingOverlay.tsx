import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'

/**
 * Held back for a beat before it appears. A JPEG decodes in a few milliseconds,
 * and an indicator that flashed up on every open would read as jank rather than
 * as progress — but a raw file is seconds of silence, which reads as a hang.
 * The delay is what separates the two cases without the caller having to know
 * which it has.
 */
const APPEAR_AFTER_MS = 350

/**
 * Progress for whatever is being decoded, shown *over the viewport* rather than
 * across the app.
 *
 * Decoding does not occupy the main thread — LibRaw has its own worker and the
 * preview conversion has another — so there is nothing to protect the user
 * from. A full-screen scrim over a free main thread only takes away the
 * filmstrip while they wait, and the photo they were looking at stays on screen
 * underneath it the whole time. This sits in a corner of the frame instead,
 * ignores the pointer, and leaves every control live: pick another photo
 * mid-decode and the open simply re-targets.
 */
export function LoadingOverlay() {
  const loading = useEditor((s) => s.loading)
  const label = useEditor((s) => s.loadingLabel)
  const name = useEditor((s) => s.loadingName)
  const progress = useEditor((s) => s.loadingProgress)
  // A photo whose heals or subject maps are still being made good after an
  // open: shown as a stage of its own, so it is never taken for finished.
  const restoring = useEditor((s) => s.restoring !== null)
  const photoName = useEditor((s) => s.photo?.meta.name ?? '')
  const active = loading || restoring
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), APPEAR_AFTER_MS)
    return () => clearTimeout(timer)
  }, [active])

  if (!visible) return null
  const shownLabel = loading ? label || 'Opening' : 'Applying edits'
  const shownName = loading ? name : photoName

  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading__card">
        {/* Indeterminate unless a stage can count: LibRaw reports no
            progress, so a percentage there would be a number we made up. The
            upscaler counts tiles, and shows them. */}
        {progress === null ? (
          <div className="loading__bar" aria-hidden>
            <span />
          </div>
        ) : (
          <div className="loading__bar loading__bar--known" aria-hidden>
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="loading__text">
          <p className="loading__label">
            {shownLabel}
            {progress === null || !loading ? '…' : ` ${Math.round(progress * 100)}%`}
          </p>
          {shownName && <p className="loading__name mono">{shownName}</p>}
        </div>
      </div>
    </div>
  )
}
