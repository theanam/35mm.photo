import { useEffect, useRef, useState } from 'react'
import { useEditor } from '../editor/edit-stack/store'
import { IconGitHub } from './ui/icons'
import * as db from '../storage/indexeddb'

export const REPO_URL = 'https://github.com/theanam/35mm.photo'
export const ISSUES_URL = `${REPO_URL}/issues`
export const FEEDBACK_EMAIL = 'anam.ahmed.a@gmail.com'

/**
 * Prefilled so a report arrives with the one detail that is hard to ask for
 * afterwards: which browser it happened in. Nothing about the photo is
 * included — it never leaves the tab, and neither should its name.
 */
function issueUrl(): string {
  const body = [
    '### What happened',
    '',
    '',
    '### What you expected',
    '',
    '',
    '### Browser',
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    '',
  ].join('\n')
  return `${ISSUES_URL}/new?body=${encodeURIComponent(body)}`
}

/**
 * The develop cache is the one thing here that grows on its own — about 20 MB
 * per raw — so it says how much it is holding and offers a way out. Everything
 * else in storage is either tiny or something the user put there deliberately.
 */
function DevelopCache() {
  const [size, setSize] = useState<{ count: number; bytes: number } | null>(null)

  useEffect(() => {
    void db.developCacheSize().then(setSize)
  }, [])

  if (!size?.count) return null

  return (
    <p className="modal__note">
      Developed raws cached for quick reopening: <strong>{size.count}</strong>{' '}
      {size.count === 1 ? 'photo' : 'photos'}, {(size.bytes / 1e6).toFixed(0)} MB.{' '}
      <button
        className="link-button"
        onClick={() => void db.clearDevelops().then(() => setSize({ count: 0, bytes: 0 }))}
      >
        Clear
      </button>
    </p>
  )
}

export function AboutDialog() {
  const open = useEditor((s) => s.aboutOpen)
  const setOpen = useEditor((s) => s.setAboutOpen)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="About 35mm">
      <div className="modal__scrim" onClick={() => setOpen(false)} />
      <div className="modal__panel" ref={panelRef} tabIndex={-1}>
        <header className="modal__header">
          <h2>About 35mm</h2>
          <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal__body">
          <p className="modal__note">
            A photo editor that runs entirely in your browser. Raw files are developed here in
            the tab, colour is graded on the GPU, and edits stay parametric — nothing is baked
            into pixels until you export. There is no backend and no account, so your photos
            are never uploaded anywhere.
          </p>

          <section className="about__section">
            <h3 className="about__label">Getting started</h3>
            <ul className="about__list">
              <li>Drop a photo anywhere on the window, or press <kbd>⌘O</kbd>.</li>
              <li>
                Adjustments live in the right rail; <kbd>C</kbd> crops, <kbd>\</kbd> shows
                before and after.
              </li>
              <li>
                Drop a <code>.cube</code>, <code>.xmp</code> or <code>.lrtemplate</code> to add
                your own looks and presets.
              </li>
              <li>
                <strong>Save edits</strong> writes a sidecar beside the photo;{' '}
                <strong>Export</strong> renders a new image.
              </li>
            </ul>
          </section>

          <section className="about__section">
            <h3 className="about__label">Found a bug, or want something?</h3>
            <div className="about__links">
              <a className="about__link" href={issueUrl()} target="_blank" rel="noreferrer noopener">
                <IconGitHub size={15} />
                <span>
                  Open an issue
                  <small>github.com/theanam/35mm.photo/issues</small>
                </span>
              </a>
              <a className="about__link" href={`mailto:${FEEDBACK_EMAIL}`}>
                <span className="about__at" aria-hidden>
                  @
                </span>
                <span>
                  Anything else
                  <small>{FEEDBACK_EMAIL}</small>
                </span>
              </a>
            </div>
          </section>

          <DevelopCache />

          <p className="modal__note">
            Raw development uses <a href="https://www.libraw.org/" target="_blank" rel="noreferrer noopener">LibRaw</a>,
            and HEIC uses <a href="https://github.com/strukturag/libheif" target="_blank" rel="noreferrer noopener">libheif</a>{' '}
            with libde265 — both compiled to WebAssembly, and both used under the{' '}
            <a href="https://www.gnu.org/licenses/lgpl-3.0.html" target="_blank" rel="noreferrer noopener">LGPL</a>.
            35mm itself is MIT. Source, licences and the full notices are on{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener">GitHub</a>.
          </p>
        </div>

        <footer className="modal__footer">
          <div className="modal__spacer" />
          <button className="button button--accent" onClick={() => setOpen(false)}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
