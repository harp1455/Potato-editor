# 부위 서버 잇기 시험: 이 PC에서 부위 서버가 켜져 있어야 해요 (python tools/potato_parts_server.py --cpu)
#   python3 -I tests/parts.py 그림 [화면저장]
# 레이어를 부위 레이어들로 나누고, 되돌리면 원래 한 장으로 돌아오는지 봐요.
import functools, http.server, os, shutil, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root)
src = os.path.join(root, '캐릭터.png'); shutil.copy(sys.argv[1], src)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
C0 = "__potato.state.project.canvases[0]"
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 900}).new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    page.evaluate("__potato.run('ai.parts')"); page.wait_for_selector('.iop-state >> text=연결됨', timeout=30000); print(page.locator('.iop-state').inner_text())
    page.click('.dlg-foot >> text=나누기'); page.locator('.toast', has_text='개로 나눴어요').or_(page.locator('.toast', has_text='부위별로 나누기:')).first.wait_for(timeout=1800000)
    print([t.inner_text() for t in page.locator('.toast').all()]); names = page.evaluate(C0 + ".layers.map(l => l.name)"); print(names)
    assert len(names) >= 3 and any('머리카락' in n for n in names), names
    if len(sys.argv) > 2:
        page.evaluate("(() => { const c = %s; c.layers.forEach((l, i) => { l.x += (i - c.layers.length / 2) * 40; }); __potato.emit(); })()" % C0); page.wait_for_timeout(500); page.screenshot(path=sys.argv[2])
    page.keyboard.press('Control+z'); page.wait_for_timeout(200); assert page.evaluate(C0 + ".layers.length") == 1
    assert not errs, errs
    br.close()
print('통과')
