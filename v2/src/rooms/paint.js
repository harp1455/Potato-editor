// 그리는 도구: 붓, 지우개, 도형, 글자. 그린 것은 '그리기' 레이어에 들어가서 원래 그림은 그대로예요.
import { h } from '../ui/dom.js';
import { state, commit, emit, layerOf, addMedia, addLayer, ensureBitmap, tidyMedia, dropBitmap } from '../core/store.js';
import { settings } from '../core/settings.js';
import { dialog } from '../ui/overlay.js';

export const PAINT_TOOLS = [
  { id: 'brush', title: '붓', key: 'P', icon: 'brush', hint: '끌어서 그려요. 그린 것은 그리기 레이어에 들어가요. Shift를 누르고 누르면 앞서 찍은 곳에서 곧은 선으로 이어져요.' },
  { id: 'cover', title: '가리기 붓 (수동 흰칠)', key: 'K', icon: 'cover', hint: '칠하거나 끌어서 가리고 고쳐요. 흰칠, 모자이크, 흐리게, 지우기, 도장, 잡티 지우기, 밝게, 어둡게, 문지르기, AI 지우개 중에서 고르고, 붓으로 칠하거나 타원이나 네모로 끌거나 끌어서 윤곽을 딸 수 있어요. 지우기만 빼고는 그리기 레이어에 들어가서 원래 그림은 그대로예요.' },
  { id: 'eraser', title: '지우개', key: 'X', icon: 'eraser', hint: '그리기 레이어에 그린 것을 지워요. 원래 그림은 지워지지 않아요.' },
  { id: 'shape', title: '도형', key: 'U', icon: 'shape', hint: '끌어서 네모, 동그라미, 선, 화살표를 그려요. Shift를 누르면 반듯한 모양이 돼요.' },
  { id: 'text', title: '글자', key: 'T', icon: 'text', hint: '누른 자리에 글자를 넣어요. 글자는 따로 레이어가 돼서 옮기고 크기를 바꿀 수 있어요.' },
];
export const COVERS = [['white', '흰칠'], ['mosaic', '모자이크'], ['blur', '흐리게'], ['erase', '지우기'], ['clone', '도장'], ['heal', '잡티 지우기'], ['dodge', '밝게'], ['burn', '어둡게'], ['smudge', '문지르기'], ['aierase', 'AI 지우개']];
export const COVER_SHAPES = [['brush', '붓으로 칠하기'], ['ellipse', '타원으로 끌기'], ['rect', '네모로 끌기'], ['outline', '끌어서 윤곽 따기']];
export const COVER_HINT = { erase: '고른 레이어의 그림을 지워서 비워요.', clone: 'Alt를 누른 채 복사해 올 곳을 먼저 누르고, 칠하면 그곳의 그림이 옮겨져요.', heal: '칠한 곳을 둘레 색으로 매끈하게 메워요.', dodge: '칠한 곳만 밝게 해요.', burn: '칠한 곳만 어둡게 해요.', smudge: '붓이 지나간 방향으로 그림을 끌고 가요.', aierase: '칠한 곳의 물건을 AI가 둘레에 맞게 지워요. AI 지우개 팩이 필요해요.' };
const COVER_LABEL = { white: '흰칠', mosaic: '모자이크로 가리기', blur: '흐리게 가리기', erase: '지우기 붓', clone: '도장', heal: '잡티 지우기', dodge: '밝게 칠하기', burn: '어둡게 칠하기', smudge: '문지르기' };
let cloneSrc = null;
export const SHAPES = [['rect', '네모'], ['ellipse', '동그라미'], ['line', '선'], ['arrow', '화살표']];
const P = () => ({ color: '#111111', size: 12, alpha: 100, shape: 'rect', fill: false, cover: 'white', cshape: 'brush', csize: 40, ccolor: '#ffffff', csoft: 20, cstr: 50, csep: true, tsize: 64, tstroke: '#ffffff', tsw: 0, ...(settings.get('paint') || {}) });
export const paintOpt = P, setPaint = (k, v) => settings.set('paint', { ...P(), [k]: v });
let lastPt = null, strokes = 0;

// 그릴 레이어: 고른 레이어가 그리기 레이어면 거기에, 아니면 그 위에 새로 만들어요
async function target(c) {
  const cur = layerOf();
  if (cur && cur.paint && !cur.locked && cur.visible) return cur;
  const t = document.createElement('canvas'); t.width = c.w; t.height = c.h;
  const m = await addMedia(new File([await new Promise(r => t.toBlob(r, 'image/png'))], '그리기.png', { type: 'image/png' }), null, { hidden: true });
  const l = addLayer(c, m); l.x = 0; l.y = 0; l.scale = 1; l.name = '그리기'; l.paint = true;
  if (cur) { const i = c.layers.indexOf(cur); c.layers.splice(c.layers.indexOf(l), 1); c.layers.splice(i + 1, 0, l); }
  await ensureBitmap(m.id); return l;
}
// 작업용 그림(캔버스)을 잠시 레이어 그림 자리에 끼워 두고, 끝나면 새 그림으로 저장해요
async function begin(c, to) {
  const l = to || await target(c), old = await ensureBitmap(l.mediaId), w = document.createElement('canvas'); w.width = old.width; w.height = old.height; const g = w.getContext('2d'); g.drawImage(old, 0, 0);
  state.bitmaps.set(l.mediaId, w);
  // 레이어가 옮겨졌거나 크기가 바뀌었어도 그림판 자리 그대로 그려지게
  // 그림판 좌표 → 레이어 그림 좌표: 옮기기·크기뿐 아니라 돌리기·뒤집기도 거꾸로 풀어요
  const M = new DOMMatrix().translate(w.width / 2, w.height / 2).scale((l.flipX ? -1 : 1) / l.scale, (l.flipY ? -1 : 1) / l.scale).rotate(-(l.rot || 0)).translate(-(l.x + w.width * l.scale / 2), -(l.y + w.height * l.scale / 2));
  const toLayer = p => { const q = M.transformPoint(new DOMPoint(p.x, p.y)); return { x: q.x, y: q.y }; }, fromCanvas = g2 => g2.setTransform(M);
  const done = async label => { const oldId = l.mediaId, m = await addMedia(new File([await new Promise(r => w.toBlob(r, 'image/png'))], '그리기.png', { type: 'image/png' }), null, { hidden: true }); state.bitmaps.set(oldId, old); await ensureBitmap(m.id); l.mediaId = m.id; commit(label); dropBitmap(oldId); if (++strokes % 20 === 0) tidyMedia(); };   // 스무 번 그을 때마다, 되돌리기로도 못 돌아가는 옛 그림을 치워요
  const cancel = () => { state.bitmaps.set(l.mediaId, old); };
  return { l, g, w, toLayer, fromCanvas, done, cancel, k: 1 / l.scale };
}
function drawShape(g, kind, a, b, o, k = 1) {
  g.save(); g.lineWidth = o.size * k; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = g.fillStyle = o.color; g.globalAlpha = o.alpha / 100; g.beginPath();
  if (kind === 'rect') g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  else if (kind === 'ellipse') g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
  else { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
  if (o.fill && (kind === 'rect' || kind === 'ellipse')) g.fill(); else g.stroke();
  if (kind === 'arrow') { const an = Math.atan2(b.y - a.y, b.x - a.x), L = Math.max(o.size * k * 3.2, 10 * k); g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x - L * Math.cos(an - 0.45), b.y - L * Math.sin(an - 0.45)); g.lineTo(b.x - L * Math.cos(an + 0.45), b.y - L * Math.sin(an + 0.45)); g.closePath(); g.fill(); }
  g.restore();
}
// 도형을 끄는 동안의 미리 보기 (그림판 좌표)
export function drawPaintDraft(g, d) {
  if (d && d.kind === 'shape') return drawShape(g, d.shape, d.a, d.b, d.o);
  if (d && d.kind === 'cover') { g.save(); g.globalAlpha = 0.55; coverPath(g, d, d.o.cover === 'white' ? d.o.ccolor : '#4b9fe8'); g.restore(); }
}
// 가릴 곳의 모양을 칠해요 (붓 자국·타원·네모). 그림판 좌표
function coverPath(g, d, color) {
  if (d.maskCv) { const t = document.createElement('canvas'); t.width = d.maskCv.width; t.height = d.maskCv.height; const tg = t.getContext('2d'); tg.drawImage(d.maskCv, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = color; tg.fillRect(0, 0, t.width, t.height); g.drawImage(t, 0, 0); return; }
  if (d.o.cshape === 'outline') { const a = d.pts[0], b = d.pts[d.pts.length - 1]; g.save(); g.strokeStyle = color; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.restore(); return; }
  g.fillStyle = g.strokeStyle = color; g.lineCap = g.lineJoin = 'round'; g.lineWidth = d.o.csize;
  if (d.o.cshape === 'brush') { g.beginPath(); g.arc(d.pts[0].x, d.pts[0].y, d.o.csize / 2, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(d.pts[0].x, d.pts[0].y); for (const q of d.pts) g.lineTo(q.x, q.y); g.stroke(); }
  else { const a = d.pts[0], b = d.pts[d.pts.length - 1]; g.beginPath(); if (d.o.cshape === 'ellipse') g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); else g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.fill(); }
}
const mkc = (w, h) => { const t = document.createElement('canvas'); t.width = Math.max(1, Math.round(w)); t.height = Math.max(1, Math.round(h)); return t; };
// 투명한 곳(구멍)을 둘레 색으로 매끈하게 메워요: 절반씩 줄인 그림들을 밑에 차례로 깔아요
function fillHoles(cv) {
  const lv = [cv]; while (lv[lv.length - 1].width > 1 || lv[lv.length - 1].height > 1) { const a = lv[lv.length - 1], b = mkc(Math.max(1, a.width >> 1), Math.max(1, a.height >> 1)), g = b.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(a, 0, 0, b.width, b.height); lv.push(b); }
  const out = mkc(cv.width, cv.height), g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.globalCompositeOperation = 'destination-over';
  for (let i = 0; i < lv.length; i++) for (let r = 0; r < (i ? 3 : 1); r++) g.drawImage(lv[i], 0, 0, out.width, out.height);
  const t = mkc(cv.width, cv.height); t.getContext('2d').drawImage(out, 0, 0); for (let r = 0; r < 4; r++) g.drawImage(t, 0, 0);
  return out;
}
// 문지르기: 붓이 지나간 길을 따라 앞의 그림을 조금씩 끌고 가요
function smudge(work, pts, size, str, soft) {
  const gw = work.getContext('2d'), r = Math.max(2, Math.round(size / 2)), D = r * 2, dab = mkc(D, D), gd = dab.getContext('2d'), gr = gd.createRadialGradient(r, r, r * Math.min(0.95, Math.max(0.05, 1 - soft / 100)) * 0.9, r, r, r);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); gd.fillStyle = gr; gd.fillRect(0, 0, D, D);
  const T = mkc(D, D), gt = T.getContext('2d'), a = Math.min(0.95, Math.max(0.1, str / 100)), step = Math.max(1, r * 0.25); let px = pts[0].x, py = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const qx = pts[i].x, qy = pts[i].y, L = Math.hypot(qx - px, qy - py); if (L < step) continue;
    for (let d = step; d <= L; d += step) {
      const cx = px + (qx - px) * d / L, cy = py + (qy - py) * d / L, sx = px + (qx - px) * (d - step) / L, sy = py + (qy - py) * (d - step) / L;
      gt.globalCompositeOperation = 'copy'; gt.drawImage(work, sx - r, sy - r, D, D, 0, 0, D, D); gt.globalCompositeOperation = 'destination-in'; gt.drawImage(dab, 0, 0);
      gw.globalAlpha = a; gw.drawImage(T, cx - r, cy - r); gw.globalAlpha = 1;
    }
    const f = Math.floor(L / step) * step / L; px += (qx - px) * f; py += (qy - py) * f;
  }
}
const coverBox = (c, d, pad) => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of d.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); } const e = (d.o.cshape === 'brush' ? d.o.csize / 2 : 0) + pad; x0 = Math.max(0, Math.floor(x0 - e)); y0 = Math.max(0, Math.floor(y0 - e)); x1 = Math.min(c.w, Math.ceil(x1 + e)); y1 = Math.min(c.h, Math.ceil(y1 + e)); return d.maskCv ? { x: 0, y: 0, w: c.w, h: c.h } : { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }; };
// 가리기·고치기: 모양대로 흰칠·모자이크·흐림·도장·메우기 따위를 만들어 그리기 레이어에 얹어요. 원래 그림은 그대로예요
async function applyCover(c, d, api) {
  const o = d.o, kind = o.cover, soft = o.csoft > 0 ? (o.cshape === 'brush' ? o.csize : 60) * o.csoft / 200 : 0;
  const maskOf = blur => { const m = mkc(c.w, c.h), mg = m.getContext('2d'); if (blur > 0) mg.filter = `blur(${blur.toFixed(1)}px)`; coverPath(mg, d, '#000'); return m; };
  if (kind === 'aierase') {   // 칠한 곳을 고른 곳으로 바꿔서 AI 지우개에 맡겨요
    const S = await import('../core/select.js'), { run } = await import('../core/cmd.js'); S.selFor(c); S.selMask('new', maskOf(0)); await run('ai.erase'); S.selNone(); emit(); return;
  }
  if (kind === 'erase') {   // 고른 레이어의 그림을 지워요 (그 레이어의 새 그림으로 바뀌고, 되돌릴 수 있어요)
    const l = layerOf(); if (!l || l.locked) { const { toast } = await import('../ui/overlay.js'); toast('지울 레이어를 먼저 골라 주세요.'); return; }
    const S = await begin(c, l); S.g.save(); S.g.globalCompositeOperation = 'destination-out'; S.fromCanvas(S.g); S.g.drawImage(maskOf(soft), 0, 0); S.g.restore(); await S.done(COVER_LABEL.erase); return;
  }
  const m = maskOf(kind === 'heal' ? Math.max(soft, 2) : soft), out = mkc(c.w, c.h), g = out.getContext('2d'), k = Math.max(0.1, o.cstr / 50);
  if (kind === 'white') { g.fillStyle = o.ccolor; g.fillRect(0, 0, c.w, c.h); }
  else {
    const src = await api.flatten(c), size = Math.max(4, Math.round(Math.max(c.w, c.h) / (kind === 'mosaic' ? 60 : 50) * k));
    if (kind === 'mosaic') { const sm = mkc(c.w / size, c.h / size); sm.getContext('2d').drawImage(src, 0, 0, sm.width, sm.height); g.imageSmoothingEnabled = false; g.drawImage(sm, 0, 0, c.w, c.h); }
    else if (kind === 'blur') { g.filter = `blur(${size}px)`; g.drawImage(src, 0, 0); g.filter = 'none'; }
    else if (kind === 'dodge' || kind === 'burn') { const a = Math.min(1, Math.max(0.05, o.cstr / 100)); g.filter = kind === 'dodge' ? `brightness(${(1 + a * 0.8).toFixed(3)}) saturate(${(1 - a * 0.15).toFixed(3)})` : `brightness(${(1 - a * 0.55).toFixed(3)}) saturate(${(1 + a * 0.2).toFixed(3)})`; g.drawImage(src, 0, 0); g.filter = 'none'; }
    else if (kind === 'clone') g.drawImage(src, -d.off.x, -d.off.y);
    else if (kind === 'smudge') { g.drawImage(src, 0, 0); smudge(out, d.pts, o.csize, o.cstr, o.csoft); }
    else if (kind === 'heal') {   // 칠한 곳을 구멍으로 보고 둘레 색으로 메워요. 넓으면 줄여서 계산해요
      const b0 = coverBox(c, d, 0), b = coverBox(c, d, Math.max(8, Math.min(b0.w, b0.h) * 0.6 + 6)), q = Math.max(1, Math.max(b.w, b.h) / 640), part = mkc(b.w / q, b.h / q), pg = part.getContext('2d');
      pg.imageSmoothingQuality = 'high'; pg.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, part.width, part.height); pg.globalCompositeOperation = 'destination-out'; pg.drawImage(maskOf(0), b.x, b.y, b.w, b.h, 0, 0, part.width, part.height);
      g.imageSmoothingQuality = 'high'; g.drawImage(fillHoles(part), b.x, b.y, b.w, b.h);
    }
  }
  g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
  if (kind === 'white' && o.csep && (o.cshape === 'ellipse' || o.cshape === 'rect')) {   // 도형 흰칠은 따로 레이어로: 나중에 옮기고 크기를 바꾸고 지울 수 있어요
    const b = coverBox(c, d, soft * 3 + 2), t = mkc(b.w, b.h); t.getContext('2d').drawImage(out, -b.x, -b.y);
    const l = await api.layerFromBlob(c, await new Promise(r => t.toBlob(r, 'image/png')), '흰칠', { x: b.x, y: b.y, hidden: true }); if (l) { l.cover = true; await ensureBitmap(l.mediaId); } commit('흰칠'); return;
  }
  const S = await begin(c); S.g.save(); S.fromCanvas(S.g); S.g.drawImage(out, 0, 0); S.g.restore();
  await S.done(COVER_LABEL[kind]);
}
// 끌어서 윤곽 따기: 끈 네모 안의 물건 모양을 AI가 따서 그 모양대로 가려요
async function outlineCover(c, d, api) {
  const a = d.pts[0], b = d.pts[d.pts.length - 1], box = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
  const { ensurePacks } = await import('../ui/aitools.js'), ai = await import('../core/ai.js'), { toast } = await import('../ui/overlay.js');
  if (!await ensurePacks(['samE', 'samD'])) return;
  try { await ai.runJob('윤곽 따서 가리기', async (j, say) => { const src = await api.flatten(c), M = await ai.samMask(src, 'cover:' + c.id + ':' + Date.now(), [], box, j, say); d.maskCv = M; await applyCover(c, d, api); }); }
  catch (e) { toast('윤곽을 따지 못했어요. ' + (e.message || ''), 'err'); }
}

function textDialog(c, p, layerFromBlob) {
  const o = P(), ta = h('textarea.text.area', { rows: 3, 'aria-label': '넣을 글자', placeholder: '여기에 글자를 적어요' });
  const go = async () => {
    const text = ta.value; if (!text.trim()) return;
    const lines = text.split('\n'), fs = o.tsize, sw = fs * o.tsw / 100, font = `700 ${fs}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`, t = document.createElement('canvas'); let g = t.getContext('2d'); g.font = font;
    t.width = Math.ceil(Math.max(1, ...lines.map(l => g.measureText(l).width)) + sw * 2 + 8); t.height = Math.ceil(lines.length * fs * 1.25 + sw * 2 + 8); g = t.getContext('2d'); g.font = font; g.textBaseline = 'middle'; g.lineJoin = 'round';
    lines.forEach((l, i) => { const y = sw + 4 + fs * 0.62 + i * fs * 1.25; if (sw > 0) { g.strokeStyle = o.tstroke; g.lineWidth = sw; g.strokeText(l, sw + 4, y); } g.fillStyle = o.color; g.fillText(l, sw + 4, y); });
    await layerFromBlob(c, await new Promise(r => t.toBlob(r, 'image/png')), lines[0].slice(0, 20) || '글자', { x: p.x, y: p.y - t.height / 2, hidden: true }); commit('글자 넣기');
  };
  const num = (label, k, min, max) => h('label.field', null, h('span.field-name.w', null, label), h('input.num', { type: 'number', min, max, value: o[k], 'aria-label': label, onchange: e => { o[k] = Math.min(max, Math.max(min, +e.target.value || min)); setPaint(k, o[k]); } }));
  const col = (label, k) => h('label.field', null, h('span.field-name.w', null, label), h('input', { type: 'color', value: o[k], 'aria-label': label, onchange: e => { o[k] = e.target.value; setPaint(k, o[k]); } }));
  dialog({ title: '글자 넣기', body: h('div.vid-form', null, ta, h('div.field-row', null, num('크기', 'tsize', 8, 600), col('색', 'color')), h('div.field-row', null, num('테두리 굵기', 'tsw', 0, 40), col('테두리 색', 'tstroke')), h('p.dlg-text', null, '넣은 글자는 그림 레이어가 돼요. 내용을 고치려면 지우고 다시 넣어 주세요.')),
    buttons: [{ label: '취소' }, { label: '넣기', primary: true, run: () => { go(); } }] });
  setTimeout(() => ta.focus(), 30);
}

// image.js의 pointerdown에서 불러요. api = { view, at, draw, drag, layerFromBlob }
export async function paintDown(e, c, p, tool, api) {
  const o = P(), { view, at, draw, drag } = api;
  if (tool === 'text') return textDialog(c, p, api.layerFromBlob);
  if (tool === 'cover') {
    if (o.cover === 'clone') {   // 도장: Alt를 누른 채 누르면 복사해 올 곳, 그냥 칠하면 그곳의 그림을 옮겨요
      const { toast } = await import('../ui/overlay.js');
      if (e.altKey) { cloneSrc = { x: p.x, y: p.y, id: c.id }; toast('복사해 올 곳을 정했어요. 이제 옮길 곳을 칠해 주세요.'); return; }
      if (!cloneSrc || cloneSrc.id !== c.id) { toast('먼저 Alt를 누른 채 복사해 올 곳을 눌러 주세요.'); return; }
    }
    const brushOnly = o.cover === 'smudge' || o.cover === 'clone'; if (brushOnly && o.cshape !== 'brush') o.cshape = 'brush';
    const d = view.draft = { kind: 'cover', pts: [p], o, off: cloneSrc ? { x: cloneSrc.x - p.x, y: cloneSrc.y - p.y } : null }; let moved = o.cshape === 'brush';
    return drag(e, ev => { const q = at(ev); d.pts.push(q); moved = true; draw(); }, async () => { view.draft = null; const a = d.pts[0], b = d.pts[d.pts.length - 1]; if (!moved || (o.cshape !== 'brush' && Math.hypot(b.x - a.x, b.y - a.y) < 3)) { draw(); return; } draw(); if (o.cshape === 'outline') await outlineCover(c, d, api); else await applyCover(c, d, api); });
  }
  if (tool === 'shape') {
    view.draft = { kind: 'shape', shape: o.shape, a: p, b: p, o }; let moved = false;
    return drag(e, ev => { let q = at(ev); if (ev.shiftKey) { const dx = q.x - p.x, dy = q.y - p.y; if (o.shape === 'line' || o.shape === 'arrow') { const an = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(dx, dy); q = { x: p.x + Math.cos(an) * L, y: p.y + Math.sin(an) * L }; } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); q = { x: p.x + Math.sign(dx || 1) * m, y: p.y + Math.sign(dy || 1) * m }; } } view.draft.b = q; moved = true; draw(); },
      async () => { const d = view.draft; view.draft = null; if (!moved || Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < 2) { draw(); return; } const S = await begin(c); drawShape(S.g, d.shape, S.toLayer(d.a), S.toLayer(d.b), o, S.k); await S.done('도형 그리기'); });
  }
  let eraseOn = null;
  if (tool === 'eraser' && !(layerOf() && layerOf().paint)) {
    eraseOn = [...c.layers].reverse().find(l => l.paint && l.visible && !l.locked) || null;
    if (!eraseOn) { const { toast } = await import('../ui/overlay.js'); toast('지울 것이 없어요. 지우개는 가리기 붓과 자동 흰칠로 가린 곳, 붓으로 그린 곳을 지워요. 원래 그림을 지우려면 가리기 붓의 지우기를 써 주세요.'); return; }
  }
  // 누르는 순간부터 지나간 점을 모아 두고, 그릴 레이어가 준비되면 밀린 점까지 한꺼번에 그려요 (준비하는 사이에 그은 선이 빠지지 않게)
  const pts = [p], straight = e.shiftKey && lastPt ? lastPt : null; let S = null, lg = null, show = () => {}, n = 0;
  const flush = () => {
    if (!S) return;
    if (n === 0) { const a = S.toLayer(pts[0]); if (straight) { const b0 = S.toLayer(straight); lg.beginPath(); lg.moveTo(b0.x, b0.y); lg.lineTo(a.x, a.y); lg.stroke(); } else { lg.beginPath(); lg.arc(a.x, a.y, o.size * S.k / 2, 0, Math.PI * 2); lg.fill(); } n = 1; }
    for (; n < pts.length; n++) { const a = S.toLayer(pts[n - 1]), b = S.toLayer(pts[n]); lg.beginPath(); lg.moveTo(a.x, a.y); lg.lineTo(b.x, b.y); lg.stroke(); }
    show();
  };
  const ready = begin(c, eraseOn).then(s => {
    S = s; const g = S.g;
    // 반투명 붓은 한 번 그은 선 안에서 겹쳐 진해지지 않게, 선 전체를 따로 그린 뒤 한 번에 얹어요
    const soft = tool === 'brush' && o.alpha < 100, mk = () => { const b = document.createElement('canvas'); b.width = S.w.width; b.height = S.w.height; return b; };
    const base = soft ? mk() : null, line = soft ? mk() : null; if (soft) base.getContext('2d').drawImage(S.w, 0, 0);
    lg = soft ? line.getContext('2d') : g; lg.lineCap = lg.lineJoin = 'round'; lg.lineWidth = o.size * S.k; lg.strokeStyle = lg.fillStyle = o.color;
    if (tool === 'eraser') g.globalCompositeOperation = 'destination-out';
    show = () => { if (soft) { g.clearRect(0, 0, S.w.width, S.w.height); g.globalAlpha = 1; g.drawImage(base, 0, 0); g.globalAlpha = o.alpha / 100; g.drawImage(line, 0, 0); } draw(); };
    flush();
  });
  drag(e, ev => { const q = at(ev), last = pts[pts.length - 1]; if (Math.hypot(q.x - last.x, q.y - last.y) * view.zoom < 1) return; pts.push(q); flush(); },
    async () => { await ready; flush(); lastPt = pts[pts.length - 1]; await S.done(tool === 'eraser' ? '지우개' : '붓'); });
  emit();
}
