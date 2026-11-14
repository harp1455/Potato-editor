// 그리는 도구: 붓, 지우개, 도형, 글자. 그린 것은 '그리기' 레이어에 들어가서 원래 그림은 그대로예요.
import { h } from '../ui/dom.js';
import { state, commit, emit, layerOf, addMedia, addLayer, ensureBitmap, tidyMedia } from '../core/store.js';
import { settings } from '../core/settings.js';
import { dialog } from '../ui/overlay.js';

export const PAINT_TOOLS = [
  { id: 'brush', title: '붓', key: 'P', icon: 'brush', hint: '끌어서 그려요. 그린 것은 그리기 레이어에 들어가요. Shift를 누르고 누르면 앞서 찍은 곳에서 곧은 선으로 이어져요.' },
  { id: 'cover', title: '가리기 붓 (수동 흰칠)', key: 'K', icon: 'cover', hint: '칠하거나 끌어서 가려요. 흰칠, 모자이크, 흐리게 중에서 고르고, 붓으로 칠하거나 타원으로 끌 수 있어요. 가린 것은 그리기 레이어에 들어가서 원래 그림은 그대로예요.' },
  { id: 'eraser', title: '지우개', key: 'X', icon: 'eraser', hint: '그리기 레이어에 그린 것을 지워요. 원래 그림은 지워지지 않아요.' },
  { id: 'shape', title: '도형', key: 'U', icon: 'shape', hint: '끌어서 네모, 동그라미, 선, 화살표를 그려요. Shift를 누르면 반듯한 모양이 돼요.' },
  { id: 'text', title: '글자', key: 'T', icon: 'text', hint: '누른 자리에 글자를 넣어요. 글자는 따로 레이어가 돼서 옮기고 크기를 바꿀 수 있어요.' },
];
export const COVERS = [['white', '흰칠'], ['mosaic', '모자이크'], ['blur', '흐리게']], COVER_SHAPES = [['brush', '붓으로 칠하기'], ['ellipse', '타원으로 끌기'], ['rect', '네모로 끌기']];
export const SHAPES = [['rect', '네모'], ['ellipse', '동그라미'], ['line', '선'], ['arrow', '화살표']];
const P = () => ({ color: '#111111', size: 12, alpha: 100, shape: 'rect', fill: false, cover: 'white', cshape: 'brush', csize: 40, ccolor: '#ffffff', csoft: 20, tsize: 64, tstroke: '#ffffff', tsw: 0, ...(settings.get('paint') || {}) });
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
async function begin(c) {
  const l = await target(c), old = await ensureBitmap(l.mediaId), w = document.createElement('canvas'); w.width = old.width; w.height = old.height; const g = w.getContext('2d'); g.drawImage(old, 0, 0);
  state.bitmaps.set(l.mediaId, w);
  // 레이어가 옮겨졌거나 크기가 바뀌었어도 그림판 자리 그대로 그려지게
  const toLayer = p => ({ x: (p.x - l.x) / l.scale, y: (p.y - l.y) / l.scale });
  const done = async label => { const oldId = l.mediaId, m = await addMedia(new File([await new Promise(r => w.toBlob(r, 'image/png'))], '그리기.png', { type: 'image/png' }), null, { hidden: true }); state.bitmaps.set(oldId, old); await ensureBitmap(m.id); l.mediaId = m.id; commit(label); if (++strokes % 20 === 0) tidyMedia(); };   // 스무 번 그을 때마다, 되돌리기로도 못 돌아가는 옛 그림을 치워요
  const cancel = () => { state.bitmaps.set(l.mediaId, old); };
  return { l, g, w, toLayer, done, cancel, k: 1 / l.scale };
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
  g.fillStyle = g.strokeStyle = color; g.lineCap = g.lineJoin = 'round'; g.lineWidth = d.o.csize;
  if (d.o.cshape === 'brush') { g.beginPath(); g.arc(d.pts[0].x, d.pts[0].y, d.o.csize / 2, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(d.pts[0].x, d.pts[0].y); for (const q of d.pts) g.lineTo(q.x, q.y); g.stroke(); }
  else { const a = d.pts[0], b = d.pts[d.pts.length - 1]; g.beginPath(); if (d.o.cshape === 'ellipse') g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); else g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); g.fill(); }
}
// 가리기: 모양대로 흰칠·모자이크·흐림을 만들어 그리기 레이어에 얹어요
async function applyCover(c, d, flatten) {
  const o = d.o, m = document.createElement('canvas'); m.width = c.w; m.height = c.h; const mg = m.getContext('2d'); if (o.csoft > 0) mg.filter = `blur(${(o.csize * o.csoft / 200).toFixed(1)}px)`; coverPath(mg, d, '#000');
  const out = document.createElement('canvas'); out.width = c.w; out.height = c.h; const g = out.getContext('2d');
  if (o.cover === 'white') { g.fillStyle = o.ccolor; g.fillRect(0, 0, c.w, c.h); }
  else { const src = await flatten(c), size = Math.max(6, Math.round(Math.max(c.w, c.h) / (o.cover === 'mosaic' ? 60 : 50)));
    if (o.cover === 'mosaic') { const sm = document.createElement('canvas'); sm.width = Math.max(1, Math.round(c.w / size)); sm.height = Math.max(1, Math.round(c.h / size)); sm.getContext('2d').drawImage(src, 0, 0, sm.width, sm.height); g.imageSmoothingEnabled = false; g.drawImage(sm, 0, 0, c.w, c.h); }
    else { g.filter = `blur(${size}px)`; g.drawImage(src, 0, 0); g.filter = 'none'; } }
  g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
  const S = await begin(c); S.g.save(); S.g.setTransform(S.k, 0, 0, S.k, -S.l.x * S.k, -S.l.y * S.k); S.g.drawImage(out, 0, 0); S.g.restore();
  await S.done({ white: '흰칠', mosaic: '모자이크로 가리기', blur: '흐리게 가리기' }[o.cover]);
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
    const d = view.draft = { kind: 'cover', pts: [p], o }; let moved = o.cshape === 'brush';
    return drag(e, ev => { const q = at(ev); d.pts.push(q); moved = true; draw(); }, async () => { view.draft = null; const a = d.pts[0], b = d.pts[d.pts.length - 1]; if (!moved || (o.cshape !== 'brush' && Math.hypot(b.x - a.x, b.y - a.y) < 3)) { draw(); return; } await applyCover(c, d, api.flatten); });
  }
  if (tool === 'shape') {
    view.draft = { kind: 'shape', shape: o.shape, a: p, b: p, o }; let moved = false;
    return drag(e, ev => { let q = at(ev); if (ev.shiftKey) { const dx = q.x - p.x, dy = q.y - p.y; if (o.shape === 'line' || o.shape === 'arrow') { const an = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(dx, dy); q = { x: p.x + Math.cos(an) * L, y: p.y + Math.sin(an) * L }; } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); q = { x: p.x + Math.sign(dx || 1) * m, y: p.y + Math.sign(dy || 1) * m }; } } view.draft.b = q; moved = true; draw(); },
      async () => { const d = view.draft; view.draft = null; if (!moved || Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < 2) { draw(); return; } const S = await begin(c); drawShape(S.g, d.shape, S.toLayer(d.a), S.toLayer(d.b), o, S.k); await S.done('도형 그리기'); });
  }
  if (tool === 'eraser' && !(layerOf() && layerOf().paint)) { const { toast } = await import('../ui/overlay.js'); toast('지우개는 그리기 레이어에서만 써요. 원래 그림을 지우려면 고른 뒤 고르기 메뉴의 고른 곳 지우기를 써 주세요.'); return; }
  // 누르는 순간부터 지나간 점을 모아 두고, 그릴 레이어가 준비되면 밀린 점까지 한꺼번에 그려요 (준비하는 사이에 그은 선이 빠지지 않게)
  const pts = [p], straight = e.shiftKey && lastPt ? lastPt : null; let S = null, lg = null, show = () => {}, n = 0;
  const flush = () => {
    if (!S) return;
    if (n === 0) { const a = S.toLayer(pts[0]); if (straight) { const b0 = S.toLayer(straight); lg.beginPath(); lg.moveTo(b0.x, b0.y); lg.lineTo(a.x, a.y); lg.stroke(); } else { lg.beginPath(); lg.arc(a.x, a.y, o.size * S.k / 2, 0, Math.PI * 2); lg.fill(); } n = 1; }
    for (; n < pts.length; n++) { const a = S.toLayer(pts[n - 1]), b = S.toLayer(pts[n]); lg.beginPath(); lg.moveTo(a.x, a.y); lg.lineTo(b.x, b.y); lg.stroke(); }
    show();
  };
  const ready = begin(c).then(s => {
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
