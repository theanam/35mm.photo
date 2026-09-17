import { useCallback, useMemo, useRef, useState } from 'react'
import { useEditor } from '../edit-stack/store'
import { IDENTITY_CURVE } from '../edit-stack/defaults'
import { CURVE_LUT_SIZE, sampleCurve } from '../presets/curve'
import type { CurveChannel, CurvePoint } from '../edit-stack/types'

const SIZE = 256

/** Closest two points may sit on the x axis, so a drag cannot reorder them. */
const MIN_GAP = 0.02

const CHANNELS: { id: CurveChannel; label: string; stroke: string }[] = [
  { id: 'rgb', label: 'RGB', stroke: '#f2eadc' },
  { id: 'r', label: 'R', stroke: '#c96a5e' },
  { id: 'g', label: 'G', stroke: '#6fae72' },
  { id: 'b', label: 'B', stroke: '#6f8ec9' },
]

const PRESETS: { id: string; label: string; points: CurvePoint[] }[] = [
  { id: 'linear', label: 'Linear', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  {
    id: 'soft',
    label: 'Soft S',
    points: [{ x: 0, y: 0 }, { x: 0.25, y: 0.22 }, { x: 0.75, y: 0.79 }, { x: 1, y: 1 }],
  },
  {
    id: 'strong',
    label: 'Strong S',
    points: [{ x: 0, y: 0 }, { x: 0.22, y: 0.14 }, { x: 0.78, y: 0.87 }, { x: 1, y: 1 }],
  },
  {
    id: 'fade',
    label: 'Fade',
    points: [{ x: 0, y: 0.08 }, { x: 0.3, y: 0.33 }, { x: 0.7, y: 0.72 }, { x: 1, y: 0.95 }],
  },
]

/** Curves as a 1D LUT built from control points (spec §4.2). */
export function CurvesTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const histogram = useEditor((s) => s.histogram)

  const [channel, setChannel] = useState<CurveChannel>('rgb')
  const [selected, setSelected] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  /**
   * Which point the pointer is holding. A ref, not state: pointer events can
   * arrive faster than React commits, and a drag that drops its first move
   * feels broken. The state copy below exists only so the handle can restyle.
   */
  const dragRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const points = edits.curves[channel]
  const stroke = CHANNELS.find((c) => c.id === channel)!.stroke

  const lut = useMemo(() => sampleCurve(points, CURVE_LUT_SIZE), [points])

  const path = useMemo(() => {
    let d = ''
    for (let i = 0; i < lut.length; i++) {
      const x = (i / (lut.length - 1)) * SIZE
      const y = SIZE - lut[i] * SIZE
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    }
    return d
  }, [lut])

  const histogramPath = useMemo(() => {
    if (!histogram) return ''
    const bins = channel === 'rgb' ? histogram.luma : histogram[channel]
    let peak = 0
    for (const v of bins) if (v > peak) peak = v
    if (!peak) return ''

    let d = `M0,${SIZE}`
    for (let i = 0; i < bins.length; i++) {
      const x = (i / (bins.length - 1)) * SIZE
      // Log scaling: a linear histogram is all spike and no shape.
      const y = SIZE - (Math.log1p(bins[i]) / Math.log1p(peak)) * SIZE
      d += `L${x.toFixed(2)},${y.toFixed(2)}`
    }
    return `${d}L${SIZE},${SIZE}Z`
  }, [histogram, channel])

  const setPoints = useCallback(
    (next: CurvePoint[], coalesce: string) => {
      // Live read: a burst of pointer moves must each build on the previous one,
      // not on whatever the last render happened to close over.
      const curves = useEditor.getState().edits.curves
      update({ curves: { ...curves, [channel]: next } }, coalesce)
    },
    [update, channel],
  )

  const livePoints = useCallback(
    () => useEditor.getState().edits.curves[channel],
    [channel],
  )

  const toCurveSpace = useCallback((clientX: number, clientY: number): CurvePoint | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01(1 - (clientY - rect.top) / rect.height),
    }
  }, [])

  /** Move point `index` to `p`, keeping the ends pinned and the order intact. */
  const movePoint = useCallback(
    (index: number, p: CurvePoint) => {
      const current = livePoints()
      if (!current[index]) return

      const next = current.map((q, i) => (i === index ? { ...p } : q))

      // The outermost points anchor the curve to the ends of the range; they
      // move vertically only, so the curve always spans the full input range.
      if (index === 0) next[0] = { x: 0, y: p.y }
      else if (index === current.length - 1) next[index] = { x: 1, y: p.y }
      else {
        const lo = next[index - 1].x + MIN_GAP
        const hi = next[index + 1].x - MIN_GAP
        next[index] = { x: Math.min(Math.max(p.x, lo), hi), y: p.y }
      }

      setPoints(next, `curve-drag-${channel}`)
    },
    [livePoints, setPoints, channel],
  )

  const beginDrag = (index: number, pointerId: number) => {
    dragRef.current = index
    setDragging(index)
    setSelected(index)
    try {
      svgRef.current?.setPointerCapture(pointerId)
    } catch {
      // Capture is best-effort; the window-level listeners still track the drag.
    }
  }

  /**
   * Pointer down on the grid drops a new control point where you pressed and
   * starts dragging it immediately, so one gesture both adds and places it.
   * Presses on an existing point never reach here — those stop propagation.
   */
  const onSurfacePointerDown = (event: React.PointerEvent) => {
    const p = toCurveSpace(event.clientX, event.clientY)
    if (!p) return
    event.preventDefault()

    const current = livePoints()

    // Too close to an existing point on the x axis: grab that one instead of
    // stacking a second point on top of it.
    const nearby = current.findIndex((q) => Math.abs(q.x - p.x) < MIN_GAP)
    if (nearby !== -1) {
      beginDrag(nearby, event.pointerId)
      movePoint(nearby, p)
      return
    }

    const added = { ...p }
    const next = [...current, added].sort((a, b) => a.x - b.x)
    setPoints(next, `curve-add-${Date.now()}`)
    beginDrag(next.indexOf(added), event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (dragRef.current === null) return
    const p = toCurveSpace(event.clientX, event.clientY)
    if (p) movePoint(dragRef.current, p)
  }

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    setDragging(null)
    try {
      svgRef.current?.releasePointerCapture?.(event.pointerId)
    } catch {
      // Already released, e.g. the pointer left the window mid-drag.
    }
  }

  const removePoint = useCallback(
    (index: number) => {
      const current = livePoints()
      // The two end points anchor the curve; removing one has no sensible result.
      if (index <= 0 || index >= current.length - 1) return
      setPoints(current.filter((_, i) => i !== index), `curve-remove-${Date.now()}`)
      setSelected(null)
    },
    [livePoints, setPoints],
  )

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (selected === null) return

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      removePoint(selected)
      return
    }

    const step = event.shiftKey ? 0.05 : 0.005
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const delta = deltas[event.key]
    if (!delta) return

    event.preventDefault()
    const p = livePoints()[selected]
    if (!p) return
    movePoint(selected, { x: clamp01(p.x + delta[0]), y: clamp01(p.y + delta[1]) })
  }

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    setPoints(preset.points.map((p) => ({ ...p })), `curve-preset-${Date.now()}`)
    setSelected(null)
  }

  const active = selected ?? dragging
  const readout =
    active !== null && points[active]
      ? `in ${Math.round(points[active].x * 255)} → out ${Math.round(points[active].y * 255)}`
      : `${points.length} point${points.length === 1 ? '' : 's'}`

  return (
    <div className="tool">
      <div className="tool__columns tool__columns--curves">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Channel</span>
            <button
              className="link-button"
              onClick={() => {
                setPoints(IDENTITY_CURVE.map((p) => ({ ...p })), `curve-reset-${Date.now()}`)
                setSelected(null)
              }}
            >
              Reset {channel === 'rgb' ? 'RGB' : channel.toUpperCase()}
            </button>
          </header>
          <div className="segmented">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            className="segmented__item"
            data-active={channel === c.id || undefined}
            style={channel === c.id ? { color: c.stroke } : undefined}
              onClick={() => {
                setChannel(c.id)
                setSelected(null)
              }}
            >
              {c.label}
            </button>
          ))}
          </div>

          <div className="curve__footer">
            <span className="mono curve__readout">{readout}</span>
            <button
              className="link-button"
              disabled={active === null || active === 0 || active === points.length - 1}
              onClick={() => active !== null && removePoint(active)}
            >
              Remove point
            </button>
          </div>

          <div className="chips">
            {PRESETS.map((p) => (
              <button key={p.id} className="chip" onClick={() => applyPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>

          <p className="tool__hint">
            Drag on the grid to add a point and place it in one go. Double-click a point to drop
            it, or select one and use the arrow keys — hold shift for bigger steps.
          </p>
        </section>

        <section className="tool__group tool__group--curve">
          <svg
            ref={svgRef}
        className="curve"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        tabIndex={0}
        role="application"
        aria-label={`${channel.toUpperCase()} tone curve, ${points.length} points`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {/* Decoration only — it must never swallow a press meant for the grid. */}
        <g className="curve__decor">
          <rect x={0} y={0} width={SIZE} height={SIZE} className="curve__bg" />
          {histogramPath && <path d={histogramPath} className="curve__histogram" />}
          {[0.25, 0.5, 0.75].map((t) => (
            <g key={t} className="curve__grid">
              <line x1={t * SIZE} y1={0} x2={t * SIZE} y2={SIZE} />
              <line x1={0} y1={t * SIZE} x2={SIZE} y2={t * SIZE} />
            </g>
          ))}
          <line x1={0} y1={SIZE} x2={SIZE} y2={0} className="curve__diagonal" />
          <path d={path} fill="none" stroke={stroke} strokeWidth={1.75} />
        </g>

        {/* The press surface, above the decoration and below the handles. */}
        <rect
          x={0}
          y={0}
          width={SIZE}
          height={SIZE}
          className="curve__surface"
          onPointerDown={onSurfacePointerDown}
        />

        {points.map((p, i) => {
          const isEnd = i === 0 || i === points.length - 1
          return (
            <g
              key={i}
              className="curve__handle"
              data-active={active === i || undefined}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                beginDrag(i, e.pointerId)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                removePoint(i)
              }}
            >
              {/* Generous invisible target: the visible dot is too small to hit. */}
              <circle cx={p.x * SIZE} cy={SIZE - p.y * SIZE} r={13} className="curve__hit" />
              <circle
                cx={p.x * SIZE}
                cy={SIZE - p.y * SIZE}
                r={active === i ? 6.5 : 5}
                className="curve__point"
                data-end={isEnd || undefined}
              />
            </g>
          )
        })}
      </svg>

        </section>
      </div>
    </div>
  )
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}
