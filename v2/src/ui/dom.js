// 화면을 만드는 작은 도구들
export function h(tag, props, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

// 선으로 그린 그림 글자. 굵기와 모서리를 한 가지로 맞춰서 직접 그렸어요 (16칸 기준).
const P = {
  image: 'M2.5 3.5h11v9h-11z M2.5 10.5l3.2-3 2.6 2.4 2-1.7 3.2 2.8 M10.6 6.2h.01',
  cut: 'M2.5 2.5h11v11h-11z M2.5 7.5h6 M8.5 2.5v11 M8.5 10h5',
  video: 'M2.5 4h11v8h-11z M5 4v8 M11 4v8 M2.5 6.7h2.5 M2.5 9.3h2.5 M11 6.7h2.5 M11 9.3h2.5',
  character: 'M8 2.2a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 0 0 0-3.2 M8 5.4v4.2 M8 6.8l-3.4 1.6 M8 6.8l3.4 1.6 M8 9.6l-2.2 4 M8 9.6l2.2 4',
  batch: 'M3 4.5h10 M3 8h10 M3 11.5h10 M1.8 4.5h.01 M1.8 8h.01 M1.8 11.5h.01',
  move: 'M8 2v12 M2 8h12 M8 2l-1.8 1.8 M8 2l1.8 1.8 M8 14l-1.8-1.8 M8 14l1.8-1.8 M2 8l1.8-1.8 M2 8l1.8 1.8 M14 8l-1.8-1.8 M14 8l-1.8 1.8',
  selRect: 'M2.5 3.5h2 M6.5 3.5h3 M11.5 3.5h2v2 M13.5 7.5v2 M13.5 11.5v1h-2 M9.5 12.5h-3 M4.5 12.5h-2v-2 M2.5 8.5v-3',
  selEllipse: 'M8 3c-3.3 0-5.5 2.2-5.5 5s2.2 5 5.5 5s5.5-2.2 5.5-5s-2.2-5-5.5-5',
  lasso: 'M8 2.5c-3.3 0-5.5 1.8-5.5 4c0 1.6 1.2 2.9 3 3.5 M8 2.5c3.300 0 5.5 1.800 5.5 4c0 2.200-2.200 4-5.500 4c-.700 0-1.400-.100-2-.200 M5.500 10c-1.100.300-1.800 1-1.800 1.800c0 1 .900 1.700 2 1.700c1.500 0 2.300-1.300 1.800-3.200',
  wand: 'M3 13l6.500-6.500 M9.500 6.500l1.500-1.500 M11.500 2v2 M10.500 3h2 M13.500 6v1.500 M12.750 6.750h1.500 M7 2.500v1.500 M6.250 3.250h1.500',
  magic: 'M2.500 13.500c1.500 0 2.500-.800 2.800-2.200l6.200-6.200a1.200 1.200 0 0 0-1.700-1.700l-6.200 6.200c-1.400.300-2.200 1.300-2.200 2.800 M12.500 9v2 M11.500 10h2 M13 12.500v1.500 M12.250 13.250h1.500',
  hand: 'M5.5 8.5v-4a1 1 0 0 1 2 0v3 M7.5 7.2v-4a1 1 0 0 1 2 0v4 M9.5 7.2v-3a1 1 0 0 1 2 0v5.3c0 2.5-1.6 4-3.8 4c-1.9 0-2.7-.8-3.6-2.3l-1.5-2.6a.9.9 0 0 1 1.5-1l1.4 1.6',
  zoom: 'M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9 M10.3 10.3l3.4 3.4',
  eye: 'M1.5 8s2.4-4.2 6.5-4.2s6.5 4.2 6.5 4.2s-2.4 4.2-6.5 4.2s-6.5-4.2-6.5-4.2 M8 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 0 0 0-3.6',
  eyeOff: 'M2 2.5l12 11 M4.3 5.3c-1.8 1.2-2.8 2.7-2.8 2.7s2.4 4.2 6.5 4.2c1 0 1.9-.2 2.7-.6 M6.6 3.9c.4-.1.9-.1 1.4-.1c4.1 0 6.5 4.2 6.5 4.2s-.6 1.1-1.8 2.2',
  lock: 'M4 7.5h8v6h-8z M5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2',
  plus: 'M8 3v10 M3 8h10',
  trash: 'M3 4.5h10 M6 4.5v-1.5h4v1.5 M4.2 4.5l.6 8.5h6.4l.6-8.5',
  up: 'M8 12.5v-9 M4.5 7l3.5-3.5l3.5 3.5',
  down: 'M8 3.5v9 M4.5 9l3.5 3.5l3.5-3.5',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9 M10.3 10.3l3.4 3.4',
  gear: 'M8 5.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 0 0 0-4.8 M8 1.8v1.7 M8 12.5v1.7 M1.8 8h1.7 M12.5 8h1.7 M3.6 3.6l1.2 1.2 M11.2 11.2l1.2 1.2 M12.4 3.6l-1.2 1.2 M4.8 11.2l-1.2 1.2',
  undo: 'M5.5 3.5l-3 3l3 3 M2.5 6.5h7a4 4 0 0 1 0 8h-3',
  redo: 'M10.5 3.5l3 3l-3 3 M13.5 6.5h-7a4 4 0 0 0 0 8h3',
  close: 'M4 4l8 8 M12 4l-8 8',
  folder: 'M2 4.5h4l1.2 1.5h6.8v7h-12z',
  folderPlus: 'M2 4.5h4l1.2 1.5h6.8v7h-12z M8 8v3.6 M6.2 9.8h3.6',
  folderIn: 'M2 4.5h4l1.2 1.5h6.8v7h-12z M8 7.6v4 M6.2 9.9l1.8 1.8l1.8-1.8',
  folderOut: 'M2 4.5h4l1.2 1.5h6.8v7h-12z M8 11.6v-4 M6.2 9.3l1.8-1.8l1.8 1.8',
  imagePlus: 'M2.5 3.5h8 M13.5 6.5v6h-11v-9 M2.5 10.5l3.2-3 2.6 2.4 2-1.7 3.2 2.8 M13 1.5v4 M11 3.5h4',
  save: 'M3 2.5h8l2.5 2.5v8.5h-10.5z M5.5 2.5v3.5h5v-3.5 M5.5 13.5v-4h5v4',
  export: 'M8 10.5v-8 M5 5.2l3-3l3 3 M3 9.5v4h10v-4',
  fit: 'M2.5 6v-3.5h3.5 M10 2.5h3.5v3.5 M13.5 10v3.5h-3.5 M6 13.5h-3.5v-3.5',
  chevron: 'M6 4l4 4l-4 4',
  panels: 'M2.5 3h11v10h-11z M6 3v10 M10.5 3v10',
  single: 'M2.5 3h11v10h-11z M2.5 6h11',
};
export function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('class', 'ic'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', P[name] || ''); s.append(p);
  return s;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const fmtKeys = k => k.replace(/\+/g, ' + ');

// 끌기: 누른 뒤 움직임과 놓기를 한곳에서
export function drag(e, onMove, onUp) {
  const el = e.currentTarget || e.target;
  try { el.setPointerCapture(e.pointerId); } catch (_) { /* 이미 놓은 포인터 */ }
  const mv = ev => onMove(ev);
  const up = ev => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (onUp) onUp(ev); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
