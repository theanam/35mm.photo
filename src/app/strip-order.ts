import type { Frame } from '../editor/edit-stack/types'

/**
 * How the filmstrip is arranged: the order photos come in, and whether they
 * are gathered under headings. A preference kept in this browser rather than
 * a fact about any folder.
 */

export type StripSort = 'name' | 'date' | 'edited'
export type StripGroup = 'none' | 'camera' | 'lens' | 'day'

export interface StripOrder {
  sort: StripSort
  descending: boolean
  group: StripGroup
}

export const DEFAULT_ORDER: StripOrder = { sort: 'name', descending: false, group: 'none' }

export const SORT_LABEL: Record<StripSort, string> = { name: 'Name', date: 'Date', edited: 'Edited' }
export const GROUP_LABEL: Record<StripGroup, string> = { none: 'None', camera: 'Camera', lens: 'Lens', day: 'Day' }

export interface StripSection {
  /** Null for the one section an ungrouped strip has. */
  label: string | null
  frames: Frame[]
}

/** When the photo was taken, or failing that when the file was last written. */
export function frameDate(frame: Frame): number {
  return frame.meta.shotAt ?? frame.modifiedAt ?? 0
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare(a: Frame, b: Frame, sort: StripSort): number {
  switch (sort) {
    case 'name':
      return byName.compare(a.meta.name, b.meta.name)
    case 'date':
      return frameDate(a) - frameDate(b) || byName.compare(a.meta.name, b.meta.name)
    case 'edited':
      return (b.editCount ?? 0) - (a.editCount ?? 0) || byName.compare(a.meta.name, b.meta.name)
  }
}

const UNKNOWN = '—'

function dayLabel(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function keyOf(frame: Frame, group: StripGroup): { key: string; label: string; at: number } | null {
  switch (group) {
    case 'none':
      return null
    // Keyed case-insensitively: the raw decoder writes "Sony" where the EXIF
    // block says "SONY", and they are one camera, not two groups.
    case 'camera':
      return frame.meta.camera
        ? { key: frame.meta.camera.toLowerCase(), label: frame.meta.camera, at: 0 }
        : { key: '', label: UNKNOWN, at: 0 }
    case 'lens':
      return frame.meta.lens
        ? { key: frame.meta.lens.toLowerCase(), label: frame.meta.lens, at: 0 }
        : { key: '', label: UNKNOWN, at: 0 }
    case 'day': {
      const t = frameDate(frame)
      if (!t) return { key: '', label: UNKNOWN, at: 0 }
      const d = new Date(t)
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).valueOf()
      return { key: String(start), label: dayLabel(start), at: start }
    }
  }
}

/**
 * The strip in the asked-for order. Within a section the sort applies;
 * sections themselves come by name, or by date when grouped by day, and the
 * photos with nothing to group on come last under a dash.
 */
export function orderFrames(frames: Frame[], order: StripOrder): StripSection[] {
  const sorted = [...frames].sort((a, b) => {
    const c = compare(a, b, order.sort)
    return order.descending ? -c : c
  })
  if (order.group === 'none') return [{ label: null, frames: sorted }]

  const sections = new Map<string, StripSection & { at: number }>()
  for (const frame of sorted) {
    const k = keyOf(frame, order.group)!
    let s = sections.get(k.key)
    if (!s) {
      s = { label: k.label, frames: [], at: k.at }
      sections.set(k.key, s)
    }
    s.frames.push(frame)
  }
  const out = [...sections.entries()]
  out.sort(([ka, a], [kb, b]) => {
    // The unknowns go last whatever the direction.
    if (ka === '') return 1
    if (kb === '') return -1
    const c = order.group === 'day' ? a.at - b.at : byName.compare(a.label ?? '', b.label ?? '')
    return order.descending ? -c : c
  })
  return out.map(([, s]) => ({ label: s.label, frames: s.frames }))
}

const KEY = '35mm.stripOrder'

export function loadStripOrder(): StripOrder {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<StripOrder>) : null
    if (!parsed) return DEFAULT_ORDER
    return {
      sort: parsed.sort && parsed.sort in SORT_LABEL ? parsed.sort : DEFAULT_ORDER.sort,
      descending: Boolean(parsed.descending),
      group: parsed.group && parsed.group in GROUP_LABEL ? parsed.group : DEFAULT_ORDER.group,
    }
  } catch {
    return DEFAULT_ORDER
  }
}

export function saveStripOrder(order: StripOrder): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order))
  } catch {
    // The order holds for this session.
  }
}
