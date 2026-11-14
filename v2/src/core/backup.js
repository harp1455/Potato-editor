// 백업: 작업(설정, 레이어, 페이지, 영상)과 그 안의 그림·소리를 ZIP 하나로 내보내고, 다시 들여와요.
import { idb, state, saveNow } from './store.js';
import { makeZip, unzipAll } from './files.js';

const blobKeys = p => [...p.media.flatMap(m => [m.id, 't:' + m.id]), ...(p.sequences || []).flatMap(s => [...(s.audio ? [s.audio] : []), ...(s.audios || [])].map(a => 'aud:' + a.id))];
// ids가 없으면 모든 작업
export async function backupZip(ids, onStep) {
  await saveNow();
  const all = await idb.all('projects'), ps = ids ? all.filter(p => ids.includes(p.id)) : all, files = [{ name: 'potato2-backup.json', blob: new Blob([JSON.stringify({ kind: 'potato2-backup', v: 1, at: Date.now(), projects: ps.map(p => ({ id: p.id, name: p.name })) })]) }];
  let done = 0; const seen = new Set();
  for (const p of ps) {
    files.push({ name: `projects/${p.id}.json`, blob: new Blob([JSON.stringify(p)]) });
    for (const k of blobKeys(p)) { if (seen.has(k)) continue; seen.add(k); const b = await idb.get('blobs', k); if (b) files.push({ name: 'blobs/' + encodeURIComponent(k), blob: b }); }
    if (onStep) onStep(++done, ps.length);
  }
  return { blob: await makeZip(files), count: ps.length };
}
// 백업 ZIP을 들여와요. 같은 작업이 이미 있으면 그대로 두고 건너뛰어요(덮어쓰지 않음). 돌려주는 값 = { added, skipped }
export async function restoreZip(file) {
  const items = await unzipAll(await file.arrayBuffer()), dec = new TextDecoder(), head = items.find(i => i.name === 'potato2-backup.json');
  if (!head || JSON.parse(dec.decode(head.data)).kind !== 'potato2-backup') throw new Error('감자 편집기 2의 백업 파일이 아니에요.');
  const have = new Set(await idb.keys('projects')), blobs = new Map(items.filter(i => i.name.startsWith('blobs/')).map(i => [decodeURIComponent(i.name.slice(6)), i.data]));
  let added = 0, skipped = 0;
  for (const it of items.filter(i => i.name.startsWith('projects/'))) {
    const p = JSON.parse(dec.decode(it.data));
    if (have.has(p.id)) { skipped++; continue; }
    for (const k of blobKeys(p)) { const d = blobs.get(k); if (!d) continue; const m = p.media.find(x => x.id === k.replace(/^t:/, '')); await idb.put('blobs', k, new Blob([d], { type: k.startsWith('aud:') ? 'audio/*' : (m && m.type) || 'image/png' })); }
    await idb.put('projects', p.id, p); added++;
  }
  return { added, skipped, now: state.project.id };
}
