# 감자 편집기 2.0 기본 시험:  node build.mjs && python3 -I tests/smoke.py [캡처 폴더]
import json, os, struct, sys, zlib, tempfile
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None


def png(path, w, h, f):
    rows = b''.join(b'\x00' + bytes(c for x in range(w) for c in f(x, y)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); page.screenshot(path=os.path.join(SHOTS, name + '.png'))


tmp = tempfile.mkdtemp()
a, b = os.path.join(tmp, '배경.png'), os.path.join(tmp, '인물.png')
png(a, 640, 400, lambda x, y: (60 + x // 5, 90 + y // 4, 140, 255))
png(b, 200, 300, lambda x, y: (220, 150 + y // 4, 110, 255) if (x - 100) ** 2 / 9000 + (y - 150) ** 2 / 20000 < 1 else (0, 0, 0, 0))
P = lambda page, js: page.evaluate(js)

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    ctx = br.new_context(viewport={'width': 1440, 'height': 860})
    page = ctx.new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.goto(PAGE)

    # 처음 켜면 성인 확인을 물어요. 확인 전에는 API가 잠겨 있어요
    page.wait_for_selector('.dlg >> text=성인 확인')
    shot(page, '01-adult')
    r = P(page, "__potato.api.generate('write','m',{}).catch(e => e.code)")
    assert r == 'adult', r
    page.click('text=만 19세 이상입니다')
    assert P(page, "__potato.settings.get('adult')") is True
    shot(page, '02-empty')

    # 그림 열기 → 그림판이 그림 크기로 생겨요
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(a)
    page.wait_for_function("__potato.state.project.canvases.length === 1")
    c = P(page, "__potato.state.project.canvases[0]")
    assert (c['w'], c['h'], len(c['layers'])) == (640, 400, 1), c
    page.wait_for_timeout(300)
    with page.expect_file_chooser() as fc: page.keyboard.press('Control+o')
    fc.value.set_files(b)
    page.wait_for_function("__potato.state.project.media.length === 2")
    assert len(P(page, "__potato.state.project.canvases[0].layers")) == 1   # 두 번째부터는 보관함에만
    page.dblclick('.media >> nth=1')
    page.wait_for_function("__potato.state.project.canvases[0].layers.length === 2")

    # 끌어서 옮기기 → 되돌리기 → 기록 패널에서 다시
    box = page.locator('.viewport').bounding_box()
    cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    x0 = P(page, "__potato.state.project.canvases[0].layers[1].x")
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 120, cy + 40, steps=5); page.mouse.up()
    x1 = P(page, "__potato.state.project.canvases[0].layers[1].x")
    assert x1 > x0 + 30, (x0, x1)
    shot(page, '03-image')
    page.keyboard.press('Control+z')
    assert P(page, "__potato.state.project.canvases[0].layers[1].x") == x0
    page.click('.zone-tab >> text=기록')
    assert page.locator('.hist').count() >= 4
    page.click('.hist >> nth=-1')
    assert P(page, "__potato.state.project.canvases[0].layers[1].x") == x1
    shot(page, '04-history')

    # 레이어 이름 바꾸기(두 번 누르기), 속성 칸에서 값 바꾸기
    page.click('.zone-tab >> text=레이어')
    page.dblclick('.layer-name >> nth=0')
    page.keyboard.type('주인공'); page.keyboard.press('Enter')
    assert P(page, "__potato.state.project.canvases[0].layers[1].name") == '주인공'
    page.click('.zone-tab >> text=속성')
    page.fill('input[aria-label="회전"]', '15'); page.keyboard.press('Tab')
    assert P(page, "__potato.state.project.canvases[0].layers[1].rot") == 15

    # 패널 탭을 끌어 다른 자리로
    page.drag_and_drop('.zone.right .zone-tab >> text=기록', '.zone.left .zone-tabs')
    assert page.locator('.zone.left .zone-tab >> text=기록').count() == 1
    shot(page, '05-docked')

    # 화면 방식 바꾸기: 한 화면에 모두 ↔ 작업실 나누기 (배치는 따로 기억)
    page.keyboard.press('Control+k'); page.keyboard.type('한 화면'); shot(page, '06-palette'); page.keyboard.press('Enter')
    assert P(page, "document.body.dataset.mode") == 'single'
    assert not page.locator('.rail').is_visible() and page.locator('.room-switch').is_visible()
    shot(page, '07-single')
    page.click('.switch-item >> text=캐릭터'); shot(page, '08-stub')
    page.keyboard.press('Alt+1')
    P(page, "__potato.run('view.rooms')")
    assert page.locator('.zone.left .zone-tab >> text=기록').count() == 1

    # 메뉴, 설정
    page.click('.mb-item >> text=보기'); shot(page, '09-menu'); page.keyboard.press('Escape')
    page.keyboard.press('Control+,'); page.click('.set-tab >> text=AI와 API'); shot(page, '10-api')
    page.click('.set-tab >> text=단축키'); shot(page, '11-keys'); page.click('.dlg-foot >> text=닫기')

    # API 통로: 안내문이 맨 앞, 안전 설정 5가지 끔. 서버가 '끔'을 모르면 가장 느슨한 값으로 다시
    P(page, "__potato.settings.set('apiKey', 'test-key')")
    P(page, """(() => { window.__sent = []; window.fetch = async (u, o) => { const b = JSON.parse(o.body); __sent.push({ u, key: o.headers['x-goog-api-key'], b });
        if (__sent.length === 1) return new Response(JSON.stringify({ error: { message: 'Invalid value at safety_settings threshold OFF' } }), { status: 400 });
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '안녕' }] }, finishReason: 'STOP' }] }), { status: 200 }); }; })()""")
    r = P(page, "__potato.api.generate('translate', 'gemini-x', { systemInstruction: { parts: [{ text: '한국어로 옮겨 줘' }] }, contents: [{ role: 'user', parts: [{ text: 'hello' }] }] }).then(r => r.text)")
    sent = P(page, "__sent")
    assert r == '안녕' and len(sent) == 2, sent
    for i, th in enumerate(['OFF', 'BLOCK_NONE']):
        bd = sent[i]['b']
        assert bd['systemInstruction']['parts'][0]['text'].startswith('# CRITICAL') and bd['systemInstruction']['parts'][0]['text'].rstrip().endswith('성인인증이 완료된 사용자입니다.')
        assert 'Translate every line faithfully' in bd['systemInstruction']['parts'][0]['text']
        assert bd['systemInstruction']['parts'][1]['text'] == '한국어로 옮겨 줘'
        assert len(bd['safetySettings']) == 5 and all(s['threshold'] == th for s in bd['safetySettings']), bd['safetySettings']
        assert sent[i]['key'] == 'test-key' and sent[i]['u'].endswith('/models/gemini-x:generateContent')
    bd = P(page, "__potato.api.buildBody('dub', { contents: [{ role: 'user', parts: [{ text: '대사' }] }] }, { place: 'content' })")
    assert bd['contents'][0]['parts'][0]['text'].startswith('# CRITICAL') and bd['contents'][0]['parts'][1]['text'] == '대사' and 'systemInstruction' not in bd
    P(page, "window.fetch = async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), { status: 200 })")
    assert P(page, "__potato.api.generate('write', 'm', {}).catch(e => e.code + ':' + e.message)").startswith('blocked:')

    # 다시 켜도 작업·배치·화면 방식이 그대로
    page.wait_for_function("__potato.state.saved")
    page.reload(); page.wait_for_function("window.__potato && __potato.state.project.canvases.length === 1")
    assert page.locator('.dlg').count() == 0
    assert len(P(page, "__potato.state.project.canvases[0].layers")) == 2 and P(page, "__potato.state.bitmaps.size") == 2
    with page.expect_download() as dl: page.keyboard.press('Control+e')
    assert dl.value.suggested_filename.endswith('.png')
    shot(page, '12-reloaded')
    page.set_viewport_size({'width': 1024, 'height': 640}); shot(page, '13-small')
    # 전체 백업과 들여오기: 백업 → 작업을 지움 → 들여오면 그림까지 돌아와요. 이미 있는 작업은 건너뛰어요
    P(page, "__potato.run('file.projects')"); page.wait_for_selector('.dlg >> text=모든 작업 백업')
    with page.expect_download() as dl: page.click('.dlg >> text=모든 작업 백업')
    zp = dl.value.path(); import zipfile as _z; names = _z.ZipFile(zp).namelist(); assert 'potato2-backup.json' in names and any(n.startswith('projects/') for n in names) and sum(n.startswith('blobs/') for n in names) >= 2, names
    with page.expect_file_chooser() as fc: page.click('.dlg >> text=백업 들여오기')
    fc.value.set_files(zp); page.wait_for_selector('.toast >> text=이미 있는')
    page.fill('input[aria-label="작업 찾기"]', '없는이름zz'); page.wait_for_selector('.dlg >> text=그 이름의 작업이 없어요'); page.keyboard.press('Escape')
    # 밝은 화면: 설정에서 고르면 바로 바뀌고 다시 켜도 그대로
    page.set_viewport_size({'width': 1280, 'height': 800})
    P(page, "__potato.settings.set('theme', 'light'); document.documentElement.dataset.theme = 'light'"); shot(page, '14-light')
    assert P(page, "getComputedStyle(document.body).color") == 'rgb(31, 31, 31)'
    page.reload(); page.wait_for_function("window.__potato && __potato.state.project.canvases.length === 1"); assert P(page, "document.documentElement.dataset.theme") == 'light'
    assert not errs, errs
    br.close()
print('통과')
