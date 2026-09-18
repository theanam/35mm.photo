/**
 * Crop aspect ratios.
 *
 * The ratio is stored on the edit as the string the user picked — "3:2", "16:9"
 * — rather than as a number, so a saved crop says what it was chosen as rather
 * than 1.5. Parsing it generically is also what lets any ratio be typed in: a
 * lookup table would have to be told about every one in advance, and there were
 * two such tables, in the tool and in the overlay, already able to disagree.
 */

/** Ids that mean "no lock" rather than a ratio. */
export const FREE_ASPECTS = ['original', 'free'] as const

export function parseAspectRatio(id: string | null | undefined): number | null {
  if (!id || (FREE_ASPECTS as readonly string[]).includes(id)) return null

  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(id.trim())
  if (!match) return null

  const w = Number(match[1])
  const h = Number(match[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null

  return w / h
}

/** The id for a ratio typed into the custom fields. */
export function formatAspect(w: number, h: number): string {
  const clean = (v: number) => String(Number(v.toFixed(4)))
  return `${clean(w)}:${clean(h)}`
}
