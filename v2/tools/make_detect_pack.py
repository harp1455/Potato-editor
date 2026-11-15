# 애니 탐지 팩 만들기: deepghs의 애니 사람·머리·손 탐지 모델(ONNX)을 받아 gz로 묶어요. 바꾸는 것은 없어요.
#   python v2/tools/make_detect_pack.py 나올폴더
# 원본: https://huggingface.co/deepghs/anime_person_detection (MIT), anime_head_detection (MIT), anime_hand_detection (openrail)
import gzip, hashlib, json, os, sys, urllib.request
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); info = []
for repo, sub, name, fid in [('anime_person_detection', 'person_detect_v1.3_s', 'anime-person-detect.onnx.gz', 'czM_detP'),
                             ('anime_head_detection', 'head_detect_v2.0_s', 'anime-head-detect.onnx.gz', 'czM_detH'),
                             ('anime_hand_detection', 'hand_detect_v1.0_s', 'anime-hand-detect.onnx.gz', 'czM_detN')]:
    raw = urllib.request.urlopen('https://huggingface.co/deepghs/%s/resolve/main/%s/model.onnx' % (repo, sub)).read(); dst = os.path.join(OUT, name)
    with open(dst, 'wb') as f:
        with gzip.GzipFile(filename='', mode='wb', fileobj=f, compresslevel=6, mtime=0) as g: g.write(raw)
    b = open(dst, 'rb').read(); info.append({'id': fid, 'file': name, 'pack': 'detect', 'size': len(b), 'raw': len(raw), 'sha256': hashlib.sha256(b).hexdigest()})
json.dump(info, open(os.path.join(OUT, 'detect-pack.json'), 'w'), indent=1); print(json.dumps(info, indent=1))
