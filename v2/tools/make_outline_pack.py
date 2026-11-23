# 정밀 윤곽 팩 만들기: SAM 2.1 (hiera base plus, Apache-2.0)의 ONNX를 받아 파일 하나로 합치고 gz로 묶어요.
#   python v2/tools/make_outline_pack.py 나올폴더
# 원본: https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX
import gzip, hashlib, json, os, sys, urllib.request
import onnx

SRC = 'https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX/resolve/main/onnx/'
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); tmp = os.path.join(OUT, 'tmp'); os.makedirs(tmp, exist_ok=True)
info = []
for src, name, fid in [('vision_encoder', 'sam2.1-base-plus-encoder.onnx.gz', 'czM_sam2E'), ('prompt_encoder_mask_decoder', 'sam2.1-decoder.onnx.gz', 'czM_sam2D')]:
    for ext in ['.onnx', '.onnx_data']:
        print('받는 중', src + ext, flush=True); urllib.request.urlretrieve(SRC + src + ext, os.path.join(tmp, src + ext))
    one = os.path.join(tmp, src + '.one.onnx'); onnx.save(onnx.load(os.path.join(tmp, src + '.onnx')), one, save_as_external_data=False)
    raw = open(one, 'rb').read(); dst = os.path.join(OUT, name)
    with open(dst, 'wb') as f:
        with gzip.GzipFile(filename='', mode='wb', fileobj=f, compresslevel=6, mtime=0) as g: g.write(raw)
    b = open(dst, 'rb').read(); info.append({'id': fid, 'file': name, 'pack': 'outline', 'size': len(b), 'raw': len(raw), 'sha256': hashlib.sha256(b).hexdigest()})
    for ext in ['.onnx', '.onnx_data', '.one.onnx']: os.remove(os.path.join(tmp, src + ext))
os.rmdir(tmp)
json.dump(info, open(os.path.join(OUT, 'outline-pack.json'), 'w'), indent=1); print(json.dumps(info, indent=1))
