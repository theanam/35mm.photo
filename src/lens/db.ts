import type { DbLensIndex, LensDbIndex, LensDbShard } from './types'

/**
 * The database on the wire: an index fetched once and kept, and calibration
 * shards fetched by maker the first time a lens of that maker is resolved.
 * The service worker precaches the index and keeps every shard it has seen,
 * so a lens matched once matches offline from then on.
 */

const base = () => `${import.meta.env.BASE_URL}lensdb/`

let index: Promise<LensDbIndex | null> | null = null
const shards = new Map<string, Promise<LensDbShard | null>>()

export function loadLensIndex(): Promise<LensDbIndex | null> {
  if (!index) {
    index = fetchJson<LensDbIndex>(`${base()}index.json`).then((db) => {
      // A failed fetch is not a verdict; the next photo asks again.
      if (!db) index = null
      return db
    })
  }
  return index
}

let current: LensDbIndex | null = null

/** The index if it has already arrived, for synchronous callers like a search box. */
export function lensIndexNow(): LensDbIndex | null {
  return current
}

export function loadLensShard(path: string): Promise<LensDbShard | null> {
  let p = shards.get(path)
  if (!p) {
    p = fetchJson<LensDbShard>(`${base()}${path}`).then((shard) => {
      if (!shard) shards.delete(path)
      return shard
    })
    shards.set(path, p)
  }
  return p
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const json = (await res.json()) as T
    if (url.endsWith('index.json')) current = json as unknown as LensDbIndex
    return json
  } catch {
    return null
  }
}

/**
 * Lenses whose name contains every word typed, on a mount if one is given,
 * for the picker. Cheap enough to run on every keystroke over the whole index.
 */
export function searchLenses(db: LensDbIndex, query: string, mounts: Set<string> | null, limit = 12): DbLensIndex[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const out: DbLensIndex[] = []
  for (const lens of db.lenses) {
    if (mounts && !lens.mounts.some((m) => mounts.has(m))) continue
    const hay = `${lens.maker} ${lens.model} ${lens.name ?? ''}`.toLowerCase()
    if (words.every((w) => hay.includes(w))) {
      out.push(lens)
      if (out.length >= limit) break
    }
  }
  return out
}

/** Every mount a body accepts: its own, its adapters', and the generic one. */
export function mountsFor(db: LensDbIndex, mount: string): Set<string> {
  const out = new Set([mount, 'Generic'])
  for (const c of db.mounts.find((m) => m.name === mount)?.compat ?? []) out.add(c)
  return out
}

/** For tests: forget everything fetched. */
export function resetLensDb(): void {
  index = null
  current = null
  shards.clear()
}
