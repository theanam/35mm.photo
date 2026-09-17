# 35mm

**[35mm.photo](https://35mm.photo)** — a full-featured photo editor in your
browser. Camera raw development, GPU colour grading, curves, an HSL mixer, crop
and export all happen in the browser tab: nothing to install, no account to
make.

The published site loads Google Analytics; see [Analytics](#analytics). Nothing
about a photo is sent anywhere, and a local build has no analytics at all.

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

The site is served from an apex domain, so `vite.config.ts` defaults `base` to
`/`. To publish under a subpath instead — a GitHub Pages project site, say —
build with `BASE_PATH=/35mm/ npm run build`.

**The custom domain is set in the repo's Pages settings, not by `public/CNAME`.**
Publishing from a GitHub Actions workflow ignores a `CNAME` file in the uploaded
artifact ("no `CNAME` file is created, and any existing `CNAME` file is ignored
and is not required" — GitHub's docs). The file is kept only so a fallback to
branch-based publishing would still carry the domain. If the site answers 404
over plain HTTP and serves a `*.github.io` certificate, the Custom domain field
is empty, whatever DNS says.

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

## Analytics

Google Analytics ships on the published site only. `vite.config.ts` injects the
tag at build time when `GA_MEASUREMENT_ID` is set, and the deploy workflow is
the only thing that sets it — `npm run build` on a laptop, a `BASE_PATH` subpath
build and any fork all produce an untagged page, and the dev server never
injects it at all.

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
    presets/           look catalogue, 3D LUT synthesis, curves
      import/          .cube, LUT images, .xmp and .lrtemplate readers
    edit-stack/        edit state, history, derived edit summary
  raw/                 LibRaw development and the preview conversion worker
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

### Importing LUTs and presets

Your own presets sit in the Looks panel beside the built-ins. Pick **Import…**,
or drop the files anywhere on the window — a drop can carry a preset pack and
the photo to try it on at once. Files are parsed in the tab and kept in
IndexedDB; nothing is uploaded, which is the point of being able to open a
bought preset pack in a browser at all.

Two kinds of thing get called a filter, and they land in different places:

| Format | Kind | Becomes |
| --- | --- | --- |
| `.cube` (3D, and 1D as three channel curves) | LUT | a look with a strength slider |
| LUT images — HALD or tiled strip `.png`/`.jpg`/`.webp` | LUT | the same |
| `.xmp` — Lightroom Classic / Camera Raw, 2018→now | parametric | slider values on the edit stack |
| `.lrtemplate` — Lightroom before 2018 | parametric | the same |

A **LUT** is a baked cube: blendable, but not otherwise editable. A
**parametric** preset is slider values, so once applied every one of them stays
adjustable in the panels where it belongs. Camera Raw's field names line up
closely with `EditState` — `Exposure2012` is already EV, and the tone controls
and the eight HSL bands are already −100..100 in the same order — so most of
`presets/import/crs.ts` is range conversion rather than translation. Both
readers share it, because `.xmp` and `.lrtemplate` disagree only about the
container: XML/RDF on one side, a Lua table on the other.

**Split toning and colour grading** both land in the Colour grading panel.
Lightroom's legacy `SplitToning*` keys and its newer `ColorGrade*` set are the
same control with a different face, so they share one destination and the modern
keys win where a preset carries both. A wheel with no saturation is how
Lightroom stores "untouched", so hue alone imports as nothing.

**The parametric curve** has no counterpart here — this pipeline has one curve,
Lightroom has two stacked. Rather than drop it, the four region sliders are
evaluated over their split points and composed onto the point curve, so the
single curve that results does what both did. It is anchored in the corners the
way Camera Raw anchors its own: a shadow lift raises near-black without moving
black itself. The falloff is a raised cosine rather than Adobe's exact
undocumented curve — right in direction and rough magnitude, which is what makes
an imported preset still look like itself.

Anything Lightroom can do that this pipeline still cannot — masks, profiles,
texture, dehaze, calibration, lens and perspective corrections — is collected as
it is read and reported on import. A preset that half-applied without saying so
would be worse than one that refused.

**Input space.** A large share of `.cube` files sold as cinematic looks are
built for log footage rather than for display-referred pixels, and feeding sRGB
into a log LUT is what produces the familiar milky result. Each imported LUT
carries the space it expects — sRGB, Rec.709, S-Log3, V-Log, C-Log3 or LogC3 —
guessed from its filename and changeable from the picker beside the strength
slider. Changing it resamples the cube through that curve into an ordinary
sRGB-in LUT, so the shader never learns about input spaces and the lookup stays
one texture fetch.

**LUT images** carry no header saying how they are packed, and a 512×512 file is
equally plausibly a HALD CLUT or an 8×8 grid of blue slices. Ambiguous images
are unpacked both ways and scored on smoothness along each axis: a correctly
read cube is smooth, a mis-read one is an order of magnitude rougher.

### Camera raw

Raw files are developed by [LibRaw](https://www.libraw.org/) compiled to
WebAssembly, via `libraw-wasm`. The binary is 1.4 MB and sits behind a dynamic
import, so it is fetched the first time someone opens a raw file and never for
anyone who only edits JPEGs.

Development settings are deliberately plain, because they decide what a file
looks like before the edit stack has touched it: the camera's own white balance,
AHD demosaic (LibRaw routes X-Trans past that to Markesteijn on its own), and
**no auto-brightening** — that last one is a per-file histogram guess, and the
Light tool is where the decision belongs. Expect files to open darker than a
converter that does brighten, and flatter than the camera's own JPEG.

LibRaw is left to apply the camera's rotation rather than `io/exif.ts`. Every
vendor records orientation somewhere different and RAF is not a TIFF container
at all, so the pixels arrive upright and `orientation` is reported as 1.

Verified against CC0 sample files from [raw.pixls.us](https://raw.pixls.us):

| Works | RAF (X-Trans), RW2, CR2, CR3, CRW, NEF, ARW, SR2, DNG, ORF, PEF, SRW, MRW, ERF, DCR, 3FR, MOS |
| --- | --- |
| **Does not** | **GPR** (GoPro's VC-5 needs a separate SDK), **X3F** (Sigma Foveon), and **plain RGB TIFF** — LibRaw is a raw library, so an ordinary TIFF is not something it develops |

The extensions that do not work are still routed to the decoder rather than
rejected up front, so they fail with `RawDecodeError` and a message naming the
file, instead of being turned away as an unknown format.

`libraw-wasm` never rejects when its worker fails to load — the call simply
never settles, and because it serialises every later call behind that one, a
decoder that cannot start would wedge the app silently for the rest of the
session. `decode-raw.ts` therefore races each call against a timeout and
disposes the instance if it wins. Relatedly, `optimizeDeps.exclude` in
`vite.config.ts` keeps the package unbundled: pre-bundling moves it into
`.vite/deps` without its sibling `worker.js`, which 404s the worker in dev while
leaving the production build working.

### Off the main thread

Histogram binning and raw decoding both run in workers. The histogram is
throttled behind the preview and rendered at 192px, so dragging a slider never
waits on it.

Raw costs two workers rather than one. `libraw-wasm` brings its own, which is
where the decode happens; `raw/preview-worker.ts` is ours, and does nothing but
rewrite LibRaw's packed 16-bit output into the 8-bit RGBA an `ImageBitmap`
wants. That rewrite is one pass over every pixel — 81 megapixels for a
high-res Panasonic frame — and on the main thread it stalled the tab outright.
Both the buffer in and the bitmap out are transferred, so neither hop copies.

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

### Navigating the viewport

**Zoom** is `ctrl`/`cmd` + scroll, the same gesture every other editor uses.
Scrolling up zooms in. Plain scroll is deliberately left alone so it pans the
stage — binding zoom to the bare wheel makes a photo lurch whenever someone
means to scroll. A trackpad pinch already arrives as `ctrl`+wheel, so laptops
get pinch-to-zoom from the same path.

Zoom is anchored on the point under the cursor: that point stays put as the
picture grows around it. Zooming out stops at fit rather than going smaller, and
returns the viewport to `fit` so it keeps tracking window resizes.

**Touch** is handled directly rather than left to the browser: one finger pans
when the image is larger than the stage, two fingers pinch to zoom and drag to
pan together, and lifting one finger of a pinch hands the gesture to the other
without a jump. The stage sets `touch-action: none` so the browser cannot claim
the gesture for scrolling or page zoom first.

Panning is suppressed while the crop tool is open so it cannot fight the crop
box, though zooming still works there.

The zoom anchor is held for the whole wheel gesture rather than re-derived each
notch. While the image still fits the stage there is no scroll range to correct
with, so the early notches cannot hold the point; keeping the original target
means the correction snaps back to the point you aimed at as soon as scrolling
becomes possible. Re-deriving each notch instead leaves a permanent drift —
about 200px at 8x in testing.

### Tablets

The layout stacks below 900px so iPad portrait (768pt) gets a full-width
viewport with the rail beneath it rather than three squeezed columns. Coarse
pointers get larger hit targets — crop handles, the split handle, slider tracks,
icon buttons and colour bands all grow under `@media (pointer: coarse)`.

iOS has no File System Access API, so opening and saving fall back to the file
input and a download; that path is feature-detected, not sniffed. Heights use
`dvh` where supported, since Safari's collapsing toolbar makes percentage
heights jump.

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
camera raw development,
the light/colour/curves/mixer/detail/grain toolset, crop and straighten, nine
looks plus import of `.cube`, LUT image, `.xmp` and `.lrtemplate` presets, the
non-destructive edit stack with local save and load, live histogram and RGB
parade, and the PWA offline shell.

**Not yet implemented — Phase 2 in the spec:**

- **WebGPU backend.** Capability detection is in `src/editor/gpu/caps.ts`;
  WebGL2 is the only implemented backend.
- **Halation, perspective correction, batch editing.** Phase 2/3 in the spec.
- **More preset formats.** `.3dl` and ASC CDL are small additions to
  `presets/import/`; `.dcp`/`.dng` camera profiles — what film-emulation
  *profiles* actually are — are a much larger one, being binary TIFF with
  HueSatMap and LookTable interpolation.
