// 8.x '캐릭터 움직이기'를 2.0에 이어 붙이는 곳. rig.js가 바깥에서 가져다 쓰던 것들을 2.0 것으로 내줘요.
import { makeRig } from './rig.gen.js';
import { idb as store } from '../core/store.js';
import { aiLoad, aiCall, samState, aiDevice } from '../core/ai.js';
import { missingFiles, idsOfPack } from '../core/packs.js';
import { saveFiles } from '../core/files.js';
import { ensureModels } from '../ui/aitools.js';
import { toast as say, dialog, busy } from '../ui/overlay.js';
import { settings } from '../core/settings.js';
import { infillCanvas, naiPrompt } from '../ui/naipanel.js';
import { h } from '../ui/dom.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = () => { let r = $('#modalRoot'); if (!r) { r = document.createElement('div'); r.id = 'modalRoot'; document.body.append(r); } return r; };
const closeModal = () => { root().innerHTML = ''; };
function modal(html, opts = {}) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  root().appendChild(bg);
  bg.addEventListener('pointerdown', e => { if (e.target === bg && !bg.firstElementChild.classList.contains('rg-modal')) closeModal(); });
  const m = bg.firstElementChild; $$('[data-close]', m).forEach(b => b.addEventListener('click', closeModal));
  return m;
}
function czProgress(title) {
  const tk = { stop: false };
  const m = modal(`<h2>${esc(title)}</h2><p class="sub" id="czPMsg">준비하는 중…</p><div class="czbar"><i id="czPBar"></i></div><p class="muted small" id="czPDev">처음 한 번은 모델을 푸느라 조금 더 걸려요.</p><div class="foot"><button class="btn" id="czPStop">멈추기</button></div>`);
  $('#czPStop', m).addEventListener('click', () => { tk.stop = true; closeModal(); });
  tk.set = (msg, f) => { if (!m.isConnected) { tk.stop = true; return; } if (msg) $('#czPMsg', m).textContent = msg; if (f !== undefined) $('#czPBar', m).style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; const d = aiDevice(); if (d) $('#czPDev', m).textContent = d + '로 처리하고 있어요.'; };
  tk.done = () => { if (m.isConnected) closeModal(); };
  return tk;
}
function czErrText(e) {
  const m = String((e && e.message) || e || '');
  if (m.startsWith('nopack')) return '필요한 AI 팩이 없어요. 설정 > AI 팩에서 받아 주세요.';
  if (/memory|Memory|allocation/.test(m)) return '메모리가 모자라서 멈췄어요. 다른 프로그램을 닫고 다시 해 보세요.';
  return '(' + m.slice(0, 80) + ')';
}
const PACKS = ['bg', 'erase', 'rig'];
const NEED = () => ['czWasm', 'czM_samE', 'czM_samD', ...PACKS.flatMap(idsOfPack)];

// 떼어 낸 자리를 NovelAI로 다시 그리기: 무엇을 그릴지 묻고, 결과 그림을 돌려줘요 (그만두면 null)
function naiFill(pic, mask, label) {
  return new Promise(res => {
    if (!settings.get('adult') || !settings.get('naiToken').trim()) { say('성인 확인과 NovelAI 토큰이 필요해요. 창을 닫고 설정 > AI와 API에서 넣어 주세요.', 'err'); return res(null); }
    const ta = h('textarea.text.area', { rows: 4, 'aria-label': '무엇을 그릴지', value: naiPrompt(), placeholder: '가려져 있던 곳에 무엇이 있어야 하는지 적어 주세요. 예: 1boy, bare shoulder, white shirt' });
    let go = false;
    dialog({ title: `'${label}'의 메운 자리 다시 그리기`, body: h('div', null, h('p.dlg-text', null, '가려져 있다가 드러난 자리만 NovelAI가 다시 그려요. 그 자리에 있어야 할 것을 프롬프트로 적어 주세요. 모델과 자세한 설정은 NovelAI 패널의 값을 써요.'), h('label.stack', { style: 'margin-top:10px' }, h('span.field-name', null, '프롬프트'), ta)),
      buttons: [{ label: '취소' }, { label: '다시 그리기', primary: true, run: () => { go = true; } }],
      onClose: async () => {
        if (!go || !ta.value.trim()) return res(null);
        const b = busy('NovelAI가 그리는 중이에요.');
        try { const img = await infillCanvas(pic, mask, ta.value.trim()); b.done(''); res(img); } catch (e) { b.done(e.message || 'NovelAI 요청이 실패했어요.', 'err'); res(null); }
      } });
  });
}

let rig = null;
function load() {
  if (!rig) rig = makeRig({
    $, $$, clamp, esc, uid: () => Math.random().toString(36).slice(2, 10),
    newCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; },
    toast: msg => say(msg), modal, closeModal,
    czLoad: aiLoad, czCall: aiCall, cz: samState, czIsApp: () => true,
    czPacksReady: () => ensureModels(NEED()),
    czPackState: async () => ({ erase: !(await missingFiles(['czM_lama'])).length }),
    czProgress, czErrText,
    idb: { get: k => store.get('blobs', 'kv:' + k), set: async (k, v) => { await store.put('blobs', 'kv:' + k, v); return true; } },
    safeName: s => String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || '그림',
    saveFiles, naiFill,
  });
  return rig;
}
export const openRig = from => load().rgOpen(from);
// 구멍 메우기(AI 지우개): px = RGBA, hole = 0~1(메울 곳) → { px, by: 'lama' | 'blur' }
export const fillHole = (px, hole, W, H, tk) => load().dpFill(px, hole, W, H, tk);
export const rigSaved = async key => !!(await store.get('blobs', 'kv:rig:' + key));
