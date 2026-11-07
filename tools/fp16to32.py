# 16비트로 계산하는 ONNX → 저장은 16비트 그대로, 불러올 때 Cast로 32비트로 바꿔 계산 (브라우저 CPU에서도 돌게)
import sys, onnx, numpy as np
from onnx import numpy_helper, helper, TensorProto
src, dst = sys.argv[1], sys.argv[2]
m = onnx.load(src); g = m.graph
F16, F32 = TensorProto.FLOAT16, TensorProto.FLOAT
casts, newinit = [], []
for init in list(g.initializer):
    if init.data_type == F16:
        h = numpy_helper.to_array(init)
        newinit.append(numpy_helper.from_array(h, init.name + '__h'))
        casts.append(helper.make_node('Cast', [init.name + '__h'], [init.name], to=F32, name=init.name + '__c'))
        g.initializer.remove(init)
g.initializer.extend(newinit)
n_cast = n_const = 0
def fix_tensor(t):
    if t.data_type == F16:
        a = numpy_helper.to_array(t).astype(np.float32); t.CopyFrom(numpy_helper.from_array(a, t.name)); return 1
    return 0
for n in g.node:
    for a in n.attribute:
        if n.op_type == 'Cast' and a.name == 'to' and a.i == F16: a.i = F32; n_cast += 1
        if a.type == onnx.AttributeProto.TENSOR: n_const += fix_tensor(a.t)
        if a.type == onnx.AttributeProto.INT and a.name in ('dtype',) and a.i == F16: a.i = F32
for vi in list(g.value_info) + list(g.output) + list(g.input):
    if vi.type.tensor_type.elem_type == F16: vi.type.tensor_type.elem_type = F32
nodes = casts + list(g.node)
# 위상 정렬 (원본도 순서가 뒤섞여 있어요)
avail = {i.name for i in g.input} | {i.name for i in g.initializer} | {''}
order, rest = [], nodes
while rest:
    nxt = []
    for n in rest:
        if all(x in avail for x in n.input): order.append(n); avail.update(n.output)
        else: nxt.append(n)
    if len(nxt) == len(rest): raise SystemExit('cycle? ' + str([n.name for n in nxt[:5]]))
    rest = nxt
del g.node[:]; g.node.extend(order)
del g.value_info[:]
onnx.checker.check_model(m); onnx.save(m, dst)
print('ok', 'init casts', len(casts), 'cast nodes', n_cast, 'const', n_const)
