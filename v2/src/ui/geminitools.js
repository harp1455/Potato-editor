// 제미나이로 하는 일: 더빙(대사 → 목소리), AI 영상(그림 → 움직이는 영상). 요청은 모두 api/gemini.js의 통로를 지나요.
import { h, icon } from './dom.js';
import { state, idb, uid, canvasOf, layerOf, emit, commit } from '../core/store.js';
import { logErr } from '../core/errlog.js';
import { settings } from '../core/settings.js';
import { addCmd, run } from '../core/cmd.js';
import { speak, animate, generate } from '../api/gemini.js';
import { runJob } from '../core/ai.js';
import { flatten, layerPic, layerFromBlob } from '../rooms/image.js';
import { download } from '../core/files.js';
import { dialog, toast, busy, confirmBox } from './overlay.js';

export const DUB_MODELS = [['gemini-3.8-flash-tts', '3.8 Flash (연기력 좋음)'], ['gemini-3.8-flash-lite-tts', '3.8 Flash-Lite (빠르고 쌈)']];
const VOICES = [['Charon', '남', '또렷한'], ['Puck', '남', '밝은'], ['Fenrir', '남', '들뜬'], ['Orus', '남', '단단한'], ['Enceladus', '남', '숨소리 섞인'], ['Iapetus', '남', '맑은'], ['Umbriel', '남', '느긋한'], ['Algieba', '남', '부드러운'], ['Algenib', '남', '거친'], ['Rasalgethi', '남', '차분히 설명하는'], ['Alnilam', '남', '단호한'], ['Schedar', '남', '고른'], ['Achird', '남', '친근한'], ['Zubenelgenubi', '남', '편한'], ['Sadachbia', '남', '생기 있는'], ['Sadaltager', '남', '지적인'],
  ['Kore', '여', '단단한'], ['Zephyr', '여', '밝은'], ['Leda', '여', '앳된'], ['Aoede', '여', '산뜻한'], ['Callirrhoe', '여', '느긋한'], ['Autonoe', '여', '밝은'], ['Despina', '여', '부드러운'], ['Erinome', '여', '맑은'], ['Laomedeia', '여', '경쾌한'], ['Achernar', '여', '여린'], ['Gacrux', '여', '성숙한'], ['Pulcherrima', '여', '당찬'], ['Vindemiatrix', '여', '다정한'], ['Sulafat', '여', '따뜻한']];
const EMO = [['', '말투 없음'], ['calm and composed', '차분하게'], ['warm and affectionate', '다정하게'], ['cheerful and bright', '기쁘게'], ['excited and energetic', '신나게'], ['angry, sharp', '화내며'], ['suppressing anger, tense and low', '화를 참으며'], ['cold and curt', '차갑게'], ['sad and subdued', '슬프게'], ['tearful, voice trembling', '울먹이며'], ['whispering softly', '속삭이듯'], ['languid, drowsy, slow', '나른하게'], ['shy and hesitant', '수줍게'], ['playful, teasing', '장난스럽게'], ['surprised, startled', '놀라서'], ['frightened, shaky voice', '겁먹은'], ['out of breath', '숨차게'], ['low, husky, intimate', '낮게 깔아서'], ['mocking, sneering', '비웃듯'], ['firm and commanding', '단호하게'], ['exhausted, weary', '지친'], ['neutral narrator', '내레이션']];
const SPEED = [['', '보통 빠르기'], ['very slow pace', '아주 천천히'], ['slightly slow pace', '조금 천천히'], ['slightly fast pace', '조금 빠르게'], ['very fast pace', '아주 빠르게']];

const D = { model: DUB_MODELS[0][0], voice: 'Charon', emo: '', speed: '', text: '', ...(settings.get('dub') || {}) };
let keepT = 0; const keep = () => { clearTimeout(keepT); keepT = setTimeout(() => settings.set('dub', { ...D }), 400); };
const clips = [];   // 만든 소리들 { text, voice, url, blob }
let busyDub = false, dubCtl = null;

async function makeDub() {
  const lines = D.text.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) { toast('읽을 대사를 적어 주세요. 한 줄이 소리 하나가 돼요.', 'err'); return; }
  busyDub = true; dubCtl = new AbortController(); emit();
  try {
    await runJob('더빙', async (job, say) => {
      for (let i = 0; i < lines.length; i++) {
        if (job.stop) { dubCtl.abort(); throw new Error('stop'); }
        say(`${i + 1} / ${lines.length}번째 대사를 읽는 중`, i / lines.length);
        const r = await speak(D.model, lines[i], [D.emo, D.speed].filter(Boolean).join(', '), D.voice, { signal: dubCtl.signal });
        clips.unshift({ text: lines[i], voice: D.voice, blob: r.blob, url: URL.createObjectURL(r.blob) });
        if (r.note && i === 0) toast(r.note);
        emit();
      }
    });
  } catch (e) { toast(e.message || '소리를 만들지 못했어요.', 'err'); }
  busyDub = false; dubCtl = null; emit();
}

export const dubPanel = {
  title: '더빙',
  render(el) {
    const sel = (label, k, list) => h('label.field', null, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: e => { D[k] = e.target.value; keep(); } }, list.map(([v, t]) => h('option', { value: v, selected: D[k] === v }, t))));
    const ready = settings.get('adult') && settings.get('apiKey').trim();
    el.append(...[
      !ready && h('p.empty', null, settings.get('adult') ? '제미나이 API 키를 넣으면 대사를 목소리로 만들 수 있어요.' : '성인 확인을 마치고 제미나이 API 키를 넣으면 쓸 수 있어요.'),
      !ready && h('button.btn', { onclick: () => run('app.settings') }, '설정 열기'),
      h('label.stack', null, h('span.field-name', null, '대사 (한 줄이 소리 하나)'), h('textarea.text.area', { rows: 4, 'aria-label': '대사', value: D.text, oninput: e => { D.text = e.target.value; keep(); } })),
      sel('목소리', 'voice', VOICES.map(([v, g, t]) => [v, `${v} (${g}, ${t})`])),
      sel('말투', 'emo', EMO), sel('빠르기', 'speed', SPEED), sel('모델', 'model', DUB_MODELS),
      h('div.btn-row.wide', null, h('button.btn.primary', { disabled: busyDub, onclick: makeDub }, busyDub ? '읽는 중이에요' : '소리 만들기')),
      h('p.panel-note', null, '웃음은 <laugh>, 한숨은 <sigh>, 쉼은 <short pause>처럼 대사 안에 적을 수 있어요. 글자 수만큼 API 요금이 들어요.'),
      ...clips.map(c => h('div.clip', null, h('p.clip-text', { title: c.text }, c.text), h('audio', { controls: true, src: c.url, preload: 'metadata' }),
        h('div.btn-row', null, h('span.field-unit', null, c.voice), h('span.grow'), h('button.btn.small', { onclick: () => download(c.blob, c.text.slice(0, 24).replace(/[\\/:*?"<>|]/g, '_') + '.wav') }, 'WAV 저장')))),
    ].filter(Boolean));
  },
};

// 영상 모델이 받는 화면 비율은 가로(16:9)와 세로(9:16) 둘뿐이에요. 그림은 보내기 전에 이 비율로 다듬어요
const RATIOS = [['16:9', 16 / 9], ['9:16', 9 / 16]];
const FITS = [['crop', '잘라서 맞추기 (가운데 기준)'], ['blur', '안 자르고, 남는 곳은 흐린 그림으로 채우기'], ['black', '안 자르고, 남는 곳은 검정으로 채우기']];
// 그림을 고른 비율의 첫 장면으로 다듬어요 (긴 쪽 1280까지)
export function firstFrame(flat, k, fit) {
  const W = k >= 1 ? 1280 : Math.round(1280 * k), H = k >= 1 ? Math.round(1280 / k) : 1280, f = document.createElement('canvas'); f.width = W; f.height = H; const g = f.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const cover = Math.max(W / flat.width, H / flat.height), inside = Math.min(W / flat.width, H / flat.height), put = z => g.drawImage(flat, (W - flat.width * z) / 2, (H - flat.height * z) / 2, flat.width * z, flat.height * z);
  if (fit === 'crop') put(cover); else { if (fit === 'blur') { g.filter = 'blur(28px) brightness(0.75)'; put(cover * 1.12); g.filter = 'none'; } put(inside); }
  return f;
}
const IDEAS = [['카메라가 천천히 다가가요', 'Slow cinematic push-in toward the subject.'], ['머리카락과 옷이 바람에 흔들려요', 'Hair and clothes sway gently in the wind; subtle natural motion.'], ['숨 쉬고 눈을 깜빡여요', 'The character breathes softly and blinks; minimal idle motion.'], ['카메라가 옆으로 천천히 움직여요', 'Slow lateral camera pan with gentle parallax.']];
// AI 영상 작업 창: 왼쪽에서 만들고, 오른쪽에 만드는 중인 것과 다 만든 영상이 쌓여요.
// 창을 닫아도 만들기는 계속되고, 다 된 영상은 작업에 저장돼서 언제든 다시 열어 보고, 저장하고, 영상 작업실로 보낼 수 있어요.
const RUN = [];   // 만드는 중이거나 실패한 것 (이 창을 켠 동안만)
let vidPaint = null;
const vids = () => state.project.videos || (state.project.videos = []);
async function makeVideo(c, V, ratio) {
  const it = { id: uid('v'), prompt: V.prompt, model: V.model, res: V.res, ratio: ratio[0], t0: Date.now(), status: 'run', text: '그림을 준비하는 중이에요.', name: c.name }; RUN.unshift(it); if (vidPaint) vidPaint();
  const ctl = new AbortController(); it.stop = () => ctl.abort();
  try {
    const r = await runJob('AI 영상', async (job, say) => {
      const f = firstFrame(await flatten(c), ratio[1], V.fit || 'crop');
      it.text = '제미나이에 보냈어요. 보통 1~3분 걸려요.'; say('제미나이가 영상을 만드는 중', 0.1); if (vidPaint) vidPaint();
      return animate(V.model, f.toDataURL('image/jpeg', 0.93).split(',')[1], V.prompt, ratio[0], V.res, { signal: ctl.signal, onWait: n => { if (job.stop) ctl.abort(); say(`제미나이가 영상을 만드는 중 (${(n + 1) * 5}초째)`, Math.min(0.95, 0.1 + n * 0.02)); } });
    });
    if (!r) throw new Error('만들기를 멈췄어요.');
    await idb.put('blobs', 'vid:' + it.id, r.blob);
    vids().unshift({ id: it.id, name: it.name, prompt: it.prompt, model: it.model, res: it.res, ratio: it.ratio, at: Date.now(), size: r.blob.size, type: r.blob.type, note: r.note || '' });
    RUN.splice(RUN.indexOf(it), 1); commit('AI 영상 만들기');
    if (vidPaint) vidPaint(it.id); else toast('AI 영상이 다 됐어요. AI 메뉴의 AI 영상에서 보고 저장할 수 있어요.');
  } catch (e) {
    it.status = 'fail'; it.text = e.message || '영상을 만들지 못했어요.'; logErr('AI 영상', it.text, (e.code || '') + (e.detail ? ' / ' + e.detail : ''));
    if (vidPaint) vidPaint(); else toast('AI 영상을 만들지 못했어요. AI 메뉴의 AI 영상에서 이유를 볼 수 있어요.', 'err');
  }
}
function videoDialog() {
  const c = canvasOf(), okKey = settings.get('adult') && settings.get('apiKey').trim();
  const V = { model: 'gemini-omni-1.1-flash', res: '720p', prompt: '', fit: 'crop', ...(settings.get('vid') || {}), ratio: '' };
  const auto = c ? RATIOS.reduce((a, b) => Math.abs(Math.log(b[1] / (c.w / c.h))) < Math.abs(Math.log(a[1] / (c.w / c.h))) ? b : a) : RATIOS[0];
  const ratioNow = () => RATIOS.find(r => r[0] === V.ratio) || auto;
  // 보낼 첫 장면 미리 보기: 비율과 맞추는 법을 바꾸면 바로 다시 그려요
  const pre = h('canvas.aiv-pre', { 'aria-label': '보낼 첫 장면 미리 보기' }); let flatNow = null;
  const drawPre = async () => { if (!c) return; flatNow = flatNow || await flatten(c); const f = firstFrame(flatNow, ratioNow()[1], V.fit), k = 300 / Math.max(f.width, f.height); pre.width = Math.round(f.width * k); pre.height = Math.round(f.height * k); pre.getContext('2d').drawImage(f, 0, 0, pre.width, pre.height); };
  const ta = h('textarea.text.area', { rows: 4, 'aria-label': '어떻게 움직일지', placeholder: '영어로 적으면 더 잘 알아들어요', value: V.prompt });
  const list = h('div.aiv-list'), urls = new Map(); let open = (vids()[0] || {}).id || null;
  const urlOf = async v => { if (!urls.has(v.id)) { const b = await idb.get('blobs', 'vid:' + v.id); urls.set(v.id, b ? URL.createObjectURL(b) : ''); } return urls.get(v.id); };
  const when = t => new Date(t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
  const paint = async focus => {
    if (focus) open = focus;
    const rows = [];
    for (const it of RUN) rows.push(h('div.aiv-item' + (it.status === 'fail' ? '.fail' : '.run'), null,
      h('div.aiv-head', null, h('b', null, it.status === 'fail' ? '만들지 못했어요' : `만드는 중 (${Math.round((Date.now() - it.t0) / 1000)}초째)`), h('span.grow'), it.status === 'fail' ? h('button.btn.small', { onclick: () => { ta.value = it.prompt; RUN.splice(RUN.indexOf(it), 1); paint(); } }, '같은 말로 다시 쓰기') : h('button.btn.small', { onclick: () => it.stop && it.stop() }, '멈추기'), it.status === 'fail' ? h('button.icon-btn', { title: '목록에서 지우기', 'aria-label': '실패한 것 지우기', onclick: () => { RUN.splice(RUN.indexOf(it), 1); paint(); } }, icon('close', 12)) : null),
      it.status === 'run' ? h('div.job-bar.wait', null, h('span')) : null, h('p.aiv-text', null, it.text), h('p.aiv-prompt', null, it.prompt || '(움직임 설명 없음)')));
    for (const v of vids()) {
      const on = v.id === open, src = on ? await urlOf(v) : '';
      rows.push(h('div.aiv-item' + (on ? '.on' : ''), null,
        h('div.aiv-head', null, h('button.aiv-name', { 'aria-expanded': String(on), onclick: () => { open = on ? null : v.id; paint(); } }, v.name), h('span.aiv-meta', null, when(v.at)), h('span.grow'), h('span.aiv-meta', null, `${v.ratio}, ${v.res}, ${(v.size / 1048576).toFixed(1)}MB`)),
        on ? (src ? h('video.vid-out', { src, controls: true, loop: true, autoplay: true, muted: true, playsinline: true }) : h('p.aiv-text', null, '영상 파일을 찾지 못했어요.')) : null,
        on ? h('p.aiv-prompt', null, v.prompt || '(움직임 설명 없음)') : null, on && v.note ? h('p.aiv-text', null, v.note) : null,
        on ? h('div.btn-row', null,
          h('button.btn.small.primary', { disabled: !src, onclick: async () => download(await idb.get('blobs', 'vid:' + v.id), `${v.name} 영상 ${v.id.slice(-4)}.mp4`) }, 'MP4로 저장'),
          h('button.btn.small', { disabled: !src, title: '영상을 장면들로 풀어 영상 작업실에 넣어요. 거기서 자막·소리·효과를 더하고 다시 내보낼 수 있어요.', onclick: async () => { const b = await idb.get('blobs', 'vid:' + v.id), { clipToScenes } = await import('../rooms/video.js'); d.close(); settings.set('room', 'video'); clipToScenes(new File([b], `${v.name} AI 영상.mp4`, { type: b.type || 'video/mp4' })); } }, '영상 작업실로 보내기'),
          h('button.btn.small', { onclick: () => { ta.value = v.prompt; ta.focus(); } }, '이 말로 다시 쓰기'), h('span.grow'),
          h('button.icon-btn', { title: '이 영상 지우기', 'aria-label': `${v.name} 영상 지우기`, onclick: async () => { if (!await confirmBox('AI 영상 지우기', `'${v.name}' 영상을 지워요. 영상 파일까지 지워서 되돌리기로 돌아오지 않아요.`, '지우기', true)) return; state.project.videos = vids().filter(x => x !== v); await idb.del('blobs', 'vid:' + v.id); if (urls.get(v.id)) URL.revokeObjectURL(urls.get(v.id)); urls.delete(v.id); commit('AI 영상 지우기'); paint(); } }, icon('trash'))) : null));
    }
    if (!rows.length) rows.push(h('p.empty', null, '아직 만든 영상이 없어요. 왼쪽에서 움직임을 적고 영상 만들기를 누르면, 만드는 과정과 결과가 여기에 나와요.'));
    list.replaceChildren(...rows);
  };
  const go = () => {
    if (!c) { toast('먼저 이미지 작업실에서 그림을 열어 주세요.', 'err'); return; }
    if (!okKey) { toast('성인 확인과 제미나이 API 키가 필요해요. 설정 > AI와 API에서 넣어 주세요.', 'err'); return; }
    V.prompt = ta.value.trim(); settings.set('vid', { ...V, ratio: undefined }); makeVideo(c, { ...V }, ratioNow());
  };
  const tick = setInterval(() => { if (RUN.some(r => r.status === 'run')) paint(); }, 1000);
  const d = dialog({ title: 'AI 영상', wide: true, onClose: () => { clearInterval(tick); vidPaint = null; urls.forEach(u => u && URL.revokeObjectURL(u)); },
    body: h('div.aiv', null,
      h('div.aiv-form', null,
        h('p.dlg-text', null, c ? `지금 그림판(${c.name})을 첫 장면으로 삼아 짧은 영상을 만들어요. 영상은 가로(16:9)나 세로(9:16)로만 만들 수 있어서, 그림을 그 비율로 다듬어 보내요. 아래 그림이 보낼 첫 장면이에요.` : '이미지 작업실에서 그림을 열면 그 그림으로 영상을 만들 수 있어요. 전에 만든 영상은 오른쪽에서 볼 수 있어요.'),
        c ? pre : null,
        c ? h('label.field', null, h('span.field-name.w', null, '화면 비율'), h('select.text', { 'aria-label': '화면 비율', onchange: e => { V.ratio = e.target.value; drawPre(); } }, [['', `알아서 (${auto[0] === '16:9' ? '가로' : '세로'} ${auto[0]})`], ['16:9', '가로 16:9'], ['9:16', '세로 9:16']].map(([v, t]) => h('option', { value: v }, t)))) : null,
        c ? h('label.field', null, h('span.field-name.w', null, '맞추는 법'), h('select.text', { 'aria-label': '맞추는 법', onchange: e => { V.fit = e.target.value; drawPre(); } }, FITS.map(([v, t]) => h('option', { value: v, selected: V.fit === v }, t)))) : null,
        h('label.stack', null, h('span.field-name', null, '어떻게 움직일지'), ta),
        h('div.btn-row.wrap', null, IDEAS.map(([t, p]) => h('button.btn.small', { onclick: () => { ta.value = (ta.value.trim() + ' ' + p).trim(); } }, t))),
        h('label.field', null, h('span.field-name.w', null, '화질'), h('select.text', { 'aria-label': '화질', onchange: e => { V.res = e.target.value; } }, ['720p', '1080p'].map(r => h('option', { value: r, selected: V.res === r }, r)))),
        h('label.field', null, h('span.field-name.w', null, '모델'), h('input.text', { type: 'text', value: V.model, 'aria-label': '영상 모델', onchange: e => { V.model = e.target.value.trim(); } })),
        h('button.btn.primary', { disabled: !c, onclick: go }, '영상 만들기'),
        h('p.dlg-text', null, '영상은 결제를 연결한 키에서만 만들 수 있고 요금이 커요. 만드는 동안 이 창을 닫아도 계속 만들어지고, 다 되면 알려 드려요. 구글의 영상 거름막은 끌 수 없어서 수위 있는 그림은 거절될 수 있어요.')),
      h('div.aiv-side', null, h('h3.sec', null, '만든 영상'), list)),
    buttons: [{ label: '닫기' }] });
  vidPaint = paint; paint(); drawPre();
}

export function registerGeminiCmds() {
  addCmd({ id: 'ai.editByText', title: '말로 그림 고치기… (제미나이)', menu: 'AI', group: 'gemini', words: '나노 바나나 편집 수정 edit', enabled: () => !!canvasOf(), run: editDialog });
  addCmd({ id: 'ai.video', title: 'AI 영상 만들기… (제미나이)', menu: 'AI', group: 'gemini', words: '움직이는 영상 omni 만든 영상 보기 저장', run: videoDialog });
}

// 말로 그림 고치기: 고른 레이어(없으면 그림판 전체)를 보내고, 고친 그림을 새 레이어로 받아요
export async function editByText(src, text, model) {
  const k = Math.min(1, 2048 / Math.max(src.width, src.height)), t = document.createElement('canvas'); t.width = Math.round(src.width * k); t.height = Math.round(src.height * k); t.getContext('2d').drawImage(src, 0, 0, t.width, t.height);
  const r = await generate('edit', model, { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: t.toDataURL('image/png').split(',')[1] } }, { text }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
  const part = (((r.raw.candidates || [])[0] || {}).content || { parts: [] }).parts.find(p => p.inlineData && p.inlineData.data);
  if (!part) throw new Error(r.text ? '그림 대신 글만 돌아왔어요: ' + r.text.slice(0, 120) : '고친 그림이 돌아오지 않았어요. 모델 이름이 그림을 만드는 모델인지 확인해 주세요.');
  return new Blob([Uint8Array.from(atob(part.inlineData.data), ch => ch.charCodeAt(0))], { type: part.inlineData.mimeType || 'image/png' });
}
function editDialog() {
  const O = { text: '', model: settings.get('imageModel'), ...(settings.get('editByText') || {}) };
  const ta = h('textarea.text.area', { rows: 4, 'aria-label': '어떻게 고칠지', placeholder: '예: 머리를 은색으로 바꿔 줘. 배경을 밤 바다로 바꿔 줘.', value: O.text, oninput: e => { O.text = e.target.value; } });
  const go = async () => {
    if (!O.text.trim()) { toast('어떻게 고칠지 적어 주세요.', 'err'); return false; }
    settings.set('editByText', O); const c = canvasOf(), l = layerOf(), b = busy('제미나이가 그림을 고치는 중이에요.');
    try {
      const src = l ? await layerPic(l) : await flatten(c), blob = await editByText(src, O.text.trim(), O.model.trim() || settings.get('imageModel')), bmp = await createImageBitmap(blob);
      const nl = await layerFromBlob(c, blob, (l ? l.name : c.name) + ' 고친 그림', l ? { x: l.x, y: l.y, scale: l.scale * src.width / bmp.width } : { scale: c.w / bmp.width }); bmp.close(); commit('말로 그림 고치기'); b.done('고친 그림을 새 레이어로 올렸어요.'); return nl;
    } catch (e) { b.done(e.message || '고치지 못했어요.', 'err'); }
  };
  dialog({ title: '말로 그림 고치기', body: h('div.vid-form', null,
    h('p.dlg-text', null, layerOf() ? '고른 레이어를 제미나이에 보내고, 고친 그림을 새 레이어로 받아요. 원래 레이어는 그대로 남아요.' : '그림판 전체를 제미나이에 보내고, 고친 그림을 새 레이어로 받아요.'),
    ta, h('label.field', null, h('span.field-name.w', null, '모델'), h('input.text', { type: 'text', value: O.model, 'aria-label': '그림 모델', oninput: e => { O.model = e.target.value; } })),
    h('p.dlg-text', null, '구글의 그림 거름막은 안전 설정으로 끌 수 없어서, 수위 있는 그림은 거절될 수 있어요. 그럴 때는 NovelAI의 고른 곳만 다시 그리기를 써 주세요.')),
    buttons: [{ label: '취소' }, { label: '고치기', primary: true, run: () => { go(); } }] });
}
