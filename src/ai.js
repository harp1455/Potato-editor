/* ================= AI 도구: 배경 지우기·화질 키우기 (설치판에서 팩을 받아 써요) ================= */
// 자동 흰칠과 같은 일꾼(onnxruntime)을 써요. 그림은 이 컴퓨터 안에서만 처리해요
let aiSr = { scale: 2, model: 'sr6' }, aiScope = 'one';
async function aiReady(pack) {
  if (!czIsApp()) { toast('AI 도구는 설치판(exe)에서 팩을 받아 쓸 수 있어요. HTML판에는 들어 있지 않아요.', 4600); return false; }
  return czPacksReady(['base', pack]);
}
const aiImg = L => { const rec = L && L.img && images.get(L.img), im = rec && imgCache.get(rec.id); return rec && im && im.complete && im.naturalWidth ? { rec, im, W: im.naturalWidth, H: im.naturalHeight } : null; };
function aiPixels(im, W, H) { const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, W, H); return g.getImageData(0, 0, W, H); }
// 캐릭터 마스크 (0~255, 그림 크기) — skytnt/anime-seg ISNet, 1024×1024 안에 비율 그대로
async function aiMask(im, W, H, tk) {
  await czLoad('isnet'); if (tk && tk.stop) throw new Error('stop');
  const S = 1024, r = S / Math.max(W, H), w = Math.max(1, Math.round(W * r)), h = Math.max(1, Math.round(H * r)), px = (S - w) >> 1, py = (S - h) >> 1;
  const c = newCanvas(S, S), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.imageSmoothingQuality = 'high'; g.drawImage(im, px, py, w, h);
  const d = g.getImageData(0, 0, S, S).data, x = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) { x[i] = d[i * 4] / 255; x[S * S + i] = d[i * 4 + 1] / 255; x[2 * S * S + i] = d[i * 4 + 2] / 255; }
  const out = await czCall({ t: 'run', key: 'isnet', data: x, dims: [1, 3, S, S] }, [x.buffer]);
  const m = newCanvas(w, h), gm = m.getContext('2d'), md = gm.createImageData(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const v = clamp(out.data[(yy + py) * S + xx + px], 0, 1) * 255, o = (yy * w + xx) * 4; md.data[o] = md.data[o + 1] = md.data[o + 2] = 255; md.data[o + 3] = v; }
  gm.putImageData(md, 0, 0);
  const M = newCanvas(W, H), gM = M.getContext('2d', { willReadFrequently: true }); gM.imageSmoothingQuality = 'high'; gM.drawImage(m, 0, 0, W, H);
  const a = gM.getImageData(0, 0, W, H).data, A = new Uint8ClampedArray(W * H);
  for (let i = 0; i < A.length; i++) { const v = a[i * 4 + 3]; A[i] = v < 12 ? 0 : v > 243 ? 255 : v; } // 아주 옅은 곳·거의 다 찬 곳은 깔끔하게
  return A;
}
async function aiCutout(o, tk) { // 배경을 지운 그림 (캔버스)
  const A = await aiMask(o.im, o.W, o.H, tk), id = aiPixels(o.im, o.W, o.H), d = id.data;
  for (let i = 0; i < A.length; i++) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * A[i] / 255);
  const c = newCanvas(o.W, o.H); c.getContext('2d').putImageData(id, 0, 0); return c;
}
// 화질 키우기: Real-ESRGAN 애니(4배) 조각조각 → 2배면 줄여요
async function aiUpscale(o, scale, model, tk, prog) {
  await czLoad(model); if (tk && tk.stop) throw new Error('stop');
  const W = o.W, H = o.H, F = 4, OW = W * F, OH = H * F;
  if (OW * OH > 42e6) throw new Error('big');
  const src = aiPixels(o.im, W, H).data, out = new ImageData(OW, OH), od = out.data;
  const T = cz.ep === 'webgpu' ? 256 : 128, O = 10, tiles = [];
  for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) tiles.push([x, y]);
  for (let k = 0; k < tiles.length; k++) {
    if (tk && tk.stop) throw new Error('stop');
    const [x0, y0] = tiles[k], ax = Math.max(0, x0 - O), ay = Math.max(0, y0 - O), bx = Math.min(W, x0 + T + O), by = Math.min(H, y0 + T + O), tw = bx - ax, th = by - ay, n = tw * th;
    const inp = new Float32Array(3 * n);
    for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) { const s = ((ay + yy) * W + ax + xx) * 4, j = yy * tw + xx; inp[j] = src[s] / 255; inp[n + j] = src[s + 1] / 255; inp[2 * n + j] = src[s + 2] / 255; }
    const r = await czCall({ t: 'run', key: model, data: inp, dims: [1, 3, th, tw] }, [inp.buffer]);
    const RW = tw * F, RN = RW * th * F, cx0 = (x0 - ax) * F, cy0 = (y0 - ay) * F, cx1 = (Math.min(W, x0 + T) - ax) * F, cy1 = (Math.min(H, y0 + T) - ay) * F;
    for (let yy = cy0; yy < cy1; yy++) for (let xx = cx0; xx < cx1; xx++) {
      const j = yy * RW + xx, o2 = ((ay * F + yy) * OW + ax * F + xx) * 4;
      od[o2] = r.data[j] * 255; od[o2 + 1] = r.data[RN + j] * 255; od[o2 + 2] = r.data[2 * RN + j] * 255; od[o2 + 3] = 255;
    }
    prog && prog((k + 1) / tiles.length);
  }
  let c = newCanvas(OW, OH); c.getContext('2d').putImageData(out, 0, 0);
  if (o.rec.alpha) { const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.imageSmoothingQuality = 'high'; g.drawImage(o.im, 0, 0, OW, OH); } // 투명한 그림은 투명도도 같이 키워요
  if (scale !== 4) { const c2 = newCanvas(Math.round(W * scale), Math.round(H * scale)), g2 = c2.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(c, 0, 0, c2.width, c2.height); c = c2; }
  return c;
}
async function aiRec(c, base, tag, alpha) { // 결과 캔버스 → 새 그림 기록
  const jpg = !alpha && /^data:image\/jpeg/.test(base.src || '');
  const src = c.toDataURL(jpg ? 'image/jpeg' : 'image/png', 0.95), im = await loadImg(src);
  const rec = { id: uid(), name: base.name.replace(/\.[^.]+$/, '') + ` (${tag})` + (jpg ? '.jpg' : '.png'), src, w: im.naturalWidth, h: im.naturalHeight, alpha: !!alpha, folder: base.folder || null };
  if (isImg()) rec.kind = 'stamp'; // 이미지 편집에서는 목록에 따로 안 보이게
  addImageRecord(rec, true, im); return rec;
}
// 범위: 지금 고른 그림 레이어, 또는 (이미지 편집) 폴더·모든 그림의 바탕 그림
function aiTargets() {
  const el = selEls()[0], A = el && el.type === 'panel' ? activeObj(el) : null;
  if (!isImg() || aiScope === 'one') return A ? [{ p: page(), el, L: A }] : [];
  const fo = page().folder;
  return realIdx().map(i => doc.pages[i]).filter(p => aiScope === 'all' || inFolder(p.folder, fo)).map(p => { const B = baseEl(p); return B ? { p, el: B, L: B } : null; }).filter(Boolean);
}
async function aiRun(kind, v) {
  const ts = aiTargets(); if (!ts.length) { toast('먼저 그림이 들어간 컷이나 바탕 그림을 골라 주세요'); return; }
  if (!(await aiReady(kind === 'bg' ? 'bg' : 'sr'))) return;
  const tk = czProgress(kind === 'bg' ? 'AI로 배경 지우는 중' : 'AI로 화질 키우는 중'), back = ts.map(t => t.p.els.slice()), pgs = ts.map(t => clone({ w: t.p.w, h: t.p.h }));
  let done = 0;
  try {
    tk.set('모델 준비하는 중…', 0);
    for (let n = 0; n < ts.length; n++) {
      const { p, el, L } = ts[n], o = aiImg(L); if (!o) continue;
      const pre = ts.length > 1 ? `${n + 1} / ${ts.length}장 · ` : '';
      if (kind === 'bg') {
        tk.set(pre + '캐릭터를 찾는 중…', n / ts.length);
        const c = await aiCutout(o, tk), rec = await aiRec(c, o.rec, '배경 지움', true);
        if (v === 'cut') { L.img = rec.id; }
        else if (isImg() && el.lock) { // 이미지 편집: 같은 자리에 새 레이어(테두리 없는 컷)
          const P = makePanel(el.x + el.w / 2, el.y + el.h / 2, el.w, el.h, rec.id); P.bw = 0; P.radius = 0; P.name = '인물만'; P.rot = el.rot || 0; P.flip = !!el.flip;
          p.els.splice(p.els.indexOf(el) + 1, 0, P);
          if (v === 'blur') el.blur = Math.max(el.blur || 0, Math.round(Math.max(p.w, p.h) / 160));
        } else { // 컷 편집: 같은 컷 안에 같은 자리 레이어로
          const N = { id: uid(), img: rec.id, iz: L.iz ?? 1, ox: L.ox || 0, oy: L.oy || 0, flip: !!L.flip, lrot: L.lrot || 0, lop: 100 };
          (el.layers || (el.layers = [])).push(N); activeLayer.set(el.id, el.layers.length);
          if (v === 'blur') L.blur = Math.max(L.blur || 0, 6);
        }
      } else {
        const lim = Math.floor(Math.sqrt(42e6 / (o.W * o.H)) * 10) / 10, sc = Math.min(aiSr.scale, lim);
        if (sc < 1.2) { toast(`'${o.rec.name}'은 이미 커서 더 키우지 않았어요`, 3000); continue; }
        const c = await aiUpscale(o, sc, aiSr.model, tk, f => tk.set(pre + `화질 키우는 중… ${Math.round(f * 100)}%`, (n + f) / ts.length));
        const rec = await aiRec(c, o.rec, `${sc}배`, o.rec.alpha);
        L.img = rec.id; clearImgCaches(rec.id);
        if (isImg() && el.lock) resizePage(p, c.width / o.W); // 이미지 편집: 그림(페이지)도 그만큼 커져요
      }
      done++;
    }
    if (tk.stop) throw new Error('stop');
    tk.done(); commit(); layoutSpacer(); fitView(); renderProps(); renderLib(); requestRender();
    toast(kind === 'bg' ? (done > 1 ? `${done}장의 배경을 지웠어요` : v === 'cut' ? '배경을 지웠어요. PNG로 저장하면 투명해요' : v === 'blur' ? '인물은 그대로 두고 배경만 흐렸어요. 바탕 그림 보정의 흐림으로 세기를 바꿔요' : '인물만 새 레이어로 올렸어요')
      : (done > 1 ? `${done}장의 화질을 키웠어요` : `화질을 키웠어요 (${page().w} × ${page().h})`), 4200);
  } catch (e) {
    tk.done(); ts.forEach((t, k) => { t.p.els = back[k]; t.p.w = pgs[k].w; t.p.h = pgs[k].h; }); requestRender();
    const m = String((e && e.message) || e);
    if (m === 'stop') toast('멈췄어요. 하던 것은 모두 되돌렸어요', 3000);
    else if (m === 'big') toast('그림이 너무 커서 키울 수 없어요. 먼저 크기를 줄여 주세요', 4000);
    else toast(czErrText(e), 6000);
  }
}
/* ---- AI 지우개: 칠한(고른) 곳을 둘레에 맞게 메워요 — LaMa, 애니·만화용 가중치 (설치판 팩) ---- */
// 결과는 그 자리에 놓이는 새 레이어(테두리 없는 컷)라서 레이어 탭에서 끄거나 지울 수 있어요
let aiEraseBusy = false;
const AI_OVER = { bubble: 1, text: 1, stamp: 1, draw: 1, shape: 1, tmpl: 1 }; // 위에 얹은 것들(말풍선·글자 등)은 빼고 그림만 보고 메워요
function aiMaskBox(mask, ms) { // 마스크(흰색) → 페이지 좌표 상자
  const W = mask.width, H = mask.height, d = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] >= 96) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0 / ms, y: y0 / ms, w: (x1 - x0 + 1) / ms, h: (y1 - y0 + 1) / ms };
}
async function aiErase(mask, ms, skip) { // mask: 페이지를 ms배로 그린 캔버스 (흰색 = 지울 곳). skip: 바탕 그리기에서 뺄 요소
  const pg = page(), bb = aiMaskBox(mask, ms);
  if (!bb) { toast('먼저 지울 곳을 칠하세요'); return false; }
  if (!(await aiReady('erase'))) return false;
  if (aiEraseBusy) return false; aiEraseBusy = true;
  const tk = czProgress('AI로 지우는 중');
  try {
    tk.set('지우개 모델 준비하는 중… (처음엔 몇 초 걸려요)', 0.05);
    await czLoad('lama'); if (tk.stop) throw new Error('stop');
    // 지울 곳 둘레를 넉넉히 넣은 조각 (둘레를 보고 메우니까요)
    const m = Math.max(bb.w, bb.h), side = Math.min(Math.max(pg.w, pg.h), m + 2 * Math.max(40, m * 0.6));
    const R = { w: Math.min(pg.w, side), h: Math.min(pg.h, side) };
    R.x = clamp(bb.x + bb.w / 2 - R.w / 2, 0, pg.w - R.w); R.y = clamp(bb.y + bb.h / 2 - R.h / 2, 0, pg.h - R.h);
    const B = baseEl(pg), rec = B && B.img && images.get(B.img), k = clamp(rec ? rec.w / Math.max(1, B.w) : 1, 1, 3); // 원래 그림 해상도로
    const RW = Math.max(1, Math.round(R.w * k)), RH = Math.max(1, Math.round(R.h * k));
    const els = pg.els.filter(e => e !== skip); let at = 0; els.forEach((e, i) => { if (!AI_OVER[e.type]) at = i + 1; });
    const comp = newCanvas(RW, RH), gc = comp.getContext('2d'); gc.fillStyle = pg.bg || '#fff'; gc.fillRect(0, 0, RW, RH);
    gc.setTransform(k, 0, 0, k, -R.x * k, -R.y * k);
    const view = { x0: R.x, y0: R.y, x1: R.x + R.w, y1: R.y + R.h };
    for (const e of els.slice(0, at)) if (!e.hidden && !AI_OVER[e.type] && !(e.type === 'fx' && e.kind === 'aierase')) drawEl(gc, e, { screen: false, rs: k, view });
    gc.setTransform(1, 0, 0, 1, 0, 0);
    // 모델 입력 512×512: 비율 그대로 줄이고(키우고) 남는 곳은 가장자리를 늘여 채워요
    const S = 512, f = S / Math.max(RW, RH), w = Math.max(1, Math.round(RW * f)), h = Math.max(1, Math.round(RH * f));
    const ci = newCanvas(S, S), gi = ci.getContext('2d', { willReadFrequently: true }); gi.imageSmoothingQuality = 'high';
    gi.drawImage(comp, 0, 0, w, h);
    if (w < S) gi.drawImage(ci, w - 1, 0, 1, h, w, 0, S - w, h);
    if (h < S) gi.drawImage(ci, 0, h - 1, S, 1, 0, h, S, S - h);
    const cm = newCanvas(S, S), gm = cm.getContext('2d', { willReadFrequently: true });
    const grow = Math.max(2, Math.round(S * 0.006)); // 조금 넓혀서 테두리(선 찌꺼기)까지
    gm.filter = `blur(${grow}px)`; gm.drawImage(mask, R.x * ms, R.y * ms, R.w * ms, R.h * ms, 0, 0, w, h); gm.filter = 'none';
    const px = gi.getImageData(0, 0, S, S).data, md = gm.getImageData(0, 0, S, S).data, N = S * S, img = new Float32Array(3 * N), mk = new Float32Array(N);
    for (let i = 0; i < N; i++) { img[i] = px[i * 4] / 255; img[N + i] = px[i * 4 + 1] / 255; img[2 * N + i] = px[i * 4 + 2] / 255; mk[i] = md[i * 4 + 3] > 20 ? 1 : 0; }
    tk.set('AI가 둘레에 맞게 메우는 중…', 0.3);
    const r = await czCall({ t: 'run2', key: 'lama', outs: ['output'], feeds: { image: { data: img, dims: [1, 3, S, S] }, mask: { data: mk, dims: [1, 1, S, S] } } }, [img.buffer, mk.buffer]);
    if (tk.stop) throw new Error('stop');
    const y = r.out.output.data, co = newCanvas(S, S), go = co.getContext('2d'), od = go.createImageData(S, S);
    for (let i = 0; i < N; i++) { od.data[i * 4] = y[i]; od.data[i * 4 + 1] = y[N + i]; od.data[i * 4 + 2] = y[2 * N + i]; od.data[i * 4 + 3] = 255; }
    go.putImageData(od, 0, 0);
    // 원래 크기로 → 지운 곳(조금 넓혀서 부드럽게)만 남겨요
    const out = newCanvas(RW, RH), gO = out.getContext('2d'); gO.imageSmoothingQuality = 'high'; gO.drawImage(co, 0, 0, w, h, 0, 0, RW, RH);
    const fm = newCanvas(RW, RH), gf = fm.getContext('2d');
    gf.filter = `blur(${Math.max(1, grow / f * 0.8).toFixed(1)}px)`; gf.drawImage(cm, 0, 0, w, h, 0, 0, RW, RH); gf.filter = 'none';
    gf.globalCompositeOperation = 'source-over'; gf.imageSmoothingQuality = 'high'; gf.drawImage(mask, R.x * ms, R.y * ms, R.w * ms, R.h * ms, 0, 0, RW, RH); // 칠한 곳 안쪽은 꽉 차게
    gO.globalCompositeOperation = 'destination-in'; gO.drawImage(fm, 0, 0);
    const src = out.toDataURL('image/png'), im = await loadImg(src);
    const nr = { id: uid(), name: 'AI 지움.png', src, w: RW, h: RH, alpha: true, kind: 'stamp' }; addImageRecord(nr, true, im);
    const P = makePanel(R.x + R.w / 2, R.y + R.h / 2, R.w, R.h, nr.id); P.bw = 0; P.radius = 0; P.name = 'AI 지움';
    const idx = at ? pg.els.indexOf(els[at - 1]) + 1 : 0; pg.els.splice(idx, 0, P);
    tk.done(); e2SetHint('AI 지우개'); commit(); renderProps(); requestRender();
    toast('지웠어요. 마음에 안 들면 Ctrl+Z, 더 지울 곳은 이어서 칠하세요', 3200);
    return true;
  } catch (e) {
    tk.done(); const msg = String((e && e.message) || e);
    toast(msg === 'stop' ? '멈췄어요' : czErrText(e), msg === 'stop' ? 2000 : 6000); return false;
  } finally { aiEraseBusy = false; }
}
async function aiEraseBrush() { // 'AI 지우개' 붓: 손을 떼면 칠한 곳을 지워요
  const bs = brushSt; if (!bs || aiEraseBusy) return;
  const el = bs.el, pg = page(), ms = Math.min(1, 2048 / Math.max(pg.w, pg.h));
  const mk = newCanvas(Math.max(1, Math.round(pg.w * ms)), Math.max(1, Math.round(pg.h * ms))), g = mk.getContext('2d');
  g.setTransform(ms, 0, 0, ms, 0, 0); g.translate(el.x + el.w / 2, el.y + el.h / 2); if (el.rot) g.rotate(el.rot * DEG);
  fxShapes(g, el, Math.sqrt(el.w * el.h) / (el.s0 || 1), '#ffffff');
  pg.els = pg.els.filter(e => e !== el); // 칠한 자국은 빼고(기록에 안 남게), 붓은 그대로 이어서
  if (brushSt === bs) { startBrush(); brushSt.el.kind = 'aierase'; }
  requestRender();
  await aiErase(mk, ms, el);
}

/* ---- 선화 추출: 그림에서 선만 뽑아요 — informative-drawings 선화 모델 (설치판 팩) ---- */
const aiLine = { model: 'F', gain: 1.4 };
async function aiLineArt(o, tk) { // → 선 진하기(0~1) 배열, 그림 크기
  const key = aiLine.model === 'C' ? 'lineC' : 'lineF'; await czLoad(key); if (tk && tk.stop) throw new Error('stop');
  const W = o.W, H = o.H, s = Math.min(1, 1600 / Math.max(W, H)), w = Math.max(8, Math.round(W * s / 8) * 8), h = Math.max(8, Math.round(H * s / 8) * 8);
  const c = newCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(o.im, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, n = w * h, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { x[i] = d[i * 4] / 255; x[n + i] = d[i * 4 + 1] / 255; x[2 * n + i] = d[i * 4 + 2] / 255; }
  const r = await czCall({ t: 'run', key, data: x, dims: [1, 3, h, w] }, [x.buffer]);
  const lc = newCanvas(w, h), gl = lc.getContext('2d'), ld = gl.createImageData(w, h);
  for (let i = 0; i < n; i++) { const v = clamp(((1 - r.data[i]) - 0.04) / 0.96 * aiLine.gain, 0, 1); ld.data[i * 4 + 3] = Math.round(v * 255); }
  gl.putImageData(ld, 0, 0);
  const L = newCanvas(W, H), gL = L.getContext('2d', { willReadFrequently: true }); gL.imageSmoothingQuality = 'high'; gL.drawImage(lc, 0, 0, W, H);
  return L; // 검은 선(투명 바탕)
}
async function aiLineRun(v) {
  const ts = aiTargets(); if (!ts.length) { toast('먼저 그림이 들어간 컷이나 바탕 그림을 골라 주세요'); return; }
  if (!(await aiReady('line'))) return;
  const tk = czProgress('AI로 선화 뽑는 중'), back = ts.map(t => t.p.els.slice()); let done = 0;
  try {
    tk.set('선화 모델 준비하는 중…', 0);
    for (let n = 0; n < ts.length; n++) {
      const { p, el, L } = ts[n], o = aiImg(L); if (!o) continue;
      tk.set((ts.length > 1 ? `${n + 1} / ${ts.length}장 · ` : '') + '선을 찾는 중…', n / ts.length);
      const lines = await aiLineArt(o, tk);
      if (v === 'replace') { // 흰 바탕 선화로 바꾸기
        const c = newCanvas(o.W, o.H), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, o.W, o.H); g.drawImage(lines, 0, 0);
        if (o.rec.alpha) { g.globalCompositeOperation = 'destination-in'; g.drawImage(o.im, 0, 0); }
        const rec = await aiRec(c, o.rec, '선화', o.rec.alpha); L.img = rec.id; clearImgCaches(rec.id);
      } else { // 선화 레이어 (투명 바탕): 같은 자리 위에
        const rec = await aiRec(lines, o.rec, '선화', true);
        if (isImg() && el.lock) {
          const P = makePanel(el.x + el.w / 2, el.y + el.h / 2, el.w, el.h, rec.id); P.bw = 0; P.radius = 0; P.name = '선화'; P.rot = el.rot || 0; P.flip = !!el.flip;
          p.els.splice(p.els.indexOf(el) + 1, 0, P);
        } else {
          const N = { id: uid(), img: rec.id, iz: L.iz ?? 1, ox: L.ox || 0, oy: L.oy || 0, flip: !!L.flip, lrot: L.lrot || 0, lop: 100 };
          (el.layers || (el.layers = [])).push(N); activeLayer.set(el.id, el.layers.length);
        }
      }
      done++;
    }
    if (tk.stop) throw new Error('stop');
    tk.done(); e2SetHint('선화 추출'); commit(); renderProps(); renderLib(); requestRender();
    toast(v === 'replace' ? '그림을 선화로 바꿨어요' : '선화를 투명 바탕 새 레이어로 넣었어요. 레이어 탭에서 아래 그림을 끄면 선만 보여요', 4200);
  } catch (e) {
    tk.done(); ts.forEach((t, k) => { t.p.els = back[k]; }); requestRender();
    const m = String((e && e.message) || e); toast(m === 'stop' ? '멈췄어요. 하던 것은 모두 되돌렸어요' : czErrText(e), m === 'stop' ? 3000 : 6000);
  }
}
function aiSec() {
  const multi = isImg() && realIdx().length > 1, fo = isImg() && page().folder && folderById(page().folder);
  return sec('ai', 'AI 도구', `
    <p class="muted small" style="margin:0 0 6px">처음 쓸 때 팩을 한 번 받아요 (배경 지우기 82MB, 화질 키우기 11MB). 그림은 이 컴퓨터 안에서만 처리해요.</p>
    ${multi ? `<div class="row"><span class="l">적용할 그림</span><div class="seg"><button class="btn sm ${aiScope === 'one' ? 'on' : ''}" data-act="ai-scope" data-v="one">이 그림</button>${fo ? `<button class="btn sm ${aiScope === 'fold' ? 'on' : ''}" data-act="ai-scope" data-v="fold">이 폴더</button>` : ''}<button class="btn sm ${aiScope === 'all' ? 'on' : ''}" data-act="ai-scope" data-v="all">모든 그림</button></div></div>` : ''}
    <h4 class="advh">배경 지우기</h4>
    <div class="btnrow"><button class="btn sm" data-act="ai-bg" data-v="cut" title="캐릭터만 남기고 배경을 투명하게">배경 지우기</button><button class="btn sm" data-act="ai-bg" data-v="layer" title="원래 그림은 두고, 캐릭터만 딴 것을 위에 새 레이어로">인물만 새 레이어로</button><button class="btn sm" data-act="ai-bg" data-v="blur" title="캐릭터는 또렷하게, 배경만 흐리게">배경만 흐리게</button></div>
    <h4 class="advh">화질 키우기</h4>
    <div class="row"><span class="l">배율</span><div class="seg"><button class="btn sm ${aiSr.scale === 2 ? 'on' : ''}" data-act="ai-sc" data-v="2">2배</button><button class="btn sm ${aiSr.scale === 4 ? 'on' : ''}" data-act="ai-sc" data-v="4">4배</button></div></div>
    <div class="row"><span class="l">모델</span><div class="seg"><button class="btn sm ${aiSr.model === 'sr4' ? 'on' : ''}" data-act="ai-md" data-v="sr4" title="작은 모델이라 빨라요">빠르게</button><button class="btn sm ${aiSr.model === 'sr6' ? 'on' : ''}" data-act="ai-md" data-v="sr6" title="선과 결이 더 깔끔해요. 몇 배 느려요">고화질</button></div></div>
    <div class="btnrow"><button class="btn sm primary" data-act="ai-sr">화질 키우기</button></div>
    <p class="muted small">그래픽카드가 없으면 그림 한 장에 몇십 초~몇 분 걸려요.</p>
    <h4 class="advh">선화 추출</h4>
    <div class="row"><span class="l">선</span><div class="seg"><button class="btn sm ${aiLine.model === 'F' ? 'on' : ''}" data-act="ai-lnm" data-v="F" title="가늘고 깔끔한 선, 음영 선도 조금">가는 선</button><button class="btn sm ${aiLine.model === 'C' ? 'on' : ''}" data-act="ai-lnm" data-v="C" title="굵은 윤곽 위주, 연필 느낌">굵은 선</button></div></div>
    <div class="row"><span class="l">진하기</span><input type="range" min="0.6" max="3" step="0.1" value="${aiLine.gain}" data-ailn="gain"><span class="muted small" style="min-width:28px">${aiLine.gain.toFixed(1)}</span></div>
    <div class="btnrow"><button class="btn sm" data-act="ai-line" data-v="layer" title="원래 그림은 두고, 투명 바탕 선화를 위에 새 레이어로">선화 레이어로</button><button class="btn sm" data-act="ai-line" data-v="replace" title="그림을 흰 바탕 선화로 바꿔요">그림을 선화로</button></div>
    <h4 class="advh">AI 지우개</h4>
    <p class="muted small" style="margin:0">위쪽 '가리기' 붓의 'AI 지우개'로 지울 물건을 칠하거나, '선택'으로 고른 뒤 'AI로 지우기'를 누르면 둘레에 맞게 메워요. (지우개 95MB, 선화 16MB 팩)</p>`);
}
function aiAct(act, v) {
  if (act === 'ai-scope') { aiScope = v; renderProps(); return; }
  if (act === 'ai-sc') { aiSr.scale = +v; renderProps(); return; }
  if (act === 'ai-md') { aiSr.model = v; renderProps(); return; }
  if (act === 'ai-bg') { aiRun('bg', v); return; }
  if (act === 'ai-sr') { aiRun('sr'); return; }
  if (act === 'ai-lnm') { aiLine.model = v; renderProps(); return; }
  if (act === 'ai-line') { aiLineRun(v); return; }
}
propsEl.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.ailn === 'gain') { aiLine.gain = +t.value; if (t.nextElementSibling) t.nextElementSibling.textContent = aiLine.gain.toFixed(1); } });
