/* ================= 일괄 처리 (동작 기록) — 이미지 편집 ================= */
// 한 그림에서 한 일을 기록해 두었다가 다른 그림들에 똑같이 해요.
// 기록되는 것: 돌리기·뒤집기·자르기·크기 바꾸기, AI 배경 지우기·화질 키우기, 자동 흰칠,
//   바탕 그림 보정(기본·고급 보정, 필터, 흐림 등), 새로 올린 글자·말풍선·효과음·도형·보정 레이어
// 그림마다 다른 것(칠한 마스크, AI 지우개, 뒤틀기, 색감 맞추기, 수평)은 기록하지 않아요.
let bxRec = null, bxRun = null;
const BX_KEY = 'potatoActions';
const bxActs = () => { try { return JSON.parse(localStorage.getItem(BX_KEY) || '[]'); } catch (_) { return []; } };
const bxActsSave = a => { try { localStorage.setItem(BX_KEY, JSON.stringify(a)); return true; } catch (_) { toast('저장할 자리가 모자라요. 안 쓰는 동작을 지워 주세요'); return false; } };
const BX_BASE_SKIP = new Set(['id', 'type', 'img', 'x', 'y', 'w', 'h', 'rot', 'flip', 'lock', 'st0', 'straight', 'name', 'cm', 'cmA', 'cmRef', 'lmask', 'hidden', 'layers', 'gid', 'inPanel']);
const bxPortable = e => !e.lock && !e.inPanel && (['text', 'bubble', 'stamp', 'shape', 'tmpl', 'draw'].includes(e.type) || (e.type === 'panel' && (e.adjL || (e.fill && e.pass))));
const bxHash = () => hstr(JSON.stringify(page()));
function bxStart() {
  const p = page(); if (!isImg() || !p || p.ph) { toast('이미지 편집에서 그림을 연 뒤 기록해 주세요'); return; }
  const B = baseEl(p);
  bxRec = { pid: p.id, w: p.w, h: p.h, base: B ? clone(B) : null, ids: new Set(p.els.map(e => e.id)), ops: [], popped: [] };
  bxPill(); renderProps();
  toast('기록을 시작했어요. 이 그림에서 평소처럼 고친 뒤 위쪽 \'기록 끝내기\'를 누르세요', 4200);
}
// 기록 중에 한 일 (각 기능에서 불러요). 다른 그림에서 한 일은 빼요
function bxNote(op) {
  if (!bxRec || bxRun || !isImg() || page().id !== bxRec.pid) return;
  bxRec.ops.push({ ...op, after: bxHash() }); bxRec.popped = []; bxPill();
}
// 되돌리기·다시 하기: 방금 기록한 일을 되돌리면 기록에서도 빼요
function bxUndoHook(before) {
  if (!bxRec || bxRun || page().id !== bxRec.pid) return;
  const L = bxRec.ops[bxRec.ops.length - 1];
  if (before && L && L.after === bxHash()) bxRec.popped.push(bxRec.ops.pop());
  if (!before) { const P = bxRec.popped[bxRec.popped.length - 1]; if (P && P.after === bxHash()) bxRec.ops.push(bxRec.popped.pop()); }
  bxPill();
}
function bxDesc(s) {
  if (s.t === 'base') return `바탕 그림 보정 (${Object.keys(s.set).length + s.del.length}가지)`;
  if (s.t === 'els') return `올린 것 ${s.els.length}개 넣기 (${[...new Set(s.els.map(e => layerLabel(e, page()).split(' ')[0]))].slice(0, 3).join(', ')})`;
  switch (s.op) {
    case 'rot': return s.dir > 0 ? '오른쪽으로 돌리기' : '왼쪽으로 돌리기';
    case 'flip': return '좌우 뒤집기';
    case 'crop': return `자르기 (가운데 ${Math.round(s.r.w * 100)}% × ${Math.round(s.r.h * 100)}%)`;
    case 'size': return s.act === 'sz-pct' ? `크기 ${Math.round(s.v * 100)}%` : s.act === 'sz-long' ? `긴 쪽 ${s.v}` : s.act === 'sz-wid' ? `폭 ${s.v}` : s.act === 'sz-ratio' ? `캔버스 비율 ${s.v}` : `캔버스 ${s.w} × ${s.h}`;
    case 'ai': return s.kind === 'bg' ? (s.v === 'cut' ? 'AI 배경 지우기' : s.v === 'blur' ? 'AI 배경만 흐리기' : 'AI 인물만 새 레이어로') : `AI 화질 키우기 (${s.scale}배)`;
    case 'cz': return '자동 흰칠';
    case 'auto': return '자동 보정 (그림마다 계산)';
  }
  return '작업';
}
// 기록 끝: 기록한 일 + 바탕 보정 차이 + 새로 올린 것
function bxStop() {
  const R = bxRec; if (!R) return; bxRec = null; bxPill();
  const p = doc.pages.find(q => q.id === R.pid);
  if (!p) { toast('기록하던 그림이 없어졌어요'); renderProps(); return; }
  const steps = R.ops.map(({ after, ...o }) => ({ t: 'op', ...o }));
  const B = baseEl(p);
  if (B && R.base) {
    const set = {}, del = [];
    for (const k of new Set([...Object.keys(B), ...Object.keys(R.base)])) {
      if (BX_BASE_SKIP.has(k)) continue;
      if (B[k] === undefined) { if (R.base[k] !== undefined) del.push(k); continue; }
      if (JSON.stringify(B[k]) !== JSON.stringify(R.base[k])) set[k] = clone(B[k]);
    }
    if (steps.some(s => s.op === 'auto')) for (const k of ['lvIn0', 'lvIn1', 'lvGam']) { delete set[k]; const j = del.indexOf(k); if (j >= 0) del.splice(j, 1); } // 자동 보정 값은 그림마다 다시 계산
    if (Object.keys(set).length || del.length) steps.push({ t: 'base', set, del });
  }
  const added = p.els.filter(e => !R.ids.has(e.id) && bxPortable(e) && !e.hidden);
  if (added.length) steps.push({ t: 'els', pw: p.w, ph: p.h, els: added.map(e => clone(e)) });
  renderProps();
  if (!steps.length) { toast('기록한 일이 없어요. 기록하는 동안 그림을 고쳐 주세요'); return; }
  bxEdit({ name: '내 동작 ' + (bxActs().length + 1), steps }, -1);
}
function bxCancel() { bxRec = null; bxPill(); renderProps(); toast('기록을 그만뒀어요'); }
function bxPill() {
  let el = $('#bxPill');
  if (!bxRec) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'bxPill'; el.className = 'bxpill'; document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-bx]'); if (!b) return; if (b.dataset.bx === 'stop') bxStop(); else bxCancel(); }); }
  el.innerHTML = `<i></i><b>동작 기록 중</b><span>${bxRec.ops.length ? `${bxRec.ops.length}가지 + 보정·올린 것` : '고친 것을 모두 기억해요'}</span><button class="btn sm primary" data-bx="stop">기록 끝내기</button><button class="btn sm" data-bx="cancel">취소</button>`;
}
// 기록한 동작 보기·고치기·저장
function bxEdit(A, idx) {
  const m = modal(`<h2>${idx < 0 ? '기록한 동작' : '동작 고치기'}</h2><p class="sub">아래 순서대로 다른 그림에 똑같이 해요. 빼고 싶은 단계는 ×로 지워요.</p>
    ${row('이름', `<input type="text" id="bxName" value="${esc(A.name)}" maxlength="30" spellcheck="false">`)}
    <ol class="bxsteps" id="bxSteps"></ol>
    <p class="muted small">자르기는 같은 비율 자리로, 올린 글자·그림은 그림 크기에 맞춰 같은 자리로 들어가요.</p>
    <div class="foot"><button class="btn" data-close>닫기</button><button class="btn" id="bxSave">저장</button><button class="btn primary" id="bxSaveRun">저장하고 다른 그림에 적용…</button></div>`, { wide: true });
  const draw = () => { $('#bxSteps', m).innerHTML = A.steps.map((s, i) => `<li><span>${esc(bxDesc(s))}</span><button class="btn sm" data-bxdel="${i}" title="이 단계 빼기">×</button></li>`).join('') || '<li class="muted">단계가 없어요</li>'; };
  draw();
  $('#bxSteps', m).addEventListener('click', e => { const b = e.target.closest('[data-bxdel]'); if (!b) return; A.steps.splice(+b.dataset.bxdel, 1); draw(); });
  const save = () => {
    if (!A.steps.length) { toast('단계가 없어서 저장하지 않았어요'); return false; }
    A.name = ($('#bxName', m).value || '').trim().slice(0, 30) || '내 동작';
    const all = bxActs(); if (idx >= 0 && all[idx]) all[idx] = A; else { all.push(A); idx = all.length - 1; }
    return bxActsSave(all);
  };
  $('#bxSave', m).addEventListener('click', () => { if (save()) { closeModal(); renderProps(); toast(`'${A.name}' 동작을 저장했어요`); } });
  $('#bxSaveRun', m).addEventListener('click', () => { if (save()) { renderProps(); bxApplyAsk(idx); } });
}
// 어디에 적용할지 고르기
function bxApplyAsk(idx) {
  const A = bxActs()[idx]; if (!A) return;
  const all = realIdx(), fo = page().folder && folderById(page().folder), inF = fo ? all.filter(i => inFolder(doc.pages[i].folder, page().folder)) : [];
  const m = modal(`<h2>'${esc(A.name)}' 적용하기</h2><p class="sub">${A.steps.length}단계를 고른 그림마다 차례로 해요. 그림마다 Ctrl+Z로 되돌릴 수 있어요.</p>
    <div class="seg" id="bxScope" style="margin-bottom:8px">${fo ? `<button class="btn sm on" data-v="fold">'${esc(fo.name)}' 폴더 (${inF.length}장)</button>` : ''}<button class="btn sm ${fo ? '' : 'on'}" data-v="all">모든 그림 (${all.length}장)</button><button class="btn sm" data-v="pick">직접 고르기</button></div>
    <div class="bxpick" id="bxPick" hidden>${all.map(i => { const P = doc.pages[i], r = P.img && images.get(P.img); return `<label class="chk"><input type="checkbox" value="${i}" ${i === doc.cur ? '' : 'checked'}> ${r && r.thumb ? `<img src="${r.thumb}" alt="">` : ''}${esc(P.name)}</label>`; }).join('')}</div>
    <label class="chk"><input type="checkbox" id="bxSkipCur" checked> 지금 보고 있는 그림은 빼기</label>
    <label class="chk"><input type="checkbox" id="bxExport"> 다 하면 내보내기 창 열기</label>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="bxGo">적용</button></div>`);
  let scope = fo ? 'fold' : 'all';
  $$('#bxScope [data-v]', m).forEach(b => b.addEventListener('click', () => { scope = b.dataset.v; $$('#bxScope [data-v]', m).forEach(x => x.classList.toggle('on', x === b)); $('#bxPick', m).hidden = scope !== 'pick'; }));
  $('#bxGo', m).addEventListener('click', () => {
    let idxs = scope === 'pick' ? $$('#bxPick input:checked', m).map(x => +x.value) : scope === 'fold' ? inF : all.slice();
    if (scope !== 'pick' && $('#bxSkipCur', m).checked) idxs = idxs.filter(i => i !== doc.cur);
    const ex = $('#bxExport', m).checked; closeModal();
    if (!idxs.length) { toast('적용할 그림이 없어요'); return; }
    bxApply(A, idxs, ex);
  });
}
// 진행 표시 (창이 아니라서 중간에 AI 진행 창이 떠도 안 꺼져요)
function bxBar(msg, f) {
  let el = $('#bxBar');
  if (msg == null) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'bxBar'; el.className = 'bxbar'; el.innerHTML = '<b></b><div class="czbar"><i></i></div><button class="btn sm">멈추기</button>'; document.body.appendChild(el); el.querySelector('button').addEventListener('click', () => { if (bxRun) bxRun.stop = true; el.querySelector('b').textContent = '이 그림까지만 하고 멈춰요…'; }); }
  if (!bxRun || !bxRun.stop) el.querySelector('b').textContent = msg;
  el.querySelector('i').style.width = Math.round(clamp(f, 0, 1) * 100) + '%';
}
async function bxApply(A, idxs, ex) {
  if (bxRun) return; bxRun = { stop: false };
  const ids = idxs.map(i => doc.pages[i].id), skipped = new Set(); let n = 0;
  try {
    for (let k = 0; k < ids.length; k++) {
      if (bxRun.stop) break;
      const i = doc.pages.findIndex(p => p.id === ids[k]); if (i < 0) continue;
      bxBar(`${k + 1} / ${ids.length}장 · ${doc.pages[i].name}`, k / ids.length);
      switchPage(i); await new Promise(r => setTimeout(r, 30));
      for (const s of A.steps) { const r = await bxStep(s); if (r) skipped.add(r); if (bxRun.stop && s.t === 'op' && (s.op === 'ai' || s.op === 'cz')) break; }
      commit(); renderLib(); n++;
    }
  } catch (e) { console.warn(e); toast('하다가 문제가 생겼어요. ' + (e && e.message || e), 5000); }
  const stopped = bxRun.stop; bxRun = null; bxBar(null);
  fitView(); renderAll(); renderLib();
  toast(`${n}장에 '${A.name}'을 했어요${stopped ? ' (중간에 멈췄어요)' : ''}${skipped.size ? ` · ${[...skipped].join(', ')}` : ''}`, 5000);
  if (ex && n && !stopped) openExportModal();
}
async function bxStep(s) {
  const p = page(), B = baseEl(p);
  if (s.t === 'base') { if (!B) return; for (const k of s.del) delete B[k]; Object.assign(B, clone(s.set)); return; }
  if (s.t === 'els') {
    const k = Math.min(p.w / s.pw, p.h / s.ph), cs = []; let miss = 0;
    for (const src of s.els) {
      if ((src.type === 'stamp' || (src.type === 'panel' && src.img)) && !images.has(src.img)) { miss++; continue; }
      const c = clone(src); c.id = uid(); delete c.gid;
      const full = Math.abs(src.x) < 1 && Math.abs(src.y) < 1 && Math.abs(src.w - s.pw) < 1 && Math.abs(src.h - s.ph) < 1;
      if (full) { c.x = 0; c.y = 0; c.w = p.w; c.h = p.h; }
      else { const cx = (src.x + src.w / 2) / s.pw * p.w, cy = (src.y + src.h / 2) / s.ph * p.h; scaleEl(c, k); if (c.type === 'text') fitText(c); const nc = center(c); moveBy(c, cx - nc.x, cy - nc.y); }
      p.els.push(c); cs.push(c);
    }
    return miss ? '다른 작품의 그림이 든 것은 빼고 넣었어요' : '';
  }
  switch (s.op) {
    case 'rot': rotatePage(s.dir); return;
    case 'flip': if (B) { B.flip = !B.flip; B.rot = -(B.rot || 0); } return;
    case 'crop': {
      const x = Math.round(s.r.x * p.w), y = Math.round(s.r.y * p.h), w = Math.max(8, Math.round(s.r.w * p.w)), h = Math.max(8, Math.round(s.r.h * p.h));
      for (const el of p.els) moveBy(el, -x, -y); e2BakeStraight(p); p.w = w; p.h = h; return;
    }
    case 'size': {
      if (s.act === 'sz-pct' || s.act === 'sz-long' || s.act === 'sz-wid') { const k = s.act === 'sz-pct' ? s.v : s.act === 'sz-long' ? s.v / Math.max(p.w, p.h) : s.v / p.w; if (Math.abs(k - 1) > 1e-4) resizePage(p, k); }
      else if (s.act === 'sz-ratio') { const [a, b] = String(s.v).split(':').map(Number), W = Math.max(p.w, Math.round(p.h * a / b)), H = Math.max(p.h, Math.round(p.w * b / a)); if (W !== p.w || H !== p.h) canvasPage(p, W, H, 0.5, 0.5, s.trans); }
      else if (s.act === 'cv') canvasPage(p, s.w, s.h, s.ax, s.ay, s.trans);
      return;
    }
    case 'ai': {
      if (!B) return;
      const keep = { ...aiSr }; if (s.kind === 'sr') { aiSr.scale = s.scale; aiSr.model = s.model; }
      aiForce = [{ p, el: B, L: B }];
      try { await aiRun(s.kind, s.v); } finally { aiForce = null; Object.assign(aiSr, keep); }
      return;
    }
    case 'cz': await czRunPage(false); return;
    case 'auto': if (B) advAuto(B); return;
  }
}
function bxSec() {
  const acts = bxActs(), multi = realIdx().length > 1;
  return `<div class="sec"><h3>일괄 처리 (동작 기록)</h3>
    <p class="muted small" style="margin:0 0 6px">이 그림에서 한 일을 기록해 두었다가 다른 그림들에 똑같이 해요. 돌리기·자르기·크기·보정·AI 배경 지우기·자동 흰칠·글자 넣기 같은 것을 기억해요.</p>
    <div class="btnrow">${bxRec ? '<button class="btn sm primary" data-act="bx-stop">● 기록 끝내기</button><button class="btn sm" data-act="bx-cancel">취소</button>' : '<button class="btn sm" data-act="bx-start">● 기록 시작</button>'}</div>
    ${acts.length ? `<div class="bxacts">${acts.map((a, i) => `<div class="bxact"><b title="${esc(a.steps.map(bxDesc).join(' → '))}">${esc(a.name)}</b><span class="muted small">${a.steps.length}단계</span><button class="btn sm primary" data-act="bx-run" data-v="${i}" ${multi ? '' : 'disabled title="그림이 두 장 이상일 때 써요"'}>적용…</button><button class="btn sm" data-act="bx-edit" data-v="${i}">보기</button><button class="btn sm" data-act="bx-del" data-v="${i}" title="이 동작 지우기">×</button></div>`).join('')}</div>` : ''}</div>`;
}
function bxAct(a, v) {
  if (a === 'bx-start') bxStart();
  else if (a === 'bx-stop') bxStop();
  else if (a === 'bx-cancel') bxCancel();
  else if (a === 'bx-run') bxApplyAsk(+v);
  else if (a === 'bx-edit') { const A = bxActs()[+v]; if (A) bxEdit(A, +v); }
  else if (a === 'bx-del') { const all = bxActs(), A = all[+v]; if (!A) return; all.splice(+v, 1); bxActsSave(all); renderProps(); toast(`'${A.name}' 동작을 지웠어요`); }
}
