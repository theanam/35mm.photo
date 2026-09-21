/*
 * Offline shell for 35mm (spec §3.4). Vite fingerprints its output, so rather
 * than precaching a build-time manifest this caches on first use and serves
 * from the cache while refreshing in the background. After one visit the app
 * opens with no network at all.
 */

// Bump on any change to a shell asset served under a stable name — the icons
// and manifest are not fingerprinted, so a stale cache would keep serving the
// previous brand to anyone who has already visited.
const CACHE = '35mm-v3'
const SHELL = ['.', 'index.html', 'manifest.webmanifest', 'icon.svg', 'favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // A missing shell entry must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Only this origin — a font or a CDN request is the browser's business.
  if (url.origin !== self.location.origin) return

  // Navigations fall back to the cached shell so a reload works offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          void caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
          return response
        })
        .catch(() => caches.match('index.html').then((r) => r ?? Response.error())),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached ?? Response.error())

      return cached ?? network
    }),
  )
})
