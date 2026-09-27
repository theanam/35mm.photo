import { useRef } from 'react'

/**
 * A draggable seam between two columns. Drag to resize the rail on its `side`;
 * double-click to put it back where the stylesheet has it.
 */
export function Splitter({
  side,
  label,
  onResize,
  onReset,
}: {
  side: 'left' | 'right'
  label: string
  /** Called with the rail's new width in CSS pixels as the pointer moves. */
  onResize: (width: number) => void
  onReset: () => void
}) {
  const dragging = useRef(false)

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
      onDoubleClick={onReset}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const body = e.currentTarget.parentElement
        if (!body) return
        const rect = body.getBoundingClientRect()
        dragging.current = true
        const seam = e.currentTarget
        seam.setPointerCapture(e.pointerId)
        seam.setAttribute('data-active', '')
        document.documentElement.setAttribute('data-resizing', '')
        const move = (ev: PointerEvent) => {
          if (!dragging.current) return
          onResize(side === 'left' ? ev.clientX - rect.left : rect.right - ev.clientX)
        }
        const up = () => {
          dragging.current = false
          seam.removeAttribute('data-active')
          document.documentElement.removeAttribute('data-resizing')
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }}
    />
  )
}
