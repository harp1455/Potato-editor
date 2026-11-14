// 영상 작업실 (첫 판): 장면을 이어 붙여 영상·움짤로 내보내요.
// 장면 = 보관함 그림 + 보여 줄 시간. 글자·넘김 효과·소리·AI 중간 장면은 다음에 옮겨 와요.
import { h, icon, drag, clamp } from '../ui/dom.js';
import { state, commit, emit, uid, ensureBitmap, addMedia, ensureFolder, idb } from '../core/store.js';
import { runJob, aiLoad } from '../core/ai.js';
import { ensurePacks } from '../ui/aitools.js';
import { legacyAi } from '../legacy/shim.js';
import { addCmd, run } from '../core/cmd.js';
import { encodeRender, canMp4 } from '../core/encode.js';
import { download } from '../core/files.js';
import { picked } from '../ui/bin.js';
import { dialog, toast, busy, showMenu } from '../ui/overlay.js';

const SIZES = [[1920, 1080, '가로 1080p'], [1280, 720, '가로 720p'], [1080, 1920, '세로 1080p'], [720, 1280, '세로 720p'], [1080, 1080, '정사각형 1080'], [3840, 2160, '가로 4K']];
const FPS = [12, 24, 30, 60];
const V = { t: 0, playing: false, sel: new Set(), raf: 0, last: 0 };
let cv = null, wrap = null;

export const seqOf = () => { const p = state.project; return (p.sequences || []).find(s => s.id === p.activeSeq) || (p.sequences || [])[0] || null; };
export function ensureSeq(w, h, fps) {
  const p = state.project; let s = seqOf();
  if (!s) { s = { id: uid('q'), name: '영상 1', w: w || 1920, h: h || 1080, fps: fps || 24, bg: '#000000', scenes: [] }; (p.sequences || (p.sequences = [])).push(s); p.activeSeq = s.id; }
  return s;
}
const total = s => s.scenes.reduce((a, x) => a + x.dur, 0);
function sceneAt(s, t) { let a = 0; for (const x of s.scenes) { if (t < a + x.dur) return x; a += x.dur; } return s.scenes[s.scenes.length - 1] || null; }
const startOf = (s, id) => { let a = 0; for (const x of s.scenes) { if (x.id === id) return a; a += x.dur; } return 0; };
let fadeCv = null;
// 화면 움직임: 장면이 이어지는 동안 그림이 천천히 다가오거나 멀어지거나 옆으로 흘러요 (p = 장면 안에서 0~1)
export const MOVES = [['', '없음'], ['in', '천천히 다가가기'], ['out', '천천히 멀어지기'], ['left', '왼쪽으로 흐르기'], ['right', '오른쪽으로 흐르기'], ['up', '위로 흐르기'], ['down', '아래로 흐르기']];
function drawScene(g, x, w, h, p = 0) {
  const b = state.bitmaps.get(x.mediaId); if (!b) { ensureBitmap(x.mediaId); return; }
  const k = (x.fit === 'cover' ? Math.max : Math.min)(w / b.width, h / b.height), dw = b.width * k, dh = b.height * k;
  const m = x.move, amt = (x.moveAmt ?? 12) / 100, e = p * p * (3 - 2 * p);   // 처음과 끝은 부드럽게
  const z = m === 'in' ? 1 + amt * e : m === 'out' ? 1 + amt * (1 - e) : m ? 1 + amt : 1, sh = amt / 2 * (1 - 2 * e);
  const ox = m === 'left' ? sh * w : m === 'right' ? -sh * w : 0, oy = m === 'up' ? sh * h : m === 'down' ? -sh * h : 0;
  g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip(); g.translate(w / 2 + ox, h / 2 + oy); g.scale(z, z);
  g.imageSmoothingQuality = 'high'; g.drawImage(b, -dw / 2, -dh / 2, dw, dh); g.restore();
}
export function renderSeq(g, s, t, w, h) {
  g.fillStyle = s.bg || '#000'; g.fillRect(0, 0, w, h);
  let a = 0, i = 0; for (; i < s.scenes.length - 1 && t >= a + s.scenes[i].dur; i++) a += s.scenes[i].dur;
  const x = s.scenes[i]; if (!x) return;
  const f = Math.min(x.fade || 0, x.dur), prev = s.scenes[i - 1];
  if (f > 0 && prev && t - a < f) {   // 앞 장면 위에 이 장면을 (바탕까지 그린 뒤) 점점 진하게
    drawScene(g, prev, w, h, 1);
    if (!fadeCv || fadeCv.width !== w || fadeCv.height !== h) { fadeCv = document.createElement('canvas'); fadeCv.width = w; fadeCv.height = h; }
    const fg = fadeCv.getContext('2d'); fg.fillStyle = s.bg || '#000'; fg.fillRect(0, 0, w, h); drawScene(fg, x, w, h, (t - a) / x.dur);
    g.save(); g.globalAlpha = (t - a) / f; g.drawImage(fadeCv, 0, 0); g.restore();
  }
  else drawScene(g, x, w, h, Math.min(1, (t - a) / x.dur));
  // 얹는 그림: 장면 위, 자막 아래. 자리는 가운데 기준 %, 크기는 영상 너비의 %
  for (const o of s.overs || []) {
    if (t < o.t0 || t >= o.t0 + o.dur) continue;
    const b = state.bitmaps.get(o.mediaId); if (!b) { ensureBitmap(o.mediaId); continue; }
    const dw = w * (o.size ?? 30) / 100, dh = dw * b.height / b.width;
    g.save(); g.globalAlpha = o.opacity ?? 1; g.imageSmoothingQuality = 'high'; g.drawImage(b, w * (o.x ?? 50) / 100 - dw / 2, h * (o.y ?? 50) / 100 - dh / 2, dw, dh); g.restore();
  }
  // 자막: 영상 높이에 맞춰 크기를 정해요
  for (const c of s.caps || []) {
    if (t < c.t0 || t >= c.t0 + c.dur || !String(c.text || '').trim()) continue;
    const size = h * (c.size || 5) / 100, lines = String(c.text).split('\n'), lh = size * 1.3, y0 = c.pos === 'top' ? size * 1.2 : c.pos === 'middle' ? h / 2 - (lines.length - 1) * lh / 2 : h - size * 1.2 - (lines.length - 1) * lh;
    g.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    lines.forEach((ln, k) => { g.strokeStyle = c.sc || '#000000'; g.lineWidth = size * 0.16; g.strokeText(ln, w / 2, y0 + k * lh); g.fillStyle = c.color || '#ffffff'; g.fillText(ln, w / 2, y0 + k * lh); });
  }
}
// 보관함 그림들을 장면으로. 영상이 비어 있으면 첫 그림 크기에 맞춰요
export function addScenes(mediaIds, dur, label) {
  const p = state.project, ms = mediaIds.map(id => p.media.find(m => m.id === id)).filter(Boolean); if (!ms.length) return 0;
  const fresh = !seqOf() || !seqOf().scenes.length, s = ensureSeq();
  if (fresh) { const k = Math.min(1, 1920 / Math.max(ms[0].w, ms[0].h)); s.w = Math.round(ms[0].w * k / 2) * 2; s.h = Math.round(ms[0].h * k / 2) * 2; }
  ms.forEach(m => { s.scenes.push({ id: uid('s'), mediaId: m.id, dur: dur || 2, fit: 'contain' }); ensureBitmap(m.id); });
  commit(label || (ms.length > 1 ? `장면 ${ms.length}개 넣기` : '장면 넣기')); return ms.length;
}
// 캐릭터 움직임처럼 이미 그려진 장면들을 받아요
export const addFrames = (frames, fps, name, onStep) => addFramesTo('캐릭터 움직임/' + name, frames, fps, name, onStep);
async function addFramesTo(path, frames, fps, name, onStep) {
  const folder = ensureFolder(path), ids = [];
  for (let i = 0; i < frames.length; i++) { const blob = await new Promise(r => frames[i].toBlob(r, 'image/png')); ids.push((await addMedia(new File([blob], `${name} ${String(i + 1).padStart(3, '0')}.png`, { type: 'image/png' }), folder)).id); if (onStep) onStep(i + 1, frames.length); }
  const fresh = !seqOf() || !seqOf().scenes.length; const n = addScenes(ids, 1 / fps, '장면 넣기');
  if (fresh) seqOf().fps = fps;
  return n;
}

// 소리(배경 음악·더빙): 파일은 보관 공간에 두고, 미리 볼 때 같이 틀고, MP4로 내보낼 때 같이 넣어요
const AUD = { el: null, id: null };
async function audioEl(s) {
  if (!s.audio) { if (AUD.el) AUD.el.pause(); AUD.el = null; AUD.id = null; return null; }
  if (AUD.id !== s.audio.id) { const b = await idb.get('blobs', 'aud:' + s.audio.id); if (AUD.el) AUD.el.pause(); AUD.el = b ? new Audio(URL.createObjectURL(b)) : null; AUD.id = s.audio.id; }
  if (AUD.el) AUD.el.volume = s.audio.vol ?? 1;
  return AUD.el;
}
async function audioBuffer(s, secs) {
  if (!s.audio) return null; const b = await idb.get('blobs', 'aud:' + s.audio.id); if (!b) return null;
  const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 }), src = await ac.decodeAudioData(await b.arrayBuffer()), n = Math.max(1, Math.round(secs * src.sampleRate)), out = ac.createBuffer(Math.min(2, src.numberOfChannels), n, src.sampleRate), vol = s.audio.vol ?? 1;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c), f = src.getChannelData(c), m = Math.min(n, f.length); for (let i = 0; i < m; i++) d[i] = f[i] * vol; }
  ac.close(); return out;
}

function draw() {
  const s = seqOf(); if (!cv || !wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight, dpr = devicePixelRatio || 1;
  if (!s) { cv.width = cv.height = 1; return; }
  const k = Math.min((W - 32) / s.w, (H - 32) / s.h), w = Math.max(1, Math.round(s.w * k)), hh = Math.max(1, Math.round(s.h * k));
  cv.style.width = w + 'px'; cv.style.height = hh + 'px';
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
  renderSeq(cv.getContext('2d'), s, V.t, cv.width, cv.height);
}
function tickPlay(now) {
  const s = seqOf(); if (!V.playing || !s) return;
  V.t += (now - V.last) / 1000; V.last = now;
  if (V.t >= total(s)) { V.t = 0; if (AUD.el) AUD.el.currentTime = 0; }
  draw(); const clock = document.querySelector('.vid-clock'); if (clock) clock.textContent = fmt(V.t) + ' / ' + fmt(total(s));
  const head = document.querySelector('.vid-head'); if (head) head.style.left = headX(s) + 'px';
  V.raf = requestAnimationFrame(tickPlay);
}
const PX = 80;   // 1초 = 80px (짧은 장면도 최소 폭은 보이게)
const widthOf = x => Math.max(14, x.dur * PX);
const headX = s => { let a = 0, px = 0; for (const x of s.scenes) { if (V.t < a + x.dur) return px + (V.t - a) / x.dur * widthOf(x); a += x.dur; px += widthOf(x); } return px; };
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function play(on) {
  V.playing = on; cancelAnimationFrame(V.raf); const s = seqOf();
  if (on) { V.last = performance.now(); V.raf = requestAnimationFrame(tickPlay); }
  if (s) audioEl(s).then(a => { if (!a) return; if (V.playing) { a.currentTime = Math.min(V.t, a.duration || V.t); a.play().catch(() => {}); } else a.pause(); });
  emit();
}

function exportDialog() {
  const s = seqOf(); if (!s || !s.scenes.length) return;
  const F = { fmt: canMp4() ? 'mp4' : 'webp', size: 0, loop: true }, box = h('div');
  const fmts = [['mp4', '영상 (MP4)', '어디서나 열리고 용량이 작아요.', canMp4()], ['webp', '움짤 (WebP)', '화질이 좋아요.', true], ['gif', '움짤 (GIF)', '어디에나 올릴 수 있지만 256색이고 용량이 커요.', true]].filter(f => f[3]);
  const drawBox = () => box.replaceChildren(
    h('p.dlg-text', null, `${s.w} × ${s.h}, 초당 ${s.fps}장, ${total(s).toFixed(1)}초예요.`),
    h('div.choice', { role: 'radiogroup' }, fmts.map(([v, t, d]) => h('label.choice-item' + (F.fmt === v ? '.on' : ''), null, h('input', { type: 'radio', name: 'vfmt', checked: F.fmt === v, onchange: () => { F.fmt = v; drawBox(); } }), h('span', null, h('b', null, t), h('small', null, d))))),
    h('div.field-row', { style: 'margin-top:12px' },
      h('label.field', null, h('span.field-name.w', null, '크기'), h('select.text', { 'aria-label': '크기', onchange: e => { F.size = +e.target.value; } }, [[0, '그대로'], [1080, '긴 쪽 1080'], [800, '긴 쪽 800'], [640, '긴 쪽 640'], [480, '긴 쪽 480']].filter(([v]) => !v || v < Math.max(s.w, s.h)).map(([v, t]) => h('option', { value: v, selected: F.size === v }, t)))),
      F.fmt !== 'mp4' ? h('label.check', null, h('input', { type: 'checkbox', checked: F.loop, onchange: e => { F.loop = e.target.checked; } }), '계속 되풀이') : h('span')));
  drawBox();
  dialog({ title: '영상 내보내기', body: box, buttons: [{ label: '취소' }, { label: '내보내기', primary: true, run: () => { (async () => {
    play(false); const b = busy('파일을 만드는 중이에요.');
    try {
      await Promise.all(s.scenes.map(x => ensureBitmap(x.mediaId)));
      const audio = F.fmt === 'mp4' ? await audioBuffer(s, total(s)).catch(() => null) : null;
      const blob = await encodeRender({ W: s.w, H: s.h, fps: s.fps, total: total(s), render: (g, t, w, hh) => renderSeq(g, s, t, w, hh) }, F.fmt, { size: F.size, loop: F.loop, quality: 90, audio }, p => b.set(`파일을 만드는 중이에요. ${Math.round(p * 100)}%`));
      download(blob, `${s.name}.${F.fmt}`); b.done(`'${s.name}.${F.fmt}'로 저장했어요.`);
    } catch (e) { b.done(String(e && e.message) === 'nomp4' ? '이 컴퓨터에서는 MP4를 만들 수 없어요. WebP나 GIF로 저장해 주세요.' : '파일을 만들지 못했어요. ' + ((e && e.message) || ''), 'err'); }
  })(); } }] });
}

export const videoRoom = {
  id: 'video', title: '영상', icon: 'video',
  mount(el) {
    cv = h('canvas.vid-view', { 'aria-label': '미리보기' });
    wrap = h('div.vid-stage', null, cv);
    const bar = h('div.vid-bar'), strip = h('div.vid-strip'), side = h('div.vid-side'), lane = h('div.vid-lane', { 'aria-label': '얹는 그림과 자막이 나오는 때' });
    el.append(h('div.vid-room', null, h('div.vid-top', null, wrap, side), bar, lane, strip));
    strip.addEventListener('scroll', () => { lane.scrollLeft = strip.scrollLeft; });
    const ro = new ResizeObserver(draw); ro.observe(wrap);
    const drop = e => { e.preventDefault(); strip.classList.remove('over'); let ids = []; try { ids = JSON.parse(e.dataTransfer.getData('application/x-potato-medias')) || []; } catch (_) { /* 보관함 그림이 아님 */ } if (ids.length) addScenes(ids); };
    strip.addEventListener('dragover', e => { e.preventDefault(); strip.classList.add('over'); }); strip.addEventListener('dragleave', () => strip.classList.remove('over')); strip.addEventListener('drop', drop);
    wrap.addEventListener('dragover', e => e.preventDefault()); wrap.addEventListener('drop', drop);

    const update = () => {
      const s = seqOf(), T = s ? total(s) : 0;
      if (s) { [...V.sel].forEach(id => { if (!s.scenes.some(x => x.id === id)) V.sel.delete(id); }); V.t = clamp(V.t, 0, Math.max(0, T - 0.0001)); }
      const one = s && V.sel.size === 1 ? s.scenes.find(x => V.sel.has(x.id)) : null, many = s ? s.scenes.filter(x => V.sel.has(x.id)) : [];
      bar.replaceChildren(
        h('button.btn.small', { disabled: !T, onclick: () => play(!V.playing), title: 'Space' }, V.playing ? '멈춤' : '재생'),
        h('span.vid-clock', null, fmt(V.t) + ' / ' + fmt(T)),
        h('span.grow'),
        h('button.btn.small', { onclick: () => run('video.import'), title: '영상이나 움짤 파일을 장면으로 풀어 넣어요' }, '영상 불러오기'),
        h('button.btn.small', { onclick: () => run('video.addPicked'), title: '보관함에서 고른 그림을 장면으로 넣어요. 보관함 그림을 아래 줄로 끌어도 돼요.' }, '고른 그림 넣기'),
        h('button.btn.small.primary', { disabled: !T, onclick: () => run('video.export') }, '내보내기'));
      // 둘째 줄: 얹는 그림과 자막이 언제 나오는지 막대로 보여요. 누르면 그 시각으로 가요
      const xOf = tt => { let a = 0, px = 8; for (const x of s.scenes) { if (tt < a + x.dur) return px + (tt - a) / x.dur * widthOf(x); a += x.dur; px += widthOf(x); } return px; };
      const bars = s && s.scenes.length ? [...(s.overs || []).map(o => [o, 'over', (state.project.media.find(m => m.id === o.mediaId) || {}).name || '그림']), ...(s.caps || []).map(c => [c, 'cap', String(c.text || '').split('\n')[0]])] : [];
      lane.hidden = !bars.length;
      lane.replaceChildren(h('div.vid-lane-in', { style: `width:${s ? xOf(1e9) + 8 : 0}px` }, bars.map(([o, kind, name]) => h('button.vid-chip.' + kind, { style: `left:${xOf(o.t0)}px;width:${Math.max(10, xOf(o.t0 + o.dur) - xOf(o.t0))}px`, title: `${kind === 'over' ? '얹는 그림' : '자막'}: ${name}, ${o.t0.toFixed(2)}초부터 ${o.dur.toFixed(2)}초 동안`, onclick: () => { V.t = o.t0; emit(); } }, name))));
      lane.scrollLeft = strip.scrollLeft;
      strip.replaceChildren(...(s && s.scenes.length ? [
        ...s.scenes.map((x, i) => h('button.vid-scene' + (V.sel.has(x.id) ? '.on' : ''), { style: `width:${widthOf(x)}px`, title: `${i + 1}번 장면, ${x.dur.toFixed(2)}초`, 'aria-pressed': String(V.sel.has(x.id)),
          onclick: e => { if (e.shiftKey && V.sel.size) { const a = s.scenes.findIndex(y => V.sel.has(y.id)); s.scenes.slice(Math.min(a, i), Math.max(a, i) + 1).forEach(y => V.sel.add(y.id)); } else if (e.ctrlKey || e.metaKey) { V.sel.has(x.id) ? V.sel.delete(x.id) : V.sel.add(x.id); } else { V.sel.clear(); V.sel.add(x.id); } V.t = startOf(s, x.id); emit(); },
          oncontextmenu: e => { e.preventDefault(); if (!V.sel.has(x.id)) { V.sel.clear(); V.sel.add(x.id); emit(); } showMenu([{ label: '앞으로 옮기기', run: () => run('video.left') }, { label: '뒤로 옮기기', run: () => run('video.right') }, { label: '복제', run: () => run('video.dup') }, '-', { label: '장면 지우기', run: () => run('video.delete') }], e.clientX, e.clientY); },
        }, h('img', { src: state.thumbs.get(x.mediaId) || '', alt: '', draggable: 'false' }))),
        h('div.vid-head', { style: `left:${headX(s)}px` }),
      ] : [h('p.empty', null, '보관함의 그림을 이 줄로 끌어다 놓으면 장면이 돼요. 캐릭터 작업실에서 만든 움직임도 여기로 보낼 수 있어요.')]));
      const num = (label, val, step, min, on, unit) => { const i = h('input.num', { type: 'number', value: val, step, min, 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) on(v); } }); return h('label.field', null, h('span.field-name.w', null, label), i, unit && h('span.field-unit', null, unit)); };
      side.replaceChildren(...(!s ? [h('p.empty', null, '장면을 넣으면 영상 설정이 여기 보여요.')] : [
        h('h3.sec', null, '영상'),
        h('label.field', null, h('span.field-name.w', null, '크기'), h('select.text', { 'aria-label': '영상 크기', onchange: e => { const v = SIZES[+e.target.value]; if (v) { s.w = v[0]; s.h = v[1]; commit('영상 크기'); } } }, [h('option', { value: -1, selected: true }, `${s.w} × ${s.h}`), ...SIZES.map(([w, hh, t], i) => h('option', { value: i }, `${t} (${w} × ${hh})`))])),
        h('label.field', null, h('span.field-name.w', null, '빠르기'), h('select.text', { 'aria-label': '초당 장 수', onchange: e => { s.fps = +e.target.value; commit('초당 장 수'); } }, [...new Set([...FPS, s.fps])].sort((a, b) => a - b).map(f => h('option', { value: f, selected: s.fps === f }, `초당 ${f}장`)))),
        h('label.field', null, h('span.field-name.w', null, '바탕'), h('input', { type: 'color', value: s.bg || '#000000', 'aria-label': '바탕색', onchange: e => { s.bg = e.target.value; commit('바탕색'); } })),
        h('h3.sec', null, many.length > 1 ? `장면 ${many.length}개` : '장면'),
        !many.length ? h('p.panel-note', null, '아래 줄에서 장면을 누르면 길이와 맞춤을 바꿀 수 있어요. Shift나 Ctrl로 여러 개를 골라요.') : num('길이', +(one ? one.dur : many[0].dur).toFixed(3), 0.1, 0.02, v => { many.forEach(x => { x.dur = clamp(v, 0.02, 600); }); commit('장면 길이'); }, '초'),
        many.length ? h('label.field', null, h('span.field-name.w', null, '맞춤'), h('select.text', { 'aria-label': '맞춤', onchange: e => { many.forEach(x => { x.fit = e.target.value; }); commit('장면 맞춤'); } }, [['contain', '다 보이게'], ['cover', '꽉 채우게']].map(([v, t]) => h('option', { value: v, selected: many[0].fit === v }, t)))) : null,
        many.length ? h('label.field', null, h('span.field-name.w', null, '화면 움직임'), h('select.text', { 'aria-label': '화면 움직임', onchange: e => { many.forEach(x => { if (e.target.value) x.move = e.target.value; else delete x.move; }); commit('화면 움직임'); } }, MOVES.map(([v, t]) => h('option', { value: v, selected: (many[0].move || '') === v }, t)))) : null,
        many.length && many[0].move ? num('움직이는 정도', many[0].moveAmt ?? 12, 1, 1, v => { many.forEach(x => { x.moveAmt = clamp(v, 1, 60); }); commit('움직이는 정도'); }, '%') : null,
        many.length ? num('겹쳐 바뀜', +(many[0].fade || 0).toFixed(2), 0.1, 0, v => { many.forEach(x => { x.fade = clamp(v, 0, 10); }); commit('겹쳐 바뀜'); }, '초') : null,
        many.length ? h('div.btn-row', null, h('button.btn.small', { title: '고른 장면과 다음 장면 사이에 AI가 중간 장면을 그려 넣어 부드럽게 이어요', onclick: () => run('video.interp') }, 'AI 중간 장면 넣기')) : null,
        many.length ? h('div.btn-row', null, h('button.icon-btn', { title: '앞으로 옮기기', 'aria-label': '앞으로 옮기기', onclick: () => run('video.left') }, icon('up')), h('button.icon-btn', { title: '뒤로 옮기기', 'aria-label': '뒤로 옮기기', onclick: () => run('video.right') }, icon('down')), h('span.grow'), h('button.icon-btn', { title: '장면 지우기', 'aria-label': '장면 지우기', onclick: () => run('video.delete') }, icon('trash'))) : null,
        h('h3.sec', null, '자막'),
        ...(s.caps || []).map(c => h('div.cap', null,
          h('textarea.text.area', { rows: 2, 'aria-label': '자막', value: c.text, oninput: e => { c.text = e.target.value; draw(); }, onchange: () => commit('자막 고치기') }),
          h('div.field-row', null, num('시작', +c.t0.toFixed(2), 0.1, 0, v => { c.t0 = Math.max(0, v); commit('자막 시작'); }, '초'), num('길이', +c.dur.toFixed(2), 0.1, 0.1, v => { c.dur = Math.max(0.1, v); commit('자막 길이'); }, '초')),
          h('div.btn-row', null, h('select.text', { 'aria-label': '자막 자리', style: 'width:auto', onchange: e => { c.pos = e.target.value; commit('자막 자리'); } }, [['bottom', '아래'], ['middle', '가운데'], ['top', '위']].map(([v, t]) => h('option', { value: v, selected: (c.pos || 'bottom') === v }, t))), h('span.grow'), h('button.icon-btn', { title: '자막 지우기', 'aria-label': '자막 지우기', onclick: () => { s.caps = s.caps.filter(x => x !== c); commit('자막 지우기'); } }, icon('trash'))))),
        h('button.btn.small', { onclick: () => { (s.caps || (s.caps = [])).push({ id: uid('k'), text: '자막', t0: +V.t.toFixed(2), dur: 2, pos: 'bottom', size: 5 }); commit('자막 넣기'); } }, '지금 시각에 자막 넣기'),
        h('h3.sec', null, '얹는 그림'),
        ...(s.overs || []).map(o => { const m = state.project.media.find(x => x.id === o.mediaId); return h('div.cap', null, h('p.clip-text', { title: m ? m.name : '' }, m ? m.name : '지워진 그림'),
          h('div.field-row', null, num('시작', +o.t0.toFixed(2), 0.1, 0, v => { o.t0 = Math.max(0, v); commit('얹는 그림 시작'); }, '초'), num('길이', +o.dur.toFixed(2), 0.1, 0.1, v => { o.dur = Math.max(0.1, v); commit('얹는 그림 길이'); }, '초')),
          h('div.field-row', null, num('가로', o.x ?? 50, 1, -50, v => { o.x = clamp(v, -50, 150); commit('얹는 그림 자리'); }, '%'), num('세로', o.y ?? 50, 1, -50, v => { o.y = clamp(v, -50, 150); commit('얹는 그림 자리'); }, '%')),
          h('div.field-row', null, num('크기', o.size ?? 30, 1, 1, v => { o.size = clamp(v, 1, 400); commit('얹는 그림 크기'); }, '%'), num('진하기', Math.round((o.opacity ?? 1) * 100), 5, 0, v => { o.opacity = clamp(v, 0, 100) / 100; commit('얹는 그림 불투명도'); }, '%')),
          h('div.btn-row', null, h('span.grow'), h('button.icon-btn', { title: '얹는 그림 빼기', 'aria-label': '얹는 그림 빼기', onclick: () => { s.overs = s.overs.filter(x => x !== o); commit('얹는 그림 빼기'); } }, icon('trash')))); }),
        h('button.btn.small', { disabled: !picked.size, title: picked.size ? '' : '보관함에서 얹을 그림을 먼저 골라 주세요', onclick: () => run('video.addOver') }, '고른 그림을 지금 시각에 얹기'),
        h('h3.sec', null, '소리'),
        s.audio ? h('div.cap', null, h('p.clip-text', { title: s.audio.name }, s.audio.name),
          h('label.field', null, h('span.field-name.w', null, '크기'), h('input.range', { type: 'range', min: 0, max: 100, value: Math.round((s.audio.vol ?? 1) * 100), 'aria-label': '소리 크기', onchange: e => { s.audio.vol = e.target.value / 100; commit('소리 크기'); } })),
          h('div.btn-row', null, h('button.btn.small', { onclick: () => { delete s.audio; commit('소리 빼기'); } }, '소리 빼기')),
          h('p.panel-note', null, '소리는 MP4로 내보낼 때만 들어가요. 영상보다 길면 영상 길이에서 잘려요.'))
          : h('button.btn.small', { onclick: () => run('video.audio') }, '소리 파일 넣기'),
      ].filter(Boolean)));
      draw();
    };
    strip.addEventListener('pointerdown', e => {   // 빈 곳을 누르고 끌면 그 시각으로
      const s = seqOf(); if (!s || e.target.closest('.vid-scene')) return;
      const seek = ev => { let px = ev.clientX - strip.getBoundingClientRect().left + strip.scrollLeft - 8, a = 0; for (const x of s.scenes) { const w = widthOf(x); if (px < w) { V.t = a + clamp(px / w, 0, 1) * x.dur; break; } px -= w; a += x.dur; V.t = a; } draw(); const head = strip.querySelector('.vid-head'); if (head) head.style.left = headX(s) + 'px'; };
      seek(e); drag(e, seek, () => emit());
    });
    update();
    return { update, destroy: () => { play(false); ro.disconnect(); cv = null; wrap = null; } };
  },
  status() { const s = seqOf(); return s ? [`${s.w} × ${s.h}`, `초당 ${s.fps}장`, `장면 ${s.scenes.length}개`] : []; },
  hint: () => '보관함 그림을 아래 줄로 끌어 장면을 만들어요. 장면을 눌러 길이를 바꾸고, 내보내기로 MP4, WebP, GIF를 저장해요.',
};

// 영상·GIF·WebP 파일 → 장면들 (긴 쪽 1280까지, 최대 600장)
async function importClip() {
  const inp = h('input', { type: 'file', accept: 'video/*,image/gif,image/webp' });
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return; const b = busy('파일에서 장면을 꺼내는 중이에요.'), frames = []; let fps = 12;
    const grab = (src, w, hh) => { const k = Math.min(1, 1280 / Math.max(w, hh)), c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c; };
    try {
      if (/^image\//.test(f.type)) {
        if (!window.ImageDecoder) throw new Error('이 브라우저는 움짤 파일을 장면으로 풀 수 없어요');
        const dec = new ImageDecoder({ data: await f.arrayBuffer(), type: f.type }); await dec.tracks.ready; const n = Math.min(600, dec.tracks.selectedTrack.frameCount); let dur = 0;
        for (let i = 0; i < n; i++) { const r = await dec.decode({ frameIndex: i }); frames.push(grab(r.image, r.image.displayWidth, r.image.displayHeight)); dur += (r.image.duration || 100000) / 1e6; r.image.close(); b.set(`파일에서 장면을 꺼내는 중이에요. ${i + 1} / ${n}`); }
        fps = Math.max(1, Math.min(60, Math.round(n / Math.max(0.05, dur))));
      } else {
        const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(f); await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('이 영상은 열 수 없어요')); });
        fps = Math.min(30, (seqOf() && seqOf().scenes.length ? seqOf().fps : 24)); const n = Math.min(600, Math.max(1, Math.floor(v.duration * fps)));
        for (let i = 0; i < n; i++) { v.currentTime = (i + 0.5) / fps; await new Promise(res => { v.onseeked = res; }); frames.push(grab(v, v.videoWidth, v.videoHeight)); b.set(`파일에서 장면을 꺼내는 중이에요. ${i + 1} / ${n}`); }
        URL.revokeObjectURL(v.src);
      }
      const name = f.name.replace(/\.[a-z0-9]+$/i, ''), n = await addFramesTo('영상 장면/' + name, frames, fps, name, (i, t) => b.set(`장면을 보관함에 넣는 중이에요. ${i} / ${t}`));
      b.done(`장면 ${n}개를 넣었어요.`);
    } catch (e) { b.done(e.message || '파일을 읽지 못했어요.', 'err'); }
  };
  inp.click();
}
// 고른 장면마다 다음 장면과의 사이에 중간 장면 하나를 그려 넣어요 (길이는 반씩 나눠 전체 길이는 그대로)
async function interp() {
  const s = seqOf(), pairs = s.scenes.map((x, i) => [x, s.scenes[i + 1]]).filter(([x, y]) => V.sel.has(x.id) && y && y.mediaId !== x.mediaId);
  if (!pairs.length) { toast('다음 장면이 있는 장면을 골라 주세요.', 'err'); return; }
  if (!await ensurePacks(['rife'])) return;
  try {
    await runJob(`AI 중간 장면 (${pairs.length}곳)`, async (job, say) => {
      say('모델을 불러오는 중'); await aiLoad('rife');
      const folder = ensureFolder('영상 장면/중간 장면');
      for (let i = 0; i < pairs.length; i++) {
        if (job.stop) throw new Error('stop'); say(`${i + 1} / ${pairs.length}번째 사이를 그리는 중`, i / pairs.length);
        const [x, y] = pairs[i], A = await ensureBitmap(x.mediaId), B = await ensureBitmap(y.mediaId), c = await legacyAi().riRun(A, B, 0.5, A.width, A.height);
        const m = await addMedia(new File([await new Promise(r => c.toBlob(r, 'image/png'))], `중간 ${Date.now().toString(36)}.png`, { type: 'image/png' }), folder);
        x.dur /= 2; s.scenes.splice(s.scenes.indexOf(x) + 1, 0, { id: uid('s'), mediaId: m.id, dur: x.dur, fit: x.fit }); await ensureBitmap(m.id);
      }
    });
    commit('AI 중간 장면'); toast(`중간 장면 ${pairs.length}개를 넣었어요.`);
  } catch (e) { toast('중간 장면을 만들지 못했어요. ' + (e.message || ''), 'err'); }
}

export function registerVideoCmds() {
  const inRoom = () => !!cv, has = () => inRoom() && !!seqOf() && V.sel.size > 0;
  const shift = d => { const s = seqOf(), ids = s.scenes.filter(x => V.sel.has(x.id)); (d < 0 ? ids : ids.reverse()).forEach(x => { const i = s.scenes.indexOf(x), j = i + d; if (j >= 0 && j < s.scenes.length && !V.sel.has(s.scenes[j].id)) { s.scenes.splice(i, 1); s.scenes.splice(j, 0, x); } }); commit('장면 옮기기'); };
  addCmd({ id: 'video.addOver', title: '보관함에서 고른 그림을 장면 위에 얹기', menu: '영상', words: '로고 스티커 워터마크 오버레이', enabled: () => picked.size > 0 && !!seqOf() && seqOf().scenes.length > 0, run: () => { const s = seqOf(); [...picked].forEach(id => { (s.overs || (s.overs = [])).push({ id: uid('o'), mediaId: id, t0: +V.t.toFixed(2), dur: 2, x: 50, y: 50, size: 30, opacity: 1 }); ensureBitmap(id); }); commit('그림 얹기'); } });
  addCmd({ id: 'video.addPicked', title: '보관함에서 고른 그림을 장면으로', menu: '영상', enabled: () => picked.size > 0, run: () => { const n = addScenes([...picked]); if (n) toast(`장면 ${n}개를 넣었어요.`); } });
  addCmd({ id: 'video.export', title: '영상 내보내기…', menu: '영상', enabled: () => !!seqOf() && seqOf().scenes.length > 0, run: exportDialog });
  addCmd({ id: 'video.play', title: '재생·멈춤', menu: '영상', group: 'play', enabled: () => inRoom() && !!seqOf(), run: () => play(!V.playing) });
  addCmd({ id: 'video.left', title: '장면을 앞으로', menu: '영상', group: 'scene', enabled: has, run: () => shift(-1) });
  addCmd({ id: 'video.right', title: '장면을 뒤로', menu: '영상', group: 'scene', enabled: has, run: () => shift(1) });
  addCmd({ id: 'video.dup', title: '장면 복제', menu: '영상', group: 'scene', enabled: has, run: () => { const s = seqOf(); [...s.scenes].forEach(x => { if (V.sel.has(x.id)) s.scenes.splice(s.scenes.indexOf(x) + 1, 0, { ...x, id: uid('s') }); }); commit('장면 복제'); } });
  addCmd({ id: 'video.delete', title: '장면 지우기', menu: '영상', group: 'scene', enabled: has, run: () => { const s = seqOf(); s.scenes = s.scenes.filter(x => !V.sel.has(x.id)); V.sel.clear(); commit('장면 지우기'); } });
  addCmd({ id: 'video.import', title: '영상·움짤 파일을 장면으로 불러오기…', menu: '영상', group: 'in', words: 'mp4 gif webp 불러오기', run: importClip });
  addCmd({ id: 'video.audio', title: '소리 파일 넣기…', menu: '영상', group: 'in', words: '음악 배경음 더빙 mp3 wav', run: () => { const i = h('input', { type: 'file', accept: 'audio/*' }); i.onchange = async () => { const f = i.files[0]; if (!f) return; const s = ensureSeq(), id = uid('a'); await idb.put('blobs', 'aud:' + id, f); s.audio = { id, name: f.name, vol: 1 }; commit('소리 넣기'); toast(`'${f.name}'을 넣었어요. 재생하면 같이 들려요.`); }; i.click(); } });
  addCmd({ id: 'video.interp', title: 'AI 중간 장면 넣기', menu: '영상', group: 'scene', words: '보간 부드럽게 rife', enabled: has, run: interp });
  addEventListener('keydown', e => { if (!cv || document.querySelector('.dlg-back, #modalRoot .modal-bg') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); if (seqOf()) play(!V.playing); } else if (e.key === 'Delete' && V.sel.size) { e.preventDefault(); e.stopImmediatePropagation(); run('video.delete'); } }, true);
}
