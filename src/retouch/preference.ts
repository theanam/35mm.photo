/**
 * Smart fill, as this browser remembers it: whether the model has been loaded,
 * and whether it should be used.
 *
 * Two things, because they are two decisions. Loading the model is a download,
 * made once and then kept — the service worker holds the file, and this notes
 * that it was asked for, so the panel never offers the download again. Using
 * it is a preference that can be switched off and on at no cost afterwards.
 *
 * Read by the export as well as the editor: a file that filled where the
 * preview healed would be the app writing something other than what it showed.
 */

/** Bumped when the model or anything around it changes the answer. */
export const FILL_MODEL = 'migan@1'

const SMART_FILL_KEY = '35mm.smartFill'
const READY_KEY = '35mm.fillModel'

/** On unless switched off: loading the model was already the choice to use it. */
export function loadSmartFill(): boolean {
  try {
    return localStorage.getItem(SMART_FILL_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveSmartFill(on: boolean): void {
  try {
    localStorage.setItem(SMART_FILL_KEY, on ? '1' : '0')
  } catch {
    // The choice holds for this session.
  }
}

/** True once this model has been loaded in this browser. */
export function loadFillReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === FILL_MODEL
  } catch {
    return false
  }
}

export function saveFillReady(): void {
  try {
    localStorage.setItem(READY_KEY, FILL_MODEL)
  } catch {
    // Remembered for this session only; the panel will offer the load again.
  }
}

/** Whether a stroke may be filled right now: the model is here and wanted. */
export function fillEnabled(): boolean {
  return loadFillReady() && loadSmartFill()
}
