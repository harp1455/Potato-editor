/* ================= 레이어 목록 (왼쪽 '레이어' 탭) ================= */
// 페이지의 요소들을 위(앞)에서 아래(뒤) 순서로 보여 줘요. 숨기기·잠그기·순서 끌기·이름·불투명도·섞는 법
const BLENDS_ALL = BLENDS.concat([['darken', '어둡게만'], ['lighten', '밝게만'], ['color-dodge', '닷지 (빛 번짐)'], ['color-burn', '번 (진하게)'], ['hard-light', '하드 라이트'], ['difference', '차이'], ['exclusion', '제외'], ['hue', '색조만'], ['saturation', '채도만'], ['luminosity', '밝기만']]);
const LAYER_ICON = {
  panel: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 12l3.5-4 2.5 3 1.7-2L13 12" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  text: '<svg viewBox="0 0 16 16"><path d="M3 3.5h10M8 3.5V13" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
  bubble: '<svg viewBox="0 0 16 16"><path d="M8 2.5c3.6 0 6 2 6 4.6S11.6 11.7 8 11.7c-.8 0-1.5-.1-2.2-.3L3 13.5l.8-3C2.7 9.6 2 8.4 2 7.1 2 4.5 4.4 2.5 8 2.5z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  stamp: '<svg viewBox="0 0 16 16"><path d="M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  draw: '<svg viewBox="0 0 16 16"><path d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  fx: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 11l6-6M5 7.5l2.5-2.5M8.5 11L11 8.5" stroke="currentColor" stroke-width="1.1"/></svg>',
  shape: '<svg viewBox="0 0 16 16"><rect x="1.5" y="6.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="10.5" cy="5.5" r="4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  tmpl: '<svg viewBox="0 0 16 16"><path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="5" cy="5.5" r="1.2" fill="#ff3b30"/></svg>',
  adj: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.5a5.5 5.5 0 010 11z" fill="currentColor"/></svg>',
};
const LOCK_SVG = on => on ? '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="currentColor"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'
  : '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5a2.5 2.5 0 014.8-1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
function layerLabel(el, p) {
  if (el.name) return el.name;
  const short = s => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 14 ? s.slice(0, 14) + '…' : s; };
  switch (el.type) {
    case 'shape': return '도형 · ' + ((SHAPE_KINDS.find(x => x[0] === el.kind) || [, ''])[1]);
    case 'tmpl': return (TMPL_KINDS.find(x => x[0] === el.kind) || [, '템플릿'])[1];
    case 'panel': {
      if (el.lock) return '바탕 그림';
      if (el.adjL) return '보정 레이어';
      if (el.fill && el.pass && !layerCount(el)) return '색 화면';
      const n = p.els.filter(e => e.type === 'panel' && !e.lock).indexOf(el) + 1, r = el.img && images.get(el.img);
      return `컷 ${n}` + (r ? ` · ${short(r.name)}` : '');
    }
    case 'text': return short(el.text) || '(빈 글자)';
    case 'bubble': return short(el.text) || '(빈 말풍선)';
    case 'stamp': return '효과음·스티커';
    case 'draw': return '손그림';
    case 'fx': return el.auto ? '자동 흰칠' : ({ blur: '가리기 · 흐림', mosaic: '가리기 · 모자이크', paint: '가리기 · 칠하기', erase: '지우기', clone: '도장', heal: '잡티 지우기', dodge: '밝게 붓', burn: '어둡게 붓', smudge: '문지르기 붓' }[el.kind] || '가리기');
  }
  return el.type;
}
let layersQ = false;
function renderLayersSoon() { if (layersQ) return; layersQ = true; requestAnimationFrame(() => { layersQ = false; renderLayers(); }); }
function renderLayers() {
  const box = $('#layers'); if (!box || $('#tab-layers').hidden) return;
  const p = page(), ids = new Set(sel);
  if (!p || p.ph) { box.innerHTML = '<p class="muted small" style="padding:10px">그림을 먼저 불러오세요.</p>'; $('#layerFoot').innerHTML = ''; return; }
  const rows = p.els.slice().reverse().map(el => {
    const r = el.type === 'panel' && el.img ? images.get(el.img) : el.type === 'stamp' ? images.get(el.img) : null;
    const thumb = r && r.thumb ? `<img src="${r.thumb}" alt="">` : el.adjL ? LAYER_ICON.adj : el.type === 'panel' && el.fill && el.pass ? `<span class="lyr-sw" style="background:${el.fill}"></span>` : LAYER_ICON[el.type] || '';
    return `<div class="lyr ${ids.has(el.id) ? 'on' : ''} ${el.hidden ? 'off' : ''}" data-lid="${el.id}" draggable="${el.lock ? 'false' : 'true'}">
      <button class="lyr-eye" data-lact="eye" title="${el.hidden ? '보이기' : '숨기기'}">${eyeSvg(!el.hidden)}</button>
      <span class="lyr-th">${thumb}</span>
      <span class="lyr-nm" title="두 번 누르면 이름 바꾸기">${esc(layerLabel(el, p))}</span>
      ${(el.eop ?? 100) < 100 ? `<span class="lyr-badge">${Math.round(el.eop)}%</span>` : ''}${el.lmask ? '<span class="lyr-badge" title="레이어 마스크">마스크</span>' : ''}${el.eblend && el.eblend !== 'source-over' ? '<span class="lyr-badge">섞기</span>' : ''}
      ${el.lock ? '<span class="lyr-lock" title="바탕 그림은 늘 고정돼 있어요">' + LOCK_SVG(true) + '</span>' : `<button class="lyr-lock ${el.ulock ? 'on' : ''}" data-lact="lock" title="${el.ulock ? '잠금 풀기' : '잠그기 (화면에서 안 골라져요)'}">${LOCK_SVG(!!el.ulock)}</button>`}
    </div>`;
  }).join('');
  box.innerHTML = rows || '<p class="muted small" style="padding:10px">아직 아무것도 없어요.</p>';
  const ss = selEls(), one = ss.length === 1 ? ss[0] : null;
  $('#layerFoot').innerHTML = ss.length ? `
    <div class="row"><span class="l">불투명도</span><input type="range" min="0" max="100" step="1" data-lk="eop" value="${one ? (one.eop ?? 100) : 100}"><input type="number" min="0" max="100" step="1" data-lk="eop" value="${one ? Math.round(one.eop ?? 100) : 100}"></div>
    <div class="row"><span class="l">섞는 법</span><select data-lk="eblend">${BLENDS_ALL.map(([v, l]) => `<option value="${v}" ${(one ? one.eblend || 'source-over' : 'source-over') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${isImg() && ss.filter(o => !o.lock).length > 1 ? '<div class="btnrow"><button class="btn sm" data-lact="merge" title="고른 레이어를 그림 레이어 하나로 합쳐요. 합친 뒤에도 옮기기·크기·돌리기를 할 수 있어요">고른 것 합치기</button></div>' : ''}
    <div class="btnrow"><button class="btn sm" data-lact="up" title="한 칸 앞으로">위로</button><button class="btn sm" data-lact="down" title="한 칸 뒤로">아래로</button><button class="btn sm" data-lact="dup">복제</button>${one ? '<button class="btn sm" data-lact="rename">이름</button>' : ''}<button class="btn sm danger" data-lact="del">삭제</button></div>`
    : `<p class="muted small">레이어를 누르면 골라져요. <kbd>Shift</kbd>로 여러 개. 끌어서 순서를 바꿔요.</p>${p.els.some(e => e.hidden) ? '<div class="btnrow"><button class="btn sm" data-lact="showall">숨긴 것 모두 보이기</button></div>' : ''}${isImg() && p.els.filter(e => !e.hidden).length > 1 ? '<div class="btnrow"><button class="btn sm" data-lact="flatten" title="보이는 레이어를 바탕 그림 한 장으로 합쳐요 (숨긴 레이어는 그대로 남아요)">모두 합치기</button></div>' : ''}`;
}
(() => {
  const box = $('#layers'), foot = $('#layerFoot');
  const find = id => page().els.find(e => e.id === id);
  box.addEventListener('click', e => {
    const row = e.target.closest('.lyr'); if (!row) return;
    const el = find(row.dataset.lid); if (!el) return;
    const act = e.target.closest('[data-lact]');
    if (act && act.dataset.lact === 'eye') { el.hidden = !el.hidden; if (!el.hidden) delete el.hidden; if (el.hidden) sel = sel.filter(i => i !== el.id); commit(); renderProps(); requestRender(); renderLayers(); return; }
    if (act && act.dataset.lact === 'lock') { el.ulock = !el.ulock; if (!el.ulock) delete el.ulock; commit(); renderLayers(); return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey) sel = sel.includes(el.id) ? sel.filter(i => i !== el.id) : sel.concat(el.id);
    else sel = [el.id];
    renderProps(); requestRender(); renderLayers();
  });
  box.addEventListener('dblclick', async e => {
    const row = e.target.closest('.lyr'); if (!row || e.target.closest('[data-lact]')) return;
    const el = find(row.dataset.lid); if (!el) return;
    const n = await askText('레이어 이름', layerLabel(el, page()), '바꾸기'); if (n === null || n === undefined) return;
    if (n.trim()) el.name = n.trim().slice(0, 30); else delete el.name; commit(); renderLayers();
  });
  // 끌어서 순서 바꾸기 (위가 앞)
  let dragId = null;
  box.addEventListener('dragstart', e => { const row = e.target.closest('.lyr'); if (!row) return; dragId = row.dataset.lid; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/x-potato-layer', dragId); } catch (_) { } row.classList.add('dragging'); });
  box.addEventListener('dragend', () => { dragId = null; $$('.lyr', box).forEach(r => r.classList.remove('dragging', 'dropA', 'dropB')); });
  const where = e => { const row = e.target.closest('.lyr'); if (!row) return null; const r = row.getBoundingClientRect(); return { row, before: e.clientY < r.top + r.height / 2 }; };
  box.addEventListener('dragover', e => {
    if (!dragId) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move';
    $$('.lyr', box).forEach(r => r.classList.remove('dropA', 'dropB')); const w = where(e); if (w) w.row.classList.add(w.before ? 'dropA' : 'dropB');
  });
  box.addEventListener('drop', e => {
    if (!dragId) return; e.preventDefault(); e.stopPropagation();
    const w = where(e), p = page(), el = find(dragId); dragId = null; if (!w || !el) { renderLayers(); return; }
    const tgt = find(w.row.dataset.lid); if (!tgt || tgt === el) { renderLayers(); return; }
    p.els.splice(p.els.indexOf(el), 1);
    let i = p.els.indexOf(tgt) + (w.before ? 1 : 0); // 목록 위 = 배열 뒤쪽
    const B = p.els.findIndex(x => x.lock); if (B >= 0) i = Math.max(i, B + 1); // 바탕 그림 아래로는 못 가요
    p.els.splice(i, 0, el); commit(); requestRender(); renderLayers();
  });
  // 아래 칸: 불투명도·섞는 법·버튼
  foot.addEventListener('input', e => {
    const k = e.target.dataset.lk; if (!k) return; const ss = selEls(); if (!ss.length) return;
    if (k === 'eop') { const v = clamp(parseFloat(e.target.value) || 0, 0, 100); for (const o of ss) { if (v >= 100) delete o.eop; else o.eop = v; } $$('[data-lk="eop"]', foot).forEach(x => { if (x !== e.target) x.value = v; }); }
    if (k === 'eblend') for (const o of ss) { if (e.target.value === 'source-over') delete o.eblend; else o.eblend = e.target.value; }
    requestRender();
  });
  foot.addEventListener('change', e => { if (e.target.dataset.lk) { commit(); renderLayers(); } });
  foot.addEventListener('click', async e => {
    const b = e.target.closest('[data-lact]'); if (!b) return; const a = b.dataset.lact, p = page();
    if (a === 'up' || a === 'down') {
      for (const o of (a === 'up' ? selEls().slice().reverse() : selEls())) {
        if (o.lock) continue; const i = p.els.indexOf(o), j = i + (a === 'up' ? 1 : -1);
        if (j < 0 || j >= p.els.length || p.els[j].lock || sel.includes(p.els[j].id)) continue;
        [p.els[i], p.els[j]] = [p.els[j], p.els[i]];
      }
      commit(); requestRender(); renderLayers(); return;
    }
    if (a === 'dup') { duplicateSel(); renderLayers(); return; }
    if (a === 'del') { deleteSel(); renderLayers(); return; }
    if (a === 'flatten') { lyFlatten(); return; }
    if (a === 'merge') { lyMergeSel(); return; }
    if (a === 'showall') { for (const o of p.els) delete o.hidden; commit(); requestRender(); renderLayers(); return; }
    if (a === 'rename') { const o = selEls()[0]; if (!o) return; const n = await askText('레이어 이름', layerLabel(o, p), '바꾸기'); if (n === null || n === undefined) return; if (n.trim()) o.name = n.trim().slice(0, 30); else delete o.name; commit(); renderLayers(); }
  });
})();
// 요소 하나를 따로 그려서 불투명도·섞는 법으로 얹기 (글자 테두리와 속이 겹쳐 비치지 않게)
function drawElGroup(ctx, el, opt, inner) {
  const m = ctx.getTransform(), b0 = elBounds(el), pd = Math.max(el.w, el.h) * 0.25 + 40, b = { x0: b0.x0 - pd, y0: b0.y0 - pd, x1: b0.x1 + pd, y1: b0.y1 + pd }, cw = ctx.canvas.width, ch = ctx.canvas.height;
  const xs = [], ys = [];
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) { xs.push(m.a * x + m.c * y + m.e); ys.push(m.b * x + m.d * y + m.f); }
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), x1 = Math.min(cw, Math.ceil(Math.max(...xs))), y1 = Math.min(ch, Math.ceil(Math.max(...ys)));
  if (x1 <= x0 || y1 <= y0) return;
  const off = newCanvas(x1 - x0, y1 - y0), g = off.getContext('2d');
  g.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0); inner(g);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= (el.eop ?? 100) / 100; if (el.eblend) ctx.globalCompositeOperation = el.eblend;
  ctx.drawImage(off, x0, y0); ctx.restore();
}

/* ================= 그림 크기·캔버스 크기 (이미지 편집) ================= */
let szMode = 'img', szAnchor = 4, szTrans = false;
// 페이지 전체를 k배 (요소들도 같이)
function resizePage(p, k) {
  const W = p.w, H = p.h, nw = Math.max(16, Math.round(W * k)), nh = Math.max(16, Math.round(H * k));
  for (const el of p.els) {
    const full = el.lock && Math.abs(el.x) < 0.5 && Math.abs(el.y) < 0.5 && Math.abs(el.w - W) < 0.5 && Math.abs(el.h - H) < 0.5;
    scaleEl(el, k);
    if (full) { el.x = 0; el.y = 0; el.w = nw; el.h = nh; }
  }
  p.w = nw; p.h = nh;
}
// 캔버스만 늘리거나 줄이기 (그림은 그대로, ax·ay = 기준 위치 0~1)
function canvasPage(p, nw, nh, ax, ay, trans) {
  const dx = (nw - p.w) * ax, dy = (nh - p.h) * ay;
  for (const el of p.els) { el.x += dx; el.y += dy; if (el.type === 'bubble') { el.tx += dx; el.ty += dy; } }
  p.w = Math.max(16, Math.round(nw)); p.h = Math.max(16, Math.round(nh));
  if (trans) p.bgT = true; else delete p.bgT;
}
function sizeSec() {
  const p = page(), fo = p.folder && folderById(p.folder), multi = realIdx().length > 1;
  const scope = multi ? `<div class="row"><span class="l">적용할 그림</span><select id="szScope"><option value="one">이 그림만</option>${fo ? `<option value="fold">'${esc(fo.name)}' 폴더 전체</option>` : ''}<option value="all">모든 그림</option></select></div>` : '';
  const anc = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => `<button class="szanc ${szAnchor === i ? 'on' : ''}" data-act="sz-anchor" data-v="${i}" title="기준 위치"></button>`).join('');
  return sec('size', '크기 바꾸기', `
    <div class="seg" style="margin-bottom:8px"><button class="btn sm ${szMode === 'img' ? 'on' : ''}" data-act="sz-mode" data-v="img">그림 크기</button><button class="btn sm ${szMode === 'cv' ? 'on' : ''}" data-act="sz-mode" data-v="cv">캔버스 크기</button></div>
    ${szMode === 'img' ? `
      <p class="muted small" style="margin:0 0 6px">그림과 위에 올린 것을 같이 키우거나 줄여요. 비율은 그대로예요.</p>
      <div class="grid2"><span>폭</span><input type="number" id="szW" min="16" max="16000" step="1" value="${p.w}"><span>높이</span><input type="number" id="szH" min="16" max="16000" step="1" value="${p.h}"></div>
      <div class="btnrow"><button class="btn sm" data-act="sz-pct" data-v="0.5">절반</button><button class="btn sm" data-act="sz-pct" data-v="0.75">75%</button><button class="btn sm" data-act="sz-pct" data-v="1.5">1.5배</button><button class="btn sm" data-act="sz-pct" data-v="2">2배</button></div>
      <div class="btnrow"><button class="btn sm" data-act="sz-long" data-v="1080">긴 쪽 1080</button><button class="btn sm" data-act="sz-long" data-v="1920">긴 쪽 1920</button><button class="btn sm" data-act="sz-wid" data-v="1080">폭 1080</button></div>
      <p class="muted small">AI 없이 늘리면 흐려질 수 있어요. 화질을 살려 키우려면 'AI 화질 키우기'를 쓰세요.</p>`
    : `
      <p class="muted small" style="margin:0 0 6px">그림 크기는 그대로 두고 둘레에 여백을 붙이거나 잘라요.</p>
      <div class="grid2"><span>폭</span><input type="number" id="szW" min="16" max="16000" step="1" value="${p.w}"><span>높이</span><input type="number" id="szH" min="16" max="16000" step="1" value="${p.h}"></div>
      <div class="row"><span class="l">기준 위치</span><div class="szgrid">${anc}</div></div>
      <div class="row"><span class="l">늘어난 곳</span><div class="seg"><button class="btn sm ${!szTrans ? 'on' : ''}" data-act="sz-fill" data-v="bg">바탕색</button><button class="btn sm ${szTrans ? 'on' : ''}" data-act="sz-fill" data-v="tr">투명</button></div></div>
      <div class="btnrow"><button class="btn sm" data-act="sz-ratio" data-v="1:1">정사각형 (1:1)</button><button class="btn sm" data-act="sz-ratio" data-v="4:5">4:5</button><button class="btn sm" data-act="sz-ratio" data-v="9:16">9:16</button><button class="btn sm" data-act="sz-ratio" data-v="16:9">16:9</button></div>
      <p class="muted small">비율 버튼은 그림이 다 보이게 여백을 붙여요. 여백 색은 아래 '바탕색'이에요.</p>`}
    ${scope}
    <div class="btnrow"><button class="btn sm primary" data-act="sz-go">바꾸기</button></div>`);
}
function sizeTargets() {
  const v = ($('#szScope') || {}).value || 'one', fo = page().folder;
  if (v === 'one') return [page()];
  return realIdx().map(i => doc.pages[i]).filter(p => v === 'all' || inFolder(p.folder, fo));
}
function sizeAct(act, v) {
  switch (act) {
    case 'sz-mode': szMode = v; renderProps(); return;
    case 'sz-anchor': szAnchor = +v; renderProps(); return;
    case 'sz-fill': szTrans = v === 'tr'; renderProps(); return;
  }
  const ts = sizeTargets(), p0 = page(); let n = 0;
  const fin = () => { layoutSpacer(); fitView(); commit(); renderProps(); renderLib(); requestRender(); toast(n > 1 ? `${n}장의 크기를 바꿨어요` : `${p0.w} × ${p0.h}로 바꿨어요`); };
  if (act === 'sz-pct' || act === 'sz-long' || act === 'sz-wid') {
    for (const p of ts) { const k = act === 'sz-pct' ? +v : act === 'sz-long' ? +v / Math.max(p.w, p.h) : +v / p.w; if (Math.abs(k - 1) > 1e-4) { resizePage(p, k); n++; } }
    return fin();
  }
  if (act === 'sz-ratio') {
    const [a, b] = v.split(':').map(Number);
    for (const p of ts) { const W = Math.max(p.w, Math.round(p.h * a / b)), H = Math.max(p.h, Math.round(p.w * b / a)); if (W !== p.w || H !== p.h) { canvasPage(p, W, H, 0.5, 0.5, szTrans); n++; } }
    return fin();
  }
  if (act === 'sz-go') {
    const w = Math.round(+$('#szW').value), h = Math.round(+$('#szH').value);
    if (!(w >= 16 && h >= 16 && w <= 16000 && h <= 16000)) { toast('크기는 16~16000 사이로 넣어 주세요'); return; }
    if (szMode === 'img') {
      const k = w !== p0.w ? w / p0.w : h / p0.h;
      for (const p of ts) { resizePage(p, k); n++; }
    } else {
      const ax = (szAnchor % 3) / 2, ay = Math.floor(szAnchor / 3) / 2;
      for (const p of ts) { canvasPage(p, ts.length > 1 ? p.w + (w - p0.w) : w, ts.length > 1 ? p.h + (h - p0.h) : h, ax, ay, szTrans); n++; }
    }
    return fin();
  }
}
(() => { // 그림 크기: 폭을 바꾸면 높이도 비율대로
  propsEl.addEventListener('input', e => {
    if (szMode !== 'img' || (e.target.id !== 'szW' && e.target.id !== 'szH')) return;
    const p = page(), v = +e.target.value; if (!(v > 0)) return;
    if (e.target.id === 'szW') $('#szH').value = Math.round(v * p.h / p.w); else $('#szW').value = Math.round(v * p.w / p.h);
  });
})();
/* ---- 레이어 합치기 (이미지 편집) ---- */
// 모두 합치기: 보이는 레이어를 바탕 그림 한 장으로 굳혀요. 고른 것 합치기: 고른 레이어를 그림 레이어 하나로.
// 합친 그림은 새 그림으로 따로 저장되니 Ctrl+Z로 그대로 되돌릴 수 있어요
async function lyNewImg(c, name) {
  const src = c.toDataURL('image/png'), im = await loadImg(src);
  const r = { id: uid(), name, src, w: c.width, h: c.height, alpha: true, kind: 'stamp' }; addImageRecord(r, true, im); return r;
}
async function lyFlatten() {
  const pg = page(); if (!isImg() || pg.ph) return;
  const vis = pg.els.filter(e => !e.hidden); if (vis.length < 2) { toast('합칠 레이어가 없어요'); return; }
  if (mode) setMode(null);
  const c = newCanvas(pg.w, pg.h), g = c.getContext('2d');
  drawPage(g, pg, { screen: false, rs: 1, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } });
  const r = await lyNewImg(c, (pg.name || '그림').replace(/\.[^.]+$/, '') + ' 합침.png');
  const B = makePanel(pg.w / 2, pg.h / 2, pg.w, pg.h, r.id); B.bw = 0; B.lock = true;
  pg.els = [B, ...pg.els.filter(e => e.hidden && !e.lock)];
  sel = []; xfBase = null; activeLayer.clear(); commit(); renderProps(); renderLayers(); requestRender(); redrawCurThumb();
  toast(`레이어 ${vis.length}개를 바탕 그림 한 장으로 합쳤어요. 되돌리려면 Ctrl+Z`, 3200);
}
async function lyMergeSel() {
  const pg = page(); if (!isImg() || pg.ph) return;
  const ss = pg.els.filter(e => sel.includes(e.id) && !e.lock && !e.hidden);
  if (ss.length < 2) { toast('합칠 레이어를 두 개 넘게 골라 주세요'); return; }
  if (ss.some(e => e.adjL || e.type === 'fx')) { toast('보정 레이어와 가리기는 따로 합칠 수 없어요. 레이어 탭의 \'모두 합치기\'를 쓰세요.', 3500); return; }
  if (mode) setMode(null);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of ss) { const b = elBounds(e); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
  x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
  const k = Math.min(1, 8000 / Math.max(x1 - x0, y1 - y0)), W = Math.max(1, Math.round((x1 - x0) * k)), H = Math.max(1, Math.round((y1 - y0) * k));
  const c = newCanvas(W, H), g = c.getContext('2d'); g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
  const view = { x0, y0, x1, y1 }; for (const e of ss) drawEl(g, e, { screen: false, rs: k, view });
  const r = await lyNewImg(c, '합친 레이어.png');
  const P = makePanel((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, r.id); P.bw = 0; P.radius = 0; P.name = '합친 레이어';
  const at = pg.els.indexOf(ss[ss.length - 1]); pg.els.splice(at + 1, 0, P);
  pg.els = pg.els.filter(e => !ss.includes(e));
  sel = [P.id]; commit(); renderProps(); renderLayers(); requestRender();
  toast(`${ss.length}개를 그림 레이어 하나로 합쳤어요`);
}
