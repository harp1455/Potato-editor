# IOPaint 잇기 시험: 이 PC에서 IOPaint가 켜져 있어야 해요 (예: iopaint start --model=lama --device=cpu --port=8080)
#   python3 -I tests/iopaint.py 팩폴더 [IOPaint 주소]
# 고른 레이어의 구멍(투명한 곳)을 골라 '고른 레이어만'으로 채우고, '보이는 그대로'로 새 레이어를 얹어 봐요.
import functools, http.server, os, shutil, sys, tempfile, threading
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); PACKS = sys.argv[1]; URL = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8080'
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root)
src = os.path.join(root, '구멍.png')
im = Image.open(os.path.join(PACKS, 'test.png')).convert('RGBA'); im.thumbnail((500, 640)); d = ImageDraw.Draw(im); d.rectangle([180, 300, 260, 380], fill=(0, 0, 0, 0)); im.save(src)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
C0 = "__potato.state.project.canvases[0]"
ALPHA = """(async () => { const c = %s, cv = await __potato.image.flatten(c, c.layers[0].id); return cv.getContext('2d').getImageData(220, 340, 1, 1).data[3]; })()""" % C0
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1 && __potato.sel")
    assert page.evaluate(ALPHA) == 0
    page.evaluate("__potato.sel.selRect('new', 175, 295, 90, 90)"); page.evaluate("__potato.settings.set('iop', { ...__potato.settings.get('iop') || {}, url: '%s' })" % URL)
    page.evaluate("__potato.run('ai.iopaint')"); page.wait_for_selector('.iop-state >> text=연결됨', timeout=30000); print(page.locator('.iop-state').inner_text())
    m0 = page.evaluate(C0 + ".layers[0].mediaId"); page.click('.dlg-foot >> text=그려 넣기')
    page.wait_for_function(C0 + ".layers[0].mediaId !== '%s'" % m0, timeout=600000); page.wait_for_timeout(300)
    a = page.evaluate(ALPHA); print('채운 뒤 구멍 자리 불투명도', a); assert a > 200, a
    page.keyboard.press('Control+z'); assert page.evaluate(ALPHA) == 0
    # 보이는 그대로: 새 레이어로 얹어요
    page.evaluate("__potato.run('ai.iopaint')"); page.wait_for_selector('.iop-state >> text=연결됨', timeout=30000); page.select_option('.dlg select', 'view')
    n = page.evaluate(C0 + ".layers.length"); page.click('.dlg-foot >> text=그려 넣기'); page.wait_for_function(C0 + ".layers.length === %d" % (n + 1), timeout=600000)
    print(page.evaluate(C0 + ".layers.map(l => l.name)"))
    # 꺼져 있을 때: 알기 쉬운 말이 나와요
    page.evaluate("__potato.settings.set('iop', { ...__potato.settings.get('iop'), url: 'http://127.0.0.1:9' })"); page.evaluate("__potato.run('ai.iopaint')"); page.wait_for_selector('.iop-state >> text=연결하지 못했어요', timeout=30000); page.keyboard.press('Escape')
    page.evaluate("__potato.run('help.iopaint')"); page.wait_for_selector('.iop-help'); assert 'disable-nsfw-checker' in page.locator('.iop-help').inner_text(); page.locator('.dlg').screenshot(path='/tmp/iop-help.png')
    assert not errs, errs
    br.close()
print('통과')
