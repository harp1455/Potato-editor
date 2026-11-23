// 사람별로 나누기 창: AI가 만든 조각마다 주인(사람 1, 사람 2, 배경)을 눌러서 정하고, 사람마다 레이어로 만들어요
import { h } from './dom.js';
import { dialog, toast } from './overlay.js';
import { splitCarve, samBig } from '../core/ai.js';

const COLORS = ['#e8a33a', '#4c8ee6', '#57b86b', '#d0679a'];
const rgb = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// S: splitPieces의 결과, done(masks): 사람마다 마스크 그림(작업 크기)을 받아 레이어를 만드는 일
export function openSplit(S, title, done) {
  let brush = 0, carve = false, people = S.people, busy = false;
  const { W, H, lab, alpha } = S, N = W * H;
  const k = Math.min(860 / W, 520 / H), cv = h('canvas.split-view', { width: Math.round(W * k), height: Math.round(H * k), 'aria-label': '조각 미리 보기. 누르면 고른 사람에게 줘요' });
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const tint = document.createElement('canvas'); tint.width = W; tint.height = H;
  const tg = tint.getContext('2d'), img = tg.createImageData(W, H);
  const src = S.small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const paint = () => {
    const d = img.data, cols = COLORS.map(rgb);
    for (let i = 0; i < N; i++) {
      const o = i * 4, a = lab[i], who = a >= 0 ? S.owner[a] : -2;
      let r = src[o], g = src[o + 1], b = src[o + 2];
      if (who >= 0) { const c = cols[who]; r = r * 0.45 + c[0] * 0.55; g = g * 0.45 + c[1] * 0.55; b = b * 0.45 + c[2] * 0.55; }
      else { r *= 0.35; g *= 0.35; b *= 0.35; }
      const x = i % W, edge = a >= 0 && ((x < W - 1 && lab[i + 1] !== a) || (i + W < N && lab[i + W] !== a));
      if (edge) { r = g = b = 255; }
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(tint, 0, 0, cv.width, cv.height);
    count.textContent = Array.from({ length: people }, (_, i) => `사람 ${i + 1}: 조각 ${S.pieces.filter((p, a) => p.area > 0 && S.owner[a] === i).length}개`).join(', ');
  };
  const at = e => { const r = cv.getBoundingClientRect(); return [Math.min(W - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * W))), Math.min(H - 1, Math.max(0, Math.floor((e.clientY - r.top) / r.height * H)))]; };
  const give = (x, y) => { const a = lab[y * W + x]; if (a < 0 || S.owner[a] === brush) return false; S.owner[a] = brush; return true; };
  cv.addEventListener('pointerdown', async e => {
    if (busy) return; e.preventDefault(); const [x, y] = at(e);
    if (carve || e.altKey) {
      if (alpha[y * W + x] <= 64) { toast('인물이 있는 곳을 눌러 주세요.'); return; }
      busy = true; cv.classList.add('wait');
      try { const id = await splitCarve(S, x, y); if (id >= 0) S.owner[id] = Math.max(0, brush); else toast('여기서는 새 조각을 따지 못했어요.'); }
      catch (err) { toast('조각을 나누지 못했어요. ' + (err.message || ''), 'err'); }
      busy = false; cv.classList.remove('wait'); paint(); return;
    }
    if (give(x, y)) paint();
    cv.setPointerCapture(e.pointerId);
    const move = ev => { const [mx, my] = at(ev); if (give(mx, my)) paint(); };
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
  });
  const chips = h('div.split-chips', { role: 'radiogroup', 'aria-label': '조각을 줄 곳' });
  const count = h('p.split-count');
  const drawChips = () => {
    chips.replaceChildren(
      ...Array.from({ length: people }, (_, i) => h('button.split-chip' + (brush === i ? '.on' : ''), { role: 'radio', 'aria-checked': String(brush === i), onclick: () => { brush = i; drawChips(); } }, h('i', { style: `background:${COLORS[i]}` }), `사람 ${i + 1}`)),
      people < 4 ? h('button.split-chip', { title: '사람을 한 명 더 만들어요', onclick: () => { people++; brush = people - 1; drawChips(); paint(); } }, '+ 사람') : null,
      h('button.split-chip' + (brush === -1 ? '.on' : ''), { role: 'radio', 'aria-checked': String(brush === -1), onclick: () => { brush = -1; drawChips(); } }, h('i.bg'), '배경'),
      h('span.grow'),
      h('button.split-chip' + (carve ? '.on' : ''), { 'aria-pressed': String(carve), title: '켜면 누른 곳에서 AI가 새 조각을 따서 떼어 내요. Alt를 누른 채 눌러도 돼요.', onclick: () => { carve = !carve; drawChips(); } }, '조각 더 나누기'));
  };
  drawChips(); paint();
  const f = S.found, intro = `사람 ${f.person}명, 머리 ${f.head}개, 손 ${f.hand}개를 찾아서 조각 ${S.pieces.length}개로 나눴어요. 위에서 사람을 고르고 조각을 누르거나 문질러서 주인을 정해 주세요. 한 조각에 두 사람이 섞여 있으면 '조각 더 나누기'를 켜고 떼어 낼 곳을 누르세요.` + (samBig() ? '' : " 설정 > AI 팩에서 윤곽 모델을 '정밀하게'로 바꾸면 조각 경계가 더 깔끔해요.");
  dialog({ title, wide: true, body: h('div.psplit', null, h('p.split-intro', null, intro), chips, cv, count),
    buttons: [{ label: '취소' }, { label: '레이어로 만들기', primary: true, run: () => {
      const masks = [];
      for (let p = 0; p < people; p++) {
        const m = document.createElement('canvas'); m.width = W; m.height = H; const g = m.getContext('2d'), d = g.createImageData(W, H); let any = 0;
        for (let i = 0; i < N; i++) { const a = lab[i]; if (a >= 0 && S.owner[a] === p) { const o = i * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = 255; d.data[o + 3] = alpha[i]; any++; } }
        if (any) { g.putImageData(d, 0, 0); masks.push(m); }
      }
      if (!masks.length) { toast('사람에게 준 조각이 없어요.'); return false; }
      done(masks);
    } }] });
  return { paint };
}
