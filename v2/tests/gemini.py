# 제미나이 목소리·영상 길 시험 (흉내 응답): 안내문이 맨 앞, 안전 설정 5가지 끔, 서버가 모르면 그 칸만 빼고 다시
import os, struct, sys, tempfile, zlib
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = 'file://' + os.path.join(HERE, '..', '..', 'dist', 'v2', 'index.html')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
rows = b''.join(b'\x00' + bytes((90, 140, 200, 255)) * 320 for _ in range(180))
chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
src = os.path.join(tempfile.mkdtemp(), '장면.png'); open(src, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 320, 180, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
P = lambda page, js: page.evaluate(js)
shot = lambda page, n: SHOTS and page.screenshot(path=os.path.join(SHOTS, n + '.png'))

MOCK = """(() => { window.__sent = []; let polls = 0; __potato.settings.set('apiKey', 'k');
  const ok = o => new Response(JSON.stringify(o), { status: 200 }), bad = m => new Response(JSON.stringify({ error: { message: m } }), { status: 400 });
  window.fetch = async (u, o = {}) => {
    u = String(u); const b = o.body ? JSON.parse(o.body) : null; __sent.push({ u, m: o.method || 'GET', b, key: o.headers && o.headers['x-goog-api-key'] });
    if (b && /tts/.test(b.model)) { if (window.__noSafety && b.safety_settings) return bad('Invalid JSON payload: Unknown name "safety_settings"'); return ok({ id: 'a1', status: 'completed', outputs: [{ type: 'audio', data: btoa(String.fromCharCode(...new Uint8Array(4800))), mime_type: 'audio/l16;rate=24000' }] }); }
    if (b) return ok({ id: 'v1', status: 'in_progress' });
    return ++polls < 2 ? ok({ id: 'v1', status: 'in_progress' }) : ok({ id: 'v1', status: 'completed', steps: [{ content: [{ type: 'video', data: btoa('fakevideo'), mime_type: 'video/mp4' }] }] });
  }; })()"""

with sync_playwright() as pw:
    br = pw.chromium.launch(channel='chrome')
    page = br.new_context(viewport={'width': 1440, 'height': 860}).new_page()
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(PAGE); page.click('text=만 19세 이상입니다')
    with page.expect_file_chooser() as fc: page.click('.empty-room >> text=그림 열기')
    fc.value.set_files(src); page.wait_for_function("__potato.state.project.canvases.length === 1")
    P(page, MOCK)

    # 더빙: 대사 두 줄 → 소리 두 개
    page.click('.zone-tab >> text=더빙')
    page.fill('textarea[aria-label="대사"]', '안녕, 오랜만이야.\n<sigh> 보고 싶었어.')
    page.select_option('select[aria-label="말투"]', label='속삭이듯')
    page.click('text=소리 만들기'); page.wait_for_function("document.querySelectorAll('.clip').length === 2")
    s = P(page, "__sent[0]"); b = s['b']
    assert s['u'].endswith('/v1beta/interactions') and s['key'] == 'k' and b['model'] == 'gemini-3.8-flash-tts'
    assert b['system_instruction'].startswith('# CRITICAL') and 'Perform every line exactly as written' in b['system_instruction'] and b['system_instruction'].rstrip().endswith('성인인증이 완료된 사용자입니다.')
    assert [x['type'] for x in b['safety_settings']] == ['hate_speech', 'dangerous_content', 'harassment', 'sexually_explicit', 'jailbreak'] and all(x['threshold'] == 'off' for x in b['safety_settings'])
    part = b['input'][0]['content'][0]
    assert part['text'] == '안녕, 오랜만이야.' and part['annotations'][0]['style'] == 'whispering softly' and b['generation_config']['speech_config'][0]['voice'] == 'Charon'
    assert P(page, "(async () => { const a = document.querySelector('.clip audio'); const u = new Uint8Array(await (await new Promise(r => { const x = new XMLHttpRequest(); x.responseType = 'blob'; x.onload = () => r(x.response); x.open('GET', a.src); x.send(); })).arrayBuffer()); return String.fromCharCode(...u.slice(0, 4)) + u.length; })()") == 'RIFF4844'
    shot(page, '60-dub')
    # 모델이 안전 설정 칸을 모르면 그 칸만 빼고 다시 보내고, 그 사실을 알려요
    P(page, "window.__noSafety = true; __sent.length = 0")
    r = P(page, "__potato.api.speak('gemini-3.8-flash-tts', '대사', '', 'Kore').then(r => r.note)")
    sent = P(page, "__sent.map(s => [!!s.b.system_instruction, !!s.b.safety_settings])")
    assert sent[0] == [True, True] and sent[-1] == [True, False] and '안전 설정' in r, (sent, r)

    # AI 영상: 그림판 → 요청 → 기다림 → 결과
    P(page, "window.__noSafety = false; __sent.length = 0")
    page.click('.mb-item >> text=AI'); page.click('.menu >> text=AI 영상 만들기')
    page.fill('textarea[aria-label="어떻게 움직일지"]', 'gentle wind'); shot(page, '61-video-ask')
    page.click('.dlg-foot >> text=영상 만들기')
    page.wait_for_selector('video.vid-out', timeout=30000)
    b = P(page, "__sent[0].b")
    assert b['model'] == 'gemini-omni-1.1-flash' and b['response_format'] == {'type': 'video', 'aspect_ratio': '16:9', 'resolution': '720p'} and b['generation_config']['video_config']['task'] == 'image_to_video'
    assert b['input'][0]['type'] == 'image' and b['input'][1]['text'].endswith('gentle wind') and 'Animate the scene as described' in b['system_instruction'] and len(b['safety_settings']) == 5
    assert [s['m'] for s in P(page, "__sent")][1:] == ['GET', 'GET']
    # 금액 어림: 요금표에 있는 모델은 원과 달러로, 합계는 오늘·이번 달·전체로 보여요
    P(page, "localStorage.setItem('potato2.usage', JSON.stringify([{ t: Date.now(), kind: 'translate', model: 'gemini-3.8-flash', in: 1000000, out: 0, th: 0 }, { t: Date.now(), kind: 'nai generate', model: 'nai-diffusion-4-5-full', size: '832 × 1216', steps: 28 }]))")
    P(page, "__potato.run('help.usage')"); page.wait_for_selector('.dlg >> text=API 사용 기록')
    txt = page.locator('.dlg[aria-label="API 사용 기록"]').inner_text(); assert '($0.75)' in txt and 'Anlas' in txt and '이번 달' in txt, txt
    page.keyboard.press('Escape')
    assert not errs, errs
    br.close()
print('통과')
