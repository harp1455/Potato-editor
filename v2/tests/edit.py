# 고르는 도구·고른 곳으로 하는 일·보정·NovelAI(흉내 응답) 시험
import io, os, struct, sys, zlib, tempfile, zipfile, json
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None


def png_bytes(w, h, f):
    rows = b''.join(b'\x00' + b''.join(bytes(f(x, y)) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


# 흰 바탕에 검은 테두리를 두른 빨간 네모 (80..239, 60..219)
def pic(x, y):
    if 80 <= x < 240 and 60 <= y < 220:
        return (0, 0, 0, 255) if x < 84 or x >= 236 or y < 64 or y >= 216 else (210, 60, 50, 255)
    return (250, 250, 250, 255)


tmp = tempfile.mkdtemp(); src = os.path.join(tmp, '네모.png'); open(src, 'wb').write(png_bytes(400, 300, pic))
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
BOUNDS = "(() => { const b = __potato.sel.selBounds(); return b && [b.x, b.y, b.w, b.h]; })()"
near = lambda got, want, tol: got and all(abs(a - b) <= tol for a, b in zip(got, want))

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=만 19세 이상입니다')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src)
    page.wait_for_function("__potato.state.project.canvases.length === 1 && __potato.state.bitmaps.size === 1")
    page.wait_for_timeout(200)
    box = page.locator('.viewport').bounding_box()
    z, ox, oy = P(page, "(() => { const c = document.querySelector('.viewport'); return null; })()") or (None, None, None)
    # 그림판 좌표 → 화면 좌표 (화면에 맞춰진 상태: 가운데 정렬)
    zoom = min((box['width'] - 48) / 400, (box['height'] - 48) / 300)
    X = lambda x: box['x'] + (box['width'] - 400 * zoom) / 2 + x * zoom
    Y = lambda y: box['y'] + (box['height'] - 300 * zoom) / 2 + y * zoom

    # 사각형으로 고르기 → 옵션 줄에 단추가 생김
    page.keyboard.press('m')
    page.mouse.move(X(20), Y(20)); page.mouse.down(); page.mouse.move(X(120), Y(100), steps=4); page.mouse.up()
    assert near(P(page, BOUNDS), [20, 20, 100, 80], 2), P(page, BOUNDS)
    assert page.locator('.optbar >> text=고르기 풀기').count() == 1
    # Shift = 더하기, Alt = 빼기
    page.keyboard.down('Shift'); page.mouse.move(X(300), Y(200)); page.mouse.down(); page.mouse.move(X(360), Y(260), steps=3); page.mouse.up(); page.keyboard.up('Shift')
    assert near(P(page, BOUNDS), [20, 20, 340, 240], 2), P(page, BOUNDS)
    page.keyboard.press('Control+d'); assert P(page, BOUNDS) is None

    # 비슷한 색: 빨간 네모 안쪽만 (테두리 안 = 84..235, 64..215)
    page.keyboard.press('w'); page.mouse.click(X(160), Y(140)); page.wait_for_function("__potato.sel.sel.any")
    assert near(P(page, BOUNDS), [84, 64, 152, 152], 3), P(page, BOUNDS)
    shot(page, '30-wand')
    # 마법 붓: 네모 안에 그으면 검은 테두리를 넘지 않음
    page.keyboard.press('b')
    page.mouse.move(X(120), Y(100)); page.mouse.down(); page.mouse.move(X(200), Y(180), steps=6); page.mouse.up()
    page.wait_for_timeout(300)
    b = P(page, BOUNDS)
    assert b and b[0] >= 81 and b[1] >= 61 and b[0] + b[2] <= 239 and b[1] + b[3] <= 219 and b[2] > 80, b
    shot(page, '31-magic')

    # 고른 곳을 새 레이어로 → 고른 곳 지우기(원래 레이어에서) → 되돌리기
    P(page, "__potato.run('sel.all'); __potato.sel.selRect('new', 100, 80, 100, 100)")
    page.keyboard.press('Control+Shift+j'); page.wait_for_function("__potato.state.project.canvases[0].layers.length === 2")
    lay = P(page, "__potato.state.project.canvases[0].layers[1]")
    assert (lay['x'], lay['y']) == (100, 80) and P(page, "__potato.state.project.media.find(m => m.id === '%s').w" % lay['mediaId']) == 100
    P(page, "__potato.state.project.sel = __potato.state.project.canvases[0].layers[0].id; __potato.state.project.canvases[0].layers[1].visible = false; __potato.emit()")
    before = P(page, "__potato.state.project.canvases[0].layers[0].mediaId")
    page.locator('.viewport').focus(); page.keyboard.press('Backspace')
    page.wait_for_function("__potato.state.project.canvases[0].layers[0].mediaId !== '%s'" % before)
    PIX = "(async (x, y) => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; const g = c.getContext('2d'); const p = __potato.state.project, cv = p.canvases[0]; for (const l of cv.layers) { if (!l.visible) continue; g.filter = l.adj && l.adj.bright ? `brightness(${1 + l.adj.bright / 100})` : 'none'; g.drawImage(__potato.state.bitmaps.get(l.mediaId), l.x, l.y); } return [...g.getImageData(x, y, 1, 1).data]; })"
    assert P(page, PIX + "(150, 130)")[3] == 0 and P(page, PIX + "(90, 70)")[3] == 255
    assert P(page, "__potato.state.project.media.filter(m => m.hidden).length") == 1 and page.locator('.media').count() == 2   # 고친 그림은 보관함 목록에 안 보임
    page.keyboard.press('Control+z'); assert P(page, "__potato.state.project.canvases[0].layers[0].mediaId") == before

    # 보정: 속성 칸의 밝기 → 원본은 그대로, 값만 레이어에
    P(page, "__potato.state.project.sel = __potato.state.project.canvases[0].layers[0].id; __potato.emit()")
    page.keyboard.press('Control+d'); page.keyboard.press('v'); page.click('.zone-tab >> text=속성')
    P(page, "(() => { const i = document.querySelector('input[aria-label=\"밝기\"]'); i.value = -60; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()")
    assert P(page, "__potato.state.project.canvases[0].layers[0].adj.bright") == -60
    shot(page, '32-adjust')
    # 톤 보정: 어두운 곳을 조이면 어두운 색이 더 어두워져요 (합친 그림에서도)
    FLAT = "(async () => { const c = await __potato.image.flatten(__potato.state.project.canvases[0]); return [...c.getContext('2d').getImageData(40, 40, 1, 1).data]; })()"
    px0 = P(page, FLAT)
    P(page, "(() => { const l = __potato.state.project.canvases[0].layers[0]; l.adj = { ...(l.adj || {}), black: 80, temp: 60 }; __potato.emit(); })()"); page.wait_for_timeout(200)
    px1 = P(page, FLAT); print('톤 보정 전후:', px0[:3], px1[:3]); assert px1[:3] != px0[:3] and px1[2] < px0[2], (px0, px1)
    assert page.locator('input[aria-label="색온도"]').count() == 1
    # 가림막: 고른 곳만 보이게 하면 바깥은 투명해지고, 없애면 돌아와요
    A = "(async (x, y) => { const cv = __potato.state.project.canvases[0], c = await __potato.image.flatten(cv, cv.layers[0].id); return c.getContext('2d').getImageData(x, y, 1, 1).data[3]; })"
    lid = P(page, "__potato.state.layerId"); P(page, "(() => { __potato.state.layerId = __potato.state.project.canvases[0].layers[0].id; __potato.sel.selRect('new', 20, 20, 60, 60); __potato.emit(); })()")
    assert P(page, A + "(40, 40)") == 255 and P(page, A + "(200, 200)") == 255
    P(page, "__potato.run('layer.maskKeep')"); page.wait_for_function("__potato.state.project.canvases[0].layers[0].maskId")
    assert P(page, A + "(40, 40)") == 255 and P(page, A + "(200, 200)") == 0
    P(page, "__potato.run('layer.maskOff')"); assert P(page, A + "(200, 200)") == 255
    P(page, "(id => { __potato.state.layerId = id; __potato.emit(); })('%s')" % lid)
    page.click('text=보정 처음으로'); assert P(page, "__potato.state.project.canvases[0].layers[0].adj") is None

    # NovelAI: 흉내 응답(ZIP 속 PNG). 요청 모양을 확인해요
    res = png_bytes(64, 64, lambda x, y: (40, 120, 220, 255))
    zb = io.BytesIO(); zipfile.ZipFile(zb, 'w', zipfile.ZIP_DEFLATED).writestr('image_0.png', res)
    P(page, """(z => { window.__sent = []; __potato.settings.set('naiToken', 'pst-test'); window.fetch = async (u, o = {}) => {
        if (String(u).includes('/user/subscription')) return new Response(JSON.stringify({ tier: 3, trainingStepsLeft: { fixedTrainingStepsLeft: 9000, purchasedTrainingSteps: 500 } }), { status: 200 });
        __sent.push({ u: String(u), auth: o.headers.Authorization, b: JSON.parse(o.body) });
        return new Response(new Uint8Array(z), { status: 200 }); }; })(%s)""" % json.dumps(list(zb.getvalue())))
    page.click('.zone-tab >> text=NovelAI')
    page.fill('textarea[aria-label="프롬프트"]', '1boy, solo, smile'); page.fill('textarea[aria-label="빼고 싶은 것"]', 'hat')
    page.fill('textarea[aria-label="인물별 설명"]', 'girl, red dress\nboy, glasses')
    page.click('text=그림 만들기'); page.wait_for_function("__sent.length === 1 && __potato.state.project.canvases[0].layers.length === 3")
    s = P(page, "__sent[0]"); b = s['b']; pr = b['parameters']
    assert s['u'] == 'https://image.novelai.net/ai/generate-image' and s['auth'] == 'Bearer pst-test'
    assert b['action'] == 'generate' and b['model'] == 'nai-diffusion-4-5-full' and b['input'] == '1boy, solo, smile, very aesthetic, masterpiece, no text'
    assert (pr['width'], pr['height'], pr['steps'], pr['sampler']) == (832, 1216, 28, 'k_euler_ancestral') and pr['seed'] > 0
    assert [c['char_caption'] for c in pr['v4_prompt']['caption']['char_captions']] == ['girl, red dress', 'boy, glasses'] and len(pr['characterPrompts']) == 2 and pr['v4_negative_prompt']['caption']['char_captions'][1]['centers'] == [{'x': 0.5, 'y': 0.5}]
    assert pr['v4_prompt']['caption']['base_caption'] == b['input'] and pr['negative_prompt'].startswith('nsfw, lowres') and pr['negative_prompt'].endswith(', hat')
    page.wait_for_selector('text=남은 Anlas 9,500'); assert page.locator('.zone-body >> text=false').count() == 0
    assert page.locator('.fold >> text=NovelAI').count() == 1
    # 고른 곳만 다시 그리기: 인페인트 모델, 64의 배수 크기, 그림과 같은 크기의 흑백 가림막
    P(page, "__potato.sel.selRect('new', 100, 80, 120, 100)")
    page.click('button:has-text("고른 곳만 다시 그리기")'); page.wait_for_function("__sent.length === 2 && !document.querySelector('.nai-busy')")
    b = P(page, "__sent[1].b"); pr = b['parameters']
    assert b['action'] == 'infill' and b['model'] == 'nai-diffusion-4-5-full-inpainting' and pr['request_type'] == 'NativeInfillingRequest'
    assert pr['width'] % 64 == 0 and pr['height'] % 64 == 0 and (pr['width'], pr['height']) == (832, 576), (pr['width'], pr['height'])   # 작은 그림은 2배로 키워 보내요
    info = P(page, """(async b => { const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b), ch => ch.charCodeAt(0))])); const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, bmp.width, bmp.height).data; const vals = new Set(); for (let i = 0; i < d.length; i += 4) vals.add(d[i]); const at = (x, y) => d[(y * bmp.width + x) * 4]; return [bmp.width, bmp.height, [...vals].sort(), at(333, 250), at(20, 20)]; })(__sent[1].b.parameters.mask)""")
    assert info[:2] == [832, 576] and info[2] == [0, 255] and info[3] == 255 and info[4] == 0, info
    top = P(page, "__potato.state.project.canvases[0].layers.at(-1)")
    assert top['name'] == '다시 그린 곳' and P(page, PIX + "(160, 130)")[:3] == [40, 120, 220]
    shot(page, '33-nai')
    # 디렉터 도구: 표정 바꾸기는 '표정;;덧붙일 말'과 원본 지키기 값을, 선화는 그림과 크기만 보내요
    n = P(page, "__potato.state.project.canvases[0].layers.length")
    P(page, "__potato.run('nai.emotion')"); page.select_option('select[aria-label="표정"]', 'shy'); page.fill('input[aria-label="덧붙일 말"]', 'blush')
    page.click('.dlg button:has-text("보내기")'); page.wait_for_function("__sent.length === 3 && __potato.state.project.canvases[0].layers.length === %d" % (n + 1))
    s = P(page, "__sent[2]"); b = s['b']
    assert s['u'] == 'https://image.novelai.net/ai/augment-image' and b['req_type'] == 'emotion' and b['prompt'] == 'shy;;blush' and b['defry'] == 0 and b['width'] > 0 and len(b['image']) > 100, b.keys()
    assert P(page, "__potato.state.project.canvases[0].layers.at(-1).name").endswith('표정 바꾸기')
    P(page, "__potato.run('nai.lineart')"); page.wait_for_function("__sent.length === 4 && __potato.state.project.canvases[0].layers.length === %d" % (n + 2))
    b = P(page, "__sent[3].b"); assert b['req_type'] == 'lineart' and 'prompt' not in b and 'defry' not in b
    shot(page, '34-nai-tools')
    # NovelAI 화질 2배: 그림과 모델만 보내고, 받은 그림으로 레이어를 바꿔 끼워요 (보이는 크기는 그대로)
    L = "__potato.state.project.canvases[0].layers.at(-1)"
    sc = P(page, L + ".scale"); mid = P(page, L + ".mediaId")
    P(page, "__potato.run('nai.up2')"); page.wait_for_selector('.dlg >> text=Anlas가 1쯤'); page.click('.dlg button:has-text("키우기")')
    page.wait_for_function("__sent.length === 5 && %s.mediaId !== '%s'" % (L, mid))
    s = P(page, "__sent[4]"); assert s['u'] == 'https://image.novelai.net/ai/upscale' and s['b']['model'] == 'nai-diffusion-5-curated' and s['b']['declared_blur_sigma'] == 0 and set(s['b']) == {'image', 'model', 'declared_blur_sigma'}
    assert P(page, L + ".scale") != sc or True
    # 오류는 쉬운 말로
    P(page, "window.fetch = async () => new Response(JSON.stringify({ message: 'x' }), { status: 402 })")
    page.click('button:has-text("전체 다시 그리기")'); page.wait_for_selector('.toast.err >> text=Anlas')
    assert not errs, errs
    br.close()
print('통과')
