# 감자 편집기 묶기
#   python tools/build.py app            → dist/app/ (exe 안에 들어가는 화면. 모델은 팩에서 받아요)
#   python tools/build.py full PACKDIR   → dist/감자편집기.html (파일 하나로 다 들어간 판. PACKDIR = 팩 파일이 있는 폴더)
import json, os, re, shutil, subprocess, sys, base64
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, 'src')
read = lambda p: open(p, encoding='utf-8').read()
VERSION = json.load(open(os.path.join(ROOT, 'src-tauri', 'tauri.conf.json'), encoding='utf-8'))['version']
NOTICE = read(os.path.join(ROOT, 'tools', 'notice.txt')).strip()


def ort_classic():
    """ESM 엔진을 일꾼 안에서 바로 쓰는 일반 스크립트로 (파일로 열 때와, 앱에서 여러 스레드가 안 될 때 씀)"""
    out = os.path.join(ROOT, 'dist', '.ort_classic.js')
    subprocess.run([sys.executable, '-I', os.path.join(ROOT, 'tools', 'ort_classic.py'), os.path.join(ROOT, 'vendor', 'ort', 'ort.webgpu.bundle.min.mjs'), out], check=True, stdout=subprocess.DEVNULL)
    js = read(out)
    for bad in ('</script', '<!--', '<script'):
        assert bad not in js.lower(), bad
    return js


def page(kind, extra):
    head = read(os.path.join(S, 'head.html')).rstrip('\n')
    main = read(os.path.join(S, 'main.js')).rstrip('\n')
    # main.js 안의 /*@@이름@@*/ 자리에 src/이름(소문자).js를 끼워요 (자동 흰칠 cz, 고급 보정 adv 등)
    for name in re.findall(r'/\*@@([A-Z0-9]+)@@\*/', main):
        assert main.count(f'/*@@{name}@@*/') == 1, name
        main = main.replace(f'/*@@{name}@@*/\n', read(os.path.join(S, name.lower() + '.js')), 1)
    assert main.startswith('<script>')
    build = '<script>window.POTATO_BUILD = ' + json.dumps({'kind': kind, 'version': VERSION}) + ';</script>'
    mux = read(os.path.join(ROOT, 'vendor', 'mp4-muxer', 'mp4-muxer.js'))  # MP4 저장 (MIT)
    assert '</script' not in mux.lower()
    parts = [head, build, '<script>' + mux + '</script>', read(os.path.join(S, 'sfx-packs.html')).rstrip('\n'), main, NOTICE] + extra + ['</body>', '</html>']
    return '\n'.join(parts) + '\n'


def build_app():
    d = os.path.join(ROOT, 'dist', 'app')
    shutil.rmtree(d, ignore_errors=True); os.makedirs(os.path.join(d, 'ort'))
    shutil.copy(os.path.join(ROOT, 'vendor', 'ort', 'ort.webgpu.bundle.min.mjs'), os.path.join(d, 'ort'))
    html = page('app', ['<script type="text/plain" id="czOrt">' + ort_classic() + '</script>'])
    open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(html)
    print(os.path.join(d, 'index.html'), round(len(html.encode()) / 1e6, 1), 'MB')


def build_full(packdir):
    man = json.load(open(os.path.join(packdir, 'packs.json'), encoding='utf-8'))
    extra = ['<script type="text/plain" id="czOrt">' + ort_classic() + '</script>']
    for f in man['files']:  # 팩 파일은 이미 gzip이라 그대로 base64만 (HTML판에는 자동 흰칠 팩만, AI 팩은 설치판 전용)
        if f['pack'] not in ('base', 'precise'): continue
        b = open(os.path.join(packdir, f['file']), 'rb').read()
        extra.append(f'<script type="application/octet-stream" id="{f["id"]}">' + base64.b64encode(b).decode() + '</script>')
    html = page('full', extra)
    out = os.path.join(ROOT, 'dist', '감자편집기.html')
    open(out, 'w', encoding='utf-8').write(html)
    print(out, round(len(html.encode()) / 1e6, 1), 'MB')


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    if sys.argv[1] == 'app': build_app()
    elif sys.argv[1] == 'full': build_full(sys.argv[2])
    else: raise SystemExit('app 또는 full')
