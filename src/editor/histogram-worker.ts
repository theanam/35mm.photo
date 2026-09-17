/// <reference lib="webworker" />

/** Histogram binning, off the UI thread (spec §3.3, §4.2). */

export interface HistogramData {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  luma: Uint32Array
  /** Fraction of pixels at 0 and at 255, for the clipping indicators. */
  clippedShadows: number
  clippedHighlights: number
}

self.addEventListener('message', (event: MessageEvent) => {
  const { id, pixels } = event.data as { id: string; pixels: ArrayBuffer }
  const data = new Uint8ClampedArray(pixels)

  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  const luma = new Uint32Array(256)

  let shadows = 0
  let highlights = 0
  const count = data.length / 4

  for (let i = 0; i < data.length; i += 4) {
    const pr = data[i]
    const pg = data[i + 1]
    const pb = data[i + 2]
    r[pr]++
    g[pg]++
    b[pb]++
    luma[(0.2126 * pr + 0.7152 * pg + 0.0722 * pb) | 0]++

    if (pr === 0 && pg === 0 && pb === 0) shadows++
    if (pr === 255 || pg === 255 || pb === 255) highlights++
  }

  self.postMessage(
    {
      id,
      r,
      g,
      b,
      luma,
      clippedShadows: count ? shadows / count : 0,
      clippedHighlights: count ? highlights / count : 0,
    },
    [r.buffer, g.buffer, b.buffer, luma.buffer],
  )
})
