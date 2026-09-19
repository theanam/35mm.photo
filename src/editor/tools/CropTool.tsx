import { useEffect, useRef, useState } from 'react'
import { Slider } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { displaySize, outputSize } from '../gpu/transform'
import { formatAspect, parseAspectRatio } from '../edit-stack/aspect'
import { IconSwap } from '../../app/ui/icons'
import { isModelCached } from '../../subject/detect'

/** Aspect presets, in the design's order. The ratio comes from the id itself. */
const ASPECTS: { id: string; label: string }[] = [
  { id: '3:2', label: '3:2' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '16:9', label: '16:9' },
  { id: 'free', label: 'Free' },
]

export function CropTool() {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const updateCrop = useEditor((s) => s.updateCrop)
  const cropToSubject = useEditor((s) => s.cropToSubject)
  const detecting = useEditor((s) => s.detecting)

  /*
   * Offered only once the detector is already here. Cropping is not a reason to
   * pull several megabytes down — someone who wants that has the Masks tool,
   * which asks first. So this appears for people who have already said yes.
   */
  const [modelReady, setModelReady] = useState(false)
  useEffect(() => {
    let live = true
    void isModelCached().then((yes) => live && setModelReady(yes))
    return () => {
      live = false
    }
  }, [])

  const [customW, setCustomW] = useState('3')
  const [customH, setCustomH] = useState('2')

  /*
   * Custom is a mode of its own rather than "the ratio matches no preset".
   * Typing 3:2 into the fields lands on a ratio a preset already covers, and
   * deriving the mode from the value would bounce the highlight over to that
   * preset and take the fields away mid-edit.
   */
  const [customMode, setCustomMode] = useState(
    () => Boolean(edits.crop.aspect) && !ASPECTS.some((a) => a.id === edits.crop.aspect),
  )

  const meta = photo?.meta
  const frame = meta ? displaySize(meta.width, meta.height, edits.crop.rotate90) : null
  const out = meta ? outputSize(meta.width, meta.height, edits.crop) : null

  const chooseAspect = (id: string) => {
    if (!frame) {
      updateCrop({ aspect: id }, 'crop-aspect')
      return
    }

    const ratio = parseAspectRatio(id)
    if (ratio === null) {
      // "Original" and "Free" both release the lock; Original also resets the box.
      updateCrop(
        id === 'original' ? { aspect: id, x: 0, y: 0, w: 1, h: 1 } : { aspect: id },
        'crop-aspect',
      )
      return
    }

    const frameAspect = frame.width / frame.height
    // Largest centred box of the chosen ratio that fits the frame. The
    // straighten angle is not accounted for here on purpose: `effectiveCrop`
    // holds the box inside the rotated frame, and baking the inset in would
    // make the ratio picked at an angle stay small after straightening back.
    const w = ratio >= frameAspect ? 1 : ratio / frameAspect
    const h = ratio >= frameAspect ? frameAspect / ratio : 1

    updateCrop({ aspect: id, w, h, x: (1 - w) / 2, y: (1 - h) / 2 }, 'crop-aspect')
  }

  /**
   * Focus the width field when Custom is chosen — picking it is already a
   * statement that a number is coming.
   *
   * The field does not exist at the moment of the click, so this cannot be a
   * focus() in the handler, and an effect on the mode would also fire when the
   * tool opens on a crop that is already custom, stealing focus from nothing
   * the user did. Instead the click leaves a note, and the field claims focus
   * as it mounts.
   */
  const widthEl = useRef<HTMLInputElement | null>(null)
  const wantsFocus = useRef(false)

  const attachWidth = (el: HTMLInputElement | null) => {
    widthEl.current = el
    if (el && wantsFocus.current) {
      wantsFocus.current = false
      // Selected, not just focused: the value is being replaced, not appended.
      el.select()
    }
  }

  const enterCustom = () => {
    if (customMode) widthEl.current?.select()
    else wantsFocus.current = true
    setCustomMode(true)
    applyCustom(customW, customH)
  }

  /** Apply a typed ratio, ignoring the half-finished states of typing one. */
  const applyCustom = (w: string, h: string, swap = false) => {
    if (swap) {
      setCustomW(w)
      setCustomH(h)
    }
    const width = Number(w)
    const height = Number(h)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    chooseAspect(formatAspect(width, height))
  }

  /**
   * Straighten writes the angle and nothing else.
   *
   * Keeping the box inside the rotated frame is `effectiveCrop`'s job now. It
   * used to be done here, by shrinking the stored rect to fit — which could
   * only ever subtract, so straightening one way and back again ratcheted the
   * crop smaller every pass and there was no way to get the frame back.
   */
  const setAngle = (angle: number) => updateCrop({ angle }, 'straighten')

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
                data-active={(!customMode && edits.crop.aspect === a.id) || undefined}
                aria-pressed={!customMode && edits.crop.aspect === a.id}
                onClick={() => {
                  setCustomMode(false)
                  chooseAspect(a.id)
                }}
              >
                {a.label}
              </button>
            ))}
            <button
              className="chip"
              data-active={customMode || undefined}
              aria-pressed={customMode}
              onClick={enterCustom}
            >
              Custom
            </button>

            {/* Inline with the chips, at chip height: the fields are part of
                the same row of choices, not a panel that opens beneath it. */}
            {customMode && (
              <span className="aspect-custom">
                <input
                  ref={attachWidth}
                  className="aspect-custom__field mono"
                  type="number"
                  min="0.1"
                  step="any"
                  value={customW}
                  aria-label="Custom aspect width"
                  onChange={(e) => {
                    setCustomW(e.target.value)
                    applyCustom(e.target.value, customH)
                  }}
                />
                <span className="aspect-custom__colon" aria-hidden>
                  :
                </span>
                <input
                  className="aspect-custom__field mono"
                  type="number"
                  min="0.1"
                  step="any"
                  value={customH}
                  aria-label="Custom aspect height"
                  onChange={(e) => {
                    setCustomH(e.target.value)
                    applyCustom(customW, e.target.value)
                  }}
                />
                <button
                  className="aspect-custom__flip"
                  onClick={() => applyCustom(customH, customW, true)}
                  title="Swap width and height"
                  aria-label="Swap width and height"
                >
                  <IconSwap size={14} />
                </button>
              </span>
            )}
          </div>

          {modelReady && (
            <div className="button-row">
              <button
                className="button"
                onClick={() => void cropToSubject()}
                disabled={detecting}
                title="Fit the crop around whatever the photo is of"
              >
                {detecting ? 'Looking…' : 'Crop to subject'}
              </button>
            </div>
          )}

          <p className="tool__hint">
            Drag the box or its handles directly on the photo.
            {modelReady && ' Crop to subject fits the box around what the photo is of, keeping the aspect if one is locked.'}
          </p>
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

