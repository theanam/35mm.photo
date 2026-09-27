import { useCallback, useEffect, useState } from 'react'

/**
 * The widths of the two rails, dragged and remembered.
 *
 * The defaults live in the stylesheet, including the narrow-screen ones, so
 * nothing is written here until somebody drags. Then the width is set as a
 * custom property on the app root, which is what the stylesheet reads, and
 * kept in this browser.
 */

export interface LayoutWidths {
  strip?: number
  rail?: number
}

/** No narrower than the stylesheet's default: the header does not fit below it. */
export const STRIP_RANGE = [148, 640] as const
export const RAIL_RANGE = [300, 720] as const

const KEY = '35mm.layout'

function load(): LayoutWidths {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as LayoutWidths) : {}
    return {
      strip: clampOr(parsed.strip, STRIP_RANGE),
      rail: clampOr(parsed.rail, RAIL_RANGE),
    }
  } catch {
    return {}
  }
}

function clampOr(v: unknown, [lo, hi]: readonly [number, number]): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined
}

export function useLayout() {
  const [widths, setWidths] = useState<LayoutWidths>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(widths))
    } catch {
      // The widths hold for this session.
    }
  }, [widths])

  const setStrip = useCallback((w: number | undefined) => setWidths((s) => ({ ...s, strip: clampOr(w, STRIP_RANGE) })), [])
  const setRail = useCallback((w: number | undefined) => setWidths((s) => ({ ...s, rail: clampOr(w, RAIL_RANGE) })), [])

  const style = {
    ...(widths.strip ? { ['--strip-width' as string]: `${widths.strip}px` } : {}),
    ...(widths.rail ? { ['--rail-width' as string]: `${widths.rail}px` } : {}),
  } as React.CSSProperties

  return { widths, style, setStrip, setRail }
}
