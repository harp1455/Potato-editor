// 오류 기록: 오류나 거절이 생기면 화면을 막지 않고 여기에 남겨요 (가장 새것 400개, 이 컴퓨터에만).
const KEY = 'potato2.errlog';
let last = '', lastAt = 0;
export function errLog() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } }
export function errClear() { try { localStorage.removeItem(KEY); } catch (_) { /* 건너뜀 */ } }
// where = 어디서(기능 이름), msg = 화면에 보인 말, detail = 서버가 준 말·코드 등
export function logErr(where, msg, detail) {
  const m = String(msg || '').slice(0, 600), now = Date.now(); if (!m) return;
  if (m === last && now - lastAt < 1500) return; last = m; lastAt = now;   // 같은 말이 연달아 오면 한 번만
  const row = { t: now, where: String(where || ''), msg: m, detail: String(detail || '').slice(0, 1500), ver: typeof __VERSION__ === 'string' ? __VERSION__ : '' };
  try { localStorage.setItem(KEY, JSON.stringify([row, ...errLog()].slice(0, 400))); } catch (_) { /* 저장 공간이 막혀 있으면 건너뜀 */ }
}
export function errText(rows = errLog()) {
  const p2 = n => String(n).padStart(2, '0'), when = t => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
  return ['감자 편집기 2 오류 기록', `만든 때: ${when(Date.now())}`, `브라우저: ${navigator.userAgent}`, '', ...rows.map(r => `[${when(r.t)}] ${r.ver ? '(' + r.ver + ') ' : ''}${r.where ? r.where + ': ' : ''}${r.msg}${r.detail ? '\n    자세히: ' + r.detail.replace(/\n/g, '\n    ') : ''}`)].join('\n');
}
// API 오류(ApiError)가 만들어질 때 자세한 내용을 붙여 두면, 뒤따르는 화면 알림과 합쳐서 한 줄로 남겨요
let pending = null;
export function noteDetail(code, message, detail) { pending = { code, message, detail, at: Date.now() }; }
export function takeDetail(msg) { if (pending && Date.now() - pending.at < 4000 && String(msg).includes(String(pending.message).slice(0, 20))) { const p = pending; pending = null; return `${p.code}${p.detail ? ' / ' + p.detail : ''}`; } return ''; }
