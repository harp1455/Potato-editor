/* ================= 더 많은 편집: 레이어 마스크 · 보정 레이어 · 색 화면 · 카메라 템플릿 · 도형 · 글자 나누기 · 스포이트 · AI 인물 선택 ================= */

/* ---- 레이어 마스크: 흰색 = 보임, 투명 = 숨김. 요소 상자 크기 그림(el.lmask)으로 가지고 있어요 ---- */
const lmImgs = new Map(), lmLive = new Map(); // dataURL → Image, 요소 id → { c: 칠하는 캔버스, url }
const LM_TYPES = new Set(['panel', 'shape', 'tmpl', 'stamp', 'draw']);
function lmSrc(el) {
  const L = lmLive.get(el.id); if (L && L.url === el.lmask) return L.c;
  let im = lmImgs.get(el.lmask);
  if (!im) { im = new Image(); im.onload = () => requestRender(); im.src = el.lmask; lmImgs.set(el.lmask, im); if (lmImgs.size > 40) lmImgs.delete(lmImgs.keys().next().value); }
  return im.complete && im.naturalWidth ? im : null;
}
function lmApply(g, el) { // 따로 그린 요소에 마스크 씌우기 (drawEl에서)
  const m = lmSrc(el); if (!m) return;
  g.save(); g.translate(el.x + el.w / 2, el.y + el.h / 2); if (el.rot) g.rotate(el.rot * DEG);
  g.globalCompositeOperation = 'destination-in'; g.imageSmoothingQuality = 'high'; g.drawImage(m, -el.w / 2, -el.h / 2, el.w, el.h); g.restore();
}
function lmBlank(el) { // 요소 상자 크기 마스크 캔버스 (긴 쪽 256~2048)
  const L = Math.max(el.w, el.h, 1), s = clamp(L, 256, 2048) / L;
  return newCanvas(Math.max(1, Math.round(el.w * s)), Math.max(1, Math.round(el.h * s)));
}
function lmSet(el, c) { const url = c.toDataURL('image/png'); el.lmask = url; lmLive.set(el.id, { c, url }); }
function lmEdit(el) { // 칠할 캔버스 (없으면 다 보이는 마스크로 시작)
  const L = lmLive.get(el.id); if (L && L.url === el.lmask && L.c.width) return L.c;
  const c = lmBlank(el), g = c.getContext('2d');
  if (el.lmask) { const im = lmSrc(el); if (im) g.drawImage(im, 0, 0, c.width, c.height); else { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } }
  else { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  lmLive.set(el.id, { c, url: el.lmask }); return c;
}
// 페이지 좌표 마스크(선택 영역) → 이 요소의 마스크
function lmFromPageMask(el, mk, s, feather) {
  const c = lmBlank(el), g = c.getContext('2d'), W = c.width, H = c.height;
  g.setTransform(W / el.w, 0, 0, H / el.h, W / 2, H / 2); if (el.rot) g.rotate(-el.rot * DEG); g.translate(-(el.x + el.w / 2), -(el.y + el.h / 2));
  if (feather > 0) g.filter = `blur(${(feather * W / el.w).toFixed(2)}px)`;
  g.imageSmoothingQuality = 'high'; g.drawImage(mk, 0, 0, mk.width / s, mk.height / s);
  return c;
}
let selLast = null; // 선택을 끝낼 때 남겨 둔 선택 영역 { c, s, feather }
function e2SelKeep() { if (!selSt || !selSt.any) return; const c = newCanvas(selSt.mask.width, selSt.mask.height); c.getContext('2d').drawImage(selSt.mask, 0, 0); selLast = { c, s: selSt.s, feather: selFeather }; }
function lmSec(el) {
  if (!LM_TYPES.has(el.type) || el.lock) return '';
  return sec('lmask', '레이어 마스크', `<p class="muted small" style="margin:0 0 6px">이 레이어의 일부만 보이게 해요. 칠한 곳은 숨고, 다시 칠하면 보여요.</p>
    <div class="btnrow"><button class="btn sm primary" data-act="e2-mk-paint">마스크 칠하기</button>${selLast ? '<button class="btn sm" data-act="e2-mk-sel" title="마지막으로 선택한 곳만 보이게">선택한 곳만 보이게</button>' : ''}</div>
    ${el.lmask ? '<div class="btnrow"><button class="btn sm" data-act="e2-mk-inv">마스크 반전</button><button class="btn sm danger" data-act="e2-mk-del">마스크 없애기</button></div>' : ''}`, el.lmask ? '켜짐' : '');
}

/* ---- 마스크 붓 ---- */
let mkSt = null, mkHover = null;
const mkOpt = { hide: true, size: 80, soft: 50 };
function mkStart(id) { const el = findEl(id); if (!el) return false; mkSt = { id, stroke: null }; lmEdit(el); return true; }
const mkEl = () => mkSt && findEl(mkSt.id);
function mkModebar() {
  return `<b>마스크 칠하기</b>
    <div class="seg" title="X로 바꿔요"><button class="btn sm ${mkOpt.hide ? 'on' : ''}" data-mb="mk-hide">숨기기</button><button class="btn sm ${mkOpt.hide ? '' : 'on'}" data-mb="mk-show">보이기</button></div>
    <label>굵기 <input type="range" id="mbMkSize" min="4" max="600" step="1" value="${mkOpt.size}"></label>
    <label>부드럽게 <input type="range" id="mbMkSoft" min="0" max="100" step="1" value="${mkOpt.soft}"></label>
    <div class="seg"><button class="btn sm" data-mb="mk-all">모두 보이기</button><button class="btn sm" data-mb="mk-none">모두 숨기기</button><button class="btn sm" data-mb="mk-inv">반전</button></div>
    <span class="mtxt">빨간 곳이 숨은 곳이에요</span>
    <button class="btn sm primary" data-mb="done">다 칠했어요</button>`;
}
function mkFill(how) {
  const el = mkEl(); if (!el) return; const c = lmEdit(el), g = c.getContext('2d');
  if (how === 'inv') { g.globalCompositeOperation = 'xor'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over'; }
  else { g.clearRect(0, 0, c.width, c.height); if (how === 'all') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } }
  lmSet(el, c); commit(); requestRender();
}
function mkLocal(el, p, c) { const q = toLocal(el, p); return { x: (q.x + el.w / 2) * c.width / el.w, y: (q.y + el.h / 2) * c.height / el.h }; }
function mkDab(el, c, p) {
  const g = c.getContext('2d'), q = mkLocal(el, p, c), r = Math.max(0.5, mkOpt.size / 2 * c.width / el.w), hard = 1 - mkOpt.soft / 100;
  const gr = g.createRadialGradient(q.x, q.y, r * hard * 0.98, q.x, q.y, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.save(); g.globalCompositeOperation = mkOpt.hide ? 'destination-out' : 'source-over'; g.fillStyle = gr; g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill(); g.restore();
}
function mkDown(p, e) { const el = mkEl(); if (!el) return; const c = lmEdit(el); mkSt.stroke = { last: p }; mkDab(el, c, p); drag = { mode: 'mask' }; scroller.setPointerCapture(e.pointerId); requestRender(); }
function mkMove(p) {
  const el = mkEl(), st = mkSt && mkSt.stroke; if (!el || !st) return; const c = lmEdit(el), d = Math.hypot(p.x - st.last.x, p.y - st.last.y), step = Math.max(1, mkOpt.size * 0.12);
  for (let k = step; k <= d; k += step) mkDab(el, c, { x: st.last.x + (p.x - st.last.x) * k / d, y: st.last.y + (p.y - st.last.y) * k / d });
  if (d >= step) st.last = p; mkHover = p; requestRender();
}
function mkUp() { drag = null; const el = mkEl(); if (!el || !mkSt.stroke) return; mkSt.stroke = null; lmSet(el, lmEdit(el)); e2SetHint(mkOpt.hide ? '마스크 숨기기' : '마스크 보이기'); commit(); requestRender(); }
function mkOverlay() {
  const el = mkEl(); if (!el) return; const c = lmEdit(el);
  const t = newCanvas(c.width, c.height), g = t.getContext('2d'); g.fillStyle = '#ff2a4f'; g.fillRect(0, 0, t.width, t.height); g.globalCompositeOperation = 'destination-out'; g.drawImage(c, 0, 0);
  const o = S({ x: 0, y: 0 });
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(zoom, zoom); ctx.translate(el.x + el.w / 2, el.y + el.h / 2); if (el.rot) ctx.rotate(el.rot * DEG);
  ctx.globalAlpha = 0.42; ctx.drawImage(t, -el.w / 2, -el.h / 2, el.w, el.h); ctx.globalAlpha = 1;
  ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 1.2 / zoom; ctx.strokeStyle = '#ff2a4f'; ctx.strokeRect(-el.w / 2, -el.h / 2, el.w, el.h); ctx.restore();
  if (mkHover) { const s = S(mkHover), r = Math.max(2, mkOpt.size / 2 * zoom); ctx.save(); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke(); ctx.lineWidth = 1.5; ctx.strokeStyle = mkOpt.hide ? '#ff5a7a' : '#fff'; ctx.stroke(); ctx.restore(); }
}

/* ---- 보정 레이어: 아래에 그려진 것 전체를 보정해요 (그림 보정·고급 보정·분위기) ---- */
let advLiveN = 0;
function advLive(c, L, lv) {
  const gl = advGL(); if (!gl) return null;
  const key = '__live|' + c.width + 'x' + c.height, t = advG.src.get(key); if (t) { gl.deleteTexture(t); advG.src.delete(key); }
  return advProcess('__live', c, c.width, c.height, L, lv);
}
function drawAdjL(ctx, el, opt) {
  const B = opt.backdrop || ctx, cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const Mg = ctx.getTransform().rotate(-(el.rot || 0)).translate(-cx, -cy), Mb = opt.backdrop ? B.getTransform() : Mg;
  const pts = [[el.x, el.y], [el.x + el.w, el.y], [el.x, el.y + el.h], [el.x + el.w, el.y + el.h]].map(([x, y]) => { const r = rot(x - cx, y - cy, (el.rot || 0) * DEG); return Mb.transformPoint(new DOMPoint(cx + r.x, cy + r.y)); });
  const cw = B.canvas.width, ch = B.canvas.height;
  const x0 = clamp(Math.floor(Math.min(...pts.map(p => p.x))), 0, cw), x1 = clamp(Math.ceil(Math.max(...pts.map(p => p.x))), 0, cw);
  const y0 = clamp(Math.floor(Math.min(...pts.map(p => p.y))), 0, ch), y1 = clamp(Math.ceil(Math.max(...pts.map(p => p.y))), 0, ch);
  const W = x1 - x0, H = y1 - y0; if (W < 2 || H < 2) return;
  const cf = colorFilter(el), bl = fx(el, 'blur'), ak = advKey(el);
  if (!cf && !(bl > 0) && !ak) return; // 바꾼 게 없으면 그대로 두기
  const snap = newCanvas(W, H); snap.getContext('2d').drawImage(B.canvas, x0, y0, W, H, 0, 0, W, H);
  const sc = Math.hypot(Mb.a, Mb.b) || 1;
  const out = ak ? (advLive(snap, el, Math.max(0.25, 1 / sc)) || snap) : snap;
  ctx.save(); ctx.setTransform(Mg.multiply(Mb.inverse()));
  const f = [cf, bl > 0 ? `blur(${(bl * sc).toFixed(2)}px)` : ''].filter(Boolean).join(' '); if (f) ctx.filter = f;
  ctx.drawImage(out, x0, y0); ctx.restore();
}
function e2NewFullPanel(extra) {
  const p = page(), el = makePanel(p.w / 2, p.h / 2, p.w, p.h, null);
  Object.assign(el, { bw: 0, radius: 0, pass: true }, extra);
  p.els.push(el); sel = [el.id]; if (mode) setMode(null); commit(); renderProps(); requestRender(); return el;
}
function e2AddAdj(mask) {
  const el = e2NewFullPanel({ adjL: true, name: mask ? '부분 보정' : '보정 레이어' });
  if (mask) { lmSet(el, lmFromPageMask(el, mask.c, mask.s, mask.feather)); commit(); }
  openSecs.add('adv'); openSecs.add('adj'); renderProps(); requestRender();
  toast(mask ? '고른 곳만 보정하는 레이어를 만들었어요. 오른쪽 보정 값을 바꿔 보세요' : '보정 레이어를 만들었어요. 아래에 있는 그림 전체가 같이 바뀌어요', 4200);
}
function e2AddFill(color, name) { const el = e2NewFullPanel({ fill: color, name }); toast(`${name}을 맨 위에 깔았어요. 오른쪽 아래 레이어 칸에서 불투명도·섞는 법을 바꾸거나 '마스크 칠하기'로 일부만 보이게 해요`, 4800); return el; }
function e2InfoSec(el) {
  if (el.adjL) return `<div class="sec"><h3>${esc(el.name || '보정 레이어')}</h3><p class="muted small">이 레이어 아래에 있는 그림 전체에 보정이 들어가요. 레이어 마스크로 일부에만 넣을 수 있어요.</p></div>`;
  return `<div class="sec"><h3>${esc(el.name || '색 화면')}</h3>${row('색', color('fill'))}
    <div class="btnrow">${[['#000000', '검정'], ['#ffffff', '흰색'], ['#808080', '회색'], ['#ff2d55', '빨강'], ['#1e90ff', '파랑']].map(([c, l]) => `<button class="btn sm" data-act="e2-fillc" data-v="${c}"><span class="swatch" style="background:${c}"></span>${l}</button>`).join('')}</div>
    <p class="muted small">오른쪽 아래 '레이어' 칸에서 불투명도를 낮추거나 섞는 법(곱하기, 스크린 등)을 바꿔 보세요.</p></div>`;
}

/* ---- 카메라 템플릿 (뷰파인더·녹화·폰 촬영·VHS·CCTV·필름·즉석 사진) + 레터박스 ---- */
const TMPL_KINDS = [['vf', '카메라 뷰파인더'], ['rec', '캠코더 녹화 화면'], ['phone', '폰 동영상 촬영 화면'], ['vhs', 'VHS 비디오'], ['cctv', 'CCTV'], ['film', '필름 프레임'], ['instant', '즉석 사진 테두리'], ['letterbox', '레터박스만']];
const LB_RATIOS = [['0', '없음'], ['2.39', '시네마 2.39 : 1'], ['2', '2 : 1'], ['1.85', '1.85 : 1'], ['1.78', '16 : 9'], ['1.33', '4 : 3'], ['1', '1 : 1'], ['0.8', '4 : 5'], ['0.5625', '9 : 16']];
const TMPL_DEF = k => ({ kind: k, color: '#ffffff', txt: { rec: 'REC', cctv: 'CAM 01', vhs: 'PLAY', instant: '우리의 여름', phone: '' }[k] ?? '', time: '00:12:34', date: '2026.11.08', lb: k === 'letterbox' ? '2.39' : '0', lbColor: '#000000', grid: k === 'vf', info: true, lbFull: true });
const tFmt = s => { s = Math.max(0, Math.floor(s)); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':'); };
const tParse = str => { const a = String(str || '').split(':').map(Number); return a.some(isNaN) ? 0 : a.reduce((s, v) => s * 60 + v, 0); };
// o: 템플릿 값, W×H 크기에 그려요. t = 움짤 시간(초, 없으면 멈춘 그림)
function tmplDraw(g, o, W, H, t) {
  const live = t != null, u = Math.min(W, H) / 100, col = o.color || '#ffffff', mono = '"Consolas","D2Coding","Courier New",monospace';
  let ax = 0, ay = 0, aw = W, ah = H; const r = parseFloat(o.lb) || 0;
  if (r > 0) { // 레터박스: 비율에 맞춰 남는 곳을 막대로
    if (W / H > r) { aw = H * r; ax = (W - aw) / 2; } else { ah = W / r; ay = (H - ah) / 2; }
    g.save(); g.fillStyle = o.lbColor || '#000'; if (ax > 0) { g.fillRect(0, 0, ax + 0.5, H); g.fillRect(ax + aw - 0.5, 0, ax + 1, H); } if (ay > 0) { g.fillRect(0, 0, W, ay + 0.5); g.fillRect(0, ay + ah - 0.5, W, ay + 1); } g.restore();
  }
  if (o.kind === 'letterbox') return;
  const U = Math.min(aw, ah) / 100, sh = () => { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = U * 0.8; g.shadowOffsetY = U * 0.15; };
  const text = (s, x, y, size, al, font, c) => { g.font = `${font || '600'} ${size}px ${o.kind === 'phone' ? 'system-ui,sans-serif' : mono}`; g.textAlign = al || 'left'; g.textBaseline = 'middle'; g.fillStyle = c || col; g.fillText(s, x, y); };
  const corners = (m, L, lw) => { g.lineWidth = lw; g.strokeStyle = col; g.lineCap = 'square'; g.beginPath();
    for (const [x, y, sx, sy] of [[ax + m, ay + m, 1, 1], [ax + aw - m, ay + m, -1, 1], [ax + m, ay + ah - m, 1, -1], [ax + aw - m, ay + ah - m, -1, -1]]) { g.moveTo(x, y + sy * L); g.lineTo(x, y); g.lineTo(x + sx * L, y); }
    g.stroke(); };
  const battery = (x, y, s) => { g.lineWidth = s * 0.09; g.strokeStyle = col; g.fillStyle = col; g.strokeRect(x - s, y - s * 0.32, s * 1.7, s * 0.64); g.fillRect(x + s * 0.7, y - s * 0.14, s * 0.14, s * 0.28); g.fillRect(x - s * 0.88, y - s * 0.2, s * 1.2, s * 0.4); };
  const timeStr = live ? tFmt(tParse(o.time) + t) : (o.time || '00:00:00'), blink = !live || (t % 1) < 0.6;
  g.save(); g.beginPath(); g.rect(ax, ay, aw, ah); g.clip(); sh();
  const k = o.kind;
  if (k === 'vf' || k === 'rec' || k === 'cctv') {
    corners(U * 6, U * 8, U * (k === 'cctv' ? 0.35 : 0.55));
    if (k === 'vf') {
      g.lineWidth = U * 0.35; g.strokeStyle = col; const c = [ax + aw / 2, ay + ah / 2], f = U * 7;
      g.beginPath(); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.moveTo(c[0] + sx * f, c[1] + sy * f * 0.55); g.lineTo(c[0] + sx * f, c[1] + sy * f); g.lineTo(c[0] + sx * f * 0.55, c[1] + sy * f); } g.stroke();
      g.beginPath(); g.moveTo(c[0] - U * 1.2, c[1]); g.lineTo(c[0] + U * 1.2, c[1]); g.moveTo(c[0], c[1] - U * 1.2); g.lineTo(c[0], c[1] + U * 1.2); g.stroke();
      if (o.grid) { g.save(); g.shadowColor = 'transparent'; g.globalAlpha = 0.35; g.lineWidth = U * 0.18; g.beginPath(); for (const q of [1, 2]) { g.moveTo(ax + aw * q / 3, ay); g.lineTo(ax + aw * q / 3, ay + ah); g.moveTo(ax, ay + ah * q / 3); g.lineTo(ax + aw, ay + ah * q / 3); } g.stroke(); g.restore(); }
      if (o.info) { text('4K  30fps', ax + U * 9, ay + U * 10, U * 3); battery(ax + aw - U * 13, ay + U * 10, U * 2.6); text('ISO 400   1/60   F2.8', ax + U * 9, ay + ah - U * 10, U * 2.8); text(timeStr, ax + aw - U * 9, ay + ah - U * 10, U * 2.8, 'right'); }
    } else if (k === 'rec') {
      if (blink) { g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(ax + U * 11, ay + U * 11, U * 1.6, 0, Math.PI * 2); g.fill(); }
      text(o.txt || 'REC', ax + U * 14, ay + U * 11, U * 3.8, 'left', '700'); text(timeStr, ax + aw - U * 9, ay + U * 11, U * 3.2, 'right');
      if (o.info) { battery(ax + aw - U * 12, ay + U * 17, U * 2.4); text('1080p', ax + U * 9.5, ay + U * 17, U * 2.6); text(o.date || '', ax + U * 9, ay + ah - U * 10, U * 3, 'left'); text('▶ SP', ax + aw - U * 9, ay + ah - U * 10, U * 3, 'right'); }
    } else {
      text(o.txt || 'CAM 01', ax + U * 9, ay + U * 10, U * 3.4, 'left', '700');
      const now = live ? tFmt(tParse(o.time) + t) : (o.time || '00:00:00'); text(`${o.date || ''}  ${now}`, ax + aw - U * 9, ay + U * 10, U * 3, 'right');
      if (blink) { g.fillStyle = '#ff2a2a'; g.beginPath(); g.arc(ax + U * 10, ay + ah - U * 10, U * 1.2, 0, Math.PI * 2); g.fill(); }
      text('REC', ax + U * 12.5, ay + ah - U * 10, U * 2.8, 'left', '700');
    }
  } else if (k === 'vhs') {
    const big = U * 5;
    text(`${o.txt || 'PLAY'} ▶`, ax + U * 8, ay + U * 10, big, 'left', '800'); text('SP', ax + aw - U * 8, ay + U * 10, big * 0.8, 'right', '800');
    if (o.info) { text(timeStr.replace(/^00:/, 'AM '), ax + U * 8, ay + ah - U * 15, big * 0.75, 'left', '800'); text(o.date || '', ax + U * 8, ay + ah - U * 9, big * 0.75, 'left', '800'); }
  } else if (k === 'phone') {
    g.shadowColor = 'transparent';
    const topH = U * 11, botH = U * 30;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(ax, ay, aw, topH); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(ax, ay + ah - botH, aw, botH);
    // 위: 번개, 녹화 시간, 점 세 개
    g.fillStyle = col; g.beginPath(); const bx = ax + U * 7, by = ay + topH / 2; g.moveTo(bx + U * 0.6, by - U * 2.2); g.lineTo(bx - U * 1.2, by + U * 0.3); g.lineTo(bx, by + U * 0.3); g.lineTo(bx - U * 0.6, by + U * 2.2); g.lineTo(bx + U * 1.2, by - U * 0.3); g.lineTo(bx, by - U * 0.3); g.closePath(); g.fill();
    const tw = U * 17, th = U * 5.4, tx = ax + aw / 2 - tw / 2, ty = by - th / 2;
    g.fillStyle = blink ? '#ff3b30' : 'rgba(255,59,48,.75)'; g.beginPath(); g.roundRect(tx, ty, tw, th, th / 2); g.fill();
    text(live ? tFmt(tParse(o.time) + t) : (o.time || '00:00:00'), ax + aw / 2, by + U * 0.1, U * 3, 'center', '600', '#ffffff');
    g.fillStyle = col; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(ax + aw - U * 9 + i * U * 2.4, by, U * 0.7, 0, Math.PI * 2); g.fill(); }
    // 아래: 확대 단추, 모드 글자, 녹화 단추
    const zy = ay + ah - botH + U * 5.5;
    [['.5', -1], ['1×', 0], ['2', 1]].forEach(([l, i]) => { const zx = ax + aw / 2 + i * U * 8; g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.arc(zx, zy, U * 3, 0, Math.PI * 2); g.fill(); text(l, zx, zy, U * 2.3, 'center', '700', i === 0 ? '#ffcc33' : '#ffffff'); });
    const my = zy + U * 7.5, modes = ['타임랩스', '슬로모', '비디오', '사진', '인물'];
    modes.forEach((m, i) => text(m, ax + aw / 2 + (i - 2) * U * 14, my, U * 2.7, 'center', i === 2 ? '700' : '500', i === 2 ? '#ffcc33' : 'rgba(255,255,255,.85)'));
    const ry = ay + ah - U * 9, rr = U * 6;
    g.lineWidth = U * 0.9; g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(ax + aw / 2, ry, rr, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff3b30'; g.beginPath(); g.roundRect(ax + aw / 2 - rr * 0.42, ry - rr * 0.42, rr * 0.84, rr * 0.84, rr * 0.18); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.roundRect(ax + U * 8, ry - U * 4, U * 8, U * 8, U * 1.5); g.fill(); g.strokeStyle = '#ffffff'; g.lineWidth = U * 0.4; g.stroke();
    g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.arc(ax + aw - U * 12, ry, U * 4.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = U * 0.45; g.beginPath(); g.arc(ax + aw - U * 12, ry, U * 2, Math.PI * 0.15, Math.PI * 1.15); g.stroke(); g.beginPath(); g.arc(ax + aw - U * 12, ry, U * 2, Math.PI * 1.15, Math.PI * 2.15); g.stroke();
  } else if (k === 'film') {
    g.shadowColor = 'transparent'; const sH = U * 10;
    g.fillStyle = '#111111'; g.fillRect(ax, ay, aw, sH); g.fillRect(ax, ay + ah - sH, aw, sH);
    const hw = U * 3.4, hh = U * 4.6, gap = U * 6.8;
    g.fillStyle = 'rgba(235,230,215,.92)';
    for (let x = ax + gap / 2; x < ax + aw; x += gap) for (const y of [ay + sH / 2, ay + ah - sH / 2]) { g.beginPath(); g.roundRect(x - hw / 2, y - hh / 2, hw, hh, U * 0.8); g.fill(); }
    text(o.txt || '24', ax + U * 4, ay + sH * 0.18 + U, U * 2, 'left', '700', '#ff9a2e'); text('KODAK-STYLE 400', ax + aw - U * 4, ay + ah - sH * 0.18 - U, U * 2, 'right', '700', '#ff9a2e');
  } else if (k === 'instant') {
    g.shadowColor = 'transparent'; const s = U * 5, b = U * 22;
    g.fillStyle = o.lbColor && o.lbColor !== '#000000' ? o.lbColor : '#fbfaf6'; g.beginPath(); g.rect(ax, ay, aw, ah); g.rect(ax + s, ay + s, aw - s * 2, ah - s - b); g.fill('evenodd');
    g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = U * 0.3; g.strokeRect(ax + s, ay + s, aw - s * 2, ah - s - b);
    if (o.txt) { g.font = `${U * 5}px ${fontCss(doc.defaults.text.font)}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#333333'; g.fillText(o.txt, ax + aw / 2, ay + ah - b / 2); }
  }
  g.restore();
}
function drawTmplEl(ctx, el) { ctx.save(); if ((el.op ?? 100) < 100) ctx.globalAlpha *= el.op / 100; ctx.translate(-el.w / 2, -el.h / 2); tmplDraw(ctx, el, el.w, el.h, null); ctx.restore(); }
function e2AddTmpl(kind) {
  const p = page(), el = { id: uid(), type: 'tmpl', x: 0, y: 0, w: p.w, h: p.h, rot: 0, pass: true, ...TMPL_DEF(kind) };
  p.els.push(el); sel = [el.id]; if (mode) setMode(null); commit(); renderProps(); requestRender();
  toast(`'${TMPL_KINDS.find(x => x[0] === kind)[1]}'를 넣었어요. 오른쪽에서 글자·색·레터박스를 바꿔요`, 3800);
}
function tmplProps(el) {
  const k = el.kind;
  return `<div class="sec"><h3>카메라 템플릿</h3>
    ${row('모양', `<select data-k="kind">${TMPL_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`)}
    ${k !== 'letterbox' && k !== 'film' ? row('글자색', color('color')) : ''}
    ${['rec', 'cctv', 'vhs', 'film', 'instant'].includes(k) ? row(k === 'instant' ? '아래 글' : k === 'film' ? '번호' : '이름', `<input type="text" data-k="txt" spellcheck="false">`) : ''}
    ${['vf', 'rec', 'cctv', 'vhs', 'phone'].includes(k) ? row('시간', `<input type="text" data-k="time" spellcheck="false" placeholder="00:12:34">`) : ''}
    ${['rec', 'cctv', 'vhs'].includes(k) ? row('날짜', `<input type="text" data-k="date" spellcheck="false">`) : ''}
    ${k === 'vf' ? `<div class="btnrow">${check('grid', '3분할 격자')}${check('info', '촬영 정보 글자')}</div>` : ['rec', 'vhs'].includes(k) ? `<div class="btnrow">${check('info', '아래쪽 정보 글자')}</div>` : ''}
    ${row('레터박스', `<select data-k="lb">${LB_RATIOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`)}
    ${row(k === 'instant' ? '테두리색' : '막대 색', color('lbColor'))}
    ${row('불투명도', range('op', 5, 100, 1))}
    <p class="muted small">템플릿은 화면을 눌러도 안 골라져요. 왼쪽 '레이어' 칸에서 골라요. 움짤에서는 '효과'에 같은 템플릿이 있고, 녹화 점이 깜빡이고 시간이 흘러가요.</p></div>
    ${geomSec(el)}${commonSec()}`;
}

/* ---- 도형 ---- */
const SHAPE_KINDS = [['rect', '사각형'], ['round', '둥근 사각형'], ['ellipse', '원'], ['tri', '삼각형'], ['star', '별'], ['heart', '하트'], ['burst', '터짐'], ['line', '선'], ['arrow', '화살표']];
let shpDef = { kind: 'rect', fillOn: true, fill: '#ffffff', stroke: '#111111', sw: 6, radius: 24, pts: 5, inner: 45, gradOn: false, fill2: '#ff7aa8', gradDir: 'v', op: 100 };
try { const s = JSON.parse(localStorage.getItem('potatoShape') || 'null'); if (s) Object.assign(shpDef, s); } catch (e) { }
const shpSave = () => { try { localStorage.setItem('potatoShape', JSON.stringify(shpDef)); } catch (e) { } };
const isLineK = k => k === 'line' || k === 'arrow';
function shapePath(g, el) {
  const w = el.w, h = el.h, k = el.kind; g.beginPath();
  if (k === 'rect') g.rect(-w / 2, -h / 2, w, h);
  else if (k === 'round') g.roundRect(-w / 2, -h / 2, w, h, Math.min(el.radius ?? 24, w / 2, h / 2));
  else if (k === 'ellipse') g.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (k === 'tri') { g.moveTo(0, -h / 2); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2, h / 2); g.closePath(); }
  else if (k === 'star' || k === 'burst') {
    const n = k === 'burst' ? 14 : clamp(el.pts | 0 || 5, 3, 24), inr = k === 'burst' ? 0.62 : clamp((el.inner ?? 45) / 100, 0.1, 0.95);
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? (k === 'burst' ? inr * (0.85 + 0.3 * ((i * 7) % 5) / 5) : inr) : 1; g.lineTo(Math.cos(a) * w / 2 * rr, Math.sin(a) * h / 2 * rr); }
    g.closePath();
  } else if (k === 'heart') {
    g.moveTo(0, h * 0.5); g.bezierCurveTo(-w * 0.62, h * 0.05, -w * 0.5, -h * 0.55, 0, -h * 0.22); g.bezierCurveTo(w * 0.5, -h * 0.55, w * 0.62, h * 0.05, 0, h * 0.5); g.closePath();
  } else if (isLineK(k)) { const ah = k === 'arrow' ? Math.max((el.sw || 4) * 3, 14) : 0; g.moveTo(-w / 2, 0); g.lineTo(w / 2 - ah * 0.7, 0); }
}
function drawShapeEl(ctx, el) {
  const g = ctx; g.save(); if ((el.op ?? 100) < 100) g.globalAlpha *= el.op / 100;
  g.lineJoin = 'round'; g.lineCap = 'round';
  shapePath(g, el);
  if (!isLineK(el.kind) && el.fillOn !== false) {
    if (el.gradOn) {
      const w = el.w, h = el.h, d = el.gradDir || 'v';
      const gr = d === 'r' ? g.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2) : g.createLinearGradient(d === 'h' ? -w / 2 : d === 'd' ? -w / 2 : 0, d === 'v' ? -h / 2 : d === 'd' ? -h / 2 : 0, d === 'h' ? w / 2 : d === 'd' ? w / 2 : 0, d === 'v' ? h / 2 : d === 'd' ? h / 2 : 0);
      gr.addColorStop(0, rgba(el.fill || '#ffffff', (el.fillA ?? 100) / 100)); gr.addColorStop(1, rgba(el.fill2 || '#000000', (el.fill2A ?? 100) / 100)); g.fillStyle = gr;
    } else g.fillStyle = el.fill || '#fff';
    g.fill();
  }
  if ((el.sw || 0) > 0) { g.lineWidth = el.sw; g.strokeStyle = el.stroke || '#000'; g.stroke(); }
  if (el.kind === 'arrow') { const ah = Math.max((el.sw || 4) * 3, 14); g.beginPath(); g.moveTo(el.w / 2, 0); g.lineTo(el.w / 2 - ah, -ah * 0.6); g.lineTo(el.w / 2 - ah, ah * 0.6); g.closePath(); g.fillStyle = el.stroke || '#000'; g.fill(); }
  g.restore();
}
let shpSt = null;
function shpModebar() {
  const D = shpDef, ln = isLineK(D.kind);
  return `<b>도형</b>
    <div class="seg">${SHAPE_KINDS.map(([v, l]) => `<button class="btn sm ${D.kind === v ? 'on' : ''}" data-mb="sh-${v}">${l}</button>`).join('')}</div>
    ${ln ? '' : `<label class="chk"><input type="checkbox" id="mbShFillOn" ${D.fillOn ? 'checked' : ''}> 채우기</label><input type="color" id="mbShFill" value="${D.fill}" title="채울 색">`}
    <label>선 <input type="color" id="mbShStroke" value="${D.stroke}"></label><label>굵기 <input type="range" id="mbShSw" min="0" max="60" step="0.5" value="${D.sw}"></label>
    <span class="mtxt">끌어서 그려요. Shift = ${ln ? '45도씩' : '정사각형·정원'}</span>
    <button class="btn sm primary" data-mb="done">다 그렸어요</button>`;
}
function shpModebarAct(a) { if (a.startsWith('sh-')) { shpDef.kind = a.slice(3); shpSave(); renderModebar(); return true; } return false; }
function shpDown(p, e) { shpSt = { a: p, b: p, shift: e.shiftKey }; drag = { mode: 'shape' }; scroller.setPointerCapture(e.pointerId); requestRender(); }
function shpMove(p, e) { if (!shpSt) return; let b = p; const a = shpSt.a;
  if (e.shiftKey) { if (isLineK(shpDef.kind)) { const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(p.x - a.x, p.y - a.y); b = { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L }; } else { const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y)); b = { x: a.x + Math.sign(p.x - a.x || 1) * s, y: a.y + Math.sign(p.y - a.y || 1) * s }; } }
  shpSt.b = b; requestRender(); }
function shpBox(a, b) {
  const D = shpDef;
  if (isLineK(D.kind)) { const L = Math.hypot(b.x - a.x, b.y - a.y), h = Math.max(D.sw * 4, 24); return { x: (a.x + b.x) / 2 - L / 2, y: (a.y + b.y) / 2 - h / 2, w: Math.max(4, L), h, rot: Math.atan2(b.y - a.y, b.x - a.x) / DEG }; }
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), rot: 0 };
}
function shpUp() {
  drag = null; if (!shpSt) return; const { a, b } = shpSt; shpSt = null;
  let bx = shpBox(a, b);
  if ((isLineK(shpDef.kind) ? bx.w : Math.min(bx.w, bx.h)) * zoom < 6) { const s = Math.min(page().w, page().h) * 0.25; bx = isLineK(shpDef.kind) ? { x: a.x - s / 2, y: a.y - 12, w: s, h: 24, rot: 0 } : { x: a.x - s / 2, y: a.y - s / 2, w: s, h: s, rot: 0 }; }
  const D = shpDef, el = { id: uid(), type: 'shape', ...bx, kind: D.kind, fillOn: !isLineK(D.kind) && D.fillOn, fill: D.fill, stroke: D.stroke, sw: D.sw, radius: D.radius, pts: D.pts, inner: D.inner, gradOn: false, fill2: D.fill2, gradDir: D.gradDir, op: 100 };
  page().els.push(el); sel = [el.id]; e2SetHint('도형 그리기'); commit(); renderProps(); requestRender();
}
function shpOverlay() {
  if (!shpSt) return; const bx = shpBox(shpSt.a, shpSt.b), D = shpDef, o = S({ x: 0, y: 0 });
  const el = { ...bx, kind: D.kind, fillOn: D.fillOn, fill: D.fill, stroke: D.stroke, sw: D.sw, radius: D.radius, pts: D.pts, inner: D.inner, op: 70 };
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(zoom, zoom); ctx.translate(bx.x + bx.w / 2, bx.y + bx.h / 2); if (bx.rot) ctx.rotate(bx.rot * DEG); drawShapeEl(ctx, el); ctx.restore();
}
function shapeProps(el) {
  const ln = isLineK(el.kind);
  return `<div class="sec"><h3>도형</h3>
    ${row('모양', `<select data-k="kind">${SHAPE_KINDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`)}
    ${ln ? '' : row('채우기', `${check('fillOn', '칠하기')} ${color('fill')}`)}
    ${ln || el.fillOn === false ? '' : `<div class="btnrow">${check('gradOn', '그라데이션')}</div>${el.gradOn ? row('시작 투명도', range('fillA', 0, 100, 1)) + row('끝 색', color('fill2')) + row('끝 투명도', range('fill2A', 0, 100, 1)) + row('방향', pick('gradDir', [['v', '위 → 아래'], ['h', '왼쪽 → 오른쪽'], ['d', '대각선'], ['r', '가운데부터']])) : ''}`}
    ${row('선', color('stroke'))}${row('선 굵기', range('sw', 0, 80, 0.5))}
    ${el.kind === 'round' ? row('모서리', range('radius', 0, 400, 1)) : ''}
    ${el.kind === 'star' ? row('꼭짓점', range('pts', 3, 24, 1)) + row('안쪽', range('inner', 10, 95, 1)) : ''}
    ${row('불투명도', range('op', 5, 100, 1))}
    <div class="btnrow"><button class="btn sm" data-act="e2-sh-def" title="다음에 그릴 도형도 이 모양으로">이 모양을 기본으로</button></div></div>
    ${geomSec(el)}${commonSec()}`;
}

/* ---- 글자를 한 글자씩 따로 ---- */
function e2SplitText(el) {
  const L = textLayout(el), c = center(el), out = [], glyphs = L.glyphs.filter(g => g.ch.trim());
  if (glyphs.length < 2) { toast('나눌 글자가 두 개 이상이어야 해요'); return; }
  for (const g of glyphs) {
    const lx = L.ox + g.x - L.tk * g.y, ly = L.oy + g.y, r = rot(lx, ly, (el.rot || 0) * DEG);
    const n = { ...clone(el), id: uid(), text: g.ch, fs: el.fs * g.sc, jit: 0, grow: 0, arc: 0, vert: false, boxOn: false, rot: Math.round(((el.rot || 0) + g.rot / DEG) * 10) / 10, seed: 1 };
    for (const k of ['sw', 'sw2']) if (typeof n[k] === 'number') n[k] = el[k];
    fitText(n); n.x = c.x + r.x - n.w / 2; n.y = c.y + r.y - n.h / 2; out.push(n);
  }
  const els = page().els, i = els.indexOf(el); els.splice(i, 1, ...out); sel = out.map(o => o.id); e2SetHint('글자 나누기'); commit(); renderProps(); requestRender();
  toast(`${out.length}글자로 나눴어요. 하나씩 끌어서 옮기거나 돌릴 수 있어요`, 3600);
}

/* ---- AI로 인물·배경 고르기 (배경 지우기 팩) ---- */
async function selAI(which, op) {
  if (!selSt) return; if (!(await aiReady('bg'))) return;
  const pg = page(), c = selSt.mask, W = c.width, H = c.height, s = selSt.s;
  const r = newCanvas(W, H), g = r.getContext('2d'); g.setTransform(s, 0, 0, s, 0, 0);
  drawPage(g, pg, { screen: false, rs: s, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } });
  const busy = toast('AI가 인물을 찾는 중…', 60000);
  let A; try { A = await aiMask(r, W, H); } catch (e) { toast('인물을 찾지 못했어요'); return; }
  const gm = c.getContext('2d', { willReadFrequently: true }), id = gm.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < A.length; i++) {
    const v = which === 'bg' ? 255 - A[i] : A[i], cur = d[i * 4 + 3];
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = op === 'add' ? Math.max(cur, v) : op === 'sub' ? Math.min(cur, 255 - v) : v;
  }
  let n = 0; for (let i = 0; i < A.length; i++) if (A[i] > 128) n++;
  if (n < A.length * 0.002) { toast('그림에서 인물을 찾지 못했어요. 애니·일러스트 인물에 잘 맞아요', 3600); return; }
  selPush(); gm.putImageData(id, 0, 0); selOutline(); toast(which === 'bg' ? '배경을 골랐어요' : '인물을 골랐어요', 2000);
}

/* ---- 스포이트: 색 칸 옆에 작은 단추 (화면 어디서든 색을 찍어요) ---- */
const EYE_SVG = '<svg width="13" height="13" viewBox="0 0 16 16"><path d="M11.3 1.6a2 2 0 012.9 2.9l-1.7 1.7.8.8-1.4 1.4-.8-.8-5.9 5.9H2.6v-2.6l5.9-5.9-.8-.8 1.4-1.4.8.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
function eyeAugment(root) {
  if (typeof EyeDropper === 'undefined') return;
  for (const inp of root.querySelectorAll('input[type=color]:not([data-eye])')) {
    inp.dataset.eye = '1'; const b = document.createElement('button'); b.type = 'button'; b.className = 'eyedrop'; b.title = '스포이트: 화면에서 색 찍기'; b.innerHTML = EYE_SVG;
    b.addEventListener('click', async ev => {
      ev.preventDefault(); ev.stopPropagation();
      try { const r = await new EyeDropper().open(); inp.value = r.sRGBHex; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { }
    });
    inp.after(b);
  }
}
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches && n.matches('input[type=color]')) eyeAugment(n.parentNode || document); else if (n.querySelector && n.querySelector('input[type=color]')) eyeAugment(n); } }).observe(document.body, { childList: true, subtree: true });
eyeAugment(document);

/* ---- 단추 ---- */
function e2Act(act, v) {
  const el = selEls()[0];
  if (act.startsWith('e2-xf')) { e2XfAct(act); return; }
  if (act === 'e2-flatten') { lyFlatten(); return; }
  if (act === 'e2-merge') { lyMergeSel(); return; }
  if (act === 'e2-group') { lyGroup(); return; }
  if (act === 'e2-ungroup') { lyUngroup(); return; }
  switch (act) {
    case 'e2-tsplit': if (el && el.type === 'text') e2SplitText(el); return;
    case 'e2-fillc': if (el) { el.fill = v; commit(); renderProps(); requestRender(); } return;
    case 'e2-sh-def': if (el && el.type === 'shape') { for (const k of ['kind', 'fillOn', 'fill', 'stroke', 'sw', 'radius', 'pts', 'inner', 'fill2', 'gradDir']) if (el[k] !== undefined) shpDef[k] = el[k]; shpSave(); toast('다음에 그릴 도형도 이 모양이에요'); } return;
    case 'e2-mk-paint': if (el) setMode('mask', el.id); return;
    case 'e2-level': setMode('level'); return;
    case 'e2-level0': e2Straighten(page(), 0); e2SetHint('수평 되돌리기'); commit(); renderProps(); requestRender(); return;
    case 'e2-mk-sel': if (el && selLast) { lmSet(el, lmFromPageMask(el, selLast.c, selLast.s, selLast.feather)); commit(); renderProps(); requestRender(); toast('선택한 곳만 보이게 했어요'); } return;
    case 'e2-mk-inv': if (el && el.lmask) { const c = lmEdit(el), g = c.getContext('2d'); g.globalCompositeOperation = 'xor'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); lmSet(el, c); commit(); requestRender(); } return;
    case 'e2-mk-del': if (el) { delete el.lmask; lmLive.delete(el.id); commit(); renderProps(); requestRender(); } return;
  }
}
// 레이어 추가 메뉴
function e2Layer(a) {
  if (page().ph) { toast('먼저 그림을 불러와 주세요'); return; }
  if (a === 'black') e2AddFill('#000000', '검은 화면');
  else if (a === 'white') e2AddFill('#ffffff', '흰 화면');
  else if (a === 'color') e2AddFill('#ff6fa0', '색 화면');
  else if (a === 'adj') e2AddAdj(null);
  else if (a === 'grad') e2AddGrad();
  else if (a.startsWith('t-')) e2AddTmpl(a.slice(2));
  else if (a === 'img') e2PickImgLayer();
}
// 모드 막대 입력 (도형·마스크)
$('#modebar').addEventListener('input', e => {
  const t = e.target, id = t.id;
  if (id === 'mbShFillOn') shpDef.fillOn = t.checked; else if (id === 'mbShFill') shpDef.fill = t.value; else if (id === 'mbShStroke') shpDef.stroke = t.value; else if (id === 'mbShSw') shpDef.sw = +t.value;
  else if (id === 'mbMkSize') mkOpt.size = +t.value; else if (id === 'mbMkSoft') mkOpt.soft = +t.value; else return;
  if (id.startsWith('mbSh')) shpSave(); requestRender();
});
function mkModebarAct(a) {
  if (a === 'mk-hide' || a === 'mk-show') { mkOpt.hide = a === 'mk-hide'; renderModebar(); requestRender(); return true; }
  if (a === 'mk-all') { mkFill('all'); return true; } if (a === 'mk-none') { mkFill('none'); return true; } if (a === 'mk-inv') { mkFill('inv'); return true; }
  return false;
}

/* ---- 되돌리기 기록 목록 ('기록' 탭) ---- */
let e2Hint = '', e2HintT = 0, e2UI = '', e2UIT = 0;
function e2SetHint(s) { e2Hint = s || ''; e2HintT = performance.now(); }
document.addEventListener('pointerdown', e => { // 마지막으로 누른 단추·칸 이름을 기록 이름으로
  const t = e.target; if (!t.closest || t.closest('#scroller') || t.closest('#histList')) return;
  const b = t.closest('button, summary, .lyr, .menu button'), r = t.closest('.row');
  let s = '';
  if (r && (!b || !r.contains(b) || b.classList.contains('eyedrop'))) s = (r.querySelector('.l') || {}).textContent || '';
  else if (b) s = b.dataset.histName || (b.getAttribute('title') || '').split(/[(:.]/)[0] || b.textContent;
  s = String(s).replace(/\s+/g, ' ').trim().slice(0, 26); if (s) { e2UI = s; e2UIT = performance.now(); }
}, true);
function e2HistLabel() {
  const now = performance.now();
  if (e2Hint && now - e2HintT < 4000) { const h = e2Hint; e2Hint = ''; return h; }
  if (e2UI && now - e2UIT < 8000) return e2UI;
  return '편집';
}
let histQ = false;
function renderHistSoon() { if (histQ) return; histQ = true; requestAnimationFrame(() => { histQ = false; renderHist(); }); }
function renderHist() {
  const box = $('#histList'); if (!box || $('#tab-hist').hidden) return;
  const tm = t => t ? new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  box.innerHTML = hist.map((h, i) => `<div class="hist ${i === hi ? 'on' : ''} ${i > hi ? 'fut' : ''}" data-hi="${i}"><span>${esc(h.l || (i ? '편집' : '처음 상태'))}</span><i>${tm(h.t)}</i></div>`).reverse().join('');
}
$('#histList').addEventListener('click', e => { const r = e.target.closest('[data-hi]'); if (!r) return; const i = +r.dataset.hi; if (i === hi || !hist[i]) return; hi = i; imgRedo = []; restoreHist(hist[i]); renderHist(); });

/* ---- 수평 맞추기 (바탕 그림을 조금 돌리고, 빈 곳이 안 생기게 키워요) ---- */
let lvSt = null;
function e2BakeStraight(p) { const B = p && baseEl(p); if (B) { delete B.st0; delete B.straight; } }
function e2Straighten(p, deg) {
  const B = baseEl(p); if (!B) return;
  deg = clamp(Math.round((+deg || 0) * 10) / 10, -45, 45);
  if (!B.st0) B.st0 = { x: B.x, y: B.y, w: B.w, h: B.h, rot: B.rot || 0 };
  const o = B.st0, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  if (!deg) { Object.assign(B, { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot }); delete B.st0; delete B.straight; return; }
  const th = (o.rot + deg) * DEG, c = Math.cos(th), s = Math.sin(th); let k = 1;
  for (const [x, y] of [[0, 0], [p.w, 0], [0, p.h], [p.w, p.h]]) { const dx = x - cx, dy = y - cy, lx = dx * c + dy * s, ly = -dx * s + dy * c; k = Math.max(k, 2 * Math.abs(lx) / o.w, 2 * Math.abs(ly) / o.h); }
  B.w = o.w * k; B.h = o.h * k; B.x = cx - B.w / 2; B.y = cy - B.h / 2; B.rot = o.rot + deg; B.straight = deg;
}
function lvUp() {
  const st = lvSt; lvSt = null; if (!st) { requestRender(); return; }
  const dx = st.b.x - st.a.x, dy = st.b.y - st.a.y; if (Math.hypot(dx, dy) * zoom < 12) { requestRender(); return; }
  let a = Math.atan2(dy, dx) / DEG; // 선의 기울기
  const near = [0, 90, -90, 180, -180].reduce((b, v) => Math.abs(a - v) < Math.abs(a - b) ? v : b, 0), fix = near - a;
  const B = baseEl(page()), cur = B ? (B.straight || 0) : 0;
  e2Straighten(page(), cur + fix); setMode(null); e2SetHint('수평 맞추기'); commit(); renderProps(); requestRender();
  toast(`${Math.abs(fix).toFixed(1)}° ${fix > 0 ? '오른쪽' : '왼쪽'}으로 돌려 맞췄어요. 오른쪽 '수평' 값으로 더 다듬어요`, 3600);
}
propsEl.addEventListener('input', e => {
  const t = e.target; if (!t.dataset || !t.dataset.e2s) return;
  e2Straighten(page(), +t.value); for (const x of $$('[data-e2s]', propsEl)) if (x !== t) x.value = t.value; requestRender();
});
propsEl.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.e2s) { e2SetHint('수평 맞추기'); commit(); renderProps(); } });

/* ---- 그라디언트 화면 ---- */
function e2AddGrad() {
  const p = page(), el = { id: uid(), type: 'shape', kind: 'rect', x: 0, y: 0, w: p.w, h: p.h, rot: 0, pass: true, name: '그라디언트 화면', fillOn: true, fill: '#000000', fillA: 0, fill2: '#000000', fill2A: 85, gradOn: true, gradDir: 'v', stroke: '#000000', sw: 0, op: 100 };
  p.els.push(el); sel = [el.id]; if (mode) setMode(null); e2SetHint('그라디언트 화면'); commit(); renderProps(); requestRender();
  toast('아래로 갈수록 어두워지는 그라디언트를 깔았어요. 오른쪽에서 색·방향·불투명도를 바꿔요', 4000);
}

/* ---- 그림 자유 변형 (이미지 편집): 바탕 그림·그림 레이어 옮기기·크기·회전 ---- */
let xfBase = null; // 자유 변형 중인 바탕 그림 id (Ctrl+T, Enter·Esc로 끝)
function xfScaleInner(el, o, f) { // 틀이 f배가 될 때 안의 그림도 같이 (위치값도 f배)
  el.ox = (o.ox || 0) * f; el.oy = (o.oy || 0) * f;
  (el.layers || []).forEach((L, i) => { const Lo = (o.layers || [])[i] || L; L.ox = (Lo.ox || 0) * f; L.oy = (Lo.oy || 0) * f; });
}
function xfSetSize(el, w) { // 가운데 그대로 폭 w로 (비율 그대로)
  const o = clone(el), f = Math.max(4, w) / el.w, cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  el.w *= f; el.h *= f; el.x = cx - el.w / 2; el.y = cy - el.h / 2; xfScaleInner(el, o, f);
}
const xfNat = el => { const r = el.img && images.get(el.img); return r ? r.w : el.w; }; // 그림 원래 폭 (100%)
function xfSec(el) {
  const on = el.lock ? xfBase === el.id : true, pct = Math.round(el.w / xfNat(el) * 1000) / 10;
  return `<div class="sec"><h3>위치·크기·회전</h3>
    ${el.lock ? `<div class="btnrow"><button class="btn sm ${on ? 'on' : ''}" data-act="e2-xf" title="Ctrl+T · 끝내려면 Enter">${on ? '변형 끝내기 (Enter)' : '자유 변형 (Ctrl+T)'}</button></div>` : ''}
    ${on ? `<div class="grid2"><span>크기</span><span><input type="number" data-e2x="sc" min="1" max="2000" step="1" value="${pct}"> %</span><span>회전</span><span><input type="number" data-e2x="rot" min="-180" max="180" step="1" value="${Math.round((el.rot || 0) * 10) / 10}"> °</span></div>
    <div class="btnrow"><button class="btn sm" data-act="e2-xf-center">가운데로</button><button class="btn sm" data-act="e2-xf-fit" title="캔버스 안에 다 보이게">캔버스에 맞추기</button><button class="btn sm" data-act="e2-xf-fill" title="빈 곳 없이 꽉 채우기">꽉 채우기</button><button class="btn sm" data-act="e2-xf-reset" title="원래 크기, 각도 0, 가운데">원래대로</button></div>
    <p class="muted small">그림을 끌면 옮겨지고, 모서리를 끌면 비율 그대로 크기, 위쪽 동그라미로 돌려요(<kbd>Shift</kbd> = 15°씩). 방향키로 조금씩 옮겨요.</p>` : ''}</div>`;
}
function e2XfToggle() { // Ctrl+T: 그림 레이어를 골랐으면 그대로(손잡이 있음), 아니면 바탕 그림
  const ss = selEls(), pg = page(); if (!pg || pg.ph) return;
  if (ss.length === 1 && !ss[0].lock && imgLayerEl(ss[0])) { toast('모서리를 끌어 크기, 위쪽 동그라미로 돌려요', 1800); return; }
  const B = baseEl(pg); if (!B) return;
  if (xfBase === B.id) { xfBase = null; } else { xfBase = B.id; sel = [B.id]; e2BakeStraight(pg); toast('그림을 끌어 옮기고 모서리로 크기, 동그라미로 돌려요. 다 되면 Enter', 2600); }
  renderProps(); requestRender();
}
function e2XfAct(a) {
  const el = selEls()[0], pg = page(); if (!el) return;
  if (a === 'e2-xf') { e2XfToggle(); return; }
  const cx = pg.w / 2, cy = pg.h / 2;
  if (el.lock) e2BakeStraight(pg);
  if (a === 'e2-xf-center') { el.x = cx - el.w / 2; el.y = cy - el.h / 2; }
  else if (a === 'e2-xf-fit' || a === 'e2-xf-fill') {
    const f = (a === 'e2-xf-fit' ? Math.min : Math.max)(pg.w / el.w, pg.h / el.h); xfSetSize(el, el.w * f); el.x = cx - el.w / 2; el.y = cy - el.h / 2;
  } else if (a === 'e2-xf-reset') { el.rot = 0; xfSetSize(el, xfNat(el)); el.x = cx - el.w / 2; el.y = cy - el.h / 2; }
  e2SetHint('그림 변형'); commit(); renderProps(); requestRender();
}
propsEl.addEventListener('change', e => {
  const t = e.target, k = t.dataset && t.dataset.e2x; if (!k) return;
  const el = selEls()[0]; if (!el) return; if (el.lock) e2BakeStraight(page());
  if (k === 'sc') xfSetSize(el, xfNat(el) * clamp(+t.value || 100, 1, 2000) / 100);
  else if (k === 'rot') el.rot = clamp(+t.value || 0, -180, 180);
  e2SetHint('그림 변형'); commit(); renderProps(); requestRender();
});
// 그림을 레이어로 넣기 (이미지 편집): 메뉴 '그림 넣기…', 캔버스에 파일을 끌어 놓을 때 고르기
function e2AddImgLayer(id, at) {
  const r = images.get(id), pg = page(); if (!r || !pg || pg.ph) return null;
  const f = Math.min(1, pg.w * 0.9 / r.w, pg.h * 0.9 / r.h), w = r.w * f, h = r.h * f;
  const c = at || { x: pg.w / 2, y: pg.h / 2 };
  const P = makePanel(c.x, c.y, w, h, id); P.bw = 0; P.radius = 0; P.name = String(r.name || '그림').replace(/\.[^.]+$/, '').slice(0, 30);
  pg.els.push(P); sel = [P.id]; return P;
}
async function e2ImgLayerFiles(files, at) {
  const ids = await importFiles(files); if (!ids.length) return;
  for (const id of ids) e2AddImgLayer(id, at);
  e2SetHint('그림 넣기'); commit(); renderProps(); requestRender(); renderLayersSoon();
  toast(ids.length > 1 ? `그림 ${ids.length}장을 레이어로 넣었어요` : '그림을 레이어로 넣었어요. 모서리를 끌어 크기를 바꿔요', 2600);
}
function e2PickImgLayer() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => { const fs = [...inp.files]; if (fs.length) e2ImgLayerFiles(fs, null); }; inp.click();
}
function e2Choice(x, y, items) { // 작은 고르기 메뉴 → 고른 값 (없으면 null)
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'menu'; m.style.left = Math.min(x, innerWidth - 240) + 'px'; m.style.top = Math.min(y, innerHeight - 40 * items.length - 20) + 'px';
    m.innerHTML = items.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join(''); document.body.appendChild(m);
    const done = v => { m.remove(); removeEventListener('pointerdown', out, true); removeEventListener('keydown', esc, true); res(v); };
    const out = e => { if (!m.contains(e.target)) done(null); }, esc = e => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    m.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) done(b.dataset.v); });
    setTimeout(() => { addEventListener('pointerdown', out, true); addEventListener('keydown', esc, true); }, 0);
  });
}
