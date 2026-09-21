import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useEditor } from '../../editor/edit-stack/store'

export type Detent = 'collapsed' | 'half' | 'full'

/** In order, so "one step up" and "one step down" are just index arithmetic. */
const ORDER: Detent[] = ['collapsed', 'half', 'full']

/**
 * Fractions of the visible viewport, matching `--sheet-half` and `--sheet-full`
 * in phone.css — CSS applies the height, these decide which one a release lands
 * on. Half is well under half the screen on purpose: a phone photo is usually portrait, and a sheet taking half the
 * height leaves a 2:3 frame about 226 points wide. The picture is the thing
 * being edited, so it keeps the larger share until asked otherwise.
 */
const FRACTION: Record<Detent, number> = { collapsed: 0, half: 0.38, full: 0.68 }
/** Enough for the header and one row of controls; `--sheet-collapsed`. */
const COLLAPSED_PX = 116
/** Past this, the flick decides the direction rather than the finish position. */
const FLICK_VELOCITY = 0.5
/**
 * Long enough to cover the snap transition in phone.css. The viewport stays
 * frozen for it, so the settle animates without re-fitting the picture on every
 * frame of it; a `transitionend` releases it sooner when one arrives, and this
 * is the floor for when one does not — a snap back to the detent it started on
 * changes no height and fires no event.
 */
const SETTLE_MS = 260

function heightFor(detent: Detent, viewport: number): number {
  return detent === 'collapsed' ? COLLAPSED_PX : Math.round(viewport * FRACTION[detent])
}

/**
 * Drag the tool sheet between its heights.
 *
 * Real height, written straight to the element as a custom property rather
 * than through React state: one style write per frame, no re-render of the
 * tool inside, and the layout stays honest at every point in the drag. A
 * transform would be cheaper still but would have to pre-size the sheet to its
 * tallest detent and slide the excess off-screen, which leaves the body's
 * scroll extent wrong everywhere except at full.
 *
 * The viewport is told to stop re-fitting for the duration — see
 * `sheetDragging` — so the picture behind resizes once, on release.
 */
export function useSheetDrag(ref: RefObject<HTMLElement>) {
  const setSheetDragging = useEditor((s) => s.setSheetDragging)
  const [detent, setDetent] = useState<Detent>('half')

  const drag = useRef<{
    id: number
    startY: number
    startH: number
    lastY: number
    lastT: number
    velocity: number
  } | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  const viewport = () => window.visualViewport?.height ?? window.innerHeight

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const el = ref.current
      if (!el) return
      // A second finger arriving mid-drag must not restart it from scratch.
      if (drag.current) return

      const now = performance.now()
      drag.current = {
        id: event.pointerId,
        startY: event.clientY,
        startH: el.offsetHeight,
        lastY: event.clientY,
        lastT: now,
        velocity: 0,
      }
      // Not preventDefault: the header holds the apply and discard buttons, and
      // suppressing the default here suppresses the click that follows.
      ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
      el.dataset.dragging = 'true'
      setSheetDragging(true)
    },
    [ref, setSheetDragging],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const d = drag.current
      const el = ref.current
      if (!d || !el || event.pointerId !== d.id) return

      const vh = viewport()
      const min = heightFor('collapsed', vh)
      const max = heightFor('full', vh)

      // Up is taller, so the delta is inverted.
      const raw = d.startH - (event.clientY - d.startY)
      // Past either end it keeps moving, at a fraction — so the sheet reads as
      // having run out of room rather than as having stopped responding.
      const height =
        raw < min ? min - (min - raw) * 0.4 : raw > max ? max + (raw - max) * 0.4 : raw

      el.style.setProperty('--sheet-h', `${Math.round(height)}px`)

      const now = performance.now()
      const dt = now - d.lastT
      if (dt > 0) d.velocity = (d.lastY - event.clientY) / dt
      d.lastY = event.clientY
      d.lastT = now
    },
    [ref],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const d = drag.current
      const el = ref.current
      if (!d || !el || event.pointerId !== d.id) return
      drag.current = null

      const vh = viewport()
      const height = el.offsetHeight
      let next: Detent

      if (Math.abs(d.velocity) > FLICK_VELOCITY) {
        // A flick means direction, not destination: one step the way it went.
        const from = ORDER.indexOf(detent)
        const step = d.velocity > 0 ? 1 : -1
        next = ORDER[Math.min(ORDER.length - 1, Math.max(0, from + step))]
      } else {
        next = ORDER.reduce((best, candidate) =>
          Math.abs(heightFor(candidate, vh) - height) < Math.abs(heightFor(best, vh) - height)
            ? candidate
            : best,
        )
      }

      el.style.removeProperty('--sheet-h')
      delete el.dataset.dragging
      setDetent(next)

      /*
       * Stay frozen through the snap.
       *
       * Releasing here instead would hand the viewport a height that is still
       * animating, and it would re-fit — and reallocate its drawing buffer —
       * on every frame of the transition. Waiting for the end of it costs a
       * quarter second of a stale fit and turns a dozen reallocations into one.
       */
      const release = () => {
        if (settle.current) clearTimeout(settle.current)
        settle.current = null
        el.removeEventListener('transitionend', onEnd)
        setSheetDragging(false)
      }
      const onEnd = (e: TransitionEvent) => {
        if (e.target === el && e.propertyName === 'height') release()
      }
      el.addEventListener('transitionend', onEnd)
      settle.current = setTimeout(release, SETTLE_MS)
    },
    [ref, detent, setSheetDragging],
  )

  // If the component goes away mid-drag or mid-settle, the viewport must not be
  // left frozen with no one to thaw it.
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current)
      setSheetDragging(false)
    },
    [setSheetDragging],
  )

  return {
    detent,
    setDetent,
    /* `pointercancel` and a lost capture are the two touch endings that are not
       `pointerup`; all three land here. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: onPointerUp,
    },
  }
}
