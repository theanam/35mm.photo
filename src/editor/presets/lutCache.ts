import { resolveLookLut, type Lut3D } from './lut3d'
import { getLook } from './looks'

/**
 * LUTs are built once and reused. Synthesising a 33³ grid is a few milliseconds
 * of JS — fine on first use, wasteful on every slider tick.
 */
const cache = new Map<string, Lut3D>()
const inflight = new Map<string, Promise<Lut3D | null>>()

export async function getLut(id: string | null | undefined): Promise<Lut3D | null> {
  if (!id) return null

  const cached = cache.get(id)
  if (cached) return cached

  const existing = inflight.get(id)
  if (existing) return existing

  const look = getLook(id)
  if (!look) return null

  const promise = resolveLookLut(look, document.baseURI)
    .then((lut) => {
      cache.set(id, lut)
      return lut
    })
    .catch((err) => {
      console.warn(`[35mm] could not build the LUT for "${id}"`, err)
      return null
    })
    .finally(() => inflight.delete(id))

  inflight.set(id, promise)
  return promise
}

/** Synchronous accessor for code paths that cannot await, e.g. a render frame. */
export function peekLut(id: string | null | undefined): Lut3D | null {
  return id ? (cache.get(id) ?? null) : null
}

export function warmLuts(ids: string[]) {
  for (const id of ids) void getLut(id)
}
