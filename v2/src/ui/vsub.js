// 영상 자막 번역: 영상에 박혀 있는 자막(따로 꺼낼 수 없는 자막)을 읽어 번역 자막으로
import * as MB from 'mediabunny';
import { generate, ready } from '../api/gemini.js';
import { settings } from '../core/settings.js';
import { addCmd } from '../core/cmd.js';
import { download } from '../core/files.js';
import { toast as say, confirmBox } from './overlay.js';

const $ = (q, r = document) => r.querySelector(q), $$ = (q, r = document) => [...r.querySelectorAll(q)];
const uid = () => Math.random().toString(36).slice(2, 10), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), r2 = v => Math.round(v * 100) / 100;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const safeName = s => (String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || '영상');
const toast = (m, kind) => say(m, typeof kind === 'string' ? kind : '');
const trErr = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
const askYes = q => confirmBox('확인', q, '계속');
const appApi = () => { const T = window.__TAURI__; return T && T.dialog && T.fs ? T : null; };
const gsSeek = (v, t) => new Promise(res => { let done = false; const ok = () => { if (!done) { done = true; res(); } }; v.addEventListener('seeked', ok, { once: true }); setTimeout(ok, 3000); v.currentTime = t; });
const TR_LN = { ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English' };
function trJson(t) {
  t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (_) { /* 아래에서 다시 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* 아래에서 다시 */ } }
  const m = t.lastIndexOf('},'); if (a >= 0 && m > a) { try { return JSON.parse(t.slice(a, m + 1) + ']}'); } catch (_) { /* 못 읽음 */ } }
  return null;
}
const vsOff = {}; // 이 모델이 안 받는 선택 항목
// 흐름: ① 영상을 이 컴퓨터에서 빠르게 돌려 보며 자막 자리(아래쪽 띠)에서 '가만히 있는 밝은 글자 획'만 따요
//       ② 글자 획 둘레만 남긴 흑백 조각(나머지 화면은 지워요)을 번호를 붙여 한 장에 모아 제미나이가 읽어요
//       ③ 읽은 글만 제미나이가 번역 → 시간에 맞춰 영상 위에 보여 주고, SRT·ASS 자막이나 자막을 입힌 MP4로 저장
// 영상 장면 자체는 어디로도 보내지 않아요. 그래서 어떤 장면이 나오든 자막 글자만 보고 번역해요.
const VS_SRC = [['auto', '자동으로 알아내기'], ['ja', '일본어'], ['en', '영어'], ['zh', '중국어'], ['ko', '한국어']];
const VS_DST = [['ko', '한국어'], ['en', '영어'], ['ja', '일본어'], ['zh', '중국어']];
const VS_FONT = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif';
const vsCfg = { src: 'auto', dst: 'ko', fps: 4, x0: 4, x1: 96, y0: 68, y1: 98, dark: false, cover: true, gloss: '', notes: '', bitrate: 0 };
try { Object.assign(vsCfg, JSON.parse(localStorage.getItem('potato2VsCfg') || '{}')); } catch (_) { }
const vsSaveCfg = () => { try { localStorage.setItem('potato2VsCfg', JSON.stringify(vsCfg)); } catch (_) { } };
const vs = { built: false, file: null, url: '', W: 0, H: 0, D: 0, key: '', lines: [], scanned: false, busy: false, tk: null, cur: -2, raf: 0, from: '', to: '', msg: '', frac: 0, drop: 0 };
const vsClock = (t, ms) => { t = Math.max(0, t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = Math.floor(t) % 60, p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : m) + ':' + p(s) + (ms ? '.' + String(Math.floor(t * 10) % 10) : ''); };
const vsParseT = s => { s = String(s || '').trim(); if (!s) return null; const p = s.split(':').map(Number); if (p.some(x => !isFinite(x))) return null; return p.reduce((a, x) => a * 60 + x, 0); };

/* ---- ① 자막 찾기: 글자 획 후보 → 가만히 있는 것만 → 구간 나누기 ---- */
// 밝고(165↑) 바로 옆(r칸 안)에 훨씬 어두운 곳이 있는 칸 = 테두리·그림자가 있는 글자 획. V = 밝기(색 있는 자막도 잡게 R·G·B 중 큰 값)
function vsMask(V, W, H, r, M, tmp) {
  const N = W * H, a = tmp.a, b = tmp.b;
  for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) { let m = 255; const k1 = x + r >= W ? W - 1 : x + r; for (let k = x - r < 0 ? 0 : x - r; k <= k1; k++) { const v = V[o + k]; if (v < m) m = v; } a[o + x] = m; } }
  for (let y = 0; y < H; y++) { const k0 = y - r < 0 ? 0 : y - r, k1 = y + r >= H ? H - 1 : y + r, o = y * W; for (let x = 0; x < W; x++) { let m = 255; for (let k = k0; k <= k1; k++) { const v = a[k * W + x]; if (v < m) m = v; } b[o + x] = m; } }
  let n = 0; for (let i = 0; i < N; i++) { const v = V[i], on = v >= 165 && v - b[i] >= 85 ? 1 : 0; M[i] = on; n += on; }
  return n;
}
// 장면은 조금씩 바뀌지만 자막 한 줄은 모든 획이 '같은 순간에 나타나서 같은 순간에 사라져요'.
// 칸마다 획이 켜진 때·꺼진 때를 적어 두었다가, 켜진 때와 꺼진 때가 같은 칸이 한 무더기 나오면 그게 자막 한 줄이에요.
function vsTracker(W, H, onSeg) {
  const N = W * H, minPix = Math.max(40, Math.round(N * 0.0004)), maxPix = N * 0.25, RING = 64;
  const birth = new Int32Array(N).fill(-1), miss = new Uint8Array(N), rv = new Uint8Array(N), rm = new Uint8Array(N), T = [], ring = [], dead = new Map(); // dead: 마지막으로 켜져 있던 장면 번호 → { i: [칸], b: [켜진 장면 번호] }
  let s = -1;
  const die = (i, d) => { const b = birth[i]; birth[i] = -1; if (d - b < 1) return; let L = dead.get(d); if (!L) dead.set(d, L = { i: [], b: [] }); L.i.push(i); L.b.push(b); };
  const settle = D => { // D번째 장면에서 꺼진 칸들(앞뒤 한 장면 포함)을 켜진 때별로 모아 보기
    const Ls = [dead.get(D - 1), dead.get(D), dead.get(D + 1)]; if (!Ls[1] || !Ls[1].i.length) return;
    const h = new Map(); for (const L of Ls) if (L) for (const b of L.b) if (b >= 0) h.set(b, (h.get(b) || 0) + 1);
    const C = b => (h.get(b - 1) || 0) + (h.get(b) || 0) + (h.get(b + 1) || 0);
    const peaks = [...h.keys()].map(b => [C(b), b]).filter(x => x[0] >= minPix).sort((x, y) => y[0] - x[0]), used = new Set();
    for (const [c, b] of peaks) {
      if (used.has(b - 1) || used.has(b) || used.has(b + 1) || used.has(b - 2) || used.has(b + 2)) continue;
      let bg = 0; for (const o of [-6, -5, -4, 4, 5, 6]) bg += C(b + o); bg /= 6; // 둘레의 평소 양보다 뚜렷이 많아야
      if (c < bg * 2.5 + minPix * 0.5 || c > maxPix) continue;
      const n = Ls.map(L => { let k = 0; if (L) for (const x of L.b) if (x >= b - 1 && x <= b + 1) k++; return k; });
      if (n[1] < n[0] || n[1] < n[2]) continue; // 꺼진 때의 한가운데가 아니면 다음 차례에
      used.add(b);
      const core = new Uint8Array(N); let k = 0;
      for (const L of Ls) if (L) for (let j = 0; j < L.i.length; j++) if (L.b[j] >= b - 1 && L.b[j] <= b + 1) { core[L.i[j]] = 1; L.b[j] = -9; k++; }
      // 그림: 이 구간의 앞·가운데·뒤 장면 가운데 가장 어두운 값 (움직이는 장면은 어두워지고 자막은 그대로 남아요)
      const pick = [...new Set([b + 1, (b * 3 + D) >> 2, (b + D) >> 1, (b + D * 3) >> 2, D - 1].map(x => clamp(x, Math.max(b, s - RING + 1), D)))].map(x => ring[x % RING]).filter(Boolean);
      if (!pick.length) continue;
      const img = new Uint8Array(pick[0]); for (let q = 1; q < pick.length; q++) { const o = pick[q]; for (let i = 0; i < N; i++) if (o[i] < img[i]) img[i] = o[i]; }
      const b0 = b > 0 && (h.get(b - 1) || 0) >= (h.get(b) || 0) * 0.3 ? b - 1 : (h.get(b) || 0) >= (h.get(b + 1) || 0) * 0.3 ? b : b + 1; // 무더기에서 가장 먼저 켜진 때
      const gap = clamp(b0 > 0 ? T[b0] - T[b0 - 1] : 0.1, 0.02, 0.3), gap2 = clamp(D + 1 < T.length ? T[D + 1] - T[D] : 0.1, 0.02, 0.3);
      onSeg({ t0: Math.max(0, T[b0] - gap / 2), t1: T[D] + gap2 / 2, n: D - b + 1, core, img });
    }
  };
  return {
    push(V, M, t, Lo) { // Lo = 칸 둘레에서 가장 어두운 값 (vsMask가 구해 둔 것)
      s++; T[s] = t; ring[s % RING] = V;
      for (let i = 0; i < N; i++) {
        if (M[i]) {
          // 같은 획인지: 밝기와 둘레 어두운 값이 처음 그대로여야 해요 (밝은 장면 위에 자막이 새로 얹히면 여기서 새 획으로 갈려요)
          if (birth[i] >= 0) { const dv = V[i] - rv[i], dm = Lo[i] - rm[i]; if (dv > 26 || dv < -26 || dm > 44 || dm < -44) die(i, s - 1 - miss[i]); }
          if (birth[i] < 0) { birth[i] = s; rv[i] = V[i]; rm[i] = Lo[i]; }
          miss[i] = 0;
        } else if (birth[i] >= 0 && ++miss[i] > 1) die(i, s - 2); // 한 장면쯤 깜빡이는 건 봐줘요
      }
      if (s >= 4) { settle(s - 4); dead.delete(s - 6); }
    },
    end() {
      for (let i = 0; i < N; i++) if (birth[i] >= 0) die(i, s - miss[i]);
      for (let D = Math.max(0, s - 4); D <= s; D++) settle(D);
    },
  };
}
// 자막 한 구간 → 글자 둘레만 남긴 흑백 조각 + 화면 속 자리. R = 자막 띠가 영상에서 차지하는 자리(영상 픽셀), k = 띠를 줄인 비율
function vsStrip(seg, W, H, R, k, r, tmp) {
  const N = W * H, c = seg.core, img = seg.img, m0 = new Uint8Array(N), m = new Uint8Array(N);
  vsMask(img, W, H, r, m0, tmp); // 구간 내내 가장 어두웠던 값으로 한 번 더 (움직이는 장면은 여기서 빠져요)
  const all = new Uint8Array(m0); // 구간 내내 글자처럼 보인 칸 모두 (밝은 장면 위에 얹혀서 '같이 켜진 무더기'에 못 든 획까지)
  for (let i = 0; i < N; i++) m0[i] &= c[i];
  // 이어진 덩어리 가운데 글자 획만 한 것만 남겨요 (점 같은 잡티, 화면을 덮는 큰 무늬는 빼요)
  const lab = new Uint8Array(N), st = [], hMin = Math.max(4, H * 0.035), hMax = H * 0.55, wMax = W * 0.35; let cnt = 0;
  for (let s = 0; s < N; s++) {
    if (!m0[s] || lab[s]) continue;
    lab[s] = 1; st.length = 0; st.push(s); const px = []; let x0 = W, x1 = -1, y0 = H, y1 = -1;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0; px.push(i);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (m0[j] && !lab[j]) { lab[j] = 1; st.push(j); } }
    }
    const ch = y1 - y0 + 1, cw = x1 - x0 + 1;
    if (px.length >= 6 && ch >= hMin && ch <= hMax && cw <= wMax) { for (const i of px) m[i] = 1; cnt += px.length; }
  }
  const need = Math.max(30, N * 0.0003); if (cnt < need) return null;
  // 글자는 한두 줄에 촘촘히 모여 있어요. 글줄(획이 많은 가로줄)과 그 줄에서 이어진 가로 범위만 남기고, 멀리 흩어진 장면 무늬는 버려요
  const rows = new Uint32Array(H), cols = new Uint32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) rows[y]++;
  let pk = 0; const sm = y => rows[y] + (y > 0 ? rows[y - 1] : 0) + (y < H - 1 ? rows[y + 1] : 0);
  for (let y = 0; y < H; y++) pk = Math.max(pk, sm(y));
  const band = new Uint8Array(H), bp0 = Math.ceil(hMin);
  for (let y = 0; y < H; y++) if (sm(y) >= pk * 0.2) for (let q = Math.max(0, y - bp0); q <= Math.min(H - 1, y + bp0); q++) band[q] = 1;
  for (let y = 0; y < H; y++) { if (!band[y]) { m.fill(0, y * W, y * W + W); continue; } for (let x = 0; x < W; x++) if (m[y * W + x]) cols[x]++; }
  { // 가로로 끊긴 덩어리: 가장 큰 것과 그 1/4 넘는 것만
    const G = Math.max(30, H * 0.35), runs = []; let st2 = -1, last = -1e9, mass = 0;
    for (let x = 0; x < W; x++) { const c2 = cols[x]; if (!c2) continue; if (st2 < 0 || x - last > G) { if (st2 >= 0) runs.push([st2, last, mass]); st2 = x; mass = 0; } last = x; mass += c2; }
    if (st2 >= 0) runs.push([st2, last, mass]);
    const top = Math.max(0, ...runs.map(q => q[2]));
    for (const [a2, b2, ms] of runs) if (ms < top * 0.25) { for (let y = 0; y < H; y++) if (band[y]) m.fill(0, y * W + a2, y * W + b2 + 1); for (let x = a2; x <= b2; x++) cols[x] = 0; }
    rows.fill(0); cnt = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { rows[y]++; cnt++; }
  }
  if (cnt < need || cnt > N * 0.09) return null; // 글자라기엔 너무 넓게 덮인 것도 빼요
  let y0 = 0, y1 = H - 1, x0 = 0, x1 = W - 1;
  while (y0 < y1 && rows[y0] < 2) y0++; while (y1 > y0 && rows[y1] < 2) y1--;
  while (x0 < x1 && !cols[x0]) x0++; while (x1 > x0 && !cols[x1]) x1--;
  if (cnt / ((y1 - y0 + 1) * (x1 - x0 + 1)) < 0.02) return null;
  { // 찾은 자리 안에서는 구간 내내 글자처럼 보인 칸을 모두 써요 (글자 획 크기인 덩어리만)
    const ex = Math.round(H * 0.06), bx0 = Math.max(0, x0 - ex * 2), bx1 = Math.min(W - 1, x1 + ex * 2), by0 = Math.max(0, y0 - ex), by1 = Math.min(H - 1, y1 + ex); lab.fill(0);
    for (let s = 0; s < N; s++) {
      if (!all[s] || lab[s]) continue; const sx0 = s % W, sy0 = (s / W) | 0; if (sx0 < bx0 || sx0 > bx1 || sy0 < by0 || sy0 > by1) continue;
      lab[s] = 1; st.length = 0; st.push(s); const px = []; let cx0 = W, cx1 = -1, cy0 = H, cy1 = -1;
      while (st.length) {
        const i = st.pop(), x = i % W, y = (i / W) | 0; px.push(i);
        if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (all[j] && !lab[j]) { lab[j] = 1; st.push(j); } }
      }
      if (px.length >= 3 && cy1 - cy0 + 1 <= hMax && cx1 - cx0 + 1 <= wMax && cx0 >= bx0 && cx1 <= bx1 && cy0 >= by0 && cy1 <= by1) for (const i of px) m[i] = 1;
    }
    x0 = W; x1 = -1; y0 = H; y1 = -1; for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  // 글자 둘레로 넓히기: 옆으로는 더 넓게 (작은 문장 부호·탁점이 같이 들어오게). 넓힌 자리 안의 원래 후보 획은 다시 살려요
  const rd = Math.max(3, Math.round(H * 0.04)), rx = rd * 3, pad = rd + 2, t = new Uint8Array(N);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= rx) t[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= rx) t[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (t[y * W + x]) last = y; if (y - last <= rd) m[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) last = y; if (last - y <= rd) m[y * W + x] = 1; } }
  const sx = Math.max(0, x0 - rx - 2), sy = Math.max(0, y0 - pad), sw = Math.min(W, x1 + rx + 3) - sx, sh = Math.min(H, y1 + pad + 1) - sy, data = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (sy + y) * W + sx + x; data[y * sw + x] = m[i] ? img[i] : 24; }
  const bp = Math.max(2, (y1 - y0) * 0.1);
  return { strip: { w: sw, h: sh, data }, box: { x: R.x + (x0 - bp) / k, y: R.y + (y0 - bp) / k, w: (x1 - x0 + 1 + bp * 2) / k, h: (y1 - y0 + 1 + bp * 2) / k } };
}
const vsRegion = () => { const x = Math.round(vs.W * vsCfg.x0 / 100), y = Math.round(vs.H * vsCfg.y0 / 100); return { x, y, w: Math.max(16, Math.round(vs.W * vsCfg.x1 / 100) - x), h: Math.max(8, Math.round(vs.H * vsCfg.y1 / 100) - y) }; };
// 영상을 빠르게 돌려 보며(안 되면 한 장씩 넘기며) 자막 구간을 모아요
async function vsScan(tk) {
  const v = $('#vsVideo'), R = vsRegion(), k = Math.min(1, 960 / R.w), W = Math.max(16, Math.round(R.w * k)), H = Math.max(8, Math.round(R.h * k)), N = W * H;
  const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }), tmp = { a: new Uint8Array(N), b: new Uint8Array(N) }, r = Math.max(2, Math.round(H * 0.02)), dark = vsCfg.dark;
  const t0 = clamp(vsParseT(vs.from) || 0, 0, Math.max(0, vs.D - 1)), t1 = clamp(vsParseT(vs.to) || vs.D, t0 + 0.5, vs.D), want = 1 / clamp(+vsCfg.fps || 4, 1, 10);
  let found = 0;
  const tr = vsTracker(W, H, seg => {
    if (seg.t1 - seg.t0 < 0.3) return;
    const s = vsStrip(seg, W, H, R, k, r, tmp); if (!s) return;
    vs.lines.push({ id: uid(), t0: seg.t0, t1: seg.t1, box: s.box, strip: s.strip }); found++;
  });
  let last = -1, rate = 6;
  const take = t => {
    if (t - last < want * 0.7) return; last = t;
    g.drawImage(v, R.x, R.y, R.w, R.h, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data, V = new Uint8Array(N), M = new Uint8Array(N);
    if (dark) for (let i = 0, j = 0; i < N; i++, j += 4) { const a = d[j], b = d[j + 1], e = d[j + 2]; V[i] = 255 - (a < b ? (a < e ? a : e) : (b < e ? b : e)); }
    else for (let i = 0, j = 0; i < N; i++, j += 4) { const a = d[j], b = d[j + 1], e = d[j + 2]; V[i] = a > b ? (a > e ? a : e) : (b > e ? b : e); }
    vsMask(V, W, H, r, M, tmp); tr.push(V, M, t, tmp.b);
  };
  const say = (t, how) => tk.set(`① 자막 찾는 중… ${vsClock(t)} / ${vsClock(t1)} · 찾은 자막 조각 ${found}개${how ? ' · ' + how : ''}`, (t - t0) / Math.max(0.1, t1 - t0) * 0.5);
  v.pause(); v.muted = true; v.controls = false;
  await gsSeek(v, t0);
  let at = t0;
  try {
    if (v.requestVideoFrameCallback) { // 빨리 감기로 보기 (화면에 그려지는 장면마다 한 번)
      at = await new Promise((res, rej) => {
        let ema = want, n = 0, lastMt = t0, seen = performance.now(), done = false, hung = 0;
        const fin = (x, err) => { if (done) return; done = true; clearInterval(iv); v.pause(); v.playbackRate = 1; v.removeEventListener('ended', onEnd); err ? rej(err) : res(x); };
        const onEnd = () => fin(t1);
        const iv = setInterval(() => {
          if (tk.stop) return fin(0, trErr('stop'));
          if (performance.now() - seen > 2500) { // 장면이 안 넘어와요 (창이 가려졌거나 멈춤) → 한 장씩 넘기기로
            if (v.paused && !v.ended && hung++ < 2) { v.play().catch(() => { }); seen = performance.now(); return; }
            fin(-lastMt - 1);
          }
        }, 400);
        const cb = (now, meta) => {
          if (done) return;
          const mt = meta.mediaTime; seen = performance.now();
          if (mt >= t1) return fin(t1);
          if (mt > lastMt) { ema = ema * 0.8 + (mt - lastMt) * 0.2; lastMt = mt; }
          try { take(mt); } catch (e) { return fin(0, e); }
          if (++n % 6 === 0) { // 놓치는 장면이 많으면 천천히, 여유 있으면 빠르게 (최대 16배속)
            if (ema > want * 1.15 && rate > 1) rate = Math.max(1, rate * 0.75); else if (ema < want * 0.8 && rate < 16) rate = Math.min(16, rate * 1.1);
            v.playbackRate = rate; say(mt, `${rate.toFixed(rate < 10 ? 1 : 0)}배속`);
          }
          v.requestVideoFrameCallback(cb);
        };
        v.addEventListener('ended', onEnd);
        v.playbackRate = rate; v.requestVideoFrameCallback(cb);
        v.play().catch(() => fin(-t0 - 1));
      });
    } else at = -t0 - 1;
    if (at < 0) { // 한 장씩 넘겨 가며 보기
      for (let t = Math.max(t0, -at - 1); t < t1; t += want) {
        if (tk.stop) throw trErr('stop');
        await gsSeek(v, t); take(t); if (Math.round(t / want) % 8 === 0) say(t, '한 장씩 넘기는 중');
      }
    }
    tr.end();
  } finally { v.pause(); v.playbackRate = 1; v.controls = true; }
  vs.lines.sort((a, b) => a.t0 - b.t0);
  // 이어지는 두 자막이 우연히 같이 쓴 칸은 두 자막에 걸친 긴 조각으로 따로 잡혀요. 그런 조각은 빼요
  const L = vs.lines, hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const near = (p, q) => Math.abs(p - q) < 0.4;
  vs.lines = L.filter(X => !L.some(a => a !== X && near(a.t0, X.t0) && a.t1 < X.t1 - 0.4 && hit(a.box, X.box) && L.some(b => b !== X && b !== a && near(b.t0, a.t1) && near(b.t1, X.t1) && hit(b.box, X.box))));
}

/* ---- ② 읽기 · ③ 번역 (제미나이) ---- */
// 제미나이 통로(api/gemini.js)가 안전 설정을 끄고 성인 창작 안내문을 붙여 줘요. 여기서는 긴 작업이라 한도·끊김만 기다렸다 다시 해요
async function vsAsk(parts, schema, tk) {
  const model = settings.get('textModel');
  for (let n = 0; ; n++) {
    if (tk.stop) throw trErr('stop');
    const gc = { responseMimeType: 'application/json' };
    if (!vsOff.schema) gc.responseSchema = schema;
    if (parts.some(p => p.inlineData) && !vsOff.media) gc.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
    let r;
    try { r = await generate('translate', model, { contents: [{ role: 'user', parts }], generationConfig: gc }); }
    catch (e) {
      const d = String(e.detail || e.message || '');
      if (e.code === 'bad' && !vsOff.media && /media/i.test(d)) { vsOff.media = 1; continue; }
      if (e.code === 'bad' && !vsOff.schema && /schema|response_?mime/i.test(d)) { vsOff.schema = 1; continue; }
      if ((e.code === 'quota' || e.code === 'net' || e.code === 'http') && n < 5) { // 잠깐 기다렸다 다시
        const w = Math.min(120, 15 * Math.pow(2, n)), t0 = Date.now();
        while (Date.now() - t0 < w * 1000) { if (tk.stop) throw trErr('stop'); tk.set(`${e.code === 'quota' ? '사용량 한도에 걸려서' : '연결이 끊겨서'} ${Math.ceil(w - (Date.now() - t0) / 1000)}초 기다리는 중…`); await new Promise(res => setTimeout(res, 500)); }
        continue;
      }
      if (e.code === 'cut' || e.code === 'empty') { if (n < 1) continue; throw trErr('parse', e.message); }
      throw e;
    }
    const out = trJson(r.text);
    if (out && Array.isArray(out.items)) return out;
    if (n < 1) continue;
    throw trErr('parse', '제미나이 답을 읽지 못했어요');
  }
}
// 자막 조각들을 번호를 붙여 한 장에. hard = 글자만 흑백으로 (더 단단히 가려요)
function vsSheet(list, hard) {
  const SW = 1180, LW = 78, GAP = 10, rows = list.map(l => { const s = l.strip, k = Math.min((SW - LW - 8) / s.w, 2, 130 / s.h); return { l, w: Math.max(4, Math.round(s.w * k)), h: Math.max(4, Math.round(s.h * k)) }; });
  const c = newCanvas(SW, rows.reduce((a, r) => a + Math.max(30, r.h) + GAP, GAP)), g = c.getContext('2d'); g.fillStyle = '#18181a'; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high'; g.font = 'bold 22px sans-serif'; g.textBaseline = 'middle';
  let y = GAP;
  rows.forEach((r, i) => {
    const s = r.l.strip, t = newCanvas(s.w, s.h), tg = t.getContext('2d'), id = tg.createImageData(s.w, s.h), d = id.data;
    for (let p = 0, q = 0; p < s.data.length; p++, q += 4) { let v = s.data[p]; if (hard) v = v >= 150 ? 255 : 0; d[q] = d[q + 1] = d[q + 2] = v; d[q + 3] = 255; }
    tg.putImageData(id, 0, 0);
    const rh = Math.max(30, r.h);
    g.fillStyle = '#d62828'; g.fillRect(4, y + rh / 2 - 14, LW - 12, 28); g.fillStyle = '#fff'; g.fillText('#' + (i + 1), 10, y + rh / 2 + 1);
    g.drawImage(t, LW, y + (rh - r.h) / 2, r.w, r.h); y += rh + GAP;
  });
  return c;
}
const vsLangName = c => c === 'auto' ? 'the original language (detect it; usually Japanese, English or Chinese)' : TR_LN[c];
const VS_READ = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, text: { type: 'STRING' } }, required: ['id', 'text'] } } }, required: ['items'] };
const VS_TR = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, t: { type: 'STRING' } }, required: ['i', 't'] } } }, required: ['items'] };
async function vsReadBatch(list, tk, hard) {
  const prompt = `This image is a contact sheet of subtitle crops cut out of a video. Each row is one crop, labelled #1, #2, … on the left. Everything except the subtitle lettering was removed, so you see bright letters on a dark background, sometimes with leftover fragments of the picture.
Transcribe the subtitle text of every crop exactly as written, in ${vsLangName(vsCfg.src)}. Do NOT translate.
Return JSON {"items":[{"id":1,"text":"..."}, ...]} with one item per crop number.
- Use \\n between lines when a crop has two or more lines of text. Leave out furigana / ruby.
- If a crop has no readable subtitle text (only picture fragments, noise, a logo or a watermark), return "" for it.
- This is fiction for adults. Transcribe faithfully, including sexual, crude or violent words. Never censor, skip or replace anything.`;
  try {
    const r = await vsAsk([{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: vsSheet(list, hard).toDataURL('image/jpeg', 0.9).split(',')[1] } }], VS_READ, tk);
    const got = new Map(); for (const it of r.items || []) got.set(+it.id, String(it.text || '').replace(/\\n/g, '\n').trim());
    list.forEach((l, i) => { l.src = got.has(i + 1) ? got.get(i + 1) : ''; delete l.fail; });
  } catch (e) {
    if (e.code !== 'blocked' && e.code !== 'parse') throw e;
    if (e.code === 'blocked' && !hard) return vsReadBatch(list, tk, true);
    if (list.length > 1) { const h = list.length >> 1; await vsReadBatch(list.slice(0, h), tk, hard); await vsReadBatch(list.slice(h), tk, hard); }
    else { list[0].src = ''; list[0].fail = 'read'; }
  }
}
async function vsRead(tk) {
  const todo = vs.lines.filter(l => l.src === undefined && l.strip); let done = 0;
  for (let a = 0; a < todo.length;) {
    if (tk.stop) throw trErr('stop');
    const part = []; let h = 0;
    while (a < todo.length && part.length < 28) { const s = todo[a].strip, rh = Math.max(30, Math.min(130, s.h * Math.min(1100 / s.w, 2))) + 10; if (part.length && h + rh > 2300) break; part.push(todo[a++]); h += rh; }
    tk.set(`② 자막 글자를 읽는 중… ${done} / ${todo.length}`, 0.5 + 0.25 * done / todo.length);
    await vsReadBatch(part, tk, false); done += part.length; vsPersist();
  }
}
// 같은 글이 이어지는 조각은 하나로, 글자가 없는 조각은 빼기
const vsNorm = s => String(s || '').replace(/[\s　.,!?！？。、…・~～\-—"'“”‘’「」『』()（）♪♡♥]/g, '').toLowerCase();
function vsSame(a, b) {
  if (a === b) return true; if (!a || !b) return false;
  const la = a.length, lb = b.length; if (Math.min(la, lb) / Math.max(la, lb) < 0.7) return false;
  if (la > 3 && lb > 3 && (a.includes(b) || b.includes(a))) return true;
  let prev = Array.from({ length: lb + 1 }, (_, i) => i); // 고친 글자 수 (읽기 실수 한두 글자는 같은 글로)
  for (let i = 1; i <= la; i++) { const row = [i]; for (let j = 1; j <= lb; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = row; }
  return prev[lb] <= Math.max(1, Math.floor(Math.max(la, lb) * 0.15));
}
function vsMerge() {
  const out = [];
  for (const l of vs.lines) {
    if (l.src === undefined) { out.push(l); continue; }
    if (!l.src && !l.fail) continue;
    const p = out[out.length - 1];
    if (p && p.src && l.src && l.t0 - p.t1 < 0.7 && vsSame(vsNorm(p.src), vsNorm(l.src))) {
      if (l.src.length > p.src.length) { p.src = l.src; p.box = l.box; }
      p.t1 = Math.max(p.t1, l.t1); continue;
    }
    out.push(l);
  }
  // 화면에 오래 떠 있으면서 다른 자막 여러 줄과 겹치는 글(방송 로고·워터마크 등)은 자막이 아니라서 빼요
  for (let i = out.length - 1; i >= 0; i--) { const X = out[i]; if (X.src !== undefined && X.t1 - X.t0 > 12 && out.filter(o => o !== X && o.t0 < X.t1 && X.t0 < o.t1).length >= 3) out.splice(i, 1); }
  // 시간이 겹치는 줄: 많이 겹치면 함께 떠 있던 자막이라 한 줄로 합치고(위에 있던 것이 먼저), 조금 겹치면 앞 줄을 줄여요
  for (let i = 0; i < out.length - 1;) {
    const a = out[i], b = out[i + 1], ov = Math.min(a.t1, b.t1) - b.t0;
    if (ov <= 0 || a.src === undefined || b.src === undefined) { i++; continue; }
    const da = a.t1 - a.t0, db = b.t1 - b.t0;
    if (ov > Math.min(da, db) * 0.5 && Math.max(da, db) <= Math.min(da, db) * 4 && a.src && b.src) {
      const [p, q] = a.box.y <= b.box.y ? [a, b] : [b, a], x0 = Math.min(a.box.x, b.box.x), y0 = Math.min(a.box.y, b.box.y);
      a.src = vsNorm(p.src).includes(vsNorm(q.src)) ? p.src : vsNorm(q.src).includes(vsNorm(p.src)) ? q.src : p.src + '\n' + q.src;
      a.box = { x: x0, y: y0, w: Math.max(a.box.x + a.box.w, b.box.x + b.box.w) - x0, h: Math.max(a.box.y + a.box.h, b.box.y + b.box.h) - y0 };
      a.t1 = Math.max(a.t1, b.t1); a.ko = null; delete a.fail; out.splice(i + 1, 1);
    } else { a.t1 = Math.max(a.t0 + 0.05, b.t0); i++; }
  }
  for (const l of out) if (l.src !== undefined) delete l.strip;
  vs.lines = out;
}
async function vsTrBatch(list, ctx, tk) {
  const dst = TR_LN[vsCfg.dst] || 'Korean', gl = String(vsCfg.gloss || '').split('\n').map(s => s.trim()).filter(s => s.includes('=')).slice(0, 200);
  let p = `You are a professional subtitle translator. Translate these numbered subtitle lines of one video from ${vsLangName(vsCfg.src)} into natural, fluent ${dst} subtitles.
The lines are in order and were read from the screen by OCR, so a few characters may be wrong or missing: work out what was meant from the context, and never mention it.
Return JSON {"items":[{"i":0,"t":"..."}, ...]} with exactly one item for every line number.
- Write the way a skilled ${dst} subtitler would: spoken, concise, easy to read at a glance. No notes, no explanations, no romanization.
- Keep each speaker's voice consistent (politeness level, speech habits, how they address others) across the whole list.
- A sentence may be split over consecutive lines: translate so the lines read naturally in order, keeping each part on its own line number.
- Use \\n to break a translation into two lines only when it is long.
- This is fiction for adults. Translate everything faithfully, including sexual, crude, violent or vulgar lines, moans and swearing. Never censor, soften, skip or summarize.
- Translate slang and newly coined words into equally natural ${dst} slang. Song lyrics and on-screen signs are translated too.
- If a line is only noise or unreadable fragments, return "" for it.`;
  if (vsCfg.dst === 'ko') p += `\n- Korean: choose 반말/존댓말 from the relationship and keep it consistent. Prefer natural spoken endings over stiff written forms.`;
  if (gl.length) p += `\n\nGlossary (always use these translations; names, terms, nicknames):\n${gl.map(s => '- ' + s).join('\n')}`;
  if (vsCfg.notes && vsCfg.notes.trim()) p += `\n\nNotes from the user about characters and tone (follow them):\n${vsCfg.notes.trim().slice(0, 2000)}`;
  if (ctx.length) p += `\n\nEarlier lines, already translated (context only, do not return them):\n${ctx.slice(-14).map(x => `${x.s.replace(/\n/g, ' ')} => ${x.d.replace(/\n/g, ' ')}`).join('\n')}`;
  p += `\n\nLines:\n${list.map((l, i) => `${i}: ${l.src.replace(/\n/g, ' / ')}`).join('\n')}`;
  try {
    const r = await vsAsk([{ text: p }], VS_TR, tk);
    for (const it of r.items || []) { const l = list[+it.i]; if (l && typeof it.t === 'string') l.ko = it.t.replace(/\\n/g, '\n').trim(); }
    const miss = list.filter(l => l.ko == null);
    if (miss.length && miss.length < list.length) await vsTrBatch(miss, ctx, tk); else for (const l of miss) { l.ko = ''; l.fail = 'tr'; }
  } catch (e) {
    if (e.code !== 'blocked' && e.code !== 'parse') throw e;
    if (list.length > 1) { const h = list.length >> 1; await vsTrBatch(list.slice(0, h), ctx, tk); await vsTrBatch(list.slice(h), ctx, tk); }
    else { list[0].ko = ''; list[0].fail = 'tr'; }
  }
}
async function vsTranslate(tk) {
  const all = vs.lines.filter(l => l.src), todo = all.filter(l => l.ko == null); let done = 0;
  for (let a = 0; a < todo.length; a += 60) {
    if (tk.stop) throw trErr('stop');
    const part = todo.slice(a, a + 60), at = all.indexOf(part[0]), ctx = all.slice(Math.max(0, at - 14), at).filter(l => l.ko).map(l => ({ s: l.src, d: l.ko }));
    tk.set(`③ 번역하는 중… ${done} / ${todo.length}`, 0.75 + 0.25 * done / todo.length);
    await vsTrBatch(part, ctx, tk); done += part.length; vsPersist(); vsRenderList();
  }
}

/* ---- 저장해 두기 (같은 영상을 다시 열면 이어서) ---- */
function vsPersist() {
  if (!vs.key) return;
  const lines = vs.lines.filter(l => l.src !== undefined).map(l => ({ t0: r2(l.t0), t1: r2(l.t1), box: [l.box.x, l.box.y, l.box.w, l.box.h].map(Math.round), src: l.src, ko: l.ko == null ? null : l.ko, fail: l.fail || undefined }));
  let all = []; try { all = JSON.parse(localStorage.getItem('potato2VsJobs') || '[]'); } catch (_) { }
  all = all.filter(j => j.key !== vs.key); if (lines.length) all.push({ key: vs.key, name: vs.file ? vs.file.name : '', at: Date.now(), lines });
  for (let n = 0; n < 6; n++) { try { localStorage.setItem('potato2VsJobs', JSON.stringify(all.slice(-6))); return; } catch (_) { all.shift(); } }
}
function vsRestore() {
  try { const j = JSON.parse(localStorage.getItem('potato2VsJobs') || '[]').find(x => x.key === vs.key); if (!j) return false; vs.lines = j.lines.map(l => ({ id: uid(), t0: l.t0, t1: l.t1, box: { x: l.box[0], y: l.box[1], w: l.box[2], h: l.box[3] }, src: l.src, ko: l.ko, fail: l.fail })); vs.scanned = true; return vs.lines.length > 0; } catch (_) { return false; }
}

/* ---- 번역 자막 놓기·그리기 ---- */
const vsMc = newCanvas(4, 4).getContext('2d');
function vsWrapKo(text, fs, maxW) {
  vsMc.font = `700 ${fs}px ${VS_FONT}`; const W = s => vsMc.measureText(s).width, out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const wd of para.split(/(\s+)/).filter(s => s.length)) {
      if (/^\s+$/.test(wd)) { if (line) line += ' '; continue; }
      if (!line || W(line + wd) <= maxW) line += wd; else { out.push(line.trimEnd()); line = wd; }
      while (W(line) > maxW && [...line].length > 1) { const cs = [...line]; let k = cs.length - 1; while (k > 1 && W(cs.slice(0, k).join('')) > maxW) k--; out.push(cs.slice(0, k).join('')); line = cs.slice(k).join(''); }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return { lines: out.length ? out : [''], w: Math.max(1, ...out.map(W)) };
}
// 한 줄 자막이 화면 어디에 어떤 크기로 놓이는지 (영상 픽셀). cover: 원래 자막을 검은 상자로 가리고 그 자리에, 아니면 원래 자막 바로 위에
function vsLay(l, W, H, cover) {
  const txt = String(l.ko || '').trim(); if (!txt) return null;
  const b = l.box, nl = Math.max(1, String(l.src || '').split('\n').length), fs = clamp(b.h / nl * 0.74, H * 0.036, H * 0.072), wr = vsWrapKo(txt, fs, W * 0.92), lh = fs * 1.3, pad = fs * 0.32;
  const tw = wr.w + pad * 2, th = wr.lines.length * lh + pad;
  let w = tw, h = th, cy = b.y - th / 2 - fs * 0.15;
  if (cover) { w = Math.max(tw, b.w + pad); h = Math.max(th, b.h + pad * 0.5); cy = b.y + b.h / 2; }
  w = Math.min(w, W); h = Math.min(h, H);
  return { x: clamp(b.x + b.w / 2 - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h, fs, lh, lines: wr.lines, cover };
}
function vsPaint(g, L) { // 캔버스에 그리기 (MP4로 저장할 때)
  if (L.cover) { g.fillStyle = '#000'; g.fillRect(Math.floor(L.x), Math.floor(L.y), Math.ceil(L.w), Math.ceil(L.h)); }
  g.font = `700 ${L.fs}px ${VS_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const cx = L.x + L.w / 2, top = L.y + (L.h - L.lines.length * L.lh) / 2;
  L.lines.forEach((s, i) => { const y = top + (i + 0.5) * L.lh; if (!L.cover) { g.strokeStyle = '#000'; g.lineWidth = Math.max(2, L.fs * 0.16); g.strokeText(s, cx, y); } g.fillStyle = '#fff'; g.fillText(s, cx, y); });
}
function vsAt(t) { // 지금 시각의 자막 번호 (-1 = 없음)
  const L = vs.lines; let lo = 0, hi = L.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t < L[m].t0) hi = m - 1; else if (t >= L[m].t1) lo = m + 1; else return m; }
  return -1;
}
function vsFit() { // 영상을 가운데 칸에 맞추기
  const st = $('#vsStage'), wr = $('#vsWrap'); if (!st || !vs.W) return;
  const k = Math.min((st.clientWidth - 24) / vs.W, (st.clientHeight - 24) / vs.H); vs.k = k;
  wr.style.width = Math.round(vs.W * k) + 'px'; wr.style.height = Math.round(vs.H * k) + 'px';
  const rg = $('#vsRg'); rg.style.left = vsCfg.x0 + '%'; rg.style.top = vsCfg.y0 + '%'; rg.style.width = (vsCfg.x1 - vsCfg.x0) + '%'; rg.style.height = (vsCfg.y1 - vsCfg.y0) + '%';
  rg.hidden = !!vs.lines.length && !vs.showRg; vs.cur = -2; vsTick();
}
function vsTick() {
  const v = $('#vsVideo'), ov = $('#vsOv'); if (!v || !vs.W) return;
  const i = vs.busy && !vs.lines.some(l => l.ko) ? -1 : vsAt(v.currentTime);
  if (i === vs.cur) return; vs.cur = i;
  const l = vs.lines[i], L = l && vsLay(l, vs.W, vs.H, vsCfg.cover), k = vs.k || 1;
  if (!L) ov.hidden = true;
  else {
    ov.hidden = false; ov.className = 'vs-ov' + (L.cover ? ' cover' : '');
    Object.assign(ov.style, { left: L.x * k + 'px', top: L.y * k + 'px', width: L.w * k + 'px', height: L.h * k + 'px', fontSize: L.fs * k + 'px', lineHeight: L.lh * k + 'px' });
    ov.textContent = L.lines.join('\n');
  }
  $$('#vsList .vs-row.on').forEach(e => e.classList.remove('on'));
  if (l) { const row = $(`#vsList [data-id="${l.id}"]`); if (row) { row.classList.add('on'); if (!v.paused && !row.contains(document.activeElement)) row.scrollIntoView({ block: 'nearest' }); } }
}
function vsLoop() { cancelAnimationFrame(vs.raf); const f = () => { if ($('#vsStudio').hidden) return; vsTick(); vs.raf = requestAnimationFrame(f); }; vs.raf = requestAnimationFrame(f); }

/* ---- 자막 파일 ---- */
const vsDone = () => vs.lines.filter(l => String(l.ko || '').trim());
function vsSrt(orig) {
  const tm = t => { const ms = Math.round(t * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  return (orig ? vs.lines.filter(l => l.src) : vsDone()).map((l, i) => `${i + 1}\n${tm(l.t0)} --> ${tm(l.t1)}\n${(orig ? l.src : l.ko).trim()}\n`).join('\n');
}
function vsAss() { // 원래 자막 자리를 검은 상자로 가리고 그 위에 번역을 얹는 자막 (팟플레이어·VLC·mpv 등)
  const tm = t => { const cs = Math.round(t * 100), p = n => String(n).padStart(2, '0'); return `${Math.floor(cs / 360000)}:${p(Math.floor(cs / 6000) % 60)}:${p(Math.floor(cs / 100) % 60)}.${p(cs % 100)}`; };
  const W = vs.W, H = vs.H, ev = [];
  for (const l of vsDone()) {
    const L = vsLay(l, W, H, vsCfg.cover); if (!L) continue;
    const x0 = Math.floor(L.x), y0 = Math.floor(L.y), x1 = Math.ceil(L.x + L.w), y1 = Math.ceil(L.y + L.h);
    if (L.cover) ev.push(`Dialogue: 0,${tm(l.t0)},${tm(l.t1)},Box,,0,0,0,,{\\an7\\pos(0,0)\\p1}m ${x0} ${y0} l ${x1} ${y0} ${x1} ${y1} ${x0} ${y1}{\\p0}`);
    ev.push(`Dialogue: 1,${tm(l.t0)},${tm(l.t1)},Ko,,0,0,0,,{\\an5\\pos(${Math.round(L.x + L.w / 2)},${Math.round(L.y + L.h / 2)})\\fs${Math.round(L.fs * 1.12)}${L.cover ? '\\bord0\\shad0' : ''}}${L.lines.map(s => s.replace(/[{}]/g, '')).join('\\N')}`);
  }
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Ko,Malgun Gothic,${Math.round(H * 0.05)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(H * 0.004))},0,5,0,0,0,1\nStyle: Box,Arial,20,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${ev.join('\n')}\n`;
}
const vsBase = () => safeName(String(vs.file ? vs.file.name : '영상').replace(/\.[^.]+$/, ''));
async function vsSaveText(kind) {
  if (!vsDone().length && kind !== 'src') { toast('아직 번역한 자막이 없어요'); return; }
  const text = kind === 'ass' ? vsAss() : vsSrt(kind === 'src'), name = `${vsBase()}${kind === 'src' ? '.원문' : '.' + vsCfg.dst}.${kind === 'ass' ? 'ass' : 'srt'}`;
  await download(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }), name);
}
// 번역 자막을 입힌 새 영상 (MP4). 영상을 한 장면씩 풀어 자막을 그리고 다시 묶어요. 소리는 그대로 옮겨요.
async function vsExport() {
  if (vs.busy || !vs.file) return;
  if (typeof VideoEncoder === 'undefined') { toast('여기서는 영상을 만들 수 없어요. 자막 파일(SRT·ASS)로 저장해 주세요', 5000); return; }
  if (!vsDone().length) { toast('아직 번역한 자막이 없어요'); return; }
  const name = `${vsBase()}.${vsCfg.dst}.mp4`, T = appApi();
  let writable = null, path = null, frag = false, mem = null, pos = 0;
  if (T) { // 설치판: 고른 파일에 차례로 이어 써요
    try { path = await T.dialog.save({ defaultPath: name, filters: [{ name: 'MP4 파일', extensions: ['mp4'] }] }); } catch (e) { toast('저장 창을 열지 못했어요', 4000); return; }
    if (!path) return; frag = true;
    writable = new WritableStream({ async write(ch) { if (ch.position !== pos) throw new Error('순서대로 쓸 수 없는 자리'); await T.fs.writeFile(path, ch.data, pos ? { append: true } : undefined); pos += ch.data.length; } });
  } else if (window.showSaveFilePicker) {
    try { const h = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 영상', accept: { 'video/mp4': ['.mp4'] } }] }); writable = await h.createWritable(); } catch (e) { return; }
  } else if (vs.file.size > 1.2e9) { toast('이 브라우저에서는 큰 영상을 저장할 수 없어요. 설치판을 쓰거나 자막 파일로 저장해 주세요', 6000); return; }
  const tk = vs.tk = { stop: false, set: vsSay }; vs.busy = true; $('#vsStop').hidden = false; $('#vsStop').disabled = false; vsRenderLeft();
  const v = $('#vsVideo'); v.pause();
  let conv = null, ok = false, input = null;
  try {
    vsSay('자막 입힌 영상을 만들 준비를 하는 중…', 0);
    input = new MB.Input({ source: new MB.BlobSource(vs.file), formats: MB.ALL_FORMATS });
    const target = writable ? new MB.StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 }) : (mem = new MB.BufferTarget());
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: frag ? 'fragmented' : writable ? false : 'in-memory' }), target });
    const cv = newCanvas(vs.W, vs.H), g = cv.getContext('2d'), lays = new Map(), cover = vsCfg.cover;
    conv = await MB.Conversion.init({
      input, output,
      video: {
        forceTranscode: true, bitrate: MB.QUALITY_HIGH, 
        process: s => {
          const l = vs.lines[vsAt(s.timestamp + 0.001)]; if (!l) return s;
          const W = s.displayWidth, H = s.displayHeight; let L = lays.get(l.id);
          if (L === undefined) { L = vsLay(l, vs.W, vs.H, cover); lays.set(l.id, L); }
          if (!L) return s;
          if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
          g.setTransform(1, 0, 0, 1, 0, 0); s.draw(g, 0, 0, W, H); g.setTransform(W / vs.W, 0, 0, H / vs.H, 0, 0); vsPaint(g, L);
          return cv;
        },
      },
    });
    if (!conv.isValid || !conv.utilizedTracks.some(t => t.type === 'video')) {
      const why = (conv.discardedTracks || []).map(d => d.reason).join(', ');
      throw trErr('fmt', `이 영상은 다시 만들 수 없는 형식이에요${/undecodable|unknown_source/.test(why) ? ' (이 컴퓨터가 풀지 못하는 코덱)' : ''}. 자막 파일(SRT·ASS)로 저장해 주세요`);
    }
    const noAud = (conv.discardedTracks || []).some(d => d.track && d.track.type === 'audio'), t0 = performance.now();
    conv.onProgress = (p, at) => { const el = (performance.now() - t0) / 1000, left = p > 0.02 ? el / p * (1 - p) : 0; vsSay(`자막 입힌 영상을 만드는 중… ${vsClock(at || 0)} / ${vsClock(vs.D)}${left ? ` · 남은 시간 약 ${left > 90 ? Math.round(left / 60) + '분' : Math.max(1, Math.round(left)) + '초'}` : ''}`, p); };
    const watch = setInterval(() => { if (tk.stop && conv.state === 'executing') conv.cancel().catch(() => { }); }, 300);
    try { await conv.execute(); } finally { clearInterval(watch); }
    if (tk.stop || conv.state === 'canceled') throw trErr('stop');
    if (mem) await download(new Blob([mem.buffer], { type: 'video/mp4' }), name);
    ok = true;
    vsSay(`자막을 입힌 영상을 저장했어요${path ? ' (' + path + ')' : ''}.${noAud ? ' 소리는 이 형식에서 옮기지 못해서 빠졌어요.' : ''}`, 1); toast('자막 입힌 영상을 저장했어요', 4000);
  } catch (e) {
    const stop = e.code === 'stop' || tk.stop;
    if (!stop) console.error(e);
    vsSay(stop ? '영상 만들기를 멈췄어요.' : e.code === 'fmt' ? e.message : `영상을 만들지 못했어요 (${String((e && e.message) || e).slice(0, 120)}). 자막 파일(SRT·ASS)로는 저장할 수 있어요.`);
    if (!stop) toast(e.code === 'fmt' ? e.message : '영상을 만들지 못했어요', 6000);
  } finally {
    if (!ok && path && T) { try { await T.fs.remove(path); } catch (_) { } } // 만들다 만 파일은 지워요
    try { if (input && input.dispose) input.dispose(); } catch (_) { }
    vs.busy = false; vs.tk = null; $('#vsStop').hidden = true; vsRenderLeft();
  }
}

/* ---- 화면 ---- */
function vsBuild() {
  if (vs.built) return; vs.built = true;
  const d = document.createElement('div'); d.id = 'vsStudio'; d.className = 'vs'; d.hidden = true;
  d.innerHTML = `<div class="gs-top"><b>영상 자막 번역</b><span class="muted small" id="vsName">영상에 박혀 있는 자막을 읽어 번역해요</span><div class="flex1"></div><button class="btn" data-v="pick">영상 고르기</button><button class="btn" data-v="close">편집기로 돌아가기</button></div>
    <div class="gs-body vs-body">
      <aside class="gs-left vs-left" id="vsLeft"></aside>
      <main class="gs-main vs-main">
        <div class="gs-stage" id="vsStage"><div id="vsWrap" class="vs-wrap" hidden><video id="vsVideo" controls playsinline preload="auto"></video><div id="vsRg" class="vs-rg"></div><div id="vsOv" class="vs-ov" hidden></div></div>
          <div id="vsEmpty" class="gs-empty"><b>번역할 영상을 넣어 주세요</b>영상을 이 화면으로 끌어오거나 '영상 고르기'를 누르세요. 10분~1시간짜리 긴 영상도 돼요 (MP4·WebM·MKV 등).<button class="btn primary" data-v="pick" style="margin-top:6px">영상 고르기</button></div></div>
        <div class="gs-ctrl vs-bar"><div class="flex1"><div id="vsMsg" class="small">영상을 넣으면 시작할 수 있어요.</div><div class="czbar"><i id="vsPBar"></i></div></div><button class="btn" data-v="stop" id="vsStop" hidden>멈추기</button></div>
      </main>
      <aside class="gs-right vs-right"><div class="vs-lh"><b>자막</b><span class="muted small" id="vsCount"></span></div><div id="vsList" class="vs-list"></div></aside>
    </div><input type="file" id="vsFile" accept="video/*,.mp4,.mkv,.webm,.mov,.m4v,.avi,.ts,.wmv,.flv" hidden>`;
  document.body.appendChild(d);
  const v = $('#vsVideo', d), stage = $('#vsStage', d);
  d.addEventListener('keydown', e => e.stopPropagation()); d.addEventListener('keyup', e => e.stopPropagation());
  d.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); stage.classList.add('drop'); } });
  d.addEventListener('dragleave', e => { if (e.target === d || e.target === stage) stage.classList.remove('drop'); });
  d.addEventListener('drop', e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.stopPropagation(); stage.classList.remove('drop'); const f = [...e.dataTransfer.files][0]; if (f) vsLoad(f); });
  $('#vsFile', d).addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) vsLoad(f); });
  d.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b && !b.disabled) vsAct(b.dataset.v, b); });
  d.addEventListener('input', e => {
    const t = e.target, f = t.dataset.f;
    if (t.dataset.ko !== undefined) { const l = vs.lines.find(x => x.id === t.dataset.ko); if (l) { l.ko = t.value; delete l.fail; vs.cur = -2; clearTimeout(vs.saveT); vs.saveT = setTimeout(vsPersist, 600); } return; }
    if (!f) return;
    if (f === 'from' || f === 'to') { vs[f] = t.value; return; }
    if (t.type === 'range') {
      let n = +t.value;
      if (f === 'y0') n = Math.min(n, vsCfg.y1 - 4); if (f === 'y1') n = Math.max(n, vsCfg.y0 + 4); if (f === 'x0') n = Math.min(n, vsCfg.x1 - 10); if (f === 'x1') n = Math.max(n, vsCfg.x0 + 10);
      vsCfg[f] = n; t.value = n; vs.showRg = true; vsFit();
    } else if (t.type !== 'checkbox' && t.tagName !== 'SELECT') vsCfg[f] = t.value;
    vsSaveCfg();
  });
  d.addEventListener('change', e => {
    const t = e.target, f = t.dataset.f; if (!f) return;
    if (t.type === 'checkbox') vsCfg[f] = t.checked; else if (t.tagName === 'SELECT') vsCfg[f] = f === 'fps' ? +t.value : f === 'dark' ? !!t.value : t.value; else if (t.type === 'range') { vs.showRg = false; vsFit(); return; } else return;
    vsSaveCfg(); vs.cur = -2; if (f === 'model' || f === 'fps' || f === 'dark') vsRenderLeft();
  });
  for (const ev of ['seeked', 'timeupdate', 'play']) v.addEventListener(ev, vsTick);
  new ResizeObserver(vsFit).observe(stage);
}
function vsRenderLeft() {
  const box = $('#vsLeft'); if (!box) return;
  if (!vs.file) { box.innerHTML = `<div class="sec"><p class="muted small" style="margin:0;line-height:1.6">영상에 박혀 있는 자막(따로 꺼낼 수 없는 자막)을 찾아 읽고 번역해요.<br><br>영상은 이 컴퓨터에서만 읽어요. 제미나이에는 <b>자막 글자 둘레만 남긴 흑백 조각</b>과 읽은 글만 보내고, 장면은 보내지 않아요. 그래서 어떤 장면이 나와도 거절되지 않고 자막만 번역돼요.</p></div>`; return; }
  const has = vs.lines.length > 0, read = vs.lines.some(l => l.src !== undefined), left = vs.lines.some(l => l.src === undefined || (l.src && l.ko == null)), dn = vsDone().length, B = vs.busy ? 'disabled' : '';
  const sl = (f, l) => `<div class="row"><span class="l">${l}</span><input type="range" min="0" max="100" step="1" data-f="${f}" value="${vsCfg[f]}" ${B}></div>`;
  const opt = (list, cur) => list.map(([a, b]) => `<option value="${a}" ${String(a) === String(cur) ? 'selected' : ''}>${b}</option>`).join('');
  box.innerHTML = `<div class="sec"><h3>① 자막 자리</h3><p class="muted small" style="margin:0 0 4px">자막이 나오는 장면으로 옮긴 뒤, 파란 점선 안에 자막이 다 들어오게 맞춰 주세요. 좁을수록 빠르고 정확해요.</p>
      ${sl('y0', '위')}${sl('y1', '아래')}${sl('x0', '왼쪽')}${sl('x1', '오른쪽')}
      <div class="row"><span class="l">글자 색</span><select data-f="dark" ${B}><option value="" ${vsCfg.dark ? '' : 'selected'}>밝은 글자 (흰색·노란색 등)</option><option value="1" ${vsCfg.dark ? 'selected' : ''}>어두운 글자</option></select></div>
      <div class="row"><span class="l">살피기</span><select data-f="fps" ${B}>${opt([[2.5, '빠르게 (1초에 2~3번)'], [4, '보통 (1초에 4번)'], [6, '꼼꼼히 (1초에 6번)']], vsCfg.fps)}</select></div>
      <div class="row"><span class="l">구간</span><input type="text" data-f="from" value="${esc(vs.from)}" placeholder="처음" style="width:64px" ${B}> ~ <input type="text" data-f="to" value="${esc(vs.to)}" placeholder="끝 (${vsClock(vs.D)})" style="width:92px" ${B}></div>
      <p class="muted small" style="margin:2px 0 0">구간은 '분:초'로 적어요. 비워 두면 영상 전체예요. 먼저 몇 분만 해 보고 전체를 돌리면 좋아요.</p></div>
    <div class="sec"><h3>② 번역</h3>
      <div class="row"><span class="l">원문</span><select data-f="src" ${B}>${opt(VS_SRC, vsCfg.src)}</select></div>
      <div class="row"><span class="l">번역할 말</span><select data-f="dst" ${B}>${opt(VS_DST, vsCfg.dst)}</select></div>
      <p class="muted small" style="margin:4px 0">모델: ${esc(settings.get('textModel'))} (설정 > AI와 API의 글 모델을 써요)</p>
      <details style="margin:6px 0"><summary class="small" style="cursor:pointer">용어집·말투 메모</summary>
        <p class="muted small" style="margin:6px 0 4px">한 줄에 하나씩 '원문 = 번역' (이름·호칭 등)</p><textarea data-f="gloss" rows="3" spellcheck="false" style="width:100%" placeholder="カイ = 카이&#10;先輩 = 선배" ${B}>${esc(vsCfg.gloss)}</textarea>
        <p class="muted small" style="margin:6px 0 4px">말투·관계 메모</p><textarea data-f="notes" rows="2" spellcheck="false" style="width:100%" placeholder="예: 둘은 연인, 서로 반말" ${B}>${esc(vsCfg.notes)}</textarea></details>
      <div class="btnrow"><button class="btn primary" data-v="${has && left ? 'go' : 'new'}" ${B}>${has && left ? '이어서 하기' : has ? '처음부터 다시 번역' : '번역 시작'}</button>${has && left ? `<button class="btn sm" data-v="new" ${B}>처음부터 다시</button>` : ''}${read && !left ? `<button class="btn sm" data-v="retr" ${B} title="읽어 둔 원문은 그대로 두고 번역만 다시 해요 (용어집·말투를 바꿨을 때)">번역만 다시</button>` : ''}</div></div>
    <div class="sec"><h3>③ 보기·저장</h3>
      <label class="chk" style="white-space:normal"><input type="checkbox" data-f="cover" ${vsCfg.cover ? 'checked' : ''}> 원래 자막을 검은 상자로 가리고 그 자리에 쓰기</label>
      <p class="muted small" style="margin:4px 0 8px">끄면 원래 자막 바로 위에 번역을 써요.</p>
      <div class="btnrow"><button class="btn sm" data-v="mp4" ${dn && !vs.busy ? '' : 'disabled'} title="번역 자막을 입힌 새 영상 파일을 만들어요">자막 입힌 영상 저장 (MP4)</button></div>
      <div class="btnrow" style="margin-top:6px"><button class="btn sm" data-v="srt" ${dn ? '' : 'disabled'}>자막 파일 (SRT)</button><button class="btn sm" data-v="ass" ${dn ? '' : 'disabled'} title="원래 자막을 가리는 상자까지 들어 있는 자막 파일. 팟플레이어·VLC·mpv에서 영상과 같은 이름으로 두면 돼요">가리는 자막 (ASS)</button><button class="btn sm" data-v="srt-src" ${read ? '' : 'disabled'}>원문 (SRT)</button></div>
      <p class="muted small" style="margin:8px 0 0">번역 결과는 이 컴퓨터에 저장돼서, 같은 영상을 다시 넣으면 이어서 볼 수 있어요.</p></div>`;
}
function vsRenderList() {
  const box = $('#vsList'); if (!box) return;
  const L = vs.lines.filter(l => l.src !== undefined), wait = vs.lines.length - L.length;
  $('#vsCount').textContent = vs.lines.length ? `${L.length}줄${wait ? ` · 아직 안 읽은 조각 ${wait}개` : ''}` : '';
  if (!L.length) { box.innerHTML = `<p class="muted small" style="padding:14px;line-height:1.6">${vs.lines.length ? '자막 조각을 찾았어요. 읽고 번역하면 여기에 나와요.' : '번역을 시작하면 자막이 시간 순서대로 여기에 나와요. 번역문은 바로 고칠 수 있어요.'}</p>`; return; }
  const keep = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ko : null, top = box.scrollTop;
  box.innerHTML = L.map(l => `<div class="vs-row ${l.fail ? 'bad' : ''}" data-id="${l.id}"><div class="vs-rt"><button class="vs-t" data-v="seek" data-id="${l.id}" title="이 자막으로 가기">${vsClock(l.t0, 1)}</button><span class="vs-src">${l.fail === 'read' ? '읽지 못한 자막이에요. 눌러서 장면을 보고 직접 적어 주세요' : esc(l.src)}</span><button class="vs-x" data-v="del" data-id="${l.id}" title="이 자막 빼기">×</button></div>
    <textarea data-ko="${l.id}" rows="${Math.max(1, String(l.ko || '').split('\n').length)}" spellcheck="false" placeholder="${l.ko == null ? '번역 기다리는 중…' : l.fail === 'tr' ? '제미나이가 번역하지 못했어요. 직접 적어 주세요' : '(비워 두면 안 보여요)'}">${esc(l.ko || '')}</textarea></div>`).join('');
  box.scrollTop = top; if (keep) { const t = $(`[data-ko="${keep}"]`, box); if (t) t.focus(); }
  vs.cur = -2;
}
const vsSay = (msg, f) => { if (msg != null) { vs.msg = msg; const e = $('#vsMsg'); if (e) e.textContent = msg; } if (f !== undefined) { vs.frac = f; const b = $('#vsPBar'); if (b) b.style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; } };
async function vsLoad(file) {
  if (vs.busy) { toast('지금 하는 일을 멈춘 뒤에 다른 영상을 넣어 주세요'); return; }
  const v = $('#vsVideo'), url = URL.createObjectURL(file);
  v.pause(); v.src = url;
  try { await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video')); setTimeout(() => rej(new Error('timeout')), 30000); }); if (!v.videoWidth || !isFinite(v.duration)) throw new Error('video'); }
  catch (_) { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); if (vs.url) v.src = vs.url; toast(`${file.name}을 열지 못했어요. 이 컴퓨터가 못 읽는 형식이에요. MP4(H.264)나 WebM으로 바꿔서 넣어 주세요`, 6000); return; }
  finally { v.onloadeddata = v.onerror = null; }
  if (vs.url) URL.revokeObjectURL(vs.url);
  Object.assign(vs, { file, url, W: v.videoWidth, H: v.videoHeight, D: v.duration, key: `${file.name}|${file.size}|${Math.round(v.duration)}`, lines: [], scanned: false, cur: -2, from: '', to: '', showRg: false });
  $('#vsName').textContent = `${file.name} · ${vs.W}×${vs.H} · ${vsClock(vs.D)}`; $('#vsEmpty').hidden = true; $('#vsWrap').hidden = false; v.muted = false;
  const old = vsRestore();
  vsSay(old ? `전에 번역해 둔 자막 ${vs.lines.length}줄을 불러왔어요.` : "자막이 나오는 장면에서 파란 점선(자막 자리)을 맞춘 뒤 '번역 시작'을 누르세요.", old ? 1 : 0);
  if (!old) gsSeek(v, Math.min(vs.D * 0.2, 120)).then(vsFit);
  vsFit(); vsRenderLeft(); vsRenderList(); vsLoop();
}
async function vsStart(mode) {
  if (vs.busy || !vs.file) return;
  try { ready(); } catch (e) { toast(e.message, 'err'); return; }
  if (mode === 'new' && vs.lines.length && !(await askYes('지금 있는 자막과 번역을 지우고 영상을 처음부터 다시 살펴요. 고친 번역문도 지워져요. 할까요?'))) return;
  if (mode === 'retr' && !(await askYes('읽어 둔 원문은 그대로 두고 번역만 모두 다시 해요. 고친 번역문은 지워져요. 할까요?'))) return;
  const tk = vs.tk = { stop: false, set: vsSay };
  vs.busy = true; $('#vsStop').hidden = false; $('#vsStop').disabled = false;
  if (mode === 'new') { vs.lines = []; vs.scanned = false; vsPersist(); }
  if (mode === 'retr') for (const l of vs.lines) if (l.src) { l.ko = null; delete l.fail; }
  vs.showRg = false; vsRenderLeft(); vsRenderList(); vsFit();
  try {
    if (!vs.scanned) { await vsScan(tk); vs.scanned = true; vsRenderList(); }
    if (!vs.lines.length) throw trErr('none', '자막을 찾지 못했어요. 자막 자리(파란 점선)가 자막을 다 덮는지, 글자 색이 맞는지 확인해 주세요');
    await vsRead(tk); vsMerge(); vsPersist(); vsRenderList();
    if (!vs.lines.some(l => l.src)) throw trErr('none', '읽을 수 있는 자막 글자가 없었어요. 자막 자리를 다시 맞춰 주세요');
    await vsTranslate(tk);
    const bad = vs.lines.filter(l => l.fail).length;
    vsSay(`다 됐어요. 자막 ${vsDone().length}줄을 번역했어요${bad ? ` (${bad}줄은 비어 있어요. 목록에서 붉은 줄을 직접 적어 주세요)` : ''}.`, 1);
    toast('영상 자막 번역이 끝났어요', 5000);
  } catch (e) {
    if (e.code !== 'stop' && !e.code) console.error(e);
    vsSay(e.code === 'stop' ? "멈췄어요. '이어서 하기'를 누르면 멈춘 데서부터 계속해요." : `${e.message || '알 수 없는 문제가 생겼어요'}${vs.scanned && vs.lines.length && e.code !== 'none' ? " — '이어서 하기'로 계속할 수 있어요." : ''}`);
    if (e.code !== 'stop') toast(e.message || '영상 자막 번역을 하지 못했어요', 6000);
    if (!vs.scanned) vs.lines = []; // 살피다 멈추면 처음부터
  } finally {
    vs.busy = false; vs.tk = null; $('#vsStop').hidden = true; vsPersist();
    const v = $('#vsVideo'); v.muted = false; vsRenderLeft(); vsRenderList(); vsFit();
  }
}
function vsAct(a, b) {
  const v = $('#vsVideo');
  if (a === 'pick') $('#vsFile').click();
  else if (a === 'close') vsClose();
  else if (a === 'stop') { if (vs.tk) { vs.tk.stop = true; b.disabled = true; vsSay('멈추는 중…'); } }
  else if (a === 'new' || a === 'go' || a === 'retr') vsStart(a);
  else if (a === 'srt' || a === 'ass') vsSaveText(a);
  else if (a === 'srt-src') vsSaveText('src');
  else if (a === 'mp4') vsExport();
  else if (a === 'seek') { const l = vs.lines.find(x => x.id === b.dataset.id); if (l && !vs.busy) { v.pause(); v.currentTime = l.t0 + 0.02; } }
  else if (a === 'del') { const i = vs.lines.findIndex(x => x.id === b.dataset.id); if (i >= 0) { vs.lines.splice(i, 1); vsPersist(); vsRenderList(); vsRenderLeft(); } }
}
function vsOpen() {
  vsBuild(); $('#vsStudio').hidden = false; vsRenderLeft(); vsRenderList(); vsFit(); if (vs.file) vsLoop();
}
function vsClose() {
  if (vs.busy && !confirm('아직 하는 중이에요. 닫으면 멈춰요. 닫을까요?')) return;
  if (vs.tk) vs.tk.stop = true;
  const v = $('#vsVideo'); if (v) v.pause();
  cancelAnimationFrame(vs.raf); $('#vsStudio').hidden = true;
}

export function registerVsubCmds() {
  addCmd({ id: 'ai.vsub', title: '영상 자막 번역… (제미나이)', menu: 'AI', group: 'gemini', words: '박힌 자막 하드섭 한국어 번역 영상 subtitle srt ass mp4', run: vsOpen });
}
