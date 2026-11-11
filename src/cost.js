/* ================= API 사용 금액: 가격표 · 작업 전 예상 · 작업마다 쓴 토큰·금액 기록 ================= */
// 제미나이를 부르는 일(페이지 번역, AI 번역·다듬기, AI 더빙, AI 영상)을 '작업' 하나로 묶어
// 시작 전에 예상 금액을 보여 주고, 끝나면 제미나이가 알려 준 실제 토큰 수로 금액을 계산해 기록해요.
// 금액은 구글이 공개한 표준(유료) 요금으로 계산한 값이에요. 무료 사용량 안이면 실제 청구는 0원이에요.
const API_PRICES = [ // [모델 이름, [[이날까지(그날 포함), 입력, 출력, 캐시 입력] …], 마지막 칸 = 그 뒤로 계속] · 100만 토큰당 달러
  [/^gemini-4-carbon/, [['2026-11-30', 2, 10, 0.1], [null, 4, 20, 0.2]]],
  [/^gemini-4-argon/, [['2026-11-30', 2, 10, 0.1], [null, 4, 20, 0.2]]],
  [/^gemini-3\.8-flash-lite-tts/, [['2026-12-31', 0.5, 6], [null, 1, 12]]],
  [/^gemini-3\.8-flash-tts/, [['2026-12-31', 0.5, 9], [null, 1, 18]]],
  [/^gemini-3\.[678]-flash(?!-lite)/, [['2026-12-31', 0.75, 3.75, 0.075], [null, 1.5, 7.5, 0.15]]],
  [/^gemini-3\.1-pro/, [[null, 2, 12, 0.2]]],
  [/^gemini-3\.5-flash-lite/, [[null, 0.3, 2.5, 0.03]]],
  [/^gemini-3\.5-flash/, [[null, 1.5, 9, 0.15]]],
  [/^gemini-2\.5-pro/, [[null, 1.25, 10, 0.125]]],
  [/^gemini-2\.5-flash-lite/, [[null, 0.1, 0.4, 0.01]]],
  [/^gemini-2\.5-flash/, [[null, 0.3, 2.5, 0.03]]],
  [/^gemini-omni/, [[null, 1.5, 17.5]]], // 영상 출력: 720p 1초 = 5,792토큰 (약 0.1달러)
];
const API_VID_TOK = { '360p': 5792 / 3, '720p': 5792, '1080p': 5792 * 1.5 }; // 영상 1초당 출력 토큰
const API_KINDS = { tr: '페이지 번역', tx: 'AI 번역·다듬기', dub: 'AI 더빙', vid: 'AI 영상', etc: '기타' };
const apiCfg = { krw: 1340 };
try { Object.assign(apiCfg, JSON.parse(localStorage.getItem('potatoApiCfg') || '{}')); } catch (_) { }
let apiLog = [];
try { apiLog = JSON.parse(localStorage.getItem('potatoApiLog') || '[]'); if (!Array.isArray(apiLog)) apiLog = []; } catch (_) { apiLog = []; }
let apiSaveT = 0;
const apiPersist = () => { clearTimeout(apiSaveT); apiSaveT = setTimeout(() => { try { if (apiLog.length > 3000) apiLog.splice(0, apiLog.length - 3000); localStorage.setItem('potatoApiLog', JSON.stringify(apiLog)); } catch (_) { } }, 250); };

/* ---- 가격 ---- */
const apiDay = t => { const d = new Date(t || Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function apiRate(model, at) {
  const P = API_PRICES.find(p => p[0].test(String(model || ''))); if (!P) return null;
  const day = apiDay(at), r = P[1].find(x => !x[0] || day <= x[0]) || P[1][P[1].length - 1];
  return { in: r[1], out: r[2], ca: r[3] ?? r[1] * 0.1, until: r[0], next: P[1][P[1].indexOf(r) + 1] || null };
}
// u = { in(입력, 캐시 포함), out(출력), th(생각), ca(캐시 입력) } → 달러 (가격을 모르면 null)
function apiCost(model, u, at) {
  const r = apiRate(model, at); if (!r) return null;
  const ca = Math.min(u.ca || 0, u.in || 0);
  return (((u.in || 0) - ca) * r.in + ca * r.ca + ((u.out || 0) + (u.th || 0)) * r.out) / 1e6;
}
const apiNum = n => Math.round(n || 0).toLocaleString('ko-KR');
function apiWon(usd) { const w = usd * (+apiCfg.krw || 1340); return w < 1 ? '1원 미만' : w < 10 ? `${w.toFixed(1)}원` : `${apiNum(w)}원`; }
function apiFmt(usd, plain) {
  if (usd == null || !isFinite(usd)) return '가격 모름';
  if (usd === 0) return '0원';
  const d = usd < 0.01 ? usd.toFixed(4) : usd < 1 ? usd.toFixed(3) : usd.toFixed(2);
  return plain ? `$${d}` : `약 ${apiWon(usd)} ($${d})`;
}
function apiModelLabel(id) {
  const r = apiRate(id); if (!r) return id;
  return /tts/.test(id) ? `${id} · 음성 1분 약 ${apiWon(60 * 25 * r.out / 1e6)}` : /omni/.test(id) ? `${id} · 720p 1초 약 $0.10` : `${id} · 100만 토큰 $${r.in}/$${r.out}`;
}
// 글 → 대략 토큰 수 (한글·일본어·한자는 한 글자에 약 1토큰, 나머지는 4글자에 1토큰)
function apiTok(s) {
  s = String(s || ''); let c = 0; const cjk = s.match(/[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-鿿가-힯豈-﫿]/g);
  if (cjk) c = cjk.length; return Math.ceil(c + (s.length - c) / 4);
}
// 말하는 데 걸리는 시간 (초, 대략)
function apiSpeechSec(s) {
  s = String(s || '').replace(/<[^>]*>/g, ' '); const cjk = (s.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length, words = (s.replace(/[぀-ヿ㐀-鿿가-힯]/g, ' ').match(/[A-Za-z0-9']+/g) || []).length;
  const tags = (String(s).match(/<(short pause|long pause|laugh|sigh|cough)>/g) || []).length;
  return 0.5 + cjk / 6.5 + words / 2.6 + tags * 0.6;
}

/* ---- 작업 기록 ---- */
function apiPj() {
  try { const id = (typeof gifOpen === 'function' && gifOpen()) ? gifPj : edPj, P = pjGet(id); if (P) return { id: P.id, name: P.name }; } catch (_) { }
  return { id: '', name: '(작업 탭 없음)' };
}
// 지난 기록으로 예상을 맞춰요 (같은 종류·모델의 최근 8번: 실제 ÷ 예상의 가운데값)
function apiAdj(kind, model, usd) {
  if (usd == null) return { usd: null, n: 0 };
  const R = apiLog.filter(j => j.kind === kind && j.model === model && j.st === 'ok' && j.est > 0 && j.usd > 0 && !j.guess).slice(-8).map(j => j.usd / j.est).sort((a, b) => a - b);
  if (R.length < 2) return { usd, n: 0 };
  return { usd: usd * clamp(R[R.length >> 1], 0.3, 4), n: R.length };
}
function apiEstText(kind, model, usd, extra) {
  const a = apiAdj(kind, model, usd);
  if (a.usd == null) return `예상 금액: 이 모델은 가격을 몰라요${extra ? ' · ' + extra : ''}`;
  return `예상 ${apiFmt(a.usd)}${a.n ? ` · 지난 ${a.n}번 기록으로 맞춘 값` : ' · 대략'}${extra ? ' · ' + extra : ''}`;
}
function apiJob(kind, label, model, est) {
  const pj = apiPj(), j = { id: uid(), at: Date.now(), kind, label, pj: pj.id, pjn: pj.name, model, est: est == null ? null : apiAdj(kind, model, est).usd, in: 0, out: 0, th: 0, ca: 0, usd: 0, calls: 0, st: 'run', parts: {} };
  apiLog.push(j); apiPersist(); return j;
}
function apiSum(j) {
  let i = 0, o = 0, t = 0, c = 0, usd = 0, unk = false, real = 0, guess = false;
  for (const k in j.parts) {
    const p = j.parts[k]; i += p.in || 0; o += p.out || 0; t += p.th || 0; c += p.ca || 0; if (p.g) guess = true; else real++;
    const v = apiCost(p.m || j.model, p, j.at); if (v == null) unk = true; else usd += v;
  }
  Object.assign(j, { in: i, out: o, th: t, ca: c, usd: unk && !usd ? null : usd, calls: Object.keys(j.parts).length, real, guess });
}
// 답에서 토큰 사용량 찾기 (generateContent의 usageMetadata, Interactions의 usage 등 모양이 달라도)
function apiUsage(o, d = 0) {
  if (!o || typeof o !== 'object' || d > 4) return null;
  for (const k of ['usageMetadata', 'usage_metadata', 'usage']) {
    const u = o[k]; if (!u || typeof u !== 'object') continue;
    const g = (...ks) => { for (const x of ks) if (typeof u[x] === 'number') return u[x]; return null; };
    const inp = g('promptTokenCount', 'total_input_tokens', 'input_tokens', 'prompt_tokens', 'inputTokens', 'totalInputTokens');
    let out = g('candidatesTokenCount', 'total_output_tokens', 'output_tokens', 'completion_tokens', 'outputTokens', 'totalOutputTokens');
    const th = g('thoughtsTokenCount', 'total_thought_tokens', 'thought_tokens', 'reasoning_tokens', 'thoughtTokens', 'totalThoughtTokens') || 0;
    const ca = g('cachedContentTokenCount', 'total_cached_tokens', 'cached_tokens', 'cachedTokens') || 0, tool = g('toolUsePromptTokenCount', 'total_tool_use_tokens') || 0;
    const tot = g('totalTokenCount', 'total_tokens', 'totalTokens');
    if (out == null && tot != null && inp != null) out = Math.max(0, tot - inp - th - tool);
    if (inp == null && out == null) continue;
    return { in: (inp || 0) + tool, out: out || 0, th, ca };
  }
  for (const k of ['response', 'interaction', 'result']) { const r = apiUsage(o[k], d + 1); if (r) return r; }
  return null;
}
let apiCallN = 0;
// trHttp가 답을 받을 때마다 불러요. 같은 Interactions id는 마지막 답의 사용량으로 바꿔 써요 (두 번 세지 않게)
function apiSeen(job, model, j) {
  const u = apiUsage(j); if (!u) return false;
  if (!job) { job = apiJob('etc', '기타 요청', model, null); job.st = 'ok'; }
  const key = (j && j.id) ? 'i:' + j.id : 'c' + (++apiCallN);
  const prev = job.parts[key];
  job.parts[key] = Object.assign({ m: model || (prev && prev.m) || job.model }, u);
  apiSum(job); apiPersist(); return true;
}
// 답에 사용량이 없을 때 대신 넣는 추정치 (더빙 길이·영상 길이로)
function apiGuess(job, model, u) { if (!job) return; job.parts['g' + (++apiCallN)] = Object.assign({ m: model, g: 1 }, u); apiSum(job); apiPersist(); }
function apiEnd(job, st) { if (!job) return null; apiSum(job); job.st = st || 'ok'; job.end = Date.now(); if (!job.calls && st !== 'ok') job.usd = 0; apiPersist(); if (typeof apiRefresh === 'function') apiRefresh(); return job; }
const apiUsed = j => j && j.calls ? ` · 이번에 쓴 금액 ${apiFmt(j.usd)}${j.guess ? '(추정)' : ''}` : '';
// 작업에 쓸 tk (멈추기·진행 표시는 원래 tk 것을 그대로)
const apiTk = (tk, job) => ({ get stop() { return !!(tk && tk.stop); }, set stop(v) { if (tk) tk.stop = v; }, set: (...a) => tk && tk.set && tk.set(...a), done: () => tk && tk.done && tk.done(), job });

/* ---- 작업별 예상 ---- */
// 페이지 번역: 그림 조각마다 (그림 1,120토큰 + 지시문) 입력, (번역 JSON + 생각) 출력
function apiEstTr(model, pages, o) {
  let inp = 0, out = 0; const pre = 1900 + apiTok((o && o.gloss) || '') + apiTok((o && o.notes) || '') + (o && o.ctx ? 500 : 0);
  for (const p of pages) {
    const W = Math.max(1, p.w || 800), H = Math.max(1, p.h || 1200), tH = W * 1.6;
    const n = H <= tH * 1.15 ? 1 : Math.ceil((H - tH) / (tH * 0.82)) + 1;
    inp += n * (1120 + pre); out += n * 2600;
  }
  return apiCost(model, { in: inp, out });
}
function apiEstTx(model, texts, ctx) {
  const t = texts.reduce((a, s) => a + apiTok(s), 0), chunks = Math.max(1, Math.ceil(texts.length / 120));
  return apiCost(model, { in: chunks * 700 + t * 1.15 + apiTok(ctx || ''), out: t * 1.9 + chunks * 1300 });
}
function apiEstDub(model, lines) { // lines = [{ text, style }]
  let inp = 0, out = 0; for (const l of lines) { inp += 30 + apiTok(l.text) + apiTok(l.style); out += apiSpeechSec(l.text) * 25; }
  return apiCost(model, { in: inp, out });
}
const apiEstVid = (model, res, sec) => apiCost(model, { in: 1500, out: sec * (API_VID_TOK[res] || 5792) });

/* ---- 내역 창 ---- */
let apiRefresh = null;
function apiCsv(list) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['날짜', '작업 탭', '종류', '내용', '모델', '예상(달러)', '실제(달러)', '입력 토큰', '출력 토큰', '생각 토큰', '캐시 토큰', '요청 수', '상태']];
  for (const j of list) rows.push([new Date(j.at).toLocaleString('ko-KR'), j.pjn, API_KINDS[j.kind] || j.kind, j.label, j.model, j.est == null ? '' : j.est.toFixed(5), j.usd == null ? '' : j.usd.toFixed(5), j.in, j.out, j.th, j.ca, j.calls, j.st]);
  return new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
}
function apiOpenLog() {
  let fPj = '', fKind = '';
  const m = modal(`<h2>API 사용 내역 (제미나이)</h2><p class="sub">제미나이를 쓴 작업마다 시작 전 예상 금액과 실제로 쓴 토큰·금액을 적어 둬요. 이 컴퓨터에만 저장돼요.</p>
    <div class="apisum" id="apiSum"></div>
    <div class="apifil"><label>작업 탭 <select id="apiPj"></select></label><label>종류 <select id="apiKind"><option value="">모두</option>${Object.entries(API_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <span class="flex1"></span><label title="원화로 바꿀 때 쓰는 값">환율 1달러 = <input type="number" id="apiKrw" min="500" max="3000" step="10" value="${+apiCfg.krw || 1340}" style="width:74px">원</label></div>
    <div class="apiby" id="apiBy"></div>
    <div class="apitbl" id="apiTbl"></div>
    <details class="sec" style="margin-top:8px"><summary>가격표 (100만 토큰당, 구글 표준 요금)</summary><div class="body" id="apiPrice"></div></details>
    <p class="muted small" style="margin:8px 0 0">실제 금액은 제미나이가 답과 함께 알려 준 토큰 수(생각 토큰은 출력 요금)에 가격표를 곱한 값이에요. 무료 사용량 안이거나 결제를 연결하지 않은 키면 실제 청구는 0원이고, 정확한 청구는 Google AI Studio의 사용량·결제 화면이 기준이에요. '추정'은 답에 토큰 수가 없어 소리·영상 길이로 계산한 값이에요.</p>
    <div class="foot"><button class="btn" id="apiClear">기록 지우기</button><button class="btn" id="apiCsvB">CSV로 저장</button><span class="flex1"></span><button class="btn primary" data-close>닫기</button></div>`, { wide: true });
  m.style.width = 'min(1060px, 100%)';
  const sum = list => list.reduce((a, j) => { a.n++; if (j.est != null) a.est += j.est; if (j.usd != null) a.usd += j.usd; a.in += j.in || 0; a.out += (j.out || 0) + (j.th || 0); return a; }, { n: 0, est: 0, usd: 0, in: 0, out: 0 });
  const kindName = j => API_KINDS[j.kind] || j.kind;
  const stName = { ok: '', stop: '멈춤', fail: '실패', run: '진행 중' };
  const draw = () => {
    if (!m.isConnected) { apiRefresh = null; return; }
    const pjs = [...new Map(apiLog.map(j => [j.pj || j.pjn, j.pjn])).entries()];
    $('#apiPj', m).innerHTML = `<option value="">모두</option>${pjs.map(([k, n]) => `<option value="${esc(k)}" ${k === fPj ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
    const L = apiLog.filter(j => (!fPj || (j.pj || j.pjn) === fPj) && (!fKind || j.kind === fKind));
    const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const S = [['오늘', sum(L.filter(j => j.at >= d0))], ['이번 달', sum(L.filter(j => j.at >= m0))], ['전체', sum(L)]];
    $('#apiSum', m).innerHTML = S.map(([t, s]) => `<div class="apicard"><span>${t}</span><b>${apiFmt(s.usd)}</b><small>작업 ${s.n}개 · 예상 ${apiFmt(s.est, true)} · 토큰 ${apiNum(s.in)} / ${apiNum(s.out)}</small></div>`).join('');
    const by = new Map(); for (const j of L) { const k = j.pjn || '(작업 탭 없음)'; if (!by.has(k)) by.set(k, []); by.get(k).push(j); }
    $('#apiBy', m).innerHTML = by.size ? `<table class="apit"><thead><tr><th>작업 탭</th><th>작업 수</th><th>예상</th><th>실제</th><th>입력 / 출력 토큰</th></tr></thead><tbody>${[...by.entries()].map(([k, a]) => { const s = sum(a); return `<tr><td>${esc(k)}</td><td>${s.n}</td><td>${apiFmt(s.est, true)}</td><td><b>${apiFmt(s.usd)}</b></td><td>${apiNum(s.in)} / ${apiNum(s.out)}</td></tr>`; }).join('')}</tbody></table>` : '';
    const rows = L.slice(-400).reverse();
    $('#apiTbl', m).innerHTML = rows.length ? `<table class="apit"><thead><tr><th>날짜</th><th>작업 탭</th><th>작업</th><th>모델</th><th>예상</th><th>실제</th><th title="입력 / 출력 / 생각">토큰</th></tr></thead><tbody>${rows.map(j => {
      const diff = j.est > 0 && j.usd != null && j.calls ? Math.round((j.usd / j.est - 1) * 100) : null;
      return `<tr class="${j.st === 'fail' ? 'bad' : ''}"><td class="nowrap">${new Date(j.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(j.pjn)}</td><td>${esc(kindName(j))}<br><small class="muted">${esc(j.label || '')}${stName[j.st] ? ` · ${stName[j.st]}` : ''}</small></td><td><small>${esc(j.model || '')}</small></td>
        <td class="nowrap">${apiFmt(j.est, true)}</td><td class="nowrap"><b>${j.calls ? apiFmt(j.usd, true) : '-'}</b>${j.guess ? '<small class="muted"> 추정</small>' : ''}${diff != null && Math.abs(diff) >= 5 ? `<br><small class="${diff > 0 ? 'up' : 'down'}">예상보다 ${Math.abs(diff)}% ${diff > 0 ? '많이' : '적게'}</small>` : ''}</td>
        <td class="nowrap"><small>${apiNum(j.in)} / ${apiNum(j.out)}${j.th ? ' / ' + apiNum(j.th) : ''}${j.calls > 1 ? `<br>요청 ${j.calls}번` : ''}</small></td></tr>`;
    }).join('')}</tbody></table>${L.length > 400 ? `<p class="muted small">최근 400개만 보여요. 전체는 CSV로 저장해 보세요.</p>` : ''}` : '<p class="muted" style="padding:16px 0">아직 기록이 없어요. 페이지 번역, AI 번역·다듬기, AI 더빙, AI 영상을 쓰면 여기에 쌓여요.</p>';
    const seen = new Set(), pr = [];
    for (const id of ['gemini-4-carbon', 'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-omni-1.1-flash']) {
      const r = apiRate(id); if (!r || seen.has(id)) continue; seen.add(id);
      pr.push(`<tr><td>${id}</td><td>$${r.in}</td><td>$${r.out}</td><td>${r.until ? `${r.until}까지${r.next ? ` → 그 뒤 $${r.next[1]} / $${r.next[2]}` : ''}` : ''}</td></tr>`);
    }
    $('#apiPrice', m).innerHTML = `<table class="apit"><thead><tr><th>모델</th><th>입력</th><th>출력(생각 포함)</th><th>바뀌는 날</th></tr></thead><tbody>${pr.join('')}</tbody></table><p class="muted small">더빙은 음성 1초 = 25토큰, 영상은 720p 1초 = 5,792토큰(360p는 1/3, 1080p는 1.5배)으로 셈해요. Carbon·Argon·Omni는 무료 사용량이 없어요.</p>`;
  };
  apiRefresh = draw; draw();
  $('#apiPj', m).addEventListener('change', e => { fPj = e.target.value; draw(); });
  $('#apiKind', m).addEventListener('change', e => { fKind = e.target.value; draw(); });
  $('#apiKrw', m).addEventListener('input', e => { const v = +e.target.value; if (v >= 500 && v <= 3000) { apiCfg.krw = v; try { localStorage.setItem('potatoApiCfg', JSON.stringify(apiCfg)); } catch (_) { } draw(); } });
  $('#apiCsvB', m).addEventListener('click', async () => { if (!apiLog.length) return; if (await download(apiCsv(apiLog), `API 사용 내역 ${apiDay()}.csv`)) toast('CSV로 저장했어요'); });
  $('#apiClear', m).addEventListener('click', e => {
    const b = e.currentTarget; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = '정말 지울까요? 한 번 더 누르세요'; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = '기록 지우기'; } }, 4000); return; }
    apiLog = apiLog.filter(j => j.st === 'run'); apiPersist(); b.dataset.sure = ''; b.textContent = '기록 지우기'; draw(); toast('사용 내역을 지웠어요');
  });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-apilog]'); if (b) { e.preventDefault(); apiOpenLog(); } });
