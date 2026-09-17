import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'

/**
 * Held back for a beat before it appears. A JPEG decodes in a few milliseconds,
 * and an overlay that flashed up on every open would read as jank rather than
 * as progress — but a raw file is seconds of silence, which reads as a hang.
 * The delay is what separates the two cases without the caller having to know
 * which it has.
 */
const APPEAR_AFTER_MS = 350

export function LoadingOverlay() {
  const loading = useEditor((s) => s.loading)
  const label = useEditor((s) => s.loadingLabel)
  const name = useEditor((s) => s.loadingName)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!loading) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), APPEAR_AFTER_MS)
    return () => clearTimeout(timer)
  }, [loading])

  if (!visible) return null

  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading__card">
        {/* Indeterminate: LibRaw reports no progress, so a percentage here
            would be a number we made up. */}
        <div className="loading__bar" aria-hidden>
          <span />
        </div>
        <p className="loading__label">{label || 'Opening'}…</p>
        {name && <p className="loading__name mono">{name}</p>}
      </div>
    </div>
  )
}
