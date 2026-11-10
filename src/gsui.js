/* ================= 움짤 화면: 프리미어 프로처럼 (재료 · 미리보기 · 속성 / 아래 시간 막대) ================= */
const GP_HW = 112; // 시간 막대 왼쪽 줄 이름 칸 폭
const GP_IC = {
  start: '<path d="M3 3h2v10H3zM13 3 6 8l7 5z"/>', back: '<path d="M11 3h2v10h-2zM10 3 3 8l7 5z"/>',
  play: '<path d="M4.5 2.5v11l9-5.5z"/>', pause: '<path d="M4 3h3v10H4zm5 0h3v10H9z"/>',
  fwd: '<path d="M3 3h2v10H3zm3 0 7 5-7 5z"/>', end: '<path d="M11 3h2v10h-2zM3 3l7 5-7 5z"/>',
  sel: '<path d="M3.5 1.5 12 7.6l-3.9.9 2.2 4.4-1.7.9-2.2-4.4-2.9 2.5z"/>',
  razor: '<g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4.3" cy="12" r="2.2"/><circle cx="11.7" cy="12" r="2.2"/><path d="M5.6 10.3 11.3 2M10.4 10.3 4.7 2"/></g>',
  snap: '<path fill="none" stroke="currentColor" stroke-width="1.8" d="M3.5 2v6a4.5 4.5 0 0 0 9 0V2"/><path d="M2.5 1.5h2.2v2.2H2.5zm8.8 0h2.2v2.2h-2.2z"/>',
  eye: '<path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.2 8S3.6 3.5 8 3.5 14.8 8 14.8 8 12.4 12.5 8 12.5 1.2 8 1.2 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeoff: '<path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.2 8S3.6 3.5 8 3.5 14.8 8 14.8 8 12.4 12.5 8 12.5 1.2 8 1.2 8zM2.5 13.5l11-11"/>',
};
const gpI = (k, cls = '') => `<svg class="gpi ${cls}" viewBox="0 0 16 16" aria-hidden="true">${GP_IC[k]}</svg>`;
const fmtTC = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const FX_ICON = { snow: '❄️', rain: '🌧️', sakura: '🌸', hearts: '💗', sparkle: '✨', stars: '⭐', confetti: '🎊', bubbles: '🫧', embers: '🔥', bokeh: '🟡', focus: '✳️', speed: '💨', shake: '〰️', zoom: '🔍', flash: '⚡', invert: '◐', glitch: '📺', vhs: '📼', grain: '🎞️', leak: '☀️', vignette: '⭕', bw: '◑', 'cam-rec': '🔴', 'cam-phone': '📱', 'cam-vf': '🎯', 'cam-vhs': '📼', 'cam-cctv': '📹', 'cam-film': '🎞️', 'cam-letterbox': '🎬' };
Object.assign(gs, { lib: 'media', tool: 'sel', snap: true, pps: 80, zoomFit: true, trSel: -1, preOpen: false });
// 시간 막대 줄 종류: o = 글자·스티커, f = 효과, a = 소리
const tlL = k => k === 'o' ? gs.ovs : k === 'f' ? gs.fx : (gs.au || (gs.au = []));
const tlT1 = (k, x) => k === 'o' ? ovT1(x) : k === 'f' ? fxT1(x) : auT1(x);
const tlSelId = k => k === 'o' ? gs.osel : k === 'f' ? gs.fsel : gs.asel;
function tlSelect(k, x) { if (k === 'o') { gs.osel = x.id; gs.focus = 'ov'; } else if (k === 'f') { gs.fsel = x.id; gs.focus = 'fx'; } else { gs.asel = x.id; gs.focus = 'au'; } }

/* ---- 화면 만들기 ---- */
function buildGifStudio() {
  if (gs.built) return; gs.built = true;
  const d = document.createElement('div'); d.id = 'gifStudio'; d.className = 'gs gp'; d.hidden = true;
  try { const h = +localStorage.getItem('potatoTLH'); if (h > 120) d.style.setProperty('--tlh', h + 'px'); } catch (e) { }
  d.innerHTML = `<div class="gs-top gp-top"><b>움짤 만들기</b><div class="gp-dash" id="gpDash"></div><div class="flex1"></div>
      <button class="btn primary" data-g="export-open" title="GIF, 움직이는 WebP, MP4로 저장 (Ctrl+M)">내보내기</button><button class="btn" data-g="close">편집기로 돌아가기</button></div>
    <div class="gp-up">
      <aside class="gp-lib" id="gpLib"></aside>
      <main class="gp-mon">
        <div class="gs-stage" id="gsStage"><canvas id="gsCv"></canvas><div id="gsEmpty" class="gs-empty"><b>장면을 넣어 주세요</b>사진·GIF·영상을 이 화면으로 끌어오거나, 왼쪽 '장면'에서 넣으세요. GIF와 영상은 프레임마다 장면으로 나뉘어 아래 시간 막대에 들어가요.</div></div>
        <div class="gp-transport">
          <span class="gp-tc" id="gsTimeL">0:00.00</span>
          <div class="gp-tbtns">
            <button class="gp-ib" data-g="go-start" title="처음으로 (Home)">${gpI('start')}</button>
            <button class="gp-ib" data-g="step-back" title="한 장 뒤로 (←)">${gpI('back')}</button>
            <button class="gp-ib gp-play" data-g="play" id="gsPlay" title="재생 / 멈춤 (Space)">${gpI('play')}</button>
            <button class="gp-ib" data-g="step-fwd" title="한 장 앞으로 (→)">${gpI('fwd')}</button>
            <button class="gp-ib" data-g="go-end" title="끝으로 (End)">${gpI('end')}</button>
          </div>
          <span class="gp-tc r" id="gpTotal"></span>
        </div>
      </main>
      <aside class="gp-insp" id="gsProps"></aside>
    </div>
    <div class="gp-split" id="gpSplit" title="끌어서 시간 막대 높이를 바꿔요"></div>
    <section class="gp-tl">
      <div class="gp-tbar" id="gpTbar"></div>
      <div class="gp-scroll" id="gpScroll"><div class="gp-rows" id="gpRows"></div></div>
    </section>
    <input type="file" id="gsFile" accept="image/*,video/*,audio/*" multiple hidden>`;
  document.body.appendChild(d);
  d.addEventListener('click', gsClick);
  $('#gsProps').addEventListener('input', gsInput); $('#gsProps').addEventListener('change', gsInput);
  $('#gsProps').addEventListener('toggle', e => { if (e.target.dataset && e.target.dataset.k === 'pre') gs.preOpen = e.target.open; }, true);
  $('#gpLib').addEventListener('input', e => { if (e.target.id === 'gpTrQ') gpTrFilter(); });
  $('#gsFile').addEventListener('change', async e => { const fs = [...e.target.files]; e.target.value = ''; await gsAddFiles(fs); });
  const stage = $('#gsStage');
  d.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); stage.classList.add('drop'); } });
  d.addEventListener('dragleave', e => { if (!d.contains(e.relatedTarget)) stage.classList.remove('drop'); });
  d.addEventListener('drop', async e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); stage.classList.remove('drop'); await gsAddFiles([...e.dataTransfer.files]); });
  new ResizeObserver(() => gsFitCanvas()).observe(stage);
  new ResizeObserver(() => { if (gs.zoomFit) tlBuild(); }).observe($('#gpScroll'));
  ovBind(); tlBind(); gpLibBind(); gpSplitBind();
}
async function openGifStudio() {
  if (mode) setMode(null);
  buildGifStudio(); $('#gifStudio').hidden = false;
  if (!gs.loaded) { gs.loaded = true; await gsLoad(); }
  gsRenderAll();
}
function closeGifStudio() { gsPause(); $('#gifStudio').hidden = true; gsSave(); }
function gsFitCanvas() {
  const [W, H] = gsSize(), cv = $('#gsCv'), st = $('#gsStage');
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const k = Math.min((st.clientWidth - 28) / W, (st.clientHeight - 28) / H, 1.5);
  cv.style.width = Math.max(10, W * k) + 'px'; cv.style.height = Math.max(10, H * k) + 'px';
  gsDraw();
}
function gsDraw() {
  const cv = $('#gsCv'); if (!cv) return; const g = cv.getContext('2d');
  gsRenderAt(g, gs.t, cv.width, cv.height); ovDrawSel(g, cv.width, cv.height);
  const T = gsTotal(), fps = +gs.set.fps || 12;
  $('#gsTimeL').textContent = fmtTC(gs.t);
  $('#gpTotal').textContent = gs.slides.length ? `${Math.min(Math.floor(gs.t * fps) + 1, Math.max(1, Math.round(T * fps)))} / ${Math.max(1, Math.round(T * fps))}장 · 전체 ${fmtTC(T)}` : '';
  $('#gsEmpty').hidden = gs.slides.length > 0;
  tlHead();
}
function gsPlay() {
  if (!gs.slides.length) return; gs.playing = true; const b = $('#gsPlay'); b.innerHTML = gpI('pause'); b.classList.add('on');
  const T = gsTotal(); if (gs.t >= T - 0.01) gs.t = 0;
  gs.start = performance.now() - gs.t * 1000; auPlayStart();
  const step = now => { if (!gs.playing) return; const T = gsTotal(); gs.t = ((now - gs.start) / 1000); if (gs.t >= T) { if (gs.set.loop) { gs.start = now; gs.t = 0; auPlayStart(); } else { gs.t = T; gsPause(); gsDraw(); return; } } gsDraw(); gs.raf = requestAnimationFrame(step); };
  gs.raf = requestAnimationFrame(step);
}
function gsPause() { const was = gs.playing; gs.playing = false; cancelAnimationFrame(gs.raf); auPlayStop(); const b = $('#gsPlay'); if (b) { b.innerHTML = gpI('play'); b.classList.remove('on'); } if (was) gsDraw(); }
function gpSeek(t) { gsPause(); gs.t = clamp(t, 0, gsTotal()); gsDraw(); }
const gsStarts = () => { const a = []; let acc = 0; for (const s of gs.slides) { a.push(acc); acc += gsDur(s); } a.push(acc); return a; };
const gsSceneAt = t => { const st = gsStarts(); for (let i = gs.slides.length - 1; i >= 0; i--) if (t >= st[i] - 1e-9) return i; return 0; };

/* ---- 위쪽 요약 (대시보드) ---- */
function gpDashRender() {
  const el = $('#gpDash'); if (!el) return;
  const S = gs.slides; if (!S.length) { el.innerHTML = '<span class="muted small">장면을 넣으면 여기에 길이·크기·저장 장 수가 보여요</span>'; return; }
  const [W, H] = gsSize(), n = gsFramePlan(+gs.set.fps).length, fmt = gs.set.fmt === 'gif' ? 'GIF' : gs.set.fmt === 'mp4' ? 'MP4' : 'WebP';
  const chip = (l, v, t) => `<button class="gp-chip" data-g="desel" title="${t}"><i>${l}</i>${v}</button>`;
  el.innerHTML = chip('장면', S.length + '개', '전체 설정 보기') + chip('길이', fmtTC(gsTotal()), '전체 설정 보기') + chip('크기', `${W}×${H}`, '전체 설정에서 바꿔요') + chip('초당', gs.set.fps + '장', '전체 설정에서 바꿔요')
    + chip('저장하면', n + '장', '움직이지 않는 부분은 한 장으로 합쳐요') + chip('형식', fmt, '내보내기에서 바꿔요')
    + (gs.ovs.length ? chip('글자', gs.ovs.length + '개', '') : '') + (gs.fx.length ? chip('효과', gs.fx.length + '개', '') : '');
}

/* ---- 왼쪽: 재료 (장면 · 글자 · 효과 · 넘김) ---- */
function gpLibRender() {
  const el = $('#gpLib'); if (!el) return;
  const tabs = [['media', '장면'], ['text', '글자'], ['fx', '효과'], ['tr', '넘김']];
  let h = `<div class="gs-tabs gp-libtabs">${tabs.map(([v, l]) => `<button class="${gs.lib === v ? 'on' : ''}" data-g="lib" data-v="${v}">${l}</button>`).join('')}</div><div class="gp-libbody">`;
  const dragTip = '<p class="gp-tip">누르면 재생 위치에 들어가요. 아래 시간 막대로 끌어다 놓으면 놓은 시간에 들어가요.</p>';
  if (gs.lib === 'media') {
    const clips = [], seen = new Map();
    gs.slides.forEach((s, i) => { if (!s.clip) return; if (!seen.has(s.clip)) { seen.set(s.clip, { id: s.clip, name: s.name, i, n: 0 }); clips.push(seen.get(s.clip)); } seen.get(s.clip).n++; });
    h += `<button class="btn primary gp-wide" data-g="add-file" title="사진, GIF, 움직이는 WebP, 영상(MP4·WebM)">+ 사진·GIF·영상 넣기</button>
      <div class="btnrow"><button class="btn sm" data-g="add-lib">보관함에서</button><button class="btn sm" data-g="add-page" title="편집기의 지금 페이지(고른 것이 있으면 그 부분만)">지금 페이지</button></div>
      <p class="gp-tip">이 화면으로 파일을 끌어와도 돼요. 새 장면은 맨 뒤에 붙어요.</p>
      <h4>장면 고르기</h4><div class="btnrow"><button class="btn sm" data-g="pick-all">모두 고르기</button><button class="btn sm" data-g="b-clear">고르기 풀기</button></div>
      <p class="gp-tip">아래 '장면' 줄에서 <kbd>Shift</kbd>+클릭은 범위, <kbd>Ctrl</kbd>+클릭은 하나씩 더 골라요. 고른 장면은 오른쪽에서 속도·거꾸로·부메랑을 한꺼번에 바꿔요.</p>
      ${clips.length ? `<h4>GIF·영상 묶음</h4>${clips.map(c => `<div class="gp-clipg"><span style="background:${gpClipColor(c.id)}"></span><b>${esc(c.name || '묶음')}</b><i>${c.n}장</i><button class="btn sm" data-g="pick-clip" data-v="${c.id}">고르기</button></div>`).join('')}` : ''}`;
  } else if (gs.lib === 'text') {
    const prev = P => { const s = P.st, sw = Math.min(3, (s.sw || 0) / 4); const sh = [s.sw ? [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1.4], [0, -1.4], [1.4, 0], [-1.4, 0]].map(([x, y]) => `${x * sw}px ${y * sw}px 0 ${s.sc}`).join(',') : '', s.glow ? `0 0 ${Math.min(10, s.glow / 4)}px ${s.glowColor}` : ''].filter(Boolean).join(',');
      return `color:${s.fillGrad ? s.color : s.color};${sh ? `text-shadow:${sh};` : ''}${s.bold === false ? 'font-weight:500;' : ''}${s.boxOn ? 'background:rgba(0,0,0,.6);padding:1px 6px;border-radius:4px;' : ''}`; };
    h += `<button class="btn primary gp-wide" data-g="ov-add" data-lib="ov-add" draggable="true">+ 글자 넣기</button>
      <h4>빠른 꾸미기 <span class="muted small">${OV_PRESETS.length}가지</span></h4><div class="gp-pre">${OV_PRESETS.map((P, i) => `<button class="gp-pcard" data-g="ov-preadd" data-v="${i}" data-lib="ov-preadd" draggable="true" title="${esc(P.n)}: 모양과 움직임이 한 번에 들어가요"><span style="${prev(P)}">가나다</span><small>${esc(P.n)}</small></button>`).join('')}</div>
      <h4>이모지 스티커</h4><div class="emo">${EMOJIS.map(e => `<button data-g="ov-emoji" data-v="${e}" data-lib="ov-emoji" draggable="true">${e}</button>`).join('')}</div>
      <h4>그림 스티커</h4><div class="btnrow"><button class="btn sm" data-g="ov-img">파일에서</button><button class="btn sm" data-g="ov-lib">보관함에서</button></div>
      <h4>자막</h4><div class="btnrow"><button class="btn sm" data-g="ov-perslide" title="장면마다 그 장면 길이에 맞춘 자막을 한 줄로 만들어요. 글자를 고른 상태면 그 모양을 따라요.">장면마다 자막 만들기</button></div>${dragTip}`;
  } else if (gs.lib === 'fx') {
    const btn = ([k, l]) => `<button class="gp-fxb" data-g="fx-add" data-v="${k}" data-lib="fx-add" draggable="true"><span>${FX_ICON[k] || '·'}</span>${l}</button>`;
    h += `<h4>빠른 묶음</h4><div class="gp-fxg">${FX_PRESETS.map(([n], i) => `<button class="gp-fxb" data-g="fx-pre" data-v="${i}" data-lib="fx-pre" draggable="true">${esc(n)}</button>`).join('')}</div>
      <h4>떠다니는 것</h4><div class="gp-fxg">${FX_KINDS.filter(x => x[2] === 'p').map(btn).join('')}</div>
      <h4>화면 효과</h4><div class="gp-fxg">${FX_KINDS.filter(x => x[2] === 's').map(btn).join('')}</div>
      <h4>카메라 화면 <span class="muted small">녹화 점·시간이 움직여요</span></h4><div class="gp-fxg">${FX_KINDS.filter(x => x[2] === 'c').map(btn).join('')}</div>${dragTip}`;
  } else {
    h += `<input type="search" id="gpTrQ" placeholder="찾기 (예: 하트, 큐브, glitch)" class="gp-wide">
      <p class="gp-tip">아래 '장면' 줄에서 장면 사이(◇)를 고르고 누르면 그 자리에, 고른 자리가 없으면 모든 장면 사이에 들어가요. 장면 사이로 끌어다 놓아도 돼요.</p>
      <div class="gp-trg" id="gpTrG">${gpTrNames().map(([v, l]) => `<button class="gp-trt" data-g="tr-apply" data-v="${esc(v)}" data-lib="tr" draggable="true" data-q="${esc(l.toLowerCase() + ' ' + v.toLowerCase())}" title="${esc(l)}"><canvas width="104" height="64"></canvas><span>${esc(l)}</span></button>`).join('')}</div>
      <div class="btnrow"><button class="btn sm" data-g="tr-gal" data-v="${gs.focus === 'tr' && gs.sel > 0 ? 's.tr' : 'trans'}">크게 보며 고르기</button></div>`;
  }
  el.innerHTML = h + '</div>';
  if (gs.lib === 'tr') gpTrThumbs();
}
function gpLibBind() {
  const el = $('#gpLib');
  el.addEventListener('dragstart', e => {
    const b = e.target.closest('[data-lib]'); if (!b) return;
    gs.libDrag = { a: b.dataset.g, v: b.dataset.v, tr: b.dataset.lib === 'tr' };
    e.dataTransfer.setData('text/x-potato-gs', '1'); e.dataTransfer.effectAllowed = 'copy';
  });
  el.addEventListener('dragend', () => { gs.libDrag = null; tlDropMark(null); });
  // 넘김 미리보기: 마우스를 올리면 움직여요
  let hov = null, raf = 0;
  const loop = now => { if (!hov || !document.body.contains(hov)) return; gpTrTile(hov, clamp((now / 1000 % 1.6) / 1.2, 0, 1)); raf = requestAnimationFrame(loop); };
  el.addEventListener('pointerover', e => { const t = e.target.closest('.gp-trt'); if (t === hov) return; if (hov) gpTrTile(hov, 0.42); hov = t; cancelAnimationFrame(raf); if (hov) raf = requestAnimationFrame(loop); });
}
const gpClipColor = id => `hsl(${strHash(String(id)) % 360},65%,55%)`;
function gpTrNames() {
  return [...GS_TRANS.map(([v, l]) => [v, l]), ['gl:*', '특수 넘김 무작위'], ...GLT_TOP.filter(n => !glt.bad.has(n)).map(n => ['gl:' + n, GLT_KO[n]]), ...GL_TRANS.map(x => x.name).filter(n => !GLT_KO[n] && !glt.bad.has(n)).map(n => ['gl:' + n, n])];
}
let gpTrA = null, gpTrB = null, gpTrQ = [], gpTrRun = 0;
function gpTrSamples() { // 넘김 미리보기에 쓸 두 장면
  const tw = 104, th = 64, S = gs.slides, i = clamp(gs.sel > 0 ? gs.sel : 1, 1, Math.max(1, S.length - 1));
  const mk = (s, alt) => { const c = newCanvas(tw, th), g = c.getContext('2d'); g.fillStyle = gs.set.bg; g.fillRect(0, 0, tw, th);
    if (s) gsDrawSlide(g, s, 0.5, tw, th, 0); else { const gr = g.createLinearGradient(0, 0, tw, th); gr.addColorStop(0, alt ? '#ff8a5b' : '#4b7bec'); gr.addColorStop(1, alt ? '#ffd166' : '#a55eea'); g.fillStyle = gr; g.fillRect(0, 0, tw, th); g.fillStyle = '#fff'; g.font = `bold ${th * 0.5}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(alt ? 'B' : 'A', tw / 2, th / 2); }
    return c; };
  gpTrA = mk(S[i - 1] || S[0], false); gpTrB = mk(S.length > 1 ? S[i] : null, true);
}
function gpTrTile(tile, p) {
  const v = tile.dataset.v, c = tile.querySelector('canvas'), g = c.getContext('2d'), w = c.width, h = c.height, A = gpTrA, B = gpTrB; if (!A) return;
  g.save(); g.globalAlpha = 1; g.clearRect(0, 0, w, h); const k = ease(p);
  if (v === 'none') g.drawImage(p < 0.5 ? A : B, 0, 0);
  else if (v === 'fade') { g.drawImage(A, 0, 0); g.globalAlpha = k; g.drawImage(B, 0, 0); }
  else if (v === 'push') { g.drawImage(A, -w * k, 0); g.drawImage(B, w * (1 - k), 0); }
  else if (v === 'up') { g.drawImage(A, 0, -h * k); g.drawImage(B, 0, h * (1 - k)); }
  else if (v === 'flash') { g.drawImage(B, 0, 0); g.fillStyle = `rgba(255,255,255,${1 - k})`; g.fillRect(0, 0, w, h); }
  else { const n = v === 'gl:*' ? GLT_TOP[Math.floor(Date.now() / 1600) % GLT_TOP.length] : v.slice(3), out = gltRender(n, A, B, k, w, h); if (out) g.drawImage(out, 0, 0, w, h); else { tile.hidden = true; } }
  g.restore();
}
function gpTrThumbs() {
  gpTrSamples(); gpTrQ = [...$$('#gpTrG .gp-trt')]; const run = ++gpTrRun;
  const step = () => { if (run !== gpTrRun || gs.lib !== 'tr') return; const t0 = performance.now(); while (gpTrQ.length && performance.now() - t0 < 20) gpTrTile(gpTrQ.shift(), 0.42); if (gpTrQ.length) setTimeout(step, 0); };
  step(); gpTrMark();
}
function gpTrFilter() { const q = ($('#gpTrQ') || {}).value.trim().toLowerCase(); for (const t of $$('#gpTrG .gp-trt')) t.hidden = (!!q && !t.dataset.q.includes(q)) || glt.bad.has(t.dataset.v.slice(3)); }
function gpTrMark() { const cur = gs.focus === 'tr' && gs.slides[gs.sel] ? gsTr(gs.slides[gs.sel]) : gs.set.trans; for (const t of $$('#gpTrG .gp-trt')) t.classList.toggle('on', t.dataset.v === cur); }
// 넘김 넣기: i < 0이면 모든 장면 사이 (GIF·영상 안쪽의 '바로 넘기기'는 그대로)
function gsApplyTrans(i, v) {
  const S = gs.slides, isGl = v.startsWith('gl:');
  if (i < 0) {
    gs.set.trans = v; S.forEach((s, k) => { if (k > 0 && !(s.clip && s.tr === 'none' && S[k - 1].clip === s.clip)) { s.tr = null; } });
    if (isGl && gs.set.trDur < 0.6) { gs.set.trDur = 0.8; toast('특수 넘김이 잘 보이도록 넘김 길이를 0.8초로 늘렸어요'); }
  } else {
    const s = S[i]; if (!s) return; s.tr = v;
    if (isGl && gsTrD(s) < 0.6) s.trd = 0.8;
    if (v !== 'none' && gsDur(s) < 0.3) toast('장면 길이가 0.3초보다 짧으면 넘김이 보이지 않아요. 장면을 늘려 주세요.', 4000);
  }
  gsChanged();
}

/* ---- 오른쪽: 속성 (고른 것에 따라) ---- */
function gsRenderProps() {
  const el = $('#gsProps'); if (!el) return;
  const S = gs.slides, s = S[gs.sel], o = gs.ovs.find(x => x.id === gs.osel), f = gs.fx.find(x => x.id === gs.fsel), set = gs.set;
  const au = (gs.au || []).find(x => x.id === gs.asel);
  if ((gs.focus === 'ov' && !o) || (gs.focus === 'fx' && !f) || (gs.focus === 'au' && !au) || ((gs.focus === 'scene' || gs.focus === 'tr') && !s) || (gs.focus === 'tr' && gs.sel < 1)) gs.focus = 'set';
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  let k = '전체', head = '움짤 전체 설정', body = '';
  if (gs.focus === 'scene' && gs.pick.size > 1) { k = '장면'; head = `고른 장면 ${gs.pick.size}개`; body = gsBatchHtml() + (S[gs.sel] ? `<div class="sec">${gsXfHtml(S[gs.sel], 0)}</div>` : ''); }
  else if (gs.focus === 'scene') {
    k = '장면'; head = `${gs.sel + 1}번 장면 <span class="muted small">/ ${S.length}</span>`;
    const nClip = s.clip ? S.filter(x => x.clip === s.clip).length : 0;
    body = `<div class="sec"><div class="btnrow gp-nav"><button class="btn sm" data-g="scene-prev" ${gs.sel > 0 ? '' : 'disabled'}>◀ 앞 장면</button><button class="btn sm" data-g="scene-next" ${gs.sel < S.length - 1 ? '' : 'disabled'}>다음 장면 ▶</button></div>
        ${row('길이', `<input type="number" data-gk="s.dur" min="0.02" max="60" step="0.05" value="${s.dur ?? ''}" placeholder="${set.dur}"> 초`)}
        ${row('움직임', `<select data-gk="s.motion"><option value="">전체 설정 따름</option>${opt(GS_MOTIONS, s.motion ?? '')}</select>`)}
        ${row('맞추기', `<select data-gk="s.fit"><option value="">전체 설정 따름</option>${opt([['cover', '꽉 채우기'], ['contain', '전체 보이기']], s.fit ?? '')}</select>`)}
        <p class="gp-tip">시간 막대에서 장면 오른쪽 끝을 끌면 길이가 바뀌고, 가운데를 끌면 순서가 바뀌어요.</p>
        ${gsXfHtml(s, nClip)}
        ${nClip > 1 ? `<div class="btnrow"><button class="btn sm" data-g="pick-clip" data-v="${s.clip}" title="이 GIF·영상 장면을 모두 고르면 오른쪽에 'AI로 부드럽게'가 나와요">AI로 부드럽게 (중간 장면)…</button></div>` : `<div class="btnrow"><button class="btn sm" data-g="ai-para" title="AI가 잰 거리대로 앞뒤를 나눠 카메라가 움직이는 것 같은 장면들로 바꿔요">입체 움직임 (AI 깊이)…</button></div>`}
        <div class="btnrow"><button class="btn sm" data-g="dup" title="Ctrl+D">복제</button><button class="btn sm" data-g="split" title="재생 위치에서 두 장면으로 (Ctrl+K)">재생 위치에서 나누기</button><button class="btn sm danger" data-g="del-sel">빼기</button></div>
        ${nClip > 1 ? `<div class="btnrow"><button class="btn sm" data-g="pick-clip" data-v="${s.clip}" title="같은 GIF·영상에서 나온 장면을 모두 골라 속도·거꾸로·부메랑을 한꺼번에">이 GIF·영상 장면 모두 고르기 (${nClip}장)</button></div>` : ''}</div>
      ${gs.sel > 0 ? `<div class="sec"><h3>들어올 때 넘김</h3>${row('넘김', gsTransSel('s.tr', s.tr ?? '', true))}${row('길이', `<input type="number" data-gk="s.trd" min="0.05" max="3" step="0.05" value="${s.trd ?? ''}" placeholder="${set.trDur}"> 초`)}</div>` : ''}`;
  } else if (gs.focus === 'tr') {
    k = '넘김'; head = `${gs.sel}번 → ${gs.sel + 1}번 장면 사이`;
    const short = gsDur(s) < 0.3;
    body = `<div class="sec">${row('넘김', gsTransSel('s.tr', s.tr ?? '', true))}
        ${row('길이', `<input type="number" data-gk="s.trd" min="0.05" max="3" step="0.05" value="${s.trd ?? ''}" placeholder="${set.trDur}"> 초`)}
        ${short ? '<p class="gp-tip warn">뒤 장면이 0.3초보다 짧아서 넘김이 보이지 않아요.</p>' : ''}
        <p class="gp-tip">왼쪽 '넘김'에서 미리보기를 보고 눌러도 이 자리에 들어가요.</p>
        <div class="btnrow"><button class="btn sm" data-g="tr-all" title="이 넘김을 모든 장면 사이에">모든 장면 사이에 같게</button><button class="btn sm" data-g="tr-none">넘김 없애기</button></div></div>`;
  } else if (gs.focus === 'ov') {
    k = o.kind === 'image' ? '스티커' : '글자'; head = esc(o.kind === 'image' ? (o.name || '그림 스티커') : ((o.text || '').split('\n')[0].slice(0, 18) || '(빈 글자)'));
    body = ovPropsHtml(o);
  } else if (gs.focus === 'fx') {
    k = '효과'; head = `${FX_ICON[f.kind] || ''} ${esc(FXK[f.kind][1])}`; body = fxPropsHtml(f);
  } else if (gs.focus === 'au') {
    k = '소리'; head = '♪ ' + esc(au.name || '소리'); body = auPropsHtml(au);
  } else {
    body = `<div class="sec"><h3>화면</h3>
        ${row('크기', `<select data-gk="size">${opt(GS_SIZES, set.size)}</select>`)}
        ${set.size === 'custom' ? `<div class="grid2"><span>폭</span><input type="number" data-gk="cw" value="${set.cw}" min="16" max="2400"><span>높이</span><input type="number" data-gk="ch" value="${set.ch}" min="16" max="2400"></div>` : ''}
        ${row('바탕색', `<input type="color" data-gk="bg" value="${set.bg}">`)}
        ${row('맞추기', `<select data-gk="fit">${opt([['cover', '꽉 채우기'], ['contain', '전체 보이기']], set.fit)}</select>`)}
        ${row('부드러움', `<select data-gk="fps">${opt([['8', '초당 8장 (가볍게)'], ['10', '초당 10장'], ['12', '초당 12장'], ['15', '초당 15장'], ['20', '초당 20장'], ['24', '초당 24장 (매끄럽게)'], ['30', '초당 30장']], String(set.fps))}</select>`)}
        ${row('반복', `<label class="chk"><input type="checkbox" data-gk="loop" ${set.loop ? 'checked' : ''}> 계속 반복</label>`)}</div>
      <div class="sec"><h3>장면 기본값</h3>
        ${row('장면 길이', `<input type="number" data-gk="dur" min="0.05" max="60" step="0.1" value="${set.dur}"> 초`)}
        ${row('움직임', `<select data-gk="motion">${opt(GS_MOTIONS, set.motion)}</select>`)}
        ${row('넘김', gsTransSel('trans', set.trans, false))}
        ${set.trans !== 'none' ? row('넘김 길이', `<input type="number" data-gk="trDur" min="0.05" max="3" step="0.05" value="${set.trDur}"> 초`) : ''}
        <p class="gp-tip">장면마다 따로 정하지 않은 것은 이 값을 따라요.</p>
        <div class="btnrow"><button class="btn sm" data-g="all-follow" title="장면마다 따로 정한 길이, 움직임, 넘김을 지우고 기본값으로 맞춰요">모든 장면을 기본값으로</button></div></div>
      <div class="sec"><h3>저장</h3><div class="btnrow"><button class="btn primary" data-g="export-open" ${S.length ? '' : 'disabled'}>내보내기…</button></div>
        <p class="gp-tip">아래 시간 막대에서 장면·글자·효과를 누르면 여기에 그 속성이 나와요.</p></div>`;
  }
  el.innerHTML = `<div class="gp-insp-h"><span class="k k-${k === '전체' ? 'set' : 'x'}">${k}</span><b>${head}</b><span class="flex1"></span>${gs.focus !== 'set' ? '<button class="gp-ib sm" data-g="desel" title="고르기 풀기 (Esc)">×</button>' : ''}</div>` + body;
  if (gs.lib === 'tr') gpTrMark();
}
function gsXfHtml(s, nClip) { // 장면 그림 위치·크기·회전
  const n = v => Math.round(v * 10) / 10, xf = !!(s.tx || s.ty || (s.tz && s.tz !== 1) || s.trot || s.tflip);
  return `<h4 class="advh">그림 위치·크기·회전</h4>
    <div class="grid2"><span>가로 위치</span><span class="gp-nu"><input type="number" data-gk="sx.tx" step="1" value="${n((s.tx || 0) * 100)}">%</span><span>세로 위치</span><span class="gp-nu"><input type="number" data-gk="sx.ty" step="1" value="${n((s.ty || 0) * 100)}">%</span>
      <span>크기</span><span class="gp-nu"><input type="number" data-gk="sx.tz" min="5" max="2000" step="1" value="${n((s.tz || 1) * 100)}">%</span><span>회전</span><span class="gp-nu"><input type="number" data-gk="sx.trot" min="-180" max="180" step="1" value="${n(s.trot || 0)}">°</span></div>
    <div class="grid2"><span>불투명도</span><span class="gp-nu"><input type="number" data-gk="sx.op" min="0" max="100" step="5" value="${n((s.op ?? 1) * 100)}">%</span></div>
    ${row('뒤집기', `<label class="chk"><input type="checkbox" data-gk="sx.tflip" ${s.tflip ? 'checked' : ''}> 좌우 뒤집기</label>`)}
    <div class="btnrow"><button class="btn sm" data-g="xf-center">가운데로</button><button class="btn sm" data-g="xf-reset" ${xf ? '' : 'disabled'}>원래대로</button><button class="btn sm" data-g="xf-all" title="이 위치·크기·회전을 모든 장면에">모든 장면에 같게</button></div>
    <p class="gp-tip">미리보기에서 그림을 끌면 옮겨지고, 모서리를 끌거나 휠을 돌리면 크기, 위쪽 동그라미로 돌려요(Shift = 15°씩).${nClip > 1 ? ' 같은 GIF·영상에서 나온 장면은 함께 움직여요.' : ''}</p>
    ${kfHtml((kfOwner(s) || s).kf, gsStarts()[gs.slides.indexOf(kfOwner(s) || s)] || 0)}`;
}
function gsSaveHtml() {
  const set = gs.set, opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="sec">${row('형식', `<div class="seg"><button class="btn sm ${set.fmt === 'gif' ? 'on' : ''}" data-g="fmt" data-v="gif">GIF</button><button class="btn sm ${set.fmt === 'webp' ? 'on' : ''}" data-g="fmt" data-v="webp">움직이는 WebP</button><button class="btn sm ${set.fmt === 'mp4' ? 'on' : ''}" data-g="fmt" data-v="mp4">MP4 영상</button></div>`)}
      ${row('부드러움', `<select data-gk="fps">${opt([['8', '초당 8장 (가볍게)'], ['10', '초당 10장'], ['12', '초당 12장'], ['15', '초당 15장'], ['20', '초당 20장'], ['24', '초당 24장 (매끄럽게)'], ['30', '초당 30장']], String(set.fps))}</select>`)}
      ${row('반복', `<label class="chk"><input type="checkbox" data-gk="loop" ${set.loop ? 'checked' : ''}> 계속 반복</label>`)}
      ${set.fmt === 'gif' ? row('', `<label class="chk"><input type="checkbox" data-gk="dither" ${set.dither ? 'checked' : ''}> 색 경계 부드럽게</label>`) + row('색 수', `<select data-gk="colors">${opt([['256', '256색 (선명)'], ['128', '128색'], ['64', '64색 (가볍게)'], ['32', '32색']], String(set.colors))}</select>`)
        : set.fmt === 'mp4' ? row('화질', `<input type="range" data-gk="mq" min="40" max="100" value="${set.mq}"> <span class="muted small rv">${set.mq}</span>`) : row('화질', `<input type="range" data-gk="q" min="40" max="100" value="${set.q}"> <span class="muted small rv">${set.q}</span>`)}
      ${row('용량 맞추기', `<input type="number" data-gk="target" min="0" max="500" step="0.5" value="${set.target || 0}" style="width:64px" title="0이면 안 맞춰요"> MB 이하`)}
      <div class="btnrow"><button class="btn sm" data-g="est">예상 용량 보기</button><span class="muted small" id="gsEst"></span></div>
      <div class="btnrow"><button class="btn primary" data-g="export" id="gsExport" ${gs.slides.length ? '' : 'disabled'}>${set.fmt === 'gif' ? 'GIF로 저장' : set.fmt === 'mp4' ? 'MP4로 저장' : 'WebP로 저장'}</button></div>
      ${(gs.au || []).some(a => !a.hidden) && set.fmt !== 'mp4' ? '<p class="gp-tip warn">넣은 소리는 MP4로 저장할 때만 들어가요.</p>' : ''}
      <p class="muted small">GIF는 256색이라 사진은 조금 거칠어질 수 있어요. 움직이는 WebP가 더 선명하고 가벼워요. MP4는 가장 가볍고${(gs.au || []).some(a => !a.hidden) ? ' 넣은 소리도 같이 들어가요' : ' \'+ 소리\'로 음악을 넣을 수 있어요'}. 용량을 정하면 넘을 때 화질·색 수·크기를 줄여 다시 만들어요.</p></div>`;
}
function gsExportOpen() {
  if (!gs.slides.length) { toast('장면을 먼저 넣어 주세요'); return; }
  gsPause();
  const [W, H] = gsSize(), m = modal(`<h2>내보내기</h2><p class="sub">${W}×${H} · ${fmtTC(gsTotal())} · 장면 ${gs.slides.length}개${gs.ovs.length ? ` · 글자 ${gs.ovs.length}개` : ''}${gs.fx.length ? ` · 효과 ${gs.fx.length}개` : ''}</p><div id="gsExpBody" class="gp-exp"></div><div class="foot"><button class="btn" data-close>닫기</button></div>`);
  gsExpRender();
  m.addEventListener('input', gsInput);
  m.addEventListener('change', e => { gsInput(e); if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') gsExpRender(); });
  m.addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (!b) return; const a = b.dataset.g; if (a === 'fmt') { gs.set.fmt = b.dataset.v; gsChanged(); gsExpRender(); } else if (a === 'est') gsEstimate(); else if (a === 'export') gsExport(); });
}
function gsExpRender() { const b = $('#gsExpBody'); if (b) b.innerHTML = gsSaveHtml(); }

/* ---- 아래: 시간 막대 ---- */
function gpTbarRender() {
  const el = $('#gpTbar'); if (!el) return;
  const z = Math.log2(gs.pps);
  el.innerHTML = `<div class="seg gp-tools"><button class="gp-ib ${gs.tool === 'sel' ? 'on' : ''}" data-g="tool" data-v="sel" title="고르기 도구 (V): 누르고 끌어 옮기기·길이 바꾸기">${gpI('sel')}</button><button class="gp-ib ${gs.tool === 'razor' ? 'on' : ''}" data-g="tool" data-v="razor" title="자르기 도구 (C): 누른 곳에서 둘로 나눠요">${gpI('razor')}</button></div>
    <button class="gp-ib ${gs.snap ? 'on' : ''}" data-g="snap" title="자석 (S): 끌 때 재생 위치·장면 경계에 붙어요">${gpI('snap')}</button>
    <span class="gp-sep"></span>
    <button class="btn sm" data-g="split" title="고른 것을 재생 위치에서 둘로 (Ctrl+K)">나누기</button><button class="btn sm" data-g="dup" title="고른 것 복제 (Ctrl+D)">복제</button><button class="btn sm" data-g="del-sel" title="고른 것 지우기 (Delete)">지우기</button>
    <span class="gp-sep"></span>
    <button class="btn sm" data-g="ov-add" title="재생 위치에 글자 넣기 (T)">+ 글자</button><button class="btn sm" data-g="au-add" title="배경 음악·효과음 넣기 (MP3·WAV·M4A, 영상 파일이면 그 소리만). MP4로 저장할 때 들어가요">+ 소리</button>
    <span class="flex1"></span>
    <span class="muted small gp-hint">${gs.tool === 'razor' ? '자르기 도구: 장면이나 막대를 누르면 그 자리에서 나눠요' : 'Ctrl+휠: 확대·축소 · 위쪽 눈금을 끌면 재생 위치 이동'}</span>
    <button class="gp-ib sm" data-g="zoom-out" title="축소 (-)">−</button><input type="range" id="gpZoom" min="2" max="12" step="0.05" value="${z.toFixed(2)}" title="시간 막대 확대"><button class="gp-ib sm" data-g="zoom-in" title="확대 (+)">+</button><button class="btn sm ${gs.zoomFit ? 'on' : ''}" data-g="zoom-fit" title="전체가 보이게 (\\)">전체 보기</button>`;
  $('#gpZoom').addEventListener('input', e => gpZoom(Math.pow(2, +e.target.value)));
}
function gpFit() { const sc = $('#gpScroll'); if (!sc) return; gs.pps = clamp((sc.clientWidth - GP_HW - 36) / Math.max(gs.slides.length ? 0.5 : 10, gsTotal()), 4, 4000); }
function gpZoom(pps, clientX) {
  const sc = $('#gpScroll'), r = sc.getBoundingClientRect(), old = gs.pps;
  const ax = clientX != null ? clientX - r.left : clamp(GP_HW + gs.t * old - sc.scrollLeft, GP_HW, sc.clientWidth), ta = (sc.scrollLeft + ax - GP_HW) / old;
  gs.zoomFit = false; gs.pps = clamp(pps, 4, 4000); tlBuild(); sc.scrollLeft = Math.max(0, ta * gs.pps + GP_HW - ax);
  const z = $('#gpZoom'); if (z && document.activeElement !== z) z.value = Math.log2(gs.pps).toFixed(2);
  const fb = $('[data-g="zoom-fit"]'); if (fb) fb.classList.remove('on');
}
let tlRaf = 0;
const tlBuildSoon = () => { if (!tlRaf) tlRaf = requestAnimationFrame(() => { tlRaf = 0; tlBuild(); }); };
function gpThumb(s) {
  if (s.thURL && s.thOf === s.bmp) return s.thURL;
  if (!s.thBusy) { s.thBusy = true; const h = 52, w = clamp(Math.round(h * s.w / s.h), 14, 120), c = newCanvas(w, h), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(s.bmp, 0, 0, w, h);
    c.toBlob(b => { s.thBusy = false; if (!b) return; s.thURL = URL.createObjectURL(b); s.thOf = s.bmp; for (const x of gs.slides) if (x !== s && x.bmp === s.bmp) { x.thURL = s.thURL; x.thOf = x.bmp; } tlBuildSoon(); }, 'image/jpeg', 0.75); }
  return s.thURL || '';
}
function tlBuild() {
  const box = $('#gpRows'); if (!box) return;
  if (gs.zoomFit) gpFit();
  const S = gs.slides, T = gsTotal(), pps = gs.pps, X = t => (t * pps).toFixed(1), st = gsStarts();
  laneFix(gs.ovs); laneFix(gs.fx); laneFix(tlL('a'));
  const nO = gs.ovs.reduce((m, o) => Math.max(m, o.lane + 1), 0), nF = gs.fx.reduce((m, f) => Math.max(m, f.lane + 1), 0), nA = gs.au.reduce((m, a) => Math.max(m, a.lane + 1), 0);
  // 눈금
  const steps = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120], maj = steps.find(v => v * pps >= 72) || 120, mn = maj / (maj * pps >= 160 ? 10 : 5);
  let ticks = ''; const tEnd = T + 160 / pps;
  for (let k = 0, t = 0; t <= tEnd; k++, t = k * mn) { const M = Math.abs(t / maj - Math.round(t / maj)) < 1e-6; ticks += `<i class="${M ? 'M' : ''}" style="left:${X(t)}px">${M ? `<b>${maj < 1 ? t.toFixed(maj < 0.1 ? 2 : 1) : Math.round(t * 10) / 10}초</b>` : ''}</i>`; }
  const rows = [`<div class="gp-row ruler"><div class="gp-h">시간</div><div class="gp-lane gp-ruler">${ticks}<span class="gp-end" style="left:${X(T)}px" title="끝"></span></div></div>`];
  const bar = (k, x) => {
    const a = x.t0 || 0, b = tlT1(k, x), on = gs.focus === { o: 'ov', f: 'fx', a: 'au' }[k] && x.id === tlSelId(k);
    const lab = k === 'o' ? (x.kind === 'image' ? '🖼 ' + (x.name || '스티커') : (x.text || '').split('\n')[0] || '(빈 글자)') : k === 'a' ? '♪ ' + (x.name || '소리') + (x.loop ? ' ⟳' : '') : (FX_ICON[x.kind] || '') + ' ' + FXK[x.kind][1];
    const an = k === 'o' && (x.ain.n || x.aloop.n || x.aout.n) ? '<em>✦</em>' : '';
    return `<b class="gp-bar ${k} ${k === 'o' && x.kind === 'image' ? 'img' : ''} ${on ? 'on' : ''} ${x.hidden ? 'hid' : ''}" data-bk="${k}" data-id="${x.id}" style="left:${X(a)}px;width:${Math.max(4, (b - a) * pps).toFixed(1)}px" title="${esc(lab)} · ${fmtT(a)}~${fmtT(b)}초">${an}${esc(lab)}${k === 'o' && x.kf ? x.kf.map(q => `<i class="gp-kf" style="left:${(q.t * pps).toFixed(1)}px"></i>`).join('') : ''}</b>`;
  };
  const lanes = (k, n, name, list) => {
    const out = [];
    if (n > 0) out.push(`<div class="gp-row new ${k}" data-lk="${k}" data-ln="${n}"><div class="gp-h"><span class="muted">+ 새 ${name} 줄</span></div><div class="gp-lane"></div></div>`);
    for (let L = Math.max(1, n) - 1; L >= 0; L--) {
      const items = list.filter(x => x.lane === L), allHid = items.length && items.every(x => x.hidden);
      out.push(`<div class="gp-row ${k}" data-lk="${k}" data-ln="${L}"><div class="gp-h"><button class="gp-ib xs" data-g="lane-eye" data-lk="${k}" data-ln="${L}" title="${allHid ? '이 줄 보이기' : '이 줄 숨기기'}" ${items.length ? '' : 'disabled'}>${gpI(allHid ? 'eyeoff' : 'eye')}</button><span>${name} ${L + 1}</span></div><div class="gp-lane">${items.map(x => bar(k, x)).join('')}${!list.length ? `<span class="gp-ehint">${k === 'o' ? '왼쪽 \'글자\'에서 끌어다 놓거나 + 글자' : k === 'a' ? '+ 소리로 배경 음악·효과음을 넣어요 (MP4에만 들어가요)' : '왼쪽 \'효과\'에서 끌어다 놓아요'}</span>` : ''}</div></div>`);
    }
    return out;
  };
  rows.push(...lanes('f', nF, '효과', gs.fx), ...lanes('o', nO, '글자', gs.ovs));
  // 장면 줄
  let clips = '';
  S.forEach((s, i) => {
    const d = gsDur(s), w = d * pps, on = gs.focus === 'scene' && (i === gs.sel || gs.pick.has(s.id)), th = gpThumb(s);
    clips += `<div class="gp-clip ${on ? 'on' : ''}" data-ci="${i}" style="left:${X(st[i])}px;width:${Math.max(2, w - 1).toFixed(1)}px;${th ? `background-image:url(${th});` : ''}${s.clip ? `border-top:3px solid ${gpClipColor(s.clip)};` : ''}" title="${i + 1}번 장면 · ${d.toFixed(2)}초">${w > 22 ? `<span class="lb">${i + 1}</span>` : ''}${w > 70 ? `<span class="lb2">${d < 1 ? d.toFixed(2) : d.toFixed(1)}초</span>` : ''}</div>`;
    if (i > 0) {
      const tr = gsTrAt(i), trOn = gs.focus === 'tr' && gs.sel === i;
      if (tr !== 'none') { const trd = Math.min(gsTrD(s), d * 0.9); clips += `<div class="gp-tr ${trOn ? 'on' : ''}" data-ti="${i}" style="left:${X(st[i])}px;width:${Math.max(9, trd * pps).toFixed(1)}px" title="넘김: ${esc(gsTrName(tr))} (${trd.toFixed(2)}초) · 누르면 바꿔요">${trd * pps > 46 ? `<span>${esc(gsTrName(tr).replace(/ \(.*\)$/, ''))}</span>` : ''}</div>`; }
      else if (trOn || (w > 16 && gsDur(S[i - 1]) * pps > 16)) clips += `<b class="gp-cut ${trOn ? 'on' : ''}" data-ti="${i}" style="left:${X(st[i])}px" title="${i}번과 ${i + 1}번 사이: 누르면 넘김을 고를 수 있어요">◇</b>`;
    }
  });
  S.forEach((s, i) => { if (s.kf && s.kf.length && kfOwner(s) === s) for (const q of s.kf) clips += `<i class="gp-kf sc" style="left:${X(st[i] + q.t)}px" title="키프레임 ${fmtT(st[i] + q.t)}초"></i>`; });
  // 소리 줄: 장면 줄 바로 아래, 장면 줄처럼 아래에 붙어 있어요
  const aRows = [];
  if (S.length) {
    for (let L = 0; L < Math.max(1, nA); L++) { const items = gs.au.filter(x => x.lane === L), allHid = items.length && items.every(x => x.hidden);
      aRows.push([29, `<div class="gp-row a" data-lk="a" data-ln="${L}" style="BOT"><div class="gp-h"><button class="gp-ib xs" data-g="lane-eye" data-lk="a" data-ln="${L}" title="${allHid ? '이 줄 소리 켜기' : '이 줄 소리 끄기'}" ${items.length ? '' : 'disabled'}>${gpI(allHid ? 'eyeoff' : 'eye')}</button><span>소리 ${L + 1}</span></div><div class="gp-lane">${items.map(x => bar('a', x)).join('')}${!gs.au.length ? '<span class="gp-ehint">+ 소리로 배경 음악·효과음을 넣어요 (MP4로 저장할 때 들어가요)</span>' : ''}</div></div>`]); }
    if (nA > 0) aRows.push([21, `<div class="gp-row new a" data-lk="a" data-ln="${nA}" style="BOT"><div class="gp-h"><span class="muted">+ 새 소리 줄</span></div><div class="gp-lane"></div></div>`]);
  }
  let below = aRows.reduce((m, r) => m + r[0], 0);
  rows.push(`<div class="gp-row v" style="bottom:${below}px"><div class="gp-h"><span>장면</span></div><div class="gp-lane" id="gpV">${clips || '<span class="gp-ehint">사진·GIF·영상을 넣으면 여기에 이어 붙어요</span>'}</div></div>`);
  for (const [h, html] of aRows) { below -= h; rows.push(html.replace('BOT', `bottom:${below}px`)); }
  box.style.width = (GP_HW + T * pps + 160) + 'px';
  box.innerHTML = rows.join('') + '<div class="gp-ph" id="gpPh"></div><div class="gp-mark" id="gpMark" hidden></div><div class="gp-tipf" id="gpTipF" hidden></div>';
  tlHead();
}
function tlHead() {
  const ph = $('#gpPh'), sc = $('#gpScroll'); if (!ph || !sc) return;
  const x = GP_HW + gs.t * gs.pps; ph.style.left = x + 'px';
  if (gs.playing && !gs.tlDrag) { const v0 = sc.scrollLeft + GP_HW, v1 = sc.scrollLeft + sc.clientWidth - 24; if (x < v0 || x > v1) sc.scrollLeft = Math.max(0, x - GP_HW - 24); }
}
function tlMark(t, cls) { const m = $('#gpMark'); if (!m) return; if (t == null) { m.hidden = true; return; } m.hidden = false; m.className = 'gp-mark ' + (cls || ''); m.style.left = (GP_HW + t * gs.pps) + 'px'; }
function tlTip(e, text) { const el = $('#gpTipF'), sc = $('#gpScroll'); if (!el) return; if (!text) { el.hidden = true; return; } const r = sc.getBoundingClientRect(); el.hidden = false; el.textContent = text; el.style.left = (e.clientX - r.left + sc.scrollLeft + 12) + 'px'; el.style.top = (e.clientY - r.top + sc.scrollTop - 26) + 'px'; }
function tlDropMark(i) { for (const el of $$('#gpV .drop')) el.classList.remove('drop'); if (i != null) { const el = $(`#gpV [data-ti="${i}"]`); if (el) el.classList.add('drop'); } }
// 끌 때 붙을 자리 (자석)
function tlSnap(t, skip) {
  if (!gs.snap) return [t, false];
  const c = [0, gsTotal(), gs.t, ...gsStarts()]; for (const x of [...gs.ovs, ...gs.fx, ...(gs.au || [])]) if (x !== skip) c.push(x.t0 || 0, x.t1 == null ? gsTotal() : x.t1);
  let best = t, bd = 8 / gs.pps; for (const v of c) { const d = Math.abs(v - t); if (d < bd) { bd = d; best = v; } }
  return [best, best !== t];
}
function gpSelTr(i) {
  const S = gs.slides; if (i < 1 || !S[i]) return;
  gs.sel = i; gs.pick.clear(); gs.focus = 'tr'; const st = gsStarts(), trd = Math.min(gsTrD(S[i]), gsDur(S[i]) * 0.9);
  gs.t = st[i] + (gsTrAt(i) !== 'none' ? trd * 0.5 : 0.001); gsPause(); gsRenderProps(); tlBuild(); gsDraw();
}
function gpDeselect() { if (gs.focus === 'set' && !gs.pick.size) return; gs.focus = 'set'; gs.pick.clear(); gsRenderProps(); tlBuild(); gsDraw(); }
// 자르기: 장면 · 글자 · 효과를 t에서 둘로
function gpSplitScene(i, t) {
  const S = gs.slides, s = S[i]; if (!s) return false; const st = gsStarts(), d = gsDur(s), loc = Math.round((t - st[i]) * 1000) / 1000;
  if (loc < 0.02 || loc > d - 0.02) return false;
  const s2 = { ...s, id: uid(), dur: Math.round((d - loc) * 1000) / 1000, tr: 'none', trd: null }; s.dur = loc; S.splice(i + 1, 0, s2); return true;
}
function gpSplitBar(k, x, t) {
  const L = tlL(k), a = x.t0 || 0, b = tlT1(k, x); t = Math.round(t * 100) / 100;
  if (t <= a + 0.03 || t >= b - 0.03) return false;
  if (k === 'a') { const y = { ...x, id: uid(), t0: t, off: (x.off || 0) + (t - a), fin: 0 }; x.t1 = t; x.fout = 0; L.splice(L.indexOf(x) + 1, 0, y); return true; }
  const y = { ...clone(k === 'o' ? { ...x, bmp: null } : x), id: uid(), t0: t }; if (k === 'o') { y.bmp = x.bmp; y.ain = { n: '', d: x.ain.d }; x.aout = { n: '', d: x.aout.d }; }
  x.t1 = t; L.splice(L.indexOf(x) + 1, 0, y); return true;
}
function gpSplitAtHead() {
  const t = gs.t;
  if (gs.focus === 'ov' || gs.focus === 'fx' || gs.focus === 'au') { const k = { ov: 'o', fx: 'f', au: 'a' }[gs.focus], x = tlL(k).find(z => z.id === tlSelId(k)); if (x && gpSplitBar(k, x, t)) { gsChanged(); return; } toast('재생 위치가 고른 막대 안에 있어야 나눌 수 있어요'); return; }
  if (!gs.slides.length) return;
  const i = gsSceneAt(t); if (gpSplitScene(i, t)) { gs.sel = i + 1; gs.pick.clear(); gs.focus = 'scene'; gsChanged(); } else toast('장면 경계와 너무 가까워서 나누지 않았어요');
}
function tlBind() {
  const sc = $('#gpScroll'); let D = null;
  const tAt = e => { const r = sc.getBoundingClientRect(); return (e.clientX - r.left + sc.scrollLeft - GP_HW) / gs.pps; };
  const hitBoundary = (e, t) => { // 장면 끝(오른쪽 가장자리) 근처면 그 장면 번호
    const st = gsStarts(), tol = 6 / gs.pps; for (let i = 0; i < gs.slides.length; i++) if (Math.abs(st[i + 1] - t) <= tol) return i; return -1;
  };
  sc.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.gp-h')) return;
    const t = tAt(e), el = e.target, inV = !!el.closest('.gp-row.v'), clip = el.closest('.gp-clip'), trEl = el.closest('.gp-tr, .gp-cut'), bar = el.closest('.gp-bar');
    if (el.closest('.gp-row.ruler')) { D = { m: 'scrub' }; gs.tlDrag = true; gpSeek(t); sc.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (gs.tool === 'razor') {
      if (bar) { const k = bar.dataset.bk, x = tlL(k).find(z => z.id === bar.dataset.id); if (x && gpSplitBar(k, x, tlSnap(t, x)[0])) gsChanged(); }
      else if (clip) { const i = +clip.dataset.ci; if (gpSplitScene(i, tlSnap(t)[0])) { gs.sel = i + 1; gs.focus = 'scene'; gs.pick.clear(); gsChanged(); } }
      return;
    }
    if (inV && gs.slides.length) { const bi = hitBoundary(e, t); if (bi >= 0) { D = { m: 'trim', i: bi, d0: gsDur(gs.slides[bi]), sx: e.clientX, start: gsStarts()[bi] }; gs.tlDrag = true; sc.setPointerCapture(e.pointerId); e.preventDefault(); return; } }
    if (trEl) { gpSelTr(+trEl.dataset.ti); return; }
    if (bar) {
      const k = bar.dataset.bk, L = tlL(k), x = L.find(z => z.id === bar.dataset.id); if (!x) return;
      const br = bar.getBoundingClientRect(), edge = Math.min(7, br.width / 3);
      const mode = e.clientX - br.left < edge ? 'l' : br.right - e.clientX < edge ? 'r' : 'm';
      tlSelect(k, x);
      D = { m: 'bar', k, L, x, mode, sx: e.clientX, t0: x.t0 || 0, t1: tlT1(k, x), open: x.t1 == null, lane0: x.lane, moved: false, off0: x.off || 0 };
      gs.tlDrag = true; gsPause(); gsRenderProps(); tlBuild(); gsDraw(); sc.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    if (clip) {
      const i = +clip.dataset.ci, s = gs.slides[i], st = gsStarts();
      if (!(gs.pick.has(s.id) && gs.pick.size > 1 && !e.shiftKey && !e.ctrlKey && !e.metaKey)) gsPickClick(i, e); else gs.sel = i;
      gs.focus = 'scene';
      if (gs.t < st[i] || gs.t >= st[i + 1]) { const tr = gsTrAt(i), trd = tr !== 'none' ? Math.min(gsTrD(s), gsDur(s) * 0.9) : 0; gs.t = st[i] + Math.min(gsDur(s) - 0.001, trd + 0.001); }
      gsPause(); gsRenderProps(); tlBuild(); gsDraw();
      D = { m: 'clip', i, sx: e.clientX, moved: false, ids: gs.pick.size > 1 ? new Set(gs.pick) : new Set([s.id]) };
      sc.setPointerCapture(e.pointerId); e.preventDefault(); return;
    }
    gpDeselect();
  });
  sc.addEventListener('pointermove', e => {
    const t = tAt(e);
    if (!D) { // 모양만 바꾸기
      const el = e.target; let cur = '';
      if (gs.tool === 'razor' && (el.closest('.gp-clip') || el.closest('.gp-bar'))) { cur = 'crosshair'; tlMark(tlSnap(t)[0], 'cut'); }
      else { tlMark(null); if (el.closest('.gp-row.v') && hitBoundary(e, t) >= 0) cur = 'ew-resize'; else { const bar = el.closest('.gp-bar'); if (bar) { const br = bar.getBoundingClientRect(), edge = Math.min(7, br.width / 3); cur = e.clientX - br.left < edge || br.right - e.clientX < edge ? 'ew-resize' : 'grab'; } } }
      sc.style.cursor = cur; return;
    }
    // 가장자리에 가면 저절로 옆으로
    const r = sc.getBoundingClientRect(); if (e.clientX > r.right - 30) sc.scrollLeft += 12; else if (e.clientX < r.left + GP_HW + 20) sc.scrollLeft -= 12;
    if (D.m === 'scrub') { gs.t = clamp(t, 0, gsTotal()); gsDraw(); return; }
    if (D.m === 'trim') {
      const s = gs.slides[D.i]; let end = D.start + Math.max(0.02, D.d0 + (e.clientX - D.sx) / gs.pps), sn = false;
      [end, sn] = (() => { if (!gs.snap) return [end, false]; const d = Math.abs(end - gs.t); return d < 8 / gs.pps ? [gs.t, true] : [end, false]; })();
      s.dur = Math.max(0.02, Math.round((end - D.start) * (gsDur(s) < 1 ? 1000 : 100)) / (gsDur(s) < 1 ? 1000 : 100));
      tlMark(sn ? end : null, 'snap'); tlTip(e, `${D.i + 1}번 장면 ${gsDur(s).toFixed(2)}초`); tlBuildSoon(); gsDraw(); return;
    }
    if (D.m === 'clip') {
      if (Math.abs(e.clientX - D.sx) > 5) D.moved = true; if (!D.moved) return;
      const st = gsStarts(); let bi = 0, bd = 1e9; st.forEach((v, j) => { const d = Math.abs(v - t); if (d < bd) { bd = d; bi = j; } });
      D.to = bi; tlMark(st[bi], 'ins'); tlTip(e, `${bi + 1}번째 자리로`); return;
    }
    if (D.m === 'bar') {
      const x = D.x, T = gsTotal(), dt = (e.clientX - D.sx) / gs.pps; if (Math.abs(e.clientX - D.sx) > 2) D.moved = true;
      let a = D.t0, b = D.t1, sn = null;
      if (D.mode === 'm') {
        const len = b - a; let na = clamp(a + dt, 0, Math.max(0, T - len)); const [s1, k1] = tlSnap(na, x), [s2, k2] = tlSnap(na + len, x);
        if (k1) { na = s1; sn = s1; } else if (k2) { na = s2 - len; sn = s2; } a = clamp(na, 0, Math.max(0, T - len)); b = a + len;
        const row = document.elementFromPoint(e.clientX, e.clientY), rw = row && row.closest('.gp-row');
        if (rw && rw.dataset.lk === D.k) { const ln = +rw.dataset.ln; if (ln !== x.lane && !D.L.some(y => y !== x && y.lane === ln && laneOver({ t0: a, t1: b }, y))) x.lane = ln; }
      } else if (D.mode === 'l') {
        let na = clamp(a + dt, D.k === 'a' ? Math.max(0, a - D.off0) : 0, b - 0.1); const [s1, k1] = tlSnap(na, x); if (k1 && s1 < b - 0.05 && (D.k !== 'a' || s1 >= a - D.off0)) { na = s1; sn = s1; } a = Math.round(na * 100) / 100;
        if (D.k === 'a') x.off = Math.max(0, Math.round((D.off0 + (a - D.t0)) * 100) / 100); // 소리: 왼쪽 끝을 끌면 소리 시작 위치도 같이
      }
      else { const mx = D.k === 'a' && !x.loop ? Math.min(T, a + Math.max(0.1, auLen(x) - (x.off || 0))) : T; let nb = clamp(b + dt, a + 0.1, mx); const [s1, k1] = tlSnap(nb, x); if (k1 && s1 > a + 0.05 && s1 <= mx) { nb = s1; sn = s1; } b = Math.round(nb * 100) / 100; }
      x.t0 = Math.round(a * 100) / 100; x.t1 = b >= T - 0.005 ? null : Math.round(b * 100) / 100;
      tlMark(sn, 'snap'); tlTip(e, `${fmtT(x.t0)} ~ ${x.t1 == null ? '끝' : fmtT(x.t1)}초`); tlBuildSoon(); gsDraw();
    }
  });
  const end = e => {
    if (!D) return; const d = D; D = null; gs.tlDrag = false; tlMark(null); tlTip(e, null);
    if (d.m === 'trim') { gsChanged(); return; }
    if (d.m === 'scrub') return;
    if (d.m === 'clip') {
      if (!d.moved || d.to == null) return;
      const S = gs.slides, moving = S.filter(s => d.ids.has(s.id)); let to = d.to; for (let j = 0; j < d.to; j++) if (d.ids.has(S[j].id)) to--;
      const rest = S.filter(s => !d.ids.has(s.id)); rest.splice(to, 0, ...moving); gs.slides = rest; gs.sel = gs.slides.indexOf(moving[0]); gsChanged(); return;
    }
    if (d.m === 'bar') { laneFix(d.L); if (d.moved) gsChanged(); else { gsRenderProps(); tlBuild(); } }
  };
  sc.addEventListener('pointerup', end); sc.addEventListener('pointercancel', end);
  sc.addEventListener('pointerleave', () => { if (!D) { tlMark(null); } });
  sc.addEventListener('wheel', e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); gpZoom(gs.pps * Math.pow(1.0015, -e.deltaY), e.clientX); }, { passive: false });
  sc.addEventListener('dblclick', e => { const bar = e.target.closest('.gp-bar.o'); if (bar) { const ta = $('#gsProps textarea[data-gk="o.text"]'); if (ta) { ta.focus(); ta.select(); } } });
  // 재료 칸에서 끌어다 놓기
  const dropAt = e => { const t = clamp(tAt(e), 0, Math.max(0, gsTotal() - 0.1)), rw = e.target.closest && e.target.closest('.gp-row'); return { t: Math.round(t * 100) / 100, lane: rw && rw.dataset.lk ? +rw.dataset.ln : null, lk: rw && rw.dataset.lk, inV: !!(rw && rw.classList.contains('v')) }; };
  const nearCut = t => { const st = gsStarts(); let bi = -1, bd = 1e9; for (let i = 1; i < gs.slides.length; i++) { const d = Math.abs(st[i] - t); if (d < bd) { bd = d; bi = i; } } return bi; };
  sc.addEventListener('dragover', e => {
    const P = gs.libDrag; if (!P) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    const at = dropAt(e);
    if (P.tr) { tlMark(null); tlDropMark(nearCut(at.t)); } else { tlDropMark(null); tlMark(at.t, 'ins'); }
  });
  sc.addEventListener('dragleave', e => { if (!sc.contains(e.relatedTarget)) { tlMark(null); tlDropMark(null); } });
  sc.addEventListener('drop', e => {
    const P = gs.libDrag; if (!P) return; e.preventDefault(); e.stopPropagation(); gs.libDrag = null; tlMark(null); tlDropMark(null);
    if (!gs.slides.length) { toast('장면을 먼저 넣어 주세요'); return; }
    const at = dropAt(e);
    if (P.tr) { const i = nearCut(at.t); if (i < 1) { toast('장면이 두 개 이상 있어야 넘김을 넣을 수 있어요'); return; } gsApplyTrans(i, P.v); gpSelTr(i); return; }
    const want = P.a.startsWith('fx') ? 'f' : P.a.startsWith('au') ? 'a' : 'o', lane = at.lk === want ? at.lane : null;
    ovClick(P.a, { dataset: { v: P.v } }, { t: at.t, lane });
  });
}
function gpSplitBind() {
  const sp = $('#gpSplit'), root = $('#gifStudio'); let D = null;
  sp.addEventListener('pointerdown', e => { D = { y: e.clientY, h: $('.gp-tl', root).getBoundingClientRect().height }; sp.setPointerCapture(e.pointerId); e.preventDefault(); });
  sp.addEventListener('pointermove', e => { if (!D) return; const h = clamp(D.h - (e.clientY - D.y), 140, window.innerHeight - 260); root.style.setProperty('--tlh', h + 'px'); });
  sp.addEventListener('pointerup', () => { if (!D) return; D = null; try { localStorage.setItem('potatoTLH', parseInt(root.style.getPropertyValue('--tlh')) || ''); } catch (e) { } tlBuild(); });
}

/* ---- 다시 그리기, 입력, 단추, 키 ---- */
function gsRenderList() { tlBuild(); gpDashRender(); if (gs.lib === 'media') gpLibRender(); }
function gsRenderAll() { gpLibRender(); gpTbarRender(); gsRenderList(); gsRenderProps(); gsFitCanvas(); }
let gsSaveT = 0;
function gsChanged(keepProps) { gsRenderList(); if (!keepProps) gsRenderProps(); gsFitCanvas(); clearTimeout(gsSaveT); gsSaveT = setTimeout(gsSave, 800); }
function gsInput(e) {
  const t = e.target;
  if (t.hasAttribute('data-g-kfe')) { if (e.type === 'change') kfEase(t.value); return; }
  const k = t.dataset.gk; if (!k) return;
  if (e.type === 'input' && (t.tagName === 'SELECT' || t.type === 'checkbox')) return;
  if (k.startsWith('a.')) { if (auSetKey(k, t)) gsChanged(e.type === 'input' || !/\.(t0|t1)$/.test(k)); return; }
  if (k.startsWith('o.') || k.startsWith('f.')) { const r = ovSetKey(k, t); if (r) gsChanged(r !== 'props' && (e.type === 'input' || !/\.(t0|t1|text)$/.test(k))); return; } // 글자·스티커, 효과
  let v = t.type === 'checkbox' ? t.checked : t.value;
  if (k.startsWith('sx.')) { // 장면 그림 위치·크기·회전 (같은 영상·여럿 고른 장면도 함께)
    const f = k.slice(3), list = scTargets(); if (!list.length) return;
    for (const s of list) {
      if (f === 'tflip') s.tflip = !!v || undefined;
      else if (f === 'tz') s.tz = clamp((+v || 100) / 100, 0.05, 20);
      else if (f === 'trot') s.trot = clamp(+v || 0, -180, 180);
      else if (f === 'op') s.op = clamp((+v || 0) / 100, 0, 1);
      else s[f] = clamp((+v || 0) / 100, -2, 2);
    }
    kfStoreScene(); gsChanged(e.type === 'input'); return;
  }
  if (k.startsWith('s.')) {
    const s = gs.slides[gs.sel]; if (!s) return; const f = k.slice(2);
    if (f === 'dur') s.dur = v === '' ? null : clamp(+v || 0.02, 0.02, 60);
    else if (f === 'trd') s.trd = v === '' ? null : clamp(+v || 0.05, 0.05, 3);
    else if (f === 'tr' && v && v !== 'none' && v.startsWith('gl:') && gsTrD(s) < 0.6) { s.tr = v; s.trd = 0.8; }
    else s[f] = v === '' ? null : v;
  } else {
    if (['dur', 'trDur', 'cw', 'ch', 'q', 'fps', 'mq', 'colors'].includes(k)) v = +v || gs.set[k];
    if (k === 'target') v = Math.max(0, +v || 0);
    gs.set[k] = v;
    const rv = t.nextElementSibling; if (t.type === 'range' && rv && rv.classList.contains('rv')) rv.textContent = t.value;
  }
  gsChanged(e.type === 'input');
}
async function gsClick(e) {
  const b = e.target.closest('[data-g]'); if (!b || b.disabled) return;
  const a = b.dataset.g, S = gs.slides, fps = +gs.set.fps || 12;
  if (a === 'tr-gal' || a.startsWith('ov-') || a.startsWith('fx-')) { ovClick(a, b); return; }
  if (a.startsWith('kf-')) { kfAct(a, b.dataset.v); return; }
  if (a.startsWith('au-')) { auClick(a); return; }
  if (a === 'close') pjBackToEditor();
  else if (a === 'export-open') gsExportOpen();
  else if (a === 'ai-para') dpParaFromScene();
  else if (a === 'xf-center') { for (const s of scTargets()) { s.tx = 0; s.ty = 0; } gsChanged(); gsRenderProps(); }
  else if (a === 'xf-reset') { for (const s of scTargets()) { delete s.tx; delete s.ty; delete s.tz; delete s.trot; delete s.tflip; } gsChanged(); gsRenderProps(); }
  else if (a === 'xf-all') { const c = S[gs.sel]; if (c) { for (const s of S) { s.tx = c.tx; s.ty = c.ty; s.tz = c.tz; s.trot = c.trot; s.tflip = c.tflip; } gsChanged(); toast('모든 장면에 같은 위치·크기·회전을 넣었어요', 2000); } }
  else if (a === 'lib') { gs.lib = b.dataset.v; gpLibRender(); }
  else if (a === 'add-file') $('#gsFile').click();
  else if (a === 'add-lib') gsPickLibrary();
  else if (a === 'add-page') gsAddPage();
  else if (a === 'play') gs.playing ? gsPause() : gsPlay();
  else if (a === 'go-start') gpSeek(0);
  else if (a === 'go-end') gpSeek(gsTotal());
  else if (a === 'step-back' || a === 'step-fwd') gpSeek(Math.round(gs.t * fps + (a === 'step-fwd' ? 1 : -1)) / fps);
  else if (a === 'tool') { gs.tool = b.dataset.v; gpTbarRender(); }
  else if (a === 'snap') { gs.snap = !gs.snap; gpTbarRender(); }
  else if (a === 'zoom-in') gpZoom(gs.pps * 1.5);
  else if (a === 'zoom-out') gpZoom(gs.pps / 1.5);
  else if (a === 'zoom-fit') { gs.zoomFit = true; tlBuild(); gpTbarRender(); $('#gpScroll').scrollLeft = 0; }
  else if (a === 'split') gpSplitAtHead();
  else if (a === 'dup') gpDup();
  else if (a === 'del-sel') gpDelete();
  else if (a === 'desel') gpDeselect();
  else if (a === 'scene-prev' || a === 'scene-next') { const i = clamp(gs.sel + (a === 'scene-next' ? 1 : -1), 0, S.length - 1); gs.sel = i; gs.pick.clear(); const st = gsStarts(); gs.t = st[i] + 0.001; gsRenderProps(); tlBuild(); gsDraw(); }
  else if (a === 'pick-all') { gs.pick = new Set(S.map(s => s.id)); gs.focus = 'scene'; gs.sel = 0; gsRenderProps(); tlBuild(); }
  else if (a === 'pick-clip') { const c = b.dataset.v || (S[gs.sel] || {}).clip; if (c) { gs.pick = new Set(S.filter(x => x.clip === c).map(x => x.id)); gs.sel = S.findIndex(x => x.clip === c); gs.focus = 'scene'; gsRenderProps(); tlBuild(); } }
  else if (a === 'b-clear') { gs.pick.clear(); gsRenderProps(); tlBuild(); }
  else if (a === 'b-dur') gsBatch(a, ($('#gsBDur') || {}).value);
  else if (a.startsWith('b-')) gsBatch(a, b.dataset.v);
  else if (a === 'all-follow') { S.forEach((s, k) => { s.dur = s.motion = s.fit = s.trd = null; if (!(k > 0 && s.clip && s.tr === 'none' && S[k - 1].clip === s.clip)) s.tr = null; }); gsChanged(); }
  else if (a === 'tr-apply') { const v = b.dataset.v; if (gs.focus === 'tr' && gs.sel > 0) gsApplyTrans(gs.sel, v); else if (gs.focus === 'scene' && gs.pick.size > 1) { S.forEach((s, k) => { if (k > 0 && gs.pick.has(s.id)) s.tr = v; }); gsChanged(); } else { gsApplyTrans(-1, v); toast('모든 장면 사이에 넣었어요. 한 자리에만 넣으려면 아래 장면 줄에서 장면 사이(◇)를 먼저 골라요.', 4000); } gpTrMark(); }
  else if (a === 'tr-all') { const s = S[gs.sel]; if (s) { const v = gsTr(s), d = s.trd; gsApplyTrans(-1, v); if (d != null) gs.set.trDur = d; gsChanged(); toast('모든 장면 사이에 같은 넘김을 넣었어요'); } }
  else if (a === 'tr-none') { const s = S[gs.sel]; if (s) { s.tr = 'none'; gsChanged(); } }
  else if (a === 'lane-eye') { const L = tlL(b.dataset.lk), ln = +b.dataset.ln, it = L.filter(x => x.lane === ln), hide = !it.every(x => x.hidden); for (const x of it) x.hidden = hide; gsChanged(); }
}
function gpDup() {
  if (gs.focus === 'ov') return ovClick('ov-dup', { dataset: {} });
  if (gs.focus === 'fx') return ovClick('fx-dup', { dataset: {} });
  if (gs.focus === 'au') return auClick('au-dup');
  if (gs.pick.size > 1) return gsBatch('b-dup');
  const s = gs.slides[gs.sel]; if (s && (gs.focus === 'scene' || gs.focus === 'tr')) { gs.slides.splice(gs.sel + 1, 0, { ...s, id: uid() }); gs.sel++; gs.focus = 'scene'; gsChanged(); }
}
function gpDelete() {
  if (gs.focus === 'ov') return ovClick('ov-del', { dataset: {} });
  if (gs.focus === 'fx') return ovClick('fx-del', { dataset: {} });
  if (gs.focus === 'au') return auClick('au-del');
  if (gs.focus === 'tr') { const s = gs.slides[gs.sel]; if (s) { s.tr = 'none'; gsChanged(); } return; }
  if (gs.focus !== 'scene') return;
  if (gs.pick.size > 1) return gsBatch('b-del');
  if (gs.sel >= 0 && gs.slides[gs.sel]) { gs.slides.splice(gs.sel, 1); gs.sel = Math.min(gs.sel, gs.slides.length - 1); if (gs.sel < 0) gs.focus = 'set'; gsChanged(); }
}
function gsKey(e) {
  const mod = e.ctrlKey || e.metaKey, k = e.key, fps = +gs.set.fps || 12;
  if (k === 'Escape') { if (modalOpen()) closeModal(); else if (gs.tool === 'razor') { gs.tool = 'sel'; gpTbarRender(); } else if (gs.focus !== 'set' || gs.pick.size) gpDeselect(); else pjBackToEditor(); e.preventDefault(); return; }
  if (isTyping(e.target) || modalOpen()) return;
  const lk = k.toLowerCase();
  if (k === ' ') { e.preventDefault(); gs.playing ? gsPause() : gsPlay(); }
  else if (mod && lk === 'm') { e.preventDefault(); gsExportOpen(); }
  else if (mod && lk === 'k') { e.preventDefault(); gpSplitAtHead(); }
  else if (mod && lk === 'd') { e.preventDefault(); gpDup(); }
  else if (mod && lk === 'a') { e.preventDefault(); gs.pick = new Set(gs.slides.map(s => s.id)); gs.focus = 'scene'; gsRenderProps(); tlBuild(); }
  else if (mod) return;
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); gpDelete(); }
  else if (lk === 'v') { gs.tool = 'sel'; gpTbarRender(); }
  else if (lk === 'c') { gs.tool = 'razor'; gpTbarRender(); }
  else if (lk === 's') { gs.snap = !gs.snap; gpTbarRender(); }
  else if (lk === 't') { e.preventDefault(); ovClick('ov-add', { dataset: {} }); }
  else if (k === '=' || k === '+') gpZoom(gs.pps * 1.5);
  else if (k === '-') gpZoom(gs.pps / 1.5);
  else if (k === '\\') { gs.zoomFit = true; tlBuild(); gpTbarRender(); }
  else if (k === 'Home') { e.preventDefault(); gpSeek(0); }
  else if (k === 'End') { e.preventDefault(); gpSeek(gsTotal()); }
  else if (k.startsWith('Arrow') && gs.focus === 'ov' && gs.osel) { const o = gs.ovs.find(x => x.id === gs.osel); if (o) { e.preventDefault(); const st = e.shiftKey ? 0.05 : 0.005; if (k === 'ArrowLeft') o.x -= st; else if (k === 'ArrowRight') o.x += st; else if (k === 'ArrowUp') o.y -= st; else o.y += st; gsDraw(); clearTimeout(gsSaveT); gsSaveT = setTimeout(gsSave, 800); } }
  else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); gpSeek(Math.round(gs.t * fps + (k === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 1)) / fps); }
  else if (k === 'ArrowUp' || k === 'ArrowDown') { // 앞뒤 장면 경계로
    e.preventDefault(); const st = gsStarts(); let t = gs.t;
    if (k === 'ArrowDown') { const n = st.find(v => v > t + 1e-3); t = n ?? gsTotal(); } else { const p = [...st].reverse().find(v => v < t - 1e-3); t = p ?? 0; }
    gpSeek(t);
  }
}
