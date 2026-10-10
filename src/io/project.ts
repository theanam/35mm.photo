import type { EditState, ImageMeta } from '../editor/edit-stack/types'
import { parseSidecar, SIDECAR_VERSION } from './export'
import { saveBlob } from './file-system'

/**
 * `.35mm` project files: the source photo and its edits in one file, so work can
 * be put down and picked up later, or moved to another machine, without the
 * original having to be found again. The photo is stored untouched and the
 * edits stay parameters, as ever.
 *
 *   8 bytes   magic
 *   4 bytes   header length, little-endian
 *   n bytes   header, UTF-8 JSON (a sidecar, plus what is needed to rebuild the File)
 *   rest      the original file, byte for byte
 */

export const PROJECT_EXTENSION = '35mm'

const MAGIC = new TextEncoder().encode('35MMPRJ\n')

interface ProjectHeader {
  app: '35mm'
  version: number
  savedAt: string
  source: { name: string; type: string; size: number; lastModified: number }
  edits: EditState
}

export function isProjectFile(name: string): boolean {
  return name.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`)
}

export function buildProject(source: File, edits: EditState): Blob {
  const header: ProjectHeader = {
    app: '35mm',
    version: SIDECAR_VERSION,
    savedAt: new Date().toISOString(),
    source: {
      name: source.name,
      type: source.type,
      size: source.size,
      lastModified: source.lastModified,
    },
    edits,
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, json.byteLength, true)
  return new Blob([MAGIC, length, json, source], { type: 'application/octet-stream' })
}

/**
 * Read a project back into the photo it holds and the edits made to it. The
 * rebuilt File keeps the original's name and modified time, so it has the same
 * identity as the photo it came from and finds the same cached work.
 */
export async function parseProject(file: File): Promise<{ photo: File; edits: EditState }> {
  const bad = () => new Error('That is not a 35mm project file')

  const prefix = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer())
  if (prefix.length < MAGIC.length + 4 || MAGIC.some((b, i) => prefix[i] !== b)) throw bad()

  const headerLength = new DataView(prefix.buffer).getUint32(MAGIC.length, true)
  const bodyStart = MAGIC.length + 4 + headerLength
  if (bodyStart > file.size) throw bad()

  const text = await file.slice(MAGIC.length + 4, bodyStart).text()
  let header: ProjectHeader
  try {
    header = JSON.parse(text) as ProjectHeader
  } catch {
    throw bad()
  }
  if (!header.source?.name) throw bad()

  const edits = parseSidecar(text)
  const bytes = file.slice(bodyStart)
  if (header.source.size !== bytes.size) throw new Error('That project file is incomplete')

  const photo = new File([bytes], header.source.name, {
    type: header.source.type,
    lastModified: header.source.lastModified,
  })
  return { photo, edits }
}

export function saveProject(source: File, edits: EditState, meta: Pick<ImageMeta, 'name'>) {
  const dot = meta.name.lastIndexOf('.')
  const stem = dot === -1 ? meta.name : meta.name.slice(0, dot)
  return saveBlob(
    buildProject(source, edits),
    `${stem}.${PROJECT_EXTENSION}`,
    'application/octet-stream',
    PROJECT_EXTENSION,
  )
}
