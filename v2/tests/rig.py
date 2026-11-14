# 캐릭터 작업실 시험 (진짜 모델로): AI로 고르기 → 캐릭터 움직이기 창 열기 → 보관 → 이어서
#   python3 -I tests/rig.py 팩폴더 [캡처 폴더]   팩폴더에 test.png(애니 그림)와 base·bg·erase·rig 팩 파일이 있어야 해요
import functools, http.server, os, shutil, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PACKS = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else None; TIME = 900000
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))
src = os.path.join(root, '캐릭터.png'); shutil.copy(os.path.join(PACKS, 'test.png'), src)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src)
    page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    page.wait_for_timeout(300)

    # AI로 고르기: 캐릭터 얼굴을 누르면 외곽선을 따요
    page.keyboard.press('a')
    box = page.locator('.viewport').bounding_box(); W, H = P(page, "[__potato.state.project.canvases[0].w, __potato.state.project.canvases[0].h]")
    zoom = min((box['width'] - 48) / W, (box['height'] - 48) / H)
    X = lambda x: box['x'] + (box['width'] - W * zoom) / 2 + x * zoom; Y = lambda y: box['y'] + (box['height'] - H * zoom) / 2 + y * zoom
    page.mouse.click(X(W * 0.48), Y(H * 0.80))
    page.wait_for_selector('.dlg >> text=AI 팩 받기'); page.click('.dlg-foot >> text=받기')
    page.wait_for_function("__potato.sel.sel.any", timeout=TIME)
    area = "(() => { const c = __potato.sel.sel.cv, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n / (c.width * c.height); })()"
    a1 = P(page, area); print('AI로 고른 넓이: %.1f%%' % (a1 * 100)); assert 0.01 < a1 < 0.9, a1
    shot(page, '50-sam')
    rev = P(page, "__potato.sel.sel.rev")
    page.keyboard.down('Shift'); page.mouse.click(X(W * 0.40), Y(H * 0.50)); page.keyboard.up('Shift')
    page.wait_for_function("__potato.sel.sel.rev > %d" % rev, timeout=TIME)
    a2 = P(page, area); print('점을 더한 뒤: %.1f%%' % (a2 * 100)); assert a2 > 0.01
    shot(page, '51-sam-add')
    # AI로 지우기: 작은 곳을 골라 메우면 '지운 자리' 레이어가 생겨요
    P(page, "__potato.sel.selRect('new', %d, %d, 90, 90)" % (W * 0.1, H * 0.1))
    page.click('.optbar >> text=AI로 지우기'); page.wait_for_selector('.dlg >> text=AI 팩 받기'); page.click('.dlg-foot >> text=받기')
    page.wait_for_function("__potato.state.project.canvases[0].layers.some(l => l.name === '지운 자리')", timeout=TIME)
    shot(page, '51b-erase'); page.keyboard.press('Control+z')
    page.keyboard.press('Control+d')

    # 캐릭터 작업실 → 이 레이어 움직이기 → 팩 받기 → 준비 → 움직임 창
    page.keyboard.press('Alt+4'); page.wait_for_selector('.char-room'); shot(page, '52-room')
    page.click('.char-item >> text=이 레이어 움직이기 >> nth=0')
    page.wait_for_selector('.dlg >> text=AI 팩 받기'); page.click('.dlg-foot >> text=받기')
    page.wait_for_selector('#modalRoot .rg-modal', timeout=TIME)
    page.wait_for_timeout(1500); shot(page, '53-rig')
    assert page.locator('#modalRoot .rg-modal canvas').count() >= 1 and page.locator('#rgGo').count() == 1
    # 닫으면 보관되고, 작업실에 '하던 작업이 있어요'
    page.click('#rgClose'); page.wait_for_selector('#modalRoot .rg-modal', state='detached', timeout=60000)
    P(page, "__potato.emit()"); page.wait_for_selector('.char-item >> text=이어서 움직이기', timeout=20000)
    shot(page, '54-saved')
    assert not errs, errs
    br.close()
srv.shutdown()
print('통과')
