import { Slider } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { displaySize, insetCropForAngle, outputSize } from '../gpu/transform'

/** Aspect presets, in the design's order. `null` ratio means free-form. */
const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: 'free', label: 'Free', ratio: null },
]

export function CropTool() {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const updateCrop = useEditor((s) => s.updateCrop)

  const meta = photo?.meta
  const frame = meta ? displaySize(meta.width, meta.height, edits.crop.rotate90) : null
  const out = meta ? outputSize(meta.width, meta.height, edits.crop) : null

  const chooseAspect = (id: string) => {
    if (!frame) {
      updateCrop({ aspect: id }, 'crop-aspect')
      return
    }

    const preset = ASPECTS.find((a) => a.id === id)
    if (!preset || preset.ratio === null) {
      // "Original" and "Free" both release the lock; Original also resets the box.
      updateCrop(
        id === 'original' ? { aspect: id, x: 0, y: 0, w: 1, h: 1 } : { aspect: id },
        'crop-aspect',
      )
      return
    }

    const frameAspect = frame.width / frame.height
    // Largest centred box of the chosen ratio that fits the frame.
    const w = preset.ratio >= frameAspect ? 1 : preset.ratio / frameAspect
    const h = preset.ratio >= frameAspect ? frameAspect / preset.ratio : 1
    const inset = insetCropForAngle(1, 1, edits.crop.angle, preset.ratio / frameAspect)

    const finalW = Math.min(w, inset.w)
    const finalH = Math.min(h, inset.h)
    updateCrop(
      { aspect: id, w: finalW, h: finalH, x: (1 - finalW) / 2, y: (1 - finalH) / 2 },
      'crop-aspect',
    )
  }

  const setAngle = (angle: number) => {
    if (!frame) {
      updateCrop({ angle }, 'straighten')
      return
    }
    // Shrink the box just enough that straightening never exposes a corner.
    const boxAspect = (edits.crop.w * frame.width) / (edits.crop.h * frame.height)
    const inset = insetCropForAngle(1, 1, angle, boxAspect)
    const w = Math.min(edits.crop.w, inset.w)
    const h = Math.min(edits.crop.h, inset.h)
    updateCrop(
      {
        angle,
        w,
        h,
        x: clampInside(edits.crop.x + (edits.crop.w - w) / 2, w),
        y: clampInside(edits.crop.y + (edits.crop.h - h) / 2, h),
      },
      'straighten',
    )
  }

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Aspect</span>
            {out && (
              <span className="mono tool__note">
                {out.width} × {out.height}
              </span>
            )}
          </header>
          <div className="chips">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                className="chip"
                data-active={edits.crop.aspect === a.id || undefined}
                aria-pressed={edits.crop.aspect === a.id}
                onClick={() => chooseAspect(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="tool__hint">Drag the box or its handles directly on the photo.</p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Orientation</span>
          </header>
          <Slider
            label="Straighten"
            value={edits.crop.angle}
            min={-15}
            max={15}
            step={0.1}
            resetTo={0}
            format={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}°`}
            onChange={setAngle}
          />
          <div className="button-row">
            <button
              className="button button--toggle"
              onClick={() => updateCrop({ rotate90: (edits.crop.rotate90 + 3) % 4 }, 'rotate')}
            >
              Rotate left
            </button>
            <button
              className="button button--toggle"
              onClick={() => updateCrop({ rotate90: (edits.crop.rotate90 + 1) % 4 }, 'rotate')}
            >
              Rotate right
            </button>
            <button
              className="button button--toggle"
              data-on={edits.crop.flipH || undefined}
              aria-pressed={edits.crop.flipH}
              onClick={() => updateCrop({ flipH: !edits.crop.flipH }, 'flip')}
            >
              Flip H
            </button>
            <button
              className="button button--toggle"
              data-on={edits.crop.flipV || undefined}
              aria-pressed={edits.crop.flipV}
              onClick={() => updateCrop({ flipV: !edits.crop.flipV }, 'flip')}
            >
              Flip V
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function clampInside(v: number, size: number) {
  return Math.min(Math.max(v, 0), Math.max(0, 1 - size))
}
