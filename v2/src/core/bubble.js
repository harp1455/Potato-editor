// 말풍선 그리기: 자와 컴퍼스로 그린 도형이 아니라, 손으로 그은 듯한 윤곽을 만들어 그려요.
//  - 윤곽은 씨앗(seed)으로 정해지는 부드러운 흔들림을 얹은 점 목록이에요. 같은 씨앗이면 늘 같은 모양이에요.
//  - 몸통·꼬리·이어 붙인 말풍선은 한 덩어리처럼 보이게, 바탕은 한 번에 칠하고 선은 서로의 바깥쪽에만 그어요.
//  - 선은 펜(굵기가 살짝 변함)·붓·스케치·점선·깔끔하게 중에서 골라요.
const TAU = Math.PI * 2;

export const SHAPES = [['ellipse', '둥글게'], ['poly', '각지게 (손그림)'], ['rect', '둥근 네모'], ['cloud', '구름 (생각)'], ['wavy', '떨림 (물결)'], ['shout', '뾰족하게 (외침)'], ['burst', '성게 (충격)'], ['blob', '연기 (덩어리)'], ['box', '네모 (해설)']];
export const LINES = [['pen', '펜'], ['clean', '깔끔하게'], ['brush', '붓'], ['sketch', '스케치'], ['dash', '점선 (속삭임)']];
export const TAILS = [['point', '뾰족한 꼬리'], ['line', '선 하나'], ['dots', '방울 (생각)']];
// 글자가 들어갈 자리: [가로 비율, 세로 비율, 둥글게 좁아지는 정도(0이면 네모나게)]
const INSET = { ellipse: [.84, .8, 2.3], poly: [.8, .78, 0], rect: [.86, .84, 0], cloud: [.66, .62, 2.3], wavy: [.78, .74, 2.3], shout: [.56, .52, 2.3], burst: [.56, .52, 2.3], blob: [.76, .7, 2.3], box: [.9, .86, 0] };
export const insetOf = e => INSET[e.shape] || INSET.ellipse;

// 고른 종류를 한 번에 입히는 견본들. 글자 내용·크기·글꼴·자리는 그대로 두고 생김새만 바꿔요
const BASE = { shape: 'ellipse', line: 'pen', bw: 3, bc: '#111111', fill: '#ffffff', fill2: '', fop: 100, soft: 0, sh: 0, dbl: false, color: '#111111', sw: 0, tail: true, tailKind: 'point' };
export const PRESETS = [
  ['대사', {}], ['각진 대사', { shape: 'poly' }], ['둥근 네모', { shape: 'rect' }], ['생각', { shape: 'cloud', tailKind: 'dots' }],
  ['외침', { shape: 'shout', bw: 4 }], ['충격', { shape: 'burst', tail: false }], ['떨림', { shape: 'wavy' }], ['속삭임', { line: 'dash', bw: 2 }],
  ['스케치', { line: 'sketch' }], ['붓', { line: 'brush', bw: 5 }], ['해설', { shape: 'box', tail: false }], ['테두리 없는 외침', { shape: 'shout', bw: 0 }],
  ['어두운 연기', { shape: 'blob', fill: '#161616', color: '#ffffff', bw: 0, soft: 3, tail: false }], ['비치는 흰색', { fop: 72, bw: 0, soft: 2 }],
  ['분홍 겹줄', { bc: '#e0458f', color: '#d0307c', dbl: true, tailKind: 'dots' }], ['색 번짐', { fill: '#fff4f8', fill2: '#ffd3e4', bc: '#e0458f', color: '#b3256a' }],
].map(([name, p]) => ({ name, props: { ...BASE, ...p } }));

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// 한 바퀴 돌면 제자리로 돌아오는 부드러운 흔들림 (-1 ~ 1)
function wobbler(rnd, ks = [1, 2, 3, 5], fall = 0.62) {
  const ps = ks.map((k, i) => [k, rnd() * TAU, Math.pow(fall, i)]), norm = ps.reduce((a, p) => a + p[2], 0);
  return a => ps.reduce((s, [k, ph, amp]) => s + Math.sin(k * a + ph) * amp, 0) / norm;
}
// 둥근 네모꼴(초타원)의 반지름: n이 2면 타원, 클수록 네모에 가까워요
const superR = (a, n) => Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), -1 / n);
const quad = (a, c, b, n, out) => { for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); } };
const area = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
// 타원 둘레를 같은 길이로 n등분하는 각도들 (납작한 말풍선에서 양 끝에 몰리지 않게)
function evenAngles(rx, ry, n) {
  const M = 360, len = [0]; let px = rx, py = 0;
  for (let i = 1; i <= M; i++) { const a = i / M * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry; len.push(len[i - 1] + Math.hypot(x - px, y - py)); px = x; py = y; }
  const out = []; let j = 0;
  for (let i = 0; i < n; i++) { const want = i / n * len[M]; while (len[j + 1] < want) j++; out.push((j + (want - len[j]) / Math.max(1e-6, len[j + 1] - len[j])) / M * TAU); }
  return out;
}
// 꼭짓점들을 잇는 다각형: 모서리는 살짝 굴리고, 변은 손으로 그은 것처럼 아주 조금 휘어요
function roundPoly(vs, round, bow, rnd) {
  const out = [], n = vs.length;
  for (let i = 0; i < n; i++) {
    const p = vs[(i + n - 1) % n], v = vs[i], q = vs[(i + 1) % n], l1 = Math.hypot(v[0] - p[0], v[1] - p[1]) || 1, l2 = Math.hypot(q[0] - v[0], q[1] - v[1]) || 1, cr = Math.min(l1, l2) * round;
    const a = [v[0] + (p[0] - v[0]) / l1 * cr, v[1] + (p[1] - v[1]) / l1 * cr], b = [v[0] + (q[0] - v[0]) / l2 * cr, v[1] + (q[1] - v[1]) / l2 * cr];
    out.push(a); quad(a, v, b, 6, out);
    const w = vs[(i + 2) % n], l3 = Math.hypot(w[0] - q[0], w[1] - q[1]) || 1, cr2 = Math.min(l2, l3) * round, e = [q[0] + (v[0] - q[0]) / l2 * cr2, q[1] + (v[1] - q[1]) / l2 * cr2];
    const k = (rnd() - 0.5) * 2 * bow * l2, nx = -(e[1] - b[1]), ny = e[0] - b[0], nl = Math.hypot(nx, ny) || 1;
    for (let s = 1; s < 6; s++) { const t = s / 6, f = Math.sin(Math.PI * t) * k; out.push([b[0] + (e[0] - b[0]) * t + nx / nl * f, b[1] + (e[1] - b[1]) * t + ny / nl * f]); }
  }
  return out;
}

// 몸통 윤곽 (가운데가 0,0인 점 목록). sharp면 꼭짓점을 뾰족하게 그대로 이어요
function body(e) {
  const rx = Math.max(4, e.w / 2), ry = Math.max(4, e.h / 2), rnd = rng((e.seed || 7) * 2654435761), k = (e.wob ?? 40) / 100, pts = [];
  const P = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))), at = (a, r) => [Math.cos(a) * rx * r, Math.sin(a) * ry * r];
  const shape = e.shape || 'ellipse';
  if (shape === 'poly' || shape === 'box') {
    let vs;
    if (shape === 'box') vs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [x * rx * (1 - 0.03 * k * rnd()), y * ry * (1 - 0.05 * k * rnd())]);
    else { const n = 7 + Math.floor(rnd() * 3), off = rnd() * TAU, as = evenAngles(rx, ry, n); vs = as.map(a => { const b = a + off / n + (rnd() - 0.5) * 0.5 * TAU / n * (0.4 + k); return at(b, superR(b, 3.6) * (1 - 0.07 * k * rnd())); }); }
    return { pts: roundPoly(vs, shape === 'box' ? 0.02 : 0.2, 0.05 * k, rnd), sharp: shape === 'box' };
  }
  if (shape === 'cloud') {
    const n = Math.max(7, Math.min(18, Math.round(P / (Math.min(rx, ry) * 0.8)))), as = evenAngles(rx * 0.82, ry * 0.8, n).map(a => a + (rnd() - 0.5) * 0.45 * TAU / n * (0.3 + k)), an = as.map(a => at(a, 1).map((v, i) => v * (i ? 0.8 : 0.82)));
    for (let i = 0; i < n; i++) {
      const A = an[i], B = an[(i + 1) % n], mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, d = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / d, uy = (B[1] - A[1]) / d, r = d / 2, bul = 0.72 + 0.3 * rnd();
      let nx = uy, ny = -ux; if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      for (let s = 0; s < 10; s++) { const f = Math.PI * s / 10; pts.push([mx - ux * r * Math.cos(f) + nx * r * bul * Math.sin(f), my - uy * r * Math.cos(f) + ny * r * bul * Math.sin(f)]); }
    }
    return { pts, sharp: true };
  }
  if (shape === 'shout' || shape === 'burst') {
    const burst = shape === 'burst', n = burst ? Math.max(24, Math.min(72, Math.round(P / 20))) : Math.max(9, Math.min(22, Math.round(P / 62))), as = evenAngles(rx, ry, n * 2), step = TAU / (n * 2), vs = [];
    for (let i = 0; i < n * 2; i++) {
      const tip = i % 2 === 0, a = as[i] + (rnd() - 0.5) * step * (burst ? 0.5 : 0.7);
      const r = tip ? (burst ? 0.84 + 0.16 * rnd() : (rnd() < 0.22 ? 1 : 0.8 + 0.14 * rnd())) : (burst ? 0.68 + 0.04 * rnd() : 0.6 + 0.08 * rnd());
      vs.push(at(a, superR(a, 2.5) * r));
    }
    for (let i = 0; i < vs.length; i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; pts.push(a); if (!burst) { const c = [(a[0] + b[0]) / 2 * 0.94, (a[1] + b[1]) / 2 * 0.94], seg = []; quad(a, c, b, 5, seg); seg.pop(); pts.push(...seg); } }
    return { pts, sharp: true };
  }
  const N = 200;
  if (shape === 'wavy') {
    const m = Math.max(10, Math.min(44, Math.round(P / 24))), W = wobbler(rnd, [1, 2, 3]), W2 = wobbler(rnd, [2, 3, 5, 7], 0.8), amp = Math.min(0.06, 3.2 / Math.min(rx, ry) + 0.012);
    evenAngles(rx, ry, N * 2).forEach((a, i) => { const u = i / (N * 2) * TAU; pts.push(at(a, superR(a, 2.4) * (1 - amp + amp * Math.sin(m * u + 2.4 * W2(u)) * (0.75 + 0.25 * W(u * 2)) + 0.02 * k * W(u)))); });
    return { pts };
  }
  const n = shape === 'rect' ? 5.5 : shape === 'blob' ? 2.25 : 2.35, W = shape === 'blob' ? wobbler(rnd, [2, 3, 4, 5, 7], 0.85) : wobbler(rnd), amp = shape === 'blob' ? 0.05 + 0.06 * k : shape === 'rect' ? 0.022 * k : 0.04 * k;
  for (let i = 0; i < N; i++) { const a = i / N * TAU; pts.push(at(a, superR(a, n) * (1 - amp + amp * W(a)))); }
  return { pts };
}

// 가운데에서 dir 쪽으로 쏜 선이 윤곽과 만나는 가장 먼 거리
function reach(pts, cx, cy, dx, dy) {
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / den, u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / den;
    if (t > best && u >= 0 && u <= 1) best = t;
  }
  return best;
}

// 말풍선 하나의 윤곽들 (페이지 좌표): shapes = 닫힌 도형들(몸통, 꼬리, 방울), strokes = 선으로만 긋는 꼬리
export function bubbleShapes(e) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2, rot = (e.rot || 0) * Math.PI / 180, co = Math.cos(rot), si = Math.sin(rot), b = body(e);
  const main = { pts: b.pts.map(([x, y]) => [cx + x * co - y * si, cy + x * si + y * co]), sharp: !!b.sharp, body: true, cx, cy };
  if (area(main.pts) < 0) main.pts.reverse();
  const shapes = [main], strokes = [];
  if (e.tail && Number.isFinite(e.tx) && Number.isFinite(e.ty)) {
    const dx0 = e.tx - cx, dy0 = e.ty - cy, L = Math.hypot(dx0, dy0), dx = dx0 / (L || 1), dy = dy0 / (L || 1), R = reach(main.pts, cx, cy, dx, dy), kind = e.tailKind || (e.shape === 'cloud' ? 'dots' : 'point');
    const m = Math.min(e.w, e.h), rnd = rng((e.seed || 7) * 40503 + 11), px = -dy, py = dx;
    if (L > R * 1.04 && R > 0) {
      const bend = (e.tailBend ?? 28) / 100;
      if (kind === 'dots') {   // 생각 방울: 몸통에서 멀어질수록 작아져요
        const gap = L - R, n = gap > m * 0.7 ? 3 : 2, r0 = Math.min(m * (e.tailW ?? 20) / 100 * 0.5, gap / (n * 1.9)); let d = R + r0 * 0.9;
        for (let i = 0; i < n; i++) {
          const r = r0 * Math.pow(0.66, i) * (1 - 0.1 * rnd()), t = (d - R) / gap, off = Math.sin(t * Math.PI) * bend * gap * 0.3, ox = i === n - 1 ? e.tx - dx * r : cx + dx * d + px * off, oy = i === n - 1 ? e.ty - dy * r : cy + dy * d + py * off, W = wobbler(rnd, [2, 3]), pts = [];
          d += r + (gap - r0 * 2.6) / n;
          for (let j = 0; j < 28; j++) { const a = j / 28 * TAU, rr = r * (1 + 0.07 * W(a)); pts.push([ox + Math.cos(a) * rr, oy + Math.sin(a) * rr * 0.9]); }
          shapes.push({ pts, cx: ox, cy: oy });
        }
      } else if (kind === 'line') {   // 선 하나: 몸통 조금 밖에서 시작해 끝까지 살짝 휘어요
        const s = [cx + dx * (R + m * 0.04), cy + dy * (R + m * 0.04)], T = [e.tx, e.ty], len = L - R, c = [(s[0] + T[0]) / 2 + px * bend * len * 0.3, (s[1] + T[1]) / 2 + py * bend * len * 0.3], pts = [s]; quad(s, c, T, 14, pts); strokes.push(pts);
      } else {   // 뾰족한 꼬리: 몸통 안쪽에서 시작해 끝으로 가며 가늘어지고, 한쪽으로 살짝 휘어요
        const base = R * 0.8, len = L - base, s = Math.min(m * (e.tailW ?? 20) / 200, len * 0.45), bx = cx + dx * base, by = cy + dy * base, T = [e.tx, e.ty], ox = px * bend * len * 0.32, oy = py * bend * len * 0.32;
        const A = [bx + px * s, by + py * s], B = [bx - px * s, by - py * s], pts = [A];
        quad(A, [(A[0] + T[0]) / 2 + ox, (A[1] + T[1]) / 2 + oy], T, 12, pts); quad(T, [(B[0] + T[0]) / 2 + ox, (B[1] + T[1]) / 2 + oy], B, 12, pts);
        if (area(pts) < 0) pts.reverse();
        shapes.push({ pts, sharp: true, tail: true });
      }
    }
  }
  return { shapes, strokes, cx, cy };
}

function trace(g, s, close = true) {
  const p = s.pts, n = p.length;
  if (s.sharp || n < 8) { g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < n; i++) g.lineTo(p[i][0], p[i][1]); }
  else { g.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2); for (let i = 0; i < n; i++) { const q = p[(i + 1) % n]; g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + q[0]) / 2, (p[i][1] + q[1]) / 2); } }
  if (close) g.closePath();
}
// 굵기가 변하는 선: 윤곽 양옆으로 벌린 띠를 칠해요 (펜을 누르는 힘이 달라지는 느낌)
function ribbon(g, pts, closed, half) {
  const n = pts.length, L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const p = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)], q = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)], v = pts[i];
    let ax = v[0] - p[0], ay = v[1] - p[1], bx = q[0] - v[0], by = q[1] - v[1]; const al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
    if (al < 1e-6) { ax = bx; ay = by; } else { ax /= al; ay /= al; } if (bl < 1e-6) { bx = ax; by = ay; } else { bx /= bl; by /= bl; }
    let nx = -(ay + by), ny = ax + bx; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const hw = half(i / n, i) / Math.max(0.45, nx * -ay + ny * ax);   // 뾰족한 모서리에서는 조금 더 벌려요
    L.push([v[0] + nx * hw, v[1] + ny * hw]); Rr.push([v[0] - nx * hw, v[1] - ny * hw]);
  }
  g.beginPath(); g.moveTo(L[0][0], L[0][1]); for (let i = 1; i < n; i++) g.lineTo(L[i][0], L[i][1]);
  if (closed) { g.closePath(); g.moveTo(Rr[n - 1][0], Rr[n - 1][1]); for (let i = n - 2; i >= 0; i--) g.lineTo(Rr[i][0], Rr[i][1]); g.closePath(); }
  else { for (let i = n - 1; i >= 0; i--) g.lineTo(Rr[i][0], Rr[i][1]); g.closePath(); }
  g.fill();
}
function strokeShape(g, s, closed, st, seed) {
  const bw = st.bw, rnd = rng(seed);
  g.fillStyle = g.strokeStyle = st.bc; g.lineJoin = 'round'; g.lineCap = 'round'; g.setLineDash([]);
  if (st.line === 'clean' || st.line === 'dash') {
    if (st.line === 'dash') g.setLineDash([bw * 3.4, bw * 2.6]);
    g.lineWidth = bw; g.lineJoin = s.sharp ? 'miter' : 'round'; g.miterLimit = 6; g.beginPath(); trace(g, s, closed); g.stroke(); g.setLineDash([]);
  } else if (st.line === 'sketch') {   // 가는 선을 조금씩 어긋나게 여러 번 그어요
    const amp = Math.max(0.8, bw * 0.55);
    for (let k = 0; k < 3; k++) {
      const W1 = wobbler(rnd, [2, 3, 5, 9], 0.8), W2 = wobbler(rnd, [2, 4, 7, 11], 0.8), n = s.pts.length;
      const pts = s.pts.map(([x, y], i) => { const a = i / n * TAU; return [x + W1(a) * amp, y + W2(a) * amp]; });
      g.lineWidth = Math.max(0.6, bw * 0.42); g.globalAlpha *= 0.92; g.beginPath(); trace(g, { pts, sharp: s.sharp }, closed); g.stroke();
    }
  } else {
    const brush = st.line === 'brush', W = wobbler(rnd, brush ? [1, 2, 3, 5, 8, 13] : [1, 2, 3, 5, 8], brush ? 0.85 : 0.7), amp = brush ? 0.62 : 0.26;
    ribbon(g, s.pts, closed, t => { const taper = closed ? 1 : Math.min(1, 0.35 + (1 - t) * 1.4); return Math.max(0.18, 1 + amp * W(t * TAU)) * bw / 2 * taper; });
  }
}

// 이어 붙인 말풍선들(보통 하나)을 한 덩어리로 그려요. 생김새는 첫 말풍선의 것을 써요
export function drawBubbles(g, els) {
  const e0 = els[0], parts = els.map(bubbleShapes), shapes = parts.flatMap(p => p.shapes), strokes = parts.flatMap(p => p.strokes);
  const st = { bw: Math.max(0, e0.bw ?? 3), bc: e0.bc || '#111111', line: e0.line || 'pen' }, t = g.getTransform(), scale = Math.hypot(t.a, t.b) || 1;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const s of shapes) for (const [x, y] of s.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const all = () => { g.beginPath(); shapes.forEach(s => trace(g, s)); };
  g.save();
  if (e0.sh) { g.save(); g.translate(e0.sh, e0.sh); g.fillStyle = st.bc; all(); g.fill(); g.restore(); }
  g.save(); g.globalAlpha *= Math.max(0, Math.min(1, (e0.fop ?? 100) / 100));
  if (e0.soft > 0) g.filter = `blur(${(e0.soft * scale).toFixed(2)}px)`;
  if (e0.fill2) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, e0.fill || '#ffffff'); gr.addColorStop(1, e0.fill2); g.fillStyle = gr; } else g.fillStyle = e0.fill || '#ffffff';
  all(); g.fill(); g.restore();
  if (st.bw > 0) {
    const pad = st.bw * 4 + 40, others = i => { for (let j = 0; j < shapes.length; j++) if (j !== i) { g.beginPath(); g.rect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2); trace(g, shapes[j]); g.clip('evenodd'); } };
    shapes.forEach((s, i) => { g.save(); others(i); strokeShape(g, s, true, st, (e0.seed || 7) * 7919 + i * 131); g.restore(); });
    strokes.forEach((pts, i) => { g.save(); others(-1); strokeShape(g, { pts }, false, st, (e0.seed || 7) * 104729 + i); g.restore(); });
    if (e0.dbl) {   // 겹줄: 몸통 안쪽에 가는 선을 한 줄 더
      const gap = st.bw * 1.9 + 2, thin = { ...st, bw: Math.max(1, st.bw * 0.45), line: st.line === 'dash' ? 'clean' : st.line };
      shapes.forEach((s, i) => { if (!s.body) return; const r = Math.min(...s.pts.map(([x, y]) => Math.hypot(x - s.cx, y - s.cy))), k = Math.max(0.3, (r - gap) / r); g.save(); for (let j = 0; j < shapes.length; j++) if (j !== i && shapes[j].body) { g.beginPath(); g.rect(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2); trace(g, shapes[j]); g.clip('evenodd'); } strokeShape(g, { pts: s.pts.map(([x, y]) => [s.cx + (x - s.cx) * k, s.cy + (y - s.cy) * k]), sharp: s.sharp }, true, thin, (e0.seed || 7) * 31 + i); g.restore(); });
    }
  }
  g.restore();
}

// 점이 말풍선 몸통이나 꼬리 안에 있는지 (눌러서 고를 때)
export function inBubble(e, x, y) {
  const { shapes } = bubbleShapes(e);
  return shapes.some(({ pts }) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; });
}
