import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { Renderer } from '../editor/gpu/renderer'
import { outputSize } from '../editor/gpu/transform'
import { getLut, peekLut } from '../editor/presets/lutCache'
import { getLook } from '../editor/presets/looks'
import { HistogramClient } from '../editor/histogram'
import { detectCapabilities } from '../editor/gpu/caps'
import { CropOverlay } from './CropOverlay'

/** Histogram readback size — enough bins to be representative, cheap to read. */
const HISTOGRAM_EDGE = 192
const HISTOGRAM_THROTTLE_MS = 140
/** Cap on the drawing buffer's longest edge, so a 400% zoom cannot exhaust VRAM. */
const MAX_BUFFER_EDGE = 4096

export function Viewport() {
  const photo = useEditor((s) => s.photo)
  const edits = useEditor((s) => s.edits)
  const zoom = useEditor((s) => s.zoom)
  const splitCompare = useEditor((s) => s.splitCompare)
  const splitAt = useEditor((s) => s.splitAt)
  const setSplitAt = useEditor((s) => s.setSplitAt)
  const cropping = useEditor((s) => s.cropping)
  const setHistogram = useEditor((s) => s.setHistogram)
  const setViewScale = useEditor((s) => s.setViewScale)
  const toast = useEditor((s) => s.toast)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const histogramRef = useRef<HistogramClient | null>(null)
  const frameRef = useRef<number | null>(null)
  const histogramTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [glError, setGlError] = useState<string | null>(null)
  const [lutReady, setLutReady] = useState(0)

  /* ── renderer lifecycle ── */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    try {
      rendererRef.current = new Renderer(canvas)
    } catch (err) {
      setGlError(err instanceof Error ? err.message : 'WebGL2 is unavailable')
      return
    }

    histogramRef.current = new HistogramClient()
    histogramRef.current.onResult(setHistogram)

    // A lost context (GPU reset, tab suspended) would otherwise leave a blank
    // canvas with no explanation.
    const onLost = (event: Event) => {
      event.preventDefault()
      setGlError('The graphics context was lost. Reload the tab to keep editing.')
    }
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      rendererRef.current?.dispose()
      rendererRef.current = null
      histogramRef.current?.dispose()
      histogramRef.current = null
    }
  }, [setHistogram])

  /* ── source image ── */

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !photo) return
    try {
      renderer.setImage(photo.preview, photo.meta.orientation)
    } catch (err) {
      setGlError(err instanceof Error ? err.message : 'Could not upload the photo to the GPU')
    }
  }, [photo])

  /* ── look LUT ── */

  useEffect(() => {
    let cancelled = false
    const id = edits.look.id

    if (!id) {
      rendererRef.current?.setLut(null)
      setLutReady((n) => n + 1)
      return
    }

    void getLut(id).then((lut) => {
      if (cancelled || !rendererRef.current) return
      rendererRef.current.setLut(lut)
      if (!lut) toast(`Could not build the ${id} look`, 'error')
      setLutReady((n) => n + 1)
    })

    return () => {
      cancelled = true
    }
  }, [edits.look.id, toast])

  /* ── layout ── */

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStage({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // While cropping, the viewport shows the whole frame with the box on top —
  // you cannot drag a crop you cannot see outside of.
  const renderEdits = useMemo(
    () => (cropping ? { ...edits, crop: { ...edits.crop, x: 0, y: 0, w: 1, h: 1 } } : edits),
    [cropping, edits],
  )

  const output = useMemo(() => {
    if (!photo) return { width: 0, height: 0 }
    return outputSize(photo.meta.width, photo.meta.height, renderEdits.crop)
  }, [photo, renderEdits.crop])

  const fitScale = useMemo(() => {
    if (!output.width || !stage.width) return 1
    return Math.min(stage.width / output.width, stage.height / output.height)
  }, [output, stage])

  const scale = zoom === 'fit' ? fitScale : zoom
  const cssWidth = Math.max(1, Math.round(output.width * scale))
  const cssHeight = Math.max(1, Math.round(output.height * scale))

  // The bottom bar shows the zoom level, and only the viewport can measure it.
  useEffect(() => {
    setViewScale(scale, fitScale)
  }, [scale, fitScale, setViewScale])

  /* ── draw ── */

  const draw = useCallback(() => {
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!renderer || !canvas || !renderer.hasImage || !cssWidth || !cssHeight) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const longest = Math.max(cssWidth, cssHeight) * dpr
    const budget = longest > MAX_BUFFER_EDGE ? MAX_BUFFER_EDGE / Math.max(cssWidth, cssHeight) : dpr

    const bufferW = Math.max(1, Math.round(cssWidth * budget))
    const bufferH = Math.max(1, Math.round(cssHeight * budget))
    if (canvas.width !== bufferW) canvas.width = bufferW
    if (canvas.height !== bufferH) canvas.height = bufferH

    const look = getLook(renderEdits.look.id)
    renderer.render(bufferW, bufferH, {
      edits: renderEdits,
      look: peekLut(renderEdits.look.id) ? look : null,
      splitAt: splitCompare && !cropping ? splitAt : null,
    })
  }, [cssWidth, cssHeight, renderEdits, splitCompare, splitAt, cropping])

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      draw()
    })
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [draw, lutReady])

  /* ── histogram, throttled behind the preview ── */

  useEffect(() => {
    const renderer = rendererRef.current
    const client = histogramRef.current
    if (!renderer || !client || !renderer.hasImage || !output.width) return

    if (histogramTimer.current) clearTimeout(histogramTimer.current)
    histogramTimer.current = setTimeout(() => {
      const aspect = output.width / output.height
      const w = Math.max(16, Math.round(aspect >= 1 ? HISTOGRAM_EDGE : HISTOGRAM_EDGE * aspect))
      const h = Math.max(16, Math.round(aspect >= 1 ? HISTOGRAM_EDGE / aspect : HISTOGRAM_EDGE))

      // Always measure the edited result, never the split view.
      const pixels = renderer.renderToPixels(w, h, edits, getLook(edits.look.id))
      client.compute(pixels)
      // The readback bound another framebuffer; put the canvas back on screen.
      draw()
    }, HISTOGRAM_THROTTLE_MS)

    return () => {
      if (histogramTimer.current) clearTimeout(histogramTimer.current)
    }
  }, [edits, output.width, output.height, draw, lutReady])

  /* ── split handle ── */

  const onSplitPointerDown = (event: React.PointerEvent) => {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    const el = event.currentTarget
    el.setPointerCapture(event.pointerId)

    const move = (e: PointerEvent) => setSplitAt((e.clientX - rect.left) / rect.width)
    const up = () => {
      el.releasePointerCapture(event.pointerId)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (glError) {
    const caps = detectCapabilities()
    return (
      <div className="viewport">
        <div className="viewport__stage">
          <div className="viewport__error">
            <h2>{caps.webgl2 ? 'The GPU pipeline stopped' : '35mm needs WebGL2'}</h2>
            <p>{glError}</p>
            <dl className="facts">
              <div>
                <dt>WebGL2</dt>
                <dd className="mono">{caps.webgl2 ? 'available' : 'unavailable'}</dd>
              </div>
              <div>
                <dt>WebGPU</dt>
                <dd className="mono">{caps.webgpu ? 'available' : 'unavailable'}</dd>
              </div>
              {caps.renderer && (
                <div>
                  <dt>Renderer</dt>
                  <dd className="mono">{caps.renderer}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="viewport">
      <div ref={stageRef} className="viewport__stage" data-zoomed={zoom !== 'fit' || undefined}>
        <div className="viewport__frame" style={{ width: cssWidth, height: cssHeight }}>
          <canvas ref={canvasRef} className="viewport__canvas" />

          {splitCompare && !cropping && (
            <>
              <span className="viewport__tag viewport__tag--before">BEFORE</span>
              <span
                className="viewport__tag viewport__tag--after"
                style={{ left: `calc(${splitAt * 100}% + 14px)` }}
              >
                AFTER
              </span>
              <div className="viewport__split-line" style={{ left: `${splitAt * 100}%` }} />
              <div
                className="viewport__split-handle"
                style={{ left: `${splitAt * 100}%` }}
                onPointerDown={onSplitPointerDown}
                role="slider"
                tabIndex={0}
                aria-label="Before / after split"
                aria-valuenow={Math.round(splitAt * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setSplitAt(splitAt - 0.02)
                  if (e.key === 'ArrowRight') setSplitAt(splitAt + 0.02)
                }}
              />
            </>
          )}

          {cropping && <CropOverlay width={cssWidth} height={cssHeight} />}
        </div>
      </div>

    </div>
  )
}
