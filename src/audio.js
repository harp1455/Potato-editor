/* ================= 움짤: 배경 음악·효과음 (MP4로 저장할 때만 들어가요) ================= */
// 소리 막대 하나 = { id, sid(원본 소리), name, t0, t1, off(원본에서 시작할 곳, 초), vol(0~200), fin·fout(서서히, 초), loop, lane }
// 원본 파일은 sid마다 한 번만 저장하고(auSrc), 막대를 나누거나 복제해도 같은 원본을 같이 써요.
const auSrc = new Map(); // sid → { blob, name, dur, buf(AudioBuffer) }
let auCtx = null, auNodes = [];
const isAudioFile = f => /^audio\//.test(f.type || '') || /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)$/i.test(f.name || '');
const auT1 = a => a.t1 == null ? gsTotal() : a.t1;
const auLen = a => { const s = auSrc.get(a.sid); return s ? s.dur : 0; };
function auCtxGet() {
  if (!auCtx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; auCtx = new C(); }
  if (auCtx.state === 'suspended') auCtx.resume().catch(() => { });
  return auCtx;
}
async function auDecode(blob) {
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext, ab = await blob.arrayBuffer();
  const ctx = auCtxGet() || new C(2, 1, 48000);
  return await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
}
// 파일 → 소리 막대 (영상 파일이면 그 소리만)
async function auAddFiles(files, t0, lane) {
  if (!gs.slides.length) { toast('장면을 먼저 넣어 주세요. 소리는 장면 길이에 맞춰 들어가요'); return; }
  let n = 0, last = null;
  for (const f of files) {
    try {
      const buf = await auDecode(f), sid = uid();
      auSrc.set(sid, { blob: f.slice ? f.slice(0, f.size, f.type) : f, name: f.name, dur: buf.duration, buf });
      const a = { id: uid(), sid, name: f.name.replace(/\.[^.]+$/, ''), off: 0, vol: 100, fin: 0, fout: 0, loop: false };
      const start = t0 ?? gpT0(), end = start + buf.duration;
      a.t1 = end >= gsTotal() - 0.02 ? null : Math.round(end * 100) / 100;
      gpPlace(gs.au, a, start, lane); last = a; n++;
    } catch (e) { toast(`${f.name}에서 소리를 읽지 못했어요. MP3·WAV·M4A·OGG나 소리가 든 영상을 넣어 주세요`, 4500); }
  }
  if (!last) return;
  gs.asel = last.id; gs.focus = 'au'; gsChanged();
  toast(n > 1 ? `소리 ${n}개를 넣었어요` : '소리를 넣었어요. 소리는 MP4로 저장할 때 들어가요', 3200);
}
function auPick(t0, lane) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.opus'; inp.multiple = true;
  inp.onchange = () => { const fs = [...inp.files]; if (fs.length) auAddFiles(fs, t0, lane); }; inp.click();
}
// 막대 하나를 소리 그래프에 얹기 (from = 움짤 시간에서 이 시점부터, at = 소리 그래프 시각)
function auSchedule(ctx, dest, a, from, at, T) {
  const S = auSrc.get(a.sid); if (!S || !S.buf || a.hidden) return null;
  const t0 = a.t0 || 0, t1 = Math.min(auT1(a), T); if (t1 <= from || t1 <= t0) return null;
  const st = Math.max(t0, from), len = t1 - st, el = st - t0; // el = 막대 안에서 이미 지난 시간
  let off = (a.off || 0) + el;
  if (!a.loop && off >= S.dur) return null;
  const src = ctx.createBufferSource(); src.buffer = S.buf;
  if (a.loop) { src.loop = true; src.loopStart = Math.min(a.off || 0, S.dur - 0.01); src.loopEnd = S.dur; if (off >= S.dur) off = src.loopStart + (off - src.loopStart) % Math.max(0.01, S.dur - src.loopStart); }
  const g = ctx.createGain(), v = clamp((a.vol ?? 100) / 100, 0, 2), when = at + (st - from), D = t1 - t0, fi = Math.min(a.fin || 0, D / 2), fo = Math.min(a.fout || 0, D / 2);
  const envAt = x => v * Math.min(fi > 0 ? clamp(x / fi, 0, 1) : 1, fo > 0 ? clamp((D - x) / fo, 0, 1) : 1); // 막대 안 시각 x의 크기
  g.gain.setValueAtTime(envAt(el), when);
  if (fi > 0 && el < fi) g.gain.linearRampToValueAtTime(envAt(fi), when + (fi - el));
  if (fo > 0) { const s2 = Math.max(el, D - fo); g.gain.setValueAtTime(envAt(s2), when + (s2 - el)); g.gain.linearRampToValueAtTime(0, when + (D - el)); }
  src.connect(g); g.connect(dest);
  src.start(when, off); src.stop(when + len);
  return src;
}
function auPlayStart() {
  auPlayStop(); if (!gs.au || !gs.au.length) return;
  const ctx = auCtxGet(); if (!ctx) return;
  const T = gsTotal(), at = ctx.currentTime + 0.03;
  for (const a of gs.au) { const s = auSchedule(ctx, ctx.destination, a, gs.t, at, T); if (s) auNodes.push(s); }
}
function auPlayStop() { for (const s of auNodes) { try { s.stop(); } catch (_) { } } auNodes = []; }
// 저장용: 전체 길이를 한 번에 섞어 AudioBuffer로 (소리가 없으면 null)
async function auMix(T, sr = 48000) {
  const list = (gs.au || []).filter(a => !a.hidden && auSrc.get(a.sid) && auSrc.get(a.sid).buf && (a.t0 || 0) < T);
  if (!list.length || T <= 0) return null;
  const C = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!C) return null;
  const ctx = new C(2, Math.max(1, Math.ceil(T * sr)), sr);
  for (const a of list) auSchedule(ctx, ctx.destination, a, 0, 0, T);
  return await ctx.startRendering();
}
// AudioBuffer → MP4 소리 (AAC가 되면 AAC, 아니면 Opus)
async function auEncoderCfg(sr, ch) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: sr, numberOfChannels: ch, bitrate: 160000 };
    try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, mux }; } catch (_) { }
  }
  return null;
}
async function auEncode(buf, muxer, cfg) {
  let err = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: e => { err = e; } });
  enc.configure(cfg);
  const sr = buf.sampleRate, ch = buf.numberOfChannels, N = buf.length, step = 4800, chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < N; i += step) {
    if (err) throw err;
    const n = Math.min(step, N - i), data = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) data.set(chans[c].subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(i / sr * 1e6), data });
    enc.encode(ad); ad.close();
    if (enc.encodeQueueSize > 16) await new Promise(r => setTimeout(r, 0));
  }
  await enc.flush(); enc.close(); if (err) throw err;
}
// 속성 칸
function auPropsHtml(a) {
  const S = auSrc.get(a.sid), dur = S ? S.dur : 0;
  return `<div class="sec"><h3>시간</h3>
      ${row('시작', `<input type="number" data-gk="a.t0" min="0" step="0.05" value="${fmtT(a.t0)}" style="width:64px"> 초 <button class="btn sm" data-g="au-now0" title="지금 재생 위치를 시작으로">지금</button>`)}
      ${row('끝', `<input type="number" data-gk="a.t1" min="0" step="0.05" value="${a.t1 == null ? '' : fmtT(a.t1)}" placeholder="끝까지" style="width:64px"> 초 <button class="btn sm" data-g="au-now1" title="지금 재생 위치를 끝으로">지금</button>`)}
      ${row('소리 시작 위치', `<input type="number" data-gk="a.off" min="0" max="${Math.max(0, dur - 0.05).toFixed(2)}" step="0.05" value="${fmtT(a.off || 0)}" style="width:64px"> 초 <span class="muted small">/ ${fmtTC(dur)}</span>`)}
      <p class="gp-tip">음악의 앞부분을 건너뛰려면 '소리 시작 위치'를 늘려요. 막대 왼쪽 끝을 끌어도 같이 바뀌어요.</p></div>
    <div class="sec"><h3>소리</h3>
      ${row('크기', rng('a.vol', a.vol ?? 100, 0, 200, 1, '%'))}
      ${row('서서히 커지기', rng('a.fin', a.fin || 0, 0, 5, 0.1, '초'))}
      ${row('서서히 작아지기', rng('a.fout', a.fout || 0, 0, 5, 0.1, '초'))}
      ${row('', `<label class="chk"><input type="checkbox" data-gk="a.loop" ${a.loop ? 'checked' : ''}> 소리가 짧으면 반복</label>`)}
      <div class="btnrow"><button class="btn sm" data-g="au-fit" title="움짤 처음부터 끝까지 이 소리를 깔아요">전체 길이에 깔기</button><button class="btn sm" data-g="dup">복제</button><button class="btn sm danger" data-g="del-sel">지우기</button></div>
      <p class="gp-tip">${gs.set.fmt === 'mp4' ? '스페이스로 재생하면 소리도 같이 들려요.' : '소리는 MP4로 저장할 때만 들어가요. 저장 형식을 MP4로 바꿔 주세요.'}</p></div>`;
}
function auSetKey(k, t) {
  const a = (gs.au || []).find(x => x.id === gs.asel); if (!a) return false;
  const f = k.slice(2); let v = t.type === 'checkbox' ? t.checked : t.value;
  if (f === 't1' && v === '') v = null;
  else if (t.type === 'number' || t.type === 'range') { v = parseFloat(v); if (!isFinite(v)) return false; }
  const T = gsTotal();
  if (f === 't0') a.t0 = clamp(v, 0, Math.max(0, T - 0.1));
  else if (f === 't1') a.t1 = v == null ? null : clamp(v, (a.t0 || 0) + 0.05, T) >= T - 0.005 ? null : clamp(v, (a.t0 || 0) + 0.05, T);
  else if (f === 'off') a.off = clamp(v, 0, Math.max(0, auLen(a) - 0.05));
  else if (f === 'vol') a.vol = clamp(v, 0, 200);
  else if (f === 'fin' || f === 'fout') a[f] = clamp(v, 0, 10);
  else if (f === 'loop') a.loop = !!v;
  if (f === 't0' || f === 't1') { if (!laneFree(gs.au, a, a.lane)) a.lane = laneFor(gs.au, a); laneFix(gs.au); }
  const rv = t.nextElementSibling; if (t.type === 'range' && rv && rv.classList.contains('rv')) rv.textContent = t.value + (f === 'vol' ? '%' : '초');
  if (gs.playing) auPlayStart();
  return true;
}
function auClick(a) {
  const x = (gs.au || []).find(y => y.id === gs.asel);
  if (a === 'au-add') { auPick(); return; }
  if (!x) return;
  if (a === 'au-now0') { x.t0 = Math.min(Math.round(gs.t * 100) / 100, Math.max(0, gsTotal() - 0.1)); if (x.t1 != null && x.t1 <= x.t0 + 0.05) x.t1 = null; }
  else if (a === 'au-now1') { const t = Math.round(gs.t * 100) / 100; if (t > (x.t0 || 0) + 0.05) x.t1 = t >= gsTotal() - 0.005 ? null : t; }
  else if (a === 'au-fit') { x.t0 = 0; x.t1 = null; x.loop = auLen(x) - (x.off || 0) < gsTotal(); if (x.loop) toast('소리가 움짤보다 짧아서 반복하게 했어요', 2400); }
  else if (a === 'au-dup') { const y = { ...x, id: uid() }; gpPlace(gs.au, y, y.t0, null); gs.asel = y.id; }
  else if (a === 'au-del') { gs.au.splice(gs.au.indexOf(x), 1); gs.asel = null; gs.focus = 'set'; }
  laneFix(gs.au); gsChanged();
}
// 저장·불러오기 (원본 소리 파일은 쓰는 것만)
function auPlain() {
  const used = new Set((gs.au || []).map(a => a.sid)), src = [];
  for (const sid of used) { const S = auSrc.get(sid); if (S) src.push({ sid, blob: S.blob, name: S.name, dur: S.dur }); }
  return { au: (gs.au || []).map(a => ({ ...a })), auSrc: src };
}
async function auRestore(d) {
  gs.au = [];
  for (const s of (d && d.auSrc) || []) {
    if (auSrc.has(s.sid) && auSrc.get(s.sid).buf) continue;
    try { const buf = await auDecode(s.blob); auSrc.set(s.sid, { blob: s.blob, name: s.name, dur: buf.duration, buf }); } catch (e) { }
  }
  gs.au = ((d && d.au) || []).filter(a => auSrc.has(a.sid));
  laneFix(gs.au);
}
