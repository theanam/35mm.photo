import { useEffect, useRef } from 'react'
import { Renderer } from '../gpu/renderer'
import { getLut } from '../presets/lutCache'
import { LOOKS } from '../presets/looks'
import type { EditState } from '../edit-stack/types'
import type { Orientation } from '../../io/exif'

const PREVIEW_W = 132
const PREVIEW_H = 86
const DEBOUNCE_MS = 260

/**
 * Renders every look onto the photo the user actually has open — the design's
 * "previewed on your photo". One hidden WebGL canvas does all nine and blits
 * each result into its swatch, so the panel costs one context, not nine.
 */
export function useLookPreviews(
  source: ImageBitmap | null,
  orientation: Orientation,
  edits: EditState,
  canvases: React.MutableRefObject<Map<string, HTMLCanvasElement | null>>,
) {
  const rendererRef = useRef<Renderer | null>(null)
  const scratchRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    return () => {
      // The scratch canvas is dropped alongside it, so the context can go too.
      rendererRef.current?.dispose({ loseContext: true })
      rendererRef.current = null
      scratchRef.current = null
    }
  }, [])

  // Only the parts of the edit state that change how a look reads are worth
  // re-rendering for; a crop nudge or a grain tweak is not.
  const signature = [
    edits.exposure, edits.contrast, edits.highlights, edits.shadows,
    edits.whites, edits.blacks, edits.temperature, edits.tint,
    edits.vibrance, edits.saturation, edits.crop.rotate90,
  ].join(',')

  useEffect(() => {
    if (!source) return
    let cancelled = false

    const timer = setTimeout(async () => {
      if (cancelled) return

      if (!scratchRef.current) {
        const canvas = document.createElement('canvas')
        canvas.width = PREVIEW_W
        canvas.height = PREVIEW_H
        scratchRef.current = canvas
      }
      const scratch = scratchRef.current

      if (!rendererRef.current) {
        try {
          rendererRef.current = new Renderer(scratch)
        } catch (err) {
          console.warn('[35mm] look previews unavailable', err)
          return
        }
      }
      const renderer = rendererRef.current
      renderer.setImage(source, orientation)

      for (const look of LOOKS) {
        if (cancelled) return
        const target = canvases.current.get(look.id)
        if (!target) continue

        const lut = await getLut(look.id)
        if (cancelled) return
        renderer.setLut(lut)

        // Neutral finishing: a swatch should show the look's colour, not its grain.
        renderer.render(PREVIEW_W, PREVIEW_H, {
          edits: {
            ...edits,
            look: { id: look.id, strength: look.defaultStrength },
            grain: 0,
            vignette: 0,
            clarity: 0,
            sharpen: 0,
            denoiseLuma: 0,
            denoiseChroma: 0,
            crop: { ...edits.crop, x: 0, y: 0, w: 1, h: 1, angle: 0 },
          },
          look,
        })

        const ctx = target.getContext('2d')
        if (!ctx) continue
        target.width = PREVIEW_W
        target.height = PREVIEW_H
        // Same task as the draw: a WebGL drawing buffer is cleared once the
        // browser composites, so this cannot be deferred.
        ctx.drawImage(scratch, 0, 0)
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [source, orientation, signature, canvases, edits])
}
