import { describe, expect, it, vi } from 'vitest'
import { runQueue, uniqueName, type BatchProgress } from './batch-export'
import { exportFilename } from './export'

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ frameId: `f${i}` }))

function recorder() {
  const events: BatchProgress[] = []
  return { events, onProgress: (u: BatchProgress) => events.push(u) }
}

describe('runQueue', () => {
  it('runs every item and counts them', async () => {
    const { events, onProgress } = recorder()
    const result = await runQueue(items(3), async () => {}, onProgress)

    expect(result).toEqual({ saved: 3, failed: 0, cancelled: false })
    expect(events.map((e) => e.status)).toEqual(['done', 'done', 'done'])
  })

  it('runs strictly one at a time', async () => {
    let inFlight = 0
    let peak = 0
    await runQueue(
      items(5),
      async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 1))
        inFlight--
      },
      () => {},
    )
    // Parallelism here would buy nothing — raw decode is serialised behind one
    // worker — and would multiply peak memory by the number in flight.
    expect(peak).toBe(1)
  })

  it('lets one failure take out only its own item', async () => {
    const { events, onProgress } = recorder()
    const seen: string[] = []
    const result = await runQueue(
      items(4),
      async (item) => {
        seen.push(item.frameId)
        if (item.frameId === 'f1') throw new Error('unreadable file')
      },
      onProgress,
    )

    expect(seen).toEqual(['f0', 'f1', 'f2', 'f3'])
    expect(result).toEqual({ saved: 3, failed: 1, cancelled: false })
    const failure = events.find((e) => e.status === 'failed')
    expect(failure?.frameId).toBe('f1')
    expect(failure?.error).toBe('unreadable file')
  })

  it('reports something sensible when a failure is not an Error', async () => {
    const { events, onProgress } = recorder()
    await runQueue(items(1), async () => { throw 'nope' }, onProgress)
    expect(events[0].error).toBe('could not be exported')
  })

  it('stops starting new work once aborted, and marks the rest skipped', async () => {
    const controller = new AbortController()
    const { events, onProgress } = recorder()
    const processed: string[] = []

    const result = await runQueue(
      items(5),
      async (item) => {
        processed.push(item.frameId)
        if (item.frameId === 'f1') controller.abort()
      },
      onProgress,
      controller.signal,
    )

    // The one in flight when Stop is pressed finishes; nothing after it starts.
    expect(processed).toEqual(['f0', 'f1'])
    expect(result.saved).toBe(2)
    expect(result.cancelled).toBe(true)
    expect(events.filter((e) => e.status === 'skipped').map((e) => e.frameId)).toEqual([
      'f2', 'f3', 'f4',
    ])
  })

  it('does nothing at all for an empty selection', async () => {
    const process = vi.fn()
    const result = await runQueue([], process, () => {})
    expect(process).not.toHaveBeenCalled()
    expect(result).toEqual({ saved: 0, failed: 0, cancelled: false })
  })

  it('counts an already-aborted run as cancelled without processing anything', async () => {
    const controller = new AbortController()
    controller.abort()
    const process = vi.fn()
    const result = await runQueue(items(3), process, () => {}, controller.signal)
    expect(process).not.toHaveBeenCalled()
    expect(result).toEqual({ saved: 0, failed: 0, cancelled: true })
  })
})

describe('exportFilename', () => {
  it('keeps the stem and swaps the extension', () => {
    expect(exportFilename('DSCF4912.RAF', 'jpeg')).toBe('DSCF4912-35mm.jpg')
    expect(exportFilename('shot.tar.gz', 'png')).toBe('shot.tar-35mm.png')
    expect(exportFilename('noext', 'webp')).toBe('noext-35mm.webp')
  })

  it('collides when two sources share a stem, which the batch has to resolve', () => {
    // Not a defect on its own: exported one at a time the user sees each save
    // dialog. It only bites when a batch pours them into one folder.
    expect(exportFilename('a.jpg', 'jpeg')).toBe(exportFilename('a.raf', 'jpeg'))
  })
})

describe('uniqueName', () => {
  it('leaves a name alone the first time', () => {
    const used = new Set<string>()
    expect(uniqueName('a-35mm.jpg', used)).toBe('a-35mm.jpg')
  })

  it('numbers the repeats rather than overwriting them', () => {
    const used = new Set<string>()
    const names = ['a.jpg', 'a.raf', 'b.jpg', 'a.dng'].map((n) =>
      uniqueName(exportFilename(n, 'jpeg'), used),
    )
    expect(names).toEqual(['a-35mm.jpg', 'a-35mm (2).jpg', 'b-35mm.jpg', 'a-35mm (3).jpg'])
    expect(new Set(names).size).toBe(4)
  })

  it('keeps the extension where it belongs', () => {
    const used = new Set(['shot-35mm.png'])
    expect(uniqueName('shot-35mm.png', used)).toBe('shot-35mm (2).png')
  })

  it('handles a name with no extension', () => {
    const used = new Set(['plain'])
    expect(uniqueName('plain', used)).toBe('plain (2)')
  })
})
