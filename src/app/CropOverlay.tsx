import { useEffect, useRef, useState } from 'react'
import { useEditor, type CropDrag } from '../editor/edit-stack/store'
import { parseAspectRatio } from '../editor/edit-stack/aspect'
import { horizonAngle } from '../editor/edit-stack/horizon'
import { moveCrop, resizeCrop, rotationAngle, type Handle } from '../editor/edit-stack/crop-drag'
import { displaySize, effectiveCrop } from '../editor/gpu/transform'
import { CropGuides } from './CropGuides'

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/**
 * The crop box, drawn over the full, uncropped frame.
 *
 * It works the way Lightroom's does. The frame is the thing being aimed and
 * the picture is what moves: a drag inside the frame slides the photo under
 * it, the handles reshape it, and a drag anywhere outside it turns the photo,
 * with a fine grid up while it turns. ⌥ resizes from the centre, ⇧ holds the
 * shape, ⌘-drag draws a horizon, a double-click applies.
 */
export function CropOverlay({ width, height }: { width: number; height: number }) {
  const stored = useEditor((s) => s.edits.crop)
  const photo = useEditor((s) => s.photo)
  const updateCrop = useEditor((s) => s.updateCrop)
  const applyTool = useEditor((s) => s.applyTool)
  const cropDragging = useEditor((s) => s.cropDragging)
  const setCropDragging = useEditor((s) => s.setCropDragging)
  const drawingHorizon = useEditor((s) => s.drawingHorizon)
  const setDrawingHorizon = useEditor((s) => s.setDrawingHorizon)
  const guide = useEditor((s) => s.cropGuide)
  const guideTurn = useEditor((s) => s.cropGuideTurn)
  const rootRef = useRef<HTMLDivElement>(null)
  /** The line being drawn, in pixels from the overlay's top-left. */
  const [line, setLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  /** The angle a turn has reached, shown beside the pointer. */
  const [turning, setTurning] = useState<{ x: number; y: number; angle: number } | null>(null)

  // Escape backs out of drawing before the tool sees it, so it cancels the
  // line rather than the whole crop. Capture, to get there first.
  useEffect(() => {
    if (!drawingHorizon) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setLine(null)
      setDrawingHorizon(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawingHorizon, setDrawingHorizon])

  // Draw and drag the box that is actually rendered. While straightened that is
  // the stored rect held inside the rotated frame, and handles that sat on the
  // stored rect instead would be offset from the picture they appear to cut.
  const crop = photo ? effectiveCrop(photo.meta.width, photo.meta.height, stored) : stored

  const frame = photo ? displaySize(photo.meta.width, photo.meta.height, crop.rotate90) : null
  // Ratio expressed in normalised units, so the maths stays in 0..1 space.
  const lockedRatio =
    crop.aspect && parseAspectRatio(crop.aspect) && frame
      ? parseAspectRatio(crop.aspect)! / (frame.width / frame.height)
      : null

  /**
   * Draw a line along something that should be level, and the picture turns
   * to make it so. From the Level button, or ⌘/Ctrl-drag anywhere on the
   * frame, the way Lightroom's straighten tool is reached.
   */
  const startHorizon = (event: React.PointerEvent) => {
    const root = rootRef.current
    if (!root) return
    event.preventDefault()
    event.stopPropagation()
    const origin = root.getBoundingClientRect()
    const x1 = event.clientX - origin.left
    const y1 = event.clientY - origin.top
    setLine({ x1, y1, x2: x1, y2: y1 })
    const target = event.currentTarget as Element
    target.setPointerCapture(event.pointerId)

    let last = { x: event.clientX, y: event.clientY }
    const move = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY }
      setLine({ x1, y1, x2: e.clientX - origin.left, y2: e.clientY - origin.top })
    }
    const end = (commit: boolean) => () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      target.removeEventListener('lostpointercapture', cancel)
      setLine(null)
      if (commit) {
        const angle = horizonAngle(stored.angle, last.x - event.clientX, last.y - event.clientY)
        // A slip leaves the mode on, so the next attempt needs no second click.
        if (angle === null) return
        if (angle !== stored.angle) updateCrop({ angle })
      }
      setDrawingHorizon(false)
    }
    const up = end(true)
    const cancel = end(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    target.addEventListener('lostpointercapture', cancel)
  }

  /**
   * The plumbing every gesture shares: capture the pointer, follow it from
   * the window, and let go on any of the three ways a drag can end.
   *
   * `pointerup` alone is enough for a mouse. A touch has two other exits: the
   * OS can claim the gesture and send `pointercancel` instead, and a capture
   * can be lost without either firing. Any of them left unhandled would leave
   * `cropDragging` stuck, which freezes the viewport's crop fit and kills crop
   * zoom for the rest of the session.
   */
  const beginDrag = (
    event: React.PointerEvent,
    kind: Exclude<CropDrag, false>,
    onMove: (e: PointerEvent) => void,
    onEnd?: () => void,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setCropDragging(kind)
    const target = event.currentTarget as Element
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Best-effort; the window listeners carry the gesture regardless.
    }
    const up = () => {
      setCropDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      target.removeEventListener('lostpointercapture', up)
      onEnd?.()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    target.addEventListener('lostpointercapture', up)
  }

  const isPrimary = (event: React.PointerEvent) =>
    event.pointerType !== 'mouse' || event.button === 0

  /** Inside the frame: the picture slides under it, with the pointer. */
  const onBoxPointerDown = (event: React.PointerEvent) => {
    if (event.metaKey || event.ctrlKey) {
      startHorizon(event)
      return
    }
    if (!isPrimary(event)) return
    const start = { ...crop }
    const sx = event.clientX
    const sy = event.clientY
    beginDrag(event, 'move', (e) => {
      updateCrop(moveCrop(start, (e.clientX - sx) / width, (e.clientY - sy) / height), 'crop-drag')
    })
  }

  /** A handle: the frame reshapes, the picture stays put. Modifiers are read live, so ⌥ and ⇧ can be pressed mid-drag. */
  const onHandlePointerDown = (handle: Handle) => (event: React.PointerEvent) => {
    if (event.metaKey || event.ctrlKey) {
      startHorizon(event)
      return
    }
    if (!isPrimary(event)) return
    const start = { ...crop }
    const sx = event.clientX
    const sy = event.clientY
    beginDrag(event, 'resize', (e) => {
      // ⇧ on a free box holds the shape it has; a locked box is held anyway.
      const ratio = lockedRatio ?? (e.shiftKey ? start.w / start.h : null)
      updateCrop(
        resizeCrop(handle, start, (e.clientX - sx) / width, (e.clientY - sy) / height, {
          ratio,
          fromCentre: e.altKey,
        }),
        'crop-drag',
      )
    })
  }

  /** Outside the frame: the picture turns about the frame's centre, following the pointer round. */
  const onRootPointerDown = (event: React.PointerEvent) => {
    // The box, the handles and the horizon layer take their own pointer.
    if (event.target !== event.currentTarget) return
    if (event.metaKey || event.ctrlKey) {
      startHorizon(event)
      return
    }
    if (!isPrimary(event)) return
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const centre = {
      x: rect.left + (crop.x + crop.w / 2) * width,
      y: rect.top + (crop.y + crop.h / 2) * height,
    }
    const from = { x: event.clientX, y: event.clientY }
    const startAngle = stored.angle
    setTurning({ x: from.x - rect.left, y: from.y - rect.top, angle: startAngle })
    beginDrag(
      event,
      'rotate',
      (e) => {
        const angle = rotationAngle(startAngle, centre, from, { x: e.clientX, y: e.clientY })
        const now = root.getBoundingClientRect()
        setTurning({ x: e.clientX - now.left, y: e.clientY - now.top, angle })
        if (angle !== useEditor.getState().edits.crop.angle) updateCrop({ angle }, 'straighten-drag')
      },
      () => setTurning(null),
    )
  }

  const box = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`,
  }

  return (
    <div
      className="crop"
      ref={rootRef}
      data-drag={cropDragging || undefined}
      onPointerDown={onRootPointerDown}
    >
      {/* Four shades rather than one box-shadow: the mask stays crisp at any size. */}
      <div className="crop__shade" style={{ left: 0, top: 0, right: 0, height: box.top }} />
      <div className="crop__shade" style={{ left: 0, top: `${(crop.y + crop.h) * 100}%`, right: 0, bottom: 0 }} />
      <div className="crop__shade" style={{ left: 0, top: box.top, width: box.left, height: box.height }} />
      <div
        className="crop__shade"
        style={{ left: `${(crop.x + crop.w) * 100}%`, top: box.top, right: 0, height: box.height }}
      />

      <div
        className="crop__box"
        style={box}
        onPointerDown={onBoxPointerDown}
        onDoubleClick={() => applyTool()}
      >
        <CropGuides
          guide={guide}
          turn={guideTurn}
          width={crop.w * width}
          height={crop.h * height}
          turning={cropDragging === 'rotate'}
        />
        {HANDLES.map((h) => (
          <span
            key={h}
            className={`crop__handle crop__handle--${h}`}
            onPointerDown={onHandlePointerDown(h)}
            role="button"
            aria-label={`Resize crop ${h}`}
          />
        ))}
      </div>

      {drawingHorizon && (
        <div className="crop__horizon" onPointerDown={startHorizon} aria-label="Draw along the horizon" />
      )}
      {line && <HorizonLine {...line} current={stored.angle} />}
      {turning && (
        <span className="crop__readout mono" style={{ left: turning.x + 14, top: turning.y - 26 }}>
          {formatAngle(turning.angle)}
        </span>
      )}
    </div>
  )
}

function formatAngle(angle: number) {
  return `${angle > 0 ? '+' : angle < 0 ? '−' : ''}${Math.abs(angle).toFixed(1)}°`
}

/** The line as it is drawn, and the angle letting go would set. */
function HorizonLine({ x1, y1, x2, y2, current }: { x1: number; y1: number; x2: number; y2: number; current: number }) {
  const angle = horizonAngle(current, x2 - x1, y2 - y1)
  return (
    <svg className="crop__line" aria-hidden>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="crop__line-halo" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <circle cx={x1} cy={y1} r={3} />
      <circle cx={x2} cy={y2} r={3} />
      {angle !== null && (
        <text x={x2 + 10} y={y2 - 10} className="mono">
          {formatAngle(angle)}
        </text>
      )}
    </svg>
  )
}
