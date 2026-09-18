import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { exportFilename, exportImage, type ExportFormat } from '../io/export'
import { outputSize } from '../editor/gpu/transform'

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

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen)
  const setOpen = useEditor((s) => s.setExportOpen)
  const settings = useEditor((s) => s.exportSettings)
  const setSettings = useEditor((s) => s.setExportSettings)
  const photo = useEditor((s) => s.photo)
  const edits = useEditor((s) => s.edits)
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

  const full = outputSize(photo.meta.width, photo.meta.height, edits.crop)
  const scale = settings.maxEdge ? Math.min(1, settings.maxEdge / Math.max(full.width, full.height)) : 1
  const width = Math.round(full.width * scale)
  const height = Math.round(full.height * scale)

  const run = async (overwrite: boolean) => {
    setBusy('Preparing')
    try {
      const result = await exportImage({
        source: photo.source,
        meta: photo.meta,
        edits,
        settings,
        sourceFile: photo.file,
        overwriteHandle: overwrite ? photo.handle : undefined,
        onProgress: setBusy,
      })

      if (result.outcome === 'cancelled') {
        setBusy(null)
        return
      }
      toast(
        `${result.filename} · ${result.width} × ${result.height} · ${(result.bytes / 1024 / 1024).toFixed(1)} MB`,
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
                  data-active={settings.maxEdge === s.maxEdge || undefined}
                  onClick={() => setSettings({ maxEdge: s.maxEdge })}
                >
                  {s.label}
                </button>
              ))}
            </div>
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

          <p className="modal__note">
            The full pipeline re-runs at this size — the export is rendered from the original file,
            not from what is on screen.
          </p>
        </div>

        <footer className="modal__footer">
          {photo.handle && (
            <button className="button" onClick={() => run(true)} disabled={Boolean(busy)}>
              Overwrite original
            </button>
          )}
          <div className="modal__spacer" />
          <button className="button" onClick={() => setOpen(false)} disabled={Boolean(busy)}>
            Cancel
          </button>
          <button className="button button--accent" onClick={() => run(false)} disabled={Boolean(busy)}>
            {busy ? `${busy}…` : 'Export'}
          </button>
        </footer>
      </div>
    </div>
  )
}
