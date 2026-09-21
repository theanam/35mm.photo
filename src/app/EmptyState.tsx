import { useEffect, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { useIsPhone } from './phone/useLayoutMode'
import { ADVERTISED_FORMATS } from '../io/formats'
import { canOpenDirectories, pickDirectory, pickFiles } from '../io/file-system'
import * as db from '../storage/indexeddb'

export function EmptyState({ dragging }: { dragging: boolean }) {
  const recents = useEditor((s) => s.recents)
  const refreshRecents = useEditor((s) => s.refreshRecents)
  const clearRecents = useEditor((s) => s.clearRecents)
  const openFiles = useEditor((s) => s.openFiles)
  const phone = useIsPhone()
  const toast = useEditor((s) => s.toast)

  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  /*
   * Not on a phone — and not merely hidden there, not fetched.
   *
   * Reopening a recent needs the handle stored beside it, and a browser
   * without the File System Access API has none: every one of them falls
   * through to an apology and a file picker, which is a worse offer than not
   * making the offer. So the list is not shown, and the reads and object URLs
   * behind it do not happen either, on the device least able to spare them.
   */
  useEffect(() => {
    if (phone) return
    void refreshRecents()
  }, [refreshRecents, phone])

  useEffect(() => {
    if (phone) return
    let cancelled = false
    const urls: string[] = []

    void (async () => {
      const next: Record<string, string> = {}
      for (const recent of recents) {
        const blob = await db.loadThumb(recent.key)
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        urls.push(url)
        next[recent.key] = url
      }
      if (cancelled) {
        urls.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      setThumbs(next)
    })()

    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [recents, phone])

  /** Reopen from a stored handle, so a recent photo costs one permission click. */
  const reopen = async (key: string, name: string) => {
    const handle = await db.loadHandle(key)
    if (!handle) {
      toast(`Choose ${name} again — this browser cannot reopen it on its own`, 'error')
      void pickFiles().then(openFiles)
      return
    }

    try {
      const permission = await handle.requestPermission?.({ mode: 'read' })
      if (permission && permission !== 'granted') {
        toast('Permission declined', 'error')
        return
      }
      await openFiles([{ handle, file: await handle.getFile() }])
    } catch {
      toast(`${name} has moved or been renamed`, 'error')
    }
  }

  return (
    <div className="empty" data-dragging={dragging || undefined}>
      <div className="dropzone">
        {/* The arrow and the headline are both instructions to drag a file in,
            which is a gesture a phone does not have. There the button below is
            the only way in, so the copy points at it instead. */}
        {!phone && (
          <div className="dropzone__icon" aria-hidden>
            ↓
          </div>
        )}
        <div className="dropzone__copy">
          <h1>{phone ? 'Pick a photo to start' : 'Drop a photo to start'}</h1>
          <p>Raw development, GPU colour grading and export, right in this browser tab. Nothing to install.</p>
        </div>
        <div className="dropzone__actions">
          <button className="button button--accent button--lg" onClick={() => void pickFiles().then(openFiles)}>
            Choose photos…
          </button>
          <button
            className="button button--lg"
            onClick={() => void pickDirectory().then((files) => openFiles(files, { replace: true }))}
            title={canOpenDirectories() ? undefined : 'Your browser will ask for the files instead'}
          >
            Open a folder
          </button>
        </div>
        <span className="mono dropzone__formats">{ADVERTISED_FORMATS}</span>
      </div>

      {!phone && recents.length > 0 && (
        <section className="recents">
          <header className="recents__header">
            <span>Pick up where you left off</span>
            <button className="link-button" onClick={() => void clearRecents()}>
              Clear
            </button>
          </header>
          <ul className="recents__grid">
            {recents.map((recent) => (
              <li key={recent.key}>
                <button className="recent" onClick={() => void reopen(recent.key, recent.meta.name)}>
                  <span className="recent__thumb">
                    {thumbs[recent.key] ? <img src={thumbs[recent.key]} alt="" /> : null}
                  </span>
                  <span className="mono recent__name">{recent.meta.name}</span>
                  <span className="recent__meta">
                    {recent.editCount} edit{recent.editCount === 1 ? '' : 's'} · {relative(recent.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** Recents read better as "yesterday" than as a timestamp. */
function relative(timestamp: number): string {
  const seconds = (Date.now() - timestamp) / 1000
  if (seconds < 90) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  if (seconds < 172_800) return 'yesterday'
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)} days ago`
  if (seconds < 1_209_600) return 'last week'
  return new Date(timestamp).toLocaleDateString()
}
