# 말풍선 시험: 종류 견본 → 손그림 윤곽 → 꼬리 → 이어 붙이기 → 글자에 맞추기 → 그 자리에서 고치기
import os, sys
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))
ELS = "__potato.state.project.pages[0].els"
with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=만 19세 이상입니다'); page.keyboard.press('Alt+2'); page.click('.empty-room >> text=한 컷'); page.wait_for_timeout(200)
    box = page.locator('.viewport').bounding_box(); zoom = min((box['width'] - 48) / 800, (box['height'] - 48) / 1280)
    X = lambda x: box['x'] + (box['width'] - 800 * zoom) / 2 + x * zoom; Y = lambda y: box['y'] + (box['height'] - 1280 * zoom) / 2 + y * zoom
    # 견본 16가지가 보이고, 고른 종류로 새 말풍선이 놓여요 (그냥 눌러도 알맞은 크기로)
    assert page.locator('.bub-pre').count() == 16
    page.click('.bub-pre[aria-label="각진 대사 말풍선"]'); page.keyboard.press('b'); page.mouse.click(X(250), Y(250))
    b = P(page, ELS + "[1]"); assert b['type'] == 'bubble' and b['shape'] == 'poly' and b['line'] == 'pen' and b['w'] == 240 and b['seed'] and b['tail'], b
    # 견본을 누르면 고른 말풍선의 생김새만 바뀌고 대사는 그대로예요
    page.fill('.vid-side textarea[aria-label="대사"]', '좋은\n말로 할 때.'); page.keyboard.press('Tab')
    page.click('.bub-pre[aria-label="분홍 겹줄 말풍선"]'); b = P(page, ELS + "[1]"); assert b['dbl'] and b['bc'] == '#e0458f' and b['tailKind'] == 'dots' and b['text'].startswith('좋은'), b
    page.keyboard.press('Control+z'); assert P(page, ELS + "[1].shape") == 'poly'
    # 모든 모양·선·꼬리가 오류 없이 그려지고, 테두리가 자로 잰 타원이 아니에요 (씨앗마다 윤곽이 달라요)
    P(page, """(() => { const pg = __potato.state.project.pages[0], src = pg.els[1]; let i = 0;
        for (const shape of ['ellipse', 'poly', 'rect', 'cloud', 'wavy', 'shout', 'burst', 'blob', 'box']) for (const line of ['pen', 'brush', 'sketch', 'dash', 'clean']) {
          pg.els.push({ ...src, id: 'g' + i, shape, line, x: 30 + (i % 5) * 150, y: 420 + Math.floor(i / 5) * 92, w: 130, h: 70, size: 16, text: '가나', tailKind: ['point', 'line', 'dots'][i % 3], tx: 50 + (i % 5) * 150, ty: 506 + Math.floor(i / 5) * 92, seed: i + 1 }); i++; }
        __potato.emit(); })()""")
    page.wait_for_timeout(300); shot(page, '88-bubble-kinds'); assert not errs, errs
    hashOf = "(() => { const c = document.querySelector('canvas.viewport'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i]) >>> 0; return s; })()"
    h0 = P(page, hashOf); P(page, "__potato.cut.pick(%s[1].id)" % ELS); P(page, "__potato.run('cut.reseed')"); page.wait_for_timeout(100); assert P(page, hashOf) != h0
    P(page, "(() => { const pg = __potato.state.project.pages[0]; pg.els = pg.els.filter(e => !/^g\\d+$/.test(e.id)); __potato.emit(); })()")
    # 이어 붙이기: 둘을 함께 골라 붙이면 생김새를 같이 쓰고, 떼면 따로예요
    page.keyboard.press('b'); page.mouse.move(X(180), Y(330)); page.mouse.down(); page.mouse.move(X(520), Y(520), steps=3); page.mouse.up()
    ids = P(page, ELS + ".slice(1).map(e => e.id)"); assert len(ids) == 2
    P(page, "(() => { __potato.cut.pick('%s'); })()" % ids[0]); a = P(page, ELS + "[1]"); c = P(page, ELS + "[2]")
    page.keyboard.press('v'); page.mouse.click(X(a['x'] + a['w'] / 2), Y(a['y'] + 30)); page.keyboard.down('Shift'); page.mouse.click(X(c['x'] + c['w'] / 2), Y(c['y'] + c['h'] - 20)); page.keyboard.up('Shift')
    assert P(page, "__potato.run('cut.join')"); j = P(page, ELS + ".slice(1).map(e => e.join)"); assert j[0] and j[0] == j[1]
    page.fill('.vid-side input[aria-label="굵기"]', '6'); page.keyboard.press('Tab'); assert P(page, ELS + ".slice(1).map(e => e.bw)") == [6, 6]
    shot(page, '89-bubble-join')
    page.keyboard.press('Control+c'); page.keyboard.press('Control+v'); j2 = P(page, ELS + ".slice(3).map(e => e.join)"); assert len(j2) == 2 and j2[0] == j2[1] and j2[0] != j[0]; page.keyboard.press('Control+z')
    P(page, "__potato.cut.pick('%s')" % ids[0]); assert P(page, "__potato.run('cut.unjoin')") and P(page, ELS + ".slice(1).every(e => !e.join)")
    # 글자에 맞추기, 화살표로 옮기기
    P(page, "(() => { const e = %s[2]; e.text = '어..어쩌지... 이렇게 긴 대사도 말풍선 안에 넉넉히 들어가야 해요'; __potato.cut.pick(e.id); })()" % ELS)
    w0 = P(page, ELS + "[2].w"); P(page, "__potato.run('cut.fitText')"); f = P(page, ELS + "[2]"); assert f['w'] != w0 and f['h'] > 100, f
    page.locator('canvas.viewport').focus(); x0 = f['x']; page.keyboard.press('Shift+ArrowRight'); page.keyboard.press('ArrowRight'); assert P(page, ELS + "[2].x") == x0 + 11 and P(page, ELS + "[2].tx") == f['tx'] + 11
    # 그 자리에서 고치기: 두 번 누르면 글 상자가 뜨고, Esc로 끝내면 한 번에 되돌릴 수 있어요
    f = P(page, ELS + "[2]"); page.mouse.dblclick(X(f['x'] + f['w'] / 2), Y(f['y'] + f['h'] / 2)); page.wait_for_selector('textarea.cut-edit'); shot(page, '90-bubble-edit')
    page.keyboard.type('바로 고쳤어요'); assert P(page, ELS + "[2].text") == '바로 고쳤어요'; page.keyboard.press('Escape'); assert page.locator('textarea.cut-edit').count() == 0
    page.keyboard.press('Control+z'); assert P(page, ELS + "[2].text").startswith('어..어쩌지')
    # 돌린 말풍선도 꼬리 끝은 손잡이 자리 그대로예요 (꼬리 안을 눌러도 골라져요)
    P(page, "(() => { const e = %s[2]; e.rot = 25; e.tailKind = 'point'; e.tailBend = 0; e.tx = e.x - 60; e.ty = e.y + e.h + 90; __potato.cut.pick(null); })()" % ELS); f = P(page, ELS + "[2]")
    cx, cy = f['x'] + f['w'] / 2, f['y'] + f['h'] / 2; page.mouse.click(X(f['tx'] + (cx - f['tx']) * 0.4), Y(f['ty'] + (cy - f['ty']) * 0.4)); assert P(page, "__potato.cut.sel()") == f['id']
    shot(page, '91-bubble-panel')
    assert not errs, errs
    br.close()
print('통과')
