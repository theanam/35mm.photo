import { describe, expect, it } from 'vitest'
import { parseCube } from './cube'

/** A 3D `.cube` body whose entries encode their own grid position. */
function identityBody(size: number): string {
  const lines: string[] = []
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const n = size - 1
        lines.push(`${r / n} ${g / n} ${b / n}`)
      }
    }
  }
  return lines.join('\n')
}

describe('parseCube, 3D', () => {
  it('reads the size, the title and every entry', () => {
    const cube = parseCube(`TITLE "Test Look"\nLUT_3D_SIZE 2\n${identityBody(2)}`)
    expect(cube.kind).toBe('3d')
    expect(cube.size).toBe(2)
    expect(cube.title).toBe('Test Look')
    expect(cube.data.length).toBe(2 ** 3 * 3)
    // Entries run r fastest, b slowest, so the last one is the white corner.
    expect([...cube.data.slice(-3)]).toEqual([1, 1, 1])
  })

  it('keeps entry order: the second entry steps red, not green', () => {
    const cube = parseCube(`LUT_3D_SIZE 3\n${identityBody(3)}`)
    expect([...cube.data.slice(3, 6)]).toEqual([0.5, 0, 0])
    expect([...cube.data.slice(9, 12)]).toEqual([0, 0.5, 0])
  })

  it('ignores comments, blank lines and stray header text', () => {
    const text = [
      '# exported by something',
      '',
      'TITLE "Spaced Out"',
      '   ',
      'LUT_3D_SIZE 2',
      '# and a comment in the middle',
      identityBody(2),
    ].join('\n')
    expect(parseCube(text).size).toBe(2)
  })

  it('reads a file with CRLF line endings', () => {
    const text = `LUT_3D_SIZE 2\r\n${identityBody(2).replace(/\n/g, '\r\n')}`
    expect(parseCube(text).data.length).toBe(24)
  })

  it('reads DOMAIN_MIN and DOMAIN_MAX', () => {
    const cube = parseCube(
      `LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 4 4 4\n${identityBody(2)}`,
    )
    expect(cube.domainMin).toEqual([0, 0, 0])
    expect(cube.domainMax).toEqual([4, 4, 4])
  })

  it('reads the older LUT_3D_INPUT_RANGE spelling of the domain', () => {
    const cube = parseCube(`LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE 0 2\n${identityBody(2)}`)
    expect(cube.domainMin).toEqual([0, 0, 0])
    expect(cube.domainMax).toEqual([2, 2, 2])
  })

  it('defaults the domain to 0..1 when the file says nothing', () => {
    const cube = parseCube(`LUT_3D_SIZE 2\n${identityBody(2)}`)
    expect(cube.domainMin).toEqual([0, 0, 0])
    expect(cube.domainMax).toEqual([1, 1, 1])
  })

  it('strips quotes from the title but keeps its spaces', () => {
    expect(parseCube(`TITLE "A Long Name"\nLUT_3D_SIZE 2\n${identityBody(2)}`).title)
      .toBe('A Long Name')
  })
})

describe('parseCube, 1D', () => {
  it('reads three per-channel curves', () => {
    const cube = parseCube('LUT_1D_SIZE 3\n0 0 0\n0.5 0.4 0.3\n1 1 1')
    expect(cube.kind).toBe('1d')
    expect(cube.size).toBe(3)
    expect(cube.data.length).toBe(9)
    // Float32Array, so 0.4 is 0.40000000596 — compare with a tolerance rather
    // than for exact equality.
    const mid = [...cube.data.slice(3, 6)]
    for (const [i, want] of [0.5, 0.4, 0.3].entries()) expect(mid[i]).toBeCloseTo(want, 6)
  })
})

describe('parseCube, bad input', () => {
  it('rejects a file with no size header', () => {
    expect(() => parseCube('0 0 0\n1 1 1')).toThrow(/LUT_3D_SIZE or LUT_1D_SIZE/)
  })

  it('rejects a file with fewer entries than the header promises', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n1 1 1')).toThrow(/expected 8/)
  })

  it('rejects a file with more entries than the header promises', () => {
    expect(() => parseCube(`LUT_3D_SIZE 2\n${identityBody(2)}\n0.5 0.5 0.5`)).toThrow(/expected 8/)
  })

  it('rejects a 1D file whose entry count does not match', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0\n1 1 1')).toThrow(/expected 4/)
  })

  it('rejects prose that happens to have a .cube extension', () => {
    expect(() => parseCube('hello there')).toThrow()
  })
})
