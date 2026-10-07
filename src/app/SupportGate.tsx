import { useEffect, useRef, useState } from 'react'
import { inAppBrowser, isStandalone, systemBrowserUrl, type Essential } from './support'

const BROWSERS = 'the current Chrome, Edge, Firefox or Safari'
const DISMISSED_KEY = '35mm.inApp.dismissed'

/**
 * Shown instead of the editor when something it cannot run without is missing.
 *
 * It still offers a way in. The check is deliberately conservative — see
 * `support.ts` — but no check is perfect, and a wrong "no" is worse than a
 * broken viewport, which at least says what went wrong in its own words.
 */
export function Unsupported({ missing, onContinue }: { missing: Essential[]; onContinue: () => void }) {
  return (
    <main className="unsupported">
      <div className="unsupported__panel">
        <h1>This browser is missing something 35mm needs</h1>
        <p>
          35mm does all of its work in the browser tab — developing, grading and exporting on
          your own machine. That takes a few things this browser does not have:
        </p>
        <ul>
          {missing.map((m) => (
            <li key={m.id}>{m.label}</li>
          ))}
        </ul>
        <p>Any of {BROWSERS} has all of them. Updating this one may be enough.</p>
        <p className="unsupported__fine">
          If you are reading this inside another app — a link opened from Facebook, Instagram
          or a mail app — try opening the page in your browser instead.
        </p>
        <div className="unsupported__actions">
          <button className="button button--accent" onClick={onContinue}>
            Try anyway
          </button>
        </div>
      </div>
    </main>
  )
}

/**
 * A dismissable word of warning for a page opened inside another app's
 * browser, where saving an export, choosing a photo and keeping edits between
 * visits are all unreliable. Once per session: it is advice, not a wall.
 */
export function InAppBrowserDialog() {
  const [detected] = useState(() =>
    typeof navigator === 'undefined' ? null : inAppBrowser(navigator.userAgent, isStandalone()),
  )
  const [open, setOpen] = useState(() => {
    if (!detected) return false
    try {
      return sessionStorage.getItem(DISMISSED_KEY) !== '1'
    } catch {
      return true
    }
  })
  const [copied, setCopied] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Then it shows again next load; no harm.
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open || !detected) return null

  const href = window.location.href
  const openUrl = systemBrowserUrl(detected.platform, href)
  const browser = detected.platform === 'ios' ? 'Safari' : detected.platform === 'android' ? 'Chrome' : 'your browser'
  const menu = detected.platform === 'ios' ? '···' : '⋮'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
    } catch {
      // No clipboard in this web view: the address below is selectable.
      const field = panelRef.current?.querySelector<HTMLInputElement>('.inapp__address')
      field?.select()
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Open in your browser">
      <div className="modal__scrim" onClick={dismiss} />
      <div className="modal__panel" ref={panelRef} tabIndex={-1}>
        <header className="modal__header">
          <h2>You're in {detected.app}'s browser</h2>
          <button className="icon-button" onClick={dismiss} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal__body">
          <p className="modal__note">
            Apps open links in a built-in browser that is missing things 35mm relies on. In
            here, saving an exported photo often fails silently, the photo picker may not open,
            and edits may not be kept for next time. Everything works in {browser}.
          </p>

          <ol className="inapp__steps">
            <li>
              Tap <strong>{menu}</strong> at the {detected.platform === 'ios' ? 'bottom' : 'top'}{' '}
              right
            </li>
            <li>
              Choose <strong>Open in {browser}</strong>
              {detected.platform === 'android' && ' or Open in browser'}
            </li>
          </ol>

          <label className="inapp__copy">
            <span className="modal__note">Or copy the address and paste it into {browser}:</span>
            <input className="inapp__address mono" readOnly value={href} onFocus={(e) => e.target.select()} />
          </label>
        </div>

        <footer className="modal__footer">
          <button className="button" onClick={dismiss}>
            Continue here
          </button>
          <span className="modal__spacer" />
          <button className="button" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {openUrl && (
            <a className="button button--accent" href={openUrl}>
              Open in {browser}
            </a>
          )}
        </footer>
      </div>
    </div>
  )
}
