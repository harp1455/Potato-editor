# 자동 흰칠 팩 만들기: 원본 모델을 받아(체크섬 확인) 변환하고 gzip으로 묶어 packs/ 에 넣어요
#   python tools/make_packs.py [--cache .cache] [--out packs]
# 결과: packs/*.gz + packs/packs.json (편집기가 이 목록을 보고 받고 검사해요)
import argparse, gzip, hashlib, io, json, os, shutil, subprocess, sys, tarfile, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, 'tools')
HF = 'https://huggingface.co/{repo}/resolve/{rev}/{path}'
SRC = {  # 원본: 주소 + sha256 (주소 내용이 바뀌면 멈춰요)
    'ort_wasm': {'npm': 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.31.1.tgz', 'member': 'package/dist/ort-wasm-simd-threaded.asyncify.wasm',
                 'sha256': 'ca319e9539cd0f1e291cf56074760121eaf39650f5dbf84b6e52c07f4b2944ec'},
    'det_s': {'url': HF.format(repo='deepghs/anime_censor_detection', rev='0cf62fd6b28213b40ae0c0055f92e7ae6a96bdc2', path='censor_detect_v1.0_s/model.onnx'),
              'sha256': '2c2524824d7d320c5619a0a73702a2e2186f619067c823d211e94f7cfe489cba'},
    'det_n': {'url': HF.format(repo='deepghs/anime_censor_detection', rev='0cf62fd6b28213b40ae0c0055f92e7ae6a96bdc2', path='censor_detect_v1.0_n/model.onnx'),
              'sha256': '029de0a116f6c3c73bde62d2a8354c78664795579858f3c8e28fc1b4633a891c'},
    'seg_n': {'url': HF.format(repo='01miku/anime-nsfw-segm-yolo26', rev='1697d5d1827b6a818b350b44bf3ec27f08837a2a', path='nsfw-anime-nano-x640.onnx'),
              'sha256': '570d4a1ee7f1c1a0c5c1221ffd20fd73e01e32cafe371e312a8a16353209aa42'},
    'seg_m': {'url': HF.format(repo='01miku/anime-nsfw-segm-yolo26', rev='1697d5d1827b6a818b350b44bf3ec27f08837a2a', path='nsfw-anime-medium-x1280.onnx'),
              'sha256': 'a12ac5532e93be9dfeb96a77fc3f3647791335c9df0de9a18fcd503f7877a828'},
    'sam_e': {'url': HF.format(repo='Acly/MobileSAM', rev='0d3b403339b4674a82493d5e97964dd78089ddc8', path='mobile_sam_image_encoder.onnx'),
              'sha256': '580f5fb648ea1062c0aabc26217aed56921985f03f0cbbd852bba81d760cc749'},
    'isnet': {'url': HF.format(repo='skytnt/anime-seg', rev='493cb60893f47441b26ec4fb9a306bce9e342982', path='isnetis.onnx'),
              'sha256': 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99'},
    'sr4': {'url': HF.format(repo='deepghs/imgutils-models', rev='35e0ed8f35ce0dbea674568161a48b31ba7d2a99', path='real_esrgan/RealESRGAN_x4plus_anime_4B32F.onnx'),
            'sha256': '2208c7ae8db793330abf1248fbce15585ad317e921c456265572836b92926c9a'},
    'sr6': {'url': HF.format(repo='deepghs/imgutils-models', rev='35e0ed8f35ce0dbea674568161a48b31ba7d2a99', path='real_esrgan/RealESRGAN_x4plus_anime_6B.onnx'),
            'sha256': '2648cab4c4343541c1aa291c6754e9e8edbe7a813fffc2a677423dd12cb6b7f7'},
    'sam_d': {'url': HF.format(repo='Acly/MobileSAM', rev='0d3b403339b4674a82493d5e97964dd78089ddc8', path='sam_mask_decoder_multi.onnx'),
              'sha256': '8976b90a87ba50a6a72217a5ff994f7d25ce16f2229fcc1ed259e1294c622ffe'},
}
# 편집기 안 이름(id) ← 원본, 변환, 팩 파일 이름, 어느 팩
FILES = [
    ('czWasm', 'ort_wasm', None, 'ort-1.31.1-asyncify.wasm.gz', 'base'),
    ('czM_deep', 'det_s', 'fp16w', 'censor-detect-s.onnx.gz', 'base'),
    ('czM_deepn', 'det_n', 'fp16w', 'censor-detect-n.onnx.gz', 'base'),
    ('czM_segN', 'seg_n', 'fp16to32', 'nsfw-segm-nano.onnx.gz', 'base'),
    ('czM_samE', 'sam_e', 'fp16w', 'mobilesam-encoder.onnx.gz', 'base'),
    ('czM_samD', 'sam_d', 'fp16w', 'mobilesam-decoder.onnx.gz', 'base'),
    ('czM_segM', 'seg_m', 'fp16to32', 'nsfw-segm-medium.onnx.gz', 'precise'),
    ('czM_isnet', 'isnet', 'fp16w', 'anime-seg-isnetis.onnx.gz', 'bg'),
    ('czM_sr4', 'sr4', 'fp16w', 'realesrgan-anime-4b32f.onnx.gz', 'sr'),
    ('czM_sr6', 'sr6', 'fp16w', 'realesrgan-anime-6b.onnx.gz', 'sr'),
]
PACKS = {'base': {'label': '기본 팩', 'desc': "AI 실행 도구, 찾기 모델, '빠르게' 모양 모델, 윤곽 따기"},
         'precise': {'label': '정밀 팩', 'desc': "'정밀하게' 모양 모델"},
         'bg': {'label': 'AI 배경 지우기 팩', 'desc': '애니 캐릭터만 따내는 모델 (skytnt/anime-seg)'},
         'sr': {'label': 'AI 화질 키우기 팩', 'desc': 'Real-ESRGAN 애니 업스케일 모델 (빠르게·고화질)'}}
sha = lambda b: hashlib.sha256(b).hexdigest()


def fetch(key, cache):
    s = SRC[key]; p = os.path.join(cache, key)
    if os.path.exists(p) and sha(open(p, 'rb').read()) == s['sha256']: return p
    print('받는 중', key, flush=True)
    req = urllib.request.Request(s.get('url') or s['npm'], headers={'User-Agent': 'potato-editor-build'})
    data = urllib.request.urlopen(req, timeout=600).read()
    if 'npm' in s:
        data = tarfile.open(fileobj=io.BytesIO(data), mode='r:gz').extractfile(s['member']).read()
    if sha(data) != s['sha256']: raise SystemExit(f'{key}: 내용이 예상과 달라요 (sha256 {sha(data)})')
    open(p, 'wb').write(data); return p


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--cache', default=os.path.join(ROOT, '.cache')); ap.add_argument('--out', default=os.path.join(ROOT, 'packs'))
    a = ap.parse_args(); os.makedirs(a.cache, exist_ok=True); shutil.rmtree(a.out, ignore_errors=True); os.makedirs(a.out)
    files = []
    for id_, key, conv, name, pack in FILES:
        src = fetch(key, a.cache)
        if conv:
            dst = os.path.join(a.cache, key + '.' + conv + '.onnx')
            subprocess.run([sys.executable, os.path.join(T, conv + '.py'), src, dst], check=True, stdout=subprocess.DEVNULL); src = dst
        raw = open(src, 'rb').read(); gz = gzip.compress(raw, 9, mtime=0)
        open(os.path.join(a.out, name), 'wb').write(gz)
        files.append({'id': id_, 'file': name, 'pack': pack, 'size': len(gz), 'raw': len(raw), 'sha256': sha(gz)})
        print(name, round(len(gz) / 1e6, 1), 'MB', flush=True)
    for k, v in PACKS.items(): v['size'] = sum(f['size'] for f in files if f['pack'] == k)
    json.dump({'version': 1, 'packs': PACKS, 'files': files}, open(os.path.join(a.out, 'packs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('packs.json', {k: round(v['size'] / 1e6, 1) for k, v in PACKS.items()})


if __name__ == '__main__':
    main()
