// 이미지 작업실: 그림판에 레이어를 올리고 옮기고 크기를 바꿔요.
// 고르는 도구·보정·AI 도구는 다음 단계에서 이 위에 얹어요.
import { h, icon, clamp, drag } from '../ui/dom.js';
import { state, commit, emit, tick, canvasOf, layerOf, newCanvas, addLayer, uid, ensureBitmap } from '../core/store.js';
import { importItems } from '../core/library.js';
import { fromDrop, isImage } from '../core/files.js';
import { addCmd, run } from '../core/cmd.js';
import { toast, showMenu, confirmBox } from '../ui/overlay.js';

export const view = { tool: 'move', zoom: 1, ox: 0, oy: 0, fitted: null, space: false, mouse: null };
let cv = null, ctx = null, wrap = null, checker = null;

const TOOLS = [
  { id: 'move', title: '옮기기', key: 'V', icon: 'move', hint: '레이어를 끌어 옮겨요. 모서리 점을 끌면 크기가 바뀌어요. Shift를 누르면 가로·세로로만 움직여요.' },
  { id: 'hand', title: '화면 옮기기', key: 'H', icon: 'hand', hint: '끌어서 화면을 옮겨요. 다른 도구를 쓰는 중에도 Space를 누르고 끌면 돼요.' },
  { id: 'zoom', title: '확대', key: 'Z', icon: 'zoom', hint: '눌러서 확대, Alt를 누르고 눌러서 축소해요. 마우스 휠로도 돼요.' },
];
export const toolHint = () => (TOOLS.find(t => t.id === view.tool) || {}).hint || '';

// ---- 좌표 ----
const toDoc = (px, py) => ({ x: (px - view.ox) / view.zoom, y: (py - view.oy) / view.zoom });
function layerSize(l) { const m = state.project.media.find(m => m.id === l.mediaId); return m ? { w: m.w * l.scale, h: m.h * l.scale } : { w: 0, h: 0 }; }
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
export function paint(g, c, { guides = false } = {}) {
  for (const l of c.layers) {
    if (!l.visible) continue;
    const bmp = state.bitmaps.get(l.mediaId); if (!bmp) { ensureBitmap(l.mediaId); continue; }
    const s = layerSize(l);
    g.save(); g.globalAlpha = l.opacity;
    g.translate(l.x + s.w / 2, l.y + s.h / 2); g.rotate(l.rot * Math.PI / 180);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, -s.w / 2, -s.h / 2, s.w, s.h);
    g.restore();
  }
  if (!guides) return;
  const l = layerOf(); if (!l || !l.visible) return;
  const s = layerSize(l), px = 1 / view.zoom;
  g.save(); g.translate(l.x + s.w / 2, l.y + s.h / 2); g.rotate(l.rot * Math.PI / 180);
  g.lineWidth = px; g.strokeStyle = '#4b9fe8'; g.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
  g.fillStyle = '#fff';
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const r = 3.5 * px; g.fillRect(x * s.w / 2 - r, y * s.h / 2 - r, r * 2, r * 2); g.strokeRect(x * s.w / 2 - r, y * s.h / 2 - r, r * 2, r * 2); }
  g.restore();
}
export function draw() {
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const c = canvasOf(); if (!c) return;
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
  ctx.save(); ctx.translate(view.ox, view.oy); ctx.scale(view.zoom, view.zoom); paint(ctx, { layers: [] }, { guides: true }); ctx.restore();
}

// ---- 파일 ----
// 그림판 쪽으로 넣기: 그림판이 없으면 첫 그림 크기로 만들고, toCanvas면 레이어로도 올려요
export async function importFiles(files, opt) { return importList([...files].filter(isImage).map(file => ({ file, dir: '' })), opt); }
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
export async function exportPng() {
  const c = canvasOf(); if (!c) return;
  const t = document.createElement('canvas'); t.width = c.w; t.height = c.h;
  await Promise.all(c.layers.map(l => ensureBitmap(l.mediaId)));
  paint(t.getContext('2d'), c);
  const blob = await new Promise(r => t.toBlob(r, 'image/png'));
  const a = h('a', { href: URL.createObjectURL(blob), download: c.name + '.png' });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`'${c.name}.png'로 내보냈어요.`);
}

// ---- 화면 ----
export const imageRoom = {
  id: 'image', title: '이미지', icon: 'image',
  mount(el) {
    const tools = h('div.tools', { role: 'toolbar', 'aria-label': '도구' });
    const tabs = h('div.doc-tabs', { role: 'tablist' });
    cv = h('canvas.viewport', { tabindex: '0', 'aria-label': '그림판' }); ctx = cv.getContext('2d'); checker = null;
    const empty = h('div.empty-room', null,
      h('h2', null, '그림을 여기에 끌어다 놓으세요'),
      h('p', null, '처음 넣은 그림 크기로 그림판이 만들어져요. 그 뒤에 넣는 그림은 보관함에 모이고, 보관함에서 두 번 누르면 레이어로 올라가요.'),
      h('button.btn.primary', { onclick: () => run('file.open') }, '그림 열기'));
    wrap = h('div.viewport-wrap', null, cv, empty);
    el.append(tools, h('div.doc', null, tabs, wrap));

    const ro = new ResizeObserver(() => { if (view.fitted !== (canvasOf() || {}).id) fit(); else draw(); });
    ro.observe(wrap);

    cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      const c = canvasOf(); if (!c) return;
      cv.focus();
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const pan = view.space || view.tool === 'hand' || e.button === 1;
      if (pan) { const ox = view.ox, oy = view.oy; cv.classList.add('grabbing'); return drag(e, ev => { view.ox = ox + ev.clientX - e.clientX; view.oy = oy + ev.clientY - e.clientY; draw(); }, () => cv.classList.remove('grabbing')); }
      if (e.button !== 0) return;
      if (view.tool === 'zoom') return zoomAt(e.altKey ? 1 / 1.5 : 1.5, sx, sy);
      const p = toDoc(sx, sy), cur = layerOf();
      const corner = cur && !cur.locked ? cornerHit(cur, p) : null;
      if (corner) {
        const s0 = layerSize(cur), sc0 = cur.scale, cx = cur.x + s0.w / 2, cy = cur.y + s0.h / 2;
        const d0 = Math.hypot(p.x - cx, p.y - cy) || 1; let moved = false;
        return drag(e, ev => {
          const q = toDoc(ev.clientX - r.left, ev.clientY - r.top);
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
      showMenu(['layer.dup', 'layer.up', 'layer.down', '-', 'layer.delete', '-', 'view.fit', 'file.export'].map(id => id === '-' ? '-' : menuItem(id)), e.clientX, e.clientY);
    });
    wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drop'); });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', e => {
      e.preventDefault(); wrap.classList.remove('drop');
      const mid = e.dataTransfer.getData('application/x-potato-media');
      if (mid) { let ids = [mid]; try { ids = JSON.parse(e.dataTransfer.getData('application/x-potato-medias')) || ids; } catch (_) { /* 한 장만 */ } return ids.slice(0, 12).forEach(placeMedia); }
      if (e.dataTransfer.files.length) fromDrop(e.dataTransfer).then(items => importList(items, { toCanvas: true }));
    });

    const update = () => {
      const p = state.project, c = canvasOf();
      tools.replaceChildren(...TOOLS.map(t => h('button.tool' + (view.tool === t.id ? '.on' : ''), { title: `${t.title} (${t.key})`, 'aria-label': t.title, 'aria-pressed': String(view.tool === t.id), onclick: () => run('tool.' + t.id) }, icon(t.icon, 18))));
      tabs.replaceChildren(...p.canvases.map(d => h('div.doc-tab' + (d.id === p.activeCanvas ? '.on' : ''), { role: 'tab', 'aria-selected': String(d.id === p.activeCanvas) },
        h('button.doc-tab-name', { onclick: () => { p.activeCanvas = d.id; p.sel = null; emit(); } }, d.name),
        h('button.icon-btn.small', { title: '그림판 지우기', 'aria-label': `${d.name} 지우기`, onclick: () => closeCanvas(d) }, icon('close', 12)))));
      tabs.hidden = !p.canvases.length;
      empty.hidden = !!c; cv.hidden = !c;
      cv.dataset.tool = view.space ? 'hand' : view.tool;
      if (c && view.fitted !== c.id) fit(); else draw();
    };
    update();
    return { update, destroy: () => { ro.disconnect(); cv = null; wrap = null; } };
  },
  status() {
    const c = canvasOf(), l = layerOf();
    return [c ? `${c.w} × ${c.h}` : '', l ? l.name : '', view.mouse ? `${view.mouse.x}, ${view.mouse.y}` : ''].filter(Boolean);
  },
  hint: () => canvasOf() ? toolHint() : '그림 파일을 끌어다 놓거나 Ctrl + O로 열어요.',
  zoomText: () => canvasOf() ? Math.round(view.zoom * 100) + '%' : '',
};

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
const hasCanvas = () => !!canvasOf(), hasLayer = () => !!layerOf();
function moveLayer(d) {
  const c = canvasOf(), l = layerOf(), i = c.layers.indexOf(l), j = i + d;
  if (j < 0 || j >= c.layers.length) return;
  c.layers.splice(i, 1); c.layers.splice(j, 0, l); commit(d > 0 ? '레이어 위로' : '레이어 아래로');
}
export function registerImageCmds() {
  addCmd({ id: 'file.open', title: '그림 열기…', menu: '파일', keys: 'Ctrl+O', words: '불러오기 가져오기 import', run: pickFiles });
  addCmd({ id: 'file.export', title: 'PNG로 내보내기', menu: '파일', keys: 'Ctrl+E', words: '저장 export', enabled: hasCanvas, run: exportPng });
  TOOLS.forEach(t => addCmd({ id: 'tool.' + t.id, title: t.title + ' 도구', menu: '도구', keys: t.key, checked: () => view.tool === t.id, run: () => { view.tool = t.id; emit(); } }));
  addCmd({ id: 'view.fit', title: '화면에 맞추기', menu: '보기', keys: 'Ctrl+0', enabled: hasCanvas, run: fit });
  addCmd({ id: 'view.100', title: '실제 크기 (100%)', menu: '보기', keys: 'Ctrl+1', enabled: hasCanvas, run: () => zoomAt(1 / view.zoom) });
  addCmd({ id: 'view.in', title: '확대', menu: '보기', keys: 'Ctrl+=', enabled: hasCanvas, run: () => zoomAt(1.25) });
  addCmd({ id: 'view.out', title: '축소', menu: '보기', keys: 'Ctrl+-', enabled: hasCanvas, run: () => zoomAt(0.8) });
  addCmd({ id: 'layer.dup', title: '레이어 복제', menu: '레이어', keys: 'Ctrl+J', enabled: hasLayer, run: () => { const c = canvasOf(), l = layerOf(), n = { ...l, id: uid('l'), name: l.name + ' 복사', x: l.x + 20, y: l.y + 20 }; c.layers.splice(c.layers.indexOf(l) + 1, 0, n); state.project.sel = n.id; commit('레이어 복제'); } });
  addCmd({ id: 'layer.up', title: '레이어 위로', menu: '레이어', keys: 'Ctrl+]', enabled: hasLayer, run: () => moveLayer(1) });
  addCmd({ id: 'layer.down', title: '레이어 아래로', menu: '레이어', keys: 'Ctrl+[', enabled: hasLayer, run: () => moveLayer(-1) });
  addCmd({ id: 'layer.delete', title: '레이어 지우기', menu: '레이어', keys: 'Delete', enabled: hasLayer, run: () => { const c = canvasOf(); c.layers = c.layers.filter(l => l.id !== state.project.sel); state.project.sel = null; commit('레이어 지우기'); } });
  addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) { view.space = true; if (cv) cv.dataset.tool = 'hand'; e.preventDefault(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') { view.space = false; if (cv) cv.dataset.tool = view.tool; } });
  addEventListener('paste', e => { const fs = [...(e.clipboardData || {}).files || []]; if (fs.length && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) importFiles(fs, { toCanvas: true }); });
}
