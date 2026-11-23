// 보관함에서 하는 일: 넣기, 폴더 옮기기, 지우기, 폴더째 꺼내기, NAI 정보 지우기
import { state, commit, addMedia, ensureFolder, folders, folderById, folderDesc, folderPath, mediaBlob, replaceMediaBlob } from './store.js';
import { hasMeta, stripMeta } from './files.js';

// items = [{ file, dir }] → 폴더 모양 그대로 보관함에. onStep(끝난 수, 전체)
export async function importItems(items, base = null, onStep) {
  const made = [], failed = [];
  for (let i = 0; i < items.length; i++) {
    const { file, dir } = items[i];
    try { made.push(await addMedia(file, ensureFolder(dir, base), { meta: await hasMeta(file) })); }
    catch (_) { failed.push(file.name); }
    if (onStep) onStep(i + 1, items.length);
  }
  return { made, failed };
}

export const mediaIn = (fid, deep = true) => { const set = fid ? (deep ? folderDesc(fid) : new Set([fid])) : null; return state.project.media.filter(m => !m.hidden && (set ? set.has(m.folder) : deep || !m.folder)); };

export function moveMedia(ids, to) {
  const p = state.project; let n = 0;
  for (const m of p.media) if (ids.includes(m.id) && (m.folder || null) !== to) { m.folder = to; n++; }
  if (n) commit(to ? `'${folderById(to).name}' 폴더로 옮기기` : '폴더에서 빼기');
  return n;
}
export function moveFolder(id, to) {
  const f = folderById(id); if (!f || id === to || (f.parent || null) === to) return 'same';
  if (to && folderDesc(id).has(to)) return 'inside';
  f.parent = to; commit('폴더 옮기기'); return 'ok';
}
export function newFolder(name, parent = null) { const id = ensureFolder(name.replace(/\//g, ' '), parent); commit('새 폴더'); return id; }
export function renameFolder(id, name) { const f = folderById(id); if (f && name.trim()) { f.name = name.replace(/\//g, ' ').trim(); commit('폴더 이름 바꾸기'); } }
// 폴더만 지우고 안에 있던 그림과 폴더는 한 칸 위로
export function deleteFolder(id) {
  const p = state.project, f = folderById(id); if (!f) return;
  const up = f.parent || null;
  p.media.forEach(m => { if (m.folder === id) m.folder = up; });
  folders().forEach(x => { if (x.parent === id) x.parent = up; });
  p.folders = folders().filter(x => x.id !== id); commit('폴더 지우기');
}
export const layersUsing = ids => state.project.canvases.reduce((n, c) => n + c.layers.filter(l => ids.includes(l.mediaId)).length, 0);
export function removeMedia(ids) {
  const p = state.project;
  p.media = p.media.filter(m => !ids.includes(m.id));
  p.canvases.forEach(c => { c.layers = c.layers.filter(l => !ids.includes(l.mediaId)); });
  if (p.sel && !p.canvases.some(c => c.layers.some(l => l.id === p.sel))) p.sel = null;
  commit(ids.length > 1 ? `그림 ${ids.length}장 빼기` : '그림 빼기');
}

// 꺼낼 파일 목록: 폴더 모양을 이름에 담아요 ('캐릭터A/표정/01.png'). fid가 있으면 그 폴더를 맨 위로.
export async function collectFiles(list, { strip = true, root = null, onStep } = {}) {
  const out = [], rootPath = root ? folderPath(folderById(root).parent) : '';
  for (let i = 0; i < list.length; i++) {
    const m = list[i]; let blob = await mediaBlob(m.id); if (!blob) continue;
    if (strip && m.meta) blob = await stripMeta(blob);
    let dir = folderPath(m.folder);
    if (rootPath && dir.startsWith(rootPath + '/')) dir = dir.slice(rootPath.length + 1);
    out.push({ name: (dir ? dir + '/' : '') + m.name, blob });
    if (onStep) onStep(i + 1, list.length);
  }
  return out;
}
// 보관함에 든 파일 자체에서 NAI 정보를 지워요 (되돌리기로는 돌아오지 않아요)
export async function stripMedia(list, onStep) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m.meta) { const b = await mediaBlob(m.id); if (b) { await replaceMediaBlob(m.id, await stripMeta(b)); m.meta = false; n++; } }
    if (onStep) onStep(i + 1, list.length);
  }
  if (n) commit(`NAI 정보 지우기 (${n}장)`);
  return n;
}
