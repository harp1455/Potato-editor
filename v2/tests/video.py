# 영상 작업실 시험: 보관함 그림 → 장면 → 길이 바꾸기·순서·재생 → WebP·MP4 내보내기
import os, struct, sys, tempfile, zlib
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
tmp = tempfile.mkdtemp(); files = []
for i, col in enumerate([(200, 90, 80), (80, 160, 110), (70, 110, 200)]):
    rows = b''.join(b'\x00' + bytes(col + (255,)) * 300 for _ in range(200))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    p = os.path.join(tmp, '장면%d.png' % (i + 1)); open(p, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 300, 200, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')); files.append(p)
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}, accept_downloads=True).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=나중에 하기')
    with page.expect_file_chooser() as fc: page.click('[aria-label="그림 넣기"]')
    fc.value.set_files(files); page.wait_for_function("__potato.state.project.media.length === 3")
    page.keyboard.press('Alt+3'); page.wait_for_selector('.vid-room'); shot(page, '70-video-empty')
    page.click('.media >> nth=0'); page.click('.media >> nth=2', modifiers=['Shift'])
    page.click('.vid-bar >> text=고른 그림 넣기')
    seq = P(page, "__potato.state.project.sequences[0]")
    assert len(seq['scenes']) == 3 and (seq['w'], seq['h']) == (300, 200) and all(s['dur'] == 2 for s in seq['scenes']), seq
    # 보관함 그림을 줄로 끌어 넣기
    page.click('.media >> nth=1'); page.drag_and_drop('.media >> nth=1', '.vid-strip'); assert len(P(page, "__potato.state.project.sequences[0].scenes")) == 4
    # 장면 길이 바꾸기, 뒤로 옮기기, 지우기, 되돌리기
    page.click('.vid-scene >> nth=0'); page.fill('.vid-side input[aria-label="길이"]', '0.5'); page.keyboard.press('Tab')
    assert P(page, "__potato.state.project.sequences[0].scenes[0].dur") == 0.5
    first = P(page, "__potato.state.project.sequences[0].scenes[0].id")
    page.click('.vid-scene >> nth=0'); page.click('.vid-side [aria-label="뒤로 옮기기"]')
    assert P(page, "__potato.state.project.sequences[0].scenes[1].id") == first
    page.click('.vid-scene >> nth=3'); page.keyboard.press('Delete'); assert len(P(page, "__potato.state.project.sequences[0].scenes")) == 3
    page.keyboard.press('Control+z'); assert len(P(page, "__potato.state.project.sequences[0].scenes")) == 4
    # 재생하면 시각이 흘러요
    page.click('.vid-bar >> text=재생'); page.wait_for_timeout(700); t = page.locator('.vid-clock').inner_text(); page.click('.vid-bar >> text=멈춤')
    assert not t.startswith('0:00.0'), t
    shot(page, '71-video')
    # 내보내기
    page.click('.vid-bar >> text=내보내기'); page.click('.choice-item >> text=움짤 (WebP)'); shot(page, '72-export')
    with page.expect_download() as dl: page.click('.dlg-foot >> text=내보내기')
    d = open(dl.value.path(), 'rb').read(); assert d[:4] == b'RIFF' and d[8:12] == b'WEBP' and b'ANMF' in d and dl.value.suggested_filename == '영상 1.webp'
    if P(page, "__potato.enc.canMp4()"):
        page.click('.vid-bar >> text=내보내기')
        with page.expect_download() as dl: page.click('.dlg-foot >> text=내보내기')
        d = open(dl.value.path(), 'rb').read(); assert d[4:8] == b'ftyp' and len(d) > 2000, len(d)
    # 겹쳐 바뀜: 둘째 장면 0.5초 → 바뀌는 중간 시각의 색이 두 장면 사이
    P(page, "(() => { const s = __potato.state.project.sequences[0]; s.scenes[1].fade = 0.5; __potato.emit(); })()")
    mid = P(page, "(() => { const s = __potato.state.project.sequences[0], c = document.createElement('canvas'); c.width = 30; c.height = 20; const g = c.getContext('2d'); __potato.video.renderSeq(g, s, s.scenes[0].dur + 0.25, 30, 20); return [...g.getImageData(15, 10, 1, 1).data]; })()")
    a0 = P(page, "(() => { const s = __potato.state.project.sequences[0], c = document.createElement('canvas'); c.width = 30; c.height = 20; const g = c.getContext('2d'); __potato.video.renderSeq(g, s, s.scenes[0].dur - 0.01, 30, 20); const a = [...g.getImageData(15, 10, 1, 1).data]; __potato.video.renderSeq(g, s, s.scenes[0].dur + 0.499, 30, 20); return [a, [...g.getImageData(15, 10, 1, 1).data]]; })()")
    assert all(min(a0[0][k], a0[1][k]) - 3 <= mid[k] <= max(a0[0][k], a0[1][k]) + 3 for k in range(3)) and mid[:3] != a0[0][:3] and mid[:3] != a0[1][:3], (mid, a0)
    # 자막 넣기
    page.click('.vid-side >> text=지금 시각에 자막 넣기'); page.fill('.vid-side textarea[aria-label="자막"]', '안녕'); page.keyboard.press('Tab')
    assert P(page, "__potato.state.project.sequences[0].caps[0].text") == '안녕'
    # 소리 넣고 MP4로 내보내면 소리 줄이 같이 들어가요
    import math
    wav = os.path.join(tmp, '소리.wav'); n = 24000; pcm = b''.join(struct.pack('<h', int(8000 * math.sin(i * 0.05))) for i in range(n))
    open(wav, 'wb').write(b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 24000, 48000, 2, 16) + b'data' + struct.pack('<I', len(pcm)) + pcm)
    with page.expect_file_chooser() as fc: page.click('.vid-side >> text=소리 파일 넣기')
    fc.value.set_files(wav); page.wait_for_function("(__potato.state.project.sequences[0].audios || []).length === 1")
    # 파형이 그려지고, 오른쪽 끝을 끌면 길이가 잘려요. 소리를 하나 더 넣으면 겹쳐져요
    page.wait_for_function("(() => { const c = document.querySelector('canvas.wave'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })()")
    wb = page.locator('canvas.wave').bounding_box(); page.mouse.move(wb['x'] + wb['width'] - 2, wb['y'] + 20); page.mouse.down(); page.mouse.move(wb['x'] + wb['width'] * 0.5, wb['y'] + 20, steps=3); page.mouse.up()
    du = P(page, "__potato.state.project.sequences[0].audios[0].dur"); assert 0.4 < du < 0.6, du
    with page.expect_file_chooser() as fc: page.click('.vid-side >> text=소리 파일 넣기')
    fc.value.set_files(wav); page.wait_for_function("__potato.state.project.sequences[0].audios.length === 2"); assert page.locator('.vid-chip.aud').count() == 2
    if P(page, "__potato.enc.canMp4() && typeof AudioEncoder !== 'undefined'"):
        page.click('.vid-bar >> text=내보내기')
        with page.expect_download() as dl: page.click('.dlg-foot >> text=내보내기')
        d = open(dl.value.path(), 'rb').read(); assert b'mp4a' in d or b'Opus' in d or b'opus' in d, '소리 줄이 없어요'
    # 움짤 파일을 장면으로 불러오기 (방금 만든 것과 같은 WebP 움짤)
    if P(page, "!!window.ImageDecoder"):
        anim = os.path.join(tmp, '움짤.webp'); open(anim, 'wb').write(P_webp) if False else None
        page.click('.vid-bar >> text=내보내기'); page.click('.choice-item >> text=움짤 (WebP)')
        with page.expect_download() as dl: page.click('.dlg-foot >> text=내보내기')
        dl.value.save_as(anim); n0 = len(P(page, "__potato.state.project.sequences[0].scenes"))
        with page.expect_file_chooser() as fc: page.click('.vid-bar >> text=영상 불러오기')
        fc.value.set_files(anim); page.wait_for_function("__potato.state.project.sequences[0].scenes.length > %d" % n0, timeout=120000)
    P(page, "(() => { const s = __potato.state.project.sequences[0]; s.scenes.length = 4; __potato.emit(); })()"); page.wait_for_timeout(900)

    # 다시 켜도 장면이 그대로
    page.wait_for_function("__potato.state.saved"); page.reload(); page.wait_for_function("window.__potato && __potato.state.project.sequences && __potato.state.project.sequences[0].scenes.length === 4")
    # 화면 움직임: 다가가기를 켜면 장면의 처음과 끝 그림이 달라져요
    R = "((t) => { const s = __potato.state.project.sequences[0], c = document.createElement('canvas'); c.width = 60; c.height = 90; const g = c.getContext('2d'); __potato.video.renderSeq(g, s, t, 60, 90); return [...g.getImageData(0, 0, 60, 90).data].reduce((a, v, i) => (a * 31 + v * (i % 7 + 1)) % 1000003, 7); })"
    P(page, "(() => { const s = __potato.state.project.sequences[0]; s.scenes.forEach(x => { x.fade = 0; }); s.caps = []; s.scenes[0].dur = 2; __potato.emit(); })()")
    P(page, R + "(0.05)"); page.wait_for_timeout(300)   # 그림을 불러올 틈
    same = P(page, R + "(0.05)") == P(page, R + "(1.9)")
    P(page, "(() => { const x = __potato.state.project.sequences[0].scenes[0]; x.move = 'in'; x.moveAmt = 40; __potato.emit(); })()")
    r0, r1 = P(page, R + "(0.05)"), P(page, R + "(1.9)"); assert same and r0 != r1, (same, r0, r1, P(page, "JSON.stringify(__potato.state.project.sequences[0].scenes.slice(0,2))"))
    # 얹는 그림: 고른 그림을 지금 시각에 얹으면 그 시간 동안만 장면 위에 보이고, 둘째 줄에 막대가 생겨요
    P(page, "(() => { const p = __potato.state.project, s = p.sequences[0]; delete s.scenes[0].move; s.overs = [{ id: 'o1', mediaId: s.scenes[1].mediaId, t0: 0.5, dur: 1, x: 50, y: 50, size: 50, opacity: 1 }]; __potato.emit(); })()")
    P(page, R + "(0.7)"); page.wait_for_timeout(300)
    assert P(page, R + "(0.1)") != P(page, R + "(0.7)") and P(page, R + "(0.1)") == P(page, R + "(1.8)")
    assert page.locator('.vid-chip.over').count() == 1 and page.locator('.vid-side >> text=얹는 그림').count() >= 1
    shot(page, '75-over')
    # 얹는 그림 움직이기: 끝 값을 주면 나오는 동안 모습이 바뀌어요
    assert P(page, R + "(0.6)") == P(page, R + "(1.4)")
    P(page, "(() => { __potato.state.project.sequences[0].overs[0].to = { x: 80, y: 50, size: 20, opacity: 1 }; __potato.emit(); })()"); assert P(page, R + "(0.6)") != P(page, R + "(1.4)")
    # 움직임 점 여러 개: 처음 → 가운데 점 → 끝 점으로 이어져요. 예전의 끝 값(to)도 그대로 읽어요
    v = P(page, "[0, 0.5, 1, 1.5, 2].map(t => +__potato.video.valAt(50, [{ t: 1, x: 90 }, { t: 2, x: 10 }], t, 'x').toFixed(1))"); assert v == [50, 70, 90, 50, 10], v
    assert P(page, "__potato.video.keysOf({ dur: 2, to: { x: 80 } })") == [{'t': 2, 'x': 80}]
    P(page, "(() => { const s = __potato.state.project.sequences[0], x = s.scenes[0]; s.overs = []; delete x.move; x.keys = [{ t: 1, zoom: 180, x: 0, y: 0 }, { t: 2, zoom: 100, x: 0, y: 0 }]; __potato.emit(); })()")
    a, b, c = P(page, R + "(0.02)"), P(page, R + "(1.0)"), P(page, R + "(1.98)"); assert a != b and b != c, (a, b, c)
    page.click('.vid-scene >> nth=0'); assert page.locator('.vid-side .key').count() == 2; shot(page, '76-keys')
    # 8.x에서 옮긴 것: 지금 시각에서 장면 나누기. 다른 작업실의 단축키는 여기서 안 먹어요(Delete가 레이어를 지우지 않음)
    P(page, "(() => { const s = __potato.state.project.sequences[0]; s.scenes[0].dur = 2; delete s.scenes[0].keys; __potato.emit(); })()")
    n = P(page, "__potato.state.project.sequences[0].scenes.length"); P(page, "__potato.video.seek(0.8)")
    lays = P(page, "__potato.state.project.canvases.reduce((a, c) => a + c.layers.length, 0)"); page.keyboard.press('Control+b')
    sc = P(page, "__potato.state.project.sequences[0].scenes.slice(0, 2).map(x => x.dur)"); assert P(page, "__potato.state.project.sequences[0].scenes.length") == n + 1 and abs(sc[0] - 0.8) < 0.01 and abs(sc[1] - 1.2) < 0.01, sc
    page.keyboard.press('Escape'); P(page, "(() => { __potato.state.project.sequences[0]; })()"); page.keyboard.press('v'); assert P(page, "__potato.state.project.canvases.reduce((a, c) => a + c.layers.length, 0)") == lays
    # 움짤 연출(8.x에서 옮김): 특수 넘김, 얹는 것의 움직임, 날리는 효과, 글자 얹기
    P(page, "(() => { const s = __potato.state.project.sequences[0]; s.overs = []; s.fx = []; s.caps = []; s.scenes.forEach(x => { delete x.keys; delete x.move; x.fade = 0; }); s.scenes[0].dur = 1; s.scenes[1].dur = 2; s.scenes[1].fade = 1; __potato.emit(); })()")
    F = P(page, "(() => { const L = __potato.video.fxLib(); return [L.AN_ALL.length, L.GL_TRANS.length, L.FX_KINDS.length]; })()"); assert F[0] == 97 and F[1] == 196 and F[2] >= 25, F
    ti = P(page, "(() => { const s = __potato.state.project.sequences[0]; s.scenes.forEach(x => { x.dur = 1; x.fade = 0; }); const i = s.scenes.findIndex((x, k) => k > 0 && x.mediaId !== s.scenes[k - 1].mediaId); s.scenes[i].fade = 1; __potato.emit(); return i; })()")
    P(page, R + "(%f)" % (ti + 0.5)); page.wait_for_timeout(300); plain = P(page, R + "(%f)" % (ti + 0.5))
    P(page, "(() => { __potato.state.project.sequences[0].scenes[%d].trans = 'gl:' + __potato.video.fxLib().GLT_TOP[0]; __potato.emit(); })()" % ti); tr = P(page, R + "(%f)" % (ti + 0.5)); assert plain != tr, '특수 넘김이 안 그려졌어요'
    P(page, "(() => { const x = __potato.state.project.sequences[0].scenes[%d]; delete x.trans; x.fade = 0; })()" % ti)
    P(page, "(() => { const s = __potato.state.project.sequences[0]; __potato.video.seek(0.2); })()"); P(page, "__potato.run('video.addText')")
    o = P(page, "__potato.state.project.sequences[0].overs[0]"); assert o['text'] and o['ain']['n'] == 'bounceIn'; assert P(page, R + "(0.25)") != P(page, R + "(0.75)")   # 나타나는 동안과 다 나타난 뒤가 달라요
    base = P(page, R + "(0.9)"); P(page, "(() => { const s = __potato.state.project.sequences[0]; s.fx = [__potato.video.fxLib().FX_DEF('snow', 0)]; __potato.emit(); })()"); assert P(page, R + "(0.9)") != base
    assert page.locator('.vid-chip.fx').count() == 1 and page.locator('select[aria-label="효과 넣기"]').count() == 1; shot(page, '77-fx')
    assert not errs, errs
    br.close()
print('통과')
