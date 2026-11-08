<script>
(() => {
'use strict';

/* ================= 기본 도구 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEG = Math.PI / 180;
const rot = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return { x: x * c - y * s, y: x * s + y * c }; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const r2 = v => Math.round(v * 100) / 100;
function seeded(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  return () => { h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
function rgba(hex, a) {
  let h = String(hex || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${clamp(a, 0, 1)})`;
}
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
// exe판(Tauri)이면 앱 기능(저장 창, 폴더에 바로 쓰기)을 써요. 웹판은 브라우저 내려받기
const appApi = () => (window.POTATO_BUILD && window.POTATO_BUILD.kind === 'app' && window.__TAURI__ && window.__TAURI__.dialog && window.__TAURI__.fs) ? window.__TAURI__ : null;
// 파일 하나 저장. 저장했으면 true, 저장 창에서 취소하면 false
async function download(blob, name) {
  const T = appApi();
  if (!T) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    return true;
  }
  const ext = (String(name).match(/\.([A-Za-z0-9]+)$/) || [])[1];
  let path = null;
  try { path = await T.dialog.save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase() + ' 파일', extensions: [ext] }] : [] }); }
  catch (e) { toast('저장 창을 열지 못했어요 (' + String((e && e.message) || e).slice(0, 60) + ')', 5000); return false; }
  if (!path) return false;
  await T.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
// 파일 여러 개 저장: exe판은 폴더를 골라 그 안에 바로(하위 폴더 그대로), 웹판은 ZIP 하나로. 결과: 'dir' | 'zip' | false(취소)
async function saveFiles(files, zipName) {
  const T = appApi();
  if (!T) { await download(await makeZip(files), zipName); return 'zip'; }
  let dir = null;
  try { dir = await T.dialog.open({ directory: true, recursive: true, title: '저장할 폴더 고르기' }); } catch (_) { }
  if (!dir) return false;
  for (const f of files) {
    const segs = String(f.name).split('/').map(safeName), leaf = segs.pop();
    let sub = dir; for (const sg of segs) sub = await T.path.join(sub, sg);
    if (sub !== dir) await T.fs.mkdir(sub, { recursive: true });
    let p = await T.path.join(sub, leaf), n = 2;
    while (await T.fs.exists(p)) p = await T.path.join(sub, leaf.replace(/(\.[^.]+)?$/, m => `(${n++})${m}`));
    await T.fs.writeFile(p, new Uint8Array(await f.blob.arrayBuffer()));
  }
  return 'dir';
}
const safeName = s => (String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || '작품');
function bufToB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToBuf(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const layerCache = new Map();
function cacheGet(key, make) {
  if (layerCache.has(key)) { const v = layerCache.get(key); layerCache.delete(key); layerCache.set(key, v); return v; }
  const v = make(); layerCache.set(key, v);
  while (layerCache.size > 80) layerCache.delete(layerCache.keys().next().value);
  return v;
}
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

/* ================= 글꼴 ================= */
const SYS_FONTS = [
  ['고딕', "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR','Noto Sans CJK KR',sans-serif"],
  ['명조', "'Batang','바탕','AppleMyungjo','Noto Serif KR','Noto Serif CJK KR',serif"],
  ['굴림', "'Gulim','굴림','Apple SD Gothic Neo','Noto Sans CJK KR',sans-serif"],
  ['궁서', "'Gungsuh','궁서','AppleMyungjo','Noto Serif CJK KR',serif"],
];
let fonts = []; // 내가 불러온 글꼴 {name, data}
function fontCss(name) {
  const f = SYS_FONTS.find(f => f[0] === name);
  return f ? f[1] : `"${String(name).replace(/"/g, '')}",${SYS_FONTS[0][1]}`;
}
const fontStr = el => `${el.italic ? 'italic ' : ''}${el.bold ? 700 : 400} ${el.fs}px ${fontCss(el.font)}`;
async function registerFont(name, b64, persist) {
  try {
    const ff = new FontFace(name, b64ToBuf(b64));
    await ff.load(); document.fonts.add(ff);
    if (!fonts.find(f => f.name === name)) fonts.push({ name, data: b64 });
    if (persist) idb.put('fonts', { name, data: b64 });
    layoutCache.clear(); layerCache.clear(); fontGen++;
    return true;
  } catch (e) { toast('글꼴을 읽지 못했어요. TTF, OTF, WOFF 파일인지 확인해 주세요.'); return false; }
}

/* ================= 데이터 ================= */
const DEFAULTS = () => ({
  panel: { bw: 4, bc: '#111111', radius: 0, gutter: 16 },
  bubble: { shape: 'round', font: '고딕', fs: 28, color: '#111111', bold: false, italic: false, tsw: 0, tsc: '#ffffff', fill: '#ffffff', stroke: '#111111', sw: 3, dash: false, lh: 1.35, align: 'center', tw: 36, tail: true, auto: true },
  text: { font: '고딕', fs: 96, color: '#ffffff', bold: true, italic: false, sc: '#111111', sw: 8, lh: 1.1, align: 'center', sc2: '#ffffff', sw2: 0, ext: 0, extAng: 120, extColor: '#111111', jit: 0, grow: 0, sp: 0, skew: 0, rough: 0, fillGrad: false, fill2: '#ffb300', gradDir: 'v',
    op: 100, glow: 0, glowColor: '#ffe25c', glowA: 80, shA: 0, shColor: '#000000', shAng: 50, shDist: 6, shBlur: 12, boxOn: false, boxColor: '#000000', boxA: 65, boxPad: 30, boxR: 25, vert: false, arc: 0 },
  stamp: { tintOn: false, tint: '#111111', ow: 0, oc: '#ffffff', op: 100 },
  draw: { color: '#111111', ow: 0, oc: '#ffffff', op: 100, pw: 7 },
  fx: { kind: 'blur', str: 14, color: '#ffffff', bw: 60, soft: 4 },
  aa: { soft: 35 }, // 말풍선·글자·컷 테두리 가장자리 매끄럽게 (0 = 끄기)
});
// 글자 모양에 영향을 주는 값들 (캐시 이름에 씀)
const TEXT_LOOK = ['text', 'font', 'fs', 'bold', 'italic', 'lh', 'sp', 'jit', 'grow', 'seed', 'skew', 'ext', 'extAng', 'extColor', 'sw', 'sw2', 'sc', 'sc2', 'color', 'fillGrad', 'fill2', 'gradDir', 'rough', 'align',
  'op', 'glow', 'glowColor', 'glowA', 'shA', 'shColor', 'shAng', 'shDist', 'shBlur', 'boxOn', 'boxColor', 'boxA', 'boxPad', 'boxR', 'vert', 'arc'];
const TEXT_STYLES = [
  { n: '깔끔하게', p: { glow: 0, shA: 0, boxOn: false, arc: 0, vert: false, jit: 0, rough: 0, skew: 0, grow: 0, ext: 0, sw2: 0, fillGrad: false } },
  { n: '네온 (빛 번짐)', p: { color: '#ffffff', sc: '#ff3fa4', sw: 3, sw2: 0, glow: 45, glowColor: '#ff3fa4', glowA: 90, fillGrad: false, boxOn: false } },
  { n: '파란 빛', p: { color: '#e9fbff', sc: '#1d8cff', sw: 3, sw2: 0, glow: 40, glowColor: '#36b3ff', glowA: 85, fillGrad: false, boxOn: false } },
  { n: '그림자', p: { shA: 60, shColor: '#000000', shAng: 50, shDist: 8, shBlur: 14 } },
  { n: '자막 띠', p: { color: '#ffffff', sw: 0, sw2: 0, boxOn: true, boxColor: '#000000', boxA: 65, boxPad: 30, boxR: 20, glow: 0, shA: 0, bold: false, jit: 0, rough: 0, skew: 0, ext: 0, grow: 0, arc: 0 } },
  { n: '금빛', p: { color: '#fff3b0', fillGrad: true, fill2: '#d18a00', gradDir: 'v', sc: '#5a3a00', sw: 4, sw2: 4, sc2: '#ffffff', glow: 20, glowColor: '#ffd24d', glowA: 60 } },
  { n: '아치 (휘기)', p: { arc: 45, vert: false } },
  { n: '세로쓰기', p: { vert: true, arc: 0 } },
];
// 컷 효과 기본값 (없으면 이 값)
const FX = {
  bright: 100, contrast: 100, saturate: 100, blur: 0, sepia: 0, hue: 0, gray: false,
  tintOn: false, tintColor: '#1d3b8f', tintA: 35, tintMode: 'multiply',
  gradOn: false, gradColor: '#000000', gradA: 70, gradDir: 'bottom', gradLen: 60, gradMode: 'source-over',
  vigOn: false, vigColor: '#000000', vigA: 60, vigSize: 55,
  toneOn: false, toneType: 'dot', toneGap: 8, toneSize: 45, toneAngle: 45, toneColor: '#000000', toneA: 100, toneFade: 'none',
  lineOn: false, lineType: 'focus', lineColor: '#000000', lineA: 100, lineN: 140, lineIn: 45, lineW: 4, lineCx: 50, lineCy: 50, lineAng: 0,
};
const FX_KEYS = Object.keys(FX);
const fx = (el, k) => el[k] ?? FX[k];
const MOODS = [
  ['없음', {}],
  ['밤', { tintOn: true, tintColor: '#1b2f7a', tintA: 45, tintMode: 'multiply', vigOn: true, vigColor: '#00000f', vigA: 55, vigSize: 50, bright: 90, saturate: 80 }],
  ['회상', { sepia: 70, contrast: 90, bright: 105, vigOn: true, vigColor: '#3a2614', vigA: 50, vigSize: 55 }],
  ['몽환', { bright: 110, contrast: 88, saturate: 110, blur: 1, tintOn: true, tintColor: '#ffc4e6', tintA: 30, tintMode: 'screen', vigOn: true, vigColor: '#ffffff', vigA: 70, vigSize: 50 }],
  ['긴장', { contrast: 120, saturate: 80, vigOn: true, vigColor: '#4a0000', vigA: 60, vigSize: 45, lineOn: true, lineType: 'focus', lineColor: '#000000', lineA: 85, lineN: 120, lineIn: 55, lineW: 3 }],
  ['공포', { bright: 80, contrast: 130, saturate: 60, tintOn: true, tintColor: '#2a0b3a', tintA: 35, tintMode: 'multiply', vigOn: true, vigColor: '#000000', vigA: 80, vigSize: 40 }],
  ['흑백 톤', { gray: true, contrast: 115, toneOn: true, toneType: 'dot', toneGap: 6, toneSize: 40, toneAngle: 45, toneColor: '#000000', toneA: 55, toneFade: 'top' }],
  ['노을', { tintOn: true, tintColor: '#ff8a3d', tintA: 30, tintMode: 'soft-light', gradOn: true, gradColor: '#ff5e3a', gradA: 45, gradDir: 'top', gradLen: 70, gradMode: 'multiply', bright: 102 }],
];
const SFX_PRESETS = [
  { n: '쾅! 충격', text: '쾅!', p: { bold: true, italic: false, fs: 130, color: '#ffffff', sc: '#111111', sw: 9, sw2: 0, ext: 20, extAng: 120, extColor: '#111111', jit: 30, grow: 0, sp: -4, skew: -8, rough: 35, fillGrad: false } },
  { n: '두근 설렘', text: '두근', p: { bold: true, italic: false, fs: 90, color: '#ff4d7d', sc: '#ffffff', sw: 7, sw2: 5, sc2: '#ff4d7d', ext: 0, jit: 22, grow: 0, sp: 2, skew: 0, rough: 12, fillGrad: false } },
  { n: '휙 속도', text: '휙', p: { bold: true, italic: false, fs: 110, color: '#111111', sc: '#ffffff', sw: 6, sw2: 0, ext: 0, jit: 10, grow: 40, sp: -6, skew: -28, rough: 30, fillGrad: false } },
  { n: '덜덜 떨림', text: '덜덜', p: { bold: true, italic: false, fs: 90, color: '#111111', sc: '#ffffff', sw: 6, sw2: 0, ext: 0, jit: 75, grow: 0, sp: 4, skew: 0, rough: 55, fillGrad: false } },
  { n: '쿵 묵직', text: '쿵', p: { bold: true, italic: false, fs: 150, color: '#5a5a5a', fillGrad: true, fill2: '#000000', sc: '#ffffff', sw: 10, sw2: 0, ext: 26, extAng: 90, extColor: '#000000', jit: 6, grow: 0, sp: 0, skew: 0, rough: 25 } },
  { n: '스윽 조용', text: '스윽', p: { bold: false, italic: true, fs: 70, color: '#333333', sc: '#ffffff', sw: 4, sw2: 0, ext: 0, jit: 12, grow: -20, sp: 18, skew: -12, rough: 45, fillGrad: false } },
  { n: '꺄악! 비명', text: '꺄악!', p: { bold: true, italic: false, fs: 110, color: '#ffffff', sc: '#d4161b', sw: 8, sw2: 6, sc2: '#ffffff', ext: 0, jit: 45, grow: 25, sp: -2, skew: -6, rough: 40, fillGrad: false } },
  { n: '반짝', text: '반짝', p: { bold: true, italic: false, fs: 80, color: '#fff7c2', fillGrad: true, fill2: '#ffb300', sc: '#7a4a00', sw: 5, sw2: 5, sc2: '#ffffff', ext: 0, jit: 15, grow: 0, sp: 6, skew: 0, rough: 0 } },
];
const PRESETS = [
  { id: 'webtoon', name: '웹툰 (세로 스크롤)', w: 800, h: 4000, desc: '아래로 길게 이어지는 형식' },
  { id: 'manga', name: '만화 페이지', w: 1000, h: 1414, desc: '책처럼 한 장씩 나뉘는 형식' },
  { id: 'square', name: '인스타툰 정사각형', w: 1080, h: 1080, desc: '1:1 한 장짜리' },
  { id: 'insta', name: '인스타툰 세로', w: 1080, h: 1350, desc: '4:5 한 장짜리' },
];
function newPage(w, h, name) { return { id: uid(), name: name || '페이지', w, h, bg: '#ffffff', els: [] }; }
let doc = { name: '새 작품', mode: 'cut', folders: [], pages: [newPage(800, 4000, '페이지 1')], cur: 0, defaults: DEFAULTS() };
const images = new Map(); // id -> {id,name,src,w,h,thumb,kind}
const imgCache = new Map(); // id -> HTMLImageElement
const trash = new Map(); // 보관함에서 뺀 그림 (되돌리기용)
const activeLayer = new Map(); // 컷 id -> 고른 레이어 번호 (0 = 배경)
const MAX_LAYERS = 10;
const stamps = new Map(); // 효과음 보관함 (작품과 상관없이 유지)
const packs = [];          // 기본 효과음 팩 + 불러온 효과음 팩
const closedPacks = new Set();
let sfxVar = 'ink';        // 놓을 효과음 버전: ink(먹선) | outline(흰 테두리) | white(흰펜)
let imageOrder = [];
let marks = [];
let sel = [];
let imageEditId = null;
let hoverId = null;
let zoom = 1;
let snapOn = true;
let guides = [];
let marquee = null;
let drag = null;
let clip = null;
let fxClip = null;
let spaceDown = false;
let panelPickTarget = null;
let mode = null;      // null | 'split' | 'pen'
let splitSt = null;   // {kind, phase, a, b, c}
let penSt = null;     // {strokes, cur, last}
let brushSt = null;   // 가리기 브러쉬 {el, world, shapes, cur, isNew}
let cropSt = null;    // 자르기 {r: 남길 상자, ratio}
const openSecs = new Set(['img', 'border', 'sfx']);

const page = () => doc.pages[doc.cur];
const findEl = id => page().els.find(e => e.id === id);
const selEls = () => sel.map(findEl).filter(Boolean);
/* 이미지 편집 모드: 그림 한 장 = 페이지 한 장 (바탕 그림은 움직이지 않게 고정) */
const isImg = () => doc.mode === 'image';
const realIdx = () => doc.pages.map((p, i) => p.ph ? -1 : i).filter(i => i >= 0);
const folderById = id => (doc.folders || []).find(f => f.id === id) || null;
// 폴더는 나무 모양이에요: { id, name(그 칸 이름), parent(위 폴더 id 또는 null) }
const folderKids = pid => (doc.folders || []).filter(f => (f.parent || null) === (pid || null));
function folderPath(id, sep = '/') { const out = []; let f = folderById(id), n = 0; while (f && n++ < 64) { out.unshift(f.name); f = f.parent ? folderById(f.parent) : null; } return out.join(sep); }
function folderDesc(id) { const out = new Set([id]); let grow = true; while (grow) { grow = false; for (const f of doc.folders || []) if (f.parent && out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grow = true; } } return out; }
const inFolder = (fid, root) => !!fid && !!root && folderDesc(root).has(fid); // 그 폴더나 그 아래 폴더에 있나
const folderDepth = id => { let d = 0, f = folderById(id); while (f && f.parent && d < 64) { d++; f = folderById(f.parent); } return d; };
// 'A/B/C' 같은 경로를 base 아래에 차례로 만들고 맨 끝 폴더를 돌려줘요
function ensureFolder(name, base) {
  doc.folders = doc.folders || [];
  const segs = String(name || '').split('/').map(x => x.trim()).filter(Boolean); if (!segs.length) segs.push('새 폴더');
  let pid = base || null, f = null;
  for (const nm of segs) { f = doc.folders.find(x => (x.parent || null) === pid && x.name === nm); if (!f) { f = { id: 'f_' + uid(), name: nm, parent: pid }; doc.folders.push(f); } pid = f.id; }
  return f;
}
// 예전 작업(이름에 '/'가 든 폴더)을 나무 모양으로
function migrateFolders(d) {
  const F = d.folders || []; if (!F.some(f => f.name && f.name.includes('/') && !f.parent)) return;
  const byPath = new Map();
  const get = (path) => { if (byPath.has(path)) return byPath.get(path); const i = path.lastIndexOf('/'), pid = i < 0 ? null : get(path.slice(0, i)), nm = path.slice(i + 1);
    let f = F.find(x => !x.name.includes('/') && (x.parent || null) === pid && x.name === nm); if (!f) { f = { id: 'f_' + uid(), name: nm, parent: pid }; F.push(f); } byPath.set(path, f.id); return f.id; };
  for (const f of F.slice()) if (f.name.includes('/') && !f.parent) { const i = f.name.lastIndexOf('/'); f.parent = get(f.name.slice(0, i)); f.name = f.name.slice(i + 1); }
}
function folderOptions(cur) { // 나무 순서대로, 들여쓰기
  const out = []; const walk = (pid, d) => { for (const f of folderKids(pid)) { out.push(`<option value="${f.id}" ${f.id === cur ? 'selected' : ''}>${'\u3000'.repeat(d)}${d ? '└ ' : ''}${esc(f.name)}</option>`); walk(f.id, d + 1); } };
  walk(null, 0); return out.join('');
}
function phPage() { const p = newPage(800, 600, '그림 없음'); p.ph = true; return p; }
function makeImagePage(id, folder) {
  const r = images.get(id), p = newPage(r.w, r.h, r.name); p.img = id; p.folder = folder || null;
  const el = makePanel(r.w / 2, r.h / 2, r.w, r.h, id); el.bw = 0; el.lock = true; p.els.push(el); return p;
}
const baseEl = p => p.els.find(e => e.lock && e.type === 'panel');
function normalizeDoc(d) {
  const D = DEFAULTS();
  const out = { name: d.name || '새 작품', mode: d.mode === 'image' ? 'image' : 'cut', folders: Array.isArray(d.folders) ? d.folders : [], pages: d.pages && d.pages.length ? d.pages : [newPage(800, 4000, '페이지 1')], cur: clamp(d.cur | 0, 0, (d.pages || [1]).length - 1), defaults: D };
  if (d.defaults) for (const k of Object.keys(D)) Object.assign(D[k], d.defaults[k] || {});
  migrateFolders(out);
  return out;
}

/* ================= 되돌리기 ================= */
let hist = [], hi = -1;
const snapStr = () => JSON.stringify({ name: doc.name, mode: doc.mode, folders: doc.folders, pages: doc.pages, defaults: doc.defaults });
function resetHistory() { hist = [{ s: snapStr(), cur: doc.cur }]; hi = 0; updateUndo(); }
function commit() {
  const s = snapStr();
  if (hist[hi] && hist[hi].s === s) return;
  hist = hist.slice(0, hi + 1); hist.push({ s, cur: doc.cur });
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1;
  afterChange();
}
function restoreHist(h) {
  const o = JSON.parse(h.s);
  doc.name = o.name; doc.pages = o.pages; doc.defaults = o.defaults; doc.folders = o.folders || []; if (o.mode) doc.mode = o.mode;
  doc.cur = clamp(h.cur, 0, doc.pages.length - 1);
  const back = id => { if (id && !images.has(id) && trash.has(id)) { addImageRecord(trash.get(id), true); trash.delete(id); } };
  for (const p of doc.pages) for (const e of p.els) { back(e.img); for (const L of e.layers || []) back(L.img); }
  sel = sel.filter(id => findEl(id)); imageEditId = null; closeInline(true);
  layoutSpacer(); renderAll(); afterChange();
}
function undo() { if (hi <= 0) return; hi--; restoreHist(hist[hi]); }
function redo() { if (hi >= hist.length - 1) return; hi++; restoreHist(hist[hi]); }
function updateUndo() { $('#bUndo').disabled = hi <= 0; $('#bRedo').disabled = hi >= hist.length - 1; }
function afterChange() { updateUndo(); scheduleSave(); scheduleThumbs(); updateHint(); renderLibSoon(); renderLayersSoon(); }

/* ================= 저장소 (자동 저장) ================= */
const idb = {
  db: null,
  open() {
    return new Promise(res => {
      try {
        const r = indexedDB.open('cut-editor', 3);
        r.onupgradeneeded = () => {
          const db = r.result, has = n => db.objectStoreNames.contains(n);
          if (!has('kv')) db.createObjectStore('kv');
          if (!has('imgs')) db.createObjectStore('imgs', { keyPath: 'id' });
          if (!has('fonts')) db.createObjectStore('fonts', { keyPath: 'name' });
          if (!has('stamps')) db.createObjectStore('stamps', { keyPath: 'id' });
          if (!has('packs')) db.createObjectStore('packs', { keyPath: 'id' });
        };
        r.onsuccess = () => { this.db = r.result; res(true); };
        r.onerror = () => res(false);
      } catch (e) { res(false); }
    });
  },
  tx(store, mode, fn) {
    return new Promise(res => {
      if (!this.db) return res(null);
      try {
        const t = this.db.transaction(store, mode); const rq = fn(t.objectStore(store));
        t.oncomplete = () => res(rq ? rq.result : true); t.onerror = () => res(null); t.onabort = () => res(null);
      } catch (e) { res(null); }
    });
  },
  get(k) { return this.tx('kv', 'readonly', s => s.get(k)); },
  set(k, v) { return this.tx('kv', 'readwrite', s => s.put(v, k)); },
  all(st) { return this.tx(st, 'readonly', s => s.getAll()); },
  put(st, v) { return this.tx(st, 'readwrite', s => s.put(v)); },
  del(st, k) { return this.tx(st, 'readwrite', s => s.delete(k)); },
  clear(st) { return this.tx(st, 'readwrite', s => s.clear()); },
};
let saveT = null;
function scheduleSave() { clearTimeout(saveT); $('#saveState').textContent = '저장 중…'; saveT = setTimeout(saveNow, 900); }
async function saveNow() {
  clearTimeout(saveT); saveT = null;
  const ok = await idb.set('doc', { s: snapStr(), cur: doc.cur, imageOrder, at: Date.now() });
  const t = new Date();
  $('#saveState').textContent = ok ? `저장됨 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '자동 저장 안 됨';
  $('#saveState').title = ok ? '이 브라우저에 자동으로 저장됐어요' : '자동 저장이 안 돼요. 저장 버튼으로 파일을 받아 두세요.';
}
document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) saveNow(); });

/* ================= 그림 ================= */
function readAsDataURL(file) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); }); }
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
function makeThumb(rec, im, transparent) {
  const s = Math.min(1, 240 / Math.max(im.naturalWidth, im.naturalHeight * 0.75));
  const c = newCanvas(im.naturalWidth * s, im.naturalHeight * s), g = c.getContext('2d');
  if (!transparent) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(im, 0, 0, c.width, c.height);
  rec.thumb = transparent ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.82);
}
function hasAlpha(im) {
  try {
    const c = newCanvas(64, 64), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 235) n++;
    return n > 20;
  } catch (e) { return false; }
}
const recData = rec => ({ id: rec.id, name: rec.name, src: rec.src, w: rec.w, h: rec.h, thumb: rec.thumb, kind: rec.kind, alpha: rec.alpha, folder: rec.folder || null });
function addImageRecord(rec, persist, imEl) {
  images.set(rec.id, rec);
  if (rec.kind !== 'stamp' && !imageOrder.includes(rec.id)) imageOrder.push(rec.id);
  const done = im => {
    const fresh = rec.alpha === undefined;
    if (fresh && rec.kind !== 'stamp') { rec.alpha = hasAlpha(im); rec.thumb = null; }
    if (!rec.thumb) makeThumb(rec, im, rec.kind === 'stamp' || rec.alpha);
    return fresh;
  };
  if (imEl) { done(imEl); imgCache.set(rec.id, imEl); }
  else {
    const im = new Image();
    im.onload = () => { if (done(im) && images.has(rec.id)) idb.put('imgs', recData(rec)); clearImgCaches(rec.id); alphaMaps.delete(rec.id); requestRender(); renderLibSoon(); scheduleThumbs(); };
    im.src = rec.src; imgCache.set(rec.id, im);
  }
  if (persist) idb.put('imgs', recData(rec));
}
const isImageFile = f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name || '');
async function importFiles(files) {
  files = [...files].filter(isImageFile);
  files.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true }));
  const ids = [];
  for (const f of files) {
    try {
      const src = await readAsDataURL(f); const im = await loadImg(src);
      const rec = { id: uid(), name: f.name || '붙여넣은 그림', src, w: im.naturalWidth, h: im.naturalHeight };
      addImageRecord(rec, true, im); ids.push(rec.id);
    } catch (e) { toast(`${f.name || '그림'}을 열지 못했어요`); }
  }
  renderLib();
  return ids;
}
const dirOf = path => { const i = String(path || '').lastIndexOf('/'); return i > 0 ? String(path).slice(0, i) : null; };
async function importItems(items, intoFolder) { // [{file, dir}] → [{id, folder}] (폴더 이름 그대로 묶어요)
  items = items.filter(it => it.file && isImageFile(it.file));
  // 폴더 구조는 디스크 그대로 나무 모양으로 만들어요 (작업/캐릭터A/표정 → 작업 › 캐릭터A › 표정)
  // 목록에 보이는 순서대로 (폴더마다 그 폴더 그림 먼저, 그다음 하위 폴더)
  const cmpS = (x, y) => x.localeCompare(y, 'ko', { numeric: true });
  items.sort((a, b) => {
    const A = a.dir ? a.dir.split('/') : [], B = b.dir ? b.dir.split('/') : [];
    for (let i = 0; i < Math.min(A.length, B.length); i++) { const c = cmpS(A[i], B[i]); if (c) return c; }
    if (A.length !== B.length) return A.length - B.length;
    return cmpS(a.file.name || '', b.file.name || '');
  });
  const out = [], many = items.length > 6;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (many && i % 4 === 0) toast(`그림 불러오는 중… ${i + 1} / ${items.length}`, 2000);
    try {
      const src = await readAsDataURL(it.file), im = await loadImg(src);
      const fid = it.dir ? ensureFolder(it.dir, intoFolder || null).id : (intoFolder || null);
      const rec = { id: uid(), name: it.file.name || '붙여넣은 그림', src, w: im.naturalWidth, h: im.naturalHeight, folder: fid };
      addImageRecord(rec, true, im); out.push({ id: rec.id, folder: fid });
    } catch (e) { toast(`${it.file.name || '그림'}을 열지 못했어요`); }
  }
  return out;
}
// 모드에 맞게 넣기: 컷 편집은 보관함으로, 이미지 편집은 고칠 그림(페이지)으로
async function addImages(items, intoFolder) {
  const got = await importItems(items, intoFolder);
  if (!got.length) { if (items.length) toast('그림 파일이 없어요. PNG, JPG, WEBP 그림을 넣어 주세요.', 3200); return got; }
  if (isImg()) {
    doc.pages = doc.pages.filter(p => !p.ph);
    const first = doc.pages.length;
    for (const g of got) doc.pages.push(makeImagePage(g.id, g.folder));
    if (mode) setMode(null);
    doc.cur = first; sel = []; imageEditId = null; commit(); fitView(); renderAll();
    toast(`${got.length}장을 열었어요. 왼쪽 목록에서 골라 고치세요.`, 3200);
  } else { renderLib(); switchTab('lib'); toast(`${got.length}장을 보관함에 넣었어요`); updateHint(); }
  return got;
}
async function entryItems(entry, dir, out) {
  if (entry.isFile) { try { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, dir }); } catch (e) { } return; }
  if (!entry.isDirectory) return;
  const rd = entry.createReader(), sub = dir ? dir + '/' + entry.name : entry.name;
  for (;;) { const batch = await new Promise(res => rd.readEntries(res, () => res([]))); if (!batch.length) break; for (const e of batch) await entryItems(e, sub, out); }
}
async function handleItems(h, dir, out) { // 폴더 핸들 → 안의 파일들 (하위 폴더까지)
  const sub = dir ? dir + '/' + h.name : h.name;
  for await (const [, c] of h.entries()) {
    if (c.kind === 'file') { try { out.push({ file: await c.getFile(), dir: sub }); } catch (e) { } }
    else await handleItems(c, sub, out);
  }
}
async function dtItems(dt) { // 끌어다 놓은 파일과 폴더 → [{file, dir}]
  // 놓는 순간에만 꺼낼 수 있어서 기다리기 전에 모두 꺼내 둬요.
  // 파일로 연 편집기(file://)에서는 예전 방식(webkitGetAsEntry)으로 파일을 못 읽어요. 파일은 getAsFile, 폴더는 새 방식 핸들로 읽어요.
  const list = [...(dt.items || [])].filter(i => i.kind === 'file');
  const got = list.map(i => ({ file: i.getAsFile(), en: i.webkitGetAsEntry ? i.webkitGetAsEntry() : null, h: i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null }));
  if (!got.length) return [...(dt.files || [])].map(f => ({ file: f, dir: null }));
  const out = []; let dirFail = 0;
  for (const g of got) {
    const h = g.h ? await g.h : null, isDir = (h && h.kind === 'directory') || (g.en && g.en.isDirectory);
    if (!isDir) { if (g.file) out.push({ file: g.file, dir: null }); continue; }
    const n0 = out.length;
    if (h && h.kind === 'directory') { try { await handleItems(h, null, out); } catch (e) { } }
    if (out.length === n0 && g.en) await entryItems(g.en, null, out);
    if (out.length === n0) dirFail++;
  }
  if (dirFail) toast("폴더를 읽지 못했어요. 왼쪽 위 '+ 폴더째' 버튼으로 골라 주세요.", 4200);
  return out;
}
let pickCb = null;
function pickFiles(dir, cb) { pickCb = cb || null; (dir ? $('#fileDir') : $('#fileImg')).click(); }
function askText(title, val, okLabel) {
  return new Promise(res => {
    const m = modal(`<h2>${title}</h2><input type="text" id="askIn" class="askin" value="${esc(val || '')}" spellcheck="false"><div class="foot"><button class="btn" id="askNo">취소</button><button class="btn primary" id="askOk">${okLabel || '확인'}</button></div>`);
    const inp = $('#askIn', m); let done = false;
    const fin = v => { if (done) return; done = true; closeModal(); res(v); };
    $('#askOk', m).addEventListener('click', () => fin(inp.value.trim() || null)); $('#askNo', m).addEventListener('click', () => fin(null));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fin(inp.value.trim() || null); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
  });
}
function usedSet() { const s = new Set(); for (const p of doc.pages) for (const e of p.els) { if (e.img) s.add(e.img); for (const L of e.layers || []) if (L.img) s.add(L.img); } return s; }
function removeImage(id) {
  if (usedSet().has(id) && !confirm('이 그림을 쓰는 컷이 있어요. 보관함에서 빼면 그 컷에서도 사라져요. 뺄까요?')) return;
  for (const p of doc.pages) for (const e of p.els) { if (e.img === id) e.img = null; if (e.layers) e.layers = e.layers.filter(L => L.img !== id); }
  trash.set(id, images.get(id)); images.delete(id); imgCache.delete(id);
  imageOrder = imageOrder.filter(x => x !== id); marks = marks.filter(x => x !== id);
  idb.del('imgs', id); commit(); renderLib(); renderProps(); requestRender();
}
// 가장자리와 이어진 단색 배경을 투명하게 (캐릭터 그림용)
async function removeBg(src) {
  const im = await loadImg(src), W = im.naturalWidth, H = im.naturalHeight;
  const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
  const id = g.getImageData(0, 0, W, H), d = id.data, smp = [];
  const take = (x, y) => { const i = (y * W + x) * 4; if (d[i + 3] > 200) smp.push([d[i], d[i + 1], d[i + 2]]); };
  const sx = Math.max(1, (W / 300) | 0), sy = Math.max(1, (H / 300) | 0);
  for (let x = 0; x < W; x += sx) { take(x, 0); take(x, H - 1); }
  for (let y = 0; y < H; y += sy) { take(0, y); take(W - 1, y); }
  if (!smp.length) return null;
  const med = k => smp.map(s => s[k]).sort((a, b) => a - b)[smp.length >> 1], bg = [med(0), med(1), med(2)];
  const T1 = 40, T2 = 78, dist = i => Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
  const mark = new Uint8Array(W * H), stack = new Int32Array(W * H); let sp = 0;
  const seed = p => { if (!mark[p] && dist(p * 4) < T1) { mark[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (sp) { const p = stack[--sp], x = p % W; if (x > 0) seed(p - 1); if (x < W - 1) seed(p + 1); if (p >= W) seed(p - W); if (p < W * (H - 1)) seed(p + W); }
  let n = 0;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    if (mark[p]) { d[i + 3] = 0; n++; continue; }
    const x = p % W, nb = (x > 0 && mark[p - 1]) || (x < W - 1 && mark[p + 1]) || (p >= W && mark[p - W]) || (p < W * (H - 1) && mark[p + W]);
    if (nb) {
      const t = clamp((dist(i) - T1) / (T2 - T1), 0.12, 1);
      if (t < 1) for (let k = 0; k < 3; k++) d[i + k] = clamp((d[i + k] - bg[k] * (1 - t)) / t, 0, 255);
      d[i + 3] = d[i + 3] * t;
    }
  }
  if (n < W * H * 0.01) return null;
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}
// 흰 배경을 투명하게 (종이 사진, 흰 바탕 그림용)
async function whiteToAlpha(src) {
  const im = await loadImg(src);
  const c = newCanvas(im.naturalWidth, im.naturalHeight), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0); const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  let tot = 0; for (const v of hist) tot += v;
  let acc = 0, wp = 255; for (let l = 255; l >= 0; l--) { acc += hist[l]; if (acc >= tot * 0.3) { wp = l; break; } }
  wp = clamp(wp, 150, 255);
  for (let i = 0; i < d.length; i += 4) {
    const r = Math.min(255, d[i] * 255 / wp), gg = Math.min(255, d[i + 1] * 255 / wp), b = Math.min(255, d[i + 2] * 255 / wp);
    let al = Math.max(255 - r, 255 - gg, 255 - b) / 255;
    if (al < 0.07) al = 0; else al = Math.min(1, (al - 0.07) / 0.93 * 1.08);
    if (al > 0) { d[i] = clamp(255 - (255 - r) / al, 0, 255); d[i + 1] = clamp(255 - (255 - gg) / al, 0, 255); d[i + 2] = clamp(255 - (255 - b) / al, 0, 255); }
    d[i + 3] = d[i + 3] * al;
  }
  g.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
}

/* ================= 효과음 보관함 ================= */
async function importStamps(files, white) {
  files = [...files].filter(isImageFile);
  files.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true }));
  let n = 0;
  for (const f of files) {
    try {
      let src = await readAsDataURL(f);
      if (white) src = await whiteToAlpha(src);
      const im = await loadImg(src);
      const rec = { id: 's_' + uid(), name: f.name || '효과음', src, w: im.naturalWidth, h: im.naturalHeight, kind: 'stamp', at: Date.now() + n };
      makeThumb(rec, im, true); stamps.set(rec.id, rec); idb.put('stamps', rec); n++;
    } catch (e) { toast(`${f.name || '그림'}을 열지 못했어요`); }
  }
  renderStamps(); return n;
}
function ensureStampImage(id) {
  if (images.has(id)) return true;
  const r = stamps.get(id); if (!r) return false;
  addImageRecord({ id: r.id, name: r.name, src: r.src, w: r.w, h: r.h, thumb: r.thumb, kind: 'stamp' }, true);
  return true;
}

/* ================= 효과음 팩 ================= */
const VAR_NAME = { ink: '먹선', outline: '흰 테두리', white: '흰펜' };
let builtinLoaded = false;
function ensurePacks() { // 기본 효과음은 처음 쓸 때 읽어요 (시작이 빨라지게)
  if (builtinLoaded) return; builtinLoaded = true;
  const s = document.getElementById('cutSfxPacks'); if (!s) return;
  try { packs.unshift(...JSON.parse(s.textContent).map(p => ({ ...p, builtin: true }))); } catch (e) { }
  s.remove();
}
const findPack = id => { ensurePacks(); return packs.find(p => p.id === id); };
function ensurePackImage(pk, i, v) {
  const w = pk.words[i], a = w && w.v[v]; if (!a) return null;
  const id = `pk_${pk.id}_${i}_${v}`;
  if (!images.has(id)) addImageRecord({ id, name: w.t + (v === 'ink' ? '' : ` (${VAR_NAME[v]})`), src: a[0], w: a[1], h: a[2], kind: 'stamp', alpha: true, thumb: w.th }, true);
  return id;
}
// 버전이 없으면 먹선으로 놓고 편집기 기능으로 비슷하게 만들어요
function packVariant(w, want) { return w.v[want] ? { v: want, fb: null } : { v: w.v.ink ? 'ink' : Object.keys(w.v)[0], fb: want }; }
function applyFallback(el, fb) {
  el.tintOn = false; el.ow = 0;
  if (fb === 'white') { el.tintOn = true; el.tint = '#ffffff'; }
  if (fb === 'outline') { el.ow = Math.max(3, Math.round(Math.min(el.w, el.h) * 0.035)); el.oc = '#ffffff'; }
}
function placePackWord(pkId, i, at) {
  const pk = findPack(pkId), w = pk && pk.words[i]; if (!w) return;
  const { v, fb } = packVariant(w, sfxVar), id = ensurePackImage(pk, i, v), r = images.get(id), pg = page();
  const ink = w.v.ink || w.v[v], s = Math.sqrt(Math.pow(pg.w * 0.32, 2) / (ink[1] * ink[2]));
  const p = at || viewCenter(), el = makeStamp(id, p.x, p.y);
  el.w = r.w * s; el.h = r.h * s; el.x = p.x - el.w / 2; el.y = p.y - el.h / 2;
  el.op = 100; el.flip = false; applyFallback(el, fb);
  el.pk = pk.id; el.pw = i; el.pv = sfxVar;
  if (!at) placeNear(el);
  page().els.push(el); sel = [el.id]; if (mode) setMode(null); commit(); renderProps(); requestRender();
}
function switchPackVariant(el, want) {
  const pk = findPack(el.pk), w = pk && pk.words[el.pw]; if (!w) return;
  const cur = images.get(el.img), { v, fb } = packVariant(w, want), id = ensurePackImage(pk, el.pw, v), r = images.get(id);
  const c = center(el), s = cur ? el.w / cur.w : el.w / r.w;
  el.img = id; el.w = r.w * s; el.h = r.h * s; el.x = c.x - el.w / 2; el.y = c.y - el.h / 2; el.pv = want;
  applyFallback(el, fb);
}
// zip 읽기 (효과음 팩 불러오기용)
async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip');
  const n = dv.getUint16(eocd + 10, true), out = []; let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const flag = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const nb = buf.subarray(p + 46, p + 46 + nl); let name;
    try { name = new TextDecoder('utf-8', { fatal: !(flag & 0x800) }).decode(nb); } catch (e) { name = new TextDecoder('euc-kr').decode(nb); }
    p += 46 + nl + el + cl;
    if (name.endsWith('/')) continue;
    const st = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    out.push({ name: name.normalize('NFC'), method, data: buf.subarray(st, st + csize) });
  }
  return out;
}
async function unzipEntry(e) {
  if (e.method === 0) return e.data;
  if (e.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('method');
  const s = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function smallThumb(im) {
  const s = Math.min(1, 140 / Math.max(im.naturalWidth, im.naturalHeight)), c = newCanvas(im.naturalWidth * s, im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/png');
}
async function importPackZip(file) {
  toast('효과음 팩을 읽는 중…', 2500);
  try {
    const ents = await readZip(file), byName = new Map(ents.map(e => [e.name, e]));
    const idxE = ents.find(e => /(^|\/)index\.json$/i.test(e.name)); let words = [], meta = null;
    if (idxE) {
      const base = idxE.name.replace(/index\.json$/i, '');
      meta = JSON.parse(new TextDecoder().decode(await unzipEntry(idxE)));
      for (const a of meta.assets || []) {
        const v = {};
        for (const [k, key] of [['ink', 'ink'], ['white_outline', 'outline'], ['white_ink', 'white']]) { const e = a[k] && byName.get((base + a[k]).normalize('NFC')); if (e) v[key] = e; }
        if (Object.keys(v).length) words.push({ t: a.text || '', c: a.category || '', v });
      }
    }
    if (!words.length) for (const e of ents) {
      if (!/\.(png|webp)$/i.test(e.name) || /미리보기|preview/i.test(e.name)) continue;
      const parts = e.name.split('/'), f = parts.pop(); words.push({ t: f.replace(/\.[^.]+$/, ''), c: parts.pop() || '', v: { ink: e } });
    }
    if (!words.length) throw new Error('empty');
    const pk = { id: 'p_' + uid(), name: meta && meta.volume ? `효과음 Vol.${meta.volume}` : file.name.replace(/\.zip$/i, ''), words: [], at: Date.now() };
    for (const w of words) {
      const o = { t: w.t, c: w.c, v: {} };
      for (const [k, e] of Object.entries(w.v)) {
        const blob = new Blob([await unzipEntry(e)], { type: /\.webp$/i.test(e.name) ? 'image/webp' : 'image/png' });
        const src = await readAsDataURL(blob), im = await loadImg(src);
        o.v[k] = [src, im.naturalWidth, im.naturalHeight]; if (k === 'ink' || !o.th) o.th = smallThumb(im);
      }
      pk.words.push(o);
    }
    packs.push(pk); idb.put('packs', pk); closedPacks.clear(); renderStamps(); switchTab('sfx');
    toast(`'${pk.name}' 효과음 ${pk.words.length}종을 넣었어요`);
  } catch (e) { toast('효과음 팩을 읽지 못했어요. zip 파일 안에 PNG가 들어 있는지 확인해 주세요.', 4000); }
}

/* ================= 요소 만들기 ================= */
const mctx = document.createElement('canvas').getContext('2d');
function makePanel(cx, cy, w, h, img) {
  const d = doc.defaults.panel;
  return { id: uid(), type: 'panel', x: cx - w / 2, y: cy - h / 2, w, h, rot: 0, img: img || null, iz: 1, ox: 0, oy: 0, flip: false, bw: d.bw, bc: d.bc, radius: d.radius, fill: null };
}
function makeBubble(cx, cy, shape) {
  const d = clone(doc.defaults.bubble);
  if (shape) d.shape = shape;
  const el = { id: uid(), type: 'bubble', x: cx - 120, y: cy - 75, w: 240, h: 150, rot: 0, text: shape === 'rect' ? '나레이션' : '대사를 입력하세요', ...d };
  if (shape === 'rect') el.tail = false;
  fitToPage(el, ['fs', 'sw', 'tw', 'tsw'], 0.02, 0.12, 0.04);
  if (el.auto) fitBubble(el);
  el.tx = el.x + el.w * 0.3; el.ty = el.y + el.h + Math.max(40, el.h * 0.45);
  return el;
}
// 그림이 아주 작거나 크면 글자 크기를 그림에 맞춰요 (짧은 변 기준 lo~hi 비율 밖이면 mid로)
function fitToPage(el, keys, lo, hi, mid) {
  const pg = page(), m = Math.min(pg.w, pg.h); if (!(m > 0)) return;
  if (el.fs >= m * lo && el.fs <= m * hi) return;
  const k = m * mid / el.fs; for (const q of keys) if (typeof el[q] === 'number') el[q] = Math.round(el[q] * k * 10) / 10;
}
function makeText(cx, cy, preset) {
  const el = { id: uid(), type: 'text', x: cx - 5, y: cy - 5, w: 10, h: 10, rot: 0, text: '쾅!', seed: 1, ...clone(doc.defaults.text) };
  if (preset) { Object.assign(el, clone(preset.p)); el.text = preset.text; }
  fitToPage(el, ['fs', 'sw', 'sw2'], 0.06, 0.25, 0.14);
  fitText(el); return el;
}
function makeStamp(id, cx, cy) {
  const r = images.get(id), pg = page();
  const w = Math.min(r.w, pg.w * 0.4, 600), h = w * r.h / r.w;
  return { id: uid(), type: 'stamp', img: id, x: cx - w / 2, y: cy - h / 2, w, h, rot: 0, flip: false, ...clone(doc.defaults.stamp) };
}
function textLines(el) { return String(el.text ?? '').split('\n'); }
function measureLines(el) {
  mctx.font = fontStr(el); let mw = 0; const lines = textLines(el);
  for (const l of lines) mw = Math.max(mw, mctx.measureText(l).width);
  return { mw, th: lines.length * el.fs * el.lh, n: lines.length };
}
// 효과음 글자 배치 (글자마다 흔들림, 크기 변화, 간격, 기울기, 입체)
const layoutCache = new Map();
function textLayout(el) {
  const key = [el.text, el.font, el.fs, el.bold, el.italic, el.lh, el.sp, el.jit, el.grow, el.seed, el.skew, el.ext, el.extAng, el.sw, el.sw2, el.rough, el.align, el.id, el.vert, el.arc, el.glow, el.shA, el.shDist, el.shBlur, el.boxOn, el.boxPad].join('|');
  if (layoutCache.has(key)) return layoutCache.get(key);
  const fs = el.fs, sp = (el.sp || 0) / 100 * fs, jit = (el.jit || 0) / 100, grow = (el.grow || 0) / 100;
  const rnd = seeded(el.id + ':' + (el.seed || 1)), lines = textLines(el);
  mctx.font = fontStr(el);
  const total = lines.reduce((s, l) => s + [...l].length, 0); let idx = 0;
  const rows = lines.map(line => {
    const chars = [...line], row = []; let x = 0;
    for (const ch of chars) {
      const t = total > 1 ? idx / (total - 1) : 0.5;
      const sc = Math.max(0.2, (1 + grow * (t - 0.5) * 2) * (1 + (rnd() - 0.5) * jit * 0.35));
      const w = mctx.measureText(ch).width * sc;
      row.push({ ch, cx: x + w / 2, dy: (rnd() - 0.5) * 2 * jit * fs * 0.12, sc, rot: (rnd() - 0.5) * 2 * jit * 16 * DEG, w });
      x += w + sp; idx++;
    }
    return { row, lw: Math.max(0, x - (chars.length ? sp : 0)) };
  });
  const maxW = Math.max(fs * 0.3, ...rows.map(r => r.lw)), lh = fs * el.lh, n = rows.length;
  const al = el.align || 'center', glyphs = [];
  if (el.vert) { // 세로쓰기: 줄마다 한 칸씩, 오른쪽 줄부터
    const cols = rows.map(r => { let y = 0; const out = r.row.map(g => { const h = (g.ch === ' ' ? fs * 0.45 : fs * 0.98) * g.sc; const o = { ...g, cy: y + h / 2 }; y += h + sp; return o; }); return { out, ch: Math.max(0, y - (out.length ? sp : 0)) }; });
    const maxH = Math.max(fs * 0.3, ...cols.map(c => c.ch));
    cols.forEach((c, i) => {
      const off = al === 'left' ? -maxH / 2 : al === 'right' ? maxH / 2 - c.ch : -c.ch / 2, x = ((n - 1) / 2 - i) * lh;
      for (const g of c.out) glyphs.push({ ch: g.ch, x: x + g.dy, y: off + g.cy, sc: g.sc, rot: g.rot, w: g.w });
    });
  } else rows.forEach((r, i) => {
    const off = al === 'left' ? -maxW / 2 : al === 'right' ? maxW / 2 - r.lw : -r.lw / 2;
    const y = (i - (n - 1) / 2) * lh;
    for (const g of r.row) glyphs.push({ ch: g.ch, x: off + g.cx, y: y + g.dy, sc: g.sc, rot: g.rot, w: g.w });
  });
  const arc = el.vert ? 0 : clamp(el.arc || 0, -100, 100);
  if (Math.abs(arc) > 0.5) { // 휘기: 둥근 길을 따라 글자를 놓아요 (+는 무지개처럼, -는 그릇처럼)
    const R = maxW / (arc / 100 * Math.PI);
    for (const g of glyphs) { const r = R - g.y, ph = g.x / R; g.x = r * Math.sin(ph); g.y = R - r * Math.cos(ph); g.rot += ph; }
    let cy = 0; for (const g of glyphs) cy += g.y; cy /= Math.max(1, glyphs.length); for (const g of glyphs) g.y -= cy;
  }
  const tk = Math.tan((el.skew || 0) * DEG);
  const ex = Math.cos((el.extAng || 0) * DEG) * (el.ext || 0) / 100 * fs, ey = Math.sin((el.extAng || 0) * DEG) * (el.ext || 0) / 100 * fs;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (x, y) => { const sx = x - tk * y; x0 = Math.min(x0, sx, sx + ex); x1 = Math.max(x1, sx, sx + ex); y0 = Math.min(y0, y, y + ey); y1 = Math.max(y1, y, y + ey); };
  for (const g of glyphs) {
    const hw = g.w / 2, hh = fs * g.sc * 0.56;
    for (const [px, py] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) { const r = rot(px, py, g.rot); add(g.x + r.x, g.y + r.y); }
  }
  if (!glyphs.length) add(0, 0);
  const gb = { x0, y0, x1, y1 }; // 글자만 (테두리 빼고) 차지하는 곳: 배경 띠에 씀
  const outl = (el.sw || 0) + (el.sw2 || 0);
  const glowExt = (el.glow || 0) / 100 * fs * 0.8, shExt = (el.shA || 0) > 0 ? ((el.shDist ?? 6) + (el.shBlur ?? 12) * 0.8) / 100 * fs : 0;
  const boxExt = el.boxOn ? Math.max(0, (el.boxPad ?? 30) / 100 * fs - outl) : 0;
  const pad = outl + (el.rough || 0) / 100 * fs * 0.08 + fs * 0.04 + Math.max(glowExt, shExt, boxExt);
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const L = { glyphs, w: x1 - x0, h: y1 - y0, ox: -(x0 + x1) / 2, oy: -(y0 + y1) / 2, tk, ex, ey, gb };
  layoutCache.set(key, L); if (layoutCache.size > 400) layoutCache.delete(layoutCache.keys().next().value);
  return L;
}
function fitText(el) {
  const L = textLayout(el), cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  el.w = Math.max(4, L.w); el.h = Math.max(4, L.h); el.x = cx - el.w / 2; el.y = cy - el.h / 2;
}
function fitBubble(el) {
  const { mw, th } = measureLines(el); const f = el.fs; let w, h;
  switch (el.shape) {
    case 'box': w = mw + f * 1.6; h = th + f * 1.3; break;
    case 'rect': w = mw + f * 1.3; h = th + f * 1.0; break;
    case 'shout': w = mw / 0.7 + f * 1.4; h = th / 0.68 + f * 1.3; break;
    case 'thought': w = mw / 0.7 + f * 1.8; h = th / 0.68 + f * 1.5; break;
    default: w = mw / 0.72 + f * 1.2; h = th / 0.72 + f * 1.0;
  }
  w = Math.max(w, f * 2.6); h = Math.max(h, f * 1.9);
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2, ow = el.w, oh = el.h;
  el.w = w; el.h = h; el.x = cx - w / 2; el.y = cy - h / 2;
  if (el.tx != null) keepTail(el, ow, oh);
}
function keepTail(el, ow, oh) {
  const t = tailLocal(el), L = Math.hypot(t.x, t.y); if (L < 1) return;
  const ux = t.x / L, uy = t.y / L, R0 = ellipseR(ow / 2, oh / 2, ux, uy);
  if (L <= R0) return;
  const nl = ellipseR(el.w / 2, el.h / 2, ux, uy) + (L - R0), v = rot(ux * nl, uy * nl, (el.rot || 0) * DEG), c = center(el);
  el.tx = c.x + v.x; el.ty = c.y + v.y;
}
function innerTextW(el) {
  const f = el.fs;
  switch (el.shape) { case 'box': return el.w - f * 1.2; case 'rect': return el.w - f * 1.0; default: return el.w * 0.72 - f * 0.5; }
}
function wrapLines(ctx, text, maxW) {
  const out = [];
  const pushWord = (lineRef, word) => {
    for (const ch of word) {
      const t = lineRef.v + ch;
      if (ctx.measureText(t).width > maxW && lineRef.v !== '') { out.push(lineRef.v); lineRef.v = ch === ' ' ? '' : ch; } else lineRef.v = t;
    }
  };
  for (const para of String(text).split('\n')) {
    const line = { v: '' };
    for (const tok of para.split(/(\s+)/)) {
      if (!tok) continue;
      const t = line.v + tok;
      if (ctx.measureText(t).width <= maxW) { line.v = t; continue; }
      if (/^\s+$/.test(tok)) { out.push(line.v.trimEnd()); line.v = ''; continue; }
      if (line.v.trim() !== '') { out.push(line.v.trimEnd()); line.v = ''; }
      if (ctx.measureText(tok).width <= maxW) line.v = tok; else pushWord(line, tok);
    }
    out.push(line.v.trimEnd());
  }
  return out;
}

/* ================= 컷 레이어 ================= */
const LDEF = { lrot: 0, lop: 100, lmode: 'source-over', flip: false, iz: 1, ox: 0, oy: 0 };
const ADJ = ['bright', 'contrast', 'saturate', 'blur', 'sepia', 'hue', 'gray'];
const layerCount = el => (el.img ? 1 : 0) + (el.layers ? el.layers.length : 0);
function getActiveIdx(el) {
  const n = el.layers ? el.layers.length : 0; let i = activeLayer.get(el.id);
  if (i == null || i > n || (i === 0 && !el.img && n)) i = n > 0 ? n : 0;
  return i;
}
const layerObj = (el, i) => i === 0 ? el : (el.layers || [])[i - 1];
const activeObj = el => el ? layerObj(el, getActiveIdx(el)) : null;
function layerList(el) { const out = []; if (el.img) out.push({ o: el, i: 0 }); (el.layers || []).forEach((L, k) => out.push({ o: L, i: k + 1 })); return out; }
function layerScaleOf(el, L) { const r = images.get(L.img); if (!r) return null; return { r, s: Math.max(el.w / r.w, el.h / r.h) * (L.iz ?? 1) }; }
function layerCorners(el, L) { // 레이어 그림의 네 모서리 (페이지 좌표)
  const k = layerScaleOf(el, L); if (!k) return null;
  const hw = k.r.w * k.s / 2, hh = k.r.h * k.s / 2, a = (L.lrot || 0) * DEG;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => { const q = rot(x, y, a); return toWorld(el, { x: q.x + (L.ox || 0), y: q.y + (L.oy || 0) }); });
}
const alphaMaps = new Map();
function alphaMap(id) {
  if (alphaMaps.has(id)) return alphaMaps.get(id);
  const im = imgCache.get(id); if (!im || !im.complete || !im.naturalWidth) return null;
  const s = Math.min(1, 320 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * s)), h = Math.max(1, Math.round(im.naturalHeight * s));
  try {
    const c = newCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
    const src = g.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h); for (let i = 0; i < a.length; i++) a[i] = src[i * 4 + 3];
    const m = { w, h, a }; alphaMaps.set(id, m); return m;
  } catch (e) { return null; }
}
function alphaAt(el, L, q) { // 컷 로컬 좌표 q에서 그 레이어가 얼마나 불투명한지 (0~255)
  const k = layerScaleOf(el, L); if (!k) return 0;
  let p = rot(q.x - (L.ox || 0), q.y - (L.oy || 0), -(L.lrot || 0) * DEG); if (L.flip) p.x = -p.x;
  const u = p.x / (k.r.w * k.s) + 0.5, v = p.y / (k.r.h * k.s) + 0.5;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  if (!k.r.alpha) return 255;
  const m = alphaMap(L.img); if (!m) return 255;
  return m.a[Math.min(m.h - 1, (v * m.h) | 0) * m.w + Math.min(m.w - 1, (u * m.w) | 0)];
}
function layerAt(el, p) { // 클릭한 곳에서 맨 위에 보이는 레이어 번호, 없으면 -1
  const q = toLocal(el, p), list = layerList(el);
  for (let j = list.length - 1; j >= 0; j--) { const { o, i } = list[j]; if (o.hidden) continue; if (alphaAt(el, o, q) * (o.lop ?? 100) / 100 > 28) return i; }
  return -1;
}
function newLayer(el, id, at) {
  if (layerCount(el) >= MAX_LAYERS) { toast(`한 컷에는 그림을 ${MAX_LAYERS}장까지 겹칠 수 있어요`); return null; }
  const r = images.get(id), cover = Math.max(el.w / r.w, el.h / r.h), contain = Math.min(el.w / r.w, el.h / r.h);
  const L = { id: uid(), img: id, iz: contain / cover * 0.9, ox: 0, oy: 0, flip: false, lrot: 0, lop: 100 };
  if (at) { const q = toLocal(el, at); L.ox = clamp(q.x, -el.w / 2, el.w / 2); L.oy = clamp(q.y, -el.h / 2, el.h / 2); }
  (el.layers || (el.layers = [])).push(L); activeLayer.set(el.id, el.layers.length);
  return L;
}
// 컷 크기나 모양이 바뀌어도 그림들이 페이지에서 제자리에 있도록 (o: 바뀌기 전, lc: 새 중심의 옛 로컬 좌표)
function reframe(el, o, lc) {
  const one = (L, Lo, base) => {
    const r = images.get(Lo.img); if (!r) return;
    const s = Math.max(o.w / r.w, o.h / r.h) * (Lo.iz ?? 1), c1 = Math.max(el.w / r.w, el.h / r.h);
    L.iz = s / c1; if (base && (Lo.iz ?? 1) >= 0.999 && L.iz < 1) L.iz = 1;
    L.ox = (Lo.ox || 0) - lc.x; L.oy = (Lo.oy || 0) - lc.y;
  };
  if (el.img) { one(el, o, true); clampImage(el); }
  (el.layers || []).forEach((L, i) => { if (o.layers && o.layers[i]) one(L, o.layers[i], false); });
}

/* ================= 기하 ================= */
const center = el => ({ x: el.x + el.w / 2, y: el.y + el.h / 2 });
function toLocal(el, p) { const c = center(el); return rot(p.x - c.x, p.y - c.y, -(el.rot || 0) * DEG); }
function toWorld(el, q) { const c = center(el), r = rot(q.x, q.y, (el.rot || 0) * DEG); return { x: c.x + r.x, y: c.y + r.y }; }
function corners(el) {
  const c = center(el), a = (el.rot || 0) * DEG;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => { const r = rot(sx * el.w / 2, sy * el.h / 2, a); return { x: c.x + r.x, y: c.y + r.y }; });
}
function aabb(el) {
  const cs = corners(el); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of cs) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function unionBox(bs) {
  if (!bs.length) return null; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function moveBy(el, dx, dy) { el.x += dx; el.y += dy; if (el.type === 'bubble') { el.tx += dx; el.ty += dy; } }
function distSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  const t = L ? clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / L, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}
function tailLocal(el) { const c = center(el); return rot(el.tx - c.x, el.ty - c.y, -(el.rot || 0) * DEG); }
function ellipseR(a, b, ux, uy) { return 1 / Math.sqrt((ux * ux) / (a * a) + (uy * uy) / (b * b)); }
// 잘린 컷 모양: clips = [[ [u,v], ... ], ...] (컷 상자 기준 0~1 좌표)
function polyPath(ctx, el, poly) {
  ctx.beginPath();
  for (let i = 0; i < poly.length; i++) { const x = (poly[i][0] - 0.5) * el.w, y = (poly[i][1] - 0.5) * el.h; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
  ctx.closePath();
}
function applyClips(ctx, el) { for (const poly of el.clips || []) { polyPath(ctx, el, poly); ctx.clip(); } }
function inClips(el, q) {
  if (!el.clips || !el.clips.length) return true;
  for (const poly of el.clips) { polyPath(mctx, el, poly); if (!mctx.isPointInPath(q.x, q.y)) return false; }
  return true;
}
const seeThrough = el => el.type === 'panel' && !(el.bw > 0) && !el.fill && !hasFx(el) && layerCount(el) > 0;
function hitEl(el, p, solid) {
  if (!solid && seeThrough(el)) { const q = toLocal(el, p); if (Math.abs(q.x) > el.w / 2 || Math.abs(q.y) > el.h / 2 || !inClips(el, q)) return false; return layerAt(el, p) >= 0; }
  const q = toLocal(el, p), tol = 3 / zoom;
  let ex = el.w / 2 + tol, ey = el.h / 2 + tol;
  if (el.type === 'bubble' && (el.shape === 'shout' || el.shape === 'thought')) { ex *= 1.12; ey *= 1.12; }
  if (Math.abs(q.x) <= ex && Math.abs(q.y) <= ey) return el.type === 'panel' ? inClips(el, q) : true;
  if (el.type === 'bubble' && el.tail) { if (distSeg(q, { x: 0, y: 0 }, tailLocal(el)) <= Math.max(el.tw * 0.45, 6 / zoom)) return true; }
  return false;
}
function hitTest(p, onlyType) {
  const els = page().els;
  for (let i = els.length - 1; i >= 0; i--) { const el = els[i]; if (el.hidden || el.ulock) continue; if (onlyType && el.type !== onlyType) continue; if (hitEl(el, p)) return el; }
  return null;
}
function imgRec(el) { return el.img ? images.get(el.img) : null; }
function clampImage(el) {
  const r = imgRec(el); if (!r) return;
  el.iz = clamp(el.iz, 0.05, 20);
  if (el.iz >= 0.999) {
    const cover = Math.max(el.w / r.w, el.h / r.h), s = cover * el.iz;
    const mx = Math.max(0, (r.w * s - el.w) / 2), my = Math.max(0, (r.h * s - el.h) / 2);
    el.ox = clamp(el.ox, -mx, mx); el.oy = clamp(el.oy, -my, my);
  }
}
function contentBottom(p) { let b = 0; for (const e of p.els) { const bb = aabb(e); b = Math.max(b, bb.y + bb.h); if (e.type === 'bubble' && e.tail) b = Math.max(b, e.ty); } return b; }

/* ================= 컷 자르기 ================= */
// 자르는 선(cut: {a,b,c}, 페이지 좌표)으로 컷 하나를 두 조각으로. 안 지나가면 null
function cutPolyline(A, B, C, L) {
  const pts = [], N = C ? 48 : 1;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (C) { const u = 1 - t; pts.push({ x: u * u * A.x + 2 * u * t * C.x + t * t * B.x, y: u * u * A.y + 2 * u * t * C.y + t * t * B.y }); }
    else pts.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
  }
  const nrm = v => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
  const t0 = nrm(C ? { x: C.x - A.x, y: C.y - A.y } : { x: B.x - A.x, y: B.y - A.y });
  const t1 = nrm(C ? { x: B.x - C.x, y: B.y - C.y } : { x: B.x - A.x, y: B.y - A.y });
  return [{ x: A.x - t0.x * L, y: A.y - t0.y * L }, ...pts, { x: B.x + t1.x * L, y: B.y + t1.y * L }];
}
function offsetPoly(pts, d, n) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let nx = -(b.y - a.y), ny = b.x - a.x; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * n.x + ny * n.y < 0) { nx = -nx; ny = -ny; }
    return { x: p.x + nx * d, y: p.y + ny * d };
  });
}
function clipSeg(a, b, x0, y0, x1, y1) { // Liang–Barsky
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
// 실제로 보이는 모양의 상자 (컷 로컬 px 좌표)
function regionBox(w, h, polys) {
  const paths = polys.map(poly => { const p = new Path2D(); poly.forEach((q, i) => i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)); p.closePath(); return p; });
  const inside = (q, skip) => {
    if (q.x < -w / 2 - 0.01 || q.x > w / 2 + 0.01 || q.y < -h / 2 - 0.01 || q.y > h / 2 + 0.01) return false;
    for (let i = 0; i < paths.length; i++) if (i !== skip && !mctx.isPointInPath(paths[i], q.x, q.y)) return false;
    return true;
  };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
  const take = q => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); n++; };
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    for (const q of [{ x: -w / 2 + w * t, y: -h / 2 }, { x: -w / 2 + w * t, y: h / 2 }, { x: -w / 2, y: -h / 2 + h * t }, { x: w / 2, y: -h / 2 + h * t }]) if (inside(q, -1)) take(q);
  }
  polys.forEach((poly, pi) => {
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length], cs = clipSeg(a, b, -w / 2, -h / 2, w / 2, h / 2);
      if (!cs) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y) * (cs[1] - cs[0]), m = clamp(Math.ceil(len / 2), 1, 2000);
      for (let j = 0; j <= m; j++) { const t = cs[0] + (cs[1] - cs[0]) * j / m, q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; if (inside(q, pi)) take(q); }
    }
  });
  if (n < 3 || x1 - x0 < 6 || y1 - y0 < 6) return null;
  return { x0, y0, x1, y1 };
}
function splitPanel(el, cut, gap) {
  const toL = p => toLocal(el, p);
  const A = toL(cut.a), B = toL(cut.b), C = cut.c ? toL(cut.c) : null;
  const L = 6 * Math.hypot(el.w, el.h) + 400, BIG = L * 3;
  const base = cutPolyline(A, B, C, L);
  const f = base[0], l = base[base.length - 1], cl = Math.hypot(l.x - f.x, l.y - f.y) || 1;
  const n = { x: -(l.y - f.y) / cl, y: (l.x - f.x) / cl };
  const oldPolys = (el.clips || []).map(poly => poly.map(([u, v]) => ({ x: (u - 0.5) * el.w, y: (v - 0.5) * el.h })));
  const pieces = [];
  for (const s of [1, -1]) {
    const sn = { x: n.x * s, y: n.y * s };
    const off = offsetPoly(base, gap / 2, sn);
    const reg = [...off, { x: off[off.length - 1].x + sn.x * BIG, y: off[off.length - 1].y + sn.y * BIG }, { x: off[0].x + sn.x * BIG, y: off[0].y + sn.y * BIG }];
    const polys = [...oldPolys, reg], bb = regionBox(el.w, el.h, polys);
    if (!bb) return null;
    pieces.push({ polys, bb });
  }
  return pieces.map(({ polys, bb }) => {
    const pc = clone(el); pc.id = uid();
    const nw = bb.x1 - bb.x0, nh = bb.y1 - bb.y0, lc = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
    pc.clips = polys.map(poly => poly.map(q => [r2((q.x - bb.x0) / nw * 1e4) / 1e4, r2((q.y - bb.y0) / nh * 1e4) / 1e4]));
    const wc = toWorld(el, lc);
    pc.w = nw; pc.h = nh; pc.x = wc.x - nw / 2; pc.y = wc.y - nh / 2;
    reframe(pc, el, lc);
    return pc;
  });
}
function doSplit(cut) {
  const pg = page(), gap = Math.max(0, doc.defaults.panel.gutter ?? 16);
  const targets = new Set(selEls().filter(e => e.type === 'panel').map(e => e.id));
  const out = [], made = []; let n = 0;
  for (const el of pg.els) {
    if (el.type === 'panel' && (!targets.size || targets.has(el.id))) {
      const ps = splitPanel(el, cut, gap);
      if (ps) { out.push(...ps); made.push(...ps.map(p => p.id)); n++; continue; }
    }
    out.push(el);
  }
  if (!n) { toast(targets.size ? '고른 컷을 가로지르게 선을 그어 주세요' : '컷을 가로지르게 선을 그어 주세요'); return; }
  pg.els = out; sel = []; commit(); renderProps(); requestRender();
  toast(`컷 ${n}개를 나눴어요. 계속 그어서 더 자를 수 있어요.`, 2200);
}

/* ================= 그리기 ================= */
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function cloudPath(ctx, el) {
  const a = el.w / 2, b = el.h / 2, rnd = seeded(el.id + 'c');
  const n = clamp(Math.round((el.w + el.h) / 52), 8, 18), ts = [];
  for (let i = 0; i < n; i++) ts.push((i + (rnd() - 0.5) * 0.35) / n * Math.PI * 2);
  const pt = (t, k) => ({ x: Math.cos(t) * a * k, y: Math.sin(t) * b * k });
  const p0 = pt(ts[0], 0.9); ctx.moveTo(p0.x, p0.y);
  for (let i = 0; i < n; i++) {
    const t0 = ts[i], t1 = i === n - 1 ? ts[0] + Math.PI * 2 : ts[i + 1];
    const c = pt((t0 + t1) / 2, 1.3 + rnd() * 0.08), p1 = pt(t1, 0.9);
    ctx.quadraticCurveTo(c.x, c.y, p1.x, p1.y);
  }
  ctx.closePath();
}
function spikePath(ctx, el) {
  const a = el.w / 2, b = el.h / 2, rnd = seeded(el.id + 's');
  const n = clamp(Math.round((el.w + el.h) / 34), 12, 30), L = Math.min(el.w, el.h);
  for (let i = 0; i < n * 2; i++) {
    const t = (i + (rnd() - 0.5) * 0.4) / (n * 2) * Math.PI * 2;
    const ex = Math.cos(t) * a, ey = Math.sin(t) * b, len = Math.hypot(ex, ey) || 1;
    const push = i % 2 === 0 ? L * (0.14 + rnd() * 0.14) : -L * 0.04;
    const x = ex + ex / len * push, y = ey + ey / len * push;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
}
function bodyPath(ctx, el) {
  const w = el.w, h = el.h; ctx.beginPath();
  switch (el.shape) {
    case 'box': roundRectPath(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.28); break;
    case 'rect': ctx.rect(-w / 2, -h / 2, w, h); break;
    case 'thought': cloudPath(ctx, el); break;
    case 'shout': spikePath(ctx, el); break;
    default: ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  }
}
function tailPath(ctx, el) {
  const t = tailLocal(el), L = Math.hypot(t.x, t.y); if (L < 1) return false;
  const ux = t.x / L, uy = t.y / L, R = ellipseR(el.w / 2, el.h / 2, ux, uy);
  if (L <= R * 0.98) return false;
  const bd = R * 0.5, hw = el.tw / 2, px = -uy, py = ux, bx = ux * bd, by = uy * bd;
  const b1 = { x: bx + px * hw, y: by + py * hw }, b2 = { x: bx - px * hw, y: by - py * hw };
  const bend = (L - bd) * 0.1;
  ctx.beginPath(); ctx.moveTo(b1.x, b1.y);
  ctx.quadraticCurveTo((b1.x + t.x) / 2 + px * bend, (b1.y + t.y) / 2 + py * bend, t.x, t.y);
  ctx.quadraticCurveTo((b2.x + t.x) / 2 + px * bend, (b2.y + t.y) / 2 + py * bend, b2.x, b2.y);
  ctx.closePath(); return true;
}
function thoughtCircles(el) {
  const t = tailLocal(el), L = Math.hypot(t.x, t.y); if (L < 1) return [];
  const ux = t.x / L, uy = t.y / L, R = ellipseR(el.w / 2, el.h / 2, ux, uy) * 1.12;
  if (L <= R) return [];
  const rs = [el.tw * 0.42, el.tw * 0.3, el.tw * 0.19], out = [];
  const start = R + rs[0] * 0.6, end = L - rs[2];
  [0, 0.55, 1].forEach((k, i) => { const d = start + (end - start) * k; out.push({ x: ux * d, y: uy * d, r: rs[i] }); });
  return out;
}
function drawBubble(ctx, el) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.fillStyle = el.fill; ctx.strokeStyle = el.stroke;
  const sw = el.sw, dash = el.dash ? [Math.max(5, sw * 3.2), Math.max(5, sw * 2.6)] : [];
  if (el.shape === 'thought') {
    const cs = el.tail ? thoughtCircles(el) : [];
    if (sw > 0) {
      ctx.lineWidth = sw * 2; ctx.setLineDash(dash); bodyPath(ctx, el); ctx.stroke();
      for (const c of cs) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.setLineDash([]); bodyPath(ctx, el); ctx.fill();
    for (const c of cs) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); }
  } else {
    if (sw > 0) {
      ctx.lineWidth = sw * 2; ctx.setLineDash(dash); bodyPath(ctx, el); ctx.stroke();
      if (el.tail && tailPath(ctx, el)) ctx.stroke();
    }
    ctx.setLineDash([]); bodyPath(ctx, el); ctx.fill();
    if (el.tail && tailPath(ctx, el)) ctx.fill();
  }
  ctx.font = fontStr(el); ctx.fillStyle = el.color; ctx.textBaseline = 'middle';
  const lines = el.auto ? textLines(el) : wrapLines(ctx, el.text ?? '', Math.max(10, innerTextW(el)));
  const lh = el.fs * el.lh, total = lines.length * lh;
  let bw = 0; for (const l of lines) bw = Math.max(bw, ctx.measureText(l).width);
  const al = el.align || 'center'; ctx.textAlign = al;
  const x = al === 'left' ? -bw / 2 : al === 'right' ? bw / 2 : 0;
  if (el.tsw > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = el.tsw * 2; ctx.strokeStyle = el.tsc || '#ffffff'; lines.forEach((l, i) => ctx.strokeText(l, x, -total / 2 + lh * (i + 0.5) + el.fs * 0.04)); }
  lines.forEach((l, i) => ctx.fillText(l, x, -total / 2 + lh * (i + 0.5) + el.fs * 0.04));
}

/* ---- 효과음 글자 ---- */
function glyphPass(g, el, L, ox, oy, fn) {
  for (const gl of L.glyphs) {
    g.save(); g.translate(gl.x + ox, gl.y + oy); g.rotate(gl.rot); g.scale(gl.sc, gl.sc); fn(gl); g.restore();
  }
}
function paintText(g, el, L) {
  g.save(); g.translate(L.ox, L.oy);
  const fs = el.fs, sw = el.sw || 0, sw2 = el.sw2 || 0, yo = fs * 0.04;
  if (el.boxOn && L.gb) { // 배경 띠 (자막처럼)
    const bp = (el.boxPad ?? 30) / 100 * fs, br = (el.boxR ?? 25) / 100 * fs, b = L.gb;
    g.save(); g.fillStyle = rgba(el.boxColor || '#000000', (el.boxA ?? 65) / 100); g.beginPath();
    roundRectPath(g, b.x0 - bp, b.y0 - bp, b.x1 - b.x0 + bp * 2, b.y1 - b.y0 + bp * 2, br); g.fill(); g.restore();
  }
  if (L.tk) g.transform(1, 0, -L.tk, 1, 0, 0);
  g.font = fontStr(el); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.miterLimit = 2;
  const depth = Math.hypot(L.ex, L.ey), steps = depth > 0 ? clamp(Math.ceil(depth / 1.2), 1, 80) : 0;
  const offs = []; for (let k = steps; k >= 0; k--) offs.push([L.ex * k / (steps || 1), L.ey * k / (steps || 1)]);
  const stroke = (w, col, list) => { if (w <= 0) return; g.strokeStyle = col; for (const [ox, oy] of list) glyphPass(g, el, L, ox, oy, gl => { g.lineWidth = w / gl.sc; g.strokeText(gl.ch, 0, yo); }); };
  // 글자 전체 모양(가장 바깥 테두리까지)을 한 색으로: 그림자와 후광에 써요
  const silhouette = col => { const ow = sw2 > 0 ? (sw + sw2) * 2 : sw * 2; stroke(ow, col, offs); g.fillStyle = col; for (const [ox, oy] of offs) glyphPass(g, el, L, ox, oy, gl => g.fillText(gl.ch, 0, yo)); };
  const m = g.getTransform(), gs = Math.hypot(m.a, m.b) || 1, FAR = ((g.canvas.width + g.canvas.height) * 2 + 2000) / gs; // 화면 밖 (그림자만 보이게)
  const shade = (col, blur, dx, dy, alpha) => { // 글자는 멀리 그리고 그림자만 제자리에 남겨요
    g.save(); g.globalAlpha *= alpha; g.shadowColor = col; g.shadowBlur = blur * gs;
    g.shadowOffsetX = -m.a * FAR + (m.a * dx + m.c * dy); g.shadowOffsetY = -m.b * FAR + (m.b * dx + m.d * dy);
    g.translate(FAR, 0); silhouette('#000'); g.restore();
  };
  if ((el.shA || 0) > 0) { const d = (el.shDist ?? 6) / 100 * fs, a = (el.shAng ?? 50) * DEG; shade(rgba(el.shColor || '#000000', el.shA / 100), (el.shBlur ?? 12) / 100 * fs, Math.cos(a) * d, Math.sin(a) * d, 1); }
  if ((el.glow || 0) > 0) { const A = clamp((el.glowA ?? 80) / 100, 0, 1), n = A > 0.85 ? 3 : A > 0.55 ? 2 : 1; for (let i = 0; i < n; i++) shade(el.glowColor || '#ffe25c', el.glow / 100 * fs * (0.5 + i * 0.35), 0, 0, Math.min(1, A * 1.15)); }
  if (sw2 > 0) stroke((sw + sw2) * 2, el.sc2, offs);
  if (steps) {
    stroke(sw * 2, el.sc, offs);
    g.fillStyle = el.extColor; for (const [ox, oy] of offs.slice(0, -1)) glyphPass(g, el, L, ox, oy, gl => g.fillText(gl.ch, 0, yo));
  }
  stroke(sw * 2, el.sc, [[0, 0]]);
  const gb = L.gb || { x0: -fs, x1: fs };
  glyphPass(g, el, L, 0, 0, gl => {
    if (el.fillGrad) {
      const gr = el.gradDir === 'h' ? g.createLinearGradient((gb.x0 - gl.x) / gl.sc, 0, (gb.x1 - gl.x) / gl.sc, 0) : g.createLinearGradient(0, -fs * 0.5, 0, fs * 0.5);
      gr.addColorStop(0, el.color); gr.addColorStop(1, el.fill2 || el.color); g.fillStyle = gr;
    } else g.fillStyle = el.color;
    g.fillText(gl.ch, 0, yo);
  });
  g.restore();
}
function noise1(rnd, fs) {
  const ph = [rnd() * 9, rnd() * 9, rnd() * 9, rnd() * 9], f = [1 / (fs * 0.9), 1 / (fs * 0.33), 1 / (fs * 0.12), 1 / (fs * 0.05)];
  return t => Math.sin(t * f[0] * 6.28 + ph[0]) * 0.55 + Math.sin(t * f[1] * 6.28 + ph[1]) * 0.3 + Math.sin(t * f[2] * 6.28 + ph[2]) * 0.18 + Math.sin(t * f[3] * 6.28 + ph[3]) * 0.08;
}
function roughText(el, L, s) {
  const key = ['rt', el.id, ...TEXT_LOOK.map(k => el[k]), s].join('|');
  return cacheGet(key, () => {
    const W = Math.ceil(L.w * s), H = Math.ceil(L.h * s);
    const a = newCanvas(W, H), ga = a.getContext('2d');
    ga.setTransform(s, 0, 0, s, W / 2, H / 2); paintText(ga, el, L);
    const amp = el.rough / 100 * el.fs * 0.05 * s, rnd = seeded(el.id + 'r' + (el.seed || 1));
    const nx = noise1(rnd, el.fs), ny = noise1(rnd, el.fs);
    const b = newCanvas(W, H), gb = b.getContext('2d'), st = Math.max(1, Math.round(s));
    for (let y = 0; y < H; y += st) gb.drawImage(a, 0, y, W, st, nx(y / s) * amp, y, W, st);
    const c = newCanvas(W, H), gc = c.getContext('2d');
    for (let x = 0; x < W; x += st) gc.drawImage(b, x, 0, st, H, x, ny(x / s) * amp, st, H);
    if (el.rough > 30) { // 마른 붓 느낌의 거친 알갱이
      gc.globalCompositeOperation = 'destination-out'; gc.fillStyle = '#000';
      const cnt = Math.round(W * H / (s * s) / (el.fs * el.fs) * 260 * (el.rough - 30) / 70);
      gc.beginPath();
      for (let i = 0; i < cnt; i++) { const x = rnd() * W, y = rnd() * H, r = (0.4 + rnd() * 1.1) * s * el.fs / 90; gc.moveTo(x + r, y); gc.arc(x, y, r, 0, 6.283); }
      gc.fill();
    }
    return c;
  });
}
function qScale(rs) { return Math.pow(2, Math.round(Math.log2(Math.max(0.05, rs)) * 2) / 2); }
function drawTextEl(ctx, el, opt) {
  const L = textLayout(el);
  if ((el.op ?? 100) < 100) ctx.globalAlpha *= el.op / 100;
  if (!(el.rough > 0)) { paintText(ctx, el, L); return; }
  const lim = opt.screen ? 2600 : 9000, s = Math.min(qScale(opt.rs || 1), lim / L.w, lim / L.h);
  const c = roughText(el, L, s);
  ctx.drawImage(c, -L.w / 2, -L.h / 2, L.w, L.h);
}

/* ---- 효과음 그림 (스탬프) ---- */
function stampLayer(el, im, s) {
  const key = ['st', el.img, Math.round(el.w), Math.round(el.h), s, el.tintOn ? el.tint : '', el.ow, el.oc].join('|');
  return cacheGet(key, () => {
    const W = Math.max(1, Math.round(el.w * s)), H = Math.max(1, Math.round(el.h * s)), P = Math.ceil((el.ow || 0) * s);
    const tinted = (col) => { const t = newCanvas(W, H), g = t.getContext('2d'); g.drawImage(im, 0, 0, W, H); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, W, H); return t; };
    const c = newCanvas(W + P * 2, H + P * 2), g = c.getContext('2d');
    if (P > 0) {
      const sil = tinted(el.oc);
      for (const k of [1, 0.66, 0.33]) for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; g.drawImage(sil, P + Math.cos(a) * P * k, P + Math.sin(a) * P * k); }
    }
    if (el.tintOn) g.drawImage(tinted(el.tint), P, P); else g.drawImage(im, P, P, W, H);
    return c;
  });
}
function drawStamp(ctx, el, opt) {
  const rec = imgRec(el), im = rec && imgCache.get(el.img), ready = im && im.complete && im.naturalWidth;
  const w = el.w, h = el.h;
  if (!ready) { if (opt.screen) { ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 1 / zoom; ctx.strokeStyle = '#cf3d33'; ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]); } return; }
  ctx.globalAlpha *= (el.op ?? 100) / 100;
  if (el.flip) ctx.scale(-1, 1);
  if (!el.tintOn && !(el.ow > 0)) { const { src } = imgSource(el.img, im, rec, w, ctx, null); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, -w / 2, -h / 2, w, h); return; }
  const lim = opt.screen ? 2600 : 9000, s = Math.min(qScale(opt.rs || 1), lim / w, lim / h);
  const c = stampLayer(el, im, s), o = el.ow || 0;
  ctx.drawImage(c, -w / 2 - o, -h / 2 - o, w + o * 2, h + o * 2);
}

/* ---- 손그림 (펜) ---- */
function strokePass(g, strokes, col, extra) {
  g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const st of strokes) {
    if (st.length === 1) { g.beginPath(); g.arc(st[0][0], st[0][1], st[0][2] / 2 + extra, 0, Math.PI * 2); g.fill(); continue; }
    for (let i = 1; i < st.length; i++) {
      g.beginPath(); g.moveTo(st[i - 1][0], st[i - 1][1]); g.lineTo(st[i][0], st[i][1]);
      g.lineWidth = (st[i - 1][2] + st[i][2]) / 2 + extra * 2; g.stroke();
    }
  }
}
function drawStrokes(g, strokes, color, ow, oc) {
  if (ow > 0) strokePass(g, strokes, oc, ow);
  strokePass(g, strokes, color, 0);
}
function drawDrawEl(ctx, el) {
  const k = Math.sqrt(el.w * el.h) / (el.s0 || 1);
  const strokes = el.strokes.map(st => st.map(([u, v, w]) => [(u - 0.5) * el.w, (v - 0.5) * el.h, w * k]));
  ctx.globalAlpha *= (el.op ?? 100) / 100;
  drawStrokes(ctx, strokes, el.color, el.ow || 0, el.oc);
}

/* ---- 가리기 (블러, 모자이크, 흰칠) ---- */
const isErase = st => !!(st && st[0] && st[0][3]); // 첫 점의 네 번째 값이 1이면 지우개 획
const hasErase = el => (el.strokes || []).some(isErase);
function fxShapes(g, el, k, color, grow = 0) { // grow: 칠한 모양을 사방으로 이만큼 넓혀서 (부드럽게 할 때)
  g.fillStyle = color;
  if (el.mask) fxMaskDraw(g, el, color);
  for (const [u, v, rx, ry] of el.shapes || []) { g.beginPath(); g.ellipse((u - 0.5) * el.w, (v - 0.5) * el.h, Math.max(0.5, rx * el.w + grow), Math.max(0.5, ry * el.h + grow), 0, 0, Math.PI * 2); g.fill(); }
  // 윤곽을 딴 모양 (pad: 윤곽 바깥으로 더 칠할 폭)
  const ex = (el.pad || 0) + grow;
  for (const pl of el.polys || []) {
    g.beginPath(); pl.forEach(([u, v], i) => i ? g.lineTo((u - 0.5) * el.w, (v - 0.5) * el.h) : g.moveTo((u - 0.5) * el.w, (v - 0.5) * el.h)); g.closePath(); g.fill();
    if (ex > 0) { g.lineWidth = ex * 2; g.lineJoin = 'round'; g.strokeStyle = color; g.stroke(); }
  }
  for (const st0 of el.strokes || []) {
    const st = st0.map(([u, v, w]) => [(u - 0.5) * el.w, (v - 0.5) * el.h, w * k]);
    if (isErase(st0)) { g.save(); g.globalCompositeOperation = 'destination-out'; strokePass(g, [st], '#000', 0); g.restore(); }
    else strokePass(g, [st], color, grow);
  }
}
// 부드러운 흰칠: 칠한 모양을 조금 넓힌 뒤 흐려서, 칠한 곳 안쪽은 끝까지 하얗고 바깥쪽만 에어브러쉬처럼 번지게
function drawSoftPaint(ctx, el, k) {
  const m = ctx.getTransform(), sc = Math.hypot(m.a, m.b), cw = ctx.canvas.width, ch = ctx.canvas.height;
  const sig = el.soft * sc, grow = el.soft * 1.5, halo = (grow + el.soft * 3) * sc;
  const pts = [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const mg = sig * 3; // 화면 밖도 조금 더 그려야 가장자리(내보낼 때 나눈 경계 포함)에서 흐려지지 않아요
  const x0 = Math.floor(Math.max(-mg, Math.min(...pts.map(p => p[0])) - halo)), x1 = Math.ceil(Math.min(cw + mg, Math.max(...pts.map(p => p[0])) + halo));
  const y0 = Math.floor(Math.max(-mg, Math.min(...pts.map(p => p[1])) - halo)), y1 = Math.ceil(Math.min(ch + mg, Math.max(...pts.map(p => p[1])) + halo));
  if (x1 - x0 < 1 || y1 - y0 < 1) return;
  const q = clamp(sig / 3, 1, 8), W = Math.max(1, Math.ceil((x1 - x0) / q)), H = Math.max(1, Math.ceil((y1 - y0) / q)); // 흐릴 거라 작게 그려도 똑같아 보여요
  const mk = newCanvas(W, H), gm = mk.getContext('2d');
  gm.setTransform(m.a / q, m.b / q, m.c / q, m.d / q, (m.e - x0) / q, (m.f - y0) / q);
  fxShapes(gm, el, k, '#ffffff', grow);
  const out = newCanvas(W, H), go = out.getContext('2d');
  go.filter = `blur(${(sig / q).toFixed(2)}px)`; go.drawImage(mk, 0, 0); go.filter = 'none';
  go.globalCompositeOperation = 'source-in'; go.fillStyle = el.color || '#ffffff'; go.fillRect(0, 0, W, H);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(out, x0, y0, W * q, H * q); ctx.restore();
}
function drawFxEl(ctx, el, opt) {
  const k = Math.sqrt(el.w * el.h) / (el.s0 || 1);
  if (el.kind === 'erase' || el.kind === 'clone' || el.kind === 'heal') { drawFixEl(ctx, el, k, opt); return; }
  if (el.kind === 'paint') { if (el.soft > 0 || hasErase(el)) drawSoftPaint(ctx, el, k); else fxShapes(ctx, el, k, el.color || '#ffffff'); return; }
  const m = ctx.getTransform(), cw = ctx.canvas.width, ch = ctx.canvas.height;
  const pts = [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const str = Math.max(1, (el.str || 10) * Math.hypot(m.a, m.b)), src = ctx.canvas, fp = el.kind === 'blur' ? Math.ceil(str * 0.7) + 2 : 1; // 가장자리 번짐 여유
  const x0 = clamp(Math.floor(Math.min(...pts.map(p => p[0]))) - fp, 0, cw), x1 = clamp(Math.ceil(Math.max(...pts.map(p => p[0]))) + fp, 0, cw);
  const y0 = clamp(Math.floor(Math.min(...pts.map(p => p[1]))) - fp, 0, ch), y1 = clamp(Math.ceil(Math.max(...pts.map(p => p[1]))) + fp, 0, ch);
  const W = x1 - x0, H = y1 - y0; if (W < 1 || H < 1) return;
  // 블러는 줄인 크기에서 처리해요 (세게 흐릴수록 더 작게: 보기엔 같고 훨씬 빨라요)
  const q = el.kind === 'blur' ? clamp(str / 4, 1, 6) : 1, Wq = Math.max(1, Math.ceil(W / q)), Hq = Math.max(1, Math.ceil(H / q));
  const out = newCanvas(Wq, Hq), go = out.getContext('2d');
  if (el.kind === 'mosaic') {
    const b = Math.max(2, str), sw = Math.max(1, Math.ceil(W / b)), sh = Math.max(1, Math.ceil(H / b)), sm = newCanvas(sw, sh), gsm = sm.getContext('2d');
    gsm.imageSmoothingQuality = 'medium'; gsm.drawImage(src, x0, y0, W, H, 0, 0, W / b, H / b);
    go.imageSmoothingEnabled = false; go.drawImage(sm, 0, 0, sw, sh, 0, 0, sw * b, sh * b);
  } else {
    const P = Math.ceil(str * 2.2), sx0 = Math.max(0, x0 - P), sy0 = Math.max(0, y0 - P), sx1 = Math.min(cw, x1 + P), sy1 = Math.min(ch, y1 + P);
    go.imageSmoothingQuality = 'medium'; go.filter = `blur(${(str / q).toFixed(2)}px)`;
    go.drawImage(src, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - x0) / q, (sy0 - y0) / q, (sx1 - sx0) / q, (sy1 - sy0) / q); go.filter = 'none';
  }
  const mk = newCanvas(Wq, Hq), gm = mk.getContext('2d');
  gm.setTransform(m.a / q, m.b / q, m.c / q, m.d / q, (m.e - x0) / q, (m.f - y0) / q);
  fxShapes(gm, el, k, '#ffffff');
  go.globalCompositeOperation = 'destination-in'; if (el.kind === 'blur') go.filter = `blur(${Math.max(0.6, str * 0.3 / q).toFixed(2)}px)`; // 가장자리 부드럽게 (한 번에)
  go.drawImage(mk, 0, 0); go.filter = 'none';
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(out, 0, 0, W / q, H / q, x0, y0, W, H); ctx.restore();
}

/* ---- 컷 효과 ---- */
function layerScale(el, opt) {
  const lim = opt.screen ? 3000 : 8000;
  return Math.min(qScale(opt.rs || 1), lim / Math.max(1, el.w), lim / Math.max(1, el.h));
}
function toneLayer(el, s) {
  const k = ['tone', el.id, el.seed || 1, Math.round(el.w), Math.round(el.h), s, fx(el, 'toneType'), fx(el, 'toneGap'), fx(el, 'toneSize'), fx(el, 'toneAngle'), fx(el, 'toneColor'), fx(el, 'toneFade')].join('|');
  return cacheGet(k, () => {
    const W = Math.max(1, Math.round(el.w * s)), H = Math.max(1, Math.round(el.h * s));
    const c = newCanvas(W, H), g = c.getContext('2d');
    const type = fx(el, 'toneType'), G = Math.max(2.5, fx(el, 'toneGap')) * s, size = fx(el, 'toneSize') / 100, ang = fx(el, 'toneAngle') * DEG, fade = fx(el, 'toneFade');
    g.fillStyle = fx(el, 'toneColor');
    const fadeF = (x, y) => {
      const u = x / W, v = y / H;
      switch (fade) {
        case 'top': return smooth(v * 1.15); case 'bottom': return smooth((1 - v) * 1.15);
        case 'left': return smooth(u * 1.15); case 'right': return smooth((1 - u) * 1.15);
        case 'center': return smooth(Math.hypot(u - 0.5, v - 0.5) * 1.6); case 'edge': return smooth(1 - Math.hypot(u - 0.5, v - 0.5) * 1.5);
        default: return 1;
      }
    };
    const D = Math.hypot(W, H), n = Math.ceil(D / 2 / G) + 2, cx = W / 2, cy = H / 2;
    g.beginPath();
    if (type === 'dot') {
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const p = rot(i * G, j * G, ang), x = cx + p.x, y = cy + p.y;
        if (x < -G || y < -G || x > W + G || y > H + G) continue;
        const r = G * 0.62 * size * fadeF(x, y); if (r < 0.2) continue;
        g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
      }
    } else if (type === 'line' || type === 'cross') {
      for (const a of type === 'cross' ? [ang, ang + Math.PI / 2] : [ang]) {
        const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux, step = Math.max(2, G / 2);
        for (let j = -n; j <= n; j++) {
          const bx = cx + px * j * G, by = cy + py * j * G, top = [], bot = [];
          for (let t = -D / 2; t <= D / 2 + step; t += step) {
            const x = bx + ux * t, y = by + uy * t, th = G * size * 0.9 * fadeF(clamp(x, 0, W), clamp(y, 0, H)) / 2;
            top.push([x + px * th, y + py * th]); bot.push([x - px * th, y - py * th]);
          }
          g.moveTo(top[0][0], top[0][1]); for (const q of top) g.lineTo(q[0], q[1]);
          for (let q = bot.length - 1; q >= 0; q--) g.lineTo(bot[q][0], bot[q][1]); g.closePath();
        }
      }
    } else { // 모래
      const rnd = seeded(el.id + 'sand' + (el.seed || 1)), cnt = Math.min(400000, Math.round(W * H / (G * G) * 2.2));
      for (let i = 0; i < cnt; i++) {
        const x = rnd() * W, y = rnd() * H; if (rnd() > fadeF(x, y)) continue;
        const r = G * (0.12 + size * 0.22) * (0.6 + rnd() * 0.8); g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    g.fill();
    return c;
  });
}
function lineLayer(el, s) {
  const k = ['line', el.id, el.seed || 1, Math.round(el.w), Math.round(el.h), s, fx(el, 'lineType'), fx(el, 'lineN'), fx(el, 'lineIn'), fx(el, 'lineW'), fx(el, 'lineCx'), fx(el, 'lineCy'), fx(el, 'lineAng'), fx(el, 'lineColor')].join('|');
  return cacheGet(k, () => {
    const W = Math.max(1, Math.round(el.w * s)), H = Math.max(1, Math.round(el.h * s));
    const c = newCanvas(W, H), g = c.getContext('2d'); g.fillStyle = fx(el, 'lineColor');
    const N = clamp(fx(el, 'lineN') | 0, 4, 600), inner = fx(el, 'lineIn') / 100, lw = fx(el, 'lineW') * s, rnd = seeded(el.id + 'ln' + (el.seed || 1));
    g.beginPath();
    if (fx(el, 'lineType') === 'focus') {
      const cx = W * fx(el, 'lineCx') / 100, cy = H * fx(el, 'lineCy') / 100;
      const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.05, rin = R * inner;
      for (let i = 0; i < N; i++) {
        const t = (i + rnd() * 0.9) / N * Math.PI * 2, ux = Math.cos(t), uy = Math.sin(t), px = -uy, py = ux;
        const r0 = rin * (0.78 + rnd() * 0.5), wo = lw * (0.35 + rnd() * 1.3);
        g.moveTo(cx + ux * r0, cy + uy * r0); g.lineTo(cx + ux * R + px * wo, cy + uy * R + py * wo); g.lineTo(cx + ux * R - px * wo, cy + uy * R - py * wo); g.closePath();
      }
    } else {
      const a = fx(el, 'lineAng') * DEG, ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux, D = Math.hypot(W, H), cx = W / 2, cy = H / 2;
      for (let i = 0; i < N; i++) {
        let off = (rnd() - 0.5) * D; const band = inner * D * 0.25;
        if (Math.abs(off) < band) off = Math.sign(off || 1) * (band + rnd() * (D / 2 - band) * 0.3);
        const len = D * (0.2 + rnd() * 0.55), t0 = (rnd() - 0.5) * D * 0.7, wd = lw * (0.3 + rnd() * 1.1);
        const mx = cx + ux * t0 + px * off, my = cy + uy * t0 + py * off;
        const ax = mx - ux * len / 2, ay = my - uy * len / 2, bx = mx + ux * len / 2, by = my + uy * len / 2;
        g.moveTo(ax, ay); g.quadraticCurveTo(mx + px * wd, my + py * wd, bx, by); g.quadraticCurveTo(mx - px * wd, my - py * wd, ax, ay); g.closePath();
      }
    }
    g.fill();
    return c;
  });
}
const GRAD_DIRS = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0], tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1] };
function drawPanelFx(ctx, el, opt) {
  const w = el.w, h = el.h;
  if (fx(el, 'tintOn')) {
    ctx.save(); ctx.globalCompositeOperation = fx(el, 'tintMode'); ctx.fillStyle = rgba(fx(el, 'tintColor'), fx(el, 'tintA') / 100); ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  }
  if (fx(el, 'gradOn')) {
    const [dx, dy] = GRAD_DIRS[fx(el, 'gradDir')] || GRAD_DIRS.bottom, sx = dx * w / 2, sy = dy * h / 2;
    const span = (dx && dy ? Math.hypot(w, h) : dx ? w : h) * fx(el, 'gradLen') / 100, l = Math.hypot(dx, dy);
    const gr = ctx.createLinearGradient(sx, sy, sx - dx / l * span, sy - dy / l * span), col = fx(el, 'gradColor'), A = fx(el, 'gradA') / 100;
    gr.addColorStop(0, rgba(col, A)); gr.addColorStop(1, rgba(col, 0));
    ctx.save(); ctx.globalCompositeOperation = fx(el, 'gradMode'); ctx.fillStyle = gr; ctx.fillRect(-w / 2, -h / 2, w, h); ctx.restore();
  }
  if (fx(el, 'vigOn')) {
    ctx.save(); ctx.scale(w / 2, h / 2);
    const ri = fx(el, 'vigSize') / 100, gr = ctx.createRadialGradient(0, 0, ri * 0.7, 0, 0, ri * 0.7 + 0.85), col = fx(el, 'vigColor');
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(1, rgba(col, fx(el, 'vigA') / 100));
    ctx.fillStyle = gr; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  if (fx(el, 'toneOn')) {
    const s = layerScale(el, opt), c = toneLayer(el, s);
    ctx.save(); ctx.globalAlpha *= fx(el, 'toneA') / 100; ctx.drawImage(c, -w / 2, -h / 2, w, h); ctx.restore();
  }
  if (fx(el, 'lineOn')) {
    const s = layerScale(el, opt), c = lineLayer(el, s);
    ctx.save(); ctx.globalAlpha *= fx(el, 'lineA') / 100; ctx.drawImage(c, -w / 2, -h / 2, w, h); ctx.restore();
  }
}
const hasFx = el => fx(el, 'tintOn') || fx(el, 'gradOn') || fx(el, 'vigOn') || fx(el, 'toneOn') || fx(el, 'lineOn');
// 그림 캐시: 작게 그릴 때 쓸 축소본, 보정(밝기·흐림 등)을 미리 입힌 그림
const bmpCache = new Map(); let bmpBytes = 0; const BMP_BUDGET = 380e6;
function bmpGet(key, make) {
  const hit = bmpCache.get(key);
  if (hit) { bmpCache.delete(key); bmpCache.set(key, hit); return hit.c; }
  const c = make(), bytes = c.width * c.height * 4; bmpCache.set(key, { c, bytes }); bmpBytes += bytes;
  while (bmpBytes > BMP_BUDGET && bmpCache.size > 1) { const k = bmpCache.keys().next().value; bmpBytes -= bmpCache.get(k).bytes; bmpCache.delete(k); }
  return c;
}
function clearImgCaches(id) {
  layerCache.clear(); if (typeof advDrop === 'function') advDrop(id);
  if (!id) { bmpCache.clear(); bmpBytes = 0; return; }
  for (const k of [...bmpCache.keys()]) if (k.startsWith(id + '|')) { bmpBytes -= bmpCache.get(k).bytes; bmpCache.delete(k); }
}
function colorFilter(L) {
  const p = [], b = fx(L, 'bright'), c = fx(L, 'contrast'), s = fx(L, 'saturate'), sp = fx(L, 'sepia'), hu = fx(L, 'hue');
  if (b !== 100) p.push(`brightness(${b / 100})`);
  if (c !== 100) p.push(`contrast(${c / 100})`);
  if (s !== 100) p.push(`saturate(${s / 100})`);
  if (fx(L, 'gray')) p.push('grayscale(1)');
  if (sp) p.push(`sepia(${sp / 100})`);
  if (hu) p.push(`hue-rotate(${hu}deg)`);
  return p.join(' ');
}
// 이 크기로 그릴 때 쓸 그림 (필요하면 축소·보정한 캐시) → { src, pad }
function imgSource(id, im, rec, dw, ctx, L) {
  const m = ctx.getTransform(), need = dw * Math.hypot(m.a, m.b);
  let lv = 1; while (rec.w / (lv * 2) >= need * 1.2 && lv < 64) lv *= 2;
  const cf = L ? colorFilter(L) : '', W = Math.max(1, Math.round(rec.w / lv)), H = Math.max(1, Math.round(rec.h / lv));
  const bl = L ? Math.round(fx(L, 'blur') * W / dw * 2) / 2 : 0, ak = L ? advKey(L) : '';
  if (!cf && !bl && !ak && lv === 1) return { src: im, pad: 0 };
  const P = bl > 0 ? Math.ceil(bl * 2.5) : 0;
  const c = bmpGet(`${id}|${lv}|${cf}|${bl}|${ak}`, () => {
    const base = ak ? (advProcess(id, im, W, H, L, lv) || im) : im; // 고급 보정 먼저, 그 위에 기본 보정
    const c = newCanvas(W + P * 2, H + P * 2), g = c.getContext('2d');
    const f = [cf, bl > 0 ? `blur(${bl}px)` : ''].filter(Boolean).join(' ');
    if (f) g.filter = f; g.imageSmoothingQuality = 'high'; g.drawImage(base, P, P, W, H); return c;
  });
  return { src: c, pad: P * dw / W };
}
function imgFilter(el, ctx) {
  const p = [], b = fx(el, 'bright'), c = fx(el, 'contrast'), s = fx(el, 'saturate'), sp = fx(el, 'sepia'), hu = fx(el, 'hue'), bl = fx(el, 'blur');
  if (b !== 100) p.push(`brightness(${b / 100})`);
  if (c !== 100) p.push(`contrast(${c / 100})`);
  if (s !== 100) p.push(`saturate(${s / 100})`);
  if (fx(el, 'gray')) p.push('grayscale(1)');
  if (sp) p.push(`sepia(${sp / 100})`);
  if (hu) p.push(`hue-rotate(${hu}deg)`);
  if (bl > 0) { const m = ctx.getTransform(); p.push(`blur(${(bl * Math.hypot(m.a, m.b)).toFixed(2)}px)`); }
  return p.join(' ');
}
function drawLayer(ctx, el, L, ghost) {
  const rec = images.get(L.img), im = rec && imgCache.get(L.img);
  if (!im || !im.complete || !im.naturalWidth || (L.hidden && !ghost)) return false;
  const s = Math.max(el.w / rec.w, el.h / rec.h) * (L.iz ?? 1), dw = rec.w * s, dh = rec.h * s;
  ctx.save(); ctx.translate(L.ox || 0, L.oy || 0); if (L.lrot) ctx.rotate(L.lrot * DEG); if (L.flip) ctx.scale(-1, 1);
  if (!ghost) {
    if ((L.lop ?? 100) < 100) ctx.globalAlpha *= L.lop / 100;
    if (L.lmode && L.lmode !== 'source-over') ctx.globalCompositeOperation = L.lmode;
  }
  const { src, pad } = imgSource(L.img, im, rec, dw, ctx, ghost ? null : L);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, -dw / 2 - pad, -dh / 2 - pad * dh / dw, dw + pad * 2, dh + pad * 2 * dh / dw); ctx.restore();
  return true;
}
function drawPanel(ctx, el, opt) {
  const w = el.w, h = el.h, r = Math.min(el.radius || 0, w / 2, h / 2);
  const list = layerList(el);
  const ready = list.some(({ o }) => { const im = imgCache.get(o.img); return images.has(o.img) && im && im.complete && im.naturalWidth; });
  if (opt.screen && el.id === imageEditId) { const A = activeObj(el); if (A && A.img) { ctx.save(); ctx.globalAlpha *= 0.32; drawLayer(ctx, el, A, true); ctx.restore(); } }
  ctx.save();
  applyClips(ctx, el);
  ctx.beginPath(); roundRectPath(ctx, -w / 2, -h / 2, w, h, r); ctx.clip();
  if (el.fill) { ctx.fillStyle = el.fill; ctx.fillRect(-w / 2, -h / 2, w, h); }
  for (const { o } of list) drawLayer(ctx, el, o, false);
  if (!ready && opt.screen && !hasFx(el)) {
    const missing = list.length > 0;
    ctx.fillStyle = missing ? 'rgba(207,61,51,.08)' : 'rgba(22,136,224,.07)'; ctx.fillRect(-w / 2, -h / 2, w, h);
    if (w * zoom > 120 && h * zoom > 40) {
      ctx.fillStyle = '#6b7b8c'; ctx.font = `${13 / zoom}px ${fontCss('고딕')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(missing ? '그림을 찾을 수 없어요' : '그림을 여기로 끌어다 놓기', 0, 0);
    }
  }
  drawPanelFx(ctx, el, opt);
  const edges = () => { ctx.beginPath(); roundRectPath(ctx, -w / 2, -h / 2, w, h, r); ctx.stroke(); for (const poly of el.clips || []) { polyPath(ctx, el, poly); ctx.stroke(); } };
  if (el.bw > 0) {
    const soft = aaSoft();
    if (soft > 0) { ctx.restore(); ctx.save(); if (!drawPanelBorderAA(ctx, el, soft)) { applyClips(ctx, el); ctx.beginPath(); roundRectPath(ctx, -w / 2, -h / 2, w, h, r); ctx.clip(); ctx.lineWidth = el.bw * 2; ctx.strokeStyle = el.bc; ctx.lineJoin = 'miter'; ctx.miterLimit = 10; edges(); } }
    else { ctx.lineWidth = el.bw * 2; ctx.strokeStyle = el.bc; ctx.lineJoin = 'miter'; ctx.miterLimit = 10; edges(); }
  }
  else if (opt.screen && !ready) { ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#7d93a8'; edges(); ctx.setLineDash([]); }
  ctx.restore();
}
const aaSoft = () => (doc.defaults.aa && doc.defaults.aa.soft) || 0;
function vecBox(el) { // 요소 안쪽 좌표에서 그림이 차지하는 곳
  if (el.type === 'text') { const L = textLayout(el); return { x: -L.w / 2, y: -L.h / 2, w: L.w, h: L.h }; }
  if (el.type === 'draw') { const m = (el.ow || 0) + 2; return { x: -el.w / 2 - m, y: -el.h / 2 - m, w: el.w + m * 2, h: el.h + m * 2 }; }
  const e = el.shape === 'shout' ? Math.min(el.w, el.h) * 0.3 : el.shape === 'thought' ? Math.max(el.w, el.h) * 0.22 : 0;
  let x0 = -el.w / 2 - e, y0 = -el.h / 2 - e, x1 = el.w / 2 + e, y1 = el.h / 2 + e;
  if (el.tail) { const t = tailLocal(el); x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y); }
  const m = (el.sw || 0) + (el.tsw || 0) + el.fs * 0.2 + 2;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + m * 2, h: y1 - y0 + m * 2 };
}
let fontGen = 0; // 글꼴을 새로 읽으면 매끄럽게 그린 캐시를 버려요
function aaKey(el) {
  const o = {}; for (const k in el) if (k !== 'x' && k !== 'y' && k !== 'rot' && k !== 'tx' && k !== 'ty') o[k] = el[k];
  if (el.type === 'bubble' && el.tail) { const t = tailLocal(el); o._t = [Math.round(t.x * 10), Math.round(t.y * 10)]; }
  return JSON.stringify(o);
}
function drawVecAA(ctx, el, opt, soft) {
  const m = ctx.getTransform(), sc = Math.hypot(m.a, m.b); if (!(sc > 0)) return false;
  const qs = Math.pow(2, Math.round(Math.log2(sc) * 4) / 4), box = vecBox(el), sig = soft / 100 * 0.9; // 흐림 정도 (페이지 px)
  const pad = sig * 3 + 1;
  let SS = opt.screen ? 2 : 3, W, H;
  for (; SS >= 1; SS--) { W = Math.ceil((box.w + pad * 2) * qs * SS); H = Math.ceil((box.h + pad * 2) * qs * SS); if (W * H <= 24e6 && W <= 12000 && H <= 12000) break; }
  if (SS < 1 || W < 1 || H < 1) return false;
  const c = bmpGet(`aa|${fontGen}|${qs}|${SS}|${soft}|${aaKey(el)}`, () => {
    const a = newCanvas(W, H), g = a.getContext('2d'), k = qs * SS;
    g.setTransform(k, 0, 0, k, (pad - box.x) * k, (pad - box.y) * k);
    if (el.type === 'bubble') drawBubble(g, el); else if (el.type === 'text') drawTextEl(g, el, { ...opt, rs: k }); else drawDrawEl(g, el);
    if (sig * k < 0.25) return a;
    const b = newCanvas(W, H), gb = b.getContext('2d'); gb.filter = `blur(${(sig * k).toFixed(2)}px)`; gb.drawImage(a, 0, 0); return b;
  });
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2); ctx.restore();
  return true;
}
// 컷 테두리도 같은 방법으로 (컷 모양 안쪽에 그린 선을 통째로 살짝 흐려요)
function drawPanelBorderAA(ctx, el, soft) {
  const m = ctx.getTransform(), sc = Math.hypot(m.a, m.b); if (!(sc > 0)) return false;
  const qs = Math.pow(2, Math.round(Math.log2(sc) * 4) / 4), sig = soft / 100 * 0.9, pad = sig * 3 + 1, w = el.w, h = el.h;
  let SS = 2, W, H;
  for (; SS >= 1; SS--) { W = Math.ceil((w + pad * 2) * qs * SS); H = Math.ceil((h + pad * 2) * qs * SS); if (W * H <= 24e6 && W <= 12000 && H <= 12000) break; }
  if (SS < 1) return false;
  const key = `pb|${qs}|${SS}|${soft}|${w.toFixed(2)}|${h.toFixed(2)}|${el.radius || 0}|${el.bw}|${el.bc}|${JSON.stringify(el.clips || [])}`;
  const c = bmpGet(key, () => {
    const a = newCanvas(W, H), g = a.getContext('2d'), k = qs * SS, r = Math.min(el.radius || 0, w / 2, h / 2);
    g.setTransform(k, 0, 0, k, (pad + w / 2) * k, (pad + h / 2) * k);
    applyClips(g, el); g.beginPath(); roundRectPath(g, -w / 2, -h / 2, w, h, r); g.clip();
    g.lineWidth = el.bw * 2; g.strokeStyle = el.bc; g.lineJoin = 'miter'; g.miterLimit = 10;
    g.beginPath(); roundRectPath(g, -w / 2, -h / 2, w, h, r); g.stroke(); for (const poly of el.clips || []) { polyPath(g, el, poly); g.stroke(); }
    if (sig * k < 0.25) return a;
    const b = newCanvas(W, H), gb = b.getContext('2d'); gb.filter = `blur(${(sig * k).toFixed(2)}px)`; gb.drawImage(a, 0, 0); return b;
  });
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2); ctx.restore();
  return true;
}
function drawEl(ctx, el, opt) {
  if (el.hidden) return; // 레이어 목록에서 숨긴 것
  if ((el.eop ?? 100) < 100 || (el.eblend && el.eblend !== 'source-over')) { drawElGroup(ctx, el, opt, g => drawElInner(g, el, opt)); return; }
  drawElInner(ctx, el, opt);
}
function drawElInner(ctx, el, opt) {
  ctx.save(); ctx.translate(el.x + el.w / 2, el.y + el.h / 2); if (el.rot) ctx.rotate(el.rot * DEG);
  const soft = aaSoft();
  if (soft > 0 && (el.type === 'bubble' || el.type === 'text' || el.type === 'draw') && drawVecAA(ctx, el, opt, soft)) { ctx.restore(); return; }
  switch (el.type) {
    case 'panel': drawPanel(ctx, el, opt); break;
    case 'bubble': drawBubble(ctx, el); break;
    case 'text': drawTextEl(ctx, el, opt); break;
    case 'stamp': drawStamp(ctx, el, opt); break;
    case 'draw': drawDrawEl(ctx, el); break;
    case 'fx': drawFxEl(ctx, el, opt); break;
  }
  ctx.restore();
}
function elBounds(el) {
  const b = aabb(el); let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h, m = 6 + (el.ow || 0);
  if (el.type === 'bubble' && el.tail) { x0 = Math.min(x0, el.tx); y0 = Math.min(y0, el.ty); x1 = Math.max(x1, el.tx); y1 = Math.max(y1, el.ty); m += el.sw * 2 + el.w * 0.15; }
  if (el.type === 'fx') m += (el.str || 0) * 3 + (el.kind === 'paint' ? (el.soft || 0) * 5 : 0) + (el.pad || 0);
  if (el.mo) m += Math.max(el.w, el.h) * 0.3;
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}
const inView = (b, v) => !v || !(b.x1 < v.x0 || b.x0 > v.x1 || b.y1 < v.y0 || b.y0 > v.y1);
function drawPage(ctx, p, opt) {
  if (p.bgT) { if (opt.screen) { ctx.save(); ctx.fillStyle = checkerPat(); ctx.fillRect(0, 0, p.w, p.h); ctx.restore(); } } // 투명 바탕: 화면에는 바둑판
  else { ctx.fillStyle = p.bg || '#fff'; ctx.fillRect(0, 0, p.w, p.h); }
  const list = [];
  for (const el of p.els) { const b = elBounds(el); if (inView(b, opt.view)) list.push({ el, out: b.x0 < 0 || b.y0 < 0 || b.x1 > p.w || b.y1 > p.h }); }
  if (opt.screen && list.some(o => o.out)) {
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 2e5); ctx.rect(0, 0, p.w, p.h); ctx.clip('evenodd');
    ctx.globalAlpha = 0.3; for (const o of list) if (o.out && o.el.type !== 'fx') drawEl(ctx, o.el, opt); ctx.restore();
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, p.w, p.h); ctx.clip();
  for (const o of list) {
    const P = o.el.type === 'fx' && o.el.inPanel ? p.els.find(e => e.id === o.el.inPanel) : null; // 자동 흰칠은 자기 컷 안에만
    if (P) { ctx.save(); panelClip(ctx, P); drawEl(ctx, o.el, opt); ctx.restore(); } else drawEl(ctx, o.el, opt);
  }
  ctx.restore();
}

/* ================= 화면 ================= */
const cv = $('#cv'), ctx = cv.getContext('2d');
const scroller = $('#scroller'), spacer = $('#spacer'), work = $('#work');
const PAD = 80;
let originX = 0, originY = 0, rq = false, deskPat = null, deskDpr = 0;
function layoutSpacer() {
  const p = page(); spacer.style.width = Math.ceil(p.w * zoom + PAD * 2) + 'px'; spacer.style.height = Math.ceil(p.h * zoom + PAD * 2) + 'px';
}
function computeOrigin() {
  const p = page(), vw = scroller.clientWidth, vh = scroller.clientHeight, cw = p.w * zoom, ch = p.h * zoom;
  originX = (cw + PAD * 2 < vw ? (vw - cw) / 2 : PAD) - scroller.scrollLeft;
  originY = (ch + PAD * 2 < vh ? (vh - ch) / 2 : PAD) - scroller.scrollTop;
}
const S = p => ({ x: originX + p.x * zoom, y: originY + p.y * zoom });
function toPage(e) {
  const r = scroller.getBoundingClientRect(); computeOrigin();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  return { x: (sx - originX) / zoom, y: (sy - originY) / zoom, sx, sy };
}
function requestRender() { if (!rq) { rq = true; requestAnimationFrame(render); } }
let checkerP = null;
function checkerPat() { if (checkerP) return checkerP; const c = newCanvas(16, 16), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#d9dde3'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8); return checkerP = ctx.createPattern(c, 'repeat'); }
function getDesk(dpr) {
  if (deskPat && deskDpr === dpr) return deskPat;
  const s = Math.round(9 * dpr), c = newCanvas(s, s);
  const dk = document.documentElement.dataset.theme === 'dark';
  const g = c.getContext('2d'); g.fillStyle = dk ? '#232529' : '#2f3238'; g.fillRect(0, 0, s, s); // 어두운 라이트테이블
  g.fillStyle = dk ? '#2c2f34' : '#393c43'; g.beginPath(); g.arc(s / 2, s / 2, 1.35 * dpr, 0, Math.PI * 2); g.fill();
  deskPat = ctx.createPattern(c, 'repeat'); deskDpr = dpr; return deskPat;
}
function render() {
  rq = false;
  const dpr = window.devicePixelRatio || 1, vw = scroller.clientWidth, vh = scroller.clientHeight;
  const W = Math.max(1, Math.round(vw * dpr)), H = Math.max(1, Math.round(vh * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; cv.style.width = vw + 'px'; cv.style.height = vh + 'px'; }
  computeOrigin();
  const p = page();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = getDesk(dpr); ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4;
  ctx.fillStyle = p.bg || '#fff'; ctx.fillRect(originX, originY, p.w * zoom, p.h * zoom); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `600 12px ${fontCss('고딕')}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${p.name}   ${p.w} × ${p.h}`, originX, originY - 8);
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * originX, dpr * originY);
  drawPage(ctx, p, { screen: true, rs: zoom * dpr, view: { x0: -originX / zoom, y0: -originY / zoom, x1: (vw - originX) / zoom, y1: (vh - originY) / zoom } });
  if (penSt) {
    const D = doc.defaults.draw, all = penSt.cur ? [...penSt.strokes, penSt.cur] : penSt.strokes;
    ctx.save(); ctx.globalAlpha = (D.op ?? 100) / 100; drawStrokes(ctx, all, D.color, D.ow, D.oc); ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawOverlay(dpr);
  if (inlEl) positionInline();
}
const BLUE = '#1688e0', GUIDE = '#ff2f92';
function outline(el, color, w, dash) {
  const cs = corners(el).map(S); ctx.beginPath(); ctx.moveTo(cs[0].x, cs[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(cs[i].x, cs[i].y);
  ctx.closePath(); ctx.setLineDash(dash || []); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
}
function shapeOutline(el, color, w, dpr) { // 잘린 컷의 실제 모양 테두리
  ctx.save(); ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * originX, dpr * originY);
  ctx.translate(el.x + el.w / 2, el.y + el.h / 2); if (el.rot) ctx.rotate(el.rot * DEG);
  applyClips(ctx, el); ctx.beginPath(); ctx.rect(-el.w / 2, -el.h / 2, el.w, el.h); ctx.clip();
  ctx.lineWidth = w * 2 / zoom; ctx.strokeStyle = color; ctx.stroke();
  for (const poly of el.clips) { polyPath(ctx, el, poly); ctx.stroke(); }
  ctx.restore();
}
function handlesFor(el) {
  if (el.lock) return [];
  const hs = [], c = center(el), a = (el.rot || 0) * DEG;
  const cornersOnly = el.type === 'text' || el.type === 'stamp';
  const pts = cornersOnly ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  for (const [hx, hy] of pts) {
    if ((hx === 0 || hy === 0) && ((hx === 0 && el.w * zoom < 46) || (hy === 0 && el.h * zoom < 46))) continue;
    const r = rot(hx * el.w / 2, hy * el.h / 2, a); hs.push({ kind: 'resize', hx, hy, x: c.x + r.x, y: c.y + r.y });
  }
  if (el.type !== 'fx') { const rr = rot(0, -el.h / 2 - 28 / zoom, a); hs.push({ kind: 'rotate', x: c.x + rr.x, y: c.y + rr.y }); }
  if (el.type === 'bubble' && el.tail) hs.push({ kind: 'tail', x: el.tx, y: el.ty });
  return hs;
}
function hitHandle(el, p) {
  const hs = handlesFor(el); let best = null, bd = 11;
  const order = { tail: 0, rotate: 1, resize: 2 };
  for (const h of hs) {
    const d = Math.hypot(h.x - p.x, h.y - p.y) * zoom;
    if (d < bd || (best && d === bd && order[h.kind] < order[best.kind])) { best = h; bd = d; }
  }
  return best;
}
function quadPts(a, c, b, n) { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }); } return out; }
function drawSplitPreview() {
  const st = splitSt; if (!st || st.phase === 'idle') return;
  const L = 6000 / zoom;
  const pts = cutPolyline(st.a, st.b, st.phase === 'bend' ? st.c : null, L).map(S);
  ctx.save(); ctx.strokeStyle = GUIDE;
  ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2; ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
  ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.beginPath(); pts.slice(1, -1).forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke();
  for (const q of [st.a, st.b]) { const s = S(q); ctx.beginPath(); ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.stroke(); }
  if (st.phase === 'bend') { const s = S(st.c); ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fillStyle = GUIDE; ctx.fill(); }
  ctx.restore();
}
function drawOverlay(dpr) {
  const hel = hoverId && !sel.includes(hoverId) ? findEl(hoverId) : null;
  if (hel) { if (hel.clips && hel.clips.length) shapeOutline(hel, 'rgba(22,136,224,.7)', 1.5, dpr); else outline(hel, 'rgba(22,136,224,.6)', 1.5); }
  const ss = selEls();
  for (const el of ss) {
    if (el.clips && el.clips.length) { shapeOutline(el, BLUE, 2, dpr); outline(el, 'rgba(22,136,224,.45)', 1, [4, 4]); }
    else outline(el, BLUE, 1.5);
  }
  if (imageEditId) {
    const el = findEl(imageEditId);
    if (el) {
      outline(el, GUIDE, 2, [6, 4]);
      const A = activeObj(el), cs = A && A.img && layerCorners(el, A);
      if (cs) { const q = cs.map(S); ctx.beginPath(); q.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = BLUE; ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  if (ss.length === 1 && !imageEditId && !inlEl && !mode) {
    const el = ss[0];
    for (const h of handlesFor(el)) {
      const s = S(h);
      if (h.kind === 'rotate') {
        const top = S(corners(el)[0]), top2 = S(corners(el)[1]);
        ctx.beginPath(); ctx.moveTo((top.x + top2.x) / 2, (top.y + top2.y) / 2); ctx.lineTo(s.x, s.y); ctx.lineWidth = 1; ctx.strokeStyle = BLUE; ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.6, -0.3, Math.PI * 1.4); ctx.lineWidth = 1.2; ctx.stroke();
      } else if (h.kind === 'tail') {
        ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fillStyle = BLUE; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      } else {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate((el.rot || 0) * DEG);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5; ctx.fillRect(-4.5, -4.5, 9, 9); ctx.strokeRect(-4.5, -4.5, 9, 9); ctx.restore();
      }
    }
  }
  if (guides.length) {
    ctx.strokeStyle = GUIDE; ctx.lineWidth = 1;
    for (const g of guides) {
      ctx.beginPath();
      if (g.v != null) { const x = Math.round(S({ x: g.v, y: 0 }).x) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); }
      else { const y = Math.round(S({ x: 0, y: g.h }).y) + 0.5; ctx.moveTo(0, y); ctx.lineTo(cv.width, y); }
      ctx.stroke();
    }
  }
  if (marquee) {
    const a = S(marquee), w = marquee.w * zoom, h = marquee.h * zoom;
    ctx.fillStyle = 'rgba(22,136,224,.1)'; ctx.fillRect(a.x, a.y, w, h); ctx.strokeStyle = BLUE; ctx.lineWidth = 1; ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);
  }
  if (mode === 'split') drawSplitPreview();
  if (mode === 'crop' && cropSt) drawCropOverlay();
  if (mode === 'select') drawSelOverlay();
  if (mode === 'brush' && cloneSrc && brushSt && brushSt.el.kind === 'clone') { // 도장: 복사할 곳 표시
    const c = S(cloneSrc); ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.moveTo(c.x - 14, c.y); ctx.lineTo(c.x + 14, c.y); ctx.moveTo(c.x, c.y - 14); ctx.lineTo(c.x, c.y + 14); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.restore();
  }
  if (mode === 'brush' && brushHover) {
    const s = S(brushHover), r = Math.max(2, doc.defaults.fx.bw / 2 * zoom);
    ctx.save(); ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke();
    ctx.setLineDash(brushErase ? [5, 4] : []); ctx.lineWidth = 1.5; ctx.strokeStyle = brushErase ? '#ff5aa8' : '#fff'; ctx.stroke(); ctx.restore();
  }
}
function viewCenter() {
  computeOrigin(); const p = page();
  return { x: clamp((scroller.clientWidth / 2 - originX) / zoom, 0, p.w), y: clamp((scroller.clientHeight / 2 - originY) / zoom, 0, p.h) };
}
function setZoom(z, sx, sy) {
  const p = toPage({ clientX: scroller.getBoundingClientRect().left + sx, clientY: scroller.getBoundingClientRect().top + sy });
  zoom = clamp(z, 0.05, 6); layoutSpacer();
  const pg = page(), vw = scroller.clientWidth, vh = scroller.clientHeight, cw = pg.w * zoom, ch = pg.h * zoom;
  const offX = cw + PAD * 2 < vw ? (vw - cw) / 2 : PAD, offY = ch + PAD * 2 < vh ? (vh - ch) / 2 : PAD;
  scroller.scrollLeft = offX + p.x * zoom - sx; scroller.scrollTop = offY + p.y * zoom - sy;
  $('#zoomLbl').textContent = Math.round(zoom * 100) + '%'; requestRender();
}
function zoomStep(dir) { setZoom(zoom * (dir > 0 ? 1.25 : 0.8), scroller.clientWidth / 2, scroller.clientHeight / 2); }
function fitView() {
  const p = page(), vw = scroller.clientWidth || 800, vh = scroller.clientHeight || 600;
  zoom = p.h > p.w * 1.8 ? (vw - 100) / p.w : Math.min((vw - 100) / p.w, (vh - 110) / p.h);
  zoom = clamp(zoom, 0.05, 3); layoutSpacer(); scroller.scrollLeft = 0; scroller.scrollTop = 0;
  $('#zoomLbl').textContent = Math.round(zoom * 100) + '%'; requestRender();
}
function scrollToEl(el) {
  computeOrigin(); const b = aabb(el), s = S({ x: b.x, y: b.y });
  if (s.y < 0 || s.y + b.h * zoom > scroller.clientHeight) scroller.scrollTop += s.y - 60;
}

/* ================= 자석(맞춤) ================= */
function snapLines(ex) {
  const p = page(), xs = [0, p.w / 2, p.w], ys = [0, p.h / 2, p.h];
  for (const e of p.els) { if (ex.has(e.id)) continue; const b = aabb(e); xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  return { xs, ys };
}
function bestSnap(cands, vals, thr) {
  let best = null;
  for (const c of cands) for (const v of vals) { const d = c - v; if (Math.abs(d) < thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, c }; }
  return best;
}
function snapMove(bb, dx, dy) {
  const thr = 6 / zoom, L = snapLines(new Set(sel));
  const bx = bestSnap(L.xs, [bb.x + dx, bb.x + bb.w / 2 + dx, bb.x + bb.w + dx], thr);
  const by = bestSnap(L.ys, [bb.y + dy, bb.y + bb.h / 2 + dy, bb.y + bb.h + dy], thr);
  if (bx) { dx += bx.d; guides.push({ v: bx.c }); }
  if (by) { dy += by.d; guides.push({ h: by.c }); }
  return { dx, dy };
}

/* ================= 모드: 컷 자르기, 펜 ================= */
function setMode(m, kind) {
  if (mode === 'pen' && m !== 'pen') finishPen();
  if (mode === 'brush') finishBrush();
  mode = m; splitSt = null; penSt = null; brushSt = null; cropSt = null; selSt = null;
  if (m === 'crop') { const p = page(); cropSt = { r: { x: 0, y: 0, w: p.w, h: p.h }, ratio: '0' }; sel = []; }
  if (m === 'split') splitSt = { kind: kind || 'line', phase: 'idle' };
  if (m === 'pen') { penSt = { strokes: [], cur: null, last: null }; sel = []; }
  if (m === 'brush') startBrush(kind);
  if (m === 'select') { selStart(); sel = []; }
  imageEditId = null; closeMenus(); renderModebar(); renderProps(); updateHint(); requestRender();
  document.body.classList.toggle('moding', !!m);
  $('#bPen').classList.toggle('on', m === 'pen'); $('#bSplit').classList.toggle('on', m === 'split'); $('#bBrush').classList.toggle('on', m === 'brush'); $('#bCrop').classList.toggle('on', m === 'crop'); $('#bSel').classList.toggle('on', m === 'select');
  scroller.style.cursor = m ? 'crosshair' : 'default';
}
function renderModebar() {
  const mb = $('#modebar');
  if (!mode) { mb.hidden = true; mb.innerHTML = ''; return; }
  mb.hidden = false;
  if (mode === 'split') {
    const n = selEls().filter(e => e.type === 'panel').length, curve = splitSt.kind === 'curve';
    mb.innerHTML = `<b>컷 자르기</b>
      <span class="mtxt">${curve ? '선을 긋고 손을 뗀 뒤, 마우스를 움직여 휘게 하고 한 번 클릭하면 잘려요.' : '자를 곳을 가로질러 선을 그으세요.'} ${n ? `고른 컷 ${n}개만 잘려요.` : '선이 지나가는 컷이 모두 잘려요.'}</span>
      <div class="seg"><button class="btn sm ${curve ? '' : 'on'}" data-mb="line">직선</button><button class="btn sm ${curve ? 'on' : ''}" data-mb="curve">곡선</button></div>
      <label>컷 사이 간격 <input type="number" id="mbGap" value="${doc.defaults.panel.gutter ?? 16}" min="0" max="200"> px</label>
      <button class="btn sm primary" data-mb="done">다 잘랐어요</button>`;
  } else if (mode === 'brush') {
    const D = doc.defaults.fx, el = brushSt && brushSt.el, kind = el ? el.kind : D.kind;
    mb.innerHTML = `<b>가리기</b>
      <div class="seg" title="칠하기(B) / 지우개(E): 지우개는 이미 가린 곳(자동 흰칠 포함)을 지워요"><button class="btn sm ${brushErase ? '' : 'on'}" data-mb="tool-paint">칠하기</button><button class="btn sm ${brushErase ? 'on' : ''}" data-mb="tool-erase">지우개</button></div>
      ${brushErase ? '' : `<div class="seg">${[['blur', '블러'], ['mosaic', '모자이크'], ['paint', '흰칠'], ['erase', '지우기'], ['clone', '도장'], ['heal', '잡티 지우기']].map(([v, l]) => `<button class="btn sm ${kind === v ? 'on' : ''}" data-mb="k-${v}">${l}</button>`).join('')}</div>`}
      <label>굵기 <input type="range" id="mbBw" min="6" max="260" step="1" value="${D.bw}"></label>
      ${brushErase ? '' : (kind === 'erase' || kind === 'clone' || kind === 'heal') ? `<label title="가장자리를 부드럽게">부드럽게 <input type="range" id="mbSoft" min="0" max="24" step="1" value="${el ? (el.soft ?? 0) : (D.soft ?? 4)}"></label>${kind === 'clone' ? `<span class="mtxt">${cloneSrc ? 'Alt+클릭으로 복사할 곳을 바꿔요' : '먼저 Alt를 누른 채 복사할 곳을 클릭하세요'}</span>` : kind === 'heal' ? '<span class="mtxt">잡티 위를 칠하면 둘레 색으로 메워요</span>' : '<span class="mtxt">칠한 곳이 투명해져요 (PNG로 저장)</span>'}` : kind === 'paint' ? `<label>색 <input type="color" id="mbFc" value="${el ? el.color : D.color}"></label><label title="가장자리를 에어브러쉬처럼 흐리게 해요. 0이면 또렷하게">부드럽게 <input type="range" id="mbSoft" min="0" max="24" step="1" value="${el ? (el.soft ?? 0) : (D.soft ?? 4)}"></label>` : `<label>세기 <input type="range" id="mbStr" min="2" max="${kind === 'mosaic' ? 60 : 40}" step="1" value="${el ? el.str : D.str}"></label>`}
      <button class="btn sm" data-mb="undo">한 획 되돌리기</button>
      <button class="btn sm" data-mb="auto" title="이 페이지에서 성기를 자동으로 찾아 흰칠해요">자동 흰칠</button>
      <button class="btn sm primary" data-mb="done">다 칠했어요</button>`;
  } else if (mode === 'select') {
    mb.innerHTML = selModebar();
  } else if (mode === 'crop') {
    mb.innerHTML = `<b>자르기</b><span class="mtxt">남길 곳을 끌어서 고르세요. 가장자리를 끌면 크기가, 안쪽을 끌면 자리가 바뀌어요.</span>
      <div class="seg">${CROP_RATIOS.map(([v, l]) => `<button class="btn sm ${cropSt.ratio === v ? 'on' : ''}" data-mb="cr-${v}">${l}</button>`).join('')}</div>
      <button class="btn sm" data-mb="crop-cancel">취소</button><button class="btn sm primary" data-mb="crop-apply">자르기 <kbd>Enter</kbd></button>`;
  } else {
    const D = doc.defaults.draw;
    mb.innerHTML = `<b>펜</b>
      <label>색 <input type="color" id="mbColor" value="${D.color}"></label>
      <label>굵기 <input type="range" id="mbPw" min="1" max="60" step="0.5" value="${D.pw}"></label>
      <label>테두리 <input type="range" id="mbOw" min="0" max="20" step="0.5" value="${D.ow}"> <input type="color" id="mbOc" value="${D.oc}"></label>
      <button class="btn sm" data-mb="undo">한 획 지우기</button>
      <button class="btn sm primary" data-mb="done">다 그렸어요</button>`;
  }
}
$('#modebar').addEventListener('click', e => {
  const b = e.target.closest('[data-mb]'); if (!b) return;
  const a = b.dataset.mb;
  if (mode === 'select' && selModebarAct(a)) return;
  if (a === 'line' || a === 'curve') { splitSt = { kind: a, phase: 'idle' }; renderModebar(); requestRender(); }
  else if (a === 'done') setMode(null);
  else if (a.startsWith('cr-') && cropSt) { cropSt.ratio = a.slice(3); cropFit(); renderModebar(); requestRender(); }
  else if (a === 'crop-apply') applyCrop();
  else if (a === 'crop-cancel') setMode(null);
  else if (a === 'auto') { setMode(null); czRunPage(false); }
  else if (a === 'undo' && penSt) { penSt.strokes.pop(); requestRender(); }
  else if (a === 'undo' && brushSt) brushUndo();
  else if (a === 'tool-paint' || a === 'tool-erase') { brushErase = a === 'tool-erase'; if (brushSt) brushSt.erase = brushErase; renderModebar(); requestRender(); }
  else if (a.startsWith('k-') && brushSt) { const k = a.slice(2); brushSt.el.kind = k; doc.defaults.fx.kind = k; if (k === 'mosaic' && brushSt.el.str < 6) brushSt.el.str = 10; renderModebar(); requestRender(); }
});
$('#modebar').addEventListener('input', e => {
  const t = e.target, D = doc.defaults.draw;
  if (t.id === 'mbGap') doc.defaults.panel.gutter = clamp(+t.value || 0, 0, 400);
  if (t.id === 'mbColor') D.color = t.value; if (t.id === 'mbPw') D.pw = +t.value; if (t.id === 'mbOw') D.ow = +t.value; if (t.id === 'mbOc') D.oc = t.value;
  const F = doc.defaults.fx, B = brushSt && brushSt.el;
  if (t.id === 'mbBw') F.bw = +t.value; if (t.id === 'mbStr') { F.str = +t.value; if (B) B.str = +t.value; } if (t.id === 'mbFc') { F.color = t.value; if (B) B.color = t.value; } if (t.id === 'mbSoft') { F.soft = +t.value; if (B) B.soft = +t.value; }
  requestRender();
});
// 가리기 브러쉬: 칠한 자리를 하나의 요소로 모아요
function startBrush(targetId) {
  const D = doc.defaults.fx; let el = targetId ? findEl(targetId) : null; const world = [], shapes = [], polys = [];
  if (el && el.type === 'fx') {
    const k = Math.sqrt(el.w * el.h) / (el.s0 || 1);
    for (const st of el.strokes || []) { const o = st.map(([u, v, w]) => [el.x + u * el.w, el.y + v * el.h, w * k]); if (isErase(st)) o[0][3] = 1; world.push(o); }
    for (const [u, v, rx, ry] of el.shapes || []) shapes.push([el.x + u * el.w, el.y + v * el.h, rx * el.w, ry * el.h]);
    for (const pl of el.polys || []) polys.push(pl.map(([u, v]) => [el.x + u * el.w, el.y + v * el.h]));
    brushSt = { el, world, shapes, polys, cur: null, isNew: false, ops: [], erase: !!brushErase };
  } else {
    el = { id: uid(), type: 'fx', kind: D.kind, str: D.str, color: D.color, soft: D.soft ?? 4, x: 0, y: 0, w: 1, h: 1, rot: 0, s0: 1, strokes: [], shapes: [] };
    brushSt = { el, world, shapes, polys, cur: null, isNew: true, ops: [], erase: !!brushErase };
  }
  sel = [];
}
let brushErase = false, brushHover = null;
// 지우개: 지나가는 곳의 다른 가리기 요소들(자동 흰칠 포함)에도 같은 지우개 획을 넣어요
function eraseApply(bs) {
  const st = bs.cur; if (!st) return;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y, w] of st) { x0 = Math.min(x0, x - w / 2); y0 = Math.min(y0, y - w / 2); x1 = Math.max(x1, x + w / 2); y1 = Math.max(y1, y + w / 2); }
  for (const el of page().els) {
    if (el.type !== 'fx' || el === bs.el) continue;
    const b = elBounds(el); if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
    const k = Math.sqrt(el.w * el.h) / (el.s0 || 1);
    const conv = st.map(([x, y, w]) => { const q = toLocal(el, { x, y }); return [r4(q.x / el.w + 0.5), r4(q.y / el.h + 0.5), r2(w / k)]; });
    conv[0][3] = 1;
    el.strokes = el.strokes || [];
    const old = bs.ext.get(el), i = old ? el.strokes.indexOf(old) : -1;
    if (i >= 0) el.strokes[i] = conv; else el.strokes.push(conv);
    bs.ext.set(el, conv);
  }
}
function brushUndo() {
  const bs = brushSt; if (!bs) return;
  const op = bs.ops.pop();
  if (!op) { if (bs.world.length) bs.world.pop(); }
  else { bs.world.pop(); for (const { el, st } of op.ext || []) el.strokes = (el.strokes || []).filter(x => x !== st); }
  rebuildFx(bs); requestRender();
}
function rebuildFx(bs) {
  const el = bs.el, all = bs.cur ? [...bs.world, bs.cur] : bs.world;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const st of all) { if (isErase(st)) continue; for (const [x, y, w] of st) { x0 = Math.min(x0, x - w / 2); y0 = Math.min(y0, y - w / 2); x1 = Math.max(x1, x + w / 2); y1 = Math.max(y1, y + w / 2); } }
  for (const [cx, cy, rx, ry] of bs.shapes) { x0 = Math.min(x0, cx - rx); y0 = Math.min(y0, cy - ry); x1 = Math.max(x1, cx + rx); y1 = Math.max(y1, cy + ry); }
  for (const pl of bs.polys || []) for (const [x, y] of pl) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 <= x0) { el.strokes = []; el.shapes = []; el.polys = []; el.w = el.h = 1; return; }
  const w = Math.max(2, x1 - x0), h = Math.max(2, y1 - y0);
  el.x = x0; el.y = y0; el.w = w; el.h = h; el.rot = 0; el.s0 = Math.sqrt(w * h);
  el.strokes = all.map(st => { const o = st.map(([x, y, sw]) => [(x - x0) / w, (y - y0) / h, sw]); if (isErase(st)) o[0][3] = 1; return o; });
  el.shapes = bs.shapes.map(([cx, cy, rx, ry]) => [(cx - x0) / w, (cy - y0) / h, rx / w, ry / h]);
  if ((bs.polys || []).length) el.polys = bs.polys.map(pl => pl.map(([x, y]) => [r4((x - x0) / w), r4((y - y0) / h)]));
}
function r4(v) { return Math.round(v * 10000) / 10000; }
function brushDown(p, e) {
  let bs = brushSt; if (!bs) return;
  if (!brushErase && bs.el.kind === 'clone') { // 도장: Alt+클릭 = 복사할 곳, 칠하기 시작할 때 거리를 정해요
    if (e.altKey) { if (bs.world.length) { finishBrush(); startBrush(); brushSt.el.kind = 'clone'; } cloneSrc = { x: p.x, y: p.y }; renderModebar(); requestRender(); return; }
    if (!cloneSrc) { toast('먼저 Alt를 누른 채 복사해 올 곳을 클릭하세요'); return; }
    if (!bs.world.some(st => !isErase(st))) { bs.el.cdx = cloneSrc.x - p.x; bs.el.cdy = cloneSrc.y - p.y; }
  }
  bs.erase = brushErase;
  if (bs.erase) { bs.cur = [[p.x, p.y, doc.defaults.fx.bw, 1]]; bs.ext = new Map(); eraseApply(bs); }
  else { if (bs.isNew && !page().els.includes(bs.el)) page().els.push(bs.el); bs.cur = [[p.x, p.y, doc.defaults.fx.bw]]; }
  rebuildFx(bs);
  scroller.setPointerCapture(e.pointerId); drag = { mode: 'brush' }; requestRender();
}
function brushMove(e) {
  const bs = brushSt; if (!bs || !bs.cur) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) { const q = toPage(ev), l = bs.cur[bs.cur.length - 1]; if (Math.hypot(q.x - l[0], q.y - l[1]) * zoom < 2) continue; bs.cur.push([q.x, q.y, doc.defaults.fx.bw]); }
  brushHover = toPage(e); if (bs.erase) eraseApply(bs);
  rebuildFx(bs); requestRender();
}
function brushUp() {
  drag = null; const bs = brushSt; if (!bs || !bs.cur) return;
  bs.world.push(bs.cur); bs.ops.push({ ext: bs.erase ? [...bs.ext.entries()].map(([el, st]) => ({ el, st })) : [] });
  bs.cur = null; bs.ext = null; rebuildFx(bs); requestRender();
}
function finishBrush() {
  const bs = brushSt; if (!bs) return; brushSt = null;
  const pg = page(), has = bs.world.some(st => !isErase(st)) || bs.shapes.length || (bs.polys || []).length;
  const touched = bs.ops.some(o => o.ext && o.ext.length);
  if (!has) { pg.els = pg.els.filter(e => e !== bs.el); if (!bs.isNew || touched) commit(); return; }
  if (!pg.els.includes(bs.el)) pg.els.push(bs.el);
  sel = [bs.el.id]; commit();
}

const CROP_RATIOS = [['0', '자유'], ['img', '원래 비율'], ['1', '1:1'], ['0.8', '4:5'], ['0.75', '3:4'], ['1.7778', '16:9'], ['0.5625', '9:16']];
function cropRatio() { if (!cropSt) return 0; if (cropSt.ratio === 'img') { const p = page(); return p.w / p.h; } return +cropSt.ratio || 0; }
function cropFit() { // 지금 상자 안에서 고른 비율로 가장 크게
  const R = cropRatio(), p = page(), r = cropSt.r; if (!R) return;
  let w = r.w, h = w / R; if (h > r.h) { h = r.h; w = h * R; }
  if (w < 8 || h < 8) { w = p.w; h = w / R; if (h > p.h) { h = p.h; w = h * R; } }
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  cropSt.r = { x: clamp(cx - w / 2, 0, p.w - w), y: clamp(cy - h / 2, 0, p.h - h), w, h };
}
function cropHit(q) {
  const r = cropSt.r, t = 9 / zoom;
  const nx = Math.abs(q.x - r.x) < t ? -1 : Math.abs(q.x - (r.x + r.w)) < t ? 1 : 0, ny = Math.abs(q.y - r.y) < t ? -1 : Math.abs(q.y - (r.y + r.h)) < t ? 1 : 0;
  const inX = q.x > r.x - t && q.x < r.x + r.w + t, inY = q.y > r.y - t && q.y < r.y + r.h + t;
  if ((nx || ny) && inX && inY) return { hx: nx, hy: ny };
  if (q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h) return { move: true };
  return null;
}
function cropHover(q) {
  const h = cropHit(q);
  scroller.style.cursor = spaceDown ? 'grab' : !h ? 'crosshair' : h.move ? 'move' : (h.hx && h.hy ? (h.hx === h.hy ? 'nwse-resize' : 'nesw-resize') : h.hx ? 'ew-resize' : 'ns-resize');
}
function cropDown(q, e) {
  const h = cropHit(q), r = cropSt.r, pg = page();
  if (h && h.move) drag = { mode: 'crop', kind: 'move', sx: q.x, sy: q.y, o: { ...r } };
  else if (h) drag = { mode: 'crop', kind: 'resize', hx: h.hx, hy: h.hy, o: { ...r } };
  else drag = { mode: 'crop', kind: 'new', sx: clamp(q.x, 0, pg.w), sy: clamp(q.y, 0, pg.h) };
  scroller.setPointerCapture(e.pointerId);
}
function cropMove(q) {
  const d = drag, pg = page(), R = cropRatio(), X = clamp(q.x, 0, pg.w), Y = clamp(q.y, 0, pg.h);
  if (d.kind === 'move') { const o = d.o; cropSt.r = { ...o, x: clamp(o.x + q.x - d.sx, 0, pg.w - o.w), y: clamp(o.y + q.y - d.sy, 0, pg.h - o.h) }; requestRender(); return; }
  let ax, ay, bx, by; // a: 고정된 모서리, b: 끄는 모서리
  if (d.kind === 'new') { ax = d.sx; ay = d.sy; bx = X; by = Y; }
  else {
    const o = d.o;
    ax = d.hx > 0 ? o.x : o.x + o.w; bx = d.hx ? X : o.x;
    ay = d.hy > 0 ? o.y : o.y + o.h; by = d.hy ? Y : o.y;
    if (!d.hx) { ax = o.x; bx = o.x + o.w; } if (!d.hy) { ay = o.y; by = o.y + o.h; }
  }
  if (R) {
    let w = Math.abs(bx - ax), h = Math.abs(by - ay);
    if (d.kind === 'resize' && !d.hy) h = w / R; else if (d.kind === 'resize' && !d.hx) w = h * R; else if (w / Math.max(h, 1e-6) > R) h = w / R; else w = h * R;
    const sx = bx >= ax ? 1 : -1, sy = by >= ay ? 1 : -1;
    const lim = Math.min(1, sx > 0 ? (pg.w - ax) / Math.max(w, 1e-6) : ax / Math.max(w, 1e-6), sy > 0 ? (pg.h - ay) / Math.max(h, 1e-6) : ay / Math.max(h, 1e-6));
    w *= lim; h *= lim; bx = ax + sx * w; by = ay + sy * h;
  }
  cropSt.r = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  requestRender();
}
function applyCrop() {
  const p = page(), r = cropSt && cropSt.r; if (!r) return;
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  if (w < 8 || h < 8) { toast('남길 곳이 너무 작아요. 화면을 끌어서 다시 골라 주세요.'); return; }
  if (x === 0 && y === 0 && w === p.w && h === p.h) { setMode(null); return; }
  for (const el of p.els) moveBy(el, -x, -y);
  p.w = w; p.h = h; setMode(null); commit(); fitView(); renderAll(); toast(`${w} × ${h} 크기로 잘랐어요. 되돌리기(Ctrl+Z)로 돌릴 수 있어요.`, 3200);
}
function drawCropOverlay() {
  const r = cropSt.r, a = S({ x: r.x, y: r.y }), w = r.w * zoom, h = r.h * zoom;
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(-10, -10, cv.width + 20, cv.height + 20); ctx.rect(a.x, a.y, w, h); ctx.fill('evenodd');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(a.x, a.y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath();
  for (const k of [1, 2]) { ctx.moveTo(a.x + w * k / 3, a.y); ctx.lineTo(a.x + w * k / 3, a.y + h); ctx.moveTo(a.x, a.y + h * k / 3); ctx.lineTo(a.x + w, a.y + h * k / 3); }
  ctx.stroke(); ctx.fillStyle = '#fff';
  for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) ctx.fillRect(a.x + w * hx - 4, a.y + h * hy - 4, 8, 8);
  ctx.font = `600 12px ${fontCss('고딕')}`; const t = `${Math.round(r.w)} × ${Math.round(r.h)}`, tw = ctx.measureText(t).width;
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(a.x, Math.max(0, a.y - 24), tw + 14, 20); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(t, a.x + 7, Math.max(0, a.y - 24) + 10);
  ctx.restore();
}
// 그림 통째로 돌리기 (dir: 1 = 오른쪽, -1 = 왼쪽)
function rotatePage(dir) {
  const p = page(), W = p.w, H = p.h, f = (x, y) => dir > 0 ? { x: H - y, y: x } : { x: y, y: W - x };
  for (const el of p.els) {
    const c = center(el), n = f(c.x, c.y);
    el.x = n.x - el.w / 2; el.y = n.y - el.h / 2; el.rot = ((((el.rot || 0) + 90 * dir) + 180) % 360 + 360) % 360 - 180;
    if (el.type === 'bubble') { const t = f(el.tx, el.ty); el.tx = t.x; el.ty = t.y; }
  }
  p.w = H; p.h = W;
}
function scaleEl(el, k) { // 크기와 자리를 원점 기준으로 k배
  el.x *= k; el.y *= k; el.w *= k; el.h *= k;
  const mul = keys => { for (const q of keys) if (typeof el[q] === 'number') el[q] *= k; };
  if (el.type === 'bubble') { el.tx *= k; el.ty *= k; mul(['fs', 'sw', 'tw', 'tsw']); }
  if (el.type === 'text') mul(['fs', 'sw', 'sw2']);
  if (el.type === 'stamp' || el.type === 'draw') mul(['ow']);
  if (el.type === 'panel') mul(['bw', 'radius']);
  if (el.type === 'fx') mul(['str', 'soft', 'pad']);
}
function copyToPages(idxs) { // 고른 것을 다른 그림에도 같은 자리에 (그림 크기에 맞춰서)
  const p0 = page(), els = selEls().filter(o => !o.lock && !o.inPanel); if (!els.length) return;
  let n = 0;
  for (const i of idxs) {
    const p = doc.pages[i]; if (i === doc.cur || !p || p.ph) continue;
    const k = Math.min(p.w / p0.w, p.h / p0.h);
    for (const src of els) {
      const c = clone(src); c.id = uid(); delete c.auto; delete c.inPanel;
      const cx = (src.x + src.w / 2) / p0.w * p.w, cy = (src.y + src.h / 2) / p0.h * p.h;
      scaleEl(c, k); if (c.type === 'text') fitText(c);
      const nc = center(c); moveBy(c, cx - nc.x, cy - nc.y); p.els.push(c);
    }
    n++;
  }
  if (!n) { toast('넣을 다른 그림이 없어요'); return; }
  commit(); renderLib(); toast(`그림 ${n}장에 똑같이 넣었어요. 장마다 자리를 고칠 수 있어요.`, 3200);
}
function snapAngle(a, b, force) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy); if (L < 1e-6) return b;
  let ang = Math.atan2(dy, dx) / DEG; const step = force ? 15 : 90, tol = force ? 8 : 3;
  const r = Math.round(ang / step) * step; if (Math.abs(ang - r) <= tol || force) ang = r;
  return { x: a.x + Math.cos(ang * DEG) * L, y: a.y + Math.sin(ang * DEG) * L };
}
function splitDown(p, e) {
  const st = splitSt;
  if (st.phase === 'bend') { doSplit({ a: st.a, b: st.b, c: st.c }); splitSt = { kind: st.kind, phase: 'idle' }; requestRender(); return; }
  splitSt = { kind: st.kind, phase: 'draw', a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y } };
  scroller.setPointerCapture(e.pointerId); drag = { mode: 'split' };
}
function splitMove(p, e) {
  const st = splitSt; if (!st) return;
  if (st.phase === 'draw') st.b = snapAngle(st.a, p, e.shiftKey);
  else if (st.phase === 'bend') st.c = { x: p.x, y: p.y };
  requestRender();
}
function splitUp() {
  const st = splitSt; drag = null; if (!st || st.phase !== 'draw') return;
  if (Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y) * zoom < 10) { splitSt = { kind: st.kind, phase: 'idle' }; requestRender(); return; }
  if (st.kind === 'line') { doSplit({ a: st.a, b: st.b, c: null }); splitSt = { kind: st.kind, phase: 'idle' }; }
  else { st.phase = 'bend'; st.c = { x: (st.a.x + st.b.x) / 2, y: (st.a.y + st.b.y) / 2 }; }
  requestRender();
}
function penWidth(e, dist, dt, lastW) {
  const base = doc.defaults.draw.pw;
  let target;
  if (e.pointerType === 'pen' && e.pressure > 0) target = base * (0.15 + e.pressure * 1.25);
  else { const v = dist * zoom / Math.max(1, dt); target = base * clamp(1.2 - v * 0.3, 0.35, 1.2); }
  return lastW == null ? target : lastW * 0.65 + target * 0.35;
}
function penDown(p, e) {
  const w = penWidth(e, 0, 16, null) * 0.45;
  penSt.cur = [[p.x, p.y, w]]; penSt.last = { x: p.x, y: p.y, t: e.timeStamp, w };
  scroller.setPointerCapture(e.pointerId); drag = { mode: 'pen' }; requestRender();
}
function penMove(e) {
  if (!penSt || !penSt.cur) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of (evs.length ? evs : [e])) {
    const q = toPage(ev), L = penSt.last, dist = Math.hypot(q.x - L.x, q.y - L.y);
    if (dist * zoom < 1.5) continue;
    let w = penWidth(ev, dist, ev.timeStamp - L.t, L.w);
    const n = penSt.cur.length; if (n < 6) w *= 0.45 + n * 0.11;
    const x = L.x * 0.3 + q.x * 0.7, y = L.y * 0.3 + q.y * 0.7;
    penSt.cur.push([x, y, w]); penSt.last = { x, y, t: ev.timeStamp, w };
  }
  requestRender();
}
function penUp() {
  drag = null; if (!penSt || !penSt.cur) return;
  const st = penSt.cur, n = st.length;
  for (let i = 0; i < Math.min(6, n - 1); i++) st[n - 1 - i][2] *= 0.35 + i * 0.11;
  penSt.strokes.push(st); penSt.cur = null; requestRender();
}
function finishPen() {
  const ps = penSt; penSt = null;
  if (!ps || !ps.strokes.length) return;
  const D = doc.defaults.draw; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const st of ps.strokes) for (const [x, y, w] of st) { const r = w / 2 + 1; x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
  const w = Math.max(4, x1 - x0), h = Math.max(4, y1 - y0);
  const el = { id: uid(), type: 'draw', x: x0, y: y0, w, h, rot: 0, s0: Math.sqrt(w * h), color: D.color, ow: D.ow, oc: D.oc, op: D.op ?? 100,
    strokes: ps.strokes.map(st => st.map(([x, y, sw]) => [r2((x - x0) / w * 1e4) / 1e4, r2((y - y0) / h * 1e4) / 1e4, r2(sw)])) };
  page().els.push(el); sel = [el.id]; commit();
}

/* ================= 마우스 조작 ================= */
function cursorFor(h, el) {
  if (h.kind === 'rotate') return 'grab';
  if (h.kind === 'tail') return 'move';
  const ang = ((Math.atan2(h.hy, h.hx) / DEG + (el.rot || 0)) % 180 + 180) % 180;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(ang / 45) % 4];
}
function updateHover(p) {
  if (mode) { scroller.style.cursor = spaceDown ? 'grab' : 'crosshair'; if (mode === 'split' && splitSt && splitSt.phase === 'bend') splitMove(p, {}); return; }
  let cur = 'default', hid = null;
  if (spaceDown) cur = 'grab';
  else {
    if (sel.length === 1 && !imageEditId) { const el = findEl(sel[0]); const h = el && hitHandle(el, p); if (h) { scroller.style.cursor = cursorFor(h, el); if (hoverId) { hoverId = null; requestRender(); } return; } }
    const hit = hitTest(p);
    if (hit && !hit.lock) { hid = hit.id; cur = imageEditId === hit.id ? 'grab' : 'move'; }
  }
  scroller.style.cursor = cur;
  if (hid !== hoverId) { hoverId = hid; requestRender(); }
}
function onDown(e) {
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop };
    scroller.setPointerCapture(e.pointerId); scroller.style.cursor = 'grabbing'; e.preventDefault(); return;
  }
  if (e.button !== 0) return;
  const r = scroller.getBoundingClientRect();
  if (e.clientX - r.left >= scroller.clientWidth || e.clientY - r.top >= scroller.clientHeight) return;
  if (inlEl) closeInline();
  closeMenus();
  const p = toPage(e);
  if (mode === 'split') { splitDown(p, e); return; }
  if (mode === 'pen') { penDown(p, e); return; }
  if (mode === 'brush') { brushDown(p, e); return; }
  if (mode === 'crop') { cropDown(p, e); return; }
  if (mode === 'select') { selDown(p, e); return; }
  if (sel.length === 1 && !imageEditId) {
    const el = findEl(sel[0]); const h = el && hitHandle(el, p);
    if (h) {
      if (h.kind === 'resize') drag = { mode: 'resize', el, hx: h.hx, hy: h.hy, o: clone(el) };
      else if (h.kind === 'rotate') drag = { mode: 'rotate', el, c: center(el) };
      else drag = { mode: 'tail', el, offx: el.tx - p.x, offy: el.ty - p.y };
      scroller.setPointerCapture(e.pointerId); return;
    }
  }
  const hit = hitTest(p);
  if (imageEditId) {
    const el = findEl(imageEditId);
    if (el && hitEl(el, p, true)) {
      const li = layerAt(el, p); if (li >= 0) activeLayer.set(el.id, li);
      const L = activeObj(el);
      if (L && L.img) { drag = { mode: 'panimg', el, L, base: L === el, sx: p.x, sy: p.y, ox: L.ox || 0, oy: L.oy || 0 }; scroller.setPointerCapture(e.pointerId); scroller.style.cursor = 'grabbing'; renderProps(); requestRender(); return; }
    }
    imageEditId = null;
  }
  if (hit && hit.lock) { // 바탕 그림: 끌면 여러 개 고르기, 그냥 누르면 바탕 그림 고르기
    if (!e.shiftKey) sel = [];
    drag = { mode: 'marquee', sx: p.x, sy: p.y, base: [...sel], lockClick: hit.id, moved: false };
    scroller.setPointerCapture(e.pointerId); renderProps(); requestRender(); return;
  }
  if (hit) {
    if (hit.type === 'panel' && layerCount(hit) > 1) { const li = layerAt(hit, p); if (li >= 0) activeLayer.set(hit.id, li); }
    if (e.shiftKey) { sel = sel.includes(hit.id) ? sel.filter(x => x !== hit.id) : [...sel, hit.id]; }
    else if (!sel.includes(hit.id)) sel = [hit.id];
    const ss = selEls().filter(o => !o.lock), mv = ss.concat(czLinked(page().els, new Set(ss.filter(x => x.type === 'panel').map(x => x.id))).filter(x => !ss.includes(x)));
    drag = { mode: 'move', sx: p.x, sy: p.y, start: mv.map(el => ({ el, x: el.x, y: el.y, tx: el.tx, ty: el.ty })), bb: unionBox(ss.map(aabb)), moved: false, clickId: hit.id, shift: e.shiftKey };
  } else {
    if (!e.shiftKey) sel = [];
    drag = { mode: 'marquee', sx: p.x, sy: p.y, base: [...sel] };
  }
  scroller.setPointerCapture(e.pointerId);
  renderProps(); requestRender();
}
function onMove(e) {
  const p = toPage(e);
  if (drag && drag.mode === 'pan') { scroller.scrollLeft = drag.sl - (e.clientX - drag.sx); scroller.scrollTop = drag.st - (e.clientY - drag.sy); return; }
  if (mode === 'split') { if (drag || (splitSt && splitSt.phase === 'bend')) splitMove(p, e); return; }
  if (mode === 'pen') { if (drag) penMove(e); return; }
  if (mode === 'brush') { if (drag) brushMove(e); else { brushHover = p; requestRender(); } return; }
  if (mode === 'crop') { if (drag && drag.mode === 'crop') cropMove(p); else cropHover(p); return; }
  if (mode === 'select') { if (drag && drag.mode === 'sel') selMove(p); return; }
  if (!drag) { updateHover(p); return; }
  const d = drag; guides = [];
  if (d.mode === 'move') {
    let dx = p.x - d.sx, dy = p.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
    d.moved = true;
    if (snapOn && !e.altKey && d.bb) ({ dx, dy } = snapMove(d.bb, dx, dy));
    for (const s of d.start) { s.el.x = s.x + dx; s.el.y = s.y + dy; if (s.el.type === 'bubble') { s.el.tx = s.tx + dx; s.el.ty = s.ty + dy; } }
  } else if (d.mode === 'resize') doResize(d, p, e);
  else if (d.mode === 'rotate') {
    let ang = Math.atan2(p.y - d.c.y, p.x - d.c.x) / DEG + 90;
    if (e.shiftKey) ang = Math.round(ang / 15) * 15; else { const r9 = Math.round(ang / 90) * 90; if (Math.abs(ang - r9) < 4) ang = r9; }
    ang = ((ang + 180) % 360 + 360) % 360 - 180; d.el.rot = Math.round(ang * 10) / 10;
  } else if (d.mode === 'tail') { d.el.tx = p.x + d.offx; d.el.ty = p.y + d.offy; }
  else if (d.mode === 'panimg') {
    const dl = rot(p.x - d.sx, p.y - d.sy, -(d.el.rot || 0) * DEG);
    d.L.ox = d.ox + dl.x; d.L.oy = d.oy + dl.y; if (d.base) clampImage(d.el);
  } else if (d.mode === 'marquee') {
    const x0 = Math.min(d.sx, p.x), y0 = Math.min(d.sy, p.y), x1 = Math.max(d.sx, p.x), y1 = Math.max(d.sy, p.y);
    if (!d.moved && Math.hypot(x1 - x0, y1 - y0) * zoom < 4) return;
    d.moved = true;
    marquee = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const hits = page().els.filter(el => { if (el.lock) return false; const b = aabb(el); return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0; }).map(el => el.id);
    sel = [...new Set([...d.base, ...hits])];
  }
  requestRender(); syncPropsSoon();
}
function onUp() {
  if (drag && drag.mode === 'crop') { drag = null; requestRender(); return; }
  if (drag && drag.mode === 'sel') { selUp(); return; }
  if (drag && drag.mode === 'split') { splitUp(); return; }
  if (drag && drag.mode === 'pen') { penUp(); return; }
  if (drag && drag.mode === 'brush') { brushUp(); return; }
  const d = drag; drag = null; guides = []; marquee = null;
  if (!d) return;
  if (d.mode === 'pan') { scroller.style.cursor = spaceDown ? 'grab' : (mode ? 'crosshair' : 'default'); return; }
  if (d.mode === 'move' && !d.moved && !d.shift && sel.length > 1) sel = [d.clickId];
  if (d.mode === 'marquee' && d.lockClick && !d.moved) sel = [d.lockClick];
  if (d.mode !== 'marquee') commit();
  if (d.mode === 'panimg') scroller.style.cursor = 'grab';
  renderProps(); requestRender();
}
function doResize(d, p, e) {
  const o = d.o, el = d.el, a = (o.rot || 0) * DEG, c0 = center(o);
  const q = rot(p.x - c0.x, p.y - c0.y, -a);
  const ax = -d.hx * o.w / 2, ay = -d.hy * o.h / 2;
  let nw = o.w, nh = o.h;
  if (el.type === 'text' || el.type === 'stamp') {
    const vx = d.hx * o.w / 2 - ax, vy = d.hy * o.h / 2 - ay;
    const f = clamp(((q.x - ax) * vx + (q.y - ay) * vy) / (vx * vx + vy * vy), 0.04, 60);
    if (el.type === 'text') {
      el.fs = Math.max(4, Math.round(o.fs * f * 10) / 10); el.sw = Math.round(o.sw * f * 10) / 10; el.sw2 = Math.round((o.sw2 || 0) * f * 10) / 10;
      const L = textLayout(el); nw = L.w; nh = L.h;
    } else { nw = Math.max(8, o.w * f); nh = nw * o.h / o.w; }
  } else {
    if (d.hx) nw = Math.max(12, (q.x - ax) * d.hx);
    if (d.hy) nh = Math.max(12, (q.y - ay) * d.hy);
    if (e.shiftKey && d.hx && d.hy) { const ratio = o.w / o.h; if (nw / nh > ratio) nh = nw / ratio; else nw = nh * ratio; }
    else if (snapOn && !e.altKey && !o.rot) {
      const thr = 6 / zoom, L = snapLines(new Set([el.id]));
      if (d.hx === 1) { const b = bestSnap(L.xs, [o.x + nw], thr); if (b) { nw += b.d; guides.push({ v: b.c }); } }
      if (d.hx === -1) { const b = bestSnap(L.xs, [o.x + o.w - nw], thr); if (b) { nw -= b.d; guides.push({ v: b.c }); } }
      if (d.hy === 1) { const b = bestSnap(L.ys, [o.y + nh], thr); if (b) { nh += b.d; guides.push({ h: b.c }); } }
      if (d.hy === -1) { const b = bestSnap(L.ys, [o.y + o.h - nh], thr); if (b) { nh -= b.d; guides.push({ h: b.c }); } }
    }
    if (el.type === 'bubble') el.auto = false;
  }
  const lcx = d.hx ? ax + d.hx * nw / 2 : 0, lcy = d.hy ? ay + d.hy * nh / 2 : 0;
  const wc = rot(lcx, lcy, a);
  el.w = nw; el.h = nh; el.x = c0.x + wc.x - nw / 2; el.y = c0.y + wc.y - nh / 2;
  if (el.type === 'panel') reframe(el, o, { x: lcx, y: lcy });
}
scroller.addEventListener('pointerdown', onDown);
scroller.addEventListener('pointermove', onMove);
scroller.addEventListener('pointerup', onUp);
scroller.addEventListener('pointercancel', onUp);
scroller.addEventListener('pointerleave', () => { if (brushHover) { brushHover = null; requestRender(); } if (!drag && hoverId) { hoverId = null; requestRender(); } });
scroller.addEventListener('scroll', () => requestRender());
scroller.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = scroller.getBoundingClientRect(); setZoom(zoom * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top); return; }
  if (imageEditId) {
    const el = findEl(imageEditId), p = toPage(e), L = el && activeObj(el);
    if (el && L && L.img && hitEl(el, p, true)) { e.preventDefault(); L.iz = clamp((L.iz ?? 1) * (e.deltaY < 0 ? 1.07 : 1 / 1.07), 0.03, 12); if (L === el) clampImage(el); requestRender(); syncProps(); clearTimeout(scroller._wt); scroller._wt = setTimeout(commit, 400); }
  }
}, { passive: false });
scroller.addEventListener('dblclick', e => {
  if (mode) return;
  const p = toPage(e), hit = hitTest(p); if (!hit || hit.lock) return;
  if (hit.type === 'panel') {
    sel = [hit.id];
    if (layerCount(hit)) { const li = layerAt(hit, p); if (li >= 0) activeLayer.set(hit.id, li); if (imageEditId !== hit.id) toggleImageEdit(hit); }
    else { panelPickTarget = { id: hit.id, li: 0 }; $('#filePanelImg').multiple = false; $('#filePanelImg').click(); }
  } else if (hit.type === 'bubble' || hit.type === 'text') openInline(hit);
  renderProps(); requestRender();
});
function toggleImageEdit(el) {
  imageEditId = imageEditId === el.id ? null : el.id;
  if (imageEditId) toast(layerCount(el) > 1 ? '움직일 그림을 눌러서 끌어요. 마우스 휠로 크기를 바꾸고, 다 되면 컷 바깥을 클릭하세요.' : '그림을 끌어서 위치를, 마우스 휠로 크기를 바꿔요. 다 되면 컷 바깥을 클릭하세요.', 4200);
  renderProps(); requestRender();
}

/* 끌어다 놓기 */
scroller.addEventListener('dragover', e => {
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  const isStamp = [...e.dataTransfer.types].some(t => t === 'text/x-cut-stamp' || t === 'text/x-cut-pack');
  const hit = isStamp ? null : hitTest(toPage(e), 'panel'); const id = hit ? hit.id : null;
  if (id !== hoverId) { hoverId = id; requestRender(); }
});
scroller.addEventListener('dragleave', () => { hoverId = null; requestRender(); });
scroller.addEventListener('drop', async e => {
  e.preventDefault(); hoverId = null; const p = toPage(e);
  const itemsP = dtItems(e.dataTransfer); // 폴더도 읽을 수 있게 지금 바로
  const pw = e.dataTransfer.getData('text/x-cut-pack');
  if (pw) { const [pid, i] = pw.split('|'); placePackWord(pid, +i, p); return; }
  const sid = e.dataTransfer.getData('text/x-cut-stamp');
  if (sid && stamps.has(sid)) { placeStamp(sid, p); return; }
  const id = e.dataTransfer.getData('text/x-cut-img');
  if (id && images.has(id)) { dropImage(id, p, e.shiftKey); return; }
  const files = [...(e.dataTransfer.files || [])];
  const proj = files.find(f => /\.json$/i.test(f.name));
  if (proj) { openProjectFile(proj); return; }
  const zip = files.find(f => /\.zip$/i.test(f.name));
  if (zip) { importPackZip(zip); return; }
  const items = await itemsP;
  if (isImg() || items.some(it => it.dir)) { await addImages(items); return; }
  const ids = await importFiles(files), panel = hitTest(p, 'panel');
  if (ids.length === 1) dropImage(ids[0], p, e.shiftKey);
  else if (ids.length > 1 && panel && ids.every(id => images.get(id).alpha)) { for (const id of ids) newLayer(panel, id, p); sel = [panel.id]; commit(); renderProps(); requestRender(); }
  else if (ids.length > 1) { switchTab('lib'); toast(`${ids.length}장을 보관함에 넣었어요. '세로로 자동 배치'로 한 번에 놓을 수 있어요.`, 4000); }
});
function dropImage(id, p, force) {
  const panel = hitTest(p, 'panel');
  if (panel) { putInPanel(panel, id, p, force); sel = [panel.id]; }
  else { const el = newImagePanel(id, p); sel = [el.id]; }
  imageEditId = null; commit(); renderProps(); requestRender();
}
// 투명한 그림은 레이어로 겹치고, 일반 그림은 배경으로
function putInPanel(panel, id, at, force) {
  const r = images.get(id), empty = !layerCount(panel);
  if (r.alpha || (force && !empty)) newLayer(panel, id, at);
  else { const had = !!panel.img; panel.img = id; panel.iz = 1; panel.ox = 0; panel.oy = 0; panel.lrot = 0; activeLayer.set(panel.id, 0); if (had && panel.layers && panel.layers.length) toast('배경을 바꿨어요. 겹친 그림은 그대로 있어요.'); }
}
function newImagePanel(id, at) {
  const r = images.get(id), pg = page();
  const w = Math.min(r.w, pg.h > pg.w * 1.6 ? pg.w * 0.85 : pg.w * 0.55), h = w * r.h / r.w;
  const el = makePanel(at.x, at.y, w, h, id); if (r.alpha) el.bw = 0; pg.els.push(el); return el;
}
function placeImage(id, force) {
  const ss = selEls();
  if (ss.length === 1 && ss[0].type === 'panel') putInPanel(ss[0], id, null, force);
  else { const el = newImagePanel(id, viewCenter()); sel = [el.id]; }
  imageEditId = null; commit(); renderProps(); requestRender();
}
function placeStamp(sid, at) {
  if (!ensureStampImage(sid)) return;
  const p = at || viewCenter(), el = makeStamp(sid, p.x, p.y);
  if (!at) placeNear(el); page().els.push(el); sel = [el.id]; if (mode) setMode(null); commit(); renderProps(); requestRender();
}

/* ================= 글자 바로 고치기 ================= */
const inl = $('#inline'); let inlEl = null;
function openInline(el) {
  sel = [el.id]; inlEl = el; inl.hidden = false; positionInline();
  inl.value = el.text ?? ''; inl.focus(); inl.select(); requestRender();
}
function positionInline() {
  const el = inlEl; if (!el) return; computeOrigin();
  const c = S(center(el)), w = Math.max(200, Math.min(el.w * zoom, 480)), h = Math.max(80, Math.min(el.h * zoom, 300));
  inl.style.left = (c.x - w / 2) + 'px'; inl.style.top = (c.y - h / 2) + 'px'; inl.style.width = w + 'px'; inl.style.height = h + 'px';
  inl.style.fontSize = clamp(el.fs * zoom, 13, 28) + 'px'; inl.style.fontFamily = fontCss(el.font); inl.style.fontWeight = el.bold ? 700 : 400;
}
function closeInline(silent) {
  if (!inlEl) return; inl.hidden = true; inlEl = null;
  if (!silent) { commit(); renderProps(); requestRender(); }
}
inl.addEventListener('input', () => {
  if (!inlEl) return; inlEl.text = inl.value;
  if (inlEl.type === 'text') fitText(inlEl); else if (inlEl.auto) fitBubble(inlEl);
  requestRender(); syncProps();
});
inl.addEventListener('blur', () => closeInline());
inl.addEventListener('keydown', e => {
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); inl.blur(); }
});

/* ================= 속성 패널 ================= */
const propsEl = $('#props');
const VIRT = {
  fillOn: { get: o => !!o.fill, set: (o, v) => { o.fill = v ? (o.lastFill || '#ffffff') : null; } },
  fillColor: { get: o => o.fill || o.lastFill || '#ffffff', set: (o, v) => { o.fill = v; o.lastFill = v; } },
};
const TEXT_FIT = new Set(['text', 'font', 'fs', 'bold', 'italic', 'sw', 'sw2', 'lh', 'jit', 'grow', 'sp', 'skew', 'ext', 'extAng', 'rough', 'align', 'seed', 'vert', 'arc', 'glow', 'shA', 'shDist', 'shBlur', 'boxOn', 'boxPad']);
const BUBBLE_FIT = new Set(['text', 'font', 'fs', 'bold', 'italic', 'lh', 'shape', 'auto']);
function getProp(o, k) {
  if (VIRT[k]) return VIRT[k].get(o);
  if (o[k] === undefined) { if ((o.type === 'panel' || !o.type) && k in LDEF) return LDEF[k]; if ((o.type === 'panel' || !o.type) && k in FX) return FX[k]; if ((o.type === 'panel' || !o.type) && k in ADV) return ADV[k]; }
  return o[k];
}
function setProp(o, k, v) {
  if (v === null || v === undefined) return;
  if (o.type === 'bubble' && (k === 'x' || k === 'y')) { const dv = v - o[k]; if (k === 'x') o.tx += dv; else o.ty += dv; }
  if (o.type === 'stamp' && (k === 'w' || k === 'h')) { const r = o.h / o.w; if (k === 'w') o.h = v * r; else o.w = v / r; }
  if (VIRT[k]) VIRT[k].set(o, v); else o[k] = v;
  if (o.type === 'text' && TEXT_FIT.has(k)) fitText(o);
  if (o.type === 'bubble') { if (k === 'w' || k === 'h') o.auto = false; if (o.auto && BUBBLE_FIT.has(k)) fitBubble(o); }
  if (o.type === 'panel' && (k === 'iz' || k === 'w' || k === 'h')) clampImage(o);
  const D = o.type && doc.defaults[o.type];
  if (D && k in D && k !== 'text') D[k] = o[k];
}
function readVal(inp) {
  if (inp.type === 'checkbox') return inp.checked;
  if (inp.type === 'number' || inp.type === 'range') { const n = parseFloat(inp.value); return isNaN(n) ? null : n; }
  return inp.value;
}
function writeVal(inp, v) {
  if (inp.type === 'checkbox') inp.checked = !!v;
  else if (inp.type === 'number' || inp.type === 'range') inp.value = typeof v === 'number' ? (inp.dataset.int ? Math.round(v) : r2(v)) : (v ?? '');
  else if (inp.value !== String(v ?? '')) inp.value = v ?? '';
}
function scopeTargets(inp) {
  const sc = inp.dataset.scope;
  if (sc === 'page') return [page()];
  if (sc === 'aa') return [doc.defaults.aa || (doc.defaults.aa = { soft: 0 })];
  if (sc === 'layer') { const el = selEls()[0]; const L = el && el.type === 'panel' ? activeObj(el) : null; return L ? [L] : []; }
  return selEls();
}
let spq = false;
function syncPropsSoon() { if (spq) return; spq = true; requestAnimationFrame(() => { spq = false; syncProps(); }); }
function syncProps() {
  for (const inp of $$('[data-k]', propsEl)) {
    if (inp === document.activeElement && inp.type !== 'range' && inp.type !== 'checkbox') continue;
    const tgt = scopeTargets(inp)[0];
    if (tgt) writeVal(inp, getProp(tgt, inp.dataset.k));
  }
}
const row = (label, html) => `<div class="row"><span class="l">${label}</span>${html}</div>`;
const range = (k, min, max, step = 1) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" aria-label="${k}"><input type="number" data-k="${k}" min="${min}" max="${max}" step="${step}">`;
const color = k => `<input type="color" data-k="${k}">`;
const check = (k, label, cls) => `<label class="chk ${cls || ''}"><input type="checkbox" data-k="${k}"> ${label}</label>`;
const num = (k, lazy, scope) => `<input type="number" data-int="1" data-k="${k}" ${lazy ? 'data-lazy="1"' : ''} ${scope ? `data-scope="${scope}"` : ''} step="1">`;
const pick = (k, items) => `<select data-k="${k}">${items.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
const BLENDS = [['source-over', '보통'], ['multiply', '곱하기 (어둡게)'], ['screen', '스크린 (밝게)'], ['overlay', '오버레이'], ['soft-light', '소프트 라이트'], ['color', '색만 바꾸기']];
function fontSelect(cur) {
  const opts = [...SYS_FONTS.map(f => f[0]), ...fonts.map(f => f.name)];
  if (!opts.includes(cur)) opts.push(cur);
  return `<select data-k="font">${opts.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select><button class="btn sm" data-act="add-font" title="컴퓨터에 있는 글꼴 파일(TTF/OTF) 불러오기">+ 내 글꼴</button>`;
}
function segBtns(act, cur, items) { return `<div class="seg">${items.map(([v, l]) => `<button class="btn ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`; }
function sec(id, title, body, badge) {
  return `<details class="sec" data-sec="${id}" ${openSecs.has(id) ? 'open' : ''}><summary>${title}${badge ? `<span class="badge">${badge}</span>` : ''}</summary><div class="body">${body}</div></details>`;
}
function geomSec(el) {
  const wh = el.type === 'text' ? '' : `<span>폭</span>${num('w')}<span>높이</span>${num('h')}`;
  return sec('geom', '위치와 크기', `
    <div class="grid2"><span>X</span>${num('x')}<span>Y</span>${num('y')}${wh}</div>
    ${row('회전', range('rot', -180, 180, 1))}
    <div class="btnrow"><button class="btn sm" data-act="pg-hc">가로 가운데로</button>${el.type === 'panel' ? '<button class="btn sm" data-act="full-width">페이지 폭 꽉 채우기</button>' : ''}${el.rot ? '<button class="btn sm" data-act="rot0">회전 없애기</button>' : ''}</div>`);
}
const commonSec = () => `<div class="sec"><h3>순서</h3>
  <div class="btnrow"><button class="btn sm" data-act="front">맨 앞으로</button><button class="btn sm" data-act="forward">앞으로</button><button class="btn sm" data-act="backward">뒤로</button><button class="btn sm" data-act="back">맨 뒤로</button></div>
  <div class="btnrow"><button class="btn sm" data-act="dup">복제 <kbd>Ctrl+D</kbd></button><button class="btn sm danger" data-act="del">삭제 <kbd>Del</kbd></button></div></div>`;
const moodBtns = () => `<div class="moods">${MOODS.map((m, i) => `<button class="btn" data-act="mood" data-v="${i}">${m[0]}</button>`).join('')}</div>`;
const eyeSvg = on => on ? '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2" fill="currentColor"/></svg>' : '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 8s2.6-5 7-5 7 5 7 5-2.6 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".45"/><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.4"/></svg>';
const LS = html => html.replace(/data-k="/g, 'data-scope="layer" data-k="');
function layerName(el, i) {
  const L = layerObj(el, i), r = L && L.img ? images.get(L.img) : null;
  if (i === 0) return r ? '배경' : '배경 (비어 있음)';
  return r ? r.name.replace(/\.[^.]+$/, '') : `레이어 ${i}`;
}
function layerRows(el) {
  const n = el.layers ? el.layers.length : 0, act = getActiveIdx(el), rows = [];
  for (let i = n; i >= 0; i--) {
    if (i === 0 && !el.img) { if (n) rows.push(`<div class="lyr empty"><span class="nm muted">배경 비어 있음. 일반 그림을 놓으면 여기에 들어가요.</span></div>`); continue; }
    const L = layerObj(el, i), r = L.img ? images.get(L.img) : null;
    rows.push(`<div class="lyr ${i === act ? 'on' : ''} ${L.hidden ? 'off' : ''}" data-act="layer-pick" data-v="${i}" title="눌러서 이 그림 고르기">
      <button class="ic" data-act="layer-eye" data-v="${i}" title="${L.hidden ? '보이기' : '숨기기'}" aria-label="${L.hidden ? '보이기' : '숨기기'}">${eyeSvg(!L.hidden)}</button>
      <span class="lt">${r ? `<img src="${r.thumb || ''}" alt="">` : ''}</span>
      <span class="nm">${esc(layerName(el, i))}</span>
      ${i > 0 ? `<button class="ic" data-act="layer-up" data-v="${i}" title="위로" aria-label="위로" ${i === n ? 'disabled' : ''}>▲</button><button class="ic" data-act="layer-down" data-v="${i}" title="아래로" aria-label="아래로" ${i === 1 ? 'disabled' : ''}>▼</button>` : ''}
      <button class="ic" data-act="layer-del" data-v="${i}" title="이 그림 빼기" aria-label="이 그림 빼기">×</button>
    </div>`);
  }
  return rows.join('');
}
function panelProps(el) {
  const editing = imageEditId === el.id, n = layerCount(el), ai = getActiveIdx(el), A = activeObj(el), isBase = ai === 0;
  const r = A && A.img ? images.get(A.img) : null;
  const ctl = r ? `<div class="sub"><b>${esc(layerName(el, ai))}</b>
      <div class="btnrow"><button class="btn sm ${editing ? 'on' : ''}" data-act="img-edit">${editing ? '위치 조절 끝내기' : '끌어서 위치 조절'}</button>${isBase ? '<button class="btn sm" data-act="fit-cover">꽉 채우기</button>' : ''}<button class="btn sm" data-act="fit-contain">${isBase ? '전체 보이기' : '컷에 맞추기'}</button>${isBase ? '' : '<button class="btn sm" data-act="layer-center">가운데로</button>'}</div>
      ${LS(row('확대', range('iz', 0.05, 5, 0.01)) + row('회전', range('lrot', -180, 180, 1)) + row('불투명도', range('lop', 0, 100, 1)) + row('섞는 법', pick('lmode', BLENDS)))}
      <div class="btnrow">${LS(check('flip', '좌우 뒤집기'))}</div>
      <div class="btnrow"><button class="btn sm" data-act="layer-bg" title="가장자리와 이어진 단색 배경(흰색, 회색 등)을 지워요">배경 지우기</button><button class="btn sm" data-act="img-pick">다른 그림으로</button></div>
    </div>` : '';
  const img = `${n ? `<div class="layers">${layerRows(el)}</div>` : '<p class="muted">왼쪽 보관함의 그림을 이 컷으로 끌어다 놓거나, 보관함 그림을 클릭하면 들어가요.</p>'}
    <div class="btnrow"><button class="btn sm" data-act="layer-add" ${n >= MAX_LAYERS ? 'disabled' : ''}>+ 그림 겹치기</button>${n ? `<span class="muted small" style="align-self:center">${n} / ${MAX_LAYERS}장</span>` : ''}</div>
    <p class="muted small">배경이 투명한 그림을 컷 위로 끌어오면 레이어로 겹쳐져요. 일반 그림은 배경을 바꾸고, Shift를 누른 채 놓으면 겹쳐져요. 컷을 더블클릭한 뒤 그림을 누르면 그 레이어가 잡혀요.</p>
    ${ctl}`;
  const on = k => fx(el, k);
  const adjOn = A && (ADJ.some(k => k !== 'gray' && fx(A, k) !== FX[k]) || fx(A, 'gray'));
  const moodN = ['tintOn', 'gradOn', 'vigOn'].filter(on).length;
  const fxCopy = `<div class="btnrow"><button class="btn sm" data-act="fx-copy">효과 복사</button><button class="btn sm" data-act="fx-paste" ${fxClip ? '' : 'disabled'}>효과 붙여넣기</button></div>`;
  return sec('img', n > 1 ? '그림과 레이어' : '컷 그림', img, n > 1 ? `${n}장` : '') +
  (r ? sec('adj', layerCount(el) > 1 ? `그림 보정 (${esc(layerName(el, ai))})` : '그림 보정', LS(`
    ${row('밝기', range('bright', 30, 170, 1))}
    ${row('대비', range('contrast', 30, 200, 1))}
    ${row('채도', range('saturate', 0, 250, 1))}
    ${row('흐림', range('blur', 0, 20, 0.5))}
    ${row('세피아', range('sepia', 0, 100, 1))}
    ${row('색조', range('hue', -180, 180, 1))}
    <div class="btnrow">${check('gray', '흑백')}</div>`) + `
    <div class="btnrow"><button class="btn sm" data-act="adj-reset">보정 처음대로</button></div>`, adjOn ? '켜짐' : '') : '') + (r ? advSec(el, A) + aiSec() : '') +
  sec('mood', '분위기', `
    <p class="muted small" style="margin:0 0 6px">한 번에 바꾸기</p>${moodBtns()}
    <div class="sub">${check('tintOn', '색 입히기', 'head')}
      ${on('tintOn') ? row('색', `${color('tintColor')}`) + row('세기', range('tintA', 0, 100, 1)) + row('섞는 법', pick('tintMode', BLENDS)) : ''}</div>
    <div class="sub">${check('gradOn', '그라데이션', 'head')}
      ${on('gradOn') ? row('색', color('gradColor')) + row('진한 쪽', pick('gradDir', [['bottom', '아래'], ['top', '위'], ['left', '왼쪽'], ['right', '오른쪽'], ['tl', '왼쪽 위'], ['tr', '오른쪽 위'], ['bl', '왼쪽 아래'], ['br', '오른쪽 아래']])) + row('세기', range('gradA', 0, 100, 1)) + row('길이', range('gradLen', 5, 100, 1)) + row('섞는 법', pick('gradMode', BLENDS)) : ''}</div>
    <div class="sub">${check('vigOn', '비네팅 (가장자리 어둡게)', 'head')}
      ${on('vigOn') ? row('색', color('vigColor')) + row('세기', range('vigA', 0, 100, 1)) + row('밝은 영역', range('vigSize', 0, 120, 1)) : ''}</div>
    ${fxCopy}`, moodN ? `${moodN}개 켜짐` : '') +
  sec('tone', '스크린톤', `
    ${check('toneOn', '톤 넣기', 'head')}
    ${on('toneOn') ? `<div style="margin-top:8px">${segBtns('tone-type', on('toneType'), [['dot', '망점'], ['line', '선'], ['cross', '그물'], ['sand', '모래']])}</div>
      ${row('간격', range('toneGap', 3, 40, 0.5))}
      ${row('진하기', range('toneSize', 5, 100, 1))}
      ${on('toneType') !== 'sand' ? row('각도', range('toneAngle', 0, 180, 1)) : ''}
      ${row('색', color('toneColor'))}
      ${row('불투명도', range('toneA', 0, 100, 1))}
      ${row('흐려지는 쪽', pick('toneFade', [['none', '없음 (고르게)'], ['top', '위로 갈수록 흐리게'], ['bottom', '아래로 갈수록 흐리게'], ['left', '왼쪽으로 흐리게'], ['right', '오른쪽으로 흐리게'], ['center', '가운데를 비우기'], ['edge', '가장자리를 비우기']]))}` : ''}`, on('toneOn') ? '켜짐' : '') +
  sec('lines', '효과선', `
    ${check('lineOn', '효과선 넣기', 'head')}
    ${on('lineOn') ? `<div style="margin-top:8px">${segBtns('line-type', on('lineType'), [['focus', '집중선'], ['speed', '속도선']])}</div>
      ${row('개수', range('lineN', 10, 400, 1))}
      ${row(on('lineType') === 'focus' ? '가운데 빈 곳' : '가운데 빈 띠', range('lineIn', 0, 95, 1))}
      ${row('굵기', range('lineW', 0.5, 20, 0.5))}
      ${on('lineType') === 'focus' ? row('중심 가로', range('lineCx', 0, 100, 1)) + row('중심 세로', range('lineCy', 0, 100, 1)) : row('방향', range('lineAng', 0, 180, 1))}
      ${row('색', color('lineColor'))}
      ${row('불투명도', range('lineA', 0, 100, 1))}
      <div class="btnrow"><button class="btn sm" data-act="reseed">모양 다시 섞기</button></div>` : ''}`, on('lineOn') ? '켜짐' : '') +
  sec('border', '테두리와 모양', `
    ${row('두께', range('bw', 0, 40, 1))}
    ${row('색', color('bc'))}
    ${row('모서리', range('radius', 0, 200, 1))}
    ${row('바탕', `${check('fillOn', '칠하기')} ${color('fillColor')}`)}
    <div class="sub"><b>컷 자르기</b>
      <div class="btnrow"><button class="btn sm" data-act="split-line">직선으로 자르기</button><button class="btn sm" data-act="split-curve">곡선으로 자르기</button></div>
      ${el.clips && el.clips.length ? '<div class="btnrow"><button class="btn sm" data-act="unclip">사각형으로 되돌리기</button></div>' : ''}</div>`) +
  geomSec(el) + commonSec();
}
function bubbleProps(el) {
  return `<div class="sec"><h3>대사</h3><textarea class="big" data-k="text" rows="3" spellcheck="false"></textarea>
    <p class="muted small">Enter로 줄을 바꿔요. 캔버스에서 말풍선을 더블클릭해도 고칠 수 있어요.</p></div>
  <div class="sec"><h3>모양</h3>
    ${segBtns('shape', el.shape, [['round', '둥근'], ['box', '네모'], ['rect', '나레이션'], ['thought', '생각'], ['shout', '외침']])}
    <div class="btnrow" style="margin-top:9px">${check('tail', '꼬리')}&nbsp;&nbsp;${check('dash', '점선 (속삭임)')}</div>
    ${el.tail ? row('꼬리 굵기', range('tw', 4, 140, 1)) : ''}
    ${row('바탕색', color('fill'))}
    ${row('선 색', color('stroke'))}
    ${row('선 두께', range('sw', 0, 16, 0.5))}
    ${el.tail ? '<p class="muted small">파란 동그라미를 끌어서 꼬리 방향을 바꿔요.</p>' : ''}
  </div>
  <div class="sec"><h3>글자</h3>
    ${row('글꼴', fontSelect(el.font))}
    ${row('크기', range('fs', 8, 140, 1))}
    ${row('색', `${color('color')}&nbsp;${check('bold', '굵게')}&nbsp;${check('italic', '기울임')}`)}
    ${row('글자 테두리', `${color('tsc')}`)}
    ${row('', range('tsw', 0, 12, 0.5))}
    ${row('줄 간격', range('lh', 0.8, 2.5, 0.05))}
    ${row('정렬', segBtns('talign', el.align, [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]))}
    <div class="btnrow">${check('auto', '글자에 맞춰 크기 자동 조절')}</div>
  </div>${geomSec(el)}${commonSec()}`;
}
function textProps(el) {
  return `<div class="sec"><h3>글자</h3><textarea class="big" data-k="text" rows="2" spellcheck="false"></textarea>
    <p class="muted small">모서리를 끌면 글자 크기가 함께 바뀌어요.</p>
    <p class="muted small" style="margin:8px 0 4px">스타일 한 번에 바꾸기</p>
    <div class="sfxbtns">${TEXT_STYLES.map((t, i) => `<button class="btn" data-act="tstyle" data-v="${i}">${t.n}</button>`).join('')}</div></div>
  ${sec('tglow', '후광 (빛 번짐)', `
    ${row('크기', range('glow', 0, 100, 1))}
    ${row('색', color('glowColor'))}
    ${row('세기', range('glowA', 10, 100, 1))}
    <p class="muted small">글자 둘레로 빛이 번지는 효과예요. 크기가 0이면 꺼져요.</p>`, el.glow > 0 ? '켜짐' : '')}
  ${sec('tshadow', '그림자', `
    ${row('진하기', range('shA', 0, 100, 1))}
    ${row('색', color('shColor'))}
    ${row('방향', range('shAng', 0, 360, 1))}
    ${row('거리', range('shDist', 0, 60, 1))}
    ${row('흐림', range('shBlur', 0, 60, 1))}
    <p class="muted small">진하기가 0이면 꺼져요.</p>`, el.shA > 0 ? '켜짐' : '')}
  ${sec('tbox', '배경 띠 (자막)', `
    ${check('boxOn', '글자 뒤에 띠 깔기', 'head')}
    ${el.boxOn ? row('색', color('boxColor')) + row('불투명도', range('boxA', 0, 100, 1)) + row('여백', range('boxPad', 0, 120, 1)) + row('모서리', range('boxR', 0, 100, 1)) : ''}`, el.boxOn ? '켜짐' : '')}
  ${sec('sfx', '효과음 스타일', `
    <div class="sfxbtns">${SFX_PRESETS.map((p, i) => `<button class="btn" data-act="sfx" data-v="${i}">${p.n}</button>`).join('')}</div>
    ${row('흔들림', range('jit', 0, 100, 1))}
    ${row('거칠기', range('rough', 0, 100, 1))}
    ${row('기울기', range('skew', -45, 45, 1))}
    ${row('점점 크게', range('grow', -100, 100, 1))}
    ${row('글자 간격', range('sp', -40, 80, 1))}
    <div class="btnrow"><button class="btn sm" data-act="reseed">흔들림 다시 섞기</button></div>
    ${row('휘기', range('arc', -100, 100, 1))}
    <div class="sub">${row('입체', range('ext', 0, 60, 1))}
      ${el.ext > 0 ? row('입체 방향', range('extAng', 0, 360, 1)) + row('입체 색', color('extColor')) : ''}</div>`)}
  <div class="sec"><h3>꾸미기</h3>
    ${row('글꼴', fontSelect(el.font))}
    ${row('크기', range('fs', 8, 400, 1))}
    ${row('글자색', `${color('color')}&nbsp;${check('fillGrad', '그라데이션')}${el.fillGrad ? '&nbsp;' + color('fill2') : ''}`)}
    ${el.fillGrad ? row('방향', segBtns('tgrad', el.gradDir === 'h' ? 'h' : 'v', [['v', '위→아래'], ['h', '왼→오른']])) : ''}
    <div class="btnrow">${check('bold', '굵게')}&nbsp;&nbsp;${check('italic', '기울임')}&nbsp;&nbsp;${check('vert', '세로쓰기')}</div>
    ${row('불투명도', range('op', 5, 100, 1))}
    ${row('외곽선 색', color('sc'))}
    ${row('외곽선', range('sw', 0, 40, 0.5))}
    ${row('바깥 테두리', `${color('sc2')}`)}
    ${row('', range('sw2', 0, 40, 0.5))}
    ${row('줄 간격', range('lh', 0.7, 2.5, 0.05))}
    ${row('정렬', segBtns('talign', el.align, [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]))}
  </div>${geomSec(el)}${commonSec()}`;
}
function stampProps(el) {
  const r = imgRec(el);
  const pk = el.pk && findPack(el.pk), w = pk && pk.words[el.pw];
  return `<div class="sec"><h3>효과음 그림</h3>
    ${r ? `<div class="imgbox"><img src="${r.thumb || ''}" alt="" style="object-fit:contain"><div class="imgname">${esc(r.name)}</div></div>` : ''}
    ${w ? row('버전', segBtns('stamp-var', el.pv || 'ink', [['ink', '먹선'], ['outline', '흰 테두리'], ['white', '흰펜']])) : ''}
    ${row('', check('tintOn', '색 바꾸기') + (el.tintOn ? '&nbsp;' + color('tint') : ''))}
    ${row('테두리', color('oc'))}
    ${row('', range('ow', 0, 40, 0.5))}
    ${row('불투명도', range('op', 5, 100, 1))}
    <div class="btnrow">${check('flip', '좌우 뒤집기')}</div>
    <div class="btnrow"><button class="btn sm" data-act="stamp-white">흰 배경 지우기</button></div>
    <p class="muted small">흰 테두리를 넣으면 웹툰 효과음처럼 그림 위에서 잘 보여요.</p>
  </div>${geomSec(el)}${commonSec()}`;
}
function drawProps() {
  return `<div class="sec"><h3>손그림</h3>
    ${row('색', color('color'))}
    ${row('테두리', color('oc'))}
    ${row('', range('ow', 0, 30, 0.5))}
    ${row('불투명도', range('op', 5, 100, 1))}
    <p class="muted small">모서리를 끌면 크기를, 위쪽 동그라미로 방향을 바꿔요.</p>
  </div>${geomSec(selEls()[0])}${commonSec()}`;
}
function fxProps(el) {
  if (el.kind === 'paint' && el.soft === undefined) el.soft = 0; // 예전에 칠한 것은 또렷한 그대로
  return `<div class="sec"><h3>가리기</h3>
    ${segBtns('fx-kind', el.kind, [['blur', '블러'], ['mosaic', '모자이크'], ['paint', '흰칠'], ['erase', '지우기'], ['clone', '도장'], ['heal', '잡티 지우기']])}
    ${el.kind === 'paint' ? row('색', color('color')) + row('부드럽게', range('soft', 0, 24, 1)) : (el.kind === 'erase' || el.kind === 'clone' || el.kind === 'heal') ? row('부드럽게', range('soft', 0, 24, 1)) : row('세기', range('str', 2, el.kind === 'mosaic' ? 60 : 40, 1))}
    ${el.polys && el.polys.length ? row('윤곽 여유', range('pad', 0, 16, 1)) : ''}
    ${el.mask ? '<p class="muted small">선택 도구로 만든 거예요.</p>' : '<div class="btnrow"><button class="btn sm" data-act="fx-continue">이어서 칠하기</button></div>'}
    ${el.inPanel ? `<p class="muted small">자동 흰칠로 칠한 거예요. 그 컷 안에만 칠해지고, 컷을 옮기면 같이 움직여요. 잘못 칠했으면 <kbd>Delete</kbd>로 지우세요.</p>` : ''}
    <p class="muted small">이 요소보다 아래에 있는 것만 가려져요. 말풍선이나 효과음까지 가리려면 '맨 앞으로'를 누르세요.</p>
  </div>${commonSec()}`;
}
function multiProps() {
  const ss = selEls(), n = ss.length, panels = ss.filter(e => e.type === 'panel').length;
  return `<div class="sec"><h3>${n}개 선택됨</h3>
    <p class="muted small">선택한 것들끼리 줄 맞추기</p>
    <div class="btnrow"><button class="btn sm" data-act="al-left">왼쪽</button><button class="btn sm" data-act="al-hc">가로 가운데</button><button class="btn sm" data-act="al-right">오른쪽</button></div>
    <div class="btnrow"><button class="btn sm" data-act="al-top">위</button><button class="btn sm" data-act="al-vc">세로 가운데</button><button class="btn sm" data-act="al-bottom">아래</button></div>
    ${n >= 3 ? '<div class="btnrow"><button class="btn sm" data-act="dist-v">세로 간격 똑같이</button><button class="btn sm" data-act="dist-h">가로 간격 똑같이</button></div>' : ''}
    <div class="btnrow"><button class="btn sm" data-act="pg-hc">한 덩어리로 페이지 가운데로</button></div>
  </div>
  ${panels ? `<div class="sec"><h3>고른 컷 ${panels}개의 분위기</h3>${moodBtns()}<div class="btnrow" style="margin-top:8px"><button class="btn sm" data-act="fx-paste" ${fxClip ? '' : 'disabled'}>복사한 효과 붙여넣기</button></div>
    <div class="btnrow"><button class="btn sm" data-act="split-line">직선으로 자르기</button><button class="btn sm" data-act="split-curve">곡선으로 자르기</button></div></div>` : ''}
  ${commonSec()}`;
}
const aaSec = () => `<div class="sec"><h3>가장자리 매끄럽게</h3>
    ${row('세기', `<input type="range" data-k="soft" data-scope="aa" min="0" max="100" step="1" aria-label="가장자리 매끄럽게"><input type="number" data-k="soft" data-scope="aa" min="0" max="100" step="1">`)}
    <p class="muted small">말풍선, 글자, 손그림, 컷 테두리를 더 곱게 그려요. 0이면 예전처럼 또렷하게. 작품 전체에 적용돼요.</p></div>`;
function imgPageProps() {
  const p = page();
  if (p.ph) return `<div class="sec"><h3>이미지 편집</h3><p class="muted">왼쪽 위 <b>+ 그림</b>이나 <b>+ 폴더째</b>로 고칠 그림을 불러오세요. 그림이나 폴더를 화면으로 바로 끌어와도 돼요.</p></div>${aaSec()}`;
  const rec = p.img && images.get(p.img), B = baseEl(p);
  const changed = p.els.length > 1 || (rec && (p.w !== rec.w || p.h !== rec.h)) || (B && (B.rot || B.flip));
  return `<div class="sec"><h3>이 그림</h3>
    <div class="imginfo"><span>이름</span><span title="${esc(p.name)}">${esc(p.name)}</span><span>크기</span><span>${p.w} × ${p.h}${rec && (rec.w !== p.w || rec.h !== p.h) ? ` (원본 ${rec.w} × ${rec.h})` : ''}</span></div>
    ${row('폴더', `<select data-act="pg-folder"><option value="">폴더 없음</option>${folderOptions(p.folder)}</select>`)}
    <div class="btnrow"><button class="btn sm" data-act="crop">자르기</button><button class="btn sm" data-act="rot-l">왼쪽으로 돌리기</button><button class="btn sm" data-act="rot-r">오른쪽으로 돌리기</button>${B ? '<button class="btn sm" data-act="flip-img">좌우 뒤집기</button>' : ''}</div>
    <div class="btnrow"><button class="btn sm" data-act="img-reset" ${changed ? '' : 'disabled'}>처음 상태로</button><button class="btn sm danger" data-act="img-del">목록에서 빼기</button></div>
    ${row('바탕색', `<input type="color" data-k="bg" data-scope="page">`)}
    <p class="muted small">바탕색은 투명한 그림 뒤나 늘린 캔버스에 깔리는 색이에요.</p>
  </div>
  ${sizeSec()}
  ${aaSec()}
  <div class="sec"><h3>이렇게 써요</h3><ol class="tips">
    <li>왼쪽 목록에서 고칠 그림을 눌러요. <kbd>PageUp</kbd>/<kbd>PageDown</kbd>으로 앞뒤 그림을 넘겨요.</li>
    <li>위쪽 <b>말풍선</b>, <b>글자</b>, <b>가리기</b>, <b>자동 흰칠</b>, <b>자르기</b>로 고쳐요.</li>
    <li>글자 같은 것을 고르면 오른쪽 아래 <b>다른 그림에도 넣기</b>로 서명·워터마크를 한 번에 넣을 수 있어요.</li>
    <li>다 되면 <b>내보내기</b>로 원래 이름 그대로 저장해요. NAI 정보를 지울지 고를 수 있어요.</li></ol>
    <p class="muted small" style="margin-top:8px">폴더 정리: 왼쪽 <b>새 폴더</b>로 폴더를 만들고 그림을 폴더 이름 위로 끌어다 놓아요.</p></div>`;
}
function lockProps(el) {
  let h = panelProps(el);
  h = h.replace(/<details class="sec" data-sec="(img|border|geom)"[\s\S]*?<\/details>/g, '');
  const i = h.indexOf('<div class="sec"><h3>순서</h3>'); if (i >= 0) h = h.slice(0, i);
  return `<div class="sec"><h3>바탕 그림</h3><p class="muted small">불러온 그림이에요. 움직이지 않게 고정돼 있어요. 아래에서 밝기와 분위기를 바꿀 수 있어요. 그림 위를 끌면 위에 올린 것들을 한꺼번에 고를 수 있어요.</p></div>` + h;
}
function copySec() {
  const p = page(), fo = p.folder && folderById(p.folder);
  return `<div class="sec"><h3>다른 그림에도 넣기</h3><p class="muted small">고른 것(글자, 말풍선, 효과음, 가리기)을 다른 그림에도 같은 자리에 넣어요. 서명이나 워터마크를 한 번에 넣을 때 좋아요.</p>
    <div class="btnrow">${fo ? `<button class="btn sm" data-act="copy-fold">'${esc(fo.name)}' 폴더 전체에</button>` : ''}<button class="btn sm" data-act="copy-all">모든 그림에</button></div></div>`;
}
function pageProps() {
  const p = page(), pi = PRESETS.findIndex(x => x.w === p.w && x.h === p.h);
  return `<div class="sec"><h3>페이지 설정</h3>
    ${row('이름', `<input type="text" data-k="name" data-scope="page" spellcheck="false">`)}
    ${row('크기', `<select data-act="preset"><option value="">직접 입력</option>${PRESETS.map((x, i) => `<option value="${i}" ${i === pi ? 'selected' : ''}>${x.name} ${x.w}×${x.h}</option>`).join('')}</select>`)}
    <div class="grid2"><span>폭</span>${num('w', 1, 'page')}<span>높이</span>${num('h', 1, 'page')}</div>
    ${row('배경색', `<input type="color" data-k="bg" data-scope="page">`)}
    <div class="btnrow"><button class="btn sm" data-act="pg-extend">아래로 1000px 늘리기</button><button class="btn sm" data-act="pg-fit">내용 끝에 맞춰 줄이기</button></div>
  </div>
  ${aaSec()}
  <div class="sec"><h3>이렇게 써요</h3><ol class="tips">
    <li>왼쪽 <b>+ 그림</b>이나 <b>+ 폴더째</b>로 NAI 그림을 넣어요. <b>새 폴더</b>로 나눠 담을 수 있어요.</li>
    <li>그림을 캔버스로 끌어다 놓으면 컷이 생겨요. 컷 위에 놓으면 그 컷에 들어가요.</li>
    <li>위쪽 <b>컷 나누기</b>로 칸을 나누거나 선을 그어 비스듬히 잘라요.</li>
    <li>컷을 고르면 오른쪽에서 <b>분위기, 스크린톤, 효과선</b>을 넣을 수 있어요.</li>
    <li><b>말풍선</b>, <b>글자</b>, <b>펜</b>으로 대사와 효과음을 넣어요.</li>
    <li>다 되면 <b>이미지로 내보내기</b>를 눌러요.</li>
  </ol>
  <p class="muted small" style="margin-top:10px">여러 개 고르기: <kbd>Shift</kbd>+클릭<br>화면 끌기: <kbd>Space</kbd>+드래그<br>확대와 축소: <kbd>Ctrl</kbd>+휠</p></div>`;
}
function renderProps() {
  const ss = selEls();
  if (ss.length !== sel.length) sel = ss.map(e => e.id);
  let html;
  if (!ss.length) html = isImg() ? imgPageProps() : pageProps();
  else if (ss.length > 1) html = multiProps();
  else html = ss[0].lock ? lockProps(ss[0]) : ({ panel: panelProps, bubble: bubbleProps, text: textProps, stamp: stampProps, draw: drawProps, fx: fxProps })[ss[0].type](ss[0]);
  if (isImg() && ss.some(o => !o.lock && !o.inPanel) && realIdx().length > 1) html += copySec();
  const st = $('#right').scrollTop;
  propsEl.innerHTML = html;
  if (ss.length === 1) { const f = $('select[data-k="font"]', propsEl); if (f) f.value = ss[0].font; }
  syncProps(); $('#right').scrollTop = st; renderLayersSoon();
}
propsEl.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.sec) { d.open ? openSecs.add(d.dataset.sec) : openSecs.delete(d.dataset.sec); } }, true);
propsEl.addEventListener('input', e => {
  const t = e.target, k = t.dataset.k; if (!k || t.dataset.lazy) return;
  const v = readVal(t), tg = scopeTargets(t); if (!tg.length) return;
  for (const o of tg) setProp(o, k, v);
  for (const x of $$(`[data-k="${k}"]`, propsEl)) if (x !== t && (x.dataset.scope || '') === (t.dataset.scope || '')) writeVal(x, getProp(tg[0], k));
  if (['x', 'y', 'w', 'h', 'fs', 'sw', 'sw2'].includes(k)) syncProps();
  requestRender();
});
propsEl.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.act === 'pg-folder') { page().folder = t.value || null; commit(); renderLib(); return; }
  if (t.dataset.act === 'preset') { const pr = PRESETS[+t.value]; if (pr) { page().w = pr.w; page().h = pr.h; layoutSpacer(); fitView(); commit(); renderProps(); renderPages(); } return; }
  const k = t.dataset.k; if (!k) return;
  if (t.dataset.lazy) {
    const v = readVal(t); const tg = t.dataset.scope === 'page' ? page() : selEls()[0];
    if (tg && v !== null) { const vv = t.dataset.scope === 'page' ? clamp(Math.round(v), 50, 60000) : v; setProp(tg, k, vv); }
    if (t.dataset.scope === 'page') { layoutSpacer(); renderPages(); }
    syncProps(); requestRender();
  }
  if (t.dataset.scope === 'page' && k === 'name') renderPages();
  commit();
  if (t.type === 'checkbox' || t.tagName === 'SELECT' || ['ext'].includes(k)) renderProps();
});
propsEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'SELECT' || b.disabled) return;
  doAct(b.dataset.act, b.dataset.v);
});
function applyMood(el, i) { pasteFx(el, MOODS[i][1]); }
function pasteFx(el, src) {
  for (const k of FX_KEYS) delete el[k];
  for (const L of el.layers || []) for (const k of ADJ) delete L[k];
  Object.assign(el, clone(src));
  for (const L of el.layers || []) for (const k of ADJ) if (src[k] !== undefined) L[k] = src[k];
}
async function stampWhite(el) {
  const r = imgRec(el); if (!r) return;
  toast('흰 배경을 지우는 중…', 1500);
  const src = await whiteToAlpha(r.src), im = await loadImg(src);
  r.src = src; r.thumb = null; makeThumb(r, im, true); imgCache.set(r.id, im); clearImgCaches(r.id);
  idb.put('imgs', { id: r.id, name: r.name, src: r.src, w: r.w, h: r.h, thumb: r.thumb, kind: r.kind });
  const s = stamps.get(r.id); if (s) { s.src = src; s.thumb = r.thumb; idb.put('stamps', s); renderStamps(); }
  renderProps(); requestRender(); toast('흰 배경을 지웠어요');
}
function doAct(act, v) {
  const ss = selEls(), el = ss[0], pg = page();
  if (act.startsWith('adv-')) { advAct(act, v); return; }
  if (act.startsWith('sz-')) { sizeAct(act, v); return; }
  if (act.startsWith('ai-')) { aiAct(act, v); return; }
  switch (act) {
    case 'shape': for (const o of ss) setProp(o, 'shape', v); break;
    case 'talign': for (const o of ss) setProp(o, 'align', v); break;
    case 'tone-type': for (const o of ss) o.toneType = v; break;
    case 'line-type': for (const o of ss) o.lineType = v; break;
    case 'reseed': for (const o of ss) { o.seed = (o.seed || 1) + 1; if (o.type === 'text') fitText(o); } break;
    case 'fit-cover': if (el) { const A = activeObj(el); A.iz = 1; A.ox = 0; A.oy = 0; A.lrot = 0; } break;
    case 'fit-contain': { const A = el && activeObj(el), r = A && A.img && images.get(A.img); if (r) { A.iz = Math.min(el.w / r.w, el.h / r.h) / Math.max(el.w / r.w, el.h / r.h); A.ox = 0; A.oy = 0; } break; }
    case 'layer-center': { const A = el && activeObj(el); if (A) { A.ox = 0; A.oy = 0; } break; }
    case 'img-edit': if (el) toggleImageEdit(el); return;
    case 'img-pick': if (el) { panelPickTarget = { id: el.id, li: getActiveIdx(el) }; $('#filePanelImg').multiple = false; $('#filePanelImg').click(); } return;
    case 'layer-add': if (el) { panelPickTarget = { id: el.id, li: 'add' }; $('#filePanelImg').multiple = true; $('#filePanelImg').click(); } return;
    case 'layer-pick': if (el) { activeLayer.set(el.id, +v); renderProps(); requestRender(); } return;
    case 'layer-eye': if (el) { const L = layerObj(el, +v); if (L) L.hidden = !L.hidden; } break;
    case 'layer-up': case 'layer-down': if (el && el.layers) {
      const i = +v - 1, j = act === 'layer-up' ? i + 1 : i - 1;
      if (j >= 0 && j < el.layers.length) { [el.layers[i], el.layers[j]] = [el.layers[j], el.layers[i]]; activeLayer.set(el.id, j + 1); }
    } break;
    case 'layer-del': if (el) {
      const i = +v;
      if (i === 0) { el.img = null; } else el.layers.splice(i - 1, 1);
      if (el.layers && !el.layers.length) delete el.layers;
      activeLayer.delete(el.id); if (!layerCount(el)) imageEditId = null;
    } break;
    case 'layer-bg': if (el) layerRemoveBg(el); return;
    case 'add-font': $('#fileFont').click(); return;
    case 'adj-reset': { const A = activeObj(el); if (A) for (const k of ADJ) delete A[k]; break; }
    case 'mood': for (const o of ss) if (o.type === 'panel') applyMood(o, +v); break;
    case 'fx-copy': if (el) { fxClip = {}; for (const k of FX_KEYS) if (el[k] !== undefined) fxClip[k] = el[k]; toast('효과를 복사했어요. 다른 컷을 고르고 붙여넣으세요.'); renderProps(); } return;
    case 'fx-paste': if (fxClip) for (const o of ss) if (o.type === 'panel') pasteFx(o, fxClip); break;
    case 'split-line': case 'split-curve': setMode('split', act === 'split-line' ? 'line' : 'curve'); return;
    case 'unclip': if (el) delete el.clips; break;
    case 'sfx': if (el) { const p = SFX_PRESETS[+v]; Object.assign(el, clone(p.p)); fitText(el); } break;
    case 'tstyle': for (const o of ss) if (o.type === 'text') { Object.assign(o, clone(TEXT_STYLES[+v].p)); fitText(o); } break;
    case 'tgrad': for (const o of ss) if (o.type === 'text') o.gradDir = v; break;
    case 'stamp-white': if (el) stampWhite(el); return;
    case 'stamp-var': if (el) switchPackVariant(el, v); break;
    case 'fx-kind': if (el) { el.kind = v; if (v === 'mosaic' && el.str < 6) el.str = 10; } break;
    case 'fx-continue': if (el) setMode('brush', el.id); return;
    case 'crop': setMode('crop'); return;
    case 'rot-l': case 'rot-r': rotatePage(act === 'rot-r' ? 1 : -1); sel = []; commit(); fitView(); renderAll(); return;
    case 'flip-img': { const B = baseEl(pg); if (B) { B.flip = !B.flip; B.rot = -(B.rot || 0); } break; }
    case 'img-reset': {
      const r = pg.img && images.get(pg.img); if (!r) return;
      if (!confirm('이 그림에 한 것(글자, 가리기, 자르기 등)을 모두 지우고 처음 상태로 돌릴까요?')) return;
      const f = makeImagePage(pg.img, pg.folder); pg.w = f.w; pg.h = f.h; pg.els = f.els; sel = []; commit(); fitView(); renderAll(); return;
    }
    case 'img-del': deleteImagePage(doc.cur); return;
    case 'copy-all': copyToPages(realIdx()); return;
    case 'copy-fold': copyToPages(realIdx().filter(i => inFolder(doc.pages[i].folder, pg.folder))); return;
    case 'rot0': if (el) el.rot = 0; break;
    case 'front': case 'back': case 'forward': case 'backward': layer(act); break;
    case 'dup': duplicateSel(); return;
    case 'del': deleteSel(); return;
    case 'pg-hc': { const b = unionBox(ss.map(aabb)); if (b) { const dx = pg.w / 2 - (b.x + b.w / 2); ss.forEach(o => moveBy(o, dx, 0)); } break; }
    case 'full-width': if (el) fullWidth(el); break;
    case 'al-left': case 'al-hc': case 'al-right': case 'al-top': case 'al-vc': case 'al-bottom': alignSel(act); break;
    case 'dist-v': case 'dist-h': distributeSel(act === 'dist-v'); break;
    case 'pg-extend': pg.h += 1000; layoutSpacer(); renderPages(); break;
    case 'pg-fit': { const b = contentBottom(pg); if (b > 0) { pg.h = Math.max(100, Math.ceil(b + 60)); layoutSpacer(); renderPages(); } else toast('페이지에 아직 아무것도 없어요'); break; }
    default: return;
  }
  commit(); renderProps(); requestRender();
}
function fullWidth(el) {
  const pg = page(), o = clone(el), cx = el.x + el.w / 2;
  el.rot = 0; el.x = 0; el.w = pg.w;
  reframe(el, o, { x: pg.w / 2 - cx, y: 0 });
}
async function layerRemoveBg(el) {
  const ai = getActiveIdx(el), A = layerObj(el, ai), r = A && A.img && images.get(A.img); if (!r) return;
  toast('배경을 지우는 중…', 1500);
  const src = await removeBg(r.src);
  if (!src) { toast('지울 배경을 찾지 못했어요. 가장자리가 한 가지 색(흰색, 회색 등)인 그림에서 잘 돼요.', 4000); return; }
  const im = await loadImg(src);
  const rec = { id: uid(), name: r.name.replace(/\.[^.]+$/, '') + ' (배경 지움).png', src, w: im.naturalWidth, h: im.naturalHeight, alpha: true };
  addImageRecord(rec, true, im); renderLib();
  A.img = rec.id;
  commit(); renderProps(); requestRender(); toast('배경을 지웠어요. 보관함에도 따로 넣어 뒀어요.');
}
function layer(op) {
  const pg = page(), ids = new Set(sel), els = pg.els;
  const a = els.filter(e => !ids.has(e.id)), b = els.filter(e => ids.has(e.id));
  if (op === 'front') pg.els = [...a, ...b];
  else if (op === 'back') pg.els = [...b, ...a];
  else if (op === 'forward') { for (let i = els.length - 2; i >= 0; i--) if (ids.has(els[i].id) && !ids.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]]; }
  else { for (let i = 1; i < els.length; i++) if (ids.has(els[i].id) && !ids.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]]; }
  pg.els = [...pg.els.filter(e => e.lock), ...pg.els.filter(e => !e.lock)]; // 바탕 그림은 늘 맨 뒤
}
function alignSel(act) {
  const ss = selEls(), B = unionBox(ss.map(aabb)); if (!B) return;
  for (const o of ss) {
    const b = aabb(o); let dx = 0, dy = 0;
    if (act === 'al-left') dx = B.x - b.x; if (act === 'al-hc') dx = B.x + B.w / 2 - (b.x + b.w / 2); if (act === 'al-right') dx = B.x + B.w - (b.x + b.w);
    if (act === 'al-top') dy = B.y - b.y; if (act === 'al-vc') dy = B.y + B.h / 2 - (b.y + b.h / 2); if (act === 'al-bottom') dy = B.y + B.h - (b.y + b.h);
    moveBy(o, dx, dy);
  }
}
function distributeSel(vert) {
  const ss = selEls().map(o => ({ o, b: aabb(o) })); if (ss.length < 3) return;
  ss.sort((p, q) => vert ? p.b.y - q.b.y : p.b.x - q.b.x);
  const B = unionBox(ss.map(s => s.b)), total = ss.reduce((s, x) => s + (vert ? x.b.h : x.b.w), 0);
  const gap = ((vert ? B.h : B.w) - total) / (ss.length - 1); let pos = vert ? B.y : B.x;
  for (const s of ss) { if (vert) moveBy(s.o, 0, pos - s.b.y); else moveBy(s.o, pos - s.b.x, 0); pos += (vert ? s.b.h : s.b.w) + gap; }
}
function duplicateSel() {
  const ss = selEls().filter(o => !o.lock); if (!ss.length) return;
  const copies = ss.map(o => { const c = clone(o); c.id = uid(); moveBy(c, 24, 24); return c; });
  page().els.push(...copies); sel = copies.map(c => c.id); commit(); renderProps(); requestRender();
}
function deleteSel() {
  if (!sel.length) return;
  const ids = new Set(sel.filter(id => { const el = findEl(id); return el && !el.lock; }));
  if (!ids.size) { toast('바탕 그림은 지울 수 없어요. 목록에서 빼려면 왼쪽 그림의 ×를 누르세요.', 3200); return; }
  for (const f of czLinked(page().els, ids)) ids.add(f.id); // 지운 컷의 자동 흰칠도 같이
  page().els = page().els.filter(e => !ids.has(e.id)); sel = []; imageEditId = null; commit(); renderProps(); requestRender();
}

/*@@ADV@@*/
/*@@LAYERS@@*/
/*@@SEL@@*/
/*@@AI@@*/
/* ================= 그림 보관함 ================= */
let libT = null;
function renderLibSoon() { if (isImg()) return; clearTimeout(libT); libT = setTimeout(renderLib, 120); }
const closedFolders = new Set();
function foldHead(f, n) {
  if (!f) return `<div class="fold none" data-fold="" title="그림을 여기로 끌어오면 폴더에서 빠져요">폴더 없음 <span class="n">${n}</span></div>`;
  return `<div class="fold ${closedFolders.has(f.id) ? 'closed' : ''}" data-fold="${f.id}" draggable="true" style="--d:${folderDepth(f.id)}" title="눌러서 접고 펴기&#10;그림이나 다른 폴더를 여기로 끌어오면 이 폴더 안으로 옮겨요&#10;폴더 이름을 끌어서 다른 폴더 안으로 옮길 수 있어요"><span class="nm">${esc(f.name)}</span><span class="n">${n}</span><button class="fb" data-fsub="${f.id}" title="이 안에 새 폴더" aria-label="이 안에 새 폴더">+</button><button class="fb" data-fren="${f.id}" title="폴더 이름 바꾸기" aria-label="폴더 이름 바꾸기">✎</button><button class="fb" data-fdel="${f.id}" title="폴더 지우기 (안의 그림은 남아요)" aria-label="폴더 지우기">×</button></div>`;
}
function grouped(keys, folderOf) {
  const none = [], by = new Map((doc.folders || []).map(f => [f.id, []]));
  for (const k of keys) { const fid = folderOf(k); (fid && by.has(fid) ? by.get(fid) : none).push(k); }
  return { none, by };
}
// 폴더 나무를 위에서부터: 머리줄(아래 폴더까지 센 수) → 그 폴더 그림 → 하위 폴더
function folderTreeHtml(by, thumb, pid = null) {
  let h = '';
  for (const f of folderKids(pid)) {
    const L = by.get(f.id) || [], kids = folderKids(f.id).length;
    let tot = 0; for (const id of folderDesc(f.id)) tot += (by.get(id) || []).length;
    h += foldHead(f, kids ? `${L.length}${tot !== L.length ? ` · 전체 ${tot}` : ''}` : L.length);
    if (closedFolders.has(f.id)) continue;
    h += L.map(thumb).join('');
    if (!L.length && !kids) h += '<div class="foldempty">비어 있어요. 그림을 여기로 끌어오세요.</div>';
    h += folderTreeHtml(by, thumb, f.id);
  }
  return h;
}
function cutThumb(id, used) {
  const r = images.get(id); if (!r) return ''; const mi = marks.indexOf(id);
  return `<div class="thumb ${r.alpha ? 'alpha' : ''}" draggable="true" data-id="${id}" title="${esc(r.name)}&#10;클릭: 넣기, 끌기: 원하는 곳에 놓기 (폴더 이름 위에 놓으면 그 폴더로)${r.alpha ? '&#10;배경이 투명한 그림이라 컷 위에 놓으면 레이어로 겹쳐져요' : ''}"><img src="${r.thumb || ''}" alt="${esc(r.name)}">${r.alpha ? '<span class="tp">투명</span>' : ''}
      <button class="mark ${mi >= 0 ? 'on' : ''}" data-mark="${id}" title="자동 배치 순서 고르기" aria-label="자동 배치 순서">${mi >= 0 ? mi + 1 : ''}</button>
      <button class="del" data-del="${id}" title="보관함에서 빼기" aria-label="보관함에서 빼기">×</button>${used.has(id) ? '<span class="used">사용 중</span>' : ''}</div>`;
}
function pageThumb(i) {
  const p = doc.pages[i], edited = p.els.length > 1 || (baseEl(p) && (p.w !== baseEl(p).w || p.h !== baseEl(p).h));
  return `<div class="thumb pgt ${i === doc.cur ? 'on' : ''}" draggable="true" data-page="${i}" title="${esc(p.name)}&#10;클릭: 이 그림 고치기, 끌기: 폴더 이름 위에 놓으면 그 폴더로"><canvas data-pt="${i}"></canvas>${edited ? '<span class="ed" title="고친 그림"></span>' : ''}<span class="cap">${esc(p.name)}</span><button class="del" data-pdel="${i}" title="목록에서 빼기" aria-label="목록에서 빼기">×</button></div>`;
}
function renderLib() {
  const grid = $('#lib');
  if (isImg()) {
    const idx = realIdx();
    if (!idx.length) { grid.innerHTML = `<div class="empty">고칠 그림이나 폴더를 여기로 끌어오거나<br>위 버튼으로 불러오세요.<br><br><span class="small">폴더째 넣으면 폴더 이름 그대로 묶여요.</span></div>`; $('#markInfo').textContent = ''; return; }
    const { none, by } = grouped(idx, i => doc.pages[i].folder);
    let h = (doc.folders || []).length ? foldHead(null, none.length) : '';
    h += none.map(pageThumb).join('');
    h += folderTreeHtml(by, pageThumb);
    grid.innerHTML = h; observeThumbs(); return;
  }
  const used = usedSet();
  marks = marks.filter(id => images.has(id));
  if (!imageOrder.length && !(doc.folders || []).length) grid.innerHTML = `<div class="empty">그림 파일을 여기로 끌어오거나<br>위 버튼으로 불러오세요.<br><br><span class="small">여러 장이나 폴더를 한꺼번에 넣어도 돼요.</span></div>`;
  else if (!(doc.folders || []).length) grid.innerHTML = imageOrder.map(id => cutThumb(id, used)).join('');
  else {
    const { none, by } = grouped(imageOrder, id => (images.get(id) || {}).folder);
    let h = foldHead(null, none.length) + none.map(id => cutThumb(id, used)).join('');
    h += folderTreeHtml(by, id => cutThumb(id, used));
    grid.innerHTML = h;
  }
  $('#markInfo').textContent = marks.length ? `동그라미로 고른 ${marks.length}장을 고른 순서대로 놓아요.` : imageOrder.length ? `동그라미를 눌러 순서를 고를 수 있어요. 안 고르면 ${imageOrder.length}장 전부를 위 순서대로 놓아요.` : '';
}
// 그림 목록 미리보기: 작은 그림(보관함 썸네일)으로 빨리 그려요
let thumbObs = null; const thumbImgs = new Map();
function thumbImg(id) {
  let im = thumbImgs.get(id); if (im) return im;
  const r = images.get(id); if (!r || !r.thumb) return null;
  im = new Image(); im.onload = () => { for (const c of $$('#lib canvas[data-pt]')) { const p = doc.pages[+c.dataset.pt]; if (p && p.img === id) drawPageThumb(c, p); } };
  im.src = r.thumb; thumbImgs.set(id, im); return im;
}
function drawPageThumb(c, p) {
  const dpr = window.devicePixelRatio || 1, s = 150 / Math.max(p.w, p.h);
  const W = Math.max(1, Math.round(p.w * s * dpr)), H = Math.max(1, Math.round(p.h * s * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d'); g.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  g.fillStyle = p.bg || '#fff'; g.fillRect(0, 0, p.w, p.h);
  g.save(); g.beginPath(); g.rect(0, 0, p.w, p.h); g.clip();
  for (const el of p.els) {
    if (el.lock && el.img) {
      const im = thumbImg(el.img); if (!im || !im.complete || !im.naturalWidth) continue;
      g.save(); g.translate(el.x + el.w / 2, el.y + el.h / 2); if (el.rot) g.rotate(el.rot * DEG); if (el.flip) g.scale(-1, 1);
      const f = colorFilter(el); if (f) g.filter = f; g.imageSmoothingQuality = 'high'; g.drawImage(im, -el.w / 2, -el.h / 2, el.w, el.h); g.restore();
    } else drawEl(g, el, { screen: false, rs: s * dpr });
  }
  g.restore(); c.dataset.done = '1';
}
function observeThumbs() {
  if (typeof IntersectionObserver === 'undefined') { for (const c of $$('#lib canvas[data-pt]')) drawPageThumb(c, doc.pages[+c.dataset.pt]); return; }
  if (!thumbObs) thumbObs = new IntersectionObserver(ents => { for (const en of ents) if (en.isIntersecting) { const c = en.target, p = doc.pages[+c.dataset.pt]; if (p && !c.dataset.done) drawPageThumb(c, p); } }, { root: $('#lib'), rootMargin: '300px' });
  thumbObs.disconnect(); for (const c of $$('#lib canvas[data-pt]')) thumbObs.observe(c);
}
function redrawCurThumb() { if (!isImg()) return; const c = $(`#lib canvas[data-pt="${doc.cur}"]`); if (c) drawPageThumb(c, page()); }
function markLibCur() { for (const t of $$('#lib .thumb.pgt')) t.classList.toggle('on', +t.dataset.page === doc.cur); const on = $('#lib .thumb.pgt.on'); if (on && on.scrollIntoViewIfNeeded) on.scrollIntoViewIfNeeded(false); else if (on) on.scrollIntoView({ block: 'nearest' }); }
function updateNav() {
  if (!isImg()) return; const idx = realIdx(), k = idx.indexOf(doc.cur);
  $('#navLbl').textContent = idx.length ? `${k + 1} / ${idx.length}` : '';
}
function gotoPage(i) { if (i !== doc.cur) switchPage(i); }
function navImg(d) { const idx = realIdx(); if (!idx.length) return; const k = idx.indexOf(doc.cur); gotoPage(idx[clamp((k < 0 ? 0 : k) + d, 0, idx.length - 1)]); }
function moveToFolder(t, fid) {
  if (t.page != null) { const p = doc.pages[t.page]; if (!p || p.folder === fid) return; p.folder = fid; commit(); }
  else { const r = images.get(t.img); if (!r || (r.folder || null) === fid) return; r.folder = fid; idb.put('imgs', recData(r)); }
  renderLib(); renderProps(); const f = folderById(fid); toast(f ? `'${folderPath(fid, ' › ')}' 폴더로 옮겼어요` : '폴더에서 뺐어요', 1600);
}
async function newFolder(parent) {
  const pf = parent ? folderById(parent) : null;
  const n = await askText(pf ? `'${pf.name}' 안에 새 폴더` : '새 폴더 이름', '새 폴더', '만들기'); if (!n) return;
  const f = ensureFolder(n.replace(/\//g, ' '), parent || null); closedFolders.delete(f.id); if (pf) closedFolders.delete(pf.id);
  commit(); switchTab('lib'); renderLib(); renderProps(); toast(`'${folderPath(f.id, ' › ')}' 폴더를 만들었어요. 그림을 폴더 이름 위로 끌어다 놓으면 들어가요.`, 3600);
}
// 폴더를 다른 폴더 안(또는 맨 위, to = null)으로
function moveFolder(id, to) {
  const f = folderById(id); if (!f || (f.parent || null) === (to || null) || id === to) return;
  if (to && folderDesc(id).has(to)) { toast('폴더를 자기 안쪽 폴더로는 옮길 수 없어요'); return; }
  let nm = f.name, k = 2; while (folderKids(to).some(x => x !== f && x.name === nm)) nm = `${f.name} (${k++})`;
  f.name = nm; f.parent = to || null; if (to) closedFolders.delete(to);
  commit(); renderLib(); renderProps(); toast(to ? `'${f.name}' 폴더를 '${folderPath(to, ' › ')}' 안으로 옮겼어요` : `'${f.name}' 폴더를 맨 위로 옮겼어요`, 2000);
}
async function renameFolder(id) { const f = folderById(id); if (!f) return; const n = await askText('폴더 이름 바꾸기', f.name, '바꾸기'); if (!n) return; f.name = n.replace(/\//g, ' ').trim() || f.name; commit(); renderLib(); renderProps(); }
function deleteFolder(id) {
  const f = folderById(id); if (!f) return;
  const up = f.parent || null, upName = up ? `'${folderById(up).name}' 폴더` : "'폴더 없음'";
  if (!confirm(`'${f.name}' 폴더를 지울까요? 안에 있던 그림과 폴더는 ${upName}로 옮겨져요.`)) return;
  doc.folders = doc.folders.filter(x => x !== f);
  for (const x of doc.folders) if (x.parent === id) x.parent = up;
  for (const p of doc.pages) if (p.folder === id) p.folder = up;
  for (const r of images.values()) if (r.folder === id) { r.folder = up; idb.put('imgs', recData(r)); }
  commit(); renderLib(); renderProps();
}
function deleteImagePage(i) {
  const p = doc.pages[i]; if (!p || p.ph) return;
  if (p.els.length > 1 && !confirm(`'${p.name}'에 고친 내용이 있어요. 목록에서 뺄까요? (되돌리기로 다시 살릴 수 있어요)`)) return;
  doc.pages.splice(i, 1); if (!doc.pages.some(q => !q.ph)) doc.pages = [phPage()];
  if (i < doc.cur || doc.cur >= doc.pages.length) doc.cur = Math.max(0, doc.cur - 1);
  sel = []; imageEditId = null; commit(); fitView(); renderAll();
}
$('#lib').addEventListener('click', e => {
  const fs = e.target.closest('[data-fsub]'); if (fs) { newFolder(fs.dataset.fsub); return; }
  const fr = e.target.closest('[data-fren]'); if (fr) { renameFolder(fr.dataset.fren); return; }
  const fd = e.target.closest('[data-fdel]'); if (fd) { deleteFolder(fd.dataset.fdel); return; }
  const fh = e.target.closest('.fold'); if (fh) { const id = fh.dataset.fold; if (id) { closedFolders.has(id) ? closedFolders.delete(id) : closedFolders.add(id); renderLib(); } return; }
  const pd = e.target.closest('[data-pdel]'); if (pd) { deleteImagePage(+pd.dataset.pdel); return; }
  const pt = e.target.closest('[data-page]'); if (pt) { gotoPage(+pt.dataset.page); return; }
  const m = e.target.closest('[data-mark]'); if (m) { const id = m.dataset.mark; marks = marks.includes(id) ? marks.filter(x => x !== id) : [...marks, id]; renderLib(); return; }
  const d = e.target.closest('[data-del]'); if (d) { removeImage(d.dataset.del); return; }
  const t = e.target.closest('.thumb'); if (t) placeImage(t.dataset.id, e.shiftKey);
});
$('#lib').addEventListener('dragstart', e => {
  const fh = e.target.closest('.fold[data-fold]'); if (fh && fh.dataset.fold) { e.dataTransfer.setData('text/x-potato-folder', fh.dataset.fold); e.dataTransfer.effectAllowed = 'move'; return; }
  const t = e.target.closest('.thumb'); if (!t) return;
  if (t.dataset.page !== undefined) { e.dataTransfer.setData('text/x-potato-page', t.dataset.page); e.dataTransfer.effectAllowed = 'move'; return; }
  e.dataTransfer.setData('text/x-cut-img', t.dataset.id); e.dataTransfer.effectAllowed = 'copy';
  try { e.dataTransfer.setDragImage(t.querySelector('img'), 30, 40); } catch (_) { }
});
const libBox = $('#lib');
libBox.addEventListener('dragover', e => {
  const types = [...e.dataTransfer.types], f = e.target.closest('.fold');
  $$('#lib .fold.drop').forEach(x => x !== f && x.classList.remove('drop'));
  if (f && (types.includes('text/x-cut-img') || types.includes('text/x-potato-page') || types.includes('text/x-potato-folder'))) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; f.classList.add('drop'); return; }
  if (types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; libBox.classList.add('dragover'); if (f) f.classList.add('drop'); }
});
libBox.addEventListener('dragleave', e => { if (!libBox.contains(e.relatedTarget)) { libBox.classList.remove('dragover'); $$('#lib .fold.drop').forEach(x => x.classList.remove('drop')); } });
libBox.addEventListener('drop', async e => {
  e.preventDefault(); libBox.classList.remove('dragover');
  const f = e.target.closest('.fold'); $$('#lib .fold.drop').forEach(x => x.classList.remove('drop'));
  const fdrag = e.dataTransfer.getData('text/x-potato-folder'); if (fdrag) { if (f) moveFolder(fdrag, f.dataset.fold || null); return; }
  const pi = e.dataTransfer.getData('text/x-potato-page'), iid = e.dataTransfer.getData('text/x-cut-img');
  if (pi !== '' || iid) { if (f) moveToFolder(pi !== '' ? { page: +pi } : { img: iid }, f.dataset.fold || null); return; }
  const items = await dtItems(e.dataTransfer); if (items.length) await addImages(items, f ? f.dataset.fold || null : null);
});

/* ================= 효과음 보관함 화면 ================= */
function renderStamps() {
  if ($('#tab-sfx').hidden) return;
  ensurePacks();
  const grid = $('#stamps'), q = ($('#sfxSearch').value || '').trim();
  grid.classList.toggle('dark', sfxVar === 'white'); grid.classList.toggle('outline', sfxVar === 'outline');
  $$('#sfxVar [data-var]').forEach(b => b.classList.toggle('on', b.dataset.var === sfxVar));
  let html = '', found = 0;
  for (const pk of packs) {
    const items = pk.words.map((w, i) => ({ w, i })).filter(({ w }) => !q || w.t.includes(q) || w.c.includes(q));
    if (!items.length) continue;
    const closed = closedPacks.has(pk.id) && !q; found += items.length;
    html += `<div class="pk ${closed ? 'closed' : ''}" data-pk="${pk.id}" title="눌러서 접고 펴기">${esc(pk.name)} <span class="n">${q ? items.length + ' / ' : ''}${pk.words.length}종</span>${pk.builtin ? '' : `<button class="x" data-pkdel="${pk.id}" title="이 효과음 팩 빼기" aria-label="이 효과음 팩 빼기">×</button>`}</div>`;
    if (closed) continue;
    let cat = null;
    for (const { w, i } of items) {
      if (w.c !== cat) { cat = w.c; if (cat) html += `<div class="cat">${esc(cat)}</div>`; }
      html += `<div class="thumb word${w.v[sfxVar] ? '' : ' fb'}" draggable="true" data-pkw="${pk.id}|${i}" title="${esc(w.t)}&#10;클릭: 넣기, 끌기: 원하는 곳에 놓기${w.v[sfxVar] ? '' : '&#10;이 버전이 없어서 먹선으로 비슷하게 만들어요'}"><img src="${w.th}" alt="${esc(w.t)}" loading="lazy"></div>`;
    }
  }
  const mine = [...stamps.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).filter(r => !q || (r.name || '').includes(q));
  html += `<div class="pk plain">내가 불러온 그림 <span class="n">${stamps.size}개</span></div>`;
  if (!stamps.size) html += `<div class="empty small">배경이 투명한 PNG를 여기로 끌어오거나 아래 버튼으로 불러오세요. 효과음 팩 zip 파일을 끌어와도 돼요.</div>`;
  else html += mine.map(r => `<div class="thumb stamp" draggable="true" data-sid="${r.id}" title="${esc(r.name)}&#10;클릭: 넣기, 끌기: 원하는 곳에 놓기"><img src="${r.thumb || r.src}" alt="${esc(r.name)}"><button class="del" data-sdel="${r.id}" title="효과음 보관함에서 빼기" aria-label="빼기">×</button></div>`).join('');
  if (q && !found && !mine.length) html = `<div class="empty">'${esc(q)}'에 맞는 효과음이 없어요.</div>`;
  grid.innerHTML = html;
}
$('#stamps').addEventListener('click', e => {
  const pd = e.target.closest('[data-pkdel]');
  if (pd) { const pk = findPack(pd.dataset.pkdel); if (pk && confirm(`'${pk.name}' 효과음 팩을 뺄까요? 이미 놓은 효과음은 그대로 남아요.`)) { packs.splice(packs.indexOf(pk), 1); idb.del('packs', pk.id); renderStamps(); } return; }
  const h = e.target.closest('.pk[data-pk]'); if (h) { const id = h.dataset.pk; closedPacks.has(id) ? closedPacks.delete(id) : closedPacks.add(id); renderStamps(); return; }
  const w = e.target.closest('[data-pkw]'); if (w) { const [pid, i] = w.dataset.pkw.split('|'); placePackWord(pid, +i); return; }
  const d = e.target.closest('[data-sdel]'); if (d) { if (confirm('이 효과음을 보관함에서 뺄까요? 이미 놓은 것은 그대로 남아요.')) { stamps.delete(d.dataset.sdel); idb.del('stamps', d.dataset.sdel); renderStamps(); } return; }
  const t = e.target.closest('[data-sid]'); if (t) placeStamp(t.dataset.sid);
});
$('#stamps').addEventListener('dragstart', e => {
  const w = e.target.closest('[data-pkw]');
  if (w) { e.dataTransfer.setData('text/x-cut-pack', w.dataset.pkw); e.dataTransfer.effectAllowed = 'copy'; return; }
  const t = e.target.closest('[data-sid]'); if (!t) return;
  e.dataTransfer.setData('text/x-cut-stamp', t.dataset.sid); e.dataTransfer.effectAllowed = 'copy';
});
$('#sfxSearch').addEventListener('input', () => renderStamps());
$('#sfxVar').addEventListener('click', e => { const b = e.target.closest('[data-var]'); if (!b) return; sfxVar = b.dataset.var; try { localStorage.setItem('cutSfxVar', sfxVar); } catch (_) { } renderStamps(); });
const stampBox = $('#stamps');
stampBox.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); stampBox.classList.add('dragover'); } });
stampBox.addEventListener('dragleave', () => stampBox.classList.remove('dragover'));
stampBox.addEventListener('drop', async e => {
  e.preventDefault(); stampBox.classList.remove('dragover');
  const files = [...(e.dataTransfer.files || [])], zips = files.filter(f => /\.zip$/i.test(f.name));
  for (const z of zips) await importPackZip(z);
  const n = await importStamps(files.filter(f => !/\.zip$/i.test(f.name)), $('#stampWhite').checked); if (n) toast(`효과음 ${n}개를 넣었어요`);
});
$('#sfxPresets').innerHTML = SFX_PRESETS.map((p, i) => `<button class="btn" data-sfx="${i}">${p.n}</button>`).join('');
$('#sfxPresets').addEventListener('click', e => { const b = e.target.closest('[data-sfx]'); if (b) addText(SFX_PRESETS[+b.dataset.sfx]); });

/* ================= 페이지 목록 ================= */
function renderPages() {
  $('#pages').innerHTML = doc.pages.map((p, i) => `<div class="pg ${i === doc.cur ? 'on' : ''}" data-pg="${i}"><canvas data-thumb="${i}"></canvas><div><b>${esc(p.name)}</b><span>${p.w} × ${p.h}</span></div></div>`).join('');
  drawThumbs();
}
let thumbT = null;
function scheduleThumbs() { clearTimeout(thumbT); thumbT = setTimeout(drawThumbs, 450); }
function drawThumbs() {
  redrawCurThumb();
  if ($('#tab-pages').hidden) return;
  const dpr = window.devicePixelRatio || 1;
  for (const c of $$('#pages canvas')) {
    const p = doc.pages[+c.dataset.thumb]; if (!p) continue;
    const s = 84 / p.w, h = Math.min(p.h * s, 130);
    c.width = Math.round(84 * dpr); c.height = Math.round(h * dpr); c.style.width = '84px'; c.style.height = h + 'px';
    const g = c.getContext('2d'); g.setTransform(s * dpr, 0, 0, s * dpr, 0, 0); drawPage(g, p, { screen: false, rs: s * dpr });
  }
}
$('#pages').addEventListener('click', e => { const t = e.target.closest('[data-pg]'); if (t) switchPage(+t.dataset.pg); });
function switchPage(i) {
  if (i === doc.cur || !doc.pages[i]) return;
  closeInline(); if (mode) setMode(null); doc.cur = i; sel = []; imageEditId = null; fitView(); renderPages(); renderProps(); updateHint(); requestRender();
  markLibCur(); updateNav();
}
function pageCmd(cmd) {
  const i = doc.cur, p = page();
  if (cmd === 'page-add') { doc.pages.splice(i + 1, 0, newPage(p.w, p.h, `페이지 ${doc.pages.length + 1}`)); doc.cur = i + 1; }
  else if (cmd === 'page-dup') { const c = clone(p); c.id = uid(); c.name = p.name + ' 복사'; c.els.forEach(e => e.id = uid()); doc.pages.splice(i + 1, 0, c); doc.cur = i + 1; }
  else if (cmd === 'page-up') { if (i === 0) return; [doc.pages[i - 1], doc.pages[i]] = [doc.pages[i], doc.pages[i - 1]]; doc.cur = i - 1; }
  else if (cmd === 'page-down') { if (i >= doc.pages.length - 1) return; [doc.pages[i + 1], doc.pages[i]] = [doc.pages[i], doc.pages[i + 1]]; doc.cur = i + 1; }
  else if (cmd === 'page-del') {
    if (doc.pages.length === 1) { toast('페이지가 하나뿐이라 지울 수 없어요'); return; }
    if (p.els.length && !confirm(`'${p.name}' 페이지를 지울까요? 안에 있는 컷과 말풍선도 함께 지워져요.`)) return;
    doc.pages.splice(i, 1); doc.cur = Math.min(i, doc.pages.length - 1);
  }
  sel = []; imageEditId = null; commit(); fitView(); renderPages(); renderProps(); updateHint(); requestRender();
}

/* ================= 탭, 힌트 ================= */
function switchTab(t) {
  $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#tab-lib').hidden = t !== 'lib'; $('#tab-sfx').hidden = t !== 'sfx'; $('#tab-pages').hidden = t !== 'pages'; $('#tab-layers').hidden = t !== 'layers';
  if (t === 'pages') renderPages();
  if (t === 'layers') renderLayers();
  if (t === 'sfx') renderStamps();
}
$$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
function updateHint() {
  const h = $('#hint');
  if (isImg()) {
    if (!page().ph || mode) { h.hidden = true; return; }
    h.hidden = false; h.innerHTML = `<b>고칠 그림을 불러오세요</b>그림 파일이나 폴더를 이 화면으로 바로 끌어오거나, 왼쪽 위 '+ 그림', '+ 폴더째'를 누르세요.`; return;
  }
  if (page().els.length || mode) { h.hidden = true; return; }
  h.hidden = false;
  h.innerHTML = imageOrder.length
    ? `<b>보관함 그림을 여기로 끌어다 놓으세요</b>그림 위에 말풍선을 올리고, 위쪽 '컷 나누기'로 칸을 먼저 나눠도 돼요.`
    : `<b>NAI 그림을 넣어서 시작하세요</b>그림 파일을 이 화면으로 바로 끌어오거나, 왼쪽 '그림 불러오기'를 누르세요.`;
}

/* ================= 움짤 만들기 (슬라이드 → GIF / 움직이는 WebP) ================= */
const GS_SIZES = [
  ['first800', '첫 장면 비율 (긴 쪽 800)'], ['first1080', '첫 장면 비율 (긴 쪽 1080)'],
  ['800x800', '정사각형 800'], ['1080x1080', '정사각형 1080'], ['864x1080', '세로 4:5'], ['720x1280', '세로 9:16'], ['1280x720', '가로 16:9'], ['custom', '직접 입력'],
];
const GS_MOTIONS = [['none', '없음'], ['zin', '천천히 확대'], ['zout', '천천히 축소'], ['pan', '옆으로 흐르기'], ['shake', '흔들림'], ['pulse', '두근두근']];
const GS_TRANS = [['none', '바로 넘기기'], ['fade', '서서히 바뀌기'], ['push', '옆으로 밀기'], ['up', '위로 밀기'], ['flash', '번쩍']];
const gs = {
  slides: [], sel: -1, playing: false, t: 0, raf: 0, start: 0, busy: false, built: false,
  set: { size: 'first800', cw: 800, ch: 800, bg: '#ffffff', fit: 'cover', dur: 1.5, motion: 'none', trans: 'fade', trDur: 0.4, fps: 12, loop: true, fmt: 'gif', dither: true, q: 88 },
};
const gifOpen = () => gs.built && !$('#gifStudio').hidden;
const gsDur = s => (s.dur ?? gs.set.dur);
const gsMo = s => s.motion ?? gs.set.motion;
const gsFit = s => s.fit ?? gs.set.fit;
const gsTr = s => s.tr ?? gs.set.trans;
const gsTrAt = i => i > 0 && gsDur(gs.slides[i]) >= 0.3 ? gsTr(gs.slides[i]) : 'none'; // 아주 짧은 장면은 넘김 효과 없이
const gsTotal = () => gs.slides.reduce((a, s) => a + gsDur(s), 0);
const gsTrD = s => s.trd ?? gs.set.trDur; // 넘김 길이 (장면마다 따로 정할 수 있어요)
function gsSize() {
  const v = gs.set.size, f = gs.slides[0];
  if (v === 'custom') return [clamp(gs.set.cw | 0, 16, 2400), clamp(gs.set.ch | 0, 16, 2400)];
  if (v.startsWith('first')) {
    const L = v === 'first1080' ? 1080 : 800; if (!f) return [L, L];
    return f.w >= f.h ? [L, Math.max(16, Math.round(L * f.h / f.w / 2) * 2)] : [Math.max(16, Math.round(L * f.w / f.h / 2) * 2), L];
  }
  return v.split('x').map(Number);
}
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
function gsDrawSlide(g, s, p, W, H, ms) {
  const iw = s.w, ih = s.h, sc = gsFit(s) === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
  let z = 1, dx = 0, dy = 0; const mo = gsMo(s);
  if (mo === 'zin') z = 1 + 0.15 * ease(p);
  else if (mo === 'zout') z = 1.15 - 0.15 * ease(p);
  else if (mo === 'pan') { z = 1.14; dx = (0.5 - p) * W * 0.12; }
  else if (mo === 'shake') { const a = Math.min(W, H) * 0.025 * (1 - p * 0.7); z = 1.06; dx = Math.sin(ms * 0.09) * a; dy = Math.cos(ms * 0.127) * a * 0.8; }
  else if (mo === 'pulse') z = 1 + 0.04 * Math.max(0, Math.sin(ms / 1000 * Math.PI * 4));
  g.save(); g.translate(W / 2 + dx, H / 2 + dy); g.scale(sc * z, sc * z); g.imageSmoothingQuality = 'high'; g.drawImage(s.bmp, -iw / 2, -ih / 2); g.restore();
}
function gsRenderAt(g, t, W, H) {
  g.fillStyle = gs.set.bg; g.fillRect(0, 0, W, H);
  const S = gs.slides; if (!S.length) return;
  let acc = 0, i = 0; for (; i < S.length - 1; i++) { if (t < acc + gsDur(S[i])) break; acc += gsDur(S[i]); }
  const d = gsDur(S[i]), tau = clamp(t - acc, 0, d), p = d ? tau / d : 0, tr = gsTrAt(i), trd = Math.min(gsTrD(S[i]), d * 0.9);
  if (tr !== 'none' && tau < trd) {
    const k = ease(tau / trd), prev = S[i - 1], pd = gsDur(prev);
    if (tr === 'fade') { gsDrawSlide(g, prev, 1, W, H, pd * 1000); g.globalAlpha = k; gsDrawSlide(g, S[i], p, W, H, tau * 1000); g.globalAlpha = 1; }
    else if (tr === 'push' || tr === 'up') {
      const ox = tr === 'push' ? W : 0, oy = tr === 'up' ? H : 0;
      g.save(); g.translate(-ox * k, -oy * k); gsDrawSlide(g, prev, 1, W, H, pd * 1000); g.restore();
      g.save(); g.translate(ox * (1 - k), oy * (1 - k)); gsDrawSlide(g, S[i], p, W, H, tau * 1000); g.restore();
    } else if (tr === 'flash') { gsDrawSlide(g, S[i], p, W, H, tau * 1000); g.fillStyle = `rgba(255,255,255,${1 - k})`; g.fillRect(0, 0, W, H); }
    else if (!gsGlTrans(g, tr, prev, S[i], k, p, pd, tau, W, H)) { gsDrawSlide(g, prev, 1, W, H, pd * 1000); g.globalAlpha = k; gsDrawSlide(g, S[i], p, W, H, tau * 1000); g.globalAlpha = 1; } // 특수 넘김 (안 되면 서서히)
  } else gsDrawSlide(g, S[i], p, W, H, tau * 1000);
  gsRenderExtras(g, t, W, H); // 글자·스티커, 효과
}
// 저장할 장면 목록: 움직임 없는 장면은 한 장으로 합쳐 용량을 줄여요
function gsFramePlan(fps) {
  const iv = 1000 / fps, out = []; let acc = 0;
  gs.slides.forEach((s, i) => {
    const d = gsDur(s) * 1000, tr = gsTrAt(i), trd = tr !== 'none' ? Math.min(gsTrD(s) * 1000, d * 0.9) : 0;
    if (gsMo(s) === 'none') {
      for (let t = 0; t < trd; t += iv) out.push({ t: acc + t, s: acc + t, dur: Math.min(iv, trd - t) });
      gsStaticRun(out, acc + trd, acc + d, iv); // 글자·효과가 움직이는 동안만 여러 장
    } else for (let t = 0; t < d - 0.5; t += iv) out.push({ t: acc + t, s: acc + t, dur: Math.min(iv, d - t) });
    acc += d;
  });
  return out.filter(f => f.dur > 0.5);
}

/* ---- GIF 만들기 ---- */
class ByteOut {
  constructor() { this.parts = []; this.buf = new Uint8Array(1 << 16); this.p = 0; }
  byte(b) { if (this.p >= this.buf.length) this.flush(); this.buf[this.p++] = b; }
  bytes(a, o = 0, n = a.length) { for (let i = 0; i < n; i++) this.byte(a[o + i]); }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  flush() { if (this.p) { this.parts.push(this.buf.slice(0, this.p)); this.p = 0; } }
  blob(type) { this.flush(); return new Blob(this.parts, { type }); }
}
function quantize(d, maxN) { // 중앙값 자르기로 색 고르기 (15비트 색 단위)
  const hist = new Uint32Array(32768);
  for (let i = 0; i < d.length; i += 4) hist[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]++;
  const cols = []; for (let c = 0; c < 32768; c++) if (hist[c]) cols.push(c);
  const ch = (c, k) => k === 0 ? c >> 10 : k === 1 ? (c >> 5) & 31 : c & 31;
  const info = box => { const lo = [31, 31, 31], hi = [0, 0, 0]; let n = 0; for (const c of box) { for (let k = 0; k < 3; k++) { const v = ch(c, k); if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; } n += hist[c]; } return { lo, hi, n }; };
  let boxes = [{ c: cols, ...info(cols) }];
  while (boxes.length < maxN) {
    let bi = -1, best = 0;
    boxes.forEach((b, i) => { if (b.c.length < 2) return; const r = Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]), sc = r * Math.sqrt(b.n); if (sc > best) { best = sc; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi], rs = [0, 1, 2].map(k => b.hi[k] - b.lo[k]), k = rs.indexOf(Math.max(...rs));
    b.c.sort((x, y) => ch(x, k) - ch(y, k));
    let half = b.n / 2, acc = 0, cut = 1; for (let j = 0; j < b.c.length - 1; j++) { acc += hist[b.c[j]]; if (acc >= half) { cut = j + 1; break; } cut = j + 1; }
    const a1 = b.c.slice(0, cut), a2 = b.c.slice(cut); boxes.splice(bi, 1, { c: a1, ...info(a1) }, { c: a2, ...info(a2) });
  }
  const pal = new Uint8Array(768);
  boxes.forEach((b, i) => { let r = 0, g = 0, bl = 0, n = 0; for (const c of b.c) { const w = hist[c]; r += (ch(c, 0) * 8 + 4) * w; g += (ch(c, 1) * 8 + 4) * w; bl += (ch(c, 2) * 8 + 4) * w; n += w; } pal[i * 3] = r / n; pal[i * 3 + 1] = g / n; pal[i * 3 + 2] = bl / n; });
  const np = boxes.length, map = new Int16Array(32768).fill(-1);
  const near = c => { let m = map[c]; if (m >= 0) return m; const r = (c >> 10) * 8 + 4, g = ((c >> 5) & 31) * 8 + 4, b = (c & 31) * 8 + 4; let bd = 1e9; for (let i = 0; i < np; i++) { const dr = pal[i * 3] - r, dg = pal[i * 3 + 1] - g, db = pal[i * 3 + 2] - b, dd = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (dd < bd) { bd = dd; m = i; } } map[c] = m; return m; };
  return { pal, near };
}
function indexFrame(d, W, H, dither, colors) {
  const { pal, near } = quantize(d, colors || 256), idx = new Uint8Array(W * H);
  if (!dither) { for (let i = 0, j = 0; i < d.length; i += 4, j++) idx[j] = near(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)); return { pal, idx }; }
  let cur = new Float32Array(W * 3), nxt = new Float32Array(W * 3);
  for (let y = 0; y < H; y++) {
    nxt.fill(0);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, e = x * 3;
      const r = clamp(d[i] + cur[e], 0, 255), g = clamp(d[i + 1] + cur[e + 1], 0, 255), b = clamp(d[i + 2] + cur[e + 2], 0, 255);
      const m = near(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)); idx[y * W + x] = m;
      const er = (r - pal[m * 3]) * 0.75, eg = (g - pal[m * 3 + 1]) * 0.75, eb = (b - pal[m * 3 + 2]) * 0.75;
      if (x + 1 < W) { cur[e + 3] += er * 7 / 16; cur[e + 4] += eg * 7 / 16; cur[e + 5] += eb * 7 / 16; nxt[e + 3] += er / 16; nxt[e + 4] += eg / 16; nxt[e + 5] += eb / 16; }
      if (x > 0) { nxt[e - 3] += er * 3 / 16; nxt[e - 2] += eg * 3 / 16; nxt[e - 1] += eb * 3 / 16; }
      nxt[e] += er * 5 / 16; nxt[e + 1] += eg * 5 / 16; nxt[e + 2] += eb * 5 / 16;
    }
    [cur, nxt] = [nxt, cur];
  }
  return { pal, idx };
}
function lzw(pixels, out) { // GIF용 LZW 압축 (8비트)
  const BITS = 12, HSIZE = 5003, maxmax = 1 << BITS, init = 8, gInit = init + 1;
  const masks = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535];
  const htab = new Int32Array(HSIZE), codetab = new Int32Array(HSIZE), acc = new Uint8Array(256);
  let aN = 0, curAcc = 0, curBits = 0, nBits = gInit, maxcode = (1 << nBits) - 1, clearFlg = false;
  const Clear = 1 << init, EOFC = Clear + 1; let free = Clear + 2;
  const flushChar = () => { if (aN > 0) { out.byte(aN); out.bytes(acc, 0, aN); aN = 0; } };
  const charOut = c => { acc[aN++] = c; if (aN >= 254) flushChar(); };
  const output = code => {
    curAcc &= masks[curBits]; curAcc = curBits > 0 ? curAcc | (code << curBits) : code; curBits += nBits;
    while (curBits >= 8) { charOut(curAcc & 255); curAcc >>= 8; curBits -= 8; }
    if (free > maxcode || clearFlg) { if (clearFlg) { nBits = gInit; maxcode = (1 << nBits) - 1; clearFlg = false; } else { nBits++; maxcode = nBits === BITS ? maxmax : (1 << nBits) - 1; } }
    if (code === EOFC) { while (curBits > 0) { charOut(curAcc & 255); curAcc >>= 8; curBits -= 8; } flushChar(); }
  };
  out.byte(init);
  let hshift = 0; for (let f = HSIZE; f < 65536; f *= 2) hshift++; hshift = 8 - hshift;
  htab.fill(-1); output(Clear);
  let ent = pixels[0];
  outer: for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i], fcode = (c << BITS) + ent; let h = (c << hshift) ^ ent;
    if (htab[h] === fcode) { ent = codetab[h]; continue; }
    if (htab[h] >= 0) { let disp = HSIZE - h; if (h === 0) disp = 1; do { if ((h -= disp) < 0) h += HSIZE; if (htab[h] === fcode) { ent = codetab[h]; continue outer; } } while (htab[h] >= 0); }
    output(ent); ent = c;
    if (free < maxmax) { codetab[h] = free++; htab[h] = fcode; } else { htab.fill(-1); free = Clear + 2; clearFlg = true; output(Clear); }
  }
  output(ent); output(EOFC); out.byte(0);
}
async function encodeGif(W, H, frames, renderFrame, progress, colors) {
  const o = new ByteOut(); o.str('GIF89a'); o.u16(W); o.u16(H); o.byte(0x70); o.byte(0); o.byte(0);
  if (gs.set.loop) { o.byte(0x21); o.byte(0xff); o.byte(11); o.str('NETSCAPE2.0'); o.byte(3); o.byte(1); o.u16(0); o.byte(0); }
  const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); let tc = 0, done = 0;
  for (const f of frames) {
    renderFrame(g, f.t / 1000, W, H);
    const { pal, idx } = indexFrame(g.getImageData(0, 0, W, H).data, W, H, gs.set.dither, colors);
    const end = Math.round((f.s + f.dur) / 10), cs = Math.max(2, end - tc); tc += cs;
    o.byte(0x21); o.byte(0xf9); o.byte(4); o.byte(0x04); o.u16(cs); o.byte(0); o.byte(0);
    o.byte(0x2c); o.u16(0); o.u16(0); o.u16(W); o.u16(H); o.byte(0x87); o.bytes(pal);
    lzw(idx, o);
    progress(++done, frames.length); await new Promise(r => setTimeout(r, 0));
  }
  o.byte(0x3b); return o.blob('image/gif');
}
async function encodeWebp(W, H, frames, renderFrame, progress, q) {
  const c = newCanvas(W, H), g = c.getContext('2d'), parts = []; let done = 0, tc = 0, alpha = false;
  const le = (n, b) => { const a = []; for (let i = 0; i < b; i++) a.push((n >> (8 * i)) & 255); return a; };
  const chunk = (id, data) => { const pad = data.length & 1; const u = new Uint8Array(8 + data.length + pad); for (let i = 0; i < 4; i++) u[i] = id.charCodeAt(i); u.set(le(data.length, 4), 4); u.set(data, 8); return u; };
  for (const f of frames) {
    renderFrame(g, f.t / 1000, W, H);
    const b = await new Promise(r => c.toBlob(r, 'image/webp', (q || gs.set.q) / 100));
    if (!b || b.type !== 'image/webp') throw new Error('nowebp');
    const u = new Uint8Array(await b.arrayBuffer()), sub = []; let p = 12;
    while (p + 8 <= u.length) { const id = String.fromCharCode(u[p], u[p + 1], u[p + 2], u[p + 3]), sz = u[p + 4] | (u[p + 5] << 8) | (u[p + 6] << 16) | (u[p + 7] << 24); if (id === 'ALPH') alpha = true; if (id === 'VP8 ' || id === 'VP8L' || id === 'ALPH') sub.push(u.subarray(p, p + 8 + sz + (sz & 1))); p += 8 + sz + (sz & 1); }
    const end = Math.round(f.s + f.dur), ms = Math.max(20, end - tc); tc += ms;
    const head = new Uint8Array([...le(0, 3), ...le(0, 3), ...le(W - 1, 3), ...le(H - 1, 3), ...le(ms, 3), 0x02]);
    const body = new Uint8Array(head.length + sub.reduce((a, s) => a + s.length, 0)); body.set(head, 0); let q = head.length; for (const s of sub) { body.set(s, q); q += s.length; }
    parts.push(chunk('ANMF', body));
    progress(++done, frames.length); await new Promise(r => setTimeout(r, 0));
  }
  const vp8x = chunk('VP8X', new Uint8Array([0x02 | (alpha ? 0x10 : 0), 0, 0, 0, ...le(W - 1, 3), ...le(H - 1, 3)]));
  const anim = chunk('ANIM', new Uint8Array([255, 255, 255, 255, ...le(gs.set.loop ? 0 : 1, 2)]));
  const size = 4 + vp8x.length + anim.length + parts.reduce((a, p) => a + p.length, 0);
  const hdr = new Uint8Array([82, 73, 70, 70, ...le(size, 4), 87, 69, 66, 80]);
  return new Blob([hdr, vp8x, anim, ...parts], { type: 'image/webp' });
}

/* ---- 화면: gsui.js ---- */
const GS_MAXSIDE = 1600, GS_BUDGET = 160e6; // 장면 한 장 긴 쪽 최대, 전체 픽셀 한도(약 640MB)
const gsPixels = () => gs.slides.reduce((a, s) => a + s.w * s.h, 0);
function gsAddBitmap(src, name, extra, maxSide = GS_MAXSIDE) {
  const sw = src.naturalWidth || src.displayWidth || src.width, sh = src.naturalHeight || src.displayHeight || src.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  if (gsPixels() + w * h > GS_BUDGET) return null;
  let c = src;
  if (!(src instanceof HTMLCanvasElement) || k < 1) { c = newCanvas(w, h); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h); }
  const s = { id: uid(), name, bmp: c, w: c.width, h: c.height, dur: null, motion: null, fit: null, tr: null, ...extra };
  gs.slides.push(s); return s;
}
const gsFull = () => toast('장면이 너무 많거나 커서 더 넣지 못했어요. 몇 장을 빼고 다시 넣어 주세요.', 4500);
// 움직이는 GIF, WebP, PNG를 장면마다 나눠 읽기 (크롬, 엣지)
async function decodeAnimated(file, onFrame) {
  const ext = (file.name || '').toLowerCase().match(/\.(gif|webp|png|apng)$/), type = file.type || (ext ? (ext[1] === 'gif' ? 'image/gif' : ext[1] === 'webp' ? 'image/webp' : 'image/png') : '');
  if (typeof ImageDecoder === 'undefined' || !/gif|webp|png/i.test(type)) return -1;
  let dec;
  try {
    dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    await dec.tracks.ready; try { await dec.completed; } catch (_) { }
    const n = dec.tracks.selectedTrack ? dec.tracks.selectedTrack.frameCount : 1;
    if (n < 2) { dec.close(); return -1; }
    let k = 0;
    for (let i = 0; i < Math.min(n, 500); i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const ok = onFrame(image, Math.max(0.02, (image.duration || 100000) / 1e6)); image.close();
      if (!ok) break; k++;
    }
    dec.close(); return k;
  } catch (e) { try { dec && dec.close(); } catch (_) { } return -1; }
}
async function gsAddFiles(files) {
  files = files.filter(f => isImageFile(f) || isVideoFile(f)); if (!files.length) return;
  files.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true }));
  toast('장면을 넣는 중…', 1500); let n = 0, full = false;
  for (const f of files) {
    if (full) break;
    if (isVideoFile(f)) { n += await gsAddVideo(f); if (gs.slides.length && gsPixels() > GS_BUDGET * 0.98) full = true; continue; }
    const before = gs.slides.length, gclip = 'c' + uid();
    const k = await decodeAnimated(f, (im, dur) => { const first = gs.slides.length === before; const s = gsAddBitmap(im, f.name, { dur: Math.round(dur * 1000) / 1000, motion: 'none', tr: first ? null : 'none', fit: 'contain', clip: gclip }, 1080); if (!s) full = true; return !!s; });
    if (k >= 0) { n += gs.slides.length - before; continue; }
    try { const bm = await createImageBitmap(f); const s = gsAddBitmap(bm, f.name); bm.close(); if (s) n++; else full = true; }
    catch (e) { try { const im = await loadImg(await readAsDataURL(f)); if (gsAddBitmap(im, f.name)) n++; else full = true; } catch (_) { toast(`${f.name}을 열지 못했어요`); } }
  }
  if (gs.sel < 0 && gs.slides.length) gs.sel = 0; gsChanged();
  if (full) gsFull(); else toast(`장면 ${n}개를 넣었어요`);
}
function gsAddImageRec(r) { const im = imgCache.get(r.id); if (!im || !im.naturalWidth) return; if (!gsAddBitmap(im, r.name)) gsFull(); if (gs.sel < 0) gs.sel = 0; gsChanged(); }
function gsPickLibrary() {
  if (!imageOrder.length) { toast('그림 보관함이 비어 있어요. + 사진·GIF로 바로 넣을 수 있어요.'); return; }
  const picked = [];
  const m = modal(`<h2>보관함에서 장면 고르기</h2><p class="sub">누른 순서대로 장면이 돼요.</p><div class="lib" id="gsPick" style="grid-template-columns:repeat(4,1fr);max-height:52vh;padding:0">${imageOrder.map(id => { const r = images.get(id); return `<div class="thumb ${r.alpha ? 'alpha' : ''}" data-pid="${id}"><img src="${r.thumb || ''}" alt=""><span class="mark"></span></div>`; }).join('')}</div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn" id="gsAll">전부 넣기</button><button class="btn primary" id="gsGo">고른 것 넣기</button></div>`, { wide: true });
  $('#gsPick', m).addEventListener('click', e => { const t = e.target.closest('[data-pid]'); if (!t) return; const id = t.dataset.pid, k = picked.indexOf(id); k >= 0 ? picked.splice(k, 1) : picked.push(id); $$('#gsPick [data-pid]', m).forEach(x => { const j = picked.indexOf(x.dataset.pid); const mk = x.querySelector('.mark'); mk.classList.toggle('on', j >= 0); mk.textContent = j >= 0 ? j + 1 : ''; }); });
  const add = ids => { closeModal(); for (const id of ids) { const im = imgCache.get(id), r = images.get(id); if (im && im.naturalWidth && !gsAddBitmap(im, r.name)) { gsFull(); break; } } if (gs.sel < 0 && gs.slides.length) gs.sel = 0; gsChanged(); };
  $('#gsGo', m).addEventListener('click', () => add(picked)); $('#gsAll', m).addEventListener('click', () => add(imageOrder.slice()));
}
function gsAddPage() {
  const pg = page(), ss = selEls(); let x0 = 0, y0 = 0, x1 = pg.w, y1 = pg.h;
  if (ss.length) { const b = unionBox(ss.map(aabb)); x0 = clamp(b.x, 0, pg.w); y0 = clamp(b.y, 0, pg.h); x1 = clamp(b.x + b.w, 0, pg.w); y1 = clamp(b.y + b.h, 0, pg.h); }
  else if (pg.h > pg.w * 1.8) { toast('세로로 긴 페이지라서 넣을 부분(컷)을 먼저 골라 주세요. 고른 것만 장면이 돼요.', 4000); return; }
  const w = x1 - x0, h = y1 - y0; if (w < 4 || h < 4) return;
  const k = Math.min(2, 1600 / Math.max(w, h)), c = newCanvas(w * k, h * k), g = c.getContext('2d');
  g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k); drawPage(g, pg, { screen: false, rs: k, view: { x0, y0, x1, y1 } });
  if (!gsAddBitmap(c, pg.name)) { gsFull(); return; }
  if (gs.sel < 0) gs.sel = 0; gsChanged(); toast(ss.length ? '고른 부분을 장면으로 넣었어요' : '지금 페이지를 장면으로 넣었어요');
}
async function gsExport() {
  if (gs.busy || !gs.slides.length) return; gsPause();
  const fmt = gs.set.fmt, btn = $('#gsExport'), frames = gsFramePlan(+gs.set.fps);
  if (fmt !== 'mp4' && frames.length > 900) { toast('장면이 너무 많아요. 초당 장 수를 줄이거나 길이를 줄여 주세요.', 4000); return; }
  gs.busy = true; btn.disabled = true;
  const prog = (i, n, tries) => { btn.textContent = (tries ? `용량 맞추는 중 (${tries + 1}번째) ` : '만드는 중 ') + `${i} / ${n}`; };
  try {
    const { blob, W, H } = await gsEncodeTarget(fmt, prog), [W0] = gsSize();
    if (await download(blob, `${safeName(doc.name)}_움짤.${fmt}`)) toast(`${fmt === 'gif' ? 'GIF' : fmt === 'mp4' ? 'MP4' : 'WebP'}로 저장했어요 (${(blob.size / 1048576).toFixed(1)}MB${W !== W0 ? `, 용량에 맞춰 ${W}×${H}로 줄였어요` : ''})`, 4500);
  } catch (e) {
    const m = e && e.message;
    toast(m === 'nowebp' ? '이 브라우저는 WebP 저장을 못 해요. 크롬이나 엣지에서 해 보세요.' : m === 'nomp4' ? '이 컴퓨터에서는 MP4로 저장할 수 없어요. GIF나 WebP로 저장해 주세요.' : '저장하지 못했어요. 크기를 줄여 다시 해 보세요.', 4500);
  }
  gs.busy = false; btn.disabled = false; gsExpRender();
}
async function gsSave() {
  if (!gs.loaded) return;
  const slides = [];
  for (const s of gs.slides) {
    if (!s.blob || s.blobOf !== s.bmp) { s.blob = await new Promise(r => s.bmp.toBlob ? s.bmp.toBlob(r, 'image/webp', 0.95) : r(null)); s.blobOf = s.bmp; }
    slides.push({ id: s.id, name: s.name, blob: s.blob, w: s.w, h: s.h, dur: s.dur, motion: s.motion, fit: s.fit, tr: s.tr, trd: s.trd, clip: s.clip });
  }
  idb.set('gif', { slides, set: gs.set, ovs: gs.ovs.map(ovPlain), fx: clone(gs.fx) });
}
async function gsLoad() {
  const d = await idb.get('gif'); if (!d) return;
  Object.assign(gs.set, d.set || {});
  for (const s of d.slides || []) {
    try { const bm = await createImageBitmap(s.blob), c = newCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); gs.slides.push({ ...s, bmp: c, blobOf: c }); } catch (e) { }
  }
  gs.ovs = await ovRestore(d.ovs); gs.fx = Array.isArray(d.fx) ? d.fx : [];
  laneFix(gs.ovs); laneFix(gs.fx);
  gs.sel = gs.slides.length ? 0 : -1;
}

/*@@GIF2@@*/
/*@@PRESETS@@*/
/*@@ANIM@@*/
/*@@GSUI@@*/
/*@@CZ@@*/
/* ================= 모달 ================= */
function modal(html, opts = {}) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modalRoot').appendChild(bg);
  bg.addEventListener('pointerdown', e => { if (e.target === bg) closeModal(); });
  const m = bg.firstElementChild; $$('[data-close]', m).forEach(b => b.addEventListener('click', closeModal));
  const f = m.querySelector('[autofocus]') || m.querySelector('button.primary'); if (f) setTimeout(() => f.focus(), 30);
  return m;
}
const closeModal = () => { $('#modalRoot').innerHTML = ''; };
const modalOpen = () => !!$('#modalRoot').firstChild;

function openNewModal(first) {
  const hasWork = doc.pages.some(p => p.els.length) || imageOrder.length;
  let pick = 0, kind = 'cut';
  const m = modal(`<h2>${first ? '무엇을 할까요?' : '새로 만들기'}</h2>
    <p class="sub">${first ? '나중에 위쪽 <b>새로 만들기</b>에서 언제든 다시 고를 수 있어요.' : '지금 작업은 사라져요. 남겨 두려면 먼저 위쪽 <b>저장</b>을 누르세요. 효과음 보관함은 그대로 남아요.'}</p>
    <div class="modechoose">
      <button class="preset on" data-kind="cut"><b>컷 편집</b><span>웹툰·만화처럼 여러 그림을 칸에 나눠 담고 말풍선과 효과음을 올려요.</span></button>
      <button class="preset" data-kind="image"><b>이미지 편집</b><span>그림을 한 장씩 그대로 열어 글자, 가리기, 자동 흰칠을 하고 원래 이름으로 저장해요. 폴더째 열 수 있어요.</span></button>
    </div>
    ${row('작품 이름', `<input type="text" id="nName" value="${esc(first ? doc.name : '새 작품')}" spellcheck="false">`)}
    <div id="nCut"><div class="presets" style="margin-top:12px">${PRESETS.map((p, i) => { const s = 46 / Math.max(p.w, p.h * 0.5); return `<button class="preset ${i === 0 ? 'on' : ''}" data-i="${i}"><div class="shape" style="width:${Math.round(p.w * s)}px;height:${Math.round(Math.min(p.h * s, 70))}px"></div><b>${p.name}</b><span>${p.w} × ${p.h}<br>${p.desc}</span></button>`; }).join('')}
      <button class="preset" data-i="-1"><div class="shape" style="width:30px;height:40px;border-style:dashed"></div><b>직접 정하기</b><span class="nowrap"><input type="number" id="nW" value="800" style="width:60px"> × <input type="number" id="nH" value="1200" style="width:64px"></span></button></div><p class="muted small" style="margin-top:10px">그림이나 폴더를 이 창에 바로 끌어다 놓으면 고른 크기로 시작하고 그림은 보관함에 넣어 드려요.</p></div>
    <div id="nImg" hidden><div class="dropzone" id="nDrop"><b>고칠 그림이나 폴더를 여기로 끌어오세요</b><br><span class="small">여러 장, 폴더 여러 개를 한꺼번에 넣어도 돼요. 폴더 이름 그대로 묶여요.</span>
      <div class="btnrow"><button class="btn" id="nPickF">그림 파일 고르기</button><button class="btn" id="nPickD">폴더 통째로 고르기</button></div></div>
      <p class="muted small" style="margin-top:8px">그림 없이 '만들기'를 눌러도 돼요. 나중에 왼쪽 위에서 불러올 수 있어요.</p></div>
    <div class="foot">${first ? '<button class="btn" id="nOpen">저장해 둔 파일 열기</button>' : '<button class="btn" data-close>취소</button>'}<button class="btn primary" id="nGo">만들기</button></div>`, { wide: true });
  $$('[data-kind]', m).forEach(b => b.addEventListener('click', () => { kind = b.dataset.kind; $$('[data-kind]', m).forEach(x => x.classList.toggle('on', x === b)); $('#nCut', m).hidden = kind !== 'cut'; $('#nImg', m).hidden = kind !== 'image'; }));
  $$('#nCut .preset', m).forEach(b => b.addEventListener('click', () => { pick = +b.dataset.i; $$('#nCut .preset', m).forEach(x => x.classList.toggle('on', x === b)); }));
  if (first) $('#nOpen', m).addEventListener('click', () => { closeModal(); $('#fileProj').click(); });
  let busy = false;
  const start = async items => {
    if (busy) return; busy = true;
    const name = $('#nName', m).value.trim() || '새 작품';
    if (!first && hasWork) { images.clear(); imgCache.clear(); thumbImgs.clear(); imageOrder = []; marks = []; await idb.clear('imgs'); }
    if (mode) setMode(null);
    const defaults = first ? doc.defaults : DEFAULTS();
    if (kind === 'cut') {
      const pr = pick >= 0 ? PRESETS[pick] : { w: clamp(+$('#nW', m).value || 800, 50, 60000), h: clamp(+$('#nH', m).value || 1200, 50, 60000) };
      doc = { name, mode: 'cut', folders: [], pages: [newPage(pr.w, pr.h, '페이지 1')], cur: 0, defaults };
    } else doc = { name, mode: 'image', folders: [], pages: [phPage()], cur: 0, defaults };
    sel = []; imageEditId = null; closeModal(); resetHistory(); fitView(); renderAll(); scheduleSave();
    if (items && items.length) await addImages(items);
  };
  $('#nGo', m).addEventListener('click', () => start(null));
  $('#nPickF', m).addEventListener('click', () => pickFiles(false, items => { if (items.length) start(items); }));
  $('#nPickD', m).addEventListener('click', () => pickFiles(true, items => { if (items.length) start(items); }));
  const dz = $('#nDrop', m), box = m.closest('.modal-bg') || m;
  box.addEventListener('dragover', e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dz.classList.add('drop'); });
  box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) dz.classList.remove('drop'); });
  box.addEventListener('drop', async e => { if (![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); e.stopPropagation(); dz.classList.remove('drop'); const items = await dtItems(e.dataTransfer); if (items.length) start(items); });
}

const TEMPLATES = [
  { n: '1컷', rows: [[1]] }, { n: '2단', rows: [[1], [1]] }, { n: '좌우 2컷', rows: [[1, 1]] }, { n: '3단', rows: [[1], [1], [1]] },
  { n: '위1 아래2', rows: [[1], [1, 1]] }, { n: '위2 아래1', rows: [[1, 1], [1]] }, { n: '4컷', rows: [[1, 1], [1, 1]] }, { n: '세로 4컷', rows: [[1], [1], [1], [1]] },
  { n: '큰 컷 + 2', rows: [{ h: 2, c: [1] }, { h: 1, c: [1, 1] }] }, { n: '6컷', rows: [[1, 1], [1, 1], [1, 1]] },
  { n: '왼쪽 큰 컷', cols: [{ w: 1.3, r: [1] }, { w: 1, r: [1, 1] }] }, { n: '엇갈림', rows: [{ h: 1, c: [2, 1] }, { h: 1, c: [1, 2] }, { h: 1, c: [2, 1] }] },
];
function tplRects(t, ax, ay, aw, ah, g) {
  const out = [];
  if (t.rows) {
    const rows = t.rows.map(r => Array.isArray(r) ? { h: 1, c: r } : r), tH = rows.reduce((s, r) => s + r.h, 0), avH = ah - g * (rows.length - 1);
    let y = ay;
    for (const r of rows) { const rh = avH * r.h / tH, tW = r.c.reduce((s, v) => s + v, 0), avW = aw - g * (r.c.length - 1); let x = ax; for (const c of r.c) { const cw = avW * c / tW; out.push({ x, y, w: cw, h: rh }); x += cw + g; } y += rh + g; }
  } else {
    const cols = t.cols, tW = cols.reduce((s, c) => s + c.w, 0), avW = aw - g * (cols.length - 1);
    let x = ax;
    for (const c of cols) { const cw = avW * c.w / tW, tH = c.r.reduce((s, v) => s + v, 0), avH = ah - g * (c.r.length - 1); let y = ay; for (const r of c.r) { const rh = avH * r / tH; out.push({ x, y, w: cw, h: rh }); y += rh + g; } x += cw + g; }
  }
  return out;
}
function openTemplateModal() {
  const p = page(), tall = p.h > p.w * 1.8; let pick = 6;
  const svg = t => `<svg width="54" height="72" viewBox="0 0 54 72">${tplRects(t, 3, 3, 48, 66, 3).map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#fff" stroke="#1d2026" stroke-width="1.4"/>`).join('')}</svg>`;
  const m = modal(`<h2>모양 골라서 나누기</h2><p class="sub">${tall ? '세로로 긴 페이지라서, 지금 내용 아래에 이 모양 한 묶음을 이어 붙여요.' : '고른 모양대로 이 페이지에 빈 컷을 만들어요.'} 비스듬하게 나누고 싶으면 만든 뒤 '직선으로 자르기'를 쓰세요.</p>
    <div class="tpls">${TEMPLATES.map((t, i) => `<button class="tpl ${i === pick ? 'on' : ''}" data-i="${i}">${svg(t)}${t.n}</button>`).join('')}</div>
    <div style="margin-top:14px">
      ${row('바깥 여백', `<input type="number" id="tM" value="${tall ? 40 : 50}"> px`)}
      ${row('컷 사이 간격', `<input type="number" id="tG" value="${tall ? 30 : 18}"> px`)}
      ${row('테두리 두께', `<input type="number" id="tB" value="${doc.defaults.panel.bw}"> px`)}
      ${tall ? '' : row('', '<label class="chk"><input type="checkbox" id="tClear" checked> 이 페이지의 빈 컷(그림 없는 컷)은 지우고 만들기</label>')}
    </div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="tGo">컷 만들기</button></div>`, { wide: true });
  $$('.tpl', m).forEach(b => b.addEventListener('click', () => { pick = +b.dataset.i; $$('.tpl', m).forEach(x => x.classList.toggle('on', x === b)); }));
  $$('.tpl', m).forEach(b => b.addEventListener('dblclick', () => $('#tGo', m).click()));
  $('#tGo', m).addEventListener('click', () => {
    const M = Math.max(0, +$('#tM', m).value || 0), G = Math.max(0, +$('#tG', m).value || 0), B = Math.max(0, +$('#tB', m).value || 0);
    let ax = M, ay = M, aw = p.w - M * 2, ah = p.h - M * 2;
    if (tall) { const cb = contentBottom(p); ay = cb > 0 ? cb + G : M; ah = aw * 1.35; if (ay + ah + M > p.h) p.h = Math.ceil(ay + ah + M); }
    else if ($('#tClear', m) && $('#tClear', m).checked) p.els = p.els.filter(e => !(e.type === 'panel' && !e.img && !hasFx(e)));
    doc.defaults.panel.bw = B; doc.defaults.panel.gutter = G;
    const made = tplRects(TEMPLATES[pick], ax, ay, aw, ah, G).map(r => { const el = makePanel(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h); p.els.push(el); return el; });
    p.els = [...p.els.filter(e => e.type === 'panel'), ...p.els.filter(e => e.type !== 'panel')];
    sel = made.map(e => e.id); closeModal(); layoutSpacer(); commit(); renderProps(); requestRender();
    if (tall && made[0]) scrollToEl(made[0]);
  });
}
function openAutoLayout() {
  const list = marks.length ? marks.filter(id => images.has(id)) : imageOrder.slice();
  if (!list.length) { toast('먼저 보관함에 그림을 넣어 주세요'); return; }
  const p = page(), cb = contentBottom(p);
  const m = modal(`<h2>세로로 자동 배치</h2><p class="sub">${marks.length ? `고른 ${list.length}장을 고른 순서대로` : `보관함의 ${list.length}장을 보관함 순서대로`} 위에서 아래로 쌓아요. 페이지 높이는 알아서 늘어나요.</p>
    ${row('좌우 여백', `<input type="number" id="aM" value="0"> px`)}
    ${row('컷 사이 간격', `<input type="number" id="aG" value="80"> px`)}
    ${row('테두리 두께', `<input type="number" id="aB" value="0"> px`)}
    ${row('놓을 곳', `<div class="radios"><label class="chk"><input type="radio" name="aW" value="end" checked> ${cb > 0 ? '지금 내용 아래에 이어서' : '이 페이지 맨 위부터'}</label><label class="chk"><input type="radio" name="aW" value="new"> 새 페이지에</label></div>`)}
    <div class="note">그림 비율은 그대로 두고 페이지 폭에 맞춰요. 여백 0, 테두리 0이면 요즘 웹툰처럼 칸 없이 이어져요.</div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="aGo">배치하기</button></div>`);
  $('#aGo', m).addEventListener('click', () => {
    const M = Math.max(0, +$('#aM', m).value || 0), G = Math.max(0, +$('#aG', m).value || 0), B = Math.max(0, +$('#aB', m).value || 0);
    const where = $('input[name="aW"]:checked', m).value;
    if (where === 'new') { doc.pages.splice(doc.cur + 1, 0, newPage(p.w, 1000, `페이지 ${doc.pages.length + 1}`)); doc.cur++; }
    const pg = page(); const start = contentBottom(pg); let y = start > 0 ? start + G : M;
    const made = [];
    for (const id of list) {
      const r = images.get(id), w = pg.w - M * 2, h = w * r.h / r.w;
      const el = makePanel(M + w / 2, y + h / 2, w, h, id); el.bw = B; pg.els.push(el); made.push(el); y += h + G;
    }
    const endY = Math.ceil(y - G + M);
    pg.h = start > 0 ? Math.max(pg.h, endY) : endY;
    marks = []; sel = made.map(e => e.id); closeModal(); commit(); fitView(); renderPages(); renderProps(); renderLib(); requestRender();
    if (made[0] && start > 0) scrollToEl(made[0]);
    toast(`${made.length}컷을 놓았어요. 이제 말풍선을 올려 보세요.`);
  });
}

/* ================= 내보내기 ================= */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  const d = new Date(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), nm = enc.encode(f.name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
    parts.push(lh, nm, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true);
    ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, off, true);
    cen.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cs = cen.reduce((s, x) => s + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cs, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...cen, end], { type: 'application/zip' });
}
async function renderPageFiles(p, pi, o) {
  const MAX = 16000, files = [];
  let sh = o.slice > 0 ? o.slice : p.h;
  if (sh * o.scale > MAX) sh = Math.floor(MAX / o.scale);
  const n = Math.ceil(p.h / sh), ext = o.fmt === 'jpg' ? 'jpg' : 'png';
  for (let i = 0; i < n; i++) {
    const y0 = i * sh, hh = Math.min(sh, p.h - y0);
    const c = newCanvas(p.w * o.scale, Math.max(1, hh * o.scale));
    const g = c.getContext('2d'); g.setTransform(o.scale, 0, 0, o.scale, 0, -y0 * o.scale); drawPage(g, p, { screen: false, rs: o.scale, view: { x0: 0, y0, x1: p.w, y1: y0 + hh } });
    if (ext === 'png') flattenAlpha(c);
    const blob = await new Promise(r => c.toBlob(r, ext === 'jpg' ? 'image/jpeg' : 'image/png', 0.93));
    if (!blob) throw new Error('canvas');
    files.push({ name: `page${String(pi + 1).padStart(2, '0')}${n > 1 ? '_' + String(i + 1).padStart(2, '0') : ''}.${ext}`, blob });
  }
  return files;
}
/* NAI 정보: PNG 글자 정보(tEXt 등)와 투명도 맨 끝 비트에 숨긴 정보. 지우기 = 둘 다 없앰, 남기기 = 원래 그림에서 옮겨 담음 */
function metaPref() { try { return localStorage.getItem('potatoMeta') === 'keep' ? 'keep' : 'strip'; } catch (_) { return 'strip'; } }
function setMetaPref(v) { try { localStorage.setItem('potatoMeta', v === 'keep' ? 'keep' : 'strip'); } catch (_) { } }
function pngTextChunks(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), out = [];
  if (u.length < 16 || u[1] !== 0x50 || u[2] !== 0x4E || u[3] !== 0x47) return out;
  for (let p = 8; p + 12 <= u.length;) {
    const len = dv.getUint32(p), type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') out.push(u.slice(p, p + 12 + len));
    if (type === 'IEND') break; p += 12 + len;
  }
  return out;
}
async function pngWithText(blob, chunks) {
  if (!chunks.length) return blob;
  const u = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(u.buffer), at = 8 + 12 + dv.getUint32(8); // IHDR 바로 뒤에
  return new Blob([u.slice(0, at), ...chunks, u.slice(at)], { type: 'image/png' });
}
function copyAlpha(c, im) { // 원래 그림의 투명도 값을 그대로 (숨은 정보가 여기 있어요)
  const W = c.width, H = c.height, t = newCanvas(W, H), gt = t.getContext('2d', { willReadFrequently: true });
  gt.imageSmoothingEnabled = false; gt.drawImage(im, 0, 0, W, H);
  const src = gt.getImageData(0, 0, W, H).data, g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, W, H), d = id.data;
  for (let i = 3; i < d.length; i += 4) d[i] = src[i];
  g.putImageData(id, 0, 0);
}
function flattenAlpha(c) { // 거의 불투명한 곳은 완전히 불투명하게 (숨은 정보 지우기)
  const g = c.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, c.width, c.height), d = id.data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 250 && d[i] < 255) { d[i] = 255; n++; }
  if (n) g.putImageData(id, 0, 0);
}
async function renderImageFile(p, o) {
  const rec = p.img && images.get(p.img), st = rec && /^data:image\/(png|jpeg|webp)/.exec(rec.src || '');
  const type = o.fmt === 'jpg' ? 'image/jpeg' : o.fmt === 'png' ? 'image/png' : (st ? 'image/' + st[1] : 'image/png');
  const sc = o.scale, c = newCanvas(p.w * sc, p.h * sc), g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(sc, 0, 0, sc, 0, 0);
  if (p.bgT && type === 'image/jpeg') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, p.w, p.h); } // JPG는 투명이 없어서 흰색
  drawPage(g, p, { screen: false, rs: sc, view: { x0: 0, y0: 0, x1: p.w, y1: p.h } });
  if (type === 'image/jpeg') { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.restore(); }
  const keep = o.meta === 'keep' && type === 'image/png' && rec && /^data:image\/png/.test(rec.src || '');
  if (keep) { // 자르거나 돌리지 않았을 때만 투명도 정보도 그대로
    const B = baseEl(p), im = imgCache.get(rec.id);
    if (sc === 1 && B && B.img === p.img && !B.rot && !B.flip && Math.abs(B.x) < 0.01 && Math.abs(B.y) < 0.01 && p.w === rec.w && p.h === rec.h && Math.abs(B.w - p.w) < 0.01 && Math.abs(B.h - p.h) < 0.01 && im && im.complete) copyAlpha(c, im);
  } else if (type === 'image/png') flattenAlpha(c);
  let blob = await new Promise(r => c.toBlob(r, type, 0.93)); if (!blob) throw new Error('canvas');
  if (keep) blob = await pngWithText(blob, pngTextChunks(b64ToBuf(rec.src.slice(rec.src.indexOf(',') + 1))));
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  return { name: safeName(String(p.name || '그림').replace(/\.[^.]+$/, '')) + '.' + ext, blob };
}
function openImgExport() {
  const p = page(), mp = metaPref();
  if (p.ph) { toast('먼저 고칠 그림을 불러와 주세요'); return; }
  const fo = p.folder ? folderById(p.folder) : null, all = realIdx(), inFold = fo ? all.filter(i => inFolder(doc.pages[i].folder, fo.id)) : [];
  const m = modal(`<h2>그림으로 저장하기</h2><p class="sub">고친 그림을 원래 파일 이름으로 저장해요. 여러 장이면 폴더 그대로 ZIP 하나로 묶어 드려요.</p>
    ${row('범위', `<div class="radios"><label class="chk"><input type="radio" name="eS" value="cur" checked> 지금 그림</label>${fo ? `<label class="chk"><input type="radio" name="eS" value="fold"> '${esc(fo.name)}' 폴더 (${inFold.length}장)</label>` : ''}<label class="chk"><input type="radio" name="eS" value="all" ${all.length < 2 ? 'disabled' : ''}> 모든 그림 (${all.length}장)</label></div>`)}
    ${row('파일 형식', `<div class="radios"><label class="chk"><input type="radio" name="eF" value="same" checked> 원래 형식</label><label class="chk"><input type="radio" name="eF" value="png"> PNG</label><label class="chk"><input type="radio" name="eF" value="jpg"> JPG (용량 작게)</label></div>`)}
    ${row('크기', `<div class="radios"><label class="chk"><input type="radio" name="eX" value="0.5"> 절반</label><label class="chk"><input type="radio" name="eX" value="1" checked> 원래 크기</label><label class="chk"><input type="radio" name="eX" value="2"> 2배</label></div>`)}
    ${row('NAI 정보', `<div class="radios"><label class="chk"><input type="radio" name="eM" value="strip" ${mp === 'strip' ? 'checked' : ''}> 지우기</label><label class="chk"><input type="radio" name="eM" value="keep" ${mp === 'keep' ? 'checked' : ''}> 남기기</label></div>`)}
    <div class="note">NAI 정보는 그림 파일 안에 숨어 있는 생성 정보(프롬프트, 설정값)예요. 남기기는 PNG로 저장할 때만 되고, JPG나 다른 형식은 항상 지워져요. 자르거나 돌린 그림은 글자 정보만 남고 투명도에 숨긴 정보는 지워져요.</div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="eGo">저장하기</button></div>`);
  $('#eGo', m).addEventListener('click', async () => {
    const b = $('#eGo', m); b.disabled = true; b.textContent = '만드는 중…';
    const sc = $('input[name="eS"]:checked', m).value, o = { fmt: $('input[name="eF"]:checked', m).value, scale: +$('input[name="eX"]:checked', m).value, meta: $('input[name="eM"]:checked', m).value };
    setMetaPref(o.meta);
    const list = sc === 'all' ? all : sc === 'fold' ? inFold : [doc.cur];
    try {
      await document.fonts.ready;
      const files = [], used = new Set();
      for (let k = 0; k < list.length; k++) {
        const pp = doc.pages[list[k]]; if (list.length > 3) b.textContent = `만드는 중… ${k + 1} / ${list.length}`;
        const f = await renderImageFile(pp, o), dir = list.length > 1 && pp.folder && folderById(pp.folder) ? folderPath(pp.folder).split('/').map(safeName).join('/') + '/' : '';
        let nm = dir + f.name, n = 2; while (used.has(nm.toLowerCase())) nm = dir + f.name.replace(/(\.[^.]+)$/, `(${n++})$1`); used.add(nm.toLowerCase());
        files.push({ name: nm, blob: f.blob });
      }
      const how = files.length === 1 ? await download(files[0].blob, files[0].name.split('/').pop()) : await saveFiles(files, `${safeName(doc.name)}.zip`);
      if (!how) { b.disabled = false; b.textContent = '저장하기'; return; }
      closeModal(); toast(files.length === 1 ? '그림을 저장했어요' : how === 'dir' ? `${files.length}장을 고른 폴더에 저장했어요` : `${files.length}장을 ZIP 파일로 저장했어요`);
    } catch (e) { b.disabled = false; b.textContent = '저장하기'; toast('저장하지 못했어요. 크기를 원래 크기로 바꾸거나 범위를 줄여 보세요.', 4000); }
  });
}
function openExportModal() {
  if (mode) setMode(null);
  if (isImg()) { openImgExport(); return; }
  const p = page(), tall = p.h > p.w * 1.8;
  const m = modal(`<h2>이미지로 내보내기</h2><p class="sub">완성된 그림 파일로 저장해요. 파일이 여러 개면 ZIP 하나로 묶어 드려요.</p>
    ${row('범위', `<div class="radios"><label class="chk"><input type="radio" name="eS" value="cur" checked> 지금 페이지</label><label class="chk"><input type="radio" name="eS" value="all" ${doc.pages.length < 2 ? 'disabled' : ''}> 모든 페이지 (${doc.pages.length}장)</label></div>`)}
    ${row('파일 형식', `<div class="radios"><label class="chk"><input type="radio" name="eF" value="png" checked> PNG (화질 그대로)</label><label class="chk"><input type="radio" name="eF" value="jpg"> JPG (용량 작게)</label></div>`)}
    ${row('크기', `<div class="radios"><label class="chk"><input type="radio" name="eX" value="1" checked> 원래 크기</label><label class="chk"><input type="radio" name="eX" value="2"> 2배 (더 선명하게)</label></div>`)}
    ${row('나눠 저장', `<label class="chk"><input type="checkbox" id="eSl" ${tall ? 'checked' : ''}> 세로</label>&nbsp;<input type="number" id="eSh" value="1280" style="width:76px"> px마다 자르기`)}
    <div class="note">웹툰 사이트에 올릴 때 한 장 길이 제한이 있으면 '나눠 저장'을 켜세요. 너무 긴 페이지는 저장할 수 있도록 자동으로 나눠요. 컷 편집은 여러 그림을 합치기 때문에 NAI 정보(생성 프롬프트)는 항상 지워져요.</div>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="eGo">저장하기</button></div>`);
  $('#eGo', m).addEventListener('click', async () => {
    const b = $('#eGo', m); b.disabled = true; b.textContent = '만드는 중…';
    const o = { fmt: $('input[name="eF"]:checked', m).value, scale: +$('input[name="eX"]:checked', m).value, slice: $('#eSl', m).checked ? Math.max(100, +$('#eSh', m).value || 1280) : 0 };
    const all = $('input[name="eS"]:checked', m).value === 'all';
    try {
      await document.fonts.ready;
      const list = all ? doc.pages.map((pp, i) => [pp, i]) : [[p, doc.cur]];
      let files = []; for (const [pp, i] of list) files = files.concat(await renderPageFiles(pp, i, o));
      const base = safeName(doc.name);
      const how = files.length === 1 ? await download(files[0].blob, `${base}_${files[0].name}`) : await saveFiles(files, `${base}.zip`);
      if (!how) { b.disabled = false; b.textContent = '저장하기'; return; }
      closeModal(); toast(files.length === 1 ? '그림 파일을 저장했어요' : how === 'dir' ? `${files.length}장을 고른 폴더에 저장했어요` : `${files.length}장을 ZIP 파일로 저장했어요`);
    } catch (e) { b.disabled = false; b.textContent = '저장하기'; toast('저장하지 못했어요. 크기를 원래 크기로 바꾸거나 나눠 저장을 켜 보세요.', 4000); }
  });
}

/* ================= 프로젝트 파일 ================= */
async function saveProject() {
  if (mode === 'pen') setMode(null);
  const used = usedSet();
  const recs = [...images.values()].filter(r => r.kind !== 'stamp' || used.has(r.id));
  const data = { app: 'potato-editor', v: 3, doc: { ...JSON.parse(snapStr()), cur: doc.cur }, imageOrder,
    images: recs.map(r => ({ id: r.id, name: r.name, src: r.src, w: r.w, h: r.h, kind: r.kind, alpha: r.alpha, folder: r.folder || null })),
    fonts: fonts.map(f => ({ name: f.name, data: f.data })) };
  try { if (!(await download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${safeName(doc.name)}.json`))) return; }
  catch (e) { toast('저장하지 못했어요 (' + String((e && e.message) || e).slice(0, 60) + ')', 5000); return; }
  toast('작업 파일을 저장했어요. 나중에 열기로 이어서 할 수 있어요.', 3200);
}
async function openProjectFile(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d || (d.app !== 'cut-editor' && d.app !== 'potato-editor') || !d.doc) throw new Error('format');
    if (mode) setMode(null);
    images.clear(); imgCache.clear(); thumbImgs.clear(); imageOrder = []; marks = []; clearImgCaches(); layoutCache.clear(); alphaMaps.clear(); activeLayer.clear(); await idb.clear('imgs');
    for (const r of d.images || []) {
      addImageRecord({ id: r.id, name: r.name, src: r.src, w: r.w, h: r.h, kind: r.kind, alpha: r.alpha, folder: r.folder || null }, true);
      if (r.kind === 'stamp' && !stamps.has(r.id)) { const s = { id: r.id, name: r.name, src: r.src, w: r.w, h: r.h, kind: 'stamp', at: Date.now() }; stamps.set(r.id, s); loadImg(r.src).then(im => { makeThumb(s, im, true); idb.put('stamps', s); renderStamps(); }).catch(() => { }); }
    }
    imageOrder = (d.imageOrder || imageOrder).filter(id => images.has(id) && images.get(id).kind !== 'stamp');
    for (const f of d.fonts || []) await registerFont(f.name, f.data, true);
    doc = normalizeDoc(d.doc); sel = []; imageEditId = null;
    closeModal(); resetHistory(); fitView(); renderAll(); scheduleSave(); toast(`'${doc.name}'을(를) 열었어요`);
  } catch (e) { toast('이 파일은 열 수 없어요. 이 편집기에서 저장한 .json 파일인지 확인해 주세요.', 4000); }
}

/* ================= 명령 ================= */
function freeSpot(pt) {
  const p = { ...pt }, els = page().els;
  for (let k = 0; k < 25 && els.some(e => { const c = center(e); return Math.abs(c.x - p.x) < 30 && Math.abs(c.y - p.y) < 30; }); k++) { p.x += 44; p.y += 44; }
  return p;
}
function placeNear(el) {
  const pg = page(), others = pg.els.filter(e => e.type !== 'panel' && e !== el).map(aabb);
  if (!others.length) return;
  const b0 = aabb(el), sx = b0.w * 0.85 + 12, sy = b0.h * 0.85 + 12;
  const offs = [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1], [0, 2], [2, 0], [0, -2], [-2, 0], [1, 2], [-1, 2], [2, 1], [-2, 1], [2, 2], [-2, 2]];
  const ov = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 0 && h > 0 ? w * h / Math.min(a.w * a.h, b.w * b.h) : 0; };
  for (const [i, j] of offs) {
    const b = { x: b0.x + i * sx, y: b0.y + j * sy, w: b0.w, h: b0.h };
    if (b.x < 0 || b.y < 0 || b.x + b.w > pg.w || b.y + b.h > pg.h) continue;
    if (others.every(o => ov(b, o) < 0.12)) { moveBy(el, i * sx, j * sy); return; }
  }
}
function addPanel() {
  if (mode) setMode(null);
  const pg = page(), c = freeSpot(viewCenter()), tall = pg.h > pg.w * 1.6;
  const w = tall ? pg.w - 80 : pg.w * 0.5, h = w * 0.72;
  const el = makePanel(c.x, c.y, w, h); pg.els.push(el); sel = [el.id]; commit(); renderProps(); requestRender();
}
function addBubble(shape) {
  if (mode) setMode(null);
  const v = viewCenter(), el = makeBubble(v.x, v.y - 30, shape); placeNear(el); page().els.push(el); sel = [el.id]; commit(); renderProps(); requestRender();
  openInline(el);
}
function addText(preset) {
  if (mode) setMode(null);
  const c = viewCenter(), el = makeText(c.x, c.y, preset && preset.p ? preset : null);
  placeNear(el); page().els.push(el); sel = [el.id]; commit(); renderProps(); requestRender();
  if (!preset || !preset.p) openInline(el);
}
function closeMenus() { $('#menuBubble').hidden = true; $('#menuSplit').hidden = true; $('#menuCz').hidden = true; }
function openMenu(menuId, btnId) {
  const m = $(menuId), was = !m.hidden; closeMenus(); if (was) return;
  const r = $(btnId).getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = (r.bottom + 6) + 'px'; m.hidden = false;
}
$('#menuBubble').addEventListener('click', e => { const b = e.target.closest('[data-bubble]'); if (!b) return; closeMenus(); addBubble(b.dataset.bubble); });
$('#menuSplit').addEventListener('click', e => {
  const b = e.target.closest('[data-split]'); if (!b) return; closeMenus();
  if (b.dataset.split === 'template') { if (mode) setMode(null); openTemplateModal(); }
  else {
    if (!page().els.some(x => x.type === 'panel')) { toast('먼저 컷을 만들어 주세요. 그림을 끌어다 놓거나 위쪽 컷 버튼을 누르면 돼요.', 3500); return; }
    setMode('split', b.dataset.split);
  }
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu') && !e.target.closest('#bBubble') && !e.target.closest('#bSplit') && !e.target.closest('#bCz')) closeMenus(); });
$('#menuCz').addEventListener('click', e => {
  const b = e.target.closest('[data-cz]'); if (!b || b.disabled) return; closeMenus();
  const a = b.dataset.cz;
  if (a === 'page') czRunPage(false); else if (a === 'sel') czRunPage(true); else if (a === 'clear') czClearPage();
  else if (a === 'all') czRunPages(realIdx(), '모든 그림 자동 흰칠하는 중');
  else if (a === 'fold') { const f = page().folder; czRunPages(realIdx().filter(i => inFolder(doc.pages[i].folder, f)), f ? `'${(folderById(f) || {}).name}' 폴더 자동 흰칠하는 중` : '폴더 없는 그림 자동 흰칠하는 중'); }
  else if (a === 'batch') openCzStudio(); else if (a === 'cfg') openCzCfg();
});
function openCzMenu() {
  if (isImg()) { const f = page().folder, fo = f && folderById(f), n = realIdx().filter(i => inFolder(doc.pages[i].folder, f)).length; $('#menuCz [data-cz="page"] span').textContent = '이 그림 자동 흰칠'; $('#menuCz [data-cz="clear"] span').textContent = '이 그림 자동 흰칠 지우기'; $('#menuCz [data-cz="all"] span').textContent = `모든 그림 자동 흰칠 (${realIdx().length}장)`; $('#menuCz [data-cz="fold"] span').textContent = fo ? `'${fo.name}' 폴더 자동 흰칠 (${n}장)` : `폴더 없는 그림 자동 흰칠 (${n}장)`; }
  else { $('#menuCz [data-cz="page"] span').textContent = '이 페이지 자동 흰칠'; $('#menuCz [data-cz="clear"] span').textContent = '이 페이지 자동 흰칠 지우기'; }
  const n = selEls().filter(e => e.type === 'panel' && layerCount(e) > 0).length, b = $('#menuCz [data-cz="sel"]');
  b.disabled = !n; b.lastChild.textContent = n ? `고른 컷 ${n}개만 자동 흰칠` : '고른 컷만 자동 흰칠 (컷을 먼저 고르세요)';
  openMenu('#menuCz', '#bCz');
}
function openHelp() {
  modal(`<h2>사용법</h2>
    <ol class="tips" style="font-size:13px">
      <li><b>두 가지 방식</b>: <b>컷 편집</b>은 여러 그림을 칸에 나눠 웹툰·만화를 만들고, <b>이미지 편집</b>은 그림을 한 장씩 그대로 고쳐서 원래 이름으로 저장해요. 위쪽 '새로 만들기'에서 골라요.</li>
      <li><b>그림·폴더 넣기</b>: 왼쪽 '+ 그림', '+ 폴더째' 또는 그림·폴더를 화면에 끌어오기. 폴더째 넣으면 폴더 이름 그대로 묶여요. '새 폴더'로 폴더를 만들고 그림을 폴더 이름 위로 끌어다 놓아 정리해요. 복사한 그림은 <kbd>Ctrl</kbd>+<kbd>V</kbd>.</li>
      <li><b>이미지 편집</b>: 왼쪽 목록에서 그림을 골라 고쳐요(<kbd>PageUp</kbd>/<kbd>PageDown</kbd>로 넘기기). 바탕 그림은 고정돼 있어요. 위쪽 '자르기', 오른쪽 '돌리기·뒤집기'를 쓸 수 있고, 글자를 고른 뒤 '다른 그림에도 넣기'로 서명을 한 번에 넣어요.</li>
      <li><b>컷 만들기</b>: 보관함 그림을 캔버스로 끌어다 놓기. 컷 위에 놓으면 그 컷 안으로 들어가요. 웹툰은 '세로로 자동 배치'가 가장 빨라요.</li>
      <li><b>컷 자르기</b>: 위쪽 '컷 나누기'에서 직선이나 곡선을 고르고, 컷을 가로질러 선을 그어요.</li>
      <li><b>컷 안에서 그림 옮기기</b>: 컷을 더블클릭한 뒤 끌기, 마우스 휠로 크기 조절. 투명한 그림은 레이어로 겹쳐져요(한 컷에 10장).</li>
      <li><b>분위기</b>: 컷이나 바탕 그림을 고르고 오른쪽에서 보정, 분위기, 스크린톤, 효과선을 넣어요.</li>
      <li><b>말풍선</b>: 모양을 골라 넣고, 더블클릭해서 대사를 고치고, 파란 동그라미로 꼬리 방향을 바꿔요. 글자 테두리와 기울임도 있어요.</li>
      <li><b>글자</b>: 오른쪽 '스타일 한 번에 바꾸기'로 네온, 그림자, 자막 띠, 금빛, 아치, 세로쓰기를 고르고, 후광(빛 번짐)·그림자·배경 띠를 따로 조절할 수 있어요.</li>
      <li><b>효과음</b>: 왼쪽 '효과음' 탭에서 클릭하거나 끌어다 놓아요. 위쪽 '펜'으로 직접 그릴 수도 있어요(태블릿 필압 지원).</li>
      <li><b>가리기</b>: 위쪽 '가리기'에서 블러, 모자이크, 흰칠을 골라 칠해요. '지우개'(<kbd>E</kbd>)로 이미 가린 곳(자동 흰칠 포함)을 지울 수 있고, '칠하기'(<kbd>B</kbd>)로 돌아와요. 다 하면 <kbd>Enter</kbd>.</li>
      <li><b>자동 흰칠</b>: '자동 흰칠'에서 이 페이지(이미지 편집이면 모든 그림, 이 폴더)를 고르면 성기 모양을 따라 흰칠해요(유두는 그대로). '빠르게'와 '정밀하게'는 설정에서 바꿔요. 잘못 칠한 곳은 지우개로, 빠진 곳은 칠하기로 고쳐요. 모두 이 컴퓨터 안에서만 처리돼요.</li>
      <li><b>저장</b>: '내보내기'에서 PNG/JPG로 저장해요. 이미지 편집은 원래 이름 그대로, 여러 장이면 폴더째 ZIP으로 묶여요. 'NAI 정보'에서 생성 정보를 지울지 남길지 골라요.</li>
      <li><b>가장자리 매끄럽게</b>: 아무것도 안 고른 상태에서 오른쪽 아래 '가장자리 매끄럽게'로 말풍선·글자 가장자리를 더 곱게 할 수 있어요.</li>
      <li><b>보관</b>: 작업은 이 브라우저에 자동 저장돼요. 다른 컴퓨터로 옮기거나 백업하려면 '저장'으로 파일을 받아 두세요. 오른쪽 위 달 모양 버튼으로 어두운 화면을 켜요.</li>
      <li><b>고급 보정</b>: 그림이나 컷을 고르면 오른쪽 '고급 보정'에서 빛·색, 곡선, 레벨, 색상별, 선명하게·필름 질감, 보정 프리셋을 써요. 같은 보정을 폴더나 모든 그림에 한 번에 넣을 수 있어요.</li>
      <li><b>선택</b>: 위쪽 '선택'으로 사각형·타원·올가미·비슷한 색을 골라요(<kbd>Shift</kbd> 더하기, <kbd>Alt</kbd> 빼기). 고른 곳을 흐리게·모자이크·칠하기·지우기 하거나, '새 레이어로 복사'해서 그 부분만 보정해요.</li>
      <li><b>고치기 붓</b>: '가리기'에서 지우기(투명), 도장(<kbd>Alt</kbd>+클릭으로 복사할 곳), 잡티 지우기를 골라 칠해요.</li>
      <li><b>AI 도구</b> (설치판): 그림을 고르면 오른쪽 'AI 도구'에서 배경 지우기·인물만 새 레이어로·배경만 흐리게, 화질 키우기(2배·4배)를 써요. 처음 쓸 때 팩을 받아요.</li>
      <li><b>레이어</b>: 왼쪽 '레이어' 탭에서 숨기기·잠그기·끌어서 순서 바꾸기·불투명도·섞는 법을 바꿔요. 두 번 누르면 이름을 바꿔요.</li>
      <li><b>움짤</b>: 위쪽 '움짤'을 누르면 프리미어 프로처럼 왼쪽 재료(장면·글자·효과·넘김), 가운데 미리보기, 오른쪽 속성, 아래 시간 막대로 나뉜 화면이 열려요. 시간 막대에서 장면 오른쪽 끝을 끌면 길이, 가운데를 끌면 순서가 바뀌어요. 글자·효과 막대는 끌어서 시간과 줄을 옮기고 양끝으로 늘여요. 장면 사이 ◇를 누르면 넘김을 골라요. 단축키: <kbd>Space</kbd> 재생, <kbd>←</kbd><kbd>→</kbd> 한 장씩, <kbd>↑</kbd><kbd>↓</kbd> 장면 경계로, <kbd>C</kbd> 자르기 도구, <kbd>V</kbd> 고르기 도구, <kbd>Ctrl</kbd>+<kbd>K</kbd> 재생 위치에서 나누기, <kbd>T</kbd> 글자 넣기, <kbd>Ctrl</kbd>+휠 확대, <kbd>Ctrl</kbd>+<kbd>M</kbd> 내보내기.</li>
      <li><b>크기</b>: 이미지 편집에서 아무것도 안 고르면 오른쪽 '크기 바꾸기'로 그림 크기, 캔버스 크기, 정사각형·4:5 여백을 바꿔요.</li>
    </ol>
    <p class="muted small" style="margin-top:12px">되돌리기 <kbd>Ctrl+Z</kbd>, 다시 하기 <kbd>Ctrl+Y</kbd>, 복제 <kbd>Ctrl+D</kbd>, 복사와 붙여넣기 <kbd>Ctrl+C</kbd>/<kbd>V</kbd>, 삭제 <kbd>Delete</kbd>, 조금씩 옮기기 방향키(<kbd>Shift</kbd>와 함께 10칸), 화면 끌기 <kbd>Space</kbd>+드래그, 확대 <kbd>Ctrl</kbd>+휠, 비율 유지 <kbd>Shift</kbd>+모서리, 자석 잠시 끄기 <kbd>Alt</kbd></p>
    <div class="foot">${window.POTATO_BUILD ? `<span class="muted small" style="margin-right:auto;align-self:center">감자 편집기 ${esc(window.POTATO_BUILD.version)}</span>` : ''}${appApi() ? '<button class="btn" id="helpUpd">업데이트 확인</button>' : ''}<button class="btn primary" data-close>알겠어요</button></div>`, { wide: true });
  const u = document.getElementById('helpUpd'); if (u) u.addEventListener('click', () => { closeModal(); checkUpdate(true); });
}
const CMDS = {
  new: () => openNewModal(false), open: () => $('#fileProj').click(), save: saveProject, undo, redo,
  'add-panel': addPanel, 'bubble-menu': () => openMenu('#menuBubble', '#bBubble'), 'split-menu': () => openMenu('#menuSplit', '#bSplit'), 'cz-menu': openCzMenu,
  'add-text': () => addText(), pen: () => setMode(mode === 'pen' ? null : 'pen'), brush: () => setMode(mode === 'brush' ? null : 'brush'),
  'zoom-in': () => zoomStep(1), 'zoom-out': () => zoomStep(-1), 'zoom-fit': fitView,
  export: openExportModal, help: openHelp, theme: () => setTheme(isDark() ? 'light' : 'dark'), gif: openGifStudio, import: () => pickFiles(false), 'import-dir': () => pickFiles(true), 'new-folder': () => newFolder(null),
  'img-prev': () => navImg(-1), 'img-next': () => navImg(1), crop: () => setMode(mode === 'crop' ? null : 'crop'), select: () => setMode(mode === 'select' ? null : 'select'), autolayout: openAutoLayout,
  'import-stamp': () => $('#fileStamp').click(), 'import-pack': () => $('#filePack').click(),
  'page-add': () => pageCmd('page-add'), 'page-dup': () => pageCmd('page-dup'), 'page-up': () => pageCmd('page-up'), 'page-down': () => pageCmd('page-down'), 'page-del': () => pageCmd('page-del'),
};
document.addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b && CMDS[b.dataset.cmd]) CMDS[b.dataset.cmd](); });
$('#snapTgl').addEventListener('change', e => { snapOn = e.target.checked; });
$('#docName').addEventListener('change', e => { doc.name = e.target.value.trim() || '새 작품'; e.target.value = doc.name; commit(); });
$('#docName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#fileImg').addEventListener('change', async e => { const files = [...e.target.files]; e.target.value = ''; const cb = pickCb; pickCb = null; const items = files.map(f => ({ file: f, dir: null })); if (cb) cb(items); else await addImages(items); });
$('#fileDir').addEventListener('change', async e => { const files = [...e.target.files]; e.target.value = ''; const cb = pickCb; pickCb = null; const items = files.map(f => ({ file: f, dir: dirOf(f.webkitRelativePath || '') })); if (cb) cb(items); else await addImages(items); });
$('#fileStamp').addEventListener('change', async e => { const n = await importStamps(e.target.files, $('#stampWhite').checked); e.target.value = ''; if (n) { switchTab('sfx'); toast(`효과음 ${n}개를 넣었어요. 클릭하거나 끌어다 놓으면 들어가요.`); } });
$('#filePanelImg').addEventListener('change', async e => {
  const ids = await importFiles(e.target.files); e.target.value = '';
  const tg = panelPickTarget, el = tg && findEl(tg.id); panelPickTarget = null;
  if (!ids.length || !el) return;
  if (tg.li === 'add') { for (const id of ids) if (!newLayer(el, id, null)) break; }
  else if (tg.li === 0) { el.img = ids[0]; el.iz = 1; el.ox = 0; el.oy = 0; el.lrot = 0; }
  else { const L = layerObj(el, tg.li); if (L) { const r = images.get(ids[0]), o = images.get(L.img); if (o && r) L.iz = (L.iz ?? 1) * Math.max(el.w / o.w, el.h / o.h) * o.w / (Math.max(el.w / r.w, el.h / r.h) * r.w); L.img = ids[0]; } }
  sel = [el.id]; commit(); renderProps(); requestRender();
});
$('#filePack').addEventListener('change', async e => { const fs = [...e.target.files]; e.target.value = ''; for (const f of fs) await importPackZip(f); });
$('#fileProj').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); });
$('#fileFont').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const name = f.name.replace(/\.[^.]+$/, '').replace(/["']/g, '').trim() || '내 글꼴';
  const ok = await registerFont(name, bufToB64(await f.arrayBuffer()), true);
  if (ok) { for (const o of selEls()) if (o.type === 'text' || o.type === 'bubble') setProp(o, 'font', name); commit(); renderProps(); requestRender(); toast(`'${name}' 글꼴을 쓸 수 있어요`); }
});

/* ================= 키보드, 붙여넣기 ================= */
const isTyping = t => t && (t.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable="true"]'));
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (gifOpen()) { if (mod && k === 's') e.preventDefault(); gsKey(e); return; }
  if (czOpen()) { if (mod && k === 's') e.preventDefault(); czsKey(e); return; }
  if (mod && k === 's') { e.preventDefault(); saveProject(); return; }
  if (e.key === 'Escape') {
    if (modalOpen()) { closeModal(); return; }
    if (!$('#menuBubble').hidden || !$('#menuSplit').hidden || !$('#menuCz').hidden) { closeMenus(); return; }
    if (mode === 'split' && splitSt && splitSt.phase !== 'idle') { splitSt = { kind: splitSt.kind, phase: 'idle' }; drag = null; requestRender(); return; }
    if (mode) { setMode(null); return; }
    if (imageEditId) { imageEditId = null; renderProps(); requestRender(); return; }
    if (sel.length && !isTyping(e.target)) { sel = []; renderProps(); requestRender(); }
    return;
  }
  if (isTyping(e.target) || modalOpen()) return;
  if (isImg() && !mode && (e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); navImg(e.key === 'PageDown' ? 1 : -1); return; }
  if (e.key === ' ' && !spaceDown) { spaceDown = true; scroller.style.cursor = 'grab'; e.preventDefault(); return; }
  if (mode === 'pen' && mod && k === 'z') { e.preventDefault(); if (penSt) { penSt.strokes.pop(); requestRender(); } return; }
  if (mode === 'brush' && mod && k === 'z') { e.preventDefault(); brushUndo(); return; }
  if (mode === 'brush' && !mod && (k === 'e' || k === 'b')) { e.preventDefault(); brushErase = k === 'e'; if (brushSt) brushSt.erase = brushErase; renderModebar(); requestRender(); return; }
  if (mode === 'crop' && e.key === 'Enter') { e.preventDefault(); applyCrop(); return; }
  if (mode === 'select' && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); setMode(null); return; }
  if ((mode === 'pen' || mode === 'brush') && e.key === 'Enter') { e.preventDefault(); setMode(null); return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && k === 'a') { e.preventDefault(); sel = page().els.filter(x => !x.lock).map(x => x.id); renderProps(); requestRender(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); return; }
  if (mod && k === '-') { e.preventDefault(); zoomStep(-1); return; }
  if (mod && k === '0') { e.preventDefault(); fitView(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) { e.preventDefault(); deleteSel(); } return; }
  if (e.key === 'Enter' && sel.length === 1) { const el = findEl(sel[0]); if (el && (el.type === 'bubble' || el.type === 'text')) { e.preventDefault(); openInline(el); } return; }
  const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k] && sel.length && e.target.type !== 'range') {
    e.preventDefault(); const st = e.shiftKey ? 10 : 1;
    const ed = imageEditId && findEl(imageEditId), L = ed && activeObj(ed);
    if (L && L.img) { const q = rot(arrows[k][0] * st, arrows[k][1] * st, -(ed.rot || 0) * DEG); L.ox = (L.ox || 0) + q.x; L.oy = (L.oy || 0) + q.y; if (L === ed) clampImage(ed); }
    else { const ss = selEls().filter(o => !o.lock), mv = ss.concat(czLinked(page().els, new Set(ss.filter(x => x.type === 'panel').map(x => x.id))).filter(x => !ss.includes(x))); for (const o of mv) moveBy(o, arrows[k][0] * st, arrows[k][1] * st); }
    syncProps(); requestRender(); clearTimeout(document._nt); document._nt = setTimeout(commit, 350);
  }
});
document.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; if (!drag) scroller.style.cursor = mode ? 'crosshair' : 'default'; } });
window.addEventListener('blur', () => { spaceDown = false; });
const CLIP_MARK = '[감자 편집기 요소]';
document.addEventListener('copy', e => {
  if (gifOpen() || czOpen() || isTyping(e.target) || !sel.length) return;
  clip = selEls().filter(o => !o.lock).map(clone); if (!clip.length) return; e.clipboardData.setData('text/plain', CLIP_MARK); e.preventDefault(); toast(`${clip.length}개 복사했어요`, 1400);
});
document.addEventListener('cut', e => {
  if (gifOpen() || czOpen() || isTyping(e.target) || !sel.length) return;
  clip = selEls().filter(o => !o.lock).map(clone); if (!clip.length) return; e.clipboardData.setData('text/plain', CLIP_MARK); e.preventDefault(); deleteSel();
});
document.addEventListener('paste', async e => {
  if (isTyping(e.target) || modalOpen()) return;
  const items = [...(e.clipboardData ? e.clipboardData.items : [])];
  const files = items.filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
  const txt = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  if (gifOpen()) { if (files.length) { e.preventDefault(); gsAddFiles(files); } return; }
  if (czOpen()) { if (files.length) { e.preventDefault(); czsAddFiles(files); } return; }
  if (files.length && txt !== CLIP_MARK && isImg()) { e.preventDefault(); addImages(files.map(f => ({ file: f, dir: null }))); return; }
  if (files.length && txt !== CLIP_MARK) {
    e.preventDefault(); const ids = await importFiles(files);
    if (ids[0]) placeImage(ids[0]); return;
  }
  if (clip && clip.length) {
    e.preventDefault(); const copies = clip.map(o => { const c = clone(o); c.id = uid(); moveBy(c, 24, 24); return c; });
    clip = copies.map(clone); page().els.push(...copies); sel = copies.map(c => c.id); commit(); renderProps(); requestRender();
  }
});

/* ================= 화면 밝기 (밝은/어두운) ================= */
const SUN = '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M13.6 10.2A6 6 0 015.8 2.4a6 6 0 107.8 7.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
const isDark = () => document.documentElement.dataset.theme === 'dark';
function setTheme(t) {
  document.documentElement.dataset.theme = t; try { localStorage.setItem('potatoTheme', t); } catch (_) { }
  const b = $('#bTheme'); if (b) { b.innerHTML = t === 'dark' ? SUN : MOON; b.title = t === 'dark' ? '밝은 화면으로' : '어두운 화면으로'; }
  deskPat = null; requestRender(); scheduleThumbs();
}
setTheme(isDark() ? 'dark' : 'light');

/* ================= 시작 ================= */
function renderAll() {
  document.body.classList.toggle('imgmode', isImg());
  if (isImg() && !$('#tab-pages').hidden) switchTab('lib');
  updateNav();
  $('#docName').value = doc.name; document.title = `${doc.name} | 감자 편집기`;
  layoutSpacer(); renderLib(); renderStamps(); renderPages(); renderProps(); updateUndo(); updateHint(); requestRender();
}
new ResizeObserver(() => { layoutSpacer(); requestRender(); }).observe(work);
window.addEventListener('resize', () => requestRender());
if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { layoutCache.clear(); layerCache.clear(); fontGen++; requestRender(); });
/* ================= 업데이트 (exe판) ================= */
// 켤 때 한 번 깃허브에 새 버전이 있는지 보고, 있으면 오른쪽 아래에 알려요. 누르면 받아서 설치하고 다시 켜요
async function checkUpdate(manual) {
  const T = appApi(); if (!T || !T.updater) { if (manual) toast('업데이트 확인은 설치판(exe)에서만 돼요'); return; }
  let up = null;
  try { up = await T.updater.check(); }
  catch (e) { if (manual) toast('업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요. (' + String((e && e.message) || e).slice(0, 60) + ')', 5000); return; }
  if (!up) { if (manual) toast(`지금이 최신 버전이에요 (${window.POTATO_BUILD.version})`); return; }
  const old = $('#updBar'); if (old) old.remove();
  const bar = document.createElement('div'); bar.id = 'updBar';
  bar.innerHTML = `<span>새 버전 <b>${esc(up.version)}</b>이 나왔어요</span><button class="btn sm primary" id="updGo">업데이트</button><button class="btn sm" id="updLater">나중에</button>`;
  document.body.appendChild(bar);
  $('#updLater', bar).addEventListener('click', () => bar.remove());
  $('#updGo', bar).addEventListener('click', () => {
    bar.remove();
    const m = modal(`<h2>새 버전 ${esc(up.version)}으로 업데이트</h2>
      <p class="sub">받아서 설치한 뒤 감자 편집기가 잠깐 닫혔다가 새 버전으로 다시 열려요. 지금 작업은 자동 저장한 뒤 진행해요.</p>
      ${up.body ? `<div class="muted small" style="white-space:pre-wrap;max-height:180px;overflow:auto;margin:8px 0">${esc(up.body)}</div>` : ''}
      <div class="czbar"><i id="updBarI"></i></div><p class="muted small" id="updMsg">&nbsp;</p>
      <div class="foot"><button class="btn" data-close>나중에</button><button class="btn primary" id="updNow">지금 업데이트</button></div>`);
    $('#updNow', m).addEventListener('click', async () => {
      const go = $('#updNow', m); go.disabled = true;
      try {
        await saveNow();
        let total = 0, got = 0;
        await up.downloadAndInstall(ev => {
          if (ev.event === 'Started') total = (ev.data && ev.data.contentLength) || 0;
          else if (ev.event === 'Progress') got += (ev.data && ev.data.chunkLength) || 0;
          else if (ev.event === 'Finished') { $('#updMsg', m).textContent = '설치하는 중…'; return; }
          $('#updBarI', m).style.width = (total ? Math.round(got / total * 100) : 50) + '%';
          $('#updMsg', m).textContent = total ? `${(got / 1e6).toFixed(1)}MB / ${(total / 1e6).toFixed(1)}MB 받는 중…` : '받는 중…';
        });
        if (T.process) await T.process.relaunch();
      } catch (e) {
        go.disabled = false; $('#updMsg', m).textContent = '업데이트하지 못했어요. 나중에 다시 해 주세요. (' + String((e && e.message) || e).slice(0, 80) + ')';
      }
    });
  });
}

async function boot() {
  await idb.open();
  try { const v = localStorage.getItem('cutSfxVar'); if (v === 'ink' || v === 'outline' || v === 'white') sfxVar = v; } catch (_) { }
  for (const s of (await idb.all('stamps')) || []) stamps.set(s.id, s);
  for (const p of (await idb.all('packs')) || []) packs.push(p);
  const saved = await idb.get('doc');
  let restored = false;
  for (const f of (await idb.all('fonts')) || []) await registerFont(f.name, f.data, false);
  if (saved && saved.s) {
    try {
      const imgs = (await idb.all('imgs')) || [];
      for (const r of imgs) addImageRecord(r, false);
      imageOrder = (saved.imageOrder || []).filter(id => images.has(id) && images.get(id).kind !== 'stamp');
      for (const r of imgs) if (r.kind !== 'stamp' && !imageOrder.includes(r.id)) imageOrder.push(r.id);
      doc = normalizeDoc({ ...JSON.parse(saved.s), cur: saved.cur });
      restored = true;
    } catch (e) { restored = false; }
  }
  resetHistory(); fitView(); renderAll();
  if (restored) { $('#saveState').textContent = '지난 작업 열림'; toast('지난번 작업을 이어서 열었어요'); }
  else openNewModal(true);
}
boot();
if (appApi()) setTimeout(() => checkUpdate(false), 4000);
})();
</script>
