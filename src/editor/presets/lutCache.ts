import { resolveLookLut, type Lut3D } from './lut3d'
import { getLook } from './catalogue'

/**
 * LUTs are built once and reused. Synthesising a 33³ grid is a few milliseconds
 * of JS — fine on first use, wasteful on every slider tick. An imported LUT is
 * cheaper still to keep around than to resample out of its input space again.
 */
const cache = new Map<string, Lut3D>()
const inflight = new Map<string, Promise<Lut3D | null>>()

/**
 * Cache key. An imported LUT's texture depends on the input space it is being
 * read through, so changing that has to miss the cache rather than serve the
 * cube built for the old one.
 */
function keyFor(id: string): string {
  const space = getLook(id)?.custom?.inputSpace
  return space ? `${id}@${space}` : id
}

export async function getLut(id: string | null | undefined): Promise<Lut3D | null> {
  if (!id) return null
  const key = keyFor(id)

  const cached = cache.get(key)
  if (cached) return cached

  const existing = inflight.get(key)
  if (existing) return existing

  const look = getLook(id)
  if (!look) return null

  const promise = resolveLookLut(look, document.baseURI)
    .then((lut) => {
      // A parametric preset has no cube of its own — it moves the sliders.
      if (lut) cache.set(key, lut)
      return lut
    })
    .catch((err) => {
      console.warn(`[35mm] could not build the LUT for "${id}"`, err)
      return null
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, promise)
  return promise
}

/** Synchronous accessor for code paths that cannot await, e.g. a render frame. */
export function peekLut(id: string | null | undefined): Lut3D | null {
  return id ? (cache.get(keyFor(id)) ?? null) : null
}

export function warmLuts(ids: string[]) {
  for (const id of ids) void getLut(id)
}

/** Drop every cube built for a preset — on delete, or an input-space change. */
export function forgetLut(id: string) {
  for (const key of [...cache.keys()]) {
    if (key === id || key.startsWith(`${id}@`)) cache.delete(key)
  }
}
