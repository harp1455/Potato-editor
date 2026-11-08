/* ================= 자동 흰칠 (그림 속 성기를 찾아 흰색으로 가리기) ================= */
// 탐지 모델 두 개와 실행 도구(onnxruntime-web)가 이 파일 안에 들어 있어요. 처음 쓸 때 한 번 풀어서
// 따로 도는 일꾼(Worker)에서 돌려요. 그림은 이 컴퓨터 안에서만 처리되고 인터넷은 쓰지 않아요.
const CZ_MODELS = {
  // 애니 그림 전용: 큰 모델과 작은 모델로, 그대로 한 번·좌우 뒤집어 한 번씩, 모두 네 번 본 점수를 평균내요 (한 번만 보면 놓치는 그림이 있었어요)
  deep: { label: '애니 그림 전용', dyn: true, thr: 0.2, cls: ['nipple', 'penis', 'pussy'], views: [['deep', false], ['deep', true], ['deepn', false], ['deepn', true]] },
  deepn: { label: '애니 그림 전용(작은 모델)', dyn: true, thr: 0.278, cls: ['nipple', 'penis', 'pussy'] },
  // 애니 전용 분할 모델 (01miku/anime-nsfw-segm-yolo26, MIT): 성기·항문 모양을 바로 따요. 빠르게 = 작은 판(640), 정밀하게 = 중간판(1280)
  segN: { label: '분할 모델(빠르게)', size: 640 },
  segM: { label: '분할 모델(정밀하게)', size: 1280 },
};
const CZ_PICKS = [['fast', '빠르게', '가벼운 분할 모델로 모양을 따요. 대부분 이걸로 충분해요.'], ['precise', '정밀하게', '큰 분할 모델이라 모양이 더 정확하고 항문도 잘 찾아요. 몇 배 느려요.']];
const CZ_MIN = 0.04; // 이보다 낮은 점수는 아예 버려요
const CZ_PARTS = ['penis', 'pussy', 'anus'];
const czCfg = Object.assign({ model: 'fast', shape: 'contour', pad: 3, sens: 50, size: 100, soft: 4, male: true, female: true, anus: false, glove: true, small: false, color: '#ffffff', device: 'auto' },
  (() => { try { return JSON.parse(localStorage.getItem('cutCzCfg') || '{}'); } catch (_) { return {}; } })());
function czSaveCfg() { try { localStorage.setItem('cutCzCfg', JSON.stringify(czCfg)); } catch (_) { } }
const czContour = () => czCfg.shape !== 'ellipse';
if (czCfg.model !== 'fast' && czCfg.model !== 'precise') czCfg.model = 'fast'; // 예전 설정(EraX 등)은 '빠르게'로
const czModelKeys = () => ['deep'];
// 민감도 50 = 모델이 권하는 기준. 100으로 갈수록 기준이 1/4까지 낮아져서 더 많이 찾아요
const czThr = key => clamp(CZ_MODELS[key].thr * Math.pow(2, (50 - czCfg.sens) / 25), CZ_MIN, 0.92);

/* ---- 일꾼 (따로 도는 스크립트) ---- */
function czWorkerMain() {
  let ort = null, ep = 'wasm';
  const S = {}, B = {}, K = {};
  const make = (key, gpu) => ort.InferenceSession.create(B[key], { executionProviders: [gpu ? 'webgpu' : 'wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  self.onmessage = async e => {
    const m = e.data;
    const reply = (o, tr) => self.postMessage(Object.assign({ id: m.id, ok: true }, o), tr || []);
    try {
      if (m.t === 'init') {
        ort = self.ort; // 실행 도구는 이 일꾼 코드 앞에 같이 붙어 있어요
        if (!ort) throw new Error('ort');
        ort.env.wasm.wasmBinary = m.wasm; ort.env.wasm.numThreads = m.threads || 1; ort.env.wasm.proxy = false; ort.env.logLevel = 'error';
        ep = 'wasm';
        if (m.device !== 'cpu' && self.navigator && navigator.gpu) {
          try {
            const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (ad && !ad.isFallbackAdapter && !(ad.info && ad.info.isFallbackAdapter)) ep = 'webgpu';
          } catch (_) { }
        }
        reply({ ep, threads: ort.env.wasm.numThreads });
      } else if (m.t === 'load') {
        B[m.key] = m.bytes;
        if (ep === 'webgpu') { try { S[m.key] = await make(m.key, true); S[m.key].gpu = true; } catch (_) { S[m.key] = null; } }
        if (!S[m.key]) S[m.key] = await make(m.key, false);
        reply({ ep: S[m.key].gpu ? 'webgpu' : 'wasm' });
      } else if (m.t === 'run') {
        const run = async () => {
          const s = S[m.key];
          const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', m.data, m.dims) });
          const y = out[s.outputNames[0]];
          return { d: new Float32Array(y.data), dims: y.dims };
        };
        let r;
        try { r = await run(); } catch (err) {
          if (!S[m.key] || !S[m.key].gpu) throw err;
          S[m.key] = await make(m.key, false); r = await run(); // 그래픽카드에서 안 되면 CPU로
        }
        reply({ data: r.d, dims: r.dims, ep: S[m.key].gpu ? 'webgpu' : 'wasm' }, [r.d.buffer]);
      } else if (m.t === 'run2') { // 입력·출력이 여러 개인 모델 (윤곽 따기). keep: 다음에 쓸 결과를 일꾼 안에 보관
        const feeds = {};
        for (const [k, v] of Object.entries(m.feeds)) feeds[k] = v.ref ? K[v.ref] : new ort.Tensor('float32', v.data, v.dims);
        let out;
        try { out = await S[m.key].run(feeds); } catch (err) {
          if (!S[m.key] || !S[m.key].gpu) throw err;
          S[m.key] = await make(m.key, false); out = await S[m.key].run(feeds);
        }
        for (const k of m.keep || []) K[k] = new ort.Tensor('float32', new Float32Array(out[k].data), out[k].dims);
        const res = {}, tr = [];
        for (const k of m.outs || []) { const d = new Float32Array(out[k].data); res[k] = { data: d, dims: out[k].dims }; tr.push(d.buffer); }
        reply({ out: res, ep: S[m.key].gpu ? 'webgpu' : 'wasm' }, tr);
      }
    } catch (err) { self.postMessage({ id: m.id, ok: false, err: String((err && err.message) || err) }); }
  };
}
const cz = { w: null, ready: null, seq: 0, wait: new Map(), loaded: {}, ep: '', gz: {}, wUrl: '', q: Promise.resolve(), samQ: Promise.resolve() };
function czCall(msg, tr) { // 일꾼에게 보내는 일은 하나씩 차례로 (동시에 돌면 결과가 섞일 수 있어요)
  const send = () => new Promise((res, rej) => {
    if (!cz.w) { rej(new Error('worker')); return; }
    const id = ++cz.seq; cz.wait.set(id, { res, rej }); cz.w.postMessage(Object.assign({ id }, msg), tr || []);
  });
  const p = cz.q.then(send, send); cz.q = p.catch(() => { }); return p;
}
// exe판: 처음 준비가 멈춘 채 끝나지 않으면(엔진이 이 PC와 안 맞는 경우) 기다리다 끊고 다른 방식으로 다시 해요
const czTimed = (p, ms) => !czIsApp() || cz.firstOk ? p : Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
function czReset(err) {
  if (cz.w) { try { cz.w.terminate(); } catch (_) { } }
  for (const p of cz.wait.values()) p.rej(err || new Error('reset'));
  cz.w = null; cz.ready = null; cz.loaded = {}; cz.wait.clear(); cz.ep = ''; cz.q = Promise.resolve(); cz.samQ = Promise.resolve(); cz.samEnc = '';
}
async function czBytes(id) { // 파일 안에 넣어 둔 압축 데이터를 원래대로
  let gz = cz.gz[id];
  if (!gz) {
    const el = document.getElementById(id);
    if (el && el.textContent) { gz = cz.gz[id] = new Uint8Array(b64ToBuf(el.textContent)); el.textContent = ''; }
    else if (czIsApp()) gz = await czPackRead(id); // exe판: 받아 둔 팩에서 (메모리에 계속 들고 있지 않아요)
    else throw new Error('notready');
  }
  return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
/* ---- 팩 (exe판): 모델과 실행 도구는 처음 쓸 때 한 번 받아 두고 써요 ---- */
// 팩 목록(packs.json)과 파일은 깃허브 Releases의 packs-N에 있어요. 팩이 바뀌면 N을 올리고 편집기도 같이 업데이트해요
const CZ_PACK_TAG = 'packs-3';
const CZ_PACK_URL = 'https://github.com/harp1455/Potato-editor/releases/download/' + CZ_PACK_TAG + '/';
const czIsApp = () => !!(window.POTATO_BUILD && window.POTATO_BUILD.kind === 'app');
const czTauri = () => (window.__TAURI__ && window.__TAURI__.fs && window.__TAURI__.upload) ? window.__TAURI__ : null;
const czPk = { man: null, busy: null };
const czMB = n => (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'MB';
async function czSha(u8) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join(''); }
// 저장소: exe = 앱 데이터 폴더/packs/packs-N/, 그 밖(웹 주소로 열었을 때·시험용) = 브라우저 캐시
const czStore = (() => {
  const T = czTauri();
  if (T) {
    const B = { baseDir: T.fs.BaseDirectory.AppData }, dir = 'packs/files';
    let abs = null; const absDir = async () => abs || (abs = await T.path.join(await T.path.appDataDir(), 'packs', 'files'));
    let moved = false;
    const migrate = async () => { // 예전(packs/packs-1)에 받아 둔 파일은 옮겨 써요
      if (moved) return; moved = true;
      try {
        if (!(await T.fs.exists('packs/packs-1', B))) return;
        await T.fs.mkdir(dir, Object.assign({ recursive: true }, B));
        for (const e of await T.fs.readDir('packs/packs-1', B)) if (e.isFile && !e.name.endsWith('.json') && !(await T.fs.exists(dir + '/' + e.name, B))) await T.fs.rename('packs/packs-1/' + e.name, dir + '/' + e.name, { oldPathBaseDir: B.baseDir, newPathBaseDir: B.baseDir });
        await T.fs.remove('packs/packs-1', Object.assign({ recursive: true }, B));
      } catch (_) { }
    };
    return {
      migrate,
      async size(f) { try { if (!(await T.fs.exists(dir + '/' + f, B))) return -1; return (await T.fs.stat(dir + '/' + f, B)).size; } catch (_) { return -1; } },
      async read(f) { return new Uint8Array(await T.fs.readFile(dir + '/' + f, B)); },
      async fetchTo(f0, onBytes, saveAs) { // 받아서 .part로 → 다 받으면 이름 바꾸기
        await T.fs.mkdir(dir, Object.assign({ recursive: true }, B));
        const f = saveAs || f0, part = f + '.part';
        try { await T.fs.remove(dir + '/' + part, B); } catch (_) { }
        await T.upload.download(CZ_PACK_URL + f0, await T.path.join(await absDir(), part), p => onBytes(p.progressTotal || 0));
        return {
          read: async () => new Uint8Array(await T.fs.readFile(dir + '/' + part, B)),
          keep: async () => { try { await T.fs.remove(dir + '/' + f, B); } catch (_) { } await T.fs.rename(dir + '/' + part, dir + '/' + f, { oldPathBaseDir: B.baseDir, newPathBaseDir: B.baseDir }); },
          drop: async () => { try { await T.fs.remove(dir + '/' + part, B); } catch (_) { } },
        };
      },
      async remove(f) { try { await T.fs.remove(dir + '/' + f, B); } catch (_) { } },
    };
  }
  const base = new URL('packs/', location.href).href, cname = 'potato-packs';
  return {
    async migrate() { },
    async size(f) { try { const r = await (await caches.open(cname)).match(base + f); return r ? (await r.arrayBuffer()).byteLength : -1; } catch (_) { return -1; } },
    async read(f) { const r = await (await caches.open(cname)).match(base + f); if (!r) throw new Error('nopack'); return new Uint8Array(await r.arrayBuffer()); },
    async fetchTo(f0, onBytes, saveAs) {
      const f = saveAs || f0, res = await fetch(base + f0, { cache: 'no-store' }); if (!res.ok) throw new Error('HTTP ' + res.status);
      const rd = res.body.getReader(), parts = []; let n = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes(n); }
      const u8 = new Uint8Array(n); let o = 0; for (const p of parts) { u8.set(p, o); o += p.length; }
      return { read: async () => u8, keep: async () => (await caches.open(cname)).put(base + f, new Response(u8)), drop: async () => { } };
    },
    async remove(f) { try { await (await caches.open(cname)).delete(base + f); } catch (_) { } },
  };
})();
// 팩 목록: 받아 둔 게 있으면 그걸, 없으면 인터넷에서
async function czPackMan(online) {
  if (czPk.man) return czPk.man;
  await czStore.migrate();
  const mf = CZ_PACK_TAG + '.json';
  if (await czStore.size(mf) > 0) { try { return czPk.man = JSON.parse(new TextDecoder().decode(await czStore.read(mf))); } catch (_) { } }
  if (!online) return null;
  const t = await czStore.fetchTo('packs.json', () => { }, mf);
  const man = JSON.parse(new TextDecoder().decode(await t.read()));
  if (!man || !Array.isArray(man.files) || !man.packs) { await t.drop(); throw new Error('팩 목록 모양이 이상해요'); }
  await t.keep(); return czPk.man = man;
}
// 팩마다 받아 둔 상태: { base: true/false, ... } (파일 크기로 확인. 받을 때 sha256까지 검사해요)
async function czPackState(online) {
  const man = await czPackMan(online); if (!man) return null;
  const st = {};
  for (const k of Object.keys(man.packs)) st[k] = true;
  for (const f of man.files) if (await czStore.size(f.file) !== f.size) st[f.pack] = false;
  return st;
}
async function czPackRead(id) {
  const man = await czPackMan(false), f = man && man.files.find(x => x.id === id);
  if (!f || await czStore.size(f.file) !== f.size) throw new Error('nopack:' + (f ? f.pack : '?'));
  return czStore.read(f.file);
}
// 팩 받기 (여러 개 한 번에). onProg(받은 바이트, 전체 바이트, 지금 파일 이름)
async function czPackGet(packs, onProg) {
  if (czPk.busy) return czPk.busy;
  czPk.busy = (async () => {
    const man = await czPackMan(true);
    const todo = [];
    for (const f of man.files) if (packs.includes(f.pack) && await czStore.size(f.file) !== f.size) todo.push(f);
    const total = todo.reduce((a, f) => a + f.size, 0); let done = 0;
    for (const f of todo) {
      let ok = false;
      for (let tries = 0; tries < 2 && !ok; tries++) { // 깨져서 오면 한 번 더 받아요
        const t = await czStore.fetchTo(f.file, n => onProg && onProg(done + Math.min(n, f.size), total, f.file));
        const u8 = await t.read();
        if (u8.length === f.size && await czSha(u8) === f.sha256) { await t.keep(); ok = true; } else await t.drop();
      }
      if (!ok) throw new Error(f.file + ' 파일이 깨져서 왔어요');
      done += f.size; onProg && onProg(done, total, f.file);
    }
  })();
  try { await czPk.busy; } finally { czPk.busy = null; }
}
async function czPackDel(pack) {
  const man = await czPackMan(false); if (!man) return;
  czReset(); // 지금 불러와 둔 모델도 내려놔요
  for (const f of man.files) if (f.pack === pack) await czStore.remove(f.file);
}
// 자동 흰칠 시작 전: 필요한 팩이 없으면 받을지 물어봐요. 준비되면 true
const czNeedPacks = () => ['base'].concat(czCfg.model === 'precise' ? ['precise'] : []);
async function czPacksReady(need) {
  if (!czIsApp()) return true;
  let st;
  try { st = await czPackState(true); }
  catch (e) { toast('팩 목록을 받지 못했어요. 인터넷 연결을 확인해 주세요. (' + String((e && e.message) || e).slice(0, 60) + ')', 5200); return false; }
  const miss = (need || czNeedPacks()).filter(k => !st[k]);
  return miss.length ? czPackAsk(miss) : true;
}
function czPackAsk(miss) {
  return new Promise(resolve => {
    const man = czPk.man, size = miss.reduce((a, k) => a + man.packs[k].size, 0);
    const m = modal(`<h2>${miss.some(k => k === 'bg' || k === 'sr') ? 'AI 팩 받기' : '자동 흰칠 팩 받기'}</h2>
      <p class="sub">${miss.some(k => k === 'bg' || k === 'sr') ? '이 기능' : '자동 흰칠'}을 쓰려면 아래 팩을 한 번 받아야 해요. 받은 뒤에는 인터넷 없이 써요. 그림은 어디로도 보내지 않아요.</p>
      <div class="czpk-list">${miss.map(k => `<div class="czpk"><b>${man.packs[k].label}</b> <span class="muted small">${czMB(man.packs[k].size)} · ${man.packs[k].desc}</span></div>`).join('')}</div>
      <div class="czbar"><i id="czPkBar"></i></div><p class="muted small" id="czPkMsg">&nbsp;</p>
      <div class="foot"><button class="btn" id="czPkNo">나중에</button><button class="btn primary" id="czPkGo">받기 (${czMB(size)})</button></div>`);
    let settled = false; const end = v => { if (!settled) { settled = true; resolve(v); } };
    $('#czPkNo', m).addEventListener('click', () => { closeModal(); end(false); });
    new MutationObserver((_, ob) => { if (!m.isConnected) { ob.disconnect(); end(false); } }).observe($('#modalRoot'), { childList: true });
    $('#czPkGo', m).addEventListener('click', async () => {
      const go = $('#czPkGo', m), no = $('#czPkNo', m); go.disabled = true; no.textContent = '닫기 (계속 받아요)';
      try {
        await czPackGet(miss, (n, t) => {
          if (!m.isConnected) return;
          $('#czPkBar', m).style.width = Math.round(t ? n / t * 100 : 100) + '%'; $('#czPkMsg', m).textContent = `${czMB(n)} / ${czMB(t)} 받는 중…`;
        });
        if (m.isConnected) { closeModal(); end(true); } else toast('자동 흰칠 팩을 다 받았어요. 이제 자동 흰칠을 쓸 수 있어요.', 4200);
      } catch (e) {
        const msg = '받지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (' + String((e && e.message) || e).slice(0, 80) + ')';
        if (m.isConnected) { $('#czPkMsg', m).textContent = msg; go.disabled = false; go.textContent = '다시 받기'; no.textContent = '나중에'; } else toast(msg, 6000);
      }
    });
  });
}
// 설정 창 안 팩 칸: 받기 / 지우기
async function czPackBoxRender(box) {
  if (!box || !box.isConnected) return;
  box.innerHTML = '<h3>팩</h3><p class="muted small">확인하는 중…</p>';
  let st = null, man = null;
  try { st = await czPackState(false); man = czPk.man; } catch (_) { }
  if (!st) {
    box.innerHTML = `<h3>팩</h3><p class="muted small">아직 받은 팩이 없어요. 자동 흰칠을 처음 쓸 때 받을지 물어봐요.</p><div class="foot" style="justify-content:flex-start;margin-top:6px"><button class="btn sm" id="czPkNow">지금 받기</button></div>`;
    $('#czPkNow', box).addEventListener('click', async () => { const ok = await czPacksReady(); if (ok) toast('팩이 준비됐어요'); });
    return;
  }
  box.innerHTML = '<h3>팩</h3>' + Object.keys(man.packs).map(k => `<div class="czpk"><b>${man.packs[k].label}</b> <span class="muted small">${czMB(man.packs[k].size)} · ${man.packs[k].desc}</span>
    <span class="flex1"></span>${st[k] ? `<span class="czpk-ok">받음</span><button class="btn sm" data-pkdel="${k}">지우기</button>` : `<button class="btn sm" data-pkget="${k}">받기</button>`}</div>`).join('');
  box.onclick = async e => {
    const g = e.target.closest('[data-pkget]'), d = e.target.closest('[data-pkdel]');
    if (g) { closeModal(); const ok = await czPackAsk([g.dataset.pkget]); if (ok) toast('팩을 받았어요'); }
    if (d) { await czPackDel(d.dataset.pkdel); toast('팩을 지웠어요. 다시 쓰려면 다시 받아야 해요.'); czPackBoxRender(box); }
  };
}
function czInit() {
  if (cz.ready) return cz.ready;
  cz.ready = (async () => {
    const mod = czIsApp() && !cz.classic;
    if (mod && !cz.wUrlM) { // exe판: 엔진(모듈)을 주소로 불러와야 여러 스레드가 돌아요
      const u = new URL('ort/ort.webgpu.bundle.min.mjs', location.href).href;
      cz.wUrlM = URL.createObjectURL(new Blob([`import * as ort from ${JSON.stringify(u)};\nself.ort = ort;\n(${czWorkerMain.toString()})();`], { type: 'text/javascript' }));
    }
    if (!mod && !cz.wUrl) { // 파일로 열었을 때도 되도록, 실행 도구와 일꾼 코드를 한 덩어리로
      const el = $('#czOrt'); if (!el || !el.textContent) throw new Error('notready');
      cz.wUrl = URL.createObjectURL(new Blob([el.textContent, `\n(${czWorkerMain.toString()})();`], { type: 'text/javascript' }));
    }
    const w = mod ? new Worker(cz.wUrlM, { type: 'module', name: 'auto-censor' }) : new Worker(cz.wUrl, { name: 'auto-censor' });
    w.onmessage = e => { const m = e.data, p = cz.wait.get(m.id); if (!p) return; cz.wait.delete(m.id); m.ok ? p.res(m) : p.rej(new Error(m.err)); };
    w.onerror = e => { e.preventDefault(); czReset(new Error(e.message || 'worker')); };
    cz.w = w;
    const wasm = await czBytes('czWasm');
    if (!cz.w) throw new Error('worker');
    // 여러 스레드는 교차 출처 격리(exe판)일 때만. 코어 절반, 많아도 4개
    const threads = mod && !cz.noThreads && self.crossOriginIsolated ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2))) : 1;
    const r = await czTimed(czCall({ t: 'init', wasm, device: czCfg.device, threads }, [wasm]), 60000);
    cz.ep = r.ep; cz.threads = r.threads || 1;
    return true;
  })();
  cz.ready.catch(err => { if (cz.ready) czReset(err); });
  return cz.ready;
}
function czLoad(key) {
  if (!cz.loaded[key]) {
    const p = cz.loaded[key] = (async () => {
      for (let tries = 0; ; tries++) {
        try {
          await czInit();
          const b = await czBytes('czM_' + key);
          const r = await czTimed(czCall({ t: 'load', key, bytes: b }, [b]), 120000);
          cz.ep = r.ep; cz.firstOk = true; return;
        } catch (e) {
          // exe판: 여러 스레드 → 한 스레드 → 예전 일꾼 순서로 물러나요 (팩이 없거나 멈춘 건 그대로 알려요)
          const msg = String((e && e.message) || '');
          if (tries >= 2 || !czIsApp() || /^(nopack|stop|reset)/.test(msg) || /memory|allocation/i.test(msg)) throw e;
          if (cz.threads > 1 && !cz.noThreads) cz.noThreads = true; else cz.classic = true;
          czReset(e); cz.loaded = { [key]: p }; // 일꾼을 새로 만들었으니 다른 모델도 다시 불러와야 해요
        }
      }
    })();
    p.catch(() => { if (cz.loaded[key] === p) delete cz.loaded[key]; });
  }
  return cz.loaded[key];
}
const czDevText = () => cz.ep === 'webgpu' ? '그래픽카드로 처리하는 중' : cz.ep === 'wasm' ? (cz.threads > 1 ? `CPU(${cz.threads}스레드)로 처리하는 중` : 'CPU로 처리하는 중') : '';
function czErrText(e) {
  const m = String((e && e.message) || e || '');
  if (m === 'notready') return '편집기 파일을 아직 다 읽지 못했어요. 몇 초 뒤에 다시 눌러 주세요.';
  if (m === 'timeout') return '자동 흰칠 준비가 너무 오래 걸려서 멈췄어요. 설정에서 처리 장치를 CPU로 바꾸거나 프로그램을 다시 켜 보세요.';
  if (m.startsWith('nopack')) return "자동 흰칠 팩이 없어요. '자동 흰칠 설정'에서 팩을 받아 주세요.";
  if (/memory|Memory|allocation/.test(m)) return '메모리가 모자라서 멈췄어요. 다른 탭을 닫거나 처리 장치를 CPU로 바꿔 보세요.';
  return '자동 흰칠을 준비하지 못했어요. 크롬이나 엣지 최신 버전에서 다시 열어 주세요. (' + m.slice(0, 80) + ')';
}

/* ---- 그림 → 모델 입력, 모델 출력 → 상자 ---- */
function czPrep(src, rx, ry, rw, rh, key, flip) { // flip: 좌우 뒤집어서 보기
  const M = CZ_MODELS[key];
  let tw, th, map;
  if (M.dyn) { // 긴 쪽 640 이하, 32의 배수로 (모델 만든 쪽 방식 그대로)
    const r = Math.min(1, 640 / Math.max(rw, rh));
    tw = Math.max(32, Math.ceil(rw * r / 32) * 32); th = Math.max(32, Math.ceil(rh * r / 32) * 32);
    map = { sx: rw / tw, sy: rh / th, ox: rx, oy: ry, px: 0, py: 0, flip: !!flip, tw };
  } else { // 640×640 안에 비율 그대로 넣고 남는 곳은 회색
    tw = th = 640;
    const r = Math.min(640 / rw, 640 / rh), nw = Math.max(1, Math.round(rw * r)), nh = Math.max(1, Math.round(rh * r));
    map = { sx: rw / nw, sy: rh / nh, ox: rx, oy: ry, px: Math.round((640 - nw) / 2), py: Math.round((640 - nh) / 2), nw, nh };
  }
  const c = newCanvas(tw, th), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  if (M.dyn) { if (flip) { g.translate(tw, 0); g.scale(-1, 1); } g.drawImage(src, rx, ry, rw, rh, 0, 0, tw, th); g.setTransform(1, 0, 0, 1, 0, 0); }
  else { g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, tw, th); g.drawImage(src, rx, ry, rw, rh, map.px, map.py, map.nw, map.nh); }
  const d = g.getImageData(0, 0, tw, th).data, n = tw * th, x = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { x[i] = d[j] / 255; x[n + i] = d[j + 1] / 255; x[2 * n + i] = d[j + 2] / 255; }
  return { data: x, dims: [1, 3, th, tw], map };
}
function czIou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)), I = ix * iy;
  return I / Math.max(1e-6, a.w * a.h + b.w * b.h - I);
}
function czNms(list, iou) { list.sort((a, b) => b.s - a.s); const keep = []; for (const b of list) { if (keep.length >= 300) break; if (keep.every(k => czIou(k, b) < iou)) keep.push(b); } return keep; }
function czDecode(y, dims, key, map) {
  const M = CZ_MODELS[key], C = dims[1], N = dims[2], out = [];
  const ci = CZ_PARTS.map(p => M.cls.indexOf(p));
  for (let i = 0; i < N; i++) {
    const sc = {}; let best = 0;
    CZ_PARTS.forEach((p, k) => { if (ci[k] < 0 || 4 + ci[k] >= C) return; const s = y[(4 + ci[k]) * N + i]; sc[p] = s; if (s > best) best = s; });
    if (best < CZ_MIN) continue;
    const cx = map.flip ? map.tw - y[i] : y[i], cy = y[N + i], w = y[2 * N + i], h = y[3 * N + i];
    out.push({ x: (cx - w / 2 - map.px) * map.sx + map.ox, y: (cy - h / 2 - map.py) * map.sy + map.oy, w: w * map.sx, h: h * map.sy, s: best, sc, m: key });
  }
  return czNms(out, 0.5);
}
// 그림을 나눠 볼 조각들: 길쭉하면 정사각형 조각으로, '꼼꼼히'면 더 작게 나눈 조각도
function czTiles(W, H, fine) {
  const t = [], L = Math.max(W, H), S = Math.min(W, H), vert = H >= W;
  if (L <= S * 1.6) t.push([0, 0, W, H]);
  else {
    const n = Math.ceil((L - S) / (S * 0.7)) + 1;
    for (let i = 0; i < n; i++) { const o = Math.round((L - S) * i / (n - 1)); t.push(vert ? [0, o, W, S] : [o, 0, S, H]); }
  }
  if (fine) for (const [x, y, w, h] of t.slice()) {
    const tw = w * 0.6, th = h * 0.6;
    if (tw < 96 || th < 96) continue;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) t.push([x + u * (w - tw), y + v * (h - th), tw, th]);
  }
  return t;
}
// 캔버스 한 장에서 찾기 → 후보 상자 (점수 낮은 것도 남겨 두고, 고를 때 기준을 적용해요)
async function czDetect(cv, key, tk, onTile) {
  const views = CZ_MODELS[key].views || [[key, false]];
  for (const [m] of views) await czLoad(m);
  const tiles = czTiles(cv.width, cv.height, czCfg.small), out = [], total = tiles.length * views.length;
  let done = 0;
  for (let i = 0; i < tiles.length; i++) {
    const [x, y, w, h] = tiles[i], lists = [];
    for (const [m, flip] of views) {
      if (tk && tk.stop) throw new Error('stop');
      const p = czPrep(cv, x, y, w, h, m, flip);
      const r = await czCall({ t: 'run', key: m, data: p.data, dims: p.dims }, [p.data.buffer]);
      cz.ep = r.ep;
      lists.push(czDecode(r.data, r.dims, m, p.map));
      if (onTile) onTile(++done, total);
    }
    out.push(...(views.length > 1 ? czFuse(lists, key) : lists[0]));
  }
  return out;
}
// 같은 조각을 여러 번 본 결과 → 겹치는 상자끼리 묶어 점수는 평균 (한 번만 잡힌 것은 그만큼 낮아져요), 위치는 점수 가중 평균
function czFuse(lists, key) {
  const n = lists.length, all = [], groups = [];
  lists.forEach((L, v) => L.forEach(b => all.push({ ...b, v })));
  all.sort((a, b) => b.s - a.s);
  for (const b of all) {
    let g = groups.find(q => czIou(q.ref, b) > 0.45);
    if (!g) { g = { ref: b, items: [] }; groups.push(g); }
    if (!g.items.some(q => q.v === b.v)) g.items.push(b);
  }
  return groups.map(g => {
    const sc = {}; for (const p of CZ_PARTS) sc[p] = g.items.reduce((a, q) => a + (q.sc[p] || 0), 0) / n;
    const ws = g.items.reduce((a, q) => a + q.s, 0), avg = k => g.items.reduce((a, q) => a + q[k] * q.s, 0) / ws;
    return { x: avg('x'), y: avg('y'), w: avg('w'), h: avg('h'), s: Math.max(...CZ_PARTS.map(p => sc[p])), sc, m: key };
  }).filter(b => b.s >= CZ_MIN / 4);
}
// 후보 중 지금 설정(모델, 민감도, 가릴 곳)에 맞는 것만 → 겹친 것은 하나로 합쳐요
function czPick(cands) {
  const keys = czModelKeys(), list = [];
  for (const b of cands) {
    if (!keys.includes(b.m)) continue;
    const s = Math.max(czCfg.male ? b.sc.penis || 0 : 0, czCfg.female ? b.sc.pussy || 0 : 0, czCfg.anus ? b.sc.anus || 0 : 0);
    if (s >= czThr(b.m)) list.push({ x: b.x, y: b.y, w: b.w, h: b.h, s });
  }
  const box = czNms(list, 0.7);
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < box.length && !again; i++) for (let j = i + 1; j < box.length; j++) {
      const a = box[i], b = box[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix * iy > 0.3 * Math.min(a.w * a.h, b.w * b.h)) {
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        box[i] = { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0, s: Math.max(a.s, b.s) };
        box.splice(j, 1); again = true; break;
      }
    }
  }
  return box;
}
// 찾은 상자 → 칠할 타원 상자 (모서리까지 덮도록 조금 크게)
function czGrow(b, minR) {
  const f = 1.3 * czCfg.size / 100, cx = b.x + b.w / 2, cy = b.y + b.h / 2, w = Math.max(minR || 6, b.w * f), h = Math.max(minR || 6, b.h * f);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/* ---- 윤곽 따기 (MobileSAM): 찾은 상자 안에서 실제 모양을 따요 ---- */
// 상자마다 주변을 잘라(그림이 작으면 통째로) 1024 크기로 넣고, 상자를 힌트로 후보 모양들을 받아 합쳐요.
// 결과는 캔버스 좌표의 비트맵 {x, y, w, h, data(0/1)} 또는 null (제대로 못 땄으면 타원으로)
function czSamUnion(cv, boxes, tk) {
  const job = cz.samQ.then(() => czSamUnionRun(cv, boxes, tk)); // 윤곽 따기는 한 번에 하나씩
  cz.samQ = job.catch(() => { }); return job;
}
async function czSamUnionRun(cv, boxes, tk) {
  if (!boxes.length) return [];
  await czLoad('samE'); await czLoad('samD');
  const W = cv.width, H = cv.height, res = boxes.map(() => null);
  const groups = Math.max(W, H) <= 1536 ? [{ r: [0, 0, W, H], ids: boxes.map((_, i) => i) }]
    : boxes.map((b, i) => {
      const side = Math.max(320, Math.max(b.w, b.h) * 2.4), rw = Math.min(W, side), rh = Math.min(H, side);
      return { r: [clamp(b.x + b.w / 2 - rw / 2, 0, W - rw), clamp(b.y + b.h / 2 - rh / 2, 0, H - rh), rw, rh], ids: [i] };
    });
  for (const gr of groups) {
    if (tk && tk.stop) throw new Error('stop');
    const rx = Math.floor(gr.r[0]), ry = Math.floor(gr.r[1]), rw = Math.max(1, Math.min(W - rx, Math.round(gr.r[2]))), rh = Math.max(1, Math.min(H - ry, Math.round(gr.r[3])));
    const s = 1024 / Math.max(rw, rh), tw = Math.max(1, Math.round(rw * s)), th = Math.max(1, Math.round(rh * s));
    const c = newCanvas(tw, th), gc = c.getContext('2d', { willReadFrequently: true });
    gc.imageSmoothingQuality = 'high'; gc.drawImage(cv, rx, ry, rw, rh, 0, 0, tw, th);
    const px = gc.getImageData(0, 0, tw, th).data, x = new Float32Array(tw * th * 3);
    for (let i = 0, j = 0, n = tw * th; i < n; i++, j += 4) { x[i * 3] = px[j]; x[i * 3 + 1] = px[j + 1]; x[i * 3 + 2] = px[j + 2]; }
    cz.samEnc = ''; await czCall({ t: 'run2', key: 'samE', feeds: { input_image: { data: x, dims: [th, tw, 3] } }, keep: ['image_embeddings'], outs: [] }, [x.buffer]);
    for (const i of gr.ids) {
      if (tk && tk.stop) throw new Error('stop');
      const b = boxes[i], bx = b.x - rx, by = b.y - ry;
      const r = await czCall({ t: 'run2', key: 'samD', outs: ['masks'], feeds: {
        image_embeddings: { ref: 'image_embeddings' },
        point_coords: { data: new Float32Array([bx * s, by * s, (bx + b.w) * s, (by + b.h) * s]), dims: [1, 2, 2] },
        point_labels: { data: new Float32Array([2, 3]), dims: [1, 2] }, // 2, 3 = 상자의 왼쪽 위, 오른쪽 아래
        mask_input: { data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] }, has_mask_input: { data: new Float32Array([0]), dims: [1] },
        orig_im_size: { data: new Float32Array([rh, rw]), dims: [2] } } });
      const u = czMaskUnion(r.out.masks.data, rw, rh, { x: bx, y: by, w: b.w, h: b.h }, r.out.masks.dims[1] || 1);
      if (u) { u.x += rx; u.y += ry; res[i] = u; }
    }
  }
  return res;
}
// 후보 모양들(nm개) 중 상자 밖으로 크게 번지지 않은 것들을 합친 비트맵 (상자를 30% 넓힌 범위). 상자를 제대로 못 덮으면 null
function czMaskUnion(m, mw, mh, b, nm = 1) {
  const e = 0.3, x0 = Math.max(0, Math.floor(b.x - b.w * e)), y0 = Math.max(0, Math.floor(b.y - b.h * e));
  const x1 = Math.min(mw, Math.ceil(b.x + b.w * (1 + e))), y1 = Math.min(mh, Math.ceil(b.y + b.h * (1 + e)));
  const w = x1 - x0, h = y1 - y0; if (w < 3 || h < 3) return null;
  const bx0 = Math.max(0, Math.floor(b.x)), by0 = Math.max(0, Math.floor(b.y)), bx1 = Math.min(mw, Math.ceil(b.x + b.w)), by1 = Math.min(mh, Math.ceil(b.y + b.h));
  const ba = Math.max(1, (bx1 - bx0) * (by1 - by0)), plane = mw * mh, bin = new Uint8Array(w * h);
  for (let k = 0; k < nm; k++) {
    const off = k * plane; let total = 0, inn = 0, cov = 0;
    for (let i = 0; i < plane; i++) if (m[off + i] > 0) total++;
    for (let y = y0; y < y1; y++) { const o = off + y * mw; for (let x = x0; x < x1; x++) if (m[o + x] > 0) { inn++; if (x >= bx0 && x < bx1 && y >= by0 && y < by1) cov++; } }
    if (!total || 1 - inn / total > 0.2 || cov / ba < 0.05 || cov / ba > 0.9) continue; // 밖으로 번졌거나, 너무 작거나, 상자를 통째로 채우는 후보는 빼요
    for (let y = 0; y < h; y++) { const o = off + (y + y0) * mw + x0; for (let x = 0; x < w; x++) if (m[o + x] > 0) bin[y * w + x] = 1; }
  }
  let area = 0, cov = 0, ux0 = 1e9, uy0 = 1e9, ux1 = -1, uy1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x]) {
    area++; const gx = x + x0, gy = y + y0;
    if (gx >= bx0 && gx < bx1 && gy >= by0 && gy < by1) { cov++; ux0 = Math.min(ux0, gx); uy0 = Math.min(uy0, gy); ux1 = Math.max(ux1, gx); uy1 = Math.max(uy1, gy); }
  }
  if (cov < ba * 0.12 || area > w * h * 0.9) return null;
  if (ux1 - ux0 < (bx1 - bx0) * 0.6 || uy1 - uy0 < (by1 - by0) * 0.6) return null; // 상자 일부만 땄으면 타원으로 (빠지는 곳 없게)
  return { x: x0, y: y0, w, h, data: bin };
}

/* ---- 애니 전용 분할 모델: 성기·항문 모양을 바로 따요 (손은 되도록 빼고) ---- */
const CZ_SEG_CLS = ['anus', 'nipple', 'penis', 'vagina', 'female face', 'male face', 'pubic hair'];
async function czSegDetect(cv, key, tk, tiles, size) { // → [{c, s, x, y, w, h, data}] 캔버스 좌표 비트맵 (점수 0.1 이상만 보관). tiles/size를 주면 그 부분만 그 크기로
  await czLoad(key);
  const M = CZ_MODELS[key], out = [], sz = size || M.size;
  for (const [tx, ty, tw0, th0] of (tiles || czTiles(cv.width, cv.height, false))) {
    if (tk && tk.stop) throw new Error('stop');
    const r = sz / Math.max(tw0, th0), nw = Math.max(1, Math.round(tw0 * r)), nh = Math.max(1, Math.round(th0 * r));
    const iw = Math.ceil(nw / 32) * 32, ih = Math.ceil(nh / 32) * 32;
    const c = newCanvas(iw, ih), g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, iw, ih); g.imageSmoothingQuality = 'high'; g.drawImage(cv, tx, ty, tw0, th0, 0, 0, nw, nh);
    const d = g.getImageData(0, 0, iw, ih).data, n = iw * ih, x = new Float32Array(3 * n);
    for (let i = 0, j = 0; i < n; i++, j += 4) { x[i] = d[j] / 255; x[n + i] = d[j + 1] / 255; x[2 * n + i] = d[j + 2] / 255; }
    const res = await czCall({ t: 'run2', key, feeds: { images: { data: x, dims: [1, 3, ih, iw] } }, outs: ['output0', 'output1'] }, [x.buffer]);
    cz.ep = res.ep;
    const y = res.out.output0.data, N = res.out.output0.dims[2], P = res.out.output1.data, mh = res.out.output1.dims[2], mw = res.out.output1.dims[3], NC = CZ_SEG_CLS.length;
    const cand = [];
    for (let i = 0; i < N; i++) for (const ci of [0, 2, 3]) { const s = y[(4 + ci) * N + i]; if (s >= 0.1) cand.push({ i, ci, s }); }
    cand.sort((a, b) => b.s - a.s);
    const keep = [];
    for (const k of cand) {
      const b = { x: y[k.i] - y[2 * N + k.i] / 2, y: y[N + k.i] - y[3 * N + k.i] / 2, w: y[2 * N + k.i], h: y[3 * N + k.i] };
      if (keep.some(q => czIou(q.b, b) > 0.5)) continue;
      keep.push({ ...k, b }); if (keep.length >= 30) break;
    }
    const sx = mw / iw, sy = mh / ih;
    for (const k of keep) {
      const coef = new Float32Array(32); for (let j = 0; j < 32; j++) coef[j] = y[(4 + NC + j) * N + k.i];
      const px0 = Math.max(0, Math.floor(k.b.x * sx) - 1), px1 = Math.min(mw, Math.ceil((k.b.x + k.b.w) * sx) + 1);
      const py0 = Math.max(0, Math.floor(k.b.y * sy) - 1), py1 = Math.min(mh, Math.ceil((k.b.y + k.b.h) * sy) + 1);
      const pw = px1 - px0, ph = py1 - py0; if (pw < 1 || ph < 1) continue;
      const pm = new Float32Array(pw * ph); // 모양 점수(로짓) = 계수 · 기본 모양들
      for (let yy = 0; yy < ph; yy++) for (let xx = 0; xx < pw; xx++) { let v = 0; const o = (py0 + yy) * mw + px0 + xx; for (let j = 0; j < 32; j++) v += coef[j] * P[j * mh * mw + o]; pm[yy * pw + xx] = v; }
      // 캔버스 픽셀마다 (상자 안만) 부드럽게 읽어서 0보다 크면 칠할 곳
      const bx0 = Math.max(tx, Math.floor(tx + k.b.x / r)), bx1 = Math.min(tx + tw0, Math.ceil(tx + (k.b.x + k.b.w) / r));
      const by0 = Math.max(ty, Math.floor(ty + k.b.y / r)), by1 = Math.min(ty + th0, Math.ceil(ty + (k.b.y + k.b.h) / r));
      const bw = bx1 - bx0, bh = by1 - by0; if (bw < 1 || bh < 1) continue;
      const data = new Uint8Array(bw * bh); let cnt = 0;
      for (let Y = 0; Y < bh; Y++) {
        const v = ((Y + by0 + 0.5 - ty) * r) * sy - 0.5 - py0, v0 = clamp(Math.floor(v), 0, ph - 1), v1 = Math.min(ph - 1, v0 + 1), fv = clamp(v - v0, 0, 1);
        for (let X = 0; X < bw; X++) {
          const u = ((X + bx0 + 0.5 - tx) * r) * sx - 0.5 - px0, u0 = clamp(Math.floor(u), 0, pw - 1), u1 = Math.min(pw - 1, u0 + 1), fu = clamp(u - u0, 0, 1);
          const val = (pm[v0 * pw + u0] * (1 - fu) + pm[v0 * pw + u1] * fu) * (1 - fv) + (pm[v1 * pw + u0] * (1 - fu) + pm[v1 * pw + u1] * fu) * fv;
          if (val > 0) { data[Y * bw + X] = 1; cnt++; }
        }
      }
      if (cnt) out.push({ c: CZ_SEG_CLS[k.ci], s: k.s, x: bx0, y: by0, w: bw, h: bh, data });
    }
  }
  return out;
}

/* ---- 모아서 칠할 곳 정하기 ---- */
const czSegKey = () => czCfg.model === 'precise' ? 'segM' : 'segN';
const czDetKey = () => 'deep' + (czCfg.small ? '+s' : '');
const czSegThr = () => clamp(0.3 * Math.pow(2, (50 - czCfg.sens) / 25), 0.08, 0.9);
const czWantSeg = c => (c === 'penis' && czCfg.male) || (c === 'vagina' && czCfg.female) || (c === 'anus' && czCfg.anus);
const czBoxKey = b => [b.x, b.y, b.w, b.h].map(v => Math.round(v)).join(',');
const czCheckSig = () => JSON.stringify([czCfg.model, czCfg.sens, czCfg.male, czCfg.female, czCfg.anus, czCfg.small, czCfg.shape, czCfg.size, czOccOn()]);
const czNewState = (W, H, padPx) => ({ W, H, padPx, cands: {}, segi: {}, zoom: new Map(), occ: {}, sam: new Map(), extra: [], checkSig: '' });
function czMergeBoxes(list) { // 겹친 상자는 하나로
  const box = list.slice().sort((a, b) => (b.s || 0) - (a.s || 0));
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < box.length && !again; i++) for (let j = i + 1; j < box.length; j++) {
      const a = box[i], b = box[j], ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix * iy > 0.3 * Math.min(a.w * a.h, b.w * b.h)) { const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y); box[i] = { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0, s: Math.max(a.s || 0, b.s || 0) }; box.splice(j, 1); again = true; break; }
    }
  }
  return box;
}
// 분할 조각은 탐지 모델도 그 자리를 (낮은 점수라도) 봤을 때만 써요 (배경·둥근 물건 오탐 거르기). 아주 확실하거나 항문(탐지 모델이 모름)은 예외
const czSegSure = () => clamp(0.9 * Math.pow(2, (50 - czCfg.sens) / 25), 0.2, 0.97);
function czSegOk(st, q) {
  if (q.s >= czSegSure() || q.c === 'anus') return true;
  const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
  return (st.cands[czDetKey()] || []).some(b => Math.max(b.sc.penis || 0, b.sc.pussy || 0) >= 0.08 &&
    ((cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) || czIou(b, q) > 0.2));
}
// 가까이 보기: 분할 모양이 탐지 상자를 별로 못 채웠으면(35% 미만) 그 둘레를 잘라 작은 분할 모델로 한 번 더 봐요
// (빠르게에서 고환 같은 부분을 놓칠 때). 손을 덜 덮는 작은 모델을 쓰고, 결과는 탐지 상자 안쪽만 써요
const czZoomBoxes = st => { if (!czContour()) return []; const base = czSegBase(st); return czDetBoxes(st).filter(b => czBoxCover(base, b) < 0.35); };
const czZoomKey = b => 'segN|' + czBoxKey(b);
function czBoxCover(insts, b) { // 상자 안에서 조각들이 덮은 비율
  const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y)), w = Math.max(1, Math.ceil(b.x + b.w) - x0), h = Math.max(1, Math.ceil(b.y + b.h) - y0), m = new Uint8Array(w * h);
  for (const q of insts) for (let y = 0; y < q.h; y++) { const yy = y + q.y - y0; if (yy < 0 || yy >= h) continue; for (let x = 0; x < q.w; x++) { const xx = x + q.x - x0; if (xx >= 0 && xx < w && q.data[y * q.w + x]) m[yy * w + xx] = 1; } }
  let n = 0; for (let i = 0; i < w * h; i++) n += m[i]; return n / (w * h);
}
function czZoomTile(st, b) {
  const side = Math.max(Math.max(b.w, b.h) * 1.6, 400), tw = Math.min(st.W, Math.round(side)), th = Math.min(st.H, Math.round(side));
  return [Math.round(clamp(b.x + b.w / 2 - tw / 2, 0, st.W - tw)), Math.round(clamp(b.y + b.h / 2 - th / 2, 0, st.H - th)), tw, th];
}
function czSegAll(st) { // 전체 그림에서 딴 조각 + 지금 상자들을 가까이 보고 딴 조각
  const out = (st.segi[czSegKey()] || []).slice();
  for (const b of czZoomBoxes(st)) out.push(...(st.zoom.get(czZoomKey(b)) || []));
  return out;
}
const czOccKey = st => czSegKey() + '#' + czZoomBoxes(st).map(czBoxKey).join(';');
// 점수가 낮아도, 탐지 모델이 확실히 찾은 상자 안에 있는 조각은 써요 (몸에 가려 따로 떨어진 끝부분 등)
function czInPicked(st, q) { // 조각의 80% 이상이 탐지 상자(15% 넓힘) 안에 있어야 (손·팔까지 번진 조각은 빼요)
  let n = 0; for (let i = 0; i < q.data.length; i++) n += q.data[i];
  return n > 0 && czDetBoxes(st).some(b => {
    const ex = 0.15, x0 = b.x - b.w * ex, x1 = b.x + b.w * (1 + ex), y0 = b.y - b.h * ex, y1 = b.y + b.h * (1 + ex); let k = 0;
    for (let y = 0; y < q.h; y++) { const gy = y + q.y + 0.5; if (gy < y0 || gy > y1) continue; for (let x = 0; x < q.w; x++) { const gx = x + q.x + 0.5; if (q.data[y * q.w + x] && gx >= x0 && gx <= x1) k++; } }
    return k >= 0.8 * n;
  });
}
const czSegPass = (st, q) => czWantSeg(q.c) && (q.s >= czSegThr() ? czSegOk(st, q) : q.c !== 'anus' && q.s >= czSegThr() / 3 && czInPicked(st, q));
const czSegBase = st => (st.segi[czSegKey()] || []).filter(q => czSegPass(st, q));
const czSegUse = st => czSegAll(st).filter(q => czSegPass(st, q));

/* ---- 겹친 검은 장갑·물건 빼기 ----
   분할 모양 안에 무채색으로 아주 어두운 두툼한 덩어리(검은 장갑 등)가 있으면, 그 안쪽 한 점을 MobileSAM에 '이것'으로,
   밝은 쪽(성기)을 '이것 아님'으로 알려 주고 그 물건 모양을 따서 칠할 곳에서 빼요. 그늘진 피부는 색이 있어서 걸리지 않아요. */
const czOccOn = () => czContour() && czCfg.glove;
function czErode(src, W, H, r) { const inv = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) inv[i] = src[i] ? 0 : 1; const d = czDilate(inv, W, H, r); for (let i = 0; i < W * H; i++) inv[i] = d[i] ? 0 : 1; return inv; }
function czLargest(bin, W, H) { // 가장 큰 덩어리 (8방향 연결) → {n, bin}
  const lab = new Int32Array(W * H), stack = []; let best = 0, bestN = 0, id = 0;
  for (let i = 0; i < W * H; i++) {
    if (!bin[i] || lab[i]) continue;
    id++; let n = 0; lab[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop(), px = p % W, py = (p - px) / W; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue; const q = qy * W + qx; if (bin[q] && !lab[q]) { lab[q] = id; stack.push(q); } }
    }
    if (n > bestN) { bestN = n; best = id; }
  }
  if (!best) return null;
  const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) out[i] = lab[i] === best ? 1 : 0;
  return { n: bestN, bin: out };
}
function czDeepest(bin, W, H) { // 가장자리에서 가장 먼 칸 → [번호, 깊이]
  const d = new Int32Array(W * H), at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : d[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bin[y * W + x]) d[y * W + x] = 1 + Math.min(at(x - 1, y), at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1));
  let bi = -1, bd = 0;
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!bin[i]) continue; d[i] = Math.min(d[i], 1 + Math.min(at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1))); if (d[i] > bd) { bd = d[i]; bi = i; } }
  return [bi, bd];
}
function czNeutralDark(px, n) { const nd = new Uint8Array(n); for (let i = 0, j = 0; i < n; i++, j += 4) { const r = px[j], g = px[j + 1], b = px[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (0.299 * r + 0.587 * g + 0.114 * b < 70 && mx - mn < 0.25 * Math.max(mx, 1)) nd[i] = 1; } return nd; }
function czOccSeed(cv, q, scale) { // 분할 조각 하나 → {seed, neg} (캔버스 좌표) 또는 null
  const w = q.w, h = q.h, n = w * h; let area = 0; for (let i = 0; i < n; i++) area += q.data[i];
  if (area < 300) return null;
  const px = cv.getContext('2d', { willReadFrequently: true }).getImageData(q.x, q.y, w, h).data, nd = czNeutralDark(px, n);
  let col = 0; // 흑백 그림(만화 등)은 성기 그늘도 무채색이라 헷갈려요 → 성기 모양 안에 색 있는 칸이 넉넉할 때만
  for (let i = 0, j = 0; i < n; i++, j += 4) { if (!q.data[i]) continue; const mx = Math.max(px[j], px[j + 1], px[j + 2]); if (mx >= 30 && mx - Math.min(px[j], px[j + 1], px[j + 2]) >= 0.2 * mx) col++; }
  if (col < area * 0.25) return null;
  const r = Math.max(1, Math.round(scale)), op = czDilate(czErode(nd, w, h, r), w, h, r); // 얇은 선(그림 윤곽선)은 빼고
  for (let i = 0; i < n; i++) op[i] = op[i] && q.data[i] ? 1 : 0;
  const blob = czLargest(op, w, h); if (!blob || blob.n < area * 0.06) return null;
  const [bi, bd] = czDeepest(blob.bin, w, h); if (bd < Math.max(4, 0.06 * Math.sqrt(area))) return null; // 두툼해야 물건
  const near = czDilate(nd, w, h, Math.max(3, Math.round(6 * scale))), rest = new Uint8Array(n), neg = [];
  for (let i = 0; i < n; i++) rest[i] = q.data[i] && !near[i] ? 1 : 0;
  for (let k = 0; k < 2; k++) {
    const c = czLargest(rest, w, h); if (!c || c.n < area * 0.03) break;
    const [j] = czDeepest(c.bin, w, h); neg.push([q.x + j % w + 0.5, q.y + Math.floor(j / w) + 0.5]);
    for (let i = 0; i < n; i++) if (c.bin[i]) rest[i] = 0;
  }
  return { q, area, seed: [q.x + bi % w + 0.5, q.y + Math.floor(bi / w) + 0.5], neg };
}
function czOccFind(cv, st, tk) {
  const job = cz.samQ.then(() => czOccRun(cv, st, tk));
  cz.samQ = job.catch(() => { }); return job;
}
async function czOccRun(cv, st, tk) { // → 뺄 물건 비트맵 목록
  const W = cv.width, H = cv.height, scale = Math.max(W, H) / 1200, out = [];
  const insts = czSegAll(st).filter(q => q.c !== 'anus' && q.s >= 0.1).sort((a, b) => b.s - a.s).slice(0, 8);
  const jobs = []; for (const q of insts) { const j = czOccSeed(cv, q, scale); if (j) jobs.push(j); }
  if (!jobs.length) return out;
  await czLoad('samE'); await czLoad('samD');
  let enc = '';
  for (const jb of jobs) {
    if (tk && tk.stop) throw new Error('stop');
    if (out.some(o => czBmHas(o, jb.seed))) continue; // 이미 딴 물건 안의 점이면 넘어가요
    const q = jb.q; let rx = 0, ry = 0, rw = W, rh = H;
    if (Math.max(W, H) > 1536) { const side = Math.max(320, Math.max(q.w, q.h) * 2.4); rw = Math.min(W, Math.round(side)); rh = Math.min(H, Math.round(side)); rx = Math.floor(clamp(q.x + q.w / 2 - rw / 2, 0, W - rw)); ry = Math.floor(clamp(q.y + q.h / 2 - rh / 2, 0, H - rh)); }
    const s = 1024 / Math.max(rw, rh), key = [rx, ry, rw, rh].join(',');
    if (enc !== key) {
      const tw = Math.max(1, Math.round(rw * s)), th = Math.max(1, Math.round(rh * s)), c = newCanvas(tw, th), gc = c.getContext('2d', { willReadFrequently: true });
      gc.imageSmoothingQuality = 'high'; gc.drawImage(cv, rx, ry, rw, rh, 0, 0, tw, th);
      const px = gc.getImageData(0, 0, tw, th).data, x = new Float32Array(tw * th * 3);
      for (let i = 0, j = 0, n = tw * th; i < n; i++, j += 4) { x[i * 3] = px[j]; x[i * 3 + 1] = px[j + 1]; x[i * 3 + 2] = px[j + 2]; }
      cz.samEnc = ''; await czCall({ t: 'run2', key: 'samE', feeds: { input_image: { data: x, dims: [th, tw, 3] } }, keep: ['image_embeddings'], outs: [] }, [x.buffer]);
      enc = key;
    }
    const pts = [jb.seed].concat(jb.neg), pc = new Float32Array(pts.length * 2);
    pts.forEach(([x, y], i) => { pc[i * 2] = (x - rx) * s; pc[i * 2 + 1] = (y - ry) * s; });
    const r = await czCall({ t: 'run2', key: 'samD', outs: ['masks'], feeds: {
      image_embeddings: { ref: 'image_embeddings' },
      point_coords: { data: pc, dims: [1, pts.length, 2] }, point_labels: { data: new Float32Array(pts.map((_, i) => i ? 0 : 1)), dims: [1, pts.length] }, // 1 = 이것, 0 = 이것 아님
      mask_input: { data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] }, has_mask_input: { data: new Float32Array([0]), dims: [1] },
      orig_im_size: { data: new Float32Array([rh, rw]), dims: [2] } } });
    const bm = czOccPick(cv, r.out.masks.data, r.out.masks.dims[1] || 1, rx, ry, rw, rh, jb);
    if (bm) out.push(bm);
  }
  return out;
}
const czBmHas = (b, [x, y]) => { const ix = Math.floor(x - b.x), iy = Math.floor(y - b.y); return ix >= 0 && iy >= 0 && ix < b.w && iy < b.h && !!b.data[iy * b.w + ix]; };
// 후보 모양 중: 점을 품고, 대부분 무채색으로 어둡고, 분할 조각을 통째로 먹지 않는 것 → 가장 큰 것 (분할 조각 둘레 범위만)
function czOccPick(cv, m, nm, rx, ry, rw, rh, jb) {
  const q = jb.q, ex = 0.5, x0 = Math.max(0, Math.floor(q.x - q.w * ex - rx)), y0 = Math.max(0, Math.floor(q.y - q.h * ex - ry));
  const x1 = Math.min(rw, Math.ceil(q.x + q.w * (1 + ex) - rx)), y1 = Math.min(rh, Math.ceil(q.y + q.h * (1 + ex) - ry)), w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) return null;
  const nd = czNeutralDark(cv.getContext('2d', { willReadFrequently: true }).getImageData(rx + x0, ry + y0, w, h).data, w * h);
  const sx = Math.floor(jb.seed[0] - rx - x0), sy = Math.floor(jb.seed[1] - ry - y0), plane = rw * rh;
  let best = -1, bestA = 0;
  for (let k = 0; k < nm; k++) {
    const off = k * plane; if (sx < 0 || sy < 0 || sx >= w || sy >= h || !(m[off + (sy + y0) * rw + sx + x0] > 0)) continue;
    let a = 0, dk = 0, ov = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!(m[off + (y + y0) * rw + x + x0] > 0)) continue;
      a++; dk += nd[y * w + x];
      const gx = x + x0 + rx - q.x, gy = y + y0 + ry - q.y; if (gx >= 0 && gy >= 0 && gx < q.w && gy < q.h && q.data[gy * q.w + gx]) ov++;
    }
    if (dk < a * 0.45 || a > jb.area * 1.5 || ov > jb.area * 0.75) continue;
    if (a > bestA) { bestA = a; best = k; }
  }
  if (best < 0) return null;
  const data = new Uint8Array(w * h), off = best * plane;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[off + (y + y0) * rw + x + x0] > 0) data[y * w + x] = 1;
  return { x: rx + x0, y: ry + y0, w, h, data };
}
const czDetBoxes = st => czPick(st.cands[czDetKey()] || []);
function czSamBoxes(st) { return czContour() ? czDetBoxes(st).concat(st.extra) : []; }
function czMissing(st) {
  if (!st.cands[czDetKey()]) return 'det';
  if (!st.segi[czSegKey()]) return 'seg';
  if (czZoomBoxes(st).some(b => !st.zoom.has(czZoomKey(b)))) return 'zoom';
  if (czOccOn() && !st.occ[czOccKey(st)]) return 'occ';
  if (czSamBoxes(st).some(b => !st.sam.has(czBoxKey(b)))) return 'sam';
  if (st.checkSig !== czCheckSig()) return 'check';
  return '';
}
function czBlit(M, W, H, bm) { for (let y = 0; y < bm.h; y++) { const gy = y + bm.y; if (gy < 0 || gy >= H) continue; for (let x = 0; x < bm.w; x++) { if (!bm.data[y * bm.w + x]) continue; const gx = x + bm.x; if (gx >= 0 && gx < W) M[gy * W + gx] = 1; } } }
function czEllipseInto(M, W, H, b) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = Math.max(1, b.w / 2), ry = Math.max(1, b.h / 2); for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(H, Math.ceil(cy + ry)); y++) { const dy = (y + 0.5 - cy) / ry, hw = rx * Math.sqrt(Math.max(0, 1 - dy * dy)); for (let x = Math.max(0, Math.floor(cx - hw)); x < Math.min(W, Math.ceil(cx + hw)); x++) M[y * W + x] = 1; } }
function czDilate(src, W, H, r) { // 네모 모양으로 r만큼 넓히기 (가로 → 세로)
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let run = 0; const o = y * W; for (let x = 0; x < Math.min(W, r); x++) run += src[o + x]; for (let x = 0; x < W; x++) { if (x + r < W) run += src[o + x + r]; if (x - r - 1 >= 0) run -= src[o + x - r - 1]; tmp[o + x] = run > 0 ? 1 : 0; } }
  for (let x = 0; x < W; x++) { let run = 0; for (let y = 0; y < Math.min(H, r); y++) run += tmp[y * W + x]; for (let y = 0; y < H; y++) { if (y + r < H) run += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) run -= tmp[(y - r - 1) * W + x]; out[y * W + x] = run > 0 ? 1 : 0; } }
  return out;
}
// 윤곽 모드: 분할 모델 모양 + (그 둘레에서만) MobileSAM 모양으로 빈 곳 메우기 + 분할 모델이 못 찾은 곳은 MobileSAM/타원
function czComposeMask(st) {
  const W = st.W, H = st.H, seg = new Uint8Array(W * H);
  for (const q of czSegUse(st)) czBlit(seg, W, H, q);
  const M = seg.slice(), boxes = czDetBoxes(st);
  let near = null;
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y)), x1 = Math.min(W, Math.ceil(b.x + b.w)), y1 = Math.min(H, Math.ceil(b.y + b.h));
    let ov = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ov += seg[y * W + x];
    const sb = st.sam.get(czBoxKey(b));
    if (ov > 0.08 * Math.max(1, (x1 - x0) * (y1 - y0))) {
      if (!sb) continue;
      if (!near) near = czDilate(seg, W, H, Math.max(3, Math.round(Math.max(W, H) * 0.015)));
      for (let y = 0; y < sb.h; y++) for (let x = 0; x < sb.w; x++) { const gx = x + sb.x, gy = y + sb.y; if (sb.data[y * sb.w + x] && gx >= 0 && gy >= 0 && gx < W && gy < H && near[gy * W + gx]) M[gy * W + gx] = 1; }
    } else if (sb) czBlit(M, W, H, sb);
    else czEllipseInto(M, W, H, czGrow(b, 5));
  }
  for (const b of st.extra) { const sb = st.sam.get(czBoxKey(b)); if (sb) czBlit(M, W, H, sb); else czEllipseInto(M, W, H, czGrow(b, 5)); }
  const occ = czOccOn() ? st.occ[czOccKey(st)] || [] : [];
  if (occ.length) { // 겹친 검은 물건은 빼요 (물건 테두리 선까지), 그 둘레에 가늘게 남은 부스러기도 정리
    const O = new Uint8Array(W * H), sc = Math.max(W, H) / 1200; for (const o of occ) czBlit(O, W, H, o);
    const OD = czDilate(O, W, H, Math.max(2, Math.round(2 * sc))); for (let i = 0; i < W * H; i++) if (OD[i]) M[i] = 0;
    const r = Math.max(2, Math.round(3 * sc)), open = czDilate(czErode(M, W, H, r), W, H, r), zone = czDilate(OD, W, H, r * 3);
    for (let i = 0; i < W * H; i++) if (zone[i] && !open[i]) M[i] = 0;
  }
  return M;
}
// 비트맵 → 조각마다 바깥 윤곽 다각형 (구멍은 메워요)
function czMaskToPolys(M, W, H) {
  const lab = new Int32Array(W * H), polys = [], st = [], minA = Math.max(12, W * H * 0.00002);
  let id = 0;
  for (let i = 0; i < W * H; i++) {
    if (!M[i] || lab[i]) continue;
    id++; let n = 0; lab[i] = id; st.push(i);
    while (st.length) {
      const p = st.pop(), px = p % W, py = (p - px) / W; n++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue; const q = qy * W + qx; if (M[q] && !lab[q]) { lab[q] = id; st.push(q); } }
    }
    if (n < minA) continue;
    const sx = i % W, sy = (i - sx) / W;
    let pts = czTrace(lab, W, H, id, sx, sy);
    pts = pts.length < 3 ? [[sx - 0.5, sy - 0.5], [sx + 0.5, sy - 0.5], [sx + 0.5, sy + 0.5], [sx - 0.5, sy + 0.5]] : czRdp(pts, 0.8);
    if (pts.length >= 3) polys.push(pts.map(([x, y]) => [x + 0.5, y + 0.5]));
  }
  return polys;
}
// 지금 설정으로 칠할 모양들 (캔버스 좌표). 윤곽: {poly}, 타원: {e: {x,y,w,h}}
function czShapes(st) {
  if (czContour()) return czMaskToPolys(czComposeMask(st), st.W, st.H).map(poly => ({ poly }));
  const minR = Math.max(st.W, st.H) / 200;
  const boxes = czMergeBoxes(czDetBoxes(st).concat(czSegUse(st).map(q => ({ x: q.x, y: q.y, w: q.w, h: q.h, s: q.s })), st.extra));
  return boxes.map(b => ({ e: czGrow(b, minR) }));
}
const czDrawable = sh => sh.poly ? czPolyBox([sh.poly]) : sh.e; // 그리기 함수(czDrawShapes)가 쓰는 꼴로
// 다 칠한 뒤 다시 확인: 칠한 그림을 한 번 더 찾아보고, 아직 보이는 곳이 있으면 그 상자를 돌려줘요
async function czRecheck(cv, st, tk) {
  const c2 = newCanvas(st.W, st.H), g = c2.getContext('2d', { willReadFrequently: true });
  const shapes = czShapes(st);
  g.drawImage(cv, 0, 0); czDrawShapes(g, shapes.map(czDrawable), 1, 0, 0, czContour() ? st.padPx : 0, 0, '#ffffff');
  const left = czPick(await czDetect(c2, 'deep', tk));
  if (!left.length) return left;
  // 칠한 자국 둘레를 성기로 착각하는 일이 있어서: 점수가 넉넉하거나, 아직 안 칠한 분할 조각이 그 상자 안에 있을 때만 믿어요
  const W = st.W, H = st.H, M = czContour() ? czComposeMask(st) : new Uint8Array(W * H);
  if (!czContour()) for (const sh of shapes) czEllipseInto(M, W, H, sh.e);
  const segs = czSegAll(st).filter(q => czWantSeg(q.c) && q.s >= 0.1), strong = 2 * czThr('deep');
  const residual = q => { let n = 0, out = 0; for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) if (q.data[y * q.w + x]) { n++; const gx = x + q.x, gy = y + q.y; if (gx >= 0 && gy >= 0 && gx < W && gy < H && !M[gy * W + gx]) out++; } return n > 0 && out >= 0.3 * n; };
  return left.filter(b => b.s >= strong || segs.some(q => { const cx = q.x + q.w / 2, cy = q.y + q.h / 2; return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h && residual(q); }));
}
// 캔버스 한 장 분석: 빠진 단계만 차례로 (st에 보관해서 설정을 바꾸면 다시 쓰기)
async function czAnalyze(cv, st, tk, say) {
  say = say || (() => { });
  for (let step = czMissing(st), guard = 0; step && guard < 12; step = czMissing(st), guard++) {
    if (tk && tk.stop) throw new Error('stop');
    if (step === 'det') { say('찾는 중…'); st.cands[czDetKey()] = await czDetect(cv, 'deep', tk); }
    else if (step === 'seg') { say('모양 보는 중…'); st.segi[czSegKey()] = await czSegDetect(cv, czSegKey(), tk); }
    else if (step === 'zoom') {
      say('가까이 보는 중…');
      for (const b of czZoomBoxes(st)) {
        const zk = czZoomKey(b); if (st.zoom.has(zk)) continue;
        const res = await czSegDetect(cv, 'segN', tk, [czZoomTile(st, b)], 640), ex = 0.1; // 상자 근처 조각만, 상자(10% 넓힘) 밖은 잘라요
        const X0 = b.x - b.w * ex, X1 = b.x + b.w * (1 + ex), Y0 = b.y - b.h * ex, Y1 = b.y + b.h * (1 + ex);
        st.zoom.set(zk, res.filter(q => { const cx = q.x + q.w / 2, cy = q.y + q.h / 2; return cx >= X0 && cx <= X1 && cy >= Y0 && cy <= Y1; }).map(q => {
          const data = q.data.slice(); for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) { const gx = x + q.x + 0.5, gy = y + q.y + 0.5; if (gx < X0 || gx > X1 || gy < Y0 || gy > Y1) data[y * q.w + x] = 0; }
          return { ...q, data };
        }));
      }
    }
    else if (step === 'occ') { say('겹친 물건 보는 중…'); st.occ[czOccKey(st)] = await czOccFind(cv, st, tk); }
    else if (step === 'sam') {
      say('윤곽 따는 중…');
      const need = czSamBoxes(st).filter(b => !st.sam.has(czBoxKey(b))), res = await czSamUnion(cv, need, tk);
      need.forEach((b, i) => st.sam.set(czBoxKey(b), res[i] || 0)); // 0 = 못 땀 (타원으로)
    } else if (step === 'check') {
      say('다시 확인하는 중…');
      const sig = czCheckSig(); st.extra = [];
      const left = await czRecheck(cv, st, tk);
      st.extra = left; st.checkSig = sig;
    }
  }
}
function czTrace(lab, w, h, id, sx, sy) { // 무어 이웃 따라가기 (바깥 윤곽, 시계 방향)
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const inn = (x, y) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === id;
  const pts = [[sx, sy]]; let cx = sx, cy = sy, bd = 4, first = null;
  for (let guard = 0; guard < 4 * w * h + 16; guard++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (bd + k) % 8, nx = cx + D[d][0], ny = cy + D[d][1];
      if (!inn(nx, ny)) continue;
      const pd = (bd + k + 7) % 8, ox = cx + D[pd][0] - nx, oy = cy + D[pd][1] - ny;
      bd = D.findIndex(v => v[0] === ox && v[1] === oy); cx = nx; cy = ny; moved = true; break;
    }
    if (!moved || bd < 0) break;
    if (first === null) first = [cx, cy];
    else { const l = pts[pts.length - 1]; if (l[0] === sx && l[1] === sy && cx === first[0] && cy === first[1]) { pts.pop(); break; } }
    pts.push([cx, cy]);
  }
  return pts;
}
function czRdp(pts, eps) { // 점 줄이기 (닫힌 도형)
  const n = pts.length; if (n < 5) return pts;
  const P = pts.concat([pts[0]]), keep = new Uint8Array(n + 1); keep[0] = keep[n] = 1;
  let far = 1, fd = -1; for (let i = 1; i < n; i++) { const d = (P[i][0] - P[0][0]) ** 2 + (P[i][1] - P[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  keep[far] = 1; const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, c] = stack.pop(); if (c - a < 2) continue;
    const ax = P[a][0], ay = P[a][1], bx = P[c][0], by = P[c][1], L = Math.hypot(bx - ax, by - ay);
    let md = 0, mi = -1;
    for (let i = a + 1; i < c; i++) { const d = L > 1e-6 ? Math.abs((bx - ax) * (ay - P[i][1]) - (ax - P[i][0]) * (by - ay)) / L : Math.hypot(P[i][0] - ax, P[i][1] - ay); if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, c]); }
  }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i]); return out;
}
// 다각형들(같은 좌표계) → 감싸는 상자 + 상자 기준 0~1 좌표
function czPolyBox(polys) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const pl of polys) for (const [x, y] of pl) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), q = v => Math.round(v * 10000) / 10000;
  return { x: x0, y: y0, w, h, poly: polys.map(pl => pl.map(([x, y]) => [q((x - x0) / w), q((y - y0) / h)])) };
}

/* ---- 진행 창 ---- */
function czProgress(title) {
  const tk = { stop: false };
  const m = modal(`<h2>${title}</h2><p class="sub" id="czPMsg">준비하는 중…</p><div class="czbar"><i id="czPBar"></i></div>
    <p class="muted small" id="czPDev">처음 한 번은 탐지 모델을 푸느라 몇 초 더 걸려요.</p>
    <div class="foot"><button class="btn" id="czPStop">멈추기</button></div>`);
  $('#czPStop', m).addEventListener('click', () => { tk.stop = true; closeModal(); });
  tk.set = (msg, f) => {
    if (!m.isConnected) { tk.stop = true; return; }
    if (msg) $('#czPMsg', m).textContent = msg;
    if (f !== undefined) $('#czPBar', m).style.width = Math.round(clamp(f, 0, 1) * 100) + '%';
    const d = czDevText(); if (d) $('#czPDev', m).textContent = d;
  };
  tk.done = () => { if (m.isConnected) closeModal(); };
  return tk;
}

/* ---- 편집기 페이지에서 자동 흰칠 ---- */
function panelClip(ctx, P) { // 지금 변환 기준으로 컷 모양만큼 잘라 두기 (변환은 그대로 돌려놔요)
  const m = ctx.getTransform();
  ctx.translate(P.x + P.w / 2, P.y + P.h / 2); if (P.rot) ctx.rotate(P.rot * DEG);
  applyClips(ctx, P);
  ctx.beginPath(); roundRectPath(ctx, -P.w / 2, -P.h / 2, P.w, P.h, Math.min(P.radius || 0, P.w / 2, P.h / 2)); ctx.clip();
  ctx.setTransform(m);
}
const czLinked = (els, ids) => els.filter(e => e.type === 'fx' && e.inPanel && ids.has(e.inPanel));
function czFxEl(b, panelId) {
  return { id: uid(), type: 'fx', kind: 'paint', str: doc.defaults.fx.str, color: czCfg.color, soft: czCfg.soft, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), rot: 0, s0: Math.sqrt(b.w * b.h), strokes: [], shapes: [[0.5, 0.5, 0.5, 0.5]], auto: true, inPanel: panelId };
}
function czPolyEl(polys, panelId) { // 윤곽 다각형(페이지 좌표) → 가리기 요소
  const b = czPolyBox(polys);
  return { id: uid(), type: 'fx', kind: 'paint', str: doc.defaults.fx.str, color: czCfg.color, soft: czCfg.soft, pad: czCfg.pad, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h), rot: 0, s0: Math.sqrt(b.w * b.h), strokes: [], shapes: [], polys: b.poly, auto: true, inPanel: panelId };
}
async function czRunPage(onlySel) {
  if (mode) setMode(null);
  const pg = page();
  let panels = pg.els.filter(e => e.type === 'panel' && layerCount(e) > 0);
  if (onlySel) { const s = new Set(sel); panels = panels.filter(e => s.has(e.id)); }
  if (!panels.length) { toast(onlySel ? '고른 것 중에 그림이 들어간 컷이 없어요. 컷을 먼저 골라 주세요.' : '이 페이지에는 그림이 들어간 컷이 없어요.', 3200); return; }
  if (!(await czPacksReady())) return;
  const tk = czProgress('자동 흰칠하는 중');
  const ids = new Set(panels.map(e => e.id)), old = pg.els.filter(e => e.type === 'fx' && e.auto && ids.has(e.inPanel));
  const keepEls = pg.els.slice();
  try {
    await document.fonts.ready;
    tk.set('모델 준비하는 중…', 0);
    for (const k of ['deep', czSegKey()].concat(czContour() ? ['samE', 'samD'] : [])) { await czLoad(k); if (tk.stop) throw new Error('stop'); }
    pg.els = pg.els.filter(e => !old.includes(e)); // 전에 자동으로 칠한 것은 지우고 새로 찾아요 (찾을 때 가려지지 않게)
    const made = [], found = await czFindOnPage(pg, panels, tk, (pi, msg, f) => tk.set(`컷 ${pi + 1} / ${panels.length} ${msg}`, (pi + f) / panels.length));
    if (tk.stop) throw new Error('stop');
    tk.done();
    for (const [P, els] of found) { pg.els.splice(pg.els.indexOf(P) + 1, 0, ...els); made.push(...els); } // 컷 바로 위에 (말풍선은 그 위로)
    sel = made.map(e => e.id); commit(); renderProps(); requestRender();
    if (made.length) toast(`${made.length}곳을 흰칠했어요. 잘못 칠한 곳은 '가리기'의 지우개로 지우고, 빠진 곳은 '가리기'로 칠하세요.`, 5200);
    else toast(old.length ? '이번에는 찾은 곳이 없어서 전에 칠한 자동 흰칠을 지웠어요.' : "가릴 곳을 찾지 못했어요. 놓친 것 같으면 '자동 흰칠 설정'에서 민감도를 올려 보세요.", 4800);
  } catch (e) {
    tk.done();
    pg.els = keepEls; // 하던 것을 모두 되돌려요
    requestRender();
    if (String(e && e.message) !== 'stop') toast(czErrText(e), 6000); else toast('멈췄어요');
  }
}
// 한 페이지에서 컷마다 찾아서 → [[컷, 흰칠 요소들], ...]
async function czFindOnPage(pg, panels, tk, prog) {
    const found = [];
    for (let pi = 0; pi < panels.length; pi++) {
      const P = panels[pi], b = aabb(P), x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(pg.w, b.x + b.w), y1 = Math.min(pg.h, b.y + b.h);
      const bw = x1 - x0, bh = y1 - y0; if (bw < 8 || bh < 8) continue;
      const s = Math.min(clamp(640 / Math.min(bw, bh), 1, 2), 6000 / Math.max(bw, bh));
      const c = newCanvas(bw * s, bh * s), g = c.getContext('2d', { willReadFrequently: true });
      g.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
      drawPage(g, pg, { screen: false, rs: s, view: { x0, y0, x1, y1 } });
      const mk = newCanvas(c.width, c.height), gm = mk.getContext('2d'); // 이 컷 바깥은 하얗게 (옆 컷을 잘못 찾지 않게)
      gm.setTransform(s, 0, 0, s, -x0 * s, -y0 * s); panelClip(gm, P); gm.fillStyle = '#000'; gm.fillRect(x0, y0, bw, bh);
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-in'; g.drawImage(mk, 0, 0);
      g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.globalCompositeOperation = 'source-over';
      const st = czNewState(c.width, c.height, czCfg.pad * s), steps = ['찾는 중…', '모양 보는 중…', '윤곽 따는 중…', '다시 확인하는 중…'];
      await czAnalyze(c, st, tk, msg => prog(pi, msg, Math.max(0, steps.indexOf(msg)) / steps.length));
      const toPage = ([x, y]) => [x0 + x / s, y0 + y / s];
      const els = czShapes(st).map(sh => sh.poly ? czPolyEl([sh.poly.map(toPage)], P.id) : czFxEl({ x: x0 + sh.e.x / s, y: y0 + sh.e.y / s, w: sh.e.w / s, h: sh.e.h / s }, P.id));
      if (els.length) found.push([P, els]);
    }
    return found;
}
// 여러 그림(페이지)을 한꺼번에: 이미지 편집의 '모든 그림', '이 폴더'
async function czRunPages(idxs, title) {
  if (mode) setMode(null);
  idxs = idxs.filter(i => doc.pages[i] && !doc.pages[i].ph && doc.pages[i].els.some(e => e.type === 'panel' && layerCount(e) > 0));
  if (!idxs.length) { toast('흰칠할 그림이 없어요'); return; }
  if (!(await czPacksReady())) return;
  const tk = czProgress(title || '여러 그림 자동 흰칠하는 중'), backup = idxs.map(i => doc.pages[i].els.slice());
  let total = 0, hit = 0;
  try {
    await document.fonts.ready;
    tk.set('모델 준비하는 중…', 0);
    for (const k of ['deep', czSegKey()].concat(czContour() ? ['samE', 'samD'] : [])) { await czLoad(k); if (tk.stop) throw new Error('stop'); }
    for (let n = 0; n < idxs.length; n++) {
      if (tk.stop) throw new Error('stop');
      const pg = doc.pages[idxs[n]], panels = pg.els.filter(e => e.type === 'panel' && layerCount(e) > 0), ids = new Set(panels.map(e => e.id));
      pg.els = pg.els.filter(e => !(e.type === 'fx' && e.auto && ids.has(e.inPanel)));
      const found = await czFindOnPage(pg, panels, tk, (pi, msg, f) => tk.set(`${n + 1} / ${idxs.length}장 · ${msg}`, (n + (pi + f) / panels.length) / idxs.length));
      let c = 0; for (const [P, els] of found) { pg.els.splice(pg.els.indexOf(P) + 1, 0, ...els); c += els.length; }
      total += c; if (c) hit++;
    }
    if (tk.stop) throw new Error('stop');
    tk.done(); sel = []; commit(); renderProps(); requestRender(); renderLib();
    toast(total ? `${idxs.length}장 중 ${hit}장에서 ${total}곳을 흰칠했어요. 한 장씩 넘겨 보며 확인해 주세요.` : '가릴 곳을 찾지 못했어요.', 5200);
  } catch (e) {
    tk.done(); idxs.forEach((i, k) => { doc.pages[i].els = backup[k]; }); requestRender();
    if (String(e && e.message) !== 'stop') toast(czErrText(e), 6000); else toast('멈췄어요. 칠하던 것은 모두 되돌렸어요.', 3200);
  }
}
function czClearPage() {
  const pg = page(), n = pg.els.filter(e => e.type === 'fx' && e.auto).length;
  if (!n) { toast('이 페이지에 자동으로 칠한 흰칠이 없어요'); return; }
  pg.els = pg.els.filter(e => !(e.type === 'fx' && e.auto)); sel = []; commit(); renderProps(); requestRender();
  toast(`자동 흰칠 ${n}개를 지웠어요. 손으로 칠한 가리기는 그대로예요.`);
}

/* ---- 설정 (설정 창과 여러 장 화면이 같이 써요) ---- */
function czCfgHtml(inStudio) {
  const C = czCfg;
  return `<div class="czmodels">${CZ_PICKS.map(([v, l, d]) => `<button class="preset ${C.model === v ? 'on' : ''}" data-zc="model" data-v="${v}"><b>${l}</b><span>${d}</span></button>`).join('')}</div>
    ${row('민감도', `<input type="range" data-zc="sens" min="0" max="100" step="1" value="${C.sens}" aria-label="민감도">`)}
    <div class="czscale"><span>확실한 것만</span><span>보통</span><span>놓치지 않게</span></div>
    ${row('모양', `<div class="seg"><button class="btn sm ${czContour() ? 'on' : ''}" data-zc="shape" data-v="contour" title="찾은 곳의 실제 모양을 따라 칠해요">윤곽 따라</button><button class="btn sm ${czContour() ? '' : 'on'}" data-zc="shape" data-v="ellipse" title="찾은 곳에 타원을 얹어요. 더 빨라요">타원</button></div>`)}
    ${czContour() ? row('윤곽 여유', `<input type="range" data-zc="pad" min="0" max="16" step="1" value="${C.pad}" aria-label="윤곽 여유"> <span class="muted small" id="czPadL">${C.pad}</span>`)
      : row('흰칠 크기', `<input type="range" data-zc="size" min="70" max="160" step="5" value="${C.size}" aria-label="흰칠 크기"> <span class="muted small" id="czSizeL">${C.size}%</span>`)}
    ${row('가릴 곳', `<div class="radios"><label class="chk"><input type="checkbox" data-zc="male" ${C.male ? 'checked' : ''}> 남성 성기</label><label class="chk"><input type="checkbox" data-zc="female" ${C.female ? 'checked' : ''}> 여성 성기</label><label class="chk" title="'정밀하게'에서 더 잘 찾아요"><input type="checkbox" data-zc="anus" ${C.anus ? 'checked' : ''}> 항문</label></div>`)}
    ${czContour() ? row('', `<label class="chk" title="성기를 쥔 검은 장갑처럼 무채색으로 어두운 물건이 겹쳐 있으면 그 부분은 빼고 칠해요"><input type="checkbox" data-zc="glove" ${C.glove ? 'checked' : ''}> 겹친 검은 장갑·물건은 빼고 칠하기</label>`) : ''}
    ${row('', `<label class="chk" title="멀리서 그린 장면처럼 작게 나온 부분을 더 잘 찾아요. 시간은 몇 배 걸려요."><input type="checkbox" data-zc="small" ${C.small ? 'checked' : ''}> 작게 나온 것도 꼼꼼히 (느려요)</label>`)}
    ${row('부드럽게', `<input type="range" data-zc="soft" min="0" max="24" step="1" value="${C.soft}" aria-label="가장자리 부드럽게"> <span class="muted small" id="czSoftL">${C.soft ? C.soft : '또렷하게'}</span>`)}
    ${row('칠할 색', `<input type="color" data-zc="color" value="${C.color}">`)}
    ${row('처리 장치', `<select data-zc="device"><option value="auto" ${C.device !== 'cpu' ? 'selected' : ''}>자동 (그래픽카드 먼저)</option><option value="cpu" ${C.device === 'cpu' ? 'selected' : ''}>CPU만</option></select>`)}
    <p class="muted small">${inStudio ? '민감도, 크기, 가릴 곳은 바로 반영돼요. 손으로 고친 그림은 그대로 둬요.' : '유두는 가리지 않아요. 다 칠한 뒤 한 번 더 찾아보고, 남은 곳이 있으면 그 자리도 덮어요. 결과가 이상하면 처리 장치를 CPU로 바꿔 보세요.'}${cz.ep ? ` 지금은 ${cz.ep === 'webgpu' ? '그래픽카드' : 'CPU'}로 처리하고 있어요.` : ''}</p>`;
}
function czCfgChange(t) {
  const k = t.dataset.zc; if (!k) return null;
  const before = JSON.stringify(czCfg);
  if (k === 'model' || k === 'shape') czCfg[k] = t.dataset.v;
  else if (t.type === 'checkbox') czCfg[k] = t.checked;
  else if (k === 'sens' || k === 'size' || k === 'soft' || k === 'pad') czCfg[k] = +t.value;
  else czCfg[k] = t.value;
  if (k === 'device' && before !== JSON.stringify(czCfg)) czReset();
  czSaveCfg();
  return k;
}
function openCzCfg() {
  const m = modal(`<h2>자동 흰칠 설정</h2><p class="sub">그림에서 성기를 찾아 흰색으로 가려요. 그림은 이 컴퓨터 안에서만 처리돼요.</p><div id="czCfgBox">${czCfgHtml(false)}</div>
    ${czIsApp() ? '<div id="czPackBox" class="czpack"></div>' : ''}
    <div class="foot"><button class="btn primary" data-close>닫기</button></div>`, { wide: true });
  const box = $('#czCfgBox', m);
  if (czIsApp()) czPackBoxRender($('#czPackBox', m));
  const on = e => { const k = czCfgChange(e.target); if (!k) return; if (k === 'size') $('#czSizeL', m).textContent = czCfg.size + '%'; if (k === 'soft') $('#czSoftL', m).textContent = czCfg.soft || '또렷하게'; if (k === 'pad') $('#czPadL', m).textContent = czCfg.pad; if (k === 'shape' || k === 'model' || e.type === 'change' && k === 'device') box.innerHTML = czCfgHtml(false); };
  box.addEventListener('input', on); box.addEventListener('change', on);
  box.addEventListener('click', e => { const b = e.target.closest('[data-zc="model"],[data-zc="shape"]'); if (b) on({ target: b, type: 'click' }); });
}

/* ================= 여러 장 한꺼번에 흰칠 ================= */
const czs = { items: [], sel: -1, shape: -1, built: false, busy: false, peek: false, fmt: 'same', bmp: null, bmpId: null, view: null, drag: null, tk: null };
const czOpen = () => czs.built && !$('#czStudio').hidden;
const czsCur = () => czs.items[czs.sel] || null;
const czsNeeds = it => it.state !== 'err' && !it.edited && !!czMissing(it.st);
function czsApply(it) { // 보관해 둔 결과로 지금 설정의 모양 만들기 (손으로 고친 그림은 건드리지 않아요)
  if (it.edited) return;
  const ds = it.st.ds;
  it.shapes = czShapes(it.st).map(sh => sh.poly ? { ...czPolyBox([sh.poly.map(([x, y]) => [x / ds, y / ds])]), auto: true } : { x: sh.e.x / ds, y: sh.e.y / ds, w: sh.e.w / ds, h: sh.e.h / ds, auto: true });
}
function czsNewState(it) { const ds = Math.min(1, 4096 / Math.max(it.w, it.h)), st = czNewState(Math.round(it.w * ds), Math.round(it.h * ds), 0); st.ds = ds; st.padPx = czsPad(it) * ds; return st; }
function buildCzStudio() {
  if (czs.built) return; czs.built = true;
  const d = document.createElement('div'); d.id = 'czStudio'; d.className = 'gs cz'; d.hidden = true;
  d.innerHTML = `<div class="gs-top"><b>여러 장 한꺼번에 흰칠</b><span class="muted small">그림을 넣으면 바로 찾아서 흰칠해요. 한 장씩 확인하고 고친 뒤 한 번에 저장하세요.</span><div class="flex1"></div><span id="czDev" class="muted small"></span><button class="btn" data-z="close">편집기로 돌아가기</button></div>
    <div class="gs-body">
      <aside class="gs-left">
        <div class="gs-add"><button class="btn sm" data-z="add-file">+ 그림 고르기</button><button class="btn sm" data-z="add-lib">+ 보관함에서</button></div>
        <div id="czList" class="gs-list"></div>
        <div id="czSum" class="gs-sum muted small"></div>
      </aside>
      <main class="gs-main">
        <div class="gs-stage" id="czStage"><canvas id="czCv"></canvas><div id="czEmpty" class="gs-empty"><b>흰칠할 그림을 넣어 주세요</b>그림 여러 장을 이 화면으로 끌어오거나 왼쪽 버튼으로 고르세요. 넣자마자 자동으로 찾아요.</div></div>
        <div class="gs-ctrl cz-ctrl">
          <button class="btn icon" data-z="prev" title="이전 그림 (←)" aria-label="이전 그림">‹</button><button class="btn icon" data-z="next" title="다음 그림 (→)" aria-label="다음 그림">›</button>
          <button class="btn sm" data-z="redo" title="이 그림을 지금 설정으로 다시 찾아요">다시 찾기</button>
          <button class="btn sm" data-z="del-shape" id="czDelShape" disabled title="고른 흰칠 빼기 (Delete)">고른 흰칠 빼기</button>
          <button class="btn sm" data-z="clear" title="이 그림의 흰칠을 모두 빼요">모두 빼기</button>
          <button class="btn sm" data-z="peek" id="czPeek" title="흰칠 아래를 살짝 비춰 보기 (V)">살짝 비춰 보기</button>
          <span id="czHint" class="muted small">빈 곳을 끌면 흰칠 추가 · 흰칠을 끌어 옮기기 · 모서리로 크기 조절</span>
        </div>
      </main>
      <aside class="gs-right" id="czProps"></aside>
    </div>
    <input type="file" id="czFile" accept="image/*" multiple hidden>`;
  document.body.appendChild(d);
  d.addEventListener('click', czsClick);
  const props = $('#czProps');
  const onCfg = e => {
    const t = e.target;
    if (t.dataset.zf) { czs.fmt = t.dataset.zf; czsRenderProps(); return; }
    if (t.dataset.zm) { setMetaPref(t.dataset.zm); czsRenderProps(); return; }
    const dev = czCfg.device, k = czCfgChange(t); if (!k) return;
    if (k === 'device' && dev !== czCfg.device && czs.busy) czs.restart = true; // 지금 찾던 것은 새 장치로 이어서
    if (k === 'size') { const l = $('#czSizeL'); if (l) l.textContent = czCfg.size + '%'; }
    if (k === 'soft') { const l = $('#czSoftL'); if (l) l.textContent = czCfg.soft || '또렷하게'; }
    if (k === 'pad') { const l = $('#czPadL'); if (l) l.textContent = czCfg.pad; }
    if (k === 'color' || k === 'soft' || k === 'pad') { czsRenderList(); czsDraw(); return; }
    if (e.type === 'input' && k === 'device') return;
    for (const it of czs.items) czsApply(it);
    if (k === 'model' || k === 'shape' || k === 'device' || (k === 'anus' && e.type === 'change')) czsRenderProps();
    czsRenderList(); czsDraw(); czsPump();
  };
  props.addEventListener('input', onCfg); props.addEventListener('change', onCfg);
  props.addEventListener('click', e => { const b = e.target.closest('[data-zc="model"],[data-zc="shape"],[data-zf],[data-zm]'); if (b) onCfg({ target: b, type: 'click' }); });
  $('#czFile').addEventListener('change', async e => { const fs = [...e.target.files]; e.target.value = ''; await czsAddFiles(fs); });
  const stage = $('#czStage');
  d.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); stage.classList.add('drop'); } });
  d.addEventListener('dragleave', e => { if (!d.contains(e.relatedTarget)) stage.classList.remove('drop'); });
  d.addEventListener('drop', async e => { e.preventDefault(); stage.classList.remove('drop'); await czsAddFiles([...e.dataTransfer.files]); });
  const cvs = $('#czCv');
  cvs.addEventListener('pointerdown', czsDown); cvs.addEventListener('pointermove', czsMove); cvs.addEventListener('pointerup', czsUp); cvs.addEventListener('pointercancel', czsUp);
  new ResizeObserver(() => czsDraw()).observe(stage);
}
function openCzStudio() {
  if (mode) setMode(null);
  closeMenus(); buildCzStudio(); $('#czStudio').hidden = false;
  czsRenderList(); czsRenderProps(); czsDraw(); czsPump();
}
function closeCzStudio() {
  if (czs.busy && czs.items.some(it => it.state === 'wait' || it.state === 'run') && !confirm('아직 찾는 중인 그림이 있어요. 닫으면 찾기를 멈춰요. 닫을까요?')) return;
  if (czs.tk) czs.tk.stop = true;
  $('#czStudio').hidden = true;
}
async function czsThumb(it, bmp) {
  const k = Math.min(96 / it.w, 96 / it.h), c = newCanvas(it.w * k, it.h * k), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height); it.th = c;
}
async function czsAddFiles(files) {
  files = [...files].filter(f => f && /^image\//.test(f.type || '') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test((f && f.name) || ''));
  files.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true }));
  let bad = 0;
  for (const f of files) {
    try {
      const bmp = await createImageBitmap(f);
      const it = { id: uid(), name: f.name || `그림${czs.items.length + 1}.png`, file: f, w: bmp.width, h: bmp.height, shapes: [], state: 'wait', edited: false };
      it.st = czsNewState(it); await czsThumb(it, bmp); bmp.close();
      czs.items.push(it);
      if (czs.sel < 0) czs.sel = czs.items.length - 1;
    } catch (e) { bad++; }
  }
  if (bad) toast(`${bad}장은 열지 못했어요`);
  czsRenderList(); czsRenderProps(); czsDraw(); czsPump();
}
function czsPickLibrary() {
  if (!imageOrder.length) { toast('그림 보관함이 비어 있어요'); return; }
  const picked = new Set();
  const m = modal(`<h2>보관함에서 고르기</h2><p class="sub">흰칠할 그림을 눌러서 고르세요.</p><div class="lib" id="czPick" style="grid-template-columns:repeat(4,1fr);max-height:52vh;padding:0">${imageOrder.map(id => { const r = images.get(id); return `<div class="thumb ${r.alpha ? 'alpha' : ''}" data-pid="${id}"><img src="${r.thumb || ''}" alt=""><span class="mark"></span></div>`; }).join('')}</div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn" id="czAll">전부 넣기</button><button class="btn primary" id="czGo">고른 것 넣기</button></div>`, { wide: true });
  $('#czPick', m).addEventListener('click', e => { const t = e.target.closest('[data-pid]'); if (!t) return; const id = t.dataset.pid; picked.has(id) ? picked.delete(id) : picked.add(id); const mk = t.querySelector('.mark'); mk.classList.toggle('on', picked.has(id)); mk.textContent = picked.has(id) ? '✓' : ''; });
  const add = async ids => {
    closeModal(); const files = [];
    for (const id of ids) { const r = images.get(id); if (!r || !r.src) continue; try { const b = await (await fetch(r.src)).blob(); files.push(new File([b], r.name || 'image.png', { type: b.type })); } catch (_) { } }
    await czsAddFiles(files);
  };
  $('#czGo', m).addEventListener('click', () => add([...picked])); $('#czAll', m).addEventListener('click', () => add(imageOrder.slice()));
}
async function czsCanvas(it) { // 찾기용: 흰 바탕 위 원래 그림 (아주 크면 줄여요)
  const bmp = await createImageBitmap(it.file), ds = Math.min(1, 4096 / Math.max(bmp.width, bmp.height));
  const c = newCanvas(bmp.width * ds, bmp.height * ds), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return { c, ds };
}
async function czsPump() {
  if (czs.busy || !czs.items.some(czsNeeds)) return;
  czs.busy = true; const tk = czs.tk = { stop: false };
  try {
    if (!(await czPacksReady())) return;
    try { $('#czDev').textContent = '모델 준비하는 중…'; for (const k of ['deep', czSegKey()].concat(czContour() ? ['samE', 'samD'] : [])) await czLoad(k); }
    catch (e) { toast(czErrText(e), 6000); $('#czDev').textContent = ''; return; }
    for (let it; !tk.stop && (it = czs.items.find(czsNeeds));) {
      it.state = 'run'; it.stage = ''; czsRenderList(); if (it === czsCur()) czsDraw();
      try {
        const { c } = await czsCanvas(it);
        it.st.padPx = czsPad(it) * it.st.ds;
        await czAnalyze(c, it.st, tk, msg => { it.stage = msg; czsRenderList(); });
        if (!czs.items.includes(it)) continue;
        czsApply(it); it.state = czMissing(it.st) ? 'wait' : 'done';
      } catch (e) {
        const msg = String((e && e.message) || '');
        if (msg === 'stop' || msg === 'reset') { it.state = 'wait'; break; } // 멈췄거나 처리 장치를 바꿨어요
        if (!cz.w) { it.state = 'wait'; toast(czErrText(e), 6000); break; } // 일꾼이 멈췄어요
        it.state = 'err'; it.err = msg;
      }
      it.stage = '';
      $('#czDev').textContent = czDevText();
      czsRenderList(); if (it === czsCur()) czsDraw();
    }
  } finally {
    czs.busy = false; if (czs.tk === tk) czs.tk = null; czsRenderList(); czsRenderProps();
    if (czs.restart || (czs.items.some(czsNeeds) && !(czs.tk && czs.tk.stop))) { czs.restart = false; setTimeout(czsPump, 50); }
  }
}
const czsStatus = it => it.state === 'run' ? (it.stage || '찾는 중…') : it.state === 'wait' ? '기다리는 중' : it.state === 'err' ? '찾지 못했어요' : (it.shapes.length ? `${it.shapes.length}곳 흰칠` : '가릴 곳 없음') + (it.edited ? ' · 손봄' : '');
function czsRenderList() {
  if (!czs.built) return;
  const S = czs.items;
  $('#czList').innerHTML = S.length ? S.map((it, i) => `<div class="gs-item ${i === czs.sel ? 'on' : ''}" data-zi="${i}">
      <span class="no">${i + 1}</span><canvas data-zt="${i}" width="48" height="48"></canvas>
      <span class="meta"><b title="${esc(it.name)}">${esc(it.name)}</b><span class="st ${it.state === 'done' && it.shapes.length ? 'on' : ''} ${it.state === 'err' ? 'bad' : ''}">${czsStatus(it)}</span></span>
      <span class="ops"><button class="ic" data-z="del" data-i="${i}" title="목록에서 빼기" aria-label="목록에서 빼기">×</button></span></div>`).join('') : '<div class="gs-none muted small">아직 그림이 없어요.</div>';
  for (const c of $$('#czList canvas')) {
    const it = S[+c.dataset.zt], g = c.getContext('2d'), k = Math.min(48 / it.th.width, 48 / it.th.height), w = it.th.width * k, h = it.th.height * k, ox = (48 - w) / 2, oy = (48 - h) / 2, q = w / it.w;
    g.fillStyle = '#eef0f2'; g.fillRect(0, 0, 48, 48); g.drawImage(it.th, ox, oy, w, h);
    czFillShapes(g, it.shapes, q, ox, oy, czCfg.color, czsPad(it), czsSoft(it) * q);
  }
  const done = S.filter(it => it.state === 'done').length, left = S.filter(it => it.state === 'wait' || it.state === 'run').length, n = S.reduce((a, it) => a + it.shapes.length, 0);
  $('#czSum').textContent = S.length ? `${S.length}장 중 ${done}장 확인 끝${left ? `, ${left}장 남음` : ''} · 흰칠 ${n}곳` : '';
  const sb = $('#czSave'); if (sb) sb.disabled = !S.length || left > 0;
  const l = $('#czList .gs-item.on'); if (l) l.scrollIntoView({ block: 'nearest' });
}
function czsRenderProps() {
  if (!czs.built) return;
  const S = czs.items, left = S.some(it => it.state === 'wait' || it.state === 'run'), F = czs.fmt;
  $('#czProps').innerHTML = `<div class="sec"><h3>찾는 방법</h3>${czCfgHtml(true)}</div>
    <div class="sec"><h3>저장</h3>
      ${row('형식', `<div class="seg"><button class="btn sm ${F === 'same' ? 'on' : ''}" data-zf="same">원래 형식</button><button class="btn sm ${F === 'png' ? 'on' : ''}" data-zf="png">PNG</button><button class="btn sm ${F === 'jpg' ? 'on' : ''}" data-zf="jpg">JPG</button></div>`)}
      ${row('NAI 정보', `<div class="seg"><button class="btn sm ${metaPref() === 'strip' ? 'on' : ''}" data-zm="strip" title="그림 안에 숨은 생성 정보(프롬프트 등)를 지워요">지우기</button><button class="btn sm ${metaPref() === 'keep' ? 'on' : ''}" data-zm="keep" title="PNG로 저장할 때 생성 정보를 그대로 남겨요">남기기</button></div>`)}
      <div class="btnrow"><button class="btn primary" data-z="save-all" id="czSave" ${S.length && !left ? '' : 'disabled'}>모두 저장 (ZIP)</button><button class="btn" data-z="save-one" ${czsCur() ? '' : 'disabled'}>이 그림만 저장</button></div>
      <div class="btnrow"><button class="btn sm" data-z="to-lib" ${S.length ? '' : 'disabled'} title="흰칠한 그림을 편집기 그림 보관함에 넣어요">편집기 보관함에 넣기</button><button class="btn sm danger" data-z="clear-all" ${S.length ? '' : 'disabled'}>목록 비우기</button></div>
      <p class="muted small">파일 이름은 원래 이름 그대로 저장돼요. 저장하기 전에 한 장씩 눌러서 빠진 곳이나 잘못 칠한 곳이 없는지 확인해 주세요.</p></div>`;
}
/* 무대: 그림과 흰칠을 그리고, 손으로 고치기 */
async function czsBitmap(it) {
  if (czs.bmpId === it.id && czs.bmp) return czs.bmp;
  const b = await createImageBitmap(it.file);
  if (czs.bmp) { try { czs.bmp.close(); } catch (_) { } }
  czs.bmp = b; czs.bmpId = it.id; return b;
}
let czsDrawQ = false;
function czsDraw() {
  if (!czs.built || czsDrawQ) return; czsDrawQ = true;
  requestAnimationFrame(async () => {
    czsDrawQ = false;
    const it = czsCur(), cv = $('#czCv'), st = $('#czStage');
    $('#czEmpty').hidden = !!it; cv.style.display = it ? '' : 'none';
    $('#czDelShape').disabled = !(it && it.shapes[czs.shape]);
    $('#czPeek').classList.toggle('on', czs.peek);
    if (!it) return;
    const dpr = window.devicePixelRatio || 1, k = Math.min((st.clientWidth - 32) / it.w, (st.clientHeight - 32) / it.h, 2);
    const W = Math.max(10, Math.round(it.w * k)), H = Math.max(10, Math.round(it.h * k));
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    czs.view = { k, W, H };
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.drawImage(it.th, 0, 0, W, H); // 먼저 작은 그림으로 바로 보여 주고
    const bmp = await czsBitmap(it); if (czsCur() !== it) return;
    g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, W, H);
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = czs.peek ? 0.45 : 1;
    czFillShapes(g, it.shapes, k * dpr, 0, 0, czCfg.color, czsPad(it), czsSoft(it) * k * dpr);
    g.restore();
    it.shapes.forEach((b, i) => {
      const on = i === czs.shape;
      czShapeOutline(g, b, k);
      g.lineWidth = on ? 2 : 1; g.strokeStyle = on ? '#1688e0' : 'rgba(22,136,224,.55)'; g.setLineDash(on ? [] : [4, 3]); g.stroke(); g.setLineDash([]);
      if (on) { g.strokeStyle = 'rgba(22,136,224,.6)'; g.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k); for (const [hx, hy] of czsCorners(b)) { g.fillStyle = '#fff'; g.strokeStyle = '#1688e0'; g.lineWidth = 1.5; g.beginPath(); g.rect(hx * k - 4.5, hy * k - 4.5, 9, 9); g.fill(); g.stroke(); } }
    });
    const d = czs.drag; if (d && d.mode === 'new' && d.box) { g.strokeStyle = '#1688e0'; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.beginPath(); if (czContour()) g.rect(d.box.x * k, d.box.y * k, d.box.w * k, d.box.h * k); else g.ellipse((d.box.x + d.box.w / 2) * k, (d.box.y + d.box.h / 2) * k, d.box.w / 2 * k, d.box.h / 2 * k, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    $('#czHint').textContent = czs.segBusy ? '윤곽 따는 중…' : czContour() ? '빈 곳을 상자처럼 끌면 그 안의 모양을 따서 칠해요 · 흰칠을 끌어 옮기기 · 모서리로 크기 조절' : '빈 곳을 끌면 흰칠 추가 · 흰칠을 끌어 옮기기 · 모서리로 크기 조절';
    if (it.state === 'run' || it.state === 'wait') { g.fillStyle = 'rgba(20,22,26,.6)'; g.fillRect(0, 0, W, 26); g.fillStyle = '#fff'; g.font = `12px ${fontCss('고딕')}`; g.textBaseline = 'middle'; g.fillText(it.state === 'run' ? '찾는 중…' : '차례를 기다리는 중…', 10, 13); }
  });
}
// 흰칠 모양들 칠하기. shapes: 그림 좌표 {x,y,w,h, poly?}, s: 배율, (ox,oy): 캔버스 위치, pd: 윤곽 바깥 여유, grow: 사방으로 넓히기 (둘 다 캔버스 픽셀)
function czDrawShapes(gg, shapes, s, ox, oy, pd, grow, color) {
  gg.fillStyle = color; gg.strokeStyle = color; gg.lineJoin = 'round';
  for (const b of shapes) {
    gg.beginPath();
    if (b.poly) {
      for (const pl of b.poly) { pl.forEach(([u, v], i) => { const x = ox + (b.x + u * b.w) * s, y = oy + (b.y + v * b.h) * s; i ? gg.lineTo(x, y) : gg.moveTo(x, y); }); gg.closePath(); }
      gg.fill(); const e = pd + grow; if (e > 0) { gg.lineWidth = e * 2; gg.stroke(); }
    } else { gg.ellipse(ox + (b.x + b.w / 2) * s, oy + (b.y + b.h / 2) * s, Math.max(0.5, b.w / 2 * s + grow), Math.max(0.5, b.h / 2 * s + grow), 0, 0, Math.PI * 2); gg.fill(); }
  }
}
function czShapeOutline(g, b, s) { // 고르기 표시용 테두리 경로
  g.beginPath();
  if (b.poly) for (const pl of b.poly) { pl.forEach(([u, v], i) => { const x = (b.x + u * b.w) * s, y = (b.y + v * b.h) * s; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); }
  else g.ellipse((b.x + b.w / 2) * s, (b.y + b.h / 2) * s, Math.max(1, b.w / 2 * s), Math.max(1, b.h / 2 * s), 0, 0, Math.PI * 2);
}
function czFillShapes(g, shapes, s, ox, oy, color, pad, soft) {
  if (!shapes.length) return;
  const pd = pad * s;
  if (!(soft > 0.3)) { czDrawShapes(g, shapes, s, ox, oy, pd, 0, color); return; }
  const grow = soft * 1.5, mg = pd + grow + soft * 3.5;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const b of shapes) { x0 = Math.min(x0, ox + b.x * s - mg); y0 = Math.min(y0, oy + b.y * s - mg); x1 = Math.max(x1, ox + (b.x + b.w) * s + mg); y1 = Math.max(y1, oy + (b.y + b.h) * s + mg); }
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  const q = clamp(soft / 3, 1, 8), W = Math.max(1, Math.ceil((x1 - x0) / q)), H = Math.max(1, Math.ceil((y1 - y0) / q));
  const mk = newCanvas(W, H);
  czDrawShapes(mk.getContext('2d'), shapes, s / q, (ox - x0) / q, (oy - y0) / q, pd / q, grow / q, '#fff');
  const out = newCanvas(W, H), go = out.getContext('2d');
  go.filter = `blur(${(soft / q).toFixed(2)}px)`; go.drawImage(mk, 0, 0); go.filter = 'none';
  go.globalCompositeOperation = 'source-in'; go.fillStyle = color; go.fillRect(0, 0, W, H);
  g.save(); g.imageSmoothingQuality = 'high'; g.drawImage(out, x0, y0, W * q, H * q); g.restore();
}
const czsPad = it => czCfg.pad * Math.max(it.w, it.h) / 1000; // 윤곽 바깥 여유 (그림 픽셀)
const czsSoft = it => czCfg.soft * Math.max(it.w, it.h) / 1000; // 그림 크기에 맞춘 흐림 정도 (그림 픽셀)
const czsCorners = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
function czsPt(e) { const r = $('#czCv').getBoundingClientRect(), k = czs.view.k; return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; }
function czsHit(it, p) { for (let i = it.shapes.length - 1; i >= 0; i--) { const b = it.shapes[i]; if (b.poly) { if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i; continue; } const u = (p.x - b.x - b.w / 2) / (b.w / 2), v = (p.y - b.y - b.h / 2) / (b.h / 2); if (u * u + v * v <= 1) return i; } return -1; }
function czsDown(e) {
  const it = czsCur(); if (!it || !czs.view || e.button !== 0) return;
  const p = czsPt(e), tol = 8 / czs.view.k, b = it.shapes[czs.shape];
  $('#czCv').setPointerCapture(e.pointerId);
  if (b) { const ci = czsCorners(b).findIndex(([x, y]) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol); if (ci >= 0) { const [ax, ay] = czsCorners(b)[(ci + 2) % 4]; czs.drag = { mode: 'size', ax, ay, b }; return; } }
  const hit = czsHit(it, p);
  if (hit >= 0) { czs.shape = hit; const s = it.shapes[hit]; czs.drag = { mode: 'move', sx: p.x, sy: p.y, ox: s.x, oy: s.y, b: s, moved: false }; czsDraw(); return; }
  czs.shape = -1; czs.drag = { mode: 'new', sx: p.x, sy: p.y, box: null }; czsDraw();
}
function czsMove(e) {
  const d = czs.drag, it = czsCur(); if (!d || !it) return;
  const p = czsPt(e);
  if (d.mode === 'move') { if (!d.moved && Math.hypot(p.x - d.sx, p.y - d.sy) * czs.view.k < 3) return; d.moved = true; d.b.x = d.ox + p.x - d.sx; d.b.y = d.oy + p.y - d.sy; }
  else if (d.mode === 'size') { d.b.x = Math.min(d.ax, p.x); d.b.y = Math.min(d.ay, p.y); d.b.w = Math.max(4, Math.abs(p.x - d.ax)); d.b.h = Math.max(4, Math.abs(p.y - d.ay)); }
  else if (d.mode === 'new') { d.box = { x: Math.min(d.sx, p.x), y: Math.min(d.sy, p.y), w: Math.abs(p.x - d.sx), h: Math.abs(p.y - d.sy) }; }
  czsDraw();
}
function czsUp() {
  const d = czs.drag, it = czsCur(); czs.drag = null; if (!d || !it) return;
  if (d.mode === 'new') { if (d.box && d.box.w * czs.view.k > 6 && d.box.h * czs.view.k > 6) { it.shapes.push(d.box); czs.shape = it.shapes.length - 1; it.edited = true; if (czContour()) czsSegManual(it, d.box); } }
  else if (d.mode === 'size' || (d.mode === 'move' && d.moved)) it.edited = true;
  czsDraw(); czsRenderList();
}
async function czsSegManual(it, b) { // 손으로 끈 상자 안의 모양을 따서 그 상자를 다각형으로 바꿔요
  czs.segBusy = (czs.segBusy || 0) + 1; czsDraw();
  try {
    const { c, ds } = await czsCanvas(it);
    const [bm] = await czSamUnion(c, [{ x: b.x * ds, y: b.y * ds, w: b.w * ds, h: b.h * ds }], null);
    const polys = bm ? czMaskToPolys(bm.data, bm.w, bm.h).map(pl => pl.map(([x, y]) => [(x + bm.x) / ds, (y + bm.y) / ds])) : [];
    if (polys.length && it.shapes.includes(b)) Object.assign(b, czPolyBox(polys));
    else if (!polys.length) toast('여기서는 모양을 따지 못해서 그린 타원 그대로 둘게요', 2600);
  } catch (e) { if (String(e && e.message) !== 'stop') toast(czErrText(e), 5000); }
  czs.segBusy--; czsDraw(); czsRenderList();
}
function czsSelect(i) { if (!czs.items.length) return; czs.sel = clamp(i, 0, czs.items.length - 1); czs.shape = -1; czsRenderList(); czsRenderProps(); czsDraw(); }
function czsDelShape() { const it = czsCur(); if (!it || !it.shapes[czs.shape]) return; it.shapes.splice(czs.shape, 1); czs.shape = -1; it.edited = true; czsDraw(); czsRenderList(); }
async function czsRender(it, fmt) { // 저장용: 원래 크기 그대로 흰칠한 파일
  const bmp = await createImageBitmap(it.file), c = newCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  const sk = bmp.width / it.w;
  let type = fmt === 'png' ? 'image/png' : fmt === 'jpg' ? 'image/jpeg' : (['image/png', 'image/jpeg', 'image/webp'].includes(it.file.type) ? it.file.type : 'image/png');
  if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0);
  czFillShapes(g, it.shapes, sk, 0, 0, czCfg.color, czsPad(it), czsSoft(it) * sk);
  const keep = metaPref() === 'keep' && type === 'image/png' && it.file.type === 'image/png';
  if (keep) copyAlpha(c, bmp); else if (type === 'image/png') flattenAlpha(c); // 투명도에 숨은 생성 정보: 남기거나 지우기
  bmp.close();
  let blob = await new Promise(r => c.toBlob(r, type, 0.95));
  if (!blob) throw new Error('canvas');
  if (keep) blob = await pngWithText(blob, pngTextChunks(await it.file.arrayBuffer()));
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  const base = (it.name || '그림').replace(/\.[^.\\/]+$/, '');
  return { name: safeName(base) + '.' + ext, blob, type };
}
async function czsSave(all) {
  const list = all ? czs.items : [czsCur()].filter(Boolean); if (!list.length) return;
  const tk = czProgress(all ? '흰칠한 그림 저장하는 중' : '저장하는 중'); $('#czPDev').textContent = '';
  try {
    const files = [], used = new Set();
    for (let i = 0; i < list.length; i++) {
      if (tk.stop) return;
      tk.set(`${i + 1} / ${list.length}장 만드는 중…`, i / list.length);
      const f = await czsRender(list[i], czs.fmt);
      let nm = f.name, n = 2; while (used.has(nm.toLowerCase())) nm = f.name.replace(/(\.[^.]+)$/, `(${n++})$1`); used.add(nm.toLowerCase());
      files.push({ name: nm, blob: f.blob });
    }
    tk.done();
    const d = new Date(), p2 = v => String(v).padStart(2, '0');
    const how = files.length === 1 ? await download(files[0].blob, files[0].name) : await saveFiles(files, `흰칠_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.zip`);
    if (how) toast(files.length === 1 ? '흰칠한 그림을 저장했어요' : how === 'dir' ? `${files.length}장을 고른 폴더에 저장했어요` : `${files.length}장을 ZIP 파일 하나로 저장했어요`);
  } catch (e) { tk.done(); toast('저장하지 못했어요. 그림이 너무 크거나 메모리가 모자랄 수 있어요.', 4500); }
}
async function czsToLib() {
  const tk = czProgress('보관함에 넣는 중'); $('#czPDev').textContent = '';
  try {
    const files = [];
    for (let i = 0; i < czs.items.length; i++) { if (tk.stop) return; tk.set(`${i + 1} / ${czs.items.length}장`, i / czs.items.length); const f = await czsRender(czs.items[i], czs.fmt === 'jpg' ? 'jpg' : 'png'); files.push(new File([f.blob], f.name, { type: f.type })); }
    tk.done(); const ids = await importFiles(files);
    toast(`${ids.length}장을 편집기 그림 보관함에 넣었어요`);
  } catch (e) { tk.done(); toast('보관함에 넣지 못했어요', 3500); }
}
function czsClick(e) {
  const b = e.target.closest('[data-z]'), item = e.target.closest('[data-zi]');
  if (!b) { if (item) czsSelect(+item.dataset.zi); return; }
  const a = b.dataset.z, it = czsCur();
  if (a === 'close') closeCzStudio();
  else if (a === 'add-file') $('#czFile').click();
  else if (a === 'add-lib') czsPickLibrary();
  else if (a === 'prev') czsSelect(czs.sel - 1);
  else if (a === 'next') czsSelect(czs.sel + 1);
  else if (a === 'del') {
    const i = +b.dataset.i; czs.items.splice(i, 1);
    if (czs.sel >= czs.items.length) czs.sel = czs.items.length - 1; czs.shape = -1;
    czsRenderList(); czsRenderProps(); czsDraw();
  }
  else if (a === 'del-shape') czsDelShape();
  else if (a === 'clear' && it) { it.shapes = []; it.edited = true; czs.shape = -1; czsDraw(); czsRenderList(); }
  else if (a === 'redo' && it) { it.st = czsNewState(it); it.edited = false; it.state = 'wait'; it.shapes = []; czs.shape = -1; czsRenderList(); czsDraw(); czsPump(); }
  else if (a === 'peek') { czs.peek = !czs.peek; czsDraw(); }
  else if (a === 'save-all') czsSave(true);
  else if (a === 'save-one') czsSave(false);
  else if (a === 'to-lib') czsToLib();
  else if (a === 'clear-all') { if (!confirm('목록의 그림을 모두 뺄까요? 저장하지 않은 흰칠은 사라져요.')) return; if (czs.tk) czs.tk.stop = true; czs.items = []; czs.sel = -1; czs.shape = -1; czsRenderList(); czsRenderProps(); czsDraw(); }
}
function czsKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); if (modalOpen()) closeModal(); else if (czs.shape >= 0) { czs.shape = -1; czsDraw(); } else closeCzStudio(); return; }
  if (isTyping(e.target) || modalOpen()) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); czsDelShape(); return; }
  if (e.target.type === 'range') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); czsSelect(czs.sel - 1); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); czsSelect(czs.sel + 1); }
  else if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) { czs.peek = !czs.peek; czsDraw(); }
}

