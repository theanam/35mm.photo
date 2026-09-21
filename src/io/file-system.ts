import { isSupportedFile } from './formats'
import { ACCEPT_ATTRIBUTE } from './formats'

/**
 * File System Access API wrapper with a download/`<input>` fallback, so Safari
 * and Firefox get the same flows with a different last mile (spec §4.1).
 */

export interface OpenedFile {
  file: File
  /** Present only where the File System Access API is available; enables
   *  "save in place" and lets a session be reopened without re-picking. */
  handle?: FileSystemFileHandle
}

export const canUseFileSystemAccess = (): boolean =>
  typeof window !== 'undefined' && 'showOpenFilePicker' in window

export const canOpenDirectories = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function pickFiles(): Promise<OpenedFile[]> {
  if (canUseFileSystemAccess()) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Photos',
            accept: {
              'image/*': ACCEPT_ATTRIBUTE.split(',') as `.${string}`[],
            },
          },
        ],
      })
      return Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() })))
    } catch (err) {
      if (isAbort(err)) return []
      // Fall through — some browsers expose the API but reject in this context.
      console.warn('[35mm] file picker unavailable, using the input fallback', err)
    }
  }
  return pickFilesViaInput()
}

export async function pickDirectory(): Promise<OpenedFile[]> {
  if (!canOpenDirectories()) return pickFilesViaInput(true)

  try {
    const dir = await window.showDirectoryPicker()
    const out: OpenedFile[] = []
    for await (const entry of dir.values()) {
      if (entry.kind !== 'file') continue
      if (!isSupportedFile(entry.name)) continue
      const handle = entry as FileSystemFileHandle
      out.push({ handle, file: await handle.getFile() })
    }
    out.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
    return out
  } catch (err) {
    if (isAbort(err)) return []
    throw err
  }
}

/**
 * Pick LUT and preset files. Separate from `pickFiles` because the filter is a
 * different set of extensions and nothing here becomes a frame — the files are
 * parsed and thrown away, so no handle is kept.
 */
export async function pickPresetFiles(accept: string): Promise<File[]> {
  if (canUseFileSystemAccess()) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'LUTs and presets',
            accept: { '*/*': accept.split(',') as `.${string}`[] },
          },
        ],
      })
      return Promise.all(handles.map((handle) => handle.getFile()))
    } catch (err) {
      if (isAbort(err)) return []
      console.warn('[35mm] file picker unavailable, using the input fallback', err)
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept
    input.style.display = 'none'

    let settled = false
    const done = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => done(Array.from(input.files ?? [])))
    window.addEventListener('focus', () => setTimeout(() => done([]), 500), { once: true })

    document.body.append(input)
    input.click()
  })
}

/** `<input type="file">` fallback; `webkitdirectory` covers the folder case. */
function pickFilesViaInput(directory = false): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ACCEPT_ATTRIBUTE
    if (directory) input.webkitdirectory = true
    input.style.display = 'none'

    // Cancelling a file input fires nothing in older browsers; the focus
    // handler is the only reliable way to stop waiting forever.
    let settled = false
    const done = (files: OpenedFile[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
        .filter((f) => isSupportedFile(f.name))
        .map((file) => ({ file }))
      done(files)
    })
    window.addEventListener(
      'focus',
      () => setTimeout(() => done([]), 500),
      { once: true },
    )

    document.body.append(input)
    input.click()
  })
}

/**
 * Walks a drag-and-drop payload, including dropped folders. Everything found is
 * returned — a drop can legitimately carry photos, LUTs and presets at once, so
 * deciding what each file is belongs to the caller, not here.
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<OpenedFile[]> {
  const out: OpenedFile[] = []

  const items = Array.from(dt.items ?? []).filter((i) => i.kind === 'file')
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => Boolean(e))

  if (entries.length) {
    for (const entry of entries) await walkEntry(entry, out)
  } else {
    for (const file of Array.from(dt.files ?? [])) out.push({ file })
  }

  out.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
  return out
}

async function walkEntry(entry: FileSystemEntry, out: OpenedFile[], depth = 0) {
  if (depth > 4) return // dropped trees can be deep; one level of albums is plenty

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
    )
    if (file) out.push({ file })
    return
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    // readEntries returns at most 100 at a time; keep reading until it is empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      )
      if (!batch.length) break
      for (const child of batch) await walkEntry(child, out, depth + 1)
    }
  }
}

/**
 * Hand the file to the operating system's share sheet.
 *
 * What "save" has to mean on a phone. A download there lands in whatever the
 * browser calls its downloads folder, several taps from the camera roll and
 * invisible to everything else; the share sheet is the one place that offers
 * Save to Photos, and messages, and mail, and the file manager, all at once.
 *
 * Returns `unavailable` rather than throwing for anything that is not an
 * outright refusal by the person, so a caller can fall back to a download and
 * still put the file somewhere. That includes losing the user gesture: sharing
 * needs transient activation, and a full-resolution render can easily outlive
 * the tap that started it.
 */
export async function shareBlob(
  blob: Blob,
  filename: string,
  mimeType: string,
): Promise<'shared' | 'cancelled' | 'unavailable'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unavailable'
  }

  let file: File
  try {
    file = new File([blob], filename, { type: mimeType })
  } catch {
    return 'unavailable'
  }

  // Asked, not assumed: a browser can have `share` and still refuse files, and
  // sharing text where a photograph was meant is worse than a download.
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) {
    return 'unavailable'
  }

  try {
    await navigator.share({ files: [file] })
    return 'shared'
  } catch (err) {
    if (isAbort(err)) return 'cancelled'
    console.warn('[35mm] the share sheet refused the file; falling back to a download', err)
    return 'unavailable'
  }
}

/** Write a blob out, preferring a real save dialog, then a share, then a download. */
export async function saveBlob(
  blob: Blob,
  suggestedName: string,
  mimeType: string,
  extension: string,
  options: { preferShare?: boolean } = {},
): Promise<'saved' | 'shared' | 'downloaded' | 'cancelled'> {
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: extension.toUpperCase(), accept: { [mimeType]: [`.${extension}`] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (err) {
      if (isAbort(err)) return 'cancelled'
      console.warn('[35mm] save dialog failed, falling back to download', err)
    }
  }

  /*
   * After the save dialog, before the download. Where a save dialog exists it is
   * the better answer — it puts the file exactly where the person said — and
   * where it does not, this is tried before falling back to a download that a
   * phone would half-swallow.
   */
  if (options.preferShare) {
    const shared = await shareBlob(blob, suggestedName, mimeType)
    if (shared !== 'unavailable') return shared
  }

  downloadBlob(blob, suggestedName)
  return 'downloaded'
}

/** Overwrite the file the photo came from. Only possible with a handle. */
export async function writeToHandle(handle: FileSystemFileHandle, blob: Blob): Promise<boolean> {
  try {
    const permission = await handle.requestPermission?.({ mode: 'readwrite' })
    if (permission && permission !== 'granted') return false
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return true
  } catch (err) {
    console.warn('[35mm] could not write in place', err)
    return false
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
