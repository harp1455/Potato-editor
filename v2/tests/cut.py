# 컷 작업실 시험: 페이지 만들기 → 컷에 그림 담기 → 말풍선·글자 → 번역(흉내 응답) → 내보내기
import os, struct, sys, tempfile, zlib, zipfile
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
rows = b''.join(b'\x00' + b''.join(bytes((70 + x // 4, 120, 200 - y // 3, 255)) for x in range(400)) for y in range(300))
chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
src = os.path.join(tempfile.mkdtemp(), '그림.png'); open(src, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 400, 300, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
ELS = "__potato.state.project.pages[0].els"
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}, accept_downloads=True).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=만 19세 이상입니다')
    with page.expect_file_chooser() as fc: page.click('[aria-label="그림 넣기"]')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.media.length === 1")
    page.keyboard.press('Alt+2'); page.wait_for_selector('.empty-room >> text=페이지를 만들어'); shot(page, '80-cut-empty')
    page.click('.empty-room >> text=위아래 2컷')
    els = P(page, ELS); assert len(els) == 2 and all(e['type'] == 'panel' for e in els) and els[0]['y'] < els[1]['y']
    page.wait_for_timeout(200)
    box = page.locator('.viewport').bounding_box(); zoom = min((box['width'] - 48) / 800, (box['height'] - 48) / 1280)
    X = lambda x: box['x'] + (box['width'] - 800 * zoom) / 2 + x * zoom; Y = lambda y: box['y'] + (box['height'] - 1280 * zoom) / 2 + y * zoom
    # 보관함 그림을 첫 컷에 끌어 담기
    page.drag_and_drop('.media >> nth=0', '.viewport', target_position={'x': X(400) - box['x'], 'y': Y(300) - box['y']})
    page.wait_for_function(ELS + "[0].mediaId"); assert P(page, ELS + "[1].mediaId") is None
    # 말풍선 만들기 → 대사 고치기 → 꼬리
    page.keyboard.press('b'); page.mouse.move(X(450), Y(120)); page.mouse.down(); page.mouse.move(X(700), Y(260), steps=4); page.mouse.up()
    bub = P(page, ELS + "[2]"); assert bub['type'] == 'bubble' and abs(bub['w'] - 250) < 6 and bub['tail']
    page.fill('.vid-side textarea[aria-label="대사"]', 'Hello!\nLong time no see.'); page.keyboard.press('Tab')
    assert P(page, ELS + "[2].text") == 'Hello!\nLong time no see.'
    # 글자 넣기, 옮기기, 되돌리기
    page.keyboard.press('t'); page.mouse.click(X(200), Y(900)); assert P(page, ELS + "[3].type") == 'text'
    page.fill('.vid-side textarea[aria-label="대사"]', 'BANG'); page.keyboard.press('Tab')
    x0 = P(page, ELS + "[3].x"); tx, ty = P(page, "(() => { const e = %s[3]; return [e.x + e.w / 2, e.y + e.h / 2]; })()" % ELS)
    page.mouse.move(X(tx), Y(ty)); page.mouse.down(); page.mouse.move(X(tx + 100), Y(ty), steps=4); page.mouse.up()
    assert abs(P(page, ELS + "[3].x") - x0 - 100) < 4; page.keyboard.press('Control+z'); assert P(page, ELS + "[3].x") == x0
    shot(page, '81-cut')
    # 대사 번역 (흉내 응답): 번역용 안내문이 맨 앞, 안전 설정 5가지 끔, 같은 차례로 바꿔 넣기
    P(page, """(() => { __potato.settings.set('apiKey', 'k'); window.__sent = []; window.fetch = async (u, o) => { const b = JSON.parse(o.body); __sent.push({ u: String(u), b }); const lines = JSON.parse(b.contents[0].parts[0].text);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(lines.map(t => '번역:' + t)) }] }, finishReason: 'STOP' }] }), { status: 200 }); }; })()""")
    page.mouse.click(X(40), Y(1270)); page.click('.vid-side >> text=대사 번역'); shot(page, '82-translate'); page.click('.dlg-foot >> text=번역하기')
    page.wait_for_function(ELS + "[3].text === '번역:BANG'")
    assert P(page, ELS + "[2].text") == '번역:Hello!\nLong time no see.'
    b = P(page, "__sent[0].b"); sysT = b['systemInstruction']['parts']
    assert sysT[0]['text'].startswith('# CRITICAL') and 'Translate every line faithfully' in sysT[0]['text'] and 'Korean' in sysT[1]['text'] and len(b['safetySettings']) == 5 and all(x['threshold'] == 'OFF' for x in b['safetySettings'])
    page.keyboard.press('Control+z'); assert P(page, ELS + "[3].text") == 'BANG'
    # 말풍선 모양(구름·외침)과 세로쓰기도 그려져요
    for shp in ['cloud', 'shout']:
        P(page, "(() => { const e = %s[2]; e.shape = '%s'; e.vert = true; __potato.emit(); })()" % (ELS, shp)); page.wait_for_timeout(150)
    shot(page, '83-shapes'); P(page, "(() => { const e = %s[2]; e.shape = 'ellipse'; e.vert = false; __potato.emit(); })()" % ELS)
    # 여러 개 함께 고르기: Shift로 더해 고르고 함께 옮기고, 되돌려요
    page.keyboard.press('v'); e0 = P(page, ELS + "[0]"); e1 = P(page, ELS + "[1]")
    page.mouse.click(X(e0['x'] + 30), Y(e0['y'] + e0['h'] - 30)); page.keyboard.down('Shift'); page.mouse.click(X(e1['x'] + 30), Y(e1['y'] + e1['h'] - 30)); page.keyboard.up('Shift')
    page.mouse.move(X(e1['x'] + 30), Y(e1['y'] + e1['h'] - 30)); page.mouse.down(); page.mouse.move(X(e1['x'] + 70), Y(e1['y'] + e1['h'] - 30), steps=3); page.mouse.up()
    a0 = P(page, ELS + "[0].x"); a1 = P(page, ELS + "[1].x"); assert a0 - e0['x'] == a1 - e1['x'] and a0 != e0['x'], (a0, a1)
    page.keyboard.press('Control+z'); assert P(page, ELS + "[0].x") == e0['x']; page.keyboard.press('Escape')
    # 효과음: 크게, 기울여서 들어가요
    n1 = P(page, ELS + ".length"); P(page, "__potato.run('cut.sfx')"); sf = P(page, ELS + ".at(-1)"); assert sf['rot'] == -12 and sf['size'] > 80 and page.locator('.vid-side input[aria-label="회전"]').count() == 1
    shot(page, '85-sfx'); page.keyboard.press('Control+z'); assert P(page, ELS + ".length") == n1
    # 집중선: 끌어서 넣으면 가장자리는 선으로 덮이고 가운데는 비어 있어요
    n0 = P(page, ELS + ".length"); page.keyboard.press('l'); page.mouse.move(X(60), Y(700)); page.mouse.down(); page.mouse.move(X(460), Y(1100), steps=4); page.mouse.up()
    ln = P(page, ELS + ".at(-1)"); assert P(page, ELS + ".length") == n0 + 1 and ln['type'] == 'lines' and abs(ln['w'] - 400) < 8
    assert page.locator('.vid-side input[aria-label="선 수"]').count() == 1
    shot(page, '84-lines'); page.keyboard.press('Control+z'); assert P(page, ELS + ".length") == n0
    # 그림 속 글자 번역 (흉내 응답): 그림을 보내고, 받은 자리에 덮는 네모와 번역을 올려요
    P(page, """(() => { window.__sent = []; window.fetch = async (u, o) => { const b = JSON.parse(o.body); __sent.push(b); const img = b.contents[0].parts.some(p => p.inlineData);
        const text = img ? JSON.stringify([{ box: [100, 100, 200, 400], text: 'こんにちは', translation: '안녕하세요' }, { box: [0, 0, 0, 0], text: 'x', translation: '' }]) : JSON.stringify(JSON.parse(b.contents[0].parts[0].text).map(t => 'T:' + t));
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 }); }; })()""")
    n0 = len(P(page, ELS)); page.mouse.click(X(40), Y(1270)); page.click('.vid-side >> text=대사 번역'); page.check('.dlg label:has-text("그림 속에 그려진 글자도") input'); page.click('.dlg-foot >> text=번역하기')
    page.wait_for_function(ELS + ".length === %d" % (n0 + 1))
    e = P(page, ELS + ".at(-1)"); assert e['text'] == '안녕하세요' and e['shape'] == 'rect' and (e['x'], e['y'], e['w'], e['h']) == (80, 128, 240, 128) and e['from'] == 'こんにちは' and e['fill'].startswith('#'), e
    assert P(page, "__sent[0].contents[0].parts[0].inlineData.mimeType") == 'image/jpeg' and P(page, "__sent[0].systemInstruction.parts[0].text").startswith('# CRITICAL')
    shot(page, '84-image-text'); page.keyboard.press('Control+z'); assert len(P(page, ELS)) == n0

    # 8.x 작업 파일 가져오기: 그림은 보관함 폴더로, 페이지는 컷 작업실로, 없는 요소는 건너뜀
    import base64, json
    old = {'app': 'potato-editor', 'v': 3, 'imageOrder': ['i1'], 'images': [{'id': 'i1', 'name': '옛그림.png', 'src': 'data:image/png;base64,' + base64.b64encode(open(src, 'rb').read()).decode(), 'w': 400, 'h': 300, 'folder': 'f1'}], 'fonts': [],
           'doc': {'name': '옛 작품', 'mode': 'cut', 'cur': 0, 'folders': [{'id': 'f1', 'name': '1화', 'parent': None}], 'pages': [{'id': 'p1', 'name': '페이지 1', 'w': 800, 'h': 4000, 'bg': '#ffffff', 'els': [
               {'id': 'a', 'type': 'panel', 'x': 40, 'y': 40, 'w': 720, 'h': 500, 'img': 'i1', 'iz': 1.2, 'ox': 5, 'oy': -3, 'bw': 6, 'bc': '#222222'},
               {'id': 'b', 'type': 'bubble', 'x': 400, 'y': 80, 'w': 240, 'h': 150, 'shape': 'round', 'text': '옛 대사', 'fs': 30, 'color': '#111111', 'fill': '#ffffff', 'stroke': '#111111', 'sw': 3, 'tail': True, 'tx': 470, 'ty': 300},
               {'id': 'c', 'type': 'text', 'x': 100, 'y': 700, 'w': 200, 'h': 100, 'text': '쾅!', 'fs': 96, 'color': '#ffffff', 'sc': '#111111', 'sw': 8, 'bold': True},
               {'id': 'd', 'type': 'stamp', 'x': 0, 'y': 0, 'w': 50, 'h': 50}]}]}}
    oldf = os.path.join(os.path.dirname(src), '옛 작품.json'); open(oldf, 'w', encoding='utf-8').write(json.dumps(old, ensure_ascii=False))
    np = P(page, "__potato.state.project.pages.length")
    with page.expect_file_chooser() as fc: P(page, "__potato.run('file.import8')")
    fc.value.set_files(oldf); page.wait_for_function("__potato.state.project.pages.length === %d" % (np + 1))
    pr = P(page, "__potato.state.project"); pg8 = pr['pages'][-1]
    assert [e['type'] for e in pg8['els']] == ['panel', 'bubble', 'text'] and pg8['h'] == 4000 and pg8['els'][0]['mediaId'] and pg8['els'][0]['is'] == 1.2 and pg8['els'][1]['size'] == 30 and pg8['els'][2]['sw'] == 8
    names = {f['id']: f for f in pr['folders']}; m8 = next(m for m in pr['media'] if m['name'] == '옛그림.png')
    assert names[m8['folder']]['name'] == '1화' and names[names[m8['folder']]['parent']]['name'] == '옛 작품'
    page.wait_for_selector('.toast >> text=건너뛰었어요'); shot(page, '85-import8')
    P(page, "(() => { const p = __potato.state.project; p.pages.pop(); p.activePage = p.pages[0].id; __potato.emit(); })()"); page.wait_for_timeout(300)

    # 새 페이지, 모든 페이지 저장(ZIP)
    P(page, "window.showDirectoryPicker = undefined"); page.click('.cut-add'); page.click('.menu >> text=4컷')
    assert P(page, "__potato.state.project.pages.length") == 2 and len(P(page, "__potato.state.project.pages[1].els")) == 4
    with page.expect_download() as dl: page.click('.vid-side >> text=모든 페이지 저장')
    z = zipfile.ZipFile(dl.value.path()); assert len(z.namelist()) == 2 and z.read(z.namelist()[0])[:4] == b'\x89PNG'
    page.wait_for_function("__potato.state.saved"); page.reload(); page.wait_for_function("window.__potato && __potato.state.project.pages && __potato.state.project.pages.length === 2")
    assert not errs, errs
    br.close()
print('통과')
