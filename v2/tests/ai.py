# AI 도구 시험 (진짜 모델로): 팩 받기 → 인물만 고르기 → 인물·배경 나누기 → 화질 키우기
#   python3 -I tests/ai.py 팩폴더 [캡처 폴더]   팩폴더 = packs.json과 *.gz가 있는 곳 (base·bg·sr 팩)
import functools, http.server, os, shutil, struct, sys, tempfile, threading, zlib
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PACKS = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else None; TIME = 900000
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()


# 하늘색 바탕 위의 간단한 캐릭터 (머리카락·얼굴·몸)
def pic(x, y):
    if (x - 128) ** 2 + (y - 92) ** 2 < 52 ** 2 and y < 100: return (40, 30, 60, 255)
    if (x - 128) ** 2 / 38 ** 2 + (y - 104) ** 2 / 44 ** 2 < 1: return (250, 222, 200, 255)
    if 78 < x < 178 and y > 146: return (200, 70, 90, 255) if (x + y) % 23 else (120, 30, 50, 255)
    return (170, 215, 240, 255)


def png(path, w, h, f):
    rows = b''.join(b'\x00' + b''.join(bytes(f(x, y)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


src = os.path.join(root, '캐릭터.png')
REAL = os.path.join(PACKS, 'test.png')   # 진짜 애니 그림이 있으면 그걸로 (모델은 단순한 도형을 캐릭터로 보지 않아요)
shutil.copy(REAL, src) if os.path.exists(REAL) else png(src, 256, 320, pic)
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; logs = []; page.on('pageerror', lambda e: errs.append(str(e))); page.on('console', lambda m: logs.append(m.text[:300]))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src)
    page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")

    # 팩이 없으면 받을지 물어요 → 받기 → 인물만 고르기
    page.click('.mb-item >> text=AI'); shot(page, '40-ai-menu'); page.click('.menu >> text=인물만 고르기')
    page.wait_for_selector('.dlg >> text=AI 팩 받기'); shot(page, '41-pack-ask'); page.click('.dlg-foot >> text=받기')
    try: page.wait_for_function("__potato.sel.sel.any", timeout=TIME)
    except Exception: print('막힘:', [t.inner_text() for t in page.locator('.toast, .job').all()], errs, logs); raise
    area = P(page, "(() => { const c = __potato.sel.sel.cv, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++; return n / (c.width * c.height); })()")
    print('인물로 고른 넓이: %.0f%%' % (area * 100))
    assert 0.05 < area < 0.95, area
    shot(page, '42-select')
    page.click('.zone-tab >> text=AI 작업') if page.locator('.zone-tab >> text=AI 작업').count() else None

    # 인물과 배경을 레이어로 나누기
    P(page, "__potato.run('sel.none'); __potato.state.project.sel = __potato.state.project.canvases[0].layers[0].id; __potato.emit()")
    P(page, "__potato.run('ai.bgSplit')")
    page.wait_for_function("__potato.state.project.canvases[0].layers.length === 2 && __potato.state.saved !== undefined && __potato.state.bitmaps.has(__potato.state.project.canvases[0].layers[1].mediaId)", timeout=TIME)
    names = P(page, "__potato.state.project.canvases[0].layers.map(l => l.name)")
    assert names == ['캐릭터 배경', '캐릭터 인물'], names
    cover = "(async i => { const l = __potato.state.project.canvases[0].layers[i], b = __potato.state.bitmaps.get(l.mediaId), c = new OffscreenCanvas(b.width, b.height), g = c.getContext('2d'); g.drawImage(b, 0, 0); const d = g.getImageData(0, 0, b.width, b.height).data; let n = 0; for (let k = 3; k < d.length; k += 4) if (d[k] > 127) n++; return n / (b.width * b.height); })"
    back, front = P(page, cover + "(0)"), P(page, cover + "(1)")
    assert abs(front - area) < 0.03 and abs(back + front - 1) < 0.05, (back, front, area)
    shot(page, '43-split')

    W0 = P(page, "__potato.state.project.canvases[0].w")
    # 화질 2배: 그림은 2배가 되고 그림판 위 크기는 그대로
    P(page, "__potato.run('ai.up2f')")
    page.wait_for_selector('.dlg >> text=AI 팩 받기'); page.click('.dlg-foot >> text=받기')
    page.wait_for_function("(() => { const p = __potato.state.project, l = p.canvases[0].layers[1], m = p.media.find(m => m.id === l.mediaId); return m.w === W0 * 2 && l.scale === 0.5; })()".replace('W0', str(W0)), timeout=TIME)
    page.keyboard.press('Control+,'); page.click('.set-tab >> text=AI 팩'); page.wait_for_selector('.pack.on'); shot(page, '44-packs')
    assert not errs, errs
    br.close()
srv.shutdown()
print('통과')
