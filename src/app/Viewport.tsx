import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { Renderer } from '../editor/gpu/renderer'
import { outputSize } from '../editor/gpu/transform'
import { getLut, peekLut } from '../editor/presets/lutCache'
import { getLook } from '../editor/presets/catalogue'
import { subjectMapsFor } from '../subject/detect'
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
/** How much of the stage a crop box is given, leaving the rest for context. */
const CROP_FIT_MARGIN = 0.82

/** Ceiling on the crop-driven zoom, as a multiple of the whole-frame fit. */
const MAX_CROP_ZOOM = 12

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
  const cropDragging = useEditor((s) => s.cropDragging)
  const sheetDragging = useEditor((s) => s.sheetDragging)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  // Derived coverage maps change without the edit stack changing, so the draw
  // has to be told separately that there is something new to upload.
  const maskMapsAt = useEditor((s) => s.maskMapsAt)
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
      const renderer = rendererRef.current
      rendererRef.current = null
      histogramRef.current?.dispose()
      histogramRef.current = null

      /*
       * Hand the context back, but only once we know the canvas is going with
       * it.
       *
       * `dispose()` on its own releases this renderer's GPU objects and leaves
       * the context itself alive until the canvas is collected, which browsers
       * are in no hurry to do — and they cap how many contexts may live at
       * once. That was survivable while the viewport only unmounted when a
       * photo was closed. It is not survivable now that crossing the phone
       * breakpoint swaps the whole tree: every crossing stranded a context, and
       * a few resizes exhausted the budget.
       *
       * `loseContext` cannot simply be turned on, for the reason `dispose`
       * documents: when the effect merely re-runs — a dependency change, a fast
       * refresh — the canvas stays and the next renderer would inherit a dead
       * context, where shaders fail to compile with a null info log. So the
       * question is not "is this cleanup running" but "is this canvas still in
       * the document afterwards", and React detaches the node *after* running
       * cleanups, so the answer is only true a microtask later.
       */
      queueMicrotask(() => renderer?.dispose({ loseContext: !canvas.isConnected }))
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

  /*
   * The stage's own box is the only thing fit, pan limits and the crop box's
   * centring are derived from.
   *
   * It is held still while the phone's sheet is being dragged. The sheet takes
   * real layout height — which is what keeps all of those correct — so every
   * frame of a drag would resize the stage, and every resize reallocates the
   * drawing buffer. The size is re-read on the falling edge instead, which is
   * the same bargain `settledCropFit` strikes a few lines below.
   */
  const sheetDraggingRef = useRef(false)
  sheetDraggingRef.current = sheetDragging

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (sheetDraggingRef.current) return
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

  const wholeFit = useMemo(() => {
    if (!output.width || !stage.width) return 1
    return Math.min(stage.width / output.width, stage.height / output.height)
  }, [output, stage])

  /**
   * While cropping, "fit" means fit the *crop box*, not the frame.
   *
   * The viewport shows the whole picture with the box drawn over it, so a crop
   * down to a tenth of the frame is a tenth of the screen to work on, and the
   * handles land within a few pixels of each other. Scaling to the box instead
   * gives a small crop the room a small crop needs, and the rest of the picture
   * keeps going past the edges where it can still be seen and dragged into.
   *
   * Never below the whole-frame fit — a crop that already fits needs no help —
   * and capped, because at some point the limit on precision is the pointer and
   * not the pixels.
   */
  const cropFit = useMemo(() => {
    if (!cropping || !output.width || !stage.width) return wholeFit
    const box = edits.crop
    const w = Math.max(box.w, 0.02) * output.width
    const h = Math.max(box.h, 0.02) * output.height
    const toBox = Math.min(stage.width / w, stage.height / h) * CROP_FIT_MARGIN
    return Math.min(Math.max(wholeFit, toBox), wholeFit * MAX_CROP_ZOOM)
  }, [cropping, output, stage, edits.crop, wholeFit])

  /**
   * Held still for the duration of a drag. Rescaling while a handle is under
   * the pointer moves the picture the pointer is aiming at, which turns a
   * steady drag into a chase; this settles a frame after the release instead.
   */
  const [settledCropFit, setSettledCropFit] = useState(1)
  useEffect(() => {
    if (!cropDragging) setSettledCropFit(cropFit)
  }, [cropFit, cropDragging])

  const fitScale = cropping ? settledCropFit : wholeFit

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

  /**
   * Keep the crop box in the middle of the stage.
   *
   * Once the scale follows the box, the frame is larger than the stage and the
   * box can be anywhere in it — so without this, dragging one toward a corner
   * walks it straight off the screen. Following during the drag as well as
   * after it means the box stays put and the picture slides underneath, which
   * is how every crop on a phone behaves and is far less disorienting than the
   * box wandering away.
   *
   * The drag maths is all client-space deltas from a snapshot taken on pointer
   * down, so scrolling underneath it changes nothing about where the box lands.
   */
  useEffect(() => {
    if (!cropping) return
    const el = stageRef.current
    if (!el) return
    const box = edits.crop
    el.scrollLeft = (box.x + box.w / 2) * cssWidth - el.clientWidth / 2
    el.scrollTop = (box.y + box.h / 2) * cssHeight - el.clientHeight / 2
  }, [cropping, edits.crop, cssWidth, cssHeight])

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

  /*
   * Swipe to the next photo, in the slot the pan gesture leaves empty.
   *
   * One finger only pans when `pannable`, and `pannable` is false whenever the
   * picture already fits — which is the ordinary case. So a horizontal drag
   * across a fitted photo did nothing at all, and there was no touch route to
   * the next frame: the arrow keys were the only one. Living inside the stage's
   * own handlers rather than in a wrapper matters, because the stage sets
   * `touch-action: none` and captures the pointer, and anything layered over it
   * would be fighting both.
   */
  const swipeRef = useRef<{ x: number; y: number; at: number } | null>(null)

  const stepFrame = useCallback((direction: -1 | 1) => {
    const s = useEditor.getState()
    const index = s.frames.findIndex((f) => f.id === s.activeFrameId)
    if (index === -1) return
    const next = index + direction
    if (next < 0 || next >= s.frames.length) return
    void s.selectFrame(s.frames[next].id)
  }, [])

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

    // Only a lone finger on a picture that has nowhere to pan can be a swipe.
    swipeRef.current =
      points.length === 1 && !pannable && event.pointerType !== 'mouse'
        ? { x: event.clientX, y: event.clientY, at: performance.now() }
        : null

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

    /*
     * Deliberately strict. A photo is a thing people put a finger on to look
     * at, so anything that could be a tap, a slow drag or a two-finger gesture
     * must not change what they are looking at: it has to be mostly sideways,
     * far enough to be meant, and quick enough to be a flick.
     */
    const swipe = swipeRef.current
    swipeRef.current = null
    if (swipe && points.length === 0) {
      const dx = event.clientX - swipe.x
      const dy = event.clientY - swipe.y
      const quick = performance.now() - swipe.at < 600
      if (quick && Math.abs(dx) > 64 && Math.abs(dy) < 44 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        // Drag left to bring the next photo in from the right, like a stack of
        // prints being pushed along.
        stepFrame(dx < 0 ? 1 : -1)
        endGesture()
        return
      }
    }

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

    // Subject coverage is derived rather than edited, so it is uploaded here
    // from the session cache rather than read off the edit stack. The order is
    // the order the masks appear in, which is the order `packMasks` assigns
    // channels in — the two must not drift apart.
    renderer.setSubjectMaps(subjectMapsFor(renderEdits.masks, activeFrameId))

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
    masking, maskOverlay, activeMaskId, activeFrameId, maskMapsAt,
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
    // `pointercancel` and a lost capture are the two touch exits that are not
    // `pointerup`; without them the move listener outlives the gesture and the
    // split line follows every later touch.
    const up = () => {
      try {
        el.releasePointerCapture(event.pointerId)
      } catch {
        // Already released — the capture was lost rather than given up.
      }
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
      {/* `data-zoomed` follows whether the frame overflows, not whether the
          user asked to zoom. Cropping scales to the box while the zoom setting
          is still "fit", so keying it on the setting left the stage
          overflow:hidden and hard-centred — which pushes whatever does not fit
          out past the edges with no way to scroll to it, and slides the crop
          box up under the toolbar. */}
      <div
        ref={stageRef}
        className="viewport__stage"
        data-zoomed={overflows || undefined}
        data-cropping={cropping || undefined}
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
