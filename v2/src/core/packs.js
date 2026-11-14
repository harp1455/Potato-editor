// AI 팩: 모델 파일 묶음. 한 번 받아 두고 계속 써요.
//   설치판 → 깃허브에서 바로 받아 앱 데이터 폴더에 보관
//   HTML판 → 브라우저는 깃허브 파일을 직접 못 받아서(막혀 있음), 내려받은 팩 파일을 편집기에 넣어 주면 브라우저 저장 공간에 보관
import { idb } from './store.js';

export const PACK_TAG = 'packs-7';
export const PACK_PAGE = 'https://github.com/harp1455/Potato-editor/releases/tag/' + PACK_TAG;
const PACK_URL = 'https://github.com/harp1455/Potato-editor/releases/download/' + PACK_TAG + '/';
export const MAN = typeof __PACKS__ === 'object' ? __PACKS__ : { packs: {}, files: [] };
const tauri = () => (window.__TAURI__ && window.__TAURI__.fs && window.__TAURI__.upload) ? window.__TAURI__ : null;
export const canDownload = () => !!tauri() || /^https?:/.test(location.protocol);
export const mb = n => (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'MB';
const sha = async u8 => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join('');

const store = (() => {
  const T = tauri();
  if (T) {
    const B = { baseDir: T.fs.BaseDirectory.AppData }, dir = 'packs/files';
    return {
      async size(f) { try { if (!(await T.fs.exists(dir + '/' + f, B))) return -1; return (await T.fs.stat(dir + '/' + f, B)).size; } catch (_) { return -1; } },
      async read(f) { return new Uint8Array(await T.fs.readFile(dir + '/' + f, B)); },
      async write(f, u8) { await T.fs.mkdir(dir, { recursive: true, ...B }); await T.fs.writeFile(dir + '/' + f, u8, B); },
      async fetch(f, onBytes) {
        await T.fs.mkdir(dir, { recursive: true, ...B });
        const part = f + '.part', abs = await T.path.join(await T.path.appDataDir(), 'packs', 'files', part);
        try { await T.fs.remove(dir + '/' + part, B); } catch (_) { /* 없으면 그만 */ }
        let got = 0;
        await T.upload.download(PACK_URL + f, abs, p => { got = p.progressTotal || got + (p.progress || 0); onBytes(got); });
        const u8 = new Uint8Array(await T.fs.readFile(dir + '/' + part, B));
        return { u8, keep: async () => { try { await T.fs.remove(dir + '/' + f, B); } catch (_) { /* 없으면 그만 */ } await T.fs.rename(dir + '/' + part, dir + '/' + f, { oldPathBaseDir: B.baseDir, newPathBaseDir: B.baseDir }); }, drop: async () => { try { await T.fs.remove(dir + '/' + part, B); } catch (_) { /* 없으면 그만 */ } } };
      },
      async remove(f) { try { await T.fs.remove(dir + '/' + f, B); } catch (_) { /* 없으면 그만 */ } },
    };
  }
  const key = f => 'pack:' + f, sizes = new Map();
  return {
    async size(f) { if (!sizes.has(f)) { const b = await idb.get('blobs', key(f)); sizes.set(f, b ? b.size : -1); } return sizes.get(f); },
    async read(f) { const b = await idb.get('blobs', key(f)); if (!b) throw new Error('nopack'); return new Uint8Array(await b.arrayBuffer()); },
    async write(f, u8) { await idb.put('blobs', key(f), new Blob([u8])); sizes.set(f, u8.length); },
    async fetch(f, onBytes) {   // 편집기와 같은 자리에 packs/ 폴더가 있을 때 (웹 주소로 열었을 때·시험)
      const res = await fetch(new URL('packs/' + f, location.href), { cache: 'no-store' }); if (!res.ok) throw new Error('HTTP ' + res.status);
      const rd = res.body.getReader(), parts = []; let n = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; onBytes(n); }
      const u8 = new Uint8Array(n); let o = 0; for (const p of parts) { u8.set(p, o); o += p.length; }
      return { u8, keep: () => this.write(f, u8), drop: async () => {} };
    },
    async remove(f) { await idb.del('blobs', key(f)); sizes.set(f, -1); },
  };
})();

// 필요한 것은 모델 이름(id)으로 적어요. 팩 전체가 아니라 그 기능이 쓰는 파일만 받으면 돼요
export const filesOf = ids => MAN.files.filter(f => ids.includes(f.id));
export const idsOfPack = pack => MAN.files.filter(f => f.pack === pack).map(f => f.id);
// 팩마다 다 받아 두었는지 { base: true, bg: false, … }
export async function packState() {
  const st = {}; Object.keys(MAN.packs).forEach(k => { st[k] = true; });
  for (const f of MAN.files) if (await store.size(f.file) !== f.size) st[f.pack] = false;
  return st;
}
export async function missingFiles(ids) { const out = []; for (const f of filesOf(ids)) if (await store.size(f.file) !== f.size) out.push(f); return out; }
// 받기 (설치판, 또는 같은 자리에 packs/ 폴더가 있을 때). onProg(받은 바이트, 전체 바이트)
export async function packGet(ids, onProg) {
  const todo = await missingFiles(ids), total = todo.reduce((a, f) => a + f.size, 0); let done = 0;
  for (const f of todo) {
    let ok = false;
    for (let tries = 0; tries < 2 && !ok; tries++) {
      const t = await store.fetch(f.file, n => onProg && onProg(done + Math.min(n, f.size), total));
      if (t.u8.length === f.size && await sha(t.u8) === f.sha256) { await t.keep(); ok = true; } else await t.drop();
    }
    if (!ok) throw new Error(f.file + ' 파일이 깨져서 왔어요');
    done += f.size; if (onProg) onProg(done, total);
  }
}
// 내려받은 팩 파일을 직접 넣기 (HTML판). 이름과 내용이 맞는 파일만 받아요 → 넣은 파일 이름들
export async function packAdd(files) {
  const added = [], bad = [];
  for (const file of files) {
    const f = MAN.files.find(x => x.file === file.name);
    if (!f) { bad.push(file.name); continue; }
    const u8 = new Uint8Array(await file.arrayBuffer());
    if (u8.length !== f.size || await sha(u8) !== f.sha256) { bad.push(file.name); continue; }
    await store.write(f.file, u8); added.push(f.file);
  }
  return { added, bad };
}
export async function packDel(pack) { for (const f of MAN.files) if (f.pack === pack) await store.remove(f.file); }
// 모델 하나의 원래 바이트 (팩 파일은 gzip으로 눌려 있어요)
export async function packBytes(id) {
  const f = MAN.files.find(x => x.id === id);
  if (!f || await store.size(f.file) !== f.size) throw new Error('nopack:' + (f ? f.pack : id));
  const gz = await store.read(f.file);
  return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
