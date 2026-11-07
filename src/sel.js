/* ================= 선택 영역 (사각형·타원·올가미·비슷한 색) ================= */
// 선택한 곳을 흐리게·모자이크·칠하기·지우기 하거나, 새 레이어(컷)로 복사해서 그 부분만 보정할 수 있어요
const SEL_TOOLS = [['rect', '사각형'], ['ellipse', '타원'], ['lasso', '올가미'], ['wand', '비슷한 색']];
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
function selApply(op, paint) { // op: new | add | sub, paint(g): 흰색으로 칠하기
  const g = selSt.mask.getContext('2d');
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
function selSetBits(M, op) {
  const c = selSt.mask, g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, c.width, c.height), d = id.data;
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
function selDown(p, e) {
  if (!selSt) return;
  const op = e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new';
  if (selTool === 'wand') { selWand(p, op); return; }
  selSt.drag = { op, a: p, b: p, pts: [p] }; drag = { mode: 'sel' }; scroller.setPointerCapture(e.pointerId); requestRender();
}
function selMove(p) {
  const d = selSt && selSt.drag; if (!d) return;
  d.b = p; if (selTool === 'lasso') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) * zoom > 2) d.pts.push(p); }
  requestRender();
}
function selUp() {
  drag = null; const d = selSt && selSt.drag; if (!d) return; selSt.drag = null;
  const tiny = selTool === 'lasso' ? d.pts.length < 3 : Math.abs(d.b.x - d.a.x) * zoom < 3 || Math.abs(d.b.y - d.a.y) * zoom < 3;
  if (tiny) { if (d.op === 'new') selApply('new', () => { }); else requestRender(); return; }
  selApply(d.op, g => { selShape(g, d); g.fill(); });
}
function selAll() { const p = page(); selApply('new', g => g.fillRect(0, 0, p.w, p.h)); }
function selInvert() {
  const g = selSt.mask.getContext('2d'); g.save(); g.globalCompositeOperation = 'xor'; g.fillStyle = '#fff'; g.fillRect(0, 0, selSt.mask.width, selSt.mask.height); g.restore(); selOutline();
}
function selGrow(px) { // 넓히기(+)·줄이기(-): 흐린 뒤 기준을 옮겨서. 줄이기는 바깥을 넓혀서 (그림 가장자리는 안 깎이게)
  if (px < 0) { selInvert(); selGrow(-px); selInvert(); return; }
  const c = selSt.mask, W = c.width, H = c.height, r = Math.max(1, Math.abs(px) * selSt.s);
  const t = newCanvas(W, H), g = t.getContext('2d', { willReadFrequently: true }); g.filter = `blur(${r / 2}px)`; g.drawImage(c, 0, 0); g.filter = 'none';
  const d = g.getImageData(0, 0, W, H).data, M = new Uint8Array(W * H), th = 8;
  for (let i = 0; i < M.length; i++) M[i] = d[i * 4 + 3] > th ? 1 : 0;
  selSetBits(M, 'new');
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
    ${selTool === 'wand' ? `<label title="클릭한 색과 얼마나 달라도 같이 고를지">허용 범위 <input type="range" id="mbTol" min="1" max="120" step="1" value="${selTol}"></label><label class="chk"><input type="checkbox" id="mbCont" ${selCont ? 'checked' : ''}> 이어진 곳만</label>` : ''}
    <span class="mtxt">Shift = 더하기, Alt = 빼기</span>
    <div class="seg"><button class="btn sm" data-mb="sel-all">모두</button><button class="btn sm" data-mb="sel-inv">반전</button><button class="btn sm" data-mb="sel-grow">넓히기</button><button class="btn sm" data-mb="sel-shrink">줄이기</button><button class="btn sm" data-mb="sel-none">해제</button></div>
    <label title="선택 가장자리를 부드럽게">경계 흐림 <input type="range" id="mbFeather" min="0" max="40" step="1" value="${selFeather}"></label>
    <span class="mtxt">선택한 곳을:</span>
    <button class="btn sm" data-mb="sf-blur">흐리게</button><button class="btn sm" data-mb="sf-mosaic">모자이크</button><button class="btn sm" data-mb="sf-paint">칠하기</button><input type="color" id="mbSelC" value="${selColor}" title="칠할 색"><button class="btn sm" data-mb="sf-erase" title="그 자리를 투명하게 (PNG로 저장하면 투명)">지우기</button>
    <button class="btn sm primary" data-mb="sf-layer" title="선택한 곳을 새 레이어로 복사해서 그 부분만 따로 보정하거나 옮겨요">새 레이어로 복사</button>
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
  }
  return false;
}
$('#modebar').addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'mbTol') selTol = +t.value; if (t.id === 'mbFeather') selFeather = +t.value; if (t.id === 'mbSelC') selColor = t.value;
  if (t.id === 'mbCont') selCont = t.checked;
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
