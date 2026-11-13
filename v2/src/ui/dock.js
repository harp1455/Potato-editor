// 패널 배치: 왼쪽·오른쪽·아래 세 자리에 패널을 탭으로 붙여요. 탭을 끌어 다른 자리로 옮기고, 경계를 끌어 넓이를 바꿔요.
// '작업실 나누기'는 작업실마다 배치를 따로 기억하고, '한 화면에 모두'는 배치 하나만 써요. 둘 다 이 파일 하나로 돌아가요.
import { h, clamp, drag } from './dom.js';
import { settings } from '../core/settings.js';
import { PANELS } from './panels.js';

const ZONES = ['left', 'right', 'bottom'];
const BASE = {
  image: { left: ['media'], right: ['layers', 'props', 'history'], bottom: [] },
  other: { left: ['media'], right: ['history', 'jobs'], bottom: [] },
  single: { left: ['media', 'history'], right: ['layers', 'props', 'jobs'], bottom: [] },
};
const SIZE = { left: 232, right: 272, bottom: 180 };

const keyOf = () => settings.get('layoutMode') === 'single' ? 'single' : 'room:' + settings.get('room');
function fresh() {
  const b = settings.get('layoutMode') === 'single' ? BASE.single : (BASE[settings.get('room')] || BASE.other);
  const L = {}; ZONES.forEach(z => { L[z] = { tabs: [...b[z]], active: b[z][0] || null, size: SIZE[z] }; });
  return L;
}
export function layout() {
  const all = settings.get('layouts'), L = all[keyOf()];
  if (L && ZONES.every(z => L[z] && Array.isArray(L[z].tabs))) { ZONES.forEach(z => { L[z].tabs = L[z].tabs.filter(id => PANELS[id]); }); return L; }
  return fresh();
}
function save(L) { settings.set('layouts', { ...settings.get('layouts'), [keyOf()]: L }); }
export function resetLayout() { const all = { ...settings.get('layouts') }; delete all[keyOf()]; settings.set('layouts', all); }
export const hasPanel = id => ZONES.some(z => layout()[z].tabs.includes(id));
export function togglePanel(id) {
  const L = layout(); let found = false;
  ZONES.forEach(z => { const i = L[z].tabs.indexOf(id); if (i >= 0) { found = true; L[z].tabs.splice(i, 1); if (L[z].active === id) L[z].active = L[z].tabs[0] || null; } });
  if (!found) { const home = ZONES.find(z => fresh()[z].tabs.includes(id)) || 'right'; L[home].tabs.push(id); L[home].active = id; }
  save(L);
}
function movePanel(id, to, before) {
  const L = layout();
  ZONES.forEach(z => { const i = L[z].tabs.indexOf(id); if (i >= 0) { L[z].tabs.splice(i, 1); if (L[z].active === id) L[z].active = L[z].tabs[0] || null; } });
  const i = before ? L[to].tabs.indexOf(before) : -1;
  if (i >= 0) L[to].tabs.splice(i, 0, id); else L[to].tabs.push(id);
  L[to].active = id; save(L);
}

let dragging = null;
const bodies = {};

export function renderDock(work, center) {
  const L = layout();
  const zone = z => {
    const Z = L[z];
    const el = h('section.zone.' + z + (Z.tabs.length ? '' : '.empty'), { 'data-zone': z, 'aria-label': { left: '왼쪽 패널', right: '오른쪽 패널', bottom: '아래 패널' }[z] });
    el.style.setProperty('--size', Z.size + 'px');
    const bar = h('div.zone-tabs', { role: 'tablist' });
    Z.tabs.forEach(id => bar.append(h('button.zone-tab' + (id === Z.active ? '.on' : ''), {
      role: 'tab', 'aria-selected': String(id === Z.active), draggable: 'true', 'data-panel': id, title: '끌어서 다른 자리로 옮길 수 있어요',
      onclick: () => { Z.active = id; save(L); },
      ondragstart: e => { dragging = id; e.dataTransfer.setData('application/x-potato-panel', id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => work.classList.add('dragging-panel')); },
      ondragend: () => { dragging = null; work.classList.remove('dragging-panel'); },
    }, PANELS[id].title)));
    const body = h('div.zone-body', { role: 'tabpanel' });
    bodies[z] = { el: body, id: Z.active };
    el.append(bar, body, h('div.zone-drop', null, '여기에 놓기'));
    el.addEventListener('dragover', e => { if (dragging) { e.preventDefault(); el.classList.add('over'); } });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
    el.addEventListener('drop', e => { if (!dragging) return; e.preventDefault(); const t = e.target.closest('.zone-tab'); movePanel(dragging, z, t && t.dataset.panel !== dragging ? t.dataset.panel : null); });
    return el;
  };
  const split = (z, dir) => h('div.split.' + dir + (L[z].tabs.length ? '' : '.empty'), {
    role: 'separator', 'aria-orientation': dir === 'v' ? 'vertical' : 'horizontal', title: '끌어서 넓이 바꾸기',
    onpointerdown: e => {
      const s0 = L[z].size, el = work.querySelector('.zone.' + z);
      drag(e, ev => {
        const d = z === 'left' ? ev.clientX - e.clientX : z === 'right' ? e.clientX - ev.clientX : e.clientY - ev.clientY;
        L[z].size = clamp(s0 + d, 160, z === 'bottom' ? 480 : 520); el.style.setProperty('--size', L[z].size + 'px'); dispatchEvent(new Event('resize'));
      }, () => save(L));
    },
  });
  work.replaceChildren(zone('left'), split('left', 'v'), h('div.mid', null, center, split('bottom', 'h'), zone('bottom')), split('right', 'v'), zone('right'));
  updatePanels(true);
}

export function updatePanels(force) {
  for (const z of ZONES) {
    const b = bodies[z]; if (!b || !b.id || !b.el.isConnected) continue;
    // 글자를 적고 있는 중에는 다시 그리지 않아요 (적던 칸이 사라지지 않게)
    const a = document.activeElement;
    if (!force && a && b.el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) continue;
    const top = b.el.scrollTop; b.el.replaceChildren(); PANELS[b.id].render(b.el); b.el.scrollTop = top;
  }
}
