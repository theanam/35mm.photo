/** Minimal Adobe `.cube` 3D LUT parser (spec §4.3.1). */

export interface ParsedCube {
  size: number
  /** RGB triples, size³ entries, in the LUT's own domain. */
  data: Float32Array
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  title?: string
}

export function parseCube(text: string): ParsedCube {
  let size = 0
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
      size = Number.parseInt(line.split(/\s+/)[1], 10)
      continue
    }
    if (line.startsWith('LUT_1D_SIZE')) {
      throw new Error('1D .cube LUTs are not supported — supply a LUT_3D_SIZE file')
    }
    if (line.startsWith('DOMAIN_MIN')) {
      domainMin = triple(line)
      continue
    }
    if (line.startsWith('DOMAIN_MAX')) {
      domainMax = triple(line)
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

  if (!size) throw new Error('.cube file has no LUT_3D_SIZE header')
  const expected = size * size * size * 3
  if (values.length !== expected) {
    throw new Error(`.cube file has ${values.length / 3} entries, expected ${expected / 3}`)
  }

  return { size, data: Float32Array.from(values), domainMin, domainMax, title }
}

function triple(line: string): [number, number, number] {
  const p = line.split(/\s+/).slice(1).map(Number)
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]
}
