import { describe, expect, it } from 'vitest'
import { groupAssets, verifyGroups } from './asset-groups'

/** A real build's output, with the hashes Vite gives it. */
const BUILD = [
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'favicon.svg',
  'assets/index-BaqksRcX.js',
  'assets/index-BuVPwQJm.css',
  'assets/histogram-worker-0pN9RptU.js',
  'assets/heic-BZ2l7TbD.js',
  'assets/heic-worker-B7oT4hWj.js',
  'assets/wasm-bundle-B_fo7_i4.js',
  'assets/libraw-CKnqEbQ6.wasm',
  'assets/libraw-DYlN_xHc.js',
  'assets/worker-QKyN-S3h.js',
  'assets/decode-raw-DoHRyVYN.js',
  'assets/preview-worker-BM9OaXDH.js',
  'assets/ort-wasm-simd-threaded-DcHrbrbl.wasm',
  'assets/subject-worker-BFhRgHye.js',
  'models/u2netp.onnx',
  'sw.js',
  'precache.json',
  'sitemap.xml',
]

describe('groupAssets', () => {
  const groups = groupAssets(BUILD)

  it('files libheif under heic', () => {
    // The mistake this is here for: `wasm-bundle` reads like the detector's
    // runtime and is libheif's two megabytes. Reading the built worker settled
    // it — heic-worker is what imports it.
    expect(groups.heic).toEqual([
      'assets/heic-BZ2l7TbD.js',
      'assets/heic-worker-B7oT4hWj.js',
      'assets/wasm-bundle-B_fo7_i4.js',
    ])
  })

  it('files the detector, its runtime and its weights under subject', () => {
    expect(groups.subject).toEqual([
      'assets/ort-wasm-simd-threaded-DcHrbrbl.wasm',
      'assets/subject-worker-BFhRgHye.js',
      'models/u2netp.onnx',
    ])
  })

  it('files LibRaw and its own worker under raw', () => {
    expect(groups.raw).toEqual([
      'assets/decode-raw-DoHRyVYN.js',
      'assets/libraw-CKnqEbQ6.wasm',
      'assets/libraw-DYlN_xHc.js',
      'assets/preview-worker-BM9OaXDH.js',
      'assets/worker-QKyN-S3h.js',
    ])
  })

  it('does not mistake another worker for LibRaw\'s', () => {
    for (const other of ['subject-worker', 'heic-worker', 'histogram-worker']) {
      expect(groups.raw, `${other} was taken for LibRaw`).not.toContain(`assets/${other}-Zz99.js`)
    }
    expect(groups.shell).toContain('assets/histogram-worker-0pN9RptU.js')
  })

  it('keeps the app in the shell', () => {
    expect(groups.shell).toContain('index.html')
    expect(groups.shell).toContain('assets/index-BaqksRcX.js')
    expect(groups.shell).toContain('assets/index-BuVPwQJm.css')
  })

  it('never caches the worker or the manifest that describe the cache', () => {
    const all = [...groups.shell, ...groups.raw, ...groups.heic, ...groups.subject]
    expect(all).not.toContain('sw.js')
    expect(all).not.toContain('precache.json')
  })

  it('accounts for every file exactly once', () => {
    const all = [...groups.shell, ...groups.raw, ...groups.heic, ...groups.subject]
    expect(new Set(all).size).toBe(all.length)
    expect(all.length).toBe(BUILD.length - 3) // sw.js, precache.json, sitemap.xml
  })
})

describe('verifyGroups', () => {
  it('passes a build that classified everything', () => {
    expect(verifyGroups(groupAssets(BUILD))).toEqual([])
  })

  it('refuses a binary that fell through to the shell', () => {
    // The exact failure that got through twice: a renamed binary lands in the
    // one group precached for every visitor, and nothing says a word.
    const renamed = BUILD.map((f) =>
      f.includes('ort-wasm') ? 'assets/onnxruntime-core-Xy12.wasm' : f,
    )
    const problems = verifyGroups(groupAssets(renamed))
    expect(problems.join(' ')).toContain('onnxruntime-core-Xy12.wasm')
    expect(problems.join(' ')).toContain('precaches it for every visitor')
  })

  it('refuses a group that has gone empty', () => {
    const withoutHeic = BUILD.filter((f) => !/heic|wasm-bundle/.test(f))
    expect(verifyGroups(groupAssets(withoutHeic)).join(' ')).toContain('"heic" group is empty')
  })
})
