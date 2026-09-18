import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { Renderer } from '../editor/gpu/renderer'
import { outputSize } from '../editor/gpu/transform'
import { getLut, peekLut } from '../editor/presets/lutCache'
import { getLook } from '../editor/presets/catalogue'
import { HistogramClient } from '../editor/histogram'
import { detectCapabilities } from '../editor/gpu/caps'
import { CropOverlay } from './CropOverlay'
import { MaskOverlay } from './MaskOverlay'

/** Histogram readback size — enough bins to be representative, cheap to read. */
const HISTOGRAM_EDGE = 192
const HISTOGRAM_THROTTLE_MS = 140
/** Cap on the drawing buffer's longest edge, so a 400% zoom cannot exhaust VRAM. */
const MAX_BUFFER_EDGE = 4096
/** Furthest the wheel will take you in. */
const MAX_ZOOM = 8
/** Wheel delta → zoom factor. Exponential so each notch feels the same. */
const WHEEL_SENSITIVITY = 0.0015
/** Trackpad pinch arrives as ctrl+wheel with small deltas; it needs more gain. */
const PINCH_GAIN = 4
/** Wheel events closer together than this count as one continuous gesture. */
const GESTURE_IDLE_MS = 350
/** Moving the cursor further than this starts a new gesture. */
const GESTURE_SLOP_PX = 24

export function Viewport() {
  const photo = useEditor((s) => s.photo)
  const edits = useEditor((s) => s.edits)
  const zoom = useEditor((s) => s.zoom)
  const splitCompare = useEditor((s) => s.splitCompare)
  const splitAt = useEditor((s) => s.splitAt)
  const setSplitAt = useEditor((s) => s.setSplitAt)
  const cropping = useEditor((s) => s.cropping)
  const masking = useEditor((s) => s.activeTool === 'masks')
  const activeMaskId = useEditor((s) => s.activeMaskId)
  const maskOverlay = useEditor((s) => s.maskOverlay)
  const setHistogram = useEditor((s) => s.setHistogram)
  const setViewScale = useEditor((s) => s.setViewScale)
  const setZoom = useEditor((s) => s.setZoom)
  const toast = useEditor((s) => s.toast)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameElRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<Renderer | null>(null)
  const histogramRef = useRef<HistogramClient | null>(null)
  const frameRef = useRef<number | null>(null)
  const histogramTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [glError, setGlError] = useState<string | null>(null)
  const [lutReady, setLutReady] = useState(0)
  const [panning, setPanning] = useState(false)

  /** Live pointers on the stage, so one finger pans and two pinch. */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; midX: number; midY: number } | null>(null)
  const panRef = useRef<
    { pointerId: number; startX: number; startY: number; startLeft: number; startTop: number } | null
  >(null)

  /**
   * The image point the wheel is zooming around, held for the whole gesture.
   *
   * It deliberately survives across notches rather than being re-derived each
   * time. While the picture still fits the stage there is no scroll range to
   * correct with, so those first notches cannot hold the point; re-deriving
   * would bake that error in permanently. Keeping the original target means the
   * moment scrolling becomes possible, it snaps back to the point you aimed at.
   */
  const anchorRef = useRef<
    { u: number; v: number; clientX: number; clientY: number; at: number } | null
  >(null)
  /** Set when a zoom is waiting for its scroll correction. */
  const correctionDueRef = useRef(false)
  /** Read inside the native wheel listener, which is attached once. */
  const fitScaleRef = useRef(1)

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

    // A parametric preset is slider values, not a cube: it lands on the edit
    // stack and sets `look.id` only to mark the grid, so resolving to no LUT is
    // the right answer for it. Only a look that should have had one has failed.
    const look = getLook(id)
    const expectsLut = look?.custom?.kind !== 'parametric'

    void getLut(id).then((lut) => {
      if (cancelled || !rendererRef.current) return
      rendererRef.current.setLut(lut)
      if (!lut && expectsLut) {
        toast(`Could not build the ${look?.name ?? id} look`, 'error')
      }
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

  useEffect(() => {
    fitScaleRef.current = fitScale
  }, [fitScale])

  /* ── zoom plumbing ── */

  /**
   * Record the image point to keep still. `sample` is where to read it from in
   * the frame as it stands now; `target` is where it should end up once the new
   * size is laid out. For a wheel notch the two are the same point; for a pinch
   * the target follows the moving midpoint, which is what makes a pinch pan and
   * zoom at once.
   */
  const setAnchor = useCallback(
    (sampleX: number, sampleY: number, targetX: number, targetY: number) => {
      const rect = frameElRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        anchorRef.current = null
        return
      }
      anchorRef.current = {
        u: clamp01((sampleX - rect.left) / rect.width),
        v: clamp01((sampleY - rect.top) / rect.height),
        clientX: targetX,
        clientY: targetY,
        at: performance.now(),
      }
    },
    [],
  )

  const applyZoom = useCallback(
    (factor: number) => {
      const fit = fitScaleRef.current
      const current = useEditor.getState().zoom
      const from = current === 'fit' ? fit : current
      const next = from * factor

      // Zooming out stops at fit: there is nothing to see past the whole frame,
      // and landing back on 'fit' keeps it responsive to window resizes.
      if (next <= fit * 1.01) {
        anchorRef.current = null
        correctionDueRef.current = false
        setZoom('fit')
        return
      }

      correctionDueRef.current = true
      setZoom(Math.min(next, MAX_ZOOM))
    },
    [setZoom],
  )

  /* ── wheel: ctrl/cmd zooms, plain scroll pans ── */

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      if (!useEditor.getState().photo) return

      // Plain scroll is left to the browser so it pans the stage, which is what
      // every other editor does. Trackpad pinch arrives here as ctrl+wheel, so
      // gating on the modifier covers the pinch gesture on a laptop too.
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()

      // deltaMode 1 is lines and 2 is pages; normalise both to pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
      const delta = event.deltaY * unit * (event.ctrlKey ? PINCH_GAIN : 1)
      if (!delta) return

      // Hold the anchor across the gesture: while the picture still fits there
      // is no scroll range to correct with, and re-deriving each notch would
      // bake that error in for good.
      const now = performance.now()
      const previous = anchorRef.current
      const continuing =
        previous !== null &&
        now - previous.at < GESTURE_IDLE_MS &&
        Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) < GESTURE_SLOP_PX

      if (continuing) {
        anchorRef.current = { ...previous, clientX: event.clientX, clientY: event.clientY, at: now }
      } else {
        setAnchor(event.clientX, event.clientY, event.clientX, event.clientY)
      }

      applyZoom(Math.exp(-delta * WHEEL_SENSITIVITY))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [applyZoom, setAnchor])

  /**
   * Put the anchor back under the cursor. This has to run after layout and
   * before paint, or the image visibly jumps on every notch of the wheel.
   */
  useLayoutEffect(() => {
    if (!correctionDueRef.current) return
    correctionDueRef.current = false

    const anchor = anchorRef.current
    const el = stageRef.current
    const frameEl = frameElRef.current
    if (!anchor || !el || !frameEl) return

    // Where the axis does not overflow the browser clamps this to zero and the
    // frame stays centred; the anchor is kept so the next notch can finish it.
    const rect = frameEl.getBoundingClientRect()
    el.scrollLeft += rect.left - (anchor.clientX - anchor.u * rect.width)
    el.scrollTop += rect.top - (anchor.clientY - anchor.v * rect.height)
  })

  /* ── pointer gestures: one finger pans, two pinch ── */

  const overflows =
    cssWidth > Math.ceil(stage.width) + 1 || cssHeight > Math.ceil(stage.height) + 1
  const pannable = overflows && !cropping

  const endGesture = useCallback(() => {
    pointersRef.current.clear()
    pinchRef.current = null
    panRef.current = null
    setPanning(false)
  }, [])

  const onStagePointerDown = (event: React.PointerEvent) => {
    const el = stageRef.current
    if (!el || !useEditor.getState().photo) return

    // The split handle and the crop box own their own drags.
    const target = event.target as Element
    if (target.closest('.viewport__split-handle') || target.closest('.crop')) return

    // A mouse only pans with the left button; touch and pen have no such notion.
    if (event.pointerType === 'mouse' && event.button !== 0) return

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    try {
      el.setPointerCapture(event.pointerId)
    } catch {
      // Capture is best-effort; the pointer map still tracks the gesture.
    }

    const points = [...pointersRef.current.values()]

    if (points.length === 2) {
      // Second finger down: stop panning and start pinching.
      panRef.current = null
      setPanning(false)
      pinchRef.current = {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        midX: (points[0].x + points[1].x) / 2,
        midY: (points[0].y + points[1].y) / 2,
      }
      anchorRef.current = null
      event.preventDefault()
      return
    }

    if (points.length === 1 && pannable) {
      anchorRef.current = null
      panRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: el.scrollLeft,
        startTop: el.scrollTop,
      }
      setPanning(true)
      event.preventDefault()
    }
  }

  const onStagePointerMove = (event: React.PointerEvent) => {
    const el = stageRef.current
    if (!el) return
    if (!pointersRef.current.has(event.pointerId)) return

    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...pointersRef.current.values()]

    const pinch = pinchRef.current
    if (points.length >= 2 && pinch) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const midX = (points[0].x + points[1].x) / 2
      const midY = (points[0].y + points[1].y) / 2

      // Moving both fingers together pans; scroll it directly so the gesture
      // still works at a zoom level the scale clamp refuses to change.
      el.scrollLeft -= midX - pinch.midX
      el.scrollTop -= midY - pinch.midY

      const ratio = distance > 0 && pinch.distance > 0 ? distance / pinch.distance : 1
      pinchRef.current = { distance, midX, midY }

      if (Math.abs(ratio - 1) > 0.002) {
        // Sampled after the pan above, so the anchor reflects where the image
        // actually sits right now.
        setAnchor(midX, midY, midX, midY)
        applyZoom(ratio)
      }
      return
    }

    const pan = panRef.current
    if (pan && pan.pointerId === event.pointerId) {
      el.scrollLeft = pan.startLeft - (event.clientX - pan.startX)
      el.scrollTop = pan.startTop - (event.clientY - pan.startY)
    }
  }

  const onStagePointerUp = (event: React.PointerEvent) => {
    const el = stageRef.current
    pointersRef.current.delete(event.pointerId)
    try {
      el?.releasePointerCapture(event.pointerId)
    } catch {
      // Already released, e.g. the pointer left the window mid-gesture.
    }

    const points = [...pointersRef.current.entries()]
    if (points.length < 2) pinchRef.current = null

    if (points.length === 1 && el && pannable) {
      // Lifting one finger of a pinch hands the gesture to the other.
      const [pointerId, point] = points[0]
      panRef.current = {
        pointerId,
        startX: point.x,
        startY: point.y,
        startLeft: el.scrollLeft,
        startTop: el.scrollTop,
      }
      setPanning(true)
      return
    }

    if (points.length === 0) endGesture()
  }

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
    // The overlay is a tool affordance, so it only exists while the tool is
    // open — an export or a histogram readback never sees it.
    const overlay =
      masking && maskOverlay ? renderEdits.masks.findIndex((m) => m.id === activeMaskId) : -1

    renderer.render(bufferW, bufferH, {
      edits: renderEdits,
      look: peekLut(renderEdits.look.id) ? look : null,
      splitAt: splitCompare && !cropping ? splitAt : null,
      maskOverlay: overlay >= 0 ? overlay : null,
    })
  }, [
    cssWidth, cssHeight, renderEdits, splitCompare, splitAt, cropping,
    masking, maskOverlay, activeMaskId,
  ])

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
      <div
        ref={stageRef}
        className="viewport__stage"
        data-zoomed={zoom !== 'fit' || undefined}
        data-pannable={pannable || undefined}
        data-panning={panning || undefined}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        <div ref={frameElRef} className="viewport__frame" style={{ width: cssWidth, height: cssHeight }}>
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
          {masking && !cropping && <MaskOverlay width={cssWidth} height={cssHeight} />}
        </div>
      </div>

    </div>
  )
}

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}
