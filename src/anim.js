/* ================= 움짤 연출: 글자·스티커 애니메이션, 효과(입자·화면), 특수 장면 넘김(WebGL) ================= */
// 움직임 = Animate.css 4.1.1의 97가지(MIT)를 숫자로 옮긴 것 + 글자 전용 효과
// 장면 넘김 = gl-transitions 196가지(MIT) — presets.js

/* ---- CSS cubic-bezier ---- */
const bezC = new Map();
function bezier(e) {
  const k = e.join(','); if (bezC.has(k)) return bezC.get(k);
  const [x1, y1, x2, y2] = e, cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, Y = t => ((ay * t + by) * t + cy) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  const f = x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x; for (let i = 0; i < 8; i++) { const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= (X(t) - x) / d; }
    if (t < 0 || t > 1 || Math.abs(X(t) - x) > 1e-3) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { t = (lo + hi) / 2; if (X(t) < x) lo = t; else hi = t; } }
    return Y(t);
  };
  bezC.set(k, f); return f;
}
const frac = v => ((v % 1) + 1) % 1;
const ANIM_P = ['tx', 'ty', 'sx', 'sy', 'r', 'rx', 'ry', 'kx', 'ky'], ANIM_ID = { tx: 0, ty: 0, sx: 1, sy: 1, r: 0, rx: 0, ry: 0, kx: 0, ky: 0, op: 1 };
const animStops = new Map();
function animPrep(name) { // 속성마다 [시점, 값, 이징] 목록
  if (animStops.has(name)) return animStops.get(name);
  const A = ANIM_CSS[name]; if (!A) return null;
  const def = A.ease || [0.25, 0.1, 0.25, 1], easeAt = new Map();
  for (const [o, f] of A.kf) if (f.ease) easeAt.set(o, f.ease);
  const idv = p => p === 'tx' || p === 'ty' ? [0, 'px'] : ANIM_ID[p], S = {};
  for (const p of ANIM_P.concat('op')) {
    const st = [];
    for (const [o, f] of A.kf) {
      if (p === 'op' ? f.op === undefined : !f._t) continue;
      const v = f[p] === undefined ? idv(p) : f[p], e = easeAt.get(o) || def;
      if (st.length && st[st.length - 1][0] === o) st[st.length - 1] = [o, v, e]; else st.push([o, v, e]);
    }
    if (!st.length || st[0][0] > 0) st.unshift([0, idv(p), easeAt.get(0) || def]);
    if (st[st.length - 1][0] < 1) st.push([1, idv(p), def]);
    S[p] = st;
  }
  const o = String(A.origin || 'center').split(/\s+/);
  const R = { S, ox: o.includes('left') ? -0.5 : o.includes('right') ? 0.5 : 0, oy: o.includes('top') ? -0.5 : o.includes('bottom') ? 0.5 : 0, dur: A.dur || 1 };
  animStops.set(name, R); return R;
}
// 진행도 p(0~1)의 모양. w·h = 요소 크기, base = px 단위 배율 (화면 짧은 쪽 1000 기준)
function animAt(name, p, w, h, base) {
  const R = animPrep(name), o = { ...ANIM_ID, ox: 0, oy: 0 }; if (!R) return o;
  for (const k in R.S) {
    const st = R.S[k]; let i = 0; while (i < st.length - 2 && p > st[i + 1][0]) i++;
    const a = st[i], b = st[i + 1] || a, span = b[0] - a[0], q = span > 0 ? bezier(a[2])(clamp((p - a[0]) / span, 0, 1)) : 1;
    const val = v => Array.isArray(v) ? v[0] * (v[1] === '%' ? (k === 'tx' ? w : h) / 100 : base) : v;
    o[k] = val(a[1]) + (val(b[1]) - val(a[1])) * q;
  }
  o.ox = R.ox * w; o.oy = R.oy * h; return o;
}
function animApply(ctx, o) {
  ctx.translate(o.tx + o.ox, o.ty + o.oy);
  if (o.r) ctx.rotate(o.r * DEG);
  if (o.kx || o.ky) ctx.transform(1, Math.tan(o.ky * DEG), Math.tan(o.kx * DEG), 1, 0, 0);
  let sx = o.sx * Math.cos(o.ry * DEG), sy = o.sy * Math.cos(o.rx * DEG);
  if (Math.abs(sx) < 1e-3) sx = 1e-3; if (Math.abs(sy) < 1e-3) sy = 1e-3;
  ctx.scale(sx, sy); ctx.translate(-o.ox, -o.oy);
  ctx.globalAlpha *= clamp(o.op, 0, 1);
}
const AN_KO = {
  bounce: '통통', flash: '깜빡', pulse: '두근', rubberBand: '고무줄', shakeX: '좌우 흔들', shakeY: '위아래 흔들', headShake: '도리도리', swing: '그네', tada: '짜잔', wobble: '흐느적', jello: '젤리', heartBeat: '심장 박동', flip: '한 바퀴 뒤집기',
  backInDown: '위에서 뒤로 물러나며', backInUp: '아래에서 뒤로 물러나며', backInLeft: '왼쪽에서 뒤로 물러나며', backInRight: '오른쪽에서 뒤로 물러나며',
  bounceIn: '튀어나오기', bounceInDown: '위에서 튀어', bounceInUp: '아래에서 튀어', bounceInLeft: '왼쪽에서 튀어', bounceInRight: '오른쪽에서 튀어',
  fadeIn: '서서히', fadeInDown: '위에서 서서히', fadeInUp: '아래에서 서서히', fadeInLeft: '왼쪽에서 서서히', fadeInRight: '오른쪽에서 서서히', fadeInDownBig: '멀리 위에서 서서히', fadeInUpBig: '멀리 아래에서 서서히', fadeInLeftBig: '멀리 왼쪽에서 서서히', fadeInRightBig: '멀리 오른쪽에서 서서히',
  fadeInTopLeft: '왼쪽 위에서 서서히', fadeInTopRight: '오른쪽 위에서 서서히', fadeInBottomLeft: '왼쪽 아래에서 서서히', fadeInBottomRight: '오른쪽 아래에서 서서히',
  flipInX: '가로로 뒤집으며', flipInY: '세로로 뒤집으며', lightSpeedInRight: '빛처럼 오른쪽에서', lightSpeedInLeft: '빛처럼 왼쪽에서',
  rotateIn: '돌며', rotateInDownLeft: '왼쪽 아래 축으로 돌며', rotateInDownRight: '오른쪽 아래 축으로 돌며', rotateInUpLeft: '왼쪽 위 축으로 돌며', rotateInUpRight: '오른쪽 위 축으로 돌며',
  jackInTheBox: '깜짝 상자', rollIn: '굴러오기', zoomIn: '커지며', zoomInDown: '위에서 커지며', zoomInUp: '아래에서 커지며', zoomInLeft: '왼쪽에서 커지며', zoomInRight: '오른쪽에서 커지며',
  slideInDown: '위에서 미끄러져', slideInUp: '아래에서 미끄러져', slideInLeft: '왼쪽에서 미끄러져', slideInRight: '오른쪽에서 미끄러져',
  backOutDown: '아래로 물러나며', backOutUp: '위로 물러나며', backOutLeft: '왼쪽으로 물러나며', backOutRight: '오른쪽으로 물러나며',
  bounceOut: '튀며 사라지기', bounceOutDown: '아래로 튀며', bounceOutUp: '위로 튀며', bounceOutLeft: '왼쪽으로 튀며', bounceOutRight: '오른쪽으로 튀며',
  fadeOut: '서서히', fadeOutDown: '아래로 서서히', fadeOutUp: '위로 서서히', fadeOutLeft: '왼쪽으로 서서히', fadeOutRight: '오른쪽으로 서서히', fadeOutDownBig: '멀리 아래로', fadeOutUpBig: '멀리 위로', fadeOutLeftBig: '멀리 왼쪽으로', fadeOutRightBig: '멀리 오른쪽으로',
  fadeOutTopLeft: '왼쪽 위로', fadeOutTopRight: '오른쪽 위로', fadeOutBottomLeft: '왼쪽 아래로', fadeOutBottomRight: '오른쪽 아래로',
  flipOutX: '가로로 뒤집으며', flipOutY: '세로로 뒤집으며', lightSpeedOutRight: '빛처럼 오른쪽으로', lightSpeedOutLeft: '빛처럼 왼쪽으로',
  rotateOut: '돌며', rotateOutDownLeft: '왼쪽 아래 축으로 돌며', rotateOutDownRight: '오른쪽 아래 축으로 돌며', rotateOutUpLeft: '왼쪽 위 축으로 돌며', rotateOutUpRight: '오른쪽 위 축으로 돌며',
  hinge: '경첩 떨어지기', rollOut: '굴러가기', zoomOut: '작아지며', zoomOutDown: '아래로 작아지며', zoomOutUp: '위로 작아지며', zoomOutLeft: '왼쪽으로 작아지며', zoomOutRight: '오른쪽으로 작아지며',
  slideOutDown: '아래로 미끄러져', slideOutUp: '위로 미끄러져', slideOutLeft: '왼쪽으로 미끄러져', slideOutRight: '오른쪽으로 미끄러져',
};
const anName = n => (AN_KO[n] ? `${AN_KO[n]} (${n})` : n);
const AN_ALL = Object.keys(ANIM_CSS);
const AN_LOOP = ['bounce', 'flash', 'pulse', 'rubberBand', 'shakeX', 'shakeY', 'headShake', 'swing', 'tada', 'wobble', 'jello', 'heartBeat', 'flip'].filter(n => ANIM_CSS[n]);
const AN_IN = AN_ALL.filter(n => /In/.test(n) && !/Out/.test(n));
const AN_OUT = AN_ALL.filter(n => /Out/.test(n) || n === 'hinge');
const TX_IN = [['type', '타자기 (한 글자씩 찍기)'], ['blur', '흐릿하다 또렷하게'], ['drop', '위에서 툭 떨어지기']];
const TX_LOOP = [['wave', '물결'], ['float', '둥실둥실'], ['shiver', '덜덜 떨기'], ['rainbow', '무지개 색'], ['flicker', '네온 깜빡임'], ['neon', '네온 숨쉬기'], ['glitch', '글리치']];
const TX_LOOP_K = new Set(TX_LOOP.map(x => x[0]));
const hash1 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

/* ---- 글자·스티커 (gs.ovs) ---- */
gs.ovs = []; gs.fx = []; gs.osel = null; gs.fsel = null; gs.focus = 'set'; // 오른쪽 속성 칸에 보일 것: set(전체) scene ov fx tr
const OV_DEF = () => ({ id: uid(), kind: 'text', text: '글자를 입력하세요', st: { font: doc.defaults.text.font, fs: 80, color: '#ffffff', bold: true, sc: '#111111', sw: 8, glow: 0, glowColor: '#ffe25c' }, x: 0.5, y: 0.82, sc: 1, rot: 0, t0: 0, t1: null, ain: { n: 'bounceIn', d: 0.7 }, aout: { n: '', d: 0.5 }, aloop: { n: '', d: 1.2 }, per: false, gap: 0.06 });
const ovT1 = o => o.t1 == null ? gsTotal() : o.t1;
const fmtT = v => (+v || 0).toFixed(1);
function ovEl(o, text) { // 편집기의 글자 요소와 똑같이 그려요 (글꼴·테두리·후광·그림자)
  const el = { ...clone(doc.defaults.text), ...o.st, id: 'ov', type: 'text', x: 0, y: 0, w: 10, h: 10, rot: 0, seed: 1, text };
  fitText(el); return el;
}
const ovCache = new Map();
function ovBitmap(o, text, s) { // s = 출력 배율 (짧은 쪽 / 1000)
  const key = JSON.stringify([o.st, text, Math.round(s * 200), fontGen]);
  let r = ovCache.get(key); if (r) return r;
  const el = ovEl(o, text), pad = el.fs * 0.25 + 4;
  const W = Math.max(2, Math.ceil((el.w + pad * 2) * s)), H = Math.max(2, Math.ceil((el.h + pad * 2) * s)), c = newCanvas(W, H), g = c.getContext('2d');
  g.setTransform(s, 0, 0, s, (pad - el.x) * s, (pad - el.y) * s); drawEl(g, el, { screen: false, rs: s });
  r = { c, w: el.w * s, h: el.h * s, W, H }; ovCache.set(key, r);
  if (ovCache.size > 600) ovCache.delete(ovCache.keys().next().value);
  return r;
}
const ovGlyphC = new Map();
function ovGlyphs(o, s) { // 한 글자씩 놓을 자리
  const key = JSON.stringify([o.st, o.text, Math.round(s * 200), fontGen]);
  let r = ovGlyphC.get(key); if (r) return r;
  const el = ovEl(o, 'A'); mctx.font = fontStr(el);
  const lines = o.text.split('\n'), lh = el.fs * (el.lh || 1.1) * s, sp = (el.sp || 0) / 100 * el.fs * s, out = []; let n = 0;
  lines.forEach((L, li) => {
    const ch = [...L], adv = ch.map(c => mctx.measureText(c).width * s + sp), tw = adv.reduce((a, b) => a + b, 0) - (ch.length ? sp : 0);
    let x = -tw / 2;
    ch.forEach((c, j) => { if (c.trim()) out.push({ b: ovBitmap(o, c, s), dx: x + (adv[j] - sp) / 2, dy: (li - (lines.length - 1) / 2) * lh, i: n }); n++; x += adv[j]; });
  });
  r = { g: out, N: Math.max(1, n) }; ovGlyphC.set(key, r);
  if (ovGlyphC.size > 100) ovGlyphC.delete(ovGlyphC.keys().next().value);
  return r;
}
function ovImgLoad(o) {
  if (o.kind !== 'image' || !o.src) return Promise.resolve();
  if (o.bmp) return Promise.resolve();
  return loadImg(o.src).then(im => { o.bmp = im; }).catch(() => { });
}
function ovBox(o, W, H) { // 회전 전 반폭·반높이 (출력 px)
  const base = Math.min(W, H) / 1000, sc = o.sc || 1;
  if (o.kind === 'image') { const im = o.bmp; if (!im) return { hw: 40, hh: 40 }; const k = (o.size || 300) * base / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height); return { hw: (im.naturalWidth || im.width) * k / 2 * sc, hh: (im.naturalHeight || im.height) * k / 2 * sc }; }
  const b = ovBitmap(o, o.text || ' ', base); return { hw: b.w / 2 * sc, hh: b.h / 2 * sc };
}
function ovDraw(g, o, t, W, H) {
  const t0 = o.t0 || 0, t1 = ovT1(o); if (t < t0 || t > t1 + 1e-6) return;
  const lt = t - t0, left = t1 - t, base = Math.min(W, H) / 1000;
  const ain = o.ain && o.ain.n ? o.ain : null, aout = o.aout && o.aout.n ? o.aout : null, aloop = o.aloop && o.aloop.n ? o.aloop : null;
  const isText = o.kind !== 'image', per = isText && (o.per || (ain && ain.n === 'type')) && [...(o.text || '')].length > 1;
  let parts, N = 1;
  if (!isText) {
    const im = o.bmp; if (!im) return;
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height, k = (o.size || 300) * base / Math.max(iw, ih);
    parts = [{ c: im, W: iw * k, H: ih * k, w: iw * k, h: ih * k, dx: 0, dy: 0, i: 0 }];
  } else if (per) {
    const G = ovGlyphs(o, base); N = G.N;
    parts = G.g.map(x => ({ c: x.b.c, W: x.b.W, H: x.b.H, w: x.b.w, h: x.b.h, dx: x.dx, dy: x.dy, i: x.i }));
  } else { const b = ovBitmap(o, o.text || ' ', base); parts = [{ c: b.c, W: b.W, H: b.H, w: b.w, h: b.h, dx: 0, dy: 0, i: 0 }]; }
  if (!parts.length) return;
  const gapIn = per ? (ain && ain.n === 'type' ? ain.d / N : (o.gap ?? 0.06)) : 0, gapOut = o.per && per ? (o.gap ?? 0.06) : 0;
  const whole = isText && !per ? parts[0] : !isText ? parts[0] : { w: Math.max(...parts.map(p => Math.abs(p.dx) * 2 + p.w)), h: Math.max(...parts.map(p => Math.abs(p.dy) * 2 + p.h)) };
  g.save(); g.translate(o.x * W, o.y * H); if (o.rot) g.rotate(o.rot * DEG); g.scale(o.sc || 1, o.sc || 1);
  if (aloop && ANIM_CSS[aloop.n] && !o.per) animApply(g, animAt(aloop.n, frac(lt / Math.max(0.1, aloop.d)), whole.w, whole.h, base));
  for (const P of parts) {
    let vis = true, filt = '', gl = 0;
    g.save(); g.translate(P.dx, P.dy);
    if (ain) {
      const d = P.i * gapIn;
      if (ain.n === 'type') vis = lt >= d;
      else {
        const q = (lt - d) / Math.max(0.05, ain.d);
        if (q < 0) vis = false;
        else if (q < 1) {
          if (ain.n === 'blur') { g.globalAlpha *= Math.min(1, q * 1.6); filt += ` blur(${((1 - q) * 14 * base).toFixed(2)}px)`; }
          else if (ain.n === 'drop') { const e = bezier([0.34, 1.56, 0.64, 1])(q); g.translate(0, -(1 - e) * P.h * 2.2); g.globalAlpha *= Math.min(1, q * 4); }
          else if (ANIM_CSS[ain.n]) animApply(g, animAt(ain.n, q, P.w, P.h, base));
        }
      }
    }
    if (vis && aout && ANIM_CSS[aout.n]) {
      const q = 1 - (left - (N - 1 - P.i) * gapOut) / Math.max(0.05, aout.d);
      if (q >= 1) vis = false; else if (q > 0) animApply(g, animAt(aout.n, q, P.w, P.h, base));
    }
    if (vis && aloop) {
      const L = aloop.n, pd = Math.max(0.1, aloop.d);
      if (L === 'wave') g.translate(0, Math.sin((lt / pd - P.i * 0.12) * Math.PI * 2) * P.h * 0.16);
      else if (L === 'float') g.translate(0, Math.sin((lt / pd) * Math.PI * 2 + P.i * 0.6) * P.h * 0.08);
      else if (L === 'shiver') { const f = Math.floor(lt * 30); g.translate((hash1(f, P.i + 0.3) - 0.5) * P.h * 0.07, (hash1(P.i + 0.7, f) - 0.5) * P.h * 0.07); }
      else if (L === 'rainbow') filt += ` hue-rotate(${Math.round(frac(lt / pd + P.i * 0.07) * 360)}deg)`;
      else if (L === 'flicker') { const k = hash1(Math.floor(lt * 14), P.i * 3.1 + 1); g.globalAlpha *= k < 0.1 ? 0.12 : k < 0.18 ? 0.55 : 1; }
      else if (L === 'neon') filt += ` drop-shadow(0 0 ${((0.35 + 0.65 * (0.5 + 0.5 * Math.sin(lt / pd * Math.PI * 2))) * 16 * base).toFixed(1)}px ${o.st && o.st.glowColor || '#ffe25c'})`;
      else if (L === 'glitch') { const j = hash1(Math.floor(lt * 12), 7.7 + (o.per ? P.i : 0)); if (j < 0.35) gl = (j - 0.17) * P.h * 0.5; }
      else if (o.per && ANIM_CSS[L]) animApply(g, animAt(L, frac(lt / pd - P.i * 0.08), P.w, P.h, base));
    }
    if (vis) {
      if (filt) g.filter = filt.trim();
      g.drawImage(P.c, -P.W / 2, -P.H / 2, P.W, P.H);
      if (gl) { g.globalAlpha *= 0.55; g.filter = 'hue-rotate(160deg) saturate(3)'; g.drawImage(P.c, -P.W / 2 + gl, -P.H / 2, P.W, P.H); g.filter = 'hue-rotate(260deg) saturate(3)'; g.drawImage(P.c, -P.W / 2 - gl * 0.6, -P.H / 2 + gl * 0.15, P.W, P.H); }
    }
    g.restore();
  }
  g.restore();
}
// 빠른 꾸미기 (모양 + 움직임 묶음)
const OV_PRESETS = [
  { n: '예능 자막', st: { color: '#ffe94d', sc: '#1a1a1a', sw: 10, sw2: 0, glow: 0, bold: true, boxOn: false, shA: 0 }, ain: ['bounceIn', 0.6], aloop: ['', 1.2], aout: ['fadeOut', 0.3], per: false },
  { n: '쾅! 충격', st: { color: '#ff3b3b', sc: '#ffffff', sw: 10, sw2: 6, sc2: '#111111', glow: 0, bold: true, boxOn: false }, ain: ['zoomIn', 0.35], aloop: ['shiver', 1], aout: ['', 0.4], per: false },
  { n: '타자기 자막', st: { color: '#ffffff', sw: 0, sw2: 0, boxOn: true, boxColor: '#000000', boxA: 60, boxPad: 26, boxR: 14, glow: 0, bold: false }, ain: ['type', 1.2], aloop: ['', 1], aout: ['fadeOut', 0.4], per: false },
  { n: '한 글자씩 통통', st: { color: '#ffffff', sc: '#ff5c8a', sw: 9, glow: 0, bold: true, boxOn: false }, ain: ['bounceInDown', 0.7], aloop: ['bounce', 1.4], aout: ['', 0.4], per: true, gap: 0.07 },
  { n: '물결 글자', st: { color: '#bff4ff', sc: '#0b4b8c', sw: 8, glow: 0, bold: true, boxOn: false }, ain: ['fadeInUp', 0.5], aloop: ['wave', 1.4], aout: ['fadeOut', 0.4], per: true, gap: 0.05 },
  { n: '네온 사인', st: { color: '#ffffff', sc: '#ff3fa4', sw: 3, sw2: 0, glow: 45, glowColor: '#ff3fa4', glowA: 90, boxOn: false }, ain: ['fadeIn', 0.5], aloop: ['flicker', 1], aout: ['fadeOut', 0.4], per: false },
  { n: '무지개', st: { color: '#ff4d4d', sc: '#ffffff', sw: 8, glow: 0, bold: true, boxOn: false }, ain: ['bounceIn', 0.6], aloop: ['rainbow', 2], aout: ['', 0.4], per: true, gap: 0.04 },
  { n: '글리치', st: { color: '#ffffff', sc: '#111111', sw: 6, glow: 0, bold: true, boxOn: false }, ain: ['blur', 0.4], aloop: ['glitch', 1], aout: ['fadeOut', 0.2], per: false },
  { n: '심쿵', st: { color: '#ff5c8a', sc: '#ffffff', sw: 10, glow: 25, glowColor: '#ffb3c8', glowA: 70, bold: true, boxOn: false }, ain: ['zoomIn', 0.4], aloop: ['heartBeat', 1.3], aout: ['zoomOut', 0.4], per: false },
  { n: '오싹', st: { color: '#d90000', sc: '#000000', sw: 6, glow: 30, glowColor: '#000000', glowA: 80, bold: true, boxOn: false }, ain: ['blur', 1.2], aloop: ['shiver', 1], aout: ['fadeOut', 0.8], per: false },
  { n: '둥실둥실', st: { color: '#ffffff', sc: '#5a6cff', sw: 8, glow: 0, bold: true, boxOn: false }, ain: ['fadeInUp', 0.6], aloop: ['float', 2.4], aout: ['fadeOutUp', 0.6], per: true, gap: 0.05 },
  { n: '툭 떨어지기', st: { color: '#ffffff', sc: '#222222', sw: 9, glow: 0, bold: true, boxOn: false }, ain: ['drop', 0.5], aloop: ['', 1], aout: ['fadeOutDown', 0.4], per: true, gap: 0.08 },
  { n: '빛처럼 휙', st: { color: '#fff3b0', fillGrad: true, fill2: '#d18a00', gradDir: 'v', sc: '#5a3a00', sw: 5, glow: 20, glowColor: '#ffd24d', glowA: 60, boxOn: false }, ain: ['lightSpeedInLeft', 0.6], aloop: ['', 1], aout: ['lightSpeedOutRight', 0.5], per: false },
  { n: '영화 엔딩', st: { color: '#ffffff', sw: 0, sw2: 0, glow: 0, bold: false, shA: 55, shColor: '#000000', shDist: 4, shBlur: 10, boxOn: false }, ain: ['fadeIn', 1.2], aloop: ['', 1], aout: ['fadeOut', 1], per: false },
  { n: '짜잔!', st: { color: '#ffffff', sc: '#ff8a00', sw: 10, glow: 0, bold: true, boxOn: false }, ain: ['jackInTheBox', 0.8], aloop: ['tada', 1.5], aout: ['bounceOut', 0.6], per: false },
  { n: '경첩 퇴장', st: { color: '#ffffff', sc: '#111111', sw: 8, glow: 0, bold: true, boxOn: false }, ain: ['rollIn', 0.8], aloop: ['', 1], aout: ['hinge', 1.6], per: false },
];
const EMOJIS = ['❤️', '💖', '💕', '✨', '⭐', '🌟', '🔥', '💥', '💢', '💦', '💧', '💤', '❗', '❓', '‼️', '⁉️', '🎵', '🎶', '🎉', '👍', '👏', '👀', '💯', '🌸', '😂', '🤣', '😭', '😳', '🥺', '😍', '😡', '🤔', '😱', '🙄', '😎', '😇', '💀', '👻'];

/* ---- 효과 (gs.fx) ---- */
const FX_KINDS = [
  ['snow', '눈', 'p'], ['rain', '비', 'p'], ['sakura', '벚꽃잎', 'p'], ['hearts', '하트', 'p'], ['sparkle', '반짝이', 'p'], ['stars', '별빛', 'p'], ['confetti', '색종이', 'p'], ['bubbles', '비눗방울', 'p'], ['embers', '불티', 'p'], ['bokeh', '빛망울', 'p'],
  ['focus', '집중선', 's'], ['speed', '속도선', 's'], ['shake', '화면 흔들림', 's'], ['zoom', '줌 펀치', 's'], ['flash', '번쩍', 's'], ['invert', '색 반전 번쩍', 's'], ['glitch', '글리치', 's'], ['vhs', 'VHS 노이즈', 's'], ['grain', '필름 질감', 's'], ['leak', '빛 번짐', 's'], ['vignette', '비네팅 맥박', 's'], ['bw', '흑백', 's'],
  ['cam-rec', '캠코더 녹화', 'c'], ['cam-phone', '폰 촬영', 'c'], ['cam-vf', '뷰파인더', 'c'], ['cam-vhs', 'VHS 화면', 'c'], ['cam-cctv', 'CCTV', 'c'], ['cam-film', '필름 프레임', 'c'], ['cam-letterbox', '레터박스', 'c'],
];
const FXK = Object.fromEntries(FX_KINDS.map(x => [x[0], x]));
const FX_COLORS = { snow: '#ffffff', rain: '#a8c8ff', sakura: '#ffb7d2', hearts: '#ff4f7b', sparkle: '#fff6c8', stars: '#ffffff', confetti: '', bubbles: '#bfe8ff', embers: '#ff9a3c', bokeh: '#ffe2a8', focus: '#000000', speed: '#ffffff', flash: '#ffffff', leak: '#ff9a5a', vignette: '#000000' };
const FX_ONCE = { flash: 0.6, invert: 0.5, zoom: 0.6, shake: 0.8 }; // 한 번만 하는 효과의 기본 길이
function FX_DEF(k, t0 = 0) {
  if (k.startsWith('cam-')) { const D = TMPL_DEF(k.slice(4)); return { id: uid(), kind: k, t0, t1: null, color: '#ffffff', txt: D.txt, time: '00:00:00', date: D.date, lb: D.lb, grid: D.grid, speed: 1, amt: 1 }; }
  return { id: uid(), kind: k, t0, t1: FX_ONCE[k] ? Math.min(gsTotal(), t0 + FX_ONCE[k]) : null, n: { rain: 160, snow: 90, confetti: 110, focus: 90, speed: 50, bokeh: 22, stars: 70, sparkle: 36 }[k] || 50, speed: 1, size: 1, color: FX_COLORS[k] ?? '#ffffff', amt: 1, every: 0 };
}
const fxT1 = f => f.t1 == null ? gsTotal() : f.t1;
const FX_PRESETS = [
  ['눈 오는 밤', [['snow', { n: 120 }], ['vignette', { amt: 0.55 }]]],
  ['축하 파티', [['confetti', { n: 130 }], ['sparkle', { n: 40 }], ['flash', { amt: 0.7 }]]],
  ['설렘', [['hearts', { n: 30 }], ['bokeh', { n: 20, color: '#ffc4dc' }], ['leak', { color: '#ff8fc0', amt: 0.7 }]]],
  ['충격', [['zoom', {}], ['shake', {}], ['flash', {}], ['focus', { n: 110 }]]],
  ['공포', [['glitch', { amt: 0.8 }], ['vhs', {}], ['vignette', { amt: 0.9 }]]],
  ['회상', [['grain', {}], ['bw', { amt: 0.85 }], ['vignette', { amt: 0.6 }]]],
  ['벚꽃 엔딩', [['sakura', { n: 70 }], ['leak', { color: '#ffb3c8', amt: 0.6 }]]],
  ['비 오는 날', [['rain', { n: 220 }], ['vignette', { amt: 0.5, color: '#0a1428' }]]],
  ['반짝반짝', [['stars', { n: 80 }], ['sparkle', { n: 30 }]]],
  ['속도감', [['speed', { n: 60 }], ['shake', { amt: 0.4, t1: null }]]],
  ['불꽃', [['embers', { n: 80 }], ['leak', { color: '#ff6a00', amt: 0.7 }]]],
  ['옛날 비디오', [['vhs', {}], ['grain', { amt: 0.7 }]]],
];
let fxCopyC = null, fxNoiseC = null;
function fxCopy(g, W, H) {
  if (!fxCopyC || fxCopyC.width !== W || fxCopyC.height !== H) fxCopyC = newCanvas(W, H);
  const c = fxCopyC.getContext('2d'); c.clearRect(0, 0, W, H); c.drawImage(g.canvas, 0, 0); return fxCopyC;
}
function fxParticles(g, f, t, W, H) {
  const n = Math.round(clamp(f.n || 50, 1, 400)), sp = f.speed || 1, S = Math.min(W, H) / 1000 * (f.size || 1), lt = t - (f.t0 || 0);
  const fade = clamp(Math.min(lt / 0.4, (fxT1(f) - t) / 0.4, 1), 0, 1), k = f.kind, col = f.color || '#ffffff';
  const CONF = ['#ff5a5a', '#ffd23f', '#3fd2a0', '#3fa7ff', '#b26bff', '#ff8fd1'];
  g.save();
  for (let i = 0; i < n; i++) {
    const r1 = hash1(i, 1.3), r2 = hash1(i, 2.7), r3 = hash1(i, 3.9), r4 = hash1(i, 5.1);
    if (k === 'stars' || k === 'sparkle' || k === 'bokeh') { // 제자리에서 반짝
      const x = r1 * W, y = r2 * H, tw = 0.5 + 0.5 * Math.sin((lt * sp * (0.6 + r3 * 1.6) + r4 * 6.28) * 2.4);
      const a = k === 'bokeh' ? 0.18 + 0.3 * tw : Math.pow(tw, 3), sz = (k === 'bokeh' ? 40 + r3 * 70 : k === 'stars' ? 4 + r3 * 6 : 8 + r3 * 14) * S;
      g.globalAlpha = a * fade; g.fillStyle = col;
      if (k === 'bokeh') { g.beginPath(); g.arc(x + Math.sin(lt * 0.4 + i) * 12 * S, y + Math.cos(lt * 0.3 + i) * 10 * S, sz, 0, 7); g.fill(); }
      else { g.beginPath(); for (let j = 0; j < 8; j++) { const an = j * Math.PI / 4, rr = j % 2 ? sz * 0.2 : sz; g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr); } g.closePath(); g.fill(); }
      continue;
    }
    // 내리거나 오르는 것: 시간으로 바로 자리를 정해요 (어느 시점이든 같은 그림)
    const up = k === 'bubbles' || k === 'embers';
    const vy = ({ rain: 1500, confetti: 380, embers: 170, bubbles: 120, sakura: 150, hearts: 110 }[k] || 95) * (0.6 + r3 * 0.8) * sp * S;
    const span = H + 140 * S, yy = frac((r2 * span + vy * lt) / span) * span - 70 * S, y = up ? H - yy : yy;
    const sway = k === 'rain' ? lt * vy * 0.12 : Math.sin(lt * (0.6 + r4) * sp + i) * (k === 'snow' ? 30 : 48) * S;
    const x = frac((r1 * W + sway) / (W + 40)) * (W + 40) - 20;
    const sz = ({ rain: 1.5, confetti: 10, bubbles: 10 + r4 * 20, embers: 2.6, sakura: 10, hearts: 13 }[k] || 3 + r4 * 4) * S * (0.7 + r3 * 0.6);
    g.save(); g.translate(x, y); g.globalAlpha = fade * (k === 'embers' ? 0.45 + 0.55 * Math.abs(Math.sin(lt * 6 + i)) : 1);
    if (k === 'rain') { g.strokeStyle = col; g.lineWidth = sz; g.globalAlpha *= 0.55; g.beginPath(); g.moveTo(0, 0); g.lineTo(-sz * 2.5, -sz * 24); g.stroke(); }
    else if (k === 'snow' || k === 'embers') { g.fillStyle = col; if (k === 'embers') { g.shadowColor = col; g.shadowBlur = sz * 4; } g.beginPath(); g.arc(0, 0, sz, 0, 7); g.fill(); }
    else if (k === 'bubbles') { g.strokeStyle = col; g.lineWidth = Math.max(1, sz * 0.1); g.globalAlpha *= 0.75; g.beginPath(); g.arc(0, 0, sz, 0, 7); g.stroke(); g.globalAlpha *= 0.6; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-sz * 0.35, -sz * 0.35, sz * 0.18, 0, 7); g.fill(); }
    else if (k === 'confetti') { g.rotate(lt * 3 * (r4 - 0.5) * sp + i); g.scale(1, Math.cos(lt * 5 * sp + i)); g.fillStyle = f.color || CONF[i % CONF.length]; g.fillRect(-sz / 2, -sz * 0.3, sz, sz * 0.6); }
    else if (k === 'sakura') { g.rotate(lt * 1.5 * sp + i); g.scale(1, 0.55 + 0.45 * Math.cos(lt * 2.2 * sp + i)); g.fillStyle = col; g.beginPath(); g.moveTo(0, -sz); g.quadraticCurveTo(sz * 0.9, -sz * 0.2, 0, sz); g.quadraticCurveTo(-sz * 0.9, -sz * 0.2, 0, -sz); g.fill(); }
    else if (k === 'hearts') { g.rotate(Math.sin(lt * 2 + i) * 0.3); g.fillStyle = col; g.beginPath(); g.moveTo(0, sz * 0.35); g.bezierCurveTo(-sz * 1.1, -sz * 0.4, -sz * 0.4, -sz * 1.1, 0, -sz * 0.45); g.bezierCurveTo(sz * 0.4, -sz * 1.1, sz * 1.1, -sz * 0.4, 0, sz * 0.35); g.fill(); }
    g.restore();
  }
  g.restore();
}
function fxScreen(g, f, t, W, H) {
  const lt = t - (f.t0 || 0), A = f.amt ?? 1, sp = f.speed || 1, k = f.kind, S = Math.min(W, H) / 1000;
  const q = f.every > 0 ? lt % f.every : lt; // 한 번 또는 되풀이
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (k === 'shake' || k === 'zoom') {
    const c = fxCopy(g, W, H); let dx = 0, dy = 0, z = 1;
    if (k === 'shake') { const a = 18 * S * A; dx = Math.sin(lt * 61 * sp) * a; dy = Math.cos(lt * 47 * sp) * a * 0.8; z = 1 + 0.045 * A; }
    else z = 1 + 0.16 * A * Math.pow(Math.max(0, 1 - q / 0.45), 3);
    g.fillStyle = gs.set.bg; g.fillRect(0, 0, W, H); g.translate(W / 2 + dx, H / 2 + dy); g.scale(z, z); g.drawImage(c, -W / 2, -H / 2);
  } else if (k === 'flash' || k === 'invert') {
    const a = Math.max(0, 1 - q / 0.3) * A;
    if (a > 0) { if (k === 'invert') { g.globalCompositeOperation = 'difference'; g.fillStyle = '#ffffff'; g.globalAlpha = Math.min(1, a); } else { g.fillStyle = f.color || '#ffffff'; g.globalAlpha = Math.min(1, a * 0.9); } g.fillRect(0, 0, W, H); }
  } else if (k === 'glitch') {
    const fr = Math.floor(lt * 14 * sp);
    if (hash1(fr, 1.1) < 0.5) {
      const c = fxCopy(g, W, H);
      for (let i = 0; i < 7; i++) { const y = hash1(fr, i + 3) * H, h = (4 + hash1(fr, i + 9) * 44) * S, dx = (hash1(fr, i + 15) - 0.5) * 90 * S * A; g.drawImage(c, 0, y, W, h, dx, y, W, h); }
      g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.4 * A; g.filter = 'hue-rotate(120deg) saturate(2)'; g.drawImage(c, (hash1(fr, 2.2) - 0.5) * 30 * S * A, 0);
    }
  } else if (k === 'vhs' || k === 'grain') {
    const fr = Math.floor(lt * 24), nw = Math.ceil(W / 3), nh = Math.ceil(H / 3);
    if (!fxNoiseC || fxNoiseC.width !== nw || fxNoiseC.height !== nh) fxNoiseC = newCanvas(nw, nh);
    const gn = fxNoiseC.getContext('2d'), id = gn.createImageData(nw, nh), d = id.data; let s = (fr * 2654435761) >>> 0;
    for (let i = 0; i < d.length; i += 4) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const v = (s >>> 0) & 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    gn.putImageData(id, 0, 0);
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = (k === 'vhs' ? 0.28 : 0.2) * A; g.drawImage(fxNoiseC, 0, 0, W, H);
    if (k === 'vhs') {
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.13 * A; g.fillStyle = '#000000';
      const st = Math.max(2, 4 * S); for (let y = 0; y < H; y += st) g.fillRect(0, y, W, Math.max(1, st * 0.4));
      const by = frac(lt * 0.25 * sp) * (H + 80 * S) - 40 * S; g.globalAlpha = 0.16 * A; g.fillStyle = '#ffffff'; g.fillRect(0, by, W, 16 * S);
      g.globalAlpha = 0.25 * A; g.globalCompositeOperation = 'screen'; const c = fxCopy(g, W, H); g.filter = 'hue-rotate(-60deg)'; g.drawImage(c, 3 * S * A, 0);
    }
  } else if (k === 'leak') {
    g.globalCompositeOperation = 'screen';
    const x = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(lt * 0.7 * sp))), y = H * (0.3 + 0.3 * Math.cos(lt * 0.5 * sp)), r = Math.max(W, H) * 0.65;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, f.color || '#ff9a5a'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55 * A; g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } else if (k === 'vignette') {
    const r0 = Math.min(W, H) * (0.28 + 0.08 * Math.sin(lt * 4 * sp)), gr = g.createRadialGradient(W / 2, H / 2, r0, W / 2, H / 2, Math.hypot(W, H) / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, f.color || '#000000'); g.globalAlpha = 0.9 * A; g.fillStyle = gr; g.fillRect(0, 0, W, H);
  } else if (k.startsWith('cam-')) { // 카메라 화면: 녹화 점이 깜빡이고 시간이 흘러요
    const D = TMPL_DEF(k.slice(4)); tmplDraw(g, { ...D, color: f.color || '#ffffff', txt: f.txt ?? D.txt, time: f.time || '00:00:00', date: f.date ?? D.date, lb: f.lb ?? D.lb, grid: f.grid ?? D.grid }, W, H, lt * (f.speed || 1));
  } else if (k === 'bw') { const c = fxCopy(g, W, H); g.filter = `grayscale(${clamp(A, 0, 1)}) contrast(1.08)`; g.drawImage(c, 0, 0); }
  else if (k === 'focus' || k === 'speed') {
    const fr = Math.floor(lt * 12 * sp), n = Math.round(clamp(f.n || 60, 10, 300));
    g.fillStyle = f.color || '#000000';
    for (let i = 0; i < n; i++) {
      const r1 = hash1(i, fr + 0.1), r2 = hash1(fr + 0.5, i);
      if (k === 'focus') {
        g.globalAlpha = 0.85 * A; const a = r1 * Math.PI * 2, R = Math.hypot(W, H) / 2, r0 = R * (0.42 + r2 * 0.28), w = (0.004 + r2 * 0.012) * Math.PI;
        g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a - w) * R * 1.2, H / 2 + Math.sin(a - w) * R * 1.2); g.lineTo(W / 2 + Math.cos(a + w) * R * 1.2, H / 2 + Math.sin(a + w) * R * 1.2); g.fill();
      } else {
        const y = hash1(i, 4.4) * H, len = W * (0.2 + hash1(i, 6.6) * 0.5), x = frac((hash1(i, 9.9) * W - lt * W * 2.2 * sp * (0.6 + hash1(i, 2.2) * 0.8)) / (W + len)) * (W + len) - len;
        g.globalAlpha = 0.55 * A * (0.3 + hash1(i, 7.7) * 0.7); g.fillRect(x, y, len, Math.max(1, (1 + hash1(i, 8.8) * 3) * S));
      }
    }
  }
  g.restore();
}
// 장면 위에 효과와 글자·스티커 (gsRenderAt 끝에서 불러요)
function gsRenderExtras(g, t, W, H) {
  if (!gs.ovs.length && !gs.fx.length) return;
  const live = gs.fx.filter(f => FXK[f.kind] && !f.hidden && t >= (f.t0 || 0) && t <= fxT1(f) + 1e-6);
  for (const f of live) if (FXK[f.kind][2] === 'p') fxParticles(g, f, t, W, H);
  for (const o of ovOrdered()) if (!o.hidden) ovDraw(g, o, t, W, H);
  for (const f of live) if (FXK[f.kind][2] === 's') fxScreen(g, f, t, W, H);
  for (const f of live) if (FXK[f.kind][2] === 'c') fxScreen(g, f, t, W, H); // 카메라 화면은 맨 위에
}
// 저장 장면 계획용: 이 시점에 움직이는 게 있으면 null, 없으면 보이는 것들의 이름
function gsDynSig(t) {
  for (const f of gs.fx) if (!f.hidden && t >= (f.t0 || 0) && t <= fxT1(f)) return null;
  let sig = '';
  for (const o of gs.ovs) {
    if (o.hidden) continue;
    const t0 = o.t0 || 0, t1 = ovT1(o); if (t < t0 || t > t1) continue;
    if (o.aloop && o.aloop.n) return null;
    const N = o.kind === 'image' ? 1 : [...(o.text || '')].length, st = o.per ? N * (o.gap ?? 0.06) : 0;
    if (o.ain && o.ain.n && t - t0 < (o.ain.d || 0) + (o.ain.n === 'type' ? 0 : st) + 0.03) return null;
    if (o.aout && o.aout.n && t1 - t < (o.aout.d || 0) + st + 0.03) return null;
    sig += o.id + ',';
  }
  return sig;
}
function gsStaticRun(out, a, b, iv) { // a~b(ms) 사이: 안 움직이는 동안은 한 장으로 합쳐요
  if (!gs.ovs.length && !gs.fx.length) { out.push({ t: a + 1, s: a, dur: b - a }); return; }
  let cur = null;
  for (let t = a; t < b - 0.5; t += iv) {
    const dur = Math.min(iv, b - t), sig = gsDynSig((t + 1) / 1000);
    if (sig !== null && cur && cur.sig === sig) { cur.dur += dur; continue; }
    cur = { t: t + 1, s: t, dur, sig }; out.push(cur);
  }
}

/* ---- 특수 장면 넘김: gl-transitions (WebGL) ---- */
const GLT_KO = {
  Fade: '서서히', CrossZoom: '확대하며 번지기', Dreamy: '꿈결', DreamyZoom: '꿈결 확대', Cube: '큐브 돌리기', InsideCube: '안쪽 큐브', Doorway: '문 열기', DirectionalWarp: '휘어 밀기', Directional: '밀어내기',
  Swirl: '소용돌이', Ripple: '물결', WaterDrop: '물방울', Pixelize: '픽셀로', Mosaic: '모자이크', GlitchMemories: '글리치 기억', GlitchDisplace: '글리치 밀림', GlitchBands: '글리치 띠', BurnThrough: '불타 들어가기',
  FilmBurn: '필름 탐', Kaleidoscope: '만화경', WindowBlinds: '블라인드', WindowSlices: '창 조각', Wind: '바람', SimpleZoom: '확대', SimpleZoomOut: '축소', ZoomInCircles: '동그라미 확대', CircleOpen: '동그랗게 열기',
  CircleIris: '조리개', HeartWipe: '하트로 닦기', StarWipe: '별로 닦기', BookFlip: '책장 넘기기', PolkaDotsCurtain: '물방울 커튼', Morph: '녹아들기', PerlinDissolve: '얼룩 번짐', ColorPhase: '색 번짐',
  Hexagonalize: '육각형', Honeycomb: '벌집', FlashFade: '번쩍 바뀜', InkBleed: '잉크 번짐', EyeBlink: '눈 깜빡', Hologram: '홀로그램', CrossWarp: '교차 휘기', Bounce: '튕기기', DoomMelt: '녹아내림',
  LeafWipe: '나뭇잎 닦기', FlameWipe: '불꽃 닦기', GooeyWipe: '끈적 닦기', ClockWipe: '시계 방향', RadialWipe: '부채꼴', Shatter: '산산조각', PaperTear: '종이 찢기', Puzzle: '퍼즐', Crumple: '구기기', Fold: '접기',
  Curtains: '커튼', Swap: '자리 바꾸기', TvTurnOff: 'TV 꺼짐', TvStatic: 'TV 지직', VhsTracking: 'VHS 트래킹', WhipPan: '휙 넘기기', WhipSpin: '휙 돌기', WarpSpeed: '워프', Tunnel: '터널', LensFlare: '렌즈 빛',
  LightningFlash: '번개', LightRays: '빛줄기', Overexposure: '하얗게 날리기', PhotoDevelop: '사진 현상', Snapshot: '찰칵', Halftone: '망점', SketchDissolve: '스케치', SmokeDissolve: '연기', Disintegrate: '흩어지기',
  GlitterDissolve: '반짝이', BokehDissolve: '빛망울', Vortex: '회오리', Sphere: '구슬', CameraShake: '흔들며', SplitFlap: '플랩 보드', DominoFall: '도미노', CardSwipe: '카드 넘기기', Gallery: '갤러리',
  FilmStrip: '필름 띠', PixelStretch: '픽셀 늘이기', HeatHaze: '아지랑이', Refraction: '굴절', Fisheye: '어안', RibbonTwist: '리본 꼬기', Shred: '파쇄', Pinwheel: '바람개비', Chessboard: '체스판', Squeeze: '쥐어짜기',
  BlockCover: '블록 덮기', RandomSquares: '무작위 사각', SquaresWipe: '사각 닦기', DiamondWipe: '마름모 닦기', TilesWave: '타일 물결', ZoomInOut: '줌 인아웃', RotateScaleFade: '돌며 사라지기', PopIn: '톡 튀어나오기',
  Prisms: '프리즘', LiquidFill: '액체 채우기', SplatterWipe: '물감 튀기기', BrushWipe: '붓질', EdgeGlow: '테두리 빛', FadeColor: '색으로 바뀜', FadeGrayscale: '흑백 거쳐', Ascii: '아스키', LedWall: 'LED 벽', Accordion: '아코디언',
};
const GLT_TOP = Object.keys(GLT_KO).filter(n => GL_TRANS.some(x => x.name === n));
const glt = { gl: null, cv: null, P: new Map(), bad: new Set(), tA: null, tB: null, buf: null };
const gltLabel = n => GLT_KO[n] ? `${GLT_KO[n]} (${n})` : n;
function gltDefault(u) {
  const d = u.d, t = u.t, n = /\d$/.test(t) ? +t.slice(-1) : 1;
  if (!d) return t === 'bool' ? false : n > 1 ? new Array(n).fill(0) : 0;
  if (d === 'true' || d === 'false') return d === 'true';
  const m = d.match(/\(([^)]*)\)/); if (m) { const a = m[1].split(',').map(s => parseFloat(s) || 0); return a.length === 1 ? new Array(n).fill(a[0]) : a; }
  return parseFloat(d) || 0;
}
function gltInit() {
  if (glt.gl) return glt.gl;
  glt.cv = document.createElement('canvas'); glt.cv.width = glt.cv.height = 8;
  const gl = glt.gl = glt.cv.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
  if (!gl) return null;
  glt.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glt.buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v); return t; };
  glt.tA = mk(); glt.tB = mk();
  glt.cv.addEventListener('webglcontextlost', e => { e.preventDefault(); glt.gl = null; glt.P.clear(); });
  return gl;
}
function gltProg(name) {
  if (glt.P.has(name)) return glt.P.get(name);
  const T = GL_TRANS.find(x => x.name === name), gl = gltInit(); if (!T || !gl) return null;
  const fs = `precision highp float;\nvarying vec2 _uv;\nuniform sampler2D from, to;\nuniform float progress, ratio;\nvec4 getFromColor(vec2 uv){ return texture2D(from, uv); }\nvec4 getToColor(vec2 uv){ return texture2D(to, uv); }\n${T.u.map(u => `uniform ${u.t} ${u.n};`).join('\n')}\n${T.glsl}\nvoid main(){ gl_FragColor = transition(_uv); }`;
  const vs = 'attribute vec2 p; varying vec2 _uv; void main(){ _uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const sh = (ty, s) => { const x = gl.createShader(ty); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; };
  const v = sh(gl.VERTEX_SHADER, vs), f = v && sh(gl.FRAGMENT_SHADER, fs); let R = null;
  if (v && f) {
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) R = { p, T, L: Object.fromEntries(['from', 'to', 'progress', 'ratio', ...T.u.map(u => u.n)].map(n => [n, gl.getUniformLocation(p, n)])) };
  }
  if (!R) glt.bad.add(name);
  glt.P.set(name, R); return R;
}
// from·to(캔버스)와 진행도로 넘김 한 장 → WebGL 캔버스 (안 되면 null)
function gltRender(name, from, to, prog, W, H) {
  const R = gltProg(name); if (!R) return null;
  const gl = glt.gl; if (glt.cv.width !== W || glt.cv.height !== H) { glt.cv.width = W; glt.cv.height = H; }
  gl.viewport(0, 0, W, H); gl.useProgram(R.p); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, glt.tA); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, from); gl.uniform1i(R.L.from, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glt.tB); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, to); gl.uniform1i(R.L.to, 1);
  gl.uniform1f(R.L.progress, clamp(prog, 0, 1)); gl.uniform1f(R.L.ratio, W / H);
  for (const u of R.T.u) {
    const l = R.L[u.n], v = gltDefault(u); if (!l) continue;
    if (u.t === 'float') gl.uniform1f(l, v); else if (u.t === 'int' || u.t === 'bool') gl.uniform1i(l, +v);
    else if (u.t === 'vec2') gl.uniform2fv(l, v); else if (u.t === 'vec3') gl.uniform3fv(l, v); else if (u.t === 'vec4') gl.uniform4fv(l, v);
    else if (u.t === 'ivec2') gl.uniform2iv(l, v.map(Math.round));
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, glt.buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (gl.getError() !== gl.NO_ERROR) return null;
  return glt.cv;
}
const strHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
function gltPickRandom(s) { const L = GLT_TOP.filter(n => !glt.bad.has(n)); return L[strHash(String(s.id)) % L.length]; }
let gltBufA = null, gltBufB = null;
// gsRenderAt에서: 특수 넘김 한 장. 그렸으면 true
function gsGlTrans(g, tr, prev, cur, k, p, pd, tau, W, H) {
  const name = tr === 'gl:*' ? gltPickRandom(cur) : tr.slice(3);
  if (!name || glt.bad.has(name)) return false;
  if (!gltBufA || gltBufA.width !== W || gltBufA.height !== H) { gltBufA = newCanvas(W, H); gltBufB = newCanvas(W, H); }
  const ga = gltBufA.getContext('2d'), gb = gltBufB.getContext('2d');
  ga.fillStyle = gb.fillStyle = gs.set.bg; ga.fillRect(0, 0, W, H); gb.fillRect(0, 0, W, H);
  gsDrawSlide(ga, prev, 1, W, H, pd * 1000); gsDrawSlide(gb, cur, p, W, H, tau * 1000);
  let out = null; try { out = gltRender(name, gltBufA, gltBufB, k, W, H); } catch (e) { glt.bad.add(name); }
  if (!out) return false;
  g.drawImage(out, 0, 0, W, H); return true;
}
// 넘김 고르는 칸 (기본 + 무작위 + 추천 + 전체)
function gsTransSel(key, cur, inherit) {
  const o = (v, l) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const top = GLT_TOP.filter(n => !glt.bad.has(n)), rest = GL_TRANS.map(x => x.name).filter(n => !GLT_KO[n] && !glt.bad.has(n));
  return `<select data-gk="${key}">${inherit ? o('', '전체 설정 따름') : ''}${GS_TRANS.map(([v, l]) => o(v, l)).join('')}${o('gl:*', '특수 넘김 무작위로')}
    <optgroup label="특수 넘김 · 추천 ${top.length}가지">${top.map(n => o('gl:' + n, gltLabel(n))).join('')}</optgroup>
    <optgroup label="특수 넘김 · 나머지 ${rest.length}가지">${rest.map(n => o('gl:' + n, n)).join('')}</optgroup></select>
    <button class="btn sm" data-g="tr-gal" data-v="${key}" title="움직이는 미리보기를 보면서 고르기">보며 고르기</button>`;
}
const gsTrName = v => !v ? '' : v === 'gl:*' ? '특수 넘김 무작위' : v.startsWith('gl:') ? gltLabel(v.slice(3)) : (GS_TRANS.find(x => x[0] === v) || [, v])[1];
// 넘김 미리보기 고르기
function gltGallery(key) {
  const [OW, OH] = gsSize(), th = 116, tw = Math.round(clamp(th * OW / OH, 70, 200)), S = gs.slides;
  const mkSample = (s, alt) => { const c = newCanvas(tw, th), g = c.getContext('2d'); g.fillStyle = gs.set.bg; g.fillRect(0, 0, tw, th);
    if (s) gsDrawSlide(g, s, 0.5, tw, th, 0); else { const gr = g.createLinearGradient(0, 0, tw, th); gr.addColorStop(0, alt ? '#ff8a5b' : '#4b7bec'); gr.addColorStop(1, alt ? '#ffd166' : '#a55eea'); g.fillStyle = gr; g.fillRect(0, 0, tw, th); g.fillStyle = '#fff'; g.font = `bold ${th * 0.45}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(alt ? 'B' : 'A', tw / 2, th / 2); }
    return c; };
  const i = clamp(gs.sel, 1, S.length - 1), A = mkSample(S[i - 1] || S[0], false), B = mkSample(S.length > 1 ? S[i] : null, true);
  const names = [...GLT_TOP, ...GL_TRANS.map(x => x.name).filter(n => !GLT_KO[n])].filter(n => !glt.bad.has(n));
  const cur = key === 'trans' ? gs.set.trans : (gs.slides[gs.sel] || {}).tr;
  const m = modal(`<h2>특수 장면 넘김 고르기</h2><p class="sub">칸 위에 마우스를 올리면 움직여요. 누르면 골라져요. (gl-transitions, MIT)</p>
    <div style="display:flex;gap:8px;margin-bottom:8px"><input type="search" id="gltQ" placeholder="이름으로 찾기 (예: 하트, glitch)" style="flex:1"><button class="btn sm" data-gv="gl:*">무작위로</button></div>
    <div class="glt-grid" id="gltGrid">${names.map(n => `<button class="glt-tile ${('gl:' + n) === cur ? 'on' : ''}" data-gv="gl:${esc(n)}" data-q="${esc((GLT_KO[n] || '') + ' ' + n.toLowerCase())}"><canvas width="${tw}" height="${th}"></canvas><span>${esc(GLT_KO[n] || n)}</span></button>`).join('')}</div>
    <div class="foot"><button class="btn" data-close>닫기</button></div>`, { wide: true });
  const tiles = [...m.querySelectorAll('.glt-tile')];
  let qi = 0, alive = true, hov = null, raf = 0;
  const thumb = (tile, p) => { const n = tile.dataset.gv.slice(3), out = gltRender(n, A, B, p, tw, th); const c = tile.querySelector('canvas').getContext('2d'); if (out) { c.drawImage(out, 0, 0, tw, th); return true; } tile.hidden = true; return false; };
  const fill = () => { if (!alive || !document.body.contains(m)) return; const t0 = performance.now(); while (qi < tiles.length && performance.now() - t0 < 25) thumb(tiles[qi++], 0.42); if (qi < tiles.length) setTimeout(fill, 0); };
  fill();
  const loop = now => { if (!hov || !document.body.contains(m)) return; thumb(hov, clamp((now / 1000 % 1.6) / 1.2, 0, 1)); raf = requestAnimationFrame(loop); };
  m.addEventListener('pointerover', e => { const t = e.target.closest('.glt-tile'); if (t === hov) return; if (hov) thumb(hov, 0.42); hov = t; cancelAnimationFrame(raf); if (hov) raf = requestAnimationFrame(loop); });
  $('#gltQ', m).addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); for (const t of tiles) if (!glt.bad.has(t.dataset.gv.slice(3))) t.hidden = !!q && !t.dataset.q.includes(q); });
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-gv]'); if (!b) return;
    alive = false; hov = null; const v = b.dataset.gv;
    gsApplyTrans(key === 'trans' ? -1 : gs.sel, v);
    closeModal(); gsChanged();
  });
}

/* ---- 줄: 글자·효과가 놓이는 시간 막대 줄. 위 줄일수록 화면에서도 위에 그려요 ---- */
const laneOver = (a, b) => (a.t0 || 0) < (b.t1 == null ? gsTotal() : b.t1) - 1e-6 && (b.t0 || 0) < (a.t1 == null ? gsTotal() : a.t1) - 1e-6;
const laneFree = (list, x, L) => !list.some(y => y !== x && (y.lane ?? 0) === L && laneOver(x, y));
function laneFor(list, x) { let L = -1; for (const y of list) if (y !== x && laneOver(x, y)) L = Math.max(L, y.lane ?? 0); return L + 1; }
function laneFix(list) { // 줄 번호가 없으면 겹치는 것 위로, 그다음 빈 줄을 당겨 0, 1, 2…
  const done = [];
  for (const x of list) { if (x.lane == null || !isFinite(x.lane)) { let L = -1; for (const y of done) if (laneOver(x, y)) L = Math.max(L, y.lane); x.lane = L + 1; } done.push(x); }
  const used = [...new Set(list.map(x => x.lane))].sort((a, b) => a - b), m = new Map(used.map((v, i) => [v, i]));
  for (const x of list) x.lane = m.get(x.lane);
}
const ovOrdered = () => gs.ovs.map((o, i) => [o, i]).sort((a, b) => (a[0].lane || 0) - (b[0].lane || 0) || a[1] - b[1]).map(x => x[0]);
const gpT0 = () => gs.t >= gsTotal() - 0.05 ? 0 : Math.round(gs.t * 100) / 100;
function gpPlace(list, x, t0, lane) { // 시작 시간과 줄 정하기
  x.t0 = clamp(t0 ?? gpT0(), 0, Math.max(0, gsTotal() - 0.1));
  if (x.t1 != null && x.t1 <= x.t0 + 0.05) x.t1 = null;
  x.lane = lane != null && lane >= 0 && laneFree(list, x, lane) ? lane : laneFor(list, x);
  list.push(x); laneFix(list);
}

/* ---- 속성 칸: 고른 글자·스티커, 효과 ---- */
const rng = (k, v, mn, mx, st, unit = '') => `<input type="range" data-gk="${k}" min="${mn}" max="${mx}" step="${st}" value="${v}"><span class="muted small rv">${v}${unit}</span>`;
function ovTimeHtml(x, pre) {
  const k = pre === 'o' ? 'ov' : 'fx';
  return `${row('시작', `<input type="number" data-gk="${pre}.t0" min="0" step="0.05" value="${fmtT(x.t0)}" style="width:64px"> 초 <button class="btn sm" data-g="${k}-now0" title="지금 재생 위치를 시작으로">지금</button>`)}
    ${row('끝', `<input type="number" data-gk="${pre}.t1" min="0" step="0.05" value="${x.t1 == null ? '' : fmtT(x.t1)}" placeholder="끝까지" style="width:64px"> 초 <button class="btn sm" data-g="${k}-now1" title="지금 재생 위치를 끝으로">지금</button><button class="btn sm" data-g="${k}-end" title="움짤 끝까지">끝까지</button>`)}`;
}
function ovPropsHtml(o) {
  const isT = o.kind !== 'image', st = o.st || {};
  const fontsL = [...SYS_FONTS.map(f => f[0]), ...fonts.map(f => f.name)]; if (st.font && !fontsL.includes(st.font)) fontsL.push(st.font);
  const anSel = (k, cur, groups) => `<select data-gk="${k}"><option value="">없음</option>${groups.map(([lab, items]) => `<optgroup label="${lab}">${items.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const toL = a => a.map(n => [n, anName(n)]);
  let h = '';
  if (isT) h += `<div class="sec"><h3>글자</h3>
      <textarea data-gk="o.text" rows="2" style="width:100%;resize:vertical">${esc(o.text)}</textarea>
      <details class="subsec" ${gs.preOpen ? 'open' : ''} data-k="pre"><summary>빠른 꾸미기 ${OV_PRESETS.length}가지</summary><div class="ov-pre">${OV_PRESETS.map((p, i) => `<button class="btn sm" data-g="ov-pre" data-v="${i}" title="모양과 움직임을 한 번에">${esc(p.n)}</button>`).join('')}</div></details>
      ${row('글꼴', `<select data-gk="o.st.font">${fontsL.map(n => `<option value="${esc(n)}" ${n === st.font ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`)}
      ${row('크기', rng('o.st.fs', st.fs ?? 80, 16, 320, 1))}
      ${row('글자색', `<input type="color" data-gk="o.st.color" value="${st.color || '#ffffff'}"><label class="chk"><input type="checkbox" data-gk="o.st.bold" ${st.bold ? 'checked' : ''}> 굵게</label>`)}
      ${row('테두리', `<input type="color" data-gk="o.st.sc" value="${st.sc || '#111111'}">${rng('o.st.sw', st.sw ?? 0, 0, 30, 1)}`)}
      ${row('후광', `<input type="color" data-gk="o.st.glowColor" value="${st.glowColor || '#ffe25c'}">${rng('o.st.glow', st.glow ?? 0, 0, 80, 1)}`)}
      ${row('꾸밈', `<select data-gk="o.style"><option value="">편집기 글자 꾸밈…</option>${TEXT_STYLES.map((s, i) => `<option value="${i}">${esc(s.n)}</option>`).join('')}</select>`)}</div>`;
  else h += `<div class="sec"><h3>그림 스티커</h3>${row('크기', rng('o.size', o.size || 300, 30, 1200, 5))}</div>`;
  h += `<div class="sec"><h3>자리</h3>
      ${row('자리', `<div class="seg"><button class="btn sm" data-g="ov-pos" data-v="top">위</button><button class="btn sm" data-g="ov-pos" data-v="mid">가운데</button><button class="btn sm" data-g="ov-pos" data-v="bot">아래</button></div>`)}
      ${row('배율', rng('o.sc', o.sc ?? 1, 0.2, 4, 0.05))}
      ${row('기울기', rng('o.rot', o.rot || 0, -180, 180, 1, '°'))}
      <p class="muted small" style="margin:2px 0 0">미리보기 화면에서 끌어 옮기고, 모서리를 끌거나 휠로 크기를 바꿔요.</p></div>
    <div class="sec"><h3>시간</h3>${ovTimeHtml(o, 'o')}</div>
    <div class="sec"><h3>움직임 <span class="muted small">Animate.css ${AN_ALL.length}가지 + 글자 효과</span></h3>
      ${row('나타날 때', anSel('o.ain.n', o.ain.n, [...(isT ? [['글자 전용', TX_IN]] : []), ['등장', toL(AN_IN)]]) + ` <input type="number" data-gk="o.ain.d" min="0.05" max="10" step="0.05" value="${o.ain.d}" style="width:56px" title="걸리는 시간(초)">`)}
      ${row('도는 동안', anSel('o.aloop.n', o.aloop.n, [['글자 효과', TX_LOOP], ['강조 반복', toL(AN_LOOP)]]) + ` <input type="number" data-gk="o.aloop.d" min="0.1" max="10" step="0.1" value="${o.aloop.d}" style="width:56px" title="한 번 도는 시간(초)">`)}
      ${row('사라질 때', anSel('o.aout.n', o.aout.n, [['퇴장', toL(AN_OUT)]]) + ` <input type="number" data-gk="o.aout.d" min="0.05" max="10" step="0.05" value="${o.aout.d}" style="width:56px" title="걸리는 시간(초)">`)}
      ${isT ? row('한 글자씩', `<label class="chk"><input type="checkbox" data-gk="o.per" ${o.per ? 'checked' : ''}> 글자마다 차례로</label> <input type="number" data-gk="o.gap" min="0" max="1" step="0.01" value="${o.gap ?? 0.06}" style="width:56px" title="글자 사이 시간(초)">`) : ''}
      <div class="btnrow"><button class="btn sm" data-g="ov-play">이 부분 재생</button></div></div>
    <div class="sec"><div class="btnrow"><button class="btn sm" data-g="ov-dup">복제</button><button class="btn sm" data-g="ov-front" title="맨 위 줄로 (화면에서도 맨 위)">맨 위로</button><button class="btn sm" data-g="ov-back">맨 아래로</button><button class="btn sm" data-g="ov-hide">${o.hidden ? '보이기' : '숨기기'}</button><button class="btn sm danger" data-g="ov-del">지우기</button></div></div>`;
  return h;
}
function fxPropsHtml(f) {
  const isP = FXK[f.kind][2] === 'p', hasN = isP || f.kind === 'focus' || f.kind === 'speed', hasC = FX_COLORS[f.kind] !== undefined, rep = ['flash', 'invert', 'zoom'].includes(f.kind);
  if (FXK[f.kind][2] === 'c') {
    const tk = f.kind.slice(4), inp = (k, ph) => `<input type="text" data-gk="f.${k}" value="${esc(f[k] ?? '')}" placeholder="${ph}" spellcheck="false" style="flex:1;min-width:0">`;
    return `<div class="sec"><h3>시간</h3>${ovTimeHtml(f, 'f')}</div>
    <div class="sec"><h3>모양</h3>
    ${tk !== 'letterbox' && tk !== 'film' ? row('글자색', `<input type="color" data-gk="f.color" value="${f.color || '#ffffff'}">`) : ''}
    ${['rec', 'cctv', 'vhs', 'film'].includes(tk) ? row('이름', inp('txt', 'REC')) : ''}
    ${['vf', 'rec', 'cctv', 'vhs', 'phone'].includes(tk) ? row('시작 시간', inp('time', '00:00:00')) : ''}
    ${['rec', 'cctv', 'vhs'].includes(tk) ? row('날짜', inp('date', '2026.11.08')) : ''}
    ${tk === 'vf' ? row('', `<label class="chk"><input type="checkbox" data-gk="f.grid" ${f.grid ? 'checked' : ''}> 3분할 격자</label>`) : ''}
    ${row('레터박스', `<select data-gk="f.lb">${LB_RATIOS.map(([v, l]) => `<option value="${v}" ${String(f.lb ?? '0') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    ${tk !== 'letterbox' ? row('시간 빠르기', rng('f.speed', f.speed ?? 1, 0.1, 10, 0.1)) : ''}
    <p class="muted small">녹화 점이 깜빡이고 시간이 흘러가요. 이미지 편집의 '레이어' 메뉴에도 같은 템플릿이 있어요.</p></div>
    <div class="sec"><div class="btnrow"><button class="btn sm" data-g="fx-dup">복제</button><button class="btn sm" data-g="fx-hide">${f.hidden ? '보이기' : '숨기기'}</button><button class="btn sm danger" data-g="fx-del">지우기</button></div></div>`;
  }
  return `<div class="sec"><h3>시간</h3>${ovTimeHtml(f, 'f')}</div>
    <div class="sec"><h3>모양</h3>
    ${hasN ? row('양', rng('f.n', f.n, 5, f.kind === 'rain' ? 400 : 250, 1)) : ''}
    ${row('속도', rng('f.speed', f.speed ?? 1, 0.1, 4, 0.1))}
    ${isP ? row('크기', rng('f.size', f.size ?? 1, 0.3, 4, 0.1)) : row('세기', rng('f.amt', f.amt ?? 1, 0.1, 2, 0.05))}
    ${hasC ? row('색', `<input type="color" data-gk="f.color" value="${f.color || '#ffffff'}">${f.kind === 'confetti' ? `<button class="btn sm" data-g="fx-mix">여러 색</button>` : ''}`) : ''}
    ${rep ? row('되풀이', `<input type="number" data-gk="f.every" min="0" max="10" step="0.1" value="${f.every || 0}" style="width:60px"> 초마다 <span class="muted small">(0 = 한 번)</span>`) : ''}
    <div class="btnrow"><button class="btn sm" data-g="fx-play">이 부분 재생</button></div></div>
    <div class="sec"><div class="btnrow"><button class="btn sm" data-g="fx-dup">복제</button><button class="btn sm" data-g="fx-hide">${f.hidden ? '보이기' : '숨기기'}</button><button class="btn sm danger" data-g="fx-del">지우기</button></div></div>`;
}
// 값 바꾸기 ('o.st.fs' 같은 이름)
function ovSetKey(k, t) {
  const tgt = k[0] === 'o' ? gs.ovs.find(x => x.id === gs.osel) : gs.fx.find(x => x.id === gs.fsel); if (!tgt) return false;
  const path = k.split('.').slice(1);
  let v = t.type === 'checkbox' ? t.checked : t.value;
  if (path[0] === 'style') { const S = TEXT_STYLES[+v]; if (S) Object.assign(tgt.st, clone(S.p)); t.value = ''; return 'props'; }
  if (path[0] === 't1' && v === '') v = null;
  else if (t.type === 'number' || t.type === 'range') { v = parseFloat(v); if (!isFinite(v)) return false; }
  if (path[0] === 't0' || path[0] === 't1') { if (v != null) v = clamp(v, 0, Math.max(0, gsTotal())); }
  let o = tgt; for (let i = 0; i < path.length - 1; i++) { o[path[i]] = o[path[i]] || {}; o = o[path[i]]; }
  o[path[path.length - 1]] = v;
  if (tgt.t1 != null && tgt.t1 < (tgt.t0 || 0) + 0.05) tgt.t1 = Math.min(gsTotal(), (tgt.t0 || 0) + 0.05);
  if (path[0] === 't0' || path[0] === 't1') { const L = k[0] === 'o' ? gs.ovs : gs.fx; if (!laneFree(L, tgt, tgt.lane)) tgt.lane = laneFor(L, tgt); laneFix(L); }
  const rv = t.nextElementSibling; if (t.type === 'range' && rv && rv.classList.contains('rv')) rv.textContent = t.value + (k === 'o.rot' ? '°' : '');
  return true;
}
function ovApplyPreset(o, P) { Object.assign(o.st, clone(P.st)); o.ain = { n: P.ain[0], d: P.ain[1] }; o.aloop = { n: P.aloop[0], d: P.aloop[1] }; o.aout = { n: P.aout[0], d: P.aout[1] }; o.per = P.per; if (P.gap) o.gap = P.gap; }
function ovNewText(text) { const o = OV_DEF(); o.text = text; const T = gsTotal(), t0 = gpT0(); if (T - t0 > 3.5) o.t1 = Math.round((t0 + 3) * 100) / 100; return o; }
function ovAddText(text, extra, t0, lane) {
  const o = ovNewText(text); if (extra) Object.assign(o, clone(extra));
  if (t0 != null && o.t1 != null) o.t1 = Math.min(gsTotal(), t0 + 3) >= gsTotal() - 0.5 ? null : Math.round((t0 + 3) * 100) / 100;
  gpPlace(gs.ovs, o, t0, lane); gs.osel = o.id; gs.focus = 'ov'; gsChanged(); return o;
}
const EMOJI_ST = () => ({ st: { font: doc.defaults.text.font, fs: 150, color: '#ffffff', bold: false, sc: '#ffffff', sw: 0, glow: 0, glowColor: '#ffe25c' }, y: 0.5, ain: { n: 'bounceIn', d: 0.6 }, aloop: { n: 'pulse', d: 1 } });
async function ovAddImageSrc(src, name, t0, lane) {
  const im = await loadImg(src), k = Math.min(1, 1024 / Math.max(im.naturalWidth, im.naturalHeight)), c = newCanvas(Math.max(1, im.naturalWidth * k), Math.max(1, im.naturalHeight * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const o = ovNewText(''); Object.assign(o, { kind: 'image', name, src: c.toDataURL('image/png'), size: 320, y: 0.5, ain: { n: 'zoomIn', d: 0.5 } });
  await ovImgLoad(o); gpPlace(gs.ovs, o, t0, lane); gs.osel = o.id; gs.focus = 'ov'; gsChanged();
}
function ovPickLibrary(t0, lane) {
  if (!imageOrder.length) { toast('그림 보관함이 비어 있어요'); return; }
  const m = modal(`<h2>스티커로 쓸 그림 고르기</h2><p class="sub">배경을 지운 그림(투명)이면 스티커처럼 보여요.</p><div class="lib" style="grid-template-columns:repeat(5,1fr);max-height:52vh;padding:0">${imageOrder.map(id => { const r = images.get(id); return `<div class="thumb ${r.alpha ? 'alpha' : ''}" data-pid="${id}"><img src="${r.thumb || ''}" alt=""></div>`; }).join('')}</div><div class="foot"><button class="btn" data-close>취소</button></div>`, { wide: true });
  m.addEventListener('click', async e => { const t = e.target.closest('[data-pid]'); if (!t) return; const im = imgCache.get(t.dataset.pid), r = images.get(t.dataset.pid); closeModal(); if (!im || !im.naturalWidth) return;
    const c = newCanvas(im.naturalWidth, im.naturalHeight); c.getContext('2d').drawImage(im, 0, 0); await ovAddImageSrc(c.toDataURL('image/png'), r.name, t0, lane); });
}
function fxAdd(kind, t0, lane) { const x = FX_DEF(kind, 0); x.t0 = 0; const t = t0 ?? gpT0(); if (x.t1 != null) x.t1 = Math.round(Math.min(gsTotal(), t + x.t1) * 100) / 100; gpPlace(gs.fx, x, t, lane); gs.fsel = x.id; gs.focus = 'fx'; return x; }
function fxAddPreset(i, t0) { const [, L] = FX_PRESETS[i]; let last; const t = t0 ?? gpT0(); for (const [k, ex] of L) { last = fxAdd(k, t); const e = { ...ex }; if ('t1' in e) { last.t1 = e.t1; delete e.t1; } Object.assign(last, e); } laneFix(gs.fx); return last; }
// 글자·효과 단추 (속성 칸, 재료 칸, 시간 막대에 놓기). at = {t, lane}
function ovClick(a, b, at) {
  const o = gs.ovs.find(x => x.id === gs.osel), f = gs.fx.find(x => x.id === gs.fsel), now = Math.round(gs.t * 100) / 100, t0 = at ? at.t : undefined, ln = at ? at.lane : undefined;
  const done = () => gsChanged();
  if (a === 'tr-gal') { gltGallery(b.dataset.v); return; }
  if (a === 'ov-add') ovAddText('글자를 입력하세요', null, t0, ln);
  else if (a === 'ov-preadd') { const P = OV_PRESETS[+b.dataset.v], x = ovNewText(P.n); ovApplyPreset(x, P); gpPlace(gs.ovs, x, t0, ln); gs.osel = x.id; gs.focus = 'ov'; done(); gsPlayFrom(x.t0); }
  else if (a === 'ov-emoji') ovAddText(b.dataset.v, EMOJI_ST(), t0, ln);
  else if (a === 'ov-img') { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.onchange = async () => { const fl = inp.files[0]; if (fl) try { await ovAddImageSrc(await readAsDataURL(fl), fl.name, t0, ln); } catch (e) { toast('그림을 열지 못했어요'); } }; inp.click(); }
  else if (a === 'ov-lib') ovPickLibrary(t0, ln);
  else if (a === 'ov-perslide') {
    if (!gs.slides.length) { toast('장면을 먼저 넣어 주세요'); return; }
    let acc = 0; const base = o && o.kind !== 'image' ? o : null, made = [], L = gs.ovs.reduce((m, x) => Math.max(m, x.lane ?? 0), -1) + 1;
    gs.slides.forEach((s, i) => { const d = gsDur(s), x = base ? { ...clone({ ...base, bmp: null }), id: uid() } : OV_DEF(); x.text = `자막 ${i + 1}`; x.t0 = Math.round(acc * 100) / 100; x.t1 = Math.round((acc + d) * 100) / 100; x.lane = L; if (!base) { x.ain = { n: 'fadeIn', d: Math.min(0.3, d / 3) }; x.aout = { n: 'fadeOut', d: Math.min(0.2, d / 4) }; Object.assign(x.st, { boxOn: true, boxColor: '#000000', boxA: 55, boxPad: 24, boxR: 12, sw: 0, bold: false, fs: 60 }); } gs.ovs.push(x); made.push(x); acc += d; });
    laneFix(gs.ovs); gs.osel = made[0].id; gs.focus = 'ov'; done(); toast(`장면 ${gs.slides.length}개에 자막을 한 줄로 만들었어요. 아래 줄에서 하나씩 눌러 글자를 바꿔요.`, 4000);
  }
  else if (a === 'fx-add') { const x = fxAdd(b.dataset.v, t0, ln); done(); gsPlayFrom(x.t0); }
  else if (a === 'fx-pre') { const x = fxAddPreset(+b.dataset.v, t0); done(); gsPlayFrom(x.t0); }
  else if (a === 'ov-del') { const i = gs.ovs.indexOf(o); if (i >= 0) { gs.ovs.splice(i, 1); laneFix(gs.ovs); gs.osel = null; gs.focus = 'set'; } done(); }
  else if (!o && a.startsWith('ov-')) return;
  else if (a === 'ov-hide') { o.hidden = !o.hidden; done(); }
  else if (a === 'ov-dup') { const x = { ...clone({ ...o, bmp: null }), id: uid(), bmp: o.bmp, x: Math.min(0.95, o.x + 0.03), y: Math.min(0.95, o.y + 0.03), lane: null }; x.lane = laneFor(gs.ovs, x); gs.ovs.push(x); laneFix(gs.ovs); gs.osel = x.id; done(); }
  else if (a === 'ov-front' || a === 'ov-back') { o.lane = a === 'ov-front' ? gs.ovs.reduce((m, x) => Math.max(m, x.lane ?? 0), 0) + 1 : -1; laneFix(gs.ovs); done(); }
  else if (a === 'ov-pre') { ovApplyPreset(o, OV_PRESETS[+b.dataset.v]); done(); gsPlayFrom(o.t0 || 0); }
  else if (a === 'ov-pos') { o.y = { top: 0.15, mid: 0.5, bot: 0.84 }[b.dataset.v]; o.x = 0.5; done(); }
  else if (a === 'ov-now0') { o.t0 = now; if (o.t1 != null && o.t1 <= now) o.t1 = null; if (!laneFree(gs.ovs, o, o.lane)) o.lane = laneFor(gs.ovs, o); laneFix(gs.ovs); done(); }
  else if (a === 'ov-now1') { o.t1 = Math.max((o.t0 || 0) + 0.1, now); done(); }
  else if (a === 'ov-end') { o.t1 = null; if (!laneFree(gs.ovs, o, o.lane)) o.lane = laneFor(gs.ovs, o); laneFix(gs.ovs); done(); }
  else if (a === 'ov-play') gsPlayFrom(o.t0 || 0);
  else if (a === 'fx-del') { const i = gs.fx.indexOf(f); if (i >= 0) { gs.fx.splice(i, 1); laneFix(gs.fx); gs.fsel = null; gs.focus = 'set'; } done(); }
  else if (!f) return;
  else if (a === 'fx-hide') { f.hidden = !f.hidden; done(); }
  else if (a === 'fx-dup') { const x = { ...clone(f), id: uid(), lane: null }; x.lane = laneFor(gs.fx, x); gs.fx.push(x); laneFix(gs.fx); gs.fsel = x.id; done(); }
  else if (a === 'fx-mix') { f.color = ''; done(); }
  else if (a === 'fx-now0') { f.t0 = now; if (f.t1 != null && f.t1 <= now) f.t1 = null; if (!laneFree(gs.fx, f, f.lane)) f.lane = laneFor(gs.fx, f); laneFix(gs.fx); done(); }
  else if (a === 'fx-now1') { f.t1 = Math.max((f.t0 || 0) + 0.1, now); done(); }
  else if (a === 'fx-end') { f.t1 = null; if (!laneFree(gs.fx, f, f.lane)) f.lane = laneFor(gs.fx, f); laneFix(gs.fx); done(); }
  else if (a === 'fx-play') gsPlayFrom(f.t0 || 0);
}
function gsPlayFrom(t) { if (!gs.slides.length) return; gsPause(); gs.t = clamp(t, 0, Math.max(0, gsTotal() - 0.01)); gsPlay(); }

/* ---- 미리보기 화면에서 끌어 옮기기 ---- */
function ovHit(px, py, W, H) { // 맨 위부터
  const L = ovOrdered();
  for (let i = L.length - 1; i >= 0; i--) {
    const o = L[i]; if (o.hidden || gs.t < (o.t0 || 0) - 1e-6 || gs.t > ovT1(o) + 1e-6) continue;
    const { hw, hh } = ovBox(o, W, H), dx = px - o.x * W, dy = py - o.y * H, a = -(o.rot || 0) * DEG;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= hw + 6 && Math.abs(ly) <= hh + 6) return o;
  }
  return null;
}
function ovDrawSel(g, W, H) {
  if (gs.playing) return;
  if (gs.focus === 'scene') { scDrawSel(g, W, H); return; }
  if (gs.focus !== 'ov') return;
  const o = gs.ovs.find(x => x.id === gs.osel); if (!o || o.hidden) return;
  const live = gs.t >= (o.t0 || 0) - 1e-6 && gs.t <= ovT1(o) + 1e-6, { hw, hh } = ovBox(o, W, H), k = W / Math.max(1, $('#gsCv').clientWidth);
  g.save(); g.translate(o.x * W, o.y * H); if (o.rot) g.rotate(o.rot * DEG);
  g.lineWidth = 1.5 * k; g.setLineDash([6 * k, 4 * k]); g.strokeStyle = live ? '#2f7bff' : 'rgba(47,123,255,.45)'; g.strokeRect(-hw - 4 * k, -hh - 4 * k, hw * 2 + 8 * k, hh * 2 + 8 * k);
  g.setLineDash([]); g.fillStyle = '#ffffff'; g.strokeStyle = '#2f7bff';
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.rect(sx * (hw + 4 * k) - 4 * k, sy * (hh + 4 * k) - 4 * k, 8 * k, 8 * k); g.fill(); g.stroke(); }
  scRotKnob(g, 0, -hh - 4 * k, k);
  if (!live) { g.fillStyle = 'rgba(47,123,255,.9)'; g.font = `${12 * k}px sans-serif`; g.textAlign = 'center'; g.fillText(`${fmtT(o.t0)}초부터 보여요`, 0, hh + 20 * k); }
  g.restore();
}
function scRotKnob(g, x, y, k) { // 돌리기 손잡이 (위쪽 동그라미)
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 22 * k); g.lineWidth = 1.2 * k; g.strokeStyle = '#2f7bff'; g.stroke();
  g.beginPath(); g.arc(x, y - 22 * k - 6 * k, 6 * k, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5 * k; g.stroke();
}
/* ---- 장면 그림 옮기기·키우기·돌리기 (미리보기에서) ---- */
// 장면마다 tx·ty(화면 폭·높이 비율), tz(배율), trot(도), tflip. 같은 GIF·영상에서 나온 장면과 여럿 고른 장면은 함께 움직여요
function scBox(s, W, H) {
  const sc = (gsFit(s) === 'contain' ? Math.min(W / s.w, H / s.h) : Math.max(W / s.w, H / s.h)) * (s.tz || 1);
  return { cx: W / 2 + (s.tx || 0) * W, cy: H / 2 + (s.ty || 0) * H, hw: s.w * sc / 2, hh: s.h * sc / 2, rot: s.trot || 0 };
}
function scTargets() {
  const S = gs.slides, cur = S[gs.sel]; if (!cur) return [];
  let list = gs.pick.size > 1 && gs.pick.has(cur.id) ? gsPicked() : [cur];
  const clips = new Set(list.map(s => s.clip).filter(Boolean));
  if (clips.size) list = S.filter(s => list.includes(s) || clips.has(s.clip));
  return list;
}
function scDrawSel(g, W, H) {
  const s = gs.slides[gs.sel]; if (!s || gsSceneAt(gs.t) !== gs.sel) return;
  const b = scBox(s, W, H), k = W / Math.max(1, $('#gsCv').clientWidth);
  g.save(); g.translate(b.cx, b.cy); if (b.rot) g.rotate(b.rot * DEG);
  g.lineWidth = 1.5 * k; g.setLineDash([6 * k, 4 * k]); g.strokeStyle = '#2f7bff'; g.strokeRect(-b.hw, -b.hh, b.hw * 2, b.hh * 2); g.setLineDash([]);
  g.fillStyle = '#fff';
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.beginPath(); g.rect(sx * b.hw - 5 * k, sy * b.hh - 5 * k, 10 * k, 10 * k); g.fill(); g.stroke(); }
  scRotKnob(g, 0, -b.hh, k);
  g.restore();
}
function scHit(s, px, py, W, H, tol) { // 'rot' | 'scale' | 'move' | null
  const b = scBox(s, W, H), a = -b.rot * DEG, dx = px - b.cx, dy = py - b.cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
  if (Math.hypot(lx, ly + b.hh + 28 * tol / 14) < tol * 1.1) return 'rot';
  if (Math.abs(Math.abs(lx) - b.hw) < tol && Math.abs(Math.abs(ly) - b.hh) < tol) return 'scale';
  if (Math.abs(lx) <= b.hw && Math.abs(ly) <= b.hh) return 'move';
  return null;
}
function ovBind() {
  const cv = $('#gsCv'); let D = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  const local = (o, px, py, W, H) => { const dx = px - o.x * W, dy = py - o.y * H, a = -(o.rot || 0) * DEG; return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a), dx, dy]; };
  const tolOf = W => 14 * W / Math.max(1, cv.clientWidth);
  cv.addEventListener('pointerdown', e => {
    if (!gs.slides.length) return;
    const [px, py] = pt(e), W = cv.width, H = cv.height, tol = tolOf(W);
    const sel = gs.ovs.find(x => x.id === gs.osel);
    let o = null, rotO = false;
    if (sel && gs.focus === 'ov') { // 고른 글자의 돌리기·크기 손잡이 먼저
      const { hw, hh } = ovBox(sel, W, H), [lx, ly] = local(sel, px, py, W, H);
      if (Math.hypot(lx, ly + hh + 4 * tol / 14 + 28 * tol / 14) < tol * 1.1) { o = sel; rotO = true; }
      else if (Math.abs(lx) <= hw + 12 && Math.abs(ly) <= hh + 12) o = sel;
    }
    if (!o) o = ovHit(px, py, W, H);
    if (!o) { // 글자·스티커가 없는 곳: 지금 보이는 장면 그림을 골라서 옮기기·키우기·돌리기
      const i = gsSceneAt(gs.t), s = gs.slides[i]; if (!s) return;
      const was = gs.focus === 'scene' && gs.sel === i, how = was ? scHit(s, px, py, W, H, tol) : 'move';
      if (!was) { gs.focus = 'scene'; if (gs.sel !== i) { gs.sel = i; if (!gs.pick.has(s.id)) gs.pick = new Set(); } gsRenderProps(); gsRenderList(); }
      gsPause();
      const b = scBox(s, W, H), list = scTargets();
      D = { scene: true, how: how || 'move', list: list.map(x => ({ s: x, tx: x.tx || 0, ty: x.ty || 0, tz: x.tz || 1, trot: x.trot || 0 })), sx: px, sy: py, cx: b.cx, cy: b.cy, d0: Math.max(1, Math.hypot(px - b.cx, py - b.cy)), a0: Math.atan2(py - b.cy, px - b.cx), moved: false };
      cv.setPointerCapture(e.pointerId); gsDraw(); e.preventDefault(); return;
    }
    gsPause();
    const { hw, hh } = ovBox(o, W, H), [lx, ly, dx, dy] = local(o, px, py, W, H);
    const corner = !rotO && Math.abs(Math.abs(lx) - hw) < tol && Math.abs(Math.abs(ly) - hh) < tol;
    D = { o, sx: px, sy: py, ox: o.x, oy: o.y, sc: o.sc || 1, d0: Math.hypot(dx, dy), corner, rot: rotO, r0: o.rot || 0, a0: Math.atan2(py - o.y * H, px - o.x * W), moved: false };
    const changed = gs.osel !== o.id || gs.focus !== 'ov'; gs.osel = o.id; gs.focus = 'ov'; if (changed) { gsRenderProps(); gsRenderList(); }
    cv.setPointerCapture(e.pointerId); gsDraw(); e.preventDefault();
  });
  const snapAng = (a, e) => { a = ((a + 180) % 360 + 360) % 360 - 180; if (e.shiftKey) return Math.round(a / 15) * 15; const r9 = Math.round(a / 90) * 90; return Math.abs(a - r9) < 4 ? r9 : Math.round(a * 10) / 10; };
  cv.addEventListener('pointermove', e => {
    const [px, py] = pt(e), W = cv.width, H = cv.height;
    if (!D) {
      const o = gs.slides.length && ovHit(px, py, W, H); let c = o ? 'move' : '';
      if (!o && gs.focus === 'scene' && gs.slides[gs.sel] && gsSceneAt(gs.t) === gs.sel) { const h = scHit(gs.slides[gs.sel], px, py, W, H, tolOf(W)); c = h === 'rot' ? 'grab' : h === 'scale' ? 'nwse-resize' : h === 'move' ? 'move' : ''; }
      cv.style.cursor = c; return;
    }
    if (!D.moved && Math.hypot(px - D.sx, py - D.sy) < 3) return;
    D.moved = true;
    if (D.scene) {
      for (const q of D.list) {
        if (D.how === 'scale') q.s.tz = clamp(q.tz * Math.hypot(px - D.cx, py - D.cy) / D.d0, 0.05, 20);
        else if (D.how === 'rot') q.s.trot = snapAng(q.trot + (Math.atan2(py - D.cy, px - D.cx) - D.a0) / DEG, e);
        else { let nx = q.tx + (px - D.sx) / W, ny = q.ty + (py - D.sy) / H; if (Math.abs(nx) < 0.012) nx = 0; if (Math.abs(ny) < 0.012) ny = 0; q.s.tx = clamp(nx, -2, 2); q.s.ty = clamp(ny, -2, 2); }
      }
      gsDraw(); return;
    }
    if (D.rot) D.o.rot = snapAng(D.r0 + (Math.atan2(py - D.oy * H, px - D.ox * W) - D.a0) / DEG, e);
    else if (D.corner) D.o.sc = clamp(D.sc * Math.hypot(px - D.ox * W, py - D.oy * H) / Math.max(1, D.d0), 0.1, 8);
    else { let nx = D.ox + (px - D.sx) / W, ny = D.oy + (py - D.sy) / H; if (Math.abs(nx - 0.5) < 0.012) nx = 0.5; if (Math.abs(ny - 0.5) < 0.012) ny = 0.5; D.o.x = clamp(nx, -0.2, 1.2); D.o.y = clamp(ny, -0.2, 1.2); }
    gsDraw();
  });
  const end = () => { if (!D) return; const m = D.moved, sc = D.scene; D = null; if (m) { gsChanged(); if (sc) gsRenderProps(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', e => {
    const [px, py] = pt(e), o = gs.ovs.find(x => x.id === gs.osel);
    if (o && gs.focus === 'ov' && ovHit(px, py, cv.width, cv.height) === o) {
      e.preventDefault(); o.sc = clamp((o.sc || 1) * Math.pow(1.1, -e.deltaY / 100), 0.1, 8); gsDraw(); clearTimeout(gsSaveT); gsSaveT = setTimeout(() => gsChanged(), 400); return;
    }
    if (gs.focus === 'scene' && gs.slides[gs.sel] && gsSceneAt(gs.t) === gs.sel && !ovHit(px, py, cv.width, cv.height)) { // 장면 그림 확대·축소
      e.preventDefault(); const f = Math.pow(1.1, -e.deltaY / 100);
      for (const s of scTargets()) s.tz = clamp((s.tz || 1) * f, 0.05, 20);
      gsDraw(); clearTimeout(gsSaveT); gsSaveT = setTimeout(() => { gsChanged(); gsRenderProps(); }, 400);
    }
  }, { passive: false });
  cv.addEventListener('dblclick', () => { const ta = $('#gsProps textarea[data-gk="o.text"]'); if (ta) { ta.focus(); ta.select(); } });
}
// 저장·불러오기
const ovPlain = o => { const { bmp, ...r } = o; return clone(r); };
async function ovRestore(list) { const out = (list || []).map(o => ({ ...o })); await Promise.all(out.map(ovImgLoad)); return out; }
