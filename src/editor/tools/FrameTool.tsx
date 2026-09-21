import { useMemo } from 'react'
import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { FRAME_SIDES, type FrameLink, type FrameSide, type FrameState } from '../edit-stack/types'
import { frameLayout, outputSize, padToAspect } from '../gpu/transform'
import { FRAME_PRESETS } from '../presets/frames'

/** The box a preview is fitted inside, so a grid of them stays even. */
const PREVIEW_BOX = 74

/**
 * The picture in the mat, at the shape the file would have.
 *
 * No GPU: a mat is a flat colour around an untouched photograph, which is
 * something CSS can say exactly. The look swatches next door need a renderer
 * because a look changes the pixels; this only changes where they sit, so a
 * thumbnail behind a coloured box is not an approximation of the result — it
 * *is* the result, at a smaller size.
 *
 * The thumbnail is of the whole file, so a crop is shown by cropping to the
 * right shape rather than by moving to the right part of the picture. The
 * question a preset tile answers is how much mat and what shape, and it answers
 * that honestly.
 */
function FramePreview({
  frame,
  photo,
  thumbUrl,
}: {
  frame: FrameState
  photo: { width: number; height: number } | null
  thumbUrl?: string
}) {
  const layout = frameLayout(photo?.width ?? 3, photo?.height ?? 2, frame)
  const scale = Math.min(PREVIEW_BOX / layout.width, PREVIEW_BOX / layout.height)
  const pc = (part: number, whole: number) => `${(part / whole) * 100}%`

  return (
    <span className="frame-preview" aria-hidden>
      <span
        className="frame-preview__mat"
        style={{
          width: Math.max(8, Math.round(layout.width * scale)),
          height: Math.max(8, Math.round(layout.height * scale)),
          background: frame.color,
        }}
      >
        <span
          className="frame-preview__photo"
          style={{
            top: pc(layout.inset.top, layout.height),
            bottom: pc(layout.inset.bottom, layout.height),
            left: pc(layout.inset.left, layout.width),
            right: pc(layout.inset.right, layout.width),
            backgroundImage: thumbUrl ? `url(${thumbUrl})` : undefined,
          }}
        />
      </span>
    </span>
  )
}

/** How the link modes name themselves, and which sides each one drives together. */
const LINKS: { id: FrameLink; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'One width on every side' },
  { id: 'pairs', label: 'Pairs', hint: 'Top with bottom, left with right' },
  { id: 'free', label: 'Free', hint: 'Every side on its own' },
]

const ASPECTS: { id: string; label: string; ratio: number }[] = [
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
]

/**
 * Whether two frames would render the same.
 *
 * Compared by value rather than by remembering which preset was last clicked:
 * apply one and nudge a slider and it is no longer that preset, and a tile that
 * went on claiming otherwise would be lying about what is on screen. The link
 * mode is left out — it decides how the sliders behave, not how the mat looks.
 */
function sameFrame(a: FrameState, b: FrameState): boolean {
  return (
    Math.abs(a.top - b.top) < 0.05 &&
    Math.abs(a.right - b.right) < 0.05 &&
    Math.abs(a.bottom - b.bottom) < 0.05 &&
    Math.abs(a.left - b.left) < 0.05 &&
    a.color.toLowerCase() === b.color.toLowerCase()
  )
}

/** The colours a mat is actually cut from, before anyone reaches for a picker. */
const SWATCHES = ['#ffffff', '#f2efe9', '#808080', '#1a1a1a', '#000000']

export function FrameTool() {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const updateFrame = useEditor((s) => s.updateFrame)
  const framePresets = useEditor((s) => s.framePresets)
  const saveFramePreset = useEditor((s) => s.saveFramePreset)
  const deleteFramePreset = useEditor((s) => s.deleteFramePreset)

  const frame = edits.frame
  // The filmstrip already made this; the tiles just borrow it.
  const thumbUrl = useEditor((s) => s.frames.find((f) => f.id === s.activeFrameId)?.thumbUrl)

  /** The cropped picture — what the percentages are measured against. */
  const photoSize = useMemo(
    () => (photo ? outputSize(photo.meta.width, photo.meta.height, edits.crop) : null),
    [photo, edits.crop],
  )
  const layout = useMemo(
    () => (photoSize ? frameLayout(photoSize.width, photoSize.height, frame) : null),
    [photoSize, frame],
  )

  /**
   * Write one side, and whichever others the link mode ties to it.
   *
   * The mode decides, not the numbers: four widths that happen to agree are
   * still four widths, and a panel that re-linked itself the moment they matched
   * would take the other three sliders away mid-edit.
   */
  const setSide = (side: FrameSide, value: number) => {
    const v = Math.max(0, Math.min(100, value))
    if (frame.link === 'all') {
      updateFrame({ top: v, right: v, bottom: v, left: v }, 'frame-width')
      return
    }
    if (frame.link === 'pairs') {
      const vertical = side === 'top' || side === 'bottom'
      updateFrame(vertical ? { top: v, bottom: v } : { left: v, right: v }, `frame-${side}`)
      return
    }
    updateFrame({ [side]: v }, `frame-${side}`)
  }

  /**
   * Switching mode levels the sides it has just tied together, rather than
   * leaving one of a linked pair silently governing the other.
   */
  const setLink = (link: FrameLink) => {
    if (link === 'all') {
      const v = Math.max(frame.top, frame.right, frame.bottom, frame.left)
      updateFrame({ link, top: v, right: v, bottom: v, left: v }, 'frame-link')
      return
    }
    if (link === 'pairs') {
      const vertical = Math.max(frame.top, frame.bottom)
      const horizontal = Math.max(frame.left, frame.right)
      updateFrame(
        { link, top: vertical, bottom: vertical, left: horizontal, right: horizontal },
        'frame-link',
      )
      return
    }
    updateFrame({ link }, 'frame-link')
  }

  const pad = (ratio: number) => {
    if (!photoSize) return
    const sides = padToAspect(photoSize.width, photoSize.height, ratio)
    // Free, not pairs: a pad is two sides wide and two sides zero, and calling
    // that "pairs" would tie the zeroes together and hide the asymmetry.
    updateFrame({ ...sides, link: 'free' }, 'frame-pad')
  }

  const showEach = frame.link === 'free'

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Colour</span>
            <span className="mono tool__note">{frame.color}</span>
          </header>
          <div className="chips">
            {SWATCHES.map((hex) => (
              <button
                key={hex}
                className="chip chip--swatch"
                data-active={frame.color.toLowerCase() === hex || undefined}
                aria-label={`Frame colour ${hex}`}
                aria-pressed={frame.color.toLowerCase() === hex}
                style={{ ['--swatch' as string]: hex }}
                onClick={() => updateFrame({ color: hex }, 'frame-color')}
              />
            ))}
            {/* The one control here that has to be able to be anything. */}
            <label className="frame-picker" title="Pick any colour">
              <input
                type="color"
                value={frame.color}
                onChange={(e) => updateFrame({ color: e.target.value }, 'frame-color')}
                aria-label="Frame colour"
              />
              <span>Custom</span>
            </label>
          </div>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Width</span>
            {layout?.framed && (
              <span className="mono tool__note">
                {layout.width} × {layout.height}
              </span>
            )}
          </header>

          <div className="segmented" role="group" aria-label="Which sides move together">
            {LINKS.map((l) => (
              <button
                key={l.id}
                className="segmented__item"
                data-active={frame.link === l.id || undefined}
                aria-pressed={frame.link === l.id}
                title={l.hint}
                onClick={() => setLink(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>

          {frame.link === 'all' && (
            <Slider
              label="All sides"
              value={frame.top}
              min={0}
              max={100}
              step={0.5}
              resetTo={0}
              format={(v) => `${formatPlain(v, 0.5)}%`}
              onChange={(v) => setSide('top', v)}
            />
          )}

          {frame.link === 'pairs' && (
            <>
              <Slider
                label="Top & bottom"
                value={frame.top}
                min={0} max={100} step={0.5} resetTo={0}
                format={(v) => `${formatPlain(v, 0.5)}%`}
                onChange={(v) => setSide('top', v)}
              />
              <Slider
                label="Left & right"
                value={frame.left}
                min={0} max={100} step={0.5} resetTo={0}
                format={(v) => `${formatPlain(v, 0.5)}%`}
                onChange={(v) => setSide('left', v)}
              />
            </>
          )}

          {showEach &&
            FRAME_SIDES.map((side) => (
              <Slider
                key={side}
                label={side[0].toUpperCase() + side.slice(1)}
                value={frame[side]}
                min={0} max={100} step={0.5} resetTo={0}
                format={(v) => `${formatPlain(v, 0.5)}%`}
                onChange={(v) => setSide(side, v)}
              />
            ))}

          <p className="tool__hint">
            Each width is a share of the picture's <strong>shorter</strong> edge, so the same
            number reads the same on a portrait and a landscape — and on the export as on the
            screen.
          </p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Pad to</span>
          </header>
          <div className="chips">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                className="chip"
                disabled={!photoSize}
                onClick={() => pad(a.ratio)}
                title={`Widen the mat until the whole thing is ${a.label.toLowerCase()}`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="tool__hint">
            Works out the widths once and writes them down, so you can nudge them afterwards.
            They are not re-worked if the crop moves later.
          </p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Presets</span>
            <button
              className="link-button"
              disabled={!layout?.framed}
              onClick={() => {
                const name = window.prompt('Name this frame')?.trim()
                if (name) void saveFramePreset(name)
              }}
            >
              Save current…
            </button>
          </header>
          <div className="frame-grid">
            {FRAME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                className="frame-preset"
                data-active={sameFrame(preset.frame, frame) || undefined}
                aria-pressed={sameFrame(preset.frame, frame)}
                onClick={() => updateFrame(preset.frame, 'frame-preset')}
                title={preset.blurb}
              >
                <FramePreview frame={preset.frame} photo={photoSize} thumbUrl={thumbUrl} />
                <span className="frame-preset__name">{preset.name}</span>
              </button>
            ))}
          </div>

          {framePresets.length > 0 && (
            <>
              <header className="tool__group-head">
                <span>Saved</span>
              </header>
              <div className="frame-grid">
                {framePresets.map((preset) => (
                  <span
                    key={preset.id}
                    className="frame-preset frame-preset--saved"
                    data-active={sameFrame(preset.frame, frame) || undefined}
                  >
                    <button
                      className="frame-preset__pick"
                      onClick={() => updateFrame(preset.frame, 'frame-preset')}
                      title="Apply this saved frame"
                    >
                      <FramePreview frame={preset.frame} photo={photoSize} thumbUrl={thumbUrl} />
                      <span className="frame-preset__name">{preset.name}</span>
                    </button>
                    <button
                      className="frame-preset__remove"
                      onClick={() => void deleteFramePreset(preset.id)}
                      aria-label={`Delete the saved frame ${preset.name}`}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
