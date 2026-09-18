import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { readExifSections, type ExifEntry, type ExifSection } from '../io/exif-tags'
import { IconCamera, IconExposure, IconFile, IconLens, IconPlace } from './ui/icons'

type IconComponent = ComponentType<{ size?: number }>

const SECTION: Record<ExifSection['id'], { title: string; Icon: IconComponent }> = {
  camera: { title: 'Camera', Icon: IconCamera },
  exposure: { title: 'Exposure', Icon: IconExposure },
  lens: { title: 'Lens', Icon: IconLens },
  place: { title: 'Place', Icon: IconPlace },
  file: { title: 'File', Icon: IconFile },
}

export function ExifDialog() {
  const open = useEditor((s) => s.exifOpen)
  const setOpen = useEditor((s) => s.setExifOpen)
  const photo = useEditor((s) => s.photo)
  const panelRef = useRef<HTMLDivElement>(null)

  const [sections, setSections] = useState<ExifSection[] | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  // Read on open rather than on decode: most photos are never asked about.
  useEffect(() => {
    if (!open || !photo) return
    let cancelled = false
    setSections(null)
    void readExifSections(photo.file)
      .then((found) => !cancelled && setSections(found))
      .catch(() => !cancelled && setSections([]))
    return () => {
      cancelled = true
    }
  }, [open, photo])

  if (!open || !photo) return null
  const meta = photo.meta

  /*
   * What the decoder already knows, shown when the file's own EXIF does not
   * cover it. A raw developed by LibRaw reports its camera and lens even when
   * the block a standard reader looks for is somewhere this one cannot follow —
   * RAF keeps its metadata inside a Fujifilm container — and it would be absurd
   * for the bottom bar to name the camera while this dialog said there was
   * nothing to show.
   */
  const known: ExifEntry[] = []
  if (meta.camera) known.push({ label: 'Camera', value: meta.camera })
  if (meta.lens) known.push({ label: 'Lens', value: meta.lens })
  if (meta.iso) known.push({ label: 'ISO', value: String(meta.iso) })
  if (meta.shotAt) {
    known.push({ label: 'Taken', value: new Date(meta.shotAt).toLocaleString() })
  }
  const hasParsedCamera = sections?.some((s) => s.id === 'camera') ?? false

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Photo information">
      <div className="modal__scrim" onClick={() => setOpen(false)} />
      <div className="modal__panel modal__panel--wide" ref={panelRef} tabIndex={-1}>
        <header className="modal__header">
          <h2>{meta.name}</h2>
          <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal__body">
          <section className="exif__section">
            <h3 className="exif__title">
              <IconFile />
              Photo
            </h3>
            <dl className="exif__list">
              <dt>Dimensions</dt>
              <dd className="mono">
                {meta.width} × {meta.height}
              </dd>
              <dt>Megapixels</dt>
              <dd className="mono">{((meta.width * meta.height) / 1_000_000).toFixed(1)}</dd>
              <dt>Format</dt>
              <dd className="mono">
                {meta.ext.toUpperCase()}
                {meta.isRaw ? ' · raw' : ''}
              </dd>
              <dt>Size on disk</dt>
              <dd className="mono">{formatBytes(meta.bytes)}</dd>
            </dl>
          </section>

          {!hasParsedCamera && known.length > 0 && (
            <section className="exif__section">
              <h3 className="exif__title">
                <IconCamera />
                Camera
              </h3>
              <dl className="exif__list">
                {known.map((entry) => (
                  <div key={entry.label} style={{ display: 'contents' }}>
                    <dt>{entry.label}</dt>
                    <dd className="mono">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {sections === null && <p className="modal__note">Reading…</p>}

          {sections?.map((section) => {
            const { title, Icon } = SECTION[section.id]
            return (
              <section key={section.id} className="exif__section">
                <h3 className="exif__title">
                  <Icon />
                  {title}
                </h3>
                <dl className="exif__list">
                  {section.entries.map((entry) => (
                    <div key={entry.label} style={{ display: 'contents' }}>
                      <dt>{entry.label}</dt>
                      <dd className="mono">{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )
          })}

          {sections?.length === 0 && (
            <p className="modal__note">
              {known.length > 0
                ? 'Everything above came from the decoder. This file keeps the rest of its metadata somewhere a standard EXIF reader cannot follow.'
                : meta.isRaw
                  ? 'No EXIF block was found in this file.'
                  : 'This file carries no EXIF data — it was most likely written by software that strips it.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** A 49 KB file is not "0.0 MB". Scale the unit to the number. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
