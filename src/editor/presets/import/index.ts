import { parseCube } from '../cube'
import { cubeToLut3d } from '../lut3d'
import { guessInputSpace } from '../inputSpace'
import type { CustomPreset, PresetFormat } from '../types'
import { parseLutImage } from './hald'
import { parseXmpPreset } from './xmp'
import { parseLrTemplate } from './lrtemplate'

/**
 * Import of the preset formats people actually own (spec §4.3.1). Everything
 * here runs on the file the user picked, in the tab — no upload, which is the
 * whole reason a browser editor can be trusted with a bought preset pack.
 *
 * Two destinations, decided by the format:
 *
 * - `.cube`, LUT images → a baked cube, applied as a look with a strength.
 * - `.xmp`, `.lrtemplate` → Camera Raw slider values, applied to the edit
 *   stack so everything stays adjustable afterwards.
 */

const FORMATS: Record<string, PresetFormat> = {
  cube: 'cube',
  png: 'hald',
  jpg: 'hald',
  jpeg: 'hald',
  webp: 'hald',
  xmp: 'xmp',
  lrtemplate: 'lrtemplate',
}

export const PRESET_ACCEPT = '.cube,.xmp,.lrtemplate,.png,.jpg,.jpeg,.webp'

export const PRESET_EXTENSIONS = Object.keys(FORMATS)

export function isPresetFile(name: string): boolean {
  return extensionOf(name) in FORMATS
}

export interface ImportOutcome {
  filename: string
  preset?: CustomPreset
  /** Set when this one file could not be read; the rest of a batch still lands. */
  error?: string
}

export async function importPresetFiles(files: File[]): Promise<ImportOutcome[]> {
  return Promise.all(files.map(importPresetFile))
}

export async function importPresetFile(file: File): Promise<ImportOutcome> {
  const filename = file.name
  const format = FORMATS[extensionOf(filename)]
  if (!format) {
    return { filename, error: `${filename} is not a preset or LUT file` }
  }

  try {
    const preset = await read(file, format)
    return { filename, preset }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'could not be read'
    return { filename, error: `${filename} ${detail}` }
  }
}

async function read(file: File, format: PresetFormat): Promise<CustomPreset> {
  const filename = file.name
  const base: Pick<CustomPreset, 'id' | 'format' | 'filename' | 'createdAt'> = {
    id: `custom:${crypto.randomUUID()}`,
    format,
    filename,
    createdAt: Date.now(),
  }

  if (format === 'cube') {
    const cube = parseCube(await file.text())
    return {
      ...base,
      kind: 'lut',
      name: cube.title?.trim() || stem(filename),
      lut: cubeToLut3d(cube),
      inputSpace: guessInputSpace(filename, cube.title),
    }
  }

  if (format === 'hald') {
    const { lut } = await parseLutImage(file)
    return {
      ...base,
      kind: 'lut',
      name: stem(filename),
      lut,
      inputSpace: guessInputSpace(filename),
    }
  }

  const parsed = format === 'xmp' ? parseXmpPreset(await file.text()) : parseLrTemplate(await file.text())
  if (!Object.keys(parsed.edits).length) {
    throw new Error('sets nothing this editor can apply')
  }

  return {
    ...base,
    kind: 'parametric',
    name: parsed.name?.trim() || stem(filename),
    edits: parsed.edits,
    dropped: parsed.dropped.length ? parsed.dropped : undefined,
  }
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}
