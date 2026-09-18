import { useMemo, useRef } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { applyMat3Point, buildUprightTransform, mat3Invert } from '../editor/gpu/transform'
import { isLinear, isRadial } from '../editor/edit-stack/masks'
import type { LinearMask, Mask, RadialMask } from '../editor/edit-stack/types'

/** Points around the ellipse. Enough that the outline reads as a curve. */
const OUTLINE_STEPS = 96
/** Half-length of the drawn gradient lines, in image heights. */
const LINE_REACH = 2.5

type Handle = 'move' | 'rx' | 'ry' | 'from' | 'to'

/**
 * The shape of the selected mask, drawn over the photo and draggable.
 *
 * Masks live in upright image coordinates, and the viewport shows a cropped,
 * straightened, possibly keystoned frame — so every point is mapped through the
 * same matrix the shader uses, inverted. That is what keeps the outline sitting
 * exactly where the render puts the mask, whatever the geometry above it is
 * doing, and it is why the outline is a sampled polygon rather than an SVG
 * ellipse: a keystone is projective, and no ellipse element can follow one.
 *
 * A luminance or colour mask has nothing to draw — it has no position, only a
 * rule — so this renders nothing for those and leaves the red overlay to say
 * where they landed.
 */
export function MaskOverlay({ width, height }: { width: number; height: number }) {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const activeMaskId = useEditor((s) => s.activeMaskId)
  const updateMask = useEditor((s) => s.updateMask)

  const mask = edits.masks.find((m) => m.id === activeMaskId) ?? null

  const meta = photo?.meta
  const aspect = meta ? meta.width / meta.height : 1

  /** Upright uv → output uv, and back. */
  const { toUpright, toOutput } = useMemo(() => {
    const m = meta
      ? buildUprightTransform(meta.width, meta.height, edits.crop, edits.perspective)
      : null
    return { toUpright: m, toOutput: m ? mat3Invert(m) : null }
  }, [meta, edits.crop, edits.perspective])

  const dragRef = useRef<{ handle: Handle; mask: Mask; from: [number, number] } | null>(null)

  if (!mask || !toUpright || !toOutput || !width || !height) return null
  if (!isRadial(mask) && !isLinear(mask)) return null

  /** Upright uv → a point in the SVG, which is drawn at the frame's pixel size. */
  const project = (u: number, v: number): [number, number] => {
    const [x, y] = applyMat3Point(toOutput, u, v)
    return [x * width, y * height]
  }

  const pointerToUpright = (event: { clientX: number; clientY: number }, rect: DOMRect) =>
    applyMat3Point(
      toUpright,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    )

  const startDrag = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()

    const el = event.currentTarget as unknown as SVGGraphicsElement
    const rect = (el.ownerSVGElement ?? el).getBoundingClientRect()
    dragRef.current = { handle, mask, from: pointerToUpright(event, rect) }

    const move = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const to = pointerToUpright(e, rect)
      const patch = resolve(drag.handle, drag.mask, drag.from, to, aspect)
      if (patch) updateMask(drag.mask.id, patch, `mask-drag-${drag.mask.id}`)
    }
    const up = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const path = (points: [number, number][]) =>
    points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')

  return (
    <svg
      className="mask-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      {isRadial(mask) ? (
        <RadialShape mask={mask} aspect={aspect} project={project} path={path} onDrag={startDrag} />
      ) : (
        <LinearShape mask={mask} aspect={aspect} project={project} path={path} onDrag={startDrag} />
      )}
    </svg>
  )
}

interface ShapeProps<M extends Mask> {
  mask: M
  aspect: number
  project: (u: number, v: number) => [number, number]
  path: (points: [number, number][]) => string
  onDrag: (handle: Handle) => (event: React.PointerEvent) => void
}

function RadialShape({ mask, aspect, project, path, onDrag }: ShapeProps<RadialMask>) {
  const outline = (scale: number) =>
    Array.from({ length: OUTLINE_STEPS + 1 }, (_, i) => {
      const t = (i / OUTLINE_STEPS) * Math.PI * 2
      const [u, v] = ellipsePoint(mask, aspect, Math.cos(t) * scale, Math.sin(t) * scale)
      return project(u, v)
    })

  const inner = 1 - Math.min(mask.feather, 99) / 100
  const handle = (cos: number, sin: number) => {
    const [u, v] = ellipsePoint(mask, aspect, cos, sin)
    return project(u, v)
  }

  return (
    <>
      <path className="mask-overlay__fill" d={path(outline(1))} onPointerDown={onDrag('move')} />
      <path className="mask-overlay__line" d={path(outline(1))} />
      {/* Where the feather starts. Nothing to grab: the slider owns it. */}
      {inner < 1 && <path className="mask-overlay__line mask-overlay__line--soft" d={path(outline(inner))} />}

      {([[1, 0], [-1, 0]] as const).map(([cos, sin], i) => (
        <Handle key={`x${i}`} at={handle(cos, sin)} onPointerDown={onDrag('rx')} />
      ))}
      {([[0, 1], [0, -1]] as const).map(([cos, sin], i) => (
        <Handle key={`y${i}`} at={handle(cos, sin)} onPointerDown={onDrag('ry')} />
      ))}
    </>
  )
}

function LinearShape({ mask, aspect, project, path, onDrag }: ShapeProps<LinearMask>) {
  const axis = { x: (mask.x2 - mask.x1) * aspect, y: mask.y2 - mask.y1 }
  const length = Math.hypot(axis.x, axis.y) || 1e-6
  // Perpendicular to the run, in aspect-corrected space, so the bands stay at
  // right angles to the gradient however the frame is shaped.
  const perp = { x: -axis.y / length, y: axis.x / length }

  const band = (u: number, v: number) =>
    path([
      project(u + (perp.x * LINE_REACH) / aspect, v + perp.y * LINE_REACH),
      project(u - (perp.x * LINE_REACH) / aspect, v - perp.y * LINE_REACH),
    ])

  const from = project(mask.x1, mask.y1)
  const to = project(mask.x2, mask.y2)
  const mid = project((mask.x1 + mask.x2) / 2, (mask.y1 + mask.y2) / 2)

  return (
    <>
      <path className="mask-overlay__line" d={band(mask.x1, mask.y1)} />
      <path className="mask-overlay__line mask-overlay__line--soft" d={band(mask.x2, mask.y2)} />
      <path className="mask-overlay__line mask-overlay__line--axis" d={path([from, to])} />

      <circle
        className="mask-overlay__grab"
        cx={mid[0]}
        cy={mid[1]}
        r={16}
        onPointerDown={onDrag('move')}
      />
      <Handle at={from} onPointerDown={onDrag('from')} />
      <Handle at={to} onPointerDown={onDrag('to')} />
    </>
  )
}

function Handle({
  at,
  onPointerDown,
}: {
  at: [number, number]
  onPointerDown: (event: React.PointerEvent) => void
}) {
  return (
    <>
      <circle className="mask-overlay__handle" cx={at[0]} cy={at[1]} r={5} />
      <circle
        className="mask-overlay__grab"
        cx={at[0]}
        cy={at[1]}
        r={14}
        onPointerDown={onPointerDown}
      />
    </>
  )
}

/**
 * A point on the ellipse at parameter (cos t, sin t), in upright uv.
 *
 * The rotation happens in aspect-corrected space — the same place the shader
 * does it — because rotating in uv would shear the ellipse on any frame that is
 * not square, and the outline would stop matching what the render draws.
 */
function ellipsePoint(mask: RadialMask, aspect: number, cos: number, sin: number): [number, number] {
  const x = mask.rx * aspect * cos
  const y = mask.ry * sin
  const rad = (mask.angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [mask.cx + (x * c - y * s) / aspect, mask.cy + (x * s + y * c)]
}

const MIN_RADIUS = 0.01
const MAX_RADIUS = 3
/** How far outside the picture a mask may be dragged before it stops. */
const REACH = 0.6

/** Turn a drag into a geometry patch, in upright uv throughout. */
function resolve(
  handle: Handle,
  mask: Mask,
  from: [number, number],
  to: [number, number],
  aspect: number,
): Partial<Mask> | null {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]

  if (isRadial(mask)) {
    if (handle === 'move') {
      return { cx: clampPos(mask.cx + dx), cy: clampPos(mask.cy + dy) }
    }

    // How far the pointer moved along the handle's own axis, measured after
    // undoing the ellipse's rotation. Relative rather than absolute, so
    // grabbing a handle slightly off its centre does not snap the radius to
    // wherever the finger happened to land.
    const now = alongAxes(mask, aspect, to)
    const started = alongAxes(mask, aspect, from)

    if (handle === 'rx') {
      return { rx: clampRadius(mask.rx + (Math.abs(now.along) - Math.abs(started.along)) / aspect) }
    }
    if (handle === 'ry') {
      return { ry: clampRadius(mask.ry + (Math.abs(now.across) - Math.abs(started.across))) }
    }
    return null
  }

  if (isLinear(mask)) {
    if (handle === 'move') {
      return {
        x1: clampPos(mask.x1 + dx),
        y1: clampPos(mask.y1 + dy),
        x2: clampPos(mask.x2 + dx),
        y2: clampPos(mask.y2 + dy),
      }
    }
    if (handle === 'from') return { x1: clampPos(mask.x1 + dx), y1: clampPos(mask.y1 + dy) }
    if (handle === 'to') return { x2: clampPos(mask.x2 + dx), y2: clampPos(mask.y2 + dy) }
  }

  return null
}

/** A point's offset from the centre, in the ellipse's own rotated axes. */
function alongAxes(mask: RadialMask, aspect: number, point: [number, number]) {
  const rad = (-mask.angle * Math.PI) / 180
  const ox = (point[0] - mask.cx) * aspect
  const oy = point[1] - mask.cy
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { along: ox * c - oy * s, across: ox * s + oy * c }
}

function clampPos(v: number) {
  return Math.min(1 + REACH, Math.max(-REACH, v))
}

function clampRadius(v: number) {
  return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, v))
}
