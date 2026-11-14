# 보관함 시험: 폴더째 넣기, 폴더 나무, 끌어서 옮기기, NAI 정보 지우기, 폴더째 저장
import io, os, struct, sys, zlib, tempfile, zipfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None


def png(path, w, h, rgb, text=None, alpha=255):
    rows = b''.join(b'\x00' + b''.join(bytes((rgb[0], rgb[1], (rgb[2] + x) % 256, alpha if (x + y) % 2 else 255)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    body = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    if text: body += chunk(b'tEXt', b'Comment\x00' + text.encode())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + body + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def chunks(data):
    out, p = [], 8
    while p < len(data):
        n = struct.unpack('>I', data[p:p + 4])[0]; out.append(data[p + 4:p + 8]); p += 12 + n
    return out


tmp = tempfile.mkdtemp(); root = os.path.join(tmp, '작업')
png(os.path.join(root, '캐릭터A', '표정', '웃음.png'), 64, 96, (200, 120, 90), text='{"prompt": "1boy, smile"}', alpha=254)
png(os.path.join(root, '캐릭터A', '전신.png'), 64, 96, (90, 120, 200), text='{"prompt": "1boy"}')
png(os.path.join(root, '배경.png'), 96, 64, (60, 160, 120))
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}, accept_downloads=True).new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=나중에 하기')

    # 폴더째 넣기: 하위 폴더까지 나무 모양 그대로, 그림판은 만들지 않고 큰 그림도 풀어 두지 않아요
    with page.expect_file_chooser() as fc: page.click('[aria-label="폴더째 넣기"]')
    fc.value.set_files(root)
    page.wait_for_function("__potato.state.project.media.length === 3")
    pr = P(page, "__potato.state.project")
    by = {f['id']: f for f in pr['folders']}
    def fpath(i):
        out = []
        while i: out.insert(0, by[i]['name']); i = by[i]['parent']
        return '/'.join(out)
    got = {m['name']: (fpath(m['folder']), m['meta']) for m in pr['media']}
    assert got == {'웃음.png': ('작업/캐릭터A/표정', True), '전신.png': ('작업/캐릭터A', True), '배경.png': ('작업', False)}, got
    assert len(pr['canvases']) == 0 and P(page, "__potato.state.bitmaps.size") == 0
    assert page.locator('.fold').count() == 3 and page.locator('.media-meta').count() == 2
    shot(page, '20-bin')

    # 하위 폴더 만들기(우클릭) → 그림을 끌어서 그 폴더로
    page.click('.fold >> text=캐릭터A', button='right'); page.click('.menu >> text=하위 폴더 만들기')
    page.keyboard.type('의상'); page.keyboard.press('Enter')
    page.wait_for_selector('.fold >> text=의상')
    page.drag_and_drop('.media >> text=전신.png', '.fold >> text=의상')
    pr = P(page, "__potato.state.project"); by = {f['id']: f for f in pr['folders']}
    assert fpath(next(m for m in pr['media'] if m['name'] == '전신.png')['folder']) == '작업/캐릭터A/의상'
    # 여러 장 고르기(Ctrl) → 한꺼번에 옮기기, 폴더를 폴더 안으로, 자기 안쪽으로는 못 옮김
    page.click('.media >> text=웃음.png'); page.click('.media >> text=배경.png', modifiers=['Control'])
    page.drag_and_drop('.media >> text=배경.png', '.fold >> text=의상')
    pr = P(page, "__potato.state.project"); by = {f['id']: f for f in pr['folders']}
    assert all(fpath(m['folder']) == '작업/캐릭터A/의상' for m in pr['media']), [(m['name'], fpath(m['folder'])) for m in pr['media']]
    page.drag_and_drop('.fold >> text=캐릭터A', '.fold >> text=표정')
    assert page.locator('.toast.err').count() == 1
    page.keyboard.press('Control+z')
    shot(page, '21-moved')

    # 두 번 눌러 레이어로 → 그때 큰 그림을 풀어요
    page.dblclick('.media >> text=웃음.png')
    page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")

    # 폴더째 저장(ZIP): 폴더 모양 그대로, NAI 정보(글자 칸 + 투명도 끝 비트)는 지워짐. 보관함 원본은 그대로
    P(page, "window.showDirectoryPicker = undefined")
    page.click('.fold >> text=캐릭터A', button='right'); page.click('.menu >> text=이 폴더째 저장')
    shot(page, '22-save')
    with page.expect_download() as dl: page.click('.dlg-foot >> text=저장')
    z = zipfile.ZipFile(dl.value.path())
    names = sorted(z.namelist())
    assert names[0].startswith('캐릭터A/') and '캐릭터A/표정/웃음.png' in names, names
    for n in names:
        assert b'tEXt' not in chunks(z.read(n)), n
    data = list(z.read('캐릭터A/표정/웃음.png'))
    alphas = P(page, "(async d => { const bmp = await createImageBitmap(new Blob([new Uint8Array(d)])); const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return [...new Set(g.getImageData(0, 0, bmp.width, bmp.height).data.filter((v, i) => i % 4 === 3))]; })(DATA)".replace('DATA', str(data)))
    assert alphas == [255], alphas
    assert sum(1 for m in P(page, "__potato.state.project.media") if m['meta']) == 2

    # 보관함 파일 자체에서 지우기
    page.click('.bin-tree', button='right', position={'x': 5, 'y': 400}); page.click('.menu >> text=모든 그림의 NAI 정보 지우기')
    page.click('.dlg-foot >> text=지우기')
    page.wait_for_function("!__potato.state.project.media.some(m => m.meta)")
    assert page.locator('.media-meta').count() == 0

    # 일괄 처리: 폴더 하나를 긴 쪽 48로 줄여 WebP로 → 폴더 모양 그대로 ZIP
    page.keyboard.press('Alt+5'); page.wait_for_selector('.batch-row')
    page.select_option('select[aria-label="from"]', label='폴더: 작업 › 캐릭터A')
    page.select_option('select[aria-label="fit"]', '768'); page.select_option('select[aria-label="fmt"]', 'image/webp')
    P(page, "__potato.settings.set('batch', { ...__potato.settings.get('batch'), fit: 48 })")
    page.keyboard.press('Alt+1'); page.keyboard.press('Alt+5')
    n = P(page, "__potato.state.project.media.filter(m => !m.hidden).length")
    with page.expect_download() as dl: page.click('.btn.primary >> text=처리해서 저장')
    zb = zipfile.ZipFile(dl.value.path()); zn = zb.namelist()
    assert zn and all(x.endswith('.webp') and x.startswith('작업/캐릭터A/') for x in zn), zn
    assert zb.read(zn[0])[8:12] == b'WEBP'
    page.keyboard.press('Alt+1')

    # 다시 켜도 폴더와 미리보기가 그대로
    page.wait_for_function("__potato.state.saved"); page.reload()
    page.wait_for_function("window.__potato && __potato.state.project.media.length === 3")
    assert page.locator('.fold').count() == 4 and P(page, "__potato.state.thumbs.size") == 3
    assert not errs, errs
    br.close()
print('통과')
