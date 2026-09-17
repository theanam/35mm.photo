import type { EditState } from './types'

/** Undo/redo is stack manipulation over whole edit states (spec §3.1). */
export interface History {
  past: EditState[]
  future: EditState[]
  /** Identifies the control currently being dragged, so a slider sweep becomes
   *  one undo step instead of sixty. */
  coalesceKey: string | null
  coalesceAt: number
}

export const HISTORY_LIMIT = 100

/** A drag is treated as continuing while the same control keeps firing. */
const COALESCE_WINDOW_MS = 1200

export function emptyHistory(): History {
  return { past: [], future: [], coalesceKey: null, coalesceAt: 0 }
}

export function shouldPush(history: History, coalesceKey: string | null, now: number): boolean {
  if (!coalesceKey) return true
  if (history.coalesceKey !== coalesceKey) return true
  return now - history.coalesceAt > COALESCE_WINDOW_MS
}

export function pushHistory(
  history: History,
  previous: EditState,
  coalesceKey: string | null,
  now: number,
): History {
  const past = [...history.past, previous]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, future: [], coalesceKey, coalesceAt: now }
}

export function touchHistory(history: History, coalesceKey: string | null, now: number): History {
  return { ...history, coalesceKey, coalesceAt: now, future: [] }
}
