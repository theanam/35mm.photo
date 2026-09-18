import { useEditor } from '../edit-stack/store'
import type {
  DemosaicQuality,
  HighlightMode,
  RawNoiseReduction,
  WhiteBalanceBasis,
} from '../edit-stack/types'

/**
 * Raw development. These run in the decoder, before anything else in the app
 * sees a pixel, so changing one develops the file again rather than moving a
 * slider — which is why they are a set of discrete choices with a stated cost
 * rather than continuous controls.
 *
 * What is deliberately *not* here matters as much as what is. Exposure, white
 * balance and contrast all survive downstream, non-destructively, so they stay
 * downstream. Only the decisions the pipeline could never undo are offered
 * here: how the mosaic is interpolated, what happens to channels that clipped
 * before the file was written, and whether noise is dealt with before demosaic
 * or after.
 */

const WHITE_BALANCE: { id: WhiteBalanceBasis; label: string; note: string }[] = [
  { id: 'camera', label: 'As shot', note: 'the white balance the camera recorded' },
  { id: 'auto', label: 'Auto', note: 'let the decoder judge it from the frame' },
  { id: 'neutral', label: 'Neutral', note: 'the sensor’s own neutral, ignoring the camera' },
]

const DEMOSAIC: { id: DemosaicQuality; label: string; note: string }[] = [
  { id: 'fast', label: 'Fast', note: 'bilinear — quickest, softest' },
  { id: 'standard', label: 'Standard', note: 'AHD — the balance this app defaults to' },
  { id: 'best', label: 'Best', note: 'DHT, and three-pass for X-Trans — roughly twice the wait' },
]

const HIGHLIGHTS: { id: HighlightMode; label: string; note: string }[] = [
  { id: 'clip', label: 'Clip', note: 'leave blown channels blown' },
  { id: 'unclip', label: 'Keep', note: 'let them run past white rather than flattening' },
  { id: 'blend', label: 'Blend', note: 'mix in the channels that did not clip' },
  { id: 'rebuild', label: 'Rebuild', note: 'reconstruct colour from whatever survived' },
]

const NOISE: { id: RawNoiseReduction; label: string; note: string }[] = [
  { id: 'off', label: 'Off', note: 'leave it to the Detail panel' },
  { id: 'light', label: 'Light', note: 'FBDD, one pass' },
  { id: 'full', label: 'Full', note: 'FBDD, full — costs nothing measurable' },
]

export function RawTool() {
  const photo = useEditor((s) => s.photo)
  const raw = useEditor((s) => s.edits.raw)
  const loading = useEditor((s) => s.loading)
  const updateRawDevelop = useEditor((s) => s.updateRawDevelop)
  if (!photo) return null

  const { meta } = photo

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>As shot</span>
          </header>
          <dl className="facts">
            <div>
              <dt>Camera</dt>
              <dd>{meta.camera ?? '—'}</dd>
            </div>
            <div>
              <dt>Lens</dt>
              <dd>{meta.lens ?? '—'}</dd>
            </div>
            <div>
              <dt>ISO</dt>
              <dd>{meta.iso ?? '—'}</dd>
            </div>
            <div>
              <dt>Sensor</dt>
              <dd className="mono">
                {meta.width} × {meta.height}
              </dd>
            </div>
          </dl>
        </section>

        <Choice
          title="White balance"
          options={WHITE_BALANCE}
          value={raw.whiteBalance}
          disabled={loading}
          onPick={(whiteBalance) => updateRawDevelop({ whiteBalance })}
        />

        <Choice
          title="Demosaic"
          options={DEMOSAIC}
          value={raw.demosaic}
          disabled={loading}
          onPick={(demosaic) => updateRawDevelop({ demosaic })}
        />

        <Choice
          title="Highlights"
          options={HIGHLIGHTS}
          value={raw.highlights}
          disabled={loading}
          onPick={(highlights) => updateRawDevelop({ highlights })}
        />

        <Choice
          title="Noise reduction"
          options={NOISE}
          value={raw.noiseReduction}
          disabled={loading}
          onPick={(noiseReduction) => updateRawDevelop({ noiseReduction })}
        />

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Draft</span>
          </header>
          <label className="mask-toggle">
            <input
              type="checkbox"
              checked={raw.draft}
              disabled={loading}
              onChange={(e) => updateRawDevelop({ draft: e.target.checked })}
            />
            <span>Develop at half size</span>
          </label>
          <p className="tool__hint">
            About three times faster, at half the pixels. For working through a folder
            quickly — turn it off before exporting, or the export develops again at full
            size anyway.
          </p>
        </section>
      </div>

      <p className="tool__hint">
        These run in the decoder, so each change develops the file again. Everything else
        in the app works from the result and stays instant.
      </p>
    </div>
  )
}

function Choice<T extends string>({
  title,
  options,
  value,
  disabled,
  onPick,
}: {
  title: string
  options: { id: T; label: string; note: string }[]
  value: T
  disabled?: boolean
  onPick: (id: T) => void
}) {
  const active = options.find((o) => o.id === value)
  return (
    <section className="tool__group">
      <header className="tool__group-head">
        <span>{title}</span>
      </header>
      <div className="chips">
        {options.map((option) => (
          <button
            key={option.id}
            className="chip"
            data-active={option.id === value || undefined}
            disabled={disabled}
            onClick={() => onPick(option.id)}
            title={option.note}
          >
            {option.label}
          </button>
        ))}
      </div>
      {active && <p className="tool__hint">{active.note}.</p>}
    </section>
  )
}
