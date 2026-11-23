// 글자·효과음 글자 그리기 (8.x의 글자 꾸밈을 옮긴 것): 글자마다 흔들림·크기 변화·간격·기울기·입체,
// 이중 테두리, 색 번짐, 후광·그림자, 배경 띠, 휘기, 거칠게. 요소(e)의 값만 보고 그리고, 같은 값이면 늘 같은 모양이에요.
//   e: { text, size, font, bold, italic, color, sw, sc, sw2, sc2, lh, sp, jit, grow, seed, skew, ext, extAng, extColor,
//        fillGrad, fill2, gradDir, rough, align, op, glow, glowColor, glowA, shA, shColor, shAng, shDist, shBlur, boxOn, boxColor, boxA, boxPad, boxR, vert, arc }
const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const BASE_FONT = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
export const fontStr = e => `${e.italic ? 'italic ' : ''}${e.bold ? 700 : 400} ${e.size || 32}px ${e.font || BASE_FONT}`;
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const rgba = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; };
const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
let mctx = null; const measure = () => mctx || (mctx = document.createElement('canvas').getContext('2d'));

// 한눈에 입히는 글자 모양 (8.x의 글자 스타일 8가지 + 효과음 견본 8가지). size는 800 폭 페이지 기준이에요
const PLAIN = { italic: false, sw2: 0, glow: 0, shA: 0, boxOn: false, arc: 0, jit: 0, rough: 0, skew: 0, grow: 0, ext: 0, sp: 0, fillGrad: false };
export const TEXT_STYLES = [
  { n: '깔끔하게', p: { ...PLAIN } },
  { n: '네온', p: { ...PLAIN, color: '#ffffff', sc: '#ff3fa4', sw: 3, glow: 45, glowColor: '#ff3fa4', glowA: 90 } },
  { n: '파란 빛', p: { ...PLAIN, color: '#e9fbff', sc: '#1d8cff', sw: 3, glow: 40, glowColor: '#36b3ff', glowA: 85 } },
  { n: '그림자', p: { ...PLAIN, shA: 60, shColor: '#000000', shAng: 50, shDist: 8, shBlur: 14 } },
  { n: '자막 띠', p: { ...PLAIN, color: '#ffffff', sw: 0, boxOn: true, boxColor: '#000000', boxA: 65, boxPad: 30, boxR: 20, bold: false } },
  { n: '금빛', p: { ...PLAIN, color: '#fff3b0', fillGrad: true, fill2: '#d18a00', gradDir: 'v', sc: '#5a3a00', sw: 4, sw2: 4, sc2: '#ffffff', glow: 20, glowColor: '#ffd24d', glowA: 60 } },
  { n: '아치', p: { ...PLAIN, arc: 45, vert: false } },
  { n: '세로쓰기', p: { ...PLAIN, vert: true } },
];
export const SFX_PRESETS = [
  { n: '쾅! 충격', text: '쾅!', p: { ...PLAIN, bold: true, size: 130, color: '#ffffff', sc: '#111111', sw: 9, ext: 20, extAng: 120, extColor: '#111111', jit: 30, sp: -4, skew: -8, rough: 35 } },
  { n: '두근 설렘', text: '두근', p: { ...PLAIN, bold: true, size: 90, color: '#ff4d7d', sc: '#ffffff', sw: 7, sw2: 5, sc2: '#ff4d7d', jit: 22, sp: 2, rough: 12 } },
  { n: '휙 속도', text: '휙', p: { ...PLAIN, bold: true, size: 110, color: '#111111', sc: '#ffffff', sw: 6, jit: 10, grow: 40, sp: -6, skew: -28, rough: 30 } },
  { n: '덜덜 떨림', text: '덜덜', p: { ...PLAIN, bold: true, size: 90, color: '#111111', sc: '#ffffff', sw: 6, jit: 75, sp: 4, rough: 55 } },
  { n: '쿵 묵직', text: '쿵', p: { ...PLAIN, bold: true, size: 150, color: '#5a5a5a', fillGrad: true, fill2: '#000000', gradDir: 'v', sc: '#ffffff', sw: 10, ext: 26, extAng: 90, extColor: '#000000', jit: 6, rough: 25 } },
  { n: '스윽 조용', text: '스윽', p: { ...PLAIN, bold: false, italic: true, size: 70, color: '#333333', sc: '#ffffff', sw: 4, jit: 12, grow: -20, sp: 18, skew: -12, rough: 45 } },
  { n: '꺄악! 비명', text: '꺄악!', p: { ...PLAIN, bold: true, size: 110, color: '#ffffff', sc: '#d4161b', sw: 8, sw2: 6, sc2: '#ffffff', jit: 45, grow: 25, sp: -2, skew: -6, rough: 40 } },
  { n: '반짝', text: '반짝', p: { ...PLAIN, bold: true, size: 80, color: '#fff7c2', fillGrad: true, fill2: '#ffb300', gradDir: 'v', sc: '#7a4a00', sw: 5, sw2: 5, sc2: '#ffffff', jit: 15, sp: 6 } },
];
export const LOOK_KEYS = ['font', 'size', 'bold', 'italic', 'lh', 'sp', 'jit', 'grow', 'seed', 'skew', 'ext', 'extAng', 'extColor', 'sw', 'sw2', 'sc', 'sc2', 'color', 'fillGrad', 'fill2', 'gradDir', 'rough', 'align', 'op', 'glow', 'glowColor', 'glowA', 'shA', 'shColor', 'shAng', 'shDist', 'shBlur', 'boxOn', 'boxColor', 'boxA', 'boxPad', 'boxR', 'vert', 'arc'];

// 글자 자리 잡기 → { glyphs, w, h, ox, oy, tk, ex, ey, gb }. 가운데가 (0, 0)이에요
const layoutCache = new Map();
export function textLayout(e) {
  const key = [e.id, e.text, ...LOOK_KEYS.map(k => e[k])].join('|'); if (layoutCache.has(key)) return layoutCache.get(key);
  const fs = e.size || 32, sp = (e.sp || 0) / 100 * fs, jit = (e.jit || 0) / 100, grow = (e.grow || 0) / 100, rnd = seeded((e.id || '') + ':' + (e.seed || 1)), lines = String(e.text ?? '').split('\n'), m = measure();
  m.font = fontStr(e);
  const total = lines.reduce((s, l) => s + [...l].length, 0); let idx = 0;
  const rows = lines.map(line => {
    const chars = [...line], row = []; let x = 0;
    for (const ch of chars) {
      const t = total > 1 ? idx / (total - 1) : 0.5, sc = Math.max(0.2, (1 + grow * (t - 0.5) * 2) * (1 + (rnd() - 0.5) * jit * 0.35)), w = m.measureText(ch).width * sc;
      row.push({ ch, cx: x + w / 2, dy: (rnd() - 0.5) * 2 * jit * fs * 0.12, sc, rot: (rnd() - 0.5) * 2 * jit * 16 * DEG, w }); x += w + sp; idx++;
    }
    return { row, lw: Math.max(0, x - (chars.length ? sp : 0)) };
  });
  const maxW = Math.max(fs * 0.3, ...rows.map(r => r.lw)), lh = fs * (e.lh || 1.3), n = rows.length, al = e.align || 'center', glyphs = [];
  if (e.vert) {   // 세로쓰기: 줄마다 한 칸씩, 오른쪽 줄부터. 긴 줄표·괄호는 눕혀요
    const cols = rows.map(r => { let y = 0; const out = r.row.map(g => { const hh = (g.ch === ' ' ? fs * 0.45 : fs * 1.02) * g.sc, o = { ...g, cy: y + hh / 2 }; y += hh + sp; return o; }); return { out, ch: Math.max(0, y - (out.length ? sp : 0)) }; });
    const maxH = Math.max(fs * 0.3, ...cols.map(c => c.ch));
    cols.forEach((c, i) => { const off = al === 'left' ? -maxH / 2 : al === 'right' ? maxH / 2 - c.ch : -c.ch / 2, x = ((n - 1) / 2 - i) * lh * 0.96; for (const g of c.out) glyphs.push({ ch: g.ch, x: x + g.dy, y: off + g.cy, sc: g.sc, rot: g.rot + (/[ー―—~〜…\-（）()「」『』]/.test(g.ch) ? Math.PI / 2 : 0), w: fs * g.sc }); });
  } else rows.forEach((r, i) => { const off = al === 'left' ? -maxW / 2 : al === 'right' ? maxW / 2 - r.lw : -r.lw / 2, y = (i - (n - 1) / 2) * lh; for (const g of r.row) glyphs.push({ ch: g.ch, x: off + g.cx, y: y + g.dy, sc: g.sc, rot: g.rot, w: g.w }); });
  const arc = e.vert ? 0 : clamp(e.arc || 0, -100, 100);
  if (Math.abs(arc) > 0.5) {   // 휘기: 둥근 길을 따라 놓아요 (+는 무지개처럼, -는 그릇처럼)
    const R = maxW / (arc / 100 * Math.PI);
    for (const g of glyphs) { const r = R - g.y, ph = g.x / R; g.x = r * Math.sin(ph); g.y = R - r * Math.cos(ph); g.rot += ph; }
    let cy = 0; for (const g of glyphs) cy += g.y; cy /= Math.max(1, glyphs.length); for (const g of glyphs) g.y -= cy;
  }
  const tk = Math.tan((e.skew || 0) * DEG), ex = Math.cos((e.extAng || 0) * DEG) * (e.ext || 0) / 100 * fs, ey = Math.sin((e.extAng || 0) * DEG) * (e.ext || 0) / 100 * fs;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (x, y) => { const sx = x - tk * y; x0 = Math.min(x0, sx, sx + ex); x1 = Math.max(x1, sx, sx + ex); y0 = Math.min(y0, y, y + ey); y1 = Math.max(y1, y, y + ey); };
  for (const g of glyphs) { const hw = g.w / 2, hh = fs * g.sc * 0.56; for (const [px, py] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) { const r = rot(px, py, g.rot); add(g.x + r.x, g.y + r.y); } }
  if (!glyphs.length) add(0, 0);
  const gb = { x0, y0, x1, y1 }, outl = (e.sw || 0) + (e.sw2 || 0), glowExt = (e.glow || 0) / 100 * fs * 0.8, shExt = (e.shA || 0) > 0 ? ((e.shDist ?? 6) + (e.shBlur ?? 12) * 0.8) / 100 * fs : 0, boxExt = e.boxOn ? Math.max(0, (e.boxPad ?? 30) / 100 * fs - outl) : 0;
  const pad = outl + (e.rough || 0) / 100 * fs * 0.08 + fs * 0.04 + Math.max(glowExt, shExt, boxExt);
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const L = { glyphs, w: x1 - x0, h: y1 - y0, ox: -(x0 + x1) / 2, oy: -(y0 + y1) / 2, tk, ex, ey, gb };
  layoutCache.set(key, L); if (layoutCache.size > 400) layoutCache.delete(layoutCache.keys().next().value);
  return L;
}
function glyphPass(g, L, ox, oy, fn) { for (const gl of L.glyphs) { g.save(); g.translate(gl.x + ox, gl.y + oy); g.rotate(gl.rot); g.scale(gl.sc, gl.sc); fn(gl); g.restore(); } }
function paintText(g, e, L) {
  g.save(); g.translate(L.ox, L.oy);
  const fs = e.size || 32, sw = e.sw || 0, sw2 = e.sw2 || 0, yo = fs * 0.04, color = e.color || '#111111', sc = e.sc || '#ffffff';
  if (e.boxOn && L.gb) {   // 배경 띠 (자막처럼)
    const bp = (e.boxPad ?? 30) / 100 * fs, br = (e.boxR ?? 25) / 100 * fs, b = L.gb;
    g.save(); g.fillStyle = rgba(e.boxColor || '#000000', (e.boxA ?? 65) / 100); g.beginPath(); g.roundRect(b.x0 - bp, b.y0 - bp, b.x1 - b.x0 + bp * 2, b.y1 - b.y0 + bp * 2, br); g.fill(); g.restore();
  }
  if (L.tk) g.transform(1, 0, -L.tk, 1, 0, 0);
  g.font = fontStr(e); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.miterLimit = 2;
  const depth = Math.hypot(L.ex, L.ey), steps = depth > 0 ? clamp(Math.ceil(depth / 1.2), 1, 80) : 0, offs = []; for (let k = steps; k >= 0; k--) offs.push([L.ex * k / (steps || 1), L.ey * k / (steps || 1)]);
  const stroke = (w, col, list) => { if (w <= 0) return; g.strokeStyle = col; for (const [ox, oy] of list) glyphPass(g, L, ox, oy, gl => { g.lineWidth = w / gl.sc; g.strokeText(gl.ch, 0, yo); }); };
  // 글자 전체 모양(가장 바깥 테두리까지)을 한 색으로: 그림자와 후광에 써요
  const silhouette = col => { stroke(sw2 > 0 ? (sw + sw2) * 2 : sw * 2, col, offs); g.fillStyle = col; for (const [ox, oy] of offs) glyphPass(g, L, ox, oy, gl => g.fillText(gl.ch, 0, yo)); };
  const m = g.getTransform(), gs = Math.hypot(m.a, m.b) || 1, FAR = ((g.canvas.width + g.canvas.height) * 2 + 2000) / gs;
  const shade = (col, blur, dx, dy, alpha) => {   // 글자는 화면 밖 멀리 그리고 그림자만 제자리에 남겨요
    g.save(); g.globalAlpha *= alpha; g.shadowColor = col; g.shadowBlur = blur * gs; g.shadowOffsetX = -m.a * FAR + (m.a * dx + m.c * dy); g.shadowOffsetY = -m.b * FAR + (m.b * dx + m.d * dy); g.translate(FAR, 0); silhouette('#000'); g.restore();
  };
  if ((e.shA || 0) > 0) { const d = (e.shDist ?? 6) / 100 * fs, a = (e.shAng ?? 50) * DEG; shade(rgba(e.shColor || '#000000', e.shA / 100), (e.shBlur ?? 12) / 100 * fs, Math.cos(a) * d, Math.sin(a) * d, 1); }
  if ((e.glow || 0) > 0) { const A = clamp((e.glowA ?? 80) / 100, 0, 1), n = A > 0.85 ? 3 : A > 0.55 ? 2 : 1; for (let i = 0; i < n; i++) shade(e.glowColor || '#ffe25c', e.glow / 100 * fs * (0.5 + i * 0.35), 0, 0, Math.min(1, A * 1.15)); }
  if (sw2 > 0) stroke((sw + sw2) * 2, e.sc2 || '#111111', offs);
  if (steps) { stroke(sw * 2, sc, offs); g.fillStyle = e.extColor || '#111111'; for (const [ox, oy] of offs.slice(0, -1)) glyphPass(g, L, ox, oy, gl => g.fillText(gl.ch, 0, yo)); }
  stroke(sw * 2, sc, [[0, 0]]);
  const gb = L.gb || { x0: -fs, x1: fs };
  glyphPass(g, L, 0, 0, gl => {
    if (e.fillGrad) { const gr = e.gradDir === 'h' ? g.createLinearGradient((gb.x0 - gl.x) / gl.sc, 0, (gb.x1 - gl.x) / gl.sc, 0) : g.createLinearGradient(0, -fs * 0.5, 0, fs * 0.5); gr.addColorStop(0, color); gr.addColorStop(1, e.fill2 || color); g.fillStyle = gr; } else g.fillStyle = color;
    g.fillText(gl.ch, 0, yo);
  });
  g.restore();
}
// 거칠게: 다 그린 글자를 가로·세로로 조금씩 밀어 손으로 그은 듯 울퉁불퉁하게 하고, 세면 마른 붓 자국도 내요
const roughCache = new Map();
function noise1(rnd, fs) { const ph = [rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9], f = [1 / (fs * 0.9), 1 / (fs * 0.33), 1 / (fs * 0.12), 1 / (fs * 0.05)]; return t => Math.sin(t * f[0] * 6.28 + ph[0]) * 0.55 + Math.sin(t * f[1] * 6.28 + ph[1]) * 0.3 + Math.sin(t * f[2] * 6.28 + ph[2]) * 0.18 + Math.sin(t * f[3] * 6.28 + ph[3]) * 0.08; }
function roughText(e, L, s) {
  const key = [e.id, e.text, ...LOOK_KEYS.map(k => e[k]), s].join('|'); let c = roughCache.get(key); if (c) return c;
  const mk = (w, h) => { const x = document.createElement('canvas'); x.width = w; x.height = h; return x; }, W = Math.max(1, Math.ceil(L.w * s)), H = Math.max(1, Math.ceil(L.h * s)), fs = e.size || 32;
  const a = mk(W, H), ga = a.getContext('2d'); ga.setTransform(s, 0, 0, s, W / 2, H / 2); paintText(ga, e, L);
  const amp = e.rough / 100 * fs * 0.05 * s, rnd = seeded((e.id || '') + 'r' + (e.seed || 1)), nx = noise1(rnd, fs), ny = noise1(rnd, fs), b = mk(W, H), gb = b.getContext('2d'), st = Math.max(1, Math.round(s));
  for (let y = 0; y < H; y += st) gb.drawImage(a, 0, y, W, st, nx(y / s) * amp, y, W, st);
  c = mk(W, H); const gc = c.getContext('2d'); for (let x = 0; x < W; x += st) gc.drawImage(b, x, 0, st, H, x, ny(x / s) * amp, st, H);
  if (e.rough > 30) { gc.globalCompositeOperation = 'destination-out'; gc.fillStyle = '#000'; const cnt = Math.round(W * H / (s * s) / (fs * fs) * 260 * (e.rough - 30) / 70); gc.beginPath(); for (let i = 0; i < cnt; i++) { const x = rnd() * W, y = rnd() * H, r = (0.4 + rnd() * 1.1) * s * fs / 90; gc.moveTo(x + r, y); gc.arc(x, y, r, 0, 6.283); } gc.fill(); }
  if (roughCache.size > 40) roughCache.delete(roughCache.keys().next().value); roughCache.set(key, c); return c;
}
// 가운데(cx, cy)에 그려요. 돌려주는 값 = 차지하는 크기 { w, h }
export function drawLettering(g, e, cx, cy) {
  const L = textLayout(e); g.save(); g.translate(cx, cy); if ((e.op ?? 100) < 100) g.globalAlpha *= e.op / 100;
  if (!(e.rough > 0)) paintText(g, e, L);
  else { const t = g.getTransform(), rs = Math.hypot(t.a, t.b) || 1, q = Math.pow(2, Math.round(Math.log2(Math.max(0.05, rs)) * 2) / 2), s = Math.min(q, 2600 / L.w, 2600 / L.h); g.drawImage(roughText(e, L, s), -L.w / 2, -L.h / 2, L.w, L.h); }
  g.restore(); return { w: L.w, h: L.h };
}
