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
