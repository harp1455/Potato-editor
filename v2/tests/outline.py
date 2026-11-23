# 윤곽 모델 시험 (진짜 모델로): 작은 모델과 큰 모델(정밀 윤곽 팩)로 같은 곳을 눌러 보고, 큰 모델이 부위만 따는지 봐요
#   python3 -I tests/outline.py 팩폴더   팩폴더에 test.png와 base·outline 팩 파일이 있어야 해요
import functools, http.server, os, shutil, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); PACKS = sys.argv[1]
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))
src = os.path.join(root, '캐릭터.png'); shutil.copy(os.path.join(PACKS, 'test.png'), src)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
RUN = """async () => { const P = __potato, ai = P.ai; ai.aiReset(); await P.packs.packGet(['czWasm', ...ai.samIds()], () => {}); const bmp = [...P.state.bitmaps.values()][0], t0 = performance.now();
  const cnt = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n / (c.width * c.height); };
  const skirt = cnt(await ai.samMask(bmp, 'k' + Math.random(), [[bmp.width * 0.47, bmp.height * 0.87, 1]], null)), t1 = performance.now();
  const head = cnt(await ai.samMask(bmp, 'k2', [], [bmp.width * 0.37, bmp.height * 0.09, bmp.width * 0.77, bmp.height * 0.42]));
  return { skirt, head, ms: Math.round(t1 - t0), ids: ai.samIds() }; }"""
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    assert page.evaluate("__potato.settings.get('samModel')") == 'fast'
    a = page.evaluate(RUN); print('작은 모델:', a); assert a['ids'] == ['czM_samE', 'czM_samD']
    # 설정 > AI 팩에서 '정밀하게'를 고르면 큰 모델로 바뀌어요
    page.keyboard.press('Control+,'); page.click('.set-tab >> text=AI 팩'); page.click('.choice-item >> text=정밀하게'); page.wait_for_function("__potato.settings.get('samModel') === 'big'")
    assert page.locator('.pack >> text=정밀 윤곽 팩').count() == 1; page.keyboard.press('Escape')
    b = page.evaluate(RUN); print('큰 모델:', b); assert b['ids'] == ['czM_sam2E', 'czM_sam2D']
    assert 0.02 < b['skirt'] < 0.2, b       # 치마만 (작은 모델은 사람을 통째로 따요)
    assert 0.05 < b['head'] < 0.2 and 0.05 < a['head'] < 0.2, (a, b)   # 상자로 물으면 둘 다 머리
    assert not errs, errs
    br.close()
print('통과')
