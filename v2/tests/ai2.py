# 8.x에서 가져온 AI 도구 시험 (진짜 모델로): 자동 흰칠(찾을 것이 없는 그림) · 선화 추출 · 배경 흐리게 · AI 중간 장면
#   python3 -I tests/ai2.py 팩폴더 [캡처 폴더]
import functools, http.server, os, shutil, sys, tempfile, threading
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PACKS = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else None; TIME = 900000
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))
src = os.path.join(root, '캐릭터.png'); shutil.copy(os.path.join(PACKS, 'test.png'), src)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root)); threading.Thread(target=srv.serve_forever, daemon=True).start()
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
def go(page, cmd, done, pack=True):
    P(page, "__potato.run('%s')" % cmd)
    if pack: page.wait_for_selector('.dlg >> text=AI 팩 받기'); page.click('.dlg-foot >> text=받기')
    page.wait_for_function(done, timeout=TIME)
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    L = "__potato.state.project.canvases[0].layers"
    # 자동 흰칠: 가릴 것이 없는 그림 → 끝까지 돌고 '찾지 못했어요'
    go(page, 'ai.censor', "[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('가릴 곳을 찾지 못했어요'))")
    assert len(P(page, L)) == 1
    # 선화 추출 → 같은 자리에 새 레이어
    go(page, 'ai.line', L + ".length === 2")
    a, b = P(page, L); assert b['name'].endswith('선화') and (b['x'], b['y']) == (a['x'], a['y'])
    ink = P(page, "(async () => { const l = %s[1], bm = await __potato.ai.aiLoad && __potato.state.bitmaps.get(l.mediaId), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); const d = g.getImageData(0, 0, bm.width, bm.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n / (bm.width * bm.height); })()" % L)
    print('선이 차지한 넓이: %.1f%%' % (ink * 100)); assert 0.005 < ink < 0.6, ink
    P(page, "__potato.state.project.canvases[0].layers[0].visible = false; __potato.emit()"); page.wait_for_timeout(300); shot(page, '90-line')
    # 배경 흐리게 → 그 레이어의 그림이 바뀜
    P(page, "(() => { const p = __potato.state.project; p.canvases[0].layers[0].visible = true; p.canvases[0].layers[1].visible = false; p.sel = p.canvases[0].layers[0].id; __potato.emit(); })()")
    m0 = P(page, L + "[0].mediaId"); go(page, 'ai.dof95', L + "[0].mediaId !== '%s'" % m0); page.wait_for_timeout(300); shot(page, '91-dof')
    assert not errs, errs
    br.close()
srv.shutdown(); print('통과')
