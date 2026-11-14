// AI 실행기: 모델을 일꾼(worker)에서 돌려요. 그림은 이 컴퓨터 안에서만 처리해요.
// 그래픽카드(WebGPU)가 되면 그쪽으로, 안 되면 CPU로 알아서 돌아요.
import { packBytes } from './packs.js';
import { emit } from './store.js';

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
    const p = A.loaded[key] = (async () => { await init(); const b = await packBytes('czM_' + key); A.ep = (await call({ t: 'load', key, bytes: b }, [b])).ep; })();
    p.catch(() => { if (A.loaded[key] === p) delete A.loaded[key]; });
  }
  return A.loaded[key];
}
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
