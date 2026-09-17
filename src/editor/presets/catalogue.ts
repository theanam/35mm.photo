import { useSyncExternalStore } from 'react'
import { LOOKS, LOOKS_BY_ID } from './looks'
import { inputSpaceDef } from './inputSpace'
import type { CustomPreset, LookConfig } from './types'

/**
 * The look catalogue the rest of the app sees: the built-ins, then whatever the
 * user has imported.
 *
 * This is deliberately a plain module rather than part of the editor store.
 * `lutCache` and `resolveLookLut` both need to resolve a look id outside React
 * and are imported *by* the store, so a registry living in the store would make
 * that a cycle. Components read it through `useLooksCatalogue`.
 */

const listeners = new Set<() => void>()

let presets: CustomPreset[] = []
let customLooks: LookConfig[] = []
let snapshot: LookConfig[] = LOOKS
let byId = new Map<string, LookConfig>(LOOKS_BY_ID)

/** Replace the imported set. The store owns persistence; this owns lookup. */
export function setCustomPresets(next: CustomPreset[]) {
  presets = [...next].sort((a, b) => b.createdAt - a.createdAt)
  customLooks = presets.map(toLook)
  snapshot = [...LOOKS, ...customLooks]
  byId = new Map(snapshot.map((l) => [l.id, l]))
  for (const fn of listeners) fn()
}

export function allLooks(): LookConfig[] {
  return snapshot
}

export function getCustomLooks(): LookConfig[] {
  return customLooks
}

export function getCustomPresets(): CustomPreset[] {
  return presets
}

export function getLook(id: string | null | undefined): LookConfig | null {
  if (!id) return null
  return byId.get(id) ?? null
}

export function isCustomLookId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('custom:')
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Built-ins plus imports, as one list, re-rendering when an import lands. */
export function useLooksCatalogue(): LookConfig[] {
  return useSyncExternalStore(subscribe, allLooks, allLooks)
}

/** Just the user's own presets, for the "Your presets" section of the grid. */
export function useCustomLooks(): LookConfig[] {
  return useSyncExternalStore(subscribe, getCustomLooks, getCustomLooks)
}

function toLook(preset: CustomPreset): LookConfig {
  return {
    id: preset.id,
    name: preset.name,
    blurb: describe(preset),
    // An imported preset brings no grain of its own: a LUT has none to give,
    // and a parametric preset carries its grain inside `edits`.
    grain: { amount: 0, size: 50, shadowBias: 0.5 },
    defaultStrength: 100,
    custom: preset,
  }
}

function describe(preset: CustomPreset): string {
  if (preset.kind === 'lut') {
    const space = inputSpaceDef(preset.inputSpace)
    const grid = preset.lut ? `${preset.lut.size}³` : '—'
    return `${preset.filename} · ${grid} LUT · ${space.name} input`
  }

  const count = countSettings(preset)
  const noun = count === 1 ? 'setting' : 'settings'
  const lost = preset.dropped?.length ? ` · ${preset.dropped.length} not supported` : ''
  return `${preset.filename} · ${count} ${noun}${lost}`
}

function countSettings(preset: CustomPreset): number {
  return preset.edits ? Object.keys(preset.edits).length : 0
}
