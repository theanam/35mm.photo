# Models

## `u2netp.onnx`

U²-Net "portable" — salient object detection, the model behind the subject
mask. 4.4 MB, 320×320 in, a single 320×320 probability map out.

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

It is float32. Quantising to int8 would take it to roughly 1.2 MB — worth doing,
and it needs a Python toolchain this repository does not otherwise require.

See [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md).
