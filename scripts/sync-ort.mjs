/**
 * Copies the ONNX Runtime WebAssembly out of node_modules and into `public/`,
 * where both the dev server and the build serve it from our own origin.
 *
 * It is not committed. The file is 13.6 MB, it is reproducible from the version
 * pinned in package-lock.json, and a binary that size in the history would be
 * there for good. `public/ort` is gitignored and this runs before dev and build.
 *
 * Same origin matters twice over: `public/sw.js` ignores cross-origin requests,
 * so a copy fetched from a CDN would never be cached and subject masking would
 * stop working offline — and a third party would get to see who is using it.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules/onnxruntime-web/dist')
const to = join(root, 'public/ort')

// The plain SIMD build, not the `jsep` one that carries a WebGPU backend at
// twice the size. GitHub Pages cannot send COOP/COEP, so SharedArrayBuffer is
// unavailable and the runtime falls back to one thread regardless.
const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']

await mkdir(to, { recursive: true })
for (const file of FILES) {
  try {
    await copyFile(join(from, file), join(to, file))
    const { size } = await stat(join(to, file))
    console.log(`[ort] ${file} (${(size / 1048576).toFixed(1)} MB)`)
  } catch (err) {
    console.error(`[ort] could not copy ${file} — is onnxruntime-web installed?`, err.message)
    process.exitCode = 1
  }
}
