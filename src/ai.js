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
    <p class="muted small">그래픽카드가 없으면 그림 한 장에 몇십 초~몇 분 걸려요.</p>`);
}
function aiAct(act, v) {
  if (act === 'ai-scope') { aiScope = v; renderProps(); return; }
  if (act === 'ai-sc') { aiSr.scale = +v; renderProps(); return; }
  if (act === 'ai-md') { aiSr.model = v; renderProps(); return; }
  if (act === 'ai-bg') { aiRun('bg', v); return; }
  if (act === 'ai-sr') { aiRun('sr'); return; }
}
