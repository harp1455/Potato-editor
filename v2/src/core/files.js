// 파일 다루기: 폴더째 읽기, 폴더째 저장(폴더에 바로 또는 ZIP), NAI 정보 찾기·지우기

const IMG = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
export const isImage = f => /^image\//.test(f.type) || IMG.test(f.name);

// ---- 읽기 ----
// 폴더 고르기 창(webkitdirectory)에서 온 파일들 → [{ file, dir }]
export const fromPicker = files => [...files].filter(isImage).map(f => ({ file: f, dir: (f.webkitRelativePath || '').split('/').slice(0, -1).join('/') }));

async function walkHandle(h, dir, out) {
  for await (const [name, child] of h.entries()) {
    if (child.kind === 'directory') await walkHandle(child, dir ? dir + '/' + name : name, out);
    else { const f = await child.getFile(); if (isImage(f)) out.push({ file: f, dir }); }
  }
}
function walkEntry(en, dir, out) {
  return new Promise(res => {
    if (en.isFile) return en.file(f => { if (isImage(f)) out.push({ file: f, dir }); res(); }, () => res());
    const rd = en.createReader(), sub = dir ? dir + '/' + en.name : en.name;
    const more = () => rd.readEntries(async list => { if (!list.length) return res(); for (const e of list) await walkEntry(e, sub, out); more(); }, () => res());
    more();
  });
}
// 끌어다 놓은 것(파일·폴더 섞여도 됨) → [{ file, dir }]. 하위 폴더까지 읽어요.
// 놓는 순간에만 읽을 수 있어서, drop 이벤트 안에서 기다리지 않고 바로 불러야 해요.
export function fromDrop(dt) {
  const items = [...(dt.items || [])].filter(i => i.kind === 'file');
  const got = items.map(i => ({ file: i.getAsFile(), en: i.webkitGetAsEntry ? i.webkitGetAsEntry() : null, h: i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null }));
  return (async () => {
    const out = [];
    for (const g of got) {
      const h = g.h ? await g.h : null;
      if (h && h.kind === 'directory') { await walkHandle(h, h.name, out); continue; }   // 파일로 연 편집기(file://)에서도 되는 방식
      if (g.en && g.en.isDirectory) { await walkEntry(g.en, '', out); continue; }
      if (g.file && isImage(g.file)) out.push({ file: g.file, dir: '' });
    }
    out.sort((a, b) => a.dir.localeCompare(b.dir) || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    return out;
  })();
}

// ---- NAI 정보 ----
// NAI는 그림을 만든 설정(프롬프트 등)을 두 군데에 넣어요: PNG의 글자 칸, 그리고 투명도 값의 맨 끝 비트(눈에 안 보임).
async function head(blob, n = 1 << 20) { return new Uint8Array(await blob.slice(0, n).arrayBuffer()); }
const isPng = u => u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47;
const isJpg = u => u[0] === 0xff && u[1] === 0xd8;
const isWebp = u => u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57 && u[9] === 0x45;

export async function hasMeta(blob) {
  const u = await head(blob);
  if (isPng(u)) {
    const dv = new DataView(u.buffer);
    for (let p = 8; p + 12 <= u.length;) {
      const len = dv.getUint32(p), type = String.fromCharCode(u[p + 4], u[p + 5], u[p + 6], u[p + 7]);
      if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt' || type === 'eXIf') return true;
      if (type === 'IDAT' || type === 'IEND') break;
      p += 12 + len;
    }
    return false;
  }
  if (isJpg(u)) { for (let p = 2; p + 4 <= u.length && u[p] === 0xff;) { const m = u[p + 1]; if (m === 0xe1 || m === 0xed || m === 0xfe) return true; if (m === 0xda) break; p += 2 + (u[p + 2] << 8 | u[p + 3]); } return false; }
  if (isWebp(u)) { const s = String.fromCharCode(...u.slice(12, Math.min(u.length, 4096))); return /EXIF|XMP /.test(s); }
  return false;
}

async function reencode(blob, type, q) {
  const bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); bmp.close();
  // 거의 불투명한 곳은 완전히 불투명하게: 투명도 끝 비트에 숨긴 정보가 사라져요
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 250 && d[i] < 255) { d[i] = 255; n++; }
  if (n) g.putImageData(id, 0, 0);
  return new Promise(r => c.toBlob(r, type, q));
}
function stripJpeg(u) {
  const parts = [u.slice(0, 2)]; let p = 2;
  while (p + 4 <= u.length && u[p] === 0xff) {
    const m = u[p + 1]; if (m === 0xda) break;
    const len = 2 + (u[p + 2] << 8 | u[p + 3]);
    if (!(m === 0xe1 || m === 0xed || m === 0xfe)) parts.push(u.slice(p, p + len));
    p += len;
  }
  parts.push(u.slice(p));
  return new Blob(parts, { type: 'image/jpeg' });
}
// 숨은 정보를 지운 새 파일을 돌려줘요. PNG는 화질 그대로, JPG는 그림 부분을 건드리지 않고 정보 칸만 떼요.
export async function stripMeta(blob) {
  const u = await head(blob, 16);
  if (isPng(u)) return reencode(blob, 'image/png');
  if (isJpg(u)) return stripJpeg(new Uint8Array(await blob.arrayBuffer()));
  if (isWebp(u)) return reencode(blob, 'image/webp', 1);
  return blob;
}

// ---- 쓰기 ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// 압축하지 않고 묶기만 하는 ZIP (그림 파일은 이미 압축돼 있어서 더 줄지 않아요)
export async function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const data = new Uint8Array(await f.blob.arrayBuffer()), name = enc.encode(f.name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    parts.push(lh.buffer, name, data); central.push(ch.buffer, name);
    off += 30 + name.length + data.length;
  }
  const csize = central.reduce((n, b) => n + (b.byteLength || b.length), 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const safe = s => String(s).replace(/[\\:*?"<>|]/g, '_').trim() || '이름 없음';
// files = [{ name: '폴더/하위/그림.png', blob }]. 폴더를 고를 수 있으면 그 안에 폴더 모양 그대로, 아니면 ZIP 하나로.
// 결과: 'dir' | 'zip' | false(취소)
export async function saveFiles(files, zipName) {
  if (window.showDirectoryPicker) {
    let root;
    try { root = await window.showDirectoryPicker({ mode: 'readwrite' }); }
    catch (e) { if (e && e.name === 'AbortError') return false; root = null; }
    if (root) {
      for (const f of files) {
        const segs = f.name.split('/').map(safe), leaf = segs.pop(); let dir = root;
        for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
        let name = leaf, n = 2;
        for (;;) { try { await dir.getFileHandle(name); name = leaf.replace(/(\.[^.]+)?$/, m => `(${n++})${m}`); } catch (_) { break; } }
        const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(f.blob); await w.close();
      }
      return 'dir';
    }
  }
  download(await makeZip(files.map(f => ({ name: f.name.split('/').map(safe).join('/'), blob: f.blob }))), zipName);
  return 'zip';
}

// ZIP에서 첫 파일 꺼내기 (NovelAI가 그림을 ZIP에 담아 보내요)
export async function unzipFirst(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP이 아니에요');
  const c = dv.getUint32(e + 16, true);
  if (dv.getUint32(c, true) !== 0x02014b50) throw new Error('ZIP이 비어 있어요');
  const method = dv.getUint16(c + 10, true), size = dv.getUint32(c + 20, true), local = dv.getUint32(c + 42, true);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), data = u.slice(start, start + size);
  if (method === 0) return data;
  if (method !== 8) throw new Error('풀 수 없는 ZIP이에요');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

// ZIP 속 파일을 모두 풀어요 → [{ name, data(Uint8Array) }]
export async function unzipAll(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), dec = new TextDecoder();
  let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP이 아니에요');
  const n = dv.getUint16(e + 10, true), out = []; let c = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(c, true) !== 0x02014b50) break;
    const method = dv.getUint16(c + 10, true), size = dv.getUint32(c + 20, true), nl = dv.getUint16(c + 28, true), xl = dv.getUint16(c + 30, true), cl = dv.getUint16(c + 32, true), local = dv.getUint32(c + 42, true);
    const name = dec.decode(u.subarray(c + 46, c + 46 + nl)), start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), raw = u.subarray(start, start + size);
    if (!name.endsWith('/')) out.push({ name, data: method === 0 ? raw.slice() : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) });
    c += 46 + nl + xl + cl;
  }
  return out;
}
