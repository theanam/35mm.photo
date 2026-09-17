# 35mm

**[35mm.photo](https://35mm.photo)** — a local, no-upload photo editor. Everything
— decode, grading, export — happens in the browser tab. No backend, no accounts,
no network calls after load.

Built to `photo-editor-spec.md`, Phase 1 scope.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm run preview    # serve the built bundle
```

`npm run build` type-checks first, so a build failure is a real failure.

## Deploying

The site is served from the apex domain in `public/CNAME`, so `vite.config.ts`
defaults `base` to `/`. To publish under a subpath instead — a GitHub Pages
project site, say — build with `BASE_PATH=/35mm/ npm run build` and delete the
CNAME.

The workflow in `.github/workflows/deploy.yml` builds and publishes `dist/` on
every push to `main`. Enable Pages for the repo with "GitHub Actions" as the
source, then set the custom domain to `35mm.photo` in the repo's Pages settings
and point the DNS at GitHub:

```
A     @    185.199.108.153     (and .109, .110, .111)
AAAA  @    2606:50c0:8000::153 (and 8001, 8002, 8003 ::153)
CNAME www  <user>.github.io
```

Turn on "Enforce HTTPS" once the certificate is issued.

## Brand

The name is the 35mm film format; the mark is the frame itself — a 3:2
rectangle with a centred aperture dot, the smallest possible drawing of "a
photograph". Amber is a safelight, not a paint: it marks what is active and
nothing else. Sources, lockups, minimum sizes and the render step for the
social card live in [`brand/`](brand/).

## Metadata

`index.html` carries the search and sharing tags: title, description, canonical,
`robots`, Open Graph and Twitter cards (both spelled out — X falls back to
`og:*`, but Slack, Discord and iMessage read the explicit ones), the installed-app
chrome, and a `WebApplication` JSON-LD block. The card art is `public/og.png`,
regenerated from `brand/og.html`.

All the absolute URLs point at the apex domain, matching `public/CNAME`. A
`BASE_PATH` subpath build serves them unchanged, so repoint the canonical,
`og:url`, JSON-LD and `SITE` in `vite.config.ts` together if the domain ever
goes away.

## How it is put together

```
src/
  app/                 shell, layout, viewport, dialogs
  editor/
    gpu/               WebGL2 context, render graph, transforms, white balance
    shaders/           GLSL ES 3.00 passes, one file per stage
    tools/             the adjustment panels
    presets/           look catalogue, 3D LUT synthesis, .cube parser, curves
    edit-stack/        edit state, history, derived edit summary
  raw/                 raw decode worker and its libraw seam
  io/                  file pickers, decode, export, sidecars
  storage/             IndexedDB persistence
  pwa/                 service worker registration
public/
  luts/                drop-in .cube files (see its README)
  sw.js                offline shell
  icon*.svg, og.png    the marks and the social card
  robots.txt           crawl policy; points at the generated sitemap
brand/                 brand sources and the card's render step
```

`sitemap.xml` is not checked in — `vite.config.ts` emits it at build time so its
`lastmod` tracks the deploy rather than rotting at a hardcoded date.

### Non-destructive by construction

`EditState` is plain JSON. Nothing is ever baked into pixels until export, undo
and redo are stack operations over whole states, and the "YOUR EDITS" strip is
*derived* from the parameters rather than stored alongside them — so it cannot
drift out of sync with what the photo actually shows.

Edits autosave to IndexedDB against a file-identity key, and can be written out
as a `.35mm.json` sidecar to move a look between photos or machines.

### The render graph

One WebGL2 context drives both the preview and the export; only the size of the
drawing buffer differs. Per frame:

```
source texture
  → colour pass   white balance → exposure → tone → curves → HSL → saturation
                  → look LUT (3D texture, hardware trilinear)
  → blur passes   separable Gaussian at two radii (only if detail work is on)
  → detail pass   denoise → clarity → sharpen
  → finish pass   grain → vignette
  → canvas
```

Crop, straighten, 90° steps, flips **and EXIF orientation** are folded into a
single `mat3` applied to the UV in the vertex shader, so geometry costs nothing
beyond the sample it was already going to take.

### Orientation

Cameras and phones record the sensor readout unrotated and note how to turn it in
an EXIF tag, and browsers disagree about whether `createImageBitmap` applies that
tag — the spec's default changed from `none` to `from-image` partway through. So
35mm reads the tag itself (`src/io/exif.ts`, covering JPEG APP1, PNG `eXIf` and
WebP `EXIF`, both byte orders), asks the decoder explicitly *not* to apply it, and
undoes it in the render graph alongside the user's own crop and rotation.

`ImageMeta.width`/`height` are always the **upright** dimensions, so nothing above
the render graph has to think about how the file happens to be stored. If a
decoder rotates anyway, the dimensions recorded in the file catch it and the tag
is treated as already applied.

Split compare runs the chain a second time with the adjustments zeroed, scissored
to the left of the handle. The scissor is applied to the *final* pass only —
clipping the intermediate targets would leave the blur taps beside the split
reading stale pixels.

### Looks

A look is a compound effect, not an overlay: a base colour transform baked into
a 33³ LUT, a tone curve, an optional monochrome mix, and grain sized per look.
Monochrome looks contrast a channel-weighted luminance *before* desaturating,
rather than flattening to grey.

The nine built-ins are synthesised from parameters at runtime, so the repo ships
no third-party LUT data. `public/luts/README.md` covers dropping in real `.cube`
files.

### Off the main thread

Histogram binning and raw decoding both run in workers. The histogram is
throttled behind the preview and rendered at 192px, so dragging a slider never
waits on it.

## Layout

- **Top bar** — file, save, export.
- **Tool bar** — geometry tools. Picking one opens a drawer directly beneath it
  with that tool's controls and its own apply (✓) and discard (✕) buttons.
  Opening a tool snapshots the edit state; discard restores it, apply keeps it,
  and both close the drawer. Enter applies, Escape discards. Only **Crop** is up
  here today — add an id to `TOOLBAR_TOOL_IDS` in
  `src/editor/tools/registry.tsx` to promote another tool, and nothing else
  needs to change.
- **Right rail** — the continuous colour and contrast adjustments: histogram,
  looks, light & colour, curves, colour mixer, detail, grain. These stay open
  while you work rather than being committed and dismissed.
- **Bottom bar** — zoom and the before/after split, nothing else.

The chip strip in the tool bar lists what is currently applied, in pipeline
order; clicking a chip jumps to whichever control owns it, drawer or rail.

### Button states

Toggles have three visually distinct states, and *off must never read as
disabled*: off is a normal surface with full-contrast text, on is filled with
the accent tint and outlined in the accent colour, and disabled is dimmed to
35%. The same rule applies to the aspect and preset chips.

## Keyboard

| | |
|---|---|
| `⌘Z` / `⌘⇧Z` | undo / redo |
| `⌘O` | open photos |
| `⌘E` | export |
| `⌘C` / `⌘V` | copy / paste look |
| `\` | before/after split |
| `C` | crop |
| `F` / `1` | fit / 100% |
| `←` `→` | previous / next photo |
| `[` `]` | cycle looks |

Sliders reset on double-click or alt-click.

## Scope

Phase 1 of the spec, in full: import and export of browser-decodable formats,
the light/colour/curves/mixer/detail/grain toolset, crop and straighten, nine
looks, the non-destructive edit stack with local save and load, live histogram
and RGB parade, and the PWA offline shell.

**Not yet implemented — Phase 2 in the spec:**

- **RAW decode.** `src/raw/decoder-worker.ts` is wired end to end and waits on a
  libraw WASM build under `src/raw/wasm/` exporting `decodeRawBuffer()`. Until
  one is vendored, opening a raw file reports the format as undecodable rather
  than silently editing its embedded JPEG preview, which the spec rules out
  (§5.4). TIFF goes through the same path for the same reason: no browser
  decodes it reliably.
- **WebGPU backend.** Capability detection is in `src/editor/gpu/caps.ts`;
  WebGL2 is the only implemented backend.
- **Halation, perspective correction, batch editing.** Phase 2/3 in the spec.
