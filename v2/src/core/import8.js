// 8.x 작업 가져오기: 8.x의 '작업 파일 저장'으로 만든 .json을 읽어 2.0 작업에 넣어요.
// 그림은 보관함으로(폴더 그대로), 페이지는 컷 작업실로. 2.0에 아직 없는 요소(스티커·손그림·효과 등)는 건너뛰고 몇 개인지 알려 줘요.
import { state, commit, addMedia, folders, uid } from './store.js';
import { hasMeta } from './files.js';

const SHAPE = { round: 'ellipse', ellipse: 'ellipse', rect: 'rect', cloud: 'cloud', think: 'cloud', shout: 'shout', spike: 'shout', burst: 'shout' };
const FONT = { '명조': '"Batang", "Nanum Myeongjo", serif', '궁서': '"Gungsuh", serif', '손글씨': '"Comic Sans MS", "Nanum Pen Script", cursive' };
function blobOf(src) {   // data: 주소 → 파일
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src); if (!m) throw new Error('nodata');
  if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: m[1] || 'image/png' });
  const bin = atob(m[3]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: m[1] || 'image/png' });
}

export async function import8(file, onStep) {
  let d; try { d = JSON.parse(await file.text()); } catch (_) { throw new Error('작업 파일을 읽지 못했어요. 8.x의 "작업 파일 저장"으로 만든 .json 파일인지 확인해 주세요.'); }
  if (!d || (d.app !== 'potato-editor' && d.app !== 'cut-editor') || !d.doc) throw new Error('감자 편집기 8.x의 작업 파일이 아니에요.');
  const p = state.project, doc = d.doc, fmap = new Map(), imap = new Map(), top = { id: uid('f'), name: doc.name || '8.x 작업', parent: null };
  folders().push(top);
  for (const f of doc.folders || []) fmap.set(f.id, { id: uid('f'), name: f.name || '폴더', parent: f.parent || null });
  for (const f of fmap.values()) { f.parent = f.parent && fmap.get(f.parent) ? fmap.get(f.parent).id : top.id; folders().push(f); }
  const imgs = d.images || []; let failed = 0;
  for (let i = 0; i < imgs.length; i++) {
    const r = imgs[i];
    try { const b = await blobOf(r.src), m = await addMedia(new File([b], r.name || `그림 ${i + 1}.png`, { type: b.type || 'image/png' }), r.folder && fmap.get(r.folder) ? fmap.get(r.folder).id : top.id, { meta: await hasMeta(b) }); imap.set(r.id, m.id); }
    catch (_) { failed++; }
    if (onStep) onStep(i + 1, imgs.length);
  }
  let skipped = 0; const made = [];
  for (const pg of doc.pages || []) {
    const n = { id: uid('g'), name: pg.name || `${(p.pages || []).length + made.length + 1}쪽`, w: Math.round(pg.w) || 800, h: Math.round(pg.h) || 1280, bg: pg.bg || '#ffffff', els: [] };
    for (const e of pg.els || []) {
      const base = { id: uid('e'), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h) };
      if (e.type === 'panel') n.els.push({ ...base, type: 'panel', mediaId: imap.get(e.img) || null, ix: e.ox || 0, iy: e.oy || 0, is: Math.max(1, e.iz || 1), bw: e.bw ?? 4, bc: e.bc || '#111111' });
      else if (e.type === 'bubble') n.els.push({ ...base, type: 'bubble', shape: SHAPE[e.shape] || 'ellipse', text: e.text || '', size: Math.round(e.fs) || 28, font: FONT[e.font] || '', color: e.color || '#111111', bold: !!e.bold, fill: e.fill || '#ffffff', bc: e.stroke || '#111111', bw: e.sw ?? 3, tail: !!e.tail, tx: Math.round(e.tx ?? base.x + base.w * 0.3), ty: Math.round(e.ty ?? base.y + base.h * 1.3), vert: !!e.vert });
      else if (e.type === 'text') n.els.push({ ...base, type: 'text', text: e.text || '', size: Math.round(e.fs) || 48, font: FONT[e.font] || '', color: e.color || '#111111', bold: e.bold !== false, sw: e.sw ?? 0, sc: e.sc || '#ffffff', vert: !!e.vert });
      else skipped++;
    }
    made.push(n);
  }
  // 이미지 편집 작업(페이지 = 그림 한 장)은 요소가 그림 위에 얹힌 모양이라, 페이지가 비면 넣지 않아요
  const keep = made.filter(n => n.els.length); (p.pages || (p.pages = [])).push(...keep);
  if (keep.length) p.activePage = keep[0].id;
  commit(`8.x 작업 가져오기 (${doc.name || '이름 없음'})`);
  return { name: doc.name || '이름 없음', images: imap.size, failed, pages: keep.length, skipped };
}
