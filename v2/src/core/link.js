// 다른 프로그램과 잇기 (NAIS3 등): 그 프로그램의 저장 폴더를 지켜보다가 새 그림을 보관함으로 가져오고,
// 반대로 지금 그림을 '보낼 폴더'에 PNG로 내보내요. 프로그램 안쪽을 건드리지 않고 폴더만 같이 써요.
import { state, idb, emit, commit, addMedia, ensureFolder, canvasOf, layerOf } from './store.js';
import { settings } from './settings.js';
import { hasMeta } from './files.js';
import { toast } from '../ui/overlay.js';

const L = { dir: null, out: null, seen: new Set(), timer: 0, busy: false, on: false, got: 0 };
// 설치판(Tauri)은 폴더를 길(path)로 다뤄요. 폴더 고르는 창에서 고른 폴더만 읽고 쓸 수 있어서, 편집기를 새로 켠 뒤 처음 한 번은 폴더를 다시 확인해요
const app = () => { const T = window.__TAURI__; return T && T.dialog && T.fs && T.path ? T : null; };
const base = p => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
export const linkState = () => ({ on: L.on, name: app() ? base(L.path || settings.get('linkPath')) : L.dir ? L.dir.name : (settings.get('linkName') || ''), out: app() ? base(L.outPath || settings.get('linkOutPath')) : L.out ? L.out.name : (settings.get('linkOutName') || ''), got: L.got, can: !!app() || !!window.showDirectoryPicker });
async function listPicsApp(T, dir, depth = 2, rel = '') {
  const out = [];
  for (const e of await T.fs.readDir(dir)) { const p = await T.path.join(dir, e.name); if (e.isFile && isPic(e.name)) out.push({ key: rel + e.name, path: p, name: e.name }); else if (e.isDirectory && depth > 0) out.push(...await listPicsApp(T, p, depth - 1, rel + e.name + '/')); }
  return out;
}
async function tickApp(T) {
  const fresh = (await listPicsApp(T, L.path)).filter(p => !L.seen.has(p.key)); if (!fresh.length) return [];
  const folder = ensureFolder(settings.get('linkFolder') || 'NAIS3에서 온 그림'), added = [];
  for (const p of fresh) {
    try { const st = await T.fs.stat(p.path); if (st.mtime && Date.now() - new Date(st.mtime).getTime() < 700) continue; } catch (_) { /* 시각을 못 읽어도 가져와요 */ }
    L.seen.add(p.key);
    try { const u = await T.fs.readFile(p.path), ext = p.name.split('.').pop().toLowerCase(); const f = new File([u], p.name, { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }); added.push(await addMedia(f, folder, { meta: await hasMeta(f) })); } catch (_) { /* 깨진 파일은 건너뜀 */ }
  }
  return added;
}
const isPic = n => /\.(png|webp|jpe?g)$/i.test(n);
// 폴더 안의 그림 파일들 (하위 폴더 두 단계까지: NAIS3의 '2026-11' 같은 달 폴더)
async function listPics(dir, depth = 2, path = '') {
  const out = [];
  for await (const [name, hnd] of dir.entries()) {
    if (hnd.kind === 'file' && isPic(name)) out.push({ key: path + name, hnd });
    else if (hnd.kind === 'directory' && depth > 0) out.push(...await listPics(hnd, depth - 1, path + name + '/'));
  }
  return out;
}
async function allow(h, mode) { if (!h) return false; const o = { mode }; return (await h.queryPermission(o)) === 'granted' || (await h.requestPermission(o)) === 'granted'; }

async function tick() {
  if (!L.on || L.busy || !(L.dir || L.path)) return; L.busy = true;
  try {
    const T = app(), added = T ? await tickApp(T) : [];
    const fresh = T ? [] : (await listPics(L.dir)).filter(p => !L.seen.has(p.key)); if (!T && !fresh.length) return;
    const folder = T ? null : ensureFolder(settings.get('linkFolder') || 'NAIS3에서 온 그림');
    for (const p of fresh) {
      const f = await p.hnd.getFile(); if (Date.now() - f.lastModified < 700) continue;   // 아직 쓰는 중일 수 있어요. 다음 번에
      L.seen.add(p.key);
      try { added.push(await addMedia(f, folder, { meta: await hasMeta(f) })); } catch (_) { /* 그림이 아니거나 깨진 파일은 건너뜀 */ }
    }
    if (!added.length) return;
    L.got += added.length;
    if (settings.get('linkToCanvas') && canvasOf()) { const { placeMedia } = await import('../rooms/image.js'); for (const m of added) await placeMedia(m.id); }
    commit(`가져오기: 그림 ${added.length}장`); toast(`${linkState().name}에서 새 그림 ${added.length}장을 보관함에 넣었어요.`);
  } catch (e) { stopWatch(); toast('지켜보던 폴더를 읽지 못해서 멈췄어요. 다시 켜 주세요.', 'err'); }
  finally { L.busy = false; }
}
// 지켜보기 시작: pick = 폴더를 새로 고름. 이미 있는 그림은 가져오지 않고, 켠 뒤에 생기는 그림만 가져와요
export async function startWatch(pick) {
  const T = app();
  if (T) {
    try {
      if (pick || !L.path) { const d = await T.dialog.open({ directory: true, recursive: true, defaultPath: settings.get('linkPath') || undefined, title: 'NAIS3의 메인 저장 폴더 고르기' }); if (!d) return false; L.path = d; settings.set('linkPath', d); }
      L.seen = new Set((await listPicsApp(T, L.path)).map(p => p.key)); L.on = true; L.got = 0; clearInterval(L.timer); L.timer = setInterval(tick, 2000); emit();
      toast(`'${base(L.path)}' 폴더를 지켜보기 시작했어요. 이제부터 새로 생기는 그림이 보관함에 들어와요.`); return true;
    } catch (e) { toast('폴더를 읽지 못했어요. (' + String((e && e.message) || e).slice(0, 80) + ')', 'err'); return false; }
  }
  if (!window.showDirectoryPicker) { toast('이 브라우저에서는 폴더를 지켜볼 수 없어요. 설치판이나 크롬·엣지에서 써 주세요.', 'err'); return false; }
  try {
    if (pick || !L.dir) L.dir = pick ? await window.showDirectoryPicker({ id: 'potato-link-in', mode: 'read' }) : (await idb.get('blobs', 'link:dir')) || await window.showDirectoryPicker({ id: 'potato-link-in', mode: 'read' });
    if (!await allow(L.dir, 'read')) { toast('폴더를 읽어도 된다고 허락해 주셔야 해요.', 'err'); return false; }
    await idb.put('blobs', 'link:dir', L.dir); settings.set('linkName', L.dir.name);
    L.seen = new Set((await listPics(L.dir)).map(p => p.key)); L.on = true; L.got = 0;
    clearInterval(L.timer); L.timer = setInterval(tick, 2000); emit();
    toast(`'${L.dir.name}' 폴더를 지켜보기 시작했어요. 이제부터 새로 생기는 그림이 보관함에 들어와요.`);
    return true;
  } catch (e) { if (e && e.name !== 'AbortError') toast('폴더를 열지 못했어요.', 'err'); return false; }
}
export function stopWatch() { L.on = false; clearInterval(L.timer); emit(); }
// 보내기: 고른 레이어(없으면 그림판 전체)를 '보낼 폴더'에 PNG로 저장해요. 그 폴더를 탐색기에 띄워 두고 상대 프로그램으로 끌어다 놓으면 돼요
export async function sendOut(pickDir) {
  const T = app();
  if (T) {
    const c = canvasOf(); if (!c) return null;
    try {
      if (pickDir || !L.outPath) { const d = await T.dialog.open({ directory: true, recursive: true, defaultPath: settings.get('linkOutPath') || undefined, title: '보낼 폴더 고르기 (여기에 PNG로 저장해요)' }); if (!d) return null; L.outPath = d; settings.set('linkOutPath', d); }
      const { flatten } = await import('../rooms/image.js'), l = layerOf(), flat = await flatten(c, l ? l.id : null), blob = await new Promise(r => flat.toBlob(r, 'image/png'));
      const d2 = new Date(), p2 = n => String(n).padStart(2, '0'), name = `${(l ? l.name : c.name).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 40)} ${p2(d2.getHours())}${p2(d2.getMinutes())}${p2(d2.getSeconds())}.png`;
      await T.fs.writeFile(await T.path.join(L.outPath, name), new Uint8Array(await blob.arrayBuffer()));
      if (L.on && L.path === L.outPath) L.seen.add(name);
      toast(`'${base(L.outPath)}' 폴더에 '${name}'으로 저장했어요. 그 파일을 상대 프로그램 창에 끌어다 놓으면 돼요.`); emit(); return name;
    } catch (e) { toast('보내지 못했어요. (' + String((e && e.message) || e).slice(0, 80) + ')', 'err'); return null; }
  }
  if (!window.showDirectoryPicker) { toast('이 브라우저에서는 폴더로 보낼 수 없어요. PNG로 내보내기를 써 주세요.', 'err'); return null; }
  const c = canvasOf(); if (!c) return null;
  try {
    if (pickDir || !L.out) L.out = pickDir ? await window.showDirectoryPicker({ id: 'potato-link-out', mode: 'readwrite' }) : (await idb.get('blobs', 'link:out')) || await window.showDirectoryPicker({ id: 'potato-link-out', mode: 'readwrite' });
    if (!await allow(L.out, 'readwrite')) { toast('폴더에 저장해도 된다고 허락해 주셔야 해요.', 'err'); return null; }
    await idb.put('blobs', 'link:out', L.out); settings.set('linkOutName', L.out.name);
    const { flatten } = await import('../rooms/image.js'), l = layerOf(), flat = await flatten(c, l ? l.id : null), blob = await new Promise(r => flat.toBlob(r, 'image/png'));
    const d = new Date(), p2 = n => String(n).padStart(2, '0'), name = `${(l ? l.name : c.name).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 40)} ${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
    const w = await (await L.out.getFileHandle(name, { create: true })).createWritable(); await w.write(blob); await w.close();
    if (L.on && L.dir && await L.dir.isSameEntry(L.out)) L.seen.add(name);   // 같은 폴더를 쓰면 내가 보낸 그림을 다시 가져오지 않게
    toast(`'${L.out.name}' 폴더에 '${name}'으로 저장했어요. 그 파일을 상대 프로그램 창에 끌어다 놓으면 돼요.`); emit();
    return name;
  } catch (e) { if (e && e.name !== 'AbortError') toast('보내지 못했어요. ' + (e.message || ''), 'err'); return null; }
}
