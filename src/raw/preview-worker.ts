/// <reference lib="webworker" />

/**
 * Turns LibRaw's output buffer into an `ImageBitmap` (spec §3.3).
 *
 * This is a per-pixel rewrite of a full-resolution frame — 81 megapixels for a
 * high-res Panasonic file — and on the main thread it froze the tab for long
 * enough to stall the UI outright. Both the buffer in and the bitmap out are
 * transferred, so the hop costs no copy.
 */

interface ConvertRequest {
  id: string
  width: number
  height: number
  /** Channels per pixel as LibRaw packed them: 3 for nearly every camera. */
  colors: number
  bits: number
  data: Uint8Array | Uint16Array
}

self.addEventListener('message', async (event: MessageEvent<ConvertRequest>) => {
  const { id, width, height, colors, bits, data } = event.data

  try {
    const channels = colors || 3
    // 16-bit sensor data down to the 8 bits an ImageBitmap can hold. Export
    // re-renders from the edit stack, so nothing downstream needs the low byte.
    const shift = bits === 16 ? 8 : 0
    const pixels = width * height
    const rgba = new Uint8ClampedArray(pixels * 4)

    for (let i = 0; i < pixels; i++) {
      const src = i * channels
      const dst = i * 4
      rgba[dst] = data[src] >> shift
      rgba[dst + 1] = data[src + 1] >> shift
      rgba[dst + 2] = data[src + 2] >> shift
      rgba[dst + 3] = 255
    }

    const bitmap = await createImageBitmap(new ImageData(rgba, width, height))
    self.postMessage({ id, ok: true, bitmap }, [bitmap])
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : 'could not build the preview',
    })
  }
})
