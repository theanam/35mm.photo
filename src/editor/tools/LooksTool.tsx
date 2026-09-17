import { useRef } from 'react'
import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import { LOOKS } from '../presets/looks'
import { useLookPreviews } from './useLookPreviews'

export function LooksTool() {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const applyLook = useEditor((s) => s.applyLook)
  const update = useEditor((s) => s.update)

  const canvases = useRef(new Map<string, HTMLCanvasElement | null>())
  useLookPreviews(photo?.preview ?? null, photo?.meta.orientation ?? 1, edits, canvases)

  const activeId = edits.look.id
  const active = LOOKS.find((l) => l.id === activeId)

  return (
    <div className="tool">
      <div className="looks__grid">
        <button
          className="look"
          data-active={activeId === null || undefined}
          onClick={() => applyLook(null)}
          title="No look — your adjustments only"
        >
          <span className="look__swatch look__swatch--none" aria-hidden />
          <span className="look__name">None</span>
        </button>

        {LOOKS.map((look) => (
          <button
            key={look.id}
            className="look"
            data-active={activeId === look.id || undefined}
            onClick={() => applyLook(look.id)}
            title={look.blurb}
          >
            <span className="look__swatch">
              <canvas
                ref={(el) => {
                  canvases.current.set(look.id, el)
                }}
                width={132}
                height={86}
              />
            </span>
            <span className="look__name">{look.name}</span>
          </button>
        ))}
      </div>

      <div className="tool__footer-row">
        <Slider
          label="Strength"
          value={edits.look.strength}
          min={0}
          max={100}
          origin={0}
          resetTo={100}
          disabled={!activeId}
          format={(v) => formatPlain(v)}
          onChange={(v) => update({ look: { ...edits.look, strength: v } }, 'look-strength')}
        />
        <p className="tool__hint tool__hint--inline">
          {active ? active.blurb : 'Pick a look to preview it on this photo.'}
        </p>
      </div>
    </div>
  )
}
