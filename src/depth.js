/* ================= AI 깊이 효과: 거리에 따라 배경 흐리기 · 입체 움짤 (Depth Anything V2 Small, 설치판 팩) ================= */
// 깊이 지도: 0 = 멀리, 1 = 가까이. 모델은 짧은 쪽 518(긴 쪽 최대 924)에서 돌리고, 그림 크기로 늘린 뒤 그림 윤곽에 맞춰 다듬어요(가이드 필터)
const dpCache = new Map(); // 그림 id → {W, H, D}
async function dpRaw(src, W, H, tk) {
  await czLoad('depth'); if (tk && tk.stop) throw new Error('stop');
  let s = 518 / Math.min(W, H); if (Math.max(W, H) * s > 924) s = 924 / Math.max(W, H);
  const w = Math.max(14, Math.round(W * s / 14) * 14), h = Math.max(14, Math.round(H * s / 14) * 14);
  const c = newCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, n = w * h, x = new Float32Array(3 * n), M = [0.485, 0.456, 0.406], S = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) x[k * n + i] = (d[i * 4 + k] / 255 - M[k]) / S[k];
  const out = await czCall({ t: 'run', key: 'depth', data: x, dims: [1, 3, h, w] }, [x.buffer]);
  const o = out.data, oh = out.dims[out.dims.length - 2], ow = out.dims[out.dims.length - 1];
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < o.length; i++) { if (o[i] < lo) lo = o[i]; if (o[i] > hi) hi = o[i]; }
  const sc = 1 / Math.max(1e-6, hi - lo), D = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { // 겹선형으로 그림 크기까지
    const fy = Math.min(oh - 1, Math.max(0, (y + 0.5) * oh / H - 0.5)), y0 = Math.floor(fy), y1 = Math.min(oh - 1, y0 + 1), ty = fy - y0;
    for (let xx = 0; xx < W; xx++) {
      const fx = Math.min(ow - 1, Math.max(0, (xx + 0.5) * ow / W - 0.5)), x0 = Math.floor(fx), x1 = Math.min(ow - 1, x0 + 1), tx = fx - x0;
      const v = (o[y0 * ow + x0] * (1 - tx) + o[y0 * ow + x1] * tx) * (1 - ty) + (o[y1 * ow + x0] * (1 - tx) + o[y1 * ow + x1] * tx) * ty;
      D[y * W + xx] = (v - lo) * sc;
    }
  }
  return D;
}
// 상자 평균 (적분 영상, 반지름 r)
function dpBox(a, W, H, r) {
  const I = new Float64Array((W + 1) * (H + 1)), o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) { s += a[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + s; } }
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      o[y * W + x] = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return o;
}
// 가이드 필터: 깊이 경계를 그림 윤곽(밝기)에 붙여요
function dpGuided(G, P, W, H, r, eps) {
  const n = W * H, GP = new Float32Array(n), GG = new Float32Array(n);
  for (let i = 0; i < n; i++) { GP[i] = G[i] * P[i]; GG[i] = G[i] * G[i]; }
  const mG = dpBox(G, W, H, r), mP = dpBox(P, W, H, r), mGP = dpBox(GP, W, H, r), mGG = dpBox(GG, W, H, r), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = mGG[i] - mG[i] * mG[i], c = mGP[i] - mG[i] * mP[i]; A[i] = c / (v + eps); B[i] = mP[i] - A[i] * mG[i]; }
  const mA = dpBox(A, W, H, r), mB = dpBox(B, W, H, r), o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = clamp(mA[i] * G[i] + mB[i], 0, 1);
  return o;
}
function dpGray(src, W, H) { const d = aiPixels(src, W, H).data, n = W * H, g = new Float32Array(n); for (let i = 0; i < n; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255; return g; }
async function dpDepth(src, W, H, key, tk) {
  const c = key && dpCache.get(key); if (c && c.W === W && c.H === H) return c.D;
  const raw = await dpRaw(src, W, H, tk);
  const D = dpGuided(dpGray(src, W, H), raw, W, H, Math.max(3, Math.round(Math.min(W, H) / 160)), 4e-4);
  if (key) { dpCache.set(key, { W, H, D }); while (dpCache.size > 6) dpCache.delete(dpCache.keys().next().value); }
  return D;
}
// 인물 마스크(0~1): 배경 지우기 팩이 있으면 그 모델로, 없으면 깊이로 (가까운 덩어리)
async function dpSubject(src, W, H, D, tk) {
  let st = null; try { st = await czPackState(false); } catch (_) { }
  if (st && st.bg) { try { const A = await aiMask(src, W, H, tk), m = new Float32Array(W * H); let s = 0; for (let i = 0; i < m.length; i++) { m[i] = A[i] / 255; s += m[i]; } if (s > m.length * 0.01) return { m, by: 'isnet' }; } catch (e) { if (String(e && e.message) === 'stop') throw e; } }
  const t = dpOtsu(D), m = new Float32Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = clamp((D[i] - t) / 0.06 + 0.5, 0, 1);
  return { m, by: 'depth' };
}
function dpOtsu(D) { // 깊이를 앞·뒤 둘로 나누는 기준
  const h = new Float64Array(256); for (let i = 0; i < D.length; i++) h[Math.min(255, D[i] * 255 | 0)]++;
  let sum = 0, tot = D.length; for (let i = 0; i < 256; i++) sum += i * h[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let i = 0; i < 256; i++) { wB += h[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = i; } }
  return (th + 0.5) / 255;
}
// 가중치 a로 거른 그림을 흐리게 → 가려진 곳 색은 둘레 색으로 (정규화 흐림). 결과는 RGBA 바이트(알파 = 흐려진 가중치)
function dpNormBlur(px, A, W, H, sigma) {
  const c = newCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
  for (let i = 0; i < W * H; i++) { d[i * 4] = px[i * 4]; d[i * 4 + 1] = px[i * 4 + 1]; d[i * 4 + 2] = px[i * 4 + 2]; d[i * 4 + 3] = A[i] * 255; }
  g.putImageData(id, 0, 0);
  if (sigma < 0.3) return d;
  const pad = Math.ceil(sigma * 3), c2 = newCanvas(W + pad * 2, H + pad * 2), g2 = c2.getContext('2d', { willReadFrequently: true });
  g2.drawImage(c, pad, pad); // 가장자리는 늘여서 붙여요 (흐림이 가장자리에서 옅어지지 않게)
  g2.drawImage(c, 0, 0, W, 1, pad, 0, W, pad); g2.drawImage(c, 0, H - 1, W, 1, pad, H + pad, W, pad);
  g2.drawImage(c2, pad, 0, 1, H + pad * 2, 0, 0, pad, H + pad * 2); g2.drawImage(c2, W + pad - 1, 0, 1, H + pad * 2, W + pad, 0, pad, H + pad * 2);
  const c3 = newCanvas(W + pad * 2, H + pad * 2), g3 = c3.getContext('2d', { willReadFrequently: true }); g3.filter = `blur(${sigma.toFixed(2)}px)`; g3.drawImage(c2, 0, 0); g3.filter = 'none';
  return g3.getImageData(pad, pad, W, H).data;
}

/* ---- 거리에 따라 흐리게 (심도) ---- */
// o: {focus(초점 깊이), band(초점 폭), amt(흐림 세기 0~100), front(앞쪽도), subj(인물 마스크 또는 null)}
function dpDof(src, W, H, D, o) {
  const px = aiPixels(src, W, H).data, n = W * H, Rmax = Math.max(W, H) * 0.012 * (o.amt / 50), f = o.focus, band = o.band;
  const back = new Float32Array(n), rad = new Float32Array(n);
  let dmin = 1; for (let i = 0; i < n; i++) if (D[i] < dmin) dmin = D[i];
  const span = Math.max(0.05, f - band - dmin);
  for (let i = 0; i < n; i++) {
    const b = o.subj ? 1 - o.subj[i] : clamp((f - band - D[i]) / 0.05, 0, 1);
    back[i] = b; rad[i] = Rmax * Math.pow(clamp((f - band - D[i]) / span, 0, 1), 0.8);
    if (o.subj) rad[i] = Math.max(rad[i], Rmax * 0.25 * b); // 인물 밖은 조금이라도 흐리게
  }
  const K = 5, L = [];
  for (let k = 1; k <= K; k++) L.push(dpNormBlur(px, back, W, H, Rmax * k / K / 2));
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4, r = rad[i] / Math.max(1e-6, Rmax) * K, k0 = Math.min(K - 1, Math.floor(r)), t = r - k0;
    let R, G, B;
    if (k0 === 0) { const q = L[0]; R = px[j] * (1 - t) + q[j] * t; G = px[j + 1] * (1 - t) + q[j + 1] * t; B = px[j + 2] * (1 - t) + q[j + 2] * t; }
    else { const p = L[k0 - 1], q = L[Math.min(K - 1, k0)]; R = p[j] * (1 - t) + q[j] * t; G = p[j + 1] * (1 - t) + q[j + 1] * t; B = p[j + 2] * (1 - t) + q[j + 2] * t; }
    const b = back[i]; // 인물(또렷한 곳)은 원래 그림 그대로
    out[j] = R * b + px[j] * (1 - b); out[j + 1] = G * b + px[j + 1] * (1 - b); out[j + 2] = B * b + px[j + 2] * (1 - b); out[j + 3] = px[j + 3];
  }
  if (o.front) { // 초점보다 가까운 것: 번지듯 흐리게 위에 얹어요
    const fr = new Float32Array(n); let any = 0;
    for (let i = 0; i < n; i++) { fr[i] = clamp((D[i] - f - band) / 0.05, 0, 1); any += fr[i]; }
    if (any > n * 0.002) {
      const c = newCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H);
      for (let i = 0; i < n; i++) { id.data[i * 4] = px[i * 4]; id.data[i * 4 + 1] = px[i * 4 + 1]; id.data[i * 4 + 2] = px[i * 4 + 2]; id.data[i * 4 + 3] = fr[i] * 255; }
      g.putImageData(id, 0, 0);
      const c2 = newCanvas(W, H), g2 = c2.getContext('2d', { willReadFrequently: true }); g2.filter = `blur(${(Rmax * 0.35).toFixed(2)}px)`; g2.drawImage(c, 0, 0);
      const q = g2.getImageData(0, 0, W, H).data;
      for (let i = 0; i < n; i++) { const j = i * 4, a = q[j + 3] / 255; if (!a) continue; out[j] = out[j] * (1 - a) + q[j] * a; out[j + 1] = out[j + 1] * (1 - a) + q[j + 1] * a; out[j + 2] = out[j + 2] * (1 - a) + q[j + 2] * a; }
    }
  }
  const c = newCanvas(W, H); c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0); return c;
}

/* ---- 입체 움짤: 인물 층과 배경 층(인물 뒤를 메운 것)을 깊이만큼 다르게 움직여요 ---- */
async function dpFill(px, hole, W, H, tk) { // 인물 뒤 배경 메우기: AI 지우개 팩이 있으면 LaMa, 없으면 둘레 색 번지기
  const n = W * H;
  let st = null; try { st = await czPackState(false); } catch (_) { }
  if (st && st.erase) {
    try {
      await czLoad('lama'); if (tk && tk.stop) throw new Error('stop');
      const S = 512, f = S / Math.max(W, H), w = Math.max(1, Math.round(W * f)), h = Math.max(1, Math.round(H * f));
      const src = newCanvas(W, H); src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
      const ci = newCanvas(S, S), gi = ci.getContext('2d', { willReadFrequently: true }); gi.imageSmoothingQuality = 'high'; gi.drawImage(src, 0, 0, w, h);
      if (w < S) gi.drawImage(ci, w - 1, 0, 1, h, w, 0, S - w, h);
      if (h < S) gi.drawImage(ci, 0, h - 1, S, 1, 0, h, S, S - h);
      const mc = newCanvas(W, H), mg = mc.getContext('2d'), mi = mg.createImageData(W, H); for (let i = 0; i < n; i++) mi.data[i * 4 + 3] = hole[i] > 0.5 ? 255 : 0; mg.putImageData(mi, 0, 0);
      const cm = newCanvas(S, S), gm = cm.getContext('2d', { willReadFrequently: true }); gm.drawImage(mc, 0, 0, w, h);
      const ip = gi.getImageData(0, 0, S, S).data, md = gm.getImageData(0, 0, S, S).data, N = S * S, img = new Float32Array(3 * N), mk = new Float32Array(N);
      for (let i = 0; i < N; i++) { img[i] = ip[i * 4] / 255; img[N + i] = ip[i * 4 + 1] / 255; img[2 * N + i] = ip[i * 4 + 2] / 255; mk[i] = md[i * 4 + 3] > 20 ? 1 : 0; }
      const r = await czCall({ t: 'run2', key: 'lama', outs: ['output'], feeds: { image: { data: img, dims: [1, 3, S, S] }, mask: { data: mk, dims: [1, 1, S, S] } } }, [img.buffer, mk.buffer]);
      const y = r.out.output.data, co = newCanvas(S, S), go = co.getContext('2d'), od = go.createImageData(S, S);
      for (let i = 0; i < N; i++) { od.data[i * 4] = y[i]; od.data[i * 4 + 1] = y[N + i]; od.data[i * 4 + 2] = y[2 * N + i]; od.data[i * 4 + 3] = 255; }
      go.putImageData(od, 0, 0);
      const back = newCanvas(W, H), gb = back.getContext('2d', { willReadFrequently: true }); gb.imageSmoothingQuality = 'high'; gb.drawImage(co, 0, 0, w, h, 0, 0, W, H);
      const q = gb.getImageData(0, 0, W, H).data, o = new Uint8ClampedArray(px);
      for (let i = 0; i < n; i++) { const a = clamp(hole[i], 0, 1); if (a) for (let k = 0; k < 3; k++) o[i * 4 + k] = px[i * 4 + k] * (1 - a) + q[i * 4 + k] * a; o[i * 4 + 3] = 255; }
      return { px: o, by: 'lama' };
    } catch (e) { if (String(e && e.message) === 'stop') throw e; }
  }
  // 둘레 색을 여러 크기로 번져 메워요 (멀리 갈수록 큰 흐림)
  const keep = new Float32Array(n); for (let i = 0; i < n; i++) keep[i] = 1 - clamp(hole[i], 0, 1);
  const o = new Uint8ClampedArray(px), left = new Float32Array(n).fill(0); for (let i = 0; i < n; i++) left[i] = hole[i];
  for (const s of [2, 5, 12, 30, 70].map(v => v * Math.max(W, H) / 800)) {
    const q = dpNormBlur(px, keep, W, H, s);
    for (let i = 0; i < n; i++) { if (left[i] <= 0) continue; const a = q[i * 4 + 3] / 255; if (a < 0.02) continue; const take = Math.min(left[i], left[i] * clamp(a * 3, 0, 1)); for (let k = 0; k < 3; k++) o[i * 4 + k] = o[i * 4 + k] * (1 - take) + q[i * 4 + k] * take; left[i] -= take; }
  }
  return { px: o, by: 'blur' };
}
function dpExtend(V, A, W, H, sig) { // 가중치 A가 있는 곳의 값 V를 밖으로 번지게 (층 밖 깊이 채우기)
  const c = newCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), n = W * H;
  for (let i = 0; i < n; i++) { const v = Math.round(clamp(V[i], 0, 1) * 255); id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = clamp(A[i], 0, 1) * 255; }
  g.putImageData(id, 0, 0);
  const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = A[i] > 0.98 ? V[i] : -1;
  for (const s of [3, 10, 30, 90].map(v => v * Math.max(W, H) / 800)) {
    const c2 = newCanvas(W, H), g2 = c2.getContext('2d', { willReadFrequently: true }); g2.filter = `blur(${s.toFixed(1)}px)`; g2.drawImage(c, 0, 0); const q = g2.getImageData(0, 0, W, H).data;
    for (let i = 0; i < n; i++) if (o[i] < 0 && q[i * 4 + 3] > 3) o[i] = q[i * 4] / 255;
  }
  for (let i = 0; i < n; i++) { if (o[i] < 0) o[i] = sig; else if (A[i] > 0 && A[i] < 0.98) o[i] = V[i] * A[i] + o[i] * (1 - A[i]); }
  return o;
}
// 준비: 그림(W×H) → 층 두 개와 깊이
async function dpPrepare(src, W, H, key, tk) {
  tk && tk.set('깊이를 재는 중…', 0.1);
  const D = await dpDepth(src, W, H, key, tk); if (tk && tk.stop) throw new Error('stop');
  tk && tk.set('인물을 찾는 중…', 0.35);
  const sub = await dpSubject(src, W, H, D, tk); if (tk && tk.stop) throw new Error('stop');
  const n = W * H, px = aiPixels(src, W, H).data, m0 = sub.m;
  for (let i = 0; i < n; i++) if (m0[i] < 0.15) m0[i] = 0; // 아주 옅은 점은 버려요 (가장자리 얼룩)
  if (sub.by === 'isnet') { // 인물 모델이 놓친 옷자락·머리카락: 인물 둘레에서 인물과 거리가 같은 곳은 인물에 넣어요
    const ds = []; for (let i = 0; i < n; i++) if (m0[i] > 0.7) ds.push(D[i]);
    if (ds.length > 50) {
      ds.sort((x, y) => x - y); const lo = ds[Math.floor(ds.length * 0.2)] - 0.04;
      const near = dpBox(Float32Array.from(m0, v => v > 0.5 ? 1 : 0), W, H, Math.max(2, Math.round(Math.max(W, H) * 0.03)));
      for (let i = 0; i < n; i++) if (near[i] > 0.02) m0[i] = Math.max(m0[i], clamp((D[i] - lo) / 0.03, 0, 1));
    }
  }
  const m = dpBox(m0, W, H, 1);
  const grow = Math.max(3, Math.round(Math.max(W, H) / 60)), mb = dpBox(m, W, H, grow), hole = new Float32Array(n);
  for (let i = 0; i < n; i++) hole[i] = clamp(mb[i] * 3, 0, 1); // 인물보다 조금 넓게 메워요 (가장자리 테두리가 안 남게)
  tk && tk.set('인물 뒤 배경을 메우는 중…', 0.55);
  const bg = await dpFill(px, hole, W, H, tk); if (tk && tk.stop) throw new Error('stop');
  let ps = 0, pn = 0; for (let i = 0; i < n; i++) if (m[i] > 0.5) { ps += D[i]; pn++; }
  const pivot = pn ? ps / pn : 0.6;
  const Dbg = dpExtend(D, Float32Array.from(hole, v => 1 - v), W, H, 0.2), Dfg = dpExtend(D, m, W, H, pivot);
  return { W, H, px, m, bg: bg.px, Dbg, Dfg, pivot, by: sub.by + '+' + bg.by };
}
// 한 장 그리기. t: 0~1(한 바퀴), o: {move: 'orbit'|'sway'|'nod'|'zoom', amt(0~100), base: 'subj'|'bg'}
function dpFrame(P, t, o, out) {
  const { W, H } = P, n = W * H, th = t * Math.PI * 2, A = Math.max(W, H) * 0.013 * (o.amt / 50);
  let ax = 0, ay = 0, z = 0;
  if (o.move === 'orbit') { ax = Math.cos(th); ay = Math.sin(th) * 0.6; }
  else if (o.move === 'sway') ax = Math.sin(th);
  else if (o.move === 'nod') ay = Math.sin(th);
  else z = (1 - Math.cos(th)) / 2;
  const piv = o.base === 'bg' ? 0 : P.pivot, mg = 1 + (A * 1.2) / Math.min(W, H) + (o.move === 'zoom' ? 0 : 0); // 가장자리가 비지 않게 살짝 확대
  const cx = W / 2, cy = H / 2, d = out.data;
  const samp = (src, x, y, j) => { // 겹선형
    x = clamp(x, 0, W - 1.001); y = clamp(y, 0, H - 1.001); const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
    for (let k = 0; k < 4; k++) d[j + k] = (src[i00 + k] * (1 - fx) + src[i10 + k] * fx) * (1 - fy) + (src[i01 + k] * (1 - fx) + src[i11 + k] * fx) * fy;
  };
  // 인물 층은 알파를 곱한 색으로 섞어야 가장자리에 원래 배경색이 묻어나지 않아요
  const fgA = P.mA || (P.mA = (() => { const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) { const m = P.m[i]; a[i * 4] = P.px[i * 4] * m; a[i * 4 + 1] = P.px[i * 4 + 1] * m; a[i * 4 + 2] = P.px[i * 4 + 2] * m; a[i * 4 + 3] = m * 255; } return a; })());
  const tmp = new Uint8ClampedArray(4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = i * 4, ux = cx + (x - cx) / mg, uy = cy + (y - cy) / mg;
    // 배경 층
    const db = P.Dbg[i] - piv, zb = 1 + z * 0.08 * (o.amt / 50) * (0.4 + P.Dbg[i]);
    samp(P.bg, cx + (ux - cx) / zb - ax * A * db, cy + (uy - cy) / zb - ay * A * db, j);
    // 인물 층 (위에 얹기)
    const df = P.Dfg[i] - piv, zf = 1 + z * 0.08 * (o.amt / 50) * (0.4 + P.Dfg[i]);
    const sx = cx + (ux - cx) / zf - ax * A * df, sy = cy + (uy - cy) / zf - ay * A * df;
    const R = d[j], G = d[j + 1], B = d[j + 2]; samp(fgA, sx, sy, j);
    const a = d[j + 3] / 255; d[j] = d[j] + R * (1 - a); d[j + 1] = d[j + 1] + G * (1 - a); d[j + 2] = d[j + 2] + B * (1 - a); d[j + 3] = 255;
  }
  return out;
}

/* ---- 창: 거리에 따라 흐리게 (이미지 편집) ---- */
async function dpOpenDof() {
  const pg = page(), B = baseEl(pg), o = aiImg(B);
  if (!isImg() || pg.ph || !o) { toast('이미지 편집에서 그림을 연 뒤 써 주세요'); return; }
  if (!(await aiReady('depth'))) return;
  const tk = czProgress('깊이를 재는 중');
  let D, subj = null, by = 'depth';
  const k = Math.min(1, 900 / Math.max(o.W, o.H)), w = Math.round(o.W * k), h = Math.round(o.H * k); // 미리보기는 작게
  try {
    tk.set('깊이 모델 준비하는 중… (처음엔 몇 초 걸려요)', 0.05);
    D = await dpDepth(o.im, w, h, o.rec.id + '@pv', tk); if (tk.stop) throw new Error('stop');
    tk.set('인물을 찾는 중…', 0.6);
    const s = await dpSubject(o.im, w, h, D, tk); if (s.by === 'isnet') { subj = s.m; by = 'isnet'; }
    tk.done();
  } catch (e) { tk.done(); if (String(e && e.message) !== 'stop') toast('깊이를 재지 못했어요. ' + czErrText(e), 5000); return; }
  let ps = 0, pn = 0; const ot = dpOtsu(D); for (let i = 0; i < D.length; i++) if ((subj ? subj[i] > 0.5 : D[i] > ot)) { ps += D[i]; pn++; }
  const st = { focus: pn ? ps / pn : 0.7, band: 0.06, amt: 50, front: false, useSubj: !!subj, view: 'fx' };
  const m = modal(`<h2>거리에 따라 흐리게</h2><p class="sub">AI가 잰 거리대로 멀수록 더 흐리게 해요. 그림을 누르면 그곳에 초점을 맞춰요.</p>
    <div style="display:flex;justify-content:center;background:var(--side);border-radius:8px;overflow:hidden"><canvas id="dpCv" style="max-width:100%;max-height:58vh;cursor:crosshair"></canvas></div>
    <div class="grid2" style="margin-top:10px">
      <span>흐림 세기</span><span><input type="range" min="5" max="100" step="1" value="${st.amt}" data-dp="amt"></span>
      <span>초점 폭</span><span><input type="range" min="0" max="0.3" step="0.01" value="${st.band}" data-dp="band" title="넓을수록 초점 둘레가 더 많이 또렷해요"></span>
      <span>초점</span><span class="seg">${subj ? `<button class="btn sm ${st.useSubj ? 'on' : ''}" data-dpf="subj" title="인물 윤곽 그대로 또렷하게 (배경 지우기 팩)">인물</button>` : ''}<button class="btn sm ${st.useSubj ? '' : 'on'}" data-dpf="pt">누른 곳 거리</button></span>
      <span></span><span><label class="chk"><input type="checkbox" data-dp="front"> 초점보다 가까운 것도 흐리게</label></span>
      <span>보기</span><span class="seg"><button class="btn sm on" data-dpv="fx">결과</button><button class="btn sm" data-dpv="d">거리 지도</button><button class="btn sm" data-dpv="o">원래 그림</button></span>
    </div>
    <p class="muted small">${by === 'isnet' ? '인물 윤곽은 배경 지우기 팩으로 땄어요.' : '배경 지우기 팩을 받아 두면 인물 윤곽이 더 깔끔해요.'} 결과는 바탕 그림 위에 새 레이어 '거리 흐림'으로 들어가요.</p>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="dpGo">적용</button></div>`, { wide: true });
  const cv = $('#dpCv', m); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  let T = 0;
  const draw = () => {
    if (!m.isConnected) return;
    if (st.view === 'o') { g.drawImage(o.im, 0, 0, w, h); return; }
    if (st.view === 'd') { const id = g.createImageData(w, h); for (let i = 0; i < D.length; i++) { const v = D[i] * 255; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); return; }
    g.drawImage(dpDof(o.im, w, h, D, { ...st, subj: st.useSubj ? subj : null }), 0, 0);
  };
  const soon = () => { clearTimeout(T); T = setTimeout(draw, 60); };
  draw();
  $$('[data-dp]', m).forEach(x => x.addEventListener('input', () => { st[x.dataset.dp] = x.type === 'checkbox' ? x.checked : +x.value; soon(); }));
  $$('[data-dpv]', m).forEach(b => b.addEventListener('click', () => { st.view = b.dataset.dpv; $$('[data-dpv]', m).forEach(x => x.classList.toggle('on', x === b)); draw(); }));
  $$('[data-dpf]', m).forEach(b => b.addEventListener('click', () => { st.useSubj = b.dataset.dpf === 'subj'; $$('[data-dpf]', m).forEach(x => x.classList.toggle('on', x === b)); draw(); }));
  cv.addEventListener('click', e => { const r = cv.getBoundingClientRect(), x = Math.round((e.clientX - r.left) / r.width * w), y = Math.round((e.clientY - r.top) / r.height * h); st.focus = D[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)]; st.useSubj = false; $$('[data-dpf]', m).forEach(b => b.classList.toggle('on', b.dataset.dpf === 'pt')); draw(); });
  $('#dpGo', m).addEventListener('click', async () => {
    closeModal(); const t2 = czProgress('거리에 따라 흐리게 하는 중');
    try {
      const W = o.W, H = o.H, k2 = Math.min(1, 2400 / Math.max(W, H)), FW = Math.round(W * k2), FH = Math.round(H * k2);
      const DF = await dpDepth(o.im, FW, FH, o.rec.id, t2); if (t2.stop) throw new Error('stop');
      let sF = null; if (st.useSubj) { t2.set('인물을 찾는 중…', 0.5); sF = (await dpSubject(o.im, FW, FH, DF, t2)).m; }
      t2.set('흐리게 하는 중…', 0.8); await new Promise(r => setTimeout(r, 30));
      const c = dpDof(o.im, FW, FH, DF, { ...st, subj: sF });
      const src = c.toDataURL('image/png'), im = await loadImg(src);
      const nr = { id: uid(), name: '거리 흐림.png', src, w: FW, h: FH, kind: 'stamp' }; addImageRecord(nr, true, im);
      const P = makePanel(B.x + B.w / 2, B.y + B.h / 2, B.w, B.h, nr.id); P.bw = 0; P.radius = 0; P.name = '거리 흐림'; if (B.rot) P.rot = B.rot; if (B.flip) P.flip = B.flip;
      pg.els.splice(pg.els.indexOf(B) + 1, 0, P); sel = [P.id];
      t2.done(); e2SetHint('거리 흐림'); commit(); renderProps(); renderLayersSoon(); requestRender();
      toast("새 레이어 '거리 흐림'으로 넣었어요. 마음에 안 들면 Ctrl+Z", 3200);
    } catch (e) { t2.done(); if (String(e && e.message) !== 'stop') toast('흐리게 하지 못했어요. ' + czErrText(e), 5000); }
  });
}

/* ---- 창: 입체 움짤 (이미지 편집의 그림, 또는 움짤 장면) ---- */
// from: {src(그림), W, H, key, name, onDone(frames, fps)}
async function dpOpenPara(from) {
  if (!(await aiReady('depth'))) return;
  const st = { move: 'orbit', amt: 50, base: 'subj', secs: 2, fps: 15, size: Math.min(720, Math.max(from.W, from.H)) };
  const dims = sz => { const k = Math.min(1, sz / Math.max(from.W, from.H)); return [Math.max(2, Math.round(from.W * k)), Math.max(2, Math.round(from.H * k))]; };
  const [pw, ph] = dims(st.size); // 저장할 크기로 한 번만 준비하고, 미리보기도 그걸로
  const tk = czProgress('입체 움짤 준비하는 중'); let P;
  try { tk.set('깊이 모델 준비하는 중… (처음엔 몇 초 걸려요)', 0.05); P = await dpPrepare(from.src, pw, ph, null, tk); tk.done(); }
  catch (e) { tk.done(); if (String(e && e.message) !== 'stop') toast('준비하지 못했어요. ' + czErrText(e), 5000); return; }
  const m = modal(`<h2>입체 움짤 만들기</h2><p class="sub">그림 한 장을 AI가 잰 거리대로 앞뒤로 나눠, 카메라가 살짝 움직이는 것처럼 만들어요.</p>
    <div style="display:flex;justify-content:center;background:var(--side);border-radius:8px;overflow:hidden"><canvas id="ppCv" style="max-width:100%;max-height:52vh"></canvas></div>
    <div class="grid2" style="margin-top:10px">
      <span>움직임</span><span class="seg">${[['orbit', '빙글'], ['sway', '좌우'], ['nod', '위아래'], ['zoom', '다가가기']].map(([k, l]) => `<button class="btn sm ${k === st.move ? 'on' : ''}" data-ppm="${k}">${l}</button>`).join('')}</span>
      <span>세기</span><span><input type="range" min="10" max="100" step="1" value="${st.amt}" data-pp="amt"></span>
      <span>기준</span><span class="seg"><button class="btn sm on" data-ppb="subj" title="인물은 거의 그대로, 배경이 움직여요">인물 고정</button><button class="btn sm" data-ppb="bg" title="배경은 거의 그대로, 인물이 움직여요">배경 고정</button></span>
      <span>길이·초당 장</span><span><select data-pp="secs">${[1.5, 2, 3, 4].map(v => `<option value="${v}" ${v === st.secs ? 'selected' : ''}>${v}초</option>`).join('')}</select> <select data-pp="fps">${[10, 12, 15, 20, 24].map(v => `<option value="${v}" ${v === st.fps ? 'selected' : ''}>${v}장</option>`).join('')}</select></span>
      <span>크기 (긴 쪽)</span><span><select data-pp="size">${[360, 480, 640, 720, 960, 1080].filter(v => v <= Math.max(from.W, from.H) || v === 360).map(v => `<option value="${v}" ${v === st.size ? 'selected' : ''}>${v}px</option>`).join('')}</select></span>
    </div>
    <p class="muted small">${/isnet/.test(P.by) ? '인물 윤곽은 배경 지우기 팩으로 땄어요.' : '배경 지우기 팩이 있으면 인물 윤곽이 더 깔끔해요.'} ${/lama/.test(P.by) ? '인물 뒤는 AI 지우개로 메웠어요.' : 'AI 지우개 팩이 있으면 인물 뒤 배경이 더 자연스러워요.'} 세기가 너무 크면 가장자리가 늘어나 보여요.</p>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="ppGo">${from.goLabel || '움짤로 만들기'}</button></div>`, { wide: true });
  const cv = $('#ppCv', m); cv.width = pw; cv.height = ph; const g = cv.getContext('2d'), buf = g.createImageData(pw, ph);
  let raf = 0, t0 = performance.now();
  let last = 0;
  const loop = now => { if (!m.isConnected) return; raf = requestAnimationFrame(loop); if (now - last < 1000 / st.fps - 2) return; last = now; const t = ((now - t0) / 1000 / st.secs) % 1; dpFrame(P, t, st, buf); g.putImageData(buf, 0, 0); };
  raf = requestAnimationFrame(loop);
  $$('[data-pp]', m).forEach(x => x.addEventListener('input', () => { st[x.dataset.pp] = +x.value; }));
  $$('[data-ppm]', m).forEach(b => b.addEventListener('click', () => { st.move = b.dataset.ppm; $$('[data-ppm]', m).forEach(x => x.classList.toggle('on', x === b)); }));
  $$('[data-ppb]', m).forEach(b => b.addEventListener('click', () => { st.base = b.dataset.ppb; $$('[data-ppb]', m).forEach(x => x.classList.toggle('on', x === b)); }));
  $('#ppGo', m).addEventListener('click', async () => {
    cancelAnimationFrame(raf); closeModal();
    const t2 = czProgress('입체 움짤 만드는 중');
    try {
      const [W, H] = dims(st.size);
      const Q = W === P.W && H === P.H ? P : await dpPrepare(from.src, W, H, null, t2); if (t2.stop) throw new Error('stop');
      const N = Math.max(2, Math.round(st.secs * st.fps)), frames = [], img = new ImageData(W, H);
      for (let f = 0; f < N; f++) {
        if (t2.stop) throw new Error('stop');
        dpFrame(Q, f / N, st, img); const c = newCanvas(W, H); c.getContext('2d').putImageData(img, 0, 0); frames.push(c);
        t2.set(`장면 그리는 중… ${f + 1} / ${N}`, 0.6 + 0.4 * (f + 1) / N); if (f % 3 === 2) await new Promise(r => setTimeout(r, 0));
      }
      t2.done(); await from.onDone(frames, st.fps);
    } catch (e) { t2.done(); if (String(e && e.message) !== 'stop') toast('만들지 못했어요. ' + czErrText(e), 5000); }
  });
}
// 이미지 편집: 지금 그림 → 움짤 탭에 새 장면들로
function dpParaFromImage() {
  const pg = page(), B = baseEl(pg), o = aiImg(B);
  if (!isImg() || pg.ph || !o) { toast('이미지 편집에서 그림을 연 뒤 써 주세요'); return; }
  const c = newCanvas(Math.round(pg.w), Math.round(pg.h)); drawPage(c.getContext('2d'), pg, { screen: false, rs: 1, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } }); // 보이는 그대로 (글자·보정 포함)
  dpOpenPara({ src: c, W: c.width, H: c.height, key: null, name: pg.name, onDone: async (frames, fps) => {
    await pjOpenGif();
    const clip = 'c' + uid(); let n = 0;
    for (let i = 0; i < frames.length; i++) if (gsAddBitmap(frames[i], (pg.name || '그림').replace(/\.[^.]+$/, '') + ' 입체', { dur: Math.round(1000 / fps) / 1000, motion: 'none', tr: i ? 'none' : null, fit: 'contain', clip })) n++;
    gs.sel = Math.max(0, gs.slides.length - n); gsChanged(); toast(`입체 움짤 ${n}장을 움짤 탭에 넣었어요`);
  } });
}
// 움짤: 고른 장면 → 그 자리를 입체 움직임 장면들로 바꾸기
function dpParaFromScene() {
  const s = gs.slides[gs.sel]; if (!s) return;
  dpOpenPara({ src: s.bmp, W: s.bmp.width, H: s.bmp.height, key: null, name: s.name, goLabel: '이 장면을 바꾸기', onDone: async (frames, fps) => {
    const i = gs.slides.indexOf(s); if (i < 0) return; const clip = 'c' + uid();
    const add = frames.map((c, k) => ({ ...s, id: uid(), bmp: c, w: c.width, h: c.height, dur: Math.round(1000 / fps) / 1000, motion: 'none', tr: k === frames.length - 1 ? s.tr : 'none', clip }));
    gs.slides.splice(i, 1, ...add); gs.sel = i; gs.pick = new Set(); gsChanged(); toast(`장면을 입체 움직임 ${add.length}장으로 바꿨어요. 되돌리려면 장면을 지우고 다시 넣어 주세요`, 4000);
  } });
}
