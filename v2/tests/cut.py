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
    # 새 페이지, 모든 페이지 저장(ZIP)
    P(page, "window.showDirectoryPicker = undefined"); page.click('.cut-add'); page.click('.menu >> text=4컷')
    assert P(page, "__potato.state.project.pages.length") == 2 and len(P(page, "__potato.state.project.pages[1].els")) == 4
    with page.expect_download() as dl: page.click('.vid-side >> text=모든 페이지 저장')
    z = zipfile.ZipFile(dl.value.path()); assert len(z.namelist()) == 2 and z.read(z.namelist()[0])[:4] == b'\x89PNG'
    page.wait_for_function("__potato.state.saved"); page.reload(); page.wait_for_function("window.__potato && __potato.state.project.pages && __potato.state.project.pages.length === 2")
    assert not errs, errs
    br.close()
print('통과')
