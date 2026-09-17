/** Adobe/Iridas `.cube` LUT parser, 1D and 3D (spec §4.3.1). */

export interface ParsedCube {
  /** A 1D file is three per-channel curves; a 3D file is a colour cube. */
  kind: '1d' | '3d'
  /** Grid edge for a 3D LUT, or the number of samples in a 1D one. */
  size: number
  /** RGB triples — size³ entries for 3D, size entries for 1D. */
  data: Float32Array
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  title?: string
}

export function parseCube(text: string): ParsedCube {
  let size3d = 0
  let size1d = 0
  let title: string | undefined
  let domainMin: [number, number, number] = [0, 0, 0]
  let domainMax: [number, number, number] = [1, 1, 1]
  const values: number[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    if (line.startsWith('TITLE')) {
      title = line.slice(5).trim().replace(/^"|"$/g, '')
      continue
    }
    if (line.startsWith('LUT_3D_SIZE')) {
      size3d = Number.parseInt(line.split(/\s+/)[1], 10)
      continue
    }
    if (line.startsWith('LUT_1D_SIZE')) {
      size1d = Number.parseInt(line.split(/\s+/)[1], 10)
      continue
    }
    if (line.startsWith('DOMAIN_MIN')) {
      domainMin = triple(line)
      continue
    }
    if (line.startsWith('DOMAIN_MAX')) {
      domainMax = triple(line)
      continue
    }
    // LUT_3D_INPUT_RANGE / LUT_1D_INPUT_RANGE are the older spelling of DOMAIN_*.
    if (line.startsWith('LUT_3D_INPUT_RANGE') || line.startsWith('LUT_1D_INPUT_RANGE')) {
      const p = line.split(/\s+/).slice(1).map(Number)
      domainMin = [p[0] ?? 0, p[0] ?? 0, p[0] ?? 0]
      domainMax = [p[1] ?? 1, p[1] ?? 1, p[1] ?? 1]
      continue
    }

    const parts = line.split(/\s+/)
    if (parts.length >= 3) {
      const r = Number.parseFloat(parts[0])
      const g = Number.parseFloat(parts[1])
      const b = Number.parseFloat(parts[2])
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) values.push(r, g, b)
    }
  }

  // The format allows one or the other, never both.
  if (!size3d && !size1d) throw new Error('no LUT_3D_SIZE or LUT_1D_SIZE header')

  const kind: '1d' | '3d' = size3d ? '3d' : '1d'
  const size = size3d || size1d
  const expected = (kind === '3d' ? size * size * size : size) * 3
  if (values.length !== expected) {
    throw new Error(`has ${values.length / 3} entries, expected ${expected / 3}`)
  }

  return { kind, size, data: Float32Array.from(values), domainMin, domainMax, title }
}

function triple(line: string): [number, number, number] {
  const p = line.split(/\s+/).slice(1).map(Number)
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
}
