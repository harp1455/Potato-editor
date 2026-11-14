# 영상·움짤 저장 시험: 장면 12장 → MP4, GIF, WebP
import os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
JS = """(async fmt => {
  const frames = Array.from({ length: 12 }, (_, i) => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const g = c.getContext('2d'); g.fillStyle = '#246'; g.fillRect(0, 0, 160, 120); g.fillStyle = '#fc3'; g.fillRect(10 + i * 10, 40, 30, 30); return c; });
  let last = 0; const b = await __potato.enc.encodeFrames(frames, fmt, { fps: 12, loop: true, quality: 90 }, p => { last = p; });
  const u = new Uint8Array(await b.arrayBuffer()); return [b.type, u.length, String.fromCharCode(...u.slice(0, 12)), last];
})"""
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome'); page = br.new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=나중에 하기'); page.wait_for_function("window.__potato && __potato.enc")
    gif = page.evaluate(JS + "('gif')"); assert gif[0] == 'image/gif' and gif[2].startswith('GIF89a') and gif[1] > 500 and gif[3] == 1, gif
    webp = page.evaluate(JS + "('webp')"); assert webp[0] == 'image/webp' and webp[2][:4] == 'RIFF' and webp[2][8:12] == 'WEBP' and webp[1] > 500, webp
    if page.evaluate("__potato.enc.canMp4()"):
        mp4 = page.evaluate(JS + "('mp4')"); assert mp4[0] == 'video/mp4' and mp4[2][4:8] == 'ftyp' and mp4[1] > 800, mp4
        print('MP4', mp4[1], '바이트')
    else: print('이 브라우저는 MP4를 만들 수 없어 건너뛰었어요')
    assert not errs, errs
    br.close()
print('통과')
