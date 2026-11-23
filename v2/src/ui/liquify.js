// 뒤틀기: 붓으로 그림을 밀고, 부풀리고, 오므려요. 결과는 새 그림으로 바꿔 끼우고 원본은 보관함에 남아요.
import { h } from './dom.js';
import { state, commit, layerOf, addMedia, ensureBitmap } from '../core/store.js';
import { addCmd } from '../core/cmd.js';
import { dialog, toast, busy } from './overlay.js';

const STEP = 4;   // 밀린 정도를 적어 두는 격자 간격 (그림 픽셀)
// 밀린 정도 표: 결과의 (x, y)는 원본의 (x + dx, y + dy)에서 색을 가져와요
export function makeField(W, H) { const gw = Math.ceil(W / STEP) + 1, gh = Math.ceil(H / STEP) + 1; return { W, H, gw, gh, dx: new Float32Array(gw * gh), dy: new Float32Array(gw * gh) }; }
const samp = (a, F, gx, gy) => { gx = Math.min(F.gw - 1.001, Math.max(0, gx)); gy = Math.min(F.gh - 1.001, Math.max(0, gy)); const x = gx | 0, y = gy | 0, fx = gx - x, fy = gy - y, i = y * F.gw + x; return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + F.gw] * (1 - fx) + a[i + F.gw + 1] * fx) * fy; };
// 붓질 한 번: (px, py)에서 반지름 R 안을 mode대로 바꿔요. (mx, my)는 붓이 움직인 만큼
export function stroke(F, mode, px, py, R, k, mx, my) {
  const x0 = Math.max(0, Math.floor((px - R) / STEP)), x1 = Math.min(F.gw - 1, Math.ceil((px + R) / STEP)), y0 = Math.max(0, Math.floor((py - R) / STEP)), y1 = Math.min(F.gh - 1, Math.ceil((py + R) / STEP));
  if (x1 < x0 || y1 < y0) return;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, nx = new Float32Array(bw * bh), ny = new Float32Array(bw * bh);
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
    const i = gy * F.gw + gx, j = (gy - y0) * bw + (gx - x0), X = gx * STEP, Y = gy * STEP, d2 = ((X - px) ** 2 + (Y - py) ** 2) / (R * R);
    if (d2 >= 1) { nx[j] = F.dx[i]; ny[j] = F.dy[i]; continue; }
    const w = (1 - d2) * (1 - d2) * k;
    if (mode === 'restore') { nx[j] = F.dx[i] * (1 - w); ny[j] = F.dy[i] * (1 - w); continue; }
    // 이 자리가 색을 가져올 곳을 (sx, sy)만큼 옮겨요. 이미 밀린 것 위에 겹쳐지게 옮긴 자리의 값을 읽어 와요
    let sx, sy;
    if (mode === 'push') { sx = -mx * w; sy = -my * w; }
    else { const s = (mode === 'bloat' ? -1 : 1) * w * 0.18; sx = (X - px) * s; sy = (Y - py) * s; }
    nx[j] = samp(F.dx, F, (X + sx) / STEP, (Y + sy) / STEP) + sx; ny[j] = samp(F.dy, F, (X + sx) / STEP, (Y + sy) / STEP) + sy;
  }
  for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const i = gy * F.gw + gx, j = (gy - y0) * bw + (gx - x0); F.dx[i] = nx[j]; F.dy[i] = ny[j]; }
}
// 밀린 정도 표대로 그림을 다시 그려요. out과 src는 같은 비율이면 크기가 달라도 돼요 (미리 보기는 작게)
export function warp(F, src, out) {
  const sw = src.width, sh = src.height, ow = out.width, oh = out.height, S = src.data, O = out.data, kx = F.W / ow, ky = F.H / oh, rx = sw / F.W, ry = sh / F.H;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const X = (x + 0.5) * kx, Y = (y + 0.5) * ky, gx = X / STEP, gy = Y / STEP;
    let u = (X + samp(F.dx, F, gx, gy)) * rx - 0.5, v = (Y + samp(F.dy, F, gx, gy)) * ry - 0.5;
    u = Math.min(sw - 1.001, Math.max(0, u)); v = Math.min(sh - 1.001, Math.max(0, v));
    const ux = u | 0, vy = v | 0, fx = u - ux, fy = v - vy, a = (vy * sw + ux) * 4, b = a + 4, c = a + sw * 4, d = c + 4, o = (y * ow + x) * 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    // 투명한 가장자리에서 색이 번지지 않게 알파를 곱해서 섞어요
    const A = S[a + 3] * w00 + S[b + 3] * w10 + S[c + 3] * w01 + S[d + 3] * w11;
    if (A < 0.5) { O[o] = O[o + 1] = O[o + 2] = O[o + 3] = 0; continue; }
    for (let ch = 0; ch < 3; ch++) O[o + ch] = (S[a + ch] * S[a + 3] * w00 + S[b + ch] * S[b + 3] * w10 + S[c + ch] * S[c + 3] * w01 + S[d + ch] * S[d + 3] * w11) / A;
    O[o + 3] = A;
  }
  return out;
}

const MODES = [['push', '밀기', '끄는 쪽으로 그림을 밀어요.'], ['bloat', '부풀리기', '누르고 있는 곳이 커져요.'], ['pinch', '오므리기', '누르고 있는 곳이 작아져요.'], ['restore', '되돌리기', '문지른 곳을 원래대로 돌려요.']];
async function open() {
  const l = layerOf(); if (!l) return;
  const bmp = await ensureBitmap(l.mediaId), W = bmp.width, H = bmp.height, m = state.project.media.find(x => x.id === l.mediaId);
  const full = document.createElement('canvas'); full.width = W; full.height = H; const fg = full.getContext('2d', { willReadFrequently: true }); fg.drawImage(bmp, 0, 0);
  const pk = Math.min(1, 640 / Math.max(W, H)), pw = Math.max(1, Math.round(W * pk)), ph = Math.max(1, Math.round(H * pk));
  const small = document.createElement('canvas'); small.width = pw; small.height = ph; const sg = small.getContext('2d', { willReadFrequently: true }); sg.imageSmoothingQuality = 'high'; sg.drawImage(bmp, 0, 0, pw, ph);
  const srcS = sg.getImageData(0, 0, pw, ph), F = makeField(W, H), O = { mode: 'push', size: Math.round(Math.max(W, H) / 8), power: 60 };
  const view = h('canvas.liq-view', { width: pw, height: ph, 'aria-label': '뒤틀 그림' }), vg = view.getContext('2d'), outS = vg.createImageData(pw, ph);
  let cursor = null, dirty = false, raf = 0, timer = 0;
  const paint = () => { raf = 0; vg.putImageData(warp(F, srcS, outS), 0, 0); if (cursor) { vg.strokeStyle = '#fff'; vg.lineWidth = 1; vg.beginPath(); vg.arc(cursor.x * pk, cursor.y * pk, O.size * pk, 0, Math.PI * 2); vg.stroke(); vg.strokeStyle = 'rgba(0,0,0,.6)'; vg.beginPath(); vg.arc(cursor.x * pk, cursor.y * pk, O.size * pk + 1, 0, Math.PI * 2); vg.stroke(); } };
  const ask = () => { if (!raf) raf = requestAnimationFrame(paint); };
  const at = e => { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  view.addEventListener('pointermove', e => { if (!e.buttons) { cursor = at(e); ask(); } });
  view.addEventListener('pointerleave', () => { cursor = null; ask(); });
  view.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); view.setPointerCapture(e.pointerId);
    let last = at(e); cursor = last; dirty = true;
    const hold = () => { if (O.mode !== 'push') { stroke(F, O.mode, last.x, last.y, O.size, O.power / 100, 0, 0); ask(); } };
    hold(); timer = setInterval(hold, 40);
    const move = ev => { const p = at(ev); if (O.mode === 'push') stroke(F, 'push', p.x, p.y, O.size, O.power / 100, p.x - last.x, p.y - last.y); last = p; cursor = p; ask(); };
    const up = () => { clearInterval(timer); view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); view.removeEventListener('pointercancel', up); };
    view.addEventListener('pointermove', move); view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  });
  const modes = h('div.seg', { role: 'radiogroup', 'aria-label': '붓 종류' });
  const drawModes = () => modes.replaceChildren(...MODES.map(([v, t, d]) => h('button' + (O.mode === v ? '.on' : ''), { title: d, role: 'radio', 'aria-checked': String(O.mode === v), onclick: () => { O.mode = v; drawModes(); } }, t)));
  drawModes();
  const rng = (label, k, min, max) => h('label.field', null, h('span.field-name.w', null, label), h('input.range', { type: 'range', min, max, value: O[k], 'aria-label': label, oninput: e => { O[k] = +e.target.value; } }));
  const apply = async () => {
    if (!dirty) return;
    const b = busy('뒤튼 그림을 만드는 중이에요.');
    try {
      await new Promise(r => setTimeout(r, 30));
      const out = warp(F, fg.getImageData(0, 0, W, H), fg.createImageData(W, H)); fg.putImageData(out, 0, 0);
      const nm = await addMedia(new File([await new Promise(r => full.toBlob(r, 'image/png'))], `${m.name.replace(/\.[a-z0-9]+$/i, '')} 뒤틀기.png`, { type: 'image/png' }), m.folder || null, { hidden: true });
      await ensureBitmap(nm.id); l.mediaId = nm.id; commit('뒤틀기');
    } catch (e) { toast('뒤틀기: ' + (e.message || '실패했어요'), 'err'); }
    finally { b.done(); }
  };
  dialog({ title: '뒤틀기', wide: true, onClose: () => { clearInterval(timer); cancelAnimationFrame(raf); },
    body: h('div.liq', null, h('div.liq-stage', null, view),
      h('div.liq-side', null, modes, rng('붓 크기', 'size', 8, Math.round(Math.max(W, H) / 2)), rng('세기', 'power', 5, 100),
        h('button.btn.small', { onclick: () => { F.dx.fill(0); F.dy.fill(0); dirty = false; ask(); } }, '처음으로'),
        h('p.dlg-text', null, '그림 위를 끌어서 모양을 바꿔요. 부풀리기와 오므리기는 누르고 있는 동안 계속 돼요.'))),
    buttons: [{ label: '취소' }, { label: '이대로 바꾸기', primary: true, run: () => { apply(); } }] });
  paint();
}

export function registerLiquify() {
  addCmd({ id: 'layer.liquify', title: '뒤틀기…', menu: '레이어', group: 'warp', words: '리퀴파이 liquify 픽셀 유동화 변형', enabled: () => !!layerOf() && !layerOf().locked, run: open });
}
