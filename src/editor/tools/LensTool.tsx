import { useEffect, useMemo, useState } from 'react'
import { Slider, formatPlain } from '../../app/ui/Slider'
import { useEditor } from '../edit-stack/store'
import type { LensCorrectionState, LensProfileMode } from '../edit-stack/types'
import { lensIndexNow, loadLensIndex, mountsFor, searchLenses } from '../../lens/db'
import type { ResolvedLens } from '../../lens/resolve'
import { profileApplies } from '../../lens/uniforms'
import type { DbLensIndex, LensDbIndex } from '../../lens/types'

const MODES: { id: LensProfileMode; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Raw files; a camera JPEG is usually corrected already' },
  { id: 'on', label: 'Always', hint: 'Every file' },
  { id: 'off', label: 'Off', hint: 'Manual sliders only' },
]

const CORRECTIONS: { key: 'distortion' | 'tca' | 'vignetting'; amount: keyof LensCorrectionState; label: string }[] = [
  { key: 'distortion', amount: 'distortionAmount', label: 'Distortion' },
  { key: 'tca', amount: 'tcaAmount', label: 'Fringing' },
  { key: 'vignetting', amount: 'vignettingAmount', label: 'Vignetting' },
]

/** The lens's display name, the way the database would print it. */
function lensName(lens: DbLensIndex): string {
  const name = lens.name ?? lens.model
  return name.toLowerCase().startsWith(lens.maker.toLowerCase()) ? name : `${lens.maker} ${name}`
}

/** What the status line says: the match, or the one reason there is none. */
function status(profile: ResolvedLens | null, resolving: boolean, lensString: string | undefined): string {
  if (resolving && !profile) return 'Looking up…'
  if (!profile) return '—'
  if (profile.lens) {
    const parts = [lensName(profile.lens)]
    if (profile.camera) parts.push(profile.camera.model)
    const clamped = profile.distortion?.clamped || profile.tca?.clamped || profile.vignetting?.clamped
    if (clamped) parts.push('outside calibrated range')
    if (profile.reason === 'no-calibration') parts.push('no usable calibration')
    if (profile.reason === 'no-focal-length') parts.push('no focal length in the file')
    return parts.join(' · ')
  }
  switch (profile.reason) {
    case 'no-database':
      return 'Lens database unavailable'
    case 'no-lens-named':
      return 'No lens named in the file'
    case 'unknown-lens':
      return `${lensString ?? 'Lens'} — not in the database`
    default:
      return '—'
  }
}

export function LensTool() {
  const edits = useEditor((s) => s.edits)
  const update = useEditor((s) => s.update)
  const photo = useEditor((s) => s.photo)
  const profile = useEditor((s) => s.lensProfile)
  const resolving = useEditor((s) => s.lensResolving)
  const pickLens = useEditor((s) => s.pickLens)

  const perspective = edits.perspective
  const lens = edits.lens
  const correction = lens.correction

  const setPerspective = (patch: Partial<typeof perspective>, key: string) =>
    update({ perspective: { ...perspective, ...patch } }, key)
  const setLens = (patch: Partial<typeof lens>, key: string) =>
    update({ lens: { ...lens, ...patch } }, key)
  const setCorrection = (patch: Partial<LensCorrectionState>, key: string) =>
    setLens({ correction: { ...correction, ...patch } }, key)

  const isRaw = photo?.meta.isRaw ?? false
  const applies = profileApplies(lens, isRaw)
  const matched = profile?.lens ?? null
  const asksWhichLens = Boolean(profile && !profile.chosen && (profile.confidence === 'ambiguous' || !matched))
  // The picker is there when there is a question, and on request otherwise.
  const [changing, setChanging] = useState(false)
  useEffect(() => setChanging(false), [photo, profile?.lens?.id])

  return (
    <div className="tool">
      <div className="tool__columns">
        <section className="tool__group">
          <header className="tool__group-head">
            <span>Perspective</span>
          </header>
          <Slider
            label="Vertical"
            value={perspective.vertical}
            min={-100}
            max={100}
            onChange={(v) => setPerspective({ vertical: v }, 'persp-v')}
          />
          <Slider
            label="Horizontal"
            value={perspective.horizontal}
            min={-100}
            max={100}
            onChange={(v) => setPerspective({ horizontal: v }, 'persp-h')}
          />
          <Slider
            label="Aspect"
            value={perspective.aspect}
            min={-100}
            max={100}
            onChange={(v) => setPerspective({ aspect: v }, 'persp-aspect')}
          />
          <Slider
            label="Scale"
            value={perspective.scale}
            min={50}
            max={150}
            origin={100}
            resetTo={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => setPerspective({ scale: v }, 'persp-scale')}
          />
          <p className="tool__hint">
            Straightening converging verticals pulls the frame inward. Scale pushes it back
            out over the empty corners.
          </p>
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Lens profile</span>
            {resolving && <span className="spinner" aria-label="Looking up the lens" />}
          </header>
          <div className="segmented" role="group" aria-label="Lens profile">
            {MODES.map((m) => (
              <button
                key={m.id}
                className="segmented__item"
                data-active={correction.mode === m.id || undefined}
                aria-pressed={correction.mode === m.id}
                title={m.hint}
                onClick={() => setCorrection({ mode: m.id }, 'lens-mode')}
              >
                {m.label}
              </button>
            ))}
          </div>

          {correction.mode !== 'off' && (
            <>
              <p className="lens-status" data-confidence={profile?.confidence}>
                <span>{status(profile, resolving, photo?.meta.lens)}</span>
                {profile?.chosen ? (
                  <button className="link-button" onClick={() => pickLens(null, true)} title="Match automatically again">
                    Unpick
                  </button>
                ) : matched && !asksWhichLens ? (
                  <button className="link-button" onClick={() => setChanging((v) => !v)}>
                    Change
                  </button>
                ) : null}
              </p>

              {matched && applies && (
                <>
                  <div className="chips">
                    {CORRECTIONS.map((c) => (
                      <button
                        key={c.key}
                        className="chip"
                        data-active={correction[c.key] || undefined}
                        aria-pressed={correction[c.key]}
                        disabled={!profile?.[c.key]}
                        title={profile?.[c.key] ? undefined : 'Not calibrated for this lens'}
                        onClick={() => setCorrection({ [c.key]: !correction[c.key] }, `lens-${c.key}`)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  {CORRECTIONS.filter((c) => correction[c.key] && profile?.[c.key]).map((c) => (
                    <Slider
                      key={c.key}
                      label={c.label}
                      value={correction[c.amount] as number}
                      min={0}
                      max={200}
                      origin={0}
                      resetTo={100}
                      format={(v) => `${Math.round(v)}%`}
                      onChange={(v) => setCorrection({ [c.amount]: v }, `lens-${c.amount}`)}
                    />
                  ))}
                  <label className="mask-toggle">
                    <input
                      type="checkbox"
                      checked={correction.constrain}
                      onChange={(e) => setCorrection({ constrain: e.target.checked }, 'lens-constrain')}
                    />
                    <span>Constrain to image</span>
                  </label>
                </>
              )}

              {profile && (asksWhichLens || changing) && (
                <LensPicker profile={profile} ask={asksWhichLens} onPick={pickLens} />
              )}
            </>
          )}
        </section>

        <section className="tool__group">
          <header className="tool__group-head">
            <span>Optics</span>
          </header>
          <Slider
            label="Distortion"
            value={lens.distortion}
            min={-100}
            max={100}
            onChange={(v) => setLens({ distortion: v }, 'lens-distortion')}
          />
          <Slider
            label="Chromatic ab."
            value={lens.ca}
            min={-100}
            max={100}
            format={(v) => formatPlain(v)}
            onChange={(v) => setLens({ ca: v }, 'lens-ca')}
          />
        </section>
      </div>
    </div>
  )
}

/**
 * Choosing a lens by hand: the matcher's best guesses first, when it was not
 * sure, then a search over everything that fits the camera's mount.
 */
function LensPicker({
  profile,
  ask,
  onPick,
}: {
  profile: ResolvedLens
  ask: boolean
  onPick: (lensId: string | null, remember: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [remember, setRemember] = useState(true)
  const [db, setDb] = useState<LensDbIndex | null>(lensIndexNow())
  useEffect(() => {
    if (!db) void loadLensIndex().then((d) => setDb(d))
  }, [db])

  const mounts = useMemo(
    () => (db && profile.camera ? mountsFor(db, profile.camera.mount) : null),
    [db, profile.camera],
  )
  const results = useMemo(() => (db && query.trim() ? searchLenses(db, query, mounts) : []), [db, query, mounts])
  const suggestions = ask ? profile.candidates.slice(0, 4).map((c) => c.lens) : []

  return (
    <div className="lens-picker">
      {ask && suggestions.length > 0 && <span className="lens-picker__ask">Is this your lens?</span>}
      {suggestions.map((l) => (
        <button key={l.id} className="lens-picker__result" onClick={() => onPick(l.id, remember)}>
          {lensName(l)}
        </button>
      ))}
      <input
        className="lens-picker__search"
        type="search"
        placeholder={mounts ? `Search ${profile.camera?.mount} lenses` : 'Search lenses'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search lenses"
      />
      {results.map((l) => (
        <button key={l.id} className="lens-picker__result" onClick={() => { onPick(l.id, remember); setQuery('') }}>
          {lensName(l)}
        </button>
      ))}
      <label className="mask-toggle">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember for this lens</span>
      </label>
    </div>
  )
}
