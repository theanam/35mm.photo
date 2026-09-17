<p align="center">
  <img src="docs/logo.png" alt="35mm.photo" width="380">
</p>

<p align="center">
  A full-featured photo editor that runs entirely in your browser.<br>
  <a href="https://35mm.photo"><strong>35mm.photo</strong></a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="A raw Fujifilm file open in 35mm, with the looks grid and histogram" width="900">
</p>

---

35mm develops camera raw, grades colour on the GPU and exports — all inside the
browser tab. There is no backend and no account. Editing is non-destructive: the
pipeline is parametric end to end, so every adjustment stays adjustable and the
original file is never rewritten unless you export.

## Features

- **Camera raw development** via [LibRaw](https://www.libraw.org/) compiled to
  WebAssembly — demosaic, camera white balance, 16-bit pipeline
- **Light and colour** — exposure, contrast, highlights, shadows, whites,
  blacks, white balance, vibrance, saturation
- **Tone curves**, RGB and per-channel
- **Colour mixer** — hue, saturation and luminance across eight bands
- **Colour grading** — split toning across shadows, midtones and highlights
- **Detail** — texture, clarity, dehaze, sharpening, luminance and chroma
  noise reduction
- **Looks** — nine built-ins, plus your own imported LUTs and presets
- **Crop and straighten**, with aspect presets and rotation
- **Perspective and optics** — keystone correction, plus manual distortion and
  chromatic aberration
- **Halation, grain and vignette**
- **Live histogram and RGB parade**
- **Batch editing** — select many photos, sync settings by group, export a
  whole selection into one folder
- **Installs as a PWA** and works offline

## Formats

| | |
| --- | --- |
| **Photos** | JPEG, PNG, WEBP, AVIF, GIF, BMP |
| **Camera raw** | RAF, RW2, CR2, CR3, CRW, NEF, ARW, SR2, DNG, ORF, PEF, SRW, MRW, ERF, DCR, 3FR, MOS and others LibRaw supports |
| **Looks** | `.cube`, HALD and tiled LUT images |
| **Presets** | `.xmp` and `.lrtemplate` from Lightroom Classic / Camera Raw |
| **Camera profiles** | `.dcp` — the hue/saturation warps and tone curve are baked into a look |

A Lightroom preset imports as slider values rather than a baked cube, so
everything it sets stays editable afterwards. Whatever it uses that this
pipeline has no equivalent for — masks, camera profiles, texture, dehaze, lens
and perspective corrections — is reported on import rather than dropped in
silence.

GPR, X3F and plain RGB TIFF are not supported. They fail with a message saying
so rather than appearing to work.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
npm run preview    # serve the built bundle
npm test           # unit tests
```

`npm run build` type-checks first, so a build failure is a real failure. Tests
cover the CPU side of the pipeline — the geometry matrices, the camera-profile
parser and the LUT it bakes — and run in CI before a deploy. The GPU passes are
checked by driving the real app in a browser instead; a shader is not something
a unit test can meaningfully assert about.

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

Sliders reset on double-click or alt-click. Zoom is `ctrl`/`cmd` + scroll, or
pinch; drag to pan.

## How it is put together

```
src/
  app/          shell, layout, viewport, dialogs
  editor/
    gpu/        WebGL2 context, render graph, transforms, white balance
    shaders/    GLSL ES 3.00 passes, one file per stage
    tools/      the adjustment panels
    presets/    look catalogue, 3D LUT synthesis, curves, preset import
    edit-stack/ edit state, history, derived edit summary
  raw/          LibRaw development and the preview conversion worker
  io/           file pickers, decode, export, sidecars
  storage/      IndexedDB persistence
  pwa/          service worker registration
public/
  luts/         drop-in .cube files (see its README)
  sw.js         offline shell
brand/          brand sources and the social card's render step
```

Edit state is a single plain-JSON object. Nothing is baked into pixels until
export, so undo, the before/after split and the `.35mm.json` sidecar all fall
out of the same parametric state. Rendering is one WebGL2 graph — geometry,
colour, detail and finishing passes, with looks applied as a 3D LUT.

Raw decoding and histogram binning run in workers. The LibRaw binary is 1.4 MB
and sits behind a dynamic import, so it is fetched only when you open a raw
file.

## Deploying

`.github/workflows/deploy.yml` builds and publishes `dist/` to GitHub Pages on
every push to `main`. The site is served from an apex domain, so `base` defaults
to `/`; build with `BASE_PATH=/35mm/ npm run build` to publish under a subpath.

The custom domain is set in the repo's Pages settings, not by `public/CNAME` — a
Pages deploy from Actions ignores a `CNAME` file in the uploaded artifact.

The published site loads Google Analytics, injected at build time only when
`GA_MEASUREMENT_ID` is set. A local build has no analytics at all, and nothing
about a photo is sent anywhere.

## Not implemented

Masks and local adjustments, and a WebGPU backend — capability detection
exists, but WebGL2 is the only implemented one.

Batch export needs the File System Access API to write a folder; browsers
without it fall back to exporting one photo at a time.

Lens correction is manual only. Profile-driven correction needs Adobe's lens
profile database, which cannot be shipped with a web app, so a preset that
relies on one says so on import rather than pretending. Camera profiles are
applied as a look rather than colorimetrically: raw development has already
mapped the sensor to sRGB by the time the profile is reached, so its hue,
saturation and tone rendering carry over but its absolute colour does not.
