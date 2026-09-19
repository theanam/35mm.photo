import { describe, expect, it } from 'vitest'
import {
  canOverwriteOriginal,
  exportFilename,
  exportImage,
  formatOfFile,
  type ExportFormat,
  type ExportRequest,
} from './export'
import { defaultEdits } from '../editor/edit-stack/defaults'
import { NATIVE_EXTENSIONS, RAW_EXTENSIONS, HEIF_EXTENSIONS } from './formats'
import type { ImageMeta } from '../editor/edit-stack/types'

describe('formatOfFile', () => {
  it('names the format of the three this app can write', () => {
    expect(formatOfFile('a.jpg')).toBe('jpeg')
    expect(formatOfFile('a.jpeg')).toBe('jpeg')
    expect(formatOfFile('a.png')).toBe('png')
    expect(formatOfFile('a.webp')).toBe('webp')
  })

  it('does not care how the extension is typed', () => {
    expect(formatOfFile('IMG_0001.JPG')).toBe('jpeg')
    expect(formatOfFile('IMG_0001.WebP')).toBe('webp')
  })

  /**
   * The point of the whole exercise: 35mm opens far more than it can encode,
   * and every one of these would be destroyed by an export written back over
   * it — a negative traded for a positive wearing its name.
   */
  it('refuses every format that can be read but not written', () => {
    const readOnly = [
      ...RAW_EXTENSIONS,
      ...HEIF_EXTENSIONS,
      ...NATIVE_EXTENSIONS.filter((e) => !['jpg', 'jpeg', 'png', 'webp'].includes(e)),
    ]
    for (const ext of readOnly) {
      expect(formatOfFile(`photo.${ext}`), ext).toBeNull()
    }
    // Includes the ones most likely to be reached for: a raw and an iPhone HEIC.
    expect(formatOfFile('DSCF1234.RAF')).toBeNull()
    expect(formatOfFile('IMG_9019.HEIC')).toBeNull()
  })

  it('has no opinion about a name with no extension', () => {
    expect(formatOfFile('photo')).toBeNull()
  })
})

describe('canOverwriteOriginal', () => {
  it('allows a file to be written back as what it already is', () => {
    expect(canOverwriteOriginal('a.jpg', 'jpeg')).toBe(true)
    expect(canOverwriteOriginal('a.png', 'png')).toBe(true)
    expect(canOverwriteOriginal('a.webp', 'webp')).toBe(true)
  })

  /**
   * Matching the extension is not enough on its own — it has to name the format
   * being encoded. PNG bytes inside a .jpg is the same mistake as a JPEG inside
   * a .RAF, with less at stake.
   */
  it('refuses to write one format into another one’s extension', () => {
    expect(canOverwriteOriginal('a.jpg', 'png')).toBe(false)
    expect(canOverwriteOriginal('a.png', 'webp')).toBe(false)
    expect(canOverwriteOriginal('a.webp', 'jpeg')).toBe(false)
  })

  it('refuses everything this app cannot encode', () => {
    for (const format of ['jpeg', 'png', 'webp'] as ExportFormat[]) {
      expect(canOverwriteOriginal('DSCF1234.RAF', format)).toBe(false)
      expect(canOverwriteOriginal('IMG_9019.HEIC', format)).toBe(false)
      expect(canOverwriteOriginal('scan.tif', format)).toBe(false)
    }
  })
})

describe('exportImage refusing to overwrite', () => {
  const request = (name: string, format: ExportFormat): ExportRequest => ({
    // The guard runs before anything touches these, which is the point of it
    // sitting at the top: a refusal should not cost a full-resolution render.
    source: {} as ImageBitmap,
    meta: { name, ext: name.split('.').pop()!, isRaw: false, width: 100, height: 100, orientation: 1, bytes: 1 } as ImageMeta,
    edits: defaultEdits(),
    settings: { format, quality: 92, maxEdge: null },
    overwriteHandle: {} as FileSystemFileHandle,
  })

  it('throws rather than writing an export over a raw', async () => {
    await expect(exportImage(request('DSCF1234.RAF', 'jpeg'))).rejects.toThrow(
      /cannot write JPEG over a \.RAF file/,
    )
  })

  it('throws rather than writing an export over a HEIC', async () => {
    await expect(exportImage(request('IMG_9019.HEIC', 'webp'))).rejects.toThrow(
      /cannot write WEBP over a \.HEIC file/,
    )
  })

  it('throws on a format that does not match the extension', async () => {
    await expect(exportImage(request('holiday.jpg', 'png'))).rejects.toThrow(
      /cannot write PNG over a \.JPG file/,
    )
  })

  it('does not refuse when no overwrite was asked for', async () => {
    // Without a handle the guard has nothing to say, so this gets as far as the
    // render and fails there instead — on the empty bitmap, not on the format.
    const { overwriteHandle, ...copy } = request('DSCF1234.RAF', 'jpeg')
    expect(overwriteHandle).toBeDefined()
    await expect(exportImage(copy)).rejects.not.toThrow(/cannot write/)
  })
})

describe('exportFilename', () => {
  it('never collides with the original, whatever the format', () => {
    expect(exportFilename('DSCF1234.RAF', 'jpeg')).toBe('DSCF1234-35mm.jpg')
    expect(exportFilename('IMG_9019.HEIC', 'webp')).toBe('IMG_9019-35mm.webp')
    // Same format as the source still gets the suffix, so a plain export is
    // never the thing that quietly replaces the file it came from.
    expect(exportFilename('holiday.jpg', 'jpeg')).toBe('holiday-35mm.jpg')
  })
})
