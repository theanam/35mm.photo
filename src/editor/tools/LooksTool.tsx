import { useRef } from 'react'
import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor, useRenderEdits } from '../edit-stack/store'
import { LOOKS } from '../presets/looks'
import { useCustomLooks, useLooksCatalogue } from '../presets/catalogue'
import { INPUT_SPACES, inputSpaceDef, type InputSpace } from '../presets/inputSpace'
import { PRESET_ACCEPT } from '../presets/import'
import { pickPresetFiles } from '../../io/file-system'
import {
  LOOK_GROUPS,
  LOOK_GROUP_BLURB,
  LOOK_GROUP_LABEL,
  type LookConfig,
} from '../presets/types'
import { useLookPreviews } from './useLookPreviews'

type CanvasMap = React.MutableRefObject<Map<string, HTMLCanvasElement | null>>

export function LooksTool() {
  const edits = useEditor((s) => s.edits)
  // Swatches show each look on the picture as it is currently drawn.
  const renderEdits = useRenderEdits()
  const photo = useEditor((s) => s.photo)
  const applyLook = useEditor((s) => s.applyLook)
  const update = useEditor((s) => s.update)
  const importPresets = useEditor((s) => s.importPresets)
  const deletePreset = useEditor((s) => s.deletePreset)
  const setPresetInputSpace = useEditor((s) => s.setPresetInputSpace)

  const catalogue = useLooksCatalogue()
  const custom = useCustomLooks()

  const canvases: CanvasMap = useRef(new Map<string, HTMLCanvasElement | null>())
  useLookPreviews(catalogue, photo?.preview ?? null, photo?.meta.orientation ?? 1, renderEdits, canvases)

  const activeId = edits.look.id
  const active = catalogue.find((l) => l.id === activeId) ?? null
  const preset = active?.custom ?? null
  const parametric = preset?.kind === 'parametric'

  async function onImport() {
    const files = await pickPresetFiles(PRESET_ACCEPT)
    if (files.length) await importPresets(files)
  }

  return (
    <div className="tool">
      {/* Grouped by the kind of rendering rather than listed flat: with this
          many looks a single grid is a wall of thumbnails, and the thing you
          are actually choosing between is the character, not the name. */}
      {LOOK_GROUPS.map((group) => {
        const inGroup = LOOKS.filter((l) => l.group === group)
        if (!inGroup.length) return null

        return (
          <section key={group} className="looks__section">
            <header className="looks__section-head">
              <span className="looks__section-name">{LOOK_GROUP_LABEL[group]}</span>
              <span className="looks__section-note">{LOOK_GROUP_BLURB[group]}</span>
            </header>

            <div className="looks__grid">
              {/* "None" leads the first section: it is the top of the same
                  list, not a section of its own. */}
              {group === LOOK_GROUPS[0] && (
                <button
                  className="look"
                  data-active={activeId === null || undefined}
                  onClick={() => applyLook(null)}
                  title="No look — your adjustments only"
                >
                  <span className="look__swatch look__swatch--none" aria-hidden />
                  <span className="look__name">None</span>
                </button>
              )}

              {inGroup.map((look) => (
                <button
                  key={look.id}
                  className="look"
                  data-active={activeId === look.id || undefined}
                  onClick={() => applyLook(look.id)}
                  title={look.blurb}
                >
                  <Swatch look={look} canvases={canvases} />
                  <span className="look__name">{look.name}</span>
                </button>
              ))}
            </div>
          </section>
        )
      })}

      <section className="looks__custom">
        <header className="tool__group-head">
          <span>Your presets</span>
          <button className="link-button" onClick={onImport}>
            Import…
          </button>
        </header>

        {custom.length ? (
          <div className="looks__grid">
            {custom.map((look) => (
              <div
                key={look.id}
                className="look look--custom"
                data-active={activeId === look.id || undefined}
              >
                <button className="look__pick" onClick={() => applyLook(look.id)} title={look.blurb}>
                  <Swatch look={look} canvases={canvases} />
                  <span className="look__name">{look.name}</span>
                </button>
                <button
                  className="look__remove"
                  onClick={() => void deletePreset(look.id)}
                  aria-label={`Remove ${look.name}`}
                  title={`Remove ${look.name}`}
                >
                  ×
                </button>
                <span className="look__badge" aria-hidden>
                  {look.custom?.kind === 'lut' ? 'LUT' : 'LR'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="tool__hint">
            Bring in <strong>.cube</strong> LUTs, LUT images (HALD or strip <strong>.png</strong>),
            and Lightroom <strong>.xmp</strong> or <strong>.lrtemplate</strong> presets. They are
            read and stored in this browser — nothing is uploaded.
          </p>
        )}
      </section>

      <div className="tool__footer-row">
        <Slider
          label="Strength"
          value={edits.look.strength}
          min={0}
          max={100}
          origin={0}
          resetTo={100}
          disabled={!activeId || parametric}
          format={(v) => formatPlain(v)}
          onChange={(v) => update({ look: { ...edits.look, strength: v } }, 'look-strength')}
        />

        {preset?.kind === 'lut' && (
          <label className="field">
            <span className="field__label">Input</span>
            <select
              className="field__select"
              value={preset.inputSpace ?? 'srgb'}
              onChange={(e) => void setPresetInputSpace(preset.id, e.target.value as InputSpace)}
            >
              {INPUT_SPACES.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className="tool__hint tool__hint--inline">{hintFor(active)}</p>
      </div>
    </div>
  )
}

function Swatch({ look, canvases }: { look: LookConfig; canvases: CanvasMap }) {
  return (
    <span className="look__swatch">
      <canvas
        ref={(el) => {
          canvases.current.set(look.id, el)
        }}
        width={180}
        height={120}
      />
    </span>
  )
}

function hintFor(look: LookConfig | null): string {
  if (!look) return 'Pick a look to preview it on this photo.'

  const preset = look.custom
  if (!preset) return look.blurb

  if (preset.kind === 'lut') {
    // The input space is the one setting that decides whether an imported LUT
    // looks right at all, so its explanation is what the footer says.
    return `${inputSpaceDef(preset.inputSpace).blurb} From ${preset.filename}.`
  }

  const count = preset.edits ? Object.keys(preset.edits).length : 0
  const base = `Sets ${count} ${count === 1 ? 'value' : 'values'} you can keep editing in the other panels.`
  return preset.dropped?.length
    ? `${base} It also uses ${preset.dropped.join(', ')}, which 35mm has no equivalent for.`
    : base
}
