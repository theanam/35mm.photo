/**
 * The guide drawn inside the crop box — Lightroom's crop overlays, cycled with
 * O and turned with ⇧O.
 *
 * A preference, not an edit: it says nothing about the picture, only about how
 * it is being looked at, so it is remembered in this browser and never written
 * to a sidecar.
 */
export type CropGuide = 'thirds' | 'golden' | 'grid' | 'diagonal' | 'triangle' | 'spiral' | 'none'

export const CROP_GUIDES: { id: CropGuide; label: string }[] = [
  { id: 'thirds', label: 'Thirds' },
  { id: 'golden', label: 'Golden' },
  { id: 'grid', label: 'Grid' },
  { id: 'diagonal', label: 'Diagonal' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'none', label: 'None' },
]

/** How many ways ⇧O can turn a guide. A symmetric one has only the one. */
export function guideTurns(guide: CropGuide): number {
  switch (guide) {
    case 'triangle':
      return 2
    case 'spiral':
      return 4
    default:
      return 1
  }
}

export function nextGuide(guide: CropGuide, direction: 1 | -1 = 1): CropGuide {
  const at = CROP_GUIDES.findIndex((g) => g.id === guide)
  const n = CROP_GUIDES.length
  return CROP_GUIDES[(Math.max(at, 0) + direction + n) % n].id
}

const KEY = '35mm.cropGuide'

export function loadCropGuide(): { guide: CropGuide; turn: number } {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { guide?: string; turn?: number }
      const guide = CROP_GUIDES.find((g) => g.id === parsed.guide)?.id
      if (guide) {
        const turns = guideTurns(guide)
        const turn = Number.isInteger(parsed.turn) ? ((parsed.turn! % turns) + turns) % turns : 0
        return { guide, turn }
      }
    }
  } catch {
    // Fall through to the default.
  }
  return { guide: 'thirds', turn: 0 }
}

export function saveCropGuide(guide: CropGuide, turn: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ guide, turn }))
  } catch {
    // The choice holds for this session.
  }
}
