/* ================= 작업 탭 (여러 작업을 탭으로 열어 두기) ================= */
// 작업(프로젝트)마다 문서(doc:id), 그림(pimg 저장소, pj=id), 움짤(gif:id)을 따로 저장해요.
// 컷·이미지 편집 작업은 편집기 화면에, 움짤 작업은 움짤 화면에 열려요. 탭을 닫아도 지워지지 않고 '작업 목록'에 남아요
let projects = [];   // [{id, name, mode: 'cut'|'image'|'gif', at, open}]
let edPj = null;     // 편집기에 열려 있는 작업
let gifPj = null;    // 움짤 화면에 열려 있는 작업
let pjBusy = false, pjListT = 0;
const histStash = new Map(); // 작업 id -> 되돌리기 기록 (탭을 오가도 Ctrl+Z가 이어지게, 이 창을 켜 둔 동안만)
const PJ_MODE = { cut: '컷 편집', image: '이미지 편집', gif: '움짤' };
const PJ_ICON = {
  cut: '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 7h13M8 7v7.5" stroke="currentColor" stroke-width="1.5"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="6.2" r="1.3" fill="currentColor"/><path d="M2 12.5l4-4 3 3 2-2 3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  gif: '<svg width="14" height="14" viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6v4l3.5-2z" fill="currentColor"/></svg>',
};
const pjGet = id => projects.find(p => p.id === id) || null;
const pjActive = () => (gifOpen() && gifPj) ? gifPj : edPj;
const gifName = () => { const p = pjGet(gifPj); return p ? p.name : '움짤'; };
function pjNewId() { let id; do id = uid(); while (pjGet(id)); return id; }
function pjSaveList(now) {
  clearTimeout(pjListT);
  const go = () => Promise.all([idb.set('projects', projects.map(p => ({ id: p.id, name: p.name, mode: p.mode, at: p.at, open: !!p.open }))), idb.set('pjState', { ed: edPj, gif: gifPj, act: pjActive() })]);
  if (now) return go();
  pjListT = setTimeout(go, 400); return Promise.resolve();
}
function pjTouch(id) { // 저장할 때 이름·방식·시각을 목록에 맞춰요
  const p = pjGet(id || edPj); if (!p) return;
  if (p.id === edPj) { if (p.name !== doc.name || p.mode !== doc.mode) { p.name = doc.name; p.mode = doc.mode; renderTabs(); } }
  p.at = Date.now(); pjSaveList();
}
// 탭 그림 (작업 목록에 보여요)
function pjThumb() {
  try {
    const W = 120, H = 90, c = newCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = isDark() ? '#2a2d33' : '#eef0f3'; g.fillRect(0, 0, W, H);
    if (gifOpen() && gifPj) {
      const s0 = gs.slides[0]; if (!s0 || !s0.bmp) return null;
      const k = Math.max(W / s0.bmp.width, H / s0.bmp.height); g.drawImage(s0.bmp, (W - s0.bmp.width * k) / 2, (H - s0.bmp.height * k) / 2, s0.bmp.width * k, s0.bmp.height * k);
    } else {
      const p = page(); if (!p || p.ph) return null;
      const k = Math.max(W / p.w, H / p.h); g.save(); g.translate((W - p.w * k) / 2, p.h * k > H * 1.4 ? 0 : (H - p.h * k) / 2); g.scale(k, k);
      g.fillStyle = p.bg || '#fff'; g.fillRect(0, 0, p.w, p.h); drawPage(g, p, { screen: false, rs: k }); g.restore();
    }
    return c.toDataURL('image/jpeg', 0.72);
  } catch (e) { return null; }
}
async function pjSaveThumb() { const id = pjActive(); if (!id) return; const t = pjThumb(); if (t) await idb.set('pthumb:' + id, t); }
// 편집기 화면 비우기 (다른 작업을 열기 전에)
function pjClearEd() {
  closeInline(true); if (mode) setMode(null); closeMenus();
  if (edPj) { histStash.delete(edPj); histStash.set(edPj, { hist, hi, imgRedo }); while (histStash.size > 4) histStash.delete(histStash.keys().next().value); }
  images.clear(); imgCache.clear(); thumbImgs.clear(); imageOrder = []; marks = []; clearImgCaches(); layoutCache.clear(); alphaMaps.clear(); activeLayer.clear();
  sel = []; imageEditId = null; xfBase = null;
}
const pjBlankDoc = (md, name) => ({ name: name || '새 작품', mode: md === 'image' ? 'image' : 'cut', folders: [], pages: [md === 'image' ? phPage() : newPage(PRESETS[0].w, PRESETS[0].h, '페이지 1')], cur: 0, defaults: DEFAULTS() });
// 아무것도 안 한 빈 작업이면 새 탭을 만들지 않고 그 자리에 열어요
const pjIsBlank = () => !!edPj && !gifOpen() && !imageOrder.length && !doc.pages.some(p => p.els.length);
async function pjLoadEd(id) { // 저장해 둔 작업을 편집기에 열기
  pjClearEd(); edPj = id;
  const P = pjGet(id), saved = await idb.get('doc:' + id), imgs = (await idb.byPj(id)) || [];
  if (edPj !== id) return false;
  for (const r of imgs) addImageRecord(r, false);
  let ok = false;
  if (saved && saved.s) {
    try {
      imageOrder = (saved.imageOrder || []).filter(x => images.has(x) && images.get(x).kind !== 'stamp');
      for (const r of imgs) if (r.kind !== 'stamp' && !imageOrder.includes(r.id)) imageOrder.push(r.id);
      doc = normalizeDoc({ ...JSON.parse(saved.s), cur: saved.cur }); ok = true;
    } catch (e) { ok = false; }
  }
  if (!ok) { imageOrder = imgs.filter(r => r.kind !== 'stamp').map(r => r.id); doc = pjBlankDoc(P && P.mode, P && P.name); }
  if (P) P.name = doc.name;
  const st = histStash.get(id); histStash.delete(id);
  if (st && st.hist[st.hi] && st.hist[st.hi].s === histEntry().s) { hist = st.hist; hi = st.hi; imgRedo = st.imgRedo; updateUndo(); renderHistSoon(); }
  else resetHistory();
  fitView(); renderAll();
  return ok;
}
// 새 편집기 작업 (지금 작업은 탭에 남겨 두고)
async function pjNewEd(md, name) {
  if (gifOpen()) closeGifStudio();
  if (pjIsBlank()) { const P = pjGet(edPj); P.mode = md; P.name = name; P.open = true; pjClearEd(); histStash.delete(edPj); }
  else {
    await pjSaveThumb(); await saveNow(); pjClearEd();
    const id = pjNewId(); projects.push({ id, name, mode: md, at: Date.now(), open: true }); edPj = id;
  }
  doc = pjBlankDoc(md, name); resetHistory();
  pjSaveList(true); renderTabs();
}
async function pjNewGif(name) {
  if (gifOpen() && gifPj) { await pjSaveThumb(); await gsSave(); }
  const id = pjNewId(); projects.push({ id, name: name || pjGifName(), mode: 'gif', at: Date.now(), open: true });
  await pjSwitch(id);
}
function pjGifName() { let n = 1; while (projects.some(p => p.name === `움짤 ${n}`)) n++; return `움짤 ${n}`; }
// 탭 바꾸기
async function pjSwitch(id) {
  const P = pjGet(id); if (!P || pjBusy) return;
  pjBusy = true;
  try {
    const was = pjActive(); if (was !== id) await pjSaveThumb();
    P.open = true; P.at = Date.now();
    if (P.mode === 'gif') {
      if (id !== gifPj) { if (gifPj && gs.loaded) await gsSave(); gsReset(); gifPj = id; }
      renderTabs(); await openGifStudio();
    } else {
      if (gifOpen()) closeGifStudio();
      if (id !== edPj) { await saveNow(); await pjLoadEd(id); }
    }
    pjSaveList(true); renderTabs();
  } finally { pjBusy = false; }
}
// 움짤 화면의 '편집기로 돌아가기': 마지막에 쓴 편집기 탭으로
function pjBackToEditor() {
  const P = pjGet(edPj);
  if (P) { P.open = true; P.at = Date.now(); }
  closeGifStudio(); pjSaveList(true); renderTabs();
}
// 움짤 버튼: 열어 둔 움짤 탭으로, 없으면 새로
function pjOpenGif() {
  const g = pjGet(gifPj);
  if (g && g.open) return pjSwitch(g.id);
  const o = projects.filter(p => p.mode === 'gif' && p.open).sort((a, b) => b.at - a.at)[0];
  return o ? pjSwitch(o.id) : pjNewGif();
}
async function pjClose(id) {
  const P = pjGet(id); if (!P) return;
  const open = projects.filter(p => p.open);
  if (open.length <= 1) { toast('마지막 탭은 닫을 수 없어요'); return; }
  if (pjActive() === id) {
    const i = open.indexOf(P), next = open[i + 1] || open[i - 1];
    await pjSwitch(next.id);
  }
  P.open = false; pjSaveList(true); renderTabs();
  toast(`'${P.name}' 탭을 닫았어요. 탭 줄 오른쪽 '작업 목록'에서 다시 열 수 있어요.`, 3200);
}
async function pjRename(id, name) {
  const P = pjGet(id); name = (name || '').trim(); if (!P || !name || name === P.name) return;
  P.name = name;
  if (id === edPj) { doc.name = name; $('#docName').value = name; document.title = `${name} | 감자 편집기`; commit(); }
  else if (P.mode !== 'gif') { // 닫혀 있는 작업은 저장해 둔 문서 이름도 바꿔요
    const d = await idb.get('doc:' + id);
    if (d && d.s) { try { const o = JSON.parse(d.s); o.name = name; d.s = JSON.stringify(o); await idb.set('doc:' + id, d); } catch (e) { } }
  }
  pjSaveList(true); renderTabs();
}
async function pjDelete(id) {
  const P = pjGet(id); if (!P) return false;
  if (id === pjActive()) { toast('지금 보고 있는 작업은 지울 수 없어요. 다른 탭으로 바꾼 뒤 지워 주세요.', 3500); return false; }
  if (id === edPj) { toast('편집기에 열려 있는 작업이에요. 다른 편집 탭으로 바꾼 뒤 지워 주세요.', 3500); return false; }
  if (!confirm(`'${P.name}' 작업을 지울까요? 이 작업의 그림과 기록이 모두 사라지고 되돌릴 수 없어요.`)) return false;
  if (id === gifPj) { gsReset(); gifPj = null; }
  projects.splice(projects.indexOf(P), 1); histStash.delete(id);
  await Promise.all([idb.del('kv', 'doc:' + id), idb.del('kv', 'gif:' + id), idb.del('kv', 'pthumb:' + id), idb.delPj(id)]);
  pjSaveList(true); renderTabs(); return true;
}
// 탭 줄
function renderTabs() {
  const bar = $('#ptabs'); if (!bar) return;
  const act = pjActive(), open = projects.filter(p => p.open), one = open.length <= 1;
  bar.innerHTML = `<div class="ptlist" role="tablist">${open.map(p => `<div class="ptab ${p.id === act ? 'on' : ''}" role="tab" aria-selected="${p.id === act}" draggable="true" data-pj="${p.id}" title="${esc(p.name)} · ${PJ_MODE[p.mode] || ''}${p.id === act ? '' : '\n두 번 누르면 이름 바꾸기, 가운데 버튼으로 닫기'}"><span class="pi">${PJ_ICON[p.mode] || ''}</span><span class="pn">${esc(p.name)}</span>${one ? '' : `<button class="px" data-pjx="${p.id}" title="탭 닫기 (작업은 '작업 목록'에 남아요)" aria-label="탭 닫기">×</button>`}</div>`).join('')}
    <button class="padd" data-pjc="new" title="새 작업을 새 탭으로 (지금 작업은 그대로 남아요)" aria-label="새 탭">+</button></div>
    <button class="plist" data-pjc="list" title="닫은 탭과 모든 작업 보기"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>작업 목록${projects.length > open.length ? ` <span class="muted">(${projects.length})</span>` : ''}</button>`;
  const on = $('.ptab.on', bar); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function pjTabRename(t) {
  const id = t.dataset.pj, P = pjGet(id), n = $('.pn', t); if (!P || !n || t.querySelector('input')) return;
  const inp = document.createElement('input'); inp.className = 'ptin'; inp.value = P.name; inp.spellcheck = false; n.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const fin = ok => { if (done) return; done = true; if (ok) pjRename(id, inp.value); else renderTabs(); if (ok && (inp.value || '').trim() === P.name) renderTabs(); };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') fin(true); else if (e.key === 'Escape') fin(false); });
  inp.addEventListener('blur', () => fin(true));
  inp.addEventListener('pointerdown', e => e.stopPropagation());
}
(function bindTabs() {
  const bar = $('#ptabs'); if (!bar) return;
  bar.addEventListener('click', e => {
    const x = e.target.closest('[data-pjx]'); if (x) { e.stopPropagation(); pjClose(x.dataset.pjx); return; }
    const c = e.target.closest('[data-pjc]');
    if (c) { if (c.dataset.pjc === 'new') openNewModal(false); else openProjList(); return; }
    const t = e.target.closest('[data-pj]'); if (t && !e.target.closest('input') && t.dataset.pj !== pjActive()) pjSwitch(t.dataset.pj);
  });
  bar.addEventListener('dblclick', e => { const t = e.target.closest('[data-pj]'); if (t && !e.target.closest('[data-pjx]')) pjTabRename(t); });
  bar.addEventListener('auxclick', e => { if (e.button !== 1) return; const t = e.target.closest('[data-pj]'); if (t) { e.preventDefault(); pjClose(t.dataset.pj); } });
  bar.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest('[data-pj]')) e.preventDefault(); });
  // 끌어서 탭 순서 바꾸기
  let dragId = null;
  bar.addEventListener('dragstart', e => { const t = e.target.closest('[data-pj]'); if (!t) return; dragId = t.dataset.pj; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/x-potato-tab', dragId); } catch (_) { } t.classList.add('drag'); });
  bar.addEventListener('dragend', () => { dragId = null; $$('.ptab', bar).forEach(t => t.classList.remove('drag', 'dl', 'dr')); });
  bar.addEventListener('dragover', e => {
    if (!dragId) return; const t = e.target.closest('[data-pj]'); e.preventDefault(); e.stopPropagation();
    $$('.ptab', bar).forEach(x => x.classList.remove('dl', 'dr'));
    if (t && t.dataset.pj !== dragId) { const r = t.getBoundingClientRect(); t.classList.add(e.clientX < r.left + r.width / 2 ? 'dl' : 'dr'); }
  });
  bar.addEventListener('drop', e => {
    if (!dragId) return; e.preventDefault(); e.stopPropagation();
    const t = e.target.closest('[data-pj]'), A = pjGet(dragId); if (!t || !A || t.dataset.pj === dragId) return;
    const r = t.getBoundingClientRect(), after = e.clientX >= r.left + r.width / 2;
    projects.splice(projects.indexOf(A), 1); const B = pjGet(t.dataset.pj); projects.splice(projects.indexOf(B) + (after ? 1 : 0), 0, A);
    pjSaveList(true); renderTabs();
  });
  // Ctrl+Tab / Ctrl+Shift+Tab: 다음·앞 탭
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey && e.key === 'Tab') || modalOpen()) return;
    e.preventDefault(); e.stopPropagation();
    const open = projects.filter(p => p.open); if (open.length < 2) return;
    const i = open.findIndex(p => p.id === pjActive()), n = open[(i + (e.shiftKey ? -1 : 1) + open.length) % open.length];
    pjSwitch(n.id);
  }, true);
})();
// 작업 목록 (닫은 탭 다시 열기, 지우기)
const pjWhen = t => { const d = new Date(t), now = new Date(), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; return d.toDateString() === now.toDateString() ? `오늘 ${hm}` : `${d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`; };
async function openProjList() {
  await pjSaveThumb();
  const act = pjActive(), list = [...projects].sort((a, b) => b.at - a.at);
  const m = modal(`<h2>작업 목록</h2><p class="sub">작업은 모두 이 컴퓨터에 자동 저장돼요. 탭을 닫아도 여기 남아 있어서 언제든 다시 열 수 있어요.</p>
    <div class="pjl" id="pjl">${list.map(p => `<div class="pjr ${p.open ? 'open' : ''}" data-pjr="${p.id}"><div class="pjt" data-pjt="${p.id}">${PJ_ICON[p.mode] || ''}</div>
      <div class="pjm"><b>${esc(p.name)}</b><span class="muted small">${PJ_MODE[p.mode] || ''} · ${pjWhen(p.at)}${p.id === act ? ' · <span class="pjnow">지금 작업 중</span>' : p.open ? ' · 탭 열림' : ''}</span></div>
      <div class="pjb">${p.id === act ? '' : `<button class="btn sm primary" data-pjo="${p.id}">${p.open ? '보기' : '열기'}</button>`}<button class="btn sm" data-pjn="${p.id}">이름 바꾸기</button>${p.id === act || p.id === edPj ? '' : `<button class="btn sm danger" data-pjd="${p.id}" title="작업을 아예 지워요">지우기</button>`}</div></div>`).join('')}</div>
    <p class="muted small" id="pjUse" style="margin-top:8px"></p>
    <div class="foot"><button class="btn" id="pjFile">파일에서 열기</button><button class="btn" id="pjNew">새 작업</button><button class="btn primary" data-close>닫기</button></div>`, { wide: true });
  for (const p of list) idb.get('pthumb:' + p.id).then(t => { const c = t && $(`[data-pjt="${p.id}"]`, m); if (c) c.innerHTML = `<img src="${t}" alt="">`; });
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(u => { const el = $('#pjUse', m); if (el && u && u.usage) el.textContent = `저장 공간 ${u.usage < 1048576 ? '1MB 미만' : (u.usage / 1048576).toFixed(0) + 'MB'} 쓰는 중`; }).catch(() => { });
  $('#pjNew', m).addEventListener('click', () => openNewModal(false));
  $('#pjFile', m).addEventListener('click', () => { closeModal(); $('#fileProj').click(); });
  $('#pjl', m).addEventListener('click', async e => {
    const o = e.target.closest('[data-pjo]'); if (o) { closeModal(); pjSwitch(o.dataset.pjo); return; }
    const n = e.target.closest('[data-pjn]');
    if (n) { const P = pjGet(n.dataset.pjn), v = P && prompt('새 이름', P.name); if (v && v.trim()) { await pjRename(P.id, v); const b = $(`[data-pjr="${P.id}"] b`, m); if (b) b.textContent = P.name; } return; }
    const d = e.target.closest('[data-pjd]'); if (d && await pjDelete(d.dataset.pjd)) { const r = $(`[data-pjr="${d.dataset.pjd}"]`, m); if (r) r.remove(); }
  });
}
// 처음 켤 때: 예전 한 칸짜리 저장을 첫 작업으로 옮기고, 마지막에 보던 작업을 열어요
async function pjMigrate() {
  const list = [], saved = await idb.get('doc'), old = (await idb.all('imgs')) || [];
  if (saved && saved.s) {
    const id = pjNewId(); let name = '새 작품', md = 'cut';
    try { const d = JSON.parse(saved.s); name = d.name || name; md = d.mode === 'image' ? 'image' : 'cut'; } catch (e) { }
    if (!(await idb.putAll('pimg', old.map(r => ({ ...r, k: id + ':' + r.id, pj: id }))))) return null;
    if (!(await idb.set('doc:' + id, saved))) return null;
    list.push({ id, name, mode: md, at: saved.at || Date.now(), open: true });
  }
  const g = await idb.get('gif');
  if (g && ((g.slides && g.slides.length) || (g.ovs && g.ovs.length))) {
    const id = uid(); if (!(await idb.set('gif:' + id, g))) return null;
    list.push({ id, name: '움짤', mode: 'gif', at: Date.now() - 1, open: true });
  }
  if (!(await idb.set('projects', list))) return null;
  if (saved && saved.s) { idb.del('kv', 'doc'); if (old.length) idb.clear('imgs'); } // 옮긴 뒤 예전 칸은 비워요
  if (g) idb.del('kv', 'gif');
  return list;
}
async function pjBoot() { // 편집기에 열 작업을 불러와요. 이어서 열었으면 true
  let list = await idb.get('projects');
  if (!Array.isArray(list)) list = (await pjMigrate()) || [];
  projects = list.filter(p => p && p.id);
  const st = (await idb.get('pjState')) || {}, isEd = p => p && p.mode !== 'gif';
  let E = isEd(pjGet(st.ed)) ? pjGet(st.ed) : projects.filter(isEd).sort((a, b) => (b.open - a.open) || (b.at - a.at))[0];
  if (pjGet(st.gif) && pjGet(st.gif).mode === 'gif') gifPj = st.gif;
  const actGif = !!(gifPj && st.act === gifPj && pjGet(gifPj).open);
  if (!E) { E = { id: pjNewId(), name: '새 작품', mode: 'cut', at: Date.now(), open: true }; projects.unshift(E); edPj = E.id; doc = pjBlankDoc('cut'); pjSaveList(true); return { restored: false, actGif }; }
  if (!actGif) E.open = true;
  if (!projects.some(p => p.open)) E.open = true;
  edPj = E.id;
  const imgs = (await idb.byPj(E.id)) || [], saved = await idb.get('doc:' + E.id);
  for (const r of imgs) addImageRecord(r, false);
  let restored = false;
  if (saved && saved.s) {
    try {
      imageOrder = (saved.imageOrder || []).filter(id => images.has(id) && images.get(id).kind !== 'stamp');
      for (const r of imgs) if (r.kind !== 'stamp' && !imageOrder.includes(r.id)) imageOrder.push(r.id);
      doc = normalizeDoc({ ...JSON.parse(saved.s), cur: saved.cur }); restored = true;
    } catch (e) { restored = false; }
  }
  if (!restored) doc = pjBlankDoc(E.mode, E.name);
  pjSaveList(true);
  return { restored, actGif };
}
