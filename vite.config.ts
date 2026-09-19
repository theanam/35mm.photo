import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const SITE = 'https://35mm.photo/'

/**
 * One page, so the sitemap is one URL. `lastmod` is taken from the build rather
 * than checked in: every deploy is a push to main, so the build date and the
 * last content change are the same thing, and a hardcoded date would rot.
 *
 * The URL is the apex domain, matching the hardcoded canonical and og:url in
 * index.html. A BASE_PATH subpath build serves these unchanged, so point them
 * all at the new origin if the custom domain ever goes away.
 */
function sitemap(): Plugin {
  return {
    name: '35mm:sitemap',
    apply: 'build',
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source:
          '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          '  <url>\n' +
          `    <loc>${SITE}</loc>\n` +
          `    <lastmod>${lastmod}</lastmod>\n` +
          '  </url>\n' +
          '</urlset>\n',
      })
    },
  }
}

/**
 * Google Analytics, injected at build time and only when GA_MEASUREMENT_ID is
 * set. The Pages deploy workflow sets it; nothing else does, so `npm run build`
 * on a laptop, a BASE_PATH subpath build and any fork all stay untagged. The
 * `apply: 'build'` keeps it out of the dev server regardless.
 */
function analytics(id: string | undefined): Plugin {
  if (id && !/^G-[A-Z0-9]+$/.test(id)) {
    throw new Error(`GA_MEASUREMENT_ID is not a measurement id: ${id}`)
  }

  return {
    name: '35mm:analytics',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () =>
        id
          ? [
              {
                tag: 'script',
                attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
                injectTo: 'head' as const,
              },
              {
                tag: 'script',
                children:
                  'window.dataLayer = window.dataLayer || [];\n' +
                  'function gtag(){dataLayer.push(arguments);}\n' +
                  "gtag('js', new Date());\n" +
                  `gtag('config', '${id}');`,
                injectTo: 'head' as const,
              },
            ]
          : [],
    },
  }
}

// The site lives at its own apex domain, so the built bundle is served from the
// root. Override with BASE_PATH (e.g. '/35mm/') to publish under a subpath
// instead, such as a GitHub Pages project site. Dev always serves from the root.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : (process.env.BASE_PATH ?? '/'),
  plugins: [react(), sitemap(), analytics(process.env.GA_MEASUREMENT_ID)],
  worker: { format: 'es' },
  /**
   * libraw-wasm starts its decoder with `new Worker(new URL('./worker.js',
   * import.meta.url))`. Pre-bundling rewrites the package into .vite/deps but
   * leaves that sibling behind, so the URL resolves to a file that is not there
   * and the worker 404s — in dev only; the production build resolves it fine.
   * Serving the package unbundled keeps the two files next to each other.
   *
   * onnxruntime-web is here for exactly the same reason, and it fails more
   * quietly: its WebAssembly is a sibling of the module, the optimizer leaves
   * it behind, and the dev server answers the request with index.html rather
   * than a 404 — so the runtime receives an HTML page where a module should be
   * and reports something unrelated. Also dev-only; the build emits the 13.6 MB
   * artefact correctly either way.
   */
  optimizeDeps: { exclude: ['libraw-wasm', 'onnxruntime-web'] },
  build: { target: 'es2022', assetsInlineLimit: 0 },
}))
