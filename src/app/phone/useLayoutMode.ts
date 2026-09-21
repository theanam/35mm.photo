import { useSyncExternalStore } from 'react'

/**
 * When the phone shell replaces the desktop tree outright.
 *
 * Two clauses, because a phone rotated is 844 points wide and would otherwise
 * fall out of a width-only test straight back into the desktop layout — the
 * exact layout this exists to avoid. The second clause catches the same device
 * on its side: short, and touched rather than pointed at. A tablet fails both
 * (834 x 1112 either way round) and keeps the desktop layout, as intended.
 *
 * What matters is that both orientations of one device give the same answer.
 * Swapping shells unmounts a React tree, and that disposes the viewport's
 * WebGL context and re-uploads the photo — so a query that flipped on rotation
 * would pay a full GPU re-init, and a visible flash, every time the phone
 * turned. This one does not flip.
 */
const PHONE_QUERY = '(max-width: 760px), (max-height: 560px) and (pointer: coarse)'

const cache = new Map<string, MediaQueryList>()

function listFor(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  let list = cache.get(query)
  if (!list) {
    list = window.matchMedia(query)
    cache.set(query, list)
  }
  return list
}

/**
 * `useSyncExternalStore` rather than an effect that sets state: an effect only
 * runs after the first paint, so a phone would mount the desktop tree, build a
 * GL context and tear it down again on every load.
 */
export function useMediaQuery(query: string): boolean {
  const list = listFor(query)
  return useSyncExternalStore(
    (onChange) => {
      if (!list) return () => {}
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => list?.matches ?? false,
    () => false,
  )
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}

/**
 * Landscape is a layout change *within* the phone shell, never a reason to
 * switch shells — see above. Only the sheet reads it, to sit beside the
 * picture instead of under it.
 */
export function useIsLandscape(): boolean {
  return useMediaQuery('(orientation: landscape)')
}
