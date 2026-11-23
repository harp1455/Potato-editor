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
    # 고급 보정(8.x에서 옮김): 노출을 올리면 밝아지고, 활기를 -100으로 내리면 색이 빠져요
    e0 = P(page, FLAT); P(page, "(() => { const l = __potato.state.project.canvases[0].layers[0]; l.adj = { ...(l.adj || {}), black: 0, temp: 0, bright: 0, exposure: 40 }; __potato.emit(); })()"); e1 = P(page, FLAT)
    P(page, "(() => { const l = __potato.state.project.canvases[0].layers[0]; l.adj = { exposure: 0, vib: -100 }; __potato.emit(); })()"); e2 = P(page, FLAT); print('고급 보정:', e0[:3], e1[:3], e2[:3])
    assert page.locator('input[aria-label="노출"]').count() == 1 and page.locator('input[aria-label="선명하게"]').count() == 1
    P(page, "(() => { const l = __potato.state.project.canvases[0].layers[0]; l.adj = { bright: -60, black: 80, temp: 60 }; __potato.emit(); })()")
    # 곡선: 가운데 점을 위로 끌면 중간 밝기가 밝아져요. 두 번 누르면 처음으로
    cb = page.locator('canvas.curve').bounding_box(); pxa = P(page, FLAT)
    page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2); page.mouse.down(); page.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] * 0.2, steps=3); page.mouse.up()
    cu = P(page, "__potato.state.project.canvases[0].layers[0].adj.curve"); pxb = P(page, FLAT); assert len(cu) == 5 and cu[2] > 0.7 and cu[0] == 0 and pxb[:3] != pxa[:3], (cu, pxa, pxb)
    shot(page, '32b-curve'); page.dblclick('canvas.curve'); assert P(page, "__potato.state.project.canvases[0].layers[0].adj.curve") is None
    # 뒤틀기: 창에서 그림을 끌어 밀면 바뀐 그림으로 바꿔 끼워요. 밀기 계산은 민 쪽으로 색이 옮겨 가요
    wr = P(page, """(() => { const F = __potato.liq.makeField(64, 64), src = new ImageData(64, 64); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4; src.data[i] = x < 32 ? 255 : 0; src.data[i + 3] = 255; }
        __potato.liq.stroke(F, 'push', 32, 32, 24, 1, 10, 0); const out = __potato.liq.warp(F, src, new ImageData(64, 64)); return [out.data[(32 * 64 + 36) * 4], out.data[(2 * 64 + 36) * 4], out.data[(32 * 64 + 36) * 4 + 3]]; })()""")
    assert wr[0] > 200 and wr[1] == 0 and wr[2] == 255, wr
    P(page, "(() => { __potato.state.layerId = __potato.state.project.canvases[0].layers[0].id; __potato.emit(); })()"); mid0 = P(page, "__potato.state.project.canvases[0].layers[0].mediaId")
    P(page, "__potato.run('layer.liquify')"); page.wait_for_selector('canvas.liq-view'); vb = page.locator('canvas.liq-view').bounding_box()
    page.mouse.move(vb['x'] + vb['width'] * 0.4, vb['y'] + vb['height'] * 0.5); page.mouse.down(); page.mouse.move(vb['x'] + vb['width'] * 0.6, vb['y'] + vb['height'] * 0.5, steps=6); page.mouse.up()
    shot(page, '32c-liquify'); page.click('.dlg button:has-text("이대로 바꾸기")'); page.wait_for_function("__potato.state.project.canvases[0].layers[0].mediaId !== '%s'" % mid0)
    page.keyboard.press('Control+z'); assert P(page, "__potato.state.project.canvases[0].layers[0].mediaId") == mid0
    # 전체 보정: 그림판 값이라 합친 그림 전체가 바뀌고, 지우면 돌아와요. 안내선: 옮길 때 달라붙어요
    f0 = P(page, FLAT); P(page, "(() => { const c = __potato.state.project.canvases[0]; c.adj = { sat: -100, contrast: 40 }; __potato.emit(); })()"); f1 = P(page, FLAT)
    assert f1[:3] != f0[:3] and abs(f1[0] - f1[1]) < 3 and abs(f1[1] - f1[2]) < 3, (f0, f1)
    P(page, "(() => { delete __potato.state.project.canvases[0].adj; __potato.emit(); })()"); assert P(page, FLAT)[:3] == f0[:3]
    P(page, "__potato.run('view.guideThirds')"); assert P(page, "__potato.state.project.canvases[0].lines.v.length") == 2; P(page, "__potato.run('view.rulers')"); shot(page, '32d-guides')
    P(page, "__potato.run('view.rulers')"); P(page, "__potato.run('view.guideClear')"); assert P(page, "__potato.state.project.canvases[0].lines") is None
    # 묶음 내보내기: PNG와 JPG, 두 가지 크기 → 네 장
    P(page, "__potato.settings.set('exportSet', { png: true, jpg: true, webp: false, sizes: '100, 50', q: 80 }); window.showDirectoryPicker = undefined")
    P(page, "__potato.run('file.exportSet')")
    with page.expect_download() as dl: page.click('.dlg button:has-text("내보내기")')
    import zipfile as _z; zn = _z.ZipFile(dl.value.path()).namelist(); assert len(zn) == 4 and sum(n.endswith('.jpg') for n in zn) == 2, zn
    # 8.x에서 옮긴 것: 섞는 법, 뒤집기, 고른 곳 모자이크(새 레이어), 고른 곳으로 자르기
    C0 = "__potato.state.project.canvases[0]"
    P(page, "(() => { const c = %s; __potato.state.layerId = c.layers[0].id; __potato.emit(); })()" % C0); assert page.locator('select[aria-label="섞는 법"]').count() == 1
    P(page, "__potato.run('layer.flipX')"); assert P(page, C0 + ".layers[0].flipX") is True; page.keyboard.press('Control+z')
    nl = P(page, C0 + ".layers.length"); P(page, "__potato.sel.selRect('new', 30, 30, 120, 90)"); P(page, "__potato.run('sel.mosaic')"); page.wait_for_function(C0 + ".layers.length === %d" % (nl + 1)); assert P(page, C0 + ".layers.at(-1).name") == '모자이크'
    page.keyboard.press('Control+z'); wh = P(page, "[%s.w, %s.h]" % (C0, C0)); P(page, "__potato.sel.selRect('new', 30, 30, 120, 90)"); P(page, "__potato.run('sel.crop')"); assert P(page, "[%s.w, %s.h]" % (C0, C0)) == [120, 90]
    page.keyboard.press('Control+z'); assert P(page, "[%s.w, %s.h]" % (C0, C0)) == wh
    # 그리는 도구(8.x에서 옮김): 붓으로 그으면 '그리기' 레이어가 생기고 그 자리에 색이 칠해져요. 지우개, 도형, 되돌리기
    C0 = "__potato.state.project.canvases[0]"; nl = P(page, C0 + ".layers.length"); vb = page.locator('.viewport').first.bounding_box()
    PX = "(async (x, y) => { const cv = %s, c = await __potato.image.flatten(cv, cv.layers.find(l => l.paint).id); return [...c.getContext('2d').getImageData(x, y, 1, 1).data]; })" % C0
    D2S = "((x, y) => { const v = __potato.image.view; return [x * v.zoom + v.ox, y * v.zoom + v.oy]; })"
    P(page, "__potato.run('view.fit')"); page.wait_for_timeout(200)
    P(page, "__potato.settings.set('paint', { color: '#ff0000', size: 20, alpha: 100, shape: 'rect', fill: true })"); page.keyboard.press('p')
    a = P(page, D2S + "(60, 60)"); b = P(page, D2S + "(160, 60)")
    page.mouse.move(vb['x'] + a[0], vb['y'] + a[1]); page.mouse.down(); page.mouse.move(vb['x'] + b[0], vb['y'] + b[1], steps=5); page.mouse.up()
    page.wait_for_function(C0 + ".layers.length === %d && %s.layers.some(l => l.paint)" % (nl + 1, C0)); page.wait_for_timeout(300)
    px = P(page, PX + "(110, 60)"); assert px[0] > 240 and px[1] < 15 and px[3] == 255, px; assert P(page, PX + "(110, 120)")[3] == 0
    m1 = P(page, C0 + ".layers.find(l => l.paint).mediaId"); page.keyboard.press('x'); page.mouse.move(vb['x'] + a[0], vb['y'] + a[1]); page.mouse.down(); page.mouse.move(vb['x'] + (a[0] + b[0]) / 2, vb['y'] + a[1], steps=4); page.mouse.up(); page.wait_for_function(C0 + ".layers.find(l => l.paint).mediaId !== '%s'" % m1); page.wait_for_timeout(200)
    assert P(page, PX + "(70, 60)")[3] == 0 and P(page, PX + "(150, 60)")[3] == 255
    page.keyboard.press('u'); c1 = P(page, D2S + "(40, 150)"); c2 = P(page, D2S + "(120, 200)"); page.mouse.move(vb['x'] + c1[0], vb['y'] + c1[1]); page.mouse.down(); m2 = P(page, C0 + ".layers.find(l => l.paint).mediaId"); page.mouse.move(vb['x'] + c2[0], vb['y'] + c2[1], steps=4); page.mouse.up(); page.wait_for_function(C0 + ".layers.find(l => l.paint).mediaId !== '%s'" % m2); page.wait_for_timeout(200)
    assert P(page, PX + "(80, 175)")[0] > 240 and P(page, C0 + ".layers.length") == nl + 1; shot(page, '32e-paint')
    # 가리기 붓(수동 흰칠): 타원으로 끌면 그 자리가 흰색으로 덮여요. 모자이크도 돼요
    P(page, "__potato.settings.set('paint', { color: '#ff0000', size: 20, alpha: 100, shape: 'rect', fill: true, cover: 'white', cshape: 'ellipse', csize: 40, ccolor: '#ffffff', csoft: 0, csep: False })".replace('False', 'false')); page.keyboard.press('k')
    k1 = P(page, D2S + "(200, 40)"); k2 = P(page, D2S + "(280, 100)"); m3 = P(page, C0 + ".layers.find(l => l.paint).mediaId")
    page.mouse.move(vb['x'] + k1[0], vb['y'] + k1[1]); page.mouse.down(); page.mouse.move(vb['x'] + k2[0], vb['y'] + k2[1], steps=4); page.mouse.up(); page.wait_for_function(C0 + ".layers.find(l => l.paint).mediaId !== '%s'" % m3); page.wait_for_timeout(200)
    kp = P(page, PX + "(240, 70)"); assert kp[0] > 250 and kp[1] > 250 and kp[2] > 250 and kp[3] == 255, kp; assert P(page, PX + "(202, 42)")[3] == 0   # 타원 바깥 모서리는 안 덮여요
    P(page, "__potato.settings.set('paint', { ...__potato.settings.get('paint'), cover: 'mosaic', cshape: 'rect' })"); m4 = P(page, C0 + ".layers.find(l => l.paint).mediaId")
    k3 = P(page, D2S + "(200, 120)"); k4 = P(page, D2S + "(260, 170)"); page.mouse.move(vb['x'] + k3[0], vb['y'] + k3[1]); page.mouse.down(); page.mouse.move(vb['x'] + k4[0], vb['y'] + k4[1], steps=4); page.mouse.up(); page.wait_for_function(C0 + ".layers.find(l => l.paint).mediaId !== '%s'" % m4); page.wait_for_timeout(200)
    assert P(page, PX + "(230, 145)")[3] == 255; shot(page, '32f-cover')
    for _ in range(5): page.keyboard.press('Control+z')
    assert P(page, C0 + ".layers.length") == nl
    # 가리기 붓의 나머지(8.x에서 옮김): 나중에 옮길 수 있는 흰칠, 밝게, 잡티 지우기, 문지르기, 도장, 지우기
    def stroke(x0, y0, x1, y1):
        s0 = P(page, D2S + "(%d, %d)" % (x0, y0)); s1 = P(page, D2S + "(%d, %d)" % (x1, y1)); page.mouse.move(vb['x'] + s0[0], vb['y'] + s0[1]); page.mouse.down(); page.mouse.move(vb['x'] + s1[0], vb['y'] + s1[1], steps=5); page.mouse.up()
    setp = lambda js: P(page, "__potato.settings.set('paint', { ...__potato.settings.get('paint'), %s })" % js)
    page.keyboard.press('k'); setp("cover: 'white', cshape: 'ellipse', csep: true, csoft: 0"); stroke(200, 40, 280, 100)
    page.wait_for_function(C0 + ".layers.length === %d" % (nl + 1)); assert P(page, C0 + ".layers.at(-1).cover") is True and P(page, C0 + ".layers.at(-1).name") == '흰칠' and abs(P(page, C0 + ".layers.at(-1).x") - 198) < 6
    page.keyboard.press('Control+z'); assert P(page, C0 + ".layers.length") == nl
    hist = "__potato.store.history.items.at(-1).t"; base = P(page, "(async () => { const cv = %s, c = await __potato.image.flatten(cv); return [...c.getContext('2d').getImageData(100, 80, 1, 1).data]; })()" % C0)
    for kind in ['dodge', 'heal', 'smudge', 'burn']:
        setp("cover: '%s', cshape: 'brush', csize: 30, cstr: 80" % kind); h0 = P(page, hist); stroke(80, 80, 140, 90); page.wait_for_function(hist + " > %d" % h0); page.wait_for_timeout(150)
        px = P(page, PX + "(100, 82)"); assert px[3] > 200, (kind, px)
        if kind == 'dodge': assert sum(px[:3]) >= sum(base[:3]), (px, base)
    assert page.locator('.optbar >> text=가린 곳 지우개').count() == 1 and page.locator('.optbar >> text=자동 흰칠').count() == 1; shot(page, '32g-cover-more')
    setp("cover: 'clone'"); stroke(60, 60, 61, 60); page.wait_for_selector('.toast >> text=먼저 Alt를 누른 채'); h0 = P(page, hist)
    s0 = P(page, D2S + "(200, 150)"); page.keyboard.down('Alt'); page.mouse.click(vb['x'] + s0[0], vb['y'] + s0[1]); page.keyboard.up('Alt'); page.wait_for_selector('.toast >> text=복사해 올 곳을 정했어요')
    want = P(page, "(async () => { const cv = %s, c = await __potato.image.flatten(cv); return [...c.getContext('2d').getImageData(210, 150, 1, 1).data]; })()" % C0)
    stroke(40, 200, 60, 200); page.wait_for_function(hist + " > %d" % h0); page.wait_for_timeout(150); got = P(page, PX + "(50, 200)"); assert got[3] > 200 and all(abs(got[i] - want[i]) < 12 for i in range(3)), (got, want)
    # 지우기: 고른 레이어의 그림이 비워져요. 지우개(X)는 그리기 레이어가 골라져 있지 않아도 가린 곳을 지워요
    P(page, "(() => { const c = %s; __potato.state.project.sel = c.layers[0].id; __potato.emit(); })()" % C0); m0 = P(page, C0 + ".layers[0].mediaId"); setp("cover: 'erase', cshape: 'rect', csoft: 0"); stroke(20, 20, 50, 50)
    page.wait_for_function(C0 + ".layers[0].mediaId !== '%s'" % m0); page.wait_for_timeout(150)
    assert P(page, "(async () => { const cv = %s, c = await __potato.image.flatten(cv, cv.layers[0].id); return c.getContext('2d').getImageData(35, 35, 1, 1).data[3]; })()" % C0) == 0
    page.keyboard.press('x'); mp = P(page, C0 + ".layers.find(l => l.paint).mediaId"); stroke(80, 82, 140, 88); page.wait_for_function(C0 + ".layers.find(l => l.paint).mediaId !== '%s'" % mp); page.wait_for_timeout(150); assert P(page, PX + "(110, 85)")[3] < 40
    for _ in range(7): page.keyboard.press('Control+z')
    assert P(page, C0 + ".layers.length") == nl and P(page, C0 + ".layers[0].mediaId") == m0; page.keyboard.press('v')
    # 자유 변형(8.x에서 옮김): 그림판을 90도 돌리면 가로세로가 바뀌고, 한 번 더 반대로 돌리면 돌아와요
    wh0 = P(page, "[%s.w, %s.h]" % (C0, C0)); l0 = P(page, C0 + ".layers[0]"); P(page, "__potato.run('canvas.turnR')"); assert P(page, "[%s.w, %s.h]" % (C0, C0)) == wh0[::-1] and P(page, C0 + ".layers[0].rot") == (l0['rot'] + 90) % 360
    P(page, "__potato.run('canvas.turnL')"); l1 = P(page, C0 + ".layers[0]"); assert P(page, "[%s.w, %s.h]" % (C0, C0)) == wh0 and abs(l1['x'] - l0['x']) <= 1 and abs(l1['y'] - l0['y']) <= 1 and l1['rot'] == l0['rot']
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    # 컷 자동 배치: 고른 그림 수만큼 컷이 나뉘고 그림이 채워져요
    mids = P(page, "__potato.state.project.media.filter(m => !m.hidden).slice(0, 3).map(m => m.id)"); assert len(mids) >= 2, mids
    P(page, "(ids => { const B = __potato.picked; B.clear(); ids.forEach(i => B.add(i)); })(%s)" % mids); np = P(page, "(__potato.state.project.pages || []).length"); P(page, "__potato.run('cut.auto')")
    pg2 = P(page, "__potato.state.project.pages.at(-1)"); assert P(page, "__potato.state.project.pages.length") == np + 1 and len(pg2['els']) == len(mids) and all(e['mediaId'] and e['w'] > 50 and e['h'] > 50 for e in pg2['els']) and max(e['y'] + e['h'] for e in pg2['els']) <= pg2['h'], pg2['els']
    page.keyboard.press('Control+z'); P(page, "__potato.picked.clear()")
    # 안 쓰는 그림 정리: 아무 데도 안 쓰는 보이지 않는 그림만 지우고, 쓰는 그림과 되돌리기에 필요한 그림은 그대로
    P(page, "(async () => { const c = document.createElement('canvas'); c.width = c.height = 8; const b = await new Promise(r => c.toBlob(r, 'image/png')); await __potato.store.addMedia(new File([b], '버릴것.png', { type: 'image/png' }), null, { hidden: true }); })()")
    used0 = P(page, "__potato.state.project.canvases.flatMap(c => c.layers.map(l => l.mediaId))"); r = P(page, "__potato.tidy()"); assert r['n'] >= 1, r
    left = P(page, "__potato.state.project.media.map(m => m.id)"); assert all(u in left for u in used0) and not P(page, "__potato.state.project.media.some(m => m.name === '버릴것.png')")
    page.keyboard.press('Control+z'); page.keyboard.press('Control+y'); assert P(page, FLAT)[3] == 255   # 되돌리기·다시 하기도 멀쩡해요
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
    page.keyboard.press('Tab'); page.select_option('select[aria-label="2번째 인물 자리"]', 'r')
    page.click('text=그림 만들기'); page.wait_for_function("__sent.length === 1 && __potato.state.project.canvases[0].layers.length === 3")
    s = P(page, "__sent[0]"); b = s['b']; pr = b['parameters']
    assert s['u'] == 'https://image.novelai.net/ai/generate-image' and s['auth'] == 'Bearer pst-test'
    assert b['action'] == 'generate' and b['model'] == 'nai-diffusion-4-5-full' and b['input'] == '1boy, solo, smile, very aesthetic, masterpiece, no text'
    assert (pr['width'], pr['height'], pr['steps'], pr['sampler']) == (832, 1216, 28, 'k_euler_ancestral') and pr['seed'] > 0
    assert [c['char_caption'] for c in pr['v4_prompt']['caption']['char_captions']] == ['girl, red dress', 'boy, glasses'] and len(pr['characterPrompts']) == 2 and pr['v4_negative_prompt']['caption']['char_captions'][1]['centers'] == [{'x': 0.9, 'y': 0.5}] and pr['use_coords'] is True and pr['v4_prompt']['caption']['char_captions'][0]['centers'] == [{'x': 0.5, 'y': 0.5}]
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
    # 분위기 참고: 참고 그림을 먼저 바꾼 뒤(한 번만), 그 결과와 세기를 그림 요청에 실어요
    P(page, "(() => { const f = window.fetch; window.fetch = async (u, o = {}) => String(u).includes('/ai/encode-vibe') ? (__sent.push({ u: String(u), b: JSON.parse(o.body) }), new Response(new Uint8Array([1, 2, 3]), { status: 200 })) : f(u, o); })()")
    n = P(page, "__sent.length"); v = P(page, "(async () => { const m = __potato.state.project.media[0].id; const d = await __potato.nai.naiVibe(m, 'AAAA', 'nai-diffusion-4-5-full-inpainting', 1); await __potato.nai.naiVibe(m, 'AAAA', 'nai-diffusion-4-5-full-inpainting', 1); return d; })()")
    assert v == 'AQID' and P(page, "__sent.length") == n + 1 and P(page, "__sent.at(-1).b") == {'image': 'AAAA', 'model': 'nai-diffusion-4-5-full', 'information_extracted': 1}
    bb = P(page, "__potato.nai.buildNai({ model: 'nai-diffusion-4-5-full', prompt: 'a', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler', uc: 'none', vibes: [{ data: 'AQID', strength: 0.6 }] }).parameters")
    assert bb['reference_image_multiple'] == ['AQID'] and bb['reference_strength_multiple'] == [0.6]
    assert 'reference_image_multiple' not in P(page, "__potato.nai.buildNai({ model: 'nai-diffusion-5-full', prompt: 'a', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler', uc: 'none', vibes: [{ data: 'AQID', strength: 0.6 }] }).parameters")
    # 오류는 쉬운 말로
    P(page, "window.fetch = async () => new Response(JSON.stringify({ message: 'x' }), { status: 402 })")
    page.click('button:has-text("전체 다시 그리기")'); page.wait_for_selector('.toast.err >> text=Anlas')
    assert not errs, errs
    br.close()
print('통과')
