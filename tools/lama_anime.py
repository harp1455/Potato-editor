# AI 지우개 모델 만들기: LaMa ONNX(Carve/LaMa-ONNX, Apache-2.0)의 그래프에
# 애니·만화용으로 다시 학습한 가중치(dreMaz/AnimeMangaInpainting, MIT)를 넣고, 가중치를 fp16으로 줄여 저장해요
#   python tools/lama_anime.py <lama_fp32.onnx> <lama_large_512px.ckpt> <out.onnx>
# ONNX 쪽은 몇몇 합성곱에 BatchNorm이 합쳐져(onnx::Conv_*) 있어서, 같은 방식으로 합쳐 넣어요.
# 체크포인트는 torch 없이 읽어요 (텐서만 허용하는 좁은 unpickler)
import io, os, pickle, subprocess, sys, zipfile
from collections import OrderedDict
import numpy as np, onnx
from onnx import numpy_helper

DT = {'FloatStorage': np.float32, 'HalfStorage': np.float16, 'DoubleStorage': np.float64, 'LongStorage': np.int64, 'IntStorage': np.int32, 'BoolStorage': np.bool_}


class _Kind:  # torch 저장소 종류 (FloatStorage 등) → numpy 자료형
    def __init__(self, name): self.dtype = DT[name]


def load_ckpt(path):
    z = zipfile.ZipFile(path); pkl = next(n for n in z.namelist() if n.endswith('/data.pkl')); pre = pkl[:-len('data.pkl')]

    def rebuild(a, offset, size, stride, *_):
        if not size: return a[offset:offset + 1].reshape(())
        return np.lib.stride_tricks.as_strided(a[offset:], shape=tuple(size), strides=tuple(s * a.itemsize for s in stride)).copy()

    class U(pickle.Unpickler):
        def find_class(self, mod, name):
            if (mod, name) == ('collections', 'OrderedDict'): return OrderedDict
            if (mod, name) in (('torch._utils', '_rebuild_tensor_v2'), ('torch._utils', '_rebuild_tensor')): return rebuild
            if mod == 'torch' and name in DT: return _Kind(name)
            raise pickle.UnpicklingError(f'허용하지 않는 내용: {mod}.{name}')

        def persistent_load(self, pid):
            return np.frombuffer(z.read(f'{pre}data/{pid[2]}'), dtype=pid[1].dtype)

    return U(io.BytesIO(z.read(pkl))).load()


def main(src, ckpt, dst):
    ck = load_ckpt(ckpt)
    ck = ck['gen_state_dict'] if 'gen_state_dict' in ck else ck
    ck = {k: np.asarray(v, np.float32) for k, v in ck.items() if not k.endswith('num_batches_tracked')}
    m = onnx.load(src); inits = {t.name: t for t in m.graph.initializer}; used = set()

    def setw(name, arr):
        t = inits[name]; old = numpy_helper.to_array(t)
        assert old.shape == arr.shape, (name, old.shape, arr.shape)
        t.CopyFrom(numpy_helper.from_array(arr.astype(np.float32), name))

    for k in inits:
        if k.startswith('model.generator.'):
            kk = k[len('model.generator.'):]; setw(k, ck[kk]); used.add(kk)
    for nd in m.graph.node:  # BatchNorm이 합쳐진 합성곱
        if nd.op_type not in ('Conv', 'ConvTranspose'): continue
        ws = [i for i in nd.input[1:] if i in inits]
        if not any(w.startswith('onnx::') for w in ws): continue
        mod = nd.name.replace('/generator/model/', '').rsplit('/', 1)[0].replace('/', '.').replace('.conv1.conv1.0', '.conv1.0')
        if mod.endswith('.ffc.convl2l'): bn = mod[:-len('.ffc.convl2l')] + '.bn_l'
        elif mod.endswith('.ffc.convl2g'): bn = mod[:-len('.ffc.convl2g')] + '.bn_g'
        elif mod.endswith('.conv1.0'): bn = mod[:-2] + '.1'
        elif mod.endswith('.fu.conv_layer'): bn = mod[:-len('.conv_layer')] + '.bn'
        else: raise SystemExit('모르는 층: ' + mod)
        W = ck[mod + '.weight']; s = ck[bn + '.weight'] / np.sqrt(ck[bn + '.running_var'] + 1e-5)
        cb = ck.get(mod + '.bias', np.zeros(W.shape[0], np.float32))
        setw(ws[0], W * s[:, None, None, None]); setw(ws[1], (cb - ck[bn + '.running_mean']) * s + ck[bn + '.bias'])
        used |= {mod + '.weight', mod + '.bias', bn + '.weight', bn + '.bias', bn + '.running_mean', bn + '.running_var'}
    left = [k for k in ck if k not in used]
    if left: raise SystemExit(f'안 쓴 가중치가 있어요: {left[:5]}')
    tmp = dst + '.fp32.onnx'; onnx.save(m, tmp)
    subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fp16w.py'), tmp, dst], check=True)
    os.remove(tmp)


if __name__ == '__main__':
    main(*sys.argv[1:4])
