/*
 * Offline shell for 35mm (spec §3.4).
 *
 * Two caches, because the things being cached have different lifetimes:
 *
 *   35mm-shell-<build>  the app itself, precached at install from the manifest
 *                       the build writes. Replaced wholesale on each deploy.
 *   35mm-assets         everything fetched afterwards — the LibRaw binary, the
 *                       detector's runtime and weights. These carry content
 *                       hashes in their names, so they cannot go stale, and
 *                       they are emphatically not re-downloaded on every
 *                       deploy: the detector alone is nineteen megabytes.
 *
 * The build id is stamped in at build time. `sw.js` is served under a stable
 * name and would otherwise be byte-identical between deploys, which means the
 * browser would never re-install it and this worker would precache the previous
 * build's filenames for ever.
 */

const BUILD = '__BUILD__'
const SHELL_CACHE = `35mm-shell-${BUILD}`
const ASSET_CACHE = '35mm-assets'

/**
 * The root, which the manifest does not list: it names `index.html`, and a
 * navigation to `/` is a different cache key.
 */
const ROOT = '.'

/** Enough to open the app if the manifest cannot be read at all. */
const FALLBACK = ['index.html', 'manifest.webmanifest', 'icon.svg', 'favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // A missing entry must not fail the whole install.
      await cache.add(ROOT).catch(() => {})

      let shell = null
      try {
        // `no-cache` so a deploy is never precached from the previous build's
        // manifest sitting in the HTTP cache under the same name.
        const response = await fetch('precache.json', { cache: 'no-cache' })
        if (response.ok) shell = (await response.json()).shell
      } catch {
        // Offline at install, or no manifest — fall back below.
      }

      // The fallback only runs when there is no manifest; running both would
      // fetch the same handful of files twice on every install.
      await Promise.allSettled((shell ?? FALLBACK).map((url) => cache.add(url)))

      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          // Only previous *shells* go. The asset cache is content-addressed and
          // outlives every deploy; dropping it would make each release cost the
          // user another nineteen megabytes.
          .filter((key) => key.startsWith('35mm-shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Only this origin — a font or a CDN request is the browser's business.
  if (url.origin !== self.location.origin) return

  // The manifest describes the cache; serving it from the cache is how a worker
  // outlives the deploy that replaced it.
  if (url.pathname.endsWith('/precache.json')) return

  // Navigations fall back to the cached shell so a reload works offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() =>
          caches.match('index.html').then((r) => r ?? caches.match('.').then((f) => f ?? Response.error())),
        ),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            // Anything not precached lands in the long-lived cache: it is
            // fingerprinted, so it is safe to keep until its name changes.
            void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached ?? Response.error())

      return cached ?? network
    }),
  )
})
