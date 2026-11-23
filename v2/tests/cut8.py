# 컷 작업실 시험 2 (8.x에서 옮긴 흐름): 그림 끌어다 놓아 컷 만들기 → 세로 자동 배치 → 페이지 늘리기·줄이기 → 위쪽 줄로 넣기 → 정렬·순서·복제 → 내보내기 창
import os, struct, sys, tempfile, zlib, zipfile
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
def png(name, w, h, rgb):
    rows = b''.join(b'\x00' + bytes(rgb + (255,)) * w for _ in range(h)); p = os.path.join(D, name)
    open(p, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')); return p
D = tempfile.mkdtemp(); A = png('가로.png', 400, 200, (200, 90, 90)); B = png('세로.png', 200, 400, (90, 120, 200))
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
PG = "__potato.state.project.pages[0]"; ELS = PG + ".els"
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}, accept_downloads=True).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=만 19세 이상입니다')
    with page.expect_file_chooser() as fc: page.click('[aria-label="그림 넣기"]')
    fc.value.set_files([A, B]); page.wait_for_function("__potato.state.project.media.length === 2")
    page.keyboard.press('Alt+2'); page.click('.empty-room >> text=한 컷'); page.wait_for_timeout(200)
    P(page, "(() => { %s.els = []; __potato.emit(); })()" % PG)
    box = page.locator('.viewport').bounding_box(); zoom = min((box['width'] - 48) / 800, (box['height'] - 48) / 1280)
    X = lambda x: box['x'] + (box['width'] - 800 * zoom) / 2 + x * zoom; Y = lambda y: box['y'] + (box['height'] - 1280 * zoom) / 2 + y * zoom
    # 빈 페이지에 그림을 끌어다 놓으면 그림 비율대로 새 컷이 생겨요. 컷 위에 놓으면 그 컷에 담겨요
    page.drag_and_drop('.media >> nth=0', '.viewport', target_position={'x': X(400) - box['x'], 'y': Y(300) - box['y']})
    page.wait_for_function(ELS + ".length === 1"); e = P(page, ELS + "[0]"); m0 = P(page, "__potato.state.project.media.find(m => m.id === '%s')" % e['mediaId'])
    assert e['type'] == 'panel' and abs(e['w'] / e['h'] - m0['w'] / m0['h']) < 0.02, e
    page.drag_and_drop('.media >> nth=1', '.viewport', target_position={'x': X(e['x'] + 30) - box['x'], 'y': Y(e['y'] + 30) - box['y']})
    page.wait_for_function(ELS + "[0].mediaId !== '%s'" % e['mediaId']); assert P(page, ELS + ".length") == 1
    # 보관함에서 두 번 누르면: 고른 컷이 없으면 새 컷으로
    page.keyboard.press('Escape'); page.dblclick('.media >> nth=0'); page.wait_for_function(ELS + ".length === 2")
    # 세로로 자동 배치: 페이지 폭에 맞춰 쌓고 페이지가 늘어나요
    P(page, "(() => { %s.els = []; __potato.picked.clear(); __potato.emit(); })()" % PG)
    page.click('.cut-bar >> text=세로로 자동 배치'); page.wait_for_selector('.dlg >> text=세로로 자동 배치'); shot(page, '92-stack'); page.click('.dlg-foot >> text=배치하기')
    page.wait_for_function(ELS + ".length === 2"); pg = P(page, PG); a, b = pg['els']
    assert a['x'] == b['x'] and a['w'] == b['w'] and b['y'] > a['y'] + a['h'] and pg['h'] >= b['y'] + b['h'], pg
    # 아래로 늘리기, 내용 끝에 맞춰 줄이기, 폭·높이 직접 적기
    page.keyboard.press('Escape'); h0 = pg['h']; page.click('.vid-side >> text=아래로 1000px 늘리기'); assert P(page, PG + ".h") == h0 + 1000
    page.click('.vid-side >> text=내용 끝에 맞춰 줄이기'); assert b['y'] + b['h'] < P(page, PG + ".h") < b['y'] + b['h'] + 80
    page.fill('.vid-side input[aria-label="폭"]', '900'); page.keyboard.press('Tab'); assert P(page, PG + ".w") == 900
    page.keyboard.press('Control+z'); page.wait_for_timeout(200)
    # 휠은 위아래로 넘기고, Ctrl+휠이 확대예요
    z0 = P(page, "__potato.cut.view().zoom"); oy = P(page, "__potato.cut.view().oy"); page.mouse.move(box['x'] + 300, box['y'] + 300); page.mouse.wheel(0, 200); page.wait_for_timeout(100)
    assert P(page, "__potato.cut.view().zoom") == z0 and P(page, "__potato.cut.view().oy") == oy - 200
    page.keyboard.press('Control+0'); page.wait_for_timeout(200)
    # 위쪽 줄: 말풍선을 누르면 가운데에 놓이고 바로 대사를 적어요
    n0 = P(page, ELS + ".length"); page.click('.cut-bar >> text=말풍선'); page.wait_for_selector('textarea.cut-edit'); page.keyboard.type('안녕'); page.keyboard.press('Escape')
    assert P(page, ELS + ".length") == n0 + 1 and P(page, ELS + ".at(-1).text") == '안녕'
    # 모두 고르기 → 왼쪽 맞추기 → 복제 → 되돌리기, 순서 앞으로·뒤로
    page.locator('canvas.viewport').focus(); page.keyboard.press('Control+a'); page.click('.vid-side >> text=왼쪽 >> nth=0'); xs = P(page, ELS + ".map(e => e.x)"); assert len(set(xs)) == 1, xs
    page.locator('canvas.viewport').focus(); page.keyboard.press('Control+d'); assert P(page, ELS + ".length") == (n0 + 1) * 2; page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    ids = P(page, ELS + ".map(e => e.id)"); P(page, "__potato.cut.pick('%s')" % ids[0]); P(page, "__potato.run('cut.forward')"); assert P(page, ELS + ".map(e => e.id)")[1] == ids[0]
    P(page, "__potato.run('cut.backward')"); assert P(page, ELS + ".map(e => e.id)") == ids
    # 빈 곳을 끌면 걸친 요소가 함께 골라져요
    page.keyboard.press('Escape'); pg = P(page, PG); zoom = P(page, "__potato.cut.view().zoom"); ox = P(page, "__potato.cut.view().ox"); oyv = P(page, "__potato.cut.view().oy")
    SX = lambda x: box['x'] + ox + x * zoom; SY = lambda y: box['y'] + oyv + y * zoom
    page.mouse.move(SX(-20), SY(-10)); page.mouse.down(); page.mouse.move(SX(pg['w'] + 20), SY(pg['h'] + 10), steps=4); page.mouse.up()
    assert P(page, "__potato.cut.selected().length") == len(pg['els']), P(page, "__potato.cut.selected()")
    shot(page, '93-cut8')
    # 내보내기 창: JPG, 세로로 잘라 여러 장
    page.keyboard.press('Escape'); P(page, "window.showDirectoryPicker = undefined"); page.click('.cut-bar >> text=내보내기'); page.wait_for_selector('.dlg >> text=세로로 자르기')
    page.select_option('.dlg select[aria-label="파일"]', 'jpeg'); page.fill('.dlg input[aria-label="세로로 자르기"]', '300'); page.keyboard.press('Tab'); shot(page, '94-export')
    with page.expect_download() as dl: page.click('.dlg-foot >> text=내보내기')
    z = zipfile.ZipFile(dl.value.path()); names = z.namelist(); assert len(names) >= 2 and all(n.endswith('.jpg') for n in names) and z.read(names[0])[:2] == b'\xff\xd8', names
    assert not errs, errs
    br.close()
print('통과')
