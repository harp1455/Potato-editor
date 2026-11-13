// 작업 하나 = 보관함(그림·영상·소리) + 그림판들 + 영상 시퀀스들 + 캐릭터들.
// 8.x처럼 '컷 작업 / 이미지 작업 / 영상 작업'으로 미리 가르지 않아요.
// 되돌리기도 여기 하나뿐이라, 어느 작업실에서 고쳤든 같은 기록에 쌓여요.

const DB = 'potato2';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('projects'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, f) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), rq = f(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
  });
}
export const idb = {
  get: (s, k) => tx(s, 'readonly', o => o.get(k)),
  put: (s, k, v) => tx(s, 'readwrite', o => o.put(v, k)),
  del: (s, k) => tx(s, 'readwrite', o => o.delete(k)),
  keys: s => tx(s, 'readonly', o => o.getAllKeys()),
  all: s => tx(s, 'readonly', o => o.getAll()),
};

export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));

function blank(name) {
  return { v: 2, id: uid('p'), name: name || '새 작업', at: Date.now(), media: [], canvases: [], sequences: [], characters: [], activeCanvas: null, sel: null };
}

export const state = {
  project: blank(),
  bitmaps: new Map(),   // 보관함 그림을 화면에 그릴 수 있게 풀어 둔 것 (mediaId → ImageBitmap)
  thumbs: new Map(),    // mediaId → 작은 미리보기 주소
  saved: true,
};

// ---- 알림 ----
const subs = new Set();
export const onChange = f => { subs.add(f); return () => subs.delete(f); };
let queued = false;
export function emit() {
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; subs.forEach(f => f()); });
}

// 마우스 좌표처럼 자주 바뀌는 값은 상태 줄만 다시 그려요
const ticks = new Set();
export const onTick = f => { ticks.add(f); };
export const tick = () => ticks.forEach(f => f());

// ---- 되돌리기 ----
const hist = { items: [], at: -1 };
const MAX = 200;
export const history = hist;

export function commit(label) {
  hist.items.length = hist.at + 1;
  hist.items.push({ label, snap: clone(state.project), t: Date.now() });
  if (hist.items.length > MAX) hist.items.shift();
  hist.at = hist.items.length - 1;
  state.saved = false; scheduleSave(); emit();
}
export function jump(i) {
  if (i < 0 || i >= hist.items.length || i === hist.at) return;
  hist.at = i; state.project = clone(hist.items[i].snap);
  state.saved = false; scheduleSave(); emit();
}
export const undo = () => jump(hist.at - 1);
export const redo = () => jump(hist.at + 1);
export const canUndo = () => hist.at > 0;
export const canRedo = () => hist.at < hist.items.length - 1;

// ---- 저장 ----
let saveT = 0;
function scheduleSave() { clearTimeout(saveT); saveT = setTimeout(saveNow, 600); }
export async function saveNow() {
  clearTimeout(saveT);
  const p = state.project; p.at = Date.now();
  try { await idb.put('projects', p.id, clone(p)); state.saved = true; localStorage.setItem('potato2.last', p.id); }
  catch (e) { console.error(e); state.saved = false; }
  emit();
}

async function loadBitmaps(p) {
  state.bitmaps.forEach(b => b.close && b.close());
  state.thumbs.forEach(u => URL.revokeObjectURL(u));
  state.bitmaps.clear(); state.thumbs.clear();
  for (const m of p.media) {
    const blob = await idb.get('blobs', m.id);
    if (!blob) continue;
    try { state.bitmaps.set(m.id, await createImageBitmap(blob)); state.thumbs.set(m.id, URL.createObjectURL(blob)); } catch (_) { /* 못 읽는 파일은 건너뜀 */ }
  }
}
function reset(p, label) {
  state.project = p; hist.items = [{ label, snap: clone(p), t: Date.now() }]; hist.at = 0; state.saved = true; emit();
}
export async function newProject(name) {
  await loadBitmaps({ media: [] });
  reset(blank(name), '새 작업');
  await saveNow();
}
export async function openProject(id) {
  const p = await idb.get('projects', id);
  if (!p) return false;
  await loadBitmaps(p); reset(p, '작업 열기');
  localStorage.setItem('potato2.last', id);
  return true;
}
export const listProjects = async () => (await idb.all('projects')).sort((a, b) => b.at - a.at).map(p => ({ id: p.id, name: p.name, at: p.at, media: p.media.length, canvases: p.canvases.length }));
export async function deleteProject(id) {
  const p = await idb.get('projects', id);
  if (p) for (const m of p.media) await idb.del('blobs', m.id);
  await idb.del('projects', id);
}
export async function boot() {
  const last = localStorage.getItem('potato2.last');
  if (last && await openProject(last)) return;
  reset(blank(), '새 작업');
}

// ---- 보관함 ----
export async function addMedia(file) {
  const bmp = await createImageBitmap(file);
  const m = { id: uid('m'), name: file.name || '그림', type: 'image', w: bmp.width, h: bmp.height, size: file.size };
  await idb.put('blobs', m.id, file);
  state.bitmaps.set(m.id, bmp); state.thumbs.set(m.id, URL.createObjectURL(file));
  state.project.media.push(m);
  return m;
}
export const mediaBlob = id => idb.get('blobs', id);

// ---- 그림판 ----
export const canvasOf = () => state.project.canvases.find(c => c.id === state.project.activeCanvas) || null;
export const layerOf = () => { const c = canvasOf(); return c ? c.layers.find(l => l.id === state.project.sel) || null : null; };
export function newCanvas(name, w, h) {
  const c = { id: uid('c'), name, w, h, bg: 'transparent', layers: [] };
  state.project.canvases.push(c); state.project.activeCanvas = c.id; state.project.sel = null;
  return c;
}
export function addLayer(c, m) {
  const s = Math.min(1, c.w / m.w, c.h / m.h);
  const l = { id: uid('l'), name: m.name.replace(/\.[a-z0-9]+$/i, ''), mediaId: m.id, x: Math.round((c.w - m.w * s) / 2), y: Math.round((c.h - m.h * s) / 2), scale: s, rot: 0, opacity: 1, visible: true, locked: false };
  c.layers.push(l); state.project.sel = l.id;
  return l;
}
