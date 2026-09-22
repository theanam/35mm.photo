import { prefetchDecoders } from './prefetch'

/** Registers the offline shell. Skipped in dev, where a stale cache only gets
 *  in the way of the reload you just triggered. */
export function registerServiceWorker() {
  if (import.meta.env.DEV) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI).href
    navigator.serviceWorker.register(url, { scope: new URL('.', document.baseURI).pathname }).catch((err) => {
      console.warn('[35mm] offline support unavailable', err)
    })

    // Once the app has settled, pull the file decoders in behind it, so the
    // first raw or HEIC opens without a download — and one opened offline
    // works at all.
    prefetchDecoders()
  })
}
