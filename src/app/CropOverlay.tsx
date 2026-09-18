import { useRef } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { parseAspectRatio } from '../editor/edit-stack/aspect'
import { displaySize } from '../editor/gpu/transform'

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'move'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Interactive crop box drawn over the full, uncropped frame. */
export function CropOverlay({ width, height }: { width: number; height: number }) {
  const crop = useEditor((s) => s.edits.crop)
  const photo = useEditor((s) => s.photo)
  const updateCrop = useEditor((s) => s.updateCrop)
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; start: typeof crop } | null>(null)

  const frame = photo ? displaySize(photo.meta.width, photo.meta.height, crop.rotate90) : null
  // Ratio expressed in normalised units, so the maths stays in 0..1 space.
  const lockedRatio =
    crop.aspect && parseAspectRatio(crop.aspect) && frame
      ? parseAspectRatio(crop.aspect)! / (frame.width / frame.height)
      : null

  const onPointerDown = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { handle, startX: event.clientX, startY: event.clientY, start: { ...crop } }
    const target = event.currentTarget as Element
    target.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = (e.clientX - drag.startX) / width
      const dy = (e.clientY - drag.startY) / height
      updateCrop(resolve(drag.handle, drag.start, dx, dy, lockedRatio), 'crop-drag')
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const box = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
  }

  return (
    <div className="crop">
      {/* Four shades rather than one box-shadow: the mask stays crisp at any size. */}
      <div className="crop__shade" style={{ left: 0, top: 0, right: 0, height: box.top }} />
      <div className="crop__shade" style={{ left: 0, top: `${(crop.y + crop.h) * 100}%`, right: 0, bottom: 0 }} />
      <div className="crop__shade" style={{ left: 0, top: box.top, width: box.left, height: box.height }} />
      <div
        className="crop__shade"
        style={{ left: `${(crop.x + crop.w) * 100}%`, top: box.top, right: 0, height: box.height }}
      />

      <div className="crop__box" style={box} onPointerDown={onPointerDown('move')}>
        <div className="crop__thirds" aria-hidden />
        {HANDLES.map((h) => (
          <span
            key={h}
            className={`crop__handle crop__handle--${h}`}
            onPointerDown={onPointerDown(h)}
            role="button"
            aria-label={`Resize crop ${h}`}
          />
        ))}
      </div>
    </div>
  )
}

const MIN = 0.05

/** Resolve a drag into a new crop rect, honouring an aspect lock if one is set. */
function resolve(
  handle: Handle,
  start: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  ratio: number | null,
) {
  if (handle === 'move') {
    return {
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    }
  }

  let { x, y, w, h } = start
  const right = start.x + start.w
  const bottom = start.y + start.h

  if (handle.includes('w')) {
    x = clamp(start.x + dx, 0, right - MIN)
    w = right - x
  }
  if (handle.includes('e')) {
    w = clamp(start.w + dx, MIN, 1 - start.x)
  }
  if (handle.includes('n')) {
    y = clamp(start.y + dy, 0, bottom - MIN)
    h = bottom - y
  }
  if (handle.includes('s')) {
    h = clamp(start.h + dy, MIN, 1 - start.y)
  }

  if (ratio) {
    // Drive the secondary axis from whichever one the handle actually moved.
    const drivenByWidth = handle === 'e' || handle === 'w' || handle.length === 2
    if (drivenByWidth) {
      h = w / ratio
      if (handle.includes('n')) y = bottom - h
    } else {
      w = h * ratio
      if (handle.includes('w')) x = right - w
    }

    // Clamping after the ratio step keeps the box inside the frame; the axis
    // that hit the wall wins and the other follows it back.
    if (y + h > 1) {
      h = 1 - y
      w = h * ratio
      if (handle.includes('w')) x = right - w
    }
    if (x + w > 1) {
      w = 1 - x
      h = w / ratio
      if (handle.includes('n')) y = bottom - h
    }
    if (y < 0) {
      h += y
      y = 0
      w = h * ratio
    }
    if (x < 0) {
      w += x
      x = 0
      h = w / ratio
    }
  }

  return {
    x: clamp(x, 0, 1 - MIN),
    y: clamp(y, 0, 1 - MIN),
    w: clamp(w, MIN, 1 - x),
    h: clamp(h, MIN, 1 - y),
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}
