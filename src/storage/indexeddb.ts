import type { EditState, FrameState, ImageMeta } from '../editor/edit-stack/types'
import type { CustomPreset } from '../editor/presets/types'

/**
 * Local persistence (spec §4.4). Seven stores: the edit state per photo, a
 * cached thumbnail so recents render instantly, the directory/file handles
 * needed to reopen a photo without a second picker prompt, the presets the user
 * has imported, the frames they have saved, developed raw previews so returning
 * to a photo does not mean running LibRaw over it again, and the subject maps
 * the detector found so returning does not mean running the model again either.
 */

const DB_NAME = '35mm'
const DB_VERSION = 5
const STORE_EDITS = 'edits'
const STORE_THUMBS = 'thumbs'
const STORE_HANDLES = 'handles'
const STORE_PRESETS = 'presets'
const STORE_DEVELOP = 'develop'
const STORE_FRAME_PRESETS = 'framePresets'
const STORE_SUBJECTS = 'subjects'

/** A frame the user saved. Plain JSON — no typed arrays, no blobs. */
export interface StoredFramePreset {
  /** Namespaced the way custom looks are, so the two can never collide. */
  id: string
  name: string
  frame: FrameState
  createdAt: number
}

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

/**
 * How long to wait for the database before giving up on it for this session.
 *
 * The case this exists for is a version upgrade that another tab is blocking.
 * That fires `onblocked` and then simply never settles — the request stays
 * pending for as long as the other connection lives, which can be all day.
 */
const OPEN_TIMEOUT_MS = 3000

/** Set when the open was blocked, so the app can say why rather than hanging. */
let blockedByAnotherTab = false
let blockedReported = false

/** Set when this tab's build is older than the database on disk. */
let staleBuild = false
let staleReported = false

/**
 * True when storage gave up this session — the app is running, and not saving.
 * Read by the shell so it can say so out loud; the top bar otherwise promises
 * that edits are being kept.
 *
 * Reports once and then stops. React runs mount effects twice in development,
 * and the caller's job is to warn the user, not to warn them repeatedly.
 */
export function storageBlocked(): boolean {
  if (!blockedByAnotherTab || blockedReported) return false
  blockedReported = true
  return true
}

/**
 * True when another tab has already upgraded the database past what this build
 * knows how to open.
 *
 * The old tab keeps running and keeps accepting edits, and every one of them is
 * dropped — `openDb` settles to null once and stays that way for the session, by
 * design. Silently losing an afternoon's work is a worse outcome than any of the
 * ones that failure mode was written for, so it is worth saying out loud.
 * Reports once, like `storageBlocked`.
 */
export function storageStale(): boolean {
  if (!staleBuild || staleReported) return false
  staleReported = true
  return true
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    let settled = false

    /**
     * Resolving null is a decision for the whole session, deliberately.
     *
     * Retrying later would be worse than not persisting: a photo whose edits
     * failed to load opens on the defaults, and if a write then succeeded it
     * would put those defaults over the edits that were on disk all along.
     * Not writing at all cannot lose anyone's work.
     */
    const settle = (db: IDBDatabase | null) => {
      if (settled) return
      settled = true
      resolve(db)
    }

    // Without this the upgrade waits on the other connection indefinitely, and
    // so does everything behind it — which, since develop settings are read
    // before a raw is decoded, now includes opening a photo at all.
    const giveUp = setTimeout(() => {
      console.warn(
        '[35mm] IndexedDB did not open in time; this session will not persist edits',
      )
      settle(null)
    }, OPEN_TIMEOUT_MS)

    request.onblocked = () => {
      blockedByAnotherTab = true
      console.warn(
        '[35mm] another tab is holding an older version of the database open, ' +
          'so the upgrade cannot finish. Close it and reload.',
      )
    }

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
      if (!db.objectStoreNames.contains(STORE_FRAME_PRESETS)) {
        db.createObjectStore(STORE_FRAME_PRESETS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_DEVELOP)) {
        const store = db.createObjectStore(STORE_DEVELOP, { keyPath: 'key' })
        store.createIndex('usedAt', 'usedAt')
      }
      if (!db.objectStoreNames.contains(STORE_SUBJECTS)) {
        const store = db.createObjectStore(STORE_SUBJECTS, { keyPath: 'key' })
        store.createIndex('usedAt', 'usedAt')
      }
    }

    request.onsuccess = () => {
      clearTimeout(giveUp)
      const db = request.result
      // Step out of the way when another tab needs a newer version, rather than
      // blocking it the way this tab was just blocked. This is what stops the
      // next schema change repeating the problem.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      settle(db)
    }

    request.onerror = () => {
      clearTimeout(giveUp)
      /*
       * A database newer than this build — another tab upgraded it underneath
       * us. Separated from the rest because it is recoverable, reloading picks
       * up the new build, and because it lands in a tab that has been open and
       * editing and therefore has something to lose.
       */
      if (request.error?.name === 'VersionError') {
        staleBuild = true
        console.warn('[35mm] this tab is older than the stored database; reload to keep saving')
        settle(null)
        return
      }
      // Private windows and blocked site data both land here. Everything below
      // degrades to "this session only" rather than failing the app.
      console.warn('[35mm] IndexedDB unavailable; edits will not persist', request.error)
      settle(null)
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
  await tx(STORE_DEVELOP, 'readwrite', (s) => s.clear())
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

/* ─────────────────────────── frame presets ─────────────────────────── */

/**
 * A store of their own rather than a `kind` beside the look presets: every
 * record in `presets` is read back through the look catalogue, so a frame
 * sitting in there would appear in the Looks grid as a broken swatch — and would
 * do so in builds that predate this one and cannot be fixed.
 */
export async function saveFramePreset(preset: StoredFramePreset): Promise<void> {
  await tx(STORE_FRAME_PRESETS, 'readwrite', (s) => s.put(preset))
}

export async function loadFramePresets(): Promise<StoredFramePreset[]> {
  const all = await tx<StoredFramePreset[]>(STORE_FRAME_PRESETS, 'readonly', (s) => s.getAll())
  if (!all) return []
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteFramePreset(id: string): Promise<void> {
  await tx(STORE_FRAME_PRESETS, 'readwrite', (s) => s.delete(id))
}

/* ─────────────────────── developed raw previews ─────────────────────── */

/**
 * One developed raw, at preview resolution, kept so that coming back to a photo
 * does not mean running LibRaw over it a second time.
 *
 * Stored as a PNG rather than the pixels themselves or a WebP. Measured on a
 * 12.6 MP preview: raw RGBA is 50 MB, lossless WebP is 10 MB but takes 2.4 s to
 * encode — over half the develop it is meant to save — and WebP at quality 0.92
 * is 0.3 MB but moves pixels by up to 60 levels, which is not something to put
 * under a photograph someone is grading. PNG is lossless, encodes in 260 ms and
 * decodes in about 110 ms against a 4.4 s develop.
 */
export interface StoredDevelop {
  /** `<fileKey>@<develop fingerprint>` — settings are part of the identity. */
  key: string
  /** The developed preview, PNG-encoded. */
  blob: Blob
  width: number
  height: number
  /** Everything the decoder reported, so a hit needs no second read. */
  meta: ImageMeta
  bytes: number
  usedAt: number
}

/** Entries to keep. Fifteen previews is roughly 260 MB at 12 MP apiece. */
export const MAX_DEVELOPS = 15
/** And a ceiling in bytes, for the larger sensors. */
export const MAX_DEVELOP_BYTES = 600_000_000

/**
 * Which cached develops to drop, oldest first.
 *
 * Pure, and separate from the store it runs against, because the interesting
 * part is the policy rather than the plumbing: it has to bound both the count
 * and the bytes, and it must never evict the entry that was just written —
 * which is exactly what a naive "drop the oldest" does on a machine where one
 * frame is bigger than the whole budget.
 */
export function developEvictionPlan(
  records: { key: string; bytes: number; usedAt: number }[],
  keep: string | null = null,
  limits: { maxEntries?: number; maxBytes?: number } = {},
): string[] {
  const maxEntries = limits.maxEntries ?? MAX_DEVELOPS
  const maxBytes = limits.maxBytes ?? MAX_DEVELOP_BYTES

  // The protected entry takes its share of the budget before anything else is
  // measured. Letting it ride along afterwards instead would put the cache over
  // its ceiling by a whole frame every time one was written.
  const held = keep ? records.find((r) => r.key === keep) : undefined
  let bytes = held?.bytes ?? 0
  let kept = held ? 1 : 0

  // Newest first; anything past the limits falls off the end.
  const ordered = [...records].sort((a, b) => b.usedAt - a.usedAt)
  const drop: string[] = []

  for (const record of ordered) {
    if (record.key === keep) continue
    if (kept < maxEntries && bytes + record.bytes <= maxBytes) {
      kept++
      bytes += record.bytes
    } else {
      drop.push(record.key)
    }
  }
  return drop
}

export async function loadDevelop(key: string): Promise<StoredDevelop | null> {
  const record = await tx<StoredDevelop>(STORE_DEVELOP, 'readonly', (s) => s.get(key))
  if (!record) return null
  // Touch it so the eviction order reflects use rather than creation.
  void tx(STORE_DEVELOP, 'readwrite', (s) => s.put({ ...record, usedAt: Date.now() }))
  return record
}

export async function saveDevelop(
  record: Omit<StoredDevelop, 'bytes' | 'usedAt'>,
): Promise<void> {
  const full: StoredDevelop = { ...record, bytes: record.blob.size, usedAt: Date.now() }
  await tx(STORE_DEVELOP, 'readwrite', (s) => s.put(full))

  const all = await tx<StoredDevelop[]>(STORE_DEVELOP, 'readonly', (s) => s.getAll())
  if (!all) return
  for (const key of developEvictionPlan(all, full.key)) {
    await tx(STORE_DEVELOP, 'readwrite', (s) => s.delete(key))
  }
}

export async function clearDevelops(): Promise<void> {
  await tx(STORE_DEVELOP, 'readwrite', (s) => s.clear())
}

/** Bytes currently held by cached develops, for the panel to report. */
export async function developCacheSize(): Promise<{ count: number; bytes: number }> {
  const all = await tx<StoredDevelop[]>(STORE_DEVELOP, 'readonly', (s) => s.getAll())
  if (!all) return { count: 0, bytes: 0 }
  return { count: all.length, bytes: all.reduce((n, r) => n + r.bytes, 0) }
}

/* ───────────────────────── subject maps ───────────────────────── */

/**
 * A subject map the detector found, kept the way a developed raw is: derived
 * from the file, keyed by the file and the model that read it, and never part
 * of the edit state. The edit stack goes on storing the intent; this is what
 * lets reopening a photo bring the mask back without the model running again,
 * or being downloaded again on a machine that has since lost it.
 */
export interface StoredSubject {
  /** `<frameId>@<model>`, the same key the in-memory cache uses. */
  key: string
  frameId: string
  model: string
  /** `size` square bytes of coverage — structured-cloneable as it stands. */
  data: Uint8ClampedArray
  size: number
  bytes: number
  usedAt: number
}

/** A map is about a megabyte, so this is a modest 64 MB at most. */
export const MAX_SUBJECTS = 64
export const MAX_SUBJECT_BYTES = 64_000_000

export function subjectKey(frameId: string, model: string): string {
  return `${frameId}@${model}`
}

export async function loadSubject(frameId: string, model: string): Promise<StoredSubject | null> {
  const key = subjectKey(frameId, model)
  const record = await tx<StoredSubject>(STORE_SUBJECTS, 'readonly', (s) => s.get(key))
  if (!record) return null
  void tx(STORE_SUBJECTS, 'readwrite', (s) => s.put({ ...record, usedAt: Date.now() }))
  return record
}

export async function saveSubject(
  record: Pick<StoredSubject, 'frameId' | 'model' | 'data' | 'size'>,
): Promise<void> {
  const full: StoredSubject = {
    ...record,
    key: subjectKey(record.frameId, record.model),
    bytes: record.data.byteLength,
    usedAt: Date.now(),
  }
  await tx(STORE_SUBJECTS, 'readwrite', (s) => s.put(full))

  const all = await tx<StoredSubject[]>(STORE_SUBJECTS, 'readonly', (s) => s.getAll())
  if (!all) return
  const plan = developEvictionPlan(all, full.key, {
    maxEntries: MAX_SUBJECTS,
    maxBytes: MAX_SUBJECT_BYTES,
  })
  for (const key of plan) await tx(STORE_SUBJECTS, 'readwrite', (s) => s.delete(key))
}

export async function clearSubjects(): Promise<void> {
  await tx(STORE_SUBJECTS, 'readwrite', (s) => s.clear())
}

export async function subjectCacheSize(): Promise<{ count: number; bytes: number }> {
  const all = await tx<StoredSubject[]>(STORE_SUBJECTS, 'readonly', (s) => s.getAll())
  if (!all) return { count: 0, bytes: 0 }
  return { count: all.length, bytes: all.reduce((n, r) => n + r.bytes, 0) }
}

/**
 * Ask the browser to treat this origin's storage as durable rather than as
 * evictable cache.
 *
 * Without this, IndexedDB is best-effort: Chrome may clear it when the disk
 * runs low and Safari expires it after a stretch of no visits. That is fine for
 * a thumbnail cache, which rebuilds itself, and not fine for a preset the user
 * imported and cannot get back — the file it came from is long closed. Granting
 * is at the browser's discretion and needs no prompt in Chrome or Safari, so a
 * refusal is not worth reporting; it only means the old best-effort behaviour.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch (err) {
    console.warn('[35mm] could not request persistent storage', err)
    return false
  }
}
