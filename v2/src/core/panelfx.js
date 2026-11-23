// 컷 분위기와 효과 (8.x에서 옮김): 그림 보정, 색 입히기, 한쪽에서 물들이기, 가장자리 어둡게, 스크린톤, 효과선(집중선·속도선).
// 값은 컷 요소에 그대로 들어가고(없으면 FX의 기본값), 컷 모양으로 잘린 안쪽에만 그려요.
const DEG = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const FX = {
  bright: 100, contrast: 100, saturate: 100, blur: 0, sepia: 0, gray: false,
  tintOn: false, tintColor: '#1d3b8f', tintA: 35, tintMode: 'multiply',
  gradOn: false, gradColor: '#000000', gradA: 70, gradDir: 'bottom', gradLen: 60, gradMode: 'source-over',
  vigOn: false, vigColor: '#000000', vigA: 60, vigSize: 55,
  toneOn: false, toneType: 'dot', toneGap: 8, toneSize: 45, toneAngle: 45, toneColor: '#000000', toneA: 100, toneFade: 'none',
  lineOn: false, lineType: 'focus', lineColor: '#000000', lineA: 100, lineN: 140, lineIn: 45, lineW: 4, lineCx: 50, lineCy: 50, lineAng: 0,
};
export const FX_KEYS = Object.keys(FX);
export const MOODS = [
  ['없음', {}],
  ['밤', { tintOn: true, tintColor: '#1b2f7a', tintA: 45, tintMode: 'multiply', vigOn: true, vigColor: '#00000f', vigA: 55, vigSize: 50, bright: 90, saturate: 80 }],
  ['회상', { sepia: 70, contrast: 90, bright: 105, vigOn: true, vigColor: '#3a2614', vigA: 50, vigSize: 55 }],
  ['몽환', { bright: 110, contrast: 88, saturate: 110, blur: 1, tintOn: true, tintColor: '#ffc4e6', tintA: 30, tintMode: 'screen', vigOn: true, vigColor: '#ffffff', vigA: 70, vigSize: 50 }],
  ['긴장', { contrast: 120, saturate: 80, vigOn: true, vigColor: '#4a0000', vigA: 60, vigSize: 45, lineOn: true, lineType: 'focus', lineColor: '#000000', lineA: 85, lineN: 120, lineIn: 55, lineW: 3 }],
  ['공포', { bright: 80, contrast: 130, saturate: 60, tintOn: true, tintColor: '#2a0b3a', tintA: 35, tintMode: 'multiply', vigOn: true, vigColor: '#000000', vigA: 80, vigSize: 40 }],
  ['흑백 톤', { gray: true, contrast: 115, toneOn: true, toneType: 'dot', toneGap: 6, toneSize: 40, toneAngle: 45, toneColor: '#000000', toneA: 55, toneFade: 'top' }],
  ['노을', { tintOn: true, tintColor: '#ff8a3d', tintA: 30, tintMode: 'soft-light', gradOn: true, gradColor: '#ff5e3a', gradA: 45, gradDir: 'top', gradLen: 70, gradMode: 'multiply', bright: 102 }],
  ['속도감', { lineOn: true, lineType: 'speed', lineColor: '#ffffff', lineA: 90, lineN: 160, lineIn: 30, lineW: 4, lineAng: 0, contrast: 108 }],
];
const fx = (e, k) => e[k] ?? FX[k];
export const hasFx = e => FX_KEYS.some(k => e[k] !== undefined && e[k] !== FX[k]);
const rgba = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; };
function seeded(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// 컷 안의 그림에 거는 보정 (그리기 전에 g.filter에 넣어요). scale = 지금 그리는 배율 (흐림은 화면 크기에 맞춰요)
export function imageFilter(e, scale = 1) {
  const p = [];
  if (fx(e, 'bright') !== 100) p.push(`brightness(${fx(e, 'bright')}%)`); if (fx(e, 'contrast') !== 100) p.push(`contrast(${fx(e, 'contrast')}%)`); if (fx(e, 'saturate') !== 100) p.push(`saturate(${fx(e, 'saturate')}%)`);
  if (fx(e, 'sepia')) p.push(`sepia(${fx(e, 'sepia')}%)`); if (fx(e, 'gray')) p.push('grayscale(100%)'); if (fx(e, 'blur')) p.push(`blur(${(fx(e, 'blur') * scale).toFixed(2)}px)`);
  return p.join(' ') || 'none';
}
const GRAD_DIRS = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const cache = new Map();
const cached = (key, make) => { let c = cache.get(key); if (!c) { c = make(); if (cache.size > 40) cache.delete(cache.keys().next().value); cache.set(key, c); } return c; };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
// 스크린톤 그림: 망점·줄·그물·모래. 한쪽으로 갈수록 옅어지게 할 수 있어요
function toneLayer(e, s) {
  const key = ['tone', e.id, Math.round(e.w), Math.round(e.h), s, fx(e, 'toneType'), fx(e, 'toneGap'), fx(e, 'toneSize'), fx(e, 'toneAngle'), fx(e, 'toneColor'), fx(e, 'toneFade')].join('|');
  return cached(key, () => {
    const W = Math.max(1, Math.round(e.w * s)), H = Math.max(1, Math.round(e.h * s)), c = mk(W, H), g = c.getContext('2d'), type = fx(e, 'toneType'), G = Math.max(2.5, fx(e, 'toneGap')) * s, size = fx(e, 'toneSize') / 100, ang = fx(e, 'toneAngle') * DEG, fade = fx(e, 'toneFade');
    g.fillStyle = fx(e, 'toneColor');
    const fadeF = (x, y) => { const u = x / W, v = y / H; return fade === 'top' ? smooth(v * 1.15) : fade === 'bottom' ? smooth((1 - v) * 1.15) : fade === 'left' ? smooth(u * 1.15) : fade === 'right' ? smooth((1 - u) * 1.15) : fade === 'center' ? smooth(Math.hypot(u - 0.5, v - 0.5) * 1.6) : fade === 'edge' ? smooth(1 - Math.hypot(u - 0.5, v - 0.5) * 1.5) : 1; };
    const D = Math.hypot(W, H), n = Math.ceil(D / 2 / G) + 2, cx = W / 2, cy = H / 2, co = Math.cos(ang), si = Math.sin(ang);
    g.beginPath();
    if (type === 'dot') { for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const x = cx + i * G * co - j * G * si, y = cy + i * G * si + j * G * co; if (x < -G || y < -G || x > W + G || y > H + G) continue; const r = G * 0.62 * size * fadeF(x, y); if (r < 0.2) continue; g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); } }
    else if (type === 'line' || type === 'cross') {
      for (const a of type === 'cross' ? [ang, ang + Math.PI / 2] : [ang]) { const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux, step = Math.max(2, G / 2);
        for (let j = -n; j <= n; j++) { const bx = cx + px * j * G, by = cy + py * j * G, top = [], bot = []; for (let t = -D / 2; t <= D / 2 + step; t += step) { const x = bx + ux * t, y = by + uy * t, th = G * size * 0.9 * fadeF(clamp(x, 0, W), clamp(y, 0, H)) / 2; top.push([x + px * th, y + py * th]); bot.push([x - px * th, y - py * th]); } g.moveTo(top[0][0], top[0][1]); for (const q of top) g.lineTo(q[0], q[1]); for (let q = bot.length - 1; q >= 0; q--) g.lineTo(bot[q][0], bot[q][1]); g.closePath(); } }
    } else { const rnd = seeded(e.id + 'sand'), cnt = Math.min(300000, Math.round(W * H / (G * G) * 2.2)); for (let i = 0; i < cnt; i++) { const x = rnd() * W, y = rnd() * H; if (rnd() > fadeF(x, y)) continue; const r = G * (0.12 + size * 0.22) * (0.6 + rnd() * 0.8); g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); } }
    g.fill(); return c;
  });
}
// 효과선: 집중선(한 점으로 모이는 선)과 속도선(한 방향으로 흐르는 선). 컷 좌표에 바로 그려요
function drawLines(g, e) {
  const W = e.w, H = e.h, N = clamp(fx(e, 'lineN') | 0, 4, 600), inner = fx(e, 'lineIn') / 100, lw = fx(e, 'lineW') * Math.max(W, H) / 800, rnd = seeded(e.id + 'ln' + (e.seed || 1));
  g.save(); g.translate(e.x, e.y); g.globalAlpha *= fx(e, 'lineA') / 100; g.fillStyle = fx(e, 'lineColor'); g.beginPath();
  if (fx(e, 'lineType') === 'focus') {
    const cx = W * fx(e, 'lineCx') / 100, cy = H * fx(e, 'lineCy') / 100, R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.05, rin = R * inner;
    for (let i = 0; i < N; i++) { const t = (i + rnd() * 0.9) / N * Math.PI * 2, ux = Math.cos(t), uy = Math.sin(t), px = -uy, py = ux, r0 = rin * (0.78 + rnd() * 0.5), wo = lw * (0.35 + rnd() * 1.3); g.moveTo(cx + ux * r0, cy + uy * r0); g.lineTo(cx + ux * R + px * wo, cy + uy * R + py * wo); g.lineTo(cx + ux * R - px * wo, cy + uy * R - py * wo); g.closePath(); }
  } else {
    const a = fx(e, 'lineAng') * DEG, ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux, D = Math.hypot(W, H), cx = W / 2, cy = H / 2;
    for (let i = 0; i < N; i++) { let off = (rnd() - 0.5) * D; const band = inner * D * 0.25; if (Math.abs(off) < band) off = Math.sign(off || 1) * (band + rnd() * (D / 2 - band) * 0.3);
      const len = D * (0.2 + rnd() * 0.55), t0 = (rnd() - 0.5) * D * 0.7, wd = lw * (0.3 + rnd() * 1.1), mx = cx + ux * t0 + px * off, my = cy + uy * t0 + py * off, ax = mx - ux * len / 2, ay = my - uy * len / 2, bx = mx + ux * len / 2, by = my + uy * len / 2;
      g.moveTo(ax, ay); g.quadraticCurveTo(mx + px * wd, my + py * wd, bx, by); g.quadraticCurveTo(mx - px * wd, my - py * wd, ax, ay); g.closePath(); }
  }
  g.fill(); g.restore();
}
// 그림 위에 얹는 효과들 (컷 모양으로 이미 잘려 있어요)
export function drawPanelFx(g, e) {
  const { x, y, w, h } = e;
  if (fx(e, 'tintOn')) { g.save(); g.globalCompositeOperation = fx(e, 'tintMode'); g.fillStyle = rgba(fx(e, 'tintColor'), fx(e, 'tintA') / 100); g.fillRect(x, y, w, h); g.restore(); }
  if (fx(e, 'gradOn')) {
    const [dx, dy] = GRAD_DIRS[fx(e, 'gradDir')] || GRAD_DIRS.bottom, cx = x + w / 2, cy = y + h / 2, sx = cx + dx * w / 2, sy = cy + dy * h / 2, span = (dx ? w : h) * fx(e, 'gradLen') / 100, gr = g.createLinearGradient(sx, sy, sx - dx * span, sy - dy * span), col = fx(e, 'gradColor'), A = fx(e, 'gradA') / 100;
    gr.addColorStop(0, rgba(col, A)); gr.addColorStop(1, rgba(col, 0)); g.save(); g.globalCompositeOperation = fx(e, 'gradMode'); g.fillStyle = gr; g.fillRect(x, y, w, h); g.restore();
  }
  if (fx(e, 'vigOn')) { g.save(); g.translate(x + w / 2, y + h / 2); g.scale(w / 2, h / 2); const ri = fx(e, 'vigSize') / 100, gr = g.createRadialGradient(0, 0, ri * 0.7, 0, 0, ri * 0.7 + 0.85), col = fx(e, 'vigColor'); gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, fx(e, 'vigA') / 100)); g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore(); }
  if (fx(e, 'toneOn')) { const t = g.getTransform(), rs = Math.hypot(t.a, t.b) || 1, s = Math.min(Math.pow(2, Math.round(Math.log2(Math.max(0.1, rs)) * 2) / 2), 2200 / Math.max(w, h)); g.save(); g.globalAlpha *= fx(e, 'toneA') / 100; g.drawImage(toneLayer(e, s), x, y, w, h); g.restore(); }
  if (fx(e, 'lineOn')) drawLines(g, e);
}
