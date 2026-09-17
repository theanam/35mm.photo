import { useEffect, useRef } from 'react'
import { Renderer } from '../gpu/renderer'
import { getLut } from '../presets/lutCache'
import type { LookConfig } from '../presets/types'
import type { EditState } from '../edit-stack/types'
import { displaySize, uprightSize } from '../gpu/transform'
import type { Orientation } from '../../io/exif'

// 3:2, matching `.look__swatch`'s aspect-ratio, at roughly the rail's device
// pixels so the swatches are not resampled up.
const PREVIEW_W = 180
const PREVIEW_H = 120
const DEBOUNCE_MS = 260

/**
 * Renders every look onto the photo the user actually has open — the design's
 * "previewed on your photo". One hidden WebGL canvas does the whole grid and
 * blits each result into its swatch, so the panel costs one context, not one
 * per look, however many presets have been imported.
 */
export function useLookPreviews(
  looks: LookConfig[],
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
        scratchRef.current = document.createElement('canvas')
      }
      const scratch = scratchRef.current

      // The render graph maps the photo onto the whole viewport, so a buffer
      // that is not the photo's own shape stretches it. Render at the photo's
      // aspect ratio, scaled to *cover* the swatch, and crop to fit below.
      const upright = uprightSize(source.width, source.height, orientation)
      const display = displaySize(upright.width, upright.height, edits.crop.rotate90)
      const cover = Math.max(PREVIEW_W / display.width, PREVIEW_H / display.height)
      const bufferW = Math.max(PREVIEW_W, Math.round(display.width * cover))
      const bufferH = Math.max(PREVIEW_H, Math.round(display.height * cover))
      if (scratch.width !== bufferW) scratch.width = bufferW
      if (scratch.height !== bufferH) scratch.height = bufferH

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

      for (const look of looks) {
        if (cancelled) return
        const target = canvases.current.get(look.id)
        if (!target) continue

        // An imported Lightroom preset has no cube — it is slider values, so
        // the swatch previews it by applying them, exactly as clicking would.
        const parametric = look.custom?.kind === 'parametric' ? look.custom.edits : null

        const lut = parametric ? null : await getLut(look.id)
        if (cancelled) return
        renderer.setLut(lut)

        // Neutral finishing: a swatch should show the look's colour, not its grain.
        renderer.render(bufferW, bufferH, {
          edits: {
            ...edits,
            ...parametric,
            look: parametric
              ? { id: null, strength: 100 }
              : { id: look.id, strength: look.defaultStrength },
            grain: 0,
            vignette: 0,
            clarity: 0,
            sharpen: 0,
            denoiseLuma: 0,
            denoiseChroma: 0,
            crop: { ...edits.crop, x: 0, y: 0, w: 1, h: 1, angle: 0 },
          },
          look: parametric ? null : look,
        })

        const ctx = target.getContext('2d')
        if (!ctx) continue
        if (target.width !== PREVIEW_W) target.width = PREVIEW_W
        if (target.height !== PREVIEW_H) target.height = PREVIEW_H
        // Same task as the draw: a WebGL drawing buffer is cleared once the
        // browser composites, so this cannot be deferred.
        ctx.drawImage(
          scratch,
          (bufferW - PREVIEW_W) / 2,
          (bufferH - PREVIEW_H) / 2,
          PREVIEW_W,
          PREVIEW_H,
          0,
          0,
          PREVIEW_W,
          PREVIEW_H,
        )
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [looks, source, orientation, signature, canvases, edits])
}
