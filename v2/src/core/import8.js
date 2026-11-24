// 8.x 작업 가져오기: 8.x의 '작업 파일 저장'으로 만든 .json을 읽어 2.0 작업에 넣어요.
// 그림은 보관함으로(폴더 그대로), 페이지는 컷 작업실로. 손그림·가리기·도형도 2.0의 같은 요소로 옮겨요. 2.0에 아직 없는 요소(선, 도장·잡티 붓 같은 붓 효과, 틀 등)는 건너뛰고 몇 개인지 알려 줘요.
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

const r1 = v => Math.round(v * 10) / 10;
// 8.x의 획은 점마다 [가로 비율, 세로 비율, 굵기]예요 (비율은 요소 상자 기준 0~1, 굵기는 s0 크기일 때 기준). 2.0은 상자 왼쪽 위에서 잰 좌표에 굵기가 하나예요
const strokeK = e => Math.sqrt(Math.max(1, e.w * e.h)) / (e.s0 || 1);
const strokesOf = (e, sts) => sts.map(st => st.map(([u, v]) => [r1(u * e.w), r1(v * e.h)]));
function strokeSize(e, sts, def) {   // 2.0은 획 굵기가 하나라, 점마다 다르던 굵기(필압)는 평균으로 맞춰요
  let n = 0, sum = 0; for (const st of sts) for (const q of st) if (q[2] > 0) { sum += q[2]; n++; }
  return n ? Math.max(1, r1(sum / n * strokeK(e))) : def;
}
// 손그림(펜)
function drawOf(e, base) {
  const sts = (e.strokes || []).filter(st => Array.isArray(st) && st.length); if (!sts.length) return null;
  return { ...base, type: 'draw', bw0: base.w, bh0: base.h, strokes: strokesOf(e, sts), color: e.color || '#111111', size: strokeSize(e, sts, 6), ol: e.ow > 0 ? r1(e.ow) : 0, olc: e.oc || '#ffffff', ...((e.op ?? 100) < 100 ? { op: Math.max(0.05, e.op / 100) } : {}) };
}
// 가리기: 블러·모자이크·흰칠만 옮겨요. 지우기·도장·잡티 지우기·밝게·어둡게·문지르기 같은 붓 효과는 2.0에 없어서 건너뛰어요
const COVER = { blur: 'blur', mosaic: 'mosaic', paint: 'white' };
function coverOf(e, base) {
  const kind = COVER[e.kind]; if (!kind) return null;
  const all = (e.strokes || []).filter(st => Array.isArray(st) && st.length), sts = all.filter(st => !st[0][3]), shapes = e.shapes || [], polys = e.polys || [];
  if (!sts.length && !shapes.length && !polys.length && !e.mask) return null;
  // 세기: 모자이크는 둘 다 '칸 크기'라 그대로. 블러는 8.x가 blur(세기), 2.0이 blur(세기 × 0.6)이라 그만큼 키워요. 8.x 블러는 가장자리가 세기의 0.3배만큼 번졌어요
  const str = e.str || 10, look = { kind, str: Math.round(kind === 'blur' ? str / 0.6 : str), soft: Math.round(kind === 'white' ? e.soft || 0 : kind === 'blur' ? str * 0.3 : 0), color: e.color || '#ffffff' };
  // 붓으로만 칠한 것 → 붓 가리기. 지우개 획(첫 점의 네 번째 값이 1)은 2.0에 없어서 빼요: 지워 뒀던 자리까지 다시 가려질 수 있어요
  if (sts.length && !shapes.length && !polys.length && !e.mask) return { ...base, type: 'cover', shape: 'brush', ...look, size: strokeSize(e, sts, 40), bw0: base.w, bh0: base.h, strokes: strokesOf(e, sts) };
  // 타원 하나만 있는 것 → 그 타원 그대로 (shapes의 한 칸은 [가운데 가로, 가운데 세로, 가로 반지름, 세로 반지름], 모두 상자 기준 비율)
  if (shapes.length === 1 && !all.length && !polys.length && !e.mask) { const [u, v, rx, ry] = shapes[0]; return { ...base, type: 'cover', shape: 'ellipse', ...look, x: Math.round(e.x + (u - rx) * e.w), y: Math.round(e.y + (v - ry) * e.h), w: Math.max(2, Math.round(rx * 2 * e.w)), h: Math.max(2, Math.round(ry * 2 * e.h)) }; }
  // 윤곽을 딴 모양(polys), 선택 도구로 만든 것(mask), 타원과 붓이 섞인 것은 2.0에서 그대로 나타낼 수 없어요.
  // 가장 가까운 것으로, 요소 상자 전체를 덮는 네모 가리기로 옮겨요. 가리려던 곳이 드러나면 안 되니까, 모자라게보다 넉넉하게 가리는 쪽을 골랐어요
  return { ...base, type: 'cover', shape: 'rect', ...look };
}
// 도형: 같은 모양이 있는 것만 옮겨요 ('선'은 2.0에 없어서 건너뛰어요). 둥근 모서리 크기, 별의 꼭짓점 수·안쪽 깊이는 2.0에서 정해진 모양이라 옮기지 않아요
const SHAPE8 = { rect: 'rect', round: 'round', ellipse: 'ellipse', tri: 'tri', star: 'star', burst: 'burst', heart: 'heart', arrow: 'arrow' };
const hexA = (c, a) => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); return m && a < 100 ? '#' + m[1] + Math.round(Math.max(0, a) * 2.55).toString(16).padStart(2, '0') : c; };   // 반투명한 색은 #rrggbbaa로
function shapeOf(e, base) {
  const kind = SHAPE8[e.kind]; if (!kind) return null;
  const op = (e.op ?? 100) < 100 ? { op: Math.max(0.05, e.op / 100) } : {};
  // 8.x의 화살표는 선 색(stroke)으로 그린 선 화살표예요. 2.0의 화살표는 속을 칠하는 도형이라, 선 색으로 칠하고 테두리는 없애요
  if (kind === 'arrow') return { ...base, type: 'shape', kind, fill: e.stroke || '#000000', fill2: '', bc: e.stroke || '#000000', bw: 0, ...op };
  // 그라데이션은 2.0에 '위 → 아래'만 있어요: 다른 방향이던 것도 위아래로 바뀌어요. 투명도(fillA·fill2A)는 색에 담아요
  const on = e.fillOn !== false, grad = on && !!e.gradOn;
  return { ...base, type: 'shape', kind, fill: on ? (grad ? hexA(e.fill || '#ffffff', e.fillA ?? 100) : e.fill || '#ffffff') : '', fill2: grad ? hexA(e.fill2 || '#000000', e.fill2A ?? 100) : '', bc: e.stroke || '#000000', bw: Math.max(0, +e.sw || 0), ...op };
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
      const base = { id: uid('e'), x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h), ...(e.rot ? { rot: Math.round(e.rot * 10) / 10 } : {}) };
      if (e.type === 'panel') n.els.push({ ...base, type: 'panel', mediaId: imap.get(e.img) || null, ix: e.ox || 0, iy: e.oy || 0, is: Math.max(0.05, e.iz || 1), bw: e.bw ?? 4, bc: e.bc || '#111111', ...(e.radius ? { br: e.radius } : {}), ...(e.fill ? { bgc: e.fill } : {}), ...(e.flip ? { ifx: true } : {}) });
      else if (e.type === 'stamp' && imap.get(e.img)) n.els.push({ ...base, type: 'pic', mediaId: imap.get(e.img), op: (e.op ?? 100) / 100, ...(e.flip ? { fx: true } : {}), ...(e.tintOn && e.tint ? { tint: e.tint } : {}), ...(e.ow ? { ol: Math.min(10, Math.max(1, Math.round(e.ow / Math.max(1, Math.min(e.w, e.h)) * 100))), olc: e.oc || '#ffffff' } : {}) });   // 스티커·효과음 그림
      else if (e.type === 'bubble') n.els.push({ ...base, type: 'bubble', shape: SHAPE[e.shape] || 'ellipse', text: e.text || '', size: Math.round(e.fs) || 28, font: FONT[e.font] || '', color: e.color || '#111111', bold: !!e.bold, fill: e.fill || '#ffffff', bc: e.stroke || '#111111', bw: e.sw ?? 3, tail: !!e.tail, tx: Math.round(e.tx ?? base.x + base.w * 0.3), ty: Math.round(e.ty ?? base.y + base.h * 1.3), vert: !!e.vert });
      else if (e.type === 'text') n.els.push({ ...base, type: 'text', text: e.text || '', size: Math.round(e.fs) || 48, font: FONT[e.font] || '', color: e.color || '#111111', bold: e.bold !== false, sw: e.sw ?? 0, sc: e.sc || '#ffffff', vert: !!e.vert });
      else { const n2 = e.type === 'draw' ? drawOf(e, base) : e.type === 'fx' ? coverOf(e, base) : e.type === 'shape' ? shapeOf(e, base) : null; if (n2) n.els.push(n2); else skipped++; }
    }
    made.push(n);
  }
  // 이미지 편집 작업(페이지 = 그림 한 장)은 요소가 그림 위에 얹힌 모양이라, 페이지가 비면 넣지 않아요
  const keep = made.filter(n => n.els.length); (p.pages || (p.pages = [])).push(...keep);
  if (keep.length) p.activePage = keep[0].id;
  commit(`8.x 작업 가져오기 (${doc.name || '이름 없음'})`);
  return { name: doc.name || '이름 없음', images: imap.size, failed, pages: keep.length, skipped };
}
