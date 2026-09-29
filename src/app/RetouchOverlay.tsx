import { useMemo, useRef, useState } from 'react'
import { useEditor, useRenderEdits } from '../editor/edit-stack/store'
import { applyMat3Point, buildUprightTransform, mat3Invert } from '../editor/gpu/transform'
import type { RetouchStroke } from '../editor/edit-stack/types'
import { storedSize } from '../lens/resolve'
import type { LensUniforms } from '../lens/uniforms'
import { contentToDrawn, drawnToContent, type Picture } from '../retouch/geometry'

/** A new point is taken once the pointer has moved this share of the brush radius. */
const POINT_SPACING = 0.25

type Point = [number, number]

/**
 * The retouch brush, over the picture.
 *
 * Painting a stroke, and afterwards seeing where each one is and where it heals
 * from. The stroke is committed on release and not before: where it heals from
 * is searched for over the whole of it, and a search per pointer move would be
 * a search for a stroke nobody has finished drawing.
 *
 * Points go through the same inverted matrix the mask overlay uses, and then
 * through the lens model, so what is stored is the spot on the picture's
 * content — see `retouch/geometry.ts` for why a brush needs that and a mask
 * does not.
 */
export function RetouchOverlay({
  width,
  height,
  lens,
}: {
  width: number
  height: number
  lens: LensUniforms
}) {
  const strokes = useEditor((s) => s.edits.retouch)
  const drawn = useRenderEdits()
  const photo = useEditor((s) => s.photo)
  const brush = useEditor((s) => s.retouchBrush)
  const activeId = useEditor((s) => s.activeRetouchId)
  const addStroke = useEditor((s) => s.addRetouchStroke)
  const updateStroke = useEditor((s) => s.updateRetouchStroke)
  const selectStroke = useEditor((s) => s.selectRetouchStroke)

  const meta = photo?.meta
  const picture = useMemo<Picture | null>(() => {
    if (!meta) return null
    const [storedWidth, storedHeight] = storedSize(meta)
    return { orientation: meta.orientation, storedWidth, storedHeight }
  }, [meta])

  const { toUpright, toOutput } = useMemo(() => {
    const m = meta ? buildUprightTransform(meta.width, meta.height, drawn.crop, drawn.perspective) : null
    return { toUpright: m, toOutput: m ? mat3Invert(m) : null }
  }, [meta, drawn.crop, drawn.perspective])

  const [cursor, setCursor] = useState<Point | null>(null)
  const [live, setLive] = useState<Point[] | null>(null)
  const liveRef = useRef<Point[] | null>(null)

  if (!meta || !picture || !toUpright || !toOutput || !width || !height) return null

  /** Content uv → a point in the SVG. */
  const project = (u: number, v: number): Point => {
    const [du, dv] = contentToDrawn(u, v, lens, picture)
    const [x, y] = applyMat3Point(toOutput, du, dv)
    return [x * width, y * height]
  }

  const toContent = (event: { clientX: number; clientY: number }, rect: DOMRect): Point => {
    const [du, dv] = applyMat3Point(
      toUpright,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    )
    return drawnToContent(du, dv, lens, picture)
  }

  const short = Math.min(meta.width, meta.height)
  /** A brush size as uv radii along each axis of the upright picture. */
  const radii = (size: number): Point => [(size * short) / meta.width, (size * short) / meta.height]

  /** On-screen radius of a brush of `size` centred at `at`. */
  const screenRadius = (at: Point, size: number) => {
    const [rx] = radii(size)
    const a = project(at[0], at[1])
    const b = project(at[0] + rx, at[1])
    return Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
  }

  const pathOf = (points: number[], dx = 0, dy = 0) => {
    const out: string[] = []
    for (let i = 0; i + 1 < points.length; i += 2) {
      const [x, y] = project(points[i] + dx, points[i + 1] + dy)
      out.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    // A dab is a zero-length line, which a round cap draws as a disc.
    if (points.length === 2) out.push('l0.01 0')
    return out.join(' ')
  }

  const onPaintDown = (event: React.PointerEvent<SVGRectElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    // With a spot selected, a click on the picture puts it away rather than
    // painting: the outline is in the way of seeing what the brush should do.
    if (activeId) {
      selectStroke(null)
      return
    }
    const el = event.currentTarget
    const rectNow = () => (el.ownerSVGElement ?? el).getBoundingClientRect()
    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      // Best-effort; the window listeners carry the gesture regardless.
    }

    const [rx, ry] = radii(brush.size)
    const start = toContent(event, rectNow())
    liveRef.current = [start]
    setLive([start])

    const move = (e: PointerEvent) => {
      const points = liveRef.current
      if (!points) return
      const next = toContent(e, rectNow())
      const last = points[points.length - 1]
      // Measured in radii, so the spacing is the same fraction of the brush
      // along either axis of a picture that is not square.
      if (Math.hypot((next[0] - last[0]) / rx, (next[1] - last[1]) / ry) < POINT_SPACING) return
      liveRef.current = [...points, next]
      setLive(liveRef.current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      el.removeEventListener('lostpointercapture', up)
      const points = liveRef.current
      liveRef.current = null
      if (!points) return
      // The drawn stroke stays on screen until its committed twin replaces it.
      void addStroke({ points: points.flat(), size: brush.size, feather: brush.feather }).finally(() =>
        setLive(null),
      )
    }
    const cancel = () => {
      liveRef.current = null
      setLive(null)
      up()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    el.addEventListener('lostpointercapture', up)
  }

  /** Drag where a heal copies from. */
  const onSourceDown = (stroke: RetouchStroke) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const el = event.currentTarget as unknown as SVGGraphicsElement
    const svg = el.ownerSVGElement ?? el
    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      // As above.
    }
    const from = toContent(event, svg.getBoundingClientRect())
    const move = (e: PointerEvent) => {
      const to = toContent(e, svg.getBoundingClientRect())
      updateStroke(
        stroke.id,
        { dx: stroke.dx + to[0] - from[0], dy: stroke.dy + to[1] - from[1] },
        `retouch-source-${stroke.id}`,
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
  }

  const cursorRadius = cursor ? screenRadius(cursor, brush.size) : 0
  const selected = strokes.find((s) => s.id === activeId) ?? null

  return (
    <svg
      className="mask-overlay retouch-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <rect
        className="retouch-overlay__paint"
        width={width}
        height={height}
        onPointerDown={onPaintDown}
        onPointerMove={(e) => setCursor(toContent(e, e.currentTarget.getBoundingClientRect()))}
        onPointerLeave={() => setCursor(null)}
      />

      {selected && (() => {
        const at: Point = [selected.points[0], selected.points[1]]
        const r = screenRadius(at, selected.size)
        const heal = selected.mode === 'heal'
        const from = project(at[0], at[1])
        const to = project(at[0] + selected.dx, at[1] + selected.dy)
        return (
          <g opacity={selected.enabled ? 1 : 0.45}>
            <Outline id="retouch-target" d={pathOf(selected.points)} radius={r} width={width} height={height} />
            {heal && (
              <>
                <path
                  className="mask-overlay__line mask-overlay__line--axis"
                  d={`M${from[0]} ${from[1]} L${to[0]} ${to[1]}`}
                />
                <Outline
                  id="retouch-source"
                  d={pathOf(selected.points, selected.dx, selected.dy)}
                  radius={r}
                  width={width}
                  height={height}
                  source
                />
                {/* The ring is drawn through a mask, which takes no pointer; this is what is grabbed. */}
                <path
                  className="retouch-overlay__grab"
                  d={pathOf(selected.points, selected.dx, selected.dy)}
                  strokeWidth={r * 2}
                  onPointerDown={onSourceDown(selected)}
                />
              </>
            )}
          </g>
        )
      })()}

      {live && (
        <Outline
          id="retouch-live"
          d={pathOf(live.flat())}
          radius={screenRadius(live[0], brush.size)}
          width={width}
          height={height}
        />
      )}

      {cursor && !live && (
        <>
          {(() => {
            const [x, y] = project(cursor[0], cursor[1])
            return (
              <>
                <circle className="mask-overlay__line retouch-overlay__cursor" cx={x} cy={y} r={cursorRadius} />
                {brush.feather > 0 && (
                  <circle
                    className="mask-overlay__line mask-overlay__line--soft retouch-overlay__cursor"
                    cx={x}
                    cy={y}
                    r={cursorRadius * (1 - brush.feather / 100)}
                  />
                )}
              </>
            )
          })()}
        </>
      )}
    </svg>
  )
}

/**
 * The edge of a brushed area, and only the edge.
 *
 * A filled shape over a healed spot reads as a patch of blown highlight — the
 * very thing the brush was used to take away. So the shape is drawn as the
 * ring between the brush's own width and a hair less, cut out with a mask:
 * a capsule's outline, which no single SVG stroke can draw.
 */
function Outline({
  id,
  d,
  radius,
  width,
  height,
  source,
}: {
  id: string
  d: string
  radius: number
  width: number
  height: number
  source?: boolean
}) {
  const ring = 1.5
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
        <path d={d} className="retouch-overlay__cut" stroke="white" strokeWidth={radius * 2} />
        <path d={d} className="retouch-overlay__cut" stroke="black" strokeWidth={Math.max(0, radius * 2 - ring * 2)} />
      </mask>
      <rect
        className="retouch-overlay__ring"
        data-source={source || undefined}
        width={width}
        height={height}
        mask={`url(#${id})`}
      />
    </>
  )
}

