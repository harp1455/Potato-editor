/* ================= 뒤틀기 (리퀴파이) ================= */
// 붓으로 그림을 밀고, 부풀리고, 오므리고, 돌려요. 따로 창에서 고친 뒤 새 그림으로 바꿔 넣어요 (Ctrl+Z로 되돌릴 수 있어요).
// 그림을 직접 고치지 않고 '어디서 가져올지' 표(격자)만 바꾸다가, 적용할 때 원래 크기로 한 번 그려요.
const LQ_TOOLS = [['push', '밀기', 'W', '끄는 방향으로 그림을 밀어요'], ['bloat', '부풀리기', 'B', '누르고 있으면 가운데가 커져요'], ['pucker', '오므리기', 'S', '누르고 있으면 가운데로 모여요'], ['twirl', '돌리기', 'C', '누르고 있으면 소용돌이처럼 돌아요'], ['rec', '되돌리기', 'R', '칠한 곳만 원래대로 돌아가요']];
const lqSet = { tool: 'push', size: 90, str: 50, ccw: false };
function lqTarget() {
  const pg = page(); if (!isImg() || !pg || pg.ph) return null;
  const ss = selEls(), s0 = ss.length === 1 ? ss[0] : null;
  const el = s0 && !s0.lock && (s0.type === 'stamp' || (imgLayerEl(s0) && s0.img)) ? s0 : baseEl(pg);
  if (!el) return null;
  const L = el.type === 'panel' ? activeObj(el) : el, o = aiImg(L);
  return o ? { el, L, o } : null;
}
// 격자 하나: 점마다 '어디서 가져올지' 차이(dx, dy, 원본 픽셀 단위)
function lqGrid(W, H) {
  const gs = Math.max(1, Math.max(W, H) / 320), Gw = Math.ceil(W / gs) + 2, Gh = Math.ceil(H / gs) + 2;
  return { gs, Gw, Gh, D: new Float32Array(Gw * Gh * 2), D0: new Float32Array(Gw * Gh * 2) };
}
// 격자 값 사이를 고르게 읽기
function lqSample(G, A, x, y, out) {
  let gx = x / G.gs, gy = y / G.gs;
  gx = gx < 0 ? 0 : gx > G.Gw - 1.001 ? G.Gw - 1.001 : gx; gy = gy < 0 ? 0 : gy > G.Gh - 1.001 ? G.Gh - 1.001 : gy;
  const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, i = (iy * G.Gw + ix) * 2, j = i + G.Gw * 2;
  out[0] = (A[i] * (1 - fx) + A[i + 2] * fx) * (1 - fy) + (A[j] * (1 - fx) + A[j + 2] * fx) * fy;
  out[1] = (A[i + 1] * (1 - fx) + A[i + 3] * fx) * (1 - fy) + (A[j + 1] * (1 - fx) + A[j + 3] * fx) * fy;
}
// 붓 한 번 찍기 (cx, cy, R: 원본 픽셀 단위)
function lqDab(G, tool, cx, cy, R, s, mdx, mdy, ccw) {
  const { gs, Gw, Gh, D, D0 } = G; D0.set(D);
  const gx0 = Math.max(0, Math.floor((cx - R) / gs)), gx1 = Math.min(Gw - 1, Math.ceil((cx + R) / gs)), gy0 = Math.max(0, Math.floor((cy - R) / gs)), gy1 = Math.min(Gh - 1, Math.ceil((cy + R) / gs));
  const t = [0, 0], f = s * 0.07, push = 0.25 + 0.75 * s, ang = s * 0.07 * (ccw ? -1 : 1);
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    const px = gx * gs, py = gy * gs, ex = px - cx, ey = py - cy, r2 = (ex * ex + ey * ey) / (R * R);
    if (r2 >= 1) continue;
    const w = (1 - r2) * (1 - r2), i = (gy * Gw + gx) * 2;
    if (tool === 'rec') { const k = 1 - w * (0.04 + 0.16 * s); D[i] = D0[i] * k; D[i + 1] = D0[i + 1] * k; continue; }
    let qx, qy;
    if (tool === 'push') { qx = px - w * push * mdx; qy = py - w * push * mdy; }
    else if (tool === 'bloat') { qx = cx + ex * (1 - w * f); qy = cy + ey * (1 - w * f); }
    else if (tool === 'pucker') { qx = cx + ex * (1 + w * f); qy = cy + ey * (1 + w * f); }
    else { const a = -w * ang, c = Math.cos(a), sn = Math.sin(a); qx = cx + ex * c - ey * sn; qy = cy + ex * sn + ey * c; }
    lqSample(G, D0, qx, qy, t);
    D[i] = qx + t[0] - px; D[i + 1] = qy + t[1] - py;
  }
}
// 격자대로 그림 그리기: src(원본 sw×sh 픽셀) → dst(크기 = 원본 × k), 사각형 [x0, x1) × [y0, y1)만
function lqRender(G, src, sw, sh, dst, dw, k, x0, y0, x1, y1) {
  const t = [0, 0], A = G.D;
  for (let py = y0; py < y1; py++) {
    const sy = (py + 0.5) / k;
    for (let px = x0; px < x1; px++) {
      const sx = (px + 0.5) / k; lqSample(G, A, sx, sy, t);
      let u = (sx + t[0]) * k - 0.5, v = (sy + t[1]) * k - 0.5;
      u = u < 0 ? 0 : u > sw - 1 ? sw - 1 : u; v = v < 0 ? 0 : v > sh - 1 ? sh - 1 : v;
      const ux = u | 0, vy = v | 0, fx = u - ux, fy = v - vy, ux1 = ux + 1 < sw ? ux + 1 : ux, vy1 = vy + 1 < sh ? vy + 1 : vy;
      const a = (vy * sw + ux) * 4, b = (vy * sw + ux1) * 4, c = (vy1 * sw + ux) * 4, d = (vy1 * sw + ux1) * 4;
      const wa = (1 - fx) * (1 - fy) * src[a + 3], wb = fx * (1 - fy) * src[b + 3], wc = (1 - fx) * fy * src[c + 3], wd = fx * fy * src[d + 3], ws = wa + wb + wc + wd, o = (py * dw + px) * 4;
      if (ws <= 0) { dst[o + 3] = 0; continue; }
      dst[o] = (src[a] * wa + src[b] * wb + src[c] * wc + src[d] * wd) / ws;
      dst[o + 1] = (src[a + 1] * wa + src[b + 1] * wb + src[c + 1] * wc + src[d + 1] * wd) / ws;
      dst[o + 2] = (src[a + 2] * wa + src[b + 2] * wb + src[c + 2] * wc + src[d + 2] * wd) / ws;
      dst[o + 3] = ws;
    }
  }
}
function lqOpen() {
  const T = lqTarget();
  if (!T) { toast('이미지 편집에서 그림을 연 뒤 써 주세요. 그림 레이어를 고르면 그 레이어를 고쳐요'); return; }
  const { o } = T, W = o.W, H = o.H, k = Math.min(1, 1000 / Math.max(W, H)), pw = Math.max(1, Math.round(W * k)), ph = Math.max(1, Math.round(H * k));
  const sc = newCanvas(pw, ph), sg = sc.getContext('2d', { willReadFrequently: true }); sg.imageSmoothingQuality = 'high'; sg.drawImage(o.im, 0, 0, pw, ph);
  const S = sg.getImageData(0, 0, pw, ph).data, G = lqGrid(W, H), undo = [];
  const m = modal(`<h2>뒤틀기</h2><p class="sub">붓으로 그림을 끌어 모양을 고쳐요. 얼굴 갸름하게, 머리카락 흐름, 옷 주름 같은 걸 다듬을 때 좋아요.</p>
    <div class="seg" id="lqTools" style="margin-bottom:8px">${LQ_TOOLS.map(([v, l, key, tip]) => `<button class="btn sm ${lqSet.tool === v ? 'on' : ''}" data-lq="${v}" title="${tip} (${key})">${l}</button>`).join('')}</div>
    <div style="position:relative;display:flex;justify-content:center;background:var(--side);border-radius:8px;overflow:hidden;touch-action:none"><canvas id="lqCv" style="max-width:100%;max-height:62vh;cursor:none;display:block"></canvas><div id="lqCur" style="position:fixed;pointer-events:none;border:1.5px solid #fff;outline:1px solid rgba(0,0,0,.55);border-radius:50%;display:none;z-index:99"></div></div>
    <div class="grid2" style="margin-top:10px">
      <span>붓 크기</span><span><input type="range" min="10" max="400" step="1" value="${lqSet.size}" data-lqs="size" title="[ ] 키로도 바꿔요"></span>
      <span>세기</span><span><input type="range" min="5" max="100" step="1" value="${lqSet.str}" data-lqs="str"></span>
      <span></span><span><label class="chk"><input type="checkbox" data-lqs="ccw" ${lqSet.ccw ? 'checked' : ''}> 돌리기를 반대 방향으로</label></span>
    </div>
    <div class="btnrow"><button class="btn sm" id="lqUndo" title="Ctrl+Z">한 번 되돌리기</button><button class="btn sm" id="lqReset">모두 되돌리기</button><button class="btn sm" id="lqOrig" title="누르고 있는 동안 원래 그림을 보여 줘요">원래 그림 보기</button></div>
    <p class="muted small">결과는 같은 자리의 그림만 바꿔요. 바꾼 뒤에도 Ctrl+Z로 되돌릴 수 있어요.</p>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="lqGo">적용</button></div>`, { wide: true });
  m.style.width = 'min(1100px, 100%)';
  const cv = $('#lqCv', m), cur = $('#lqCur', m); cv.width = pw; cv.height = ph;
  const g = cv.getContext('2d'), out = g.createImageData(pw, ph);
  out.data.set(S); g.putImageData(out, 0, 0);
  let dirty = null, raf = 0, orig = false;
  const flush = () => {
    raf = 0; if (!dirty || !m.isConnected) return;
    const x0 = clamp(Math.floor(dirty[0]), 0, pw), y0 = clamp(Math.floor(dirty[1]), 0, ph), x1 = clamp(Math.ceil(dirty[2]), 0, pw), y1 = clamp(Math.ceil(dirty[3]), 0, ph); dirty = null;
    if (x1 <= x0 || y1 <= y0) return;
    lqRender(G, S, pw, ph, out.data, pw, k, x0, y0, x1, y1);
    if (!orig) g.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
  };
  const mark = (x0, y0, x1, y1) => { dirty = dirty ? [Math.min(dirty[0], x0), Math.min(dirty[1], y0), Math.max(dirty[2], x1), Math.max(dirty[3], y1)] : [x0, y0, x1, y1]; if (!raf) raf = requestAnimationFrame(flush); };
  const redrawAll = () => mark(0, 0, pw, ph);
  const scale = () => cv.width / cv.getBoundingClientRect().width; // 화면 px → 미리보기 px
  const R = () => lqSet.size / 2 * scale() / k; // 원본 px
  const toSrc = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  const showCur = e => { const d = lqSet.size; cur.style.display = 'block'; cur.style.width = cur.style.height = d + 'px'; cur.style.left = (e.clientX - d / 2) + 'px'; cur.style.top = (e.clientY - d / 2) + 'px'; };
  const dab = (x, y, dx, dy) => {
    const r = R(); lqDab(G, lqSet.tool, x, y, r, lqSet.str / 100, dx, dy, lqSet.ccw);
    const pad = r * 1.1 * k + 2; mark(x * k - pad, y * k - pad, x * k + pad, y * k + pad);
  };
  let drag = null, hold = 0;
  const stopHold = () => { clearInterval(hold); hold = 0; };
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); cv.setPointerCapture(e.pointerId);
    undo.push(G.D.slice()); if (undo.length > 40) undo.shift();
    const [x, y] = toSrc(e); drag = { x, y, lx: x, ly: y };
    if (lqSet.tool !== 'push') { dab(x, y, 0, 0); stopHold(); hold = setInterval(() => { if (drag) dab(drag.x, drag.y, 0, 0); }, 33); }
  });
  cv.addEventListener('pointermove', e => {
    showCur(e); if (!drag) return;
    const [x, y] = toSrc(e); drag.x = x; drag.y = y;
    if (lqSet.tool === 'push') { // 많이 움직이면 잘게 나눠 밀어요
      const dx = x - drag.lx, dy = y - drag.ly, d = Math.hypot(dx, dy), st = Math.max(1, R() / 5), n = Math.ceil(d / st);
      for (let i = 1; i <= n; i++) dab(drag.lx + dx * (i - 1) / n, drag.ly + dy * (i - 1) / n, dx / n, dy / n);
      drag.lx = x; drag.ly = y;
    } else { const d = Math.hypot(x - drag.lx, y - drag.ly); if (d > R() / 4) { dab(x, y, 0, 0); drag.lx = x; drag.ly = y; } }
  });
  const end = () => { drag = null; stopHold(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { cur.style.display = 'none'; });
  cv.addEventListener('wheel', e => { if (!e.altKey && !e.ctrlKey) return; e.preventDefault(); setSize(lqSet.size * (e.deltaY < 0 ? 1.1 : 0.9)); showCur(e); }, { passive: false });
  const setSize = v => { lqSet.size = Math.round(clamp(v, 10, 400)); const r = $('[data-lqs="size"]', m); if (r) r.value = lqSet.size; };
  const setTool = v => { lqSet.tool = v; $$('[data-lq]', m).forEach(b => b.classList.toggle('on', b.dataset.lq === v)); };
  $$('[data-lq]', m).forEach(b => b.addEventListener('click', () => setTool(b.dataset.lq)));
  $$('[data-lqs]', m).forEach(x => x.addEventListener('input', () => { lqSet[x.dataset.lqs] = x.type === 'checkbox' ? x.checked : +x.value; }));
  const doUndo = () => { const u = undo.pop(); if (!u) return; G.D.set(u); redrawAll(); };
  $('#lqUndo', m).addEventListener('click', doUndo);
  $('#lqReset', m).addEventListener('click', () => { if (!G.D.some(v => v)) return; undo.push(G.D.slice()); G.D.fill(0); redrawAll(); });
  const ob = $('#lqOrig', m), showO = on => { orig = on; if (on) { const id = g.createImageData(pw, ph); id.data.set(S); g.putImageData(id, 0, 0); } else g.putImageData(out, 0, 0); };
  ob.addEventListener('pointerdown', () => showO(true)); ob.addEventListener('pointerup', () => showO(false)); ob.addEventListener('pointerleave', () => { if (orig) showO(false); });
  const key = e => { // 창이 떠 있는 동안 단축키는 여기서만
    if (!m.isConnected) { window.removeEventListener('keydown', key, true); return; }
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    const c = e.ctrlKey || e.metaKey;
    if (c && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopImmediatePropagation(); doUndo(); return; }
    if (c) return;
    if (e.key === '[' || e.key === ']') { e.preventDefault(); e.stopImmediatePropagation(); setSize(lqSet.size * (e.key === ']' ? 1.15 : 1 / 1.15)); return; }
    const t = LQ_TOOLS.find(q => q[2].toLowerCase() === e.key.toLowerCase()); if (t) { e.preventDefault(); e.stopImmediatePropagation(); setTool(t[0]); }
  };
  window.addEventListener('keydown', key, true);
  $('#lqGo', m).addEventListener('click', async () => {
    window.removeEventListener('keydown', key, true);
    if (!G.D.some(v => Math.abs(v) > 0.01)) { closeModal(); return; }
    closeModal(); const tk = czProgress('뒤틀기 적용하는 중');
    try {
      const fc = newCanvas(W, H), fg = fc.getContext('2d', { willReadFrequently: true }); fg.drawImage(o.im, 0, 0);
      const src = fg.getImageData(0, 0, W, H).data, res = fg.createImageData(W, H), step = Math.max(16, Math.floor(2e6 / W));
      for (let y = 0; y < H; y += step) {
        if (tk.stop) throw new Error('stop');
        lqRender(G, src, W, H, res.data, W, 1, 0, y, W, Math.min(H, y + step));
        tk.set(`그리는 중… ${Math.round(y / H * 100)}%`, y / H); await new Promise(r => setTimeout(r, 0));
      }
      fg.putImageData(res, 0, 0);
      const rec = await aiRec(fc, o.rec, '뒤틀기', o.rec.alpha);
      const T2 = lqTarget(); const L = T2 && T2.L.img === o.rec.id ? T2.L : T.L; // 그 사이 고른 것이 바뀌었어도 처음 그림에
      L.img = rec.id; clearImgCaches(rec.id);
      tk.done(); commit(); renderProps(); renderLib(); requestRender(); toast('뒤틀기를 적용했어요. Ctrl+Z로 되돌릴 수 있어요', 2600);
    } catch (e) { tk.done(); if (String(e && e.message) !== 'stop') toast('뒤틀기를 적용하지 못했어요. ' + (e && e.message || e), 5000); }
  });
}
