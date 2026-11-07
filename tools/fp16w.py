# 가중치만 fp16으로 저장하고, 불러올 때 Cast로 fp32로 되돌림 (계산은 fp32 그대로)
import sys, onnx, numpy as np
from onnx import numpy_helper, helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src)
g = m.graph
new_inits, casts = [], []
n_conv = 0
for init in list(g.initializer):
    if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims)) >= 16:
        arr = numpy_helper.to_array(init)
        h = numpy_helper.from_array(arr.astype(np.float16), init.name + '__h')
        new_inits.append(h)
        casts.append(helper.make_node('Cast', [init.name + '__h'], [init.name], to=TensorProto.FLOAT, name=init.name + '__cast'))
        g.initializer.remove(init)
        n_conv += 1
g.initializer.extend(new_inits)
nodes = list(g.node)
del g.node[:]
g.node.extend(casts + nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print('converted', n_conv)
