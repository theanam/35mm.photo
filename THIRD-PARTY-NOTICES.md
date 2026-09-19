# Third-party notices

35mm itself is MIT licensed — see [LICENSE](LICENSE). This file covers the
third-party code that is **distributed as part of the built application**, and
the obligations that come with it.

Two of the decoders are copyleft (LGPL). That is compatible with an MIT
application and does not make 35mm itself LGPL, but it does carry conditions,
which the [Copyleft obligations](#copyleft-obligations) section sets out.

Build-time tooling — Vite, TypeScript, Vitest, esbuild, Rollup and their
dependencies — is not covered here. None of it is shipped to the browser.

---

## Shipped at runtime

| Component | Version | Licence | Upstream |
| --- | --- | --- | --- |
| [libheif](https://github.com/strukturag/libheif) (via [libheif-js](https://github.com/catdad-experiments/libheif-js)) | 1.23.2 | **LGPL-3.0-or-later** | strukturag/libheif |
| [libde265](https://github.com/strukturag/libde265) (inside the libheif build) | bundled | **LGPL-3.0-or-later** | strukturag/libde265 |
| [LibRaw](https://www.libraw.org/) (via [libraw-wasm](https://github.com/ybouane/LibRaw-Wasm)) | 1.6.0 wrapper | **LGPL-2.1-or-later or CDDL-1.0** | LibRaw/LibRaw |
| [React](https://react.dev/) and React DOM | 18.3.1 | MIT | facebook/react |
| [zustand](https://github.com/pmndrs/zustand) | 4.5.7 | MIT | pmndrs/zustand |
| [ONNX Runtime Web](https://onnxruntime.ai/) | 1.30.0 | MIT | microsoft/onnxruntime |
| [U²-Netp](https://github.com/xuebinqin/U-2-Net) weights (`public/models/u2netp.onnx`) | — | **Apache-2.0** | xuebinqin/U-2-Net |

### A note on the LibRaw wrapper

The npm package `libraw-wasm` declares `"license": "ISC"` in its
`package.json`, and its GitHub repository carries no licence file at all.
That declaration covers the author's own wrapper code; it cannot and does not
relicense LibRaw, which is compiled into the `libraw.wasm` the package ships.

LibRaw is distributed by its authors under a choice of **LGPL-2.1-or-later** or
**CDDL-1.0**. 35mm treats the shipped `libraw.wasm` as LGPL-2.1, which is the
more demanding of the two, and meets the conditions below on that basis.

### The subject-detection model

`public/models/u2netp.onnx` is U²-Net "portable", from Qin et al., *U²-Net:
Going Deeper with Nested U-Structure for Salient Object Detection* (Pattern
Recognition 106, 2020), released by its authors under **Apache-2.0**. The ONNX
conversion used here comes from
[BritishWerewolf/U-2-Netp](https://huggingface.co/BritishWerewolf/U-2-Netp),
also Apache-2.0. It was trained on DUTS-TR.

Apache-2.0 asks that the licence travel with the work, that changes be stated,
and that any NOTICE file be preserved. The change here, stated: the weights are
converted from the published float32 export to float16, which halves the file
and leaves the output all but identical. Nothing else is altered.

This model was chosen partly *because* of its licence. The obvious alternatives
for this kind of task — NVIDIA's SegFormer checkpoints in particular — are
released for non-commercial research use, and could not be distributed from
this repository at all: MIT grants downstream users commercial rights that
35mm would not itself hold, and a project cannot pass on what it was never
given. No amount of the project being unpaid changes that.

The ONNX Runtime WebAssembly is **not** committed. The build emits it from
`node_modules` as an ordinary hashed asset, so it is reproducible from the
version pinned in `package-lock.json` and 13.6 MB never enters the history.

35mm imports the `onnxruntime-web/wasm` entry point rather than the default
one. The default carries the WebGPU build as well, at 28 MB against this one's
13.6 MB, for a backend nothing here asks for.

### What is *not* shipped

The libheif build used here is **decode-only**. It contains libde265 (an
LGPL-3.0 HEVC *decoder*) and does not contain x265, aom, dav1d, kvazaar, SVT or
any other encoder. This matters: x265 is GPL-2.0, and linking it would impose
GPL terms on the whole application. It is absent, and the HEIC path must stay
decode-only for that reason. Verified against the shipped `libheif.wasm`.

---

## Copyleft obligations

Both LGPL licences permit use by an application under any licence, including
MIT, provided the following hold. They do, and here is how.

**1 — Notice.** Users must be told the libraries are used and are LGPL. 35mm
says so in the About dialog, in the README, and in this file.

**2 — Licence text.** The full licence texts travel with the packages, in
`node_modules/libheif-js/LICENSE` and the libheif source tree. They are
reproduced upstream at
[LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.html) and
[LGPL-2.1](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html).

**3 — Relinking.** LGPL-3.0 §4(d) and LGPL-2.1 §6 require that a user be able
to replace the library with their own modified build and still run the
application.

35mm satisfies this by being wholly open: every line of the application is MIT
at [35mm.photo's repository](https://github.com/theanam/35mm.photo), the
dependency versions are pinned in `package-lock.json`, and anyone may swap
either decoder for a build of their own and run `npm run build`. Neither
library is modified — both are consumed as published npm artefacts.

> **If 35mm ever ships without its source**, this arrangement stops being
> sufficient. The HEIC decoder in particular is imported as
> `libheif-js/wasm-bundle`, which inlines the WebAssembly into the JavaScript
> as base64 rather than leaving it a separate, swappable file. That was a build
> decision (see the note in `src/io/heic-worker.ts`), not a licensing one. A
> closed-source distribution would need to switch to the `libheif-js/wasm`
> entry point, which keeps `libheif.wasm` a separate artefact a user can
> replace, and to ship LibRaw's `libraw.wasm` the same way.

**4 — No further restriction.** 35mm adds no terms to either library and does
not attempt to sublicense them.

---

## Formats and patents

HEIC images are HEVC-coded, and HEVC is patent-encumbered. 35mm decodes HEIC
in software on the user's own machine and never encodes it. This is the same
reason Chrome, Edge and Firefox decline to ship an HEIC decoder at all, and
anyone redistributing 35mm — or shipping it as a packaged application in a
jurisdiction where those patents are enforced — should reach their own view
rather than relying on this note.

---

## Adding a dependency

Anything that reaches the browser belongs in the table above, with its licence
checked against the package's own metadata **and** against what the artefact
actually contains. The LibRaw entry above is the reason for that second check:
a wrapper's declared licence can understate what it bundles.

Machine-learning model weights count as shipped components and are held to the
same standard. A weight file's licence is the one its publisher states, which
is frequently *not* the licence of the code that trained it — several widely
used segmentation models are released for non-commercial research use only,
and those cannot be distributed from an MIT repository, because MIT grants
downstream users commercial rights this project would not hold.
