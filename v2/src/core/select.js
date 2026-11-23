// 고르는 도구가 만드는 '고른 곳'. 그림판마다 하나, 그림판과 같은 크기의 가림막(흰 곳 = 고른 곳)이에요.
// 사각형·타원·올가미·비슷한 색·마법 붓이 모두 이 가림막 하나를 고쳐요. 다른 작업실(캐릭터 나누기 등)도 이걸 그대로 써요.
import { emit } from './store.js';

export const sel = { id: null, w: 0, h: 0, cv: null, any: false, rev: 0 };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export function selFor(c) {
  if (!c) { sel.id = null; sel.cv = null; sel.any = false; return sel; }
  if (sel.id !== c.id || sel.w !== c.w || sel.h !== c.h) { sel.id = c.id; sel.w = c.w; sel.h = c.h; sel.cv = mk(c.w, c.h); sel.any = false; sel.rev++; }
  return sel;
}
const ctx = () => sel.cv.getContext('2d', { willReadFrequently: true });
function touched() {
  // 고른 곳이 하나라도 남았는지 (작게 줄여서 빠르게 봄)
  const t = mk(64, 64), g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(sel.cv, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data; let any = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { any = true; break; }
  sel.any = any; sel.rev++; emit();
}
// op: 'new' 새로 고르기, 'add' 더하기(Shift), 'sub' 빼기(Alt)
function apply(op, drawShape) {
  const g = ctx();
  if (op === 'new') g.clearRect(0, 0, sel.w, sel.h);
  g.save(); g.globalCompositeOperation = op === 'sub' ? 'destination-out' : 'source-over'; g.fillStyle = '#fff';
  drawShape(g); g.restore(); touched();
}
export const selRect = (op, x, y, w, h) => apply(op, g => g.fillRect(x, y, w, h));
export const selEllipse = (op, x, y, w, h) => apply(op, g => { g.beginPath(); g.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); g.fill(); });
export const selPoly = (op, pts) => apply(op, g => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath(); g.fill(); });
export const selMask = (op, maskCanvas) => apply(op, g => g.drawImage(maskCanvas, 0, 0, sel.w, sel.h));
export function selNone() { if (!sel.cv) return; ctx().clearRect(0, 0, sel.w, sel.h); touched(); }
export function selAll() { if (!sel.cv) return; const g = ctx(); g.fillStyle = '#fff'; g.fillRect(0, 0, sel.w, sel.h); touched(); }
export function selInvert() {
  if (!sel.cv) return;
  const g = ctx(); g.save(); g.globalCompositeOperation = 'source-out'; g.fillStyle = '#fff'; g.fillRect(0, 0, sel.w, sel.h); g.restore(); touched();
}
// 가장자리를 px만큼 넓히거나(+) 좁혀요(-)
export function selGrow(px) {
  if (!sel.cv || !sel.any || !px) return;
  const t = mk(sel.w, sel.h), g = t.getContext('2d'), r = Math.abs(px);
  if (px > 0) { g.filter = `blur(${r / 2}px)`; g.drawImage(sel.cv, 0, 0); g.filter = 'none'; }
  else { g.fillStyle = '#fff'; g.fillRect(0, 0, sel.w, sel.h); g.globalCompositeOperation = 'destination-out'; g.filter = `blur(${r / 2}px)`; g.drawImage(sel.cv, 0, 0); g.filter = 'none'; }
  // 번진 값을 다시 또렷하게: 넓힐 때는 조금이라도 닿은 곳, 좁힐 때는 바깥이 조금이라도 닿은 곳을 뺌
  const id = g.getImageData(0, 0, sel.w, sel.h), d = id.data;
  for (let i = 3; i < d.length; i += 4) { const on = px > 0 ? d[i] > 12 : d[i] < 12; d[i - 3] = d[i - 2] = d[i - 1] = 255; d[i] = on ? 255 : 0; }
  g.putImageData(id, 0, 0);
  const s = ctx(); s.clearRect(0, 0, sel.w, sel.h); s.drawImage(t, 0, 0); touched();
}
export function selBounds() {
  if (!sel.cv || !sel.any) return null;
  const d = ctx().getImageData(0, 0, sel.w, sel.h).data; let x0 = sel.w, y0 = sel.h, x1 = -1, y1 = -1;
  for (let y = 0; y < sel.h; y++) for (let x = 0; x < sel.w; x++) if (d[(y * sel.w + x) * 4 + 3] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---- 그림을 보고 고르기 (비슷한 색, 마법 붓) ----
// 계산은 긴 쪽 1280까지 줄인 그림으로 해요. img = 그림판을 그대로 그린 캔버스
function work(img) {
  const s = Math.min(1, 1280 / Math.max(img.width, img.height)), W = Math.max(1, Math.round(img.width * s)), H = Math.max(1, Math.round(img.height * s));
  const c = mk(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, H);
  return { s, W, H, d: g.getImageData(0, 0, W, H).data };
}
function maskFrom(on, W, H) {
  const c = mk(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
  for (let i = 0; i < on.length; i++) if (on[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  // 줄인 크기에서 만든 가림막을 키울 때 계단이 지지 않게 살짝 번졌다가 다시 또렷하게
  return c;
}
const diff = (d, i, r, g, b, a) => Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(d[i + 3] - a));

// 비슷한 색: 누른 곳과 색이 비슷한 곳. tol 0~100, contiguous면 이어진 곳만
export function selWand(op, img, x, y, tol = 20, contiguous = true) {
  const { s, W, H, d } = work(img), X = Math.min(W - 1, Math.max(0, Math.round(x * s))), Y = Math.min(H - 1, Math.max(0, Math.round(y * s)));
  const j = (Y * W + X) * 4, r = d[j], g = d[j + 1], b = d[j + 2], a = d[j + 3], T = tol * 2.55, on = new Uint8Array(W * H);
  if (!contiguous) { for (let i = 0; i < W * H; i++) if (diff(d, i * 4, r, g, b, a) <= T) on[i] = 1; }
  else {
    const st = [Y * W + X]; on[Y * W + X] = 1;
    while (st.length) {
      const p = st.pop(), px = p % W, py = (p - px) / W;
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx; if (on[q] || diff(d, q * 4, r, g, b, a) > T) continue;
        on[q] = 1; st.push(q);
      }
    }
  }
  selMask(op, maskFrom(on, W, H));
}

const NB = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [1, 1, 1.414]];
// 마법 붓: 그은 자리에서 옆으로 번지되, 색이 확 바뀌는 곳(선·경계)은 넘지 못해요.
// pts = 그은 점들(그림판 좌표), size = 붓 굵기(그림판 px), spread 0~100 = 얼마나 멀리 번질지
export function selMagic(op, img, pts, size = 28, spread = 35) {
  const { s, W, H, d } = work(img), N = W * H, rw = Math.max(1.5, size / 2 * s), t = spread / 100;
  // 선 지도: 이웃과의 색 차이
  const edge = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = (y * W + x) * 4; let m = 0;
    for (let k = 0; k < 4; k++) { const gx = Math.abs(d[i + 4 + k] - d[i - 4 + k]), gy = Math.abs(d[i + W * 4 + k] - d[i - W * 4 + k]); if (gx > m) m = gx; if (gy > m) m = gy; }
    edge[y * W + x] = Math.min(1, Math.max(0, (m - 18) / 110));
  }
  // 그은 선을 씨앗으로, 그은 곳의 색들을 '고를 색'으로
  const sc = mk(W, H), sg = sc.getContext('2d', { willReadFrequently: true });
  sg.strokeStyle = sg.fillStyle = '#fff'; sg.lineCap = sg.lineJoin = 'round'; sg.lineWidth = rw * 2;
  sg.beginPath(); pts.forEach((p, i) => i ? sg.lineTo(p.x * s, p.y * s) : sg.moveTo(p.x * s, p.y * s));
  if (pts.length === 1) { sg.arc(pts[0].x * s, pts[0].y * s, rw, 0, Math.PI * 2); sg.fill(); } else sg.stroke();
  const sd = sg.getImageData(0, 0, W, H).data, proto = [];
  for (const p of pts) {
    const X = Math.min(W - 1, Math.max(0, Math.round(p.x * s))), Y = Math.min(H - 1, Math.max(0, Math.round(p.y * s))), i = (Y * W + X) * 4;
    if (proto.length < 24 && proto.every(q => diff(d, i, q[0], q[1], q[2], q[3]) > 14)) proto.push([d[i], d[i + 1], d[i + 2], d[i + 3]]);
  }
  const far = i => { let m = 255; for (const q of proto) { const v = diff(d, i * 4, q[0], q[1], q[2], q[3]); if (v < m) m = v; } return m; };
  // 가까운 것부터 번지기 (값이 작은 칸부터). 한 칸 값 = 기본 + 선을 넘는 값 + 고른 색과 다른 정도
  const budget = rw * (2.5 + 9 * t) + (0.03 + 0.4 * t * t) * Math.max(W, H), colTol = 26 + 60 * t;
  const dist = new Float32Array(N).fill(Infinity), B = Math.ceil(budget) + 2, bk = Array.from({ length: B }, () => []);
  for (let i = 0; i < N; i++) if (sd[i * 4 + 3] > 127) { dist[i] = 0; bk[0].push(i); }
  for (let b = 0; b < B; b++) {
    const q = bk[b];
    for (let k = 0; k < q.length; k++) {
      const p = q[k]; if (Math.floor(dist[p]) !== b) continue;
      const px = p % W, py = (p - px) / W;
      for (const [ox, oy, step] of NB) {
        const nx = px + ox, ny = py + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx, e = edge[n], f = far(n);
        if (f > colTol * 1.6) continue;
        const nd = dist[p] + step + e * e * budget * 1.4 + Math.max(0, f - colTol * 0.4) / colTol * 3;
        if (nd < dist[n] && nd <= budget) { dist[n] = nd; const bi = Math.floor(nd); if (bi < B) (bi === b ? q : bk[bi]).push(n); }
      }
    }
  }
  const on = new Uint8Array(N); for (let i = 0; i < N; i++) if (dist[i] <= budget) on[i] = 1;
  selMask(op, maskFrom(on, W, H));
}
