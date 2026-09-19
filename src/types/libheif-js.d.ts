/**
 * `libheif-js` ships no types of its own, and only the sliver of its surface
 * that `io/heic-worker.ts` touches is described here.
 *
 * The `wasm-bundle` entry is the one with the WASM inlined into the JavaScript
 * rather than sitting beside it as a separate asset — see the note in the
 * worker for why that distinction is the one that matters to a bundler.
 */
declare module 'libheif-js/wasm-bundle' {
  export interface HeifImage {
    get_width(): number
    get_height(): number
    /** Fills the `ImageData` with RGBA, then calls back with it — or with null. */
    display(into: ImageData, done: (out: ImageData | null) => void): void
    /** Releases the handle into WASM memory. Absent in some builds. */
    free?(): void
  }

  export class HeifDecoder {
    /** Every image item in the container, the primary one first. */
    decode(bytes: Uint8Array | ArrayBuffer): HeifImage[]
  }

  const libheif: { HeifDecoder: typeof HeifDecoder }
  export default libheif
}
