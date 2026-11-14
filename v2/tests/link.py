# 다른 프로그램과 잇기 시험: 폴더 지켜보기 → 새 그림이 보관함으로, 보내기 → 폴더에 PNG  (python3 -I tests/link.py)
import functools, http.server, os, shutil, struct, tempfile, threading, zlib
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root)


def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h)); ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')


src = os.path.join(root, 'a.png'); open(src, 'wb').write(png(120, 90, (200, 120, 80)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
P = lambda page, js: page.evaluate(js)
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome'); page = br.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    # NAIS3와 잇기 (브라우저 안의 폴더로 흉내): 지켜보기를 켠 뒤 생긴 그림만 보관함에 들어오고, 보내기는 그 폴더에 PNG를 써요
    P(page, """(async () => { const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('nais', { create: true }), sub = await dir.getDirectoryHandle('2026-11', { create: true });
        const png = async (w) => { const c = document.createElement('canvas'); c.width = w; c.height = 20; c.getContext('2d').fillRect(0, 0, w, 20); return new Promise(r => c.toBlob(r, 'image/png')); };
        window.__put = async (name, w) => { const f = await sub.getFileHandle(name, { create: true }), wr = await f.createWritable(); await wr.write(await png(w)); await wr.close(); };
        await window.__put('old.png', 30); window.showDirectoryPicker = async () => dir; window.__dir = dir; })()""")
    m0 = P(page, "__potato.state.project.media.length"); assert P(page, "__potato.link.startWatch(true)") is True
    P(page, "window.__put('new1.png', 44)"); page.wait_for_function("__potato.state.project.media.length === %d" % (m0 + 1), timeout=15000)
    nm = P(page, "__potato.state.project.media.at(-1)"); fo = P(page, "__potato.state.project.folders.find(f => f.id === '%s').name" % nm['folder']); assert nm['name'] == 'new1.png' and nm['w'] == 44 and fo == 'NAIS3에서 온 그림', (nm, fo)
    sent = P(page, "__potato.link.sendOut(true)"); assert sent and sent.endswith('.png') and P(page, "(async () => { try { await window.__dir.getFileHandle('%s'); return true; } catch (e) { return false; } })()" % sent)
    page.wait_for_timeout(3200); assert P(page, "__potato.state.project.media.length") == m0 + 1   # 내가 보낸 그림은 다시 안 가져와요
    P(page, "__potato.link.stopWatch()"); assert P(page, "__potato.link.linkState().on") is False
    assert not errs, errs
    br.close()
srv.shutdown()
print('통과')
