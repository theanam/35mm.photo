import type { AssetGroups } from './asset-groups'

/**
 * Warming the file decoders once the app is sitting idle.
 *
 * Everything heavy in 35mm loads on first use, which is right for the page
 * weight and wrong for two other things: the first raw anyone opens waits for a
 * download it could have had already, and a raw opened *offline* cannot be
 * developed at all, because nothing ever fetched the decoder while there was a
 * network to fetch it over. Pulling them in quietly once the app has settled
 * fixes both without delaying anything anyone is waiting for.
 *
 * Two groups are warmed: LibRaw (~1.6 MB) and libheif (~2.0 MB). Together they
 * are less than a single photograph, and they are what makes this a photo
 * editor rather than a JPEG editor — between them they open what is actually on
 * a camera card and on a phone.
 *
 * ## What is deliberately not prefetched
 *
 * The subject detector — about seventeen megabytes of ONNX Runtime and model
 * weights. The Masks panel asks before the first detection precisely because
 * that is a real cost on a real connection, and spending it quietly here would
 * go behind the back of a question the app already knows to ask. Once somebody
 * has said yes, the service worker keeps it; until then it stays unfetched.
 */

/** Long enough that the first photo, the LUTs and the histogram are all done. */
const SETTLE_MS = 4000

/**
 * A connection the user has asked us to be careful with. Save-Data is an
 * explicit request; 2g and 3g are the cases where 1.6 MB in the background
 * would be felt by whatever they are actually doing.
 */
function connectionIsPrecious(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string }
    }
  ).connection
  if (!connection) return false
  if (connection.saveData) return true
  return connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g'
}

function whenIdle(fn: () => void): void {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback
  if (idle) idle(fn)
  else setTimeout(fn, 0)
}

async function readManifest(): Promise<AssetGroups | null> {
  try {
    const url = new URL('precache.json', document.baseURI).href
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as AssetGroups
  } catch {
    // Dev has no manifest, and there is nothing to warm there anyway.
    return null
  }
}

/**
 * Fetch, and throw the bytes away.
 *
 * The point is the caches, not the value: the service worker sees the request
 * and keeps the response, so the real load later comes off the disk. Failures
 * are silent by design — this is an optimisation, and an optimisation that
 * reports errors to someone who did not ask for it is a bug.
 */
async function warm(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      const url = new URL(path, document.baseURI).href
      await fetch(url, { credentials: 'same-origin' })
    } catch {
      return
    }
  }
}

let started = false

export function prefetchDecoders(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return
  if (connectionIsPrecious()) return

  window.setTimeout(() => {
    whenIdle(() => {
      void readManifest().then((manifest) => {
        if (!manifest) return
        void warm([...(manifest.raw ?? []), ...(manifest.heic ?? [])])
      })
    })
  }, SETTLE_MS)
}
