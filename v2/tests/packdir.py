# AI 팩 저장 폴더 시험: 설치판의 파일 기능을 흉내 낸 채로(메모리 안의 가짜 디스크),
#   기본 자리에 팩 받기 → 다른 디스크 폴더로 옮기기 → 거기서 읽기 → 기본 자리로 되돌리기, 그리고 도움말의 디스크 고르기를 봐요.
#   python3 -I tests/packdir.py 팩폴더 [화면저장폴더]
import functools, http.server, os, shutil, sys, tempfile, threading
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); PACKS = sys.argv[1]; SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
root = tempfile.mkdtemp(); shutil.copy(os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html'), root); os.symlink(os.path.abspath(PACKS), os.path.join(root, 'packs'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=root))
threading.Thread(target=srv.serve_forever, daemon=True).start()
FAKE = r"""
(() => {
  const APP = 'C:\\Users\\u\\AppData\\Roaming\\potato2', disk = new Map(), dirs = new Set(['C:\\', 'E:\\']);
  const full = (p, o) => (o && o.baseDir === 'AppData' ? APP + '\\' + p.replace(/\//g, '\\') : p).replace(/\\+$/, '');
  const fs = {
    BaseDirectory: { AppData: 'AppData' },
    async exists(p, o) { const f = full(p, o); return disk.has(f) || dirs.has(f) || dirs.has(f + '\\'); },
    async stat(p, o) { const f = full(p, o); if (!disk.has(f)) throw new Error('없음 ' + f); return { size: disk.get(f).length }; },
    async readFile(p, o) { const f = full(p, o); if (!disk.has(f)) throw new Error('없음 ' + f); return disk.get(f); },
    async writeFile(p, u8, o) { disk.set(full(p, o), new Uint8Array(u8)); },
    async mkdir(p, o) { dirs.add(full(p, o)); },
    async remove(p, o) { const f = full(p, o); if (!disk.delete(f)) throw new Error('없음'); },
    async rename(a, b, o) { const fa = full(a, { baseDir: o && o.oldPathBaseDir }), fb = full(b, { baseDir: o && o.newPathBaseDir }); disk.set(fb, disk.get(fa)); disk.delete(fa); },
    async copyFile(a, b, o) { const fa = full(a, { baseDir: o && o.fromPathBaseDir }), fb = full(b, { baseDir: o && o.toPathBaseDir }); if (!disk.has(fa)) throw new Error('없음 ' + fa); disk.set(fb, new Uint8Array(disk.get(fa))); },
  };
  const path = { join: async (...a) => a.filter(Boolean).join('\\').replace(/\\{2,}/g, '\\'), appDataDir: async () => APP };
  const upload = { async download(url, to, cb) { const f = url.split('/').pop(), r = await fetch('packs/' + f), u8 = new Uint8Array(await r.arrayBuffer()); cb && cb({ progress: u8.length, progressTotal: u8.length }); disk.set(to, u8); } };
  const dialog = { open: async () => window.__pick, save: async () => null };
  window.__TAURI__ = { fs, path, upload, dialog }; window.__disk = disk;
})();
"""
C = "[...__disk.keys()].filter(k => k.endsWith('.gz')).sort()"
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    ctx = br.new_context(viewport={'width': 1440, 'height': 900}); ctx.add_init_script(FAKE)
    page = ctx.new_page(); errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto('http://127.0.0.1:%d/index.html' % srv.server_address[1]); page.click('text=나중에 하기')
    page.wait_for_function("window.__potato && __potato.packs"); page.evaluate("__potato.packs.packGet(['czM_detH'], () => {})")
    keys = page.evaluate(C); print(keys); assert keys == ['C:\\Users\\u\\AppData\\Roaming\\potato2\\packs\\files\\anime-head-detect.onnx.gz'], keys
    # 설정 > AI 팩: 다른 폴더 고르기 → E 드라이브로 옮겨요
    page.evaluate("window.__pick = 'E:\\\\Stuff'"); page.keyboard.press('Control+,'); page.click('.set-tab >> text=AI 팩')
    page.wait_for_selector('text=기본 자리 (C 드라이브의 사용자 폴더 안)')
    if SHOTS: page.locator('.dlg').screenshot(path=os.path.join(SHOTS, 'packdir-1.png'))
    page.click('.disk-pick >> text=다른 폴더 고르기'); page.wait_for_selector('.toast >> text=옮겼어요', timeout=60000)
    keys = page.evaluate(C); print(keys); assert keys == ['E:\\Stuff\\감자편집기 AI 팩\\anime-head-detect.onnx.gz'], keys
    assert page.evaluate("__potato.settings.get('packDir')") == 'E:\\Stuff\\감자편집기 AI 팩'
    page.wait_for_selector('.disk-pick >> text=기본 자리로')
    # 새 자리에서 받은 것으로 알아보고, 새로 받는 팩도 거기로 가요
    assert page.evaluate("__potato.packs.missingFiles(['czM_detH']).then(m => m.length)") == 0
    page.evaluate("__potato.packs.packGet(['czM_detN'], () => {})"); keys = page.evaluate(C); assert 'E:\\Stuff\\감자편집기 AI 팩\\anime-hand-detect.onnx.gz' in keys and len(keys) == 2, keys
    # 기본 자리로 되돌리기
    page.click('.disk-pick >> text=기본 자리로'); page.wait_for_selector('.toast >> text=기본 자리', timeout=60000)
    keys = page.evaluate(C); print(keys); assert all(k.startswith('C:\\Users\\u\\AppData') for k in keys) and len(keys) == 2, keys
    assert page.evaluate("__potato.settings.get('packDir')") == ''
    page.keyboard.press('Escape')
    # 도움말 > IOPaint 켜는 법: 있는 디스크만 보이고, 고른 디스크가 명령에 들어가요
    page.evaluate("__potato.run('help.iopaint')"); page.wait_for_function("document.querySelectorAll('.disk-pick option').length === 2")
    assert page.evaluate("[...document.querySelectorAll('.disk-pick option')].map(o => o.value)") == ['C', 'E']
    page.select_option('.disk-pick select', 'E'); t = page.locator('.iop-help').inner_text(); print([l for l in t.split('\n') if 'model-dir' in l or 'Python311' in l])
    assert '--model-dir="E:\\PotatoEditor\\iopaint-models"' in t and 'E:\\PotatoEditor\\Python311' in t and '--no-cache-dir' in t
    page.evaluate("window.__pick = 'E:\\\\AI 도구'"); page.click('.disk-pick >> text=폴더 고르기'); page.wait_for_timeout(200)
    assert '--model-dir="E:\\AI 도구\\iopaint-models"' in page.locator('.iop-help').inner_text()
    if SHOTS: page.locator('.dlg').screenshot(path=os.path.join(SHOTS, 'packdir-2.png'))
    page.keyboard.press('Escape'); page.evaluate("__potato.run('help.parts')"); page.wait_for_selector('.iop-help >> text=cd /d "E:\\AI 도구"')
    assert not errs, errs
    br.close()
print('통과')
