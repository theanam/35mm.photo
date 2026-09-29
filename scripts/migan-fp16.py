"""
Store MI-GAN's weights as float16, for public/models/migan.onnx.

    pip install onnx numpy
    curl -L -o migan_pipeline_v2.onnx \
      https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx
    python scripts/migan-fp16.py migan_pipeline_v2.onnx public/models/migan.onnx

Weights only. The graph is the authors' "pipeline" export, which does its own
pre- and post-processing in float32 around the network, and the stock
float16 converter breaks on the casts inside it. So every large float32
constant is stored as float16 and cast back to float32 where it is read:
the file halves and the arithmetic does not change. Against the float32
original, no output byte differs by more than one level.
"""

import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

# Biases and scalars are left alone; they are a rounding error of the file.
MIN_ELEMENTS = 256

source, dest = sys.argv[1], sys.argv[2]
model = onnx.load(source)
graph = model.graph
casts = []

for tensor in list(graph.initializer):
    array = numpy_helper.to_array(tensor)
    if array.dtype != np.float32 or array.size < MIN_ELEMENTS:
        continue
    graph.initializer.remove(tensor)
    graph.initializer.append(numpy_helper.from_array(array.astype(np.float16), tensor.name + "_f16"))
    casts.append(helper.make_node("Cast", [tensor.name + "_f16"], [tensor.name], to=TensorProto.FLOAT, name="w16_" + tensor.name))

nodes = list(graph.node)
del graph.node[:]
graph.node.extend(casts)
for node in nodes:
    graph.node.append(node)
    if node.op_type != "Constant" or node.attribute[0].name != "value":
        continue
    array = numpy_helper.to_array(node.attribute[0].t)
    if array.dtype != np.float32 or array.size < MIN_ELEMENTS:
        continue
    name = node.output[0]
    node.output[0] = name + "_f16"
    node.attribute[0].t.CopyFrom(numpy_helper.from_array(array.astype(np.float16), name + "_f16"))
    graph.node.append(helper.make_node("Cast", [name + "_f16"], [name], to=TensorProto.FLOAT, name="w16_" + name))

onnx.checker.check_model(model)
onnx.save(model, dest)
