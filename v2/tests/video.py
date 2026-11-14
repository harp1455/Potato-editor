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
    # 다시 켜도 장면이 그대로
    page.wait_for_function("__potato.state.saved"); page.reload(); page.wait_for_function("window.__potato && __potato.state.project.sequences && __potato.state.project.sequences[0].scenes.length === 4")
    assert not errs, errs
    br.close()
print('통과')
