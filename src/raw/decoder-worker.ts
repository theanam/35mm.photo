/// <reference lib="webworker" />

/**
 * Raw decode worker (spec §5). Drop a libraw WASM build into `src/raw/wasm/`
 * and export `decodeRawBuffer(bytes) => { width, height, pixels, meta }` from
 * it; this worker will pick it up and the rest of the pipeline needs no change.
 *
 * Running the decode here keeps a multi-second CBR/CR3 parse off the UI thread
 * (spec §3.3).
 */

type DecodeRequest = { id: string; type: 'decode'; name: string; bytes: ArrayBuffer }

interface LibrawModule {
  decodeRawBuffer(bytes: Uint8Array): {
    width: number
    height: number
    /** Demosaiced linear RGBA, 16 bits per channel. */
    pixels: Uint16Array
    meta?: { iso?: number; camera?: string; lens?: string; shotAt?: number }
  }
}

let modulePromise: Promise<LibrawModule | null> | null = null

async function loadLibraw(): Promise<LibrawModule | null> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        // The path is held in a variable so neither TypeScript nor the bundler
        // tries to resolve a binary that may not be vendored yet.
        const path = './wasm/libraw.js'
        const mod = (await import(/* @vite-ignore */ path)) as unknown as LibrawModule
        return typeof mod.decodeRawBuffer === 'function' ? mod : null
      } catch {
        return null
      }
    })()
  }
  return modulePromise
}

self.addEventListener('message', async (event: MessageEvent<DecodeRequest>) => {
  const msg = event.data
  if (msg?.type !== 'decode') return

  const libraw = await loadLibraw()
  if (!libraw) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: 'No RAW decoder is bundled. Add a libraw WASM build under src/raw/wasm/.',
    })
    return
  }

  try {
    const result = libraw.decodeRawBuffer(new Uint8Array(msg.bytes))
    self.postMessage(
      {
        id: msg.id,
        ok: true,
        width: result.width,
        height: result.height,
        pixels: result.pixels,
        meta: result.meta,
      },
      [result.pixels.buffer],
    )
  } catch (err) {
    self.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : 'RAW decode failed',
    })
  }
})
