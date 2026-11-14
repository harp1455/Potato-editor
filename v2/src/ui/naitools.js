// NovelAI 디렉터 도구: 고른 레이어를 보내서 선화·스케치·색·표정·군더더기 지우기 결과를 새 레이어로 받아요
import { h } from './dom.js';
import { state, commit, canvasOf, layerOf, ensureBitmap } from '../core/store.js';
import { addCmd } from '../core/cmd.js';
import { settings } from '../core/settings.js';
import { NAI_TOOLS, NAI_EMOTIONS, naiAugment } from '../api/nai.js';
import { layerFromBlob } from '../rooms/image.js';
import { dialog, toast, busy } from './overlay.js';

const MAX = 1536 * 1024;   // 이보다 크면 줄여서 보내요 (Anlas가 크기에 따라 들어요)
const b64 = async c => { const b = await new Promise(r => c.toBlob(r, 'image/png')), u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

async function send(tool, extra = {}) {
  const c = canvasOf(), l = layerOf(); if (!c || !l) return;
  const label = NAI_TOOLS.find(t => t[0] === tool)[1], stop = new AbortController(), b = busy(`NovelAI: ${label}`);
  try {
    const bmp = await ensureBitmap(l.mediaId), k = Math.min(1, Math.sqrt(MAX / (bmp.width * bmp.height)));
    const w = Math.max(64, Math.round(bmp.width * k)), hh = Math.max(64, Math.round(bmp.height * k));
    const t = document.createElement('canvas'); t.width = w; t.height = hh; t.getContext('2d').drawImage(bmp, 0, 0, w, hh);
    const blob = await naiAugment({ tool, image: await b64(t), width: w, height: hh, ...extra }, stop.signal);
    const out = await createImageBitmap(blob), nl = await layerFromBlob(c, blob, `${l.name} ${label}`, { x: l.x, y: l.y, scale: l.scale * bmp.width / out.width });
    out.close(); state.layerId = nl.id; commit('NovelAI ' + label);
    toast(k < 1 ? `${label}: 새 레이어로 올렸어요. 그림이 커서 줄여 보냈어요.` : `${label}: 새 레이어로 올렸어요.`);
  } catch (e) { toast(`${label}: ${e.message || '실패했어요'}`, 'err'); }
  finally { b.done(); }
}

function ask(tool) {
  const o = { emotion: 'happy', prompt: '', weaken: 0, ...(settings.get('naiTool_' + tool) || {}) }, keep = () => settings.set('naiTool_' + tool, o);
  const emo = tool === 'emotion';
  dialog({ title: emo ? '표정 바꾸기' : '색 입히기',
    body: h('div.vid-form', null,
      h('p.dlg-text', null, emo ? '고른 레이어의 인물 표정을 바꿔 새 레이어로 올려요. 얼굴이 크게 보이는 그림일수록 잘 돼요.' : '선화나 흑백 그림에 색을 입혀 새 레이어로 올려요.'),
      emo && h('label.field', null, h('span.field-name.w', null, '표정'), h('select.text', { 'aria-label': '표정', onchange: e => { o.emotion = e.target.value; } }, NAI_EMOTIONS.map(([v, t]) => h('option', { value: v, selected: o.emotion === v }, t)))),
      h('label.field', null, h('span.field-name.w', null, emo ? '덧붙일 말' : '색 설명'), h('input.text', { type: 'text', value: o.prompt, 'aria-label': emo ? '덧붙일 말' : '색 설명', placeholder: emo ? 'tears, blush (비워도 돼요)' : 'red hair, blue eyes (비워도 돼요)', oninput: e => { o.prompt = e.target.value; } })),
      h('label.field', null, h('span.field-name.w', null, '원본 지키기'), h('input.range', { type: 'range', min: 0, max: 5, step: 1, value: o.weaken, 'aria-label': '원본 지키기', oninput: e => { o.weaken = +e.target.value; e.target.nextSibling.textContent = o.weaken; } }), h('span.field-unit', null, String(o.weaken))),
      h('p.dlg-text', null, '숫자가 클수록 원본에서 덜 바뀌어요. 한 번 보낼 때마다 Anlas가 들어요.')),
    buttons: [{ label: '취소' }, { label: '보내기', primary: true, run: () => { keep(); send(tool, o); } }] });
}

export function registerNaiTools() {
  const ok = () => !!layerOf() && !!settings.get('naiToken');
  for (const [tool, label] of NAI_TOOLS) {
    const form = tool === 'colorize' || tool === 'emotion';
    addCmd({ id: 'nai.' + tool, title: `NovelAI: ${label}${form ? '…' : ''}`, menu: 'AI', group: 'nai', words: '디렉터 director 노벨 nai', enabled: ok, run: () => (form ? ask(tool) : send(tool)) });
  }
}
