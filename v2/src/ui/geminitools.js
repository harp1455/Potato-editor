// 제미나이로 하는 일: 더빙(대사 → 목소리), AI 영상(그림 → 움직이는 영상). 요청은 모두 api/gemini.js의 통로를 지나요.
import { h } from './dom.js';
import { canvasOf, layerOf, emit, commit } from '../core/store.js';
import { settings } from '../core/settings.js';
import { addCmd, run } from '../core/cmd.js';
import { speak, animate, generate } from '../api/gemini.js';
import { runJob } from '../core/ai.js';
import { flatten, layerPic, layerFromBlob } from '../rooms/image.js';
import { download } from '../core/files.js';
import { dialog, toast, busy } from './overlay.js';

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

const RATIOS = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4]];
const IDEAS = [['카메라가 천천히 다가가요', 'Slow cinematic push-in toward the subject.'], ['머리카락과 옷이 바람에 흔들려요', 'Hair and clothes sway gently in the wind; subtle natural motion.'], ['숨 쉬고 눈을 깜빡여요', 'The character breathes softly and blinks; minimal idle motion.'], ['카메라가 옆으로 천천히 움직여요', 'Slow lateral camera pan with gentle parallax.']];
function videoDialog() {
  const c = canvasOf(); if (!c) return;
  if (!settings.get('adult') || !settings.get('apiKey').trim()) { toast('성인 확인과 제미나이 API 키가 필요해요.', 'err'); return run('app.settings'); }
  const V = { model: 'gemini-omni-1.1-flash', res: '720p', prompt: '', ...(settings.get('vid') || {}) };
  const ratio = RATIOS.reduce((a, b) => Math.abs(Math.log(b[1] / (c.w / c.h))) < Math.abs(Math.log(a[1] / (c.w / c.h))) ? b : a);
  const ta = h('textarea.text.area', { rows: 3, 'aria-label': '어떻게 움직일지', placeholder: '영어로 적으면 더 잘 알아들어요', value: V.prompt });
  dialog({ title: 'AI 영상 만들기', wide: true, body: h('div.vid-form', null,
    h('p.dlg-text', null, `지금 그림판을 첫 장면으로 삼아 짧은 영상을 만들어요. 화면 비율은 그림에 가장 가까운 ${ratio[0]}로 맞추고, 넘치는 곳은 가운데를 기준으로 잘라요. 영상은 결제를 연결한 키에서만 만들 수 있고 요금이 커요.`),
    h('label.stack', null, h('span.field-name', null, '어떻게 움직일지'), ta),
    h('div.btn-row', null, IDEAS.map(([t, p]) => h('button.btn.small', { onclick: () => { ta.value = (ta.value.trim() + ' ' + p).trim(); } }, t))),
    h('div.field-row', null,
      h('label.field', null, h('span.field-name.w', null, '화질'), h('select.text', { 'aria-label': '화질', onchange: e => { V.res = e.target.value; } }, ['720p', '1080p'].map(r => h('option', { value: r, selected: V.res === r }, r)))),
      h('label.field', null, h('span.field-name.w', null, '모델'), h('input.text', { type: 'text', value: V.model, 'aria-label': '영상 모델', onchange: e => { V.model = e.target.value.trim(); } })))),
    buttons: [{ label: '취소' }, { label: '영상 만들기', primary: true, run: () => {
      V.prompt = ta.value.trim(); settings.set('vid', V);
      (async () => {
        const ctl = new AbortController();
        try {
          const r = await runJob('AI 영상', async (job, say) => {
            const flat = await flatten(c), k = ratio[1], sw = Math.min(flat.width, flat.height * k), sh = sw / k, L = 1280 / Math.max(sw, sh), f = document.createElement('canvas');
            f.width = Math.round(sw * Math.min(1, L)); f.height = Math.round(sh * Math.min(1, L)); const g = f.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, f.width, f.height); g.imageSmoothingQuality = 'high';
            g.drawImage(flat, (flat.width - sw) / 2, (flat.height - sh) / 2, sw, sh, 0, 0, f.width, f.height);
            say('제미나이가 영상을 만드는 중 (몇 분 걸릴 수 있어요)', 0.1);
            return animate(V.model, f.toDataURL('image/jpeg', 0.93).split(',')[1], V.prompt, ratio[0], V.res, { signal: ctl.signal, onWait: n => { if (job.stop) ctl.abort(); say(`제미나이가 영상을 만드는 중 (${(n + 1) * 5}초째)`, Math.min(0.95, 0.1 + n * 0.02)); } });
          });
          if (!r) return;
          const url = URL.createObjectURL(r.blob);
          dialog({ title: 'AI 영상', wide: true, onClose: () => URL.revokeObjectURL(url), body: h('div', null, h('video.vid-out', { src: url, controls: true, loop: true, autoplay: true }), r.note && h('p.set-note', null, r.note)), buttons: [{ label: '닫기' }, { label: 'MP4 저장', primary: true, run: () => { download(r.blob, c.name + ' 영상.mp4'); return false; } }] });
        } catch (e) { toast(e.message || '영상을 만들지 못했어요.', 'err'); }
      })();
    } }] });
}

export function registerGeminiCmds() {
  addCmd({ id: 'ai.editByText', title: '말로 그림 고치기… (제미나이)', menu: 'AI', group: 'gemini', words: '나노 바나나 편집 수정 edit', enabled: () => !!canvasOf(), run: editDialog });
  addCmd({ id: 'ai.video', title: 'AI 영상 만들기… (제미나이)', menu: 'AI', group: 'gemini', words: '움직이는 영상 omni', enabled: () => !!canvasOf(), run: videoDialog });
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
