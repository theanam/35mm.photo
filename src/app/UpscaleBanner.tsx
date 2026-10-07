import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { outputSize } from '../editor/gpu/transform'
import { estimateSeconds, factorsFor, offerFor } from '../upscale/tiles'
import { isUpscaleModelCached, probeUpscaleBackend, upscaleBackend } from '../upscale/upscale'

/** Declined for this photo, for this session. Asking again on every click back would be nagging. */
const declined = new Set<string>()

/**
 * The offer to upscale a small photo, made once, at the bottom of the frame.
 *
 * Taking it sets the photo's upscale, which is an edit like any other: it is
 * saved with the photo, undone with ⌘Z, shown in the stack, and run — last,
 * on the cropped picture — right away, so the viewport shows the result. The
 * Upscale panel and the export dialog have the same control.
 */
export function UpscaleBanner() {
  const photo = useEditor((s) => s.photo)
  const upscale = useEditor((s) => s.edits.upscale)
  const crop = useEditor((s) => s.edits.crop)
  const loading = useEditor((s) => s.loading)
  const update = useEditor((s) => s.update)
  const [cached, setCached] = useState<boolean | null>(null)
  // The guess first, the probed truth once it is in: the two differ only on a
  // machine with WebGPU switched off, where the note about the CPU matters.
  const [backend, setBackend] = useState(() => upscaleBackend())
  useEffect(() => {
    let live = true
    void probeUpscaleBackend().then((b) => live && setBackend(b))
    return () => {
      live = false
    }
  }, [])
  // `declined` is not state; declining bumps this so the banner re-renders away.
  const [, setDeclinedAt] = useState(0)

  useEffect(() => {
    if (cached !== null) return
    let live = true
    void isUpscaleModelCached().then((yes) => live && setCached(yes))
    return () => {
      live = false
    }
  }, [cached])

  if (!photo || loading || upscale !== 1 || !backend) return null
  const frameId = photo.frameId
  if (declined.has(frameId)) return null

  // The crop is what the model is handed, so it is the crop that is measured.
  const { width, height } = outputSize(photo.meta.width, photo.meta.height, crop)
  const offer = offerFor(width, height, backend)
  if (!offer) return null
  const factors = factorsFor(width, height, backend).filter((f) => f > 1)

  const decline = () => {
    declined.add(frameId)
    setDeclinedAt(Date.now())
  }

  const seconds = Math.round(estimateSeconds(width, height, backend))
  const notes: string[] = []
  if (cached === false) notes.push(`downloads ${backend === 'webgpu' ? '33' : '19'} MB once`)
  if (backend === 'wasm') notes.push(`no WebGPU here, so about ${seconds} s`)

  return (
    <div className="upscale-banner" role="region" aria-label="Upscale this photo">
      <p className="upscale-banner__text">
        <strong className="mono">
          {width} × {height}
        </strong>{' '}
        is on the small side. Upscale it to{' '}
        <strong className="mono">
          {width * offer} × {height * offer}
        </strong>{' '}
        at ×{offer}.
        {notes.length > 0 && (
          <span className="upscale-banner__note">
            {' '}
            {notes.join(' · ').replace(/^./, (c) => c.toUpperCase())}.
          </span>
        )}
      </p>
      <div className="upscale-banner__actions">
        {factors
          .slice()
          .reverse()
          .map((f) => (
            <button
              key={f}
              className={f === offer ? 'button button--accent button--sm' : 'button button--sm'}
              onClick={() => update({ upscale: f }, 'upscale')}
            >
              Upscale ×{f}
            </button>
          ))}
        <button className="button button--sm" onClick={decline}>
          Not now
        </button>
      </div>
    </div>
  )
}
