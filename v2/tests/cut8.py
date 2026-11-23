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
    page.click('.vid-side >> text=세로로 자동 배치…'); page.wait_for_selector('.dlg >> text=세로로 자동 배치'); shot(page, '92-stack'); page.click('.dlg-foot >> text=배치하기')
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
    # 손잡이: 변을 끌면 한쪽만, 돌리기 손잡이로 돌리고, 돌린 요소도 눌러서 골라져요
    page.keyboard.press('Escape'); P(page, "__potato.cut.pick(%s[0].id)" % ELS); page.wait_for_timeout(100); e = P(page, ELS + "[0]")
    page.mouse.move(SX(e['x'] + e['w']), SY(e['y'] + e['h'] / 2)); page.mouse.down(); page.mouse.move(SX(e['x'] + e['w'] - 100), SY(e['y'] + e['h'] / 2), steps=3); page.mouse.up()
    e2 = P(page, ELS + "[0]"); assert abs(e2['w'] - (e['w'] - 100)) < 4 and e2['h'] == e['h'] and e2['x'] == e['x'], (e, e2)
    kz = P(page, "__potato.cut.view().zoom"); page.mouse.move(SX(e2['x'] + e2['w'] / 2), SY(e2['y']) - 24); page.mouse.down(); page.mouse.move(SX(e2['x'] + e2['w'] / 2 + 200), SY(e2['y'] + e2['h'] / 2), steps=4); page.mouse.up()
    assert P(page, ELS + "[0].rot") == 90, P(page, ELS + "[0].rot")
    P(page, "__potato.run('cut.front')"); page.keyboard.press('Escape'); page.mouse.click(SX(e2['x'] + e2['w'] / 2), SY(e2['y'] + e2['h'] / 2 + e2['w'] / 2 - 6)); assert P(page, "__potato.cut.sel()") == e2['id']   # 돌려서 세로로 길어진 자리
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z'); page.keyboard.press('Control+z')
    # 컷 안 그림: 전체 보이기, 좌우 뒤집기, 두 번 눌러 그림 옮기기
    P(page, "__potato.cut.pick(%s[0].id)" % ELS); page.click('.vid-side >> text=전체 보이기'); assert P(page, ELS + "[0].is") <= 1
    page.check('.vid-side label:has-text("좌우 뒤집기") input'); assert P(page, ELS + "[0].ifx") is True
    e = P(page, ELS + "[0]"); page.mouse.dblclick(SX(e['x'] + 20), SY(e['y'] + 20)); page.wait_for_selector('.vid-side >> text=그림 옮기기 끝내기')
    page.mouse.move(SX(e['x'] + 60), SY(e['y'] + 60)); page.mouse.down(); page.mouse.move(SX(e['x'] + 110), SY(e['y'] + 60), steps=3); page.mouse.up()
    assert abs(P(page, ELS + "[0].ix") - 50) < 4 and P(page, ELS + "[0].x") == e['x']; page.keyboard.press('Escape')
    # 글자는 모서리를 끌면 글자 크기가 바뀌어요. 스티커는 색을 입히고 테두리를 둘러요
    page.click('.cut-bar >> text=글자'); page.wait_for_selector('textarea.cut-edit'); page.keyboard.press('Escape'); page.wait_for_timeout(150); t = P(page, ELS + ".at(-1)")
    page.mouse.move(SX(t['x'] + t['w']), SY(t['y'] + t['h'])); page.mouse.down(); page.mouse.move(SX(t['x'] + t['w'] * 1.5 + 0), SY(t['y'] + t['h'] * 1.5), steps=3); page.mouse.up()
    assert P(page, ELS + ".at(-1).size") > t['size'] * 1.5, (t, P(page, ELS + ".at(-1)"))
    P(page, "(() => { __potato.picked.clear(); __potato.picked.add(__potato.state.project.media[0].id); __potato.emit(); })()"); P(page, "__potato.run('cut.addPic')")
    page.check('.vid-side input[aria-label="색 입히기"]'); page.fill('.vid-side input[aria-label="테두리"]', '4'); page.keyboard.press('Tab'); pc = P(page, ELS + ".at(-1)"); assert pc['type'] == 'pic' and pc['tint'] and pc['ol'] == 4
    page.wait_for_timeout(200); shot(page, '95-handles')
    # 컷 분위기: 견본을 고르면 값이 들어가고 그림이 달라져요. 효과 복사·붙여넣기, 없애기
    page.keyboard.press('Escape'); pp = P(page, ELS + ".filter(e => e.type === 'panel')"); P(page, "__potato.cut.pick('%s')" % pp[0]['id']); page.wait_for_timeout(100)
    hsh = "(() => { const c = document.querySelector('canvas.viewport'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 16) s = (s * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0; return s; })()"
    h0 = P(page, hsh); page.select_option('.vid-side select[aria-label="분위기"]', label='흑백 톤'); page.wait_for_timeout(150); m1 = P(page, ELS + ".find(e => e.id === '%s')" % pp[0]['id'])
    assert m1['gray'] is True and m1['toneOn'] is True and P(page, hsh) != h0, m1
    page.click('.vid-side >> text=효과 복사'); P(page, "__potato.cut.pick('%s')" % pp[1]['id']); page.click('.vid-side summary >> text=보정·톤·효과선'); page.click('.vid-side >> text=효과 붙여넣기'); assert P(page, ELS + ".find(e => e.id === '%s').toneOn" % pp[1]['id']) is True
    page.click('.vid-side >> text=효과 없애기'); assert 'toneOn' not in P(page, ELS + ".find(e => e.id === '%s')" % pp[1]['id'])
    page.keyboard.press('Escape'); [page.keyboard.press('Control+z') for _ in range(3)]; page.wait_for_timeout(150); assert 'gray' not in P(page, ELS + ".find(e => e.id === '%s')" % pp[0]['id']) and not errs, errs
    # 가리기 도구: 끌면 모자이크 요소가 생기고, 그 밑의 그림이 실제로 뭉개져요. 요소 목록에서 숨기고 잠가요
    page.keyboard.press('Escape'); n3 = P(page, ELS + ".length"); bigp = P(page, ELS + ".filter(e => e.type === 'panel').sort((a, b) => b.h - a.h)[0]")
    px = "(() => { const c = document.querySelector('canvas.viewport'), r = c.getBoundingClientRect(), k = c.width / r.width, d = c.getContext('2d').getImageData(Math.round((%f - r.left) * k), Math.round((%f - r.top) * k), 1, 1).data; return [d[0], d[1], d[2]]; })()"
    ex, ey = SX(bigp['x']), SY(bigp['y'] + bigp['h'] * 0.8); before = P(page, px % (ex + 4, ey))   # 컷 테두리 바로 안쪽: 테두리의 검정과 그림 색이 섞여야 해요
    page.keyboard.press('x'); page.mouse.move(ex - 20, ey - 30); page.mouse.down(); page.mouse.move(ex + 60, ey + 30, steps=3); page.mouse.up(); page.wait_for_timeout(150)
    cvr = P(page, ELS + ".at(-1)"); assert P(page, ELS + ".length") == n3 + 1 and cvr['type'] == 'cover' and cvr['kind'] == 'mosaic', cvr
    page.keyboard.press('v'); page.keyboard.press('Escape'); page.wait_for_timeout(150); after = P(page, px % (ex + 4, ey)); assert after != before, (before, after)
    page.wait_for_selector('.el-row'); assert page.locator('.el-row').count() == n3 + 1; shot(page, '99-cover')
    page.click('.el-row >> nth=0 >> button[title="숨기기"]'); assert P(page, ELS + ".at(-1).hide") is True; page.wait_for_timeout(100); assert P(page, px % (ex + 4, ey)) == before
    page.click('.el-row >> nth=0 >> button[title="보이기"]'); page.click('.el-row >> nth=0 >> button[title^="잠그기"]'); assert P(page, ELS + ".at(-1).lock") is True
    page.mouse.click(ex + 20, ey); assert P(page, "__potato.cut.sel()") != cvr['id']   # 잠근 것은 눌러도 안 골라져요
    page.keyboard.press('Escape'); [page.keyboard.press('Control+z') for _ in range(5)]; assert P(page, ELS + ".length") == n3
    # 글자 꾸밈: 효과음 견본으로 넣고, 글자 모양 견본을 입히고, 값을 바꿔요 (되돌리면 그대로)
    page.keyboard.press('Escape'); n2 = P(page, ELS + ".length"); page.click('.cut-bar >> text=효과음'); page.click('.menu-item >> text=두근 설렘'); sx = P(page, ELS + ".at(-1)")
    assert P(page, ELS + ".length") == n2 + 1 and sx['text'] == '두근' and sx['sw2'] > 0 and sx['jit'] == 22 and sx['w'] > 100, sx
    assert page.locator('.txt-grid .bub-pre').count() == 16; page.click('.txt-grid .bub-pre[aria-label="네온 글자 모양"]'); nx = P(page, ELS + ".at(-1)"); assert nx['glow'] == 45 and nx['jit'] == 0 and nx['text'] == '두근'
    page.click('.vid-side summary >> text=효과음 모양'); page.fill('.vid-side input[aria-label="휘기"]', '40'); page.keyboard.press('Tab'); assert P(page, ELS + ".at(-1).arc") == 40
    page.wait_for_timeout(200); shot(page, '98-lettering'); assert not errs, errs
    page.keyboard.press('Control+z'); page.keyboard.press('Control+z'); page.keyboard.press('Control+z'); assert P(page, ELS + ".length") == n2
    # 선으로 자르기: 비스듬히 그으면 컷이 두 조각이 되고, 사이가 벌어지고, 그림은 제자리에 이어져요
    page.keyboard.press('Escape'); big = P(page, ELS + ".filter(e => e.type === 'panel').sort((a, b) => b.h - a.h)[0]"); np0 = P(page, ELS + ".filter(e => e.type === 'panel').length")
    page.keyboard.press('k'); page.mouse.move(SX(big['x'] - 30), SY(big['y'] + big['h'] * 0.3)); page.mouse.down(); page.mouse.move(SX(big['x'] + big['w'] + 30), SY(big['y'] + big['h'] * 0.6), steps=4); page.mouse.up()
    ps = P(page, ELS + ".filter(e => e.type === 'panel')"); assert len(ps) == np0 + 1, len(ps); two = [e for e in ps if e.get('poly')]; assert len(two) == 2 and all(len(e['poly']) == 4 and e['mediaId'] == big['mediaId'] for e in two), two
    top, bot = sorted(two, key=lambda e: e['y']); assert top['y'] == big['y'] and abs(bot['y'] + bot['h'] - big['y'] - big['h']) < 1 and top['h'] + bot['h'] > big['h']   # 비스듬해서 두 상자가 겹쳐요
    page.wait_for_timeout(200); shot(page, '97-slice'); page.keyboard.press('v'); page.keyboard.press('Control+z'); assert P(page, ELS + ".filter(e => e.type === 'panel').length") == np0
    # 효과음 패널: 내장 효과음을 찾아 누르면 스티커로 놓여요 (흰펜 모양이 없는 글자는 색 입히기로 대신)
    page.keyboard.press('Escape'); page.click('.zone-tab >> text=효과음'); page.wait_for_selector('.sfx-item'); assert page.locator('.sfx-item').count() >= 60
    page.fill('.sfx-head input[type=search]', '쾅'); page.wait_for_timeout(150); assert 1 <= page.locator('.sfx-item').count() < 20
    n1 = P(page, ELS + ".length"); page.click('.sfx-item >> nth=0'); page.wait_for_function(ELS + ".length === %d" % (n1 + 1)); sf = P(page, ELS + ".at(-1)")
    assert sf['type'] == 'pic' and 200 < sf['w'] < 420 and P(page, "__potato.state.project.media.find(m => m.id === '%s').sfx" % sf['mediaId']), sf
    page.wait_for_timeout(300); shot(page, '96-sfx'); page.click('.zone-tab >> text=보관함')
    # 내보내기 창: JPG, 세로로 잘라 여러 장
    page.keyboard.press('Escape'); P(page, "window.showDirectoryPicker = undefined"); page.click('.cut-bar >> text=내보내기'); page.wait_for_selector('.dlg >> text=세로로 자르기')
    page.select_option('.dlg select[aria-label="파일"]', 'jpeg'); page.fill('.dlg input[aria-label="세로로 자르기"]', '300'); page.keyboard.press('Tab'); shot(page, '94-export')
    with page.expect_download() as dl: page.click('.dlg-foot >> text=내보내기')
    z = zipfile.ZipFile(dl.value.path()); names = z.namelist(); assert len(names) >= 2 and all(n.endswith('.jpg') for n in names) and z.read(names[0])[:2] == b'\xff\xd8', names
    assert not errs, errs
    br.close()
print('통과')
