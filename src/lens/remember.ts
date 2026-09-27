/**
 * Lens choices the user has made, so the next photo from the same body with
 * the same lens string matches at once. Keyed by what the camera wrote, valued
 * by database id, and kept in this browser: it is a preference about this
 * person's bag, not a fact about any photo.
 */

const KEY = '35mm.lensChoices'

export function loadRemembered(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function rememberLens(key: string, lensId: string | null): void {
  const all = loadRemembered()
  if (lensId) all[key] = lensId
  else delete all[key]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage refused: the choice holds for this session through the edit state.
  }
}
