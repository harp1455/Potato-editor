# 컷 작업실 시험 3: 가리기 붓·부드럽게, 도형·카메라 틀, 곡선으로 자르기, 컷 안에 그림 겹치기, 내 모양(미리보기·기본)
import json, os, shutil, struct, sys, tempfile, zlib
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
    # 카메라 틀은 가장자리만 눌려요: 가운데를 누르면 밑의 컷이 골라지고, 가장자리나 요소 목록으로는 틀이 골라져요
    page.keyboard.press('Escape'); P(page, "(() => { const p = %s; p.els = p.els.filter(e => e.type === 'panel'); delete p.els[0].gid; __potato.cut.pick(p.els[0].id); })()" % PG)
    page.click('.cut-bar >> text=도형·틀'); page.click('.menu-item >> text=뷰파인더'); pid = P(page, ELS + "[0].id"); fid = P(page, ELS + "[1].id"); assert P(page, ELS + "[1].type") == 'frame'
    SEL = lambda: P(page, "__potato.cut.sel()"); none = lambda: (P(page, "__potato.cut.pick(null)"), page.wait_for_timeout(60))
    none(); page.mouse.click(SX(400), SY(325)); assert SEL() == pid, '틀 가운데를 누르면 컷이 골라져야 해요'
    none(); page.mouse.click(SX(112), SY(250)); assert SEL() == fid, '틀 가장자리를 누르면 틀이 골라져야 해요'   # 띠: 450의 8% = 36
    none(); page.mouse.click(SX(100 + 600 - 20), SY(100 + 450 - 20)); assert SEL() == fid   # 모서리 쪽 띠
    none(); page.mouse.click(SX(100 + 60), SY(100 + 60)); assert SEL() == pid   # 띠 바로 안쪽은 컷
    none(); page.click('.vid-side .el-name >> text=카메라 틀'); assert SEL() == fid and page.locator('.vid-side select[aria-label="틀 종류"]').count() == 1
    # 묶이지 않은 틀(페이지 전체)도 같아요. 틀을 숨기지 않아도 밑의 컷을 끌어 옮길 수 있어요
    none(); page.click('.cut-bar >> text=도형·틀'); page.click('.menu-item >> text=녹화 중'); f2 = P(page, ELS + ".at(-1)"); assert f2['type'] == 'frame' and f2['w'] == P(page, PG + ".w") and 'gid' not in f2
    none(); page.mouse.click(SX(400), SY(325)); assert SEL() == pid
    none(); page.mouse.click(SX(6), SY(700)); assert SEL() == f2['id']
    none(); page.mouse.move(SX(400), SY(325)); page.mouse.down(); page.mouse.move(SX(440), SY(325), steps=4); page.mouse.up(); assert abs(P(page, ELS + "[0].x") - 140) < 4 and P(page, ELS + ".at(-1).x") == 0; page.keyboard.press('Control+z'); assert P(page, ELS + "[0].x") == 100
    # 색 화면은 꽉 찬 도형이라 그대로 눌려요. 설정에 '요소 목록에서 잠그라'는 안내가 있고, 잠그면 밑의 컷이 눌려요
    P(page, "(() => { const p = %s; p.els = p.els.filter(e => e.type === 'panel'); delete p.els[0].gid; __potato.cut.pick(p.els[0].id); })()" % PG); page.click('.cut-bar >> text=도형·틀'); page.click('.menu-item >> text=색 화면')
    scr = P(page, ELS + ".at(-1)"); assert scr['type'] == 'shape' and scr['screen'] and (scr['x'], scr['w']) == (100, 600)
    assert page.locator('.vid-side .panel-note >> text=요소 목록에서 이 화면을 잠가 주세요').count() == 1
    none(); page.mouse.click(SX(400), SY(325)); assert SEL() == scr['id']
    none(); page.click('.vid-side button[aria-label="도형 잠그기"]'); page.mouse.click(SX(400), SY(325)); assert SEL() == pid
    P(page, "__potato.cut.pick('%s')" % P(page, "(() => { const p = %s; p.els.push({ id: 'star1', type: 'shape', kind: 'star', x: 0, y: 600, w: 80, h: 80, fill: '#ffffff', bw: 2 }); __potato.emit(); return 'star1'; })()" % PG)); page.wait_for_timeout(80)
    assert page.locator('.vid-side select[aria-label="도형 모양"]').count() == 1 and page.locator('.vid-side .panel-note >> text=이 화면을 잠가').count() == 0   # 보통 도형에는 안내가 없어요
    shot(page, '106-frame-hit'); assert not errs, errs
    # 대사 하나만 AI로 번역 (흉내 응답): 고른 말풍선의 글만 바뀌고, Ctrl+Z로 되돌아와요
    P(page, """(() => { const p = %s; p.els = p.els.filter(e => e.type === 'panel'); p.els.push({ id: 'tb1', type: 'bubble', shape: 'ellipse', x: 150, y: 600, w: 240, h: 150, text: '안녕?', size: 28, color: '#111111', fill: '#ffffff', bc: '#111111', bw: 3 }, { id: 'tb2', type: 'bubble', shape: 'ellipse', x: 450, y: 600, w: 240, h: 150, text: '그대로', size: 28, color: '#111111', fill: '#ffffff', bc: '#111111', bw: 3 });
        __potato.settings.set('apiKey', 'k'); window.__f0 = window.fetch; window.__sent = []; window.fetch = async (u, o) => { const b = JSON.parse(o.body); __sent.push({ u: String(u), b }); const lines = JSON.parse(b.contents[0].parts[0].text);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(lines.map(t => 'EN:' + t)) }] }, finishReason: 'STOP' }] }), { status: 200 }); }; __potato.store.commit('시험 준비'); __potato.cut.pick('tb1'); })()""" % PG)
    page.click('.vid-side >> text=AI로 번역·다듬기…'); page.click('.menu-item >> text=영어'); page.wait_for_function(PG + ".els.find(e => e.id === 'tb1').text === 'EN:안녕?'")
    sent = P(page, "__sent"); assert len(sent) == 1 and json.loads(sent[0]['b']['contents'][0]['parts'][0]['text']) == ['안녕?'] and any('English' in x['text'] for x in sent[0]['b']['systemInstruction']['parts']), sent
    assert P(page, PG + ".els.find(e => e.id === 'tb2').text") == '그대로'; page.wait_for_selector('.toast >> text=대사 1개를 바꿨어요')
    page.keyboard.press('Control+z'); assert P(page, PG + ".els.find(e => e.id === 'tb1').text") == '안녕?'
    page.keyboard.press('Control+Shift+z'); assert P(page, PG + ".els.find(e => e.id === 'tb1').text") == 'EN:안녕?'; page.keyboard.press('Control+z')
    # 제미나이가 줄 수를 틀리게 돌려주면 글은 그대로 두고 까닭을 알려 줘요
    P(page, "(() => { window.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '[]' }] }, finishReason: 'STOP' }] }), { status: 200 }); })()")
    page.click('.vid-side >> text=AI로 번역·다듬기…'); page.click('.menu-item >> text=일본어'); page.wait_for_selector('.toast >> text=0줄이 돌아왔어요'); assert P(page, PG + ".els.find(e => e.id === 'tb1').text") == '안녕?'
    P(page, "(() => { window.fetch = window.__f0; })()"); assert not errs, errs
    # 8.x 작업 가져오기: 손그림·가리기·도형도 2.0의 같은 요소로 들어와요. 2.0에 없는 것(선, 도장 붓, 그림 없는 스티커)만 건너뛰어요
    pt = lambda u, v, w, *x: [u, v, w, *x]
    old = {'app': 'potato-editor', 'v': 3, 'imageOrder': [], 'images': [], 'fonts': [], 'doc': {'name': '옛 요소', 'mode': 'cut', 'cur': 0, 'folders': [], 'pages': [{'id': 'p1', 'name': '페이지 1', 'w': 800, 'h': 1280, 'bg': '#ffffff', 'els': [
        {'id': 'a', 'type': 'panel', 'x': 40, 'y': 40, 'w': 720, 'h': 500, 'bw': 6, 'bc': '#222222', 'fill': '#88aacc'},
        {'id': 'd1', 'type': 'draw', 'x': 100, 'y': 600, 'w': 200, 'h': 100, 'rot': 0, 's0': 100, 'color': '#ff0000', 'ow': 3, 'oc': '#ffffff', 'op': 80, 'strokes': [[pt(0, 0, 4), pt(0.5, 1, 6), pt(1, 0.5, 8)], [pt(0.25, 0.25, 6)]]},
        {'id': 'f1', 'type': 'fx', 'kind': 'mosaic', 'str': 20, 'color': '#ffffff', 'soft': 4, 'x': 100, 'y': 100, 'w': 300, 'h': 200, 'rot': 0, 's0': 122.474487, 'strokes': [[pt(0.1, 0.5, 30), pt(0.9, 0.5, 30)], [pt(0.5, 0.2, 30, 1), pt(0.5, 0.8, 30)]], 'shapes': []},
        {'id': 'f2', 'type': 'fx', 'kind': 'paint', 'str': 14, 'color': '#ffeeee', 'soft': 6, 'x': 400, 'y': 200, 'w': 200, 'h': 100, 'rot': 0, 's0': 141.42, 'strokes': [], 'shapes': [[0.5, 0.5, 0.25, 0.5]], 'auto': True, 'inPanel': 'a'},
        {'id': 'f3', 'type': 'fx', 'kind': 'blur', 'str': 12, 'color': '#ffffff', 'soft': 4, 'pad': 2, 'x': 500, 'y': 350, 'w': 120, 'h': 90, 'rot': 0, 's0': 103.9, 'strokes': [], 'shapes': [], 'polys': [[[0, 0], [1, 0.2], [0.5, 1]]]},
        {'id': 'f4', 'type': 'fx', 'kind': 'clone', 'str': 14, 'soft': 4, 'x': 0, 'y': 0, 'w': 50, 'h': 50, 's0': 50, 'strokes': [[pt(0.5, 0.5, 20)]], 'shapes': []},
        {'id': 's1', 'type': 'shape', 'x': 100, 'y': 800, 'w': 150, 'h': 150, 'rot': 15, 'kind': 'star', 'fillOn': True, 'fill': '#ffd400', 'stroke': '#222222', 'sw': 5, 'radius': 24, 'pts': 5, 'inner': 45, 'gradOn': False, 'fill2': '#000000', 'gradDir': 'v', 'op': 70},
        {'id': 's2', 'type': 'shape', 'kind': 'rect', 'x': 0, 'y': 0, 'w': 800, 'h': 1280, 'rot': 0, 'pass': True, 'name': '그라디언트 화면', 'fillOn': True, 'fill': '#000000', 'fillA': 0, 'fill2': '#000000', 'fill2A': 85, 'gradOn': True, 'gradDir': 'v', 'stroke': '#000000', 'sw': 0, 'op': 100},
        {'id': 's3', 'type': 'shape', 'x': 300, 'y': 900, 'w': 200, 'h': 24, 'rot': 30, 'kind': 'arrow', 'fillOn': False, 'fill': '#ffffff', 'stroke': '#0044ff', 'sw': 6, 'op': 100},
        {'id': 's4', 'type': 'shape', 'x': 300, 'y': 1000, 'w': 200, 'h': 24, 'rot': 0, 'kind': 'line', 'fillOn': False, 'stroke': '#000000', 'sw': 6, 'op': 100},
        {'id': 's5', 'type': 'shape', 'x': 550, 'y': 800, 'w': 100, 'h': 100, 'rot': 0, 'kind': 'ellipse', 'fillOn': False, 'fill': '#ffffff', 'stroke': '#00aa00', 'sw': 4, 'op': 100},
        {'id': 'st', 'type': 'stamp', 'x': 0, 'y': 0, 'w': 50, 'h': 50}]}]}}
    oldf = os.path.join(D, '옛 요소.json'); open(oldf, 'w', encoding='utf-8').write(json.dumps(old, ensure_ascii=False)); np = P(page, "__potato.state.project.pages.length")
    with page.expect_file_chooser() as fc: P(page, "__potato.run('file.import8')")
    fc.value.set_files(oldf); page.wait_for_function("__potato.state.project.pages.length === %d" % (np + 1)); es = P(page, "__potato.state.project.pages.at(-1).els")
    assert [e['type'] for e in es] == ['panel', 'draw', 'cover', 'cover', 'cover', 'shape', 'shape', 'shape', 'shape'], [e['type'] for e in es]
    d1 = es[1]; assert (d1['x'], d1['y'], d1['w'], d1['h'], d1['bw0'], d1['bh0']) == (100, 600, 200, 100, 200, 100) and d1['strokes'] == [[[0, 0], [100, 100], [200, 50]], [[50, 25]]] and d1['color'] == '#ff0000' and d1['ol'] == 3 and d1['olc'] == '#ffffff' and abs(d1['op'] - 0.8) < 1e-6, d1
    assert abs(d1['size'] - 6 * (20000 ** 0.5) / 100) < 0.06, d1['size']   # 점 굵기 평균(6) × 지금 크기 ÷ s0
    c1, c2, c3 = es[2:5]; assert c1['kind'] == 'mosaic' and c1['shape'] == 'brush' and c1['str'] == 20 and c1['soft'] == 0 and c1['strokes'] == [[[30, 100], [270, 100]]] and (c1['bw0'], c1['bh0']) == (300, 200) and abs(c1['size'] - 60) < 0.1, c1   # 지우개 획은 빠져요
    assert c2['kind'] == 'white' and c2['shape'] == 'ellipse' and (c2['x'], c2['y'], c2['w'], c2['h']) == (450, 200, 100, 100) and c2['soft'] == 6 and c2['color'] == '#ffeeee', c2
    assert c3['kind'] == 'blur' and c3['shape'] == 'rect' and (c3['x'], c3['y'], c3['w'], c3['h']) == (500, 350, 120, 90) and c3['str'] == 20 and c3['soft'] == 4, c3   # 윤곽 모양은 상자 전체 네모로
    s1, s2, s3, s5 = es[5:9]; assert s1['kind'] == 'star' and s1['fill'] == '#ffd400' and s1['fill2'] == '' and s1['bc'] == '#222222' and s1['bw'] == 5 and abs(s1['op'] - 0.7) < 1e-6 and s1['rot'] == 15, s1
    assert s2['kind'] == 'rect' and s2['fill'] == '#00000000' and s2['fill2'] == '#000000d9' and s2['bw'] == 0 and 'op' not in s2, s2
    assert s3['kind'] == 'arrow' and s3['fill'] == '#0044ff' and s3['bw'] == 0 and s3['rot'] == 30 and s5['kind'] == 'ellipse' and s5['fill'] == '' and s5['bc'] == '#00aa00' and s5['bw'] == 4, (s3, s5)
    page.wait_for_selector('.toast >> text=요소 3개'); page.wait_for_selector('.toast >> text=건너뛰었어요'); page.wait_for_timeout(300)
    # 화면에 실제로 그려져요: 흰칠 타원 가운데는 그 색(위에 덮인 화면만큼 어둡게), 그라디언트 화면은 위가 비치고 아래가 어두워요, 손그림의 빨간 획
    box = page.locator('.viewport').bounding_box(); P(page, "__potato.cut.pick(null)"); page.wait_for_timeout(200)
    w1 = P(page, px % (SX(500), SY(250))); assert all(abs(a - b) <= 4 for a, b in zip(w1, [213, 198, 198])), w1   # 흰칠 색(#ffeeee) 위에 그라디언트 화면이 17%쯤 덮여요
    top = P(page, px % (SX(20), SY(10))); bot = P(page, px % (SX(20), SY(1270))); assert min(top) > 245 and max(bot) < 60, (top, bot)
    r = P(page, px % (SX(100), SY(600))); assert r[0] > r[1] + 60 and r[0] > r[2] + 60, r   # 획이 시작하는 점은 빨강
    for e in es[1:]: P(page, "__potato.cut.pick('%s')" % e['id']); page.wait_for_timeout(60)   # 하나씩 골라도 설정이 오류 없이 그려져요
    shot(page, '107-import8-more'); assert not errs, errs
    P(page, "(() => { const p = __potato.state.project; p.pages.pop(); p.activePage = p.pages[0].id; __potato.emit(); })()"); page.wait_for_timeout(300)
    # 글꼴 파일 넣기: 글꼴 목록의 '글꼴 파일 넣기…'로 TTF를 고르면 작업에 저장되고 그 말풍선에 쓰여요. 다시 열어도 글꼴이 올라와 있어요
    FONT = os.path.join(D, '감자시험글꼴.ttf'); shutil.copy('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', FONT)
    FOK = "(() => [...document.fonts].some(f => f.family.replace(/\"/g, '') === '감자시험글꼴' && f.status === 'loaded') && document.fonts.check('28px \"감자시험글꼴\"'))()"
    assert not P(page, "[...document.fonts].some(f => f.family.includes('감자시험글꼴'))")
    P(page, "__potato.cut.pick('tb1')"); page.wait_for_selector('.vid-side select[aria-label="글꼴"]')
    with page.expect_file_chooser() as fc: page.select_option('.vid-side select[aria-label="글꼴"]', label='글꼴 파일 넣기… (TTF·OTF·WOFF)')
    fc.value.set_files(FONT); page.wait_for_function("(__potato.state.project.fonts || []).length === 1"); page.wait_for_selector('.toast >> text=글꼴을 이 작업에 넣었어요')
    fo = P(page, "__potato.state.project.fonts[0]"); assert fo['name'] == '감자시험글꼴' and fo['id'], fo
    assert P(page, PG + ".els.find(e => e.id === 'tb1').font") == '"감자시험글꼴"' and P(page, FOK)
    assert P(page, "document.querySelector('.vid-side select[aria-label=\"글꼴\"]').value") == '"감자시험글꼴"' and page.locator('.vid-side optgroup[label="이 작업에 넣은 글꼴"] option').count() == 1
    assert P(page, "__potato.store.idb.get('blobs', 'font:%s').then(b => b.size)" % fo['id']) == os.path.getsize(FONT)
    page.keyboard.press('Control+z'); assert not P(page, PG + ".els.find(e => e.id === 'tb1').font") and not P(page, "__potato.state.project.fonts")   # 되돌리면 넣은 글꼴도 목록에서 함께 빠져요 (그림 넣기와 같아요)
    page.keyboard.press('Control+Shift+z'); assert P(page, PG + ".els.find(e => e.id === 'tb1').font") == '"감자시험글꼴"' and len(P(page, "__potato.state.project.fonts")) == 1
    # 같은 글꼴 파일을 다른 말풍선에서 또 넣으면 두 번 저장하지 않고 그 글꼴만 골라 줘요
    P(page, "__potato.cut.pick('tb2')"); page.wait_for_timeout(80)
    with page.expect_file_chooser() as fc: page.select_option('.vid-side select[aria-label="글꼴"]', label='글꼴 파일 넣기… (TTF·OTF·WOFF)')
    fc.value.set_files(FONT); page.wait_for_selector('.toast >> text=이미 이 작업에 있어요'); assert len(P(page, "__potato.state.project.fonts")) == 1 and P(page, PG + ".els.find(e => e.id === 'tb2').font") == '"감자시험글꼴"'
    # 글꼴이 아닌 파일은 알려 주고 넣지 않아요
    with page.expect_file_chooser() as fc: page.select_option('.vid-side select[aria-label="글꼴"]', label='글꼴 파일 넣기… (TTF·OTF·WOFF)')
    fc.value.set_files(A); page.wait_for_selector('.toast >> text=글꼴 파일을 읽지 못했어요'); assert len(P(page, "__potato.state.project.fonts")) == 1
    shot(page, '108-font-file'); assert not errs, errs
    P(page, "__potato.run('file.save')"); page.wait_for_function("__potato.state.saved"); page.reload(); page.wait_for_function("window.__potato && __potato.cut && (__potato.state.project.fonts || []).length === 1")
    P(page, "__potato.settings.set('room', 'cut')"); page.wait_for_function(FOK); assert P(page, PG + ".els.find(e => e.id === 'tb1').font") == '"감자시험글꼴"'
    page.wait_for_timeout(200); shot(page, '109-font-reloaded')
    assert not errs, errs
    br.close()
print('통과')
