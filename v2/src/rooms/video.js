// 영상 작업실 (첫 판): 장면을 이어 붙여 영상·움짤로 내보내요.
// 장면 = 보관함 그림 + 보여 줄 시간. 글자·넘김 효과·소리·AI 중간 장면은 다음에 옮겨 와요.
import { makeFx } from '../legacy/fx.gen.js';
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
// 움직임 점: 처음 값(base)에서 시작해, 점마다 적힌 시각(t초)에 그 값이 되도록 부드럽게 이어 가요. 점은 몇 개든 둘 수 있어요
export const keysOf = o => (o.keys && o.keys.length ? [...o.keys].sort((a, b) => a.t - b.t) : o.to ? [{ t: o.dur, ...o.to }] : []);
export function valAt(base, keys, t, k) {
  let a = { t: 0, [k]: base }, v = base;
  for (const q of keys) { if (q[k] == null) continue; if (t >= q.t) { a = q; v = q[k]; continue; } const p = clamp((t - a.t) / Math.max(1e-6, q.t - a.t), 0, 1), e = p * p * (3 - 2 * p); return a[k] + (q[k] - a[k]) * e; }
  return v;
}
// 화면 움직임: 장면이 이어지는 동안 그림이 천천히 다가오거나 멀어지거나 옆으로 흘러요 (p = 장면 안에서 0~1)
export const MOVES = [['', '없음'], ['in', '천천히 다가가기'], ['out', '천천히 멀어지기'], ['left', '왼쪽으로 흐르기'], ['right', '오른쪽으로 흐르기'], ['up', '위로 흐르기'], ['down', '아래로 흐르기']];
function drawScene(g, x, w, h, p = 0) {
  const b = state.bitmaps.get(x.mediaId); if (!b) { ensureBitmap(x.mediaId); return; }
  const k = (x.fit === 'cover' ? Math.max : Math.min)(w / b.width, h / b.height), dw = b.width * k, dh = b.height * k;
  const m = x.move, amt = (x.moveAmt ?? 12) / 100, e = p * p * (3 - 2 * p);   // 처음과 끝은 부드럽게
  const z = m === 'in' ? 1 + amt * e : m === 'out' ? 1 + amt * (1 - e) : m ? 1 + amt : 1, sh = amt / 2 * (1 - 2 * e);
  const ox = m === 'left' ? sh * w : m === 'right' ? -sh * w : 0, oy = m === 'up' ? sh * h : m === 'down' ? -sh * h : 0;
  // 점으로 직접 정한 움직임이 있으면 그것을 써요 (zoom = 확대 %, x·y = 화면 크기에 견준 밀기 %)
  const K = keysOf(x), tt = p * x.dur, zz = K.length ? valAt(100, K, tt, 'zoom') / 100 : z, kx = K.length ? valAt(0, K, tt, 'x') / 100 * w : ox, ky = K.length ? valAt(0, K, tt, 'y') / 100 * h : oy;
  g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip(); g.translate(w / 2 + kx, h / 2 + ky); g.scale(zz, zz);
  g.imageSmoothingQuality = 'high'; g.drawImage(b, -dw / 2, -dh / 2, dw, dh); g.restore();
}
// 움짤 연출(8.x에서 가져온 것): 움직임 97가지, 장면 넘김 196가지, 입자·화면 효과. 처음 쓸 때 한 번 준비해요
let FXM = null;
export const fxLib = () => FXM || (FXM = makeFx({ newCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }, clamp, uid: () => uid('f'), gsTotal: () => (seqOf() ? total(seqOf()) : 0), gs: { get set() { return { bg: (seqOf() || {}).bg || '#000000' }; } } }));
const frac = v => v - Math.floor(v), strHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
let glA = null, glB = null;
function glTrans(g, s, prev, x, k, p, w, h) {
  const F = fxLib(), bad = F.glt().bad, name = x.trans === 'gl:*' ? F.GLT_TOP.filter(n => !bad.has(n))[strHash(x.id) % Math.max(1, F.GLT_TOP.length)] : String(x.trans).slice(3); if (!name || bad.has(name)) return false;
  if (!glA || glA.width !== w || glA.height !== h) { glA = document.createElement('canvas'); glB = document.createElement('canvas'); glA.width = glB.width = w; glA.height = glB.height = h; }
  const ga = glA.getContext('2d'), gb = glB.getContext('2d'); ga.fillStyle = gb.fillStyle = s.bg || '#000'; ga.fillRect(0, 0, w, h); gb.fillRect(0, 0, w, h); drawScene(ga, prev, w, h, 1); drawScene(gb, x, w, h, p);
  let out = null; try { out = F.gltRender(name, glA, glB, k, w, h); } catch (_) { bad.add(name); }
  if (!out) return false; g.drawImage(out, 0, 0, w, h); return true;
}
// 글자 얹기: 글자를 그림으로 만들어 두고 얹는 그림처럼 다뤄요
const textCache = new Map();
function textPic(o) {
  const key = [o.text, o.color, o.sc, o.sw, o.bold].join('|'); let c = textCache.get(key); if (c) return c;
  const fs = 160, lines = String(o.text || ' ').split('\n'), font = `${o.bold === false ? 500 : 800} ${fs}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`, sw = fs * (o.sw ?? 12) / 100;
  c = document.createElement('canvas'); let g = c.getContext('2d'); g.font = font; const tw = Math.max(1, ...lines.map(l => g.measureText(l).width)); c.width = Math.ceil(tw + sw * 2 + 8); c.height = Math.ceil(lines.length * fs * 1.25 + sw * 2 + 8);
  g = c.getContext('2d'); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  lines.forEach((l, i) => { const y = sw + 4 + fs * 0.62 + i * fs * 1.25; if (sw > 0) { g.strokeStyle = o.sc || '#000000'; g.lineWidth = sw; g.strokeText(l, c.width / 2, y); } g.fillStyle = o.color || '#ffffff'; g.fillText(l, c.width / 2, y); });
  if (textCache.size > 60) textCache.clear(); textCache.set(key, c); return c;
}
// 한 글자씩: 글자마다 따로 그림을 만들어 두고, 글자마다 시간 차를 두어 움직여요
export const PER = [['', '한꺼번에'], ['each', '한 글자씩 (나타날 때 움직임을 글자마다)'], ['type', '타자기 (한 글자씩 찍기)'], ['blur', '흐릿하다 또렷하게'], ['drop', '위에서 툭 떨어지기']];
export const TFX = [['', '없음'], ['wave', '물결'], ['float', '둥실둥실'], ['shiver', '덜덜 떨기'], ['rainbow', '무지개 색'], ['flicker', '깜빡임']];
const glyphCache = new Map(), hash1 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
function glyphsOf(o, color) {
  const key = [o.text, color, o.sc, o.sw, o.bold].join('|'); let G = glyphCache.get(key); if (G) return G;
  const fs = 160, lines = String(o.text || ' ').split('\n'), font = `${o.bold === false ? 500 : 800} ${fs}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`, sw = fs * (o.sw ?? 12) / 100, pad = sw + 4, m = document.createElement('canvas').getContext('2d'); m.font = font;
  const rows = lines.map(l => { const seg = window.Intl && Intl.Segmenter ? [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(l)].map(x => x.segment) : Array.from(l); return seg.map(ch => ({ ch, w: m.measureText(ch).width })); });
  const W = Math.ceil(Math.max(1, ...rows.map(r => r.reduce((a, x) => a + x.w, 0))) + pad * 2), H = Math.ceil(lines.length * fs * 1.25 + pad * 2), list = []; let i = 0;
  rows.forEach((r, li) => { let x = (W - r.reduce((a, q) => a + q.w, 0)) / 2; for (const q of r) { if (q.ch.trim()) { const c = document.createElement('canvas'); c.width = Math.ceil(q.w + pad * 2); c.height = Math.ceil(fs * 1.25 + pad * 2); const g = c.getContext('2d'); g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; if (sw > 0) { g.strokeStyle = o.sc || '#000000'; g.lineWidth = sw; g.strokeText(q.ch, c.width / 2, c.height / 2); } g.fillStyle = color; g.fillText(q.ch, c.width / 2, c.height / 2); list.push({ c, x: x + q.w / 2, y: pad + fs * 0.62 + li * fs * 1.25, i: i++ }); } x += q.w; } });
  G = { W, H, list }; if (glyphCache.size > 40) glyphCache.clear(); glyphCache.set(key, G); return G;
}
function drawGlyphs(g, o, lt, dw, w, h) {
  const rainbow = o.tfx === 'rainbow', G = glyphsOf(o, rainbow ? '#ff4040' : (o.color || '#ffffff')), k = dw / G.W, F = fxLib(), gap = o.gap ?? 0.07, base = Math.min(w, h) / 1000, ad = (o.ain && o.ain.d) || 0.6;
  for (const q of G.list) {
    const d = q.i * gap, gw = q.c.width * k, gh = q.c.height * k; let a = 1, blur = 0, dy = 0, dx = 0, rot = 0;
    if (o.per === 'type') { if (lt < d) continue; }
    else if (o.per === 'blur') { const p = clamp((lt - d) / 0.45, 0, 1); if (p <= 0) continue; a = p; blur = (1 - p) * 14 * k * 4; }
    else if (o.per === 'drop') { const p = clamp((lt - d) / 0.4, 0, 1); if (p <= 0) continue; const e = 1 - Math.pow(1 - p, 3); a = Math.min(1, p * 2); dy = -(1 - e) * G.H * k * 0.9; }
    if (o.tfx === 'wave') dy += Math.sin(lt * 5 - q.i * 0.55) * G.H * k * 0.1; else if (o.tfx === 'float') { dy += Math.sin(lt * 2 + q.i * 0.9) * G.H * k * 0.05; rot = Math.sin(lt * 1.6 + q.i) * 0.06; }
    else if (o.tfx === 'shiver') { const f = Math.floor(lt * 24); dx += (hash1(f, q.i) - 0.5) * gw * 0.08; dy += (hash1(q.i, f) - 0.5) * gw * 0.08; } else if (o.tfx === 'flicker') a *= hash1(Math.floor(lt * 12), q.i) > 0.22 ? 1 : 0.3;
    g.save(); g.translate((q.x - G.W / 2) * k + dx, (q.y - G.H / 2) * k + dy); if (rot) g.rotate(rot); g.globalAlpha *= a;
    if (o.per === 'each' && o.ain && F.ANIM_CSS[o.ain.n]) { const p = (lt - d) / ad; if (p < 0) { g.restore(); continue; } if (p < 1) F.animApply(g, F.animAt(o.ain.n, p, gw, gh, base)); }
    if (blur > 0.3 || rainbow) g.filter = `${blur > 0.3 ? `blur(${blur.toFixed(1)}px) ` : ''}${rainbow ? `hue-rotate(${Math.round((lt * 140 + q.i * 32) % 360)}deg)` : ''}`;
    g.drawImage(q.c, -gw / 2, -gh / 2, gw, gh); g.restore();
  }
}
export function renderSeq(g, s, t, w, h) {
  g.fillStyle = s.bg || '#000'; g.fillRect(0, 0, w, h);
  let a = 0, i = 0; for (; i < s.scenes.length - 1 && t >= a + s.scenes[i].dur; i++) a += s.scenes[i].dur;
  const x = s.scenes[i]; if (!x) return;
  const f = Math.min(x.fade || 0, x.dur), prev = s.scenes[i - 1];
  if (f > 0 && prev && t - a < f && x.trans && glTrans(g, s, prev, x, (t - a) / f, (t - a) / x.dur, w, h)) { /* 특수 넘김으로 그렸어요 */ }
  else if (f > 0 && prev && t - a < f) {   // 앞 장면 위에 이 장면을 (바탕까지 그린 뒤) 점점 진하게
    drawScene(g, prev, w, h, 1);
    if (!fadeCv || fadeCv.width !== w || fadeCv.height !== h) { fadeCv = document.createElement('canvas'); fadeCv.width = w; fadeCv.height = h; }
    const fg = fadeCv.getContext('2d'); fg.fillStyle = s.bg || '#000'; fg.fillRect(0, 0, w, h); drawScene(fg, x, w, h, (t - a) / x.dur);
    g.save(); g.globalAlpha = (t - a) / f; g.drawImage(fadeCv, 0, 0); g.restore();
  }
  else drawScene(g, x, w, h, Math.min(1, (t - a) / x.dur));
  // 얹는 그림: 장면 위, 자막 아래. 자리는 가운데 기준 %, 크기는 영상 너비의 %
  const live = (s.fx || []).filter(f => t >= (f.t0 || 0) && t <= (f.t1 == null ? 1e9 : f.t1) + 1e-6), kindOf = f => (fxLib().FXK[f.kind] || [])[2];
  for (const f of live) if (kindOf(f) === 'p') fxLib().fxParticles(g, f, t, w, h);
  for (const o of s.overs || []) {
    if (t < o.t0 || t >= o.t0 + o.dur) continue;
    const b = o.text != null ? textPic(o) : state.bitmaps.get(o.mediaId); if (!b) { ensureBitmap(o.mediaId); continue; }
    // 끝 값(to)이 있으면 나오는 동안 처음 값에서 끝 값으로 부드럽게 바뀌어요
    const K = keysOf(o), at = (k, def) => valAt(o[k] ?? def, K, t - o.t0, k);
    const dw = w * at('size', 30) / 100, dh = dw * b.height / b.width;
    g.save(); g.globalAlpha = clamp(at('opacity', 1), 0, 1); g.imageSmoothingQuality = 'high'; g.translate(w * at('x', 50) / 100, h * at('y', 50) / 100);
    // 나타날 때 · 있는 동안 · 사라질 때의 움직임
    if (o.ain || o.aloop || o.aout) { const F = fxLib(), lt = t - o.t0, left = o.dur - lt, base = Math.min(w, h) / 1000, on = (n, p) => F.ANIM_CSS[n] && F.animApply(g, F.animAt(n, clamp(p, 0, 1), dw, dh, base));
      if (o.aloop) on(o.aloop.n, frac(lt / Math.max(0.1, o.aloop.d || 1)));
      if (o.ain && !o.per && lt < (o.ain.d || 0.6)) on(o.ain.n, lt / (o.ain.d || 0.6)); else if (o.aout && left < (o.aout.d || 0.6)) on(o.aout.n, 1 - left / (o.aout.d || 0.6)); }
    if (o.text != null && (o.per || o.tfx)) drawGlyphs(g, o, t - o.t0, dw, w, h); else g.drawImage(b, -dw / 2, -dh / 2, dw, dh);
    g.restore();
  }
  for (const f of live) if (kindOf(f) === 's') fxLib().fxScreen(g, f, t, w, h);
  // 자막: 영상 높이에 맞춰 크기를 정해요
  for (const c of s.caps || []) {
    if (t < c.t0 || t >= c.t0 + c.dur || !String(c.text || '').trim()) continue;
    const size = h * (c.size || 5) / 100, lines = String(c.text).split('\n'), lh = size * 1.3, y0 = c.pos === 'top' ? size * 1.2 : c.pos === 'middle' ? h / 2 - (lines.length - 1) * lh / 2 : h - size * 1.2 - (lines.length - 1) * lh;
    g.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    lines.forEach((ln, k) => { g.strokeStyle = c.sc || '#000000'; g.lineWidth = size * 0.16; g.strokeText(ln, w / 2, y0 + k * lh); g.fillStyle = c.color || '#ffffff'; g.fillText(ln, w / 2, y0 + k * lh); });
  }
  for (const f of live) if (kindOf(f) === 'c') fxLib().fxScreen(g, f, t, w, h);   // 카메라 화면은 맨 위에
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
// 소리 줄은 여러 개: { id, name, vol, t0(영상의 몇 초부터), from(파일의 몇 초부터), dur(얼마 동안, 없으면 끝까지) }
export const tracksOf = s => s.audios || (s.audio ? [{ t0: 0, from: 0, ...s.audio }] : []);
function ownTracks(s) { if (!s.audios) { s.audios = tracksOf(s).map(a => ({ ...a })); delete s.audio; } return s.audios; }
const AUD = new Map();   // id → { el, len, peaks }
async function audOf(a) {
  let o = AUD.get(a.id); if (o) return o;
  const b = await idb.get('blobs', 'aud:' + a.id); if (!b) return null;
  o = { el: new Audio(URL.createObjectURL(b)), len: 0, peaks: null }; AUD.set(a.id, o);
  try {   // 파형: 800칸으로 줄여서 가장 큰 값만 남겨요
    const ac = new (window.AudioContext || window.webkitAudioContext)(), buf = await ac.decodeAudioData(await b.arrayBuffer()), d = buf.getChannelData(0), N = 800, st = Math.max(1, Math.floor(d.length / N)); o.len = buf.duration; o.peaks = new Float32Array(N);
    for (let k = 0; k < N; k++) { let m = 0; for (let q = k * st, e = Math.min(d.length, q + st); q < e; q += 8) { const v = Math.abs(d[q]); if (v > m) m = v; } o.peaks[k] = m; }
    ac.close();
  } catch (_) { /* 파형을 못 그려도 소리는 나요 */ }
  return o;
}
const lenOf = (a, o) => Math.max(0.05, a.dur ?? ((o && o.len) || 0) - (a.from || 0));
// 미리 보기: 지금 시각에 나와야 할 소리만 틀어요
function syncAudio(s, restart) {
  const live = new Set();
  for (const a of s ? tracksOf(s) : []) {
    live.add(a.id); const o = AUD.get(a.id); if (!o) { audOf(a).then(() => syncAudio(seqOf())); continue; }
    const on = V.playing && V.t >= a.t0 && V.t < a.t0 + lenOf(a, o); { const L = lenOf(a, o), q = V.t - a.t0; o.el.volume = clamp((a.vol ?? 1) * Math.min(1, a.fin ? q / a.fin : 1, a.fout ? (L - q) / a.fout : 1), 0, 1); }
    if (on && (o.el.paused || restart)) { o.el.currentTime = (a.from || 0) + (V.t - a.t0); o.el.play().catch(() => {}); } else if (!on && !o.el.paused) o.el.pause();
  }
  for (const [id, o] of AUD) if (!live.has(id)) o.el.pause();
}
async function audioBuffer(s, secs) {
  const T = tracksOf(s); if (!T.length) return null;
  const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 }), n = Math.max(1, Math.round(secs * 48000)), out = ac.createBuffer(2, n, 48000); let any = false;
  for (const a of T) {
    const b = await idb.get('blobs', 'aud:' + a.id); if (!b) continue;
    const src = await ac.decodeAudioData(await b.arrayBuffer()), r = src.sampleRate, f0 = Math.round((a.from || 0) * r), len = Math.round((a.dur ?? (src.duration - (a.from || 0))) * r), o0 = Math.round(a.t0 * 48000), vol = a.vol ?? 1; any = true;
    for (let c = 0; c < 2; c++) { const d = out.getChannelData(c), f = src.getChannelData(Math.min(c, src.numberOfChannels - 1)), k = r / 48000, m = Math.min(n - o0, Math.floor(Math.min(len, f.length - f0) / k)); const fi = (a.fin || 0) * 48000, fo = (a.fout || 0) * 48000; for (let q = Math.max(0, -o0); q < m; q++) { const g = Math.min(1, fi ? q / fi : 1, fo ? (m - q) / fo : 1); d[o0 + q] += f[f0 + Math.floor(q * k)] * vol * g; } }
  }
  ac.close(); return any ? out : null;
}
// 파형과 자르는 손잡이: 밝은 구간이 영상에 들어가는 부분이에요. 양 끝을 끌어 잘라요
function waveBox(a) {
  const W = 236, H = 44, c = h('canvas.wave', { width: W, height: H, title: '밝은 부분만 영상에 들어가요. 양 끝을 끌어 잘라요.', 'aria-label': `${a.name} 파형` }), g = c.getContext('2d');
  const paint = () => { const o = AUD.get(a.id), css = getComputedStyle(document.documentElement), L = (o && o.len) || 0; g.clearRect(0, 0, W, H); if (!o || !o.peaks || !L) return;
    const x0 = (a.from || 0) / L * W, x1 = ((a.from || 0) + lenOf(a, o)) / L * W;
    for (let x = 0; x < W; x++) { const v = o.peaks[Math.floor(x / W * o.peaks.length)] * (H / 2 - 2); g.fillStyle = css.getPropertyValue(x >= x0 && x <= x1 ? '--potato' : '--faint'); g.fillRect(x, H / 2 - v, 1, Math.max(1, v * 2)); }
    g.fillStyle = css.getPropertyValue('--text'); g.fillRect(Math.round(x0), 0, 2, H); g.fillRect(Math.round(x1) - 2, 0, 2, H); };
  audOf(a).then(paint);
  c.addEventListener('pointerdown', e => { const o = AUD.get(a.id); if (!o || !o.len) return; const r = c.getBoundingClientRect(), L = o.len, at = ev => clamp((ev.clientX - r.left) / r.width, 0, 1) * L, end0 = (a.from || 0) + lenOf(a, o), left = Math.abs(at(e) - (a.from || 0)) < Math.abs(at(e) - end0); let mv = false;
    drag(e, ev => { const t = at(ev); if (left) { const f = clamp(t, 0, end0 - 0.05); a.dur = +(end0 - f).toFixed(3); a.from = +f.toFixed(3); } else a.dur = +clamp(t - (a.from || 0), 0.05, L - (a.from || 0)).toFixed(3); mv = true; paint(); }, () => mv && commit('소리 자르기')); });
  return c;
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
  if (V.t >= total(s)) { V.t = 0; syncAudio(s, true); } else syncAudio(s);
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
  syncAudio(s, true);
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
      // 움직임 점 목록: 점마다 시각과 값. '지금 시각에 점 넣기'는 그때의 모습을 그대로 점으로 남겨요
      const keyRows = (o, fields, what, now) => {
        if (o.to && !o.keys) { o.keys = [{ t: o.dur, ...o.to }]; delete o.to; }
        const K = o.keys || [], pct = k => k === 'opacity', shown = (k, v) => (pct(k) ? Math.round(v * 100) : +(+v).toFixed(1)), stored = (k, v) => (pct(k) ? v / 100 : v);
        return [...[...K].sort((a, b) => a.t - b.t).map(q => h('div.key', null,
          h('div.field-row', null, num('때', +q.t.toFixed(2), 0.1, 0.05, v => { q.t = clamp(v, 0.05, o.dur); commit(what + ' 움직임 점'); }, '초'), h('button.icon-btn', { title: '이 점 지우기', 'aria-label': `${q.t.toFixed(2)}초 점 지우기`, onclick: () => { o.keys = o.keys.filter(z => z !== q); if (!o.keys.length) delete o.keys; commit(what + ' 움직임 점 지우기'); } }, icon('trash'))),
          h('div.field-row.wrap', null, fields.map(([k, label, min, max]) => num(label, shown(k, q[k]), 1, min, v => { q[k] = stored(k, clamp(v, min, max)); commit(what + ' 움직임 점'); }, '%'))))),
          h('button.btn.small', { title: '지금 재생 막대가 있는 시각에, 그때의 모습 그대로 점을 넣어요. 그다음 값을 바꾸면 그 시각에 그 모습이 돼요.', onclick: () => { const t = +clamp(now, 0.05, o.dur).toFixed(2), kk = keysOf(o), q = { t }; fields.forEach(([k, , , , def]) => { q[k] = valAt(o[k] ?? def, kk, t, k); }); o.keys = [...(o.keys || []).filter(z => Math.abs(z.t - t) > 0.01), q]; commit(what + ' 움직임 점 넣기'); } }, '지금 시각에 움직임 점 넣기')];
      };
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
      const bars = s && s.scenes.length ? [...(s.overs || []).map(o => [o, 'over', o.text != null ? String(o.text).split('\n')[0] : (state.project.media.find(m => m.id === o.mediaId) || {}).name || '그림']), ...(s.fx || []).map(f => [{ t0: f.t0 || 0, dur: (f.t1 == null ? total(s) : f.t1) - (f.t0 || 0) }, 'fx', (fxLib().FXK[f.kind] || [0, f.kind])[1]]), ...(s.caps || []).map(c => [c, 'cap', String(c.text || '').split('\n')[0]]), ...tracksOf(s).map(a => [{ t0: a.t0 || 0, dur: lenOf(a, AUD.get(a.id)) || 1 }, 'aud', a.name])] : [];
      lane.hidden = !bars.length;
      lane.replaceChildren(h('div.vid-lane-in', { style: `width:${s ? xOf(1e9) + 8 : 0}px` }, bars.map(([o, kind, name]) => h('button.vid-chip.' + kind, { style: `left:${xOf(o.t0)}px;width:${Math.max(10, xOf(o.t0 + o.dur) - xOf(o.t0))}px`, title: `${{ over: '얹는 것', aud: '소리', fx: '효과' }[kind] || '자막'}: ${name}, ${o.t0.toFixed(2)}초부터 ${o.dur.toFixed(2)}초 동안`, onclick: () => { V.t = o.t0; emit(); } }, name))));
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
        ...(one ? [h('p.panel-note', null, '움직임을 직접 정하려면 점을 넣어요. 점이 있으면 위의 화면 움직임 대신 점대로 움직여요.'), ...keyRows(one, [['zoom', '확대', 10, 800, 100], ['x', '가로 밀기', -100, 100, 0], ['y', '세로 밀기', -100, 100, 0]], '장면', V.t - startOf(s, one.id))] : []),
        many.length ? h('label.field', null, h('span.field-name.w', null, '넘김 모양'), h('select.text', { 'aria-label': '넘김 모양', onchange: e => { many.forEach(x => { if (e.target.value) { x.trans = e.target.value; if (!x.fade) x.fade = 0.6; } else delete x.trans; }); commit('넘김 모양'); } },
          [['', '겹쳐 바뀜 (기본)'], ['gl:*', '무작위 (장면마다 다르게)'], ...fxLib().GLT_TOP.map(n => ['gl:' + n, fxLib().GLT_KO[n] || n]), ...fxLib().GL_TRANS.filter(x => !fxLib().GLT_KO[x.name]).map(x => ['gl:' + x.name, x.name])].map(([v, t]) => h('option', { value: v, selected: (many[0].trans || '') === v }, t)))) : null,
        many.length ? num('겹쳐 바뀜', +(many[0].fade || 0).toFixed(2), 0.1, 0, v => { many.forEach(x => { x.fade = clamp(v, 0, 10); }); commit('겹쳐 바뀜'); }, '초') : null,
        many.length ? h('div.btn-row', null, h('button.btn.small', { title: '고른 장면과 다음 장면 사이에 AI가 중간 장면을 그려 넣어 부드럽게 이어요', onclick: () => run('video.interp') }, 'AI 중간 장면 넣기')) : null,
        many.length ? h('div.btn-row', null, h('button.icon-btn', { title: '앞으로 옮기기', 'aria-label': '앞으로 옮기기', onclick: () => run('video.left') }, icon('up')), h('button.icon-btn', { title: '뒤로 옮기기', 'aria-label': '뒤로 옮기기', onclick: () => run('video.right') }, icon('down')), h('span.grow'), h('button.icon-btn', { title: '장면 지우기', 'aria-label': '장면 지우기', onclick: () => run('video.delete') }, icon('trash'))) : null,
        h('h3.sec', null, '자막'),
        ...(s.caps || []).map(c => h('div.cap', null,
          h('textarea.text.area', { rows: 2, 'aria-label': '자막', value: c.text, oninput: e => { c.text = e.target.value; draw(); }, onchange: () => commit('자막 고치기') }),
          h('div.field-row', null, num('시작', +c.t0.toFixed(2), 0.1, 0, v => { c.t0 = Math.max(0, v); commit('자막 시작'); }, '초'), num('길이', +c.dur.toFixed(2), 0.1, 0.1, v => { c.dur = Math.max(0.1, v); commit('자막 길이'); }, '초')),
          h('div.btn-row', null, h('select.text', { 'aria-label': '자막 자리', style: 'width:auto', onchange: e => { c.pos = e.target.value; commit('자막 자리'); } }, [['bottom', '아래'], ['middle', '가운데'], ['top', '위']].map(([v, t]) => h('option', { value: v, selected: (c.pos || 'bottom') === v }, t))), h('span.grow'), h('button.icon-btn', { title: '자막 지우기', 'aria-label': '자막 지우기', onclick: () => { s.caps = s.caps.filter(x => x !== c); commit('자막 지우기'); } }, icon('trash'))))),
        h('button.btn.small', { onclick: () => { (s.caps || (s.caps = [])).push({ id: uid('k'), text: '자막', t0: +V.t.toFixed(2), dur: 2, pos: 'bottom', size: 5 }); commit('자막 넣기'); } }, '지금 시각에 자막 넣기'),
        h('h3.sec', null, '얹는 그림과 글자'),
        ...(s.overs || []).map(o => { const m = state.project.media.find(x => x.id === o.mediaId); const anim = (label, key, list) => h('div.field-row', null, h('label.field', { style: 'flex:1' }, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: e => { if (e.target.value) o[key] = { n: e.target.value, d: (o[key] && o[key].d) || (key === 'aloop' ? 1.2 : 0.6) }; else delete o[key]; commit('얹는 것 움직임'); } }, [h('option', { value: '' }, '없음'), ...list.map(n => h('option', { value: n, selected: !!o[key] && o[key].n === n }, fxLib().AN_KO[n] || n))])), o[key] ? num('', o[key].d, 0.1, 0.1, v => { o[key].d = clamp(v, 0.1, 20); commit('얹는 것 움직임 길이'); }, '초') : null);
          return h('div.cap', null, o.text != null ? h('textarea.text.area', { rows: 2, 'aria-label': '얹는 글자', value: o.text, onchange: e => { o.text = e.target.value; commit('얹는 글자'); } }) : h('p.clip-text', { title: m ? m.name : '' }, m ? m.name : '지워진 그림'),
          o.text != null ? h('div.field-row', null, h('label.field', null, h('span.field-name', null, '색'), h('input', { type: 'color', value: o.color || '#ffffff', 'aria-label': '글자 색', onchange: e => { o.color = e.target.value; commit('글자 색'); } })), h('label.field', null, h('span.field-name', null, '테두리'), h('input', { type: 'color', value: o.sc || '#000000', 'aria-label': '테두리 색', onchange: e => { o.sc = e.target.value; commit('테두리 색'); } })), num('굵기', o.sw ?? 12, 1, 0, v => { o.sw = clamp(v, 0, 40); commit('테두리 굵기'); }, '')) : null,
          ...(o.text != null ? [['글자마다', 'per', PER], ['글자 효과', 'tfx', TFX]].map(([label, key, list]) => h('label.field', null, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: e => { if (e.target.value) o[key] = e.target.value; else delete o[key]; commit('글자 움직임'); } }, list.map(([v, tt]) => h('option', { value: v, selected: (o[key] || '') === v }, tt))))) : []),
          anim('나타날 때', 'ain', fxLib().AN_IN), anim('있는 동안', 'aloop', fxLib().AN_LOOP), anim('사라질 때', 'aout', fxLib().AN_OUT),
          h('div.field-row', null, num('시작', +o.t0.toFixed(2), 0.1, 0, v => { o.t0 = Math.max(0, v); commit('얹는 그림 시작'); }, '초'), num('길이', +o.dur.toFixed(2), 0.1, 0.1, v => { o.dur = Math.max(0.1, v); commit('얹는 그림 길이'); }, '초')),
          h('div.field-row', null, num('가로', o.x ?? 50, 1, -50, v => { o.x = clamp(v, -50, 150); commit('얹는 그림 자리'); }, '%'), num('세로', o.y ?? 50, 1, -50, v => { o.y = clamp(v, -50, 150); commit('얹는 그림 자리'); }, '%')),
          h('div.field-row', null, num('크기', o.size ?? 30, 1, 1, v => { o.size = clamp(v, 1, 400); commit('얹는 그림 크기'); }, '%'), num('진하기', Math.round((o.opacity ?? 1) * 100), 5, 0, v => { o.opacity = clamp(v, 0, 100) / 100; commit('얹는 그림 불투명도'); }, '%')),
          ...keyRows(o, [['x', '가로', -50, 150, 50], ['y', '세로', -50, 150, 50], ['size', '크기', 1, 400, 30], ['opacity', '진하기', 0, 100, 1]], '얹는 그림', V.t - o.t0),
          h('div.btn-row', null, h('span.grow'), h('button.icon-btn', { title: '얹는 그림 빼기', 'aria-label': '얹는 그림 빼기', onclick: () => { s.overs = s.overs.filter(x => x !== o); commit('얹는 그림 빼기'); } }, icon('trash')))); }),
        h('div.btn-row', null, h('button.btn.small', { disabled: !picked.size, title: picked.size ? '' : '보관함에서 얹을 그림을 먼저 골라 주세요', onclick: () => run('video.addOver') }, '고른 그림 얹기'), h('button.btn.small', { onclick: () => run('video.addText') }, '글자 얹기'), h('button.btn.small', { onclick: () => run('video.addEmoji') }, '이모지 얹기')),
        h('h3.sec', null, '효과'),
        ...(s.fx || []).map(f => { const K = fxLib().FXK[f.kind] || [f.kind, f.kind, 's']; return h('div.cap', null, h('p.clip-text', null, K[1]),
          h('div.field-row', null, num('시작', +(f.t0 || 0).toFixed(2), 0.1, 0, v => { f.t0 = Math.max(0, v); commit('효과 시작'); }, '초'), num('끝', f.t1 == null ? +total(s).toFixed(2) : +f.t1.toFixed(2), 0.1, 0, v => { f.t1 = v >= total(s) - 0.01 ? null : Math.max((f.t0 || 0) + 0.1, v); commit('효과 끝'); }, '초')),
          h('div.field-row', null, K[2] === 'p' ? num('양', f.n ?? 50, 5, 1, v => { f.n = clamp(v, 1, 600); commit('효과 양'); }, '') : num('세기', Math.round((f.amt ?? 1) * 100), 10, 0, v => { f.amt = clamp(v, 0, 400) / 100; commit('효과 세기'); }, '%'), num('빠르기', Math.round((f.speed ?? 1) * 100), 10, 10, v => { f.speed = clamp(v, 10, 500) / 100; commit('효과 빠르기'); }, '%')),
          h('div.btn-row', null, K[2] !== 'c' ? h('label.field', null, h('span.field-name', null, '색'), h('input', { type: 'color', value: f.color || '#ffffff', 'aria-label': '효과 색', onchange: e => { f.color = e.target.value; commit('효과 색'); } })) : null, h('span.grow'), h('button.icon-btn', { title: '효과 빼기', 'aria-label': `${K[1]} 빼기`, onclick: () => { s.fx = s.fx.filter(x => x !== f); commit('효과 빼기'); } }, icon('trash')))); }),
        h('select.text', { 'aria-label': '효과 넣기', onchange: e => { const k = e.target.value; if (!k) return; const f = fxLib().FX_DEF(k, +V.t.toFixed(2)); (s.fx || (s.fx = [])).push(f); commit('효과 넣기'); } }, [h('option', { value: '' }, '효과 넣기…'), ...[['p', '날리는 것'], ['s', '화면 효과'], ['c', '카메라 화면']].map(([g2, label]) => h('optgroup', { label }, fxLib().FX_KINDS.filter(x => x[2] === g2).map(x => h('option', { value: x[0] }, x[1]))))]),
        h('h3.sec', null, '소리'),
        ...tracksOf(s).map((a0, ti) => { const A = () => ownTracks(s)[ti]; return h('div.cap', null, h('p.clip-text', { title: a0.name }, a0.name), waveBox(new Proxy(a0, { set: (_, k, v) => { A()[k] = v; a0[k] = v; return true; } })),
          h('div.field-row', null, num('영상의', +(a0.t0 || 0).toFixed(2), 0.1, 0, v => { A().t0 = Math.max(0, v); commit('소리 시작'); }, '초부터'), num('크기', Math.round((a0.vol ?? 1) * 100), 5, 0, v => { A().vol = clamp(v, 0, 200) / 100; commit('소리 크기'); }, '%')),
          h('div.field-row', null, num('서서히 커짐', a0.fin || 0, 0.1, 0, v => { A().fin = clamp(v, 0, 30); commit('소리 서서히'); }, '초'), num('서서히 작아짐', a0.fout || 0, 0.1, 0, v => { A().fout = clamp(v, 0, 30); commit('소리 서서히'); }, '초')),
          h('div.btn-row', null, h('button.btn.small', { onclick: () => { A().t0 = +V.t.toFixed(2); commit('소리 시작'); } }, '지금 시각부터 나오게'), h('span.grow'), h('button.icon-btn', { title: '소리 빼기', 'aria-label': `${a0.name} 빼기`, onclick: () => { ownTracks(s).splice(ti, 1); commit('소리 빼기'); } }, icon('trash')))); }),
        h('button.btn.small', { onclick: () => run('video.audio') }, '소리 파일 넣기'),
        tracksOf(s).length ? h('p.panel-note', null, '소리는 MP4로 내보낼 때만 들어가요. 여러 개를 넣으면 겹쳐서 나와요.') : null,
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
function importClip() { const inp = h('input', { type: 'file', accept: 'video/*,image/gif,image/webp' }); inp.onchange = () => { if (inp.files[0]) clipToScenes(inp.files[0]); }; inp.click(); }
// 영상·움짤 파일(또는 AI가 만든 영상)을 장면들로 풀어 넣어요
export async function clipToScenes(f) {
  {
    const b = busy('파일에서 장면을 꺼내는 중이에요.'), frames = []; let fps = 12;
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
  }
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

export const seek = t => { V.t = t; emit(); };   // 재생 막대를 옮겨요
export function registerVideoCmds() {
  const inRoom = () => !!cv, has = () => inRoom() && !!seqOf() && V.sel.size > 0;
  const shift = d => { const s = seqOf(), ids = s.scenes.filter(x => V.sel.has(x.id)); (d < 0 ? ids : ids.reverse()).forEach(x => { const i = s.scenes.indexOf(x), j = i + d; if (j >= 0 && j < s.scenes.length && !V.sel.has(s.scenes[j].id)) { s.scenes.splice(i, 1); s.scenes.splice(j, 0, x); } }); commit('장면 옮기기'); };
  addCmd({ id: 'video.addOver', title: '보관함에서 고른 그림을 장면 위에 얹기', menu: '영상', words: '로고 스티커 워터마크 오버레이', enabled: () => picked.size > 0 && !!seqOf() && seqOf().scenes.length > 0, run: () => { const s = seqOf(); [...picked].forEach(id => { (s.overs || (s.overs = [])).push({ id: uid('o'), mediaId: id, t0: +V.t.toFixed(2), dur: 2, x: 50, y: 50, size: 30, opacity: 1 }); ensureBitmap(id); }); commit('그림 얹기'); } });
  addCmd({ id: 'video.addText', title: '지금 시각에 글자 얹기', menu: '영상', words: '자막 스티커 타이틀 텍스트', enabled: () => !!seqOf() && seqOf().scenes.length > 0, run: () => { const s = seqOf(); (s.overs || (s.overs = [])).push({ id: uid('o'), text: '글자를 적어 주세요', color: '#ffffff', sc: '#000000', sw: 12, t0: +V.t.toFixed(2), dur: Math.min(3, Math.max(0.5, total(s) - V.t)), x: 50, y: 50, size: 50, opacity: 1, ain: { n: 'bounceIn', d: 0.6 } }); commit('글자 얹기'); } });
  addCmd({ id: 'video.addEmoji', title: '지금 시각에 이모지 얹기…', menu: '영상', words: '스티커 하트 emoji', enabled: () => !!seqOf() && seqOf().scenes.length > 0, run: () => { const d = dialog({ title: '이모지 얹기', body: h('div.emoji-grid', null, fxLib().EMOJIS.map(em => h('button.emoji', { 'aria-label': em, onclick: () => { const s = seqOf(); (s.overs || (s.overs = [])).push({ id: uid('o'), text: em, color: '#ffffff', sw: 0, bold: false, t0: +V.t.toFixed(2), dur: Math.min(3, Math.max(0.5, total(s) - V.t)), x: 50, y: 40, size: 18, opacity: 1, ain: { n: 'bounceIn', d: 0.6 }, aloop: { n: 'pulse', d: 1.2 } }); commit('이모지 얹기'); d.close(); } }, em))), buttons: [{ label: '닫기' }] }); } });
  addCmd({ id: 'video.addPicked', title: '보관함에서 고른 그림을 장면으로', menu: '영상', enabled: () => picked.size > 0, run: () => { const n = addScenes([...picked]); if (n) toast(`장면 ${n}개를 넣었어요.`); } });
  addCmd({ id: 'video.export', title: '영상 내보내기…', menu: '영상', enabled: () => !!seqOf() && seqOf().scenes.length > 0, run: exportDialog });
  addCmd({ id: 'video.play', title: '재생·멈춤', menu: '영상', group: 'play', enabled: () => inRoom() && !!seqOf(), run: () => play(!V.playing) });
  addCmd({ id: 'video.left', title: '장면을 앞으로', menu: '영상', group: 'scene', enabled: has, run: () => shift(-1) });
  addCmd({ id: 'video.right', title: '장면을 뒤로', menu: '영상', group: 'scene', enabled: has, run: () => shift(1) });
  addCmd({ id: 'video.split', title: '지금 시각에서 장면 나누기', menu: '영상', group: 'scene', keys: 'Ctrl+B', words: '자르기 컷 split', enabled: () => { const s = seqOf(); return !!s && V.t > 0.05 && V.t < total(s) - 0.05; }, run: () => { const s = seqOf(); let a = 0; for (const x of s.scenes) { if (V.t < a + x.dur) { const d1 = +(V.t - a).toFixed(3); if (d1 < 0.05 || x.dur - d1 < 0.05) return; const i = s.scenes.indexOf(x), y = { ...x, id: uid('s'), dur: +(x.dur - d1).toFixed(3), fade: 0 }; delete y.keys; x.dur = d1; s.scenes.splice(i + 1, 0, y); V.sel = new Set([y.id]); commit('장면 나누기'); return; } a += x.dur; } } });
  addCmd({ id: 'video.frame', title: '지금 화면을 PNG로 저장', menu: '영상', group: 'out', enabled: () => !!seqOf() && seqOf().scenes.length > 0, run: async () => { const s = seqOf(), c = document.createElement('canvas'); c.width = s.w; c.height = s.h; renderSeq(c.getContext('2d'), s, V.t, s.w, s.h); const { download } = await import('../core/files.js'); download(await new Promise(r => c.toBlob(r, 'image/png')), `${s.name} ${V.t.toFixed(2)}초.png`); } });
  addCmd({ id: 'video.dup', title: '장면 복제', menu: '영상', group: 'scene', enabled: has, run: () => { const s = seqOf(); [...s.scenes].forEach(x => { if (V.sel.has(x.id)) s.scenes.splice(s.scenes.indexOf(x) + 1, 0, { ...x, id: uid('s') }); }); commit('장면 복제'); } });
  addCmd({ id: 'video.delete', title: '장면 지우기', menu: '영상', group: 'scene', enabled: has, run: () => { const s = seqOf(); s.scenes = s.scenes.filter(x => !V.sel.has(x.id)); V.sel.clear(); commit('장면 지우기'); } });
  addCmd({ id: 'video.import', title: '영상·움짤 파일을 장면으로 불러오기…', menu: '영상', group: 'in', words: 'mp4 gif webp 불러오기', run: importClip });
  addCmd({ id: 'video.audio', title: '소리 파일 넣기…', menu: '영상', group: 'in', words: '음악 배경음 더빙 mp3 wav', run: () => { const i = h('input', { type: 'file', accept: 'audio/*' }); i.onchange = async () => { const f = i.files[0]; if (!f) return; const s = ensureSeq(), id = uid('a'); await idb.put('blobs', 'aud:' + id, f); ownTracks(s).push({ id, name: f.name, vol: 1, t0: ownTracks(s).length ? +V.t.toFixed(2) : 0, from: 0 }); commit('소리 넣기'); toast(`'${f.name}'을 넣었어요. 재생하면 같이 들려요.`); }; i.click(); } });
  addCmd({ id: 'video.interp', title: 'AI 중간 장면 넣기', menu: '영상', group: 'scene', words: '보간 부드럽게 rife', enabled: has, run: interp });
  addEventListener('keydown', e => { if (!cv || document.querySelector('.dlg-back, #modalRoot .modal-bg') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); if (seqOf()) play(!V.playing); } else if (e.key === 'Delete' && V.sel.size) { e.preventDefault(); e.stopImmediatePropagation(); run('video.delete'); } }, true);
}
