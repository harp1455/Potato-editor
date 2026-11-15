// AI 팩: 모델 파일 묶음. 한 번 받아 두고 계속 써요.
//   설치판 → 깃허브에서 바로 받아 앱 데이터 폴더에 보관
//   HTML판 → 브라우저는 깃허브 파일을 직접 못 받아서(막혀 있음), 내려받은 팩 파일을 편집기에 넣어 주면 브라우저 저장 공간에 보관
import { idb } from './store.js';
import { settings } from './settings.js';

export const PACK_TAG = 'packs-7';
export const PACK_PAGE = 'https://github.com/harp1455/Potato-editor/releases/tag/' + PACK_TAG;
const PACK_URL = 'https://github.com/harp1455/Potato-editor/releases/download/' + PACK_TAG + '/';
export const MAN = typeof __PACKS__ === 'object' ? __PACKS__ : { packs: {}, files: [] };
const tauri = () => (window.__TAURI__ && window.__TAURI__.fs && window.__TAURI__.upload) ? window.__TAURI__ : null;
export const canDownload = () => !!tauri() || /^https?:/.test(location.protocol);
export const mb = n => (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + 'MB';
const sha = async u8 => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map(b => b.toString(16).padStart(2, '0')).join('');

// 설치판: 설정의 'AI 팩 저장 폴더'(packDir)가 있으면 그 폴더, 없으면 앱 데이터 폴더(C 드라이브의 사용자 폴더) 안의 packs/files
export const packDirOf = () => settings.get('packDir') || '';
const store = (() => {
  const T = tauri();
  if (T) {
    const at = async f => { const d = packDirOf(); return d ? { p: f ? await T.path.join(d, f) : d, o: {} } : { p: f ? 'packs/files/' + f : 'packs/files', o: { baseDir: T.fs.BaseDirectory.AppData } }; };
    const abs = async f => { const d = packDirOf(); return d ? T.path.join(d, f) : T.path.join(await T.path.appDataDir(), 'packs', 'files', f); };
    const mkdir = async () => { const r = await at(''); await T.fs.mkdir(r.p, { recursive: true, ...r.o }); };
    const rm = async f => { const r = await at(f); try { await T.fs.remove(r.p, r.o); } catch (_) { /* 없으면 그만 */ } };
    return {
      async size(f) { try { const r = await at(f); if (!(await T.fs.exists(r.p, r.o))) return -1; return (await T.fs.stat(r.p, r.o)).size; } catch (_) { return -1; } },
      async read(f) { const r = await at(f); return new Uint8Array(await T.fs.readFile(r.p, r.o)); },
      async write(f, u8) { await mkdir(); const r = await at(f); await T.fs.writeFile(r.p, u8, r.o); },
      async fetch(f, onBytes) {
        await mkdir(); const part = f + '.part'; await rm(part);
        let got = 0;
        await T.upload.download(PACK_URL + f, await abs(part), p => { got = p.progressTotal || got + (p.progress || 0); onBytes(got); });
        const rp = await at(part), u8 = new Uint8Array(await T.fs.readFile(rp.p, rp.o));
        return { u8, keep: async () => { await rm(f); const a = await at(part), b = await at(f); await T.fs.rename(a.p, b.p, a.o.baseDir ? { oldPathBaseDir: a.o.baseDir, newPathBaseDir: b.o.baseDir } : {}); }, drop: () => rm(part) };
      },
      remove: rm,
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

// AI 팩 저장 폴더 바꾸기 (설치판). 이미 받은 팩 파일은 새 폴더로 옮겨요(복사 → 확인 → 지우기). to가 ''이면 기본 자리로
export async function movePacks(to, onProg) {
  const T = tauri(); if (!T) throw new Error('설치판에서만 바꿀 수 있어요.');
  const from = packDirOf(), D = T.fs.BaseDirectory.AppData;
  const src = async f => from ? { p: await T.path.join(from, f), o: {} } : { p: 'packs/files/' + f, o: { baseDir: D } };
  const dst = async f => to ? { p: await T.path.join(to, f), o: {} } : { p: 'packs/files/' + f, o: { baseDir: D } };
  const d0 = await dst(''); await T.fs.mkdir(to || 'packs/files', to ? { recursive: true } : { recursive: true, baseDir: D });
  // 새 폴더에 쓸 수 있는지 먼저 봐요
  const probe = await dst('.potato-write-test'); await T.fs.writeFile(probe.p, new Uint8Array([1]), probe.o); await T.fs.remove(probe.p, probe.o);
  const have = []; for (const f of MAN.files) { const s = await src(f.file); try { if (await T.fs.exists(s.p, s.o) && (await T.fs.stat(s.p, s.o)).size === f.size) have.push(f); } catch (_) { /* 없음 */ } }
  const total = have.reduce((a, f) => a + f.size, 0); let done = 0;
  for (const f of have) {
    const s = await src(f.file), t = await dst(f.file);
    let ok = false; try { ok = await T.fs.exists(t.p, t.o) && (await T.fs.stat(t.p, t.o)).size === f.size; } catch (_) { /* 없음 */ }
    if (!ok) await T.fs.copyFile(s.p, t.p, { fromPathBaseDir: s.o.baseDir, toPathBaseDir: t.o.baseDir });
    if ((await T.fs.stat(t.p, t.o)).size !== f.size) throw new Error(f.file + '을 옮기지 못했어요.');
    done += f.size; onProg && onProg(done, total);
  }
  settings.set('packDir', to);
  for (const f of have) { const s = await src(f.file); try { await T.fs.remove(s.p, s.o); } catch (_) { /* 못 지워도 그만 */ } }
  void d0; return have.length;
}
