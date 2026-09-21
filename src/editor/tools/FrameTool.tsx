import { useMemo } from 'react'
import { Slider } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import {
  FRAME_SIDES,
  type FrameLink,
  type FrameSide,
  type FrameState,
  type FrameUnit,
} from '../edit-stack/types'
import { frameLayout, outputSize, padToAspect } from '../gpu/transform'
import { FRAME_PRESETS } from '../presets/frames'

/** The box a preview is fitted inside, so a grid of them stays even. */
const PREVIEW_BOX = 74

/** How finely the percentage slider moves; the pixel one is matched to it. */
const PERCENT_STEP = 0.5

/**
 * The nearest round number at or below a raw increment — 1, 2, 5, 10, 20, 50…
 *
 * A pixel width dragged on a 147-point track over a range of a thousand-odd
 * lands wherever the arithmetic puts it: 8, 15, 23, 31. The percentage slider
 * next to it gives 0.5, 1.0, 1.5, because its step is a number a person chose.
 * This gives the pixel slider the same courtesy at the same granularity, so
 * dragging one after the other feels like one control in two units rather than
 * two controls that disagree.
 */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / magnitude
  const pick = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return Math.max(1, Math.round(pick * magnitude))
}

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

const UNITS: { id: FrameUnit; label: string; hint: string }[] = [
  { id: 'percent', label: '%', hint: 'A share of the picture\u2019s shorter edge' },
  { id: 'pixel', label: 'px', hint: 'Pixels of the exported file' },
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

  /** The shorter edge every percentage is measured against. */
  const short = photoSize ? Math.min(photoSize.width, photoSize.height) : 0

  /*
   * The two scales are one scale in two units: same floor, same ceiling, same
   * increments. A hundred percent of the shorter edge is the widest mat the
   * slider offers, and in pixels that is the shorter edge itself.
   */
  const nominalMax = frame.unit === 'pixel' ? Math.max(1, Math.round(short)) : 100
  /*
   * Except when the state already holds more. Padding a panorama out to a
   * square asks for more than the whole shorter edge, and a slider whose
   * maximum was below the value it is showing would strand the thumb at the end
   * and collapse the width on the next touch.
   */
  const widest = Math.max(frame.top, frame.right, frame.bottom, frame.left)
  const maxWidth = Math.max(nominalMax, Math.ceil(Number.isFinite(widest) ? widest : 0))

  const step =
    frame.unit === 'pixel' ? niceStep((PERCENT_STEP / 100) * short) : PERCENT_STEP
  const unitLabel = frame.unit === 'pixel' ? 'px' : '%'

  /**
   * Switch what the numbers count without changing what they draw.
   *
   * Converting rather than reinterpreting: 9 is a modest border as a percentage
   * and an invisible one as pixels, so carrying the digits across would silently
   * throw the mat away. Needs the picture's size to do it, so with no photo open
   * the unit is simply recorded.
   */
  const setUnit = (unit: FrameUnit) => {
    if (unit === frame.unit) return
    if (!short) {
      updateFrame({ unit }, 'frame-unit')
      return
    }
    const to = (v: number) =>
      unit === 'pixel'
        ? Math.round((v / 100) * short)
        : Math.round((v / short) * 1000) / 10
    updateFrame(
      { unit, top: to(frame.top), right: to(frame.right), bottom: to(frame.bottom), left: to(frame.left) },
      'frame-unit',
    )
  }

  /**
   * Write one side, and whichever others the link mode ties to it.
   *
   * The mode decides, not the numbers: four widths that happen to agree are
   * still four widths, and a panel that re-linked itself the moment they matched
   * would take the other three sliders away mid-edit.
   */
  const setSide = (side: FrameSide, value: number) => {
    const v = Math.max(0, Math.min(maxWidth, value))
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
    const pct = padToAspect(photoSize.width, photoSize.height, ratio)
    const sides =
      frame.unit === 'pixel'
        ? {
            top: Math.round((pct.top / 100) * short),
            right: Math.round((pct.right / 100) * short),
            bottom: Math.round((pct.bottom / 100) * short),
            left: Math.round((pct.left / 100) * short),
          }
        : pct
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

          <div className="frame-modes">
            <div className="segmented" role="group" aria-label="What the widths count">
              {UNITS.map((u) => (
                <button
                  key={u.id}
                  className="segmented__item"
                  data-active={frame.unit === u.id || undefined}
                  aria-pressed={frame.unit === u.id}
                  title={u.hint}
                  onClick={() => setUnit(u.id)}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>

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
              max={maxWidth}
              step={step}
              resetTo={0}
              editable
              unit={unitLabel}
              onChange={(v) => setSide('top', v)}
            />
          )}

          {frame.link === 'pairs' && (
            <>
              <Slider
                label="Top & bottom"
                value={frame.top}
                min={0} max={maxWidth} step={step} resetTo={0}
                editable unit={unitLabel}
                onChange={(v) => setSide('top', v)}
              />
              <Slider
                label="Left & right"
                value={frame.left}
                min={0} max={maxWidth} step={step} resetTo={0}
                editable unit={unitLabel}
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
                min={0} max={maxWidth} step={step} resetTo={0}
                editable unit={unitLabel}
                onChange={(v) => setSide(side, v)}
              />
            ))}

          <p className="tool__hint">
            {frame.unit === 'percent' ? (
              <>
                Each width is a share of the picture's <strong>shorter</strong> edge, so the same
                number reads the same on a portrait and a landscape — and on the export as on the
                screen.
              </>
            ) : (
              <>
                Each width is <strong>pixels of the exported file</strong>. A smaller export scales
                them down with the picture, so the border keeps its proportion rather than
                swallowing the photograph.
              </>
            )}
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
