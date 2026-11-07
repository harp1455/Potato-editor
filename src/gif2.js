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
  const n = Math.max(1, Math.min(400, Math.round((opt.end - opt.start) * opt.fps))), clip = 'c' + uid();
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
      ${row('초당 장 수', `<select id="gvF">${[6, 8, 10, 12, 15, 20, 24, 30].map(f => `<option value="${f}" ${f === 12 ? 'selected' : ''}>${f}장</option>`).join('')}</select>`)}
      ${row('크기 (긴 쪽)', `<select id="gvM">${[360, 480, 640, 800, 1080].map(f => `<option value="${f}" ${f === 640 ? 'selected' : ''}>${f}px</option>`).join('')}</select>`)}
      <p class="muted small" id="gvN"></p>
      <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="gvGo">불러오기</button></div>`, { wide: true });
    v.controls = true; v.style.maxWidth = '100%'; v.style.maxHeight = '40vh'; $('#gvBox', m).appendChild(v);
    const upd = () => { const s = +$('#gvS', m).value || 0, e = +$('#gvE', m).value || 0, n = Math.round(Math.max(0, e - s) * +$('#gvF', m).value); $('#gvN', m).textContent = n > 400 ? `${n}장이 돼요. 한 번에 400장까지라 앞에서부터 400장만 넣어요.` : `${n}장이 장면으로 들어가요.`; };
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
    <div class="btnrow"><button class="btn sm" data-g="b-none" title="움직임·넘김 효과 없이 (영상·GIF 프레임용)">효과 없이</button><button class="btn sm" data-g="b-dup">복제</button><button class="btn sm danger" data-g="b-del">빼기</button><button class="btn sm" data-g="b-clear">고르기 풀기</button></div></div>`;
}
function gsPickClick(i, e) { // 장면 목록 클릭: Shift = 범위, Ctrl = 하나씩
  const s = gs.slides[i]; if (!s) return;
  if (e.shiftKey && gs.sel >= 0) { const [a, b] = [Math.min(gs.sel, i), Math.max(gs.sel, i)]; gs.pick = new Set(gs.slides.slice(a, b + 1).map(x => x.id)); }
  else if (e.ctrlKey || e.metaKey) { if (gs.pick.size === 0 && gs.slides[gs.sel]) gs.pick.add(gs.slides[gs.sel].id); gs.pick.has(s.id) ? gs.pick.delete(s.id) : gs.pick.add(s.id); gs.sel = i; }
  else { gs.pick = new Set(); gs.sel = i; }
}

/* ---- 저장: MP4(H.264), 용량 맞추기, 예상 용량 ---- */
async function gsMp4Codec(W, H, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return null;
  for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.42003e', 'avc1.42001f']) {
    const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return cfg; } catch (_) { }
  }
  return null;
}
async function encodeMp4(W, H, fps, total, renderFrame, progress, bitrate) {
  W -= W % 2; H -= H % 2;
  const cfg = await gsMp4Codec(W, H, fps, bitrate); if (!cfg) throw new Error('nomp4');
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(cfg);
  const c = newCanvas(W, H), g = c.getContext('2d'), n = Math.max(1, Math.round(total * fps)), us = 1e6 / fps;
  for (let i = 0; i < n; i++) {
    if (err) throw err;
    renderFrame(g, i / fps, W, H);
    const f = new VideoFrame(c, { timestamp: Math.round(i * us), duration: Math.round(us) });
    enc.encode(f, { keyFrame: i % (fps * 2) === 0 }); f.close();
    if (enc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
    progress(i + 1, n);
  }
  await enc.flush(); enc.close(); if (err) throw err;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
function gsEncodeOnce(fmt, W, H, opt, prog) {
  const R = (g, t, w, h) => gsRenderAt(g, t, w, h);
  if (fmt === 'mp4') return encodeMp4(W, H, opt.fps, gsTotal(), R, prog, opt.bitrate);
  const frames = gsFramePlan(opt.fps);
  if (fmt === 'gif') return encodeGif(W, H, frames, R, prog, opt.colors);
  return encodeWebp(W, H, frames, R, prog, opt.q);
}
const gsMp4Bitrate = (W, H, fps, q) => Math.round(W * H * fps * (0.04 + q / 100 * 0.22)); // 화질(40~100) → 픽셀당 비트
// 목표 용량 안으로: 한 번 만들어 보고, 크면 화질·색 수·크기를 줄여 다시 (최대 5번)
async function gsEncodeTarget(fmt, prog) {
  let [W, H] = gsSize(); const set = gs.set, target = (+set.target || 0) * 1048576;
  let opt = { fps: +set.fps, colors: +set.colors || 256, q: +set.q || 88, bitrate: gsMp4Bitrate(W, H, +set.fps, +set.mq || 75) };
  if (fmt === 'mp4' && target) opt.bitrate = Math.max(150e3, Math.round(target * 8 * 0.93 / Math.max(0.5, gsTotal())));
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
  const [W, H] = gsSize(), fmt = gs.set.fmt, fps = +gs.set.fps, frames = gsFramePlan(fps), out = $('#gsEst');
  if (!gs.slides.length || !out) return;
  out.textContent = '계산하는 중…';
  try {
    let bytes;
    if (fmt === 'mp4') bytes = gsMp4Bitrate(W, H, fps, +gs.set.mq || 75) * gsTotal() / 8;
    else {
      const sample = [0, Math.floor(frames.length / 2), frames.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => frames[i]);
      const b = fmt === 'gif' ? await encodeGif(W, H, sample, gsRenderAt, () => { }, +gs.set.colors || 256) : await encodeWebp(W, H, sample, gsRenderAt, () => { }, +gs.set.q || 88);
      bytes = b.size / sample.length * frames.length;
    }
    const t = (+gs.set.target || 0) * 1048576;
    out.textContent = `예상 약 ${(bytes / 1048576).toFixed(1)}MB (${frames.length}장)` + (t && bytes > t ? ` · 목표보다 커서 저장할 때 줄여요` : '');
  } catch (e) { out.textContent = fmt === 'mp4' ? '이 컴퓨터에서는 MP4로 저장할 수 없어요' : '계산하지 못했어요'; }
}
