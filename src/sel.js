/* ================= 선택 영역 (사각형·타원·올가미·비슷한 색) ================= */
// 선택한 곳을 흐리게·모자이크·칠하기·지우기 하거나, 새 레이어(컷)로 복사해서 그 부분만 보정할 수 있어요
const SEL_TOOLS = [['brush', '마법 붓'], ['rect', '사각형'], ['ellipse', '타원'], ['lasso', '올가미'], ['wand', '비슷한 색']];
let selSt = null, selTool = 'rect', selTol = 32, selCont = true, selFeather = 0, selColor = '#ffffff';
function selStart() {
  const p = page(), s = Math.min(1, 2048 / Math.max(p.w, p.h));
  selSt = { mask: newCanvas(Math.max(1, Math.round(p.w * s)), Math.max(1, Math.round(p.h * s))), s, polys: [], drag: null, hover: null, any: false };
}
function selShape(g, d) { // 끄는 중인 모양 경로 (페이지 좌표)
  g.beginPath();
  if (selTool === 'lasso') { d.pts.forEach((q, i) => i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)); g.closePath(); return; }
  const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y), w = Math.abs(d.b.x - d.a.x), h = Math.abs(d.b.y - d.a.y);
  if (selTool === 'ellipse') g.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2); else g.rect(x, y, w, h);
}
function selPush() { // 선택 되돌리기 (Ctrl+Z, 선택 중에만)
  const c = newCanvas(selSt.mask.width, selSt.mask.height); c.getContext('2d').drawImage(selSt.mask, 0, 0);
  (selSt.undo || (selSt.undo = [])).push(c); if (selSt.undo.length > 30) selSt.undo.shift();
}
function selUndo() {
  const c = selSt && selSt.undo && selSt.undo.pop(); if (!c) { toast('되돌릴 선택이 없어요', 1400); return; }
  const g = selSt.mask.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.drawImage(c, 0, 0); g.restore(); selOutline();
}
function selApply(op, paint) { // op: new | add | sub, paint(g): 흰색으로 칠하기
  selPush(); const g = selSt.mask.getContext('2d');
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (op === 'new') g.clearRect(0, 0, selSt.mask.width, selSt.mask.height);
  g.globalCompositeOperation = op === 'sub' ? 'destination-out' : 'source-over';
  g.setTransform(selSt.s, 0, 0, selSt.s, 0, 0); g.fillStyle = '#fff'; paint(g); g.restore();
  selOutline();
}
function selBits() { // 선택 마스크 → 0/1 배열
  const c = selSt.mask, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, M = new Uint8Array(c.width * c.height);
  let n = 0; for (let i = 0; i < M.length; i++) if (d[i * 4 + 3] >= 128) { M[i] = 1; n++; }
  return { M, n, W: c.width, H: c.height };
}
// 마스크 윤곽: 바깥 테두리 + 안쪽 구멍 (화면 표시용, 짝홀 규칙으로 칠해요)
function maskOutline(M, W, H) {
  const out = czMaskToPolys(M, W, H), inv = new Uint8Array(W * H), st = [];
  for (let i = 0; i < M.length; i++) inv[i] = M[i] ? 0 : 1;
  const push = i => { if (inv[i] === 1) { inv[i] = 2; st.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W); }
  for (let i = 0; i < inv.length; i++) inv[i] = inv[i] === 1 ? 1 : 0; // 테두리와 안 이어진 빈 곳 = 구멍
  return out.concat(czMaskToPolys(inv, W, H));
}
function selOutline() {
  const { M, n, W, H } = selBits(); selSt.any = n > 0;
  selSt.polys = n ? maskOutline(M, W, H).map(pl => pl.map(([x, y]) => [x / selSt.s, y / selSt.s])) : [];
  renderModebar(); requestRender();
}
// 선택 마스크에서 칠해진 곳만 잘라낸 조각 → { x, y, w, h (페이지 좌표), url (흰색 PNG) }
function selCrop() {
  const { M, n, W, H } = selBits(); if (!n) return null;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (M[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, c = newCanvas(w, h); c.getContext('2d').drawImage(selSt.mask, -x0, -y0);
  return { x: x0 / selSt.s, y: y0 / selSt.s, w: w / selSt.s, h: h / selSt.s, c, url: c.toDataURL('image/png') };
}
function selSetBits(M, op, noPush) {
  if (!noPush) selPush(); const c = selSt.mask, g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < M.length; i++) {
    const on = d[i * 4 + 3] >= 128;
    const v = op === 'new' ? M[i] : op === 'add' ? (on || M[i]) : (on && !M[i]);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = v ? 255 : 0;
  }
  g.putImageData(id, 0, 0); selOutline();
}
// 비슷한 색: 클릭한 곳 색과 허용 범위 안의 색 (이어진 곳만 / 그림 전체)
function selWand(p, op) {
  const pg = page(), c = selSt.mask, W = c.width, H = c.height, s = selSt.s;
  const r = newCanvas(W, H), g = r.getContext('2d', { willReadFrequently: true });
  g.setTransform(s, 0, 0, s, 0, 0); drawPage(g, pg, { screen: false, rs: s, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } });
  const d = g.getImageData(0, 0, W, H).data, sx = clamp(Math.floor(p.x * s), 0, W - 1), sy = clamp(Math.floor(p.y * s), 0, H - 1), i0 = (sy * W + sx) * 4;
  const R = d[i0], G = d[i0 + 1], B = d[i0 + 2], tol = selTol * 2.2, M = new Uint8Array(W * H);
  const near = i => { const j = i * 4; return Math.abs(d[j] - R) + Math.abs(d[j + 1] - G) + Math.abs(d[j + 2] - B) <= tol; };
  if (selCont) {
    const st = [sy * W + sx]; M[st[0]] = 1;
    while (st.length) {
      const i = st.pop(), x = i % W, y = (i / W) | 0;
      if (x > 0 && !M[i - 1] && near(i - 1)) { M[i - 1] = 1; st.push(i - 1); }
      if (x < W - 1 && !M[i + 1] && near(i + 1)) { M[i + 1] = 1; st.push(i + 1); }
      if (y > 0 && !M[i - W] && near(i - W)) { M[i - W] = 1; st.push(i - W); }
      if (y < H - 1 && !M[i + W] && near(i + W)) { M[i + W] = 1; st.push(i + W); }
    }
  } else for (let i = 0; i < M.length; i++) M[i] = near(i) ? 1 : 0;
  selSetBits(M, op);
}
/* ---- 마법 붓 (빠른 선택): 펜처럼 그으면 그 근처의 비슷한 곳을 선(경계)까지 묶어서 골라요 ---- */
// 붓이 지나간 곳에서 출발해 옆으로 번지는데, 색이 확 바뀌는 곳(선·경계)은 넘지 못하고 붓으로 칠한 색과 다른 색으로는 멀리 못 가요
let qsSize = 28, qsSpread = 35, qsAI = true, qsHover = null, qs = null, qsImg = null;
try { const o = JSON.parse(localStorage.getItem('potatoQs') || '{}'); if (o.size) qsSize = o.size; if (o.spread) qsSpread = o.spread; if (o.ai !== undefined) qsAI = !!o.ai; } catch (e) { }
const qsSave = () => { try { localStorage.setItem('potatoQs', JSON.stringify({ size: qsSize, spread: qsSpread, ai: qsAI })); } catch (e) { } };
function qsPrep() { // 지금 그림을 계산용 크기로 그려 색(Lab + 투명도)으로 바꿔 둬요
  const pg = page(), key = pg.id + '|' + hi + '|' + pg.w + 'x' + pg.h + '|' + hist.length;
  if (qsImg && qsImg.key === key) return qsImg;
  const s = Math.min(1, 1280 / Math.max(pg.w, pg.h)), W = Math.max(1, Math.round(pg.w * s)), H = Math.max(1, Math.round(pg.h * s));
  const c = newCanvas(W, H), g = c.getContext('2d'); g.setTransform(s, 0, 0, s, 0, 0);
  drawPage(g, pg, { screen: false, rs: s, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } });
  const b = newCanvas(W, H), gb = b.getContext('2d', { willReadFrequently: true }); gb.filter = 'blur(0.6px)'; gb.drawImage(c, 0, 0);
  const d = gb.getImageData(0, 0, W, H).data, N = W * H, C = new Float32Array(N * 4), lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const r = lin[d[j]], gg = lin[d[j + 1]], bb = lin[d[j + 2]];
    const fx = f((r * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047), fy = f(r * 0.2126 + gg * 0.7152 + bb * 0.0722), fz = f((r * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883);
    C[j] = 116 * fy - 16; C[j + 1] = 500 * (fx - fy); C[j + 2] = 200 * (fy - fz); C[j + 3] = d[j + 3] / 2.55; // 투명한 곳은 다른 색처럼
  }
  return qsImg = { key, W, H, s, C, pc: c };
}
const qsD = (C, i, j) => { const a = C[i] - C[j], b = C[i + 1] - C[j + 1], c = C[i + 2] - C[j + 2], d = C[i + 3] - C[j + 3]; return Math.sqrt(a * a + b * b + c * c + d * d); };
function qsParams(I, rw) {
  const t = qsSpread / 100;
  // ws: 고른 색이 이어지는 곳에서 한 칸 갈 때 드는 값 (번짐이 클수록 싸서 멀리 가요). 선을 넘거나 다른 색으로 갈수록 비싸져요
  return { et: 2 + 4 * t, eh: 12 + 10 * t, mt: 7 + 18 * t, A: 10, B: 8, ws: 1 - 0.8 * t, T: Math.round(rw * (3 + 8 * t) + (0.05 + 0.5 * t * t) * Math.max(I.W, I.H)) };
}
function qsBegin(p, op) {
  const I = qsPrep(), N = I.W * I.H, rw = Math.max(1, qsSize / 2 / zoom * I.s);
  const sc = newCanvas(I.W, I.H), sg = sc.getContext('2d', { willReadFrequently: true });
  sg.setTransform(I.s, 0, 0, I.s, 0, 0); sg.strokeStyle = sg.fillStyle = '#fff'; sg.lineCap = sg.lineJoin = 'round'; sg.lineWidth = rw * 2 / I.s;
  qs = { op, I, rw, P: qsParams(I, rw), pts: [p], sc, sg, seed: new Uint8Array(N), dist: new Float32Array(N).fill(Infinity), md: new Float32Array(N).fill(-1), proto: [], bk: [], last: p, prev: null, dirty: true };
  qsAddSeg(p, p); qsRun();
}
function qsProto(x, y) { // 붓 가운데 색을 '고를 색'으로 모아 둬요 (가장자리 색은 섞이기 쉬워서 빼요)
  const { I, rw } = qs; let changed = false;
  for (const [ox, oy] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
    const X = clamp(Math.round(x * I.s + ox * rw), 0, I.W - 1), Y = clamp(Math.round(y * I.s + oy * rw), 0, I.H - 1), j = (Y * I.W + X) * 4;
    if (qs.proto.length >= 32) break;
    if (qs.proto.every(q => Math.hypot(q[0] - I.C[j], q[1] - I.C[j + 1], q[2] - I.C[j + 2], q[3] - I.C[j + 3]) > 5)) { qs.proto.push([I.C[j], I.C[j + 1], I.C[j + 2], I.C[j + 3]]); changed = true; }
  }
  return changed;
}
function qsAddSeg(a, b) {
  const { I, sg, sc, rw } = qs; let pc = false;
  const L = Math.hypot(b.x - a.x, b.y - a.y), stp = Math.max(0.5, rw / I.s * 0.5);
  for (let d = 0; d <= L; d += stp) pc = qsProto(a.x + (b.x - a.x) * (L ? d / L : 0), a.y + (b.y - a.y) * (L ? d / L : 0)) || pc;
  pc = qsProto(b.x, b.y) || pc;
  sg.beginPath(); if (L < 1e-6) { sg.arc(b.x, b.y, rw / I.s, 0, Math.PI * 2); sg.fill(); } else { sg.moveTo(a.x, a.y); sg.lineTo(b.x, b.y); sg.stroke(); }
  const x0 = clamp(Math.floor(Math.min(a.x, b.x) * I.s - rw - 2), 0, I.W), x1 = clamp(Math.ceil(Math.max(a.x, b.x) * I.s + rw + 2), 0, I.W);
  const y0 = clamp(Math.floor(Math.min(a.y, b.y) * I.s - rw - 2), 0, I.H), y1 = clamp(Math.ceil(Math.max(a.y, b.y) * I.s + rw + 2), 0, I.H);
  if (pc) { // 고를 색이 늘었으면 처음부터 다시 번져요
    qs.dist.fill(Infinity); qs.md.fill(-1); qs.bk = [[]];
    for (let i = 0; i < qs.seed.length; i++) if (qs.seed[i]) { qs.dist[i] = 0; qs.bk[0].push(i); }
  }
  if (x1 > x0 && y1 > y0) {
    const d = sg.getImageData(x0, y0, x1 - x0, y1 - y0).data, w = x1 - x0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * I.W + x; if (qs.seed[i] || d[((y - y0) * w + x - x0) * 4 + 3] < 128) continue;
      qs.seed[i] = 1; qs.dist[i] = 0; (qs.bk[0] || (qs.bk[0] = [])).push(i);
    }
  }
  qs.dirty = true;
}
function qsRun() { // 경계를 넘을수록 비싸지는 길 찾기 (8방향, 정수 비용 → 칸 줄 세우기). 비용은 40배로 (대각선 56)
  const { I, P, dist, md, proto, bk } = qs, C = I.C, W = I.W, H = I.H, T = P.T * 40;
  const mdist = i => { let v = md[i]; if (v >= 0) return v; v = 1e9; const j = i * 4; for (const q of proto) { const a = C[j] - q[0], b = C[j + 1] - q[1], c = C[j + 2] - q[2], e = C[j + 3] - q[3], h = a * a + b * b + c * c + e * e; if (h < v) v = h; } return md[i] = Math.sqrt(v); };
  const DX = [-1, 1, 0, 0, -1, 1, -1, 1], DY = [0, 0, -1, 1, -1, -1, 1, 1];
  for (let b = 0; b <= T; b++) {
    const q = bk[b]; if (!q || !q.length) continue;
    while (q.length) {
      const i = q.pop(); if (dist[i] !== b) continue;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx, dg = k >= 4, base = dg ? 56 : 40;
        if (dist[n] <= b) continue;
        const e = qsD(C, i * 4, n * 4) / (dg ? 1.414 : 1); if (e > P.eh) continue; // 또렷한 선·경계는 못 넘어요
        const nd = b + Math.max(1, Math.round(base * (P.ws + P.A * Math.max(0, e - P.et) + P.B * Math.max(0, mdist(n) - P.mt))));
        if (nd > T || nd >= dist[n]) continue;
        dist[n] = nd; (bk[nd] || (bk[nd] = [])).push(n);
      }
    }
  }
}
function qsRegion(st, fillHoles) { // 번진 곳 → 0/1 (계산 크기)
  const { I, dist, P } = st, N = I.W * I.H, M = new Uint8Array(N); let n = 0;
  for (let i = 0; i < N; i++) if (dist[i] <= P.T * 40) { M[i] = 1; n++; }
  if (fillHoles && n) { // 안쪽의 작은 구멍(잡티·반짝임)은 메워요
    const W = I.W, H = I.H, lab = new Uint8Array(N), lim = Math.max(16, n * 0.004 + st.rw * st.rw), sk = [];
    for (let s0 = 0; s0 < N; s0++) {
      if (M[s0] || lab[s0]) continue;
      const comp = []; let edge = false; lab[s0] = 1; sk.push(s0);
      while (sk.length) {
        const i = sk.pop(); comp.push(i); const x = i % W, y = (i / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        if (x > 0 && !M[i - 1] && !lab[i - 1]) { lab[i - 1] = 1; sk.push(i - 1); } if (x < W - 1 && !M[i + 1] && !lab[i + 1]) { lab[i + 1] = 1; sk.push(i + 1); }
        if (y > 0 && !M[i - W] && !lab[i - W]) { lab[i - W] = 1; sk.push(i - W); } if (y < H - 1 && !M[i + W] && !lab[i + W]) { lab[i + W] = 1; sk.push(i + W); }
      }
      if (!edge && comp.length <= lim) for (const i of comp) M[i] = 1;
    }
    // 가장자리 한 칸 더: 선과 색 사이 흐린 경계(안티에일리어싱)까지 덮어야 모자이크·보정 테두리가 안 남아요
    const E = M.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (M[i]) continue;
      if ((x > 0 && M[i - 1]) || (x < W - 1 && M[i + 1]) || (y > 0 && M[i - W]) || (y < H - 1 && M[i + W])) E[i] = 1;
    }
    return E;
  }
  return M;
}
function qsPreview() { // 긋는 중: 고를 곳을 파랗게 미리 보여줘요
  if (!qs || !qs.dirty) return qs && qs.prev; qs.dirty = false;
  const { I } = qs, M = qsRegion(qs, false), c = qs.prev || (qs.prev = newCanvas(I.W, I.H)), g = c.getContext('2d'), id = g.createImageData(I.W, I.H), d = id.data;
  const sub = qs.op === 'sub';
  for (let i = 0; i < M.length; i++) if (M[i]) { const j = i * 4; d[j] = sub ? 255 : 22; d[j + 1] = sub ? 70 : 136; d[j + 2] = sub ? 90 : 224; d[j + 3] = 110; }
  g.putImageData(id, 0, 0); return c;
}
function qsToMask(M, I) { // 계산 크기 0/1 → 선택 마스크 크기 0/1 (부드럽게 키운 뒤 반으로 잘라서 계단이 덜 보이게)
  const c = newCanvas(I.W, I.H), g = c.getContext('2d'), id = g.createImageData(I.W, I.H), d = id.data;
  for (let i = 0; i < M.length; i++) if (M[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = 255; }
  g.putImageData(id, 0, 0);
  const mw = selSt.mask.width, mh = selSt.mask.height, b = newCanvas(mw, mh), gb = b.getContext('2d', { willReadFrequently: true });
  gb.imageSmoothingQuality = 'high'; gb.drawImage(c, 0, 0, mw, mh);
  const a = gb.getImageData(0, 0, mw, mh).data, out = new Uint8Array(mw * mh);
  for (let i = 0; i < out.length; i++) out[i] = a[i * 4 + 3] >= 128 ? 1 : 0;
  return out;
}
async function qsEnd() { // 먼저 보통 방식으로 바로 고르고, AI로 다듬기가 켜져 있으면 다듬은 모양으로 바꿔요
  const st = qs; if (!st) return; qs = null; requestRender();
  if (!selSt) return;
  const ss = selSt; selSetBits(qsToMask(qsRegion(st, true), st.I), st.op);
  if (!qsAI || !czIsApp()) return;
  const snap = ss.undo && ss.undo[ss.undo.length - 1];
  let M = null; try { M = await qsSam(st); } catch (e) { console.warn('qsSam', e); M = null; }
  if (!M) { toast('AI로 다듬지 못해서 보통 방식으로 골랐어요', 2600); return; }
  if (selSt !== ss || !snap || ss.undo[ss.undo.length - 1] !== snap) return; // 그 사이 다른 걸 했으면 그대로 둬요
  const g = ss.mask.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'copy'; g.drawImage(snap, 0, 0); g.restore(); // 긋기 전으로 돌린 뒤
  selSetBits(qsToMask(M, st.I), st.op, true);
}
// AI로 다듬기 (설치판): 붓이 지나간 점들을 MobileSAM에 '이것'으로 알려줘서 물체 모양을 따요
async function qsSam(st) {
  if (!czIsApp() || !(await czPacksReady(['base']))) return null;
  const I = st.I, xs = st.pts.map(q => q.x * I.s), ys = st.pts.map(q => q.y * I.s), rx = 0, ry = 0, rw = I.W, rh = I.H; // 그림 전체를 한 번 읽어 두고 (같은 그림이면 다시 안 읽어요)
  const run = async () => {
    await czLoad('samE'); await czLoad('samD');
    const s = 1024 / Math.max(rw, rh), key = I.key;
    if (cz.samEnc !== key) {
      const tw = Math.max(1, Math.round(rw * s)), th = Math.max(1, Math.round(rh * s)), c = newCanvas(tw, th), gc = c.getContext('2d', { willReadFrequently: true });
      gc.fillStyle = '#fff'; gc.fillRect(0, 0, tw, th); gc.imageSmoothingQuality = 'high'; gc.drawImage(I.pc, rx, ry, rw, rh, 0, 0, tw, th);
      const px = gc.getImageData(0, 0, tw, th).data, x = new Float32Array(tw * th * 3);
      for (let i = 0, j = 0, n = tw * th; i < n; i++, j += 4) { x[i * 3] = px[j]; x[i * 3 + 1] = px[j + 1]; x[i * 3 + 2] = px[j + 2]; }
      await czCall({ t: 'run2', key: 'samE', feeds: { input_image: { data: x, dims: [th, tw, 3] } }, keep: ['image_embeddings'], outs: [] }, [x.buffer]);
      cz.samEnc = key;
    }
    // 획을 따라 고르게 점 몇 개 (너무 많으면 SAM이 헷갈려요)
    const pts = [], L = [0]; for (let i = 1; i < st.pts.length; i++) L.push(L[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    const n = Math.min(8, Math.max(1, Math.round(L.at(-1) / Math.max(4, st.rw * 1.5)) + 1));
    for (let k = 0; k < n; k++) { const t = n === 1 ? 0 : L.at(-1) * k / (n - 1); let i = 1; while (i < L.length - 1 && L[i] < t) i++; const a = L[i - 1] ?? 0, f = L[i] > a ? (t - a) / (L[i] - a) : 0, j0 = Math.max(0, i - 1), j1 = Math.min(st.pts.length - 1, i); pts.push([xs[j0] + (xs[j1] - xs[j0]) * f, ys[j0] + (ys[j1] - ys[j0]) * f]); }
    const pc = new Float32Array(pts.length * 2); pts.forEach(([x, y], i) => { pc[i * 2] = (x - rx) * s; pc[i * 2 + 1] = (y - ry) * s; });
    const r = await czCall({ t: 'run2', key: 'samD', outs: ['masks', 'iou_predictions'], feeds: {
      image_embeddings: { ref: 'image_embeddings' },
      point_coords: { data: pc, dims: [1, pts.length, 2] }, point_labels: { data: new Float32Array(pts.length).fill(1), dims: [1, pts.length] },
      mask_input: { data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] }, has_mask_input: { data: new Float32Array([0]), dims: [1] },
      orig_im_size: { data: new Float32Array([rh, rw]), dims: [2] } } });
    const m = r.out.masks.data, nm = r.out.masks.dims[1] || 1, plane = rw * rh, iou = r.out.iou_predictions ? r.out.iou_predictions.data : null;
    // 후보 4개 중 붓 자리를 거의 다 품고 그림을 통째로 먹지 않는 것 → AI 자신감 + 보통 방식으로 번진 곳과 겹치는 정도가 가장 높은 것
    // (손에 쥔 물건처럼 붙어 있는 것까지 한 덩어리로 잡는 걸 줄여요)
    const R = qsRegion(st, false);
    let best = null, bestS = -1;
    for (let k = 0; k < nm; k++) {
      const off = k * plane; let inS = 0, nS = 0, area = 0, inter = 0, nR = 0;
      for (let i = 0; i < plane; i++) { const on = m[off + i] > 0; if (on) area++; if (st.seed[i]) { nS++; if (on) inS++; } if (R[i]) { nR++; if (on) inter++; } }
      if (!area || inS < nS * 0.8 || area > plane * 0.92) continue;
      const sc = (iou ? iou[k] : 0) * 0.5 + inter / Math.max(1, area + nR - inter);
      if (sc > bestS) { bestS = sc; best = off; }
    }
    if (best === null) return null;
    const M = new Uint8Array(I.W * I.H);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (m[best + y * rw + x] > 0) M[(y + ry) * I.W + x + rx] = 1;
    for (let i = 0; i < M.length; i++) if (st.seed[i]) M[i] = 1;
    // 붓과 떨어진 아주 작은 부스러기 조각은 빼요
    const lab = new Uint8Array(M.length), W = I.W, H = I.H, sk = []; let tot = 0; for (let i = 0; i < M.length; i++) tot += M[i];
    const lim = Math.max(24, tot * 0.004);
    for (let s0 = 0; s0 < M.length; s0++) {
      if (!M[s0] || lab[s0]) continue;
      const comp = []; let hasSeed = false; lab[s0] = 1; sk.push(s0);
      while (sk.length) {
        const i = sk.pop(); comp.push(i); if (st.seed[i]) hasSeed = true; const x = i % W, y = (i / W) | 0;
        if (x > 0 && M[i - 1] && !lab[i - 1]) { lab[i - 1] = 1; sk.push(i - 1); } if (x < W - 1 && M[i + 1] && !lab[i + 1]) { lab[i + 1] = 1; sk.push(i + 1); }
        if (y > 0 && M[i - W] && !lab[i - W]) { lab[i - W] = 1; sk.push(i - W); } if (y < H - 1 && M[i + W] && !lab[i + W]) { lab[i + W] = 1; sk.push(i + W); }
      }
      if (!hasSeed && comp.length < lim) for (const i of comp) M[i] = 0;
    }
    return M;
  };
  toast('AI가 모양을 다듬는 중…', 60000);
  const job = cz.samQ.then(run); cz.samQ = job.catch(() => { });
  try { const M = await job; if (M) toast('골랐어요', 1200); return M; } catch (e) { console.warn('qsSam', e); return null; }
}
function qsOverlay() {
  if (selTool !== 'brush') return;
  const pv = qsPreview(); if (pv) { const o = S({ x: 0, y: 0 }), pg = page(); ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(pv, o.x, o.y, pg.w * zoom, pg.h * zoom); ctx.restore(); }
  const h = qsHover; if (!h) return;
  const s = S(h), r = Math.max(2, qsSize / 2); ctx.save(); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = qs && qs.op === 'sub' ? '#ff5a7a' : '#fff'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke(); ctx.restore();
}
function selDown(p, e) {
  if (!selSt) return;
  const op = e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new';
  if (selTool === 'wand') { selWand(p, op); return; }
  if (selTool === 'brush') { qsHover = p; qsBegin(p, e.altKey ? 'sub' : (e.shiftKey || selSt.any) ? 'add' : 'new'); drag = { mode: 'sel' }; scroller.setPointerCapture(e.pointerId); requestRender(); return; }
  selSt.drag = { op, a: p, b: p, pts: [p] }; drag = { mode: 'sel' }; scroller.setPointerCapture(e.pointerId); requestRender();
}
function selMove(p) {
  if (qs) { qsHover = p; const l = qs.last; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom >= 2) { qsAddSeg(l, p); qs.last = p; qs.pts.push(p); qsRun(); } requestRender(); return; }
  const d = selSt && selSt.drag; if (!d) return;
  d.b = p; if (selTool === 'lasso') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 2) d.pts.push(p); }
  requestRender();
}
function selUp() {
  if (qs) { drag = null; qsEnd(); return; }
  drag = null; const d = selSt && selSt.drag; if (!d) return; selSt.drag = null;
  const tiny = selTool === 'lasso' ? d.pts.length < 3 : Math.abs(d.b.x - d.a.x) * zoom < 3 || Math.abs(d.b.y - d.a.y) * zoom < 3;
  if (tiny) { if (d.op === 'new') selApply('new', () => { }); else requestRender(); return; }
  selApply(d.op, g => { selShape(g, d); g.fill(); });
}
function selAll() { const p = page(); selApply('new', g => g.fillRect(0, 0, p.w, p.h)); }
function selInvert(noPush) {
  if (!noPush) selPush(); const g = selSt.mask.getContext('2d'); g.save(); g.globalCompositeOperation = 'xor'; g.fillStyle = '#fff'; g.fillRect(0, 0, selSt.mask.width, selSt.mask.height); g.restore(); selOutline();
}
function selGrow(px, noPush) { // 넓히기(+)·줄이기(-): 흐린 뒤 기준을 옮겨서. 줄이기는 바깥을 넓혀서 (그림 가장자리는 안 깎이게)
  if (px < 0) { selPush(); selInvert(true); selGrow(-px, true); selInvert(true); return; }
  const c = selSt.mask, W = c.width, H = c.height, r = Math.max(1, Math.abs(px) * selSt.s);
  const t = newCanvas(W, H), g = t.getContext('2d', { willReadFrequently: true }); g.filter = `blur(${r / 2}px)`; g.drawImage(c, 0, 0); g.filter = 'none';
  const d = g.getImageData(0, 0, W, H).data, M = new Uint8Array(W * H), th = 8;
  for (let i = 0; i < M.length; i++) M[i] = d[i * 4 + 3] > th ? 1 : 0;
  selSetBits(M, 'new', noPush);
}
function drawSelOverlay() {
  if (!selSt) return;
  const P = (x, y) => S({ x, y });
  ctx.save(); ctx.lineWidth = 1;
  if (selSt.polys.length) {
    ctx.beginPath(); for (const pl of selSt.polys) { pl.forEach(([x, y], i) => { const q = P(x, y); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.closePath(); }
    ctx.fillStyle = 'rgba(22,136,224,.12)'; ctx.fill('evenodd');
    ctx.setLineDash([5, 4]); ctx.lineDashOffset = -(performance.now() / 60) % 9; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineDashOffset += 4.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  qsOverlay();
  const d = selSt.drag;
  if (d) {
    ctx.setLineDash([4, 3]); ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5;
    ctx.save(); const o = P(0, 0); ctx.translate(o.x, o.y); ctx.scale(zoom, zoom); selShape(ctx, d); ctx.restore(); ctx.stroke();
  }
  ctx.restore();
  if (selSt.polys.length && !selAnts) { selAnts = setInterval(() => { if (mode === 'select' && selSt && selSt.polys.length) requestRender(); else { clearInterval(selAnts); selAnts = 0; } }, 120); }
}
let selAnts = 0;
// 선택한 곳 → 가리기 요소 (흐리게·모자이크·칠하기·지우기)
function selToFx(kind) {
  if (!selSt || !selSt.any) { toast('먼저 고칠 곳을 선택하세요'); return; }
  const cr = selCrop(); if (!cr) return;
  const D = doc.defaults.fx, w = Math.max(1, cr.w), h = Math.max(1, cr.h);
  const el = { id: uid(), type: 'fx', kind, str: kind === 'mosaic' ? Math.max(8, D.str) : D.str, color: selColor, soft: selFeather, pad: 0, x: cr.x, y: cr.y, w, h, rot: 0, s0: Math.sqrt(w * h), strokes: [], shapes: [], polys: [], mask: cr.url };
  page().els.push(el); setMode(null); sel = [el.id]; commit(); renderProps(); requestRender();
  toast({ blur: '선택한 곳을 흐리게 했어요', mosaic: '선택한 곳을 모자이크했어요', paint: '선택한 곳을 칠했어요', erase: '선택한 곳을 지웠어요 (투명)' }[kind] + '. 오른쪽에서 세기를 바꿀 수 있어요', 3600);
}
// 선택한 곳의 그림을 새 레이어(테두리 없는 컷)로 복사 → 그 부분만 따로 보정하거나 옮길 수 있어요
async function selToLayer() {
  if (!selSt || !selSt.any) { toast('먼저 복사할 곳을 선택하세요'); return; }
  const pg = page();
  const cr = selCrop(); if (!cr) return;
  const x0 = Math.max(0, Math.floor(cr.x)), y0 = Math.max(0, Math.floor(cr.y)), x1 = Math.min(pg.w, Math.ceil(cr.x + cr.w)), y1 = Math.min(pg.h, Math.ceil(cr.y + cr.h));
  const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
  // 원래 그림 해상도로 (바탕 그림이 페이지보다 크면 그만큼)
  const B = baseEl(pg), rec = B && B.img && images.get(B.img), k = clamp(rec ? rec.w / Math.max(1, B.w) : 1, 1, 4);
  const c = newCanvas(Math.round(w * k), Math.round(h * k)), g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  const view = { x0, y0, x1, y1 };
  for (const el of pg.els) if (el.type === 'panel' && !el.hidden) drawEl(g, el, { screen: false, rs: k, view }); // 그림(컷)만, 글자·말풍선은 빼고
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-in';
  const m = newCanvas(c.width, c.height), gm = m.getContext('2d'); gm.imageSmoothingQuality = 'high';
  gm.drawImage(selSt.mask, 0, 0, selSt.mask.width, selSt.mask.height, -x0 * k, -y0 * k, selSt.mask.width / selSt.s * k, selSt.mask.height / selSt.s * k);
  if (selFeather > 0) { const m2 = newCanvas(c.width, c.height), g2 = m2.getContext('2d'); g2.filter = `blur(${selFeather * k}px)`; g2.drawImage(m, 0, 0); g.drawImage(m2, 0, 0); } else g.drawImage(m, 0, 0);
  const src = c.toDataURL('image/png'), im = await loadImg(src);
  const rec2 = { id: uid(), name: '선택 복사.png', src, w: c.width, h: c.height, alpha: true, kind: 'stamp' };
  addImageRecord(rec2, true, im);
  const P = makePanel(x0 + w / 2, y0 + h / 2, w, h, rec2.id); P.bw = 0; P.radius = 0; P.name = '선택 복사';
  pg.els.push(P); setMode(null); sel = [P.id]; commit(); renderProps(); requestRender();
  openSecs.add('adv'); renderProps();
  toast('선택한 곳을 새 레이어로 복사했어요. 오른쪽 고급 보정으로 그 부분만 바꿀 수 있어요', 4200);
}
function selModebar() {
  return `<b>선택</b>
    <div class="seg">${SEL_TOOLS.map(([v, l]) => `<button class="btn sm ${selTool === v ? 'on' : ''}" data-mb="st-${v}">${l}</button>`).join('')}</div>
    <div class="seg" title="배경 지우기 AI로 인물(캐릭터)이나 배경을 한 번에 골라요 (설치판)"><button class="btn sm" data-mb="sel-ai">AI 인물</button><button class="btn sm" data-mb="sel-aibg">AI 배경</button></div>
    ${selTool === 'brush' ? `<label title="붓 크기 ( [ ] 키로도 바꿔요)">붓 크기 <input type="range" id="mbQsSize" min="6" max="160" step="1" value="${qsSize}"></label><label title="높을수록 비슷한 색을 따라 더 멀리 번져요. 낮으면 붓 근처만">번짐 <input type="range" id="mbQsSpread" min="1" max="100" step="1" value="${qsSpread}"></label>${czIsApp() ? `<label class="chk" title="MobileSAM으로 물체 모양을 따라 더 깔끔하게 골라요. 처음 한 번은 그림을 읽느라 조금 걸려요"><input type="checkbox" id="mbQsAI" ${qsAI ? 'checked' : ''}> AI로 다듬기</label>` : ''}<span class="mtxt">고를 곳 위를 펜처럼 그으세요 · 그을수록 더해져요</span>` : ''}
    ${selTool === 'wand' ? `<label title="클릭한 색과 얼마나 달라도 같이 고를지">허용 범위 <input type="range" id="mbTol" min="1" max="120" step="1" value="${selTol}"></label><label class="chk"><input type="checkbox" id="mbCont" ${selCont ? 'checked' : ''}> 이어진 곳만</label>` : ''}
    <span class="mtxt">Shift = 더하기, Alt = 빼기</span>
    <div class="seg"><button class="btn sm" data-mb="sel-all">모두</button><button class="btn sm" data-mb="sel-inv">반전</button><button class="btn sm" data-mb="sel-grow">넓히기</button><button class="btn sm" data-mb="sel-shrink">줄이기</button><button class="btn sm" data-mb="sel-none">해제</button></div>
    <label title="선택 가장자리를 부드럽게">경계 흐림 <input type="range" id="mbFeather" min="0" max="40" step="1" value="${selFeather}"></label>
    <span class="mtxt">선택한 곳을:</span>
    <button class="btn sm" data-mb="sf-blur">흐리게</button><button class="btn sm" data-mb="sf-mosaic">모자이크</button><button class="btn sm" data-mb="sf-paint">칠하기</button><input type="color" id="mbSelC" value="${selColor}" title="칠할 색"><button class="btn sm" data-mb="sf-erase" title="그 자리를 투명하게 (PNG로 저장하면 투명)">지우기</button>
    <button class="btn sm primary" data-mb="sf-adj" title="고른 곳에만 들어가는 보정 레이어를 만들어요 (경계 흐림이 그대로 들어가요)">이 부분만 보정</button>
    <button class="btn sm" data-mb="sf-layer" title="선택한 곳을 새 레이어로 복사해서 그 부분만 따로 옮기거나 고쳐요">새 레이어로 복사</button>
    ${czIsApp() ? '<button class="btn sm" data-mb="sf-aierase" title="고른 곳을 지우고 둘레에 맞게 메워요 (AI 지우개 팩)">AI로 지우기</button>' : ''}
    <button class="btn sm" data-mb="done">끝내기</button>`;
}
function selModebarAct(a) {
  if (a.startsWith('st-')) { selTool = a.slice(3); renderModebar(); return true; }
  switch (a) {
    case 'sel-all': selAll(); return true;
    case 'sel-inv': selInvert(); return true;
    case 'sel-none': selApply('new', () => { }); return true;
    case 'sel-grow': selGrow(6 / Math.max(0.2, zoom)); return true;
    case 'sel-shrink': selGrow(-6 / Math.max(0.2, zoom)); return true;
    case 'sf-blur': case 'sf-mosaic': case 'sf-paint': case 'sf-erase': selToFx(a.slice(3)); return true;
    case 'sf-layer': selToLayer(); return true;
    case 'sf-aierase': { if (!selSt || !selSt.any) { toast('먼저 지울 곳을 선택하세요'); return true; } const m = selSt.mask, s = selSt.s; aiErase(m, s).then(ok => { if (ok && mode === 'select') { selApply('new', () => { }); } }); return true; }
    case 'sel-ai': selAI('fg', 'new'); return true;
    case 'sel-aibg': selAI('bg', 'new'); return true;
    case 'sf-adj': { if (!selSt || !selSt.any) { toast('먼저 보정할 곳을 선택하세요'); return true; } e2SelKeep(); const m = selLast; setMode(null); e2AddAdj(m); return true; }
  }
  return false;
}
$('#modebar').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'mbTol') selTol = +t.value; if (t.id === 'mbFeather') selFeather = +t.value; if (t.id === 'mbSelC') selColor = t.value;
  if (t.id === 'mbCont') selCont = t.checked;
  if (t.id === 'mbQsSize') { qsSize = +t.value; qsSave(); requestRender(); } if (t.id === 'mbQsSpread') { qsSpread = +t.value; qsSave(); } if (t.id === 'mbQsAI') { qsAI = t.checked; qsSave(); }
});

/* ================= 고치기 붓: 지우기(투명)·도장(복제)·잡티 지우기 ================= */
// '가리기' 붓의 종류로 들어가요. 도장은 Alt+클릭으로 복사할 곳을 정한 뒤 칠해요
let cloneSrc = null; // 페이지 좌표
function fxMaskCanvas(ctx, el, k, x0, y0, W, H, q, soft) { // 이 요소의 칠한 모양(흰색) → 화면 크기 조각
  const m = ctx.getTransform(), mk = newCanvas(W, H), gm = mk.getContext('2d');
  gm.setTransform(m.a / q, m.b / q, m.c / q, m.d / q, (m.e - x0) / q, (m.f - y0) / q);
  fxShapes(gm, el, k, '#ffffff', soft > 0 ? soft * 0.8 : 0);
  if (soft > 0) { const sc = Math.hypot(m.a, m.b), b = newCanvas(W, H), gb = b.getContext('2d'); gb.filter = `blur(${(soft * sc / q).toFixed(2)}px)`; gb.drawImage(mk, 0, 0); return b; }
  return mk;
}
function fxDevBox(ctx, el, extra) {
  const m = ctx.getTransform(), cw = ctx.canvas.width, ch = ctx.canvas.height, sc = Math.hypot(m.a, m.b);
  const pts = [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const e = (extra || 0) * sc;
  const x0 = clamp(Math.floor(Math.min(...pts.map(p => p[0])) - e), 0, cw), x1 = clamp(Math.ceil(Math.max(...pts.map(p => p[0])) + e), 0, cw);
  const y0 = clamp(Math.floor(Math.min(...pts.map(p => p[1])) - e), 0, ch), y1 = clamp(Math.ceil(Math.max(...pts.map(p => p[1])) + e), 0, ch);
  return { x0, y0, x1, y1, W: x1 - x0, H: y1 - y0, m, sc };
}
function drawFixEl(ctx, el, k, opt) {
  const soft = el.soft || 0;
  if (el.kind === 'erase') {
    const bx = fxDevBox(ctx, el, soft * 3 + 2); if (bx.W < 1 || bx.H < 1) return;
    const mk = fxMaskCanvas(ctx, el, k, bx.x0, bx.y0, bx.W, bx.H, 1, soft);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mk, bx.x0, bx.y0);
    if (opt && opt.screen) { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = checkerPat(); ctx.fillRect(bx.x0, bx.y0, bx.W, bx.H); } // 화면에서는 투명한 곳을 바둑판으로
    ctx.restore(); return;
  }
  if (el.kind === 'clone') {
    const bx = fxDevBox(ctx, el, soft * 3 + 2); if (bx.W < 1 || bx.H < 1) return;
    const m = bx.m, dx = m.a * (el.cdx || 0) + m.c * (el.cdy || 0), dy = m.b * (el.cdx || 0) + m.d * (el.cdy || 0);
    const out = newCanvas(bx.W, bx.H), go = out.getContext('2d');
    go.drawImage(ctx.canvas, -(bx.x0 + dx), -(bx.y0 + dy)); // 아래 그려진 것에서 그만큼 떨어진 곳을 가져와요
    go.globalCompositeOperation = 'destination-in'; go.drawImage(fxMaskCanvas(ctx, el, k, bx.x0, bx.y0, bx.W, bx.H, 1, soft), 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(out, bx.x0, bx.y0); ctx.restore(); return;
  }
  if (el.kind === 'dodge' || el.kind === 'burn') { // 밝게·어둡게: 칠한 곳만 밝기를 바꿔요
    const bx = fxDevBox(ctx, el, soft * 3 + 2); if (bx.W < 1 || bx.H < 1) return;
    const a = clamp((el.str || 10) / 40, 0.05, 1), out = newCanvas(bx.W, bx.H), go = out.getContext('2d');
    go.filter = el.kind === 'dodge' ? `brightness(${(1 + a * 0.8).toFixed(3)}) saturate(${(1 - a * 0.15).toFixed(3)})` : `brightness(${(1 - a * 0.55).toFixed(3)}) saturate(${(1 + a * 0.2).toFixed(3)})`;
    go.drawImage(ctx.canvas, -bx.x0, -bx.y0); go.filter = 'none';
    go.globalCompositeOperation = 'destination-in'; go.drawImage(fxMaskCanvas(ctx, el, k, bx.x0, bx.y0, bx.W, bx.H, 1, soft), 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(out, bx.x0, bx.y0); ctx.restore(); return;
  }
  if (el.kind === 'smudge') { // 문지르기: 붓이 지나간 길을 따라 앞의 그림을 조금씩 끌고 가요
    const maxW = Math.max(4, ...(el.strokes || []).flat().map(q => q[2] || 0)) * k;
    const bx = fxDevBox(ctx, el, maxW + soft * 3 + 4); if (bx.W < 2 || bx.H < 2) return;
    const m = bx.m, sc = bx.sc, work = newCanvas(bx.W, bx.H), gw = work.getContext('2d'); gw.drawImage(ctx.canvas, -bx.x0, -bx.y0);
    const a = clamp((el.str || 10) / 40, 0.1, 0.95), hard = clamp(1 - soft / 24, 0.05, 1);
    for (const st of el.strokes || []) {
      if (isErase(st) || st.length < 2) continue;
      const P = st.map(([u, v, w]) => { const x = (u - 0.5) * el.w, y = (v - 0.5) * el.h; return [m.a * x + m.c * y + m.e - bx.x0, m.b * x + m.d * y + m.f - bx.y0, Math.max(2, w * k * sc / 2)]; });
      const r = Math.max(2, Math.round(P[0][2])), D = r * 2, dab = newCanvas(D, D), gd = dab.getContext('2d'), gr = gd.createRadialGradient(r, r, r * hard * 0.9, r, r, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); gd.fillStyle = gr; gd.fillRect(0, 0, D, D); const T = newCanvas(D, D), gt = T.getContext('2d');
      let [px, py] = P[0];
      for (let i = 1; i < P.length; i++) {
        const [qx, qy] = P[i], L = Math.hypot(qx - px, qy - py), step = Math.max(1, r * 0.25);
        for (let d = step; d <= L; d += step) {
          const cx = px + (qx - px) * d / L, cy = py + (qy - py) * d / L, sx = px + (qx - px) * (d - step) / L, sy = py + (qy - py) * (d - step) / L;
          gt.globalCompositeOperation = 'copy'; gt.drawImage(work, sx - r, sy - r, D, D, 0, 0, D, D);
          gt.globalCompositeOperation = 'destination-in'; gt.drawImage(dab, 0, 0);
          gw.globalAlpha = a; gw.drawImage(T, cx - r, cy - r); gw.globalAlpha = 1;
        }
        if (L >= step) { const f = Math.floor(L / step) * step / L; px += (qx - px) * f; py += (qy - py) * f; }
      }
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(work, bx.x0, bx.y0); ctx.restore(); return;
  }
  if (el.kind === 'heal') {
    const bx0 = fxDevBox(ctx, el, 0), pad = Math.max(8, Math.min(bx0.W, bx0.H) * 0.6 + 6);
    const bx = fxDevBox(ctx, el, pad / Math.max(0.01, bx0.sc)); if (bx.W < 2 || bx.H < 2) return;
    const q = Math.max(1, Math.max(bx.W, bx.H) / 640), W = Math.max(2, Math.round(bx.W / q)), H = Math.max(2, Math.round(bx.H / q)); // 크면 줄여서 계산
    const src = newCanvas(W, H), gs = src.getContext('2d', { willReadFrequently: true }); gs.drawImage(ctx.canvas, bx.x0, bx.y0, bx.W, bx.H, 0, 0, W, H);
    const mk = fxMaskCanvas(ctx, el, k, bx.x0, bx.y0, W, H, q, 0), md = mk.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const id = gs.getImageData(0, 0, W, H), hole = new Uint8Array(W * H); for (let i = 0; i < hole.length; i++) hole[i] = md[i * 4 + 3] > 20 ? 1 : 0;
    healFill(id.data, hole, W, H); gs.putImageData(id, 0, 0);
    // 매끈하게 메운 곳에 둘레의 결(잡음)을 살짝 입혀요
    gs.globalCompositeOperation = 'destination-in'; gs.drawImage(fxMaskCanvas(ctx, el, k, bx.x0, bx.y0, W, H, q, Math.max(soft, 2)), 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, bx.x0, bx.y0, bx.W, bx.H); ctx.restore();
  }
}
// 구멍 메우기 (밀고 당기기 방식): 작게 줄여 가며 둘레 색을 모으고, 다시 키우며 구멍만 채워요
function healFill(d, hole, W, H) {
  const levels = [{ W, H, c: new Float32Array(W * H * 3), w: new Float32Array(W * H) }];
  for (let i = 0; i < W * H; i++) { const ok = hole[i] ? 0 : 1; levels[0].w[i] = ok; levels[0].c[i * 3] = d[i * 4] * ok; levels[0].c[i * 3 + 1] = d[i * 4 + 1] * ok; levels[0].c[i * 3 + 2] = d[i * 4 + 2] * ok; }
  while (levels[levels.length - 1].W > 1 || levels[levels.length - 1].H > 1) {
    const a = levels[levels.length - 1], w2 = Math.max(1, Math.ceil(a.W / 2)), h2 = Math.max(1, Math.ceil(a.H / 2)), b = { W: w2, H: h2, c: new Float32Array(w2 * h2 * 3), w: new Float32Array(w2 * h2) };
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      let cw = 0, r = 0, g = 0, bl = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const X = Math.min(a.W - 1, x * 2 + dx), Y = Math.min(a.H - 1, y * 2 + dy), j = Y * a.W + X; cw += a.w[j]; r += a.c[j * 3]; g += a.c[j * 3 + 1]; bl += a.c[j * 3 + 2]; }
      const o = y * w2 + x, n = cw > 0 ? 1 / cw : 0; b.w[o] = Math.min(1, cw); b.c[o * 3] = r * n * b.w[o]; b.c[o * 3 + 1] = g * n * b.w[o]; b.c[o * 3 + 2] = bl * n * b.w[o];
    }
    levels.push(b); if (w2 === 1 && h2 === 1) break;
  }
  for (let L = levels.length - 2; L >= 0; L--) {
    const a = levels[L], b = levels[L + 1];
    for (let y = 0; y < a.H; y++) for (let x = 0; x < a.W; x++) {
      const o = y * a.W + x, wa = a.w[o]; if (wa >= 1) continue;
      const fx = Math.min(b.W - 1, Math.max(0, x / 2 - 0.25)), fy = Math.min(b.H - 1, Math.max(0, y / 2 - 0.25)), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(b.W - 1, x0 + 1), y1 = Math.min(b.H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      for (let ch = 0; ch < 3; ch++) {
        const v = (j => b.w[j] > 0 ? b.c[j * 3 + ch] / b.w[j] : 0);
        const up = (v(y0 * b.W + x0) * (1 - tx) + v(y0 * b.W + x1) * tx) * (1 - ty) + (v(y1 * b.W + x0) * (1 - tx) + v(y1 * b.W + x1) * tx) * ty;
        const cur = wa > 0 ? a.c[o * 3 + ch] / wa : 0;
        a.c[o * 3 + ch] = (cur * wa + up * (1 - wa));
      }
      a.w[o] = 1;
    }
  }
  const L0 = levels[0];
  for (let i = 0; i < W * H; i++) if (hole[i]) { d[i * 4] = L0.c[i * 3]; d[i * 4 + 1] = L0.c[i * 3 + 1]; d[i * 4 + 2] = L0.c[i * 3 + 2]; d[i * 4 + 3] = 255; }
}

// 선택으로 만든 가리기 요소: 모양을 흰 마스크 그림(el.mask)으로 가지고 있어요 (구멍·반전도 그대로)
const fxMaskImgs = new Map();
function fxMaskDraw(g, el, color) {
  let im = fxMaskImgs.get(el.mask);
  if (!im) { im = new Image(); im.onload = () => { requestRender(); renderLibSoon(); }; im.src = el.mask; fxMaskImgs.set(el.mask, im); if (fxMaskImgs.size > 60) fxMaskImgs.delete(fxMaskImgs.keys().next().value); }
  if (!im.complete || !im.naturalWidth) return;
  let src = im;
  if (color && color.toLowerCase() !== '#ffffff') { const c = newCanvas(im.naturalWidth, im.naturalHeight), gc = c.getContext('2d'); gc.drawImage(im, 0, 0); gc.globalCompositeOperation = 'source-in'; gc.fillStyle = color; gc.fillRect(0, 0, c.width, c.height); src = c; }
  g.save(); g.imageSmoothingQuality = 'high'; g.drawImage(src, -el.w / 2, -el.h / 2, el.w, el.h); g.restore();
}
