// AI 실행기: 모델을 일꾼(worker)에서 돌려요. 그림은 이 컴퓨터 안에서만 처리해요.
// 그래픽카드(WebGPU)가 되면 그쪽으로, 안 되면 CPU로 알아서 돌아요.
import { packBytes } from './packs.js';
import { emit } from './store.js';
import { settings } from './settings.js';

function workerMain() {
  let ort = null, ep = 'wasm';
  const S = {}, B = {}, K = {};
  const make = (key, gpu) => ort.InferenceSession.create(B[key], { executionProviders: [gpu ? 'webgpu' : 'wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  self.onmessage = async e => {
    const m = e.data, reply = (o, tr) => self.postMessage(Object.assign({ id: m.id, ok: true }, o), tr || []);
    try {
      if (m.t === 'init') {
        ort = self.ort; if (!ort) throw new Error('ort');
        ort.env.wasm.wasmBinary = m.wasm; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false; ort.env.logLevel = 'error';
        if (m.device !== 'cpu' && self.navigator && navigator.gpu) {
          try { const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (ad && !ad.isFallbackAdapter && !(ad.info && ad.info.isFallbackAdapter)) ep = 'webgpu'; } catch (_) { /* CPU로 */ }
        }
        reply({ ep });
      } else if (m.t === 'load') {
        B[m.key] = m.bytes;
        if (ep === 'webgpu') { try { S[m.key] = await make(m.key, true); S[m.key].gpu = true; } catch (_) { S[m.key] = null; } }
        if (!S[m.key]) S[m.key] = await make(m.key, false);
        reply({ ep: S[m.key].gpu ? 'webgpu' : 'wasm' });
      } else if (m.t === 'run') {
        const run = async () => { const s = S[m.key], out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', m.data, m.dims) }), y = out[s.outputNames[0]]; return { d: new Float32Array(y.data), dims: y.dims }; };
        let r;
        try { r = await run(); } catch (err) { if (!S[m.key] || !S[m.key].gpu) throw err; S[m.key] = await make(m.key, false); r = await run(); }   // 그래픽카드에서 안 되면 CPU로
        reply({ data: r.d, dims: r.dims, ep: S[m.key].gpu ? 'webgpu' : 'wasm' }, [r.d.buffer]);
      } else if (m.t === 'run2' && S[m.key] && S[m.key].inputNames.includes('pixel_values') && m.feeds.input_image) {
        // 큰 윤곽 모델(SAM 2.1): 부르는 쪽은 그대로 두고 여기서 모양만 맞춰요. 그림을 1024×1024로 맞추고 색을 고르게 한 뒤 읽혀요
        const v = m.feeds.input_image, th = v.dims[0], tw = v.dims[1], src = v.data, N = 1024, x = new Float32Array(3 * N * N), mean = [123.675, 116.28, 103.53], std = [58.395, 57.12, 57.375];
        for (let y = 0; y < N; y++) { const fy = Math.min(th - 1, Math.max(0, (y + 0.5) * th / N - 0.5)), y0 = fy | 0, y1 = Math.min(th - 1, y0 + 1), wy = fy - y0;
          for (let xx = 0; xx < N; xx++) { const fx = Math.min(tw - 1, Math.max(0, (xx + 0.5) * tw / N - 0.5)), x0 = fx | 0, x1 = Math.min(tw - 1, x0 + 1), wx = fx - x0, a = (y0 * tw + x0) * 3, b2 = (y0 * tw + x1) * 3, c = (y1 * tw + x0) * 3, d = (y1 * tw + x1) * 3;
            for (let k = 0; k < 3; k++) x[k * N * N + y * N + xx] = ((src[a + k] * (1 - wx) + src[b2 + k] * wx) * (1 - wy) + (src[c + k] * (1 - wx) + src[d + k] * wx) * wy - mean[k]) / std[k]; } }
        const feeds = { pixel_values: new ort.Tensor('float32', x, [1, 3, N, N]) }; let out;
        try { out = await S[m.key].run(feeds); } catch (err) { if (!S[m.key].gpu) throw err; S[m.key] = await make(m.key, false); out = await S[m.key].run(feeds); }
        for (const k of ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2']) K[k] = new ort.Tensor('float32', new Float32Array(out[k].data), out[k].dims);
        K.s2 = { tw, th }; reply({ out: {}, ep: S[m.key].gpu ? 'webgpu' : 'wasm' });
      } else if (m.t === 'run2' && S[m.key] && S[m.key].inputNames.includes('input_points') && m.feeds.point_coords) {
        const { tw, th } = K.s2, pc = m.feeds.point_coords.data, pl = m.feeds.point_labels.data, P = [], Lb = [];
        for (let i = 0; i < pl.length; i++) if (pl[i] >= 0) { P.push(pc[i * 2] * 1024 / tw, pc[i * 2 + 1] * 1024 / th); Lb.push(BigInt(Math.round(pl[i]))); }
        const feeds = { input_points: new ort.Tensor('float32', Float32Array.from(P), [1, 1, Lb.length, 2]), input_labels: new ort.Tensor('int64', BigInt64Array.from(Lb), [1, 1, Lb.length]), input_boxes: new ort.Tensor('float32', new Float32Array(0), [1, 0, 4]),
          'image_embeddings.0': K['image_embeddings.0'], 'image_embeddings.1': K['image_embeddings.1'], 'image_embeddings.2': K['image_embeddings.2'] };
        let out;
        try { out = await S[m.key].run(feeds); } catch (err) { if (!S[m.key].gpu) throw err; S[m.key] = await make(m.key, false); out = await S[m.key].run(feeds); }
        // 후보 3개를 그림 크기로 키워서 돌려줘요. 맨 앞(0번)에는 점수가 가장 높은 것을 한 번 더 둬요 (작은 모델과 차례를 맞추려고)
        const pm = out.pred_masks, mw = pm.dims[pm.dims.length - 1], mh = pm.dims[pm.dims.length - 2], lo = pm.data, sc = out.iou_scores.data, n = tw * th, masks = new Float32Array(4 * n);
        let top = 0; for (let k = 1; k < 3; k++) if (sc[k] > sc[top]) top = k;
        for (let k = 0; k < 3; k++) { const o = (k + 1) * n, q = k * mw * mh;
          for (let y = 0; y < th; y++) { const fy = Math.min(mh - 1, Math.max(0, (y + 0.5) * mh / th - 0.5)), y0 = fy | 0, y1 = Math.min(mh - 1, y0 + 1), wy = fy - y0;
            for (let xx = 0; xx < tw; xx++) { const fx = Math.min(mw - 1, Math.max(0, (xx + 0.5) * mw / tw - 0.5)), x0 = fx | 0, x1 = Math.min(mw - 1, x0 + 1), wx = fx - x0;
              masks[o + y * tw + xx] = (lo[q + y0 * mw + x0] * (1 - wx) + lo[q + y0 * mw + x1] * wx) * (1 - wy) + (lo[q + y1 * mw + x0] * (1 - wx) + lo[q + y1 * mw + x1] * wx) * wy; } } }
        masks.copyWithin(0, (top + 1) * n, (top + 2) * n);
        const iou = new Float32Array([sc[top], sc[0], sc[1], sc[2]]), res = { masks: { data: masks, dims: [1, 4, th, tw] }, iou_predictions: { data: iou, dims: [1, 4] } };
        reply({ out: res, ep: S[m.key].gpu ? 'webgpu' : 'wasm' }, [masks.buffer, iou.buffer]);
      } else if (m.t === 'run2') {   // 입력·출력이 여러 개인 모델. keep: 다음에 쓸 결과를 일꾼 안에 보관, ref: 보관한 결과를 입력으로
        const feeds = {};
        for (const [k, v] of Object.entries(m.feeds)) feeds[k] = v.ref ? K[v.ref] : new ort.Tensor('float32', v.data, v.dims);
        let out;
        try { out = await S[m.key].run(feeds); } catch (err) { if (!S[m.key] || !S[m.key].gpu) throw err; S[m.key] = await make(m.key, false); out = await S[m.key].run(feeds); }
        for (const k of m.keep || []) K[k] = new ort.Tensor('float32', new Float32Array(out[k].data), out[k].dims);
        const res = {}, tr = [];
        for (const k of m.outs || []) { const d = new Float32Array(out[k].data); res[k] = { data: d, dims: out[k].dims }; tr.push(d.buffer); }
        reply({ out: res, ep: S[m.key].gpu ? 'webgpu' : 'wasm' }, tr);
      }
    } catch (err) { self.postMessage({ id: m.id, ok: false, err: String((err && err.message) || err) }); }
  };
}

const A = { w: null, ready: null, seq: 0, wait: new Map(), loaded: {}, ep: '', q: Promise.resolve() };
function call(msg, tr) {   // 한 번에 하나씩 차례로
  const send = () => new Promise((res, rej) => { if (!A.w) return rej(new Error('worker')); const id = ++A.seq; A.wait.set(id, { res, rej }); A.w.postMessage(Object.assign({ id }, msg), tr || []); });
  const p = A.q.then(send, send); A.q = p.catch(() => {}); return p;
}
function reset(err) {
  if (A.w) { try { A.w.terminate(); } catch (_) { /* 이미 끝남 */ } }
  for (const p of A.wait.values()) p.rej(err || new Error('reset'));
  A.w = null; A.ready = null; A.loaded = {}; A.wait.clear(); A.ep = ''; A.q = Promise.resolve(); samState.samEnc = ''; samState.samQ = Promise.resolve();
}
function init() {
  if (A.ready) return A.ready;
  A.ready = (async () => {
    const el = document.getElementById('ortJs'); if (!el || !el.textContent) throw new Error('이 판에는 AI 실행 도구가 들어 있지 않아요');
    const url = URL.createObjectURL(new Blob([el.textContent, `\n(${workerMain.toString()})();`], { type: 'text/javascript' }));
    const w = new Worker(url, { name: 'potato-ai' });
    w.onmessage = e => { const m = e.data, p = A.wait.get(m.id); if (!p) return; A.wait.delete(m.id); m.ok ? p.res(m) : p.rej(new Error(m.err)); };
    w.onerror = e => { e.preventDefault(); reset(new Error(e.message || 'worker')); };
    A.w = w;
    const wasm = await packBytes('czWasm');
    A.ep = (await call({ t: 'init', wasm, device: 'auto' }, [wasm])).ep;
  })();
  A.ready.catch(err => { if (A.ready) reset(err); });
  return A.ready;
}
export function aiLoad(key) {
  if (!A.loaded[key]) {
    const p = A.loaded[key] = (async () => { await init(); const b = await packBytes(fileIdOf(key)); A.ep = (await call({ t: 'load', key, bytes: b }, [b])).ep; })();
    p.catch(() => { if (A.loaded[key] === p) delete A.loaded[key]; });
  }
  return A.loaded[key];
}
// 윤곽 모델: 설정에서 '정밀하게'를 고르면 큰 모델(SAM 2.1)을 같은 이름(samE·samD)으로 올려요. 바꾸면 올려 둔 것을 내려요
export const samBig = () => settings.get('samModel') === 'big';
export const fileIdOf = key => 'czM_' + (samBig() && (key === 'samE' || key === 'samD') ? (key === 'samE' ? 'sam2E' : 'sam2D') : key);
export const samIds = () => [fileIdOf('samE'), fileIdOf('samD')];
export const aiRun = (key, data, dims) => call({ t: 'run', key, data, dims }, [data.buffer]);
export const aiCall = (msg, tr) => call(msg, tr);
// 윤곽 AI(SAM)가 지금 어떤 그림을 읽어 두었는지. 캐릭터 움직이기와 'AI로 고르기'가 같이 써요
export const samState = { samEnc: '', samQ: Promise.resolve() };
export const aiDevice = () => A.ep === 'webgpu' ? '그래픽카드' : A.ep === 'wasm' ? 'CPU' : '';
export const aiReset = reset;

// ---- 작업 줄: 오래 걸리는 AI 일을 한곳에서 보여 줘요 ----
export const jobs = [];
export async function runJob(title, fn) {
  const job = { id: Date.now() + Math.random(), title, text: '준비하는 중', p: 0, stop: false, state: 'run' };
  jobs.unshift(job); if (jobs.length > 12) jobs.length = 12; emit();
  const say = (text, p) => { if (text != null) job.text = text; if (p != null) job.p = p; emit(); };
  try { const r = await fn(job, say); job.state = 'done'; job.text = '끝났어요'; job.p = 1; emit(); return r; }
  catch (e) { job.state = job.stop ? 'stop' : 'err'; job.text = job.stop ? '멈췄어요' : (e.message || '실패했어요'); emit(); if (!job.stop) throw e; return null; }
}
export const check = job => { if (job.stop) throw new Error('stop'); };

// ---- 모델들 ----
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
// 캐릭터 가림막(인물 = 흰색, 그림 크기 캔버스) — skytnt/anime-seg ISNet, 1024×1024 안에 비율 그대로
export async function charMask(src, job, say) {
  say && say('모델을 불러오는 중'); await aiLoad('isnet'); job && check(job);
  const W = src.width, H = src.height, S = 1024, r = S / Math.max(W, H), w = Math.max(1, Math.round(W * r)), h = Math.max(1, Math.round(H * r)), px = (S - w) >> 1, py = (S - h) >> 1;
  const c = mk(S, S), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.imageSmoothingQuality = 'high'; g.drawImage(src, px, py, w, h);
  const d = g.getImageData(0, 0, S, S).data, x = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) { x[i] = d[i * 4] / 255; x[S * S + i] = d[i * 4 + 1] / 255; x[2 * S * S + i] = d[i * 4 + 2] / 255; }
  say && say(`인물을 찾는 중 (${aiDevice() || 'AI'})`, 0.3);
  const out = await aiRun('isnet', x, [1, 3, S, S]); job && check(job);
  const m = mk(w, h), gm = m.getContext('2d'), md = gm.createImageData(w, h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { let v = Math.min(1, Math.max(0, out.data[(yy + py) * S + xx + px])) * 255; v = v < 12 ? 0 : v > 243 ? 255 : v; const o = (yy * w + xx) * 4; md.data[o] = md.data[o + 1] = md.data[o + 2] = 255; md.data[o + 3] = v; }
  gm.putImageData(md, 0, 0);
  const M = mk(W, H), gM = M.getContext('2d'); gM.imageSmoothingQuality = 'high'; gM.drawImage(m, 0, 0, W, H);
  return M;
}
// 화질 키우기: Real-ESRGAN 애니(4배)를 조각조각 돌리고, 2배면 줄여요. model = 'sr4'(빠르게) | 'sr6'(고화질)
export async function upscale(src, scale, model, job, say) {
  say && say('모델을 불러오는 중'); await aiLoad(model); job && check(job);
  const W = src.width, H = src.height, F = 4, OW = W * F, OH = H * F;
  if (OW * OH > 42e6) throw new Error('그림이 너무 커요. 4배로 키운 크기가 4천만 화소를 넘으면 처리할 수 없어요.');
  const sc = mk(W, H), sg = sc.getContext('2d', { willReadFrequently: true }); sg.drawImage(src, 0, 0);
  const sd = sg.getImageData(0, 0, W, H).data, out = new ImageData(OW, OH), od = out.data;
  const T = A.ep === 'webgpu' ? 256 : 128, O = 10, tiles = [];
  for (let y = 0; y < H; y += T) for (let x = 0; x < W; x += T) tiles.push([x, y]);
  for (let k = 0; k < tiles.length; k++) {
    job && check(job);
    const [x0, y0] = tiles[k], ax = Math.max(0, x0 - O), ay = Math.max(0, y0 - O), bx = Math.min(W, x0 + T + O), by = Math.min(H, y0 + T + O), tw = bx - ax, th = by - ay, n = tw * th;
    const inp = new Float32Array(3 * n);
    for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) { const s = ((ay + yy) * W + ax + xx) * 4, j = yy * tw + xx; inp[j] = sd[s] / 255; inp[n + j] = sd[s + 1] / 255; inp[2 * n + j] = sd[s + 2] / 255; }
    const r = await aiRun(model, inp, [1, 3, th, tw]);
    const RW = tw * F, RN = RW * th * F, cx0 = (x0 - ax) * F, cy0 = (y0 - ay) * F, cx1 = (Math.min(W, x0 + T) - ax) * F, cy1 = (Math.min(H, y0 + T) - ay) * F;
    for (let yy = cy0; yy < cy1; yy++) for (let xx = cx0; xx < cx1; xx++) { const j = yy * RW + xx, o2 = ((ay * F + yy) * OW + ax * F + xx) * 4; od[o2] = r.data[j] * 255; od[o2 + 1] = r.data[RN + j] * 255; od[o2 + 2] = r.data[2 * RN + j] * 255; od[o2 + 3] = 255; }
    say && say(`화질을 키우는 중 ${k + 1} / ${tiles.length} (${aiDevice()})`, (k + 1) / tiles.length);
  }
  let c = mk(OW, OH); const g = c.getContext('2d'); g.putImageData(out, 0, 0);
  g.globalCompositeOperation = 'destination-in'; g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, OW, OH);   // 투명한 곳은 투명하게
  if (scale !== 4) { const c2 = mk(Math.round(W * scale), Math.round(H * scale)), g2 = c2.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(c, 0, 0, c2.width, c2.height); c = c2; }
  return c;
}

// AI로 고르기: 그림을 윤곽 AI(MobileSAM)에 한 번 읽혀 두고(key가 같으면 다시 안 읽음), 점·상자로 물어봐요.
//   pts = [[x, y, 1(이것) | 0(아님)]…], box = [x0, y0, x1, y1] (그림 좌표) → 가림막 캔버스(그림 크기)
// 인물별로 나누기: 애니 인물 찾기 모델(CartoonSegmentation의 RTMDet, MIT)이 사람마다 대강의 자리를 찾고,
// 인물 윤곽(isnet) 안의 점마다 가장 그럴듯한 사람에게 나눠 줘요. 두 명 이상 못 찾으면 빈 목록
export async function peopleMasks(src, job, say) {
  say && say('모델을 불러오는 중'); await aiLoad('people'); job && check(job);
  const W = src.width, H = src.height, S = 640, s = S / Math.max(W, H), tw = Math.max(1, Math.round(W * s)), th = Math.max(1, Math.round(H * s));
  const c = mk(S, S), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, S, S); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, tw, th);
  const d = g.getImageData(0, 0, S, S).data, x = new Float32Array(3 * S * S), n = S * S;
  for (let i = 0; i < n; i++) { x[i] = (d[i * 4 + 2] - 103.53) / 57.375; x[n + i] = (d[i * 4 + 1] - 116.28) / 57.12; x[2 * n + i] = (d[i * 4] - 123.675) / 58.395; }
  say && say(`인물을 세는 중 (${aiDevice() || 'AI'})`, 0.3);
  const r = await aiCall({ t: 'run2', key: 'people', feeds: { image: { data: x, dims: [1, 3, S, S] } }, outs: ['scores', 'boxes', 'kernels', 'mask_feat'] }, [x.buffer]); job && check(job);
  const sc = r.out.scores.data, bx = r.out.boxes.data, kr = r.out.kernels.data, mf = r.out.mask_feat.data, P = [];
  for (const st of [8, 16, 32]) { const m = S / st; for (let y = 0; y < m; y++) for (let xx = 0; xx < m; xx++) P.push([xx * st, y * st, st]); }
  const cand = []; for (let i = 0; i < P.length; i++) if (sc[i] > 0.2) cand.push(i);   // 이보다 자신 없는 것은 엉뚱하게 나누는 일이 많았어요 cand.sort((a, b) => sc[b] - sc[a]);
  const boxOf = i => [P[i][0] - bx[i * 4], P[i][1] - bx[i * 4 + 1], P[i][0] + bx[i * 4 + 2], P[i][1] + bx[i * 4 + 3]];
  const iou = (a, b) => { const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), it = iw * ih; return it / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - it + 1e-6); };
  let keep = []; for (const i of cand.slice(0, 60)) { const b = boxOf(i); if (keep.every(k => iou(b, k.box) < 0.6)) keep.push({ i, box: b, score: sc[i] }); if (keep.length >= 6) break; }
  // 사람마다 80×80 대강 그림: 그 사람만의 작은 거름막 3겹(10→8→8→1)을 특징 그림에 씌워요
  const G = 80, gh = Math.ceil(th / 8), gw = Math.ceil(tw / 8);
  for (const k of keep) {
    const o = k.i * 169, [px, py, st] = P[k.i], lo = k.lo = new Float32Array(G * G), h1 = new Float32Array(8), h2 = new Float32Array(8); let area = 0;
    for (let y = 0; y < G; y++) for (let xx = 0; xx < G; xx++) { const q = y * G + xx, rx = (px - xx * 8) / (st * 8), ry = (py - y * 8) / (st * 8);
      for (let a = 0; a < 8; a++) { let v = kr[o + 152 + a] + kr[o + a * 10] * rx + kr[o + a * 10 + 1] * ry; for (let b = 0; b < 8; b++) v += kr[o + a * 10 + 2 + b] * mf[b * G * G + q]; h1[a] = v > 0 ? v : 0; }
      for (let a = 0; a < 8; a++) { let v = kr[o + 160 + a]; for (let b = 0; b < 8; b++) v += kr[o + 80 + a * 8 + b] * h1[b]; h2[a] = v > 0 ? v : 0; }
      let v = kr[o + 168]; for (let b = 0; b < 8; b++) v += kr[o + 144 + b] * h2[b]; lo[q] = v; if (v > 0 && y < gh && xx < gw) area++; }
    k.area = area;
  }
  keep = keep.filter(k => k.area > 6);
  // 두 사람을 한 덩어리로 본 것은, 그 안을 나눠 가진 둘이 따로 있으면 빼요
  const inside = (a, b) => { let it = 0; for (let q = 0; q < G * G; q++) if (a.lo[q] > 0 && b.lo[q] > 0) it++; return it; };
  keep = keep.filter(A => { const subs = keep.filter(B => B !== A && B.area >= A.area * 0.15 && B.area < A.area * 0.85 && inside(A, B) / B.area >= 0.75); if (subs.length < 2) return true; let cov = 0; for (let q = 0; q < G * G; q++) if (A.lo[q] > 0 && subs.some(B => B.lo[q] > 0)) cov++; return cov / A.area < 0.6; });
  keep = keep.filter((A, ai) => keep.every((B, bi) => bi >= ai || inside(A, B) / Math.min(A.area, B.area) < 0.7));   // 거의 같은 자리를 두 번 센 것
  if (keep.length < 2) return [];
  const ch = await charMask(src, job, say), cd = ch.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const outs = keep.map(() => new ImageData(W, H)), cnt = keep.map(() => 0);
  for (let y = 0; y < H; y++) { const fy = Math.min(G - 1, Math.max(0, (y + 0.5) * s / 8 - 0.5)), y0 = fy | 0, y1 = Math.min(G - 1, y0 + 1), wy = fy - y0;
    for (let xx = 0; xx < W; xx++) { const a = cd[(y * W + xx) * 4 + 3]; if (!a) continue;
      const fx = Math.min(G - 1, Math.max(0, (xx + 0.5) * s / 8 - 0.5)), x0 = fx | 0, x1 = Math.min(G - 1, x0 + 1), wx = fx - x0; let best = 0, bv = -1e9;
      for (let k = 0; k < keep.length; k++) { const lo = keep[k].lo, v = (lo[y0 * G + x0] * (1 - wx) + lo[y0 * G + x1] * wx) * (1 - wy) + (lo[y1 * G + x0] * (1 - wx) + lo[y1 * G + x1] * wx) * wy; if (v > bv) { bv = v; best = k; } }
      const o = (y * W + xx) * 4, t = outs[best].data; t[o] = t[o + 1] = t[o + 2] = 255; t[o + 3] = a; cnt[best]++; } }
  const res = []; keep.forEach((k, i) => { if (cnt[i] < W * H * 0.003) return; const m = mk(W, H); m.getContext('2d').putImageData(outs[i], 0, 0); res.push({ mask: m, score: k.score, x: (k.box[0] + k.box[2]) / 2 / s }); });
  return res.length < 2 ? [] : res.sort((a, b) => a.x - b.x);   // 왼쪽 사람부터
}

// 애니 탐지(deepghs, YOLO): 사람·머리·손의 자리를 상자로 찾아요. 클로즈업이나 엉킨 그림에서도 머리·손은 꽤 잘 찾아요
export const DETECT = { person: { key: 'detP', thr: 0.25 }, head: { key: 'detH', thr: 0.35 }, hand: { key: 'detN', thr: 0.33 } };
export async function detectBoxes(src, kind, job) {
  const D = DETECT[kind]; await aiLoad(D.key); job && check(job);
  const W = src.width, H = src.height, r = Math.min(1, 640 / W, 640 / H), nw = Math.ceil(W * r / 32) * 32, nh = Math.ceil(H * r / 32) * 32;
  const c = mk(nw, nh), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, nw, nh);
  const d = g.getImageData(0, 0, nw, nh).data, n = nw * nh, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { x[i] = d[i * 4] / 255; x[n + i] = d[i * 4 + 1] / 255; x[2 * n + i] = d[i * 4 + 2] / 255; }
  const r2 = await aiCall({ t: 'run2', key: D.key, feeds: { images: { data: x, dims: [1, 3, nh, nw] } }, outs: ['output0'] }, [x.buffer]); job && check(job);
  const o = r2.out.output0, dm = o.dims, v = o.data, sx = W / nw, sy = H / nh, cand = [];
  if (dm[2] === 6) { for (let i = 0; i < dm[1]; i++) { const s = v[i * 6 + 4]; if (s > D.thr) cand.push({ box: [v[i * 6] * sx, v[i * 6 + 1] * sy, v[i * 6 + 2] * sx, v[i * 6 + 3] * sy], score: s }); } }   // 끝까지 다 해 주는 모델 (x0 y0 x1 y1 점수 종류)
  else { const A = dm[2], C = dm[1]; for (let i = 0; i < A; i++) { let s = 0; for (let k = 4; k < C; k++) s = Math.max(s, v[k * A + i]); if (s <= D.thr) continue; const cx = v[i], cy = v[A + i], w = v[2 * A + i], hh = v[3 * A + i]; cand.push({ box: [(cx - w / 2) * sx, (cy - hh / 2) * sy, (cx + w / 2) * sx, (cy + hh / 2) * sy], score: s }); } }
  cand.sort((a, b) => b.score - a.score);
  const iou = (a, b) => { const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), it = iw * ih; return it / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - it + 1e-6); };
  const keep = []; for (const c2 of cand) { if (keep.every(k => iou(k.box, c2.box) < 0.5)) keep.push(c2); if (keep.length >= 12) break; }
  return keep.map(k => ({ ...k, box: [Math.max(0, k.box[0]), Math.max(0, k.box[1]), Math.min(W, k.box[2]), Math.min(H, k.box[3])] }));
}

// 사람별로 나누기 (반자동): 머리·손·사람 상자와 고르게 뿌린 점으로 SAM 조각을 만들고, 겹치면 작은 조각이 이겨요.
// 돌려주는 것: { W, H, alpha(인물 윤곽), lab(점마다 조각 번호, -1은 배경), pieces[{ area, cx, cy }], owner[조각마다 사람 번호], people }
export async function splitPieces(src, job, say) {
  const W0 = src.width, H0 = src.height, k = Math.min(1, 1400 / Math.max(W0, H0)), W = Math.round(W0 * k), H = Math.round(H0 * k), N = W * H;
  const small = mk(W, H); small.getContext('2d').drawImage(src, 0, 0, W, H);
  say && say('인물 윤곽을 따는 중', 0.05); const cm = await charMask(small, job), alpha = new Uint8Array(N);
  { const d = cm.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data; for (let i = 0; i < N; i++) alpha[i] = d[i * 4 + 3]; }
  say && say('사람·머리·손을 찾는 중', 0.15);
  const P = await detectBoxes(small, 'person', job), Hd = await detectBoxes(small, 'head', job), Hn = await detectBoxes(small, 'hand', job);
  // SAM 결과의 점박이를 지워요: 가로세로로 고르게 흐린 뒤 반 넘게 찬 곳만 남겨요
  const R = Math.max(2, Math.round(Math.max(W, H) / 300)), tmp = new Float32Array(N);
  const smooth = u => { for (let y = 0; y < H; y++) { let acc = 0; const o = y * W; for (let x = -R; x < W; x++) { if (x + R < W) acc += u[o + x + R]; if (x - R - 1 >= 0) acc -= u[o + x - R - 1]; if (x >= 0) tmp[o + x] = acc / (Math.min(W - 1, x + R) - Math.max(0, x - R) + 1); } }
    let a = 0; for (let x = 0; x < W; x++) { let acc = 0; for (let y = -R; y < H; y++) { if (y + R < H) acc += tmp[(y + R) * W + x]; if (y - R - 1 >= 0) acc -= tmp[(y - R - 1) * W + x]; if (y >= 0) { const v = acc / (Math.min(H - 1, y + R) - Math.max(0, y - R) + 1) >= 0.5 && alpha[y * W + x] > 64 ? 1 : 0; u[y * W + x] = v; a += v; } } } return a; };
  const key = 'split:' + Math.random(), maskOf = async (pts, box) => { const m = await samMask(small, key, pts, box, job), d = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, u = new Uint8Array(N); for (let i = 0; i < N; i++) if (d[i * 4 + 3] > 127) u[i] = 1; const a = smooth(u); return { u, a }; };
  const raw = []; let done = 0;
  const prompts = [...Hd.map(d => [[], d.box]), ...Hn.map(d => [[], d.box])];
  // 고르게 뿌린 점: 인물 윤곽 안에서 7×6 칸마다 하나
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 7; gx++) { const x = Math.round((gx + 0.5) * W / 7), y = Math.round((gy + 0.5) * H / 6); if (alpha[y * W + x] > 128) prompts.push([[[x, y, 1]], null]); }
  for (const [pts, box] of prompts) { const m = await maskOf(pts, box); if (m.a > N * 0.002 && m.a < N * 0.85) raw.push(m); say && say(`조각을 만드는 중 (${++done}/${prompts.length})`, 0.2 + 0.6 * done / prompts.length); }
  // 사람마다 몸 전체 짐작 (상자로 물어서). 조각 주인을 처음 정할 때만 써요
  const bodies = []; for (const p of P.slice(0, 4)) { const m = await maskOf([], p.box); if (m.a > N * 0.01) bodies.push({ ...m, score: p.score }); }
  say && say('조각을 정리하는 중', 0.85);
  const lab = new Int32Array(N).fill(-1); raw.sort((a, b) => b.a - a.a);
  raw.forEach((m, id) => { for (let i = 0; i < N; i++) if (m.u[i]) lab[i] = id; });
  // 아무 조각에도 안 든 인물 자리: 이어진 덩어리마다 새 조각
  let next = raw.length; const q = new Int32Array(N);
  for (let s = 0; s < N; s++) { if (lab[s] !== -1 || alpha[s] <= 64) continue; let h = 0, t = 0; q[t++] = s; lab[s] = next;
    while (h < t) { const i = q[h++], x = i % W; for (const j of [i - 1, i + 1, i - W, i + W]) { if (j < 0 || j >= N || (j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue; if (lab[j] === -1 && alpha[j] > 64) { lab[j] = next; q[t++] = j; } } }
    next++; }
  // 한 조각이 여러 덩어리로 흩어져 있으면 덩어리마다 따로 번호를 줘요 (작은 덩어리는 아래에서 이웃에 붙어요)
  { const nl = new Int32Array(N).fill(-1); let c = 0;
    for (let s = 0; s < N; s++) { if (lab[s] < 0 || nl[s] >= 0) continue; const L = lab[s]; let h = 0, t = 0; q[t++] = s; nl[s] = c;
      while (h < t) { const i = q[h++], x = i % W; for (const j of [i - 1, i + 1, i - W, i + W]) { if (j < 0 || j >= N || (j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue; if (nl[j] < 0 && lab[j] === L) { nl[j] = c; q[t++] = j; } } }
      c++; }
    for (let i = 0; i < N; i++) lab[i] = nl[i]; next = c; }
  // 너무 작은 조각은 가장 많이 맞닿은 이웃에 붙여요
  const area = new Int32Array(next); for (let i = 0; i < N; i++) if (lab[i] >= 0) area[lab[i]]++;
  for (let pass = 0; pass < 6; pass++) { const nb = new Map();
    for (let i = 0; i < N; i++) { const a = lab[i]; if (a < 0 || area[a] >= N * 0.0015) continue; const x = i % W; for (const j of [i - 1, i + 1, i - W, i + W]) { if (j < 0 || j >= N || (j === i - 1 && x === 0) || (j === i + 1 && x === W - 1)) continue; const b = lab[j]; if (b >= 0 && b !== a) { const m = nb.get(a) || new Map(); m.set(b, (m.get(b) || 0) + 1); nb.set(a, m); } } }
    if (!nb.size) break; const to = new Map(); for (const [a, m] of nb) to.set(a, [...m].sort((x, y) => y[1] - x[1])[0][0]);
    for (let i = 0; i < N; i++) { const a = lab[i]; if (to.has(a)) { lab[i] = to.get(a); } } area.fill(0); for (let i = 0; i < N; i++) if (lab[i] >= 0) area[lab[i]]++; }
  // 번호를 0부터 다시 매겨요
  const map = new Int32Array(next).fill(-1); let n = 0; for (let a = 0; a < next; a++) if (area[a] > 0) map[a] = n++;
  const pieces = Array.from({ length: n }, () => ({ area: 0, cx: 0, cy: 0 }));
  for (let i = 0; i < N; i++) if (lab[i] >= 0) { const p = pieces[lab[i] = map[lab[i]]]; p.area++; p.cx += i % W; p.cy += (i / W) | 0; }
  for (const p of pieces) { p.cx /= p.area; p.cy /= p.area; }
  // 처음 주인: 몸 짐작이 둘 이상이면 조각이 가장 많이 들어간 사람(작은 몸 짐작부터 봐요). 아니면 모두 사람 1
  const owner = new Int16Array(n), people = Math.max(2, Math.min(4, bodies.length));
  if (bodies.length >= 2) {
    for (const b of bodies) { let sx = 0; for (let i = 0; i < N; i++) if (b.u[i]) sx += i % W; b.cx = sx / b.a; }
    bodies.sort((a, b) => a.cx - b.cx);   // 왼쪽 사람이 사람 1
    const order = bodies.map((b, i) => i).sort((x, y) => bodies[x].a - bodies[y].a), ov = pieces.map(() => new Float32Array(bodies.length));
    for (let i = 0; i < N; i++) { const a = lab[i]; if (a < 0) continue; for (let b = 0; b < bodies.length; b++) if (bodies[b].u[i]) ov[a][b]++; }
    pieces.forEach((p, a) => { let pick = -1; for (const b of order) if (ov[a][b] / p.area >= 0.6) { pick = b; break; } if (pick < 0) { let bv = 0.2; ov[a].forEach((v, b) => { if (v / p.area > bv) { bv = v / p.area; pick = b; } }); } owner[a] = Math.max(0, pick); });
  }
  return { W, H, W0, H0, alpha, lab, pieces, owner, people, key, small, found: { person: P.length, head: Hd.length, hand: Hn.length } };
}
// 누른 점에서 새 조각을 따서 기존 조각에서 떼어 내요 (사람 나누기 창에서 '조각 더 나누기')
export async function splitCarve(S, x, y, job) {
  const m = await samMask(S.small, S.key, [[x, y, 1]], null, job), d = m.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, S.W, S.H).data, id = S.pieces.length; let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < S.W * S.H; i++) if (d[i * 4 + 3] > 127 && S.alpha[i] > 64) { if (S.lab[i] >= 0) S.pieces[S.lab[i]].area--; S.lab[i] = id; a++; cx += i % S.W; cy += (i / S.W) | 0; }
  if (!a) return -1; S.pieces.push({ area: a, cx: cx / a, cy: cy / a }); const o = new Int16Array(S.pieces.length); o.set(S.owner); S.owner = o; return id;
}

export async function samMask(src, key, pts, box, job, say) {
  say && say('모델을 불러오는 중'); await aiLoad('samE'); await aiLoad('samD'); job && check(job);
  const W = src.width, H = src.height, s = 1024 / Math.max(W, H), tw = Math.max(1, Math.round(W * s)), th = Math.max(1, Math.round(H * s));
  if (samState.samEnc !== key) {
    say && say(`그림을 읽는 중 (${aiDevice() || 'AI'})`, 0.2);
    const c = mk(tw, th), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, tw, th);
    const px = g.getImageData(0, 0, tw, th).data, x = new Float32Array(tw * th * 3); for (let i = 0, j = 0; i < tw * th; i++, j += 4) { x[i * 3] = px[j]; x[i * 3 + 1] = px[j + 1]; x[i * 3 + 2] = px[j + 2]; }
    samState.samEnc = ''; await aiCall({ t: 'run2', key: 'samE', feeds: { input_image: { data: x, dims: [th, tw, 3] } }, keep: ['image_embeddings'], outs: [] }, [x.buffer]); samState.samEnc = key;
    job && check(job);
  }
  say && say('윤곽을 따는 중', 0.7);
  const np = pts.length + (box ? 2 : 1), pc = new Float32Array(np * 2), pl = new Float32Array(np);
  pts.forEach(([x, y, l], i) => { pc[i * 2] = x * s; pc[i * 2 + 1] = y * s; pl[i] = l; });
  if (box) { pc.set([box[0] * s, box[1] * s, box[2] * s, box[3] * s], pts.length * 2); pl[pts.length] = 2; pl[pts.length + 1] = 3; } else pl[pts.length] = -1;
  const r = await aiCall({ t: 'run2', key: 'samD', outs: ['masks', 'iou_predictions'], feeds: { image_embeddings: { ref: 'image_embeddings' }, point_coords: { data: pc, dims: [1, np, 2] }, point_labels: { data: pl, dims: [1, np] },
    mask_input: { data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] }, has_mask_input: { data: new Float32Array([0]), dims: [1] }, orig_im_size: { data: new Float32Array([th, tw]), dims: [2] } } });
  const m = r.out.masks.data, nm = r.out.masks.dims[1] || 1, iou = r.out.iou_predictions ? r.out.iou_predictions.data : null, n = tw * th;
  // 후보가 여럿이면 점수가 비슷한 것 중 가장 넓은 것 (눈 하나보다 얼굴, 얼굴보다 사람)
  let best = 0;
  if (iou && nm > 1) {
    const size = k => { let c = 0; for (let i = 0; i < n; i++) if (m[k * n + i] > 0) c++; return c; };
    let top = 0; for (let k = 1; k < nm; k++) if (iou[k] > iou[top]) top = k;
    let bs = -1; for (let k = 0; k < nm; k++) if (iou[k] >= iou[top] - 0.08) { const sz = size(k); if (sz > bs && sz < n * 0.92) { bs = sz; best = k; } }
  }
  const c = mk(tw, th), g = c.getContext('2d'), id = g.createImageData(tw, th);
  for (let i = 0; i < n; i++) { const on = m[best * n + i] > 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = on ? 255 : 0; }
  g.putImageData(id, 0, 0);
  const M = mk(W, H), gm = M.getContext('2d'); gm.imageSmoothingQuality = 'high'; gm.drawImage(c, 0, 0, W, H);
  return M;
}
