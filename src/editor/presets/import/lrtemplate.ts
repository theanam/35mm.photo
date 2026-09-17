import { mapCrsSettings, type CrsResult, type CrsSettings } from './crs'
import { parseLuaTable, type LuaTable } from './lua'

/**
 * Legacy Lightroom `.lrtemplate` presets — everything sold before 2018, and
 * still bundled alongside `.xmp` by most preset shops. The container is a Lua
 * table, but the settings inside it carry the same Camera Raw names, so only
 * the unwrapping is different.
 */

export interface ParsedLrTemplate extends CrsResult {
  name: string | null
}

export function parseLrTemplate(text: string): ParsedLrTemplate {
  const root = parseLuaTable(text)

  const value = root.value
  const settings =
    isTable(value) && isTable(value.settings)
      ? value.settings
      : isTable(root.settings)
        ? root.settings
        : null

  if (!settings) throw new Error('has no value.settings table — is it a Develop preset?')

  const name =
    stringOrNull(root.title) ?? stringOrNull(root.internalName) ?? stringOrNull(root.id)

  return { name, ...mapCrsSettings(settings as CrsSettings) }
}

function isTable(v: unknown): v is LuaTable {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
