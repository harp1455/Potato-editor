// 이미지 작업실: 그림판에 레이어를 올리고, 옮기고, 고르고, 고쳐요.
import { h, icon, clamp, drag } from '../ui/dom.js';
import { state, commit, emit, tick, canvasOf, layerOf, newCanvas, addLayer, addMedia, uid, ensureBitmap } from '../core/store.js';
import { settings } from '../core/settings.js';
import { importItems } from '../core/library.js';
import { fromDrop, isImage } from '../core/files.js';
import { sel, selFor, selRect, selEllipse, selPoly, selWand, selMagic, selNone, selAll, selInvert, selGrow, selBounds } from '../core/select.js';
import { addCmd, run } from '../core/cmd.js';
import { toast, showMenu, confirmBox } from '../ui/overlay.js';

export const view = { tool: 'move', zoom: 1, ox: 0, oy: 0, fitted: null, space: false, mouse: null, draft: null };
let cv = null, ctx = null, wrap = null, checker = null, ring = null;

const TOOLS = [
  { id: 'move', title: '옮기기', key: 'V', icon: 'move', hint: '레이어를 끌어 옮겨요. 모서리 점을 끌면 크기가 바뀌어요. Shift를 누르면 가로·세로로만 움직여요.' },
  { id: 'rect', title: '사각형으로 고르기', key: 'M', icon: 'selRect', sel: 1, hint: '끌어서 사각형으로 골라요. Shift를 누르면 더하고, Alt를 누르면 빼요.' },
  { id: 'ellipse', title: '타원으로 고르기', key: 'E', icon: 'selEllipse', sel: 1, hint: '끌어서 타원으로 골라요. Shift를 누르면 더하고, Alt를 누르면 빼요.' },
  { id: 'lasso', title: '올가미', key: 'L', icon: 'lasso', sel: 1, hint: '원하는 모양을 따라 그리면 그 안이 골라져요. Shift를 누르면 더하고, Alt를 누르면 빼요.' },
  { id: 'wand', title: '비슷한 색 고르기', key: 'W', icon: 'wand', sel: 1, hint: '누른 곳과 비슷한 색이 이어진 곳을 골라요. 위의 허용 범위로 넓이를 정해요.' },
  { id: 'magic', title: '마법 붓', key: 'B', icon: 'magic', sel: 1, hint: '펜처럼 그으면 그 둘레의 비슷한 곳을 선(경계)까지 골라요. Shift를 누르면 더하고, Alt를 누르면 빼요.' },
  { id: 'sam', title: 'AI로 고르기', key: 'A', icon: 'aiSel', sel: 1, hint: '고르고 싶은 것을 누르면 AI가 외곽선을 따요. Shift를 누르고 누르면 같은 것에 점을 더하고, Alt를 누르고 누르면 그 자리는 빼요. 끌면 그 상자 안에서 찾아요.' },
  { id: 'hand', title: '화면 옮기기', key: 'H', icon: 'hand', hint: '끌어서 화면을 옮겨요. 다른 도구를 쓰는 중에도 Space를 누르고 끌면 돼요.' },
  { id: 'zoom', title: '확대', key: 'Z', icon: 'zoom', hint: '눌러서 확대, Alt를 누르고 눌러서 축소해요. 마우스 휠로도 돼요.' },
];
const toolOf = () => TOOLS.find(t => t.id === view.tool) || TOOLS[0];
const opt = (k, d) => { const o = settings.get('selOpt') || {}; return o[k] === undefined ? d : o[k]; };
const setOpt = (k, v) => settings.set('selOpt', { ...(settings.get('selOpt') || {}), [k]: v });

// ---- 좌표 ----
const toDoc = (px, py) => ({ x: (px - view.ox) / view.zoom, y: (py - view.oy) / view.zoom });
const mediaOf = l => state.project.media.find(m => m.id === l.mediaId);
function layerSize(l) { const m = mediaOf(l); return m ? { w: m.w * l.scale, h: m.h * l.scale } : { w: 0, h: 0 }; }
function toLocal(l, p) {
  const s = layerSize(l), cx = l.x + s.w / 2, cy = l.y + s.h / 2, a = -l.rot * Math.PI / 180;
  const dx = p.x - cx, dy = p.y - cy;
  return { x: dx * Math.cos(a) - dy * Math.sin(a) + s.w / 2, y: dx * Math.sin(a) + dy * Math.cos(a) + s.h / 2, w: s.w, h: s.h };
}
function hit(c, p) {
  for (let i = c.layers.length - 1; i >= 0; i--) {
    const l = c.layers[i]; if (!l.visible || l.locked) continue;
    const q = toLocal(l, p); if (q.x >= 0 && q.y >= 0 && q.x <= q.w && q.y <= q.h) return l;
  }
  return null;
}
function cornerHit(l, p) {
  const q = toLocal(l, p), r = 7 / view.zoom;
  for (const [cx, cy, n] of [[0, 0, 'nw'], [q.w, 0, 'ne'], [0, q.h, 'sw'], [q.w, q.h, 'se']]) if (Math.abs(q.x - cx) <= r && Math.abs(q.y - cy) <= r) return n;
  return null;
}

export function fit() {
  const c = canvasOf(); if (!c || !wrap) return;
  const W = wrap.clientWidth, H = wrap.clientHeight, pad = 48;
  view.zoom = clamp(Math.min((W - pad) / c.w, (H - pad) / c.h), 0.02, 32);
  view.ox = (W - c.w * view.zoom) / 2; view.oy = (H - c.h * view.zoom) / 2;
  view.fitted = c.id; draw();
}
export function zoomAt(f, px, py) {
  if (!wrap) return;
  if (px == null) { px = wrap.clientWidth / 2; py = wrap.clientHeight / 2; }
  const z = clamp(view.zoom * f, 0.02, 32), d = toDoc(px, py);
  view.zoom = z; view.ox = px - d.x * z; view.oy = py - d.y * z; draw(); tick();
}

// ---- 그리기 ----
// 보정 값(밝기·대비·채도·색조·흐림)은 레이어에 숫자로만 남겨 두고 그릴 때 입혀요. 원본 그림은 그대로예요.
export const ADJ = [['bright', '밝기', -100, 100], ['contrast', '대비', -100, 100], ['sat', '채도', -100, 100], ['hue', '색조', -180, 180], ['blur', '흐림', 0, 40]];
// 톤 보정: 어두운 곳·밝은 곳의 끝점, 중간 밝기, 색온도. 색 단계표를 만들어 필터로 입혀요.
export const TONE = [['black', '어두운 곳 조이기', 0, 100], ['white', '밝은 곳 조이기', 0, 100], ['gamma', '중간 밝기', -100, 100], ['temp', '색온도', -100, 100]];
const luts = new Map();
function lutOf(a) {
  const key = [a.black | 0, a.white | 0, a.gamma | 0, a.temp | 0].join('_'); if (key === '0_0_0_0') return '';
  if (luts.has(key)) return luts.get(key);
  let svg = document.getElementById('adjLuts');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'adjLuts'; svg.setAttribute('width', 0); svg.setAttribute('height', 0); svg.style.position = 'absolute'; document.body.append(svg); }
  const lo = (a.black || 0) / 200, hi = 1 - (a.white || 0) / 200, ex = Math.pow(2, -(a.gamma || 0) / 100), t = (a.temp || 0) / 100;
  const table = gain => Array.from({ length: 33 }, (_, i) => Math.min(1, Math.max(0, Math.pow(Math.min(1, Math.max(0, (i / 32 - lo) / Math.max(0.02, hi - lo))), ex) * gain)).toFixed(4)).join(' ');
  const id = 'lut' + key.replace(/-/g, 'm'), NS = 'http://www.w3.org/2000/svg', f = document.createElementNS(NS, 'filter'), ct = document.createElementNS(NS, 'feComponentTransfer');
  f.id = id; f.setAttribute('color-interpolation-filters', 'sRGB');
  for (const [ch, gain] of [['R', 1 + t * 0.18], ['G', 1], ['B', 1 - t * 0.18]]) { const fn = document.createElementNS(NS, 'feFunc' + ch); fn.setAttribute('type', 'table'); fn.setAttribute('tableValues', table(gain)); ct.append(fn); }
  f.append(ct); svg.append(f); luts.set(key, `url(#${id})`);
  return luts.get(key);
}
function filterOf(l) {
  const a = l.adj; if (!a) return 'none';
  const f = [], lut = lutOf(a); if (lut) f.push(lut);
  if (a.bright) f.push(`brightness(${1 + a.bright / 100})`);
  if (a.contrast) f.push(`contrast(${1 + a.contrast / 100})`);
  if (a.sat) f.push(`saturate(${1 + a.sat / 100})`);
  if (a.hue) f.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) f.push(`blur(${a.blur * l.scale}px)`);
  return f.join(' ') || 'none';
}
export function paint(g, c, only) {
  for (const l of c.layers) {
    if (!l.visible || (only && l.id !== only)) continue;
    const bmp = state.bitmaps.get(l.mediaId); if (!bmp) { ensureBitmap(l.mediaId); continue; }
    const s = layerSize(l);
    g.save(); g.globalAlpha = l.opacity; g.filter = filterOf(l);
    g.translate(l.x + s.w / 2, l.y + s.h / 2); g.rotate(l.rot * Math.PI / 180);
    g.imageSmoothingQuality = 'high';
    g.drawImage(l.maskId ? masked(l, bmp) : bmp, -s.w / 2, -s.h / 2, s.w, s.h);
    g.restore();
  }
}
// 가림막: 레이어 그림과 같은 크기의 그림. 불투명한 곳만 레이어가 보여요. 원본 그림은 그대로예요.
const maskCache = new Map();
function masked(l, bmp) {
  const mb = state.bitmaps.get(l.maskId); if (!mb) { ensureBitmap(l.maskId).then(() => emit()); return bmp; }
  const key = l.mediaId + '|' + l.maskId; let c = maskCache.get(key);
  if (!c) { c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); g.globalCompositeOperation = 'destination-in'; g.drawImage(mb, 0, 0, c.width, c.height); if (maskCache.size > 24) maskCache.clear(); maskCache.set(key, c); }
  return c;
}
async function maskFromSel(invert) {
  const l = layerOf(), bmp = await ensureBitmap(l.mediaId), s = layerSize(l), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.scale(c.width / s.w, c.height / s.h); g.rotate(-l.rot * Math.PI / 180); g.translate(-(l.x + s.w / 2), -(l.y + s.h / 2)); g.drawImage(sel.cv, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (invert) { g.globalCompositeOperation = 'source-out'; g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); }
  if (l.maskId) { const old = await ensureBitmap(l.maskId); g.globalCompositeOperation = 'destination-in'; g.drawImage(old, 0, 0, c.width, c.height); }   // 이미 가린 곳은 계속 가려요
  const m = await addMedia(new File([await toBlob(c)], `${l.name} 가림막.png`, { type: 'image/png' }), null, { hidden: true });
  await ensureBitmap(m.id); l.maskId = m.id; selNone(); commit(invert ? '고른 곳 가리기' : '고른 곳만 보이기');
}
// 그림판을 한 장으로 합친 캔버스 (only = 그 레이어만)
export async function flatten(c, only) {
  await Promise.all(c.layers.map(l => ensureBitmap(l.mediaId)));
  const t = document.createElement('canvas'); t.width = c.w; t.height = c.h;
  paint(t.getContext('2d'), c, only); return t;
}
function guides(g) {
  const l = layerOf(); if (!l || !l.visible || toolOf().sel) return;
  const s = layerSize(l), px = 1 / view.zoom;
  g.save(); g.translate(l.x + s.w / 2, l.y + s.h / 2); g.rotate(l.rot * Math.PI / 180);
  g.lineWidth = px; g.strokeStyle = '#4b9fe8'; g.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
  g.fillStyle = '#fff';
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const r = 3.5 * px; g.fillRect(x * s.w / 2 - r, y * s.h / 2 - r, r * 2, r * 2); g.strokeRect(x * s.w / 2 - r, y * s.h / 2 - r, r * 2, r * 2); }
  g.restore();
}
// 고른 곳: 옅은 파랑으로 덮고 테두리를 그려요
let tintCv = null, tintRev = -1;
function tinted() {
  if (tintRev === sel.rev && tintCv) return tintCv;
  tintCv = document.createElement('canvas'); tintCv.width = sel.w; tintCv.height = sel.h;
  const g = tintCv.getContext('2d'); g.fillStyle = '#3d8ee6'; g.fillRect(0, 0, sel.w, sel.h); g.globalCompositeOperation = 'destination-in'; g.drawImage(sel.cv, 0, 0);
  tintRev = sel.rev; return tintCv;
}
function drawSel(dpr) {
  if (!sel.cv || !sel.any) return;
  if (!ring || ring.width !== cv.width || ring.height !== cv.height) { ring = document.createElement('canvas'); ring.width = cv.width; ring.height = cv.height; }
  const g = ring.getContext('2d'), k = dpr * view.zoom, put = (img, dx, dy) => { g.setTransform(k, 0, 0, k, dpr * (view.ox + dx), dpr * (view.oy + dy)); g.drawImage(img, 0, 0); };
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, ring.width, ring.height);
  for (const [dx, dy] of [[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.2]]) put(sel.cv, dx, dy);
  g.globalCompositeOperation = 'destination-out'; put(sel.cv, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#eaf4ff'; g.fillRect(0, 0, ring.width, ring.height);
  g.globalCompositeOperation = 'destination-over'; g.globalAlpha = 0.25; put(tinted(), 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(ring, 0, 0); ctx.restore();
}
function drawDraft(g) {
  const d = view.draft; if (!d) return;
  g.save(); g.lineWidth = 1 / view.zoom; g.strokeStyle = '#eaf4ff'; g.setLineDash([4 / view.zoom, 3 / view.zoom]);
  const path = () => { g.beginPath(); d.pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); };
  if (d.kind === 'rect') g.strokeRect(d.x, d.y, d.w, d.h);
  else if (d.kind === 'ellipse') { g.beginPath(); g.ellipse(d.x + d.w / 2, d.y + d.h / 2, Math.abs(d.w / 2), Math.abs(d.h / 2), 0, 0, Math.PI * 2); g.stroke(); }
  else if (d.kind === 'lasso') { path(); g.stroke(); }
  else if (d.kind === 'magic') { g.setLineDash([]); g.lineCap = g.lineJoin = 'round'; g.lineWidth = d.size; g.strokeStyle = d.op === 'sub' ? 'rgba(224,112,95,.45)' : 'rgba(61,142,230,.45)'; path(); if (d.pts.length === 1) g.lineTo(d.pts[0].x + 0.01, d.pts[0].y); g.stroke(); }
  g.restore();
}
export function draw() {
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const c = canvasOf(); if (!c) return;
  selFor(c);
  if (!checker) {
    const t = document.createElement('canvas'); t.width = t.height = 16; const g = t.getContext('2d');
    g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
    checker = ctx.createPattern(t, 'repeat');
  }
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(view.ox + 2, view.oy + 3, c.w * view.zoom, c.h * view.zoom);
  ctx.fillStyle = checker; ctx.fillRect(view.ox, view.oy, c.w * view.zoom, c.h * view.zoom);
  ctx.save(); ctx.beginPath(); ctx.rect(view.ox, view.oy, c.w * view.zoom, c.h * view.zoom); ctx.clip();
  ctx.translate(view.ox, view.oy); ctx.scale(view.zoom, view.zoom);
  paint(ctx, c); ctx.restore();
  drawSel(dpr);
  ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.zoom, view.zoom); guides(ctx); drawDraft(ctx); ctx.restore();
}

// ---- 파일 ----
// 그림판 쪽으로 넣기: 그림판이 없으면 첫 그림 크기로 만들고, toCanvas면 레이어로도 올려요
export async function importFiles(files, o) { return importList([...files].filter(isImage).map(file => ({ file, dir: '' })), o); }
export async function importList(items, { toCanvas = false } = {}) {
  if (!items.length) { toast('그림 파일(PNG, JPG, WebP 등)만 넣을 수 있어요.', 'err'); return; }
  const { made, failed } = await importItems(items);
  failed.forEach(n => toast(`'${n}'은 열 수 없는 그림이에요.`, 'err'));
  if (!made.length) return;
  if (!canvasOf()) { const m = made[0]; addLayer(newCanvas(m.name.replace(/\.[a-z0-9]+$/i, ''), m.w, m.h), m); if (toCanvas) made.slice(1, 12).forEach(m => addLayer(canvasOf(), m)); }
  else if (toCanvas) made.slice(0, 12).forEach(m => addLayer(canvasOf(), m));
  commit(made.length > 1 ? `그림 ${made.length}장 넣기` : '그림 넣기');
}
function pickFiles() {
  const i = h('input', { type: 'file', accept: 'image/*', multiple: true });
  i.onchange = () => importFiles(i.files);
  i.click();
}
const toBlob = c => new Promise(r => c.toBlob(r, 'image/png'));
export async function exportPng() {
  const c = canvasOf(); if (!c) return;
  const blob = await toBlob(await flatten(c));
  const a = h('a', { href: URL.createObjectURL(blob), download: c.name + '.png' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`'${c.name}.png'로 내보냈어요.`);
}
// 그림 파일(Blob)을 보관함에 넣고 레이어로 올려요. hidden이면 보관함 목록에는 안 보여요(레이어 전용)
export async function layerFromBlob(c, blob, name, { x = 0, y = 0, scale = 1, hidden = false, folder = null } = {}) {
  const m = await addMedia(new File([blob], name + '.png', { type: 'image/png' }), folder, hidden ? { hidden: true } : {});
  const l = addLayer(c, m); l.x = Math.round(x); l.y = Math.round(y); l.scale = scale; l.name = name;
  return l;
}

// ---- 고른 곳으로 하는 일 ----
// 고른 곳을 새 레이어로: 레이어를 골랐으면 그 레이어에서만, 아니면 보이는 그대로
async function selToLayer() {
  const c = canvasOf(), b = selBounds(); if (!c || !b) return;
  const cur = layerOf(), src = await flatten(c, cur ? cur.id : null);
  const t = document.createElement('canvas'); t.width = b.w; t.height = b.h; const g = t.getContext('2d');
  g.drawImage(src, -b.x, -b.y); g.globalCompositeOperation = 'destination-in'; g.drawImage(sel.cv, -b.x, -b.y);
  await layerFromBlob(c, await toBlob(t), cur ? cur.name + ' 조각' : '고른 곳', { x: b.x, y: b.y });
  commit('고른 곳을 새 레이어로');
}
// 고른 곳 지우기: 고른 레이어의 그림에서 그 자리만 투명하게. 원본 그림은 보관함에 그대로 남아요
async function selErase() {
  const c = canvasOf(), l = layerOf(); if (!c || !sel.any) return;
  if (!l) { toast('지울 레이어를 먼저 골라 주세요.', 'err'); return; }
  if (l.locked) { toast('잠긴 레이어예요.', 'err'); return; }
  const m = mediaOf(l), bmp = await ensureBitmap(l.mediaId), s = layerSize(l);
  const t = document.createElement('canvas'); t.width = m.w; t.height = m.h; const g = t.getContext('2d');
  g.drawImage(bmp, 0, 0); g.globalCompositeOperation = 'destination-out';
  g.translate(m.w / 2, m.h / 2); g.scale(1 / l.scale, 1 / l.scale); g.rotate(-l.rot * Math.PI / 180); g.translate(-(l.x + s.w / 2), -(l.y + s.h / 2));
  g.drawImage(sel.cv, 0, 0);
  const nm = await addMedia(new File([await toBlob(t)], m.name.replace(/\.[a-z0-9]+$/i, '') + ' 고침.png', { type: 'image/png' }), m.folder || null, { hidden: true });
  l.mediaId = nm.id; await ensureBitmap(nm.id);
  commit('고른 곳 지우기');
}

// ---- 화면 ----
export const imageRoom = {
  id: 'image', title: '이미지', icon: 'image',
  mount(el) {
    const tools = h('div.tools', { role: 'toolbar', 'aria-label': '도구' });
    const tabs = h('div.doc-tabs', { role: 'tablist' });
    const optbar = h('div.optbar');
    cv = h('canvas.viewport', { tabindex: '0', 'aria-label': '그림판' }); ctx = cv.getContext('2d'); checker = null;
    const empty = h('div.empty-room', null,
      h('h2', null, '그림을 여기에 끌어다 놓으세요'),
      h('p', null, '처음 넣은 그림 크기로 그림판이 만들어져요. 그 뒤에 넣는 그림은 보관함에 모이고, 보관함에서 두 번 누르면 레이어로 올라가요.'),
      h('button.btn.primary', { onclick: () => run('file.open') }, '그림 열기'));
    wrap = h('div.viewport-wrap', null, cv, empty);
    el.append(tools, h('div.doc', null, tabs, optbar, wrap));

    const ro = new ResizeObserver(() => { if (view.fitted !== (canvasOf() || {}).id) fit(); else draw(); });
    ro.observe(wrap);

    cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      const c = canvasOf(); if (!c) return;
      cv.focus();
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const at = ev => toDoc(ev.clientX - r.left, ev.clientY - r.top);
      const pan = view.space || view.tool === 'hand' || e.button === 1;
      if (pan) { const ox = view.ox, oy = view.oy; cv.classList.add('grabbing'); return drag(e, ev => { view.ox = ox + ev.clientX - e.clientX; view.oy = oy + ev.clientY - e.clientY; draw(); }, () => cv.classList.remove('grabbing')); }
      if (e.button !== 0) return;
      if (view.tool === 'zoom') return zoomAt(e.altKey ? 1 / 1.5 : 1.5, sx, sy);
      const p = toDoc(sx, sy), tool = view.tool, op = e.altKey ? 'sub' : e.shiftKey ? 'add' : 'new';
      if (toolOf().sel) {
        selFor(c);
        if (tool === 'sam') {
          // 누르기 = 점 하나, 끌기 = 상자. Shift·Alt는 지금 고르던 것에 '이것'·'아님' 점을 더해요
          view.draft = { kind: 'rect', x: p.x, y: p.y, w: 0, h: 0 };
          return drag(e, ev => { const q = at(ev); Object.assign(view.draft, { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }); draw(); }, () => {
            const d = view.draft; view.draft = null; draw();
            const isBox = d.w * view.zoom > 6 && d.h * view.zoom > 6;
            if (op === 'new' || isBox || !samPick || samPick.id !== c.id) samPick = { id: c.id, pts: [], box: null };
            if (isBox) samPick.box = [d.x, d.y, d.x + d.w, d.y + d.h]; else samPick.pts.push([p.x, p.y, op === 'sub' ? 0 : 1]);
            if (!samPick.pts.some(q => q[2] === 1) && !samPick.box) { samPick = null; return; }
            run('sel.sam');
          });
        }
        if (tool === 'wand') return flatten(c).then(img => selWand(op, img, p.x, p.y, opt('tol', 20), opt('contig', true)));
        if (tool === 'rect' || tool === 'ellipse') {
          view.draft = { kind: tool, x: p.x, y: p.y, w: 0, h: 0 };
          return drag(e, ev => { const q = at(ev); Object.assign(view.draft, { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }); draw(); }, () => {
            const d = view.draft; view.draft = null;
            if (d.w < 2 / view.zoom && d.h < 2 / view.zoom) { if (op === 'new') selNone(); else draw(); return; }
            (tool === 'rect' ? selRect : selEllipse)(op, d.x, d.y, d.w, d.h);
          });
        }
        const size = tool === 'magic' ? opt('size', 28) / view.zoom : 0;
        view.draft = { kind: tool, pts: [p], size, op }; draw();
        return drag(e, ev => { const q = at(ev), last = view.draft.pts[view.draft.pts.length - 1]; if (Math.hypot(q.x - last.x, q.y - last.y) * view.zoom > 2) { view.draft.pts.push(q); draw(); } }, async () => {
          const d = view.draft; view.draft = null;
          if (tool === 'lasso') { if (d.pts.length > 2) selPoly(op, d.pts); else if (op === 'new') selNone(); else draw(); return; }
          selMagic(op, await flatten(c), d.pts, size, opt('spread', 35));
        });
      }
      const cur = layerOf();
      const corner = cur && !cur.locked ? cornerHit(cur, p) : null;
      if (corner) {
        const s0 = layerSize(cur), sc0 = cur.scale, cx = cur.x + s0.w / 2, cy = cur.y + s0.h / 2;
        const d0 = Math.hypot(p.x - cx, p.y - cy) || 1; let moved = false;
        return drag(e, ev => {
          const q = at(ev);
          cur.scale = clamp(sc0 * Math.hypot(q.x - cx, q.y - cy) / d0, 0.01, 50);
          const s = layerSize(cur); cur.x = cx - s.w / 2; cur.y = cy - s.h / 2; moved = true; draw(); emit();
        }, () => { if (moved) { cur.x = Math.round(cur.x); cur.y = Math.round(cur.y); commit('크기 바꾸기'); } });
      }
      const l = hit(c, p);
      if (state.project.sel !== (l ? l.id : null)) { state.project.sel = l ? l.id : null; emit(); draw(); }
      if (!l) return;
      const x0 = l.x, y0 = l.y; let moved = false;
      drag(e, ev => {
        let dx = (ev.clientX - e.clientX) / view.zoom, dy = (ev.clientY - e.clientY) / view.zoom;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (Math.abs(dx) + Math.abs(dy) > 0) moved = true;
        l.x = Math.round(x0 + dx); l.y = Math.round(y0 + dy); draw(); emit();
      }, () => { if (moved) commit('레이어 옮기기'); });
    });
    cv.addEventListener('pointermove', e => { const r = cv.getBoundingClientRect(); const p = toDoc(e.clientX - r.left, e.clientY - r.top); view.mouse = { x: Math.round(p.x), y: Math.round(p.y) }; tick(); });
    cv.addEventListener('pointerleave', () => { view.mouse = null; tick(); });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault(); if (!canvasOf()) return;
      const ids = sel.any ? ['sel.toLayer', 'sel.erase', 'sel.invert', 'sel.none', '-', 'view.fit', 'file.export'] : ['layer.dup', 'layer.up', 'layer.down', '-', 'layer.delete', '-', 'sel.all', 'view.fit', 'file.export'];
      showMenu(ids.map(id => id === '-' ? '-' : menuItem(id)), e.clientX, e.clientY);
    });
    wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop'); });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', e => {
      e.preventDefault(); wrap.classList.remove('drop');
      const mid = e.dataTransfer.getData('application/x-potato-media');
      if (mid) { let ids = [mid]; try { ids = JSON.parse(e.dataTransfer.getData('application/x-potato-medias')) || ids; } catch (_) { /* 한 장만 */ } return ids.slice(0, 12).forEach(placeMedia); }
      if (e.dataTransfer.files.length) fromDrop(e.dataTransfer).then(items => importList(items, { toCanvas: true }));
    });

    const range = (label, key, min, max, def, unit) => { const out = h('span.opt-val', null, opt(key, def) + unit); return h('label.opt', null, h('span', null, label), h('input.range', { type: 'range', min, max, value: opt(key, def), 'aria-label': label, oninput: e => { out.textContent = e.target.value + unit; }, onchange: e => setOpt(key, +e.target.value) }), out); };
    let optKey = null;
    const update = () => {
      const p = state.project, c = canvasOf(), t = toolOf();
      tools.replaceChildren(...TOOLS.flatMap((t, i) => [i && !!t.sel !== !!TOOLS[i - 1].sel ? h('span.tool-sep') : null, h('button.tool' + (view.tool === t.id ? '.on' : ''), { title: `${t.title} (${t.key})`, 'aria-label': t.title, 'aria-pressed': String(view.tool === t.id), onclick: () => run('tool.' + t.id) }, icon(t.icon, 18))]).filter(Boolean));
      tabs.replaceChildren(...p.canvases.map(d => h('div.doc-tab' + (d.id === p.activeCanvas ? '.on' : ''), { role: 'tab', 'aria-selected': String(d.id === p.activeCanvas) },
        h('button.doc-tab-name', { onclick: () => { p.activeCanvas = d.id; p.sel = null; emit(); } }, d.name),
        h('button.icon-btn.small', { title: '그림판 지우기', 'aria-label': `${d.name} 지우기`, onclick: () => closeCanvas(d) }, icon('close', 12)))));
      tabs.hidden = !p.canvases.length;
      // 도구 옵션 줄: 고르는 도구일 때만. 값을 끄는 중에 다시 그려지지 않게 내용이 바뀔 때만 새로 만들어요
      const key = !c ? '' : t.id + '|' + sel.any;   // 그림판이 있으면 늘 보여요 (도구를 바꿀 때 그림이 위아래로 밀리지 않게)
      if (key !== optKey) {
        optKey = key;
        optbar.replaceChildren(...(!key ? [] : [
          h('span.opt-name', null, t.title),
          t.id === 'wand' && range('허용 범위', 'tol', 1, 100, 20, ''),
          t.id === 'wand' && h('label.check', null, h('input', { type: 'checkbox', checked: opt('contig', true), onchange: e => setOpt('contig', e.target.checked) }), '이어진 곳만'),
          t.id === 'magic' && range('붓 굵기', 'size', 6, 120, 28, 'px'),
          t.id === 'magic' && range('번짐', 'spread', 0, 100, 35, ''),
          h('span.grow'),
          sel.any && h('button.btn.small', { onclick: () => run('sel.toLayer') }, '새 레이어로'),
          sel.any && h('button.btn.small', { onclick: () => run('sel.erase') }, '지우기'),
          sel.any && h('button.btn.small', { title: '고른 곳을 둘레에 어울리게 메워요', onclick: () => run('ai.erase') }, 'AI로 지우기'),
          sel.any && h('button.btn.small', { onclick: () => run('sel.invert') }, '반대로'),
          sel.any && h('button.btn.small', { onclick: () => run('sel.none') }, '고르기 풀기'),
        ].filter(Boolean)));
      }
      optbar.hidden = !key;
      empty.hidden = !!c; cv.hidden = !c;
      cv.dataset.tool = view.space ? 'hand' : view.tool;
      if (c && view.fitted !== c.id) fit(); else draw();
    };
    update();
    return { update, destroy: () => { ro.disconnect(); cv = null; wrap = null; } };
  },
  status() {
    const c = canvasOf(), l = layerOf();
    return [c ? `${c.w} × ${c.h}` : '', l ? l.name : '', c && sel.any ? '고른 곳 있음' : '', view.mouse ? `${view.mouse.x}, ${view.mouse.y}` : ''].filter(Boolean);
  },
  hint: () => canvasOf() ? toolOf().hint : '그림 파일을 끌어다 놓거나 Ctrl + O로 열어요.',
  zoomText: () => canvasOf() ? Math.round(view.zoom * 100) + '%' : '',
};

export let samPick = null;   // 'AI로 고르기'로 찍은 점들과 상자
let menuItem = id => ({ label: id, run() {} });
export const setMenuItem = f => { menuItem = f; };

export function placeMedia(mid) {
  const m = state.project.media.find(m => m.id === mid); if (!m) return;
  let c = canvasOf();
  if (!c) c = newCanvas(m.name.replace(/\.[a-z0-9]+$/i, ''), m.w, m.h);
  addLayer(c, m); commit('레이어로 올리기');
}
async function closeCanvas(d) {
  if (!await confirmBox('그림판 지우기', `'${d.name}' 그림판을 지울까요? 보관함의 그림은 그대로 남고, 되돌리기로 다시 살릴 수 있어요.`, '지우기', true)) return;
  const p = state.project; p.canvases = p.canvases.filter(c => c.id !== d.id);
  if (p.activeCanvas === d.id) { p.activeCanvas = (p.canvases[0] || {}).id || null; p.sel = null; }
  commit('그림판 지우기');
}

// ---- 명령 ----
const hasCanvas = () => !!canvasOf(), hasLayer = () => !!layerOf(), hasSel = () => !!canvasOf() && sel.any;
function moveLayer(d) {
  const c = canvasOf(), l = layerOf(), i = c.layers.indexOf(l), j = i + d;
  if (j < 0 || j >= c.layers.length) return;
  c.layers.splice(i, 1); c.layers.splice(j, 0, l); commit(d > 0 ? '레이어 위로' : '레이어 아래로');
}
export function registerImageCmds() {
  addCmd({ id: 'file.open', title: '그림 열기…', menu: '파일', keys: 'Ctrl+O', words: '불러오기 가져오기 import', run: pickFiles });
  addCmd({ id: 'file.export', title: 'PNG로 내보내기', menu: '파일', keys: 'Ctrl+E', words: '저장 export', enabled: hasCanvas, run: exportPng });
  TOOLS.forEach(t => addCmd({ id: 'tool.' + t.id, title: t.title + ' 도구', menu: '도구', group: t.sel ? 'sel' : t.id === 'move' ? 'move' : 'view', keys: t.key, checked: () => view.tool === t.id, run: () => { view.tool = t.id; emit(); } }));
  addCmd({ id: 'sel.all', title: '모두 고르기', menu: '고르기', keys: 'Ctrl+A', enabled: hasCanvas, run: () => { selFor(canvasOf()); selAll(); } });
  addCmd({ id: 'sel.none', title: '고르기 풀기', menu: '고르기', keys: 'Ctrl+D', enabled: hasSel, run: selNone });
  addCmd({ id: 'sel.invert', title: '반대로 고르기', menu: '고르기', keys: 'Ctrl+I', words: '반전', enabled: hasSel, run: selInvert });
  addCmd({ id: 'sel.grow', title: '고른 곳 넓히기 (4px)', menu: '고르기', group: 'edge', enabled: hasSel, run: () => selGrow(4) });
  addCmd({ id: 'sel.shrink', title: '고른 곳 좁히기 (4px)', menu: '고르기', group: 'edge', enabled: hasSel, run: () => selGrow(-4) });
  addCmd({ id: 'sel.toLayer', title: '고른 곳을 새 레이어로', menu: '고르기', group: 'do', keys: 'Ctrl+Shift+J', words: '복사 오려 누끼', enabled: hasSel, run: selToLayer });
  addCmd({ id: 'sel.erase', title: '고른 곳 지우기', menu: '고르기', group: 'do', keys: 'Backspace', enabled: () => hasSel() && hasLayer(), run: selErase });
  addCmd({ id: 'view.fit', title: '화면에 맞추기', menu: '보기', keys: 'Ctrl+0', enabled: hasCanvas, run: fit });
  addCmd({ id: 'view.100', title: '실제 크기 (100%)', menu: '보기', keys: 'Ctrl+1', enabled: hasCanvas, run: () => zoomAt(1 / view.zoom) });
  addCmd({ id: 'view.in', title: '확대', menu: '보기', keys: 'Ctrl+=', enabled: hasCanvas, run: () => zoomAt(1.25) });
  addCmd({ id: 'view.out', title: '축소', menu: '보기', keys: 'Ctrl+-', enabled: hasCanvas, run: () => zoomAt(0.8) });
  addCmd({ id: 'layer.dup', title: '레이어 복제', menu: '레이어', keys: 'Ctrl+J', enabled: hasLayer, run: () => { const c = canvasOf(), l = layerOf(), n = { ...l, ...(l.adj ? { adj: { ...l.adj } } : {}), id: uid('l'), name: l.name + ' 복사', x: l.x + 20, y: l.y + 20 }; c.layers.splice(c.layers.indexOf(l) + 1, 0, n); state.project.sel = n.id; commit('레이어 복제'); } });
  addCmd({ id: 'layer.up', title: '레이어 위로', menu: '레이어', keys: 'Ctrl+]', enabled: hasLayer, run: () => moveLayer(1) });
  addCmd({ id: 'layer.down', title: '레이어 아래로', menu: '레이어', keys: 'Ctrl+[', enabled: hasLayer, run: () => moveLayer(-1) });
  addCmd({ id: 'layer.maskKeep', title: '고른 곳만 보이기 (가림막)', menu: '레이어', group: 'mask', words: '마스크 mask 가리기', enabled: () => hasLayer() && sel.any, run: () => maskFromSel(false) });
  addCmd({ id: 'layer.maskHide', title: '고른 곳 가리기 (가림막)', menu: '레이어', group: 'mask', words: '마스크 mask 숨기기', enabled: () => hasLayer() && sel.any, run: () => maskFromSel(true) });
  addCmd({ id: 'layer.maskOff', title: '가림막 없애기', menu: '레이어', group: 'mask', enabled: () => !!(layerOf() && layerOf().maskId), run: () => { delete layerOf().maskId; commit('가림막 없애기'); } });
  addCmd({ id: 'layer.resetAdj', title: '보정 처음으로', menu: '레이어', group: 'adj', enabled: () => !!(layerOf() && layerOf().adj), run: () => { delete layerOf().adj; commit('보정 처음으로'); } });
  addCmd({ id: 'layer.delete', title: '레이어 지우기', menu: '레이어', group: 'del', keys: 'Delete', enabled: hasLayer, run: () => { const c = canvasOf(); c.layers = c.layers.filter(l => l.id !== state.project.sel); state.project.sel = null; commit('레이어 지우기'); } });
  addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) { view.space = true; if (cv) cv.dataset.tool = 'hand'; e.preventDefault(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') { view.space = false; if (cv) cv.dataset.tool = view.tool; } });
  addEventListener('paste', e => { const fs = [...(e.clipboardData || {}).files || []]; if (fs.length && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) importFiles(fs, { toCanvas: true }); });
}
