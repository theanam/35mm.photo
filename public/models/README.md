# Models

## `u2netp.onnx`

U²-Net "portable" — salient object detection, the model behind the subject
mask. 2.3 MB, 320×320 in, a single 320×320 probability map out.

| | |
| --- | --- |
| Licence | Apache-2.0 |
| Paper | Qin et al., *U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection*, Pattern Recognition 106 (2020) |
| Source | https://github.com/xuebinqin/U-2-Net |
| ONNX export | https://huggingface.co/BritishWerewolf/U-2-Netp |
| Trained on | DUTS-TR |

Committed rather than fetched, unlike the ONNX Runtime WebAssembly, which the
build emits straight out of `node_modules`. That one is reproducible from
`package-lock.json`; this is not on npm, and a build that reaches the network
for a required asset is a build that breaks the day the host does.

## Precision

The weights are **float16**, converted from the published float32 export with
`onnxconverter_common.float16` and `keep_io_types=True`, so the graph still
takes and returns float32 and nothing around it has to know. That halves the
file, 4.36 MB to 2.26 MB, for an IoU against the original of 0.97 to 0.9997 on
the frames it was checked against, and about 5% on inference — measured under
ONNX Runtime Web, single-threaded, warm-up discarded.

**Do not quantise this to int8.** It was tried. Dynamic int8 quantisation
produces a model that returns an empty mask — IoU 0.0000, entirely black
output — and runs four times slower into the bargain. U²-Net's nested RSU
blocks carry activation ranges too wide for per-tensor dynamic quantisation,
and the saving of a further megabyte is not available at any acceptable price.

See [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).

## `migan.onnx`

MI-GAN — image inpainting, the model behind the retouch brush's smart fill.
14.2 MB. Takes an RGB crop and a hole mask as bytes at any size; works on a
512×512 square around the hole and pastes the answer back, every pixel outside
the hole left as it was.

| | |
| --- | --- |
| Licence | MIT (code and weights) |
| Paper | Sargsyan et al., *MI-GAN: A Simple Baseline for Image Inpainting on Mobile Devices*, ICCV 2023 |
| Source | https://github.com/Picsart-AI-Research/MI-GAN |
| ONNX export | https://huggingface.co/andraniksargsyan/migan (`migan_pipeline_v2.onnx`) |
| Trained on | Places2, 512×512 |

The mask is 255 where the picture is known and 0 in the hole — the opposite of
what the name suggests, and the one convention there is to get wrong.

### Precision

The **weights** are float16; the arithmetic is not. The published export is
the authors' "pipeline" graph, which does its own pre- and post-processing in
float32, and `onnxconverter_common.float16` breaks on the casts inside it. So
every large constant is stored as float16 and cast back to float32 where it is
read — see `scripts/migan-fp16.py`, which reproduces this file byte for byte.
28.1 MB becomes 14.2 MB, and no output byte differs from the float32 model's
by more than one level. About 0.9 s a fill under ONNX Runtime Web,
single-threaded, whatever the size of the crop.

Chosen for size: it is the smallest of the usual inpainters by a distance —
LaMa's published export is about 200 MB, AOT-GAN's about 60 MB. It is only
asked to fill what a heal cannot; everything else never reaches it.
