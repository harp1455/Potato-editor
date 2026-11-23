# 인물 나누기 팩 만들기: 애니 인물 찾기 모델(CartoonSegmentation의 RTMDet-L, MIT)을 받아 ONNX로 바꾸고 gz로 묶어요.
#   python v2/tools/make_people_pack.py 나올폴더
# 원본: https://huggingface.co/dreMaz/AnimeInstanceSegmentation (rtmdetl_e60.ckpt)
# 뼈대+목+머리의 날것 결과만 내보내요. 상자 풀기, 겹침 지우기, 마스크 조립은 편집기(core/ai.js의 peopleMasks)가 해요.
# mmcv의 연산 묶음(mmcv.ops)은 내보낼 때 쓰이지 않아서 빈 껍데기로 대신해요 (mmcv-lite만 있으면 돼요).
import gzip, hashlib, json, os, urllib.request
import sys, types, importlib, importlib.abc, importlib.machinery
import torch, torchvision

class _Dummy:
    def __init__(self, *a, **k): pass
    def __call__(self, *a, **k): raise RuntimeError('mmcv.ops 없음')
class _Ops(types.ModuleType):
    __path__ = []
    def __getattr__(self, n):
        if n.startswith('__'): raise AttributeError(n)
        return type(n, (torch.nn.Module,), {}) if n[0].isupper() else _Dummy()
class _Finder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path, target=None):
        if name == 'mmcv.ops' or name.startswith('mmcv.ops.'): return importlib.machinery.ModuleSpec(name, self, is_package=True)
    def create_module(self, spec): return _Ops(spec.name)
    def exec_module(self, m): pass
sys.meta_path.insert(0, _Finder())

from mmengine.config import Config
from mmengine.registry import init_default_scope
import mmdet, os
init_default_scope('mmdet')
from mmdet.registry import MODELS
cfgp = os.path.join(os.path.dirname(mmdet.__file__), '.mim', 'configs', 'rtmdet', 'rtmdet-ins_l_8xb32-300e_coco.py')
cfg = Config.fromfile(cfgp); cfg.model.bbox_head.num_classes = 1
for k in ('backbone', 'neck'):
    if 'init_cfg' in cfg.model[k]: cfg.model[k].init_cfg = None
def fix(d):
    if isinstance(d, dict):
        if d.get('type') == 'SyncBN': d['type'] = 'BN'
        for v in d.values(): fix(v)
    elif isinstance(d, (list, tuple)):
        for v in d: fix(v)
fix(cfg.model)
model = MODELS.build(cfg.model)
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); CK = os.path.join(OUT, 'rtmdetl_e60.ckpt'); ONNX = os.path.join(OUT, 'people.onnx')
urllib.request.urlretrieve('https://huggingface.co/dreMaz/AnimeInstanceSegmentation/resolve/main/rtmdetl_e60.ckpt', CK)
sd = torch.load(CK, map_location='cpu', weights_only=True); sd = sd.get('state_dict', sd)
model.load_state_dict(sd, strict=True)
model.eval()

class Raw(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x):
        f = s.m.neck(s.m.backbone(x)); cls, box, ker, mf = s.m.bbox_head(f)
        n = x.shape[0]
        c = torch.cat([v.permute(0, 2, 3, 1).reshape(n, -1, 1) for v in cls], 1).sigmoid()
        b = torch.cat([v.permute(0, 2, 3, 1).reshape(n, -1, 4) for v in box], 1)
        k = torch.cat([v.permute(0, 2, 3, 1).reshape(n, -1, 169) for v in ker], 1)
        return c, b, k, mf
raw = Raw(model); x = torch.zeros(1, 3, 640, 640)
with torch.no_grad(): o = raw(x)
print([tuple(v.shape) for v in o])
torch.onnx.export(raw, x, ONNX, input_names=['image'], output_names=['scores', 'boxes', 'kernels', 'mask_feat'], opset_version=17, dynamo=False)
raw_b = open(ONNX, 'rb').read(); name = 'anime-people.onnx.gz'; dst = os.path.join(OUT, name)
with open(dst, 'wb') as f:
    with gzip.GzipFile(filename='', mode='wb', fileobj=f, compresslevel=6, mtime=0) as g: g.write(raw_b)
b = open(dst, 'rb').read(); info = [{'id': 'czM_people', 'file': name, 'pack': 'people', 'size': len(b), 'raw': len(raw_b), 'sha256': hashlib.sha256(b).hexdigest()}]
os.remove(CK); os.remove(ONNX)
json.dump(info, open(os.path.join(OUT, 'people-pack.json'), 'w'), indent=1); print(json.dumps(info, indent=1))
