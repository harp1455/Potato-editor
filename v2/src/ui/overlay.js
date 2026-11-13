// 위에 뜨는 것들: 메뉴, 대화 창, 알림, 명령 찾기
import { h, icon, fmtKeys } from './dom.js';
import { cmds, canRun, keysOf, run } from '../core/cmd.js';

let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.querySelectorAll('.mb-item.on').forEach(b => b.classList.remove('on')); } }

// items: [{ label, keys, run, disabled, checked } | '-' | { head }]
export function showMenu(items, x, y, owner) {
  closeMenu();
  const m = h('div.menu', { role: 'menu' });
  items.forEach(it => {
    if (it === '-') return m.append(h('div.menu-sep'));
    if (it.head) return m.append(h('div.menu-head', null, it.head));
    const b = h('button.menu-item', { role: 'menuitem', disabled: !!it.disabled, onclick: () => { closeMenu(); it.run(); } },
      h('span.menu-check', null, it.checked ? '✓' : ''), h('span.menu-label', null, it.label), h('span.menu-keys', null, it.keys ? fmtKeys(it.keys) : ''));
    m.append(b);
  });
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  m.addEventListener('keydown', e => {
    const bs = [...m.querySelectorAll('.menu-item:not(:disabled)')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (bs[i + 1] || bs[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (bs[i - 1] || bs[bs.length - 1]).focus(); }
    else if (e.key === 'Escape') { closeMenu(); if (owner) owner.focus(); }
  });
  openMenu = m;
  return m;
}
export const cmdItem = c => ({ label: c.title, keys: keysOf(c.id), run: () => run(c.id), disabled: !canRun(c), checked: c.checked && c.checked() });
document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.mb-item')) closeMenu(); }, true);
addEventListener('blur', closeMenu);

// ---- 알림 ----
let toastBox = null;
export function toast(text, kind = '') {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div.toast' + (kind ? '.' + kind : ''), null, text);
  toastBox.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3200);
}

// ---- 대화 창 ----
export function dialog({ title, body, buttons = [], wide = false, onClose, dismiss = true }) {
  const prev = document.activeElement;
  const box = h('div.dlg' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const back = h('div.dlg-back', null, box);
  const close = v => { back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); if (onClose) onClose(v); };
  const onKey = e => { if (e.key === 'Escape' && dismiss) { e.stopPropagation(); close(); } };
  box.append(h('div.dlg-head', null, h('h2', null, title), dismiss && h('button.icon-btn', { title: '닫기', 'aria-label': '닫기', onclick: () => close() }, icon('close'))));
  box.append(h('div.dlg-body', null, body));
  if (buttons.length) box.append(h('div.dlg-foot', null, buttons.map(b => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), { onclick: () => { if (!b.run || b.run() !== false) close(b.value); } }, b.label))));
  if (dismiss) back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  const f = box.querySelector('[autofocus], .btn.primary, input, button');
  if (f) f.focus();
  return { el: box, close };
}
export const confirmBox = (title, text, okLabel = '확인', danger = false) => new Promise(res => {
  dialog({ title, body: h('p.dlg-text', null, text), onClose: v => res(!!v), buttons: [{ label: '취소' }, { label: okLabel, primary: !danger, danger, value: true }] });
});

// ---- 명령 찾기 (Ctrl+K) ----
export function palette() {
  const input = h('input.pal-input', { type: 'text', placeholder: '하고 싶은 일을 적어 보세요. 예: 내보내기, 화면 방식', 'aria-label': '명령 찾기' });
  const listEl = h('div.pal-list', { role: 'listbox' });
  let items = [], at = 0;
  const d = dialog({ title: '명령 찾기', body: h('div.pal', null, input, listEl) });
  d.el.classList.add('pal-dlg');
  const draw = () => {
    const q = input.value.trim().toLowerCase().replace(/\s+/g, '');
    items = cmds().filter(c => c.title && (!q || (c.title + (c.menu || '') + (c.words || '')).toLowerCase().replace(/\s+/g, '').includes(q)));
    items.sort((a, b) => (canRun(b) ? 1 : 0) - (canRun(a) ? 1 : 0));
    at = Math.min(at, Math.max(0, items.length - 1));
    listEl.replaceChildren(...items.map((c, i) => h('button.pal-item' + (i === at ? '.on' : ''), { role: 'option', disabled: !canRun(c), onclick: () => { d.close(); run(c.id); } },
      h('span.pal-menu', null, c.menu || ''), h('span.pal-title', null, c.title), h('span.menu-keys', null, fmtKeys(keysOf(c.id))))));
    if (!items.length) listEl.append(h('p.empty', null, '맞는 명령이 없어요. 다른 말로 찾아보세요.'));
    const on = listEl.querySelector('.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => { at = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(items.length - 1, at + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
    else if (e.key === 'Enter' && items[at] && canRun(items[at])) { d.close(); run(items[at].id); }
  });
  draw(); input.focus();
}
