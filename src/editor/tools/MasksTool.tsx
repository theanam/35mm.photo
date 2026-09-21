import { useEffect, useState } from 'react'
import { Slider, formatSigned } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import {
  MASK_KIND_LABEL,
  defaultGeometry,
  isColour,
  isLinear,
  isLuminance,
  isRadial,
  maskKindHint,
  maskSummary,
} from '../edit-stack/masks'
import { MAX_MASKS, type Mask, type MaskKind, type SubjectMask } from '../edit-stack/types'
import { cachedSubject, isModelCached } from '../../subject/detect'
import { IconCross, IconEye, IconEyeOff } from '../../app/ui/icons'

const KINDS: MaskKind[] = ['radial', 'linear', 'luminance', 'colour', 'subject']

/**
 * Local adjustments. The list on the left is the mask stack; everything to the
 * right belongs to whichever one is selected, because a mask with no selection
 * has no controls worth showing and a panel showing all of them at once would
 * be unreadable by the third mask.
 */
export function MasksTool() {
  const edits = useEditor((s) => s.edits)
  const photo = useEditor((s) => s.photo)
  const activeMaskId = useEditor((s) => s.activeMaskId)
  const maskOverlay = useEditor((s) => s.maskOverlay)
  const addMask = useEditor((s) => s.addMask)
  const removeMask = useEditor((s) => s.removeMask)
  const selectMask = useEditor((s) => s.selectMask)
  const updateMask = useEditor((s) => s.updateMask)
  const updateMaskAdjust = useEditor((s) => s.updateMaskAdjust)
  const setMaskOverlay = useEditor((s) => s.setMaskOverlay)

  const masks = edits.masks
  const mask = masks.find((m) => m.id === activeMaskId) ?? null
  const full = masks.length >= MAX_MASKS

  return (
    <div className="tool">
      <div className="tool__columns tool__columns--masks">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Masks</span>
            <label className="mask-toggle">
              <input
                type="checkbox"
                checked={maskOverlay}
                onChange={(e) => setMaskOverlay(e.target.checked)}
              />
              <span>Show overlay</span>
            </label>
          </header>

          {masks.length > 0 && (
            <ul className="mask-list">
              {masks.map((m) => (
                <li key={m.id}>
                  <div className="mask-row" data-active={m.id === activeMaskId || undefined}>
                    <button
                      className="mask-row__pick"
                      onClick={() => selectMask(m.id)}
                      aria-pressed={m.id === activeMaskId}
                    >
                      <span className="mask-row__name">{m.name}</span>
                      <span className="mask-row__note">{maskSummary(m)}</span>
                    </button>
                    <button
                      className="icon-button icon-button--quiet"
                      onClick={() => updateMask(m.id, { enabled: !m.enabled }, `mask-on-${m.id}`)}
                      title={m.enabled ? 'Turn this mask off' : 'Turn this mask on'}
                      aria-label={m.enabled ? 'Turn this mask off' : 'Turn this mask on'}
                    >
                      {m.enabled ? <IconEye /> : <IconEyeOff />}
                    </button>
                    <button
                      className="icon-button icon-button--quiet"
                      onClick={() => removeMask(m.id)}
                      title="Remove this mask"
                      aria-label={`Remove ${m.name}`}
                    >
                      <IconCross />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="chips">
            {KINDS.map((kind) => (
              <button
                key={kind}
                className="chip"
                onClick={() => addMask(kind)}
                disabled={full}
                title={full ? `${MAX_MASKS} masks is the limit` : maskKindHint(kind)}
              >
                + {MASK_KIND_LABEL[kind]}
              </button>
            ))}
          </div>

          {!masks.length && (
            <p className="tool__hint">
              A mask decides <strong>where</strong> an adjustment lands. Radial and linear
              are shapes you place on the picture; luminance and colour pick the picture out
              by what is already in it; subject finds what the photograph is of.
            </p>
          )}
        </section>

        {mask ? (
          <>
            <ShapeGroup mask={mask} />

            <section className="tool__group">
              <header className="tool__group-head">
                <span>Light</span>
              </header>
              <Slider
                label="Exposure"
                value={mask.adjust.exposure}
                min={-4}
                max={4}
                step={0.01}
                resetTo={0}
                format={(v) => formatSigned(v, 0.01)}
                onChange={(v) => updateMaskAdjust(mask.id, { exposure: v }, `mask-exp-${mask.id}`)}
              />
              <Slider
                label="Contrast"
                value={mask.adjust.contrast}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { contrast: v }, `mask-con-${mask.id}`)}
              />
              <Slider
                label="Highlights"
                value={mask.adjust.highlights}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { highlights: v }, `mask-hi-${mask.id}`)}
              />
              <Slider
                label="Shadows"
                value={mask.adjust.shadows}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { shadows: v }, `mask-sh-${mask.id}`)}
              />
              <Slider
                label="Whites"
                value={mask.adjust.whites}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { whites: v }, `mask-wh-${mask.id}`)}
              />
              <Slider
                label="Blacks"
                value={mask.adjust.blacks}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { blacks: v }, `mask-bl-${mask.id}`)}
              />
            </section>

            <section className="tool__group">
              <header className="tool__group-head">
                <span>Colour &amp; detail</span>
              </header>
              <Slider
                label="Warmth"
                value={mask.adjust.temperature}
                min={-100}
                max={100}
                trackGradient="linear-gradient(90deg,#3f5a86,#8a7a5e)"
                onChange={(v) => updateMaskAdjust(mask.id, { temperature: v }, `mask-temp-${mask.id}`)}
              />
              <Slider
                label="Tint"
                value={mask.adjust.tint}
                min={-100}
                max={100}
                trackGradient="linear-gradient(90deg,#4b7a4e,#8a5580)"
                onChange={(v) => updateMaskAdjust(mask.id, { tint: v }, `mask-tint-${mask.id}`)}
              />
              <Slider
                label="Saturation"
                value={mask.adjust.saturation}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { saturation: v }, `mask-sat-${mask.id}`)}
              />
              <Slider
                label="Clarity"
                value={mask.adjust.clarity}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { clarity: v }, `mask-cla-${mask.id}`)}
              />
              <Slider
                label="Texture"
                value={mask.adjust.texture}
                min={-100}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { texture: v }, `mask-tex-${mask.id}`)}
              />
              <Slider
                label="Sharpen"
                value={mask.adjust.sharpen}
                min={0}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { sharpen: v }, `mask-shp-${mask.id}`)}
              />
              <Slider
                label="Blur"
                value={mask.adjust.blur}
                min={0}
                max={100}
                onChange={(v) => updateMaskAdjust(mask.id, { blur: v }, `mask-blur-${mask.id}`)}
              />
            </section>
          </>
        ) : (
          masks.length > 0 && (
            <section className="tool__group">
              <p className="tool__hint">Pick a mask from the list to adjust it.</p>
            </section>
          )
        )}
      </div>

      {mask && (isRadial(mask) || isLinear(mask)) && (
        <p className="tool__hint">
          Drag the shape on the photo to move it{isRadial(mask) ? ', or its handles to resize' : ''}.
          The mask is anchored to the picture, so cropping or straightening afterwards carries it
          along.
          {photo && (
            <>
              {' '}
              <button
                className="link-button"
                onClick={() =>
                  updateMask(
                    mask.id,
                    defaultGeometry(mask, photo.meta.width / photo.meta.height),
                    `mask-recentre-${mask.id}`,
                  )
                }
              >
                Put it back in the middle
              </button>{' '}
              if you have dragged it out of the frame.
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** The controls that belong to the kind of mask this is. */
function ShapeGroup({ mask }: { mask: Mask }) {
  const updateMask = useEditor((s) => s.updateMask)

  return (
    <section className="tool__group">
      <header className="tool__group-head">
        <span>{MASK_KIND_LABEL[mask.kind]}</span>
        <label className="mask-toggle">
          <input
            type="checkbox"
            checked={mask.invert}
            onChange={(e) => updateMask(mask.id, { invert: e.target.checked }, `mask-inv-${mask.id}`)}
          />
          <span>Invert</span>
        </label>
      </header>

      <Slider
        label="Amount"
        value={mask.amount}
        min={0}
        max={100}
        resetTo={100}
        onChange={(v) => updateMask(mask.id, { amount: v }, `mask-amt-${mask.id}`)}
      />

      {/* A linear mask's feather is the distance between its two handles, so
          there is nothing here for a slider to do. */}
      {!isLinear(mask) && (
        <Slider
          label="Feather"
          value={mask.feather}
          min={0}
          max={100}
          resetTo={50}
          onChange={(v) => updateMask(mask.id, { feather: v }, `mask-fea-${mask.id}`)}
        />
      )}

      {mask.kind === 'subject' && <SubjectControls mask={mask} />}

      {isRadial(mask) && (
        <Slider
          label="Angle"
          value={mask.angle}
          min={-90}
          max={90}
          resetTo={0}
          format={(v) => `${formatSigned(v)}°`}
          onChange={(v) => updateMask(mask.id, { angle: v }, `mask-ang-${mask.id}`)}
        />
      )}

      {isLuminance(mask) && (
        <>
          <Slider
            label="From"
            value={mask.lo}
            min={0}
            max={100}
            origin={0}
            // Kept below the upper end: a window that has crossed itself selects
            // nothing, which looks like a broken mask rather than an empty one.
            onChange={(v) => updateMask(mask.id, { lo: Math.min(v, mask.hi - 1) }, `mask-lo-${mask.id}`)}
          />
          <Slider
            label="To"
            value={mask.hi}
            min={0}
            max={100}
            origin={0}
            onChange={(v) => updateMask(mask.id, { hi: Math.max(v, mask.lo + 1) }, `mask-hi-${mask.id}`)}
          />
        </>
      )}

      {isColour(mask) && (
        <>
          <Slider
            label="Hue"
            value={mask.hue}
            min={0}
            max={360}
            trackGradient="linear-gradient(90deg,#d44,#dd4,#4d4,#4dd,#44d,#d4d,#d44)"
            format={(v) => `${Math.round(v)}°`}
            onChange={(v) => updateMask(mask.id, { hue: v }, `mask-hue-${mask.id}`)}
          />
          <Slider
            label="Range"
            value={mask.width}
            min={1}
            max={100}
            origin={1}
            onChange={(v) => updateMask(mask.id, { width: v }, `mask-wid-${mask.id}`)}
          />
        </>
      )}

      <p className="tool__hint">{maskKindHint(mask.kind)}.</p>
    </section>
  )
}

/**
 * The detect button, and the one honest thing to say before it is pressed.
 *
 * The model and its runtime are about 8 MB, which is far more than the rest of
 * the app put together, so the first press is a download and not merely a wait.
 * That is the user's to agree to: the size is on the button until the fetch has
 * happened, and after that it says what it actually costs, which is a second.
 */
function SubjectControls({ mask }: { mask: SubjectMask }) {
  const detectSubjectMask = useEditor((s) => s.detectSubjectMask)
  const detecting = useEditor((s) => s.detecting)
  const activeFrameId = useEditor((s) => s.activeFrameId)
  const maskMapsAt = useEditor((s) => s.maskMapsAt)

  const [cached, setCached] = useState(false)
  useEffect(() => {
    let live = true
    void isModelCached().then((yes) => live && setCached(yes))
    return () => {
      live = false
    }
  }, [])

  // `maskMapsAt` is subscribed to purely so that finishing a detection
  // re-renders this: coverage lives outside the edit stack, so there is
  // nothing else here that changes when one is found.
  void maskMapsAt
  const found = Boolean(activeFrameId && cachedSubject(activeFrameId, mask.model))

  return (
    <div className="field">
      <button
        className="button"
        onClick={() => void detectSubjectMask(mask.id)}
        disabled={detecting || !activeFrameId}
        data-busy={detecting || undefined}
      >
        {found ? 'Find the subject again' : 'Find the subject'}
        {detecting && <span className="spinner" aria-label="Finding the subject" />}
      </button>
      <p className="tool__hint">
        {found
          ? 'Feather sets how hard the edge is held, not how far it is blurred — the edge itself comes from the picture.'
          : cached
            ? 'A second or so, on this machine, with nothing leaving it.'
            : 'Downloads about 8 MB the first time, then works offline. Nothing leaves your machine.'}
      </p>
    </div>
  )
}
