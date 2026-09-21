import { cloneEdits, defaultEdits } from './defaults'
import type { EditState } from './types'

/**
 * Copying one photo's settings onto others.
 *
 * Not every setting travels. A crop frames *this* picture, and an absolute
 * Kelvin white balance read off one raw describes the light that scene was shot
 * under — pasting either across a set is how a batch edit ruins the photos it
 * was meant to speed up. So the copy is made by group, and the groups that
 * should rarely travel are off by default rather than merely available to turn
 * off afterwards.
 *
 * The existing `pasteLook` already worked this way for the single-photo case:
 * it copies everything except the crop.
 */

export const SYNC_GROUPS = [
  'whiteBalance',
  'light',
  'curves',
  'mixer',
  'grade',
  'optics',
  'detail',
  'finish',
  'look',
  'raw',
  'masks',
  'crop',
] as const

export type SyncGroup = (typeof SYNC_GROUPS)[number]

export const SYNC_GROUP_LABEL: Record<SyncGroup, string> = {
  whiteBalance: 'White balance',
  light: 'Light & colour',
  curves: 'Curves',
  mixer: 'Colour mixer',
  grade: 'Colour grading',
  optics: 'Optics & perspective',
  detail: 'Detail & noise',
  finish: 'Halation, grain & vignette',
  look: 'Look',
  raw: 'RAW development',
  masks: 'Masks & local adjustments',
  crop: 'Crop & rotation',
}

/**
 * What a fresh sync starts with. Crop is off because it is per-picture, and
 * masks for the same reason twice over: a radial placed on one face lands on
 * whatever happens to be in that corner of the next frame. White balance is on
 * because a set shot under one light wants it — but it is the first thing to
 * turn off when the set is not.
 */
export const DEFAULT_SYNC_GROUPS: SyncGroup[] = SYNC_GROUPS.filter(
  (g) => g !== 'crop' && g !== 'masks',
)

/** Fields carried by each group, so the mapping is stated once. */
const FIELDS: Record<SyncGroup, (keyof EditState)[]> = {
  whiteBalance: ['temperature', 'tint'],
  light: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'dynamicRange', 'vibrance', 'saturation'],
  curves: ['curves'],
  mixer: ['hsl'],
  grade: ['colorGrade'],
  optics: ['perspective', 'lens'],
  detail: ['clarity', 'texture', 'dehaze', 'sharpen', 'denoiseLuma', 'denoiseChroma'],
  finish: ['halation', 'grain', 'grainSize', 'vignette', 'frame'],
  look: ['look'],
  raw: ['raw'],
  masks: ['masks'],
  crop: ['crop'],
}

/**
 * Build the edit state a target photo should end up with.
 *
 * Everything outside the chosen groups is kept from the target, so syncing
 * colour onto a photo that is already cropped leaves the crop alone.
 */
export function applySyncScope(
  target: EditState,
  source: EditState,
  groups: Iterable<SyncGroup>,
): EditState {
  const out = cloneEdits(target)
  const chosen = new Set(groups)

  for (const group of SYNC_GROUPS) {
    if (!chosen.has(group)) continue
    for (const field of FIELDS[group]) {
      // Structured clone per field: the source object must not end up shared
      // between photos, or editing one would silently edit the others.
      ;(out as unknown as Record<string, unknown>)[field] = structuredClone(
        (source as unknown as Record<string, unknown>)[field],
      )
    }
  }

  return out
}

/**
 * Put the chosen groups back to their defaults instead of copying them.
 * The counterpart to a sync, and the closest thing to undo across a set —
 * history is per-photo, so a batch cannot be walked back a step at a time.
 */
export function resetSyncScope(target: EditState, groups: Iterable<SyncGroup>): EditState {
  // The source is the defaults, not the photo: syncing a group *from* neutral
  // is the same operation as clearing it.
  return applySyncScope(target, defaultEdits(), groups)
}
