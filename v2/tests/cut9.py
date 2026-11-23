# 컷 작업실 시험 3: 가리기 붓·부드럽게, 도형·카메라 틀, 곡선으로 자르기, 컷 안에 그림 겹치기, 내 모양(미리보기·기본)
import os, struct, sys, tempfile, zlib
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
def png(name, w, h, f):
    rows = b''.join(b'\x00' + b''.join(bytes(f(x, y)) for x in range(w)) for y in range(h)); p = os.path.join(D, name)
    open(p, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')); return p
D = tempfile.mkdtemp(); A = png('줄무늬.png', 400, 300, lambda x, y: (230, 60, 60, 255) if (x // 10 + y // 10) % 2 else (250, 250, 250, 255)); B = png('점.png', 200, 200, lambda x, y: (40, 90, 220, 255) if (x - 100) ** 2 + (y - 100) ** 2 < 6400 else (0, 0, 0, 0))
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
PG = "__potato.state.project.pages[0]"; ELS = PG + ".els"
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=만 19세 이상입니다')
    with page.expect_file_chooser() as fc: page.click('[aria-label="그림 넣기"]')
    fc.value.set_files([A, B]); page.wait_for_function("__potato.state.project.media.length === 2")
    page.keyboard.press('Alt+2'); page.click('.empty-room >> text=한 컷'); page.wait_for_timeout(200)
    mids = P(page, "__potato.state.project.media.map(m => m.id)")
    P(page, "(id => { const e = %s[0]; Object.assign(e, { x: 100, y: 100, w: 600, h: 450, mediaId: id }); __potato.emit(); })('%s')" % (ELS, mids[0])); page.wait_for_timeout(300)
    V = lambda: P(page, "__potato.cut.view()"); box = page.locator('.viewport').bounding_box()
    SX = lambda x: box['x'] + V()['ox'] + x * V()['zoom']; SY = lambda y: box['y'] + V()['oy'] + y * V()['zoom']
    px = "(() => { const c = document.querySelector('canvas.viewport'), r = c.getBoundingClientRect(), k = c.width / r.width, d = c.getContext('2d').getImageData(Math.round((%f - r.left) * k), Math.round((%f - r.top) * k), 1, 1).data; return [d[0], d[1], d[2]]; })()"
    # 가리기 도구: 오른쪽에서 붓과 흰칠을 고르고 칠하면, 칠한 자리만 흰색이 되고 이어 칠하면 한 가리기에 모여요
    page.keyboard.press('x'); page.wait_for_selector('.vid-side >> text=가리기 도구'); page.select_option('.vid-side select[aria-label="가릴 모양"]', 'brush'); page.select_option('.vid-side select[aria-label="가리는 법"]', 'white')
    page.fill('.vid-side input[aria-label="붓 굵기"]', '50'); page.keyboard.press('Tab')
    for yy in (200, 300): page.mouse.move(SX(200), SY(yy)); page.mouse.down(); page.mouse.move(SX(500), SY(yy + 10), steps=6); page.mouse.up()
    cv = P(page, ELS + ".at(-1)"); assert P(page, ELS + ".length") == 2 and cv['type'] == 'cover' and cv['shape'] == 'brush' and len(cv['strokes']) == 2 and cv['kind'] == 'white', cv
    page.keyboard.press('v'); page.keyboard.press('Escape'); page.wait_for_timeout(150)
    assert P(page, px % (SX(350), SY(205))) == [255, 255, 255] and P(page, px % (SX(350), SY(255))) != [255, 255, 255]   # 획 위는 흰색, 두 획 사이는 그대로
    # 모자이크로 바꾸고 부드럽게: 가장자리가 번져서 섞여요 (오류 없이 그려져요)
    P(page, "(() => { const e = %s.at(-1); e.kind = 'mosaic'; e.soft = 8; __potato.emit(); })()" % ELS); page.wait_for_timeout(200); shot(page, '101-cover-brush'); assert not errs, errs
    # 도형과 카메라 틀: 위쪽 줄에서 넣어요. 틀은 고른 컷에 꼭 맞고 그 컷과 묶여요
    page.click('.cut-bar >> text=도형·틀'); page.click('.menu-item >> text=별'); sh = P(page, ELS + ".at(-1)"); assert sh['type'] == 'shape' and sh['kind'] == 'star'
    page.select_option('.vid-side select[aria-label="도형 모양"]', 'heart'); assert P(page, ELS + ".at(-1).kind") == 'heart'
    P(page, "__potato.cut.pick(%s[0].id)" % ELS); page.click('.cut-bar >> text=도형·틀'); page.click('.menu-item >> text=뷰파인더'); pan = P(page, ELS + "[0]"); fr = P(page, ELS + ".find(e => e.type === 'frame')")
    assert (fr['x'], fr['y'], fr['w'], fr['h']) == (pan['x'], pan['y'], pan['w'], pan['h']) and fr['gid'] == pan['gid'], fr
    for k in ['rec', 'letterbox', 'vhs', 'film']: page.select_option('.vid-side select[aria-label="틀 종류"]', k); page.wait_for_timeout(60)
    page.select_option('.vid-side select[aria-label="틀 종류"]', 'viewfinder'); page.wait_for_timeout(150); shot(page, '102-frame'); assert not errs, errs
    # 컷 안에 그림 겹치기: 보관함에서 고른 그림을 겹치고, 겹친 그림만 옮겨요 (바탕은 그대로)
    P(page, "(id => { __potato.picked.clear(); __potato.picked.add(id); __potato.cut.pick(%s[0].id); })('%s')" % (ELS, mids[1])); page.click('.vid-side >> text=고른 그림 겹치기')
    ly = P(page, ELS + "[0].layers"); assert len(ly) == 1 and ly[0]['mediaId'] == mids[1] and ly[0]['is'] <= 1, ly
    page.fill('.vid-side input[aria-label="확대"]', '50'); page.keyboard.press('Tab'); assert abs(P(page, ELS + "[0].layers[0].is") - 0.5) < 0.01 and P(page, ELS + "[0].is") == 1
    page.click('.vid-side .el-name >> text=바탕'); page.fill('.vid-side input[aria-label="확대"]', '120'); page.keyboard.press('Tab'); assert abs(P(page, ELS + "[0].is") - 1.2) < 0.01 and abs(P(page, ELS + "[0].layers[0].is") - 0.5) < 0.01
    page.wait_for_timeout(200); assert P(page, px % (SX(400), SY(325)))[2] > 150   # 겹친 파란 동그라미가 컷 가운데에 보여요
    page.keyboard.press('Control+z'); shot(page, '103-layers')
    # 곡선으로 자르기: 구불구불 그으면 두 조각이 되고, 조각 가장자리가 여러 점으로 휘어 있어요
    page.keyboard.press('Escape'); P(page, "(() => { const p = %s; p.els = p.els.filter(e => e.type === 'panel'); delete p.els[0].layers; __potato.emit(); })()" % PG)
    page.click('.cut-bar >> text=컷 나누기'); page.click('.menu-item >> text=곡선으로 자르기'); page.mouse.move(SX(60), SY(300)); page.mouse.down()
    for i in range(1, 15): page.mouse.move(SX(60 + i * 50), SY(300 + (60 if i % 2 else -60)))
    page.mouse.up(); ps = P(page, ELS + ".filter(e => e.type === 'panel')"); assert len(ps) == 2 and all(len(e['poly']) > 12 and e['mediaId'] == mids[0] for e in ps), [len(e.get('poly') or []) for e in ps]
    page.wait_for_timeout(200); shot(page, '104-curve'); page.keyboard.press('v'); page.keyboard.press('Control+z'); assert P(page, ELS + ".filter(e => e.type === 'panel').length") == 1
    # 내 모양: 저장하면 미리보기가 보이고, 별표를 켜면 새로 넣는 글자가 그 모양으로 들어가요
    page.keyboard.press('Escape'); page.click('.cut-bar >> text=글자'); page.wait_for_selector('textarea.cut-edit'); page.keyboard.press('Escape'); page.click('.txt-grid .bub-pre[aria-label="네온 글자 모양"]')
    page.click('.vid-side >> text=지금 모양 저장'); page.fill('.dlg input', '내 네온'); page.click('.dlg-foot >> text=저장'); page.wait_for_selector('.my-style'); assert page.locator('.my-style canvas').count() == 1
    page.click('.my-style button[aria-label="내 네온 기본으로"]'); page.keyboard.press('Escape'); page.click('.cut-bar >> text=글자'); page.wait_for_selector('textarea.cut-edit'); page.keyboard.press('Escape')
    assert P(page, ELS + ".at(-1).glow") == 45 and P(page, ELS + ".at(-1).sc") == '#ff3fa4'
    page.click('.my-style button[aria-label="내 네온 모양 지우기"]'); assert page.locator('.my-style').count() == 0
    # 대사 한꺼번에 넣기: 줄마다 말풍선이 생기고 좌우로 번갈아 놓여요
    page.keyboard.press('Escape'); nb = P(page, ELS + ".filter(e => e.type === 'bubble').length"); page.click('.vid-side >> text=대사 한꺼번에 넣기'); page.fill('.dlg textarea', '안녕?\n오랜만이야.\n잘 지냈어?'); page.click('.dlg-foot >> text=말풍선으로 넣기')
    bs = P(page, ELS + ".filter(e => e.type === 'bubble')"); assert len(bs) == nb + 3 and [b['text'] for b in bs[-3:]] == ['안녕?', '오랜만이야.', '잘 지냈어?'] and bs[-3]['x'] < bs[-2]['x'] and bs[-2]['y'] > bs[-3]['y'] + bs[-3]['h'], bs[-3:]
    page.wait_for_timeout(150); shot(page, '105-script')
    assert not errs, errs
    br.close()
print('통과')
