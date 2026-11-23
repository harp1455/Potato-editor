// 명령: 모든 기능은 여기에 이름을 올려요. 메뉴·우클릭·명령 찾기·단축키가 전부 이 목록에서 만들어져서
// '메뉴에 없어서 못 찾는 기능'이 생기지 않아요.
import { settings } from './settings.js';

const list = new Map();

export function addCmd(c) {
  // c = { id, title, menu: '파일' | null, group, keys: 'Ctrl+O', run, enabled?, checked?, hint? }
  list.set(c.id, c);
  return c;
}
export const cmds = () => [...list.values()];
export const cmd = id => list.get(id);
export const keysOf = id => { const k = settings.get('keys')[id]; return k === undefined ? (list.get(id) || {}).keys || '' : k; };
export const canRun = c => !c.enabled || !!c.enabled();

export function run(id, arg) {
  const c = list.get(id);
  if (!c || !canRun(c)) return false;
  try { const r = c.run(arg); if (r && r.catch) r.catch(reportErr); } catch (e) { reportErr(e); }
  return true;
}

let onErr = e => console.error(e);
export const setErrHandler = f => { onErr = f; };
function reportErr(e) { onErr(e); }

// 키 이름을 한 가지 모양으로: 'Ctrl+Shift+Z'
export function keyName(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
  let k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (e.code === 'Space') k = 'Space';
  if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k;
}

export function handleKey(e) {
  const t = e.target;
  // 글자를 적는 칸에서만 단축키를 쉬어요. 슬라이더·체크 상자·고르는 칸을 만진 뒤에도 단축키는 그대로 들어요
  const typing = t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|color|button|file)$/.test(t.type)));
  const name = keyName(e);
  if (!name) return false;
  if (typing && !/^Ctrl\+|^F\d/.test(name)) return false;
  if (typing && /^Ctrl\+(Z|Y|A|C|V|X|Shift\+Z)$/.test(name)) return false;
  const room = settings.get('room'), own = { tool: 'image', layer: 'image', sel: 'image', video: 'video', cut: 'cut' };
  for (const c of list.values()) {
    const r = own[c.id.split('.')[0]]; if (r && r !== room) continue;   // 작업실 전용 단축키는 그 작업실에서만
    if (keysOf(c.id) === name && canRun(c)) { e.preventDefault(); run(c.id); return true; }
  }
  return false;
}
