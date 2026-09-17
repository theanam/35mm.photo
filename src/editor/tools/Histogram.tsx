import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../edit-stack/store'

const W = 332
const H = 88

type Mode = 'histogram' | 'parade'

/** Live histogram and RGB parade (spec §4.2). */
export function Histogram() {
  const histogram = useEditor((s) => s.histogram)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<Mode>('histogram')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!histogram) {
      ctx.fillStyle = '#8c857a'
      ctx.font = '12px "Alegreya Sans", system-ui, sans-serif'
      ctx.fillText('Reading the photo…', 10, H / 2 + 4)
      return
    }

    if (mode === 'histogram') drawOverlay(ctx, histogram)
    else drawParade(ctx, histogram)
  }, [histogram, mode])

  const clipHi = histogram ? histogram.clippedHighlights : 0
  const clipLo = histogram ? histogram.clippedShadows : 0

  return (
    <section className="histogram">
      <header className="histogram__header">
        <div className="segmented segmented--tight">
          <button
            className="segmented__item"
            data-active={mode === 'histogram' || undefined}
            onClick={() => setMode('histogram')}
          >
            Histogram
          </button>
          <button
            className="segmented__item"
            data-active={mode === 'parade' || undefined}
            onClick={() => setMode('parade')}
          >
            Parade
          </button>
        </div>
        <div className="histogram__clip" title="Clipped shadows / highlights">
          <span data-warn={clipLo > 0.005 || undefined}>{(clipLo * 100).toFixed(1)}%</span>
          <span className="histogram__clip-sep">·</span>
          <span data-warn={clipHi > 0.005 || undefined}>{(clipHi * 100).toFixed(1)}%</span>
        </div>
      </header>
      <canvas ref={canvasRef} style={{ width: W, height: H }} aria-label="Histogram" />
    </section>
  )
}

type Hist = NonNullable<ReturnType<typeof useEditor.getState>['histogram']>

function drawOverlay(ctx: CanvasRenderingContext2D, h: Hist) {
  const peak = Math.max(maxOf(h.r), maxOf(h.g), maxOf(h.b)) || 1

  // Additive blending: where all three channels overlap the trace reads white,
  // which is how a photographer expects to see neutral tones.
  ctx.globalCompositeOperation = 'lighter'
  drawTrace(ctx, h.r, peak, 'rgba(196, 84, 74, 0.75)')
  drawTrace(ctx, h.g, peak, 'rgba(95, 168, 94, 0.75)')
  drawTrace(ctx, h.b, peak, 'rgba(90, 118, 189, 0.8)')
  ctx.globalCompositeOperation = 'source-over'

  ctx.strokeStyle = 'rgba(236, 231, 222, 0.14)'
  ctx.lineWidth = 1
  for (const t of [0.25, 0.5, 0.75]) {
    ctx.beginPath()
    ctx.moveTo(Math.round(t * W) + 0.5, 0)
    ctx.lineTo(Math.round(t * W) + 0.5, H)
    ctx.stroke()
  }
}

function drawParade(ctx: CanvasRenderingContext2D, h: Hist) {
  const colors = ['rgba(196,84,74,0.85)', 'rgba(95,168,94,0.85)', 'rgba(90,118,189,0.9)']
  const bins = [h.r, h.g, h.b]
  const third = W / 3
  const peak = Math.max(maxOf(h.r), maxOf(h.g), maxOf(h.b)) || 1

  bins.forEach((channel, i) => {
    ctx.save()
    ctx.beginPath()
    ctx.rect(i * third, 0, third - 4, H)
    ctx.clip()
    ctx.translate(i * third, 0)
    drawTrace(ctx, channel, peak, colors[i], third - 4)
    ctx.restore()
  })
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  bins: Uint32Array,
  peak: number,
  fill: string,
  width = W,
) {
  ctx.beginPath()
  ctx.moveTo(0, H)
  for (let i = 0; i < bins.length; i++) {
    const x = (i / (bins.length - 1)) * width
    // Log scale — otherwise a single dominant tone flattens everything else.
    const y = H - (Math.log1p(bins[i]) / Math.log1p(peak)) * H
    ctx.lineTo(x, y)
  }
  ctx.lineTo(width, H)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
}

function maxOf(bins: Uint32Array): number {
  let m = 0
  for (const v of bins) if (v > m) m = v
  return m
}
