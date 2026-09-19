/// <reference lib="webworker" />

import type { HeifImage } from 'libheif-js/wasm-bundle'

/**
 * HEIC decoding through libheif, compiled to WASM (spec §3.3).
 *
 * Off the main thread for the same reason `raw/preview-worker.ts` is: this is
 * an HEVC intra frame being decoded in software, twelve megapixels of it for a
 * phone photo, and on the main thread it froze the tab for the second or two it
 * took. The bitmap is transferred back rather than copied.
 *
 * The import is dynamic so that nothing about libheif — neither the module nor
 * the WASM inlined into it — is fetched until a file arrives that needs it. On
 * Safari none ever does: the browser decodes HEIC itself and this worker is
 * never started.
 */

interface DecodeRequest {
  id: string
  bytes: Uint8Array
}

type Libheif = (typeof import('libheif-js/wasm-bundle'))['default']

/**
 * The `wasm-bundle` entry carries its WASM inside the JavaScript rather than
 * beside it as a separate asset. That is the whole reason for choosing it: the
 * sibling-file entry point would land this in the same trap `libraw-wasm` is in
 * — see the note in `vite.config.ts` — where the bundler rewrites the module
 * and leaves the file it reaches for behind.
 */
let loading: Promise<Libheif> | null = null

function load(): Promise<Libheif> {
  if (!loading) {
    const attempt = import('libheif-js/wasm-bundle').then((mod) => {
      // Published as CommonJS, so whether the namespace itself or its `default`
      // holds the exports depends on how the bundler interoperated it.
      const namespace = mod as unknown as Partial<Libheif>
      const lib = namespace?.HeifDecoder ? (namespace as Libheif) : mod.default
      if (!lib?.HeifDecoder) throw new Error('the HEIC decoder did not load')
      return lib
    })

    // A failed load must not be remembered as the answer. The likeliest cause
    // is being offline before the WASM was ever cached, and the next attempt
    // should get to try again rather than inherit this one's failure.
    attempt.catch(() => {
      if (loading === attempt) loading = null
    })
    loading = attempt
  }
  return loading
}

self.addEventListener('message', async (event: MessageEvent<DecodeRequest>) => {
  const { id, bytes } = event.data
  let image: HeifImage | undefined

  try {
    const libheif = await load()
    const images = new libheif.HeifDecoder().decode(bytes)

    // A HEIC is a container and routinely holds more than the photo: a depth
    // map, an alternative exposure, the thumbnail. The primary image comes
    // first, and it is the only one being opened here.
    image = images?.[0]
    if (!image) throw new Error('the file holds no image')

    const width = image.get_width()
    const height = image.get_height()
    if (!width || !height) throw new Error('the image has no dimensions')

    // libheif applies the container's own rotation and mirroring as it decodes,
    // so these dimensions — and the pixels below — are already upright. See the
    // note in `exif.ts` on why nothing downstream turns them again.
    const data = new ImageData(width, height)
    const decoded = image
    await new Promise<void>((resolve, reject) => {
      decoded.display(data, (out) =>
        out ? resolve() : reject(new Error('the decoder returned no pixels')),
      )
    })

    const bitmap = await createImageBitmap(data)
    self.postMessage({ id, ok: true, bitmap }, [bitmap])
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'could not decode the file',
    })
  } finally {
    // libheif hands back a handle into WASM memory, which the garbage collector
    // on this side knows nothing about.
    try {
      image?.free?.()
    } catch {
      // Already released, or a build that does not expose it.
    }
  }
})
