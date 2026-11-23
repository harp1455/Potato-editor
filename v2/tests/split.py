# 사람별로 나누기 (조각 골라서) 시험, 진짜 모델로:
#   python3 -I tests/split.py 팩폴더 [그림 [화면저장]]
# 그림을 안 주면 test.png의 캐릭터를 둘 나란히 붙인 그림으로 시험해요.
import functools, http.server, os, shutil, sys, tempfile, threading
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); PACKS = sys.argv[1]; TIME = 900000
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))
src = os.path.join(root, '두사람.png'); own = len(sys.argv) > 2 and sys.argv[2] != ''
if own: shutil.copy(sys.argv[2], src)
else:
    one = Image.open(os.path.join(PACKS, 'test.png')).convert('RGB'); one.thumbnail((600, 800)); two = Image.new('RGB', (one.width * 2, one.height)); two.paste(one, (0, 0)); two.paste(one.transpose(Image.FLIP_LEFT_RIGHT), (one.width, 0)); two.save(src)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
C0 = "__potato.state.project.canvases[0]"
with sync_playwright() as pw:
    # 팩이 커서 시크릿 창의 저장 한도에 걸려요. 디스크에 저장하는 창으로 열어요
    br = pw.chromium.launch_persistent_context(tempfile.mkdtemp(), channel='chrome', viewport={'width': 1440, 'height': 900}, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = br.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    page.evaluate("__potato.run('ai.people')"); page.wait_for_selector('.dlg >> text=AI 팩 받기'); page.click('.dlg-foot >> text=받기')
    page.wait_for_selector('.split-view', timeout=TIME); page.wait_for_timeout(500)
    intro = page.locator('.split-intro').inner_text(); print(intro); print(page.locator('.split-count').inner_text())
    if len(sys.argv) > 3: page.locator('.dlg').screenshot(path=sys.argv[3])
    if not own:
        box = page.locator('.split-view').bounding_box()
        # 오른쪽 사람의 가운데를 사람 2로, 왼쪽 사람의 가운데를 사람 1로 칠해요 (처음 짐작이 어떻든)
        page.click('.split-chip >> text=사람 2'); page.mouse.move(box['x'] + box['width'] * 0.66, box['y'] + box['height'] * 0.2); page.mouse.down()
        for t in range(1, 40): page.mouse.move(box['x'] + box['width'] * (0.66 + 0.18 * (t % 2)), box['y'] + box['height'] * (0.2 + t * 0.018))
        page.mouse.up()
        page.click('.split-chip >> text=사람 1'); page.mouse.move(box['x'] + box['width'] * 0.33, box['y'] + box['height'] * 0.2); page.mouse.down()
        for t in range(1, 40): page.mouse.move(box['x'] + box['width'] * (0.16 + 0.18 * (t % 2)), box['y'] + box['height'] * (0.2 + t * 0.018))
        page.mouse.up()
        # 조각 더 나누기: 켜고 누르면 조각이 하나 늘어요
        n0 = int(intro.split('조각 ')[1].split('개')[0]); page.click('.split-chip >> text=조각 더 나누기')
        page.mouse.click(box['x'] + box['width'] * 0.25, box['y'] + box['height'] * 0.12); page.wait_for_function("!document.querySelector('.split-view.wait')", timeout=TIME); page.wait_for_timeout(300)
        page.click('.dlg-foot >> text=레이어로 만들기'); page.wait_for_selector('.toast >> text=따로 레이어로', timeout=TIME)
        names = page.evaluate(C0 + ".layers.map(l => l.name)"); print(names); assert len(names) == 3 and names[0].endswith('배경') and names[1].endswith('사람 1') and names[2].endswith('사람 2'), names
        half = page.evaluate("""async () => { const c = %s, out = []; for (const l of c.layers.slice(1)) { const cv = await __potato.image.flatten(c, l.id), w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data; let L = 0, R = 0; for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) if (d[(y * w + x) * 4 + 3] > 128) (x < w / 2 ? L++ : R++); out.push([L, R]); } return out; }""" % C0)
        print(half); assert half[0][0] > half[0][1] * 3 and half[1][1] > half[1][0] * 3, half
        page.keyboard.press('Control+z'); assert page.evaluate(C0 + ".layers.length") == 1
    assert not errs, errs
    br.close()
print('통과')
