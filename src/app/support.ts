/**
 * Can this browser run 35mm, and is it one worth leaving?
 *
 * Two different questions with two different standards of proof.
 *
 * The first decides whether the editor loads at all, so it must never be wrong
 * about a browser that would have worked. It asks only whether the few things
 * the editor cannot do without *exist* — the constructors, not whether they
 * can be used right this second. Making a WebGL context to test for WebGL
 * would fail on a healthy browser with a blocklisted GPU, in a background tab
 * on some phones, or under a privacy setting, and each of those is a case for
 * the viewport's own error message, not for turning someone away at the door.
 * Everything else — WebAssembly for raws, the file system picker, service
 * workers — has a fallback or a graceful failure of its own and is not asked
 * about.
 *
 * The second is a hint. Facebook, Instagram and the rest open links in a
 * browser of their own, where saving a file, picking one and keeping edits
 * between visits are all unreliable. There is no feature to detect for that,
 * only the user agent string, which is enough for a dismissable suggestion
 * and would never be enough to block on.
 */

export interface Essential {
  id: string
  /** What it is for, in the user's terms. */
  label: string
  present: () => boolean
}

const has = (name: string) => () => {
  try {
    return typeof (globalThis as Record<string, unknown>)[name] !== 'undefined'
  } catch {
    return false
  }
}

export const ESSENTIALS: Essential[] = [
  {
    id: 'webgl2',
    label: 'WebGL 2, which draws every adjustment on your graphics card',
    present: has('WebGL2RenderingContext'),
  },
  {
    id: 'workers',
    label: 'Web Workers, which decode and develop photos off the main thread',
    present: has('Worker'),
  },
  {
    id: 'bitmap',
    label: 'createImageBitmap, which opens image files',
    present: () => typeof createImageBitmap === 'function',
  },
  {
    id: 'indexeddb',
    label: 'IndexedDB, which keeps your edits between visits',
    present: () => {
      try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null
      } catch {
        // Some privacy modes throw on the mere mention. That is a runtime
        // failure the storage layer already copes with, not a missing feature.
        return true
      }
    },
  },
]

/** The essentials this browser does not have, in the user's terms. */
export function missingEssentials(): Essential[] {
  return ESSENTIALS.filter((e) => !e.present())
}

/**
 * The small things a slightly older browser lacks that are cheaper to supply
 * than to turn anyone away for. `crypto.randomUUID` arrived in Safari 15.4;
 * `Array.prototype.at` the same release. Both are a few lines.
 */
export function polyfill(): void {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.getRandomValues === 'function' && typeof c.randomUUID !== 'function') {
    ;(c as { randomUUID?: () => string }).randomUUID = () => {
      const b = c.getRandomValues(new Uint8Array(16))
      b[6] = (b[6] & 0x0f) | 0x40
      b[8] = (b[8] & 0x3f) | 0x80
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    }
  }
  if (typeof Array.prototype.at !== 'function') {
    Object.defineProperty(Array.prototype, 'at', {
      value: function at(this: unknown[], n: number) {
        const i = Math.trunc(n) || 0
        const k = i < 0 ? this.length + i : i
        return k < 0 || k >= this.length ? undefined : this[k]
      },
      writable: true,
      configurable: true,
    })
  }
}

export interface InAppBrowser {
  /** The app, when it can be named; otherwise what the string gives away. */
  app: string
  platform: 'ios' | 'android' | 'other'
}

/** Apps whose built-in browser announces itself. First match wins. */
const KNOWN_APPS: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS/, 'Facebook'],
  [/Instagram/, 'Instagram'],
  [/Barcelona/, 'Threads'],
  [/\bLine\//, 'LINE'],
  [/Snapchat/, 'Snapchat'],
  [/musical_ly|TikTok|Bytedance/i, 'TikTok'],
  [/LinkedInApp/, 'LinkedIn'],
  [/Twitter/, 'X'],
  [/Pinterest/, 'Pinterest'],
  [/MicroMessenger/, 'WeChat'],
  [/\bGSA\//, 'the Google app'],
  [/\bReddit\//, 'Reddit'],
]

/**
 * Whether this looks like a page opened inside another app.
 *
 * `standalone` is the page installed to the home screen, which iOS reports
 * with the same stripped-down user agent as a web view: an installed 35mm is
 * the one place this must never fire.
 */
export function inAppBrowser(ua: string, standalone: boolean): InAppBrowser | null {
  if (standalone) return null
  const platform: InAppBrowser['platform'] = /iPhone|iPad|iPod/.test(ua)
    ? 'ios'
    : /Android/.test(ua)
      ? 'android'
      : 'other'

  for (const [pattern, app] of KNOWN_APPS) {
    if (pattern.test(ua)) return { app, platform }
  }

  // Android's WebView marks itself; Chrome, Firefox, Samsung Internet and the
  // rest do not carry the token.
  if (platform === 'android' && /\bwv\b/.test(ua)) return { app: 'an app', platform }

  // On iOS every real browser — Safari, Chrome, Firefox, Edge, Brave, Opera,
  // DuckDuckGo — ends its string with a "Safari/" token. A WKWebView does not.
  if (platform === 'ios' && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) {
    return { app: 'an app', platform }
  }

  return null
}

/** The page as it is shown now: installed to the home screen, or in a tab. */
export function isStandalone(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)')
        .matches
    )
  } catch {
    return false
  }
}

/**
 * A URL that asks the system browser to open this page, where one exists.
 * Android understands an intent URL from most web views; iOS has a Safari
 * scheme that some apps honour. Neither is guaranteed, which is why the
 * dialog also says how to do it by hand.
 */
export function systemBrowserUrl(platform: InAppBrowser['platform'], href: string): string | null {
  const url = new URL(href)
  if (url.protocol !== 'https:') return null
  const rest = `${url.host}${url.pathname}${url.search}${url.hash}`
  if (platform === 'android') {
    return `intent://${rest}#Intent;scheme=https;action=android.intent.action.VIEW;end`
  }
  if (platform === 'ios') return `x-safari-https://${rest}`
  return null
}
