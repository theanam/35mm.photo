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

// The site lives at its own apex domain, so the built bundle is served from the
// root. Override with BASE_PATH (e.g. '/35mm/') to publish under a subpath
// instead, such as a GitHub Pages project site. Dev always serves from the root.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : (process.env.BASE_PATH ?? '/'),
  plugins: [react(), sitemap()],
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
}))
