// 8.x '캐릭터 움직이기'를 2.0에 이어 붙이는 곳. rig.js가 바깥에서 가져다 쓰던 것들을 2.0 것으로 내줘요.
import { makeRig } from './rig.gen.js';
import { idb as store } from '../core/store.js';
import { aiLoad, aiCall, samState, aiDevice } from '../core/ai.js';
import { missingFiles, idsOfPack } from '../core/packs.js';
import { saveFiles } from '../core/files.js';
import { ensureModels } from '../ui/aitools.js';
import { toast as say } from '../ui/overlay.js';

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
    saveFiles,
  });
  return rig;
}
export const openRig = from => load().rgOpen(from);
// 구멍 메우기(AI 지우개): px = RGBA, hole = 0~1(메울 곳) → { px, by: 'lama' | 'blur' }
export const fillHole = (px, hole, W, H, tk) => load().dpFill(px, hole, W, H, tk);
export const rigSaved = async key => !!(await store.get('blobs', 'kv:rig:' + key));
