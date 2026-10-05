import type { CropGuide } from '../editor/edit-stack/crop-guides'

/**
 * The composition guide inside the crop box, drawn at the box's pixel size so
 * a diagonal is a true 45° and a grid cell is square whatever shape the box
 * is. Only the spiral is stretched: it is drawn in a golden rectangle and
 * fitted to the box, which is what Lightroom does with it too.
 */
export function CropGuides({
  guide,
  turn,
  width: w,
  height: h,
  turning,
}: {
  guide: CropGuide
  turn: number
  width: number
  height: number
  /** While the picture is being turned a fine grid replaces the guide: it is what a horizon is lined up against. */
  turning: boolean
}) {
  if (!(w > 0) || !(h > 0)) return null
  const kind: CropGuide = turning ? 'grid' : guide
  if (kind === 'none') return null

  return (
    <svg
      className={`crop__guides${turning ? ' crop__guides--turning' : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {kind === 'thirds' && lines(w, h, [1 / 3, 2 / 3])}
      {kind === 'golden' && lines(w, h, [0.382, 0.618])}
      {kind === 'grid' && grid(w, h, turning ? 12 : 6)}
      {kind === 'diagonal' && diagonals(w, h)}
      {kind === 'triangle' && triangle(w, h, turn)}
      {kind === 'spiral' && spiral(w, h, turn)}
    </svg>
  )
}

function lines(w: number, h: number, at: number[]) {
  return at.map((t) => (
    <g key={t}>
      <line x1={w * t} y1={0} x2={w * t} y2={h} />
      <line x1={0} y1={h * t} x2={w} y2={h * t} />
    </g>
  ))
}

/** Square cells, `cells` of them across the short side, counted out from the centre. */
function grid(w: number, h: number, cells: number) {
  const cell = Math.min(w, h) / cells
  const out: JSX.Element[] = []
  for (let x = w / 2; x <= w; x += cell) {
    out.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={h} />)
    if (x > w / 2) out.push(<line key={`-x${x}`} x1={w - x} y1={0} x2={w - x} y2={h} />)
  }
  for (let y = h / 2; y <= h; y += cell) {
    out.push(<line key={`y${y}`} x1={0} y1={y} x2={w} y2={y} />)
    if (y > h / 2) out.push(<line key={`-y${y}`} x1={0} y1={h - y} x2={w} y2={h - y} />)
  }
  return out
}

/** A 45° line in from each corner, as far as the far edge. */
function diagonals(w: number, h: number) {
  const m = Math.min(w, h)
  return (
    <>
      <line x1={0} y1={0} x2={m} y2={m} />
      <line x1={w} y1={0} x2={w - m} y2={m} />
      <line x1={0} y1={h} x2={m} y2={h - m} />
      <line x1={w} y1={h} x2={w - m} y2={h - m} />
    </>
  )
}

/** One corner-to-corner diagonal, and a perpendicular to it from each other corner. */
function triangle(w: number, h: number, turn: number) {
  const flip = turn % 2 === 1
  const a = { x: flip ? w : 0, y: 0 }
  const b = { x: flip ? 0 : w, y: h }
  const others = [
    { x: flip ? 0 : w, y: 0 },
    { x: flip ? w : 0, y: h },
  ]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  return (
    <>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {others.map((p, i) => {
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
        return <line key={i} x1={p.x} y1={p.y} x2={a.x + t * dx} y2={a.y + t * dy} />
      })}
    </>
  )
}

const PHI = (1 + Math.sqrt(5)) / 2

/**
 * The golden spiral: a square cut from a golden rectangle leaves a smaller
 * golden rectangle, and a quarter circle in each square joins up into the
 * spiral. Drawn in a φ × 1 rectangle and scaled to the box, so each quarter
 * circle becomes a quarter ellipse. The four turns are the four reflections.
 */
function spiral(w: number, h: number, turn: number) {
  const sx = w / PHI
  const sy = h
  let rx = 0
  let ry = 0
  let rw = PHI
  let rh = 1
  // Both paths in box pixels: the arcs, and the faint edges of the squares.
  const arcs: string[] = []
  const edges: string[] = []
  const X = (v: number) => v * sx
  const Y = (v: number) => v * sy
  for (let k = 0; k < 10 && Math.min(rw, rh) * Math.min(sx, sy) > 1; k++) {
    const s = Math.min(rw, rh)
    let from: [number, number]
    let to: [number, number]
    switch (k % 4) {
      case 0: // square on the left, arc from its bottom-left up to its top-right
        from = [rx, ry + s]
        to = [rx + s, ry]
        edges.push(`M${X(rx + s)} ${Y(ry)} V${Y(ry + rh)}`)
        rx += s
        rw -= s
        break
      case 1: // on top, arc from its top-left round to its bottom-right
        from = [rx, ry]
        to = [rx + s, ry + s]
        edges.push(`M${X(rx)} ${Y(ry + s)} H${X(rx + rw)}`)
        ry += s
        rh -= s
        break
      case 2: // on the right, arc from its top-right down to its bottom-left
        from = [rx + rw, ry]
        to = [rx + rw - s, ry + s]
        edges.push(`M${X(rx + rw - s)} ${Y(ry)} V${Y(ry + rh)}`)
        rw -= s
        break
      default: // at the bottom, arc from its bottom-right back to its top-left
        from = [rx + s, ry + rh]
        to = [rx, ry + rh - s]
        edges.push(`M${X(rx)} ${Y(ry + rh - s)} H${X(rx + rw)}`)
        rh -= s
        break
    }
    if (!arcs.length) arcs.push(`M${X(from[0])} ${Y(from[1])}`)
    arcs.push(`A${X(s)} ${Y(s)} 0 0 1 ${X(to[0])} ${Y(to[1])}`)
  }
  const transform = [
    turn & 1 ? `translate(${w} 0) scale(-1 1)` : '',
    turn & 2 ? `translate(0 ${h}) scale(1 -1)` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <g transform={transform || undefined}>
      <path className="crop__guides-faint" d={edges.join(' ')} />
      <path d={arcs.join(' ')} />
    </g>
  )
}
