# 겹친 다리 떼기 시험 (진짜 모델로): 그림마다 캐릭터 움직이기 창을 열고 '겹친 다리 떼기'를 눌러 봐요
#   python3 -I tests/legs.py 팩폴더 캡처폴더 그림1 [그림2 …]
import functools, http.server, os, shutil, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PACKS, SHOTS, PICS = sys.argv[1], sys.argv[2], sys.argv[3:]; TIME = 900000
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
P = lambda page, js: page.evaluate(js)
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    for pic in PICS:
        name = os.path.splitext(os.path.basename(pic))[0]
        page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
        with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
        fc.value.set_files(pic); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
        page.keyboard.press('Alt+4'); page.wait_for_selector('.char-room'); page.click('.char-item >> text=이 레이어 움직이기 >> nth=0')
        try: page.wait_for_selector('.dlg >> text=AI 팩 받기', timeout=4000); page.click('.dlg-foot >> text=받기')
        except Exception: pass
        page.wait_for_selector('#modalRoot .rg-modal', timeout=TIME); page.wait_for_timeout(1500)
        page.click('#modalRoot [data-rgm="part"]'); page.wait_for_timeout(500); page.screenshot(path=os.path.join(SHOTS, 'leg-%s-0.png' % name))
        before = page.locator('#modalRoot').inner_text()
        page.click('#modalRoot [data-rga="autolegs"]'); page.wait_for_selector('#modalRoot .toast, .toast', timeout=TIME)
        page.wait_for_function("[...document.querySelectorAll('.toast')].some(t => /떼어 냈어요|찾지 못했어요/.test(t.textContent))", timeout=TIME)
        msg = P(page, "[...document.querySelectorAll('.toast')].map(t => t.textContent).filter(t => /떼어 냈어요|찾지 못했어요/.test(t)).at(-1)")
        page.wait_for_timeout(800); page.screenshot(path=os.path.join(SHOTS, 'leg-%s-1.png' % name))
        print(name, '→', msg[:60], '| 오류:', errs[:1]); sys.stdout.flush(); page.context.close()
    br.close()
srv.shutdown()
