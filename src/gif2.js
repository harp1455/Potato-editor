/* ================= 움짤: 영상 불러오기 · 여러 장면 한꺼번에 · 저장 강화 ================= */
const isVideoFile = f => /^video\//.test(f.type || '') || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(f.name || '');
gs.pick = new Set(); // 여러 개 고른 장면 (id)
Object.assign(gs.set, Object.assign({ colors: 256, target: 0, mq: 75 }, gs.set));
const gsPicked = () => gs.slides.filter(s => gs.pick.has(s.id));
const gsSeek = (v, t) => new Promise(res => { let done = false; const ok = () => { if (!done) { done = true; res(); } }; v.addEventListener('seeked', ok, { once: true }); setTimeout(ok, 3000); v.currentTime = t; });
// 영상 → 장면들 (구간·초당 장 수·크기를 고르고 나서)
async function gsAddVideo(file) {
  const url = URL.createObjectURL(file), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try { await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video')); setTimeout(() => rej(new Error('timeout')), 20000); }); }
  catch (e) { URL.revokeObjectURL(url); toast(`${file.name}을 열지 못했어요. MP4(H.264)나 WebM 영상을 넣어 주세요`, 4500); return 0; }
  const opt = await gsVideoAsk(v, file.name);
  if (!opt) { URL.revokeObjectURL(url); return 0; }
  const n = Math.max(1, Math.min(900, Math.round((opt.end - opt.start) * opt.fps))), clip = 'c' + uid();
  const k = Math.min(1, opt.max / Math.max(v.videoWidth, v.videoHeight)), w = Math.max(2, Math.round(v.videoWidth * k)), h = Math.max(2, Math.round(v.videoHeight * k));
  let got = 0;
  for (let i = 0; i < n; i++) {
    await gsSeek(v, Math.min(opt.start + i / opt.fps, Math.max(0, v.duration - 0.001)));
    const c = newCanvas(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(v, 0, 0, w, h);
    if (!gsAddBitmap(c, file.name, { dur: Math.round(1000 / opt.fps) / 1000, motion: 'none', tr: i ? 'none' : null, fit: 'contain', clip })) { gsFull(); break; }
    got++; if (i % 10 === 0) toast(`영상에서 장면을 꺼내는 중… ${i + 1} / ${n}`, 1500);
  }
  URL.revokeObjectURL(url); return got;
}
function gsVideoAsk(v, name) {
  return new Promise(resolve => {
    const D = v.duration || 0, fmt = x => x.toFixed(2);
    const m = modal(`<h2>영상 불러오기</h2><p class="sub">${esc(name)} · ${v.videoWidth}×${v.videoHeight} · ${fmt(D)}초. 쓸 구간과 초당 장 수를 골라 주세요.</p>
      <div id="gvBox" style="display:flex;justify-content:center;background:#000;border-radius:8px;overflow:hidden;max-height:40vh"></div>
      <div class="grid2" style="margin-top:10px"><span>시작 (초)</span><span><input type="number" id="gvS" min="0" max="${D}" step="0.05" value="0"> <button class="btn sm" id="gvSNow">지금 위치</button></span>
        <span>끝 (초)</span><span><input type="number" id="gvE" min="0" max="${D}" step="0.05" value="${fmt(Math.min(D, 6))}"> <button class="btn sm" id="gvENow">지금 위치</button></span></div>
      ${row('초당 장 수', `<select id="gvF">${[6, 8, 10, 12, 15, 20, 24, 25, 30, 50, 60].map(f => `<option value="${f}" ${f === Math.min(60, +gs.set.fps || 12) ? 'selected' : ''}>${f}장${f === +gs.set.fps ? ' (시퀀스와 같게)' : ''}</option>`).join('')}</select>`)}
      ${row('크기 (긴 쪽)', `<select id="gvM">${[360, 480, 640, 800, 1080, 1440, 2160].map(f => `<option value="${f}" ${f === (gsInMax() >= 1920 ? 1080 : gsInMax() >= 1080 ? 800 : 640) ? 'selected' : ''}>${f}px</option>`).join('')}</select>`)}
      <p class="muted small" id="gvN"></p>
      <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="gvGo">불러오기</button></div>`, { wide: true });
    v.controls = true; v.style.maxWidth = '100%'; v.style.maxHeight = '40vh'; $('#gvBox', m).appendChild(v);
    const upd = () => { const s = +$('#gvS', m).value || 0, e = +$('#gvE', m).value || 0, n = Math.round(Math.max(0, e - s) * +$('#gvF', m).value); $('#gvN', m).textContent = n > 900 ? `${n}장이 돼요. 한 번에 900장까지라 앞에서부터 900장만 넣어요.` : `${n}장이 장면으로 들어가요.`; };
    $$('input,select', m).forEach(x => x.addEventListener('input', upd)); upd();
    $('#gvSNow', m).addEventListener('click', () => { $('#gvS', m).value = fmt(v.currentTime); upd(); });
    $('#gvENow', m).addEventListener('click', () => { $('#gvE', m).value = fmt(v.currentTime); upd(); });
    let done = false; const fin = r => { if (done) return; done = true; v.pause(); v.controls = false; resolve(r); };
    new MutationObserver((_, ob) => { if (!m.isConnected) { ob.disconnect(); fin(null); } }).observe($('#modalRoot'), { childList: true });
    $('#gvGo', m).addEventListener('click', () => {
      const s = clamp(+$('#gvS', m).value || 0, 0, D), e = clamp(+$('#gvE', m).value || D, 0, D);
      if (e - s < 0.05) { toast('끝이 시작보다 뒤여야 해요'); return; }
      const r = { start: s, end: e, fps: +$('#gvF', m).value, max: +$('#gvM', m).value }; fin(r); closeModal();
    });
  });
}
// 여러 장면 한꺼번에: 속도, 거꾸로, 부메랑, 솎기, 길이, 복제, 빼기
function gsBatch(a, v) {
  const P = gsPicked(); if (!P.length) return;
  const idx = P.map(s => gs.slides.indexOf(s)).sort((x, y) => x - y);
  if (a === 'b-speed') { const f = +v; for (const s of P) s.dur = Math.max(0.02, Math.round(gsDur(s) / f * 1000) / 1000); }
  else if (a === 'b-dur') { const d = clamp(+v || 0.1, 0.02, 60); for (const s of P) s.dur = d; }
  else if (a === 'b-rev') { const rev = idx.map(i => gs.slides[i]).reverse(); idx.forEach((i, k) => { gs.slides[i] = rev[k]; }); }
  else if (a === 'b-boom') { const seq = idx.map(i => gs.slides[i]), back = seq.slice(1, -1).reverse().map(s => ({ ...s, id: uid(), tr: 'none' })); gs.slides.splice(idx[idx.length - 1] + 1, 0, ...back); }
  else if (a === 'b-thin') { const keep = new Set(); idx.forEach((i, k) => { const s = gs.slides[i]; if (k % 2 === 0) { const nx = gs.slides[idx[k + 1]]; s.dur = Math.round((gsDur(s) + (nx ? gsDur(nx) : 0)) * 1000) / 1000; keep.add(s); } }); gs.slides = gs.slides.filter(s => !gs.pick.has(s.id) || keep.has(s)); }
  else if (a === 'b-dup') { const cp = idx.map(i => ({ ...gs.slides[i], id: uid() })); gs.slides.splice(idx[idx.length - 1] + 1, 0, ...cp); }
  else if (a === 'b-del') { gs.slides = gs.slides.filter(s => !gs.pick.has(s.id)); gs.pick.clear(); gs.sel = Math.min(gs.sel, gs.slides.length - 1); }
  else if (a === 'b-none') { for (const s of P) { s.motion = 'none'; s.tr = 'none'; } }
  else if (a === 'b-ai') { gsInterp(+v || 2); return; }
  gs.pick = new Set([...gs.pick].filter(id => gs.slides.some(s => s.id === id)));
  gsChanged();
}
function gsBatchHtml() {
  const P = gsPicked(); if (P.length < 2) return '';
  const tot = P.reduce((a, s) => a + gsDur(s), 0);
  return `<div class="sec"><h3>고른 장면 ${P.length}개</h3><p class="muted small" style="margin:0 0 6px">모두 ${tot.toFixed(2)}초. <kbd>Shift</kbd>+클릭으로 범위, <kbd>Ctrl</kbd>+클릭으로 하나씩 더 골라요.</p>
    ${row('속도', `<div class="seg">${[['0.5', '0.5배'], ['0.75', '0.75배'], ['1.5', '1.5배'], ['2', '2배'], ['3', '3배']].map(([x, l]) => `<button class="btn sm" data-g="b-speed" data-v="${x}">${l}</button>`).join('')}</div>`)}
    ${row('한 장 길이', `<input type="number" id="gsBDur" min="0.02" max="60" step="0.01" value="${(tot / P.length).toFixed(2)}"> 초 <button class="btn sm" data-g="b-dur">맞추기</button>`)}
    <div class="btnrow"><button class="btn sm" data-g="b-rev" title="고른 장면 순서를 뒤집어요">거꾸로</button><button class="btn sm" data-g="b-boom" title="앞으로 갔다가 거꾸로 돌아와요">부메랑</button><button class="btn sm" data-g="b-thin" title="한 장 걸러 하나씩 빼서 장 수를 반으로 (길이는 그대로)">반으로 솎기</button></div>
    ${row('AI로 부드럽게', `<div class="seg"><button class="btn sm" data-g="b-ai" data-v="2" title="장면 사이에 AI가 한 장씩 새로 그려 넣어요">2배</button><button class="btn sm" data-g="b-ai" data-v="4" title="장면 사이에 세 장씩">4배</button></div><label class="chk" title="끄면 길이는 그대로 두고 더 부드럽게, 켜면 늘어난 장 수만큼 느리게(슬로모션)"><input type="checkbox" id="gsAiSlow" ${gs.set.aiSlow ? 'checked' : ''}> 느리게</label>`)}
    <p class="muted small" style="margin:-2px 0 6px">영상·GIF처럼 조금씩 움직이는 장면에 잘 맞아요. 그림이 확 바뀌는 사이는 그대로 둬요.</p>
    <div class="btnrow"><button class="btn sm" data-g="b-none" title="움직임·넘김 효과 없이 (영상·GIF 프레임용)">효과 없이</button><button class="btn sm" data-g="b-dup">복제</button><button class="btn sm danger" data-g="b-del">빼기</button><button class="btn sm" data-g="b-clear">고르기 풀기</button></div></div>`;
}
function gsPickClick(i, e) { // 장면 목록 클릭: Shift = 범위, Ctrl = 하나씩
  const s = gs.slides[i]; if (!s) return;
  if (e.shiftKey && gs.sel >= 0) { const [a, b] = [Math.min(gs.sel, i), Math.max(gs.sel, i)]; gs.pick = new Set(gs.slides.slice(a, b + 1).map(x => x.id)); }
  else if (e.ctrlKey || e.metaKey) { if (gs.pick.size === 0 && gs.slides[gs.sel]) gs.pick.add(gs.slides[gs.sel].id); gs.pick.has(s.id) ? gs.pick.delete(s.id) : gs.pick.add(s.id); gs.sel = i; }
  else { gs.pick = new Set(); gs.sel = i; }
}

/* ---- 저장: MP4(H.264), 용량 맞추기, 예상 용량 ---- */
// H.264가 먼저 (어디서나 열려요). 이 크기·프레임을 못 하면 HEVC → VP9 → AV1 순서로 (모두 MP4 안에 넣어요)
const GS_CODECS = [['avc', 'avc1.640034'], ['avc', 'avc1.640033'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.640028'], ['avc', 'avc1.42001f'], ['hevc', 'hvc1.1.6.L153.B0'], ['hevc', 'hvc1.1.6.L156.B0'], ['vp9', 'vp09.00.51.08'], ['av1', 'av01.0.12M.08']];
async function gsMp4Codec(W, H, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return null;
  const hw = uiSet.hw || 'no-preference', tries = hw === 'no-preference' ? [hw] : [hw, 'no-preference'];
  for (const [mux, codec] of GS_CODECS) for (const acc of tries) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: acc, latencyMode: 'quality' };
    if (mux === 'avc') cfg.avc = { format: 'avc' }; if (mux === 'hevc') cfg.hevc = { format: 'hevc' };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) { cfg.mux = mux; return cfg; } } catch (_) { }
  }
  return null;
}
async function encodeMp4(W, H, fps, total, renderFrame, progress, bitrate, audio) {
  W -= W % 2; H -= H % 2;
  const cfg = await gsMp4Codec(W, H, fps, bitrate); if (!cfg) throw new Error('nomp4');
  const vmux = cfg.mux; delete cfg.mux;
  const ac = audio ? await auEncoderCfg(audio.sampleRate, audio.numberOfChannels) : null; // 소리 (배경 음악·효과음)
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: vmux, width: W, height: H, frameRate: fps }, ...(ac ? { audio: { codec: ac.mux, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } } : {}), fastStart: 'in-memory' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(cfg);
  const c = newCanvas(W, H), g = c.getContext('2d'), n = Math.max(1, Math.round(total * fps)), us = 1e6 / fps;
  for (let i = 0; i < n; i++) {
    if (err) throw err;
    renderFrame(g, i / fps, W, H);
    const f = new VideoFrame(c, { timestamp: Math.round(i * us), duration: Math.round(us) });
    enc.encode(f, { keyFrame: i % Math.round(fps * 2) === 0 }); f.close();
    while (enc.encodeQueueSize > 8) { if (err) throw err; await new Promise(r => setTimeout(r, 2)); }
    progress(i + 1, n);
  }
  await enc.flush(); enc.close(); if (err) throw err;
  if (ac) await auEncode(audio, muxer, ac.cfg);
  muxer.finalize();
  const out = new Blob([muxer.target.buffer], { type: 'video/mp4' }); if (audio && !ac) out.noAudio = true; out.codec = vmux;
  return out;
}
async function gsEncodeOnce(fmt, W, H, opt, prog) {
  const R = (g, t, w, h) => gsRenderAt(g, t, w, h);
  if (fmt === 'mp4') return encodeMp4(W, H, opt.fps, gsTotal(), R, prog, opt.bitrate, await auMix(gsTotal()));
  const frames = gsFramePlan(opt.gfps);
  if (fmt === 'gif') return encodeGif(W, H, frames, R, prog, opt.colors);
  return encodeWebp(W, H, frames, R, prog, opt.q);
}
const gsMp4Bitrate = (W, H, fps, q) => Math.min(150e6, Math.round(W * H * Math.pow(fps, 0.75) * 2.2 * (0.04 + q / 100 * 0.22))); // 화질(40~100) → 비트레이트 (프레임이 늘면 덜 늘게)
// 움짤(GIF·WebP)은 영상과 따로: 프레임(GIF는 50까지 — 그보다 짧은 간격은 브라우저가 느리게 틀어요)과 크기
const GS_GFPS = [8, 10, 12, 15, 20, 24, 25, 30, 50, 60];
function gsOutFps(fmt) { const f = +gs.set.gfps || +gs.set.fps || 12; return fmt === 'gif' ? Math.min(50, f) : Math.min(60, f); }
const GS_GSCALE = [['1', '영상과 같게'], ['0.75', '75%'], ['0.5', '50%'], ['l1080', '긴 쪽 1080'], ['l800', '긴 쪽 800 (추천)'], ['l640', '긴 쪽 640'], ['l480', '긴 쪽 480 (가볍게)']];
function gsOutSize(fmt) {
  const [W, H] = gsSize(); if (fmt === 'mp4') return [W, H];
  const v = String(gs.set.gscale ?? 'l800'); let k = 1;
  if (v[0] === 'l') k = Math.min(1, (+v.slice(1) || 800) / Math.max(W, H)); else k = clamp(+v || 1, 0.1, 1);
  return [Math.max(16, Math.round(W * k / 2) * 2), Math.max(16, Math.round(H * k / 2) * 2)];
}
// 목표 용량 안으로: 한 번 만들어 보고, 크면 화질·색 수·크기를 줄여 다시 (최대 5번)
async function gsEncodeTarget(fmt, prog) {
  let [W, H] = gsOutSize(fmt); const set = gs.set, target = (+set.target || 0) * 1048576;
  let opt = { fps: +set.fps, gfps: gsOutFps(fmt), colors: +set.colors || 256, q: +set.q || 88, bitrate: gsMp4Bitrate(W, H, +set.fps, +set.mq || 75) };
  if (fmt === 'mp4' && target) opt.bitrate = Math.max(150e3, Math.round(target * 8 * 0.93 / Math.max(0.5, gsTotal())) - ((gs.au || []).some(a => !a.hidden) ? 165000 : 0)); // 소리 몫은 빼고
  let blob = null;
  for (let tries = 0; tries < 5; tries++) {
    blob = await gsEncodeOnce(fmt, W, H, opt, (i, n) => prog(i, n, tries));
    if (!target || blob.size <= target || fmt === 'mp4' && tries > 0) break;
    const r = target / blob.size;
    if (fmt === 'webp' && opt.q > 50) { opt.q = Math.max(45, Math.round(opt.q * (r > 0.6 ? 0.8 : 0.6))); continue; }
    if (fmt === 'gif' && opt.colors > 64 && r > 0.55) { opt.colors = opt.colors > 128 ? 128 : 64; continue; }
    if (fmt === 'mp4') { opt.bitrate = Math.round(opt.bitrate * r * 0.85); continue; }
    const k = clamp(Math.sqrt(r) * 0.93, 0.35, 0.95); W = Math.max(32, Math.round(W * k / 2) * 2); H = Math.max(32, Math.round(H * k / 2) * 2);
  }
  return { blob, W, H };
}
async function gsEstimate() {
  const fmt = gs.set.fmt, [W, H] = gsOutSize(fmt), fps = +gs.set.fps, frames = gsFramePlan(fmt === 'mp4' ? fps : gsOutFps(fmt)), out = $('#gsEst');
  if (!gs.slides.length || !out) return;
  out.textContent = '계산하는 중…';
  try {
    let bytes;
    if (fmt === 'mp4') bytes = (gsMp4Bitrate(W, H, fps, +gs.set.mq || 75) + ((gs.au || []).some(a => !a.hidden) ? 160000 : 0)) * gsTotal() / 8;
    else {
      const sample = [0, Math.floor(frames.length / 2), frames.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => frames[i]);
      const b = fmt === 'gif' ? await encodeGif(W, H, sample, gsRenderAt, () => { }, +gs.set.colors || 256) : await encodeWebp(W, H, sample, gsRenderAt, () => { }, +gs.set.q || 88);
      bytes = b.size / sample.length * frames.length;
    }
    const t = (+gs.set.target || 0) * 1048576;
    out.textContent = `예상 약 ${(bytes / 1048576).toFixed(1)}MB (${fmt === 'mp4' ? Math.round(gsTotal() * fps) : frames.length}장${fmt === 'mp4' ? ` · ${(gsMp4Bitrate(W, H, fps, +gs.set.mq || 75) / 1e6).toFixed(1)}Mbps` : ''})` + (t && bytes > t ? ` · 목표보다 커서 저장할 때 줄여요` : '');
  } catch (e) { out.textContent = fmt === 'mp4' ? '이 컴퓨터에서는 MP4로 저장할 수 없어요' : '계산하지 못했어요'; }
}
/* ---- AI 중간 장면 (RIFE v4.9): 고른 장면 사이에 새 장면을 그려 넣어 부드럽게 ---- */
// 장면 둘 + 시점(0~1)을 한 입력 [1,7,H,W]로. 가로·세로는 32의 배수로 늘려(가장자리 늘이기) 넣고 결과에서 잘라요
function riPlane(src, W, H, Wp, Hp) {
  const c = newCanvas(Wp, Hp), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, W, H);
  if (Wp > W) g.drawImage(c, W - 1, 0, 1, H, W, 0, Wp - W, H);
  if (Hp > H) g.drawImage(c, 0, H - 1, Wp, 1, 0, H, Wp, Hp - H);
  return g.getImageData(0, 0, Wp, Hp).data;
}
async function riRun(A, B, t, W, H) { // A, B: 같은 크기의 그림 → 중간 장면 캔버스
  const Wp = Math.ceil(W / 32) * 32, Hp = Math.ceil(H / 32) * 32, N = Wp * Hp, x = new Float32Array(7 * N);
  const a = riPlane(A, W, H, Wp, Hp), b = riPlane(B, W, H, Wp, Hp);
  let alpha = false;
  for (let i = 0; i < N; i++) {
    x[i] = a[i * 4] / 255; x[N + i] = a[i * 4 + 1] / 255; x[2 * N + i] = a[i * 4 + 2] / 255;
    x[3 * N + i] = b[i * 4] / 255; x[4 * N + i] = b[i * 4 + 1] / 255; x[5 * N + i] = b[i * 4 + 2] / 255; x[6 * N + i] = t;
    if (a[i * 4 + 3] < 250 || b[i * 4 + 3] < 250) alpha = true;
  }
  const out = await czCall({ t: 'run', key: 'rife', data: x, dims: [1, 7, Hp, Wp] }, [x.buffer]), o = out.data;
  const c = newCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const i = y * Wp + xx, j = (y * W + xx) * 4;
    d[j] = o[i] * 255; d[j + 1] = o[N + i] * 255; d[j + 2] = o[2 * N + i] * 255;
    d[j + 3] = alpha ? a[i * 4 + 3] * (1 - t) + b[i * 4 + 3] * t : 255; // 투명한 곳은 섞어서
  }
  g.putImageData(id, 0, 0); return c;
}
let riBusy = false;
async function gsInterp(mult) {
  const P = gsPicked(); if (P.length < 2 || riBusy) { if (P.length < 2) toast('장면을 두 개 넘게 골라 주세요'); return; }
  if (!(await aiReady('interp'))) return;
  const slow = !!($('#gsAiSlow') && $('#gsAiSlow').checked); gs.set.aiSlow = slow;
  const idx = P.map(s => gs.slides.indexOf(s)).sort((x, y) => x - y), pairs = [];
  for (let k = 0; k + 1 < idx.length; k++) if (idx[k + 1] === idx[k] + 1) pairs.push(gs.slides[idx[k]]); // 붙어 있는 장면 사이만
  if (!pairs.length) { toast('붙어 있는 장면을 골라 주세요'); return; }
  riBusy = true; const tk = czProgress('AI로 중간 장면 만드는 중'); let made = 0, skip = 0;
  try {
    tk.set('중간 장면 모델 준비하는 중… (처음엔 몇 초 걸려요)', 0.02);
    await czLoad('rife'); if (tk.stop) throw new Error('stop');
    const total = pairs.length * (mult - 1), t0 = performance.now();
    for (const A of pairs) {
      const i = gs.slides.indexOf(A), B = gs.slides[i + 1]; if (!B) continue;
      const W = A.bmp.width, H = A.bmp.height;
      if (gsPixels() + W * H * (mult - 1) > GS_BUDGET) { gsFull(); break; }
      // 그림이 확 바뀌면(다른 그림) 건너뛰어요: 작게 줄여 차이를 봐요
      if (riCut(A.bmp, B.bmp)) { skip++; continue; }
      const d0 = gsDur(A), add = [];
      for (let k = 1; k < mult; k++) {
        if (tk.stop) throw new Error('stop');
        const c = await riRun(A.bmp, B.bmp, k / mult, W, H);
        add.push({ ...A, id: uid(), bmp: c, w: W, h: H, th: null, thBusy: false, tr: 'none', motion: 'none', dur: slow ? d0 : Math.round(d0 / mult * 1000) / 1000 });
        made++; const el = (performance.now() - t0) / made;
        tk.set(`${made} / ${total}장 · 남은 시간 약 ${Math.ceil(el * (total - made) / 1000)}초`, made / total);
      }
      if (!slow) A.dur = Math.round(d0 / mult * 1000) / 1000;
      A.motion = 'none'; B.motion = 'none'; B.tr = 'none'; // 이어지는 움직임이 되니 장면마다 움직임·넘김 효과는 빼요
      gs.slides.splice(gs.slides.indexOf(A) + 1, 0, ...add);
      for (const s of add) gs.pick.add(s.id);
      await new Promise(r => setTimeout(r, 0));
    }
    tk.done();
    toast(made ? `중간 장면 ${made}장을 넣었어요${slow ? ' (느리게)' : ' (길이는 그대로)'}${skip ? `. 그림이 확 바뀌는 ${skip}곳은 건너뛰었어요` : ''}` : '그림이 확 바뀌는 장면들이라 넣지 않았어요', 4200);
  } catch (e) {
    tk.done(); const m = String((e && e.message) || e);
    if (m !== 'stop') toast('중간 장면을 만들지 못했어요. ' + (/^nopack/.test(m) ? "'AI 중간 장면 팩'을 받아 주세요." : czErrText(e)), 5000);
    else if (made) toast(`멈췄어요. 그때까지 만든 ${made}장은 넣었어요`);
  } finally { riBusy = false; gsChanged(); }
}
function riCut(a, b) { // 두 장면이 다른 그림(장면 전환)이면 true: 작게 줄여 평균 차이와 밝기 모양의 닮은 정도를 봐요
  const S = 32, c = newCanvas(S * 2, S), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
  g.drawImage(a, 0, 0, S, S); g.drawImage(b, S, 0, S, S);
  const d = g.getImageData(0, 0, S * 2, S).data, n = S * S, ga = new Float32Array(n), gb = new Float32Array(n); let md = 0, ma = 0, mb = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S * 2 + x) * 4, j = i + S * 4, k = y * S + x; md += Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]); ga[k] = d[i] + d[i + 1] + d[i + 2]; gb[k] = d[j] + d[j + 1] + d[j + 2]; ma += ga[k]; mb += gb[k]; }
  md /= n * 3; ma /= n; mb /= n; let sab = 0, saa = 0, sbb = 0;
  for (let k = 0; k < n; k++) { const x = ga[k] - ma, y = gb[k] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  const cor = sab / (Math.sqrt(saa * sbb) + 1e-6);
  return md > 24 || (md > 9 && cor < 0.5);
}
