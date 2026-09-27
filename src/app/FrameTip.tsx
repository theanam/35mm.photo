import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Frame } from '../editor/edit-stack/types'
import { frameDate } from './strip-order'

/**
 * What a filmstrip frame is, on hover: the name the thumbnail cannot show,
 * and the few facts that tell two near-identical frames apart.
 *
 * Portalled to the body and placed beside the frame rather than over it — the
 * strip scrolls and clips, and the photo under the pointer is the one thing
 * the card must not hide.
 */
export function FrameTip({ frame, anchor }: { frame: Frame; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 8
    const margin = 8
    // Out towards the viewport, where there is room; back over the strip only
    // when the window is too narrow for that.
    let left = anchor.right + gap
    if (left + width > window.innerWidth - margin) left = Math.max(margin, anchor.left - gap - width)
    const top = Math.min(Math.max(margin, anchor.top), window.innerHeight - height - margin)
    setPos({ left, top })
  }, [anchor, frame])

  const { meta } = frame
  const type = meta.ext === 'jpeg' ? 'JPG' : meta.ext.toUpperCase()
  const size = [
    type,
    meta.width && meta.height ? `${meta.width} × ${meta.height}` : null,
    formatBytes(meta.bytes),
  ]
  const exposure = [
    meta.focal ? `${Math.round(meta.focal)} mm` : null,
    meta.aperture ? `ƒ/${meta.aperture}` : null,
    meta.iso ? `ISO ${meta.iso}` : null,
  ]
  const at = frameDate(frame)

  return createPortal(
    <div
      ref={ref}
      className="frame-tip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
    >
      <div className="frame-tip__name">{meta.name}</div>
      <Row parts={size} mono />
      {meta.camera && <div className="frame-tip__row">{meta.camera}</div>}
      {meta.lens && <div className="frame-tip__row">{meta.lens}</div>}
      <Row parts={exposure} mono />
      {at > 0 && (
        <div className="frame-tip__row">
          {new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      )}
      {frame.error ? (
        <div className="frame-tip__status" data-tone="error">
          {frame.error}
        </div>
      ) : frame.unsaved ? (
        <div className="frame-tip__status">Edited · not in a sidecar</div>
      ) : null}
    </div>,
    document.body,
  )
}

function Row({ parts, mono }: { parts: (string | null)[]; mono?: boolean }) {
  const shown = parts.filter(Boolean)
  if (!shown.length) return null
  return <div className={mono ? 'frame-tip__row mono' : 'frame-tip__row'}>{shown.join(' · ')}</div>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
