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
    r.onerror = () => { dbp = null; rej(r.error); };   // 다음에 다시 열어 볼 수 있게
  });
  return dbp;
}
async function tx(store, mode, f) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), rq = f(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('저장 공간이 모자라거나 저장이 중단됐어요.'));   // 공간이 모자라면 오류 없이 중단만 돼요
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
  return { v: 2, id: uid('p'), name: name || '새 작업', at: Date.now(), media: [], canvases: [], sequences: [], characters: [], folders: [], activeCanvas: null, sel: null };
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
  try { await idb.put('projects', p.id, clone(p)); state.saved = true; state.saveErr = ''; try { localStorage.setItem('potato2.last', p.id); } catch (_) { /* 마지막 작업 기억만 못 해요 */ } }
  catch (e) { console.error(e); state.saved = false; const first = !state.saveErr; state.saveErr = (e && e.message) || '알 수 없는 까닭'; if (first) onSaveErr(state.saveErr); }
  emit(); return state.saved;
}
// 저장이 안 될 때 한 번 알려요 (다시 저장되면 다음 실패 때 또 알려요)
let onSaveErr = () => {};
export const setSaveErrHandler = f => { onSaveErr = f; };

// 큰 그림은 그림판에 올라갔을 때만 풀어 두고, 보관함에는 작은 미리보기만 써요 (폴더째 수백 장을 넣어도 가볍게)
async function loadThumbs(p) {
  state.bitmaps.forEach(b => b.close && b.close());
  state.thumbs.forEach(u => URL.revokeObjectURL(u));
  state.bitmaps.clear(); state.thumbs.clear(); loading.clear();
  await Promise.all(p.media.map(async m => {
    const t = await idb.get('blobs', 't:' + m.id) || await idb.get('blobs', m.id);
    if (t) state.thumbs.set(m.id, URL.createObjectURL(t));
  }));
  const used = new Set(p.canvases.flatMap(c => c.layers.map(l => l.mediaId)));
  await Promise.all([...used].map(ensureBitmap));
}
const loadBitmaps = loadThumbs;
const loading = new Map();
export function ensureBitmap(id) {
  if (state.bitmaps.has(id)) return Promise.resolve(state.bitmaps.get(id));
  if (!loading.has(id)) loading.set(id, (async () => {
    try { const blob = await idb.get('blobs', id); if (!blob) return null; const b = await createImageBitmap(blob); state.bitmaps.set(id, b); emit(); return b; }
    catch (_) { return null; } finally { loading.delete(id); }
  })());
  return loading.get(id);
}
function reset(p, label) {
  state.project = p; hist.items = [{ label, snap: clone(p), t: Date.now() }]; hist.at = 0; state.saved = true; emit();
}
export async function newProject(name) {
  await loadBitmaps({ media: [], canvases: [] });
  reset(blank(name), '새 작업');
  await saveNow();
}
export async function openProject(id) {
  const p = await idb.get('projects', id);
  if (!p) return false;
  for (const k of ['media', 'folders', 'canvases']) if (!Array.isArray(p[k])) p[k] = [];   // 옛 판이나 깨진 기록에 빠진 칸은 비워서 열어요
  await loadBitmaps(p); reset(p, '작업 열기');
  localStorage.setItem('potato2.last', id);
  return true;
}
export const listProjects = async () => (await idb.all('projects')).sort((a, b) => b.at - a.at).map(p => ({ id: p.id, name: p.name, at: p.at, media: p.media.length, canvases: p.canvases.length }));
// 안 쓰는 그림 정리: 붓질·AI 도구가 남긴 '보이지 않는 그림' 가운데, 지금 작업에서도 되돌리기 기록에서도 쓰지 않는 것을 지워요.
// 돌려주는 값 = { n(지운 장 수), bytes }
export async function tidyMedia() {
  const p = state.project; if (!p) return { n: 0, bytes: 0 };
  const strip = q => JSON.stringify({ ...q, media: [] }), used = strip(p) + hist.items.map(x => strip(x.snap)).join('');
  const dead = p.media.filter(m => m.hidden && !used.includes('"' + m.id + '"')); if (!dead.length) return { n: 0, bytes: 0 };
  const ids = new Set(dead.map(m => m.id)); let bytes = 0;
  p.media = p.media.filter(m => !ids.has(m.id)); for (const x of hist.items) x.snap.media = x.snap.media.filter(m => !ids.has(m.id));
  for (const m of dead) { bytes += m.size || 0; const b = state.bitmaps.get(m.id); if (b && b.close) b.close(); state.bitmaps.delete(m.id); await idb.del('blobs', m.id); await idb.del('blobs', 't:' + m.id); }
  state.saved = false; scheduleSave(); return { n: dead.length, bytes };
}
// 작업 하나에 딸린 저장 조각들: 그림과 미리보기, 영상 작업실의 소리·클립, 영상
export const blobKeys = p => [...(p.media || []).flatMap(m => [m.id, 't:' + m.id]), ...(p.sequences || []).flatMap(s => [...(s.audio ? [s.audio] : []), ...(s.audios || [])].map(a => 'aud:' + a.id).concat([...new Set((s.scenes || []).filter(x => x.clip).map(x => 'clip:' + x.clip))])), ...(p.videos || []).map(v => 'vid:' + v.id)];
export async function deleteProject(id) {
  const p = await idb.get('projects', id);
  if (p) for (const k of blobKeys(p)) await idb.del('blobs', k);
  await idb.del('projects', id);
}
export async function boot() {
  // 마지막 작업을 못 열어도 프로그램은 켜져야 해요: 빈 작업으로 시작하고 까닭을 돌려줘요
  let last = null; try { last = localStorage.getItem('potato2.last'); } catch (_) { /* 저장 공간이 막힌 환경 */ }
  try { if (last && await openProject(last)) return null; } catch (e) { console.error(e); reset(blank(), '새 작업'); return (e && e.message) || '알 수 없는 까닭'; }
  reset(blank(), '새 작업'); return null;
}

// ---- 보관함 ----
async function makeThumb(bmp) {
  const k = Math.min(1, 192 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/webp', 0.8));
}
export async function addMedia(file, folder = null, info = {}) {
  const bmp = await createImageBitmap(file);
  const m = { id: uid('m'), name: file.name || '그림', type: 'image', w: bmp.width, h: bmp.height, size: file.size, folder, ...info };
  const thumb = await makeThumb(bmp); bmp.close();
  await idb.put('blobs', m.id, file);
  if (thumb) await idb.put('blobs', 't:' + m.id, thumb);
  state.thumbs.set(m.id, URL.createObjectURL(thumb || file));
  state.project.media.push(m);
  return m;
}
// 보관함 그림의 파일을 바꿔요 (NAI 정보 지우기 등). 크기는 그대로라 미리보기는 안 바뀌어요
export async function replaceMediaBlob(id, blob) {
  await idb.put('blobs', id, blob);
  const b = state.bitmaps.get(id); if (b) { b.close && b.close(); state.bitmaps.delete(id); await ensureBitmap(id); }
  const m = state.project.media.find(m => m.id === id); if (m) m.size = blob.size;
}

// ---- 폴더: 나무 모양 { id, name, parent } ----
export const folders = () => state.project.folders || (state.project.folders = []);
export const folderById = id => folders().find(f => f.id === id) || null;
export function folderPath(id, sep = '/') { const out = []; for (let f = folderById(id), n = 0; f && n < 50; f = folderById(f.parent), n++) out.unshift(f.name); return out.join(sep); }
export function folderDesc(id) { const out = new Set([id]); let grew = true; while (grew) { grew = false; for (const f of folders()) if (f.parent && out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true; } } return out; }
export function ensureFolder(path, base = null) {
  let parent = base;
  for (const name of String(path || '').split('/').map(x => x.trim()).filter(Boolean)) {
    let f = folders().find(f => f.parent === parent && f.name === name);
    if (!f) { f = { id: uid('f'), name, parent }; folders().push(f); }
    parent = f.id;
  }
  return parent;
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
  c.layers.push(l); state.project.sel = l.id; ensureBitmap(m.id);
  return l;
}
