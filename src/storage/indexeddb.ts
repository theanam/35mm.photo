import type { EditState, ImageMeta } from '../editor/edit-stack/types'
import type { CustomPreset } from '../editor/presets/types'

/**
 * Local persistence (spec §4.4). Four stores: the edit state per photo, a
 * cached thumbnail so recents render instantly, the directory/file handles
 * needed to reopen a photo without a second picker prompt, and the presets the
 * user has imported.
 */

const DB_NAME = '35mm'
const DB_VERSION = 2
const STORE_EDITS = 'edits'
const STORE_THUMBS = 'thumbs'
const STORE_HANDLES = 'handles'
const STORE_PRESETS = 'presets'

export interface StoredEdit {
  /** Stable key derived from the file identity, not the object URL. */
  key: string
  meta: ImageMeta
  edits: EditState
  /** How many parameter groups differ from default — shown in the recents grid. */
  editCount: number
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_EDITS)) {
        const store = db.createObjectStore(STORE_EDITS, { keyPath: 'key' })
        store.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(STORE_THUMBS)) db.createObjectStore(STORE_THUMBS)
      if (!db.objectStoreNames.contains(STORE_HANDLES)) db.createObjectStore(STORE_HANDLES)
      if (!db.objectStoreNames.contains(STORE_PRESETS)) {
        db.createObjectStore(STORE_PRESETS, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      // Private windows and blocked site data both land here. Everything below
      // degrades to "this session only" rather than failing the app.
      console.warn('[35mm] IndexedDB unavailable; edits will not persist', request.error)
      resolve(null)
    }
  })

  return dbPromise
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        try {
          const transaction = db.transaction(store, mode)
          const request = fn(transaction.objectStore(store))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
        } catch (err) {
          console.warn(`[35mm] IndexedDB ${mode} on "${store}" failed`, err)
          resolve(null)
        }
      }),
  )
}

/**
 * Identity key for a photo. Name plus size plus mtime is stable across reopens
 * and cheap — hashing megabytes of pixels on every open is not.
 */
export function fileKey(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export async function saveEdits(record: StoredEdit): Promise<void> {
  await tx(STORE_EDITS, 'readwrite', (s) => s.put(record))
}

export async function loadEdits(key: string): Promise<StoredEdit | null> {
  return (await tx<StoredEdit>(STORE_EDITS, 'readonly', (s) => s.get(key))) ?? null
}

export async function deleteEdits(key: string): Promise<void> {
  await tx(STORE_EDITS, 'readwrite', (s) => s.delete(key))
  await tx(STORE_THUMBS, 'readwrite', (s) => s.delete(key))
  await tx(STORE_HANDLES, 'readwrite', (s) => s.delete(key))
}

export async function recentEdits(limit = 8): Promise<StoredEdit[]> {
  const all = await tx<StoredEdit[]>(STORE_EDITS, 'readonly', (s) => s.getAll())
  if (!all) return []
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

export async function clearRecents(): Promise<void> {
  await tx(STORE_EDITS, 'readwrite', (s) => s.clear())
  await tx(STORE_THUMBS, 'readwrite', (s) => s.clear())
  await tx(STORE_HANDLES, 'readwrite', (s) => s.clear())
}

export async function saveThumb(key: string, blob: Blob): Promise<void> {
  await tx(STORE_THUMBS, 'readwrite', (s) => s.put(blob, key))
}

export async function loadThumb(key: string): Promise<Blob | null> {
  return (await tx<Blob>(STORE_THUMBS, 'readonly', (s) => s.get(key))) ?? null
}

/**
 * File handles are structured-cloneable, so a recent photo can be reopened with
 * one permission prompt instead of a fresh file picker.
 */
export async function saveHandle(key: string, handle: FileSystemFileHandle): Promise<void> {
  await tx(STORE_HANDLES, 'readwrite', (s) => s.put(handle, key))
}

export async function loadHandle(key: string): Promise<FileSystemFileHandle | null> {
  return (await tx<FileSystemFileHandle>(STORE_HANDLES, 'readonly', (s) => s.get(key))) ?? null
}

/* ─────────────────────────── imported presets ─────────────────────────── */

/**
 * Imported LUTs and presets. The records go in whole: a `CustomPreset` holds a
 * `Float32Array`, which is structured-cloneable, so a 64³ cube round-trips
 * without a serialiser and without ever being turned into text.
 */
export async function savePreset(preset: CustomPreset): Promise<void> {
  await tx(STORE_PRESETS, 'readwrite', (s) => s.put(preset))
}

export async function loadPresets(): Promise<CustomPreset[]> {
  const all = await tx<CustomPreset[]>(STORE_PRESETS, 'readonly', (s) => s.getAll())
  if (!all) return []
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deletePreset(id: string): Promise<void> {
  await tx(STORE_PRESETS, 'readwrite', (s) => s.delete(id))
}
