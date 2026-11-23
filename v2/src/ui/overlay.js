// 위에 뜨는 것들: 메뉴, 대화 창, 알림, 명령 찾기
import { logErr, takeDetail } from '../core/errlog.js';
import { h, icon, fmtKeys } from './dom.js';
import { cmds, canRun, keysOf, run } from '../core/cmd.js';
import { hold } from '../core/store.js';

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
  if (owner || lastKeyboard) { const first = m.querySelector('.menu-item:not(:disabled)'); if (first) first.focus({ preventScroll: true }); }
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
// 메뉴는 어디에 초점이 있든 Esc로 닫혀요. 키보드로 열었으면 첫 줄을 붙잡아 화살표로 고를 수 있어요
let lastKeyboard = false;
addEventListener('keydown', e => { lastKeyboard = true; if (e.key === 'Escape' && openMenu) { e.preventDefault(); e.stopPropagation(); closeMenu(); } }, true);
addEventListener('pointerdown', () => { lastKeyboard = false; }, true);
document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.contains(e.target) && !e.target.closest('.mb-item')) closeMenu(); }, true);
addEventListener('blur', closeMenu);

// ---- 알림 ----
let toastBox = null;
let onErrClick = null, whereFn = null;
export const setErrUi = (open, where) => { onErrClick = open; whereFn = where; };
const toastWhere = () => { try { return whereFn ? whereFn() : ''; } catch (_) { return ''; } };
export function toast(text, kind = '') {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  // 오류는 화면을 막지 않아요: 기록에 남기고, 짧은 알림만 잠깐 보여요. 알림을 누르면 오류 기록이 열려요
  if (kind === 'err') logErr(toastWhere(), text, takeDetail(text));
  const t = h('div.toast' + (kind ? '.' + kind : ''), kind === 'err' ? { role: 'button', tabindex: '0', title: '눌러서 오류 기록 보기', onclick: () => { t.remove(); if (onErrClick) onErrClick(); }, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); } } } : null, text);
  toastBox.append(t); while (toastBox.querySelectorAll('.toast.err').length > 3) toastBox.querySelector('.toast.err').remove();
  setTimeout(() => t.remove(), Math.min(12000, (kind === 'err' ? 5000 : 3200) + Math.max(0, String(text).length - 30) * 55));   // 긴 글은 읽을 시간을 더 줘요
}

// ---- 대화 창 ----
export function dialog({ title, body, buttons = [], wide = false, onClose, dismiss = true }) {
  const prev = document.activeElement;
  const box = h('div.dlg' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const back = h('div.dlg-back', null, box);
  const close = v => { if (!back.isConnected) return; back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); if (onClose) onClose(v); };
  const onKey = e => {
    const top = [...document.querySelectorAll('.dlg-back')].at(-1) === back; if (!top) return;   // 겹쳐 뜬 창은 맨 위 것만
    if (e.key === 'Escape' && dismiss) { e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === 'Tab') { const fs = [...box.querySelectorAll('button, input, select, textarea, [tabindex]')].filter(x => !x.disabled && x.tabIndex >= 0 && x.offsetParent !== null); if (!fs.length) return; const a = document.activeElement, first = fs[0], last = fs.at(-1); if (!box.contains(a) || (e.shiftKey && a === first) || (!e.shiftKey && a === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); } }
  };
  box.append(h('div.dlg-head', null, h('h2', null, title), dismiss && h('button.icon-btn', { title: '닫기', 'aria-label': '닫기', onclick: () => close() }, icon('close'))));
  box.append(h('div.dlg-body', null, body));
  if (buttons.length) box.append(h('div.dlg-foot', null, buttons.map(b => h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), { onclick: () => { if (!b.run || b.run() !== false) close(b.value); } }, b.label))));
  if (dismiss) back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  const f = box.querySelector('[autofocus]') || box.querySelector('.dlg-body input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), .dlg-body textarea') || box.querySelector('.btn.primary') || box.querySelector('button');
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

export const askText = (title, value = '', okLabel = '확인') => new Promise(res => {
  const i = h('input.text.wide', { type: 'text', value, 'aria-label': title, autofocus: true });
  let out = null;
  const d = dialog({ title, body: i, onClose: () => res(out), buttons: [{ label: '취소' }, { label: okLabel, primary: true, run: () => { out = i.value.trim() || null; } }] });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') { out = i.value.trim() || null; d.close(); } });
  i.focus(); i.select();
});

// 오래 걸리는 일의 진행 알림. set(글)으로 바꾸고 done(글)으로 끝내요.
export function busy(text) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div.toast.busy', null, text), free = hold(); toastBox.append(t);   // 도는 동안 되돌리기를 쉬어요
  return { set: s => { t.textContent = s; }, done: (s, kind) => { free(); t.remove(); if (s) toast(s, kind); } };
}
