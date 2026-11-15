# 감자 편집기 부위 서버
# See-through의 부위 나누기 모델(19부위, Apache-2.0, 24yearsold/l2d_sam_iter2)을 이 PC에서 돌려서
# 감자 편집기의 "AI > 부위별로 레이어 나누기"에 결과를 돌려줘요. 그림은 이 PC 밖으로 나가지 않아요.
#
# 쓰는 법 (명령 프롬프트):
#   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121   (IOPaint를 깔았다면 이미 있어요)
#   pip install einops
#   python potato_parts_server.py            그래픽카드로 (4GB면 반정밀도로 돌려요)
#   python potato_parts_server.py --cpu      그래픽카드 메모리가 모자랄 때 (느려요)
# 처음 켤 때 모델(약 1.3GB)과 모델 코드를 이 파일 옆의 potato-parts 폴더에 받아요.
import argparse, base64, io, json, os, sys, threading, types, urllib.request, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(HERE, 'potato-parts')
COMMIT = 'fc4440db7c076518e313f378e28b1504e9886a95'   # See-through 코드 (고정)
CKPT_URL = 'https://huggingface.co/24yearsold/l2d_sam_iter2/resolve/main/checkpoint-18000.pt'
PARTS = ['hair', 'headwear', 'face', 'eyes', 'eyewear', 'ears', 'earwear', 'nose', 'mouth', 'neck', 'neckwear', 'topwear', 'handwear', 'bottomwear', 'legwear', 'footwear', 'tail', 'wings', 'objects']


def fetch(url, dst):
    if os.path.exists(dst): return
    print('받는 중:', url, flush=True); tmp = dst + '.part'
    with urllib.request.urlopen(url) as r, open(tmp, 'wb') as f:
        total = int(r.headers.get('Content-Length') or 0); got = 0
        while True:
            b = r.read(1 << 20)
            if not b: break
            f.write(b); got += len(b)
            if total: print('\r  %d / %d MB' % (got >> 20, total >> 20), end='', flush=True)
    print(); os.replace(tmp, dst)


def prepare():
    os.makedirs(D, exist_ok=True)
    code = os.path.join(D, 'seethrough-' + COMMIT[:8])
    if not os.path.isdir(os.path.join(code, 'modules')):
        z = os.path.join(D, 'seethrough.zip'); fetch('https://github.com/shitagaki-lab/see-through/archive/' + COMMIT + '.zip', z)
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                rel = n.split('/', 1)[1] if '/' in n else ''
                if rel.startswith('common/modules/') and not n.endswith('/'):
                    out = os.path.join(code, rel[len('common/'):]); os.makedirs(os.path.dirname(out), exist_ok=True)
                    with open(out, 'wb') as f: f.write(zf.read(n))
        os.remove(z)
    ck = os.path.join(D, 'l2d_sam_iter2.pt'); fetch(CKPT_URL, ck)
    return code, ck


def load(code, ck, cpu):
    import torch
    # 모델 코드가 부르는 도구 중 이 일에 필요 없는 것은 빈 껍데기로 대신해요
    tu = types.ModuleType('utils.torch_utils')
    def fix_params(m):
        for p in m.parameters(): p.requires_grad = False
    tu.fix_params = fix_params; tu.img2tensor = None; tu.tensor2img = None
    sys.modules.setdefault('utils', types.ModuleType('utils')); sys.modules['utils.torch_utils'] = tu
    try: import einops  # noqa: F401
    except ImportError:
        e = types.ModuleType('einops'); e.rearrange = None; sys.modules['einops'] = e
    sys.path.insert(0, code)
    from modules.semanticsam import SemanticSam
    with torch.device('meta'): m = SemanticSam(class_num=19)
    sd = torch.load(ck, map_location='cpu', weights_only=True, mmap=True); sd = sd.get('state_dict', sd)
    m.load_state_dict(sd, strict=True, assign=True); m.eval()
    if not cpu and torch.cuda.is_available():
        try:
            m = m.to('cuda', torch.float16); torch.zeros(1, device='cuda'); return m, 'cuda', torch.float16
        except RuntimeError as err:
            print('그래픽카드에 올리지 못해서 CPU로 돌려요:', err, flush=True); m = m.to('cpu'); torch.cuda.empty_cache()
    return m.to('cpu', torch.float32), 'cpu', torch.float32


def infer(model, dev, dt, pil):
    import numpy as np, torch
    import torch.nn.functional as F
    im = np.asarray(pil.convert('RGB'), np.float32); H, W = im.shape[:2]; s = 1024 / max(W, H); nw, nh = round(W * s), round(H * s)
    x = torch.from_numpy(im).permute(2, 0, 1)[None]
    x = F.interpolate(x, (nh, nw), mode='bilinear', align_corners=False, antialias=True)
    px, py = (1024 - nw) // 2, (1024 - nh) // 2; x = F.pad(x, (px, 1024 - nw - px, py, 1024 - nh - py))
    mean = torch.tensor([123.675, 116.28, 103.53]).view(1, 3, 1, 1); std = torch.tensor([58.395, 57.12, 57.375]).view(1, 3, 1, 1)
    x = ((x - mean) / std).to(dev, dt)
    with torch.inference_mode():
        lo, _ = model(x); lo = lo.float()
        if not torch.isfinite(lo).all(): raise RuntimeError('결과에 잘못된 값이 섞였어요. --cpu로 다시 켜 주세요.')
        p = F.interpolate(lo, (1024, 1024), mode='bilinear', align_corners=False)[:, :, py:py + nh, px:px + nw]
        p = F.interpolate(p, (H, W), mode='bilinear', align_corners=False)[0]
        mx, lab = p.max(0); lab = torch.where(mx > 0, lab + 1, torch.zeros_like(lab))
    return lab.to('cpu', torch.uint8).numpy()


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=8091); ap.add_argument('--cpu', action='store_true'); a = ap.parse_args()
    code, ck = prepare(); print('모델을 올리는 중', flush=True); model, dev, dt = load(code, ck, a.cpu)
    from PIL import Image
    lock = threading.Lock()   # 한 번에 한 장씩
    info = {'name': 'See-through 부위 모델 (19부위)', 'device': dev, 'parts': PARTS}

    class Handler(BaseHTTPRequestHandler):
        def head(self, code, kind='application/json'):
            self.send_response(code); self.send_header('Content-Type', kind)
            for k, v in [('Access-Control-Allow-Origin', '*'), ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'), ('Access-Control-Allow-Headers', 'content-type'), ('Access-Control-Allow-Private-Network', 'true')]: self.send_header(k, v)
            self.end_headers()
        def do_OPTIONS(self): self.head(204)
        def do_GET(self):
            if self.path.rstrip('/') == '/info': self.head(200); self.wfile.write(json.dumps(info, ensure_ascii=False).encode())
            else: self.head(404); self.wfile.write(b'{}')
        def do_POST(self):
            if self.path.rstrip('/') != '/parts': self.head(404); self.wfile.write(b'{}'); return
            try:
                req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
                b = req['image']; b = b.split(',', 1)[1] if b.startswith('data:') else b
                pil = Image.open(io.BytesIO(base64.b64decode(b)))
                print('부위를 나누는 중 (%dx%d)' % pil.size, flush=True); 
                with lock: lab = infer(model, dev, dt, pil)
                out = io.BytesIO(); Image.fromarray(lab, 'L').save(out, 'PNG')
                self.head(200); self.wfile.write(json.dumps({'labels': 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode(), 'parts': PARTS}).encode()); print('끝났어요', flush=True)
            except Exception as err:
                print('실패:', err, flush=True); self.head(500); self.wfile.write(json.dumps({'error': str(err)}, ensure_ascii=False).encode())
        def log_message(self, *a): pass

    srv = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    print('준비됐어요: http://127.0.0.1:%d (%s). 이 창은 쓰는 동안 열어 두세요.' % (a.port, '그래픽카드' if dev == 'cuda' else 'CPU'), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
