import { useEffect, useState } from 'react'
import { Slider } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { FILL_MODEL, isFillModelCached, onRetouchBusy } from '../../retouch/retouch'
import { IconCross, IconEye, IconEyeOff } from '../../app/ui/icons'
import { DEFAULT_BRUSH_SIZE, sizeToSlider, sliderToSize } from '../../retouch/brush'

export function RetouchTool() {
  const strokes = useEditor((s) => s.edits.retouch)
  const brush = useEditor((s) => s.retouchBrush)
  const smartFill = useEditor((s) => s.smartFill)
  const activeId = useEditor((s) => s.activeRetouchId)
  const planning = useEditor((s) => s.retouchPlanning)
  const setBrush = useEditor((s) => s.setRetouchBrush)
  const setSmartFill = useEditor((s) => s.setSmartFill)
  const update = useEditor((s) => s.update)
  const updateStroke = useEditor((s) => s.updateRetouchStroke)
  const removeStroke = useEditor((s) => s.removeRetouchStroke)
  const selectStroke = useEditor((s) => s.selectRetouchStroke)
  const fillLoading = useEditor((s) => s.fillLoading)
  const fillReady = useEditor((s) => s.fillReady)
  const loadFillModel = useEditor((s) => s.loadFillModel)
  const setFillReady = useEditor((s) => s.setFillReady)

  const [busy, setBusy] = useState(false)
  useEffect(() => onRetouchBusy(setBusy), [])

  // An installed app fetches the model on its own (see `pwa/prefetch.ts`);
  // if it is already here, there is nothing to offer.
  useEffect(() => {
    if (fillReady) return
    let live = true
    void isFillModelCached().then((yes) => live && yes && setFillReady())
    return () => {
      live = false
    }
  }, [fillReady, setFillReady])

  const filling = smartFill && fillReady

  const active = strokes.find((s) => s.id === activeId) ?? null

  return (
    <div className="tool">
      <div className="tool__columns tool__columns--masks">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Brush</span>
            {(busy || planning) && <span className="spinner retouch__spinner" aria-label="Healing" />}
          </header>
          <Slider
            label="Size"
            value={sizeToSlider(brush.size)}
            min={0}
            max={100}
            step={0.5}
            resetTo={sizeToSlider(DEFAULT_BRUSH_SIZE)}
            format={() => `${(brush.size * 100).toFixed(brush.size < 0.01 ? 2 : 1)}%`}
            onChange={(v) => setBrush({ size: sliderToSize(v) })}
          />
          <Slider
            label="Feather"
            value={brush.feather}
            min={0}
            max={100}
            resetTo={50}
            onChange={(v) => setBrush({ feather: v })}
          />
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Smart fill</span>
            {fillReady && (
              <label className="mask-toggle">
                <input type="checkbox" checked={smartFill} onChange={(e) => setSmartFill(e.target.checked)} />
                <span>On</span>
              </label>
            )}
          </header>
          <p className="tool__hint">
            Healing copies texture from nearby, which suits spots and dust. Where a stroke crosses an
            edge or covers an object, smart fill has a small AI model paint the area in instead. It
            runs on this device; nothing is uploaded.
          </p>
          {!fillReady && (
            <button
              className="button retouch__load"
              data-busy={fillLoading || undefined}
              disabled={fillLoading}
              onClick={() => void loadFillModel()}
            >
              Load model <span className="mono retouch__size">15 MB</span>
              {fillLoading && <span className="spinner" aria-label="Loading the model" />}
            </button>
          )}
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>
              Spots
            </span>
            {strokes.length > 0 && (
              <button
                className="link-button panel__reset"
                onClick={() => update({ retouch: [] }, `retouch-clear-${Date.now()}`)}
              >
                Reset
              </button>
            )}
          </header>

          {strokes.length === 0 && <p className="retouch__empty">Brush over a spot on the photo — it will be listed here.</p>}

          {strokes.length > 0 && (
            <ul className="mask-list">
              {strokes.map((stroke, i) => (
                <li key={stroke.id}>
                  <div className="mask-row" data-active={stroke.id === activeId || undefined}>
                    <button
                      className="mask-row__pick"
                      onClick={() => selectStroke(stroke.id === activeId ? null : stroke.id)}
                      aria-pressed={stroke.id === activeId}
                    >
                      <span className="mask-row__name">Spot {i + 1}</span>
                      <span className="mask-row__note">{stroke.mode === 'fill' ? 'fill' : 'heal'}</span>
                    </button>
                    <button
                      className="icon-button icon-button--quiet"
                      onClick={() =>
                        updateStroke(stroke.id, { enabled: !stroke.enabled }, `retouch-on-${stroke.id}`)
                      }
                      title={stroke.enabled ? 'Turn this spot off' : 'Turn this spot on'}
                      aria-label={stroke.enabled ? `Turn spot ${i + 1} off` : `Turn spot ${i + 1} on`}
                    >
                      {stroke.enabled ? <IconEye /> : <IconEyeOff />}
                    </button>
                    <button
                      className="icon-button icon-button--quiet"
                      onClick={() => removeStroke(stroke.id)}
                      title="Remove this spot"
                      aria-label={`Remove spot ${i + 1}`}
                    >
                      <IconCross />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {active && (
            <div className="segmented">
              <button
                className="segmented__item"
                data-active={active.mode === 'heal' || undefined}
                onClick={() => updateStroke(active.id, { mode: 'heal', model: undefined }, `retouch-mode-${active.id}`)}
              >
                Heal
              </button>
              <button
                className="segmented__item"
                data-active={active.mode === 'fill' || undefined}
                disabled={!filling}
                onClick={() => updateStroke(active.id, { mode: 'fill', model: FILL_MODEL }, `retouch-mode-${active.id}`)}
              >
                Fill
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
