import { useEffect, useState } from 'react'
import { useEditor } from '../edit-stack/store'
import type { UpscaleFactor } from '../edit-stack/types'
import { outputSize } from '../gpu/transform'
import { MAX_OUTPUT_PIXELS, MAX_WASM_INPUT_PIXELS, estimateSeconds, factorsFor } from '../../upscale/tiles'
import { isUpscaleModelCached, probeUpscaleBackend, upscaleBackend } from '../../upscale/upscale'

const FACTORS: UpscaleFactor[] = [1, 2, 4]

const mp = (w: number, h: number) => `${((w * h) / 1e6).toFixed(1)} MP`

/**
 * The last stage of the stack: super-resolution on the cropped picture, run
 * as soon as it is asked for so the viewport shows what the file will hold.
 * A panel rather than only the offer at the foot of the frame, so the factor
 * can be chosen, changed and cleared like any other setting — and chosen
 * after a crop, which is what makes a small crop of a large photo worth
 * upscaling at all.
 */
export function UpscaleTool() {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const update = useEditor((s) => s.update)
  const [backend, setBackend] = useState(() => upscaleBackend())
  const [cached, setCached] = useState<boolean | null>(null)

  useEffect(() => {
    let live = true
    void probeUpscaleBackend().then((b) => live && setBackend(b))
    void isUpscaleModelCached().then((c) => live && setCached(c))
    return () => {
      live = false
    }
  }, [])

  const meta = photo?.meta
  // Measured against what leaves the crop, not the file: that is what the
  // model will be handed.
  const out = meta ? outputSize(meta.width, meta.height, edits.crop) : null
  const allowed = out ? factorsFor(out.width, out.height, backend) : [1 as UpscaleFactor]
  const factor = edits.upscale

  const reason = (f: UpscaleFactor): string | undefined => {
    if (!out || f === 1 || allowed.includes(f)) return undefined
    if (!backend) return 'This browser cannot run the upscaler'
    if (backend === 'wasm' && out.width * out.height > MAX_WASM_INPUT_PIXELS) {
      return `Without WebGPU the upscaler is only offered up to ${mp(MAX_WASM_INPUT_PIXELS, 1)} of picture; this one is ${mp(out.width, out.height)}`
    }
    return `×${f} would be ${mp(out.width * f, out.height * f)}; the most a browser can hold is ${MAX_OUTPUT_PIXELS / 1e6} MP`
  }

  return (
    <div className="tool">
      <section className="tool__group">
        <header className="tool__group-head">
          <span>Factor</span>
          {out && (
            <span className="mono tool__note">
              {out.width * factor} × {out.height * factor}
            </span>
          )}
        </header>
        <div className="chips">
          {FACTORS.map((f) => (
            <button
              key={f}
              className="chip"
              data-active={factor === f || undefined}
              aria-pressed={factor === f}
              disabled={f !== factor && !allowed.includes(f)}
              title={reason(f)}
              onClick={() => update({ upscale: f }, 'upscale')}
            >
              {f === 1 ? 'None' : `×${f}`}
            </button>
          ))}
        </div>
        <p className="tool__hint">
          Runs on the cropped picture, right away, and the viewport shows the result. The crop
          and retouch tools show the photo as shot while they are open, and the upscale runs
          again when they close.
        </p>
        {!backend && <p className="tool__hint">This browser cannot run the upscaler.</p>}
        {backend && out && allowed.length === 1 && (
          <p className="tool__hint">
            Too large to upscale as it is: {reason(2)?.replace(/^×2 would be /, '×2 would be ')}. Crop
            it first.
          </p>
        )}
        {backend && out && factor > 1 && (
          <p className="tool__hint">
            {backend === 'webgpu' ? 'On your GPU, about' : 'On the CPU — no WebGPU in this browser — about'}{' '}
            {Math.round(estimateSeconds(out.width, out.height, backend))} s each time it runs.
            {cached === false && ' Downloads 32 MB the first time.'}
          </p>
        )}
      </section>
    </div>
  )
}
