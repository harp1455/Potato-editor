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
    # AI 지우개: LaMa ONNX 그래프(Apache-2.0) + 애니·만화용 가중치(MIT)
    'lama_onnx': {'url': HF.format(repo='Carve/LaMa-ONNX', rev='c3c0c9e468934d62e79c329e35d82dd09ff8c444', path='lama_fp32.onnx'),
                  'sha256': '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6'},
    'lama_anime': {'url': HF.format(repo='dreMaz/AnimeMangaInpainting', rev='2953a4e935bf01ad1471f6cbfd26ab81abeeb92d', path='lama_large_512px.ckpt'),
                   'sha256': '11d30fbb3000fb2eceae318b75d9ced9229d99ae990a7f8b3ac35c8d31f2c935'},
    # 선화 추출: informative-drawings(MIT) — ControlNet 'lineart' 주석기, deepghs ONNX 변환(MIT)
    'line_fine': {'url': HF.format(repo='deepghs/imgutils-models', rev='35e0ed8f35ce0dbea674568161a48b31ba7d2a99', path='lineart/lineart.onnx'),
                  'sha256': '14570bc70981c7cab28dbd06938b7b25f4b3e969476e816f99cc39ecd8a1c820'},
    'line_coarse': {'url': HF.format(repo='deepghs/imgutils-models', rev='35e0ed8f35ce0dbea674568161a48b31ba7d2a99', path='lineart/lineart_coarse.onnx'),
                    'sha256': 'e32fc7b9ffd219ac38f6bd770c5d537c92f1038f81a6a258db03f4d0d501a64c'},
    # 움짤 중간 장면: RIFE v4.9(MIT, hzwer/Practical-RIFE, 애니용으로 다듬은 판) ONNX — 입력 [1,7,H,W] = 앞 장면·뒤 장면·시점
    'rife49': {'url': HF.format(repo='FuryTMP/RIFE_v4.9', rev='d30537a6f5e71f1baac6c2d5a03e74b650f916fe', path='rife_v4.9.onnx'),
               'sha256': 'b53f43b0853f73c055b1ba56dced48296d48a0ab76ce123bb7b492bf6c2ae57a'},
    # 깊이: Depth Anything V2 Small(Apache-2.0) ONNX — 그래프와 가중치가 따로
    'depth_g': {'url': HF.format(repo='onnx-community/depth-anything-v2-small-ONNX', rev='c3b67641fd837b2368757101311e5d21e511441e', path='onnx/model.onnx'),
                'sha256': '345f249eda90f33e0548890f2fe1e89662c1dbb5a8b7c10a50492558f65e85a3'},
    'depth_d': {'url': HF.format(repo='onnx-community/depth-anything-v2-small-ONNX', rev='c3b67641fd837b2368757101311e5d21e511441e', path='onnx/model.onnx_data'),
                'sha256': 'c4fba31e921953367d8c5348b92296b2bf41f9cef9745ffaca01e2b1653e6d08'},
    # 글자 찾기: PP-OCRv4 mobile 검출(Apache-2.0, PaddleOCR) ONNX (RapidOCR 변환본) — 페이지 번역에서 글자 자리만 잘라 보낼 때
    'ppocr4det': {'url': HF.format(repo='SWHL/RapidOCR', rev='1cfba2e90fc938db55889873735088de210cc173', path='PP-OCRv4/ch_PP-OCRv4_det_infer.onnx'),
                  'sha256': 'd2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9'},
    # 캐릭터 움직이기: 온몸 뼈대 찾기 DWPose-l 384×288(Apache-2.0, IDEA-Research/DWPose) — 입력 [1,3,384,288], 출력 simcc_x·simcc_y(133점)
    'dwpose': {'url': HF.format(repo='yzd-v/DWPose', rev='1a7144101628d69ee7a3768d1ee3a094070dc388', path='dw-ll_ucoco_384.onnx'),
               'sha256': '724f4ff2439ed61afb86fb8a1951ec39c6220682803b4a8bd4f598cd913b1843'},
    # 캐릭터 움직이기: 애니 눈 찾기(눈 깜빡임 자리) — deepghs/anime_eye_detection v1.0_n (YOLOv8n)
    'eye_n': {'url': HF.format(repo='deepghs/anime_eye_detection', rev='ba69e3ee3b0b23e7c948994e182f06cd46e534f1', path='eye_detect_v1.0_n/model.onnx'),
              'sha256': 'a96515cdf4ca0a4caf56778d93ba7fc28b4582727ff32645844cd89d39cdee29'},
    # 캐릭터 움직이기: 애니 사람 찾기(캐릭터가 몇 명인지·어디 있는지) — deepghs/anime_person_detection v1.1_n (YOLOv8n, MIT)
    'person_n': {'url': HF.format(repo='deepghs/anime_person_detection', rev='e39c744c22432ad01f91dd254fe2b02c8d878b8c', path='person_detect_v1.1_n/model.onnx'),
                 'sha256': '6fcdfc6af18b3a26aca62aad0e00faffbeea23413abf868808d2d98d399999c9'},
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
    ('czM_lama', 'lama_onnx+lama_anime', 'lama_anime', 'lama-anime.onnx.gz', 'erase'),
    ('czM_lineF', 'line_fine', 'fp16w', 'lineart-fine.onnx.gz', 'line'),
    ('czM_lineC', 'line_coarse', 'fp16w', 'lineart-coarse.onnx.gz', 'line'),
    ('czM_rife', 'rife49', 'fp16w', 'rife-v4.9.onnx.gz', 'interp'),
    ('czM_depth', 'depth_g+depth_d', 'fp16w_ext', 'depth-anything-v2-small.onnx.gz', 'depth'),
    ('czM_tdet', 'ppocr4det', None, 'ppocr-det-v4.onnx.gz', 'text'),
    ('czM_pose', 'dwpose', 'fp16w', 'dwpose-l-384.onnx.gz', 'rig'),
    ('czM_eye', 'eye_n', 'fp16w', 'anime-eye-n.onnx.gz', 'rig'),
    ('czM_person', 'person_n', 'fp16w', 'anime-person-n.onnx.gz', 'rig'),
]
PACKS = {'base': {'label': '기본 팩', 'desc': "AI 실행 도구, 찾기 모델, '빠르게' 모양 모델, 윤곽 따기"},
         'precise': {'label': '정밀 팩', 'desc': "'정밀하게' 모양 모델"},
         'bg': {'label': 'AI 배경 지우기 팩', 'desc': '애니 캐릭터만 따내는 모델 (skytnt/anime-seg)'},
         'sr': {'label': 'AI 화질 키우기 팩', 'desc': 'Real-ESRGAN 애니 업스케일 모델 (빠르게·고화질)'},
         'erase': {'label': 'AI 지우개 팩', 'desc': '칠한 곳을 둘레에 맞게 메우는 LaMa 모델 (애니·만화용)'},
         'line': {'label': 'AI 선화 추출 팩', 'desc': '그림에서 선만 뽑는 모델 (가는 선·굵은 선)'},
         'interp': {'label': 'AI 중간 장면 팩', 'desc': '움짤 장면 사이를 새로 그려 부드럽게 하는 RIFE 모델 (애니용 v4.9)'},
         'depth': {'label': 'AI 깊이 팩', 'desc': '그림의 앞뒤 거리를 재는 Depth Anything V2 모델 (배경 흐림·입체 움짤)'},
         'text': {'label': 'AI 글자 찾기 팩', 'desc': '그림 속 글자 자리를 찾는 PP-OCR 모델 (페이지 번역에서 글자 부분만 보낼 때)'},
         'rig': {'label': 'AI 캐릭터 뼈대 팩', 'desc': '캐릭터의 관절과 눈 자리, 캐릭터가 몇 명인지 찾는 모델 (캐릭터 움직이기)'}}
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
        srcs = [fetch(k, a.cache) for k in key.split('+')]; src = srcs[0]  # 원본이 둘이면 변환기에 둘 다 넘겨요
        if conv:
            dst = os.path.join(a.cache, key.replace('+', '_') + '.' + conv + '.onnx')
            subprocess.run([sys.executable, os.path.join(T, conv + '.py'), *srcs, dst], check=True, stdout=subprocess.DEVNULL); src = dst
        raw = open(src, 'rb').read(); gz = gzip.compress(raw, 9, mtime=0)
        open(os.path.join(a.out, name), 'wb').write(gz)
        files.append({'id': id_, 'file': name, 'pack': pack, 'size': len(gz), 'raw': len(raw), 'sha256': sha(gz)})
        print(name, round(len(gz) / 1e6, 1), 'MB', flush=True)
    for k, v in PACKS.items(): v['size'] = sum(f['size'] for f in files if f['pack'] == k)
    json.dump({'version': 1, 'packs': PACKS, 'files': files}, open(os.path.join(a.out, 'packs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('packs.json', {k: round(v['size'] / 1e6, 1) for k, v in PACKS.items()})


if __name__ == '__main__':
    main()
