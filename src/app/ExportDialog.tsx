import { useEffect, useRef, useState } from 'react'
import { useEditor, useRenderEdits } from '../editor/edit-stack/store'
import {
  canOverwriteOriginal,
  exportFilename,
  exportImage,
  formatOfFile,
  type ExportFormat,
} from '../io/export'
import { exportLayout } from '../editor/gpu/transform'
import { edgeForHeight, edgeForWidth } from '../io/export-size'
import { useIsPhone } from './phone/useLayoutMode'

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: 'jpeg', label: 'JPEG', note: 'smallest, no transparency' },
  { id: 'png', label: 'PNG', note: 'lossless, large' },
  { id: 'webp', label: 'WebP', note: 'small and lossless-capable' },
]

const SIZES: { id: string; label: string; maxEdge: number | null }[] = [
  { id: 'full', label: 'Full size', maxEdge: null },
  { id: '4096', label: 'Long edge 4096', maxEdge: 4096 },
  { id: '2048', label: 'Long edge 2048', maxEdge: 2048 },
  { id: '1080', label: 'Long edge 1080', maxEdge: 1080 },
]

/**
 * One side of a custom size: typed, committed on Enter or on leaving, shown as
 * what the file will actually be once the other side has had its say.
 */
function SideField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => setDraft(null), [value])
  const commit = () => {
    if (draft === null) return
    const n = Number(draft.trim())
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n)
  }
  return (
    <label className="size-link__side">
      <span className="size-link__label">{label[0]}</span>
      <input
        className="size-link__field mono"
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        aria-label={`${label} in pixels`}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); e.currentTarget.blur() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null); e.currentTarget.blur() }
        }}
      />
    </label>
  )
}

/** Two numbers held in one shape: the chain between them says so. */
function IconChain() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M6.8 9.2 9.2 6.8" />
      <path d="M7.2 4.6 8.6 3.2a2.6 2.6 0 0 1 3.7 3.7L10.9 8.3" />
      <path d="M8.8 11.4 7.4 12.8a2.6 2.6 0 0 1-3.7-3.7L5.1 7.7" />
    </svg>
  )
}

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen)
  const setOpen = useEditor((s) => s.setExportOpen)
  const settings = useEditor((s) => s.exportSettings)
  const setSettings = useEditor((s) => s.setExportSettings)
  const photo = useEditor((s) => s.photo)
  // A phone has no save dialog and a downloads folder nobody visits, so the
  // share sheet is what "save" means there.
  const phone = useIsPhone()
  // What is on screen is what gets written: a hidden edit stays out of the file.
  const edits = useRenderEdits()
  const toast = useEditor((s) => s.toast)

  const [busy, setBusy] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, setOpen])

  if (!open || !photo) return null

  // The numbers the file will actually have, mat included.
  const layout = exportLayout(
    photo.meta.width,
    photo.meta.height,
    edits.crop,
    edits.frame,
    settings.maxEdge,
  )
  const width = layout.width
  const height = layout.height

  // The file at full size, which is what a custom width or height is measured
  // against — and the size Custom starts from, so choosing it changes nothing
  // until a number is typed.
  const natural = exportLayout(photo.meta.width, photo.meta.height, edits.crop, edits.frame, null)
  const custom = settings.maxEdge !== null && !SIZES.some((s) => s.maxEdge === settings.maxEdge)

  // Writing back in place is only offered when the file's own extension names
  // the format being encoded. Nearly everything 35mm opens it cannot write —
  // every raw, HEIC, TIFF — and overwriting one of those would trade the
  // original for a JPEG wearing its name.
  const originalFormat = formatOfFile(photo.meta.name)
  const canOverwrite = canOverwriteOriginal(photo.meta.name, settings.format)
  const whyNot =
    originalFormat === null
      ? `35mm can open .${photo.meta.ext.toUpperCase()} but not write it, so the original has to be kept.`
      : `The original is ${originalFormat.toUpperCase()}. Choose ${originalFormat.toUpperCase()} to write over it in place.`

  const run = async (overwrite: boolean) => {
    setBusy('Preparing')
    try {
      // A photo restored from the develop cache holds preview pixels only, so
      // what gets written is always developed from the raw rather than from
      // whatever was convenient to keep.
      const source = photo.sourceIsPreview
        ? await useEditor.getState().ensureFullSource()
        : photo.source
      if (!source) {
        setBusy(null)
        return
      }

      const result = await exportImage({
        source,
        meta: photo.meta,
        edits,
        settings,
        sourceFile: photo.file,
        frameId: photo.frameId,
        preferShare: phone,
        overwriteHandle: overwrite ? photo.handle : undefined,
        onProgress: setBusy,
      })

      if (result.outcome === 'cancelled') {
        setBusy(null)
        return
      }
      // Says which of the three it did, because they end in different places
      // — and a share that quietly became a download is worth knowing about.
      const verb =
        result.outcome === 'shared' ? 'Shared' : result.outcome === 'saved' ? 'Saved' : 'Downloaded'
      toast(
        `${verb} ${result.filename} · ${result.width} × ${result.height} · ` +
          `${(result.bytes / 1024 / 1024).toFixed(1)} MB`,
      )
      setOpen(false)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export photo">
      <div className="modal__scrim" onClick={() => !busy && setOpen(false)} />
      <div className="modal__panel" ref={dialogRef} tabIndex={-1}>
        <header className="modal__header">
          <h2>Export</h2>
          <button className="icon-button" onClick={() => setOpen(false)} disabled={Boolean(busy)} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal__body">
          <div className="field">
            <span className="field__label">Format</span>
            <div className="chips">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className="chip"
                  data-active={settings.format === f.id || undefined}
                  onClick={() => setSettings({ format: f.id })}
                  title={f.note}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {settings.format !== 'png' && (
            <div className="field">
              <span className="field__label">
                Quality <span className="mono">{settings.quality}</span>
              </span>
              <input
                className="range"
                type="range"
                min={40}
                max={100}
                value={settings.quality}
                onChange={(e) => setSettings({ quality: Number(e.target.value) })}
              />
            </div>
          )}

          <div className="field">
            <span className="field__label">Size</span>
            <div className="chips">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  className="chip"
                  data-active={(!custom && settings.maxEdge === s.maxEdge) || undefined}
                  onClick={() => setSettings({ maxEdge: s.maxEdge })}
                >
                  {s.label}
                </button>
              ))}
              <button
                className="chip"
                data-active={custom || undefined}
                onClick={() => setSettings({ maxEdge: Math.max(natural.width, natural.height) })}
              >
                Custom
              </button>
            </div>
            {custom && (
              <div className="size-link" role="group" aria-label="Custom size" title="Width and height keep the picture's shape">
                <SideField
                  label="Width"
                  value={width}
                  onCommit={(n) => setSettings({ maxEdge: edgeForWidth(natural.width, natural.height, n) })}
                />
                <span className="size-link__chain">
                  <IconChain />
                </span>
                <SideField
                  label="Height"
                  value={height}
                  onCommit={(n) => setSettings({ maxEdge: edgeForHeight(natural.width, natural.height, n) })}
                />
                <span className="size-link__unit">px</span>
              </div>
            )}
          </div>

          <dl className="facts">
            <div>
              <dt>Output</dt>
              <dd className="mono">
                {width} × {height}
              </dd>
            </div>
            <div>
              <dt>Filename</dt>
              <dd className="mono">{exportFilename(photo.meta.name, settings.format)}</dd>
            </div>
          </dl>

          {photo.handle && !canOverwrite && <p className="modal__note">{whyNot}</p>}
        </div>

        <footer className="modal__footer">
          {photo.handle && (
            <button
              className="button"
              onClick={() => run(true)}
              disabled={Boolean(busy) || !canOverwrite}
              title={canOverwrite ? undefined : whyNot}
            >
              Overwrite original
            </button>
          )}
          <div className="modal__spacer" />
          <button className="button" onClick={() => setOpen(false)} disabled={Boolean(busy)}>
            Cancel
          </button>
          {/* Keeps its word and its width while it works. The stages behind
              this — preparing, finding the subject, rendering, encoding — are
              this app's business, not the reader's, and naming each one in turn
              resized the button under the pointer that had just pressed it. */}
          <button
            className="button button--accent"
            onClick={() => run(false)}
            disabled={Boolean(busy)}
            data-busy={busy || undefined}
          >
            {phone ? 'Share' : 'Export'}
            {busy && <span className="spinner" aria-label="Working" />}
          </button>
        </footer>
      </div>
    </div>
  )
}
