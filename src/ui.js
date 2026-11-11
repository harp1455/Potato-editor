/* ================= 화면 틀: 메뉴 막대 · 우클릭 메뉴 · 상태 줄 · 설정 창 · 업데이트 기록 ================= */
// 기능은 원래 자리(도구 줄·오른쪽 칸)에 그대로 있고, 여기서는 그 기능들을 메뉴·우클릭·설정으로 한데 모아요.
const UI_SET0 = { status: true, left: true, right: true, autoUpd: true, theme: '', pvMax: 1920, hw: 'no-preference', vSize: 'first1080', vFps: 30, vFmt: 'mp4', budget: 0, ctxNative: false, snap: true };
const uiSet = Object.assign({}, UI_SET0);
try { Object.assign(uiSet, JSON.parse(localStorage.getItem('potatoSet') || '{}')); } catch (_) { }
const uiSave = () => { try { localStorage.setItem('potatoSet', JSON.stringify(uiSet)); } catch (_) { } };
function uiVidDefaults() { return { size: uiSet.vSize || 'first1080', fps: +uiSet.vFps || 30, fmt: uiSet.vFmt || 'mp4' }; }
const uiVer = () => (window.POTATO_BUILD && window.POTATO_BUILD.version) || '';
const uiMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
const uiK = s => uiMac ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s;
function uiTry(fn) { return (...a) => { try { const r = fn(...a); if (r && r.catch) r.catch(e => { console.warn(e); toast('하지 못했어요 · ' + ((e && e.message) || e), 4000); }); } catch (e) { console.warn(e); toast('하지 못했어요 · ' + ((e && e.message) || e), 4000); } }; }

/* ---- 메뉴 (메뉴 막대·우클릭 모두 이것으로) ---- */
// 항목: { l: 이름, k: 단축키, fn, dis, chk(true/false), sub: [...], danger } · '-' = 구분선 · { h: '머리말' }
let uiMenuStack = [], uiMenuClose = null;
function uiMenuHide() { for (const m of uiMenuStack) m.remove(); uiMenuStack = []; if (uiMenuClose) { const f = uiMenuClose; uiMenuClose = null; f(); } }
function uiMenuOpen(items, x, y, opt = {}) {
  if (!opt.level) uiMenuHide();
  items = items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && a[i - 1] !== '-' && i < a.length - 1));
  if (!items.length) return null;
  const m = document.createElement('div'); m.className = 'uim'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="uim-sep"></div>' : it.h ? `<div class="uim-h">${esc(it.h)}</div>`
    : `<button class="uim-i ${it.danger ? 'danger' : ''} ${it.sub ? 'has' : ''}" role="menuitem" data-i="${i}" ${it.dis ? 'disabled' : ''}><span class="uim-c">${it.chk === true ? '✓' : it.chk === false ? '' : ''}</span><span class="uim-l">${esc(it.l)}</span>${it.k ? `<kbd>${esc(uiK(it.k))}</kbd>` : ''}${it.sub ? '<span class="uim-a">›</span>' : ''}</button>`).join('');
  document.body.appendChild(m); uiMenuStack.push(m);
  const r = m.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  let L = x, T = y; if (L + r.width > vw - 4) L = opt.level ? opt.px - r.width + 2 : vw - r.width - 4; if (T + r.height > vh - 4) T = Math.max(4, vh - r.height - 4);
  m.style.left = Math.max(4, L) + 'px'; m.style.top = Math.max(4, T) + 'px';
  let subT = 0;
  const openSub = (b, it) => {
    const lv = (opt.level || 0) + 1; while (uiMenuStack.length > lv) uiMenuStack.pop().remove();
    if (!it || !it.sub) return; const br = b.getBoundingClientRect();
    uiMenuOpen(typeof it.sub === 'function' ? it.sub() : it.sub, br.right - 2, br.top - 5, { level: lv, px: br.left });
  };
  m.addEventListener('pointerover', e => { const b = e.target.closest('.uim-i'); if (!b || b.disabled) return; clearTimeout(subT); m.querySelectorAll('.uim-i.open').forEach(x => x !== b && x.classList.remove('open')); const it = items[+b.dataset.i]; subT = setTimeout(() => { if (it.sub) b.classList.add('open'); openSub(b, it); }, it.sub ? 60 : 160); });
  m.addEventListener('click', e => {
    const b = e.target.closest('.uim-i'); if (!b || b.disabled) return; const it = items[+b.dataset.i];
    if (it.sub) { b.classList.add('open'); openSub(b, it); return; }
    uiMenuHide(); if (it.fn) uiTry(it.fn)();
  });
  m.addEventListener('contextmenu', e => e.preventDefault());
  return m;
}
document.addEventListener('pointerdown', e => { if (uiMenuStack.length && !e.target.closest('.uim') && !e.target.closest('.mb-i')) uiMenuHide(); }, true);
window.addEventListener('blur', () => uiMenuHide());
window.addEventListener('resize', () => uiMenuHide());
document.addEventListener('keydown', e => {
  if (!uiMenuStack.length) return;
  const m = uiMenuStack[uiMenuStack.length - 1], bs = [...m.querySelectorAll('.uim-i:not(:disabled)')], cur = m.querySelector('.uim-i:focus');
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (uiMenuStack.length > 1) { uiMenuStack.pop().remove(); const p = uiMenuStack[uiMenuStack.length - 1].querySelector('.uim-i.open'); if (p) p.focus(); } else uiMenuHide(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); const i = bs.indexOf(cur), n = e.key === 'ArrowDown' ? (i + 1) % bs.length : (i - 1 + bs.length) % bs.length; if (bs[n]) bs[n].focus(); return; }
  if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && cur) { e.preventDefault(); e.stopPropagation(); if (e.key !== 'ArrowRight' || cur.classList.contains('has')) cur.click(); return; }
  if (e.key === 'ArrowLeft' && uiMenuStack.length > 1) { e.preventDefault(); e.stopPropagation(); uiMenuStack.pop().remove(); return; }
}, true);

/* ---- 자주 쓰는 동작 ---- */
const uiG = a => { const b = document.createElement('b'); b.dataset.g = a; return gsClick({ target: b }); }; // 영상 화면 단추 누르기
const uiGif = () => typeof gifOpen === 'function' && gifOpen();
const uiCz = () => typeof czOpen === 'function' && czOpen();
const uiEd = () => !uiGif() && !uiCz();
const uiPg = () => { try { return page(); } catch (_) { return null; } };
const uiHasPage = () => { const p = uiPg(); return !!(p && !p.ph); };
function uiPaste() {
  if (!clip || !clip.length) { toast('붙여 넣을 요소가 없어요. 그림 파일은 Ctrl+V로 붙여 넣어요'); return; }
  for (const id of clipRefs(clip)) if (!images.has(id) && clipImgs.has(id)) { const { pj, k, ...r } = clipImgs.get(id); addImageRecord({ ...r, kind: isImg() ? 'stamp' : r.kind }, true); }
  const copies = clip.map(o => { const c = clone(o); c.id = uid(); moveBy(c, 24, 24); return c; }); lyCopyGroups(copies, page());
  clip = copies.map(clone); page().els.push(...copies); sel = copies.map(c => c.id); commit(); renderProps(); requestRender();
}
function uiCopy(cut) {
  if (!sel.length) return; const n = clipTake(); if (!n) return;
  try { navigator.clipboard && navigator.clipboard.writeText(CLIP_MARK).catch(() => { }); } catch (_) { }
  if (cut) deleteSel(); toast(`${n}개 ${cut ? '잘라냈어요' : '복사했어요'}`, 1400);
}
const uiLact = a => { const b = document.querySelector(`#layerFoot [data-lact="${a}"]`); if (b && !b.disabled) b.click(); else toast('레이어 탭에서 할 수 있어요'); };
function uiMoveTo(el, p) { if (!el || !p) return; moveBy(el, p.x - (el.x + el.w / 2), p.y - (el.y + el.h / 2)); requestRender(); if (inlEl === el) { closeInline(); openInline(el); } }
function uiPlaceAt(p, make) { make(); const el = sel.length === 1 && findEl(sel[0]); if (el && p) { uiMoveTo(el, p); commit(); } }
async function uiSaveFrame() { // 영상 지금 화면을 PNG로
  const [W, H] = gsSize(), c = newCanvas(W, H); gsRenderAt(c.getContext('2d'), gs.t, W, H);
  const b = await new Promise(r => c.toBlob(r, 'image/png')); if (b && await download(b, `${safeName(gifName())} ${fmtTC(gs.t).replace(/[:.]/g, '-')}.png`)) toast('지금 화면을 PNG로 저장했어요');
}
const uiTheme = t => { uiSet.theme = t; uiSave(); setTheme(t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t); };
function uiPanels() {
  const a = $('#app'); if (!a) return;
  a.classList.toggle('noleft', !uiSet.left); a.classList.toggle('noright', !uiSet.right); a.classList.toggle('nostatus', !uiSet.status);
  window.dispatchEvent(new Event('resize'));
}
function uiFull() { const d = document; if (d.fullscreenElement) d.exitFullscreen().catch(() => { }); else d.documentElement.requestFullscreen().catch(() => toast('전체 화면을 켜지 못했어요')); }
const uiEl = () => sel.length === 1 ? findEl(sel[0]) : null;
const uiTxtEl = () => { const e = uiEl(); return e && (e.type === 'text' || e.type === 'bubble') ? e : null; };
const uiBubbles = () => $$('#menuBubble [data-bubble]').map(b => ({ l: b.textContent.trim(), fn: () => addBubble(b.dataset.bubble) }));
const uiLayers = () => $$('#menuLayer [data-e2l]').map(b => ({ l: b.textContent.trim(), fn: () => e2Layer(b.dataset.e2l), dis: b.disabled }));
const uiSplits = () => $$('#menuSplit [data-split]').map(b => ({ l: b.textContent.trim(), fn: () => b.click(), dis: b.disabled }));

/* ---- 메뉴 막대 ---- */
const UI_MENUS = [
  ['파일', () => [
    { l: '새로 만들기…', fn: () => openNewModal(false) }, { l: '새 영상·움짤 작업', fn: () => pjNewGif() }, { l: '작업 파일 열기…', fn: () => $('#fileProj').click() },
    { l: '저장 (작업 파일로)', k: 'Ctrl+S', fn: saveProject }, '-',
    { l: '그림 넣기…', fn: () => pickFiles(false), dis: !uiEd() }, { l: '폴더째 넣기…', fn: () => pickFiles(true), dis: !uiEd() }, { l: '효과음 팩 넣기…', fn: () => $('#filePack').click(), dis: !uiEd() }, '-',
    { l: '이미지로 내보내기…', fn: openExportModal, dis: !uiEd() }, { l: '영상·움짤 내보내기…', k: uiGif() ? 'Ctrl+M' : '', fn: async () => { if (!uiGif()) await pjOpenGif(); gsExportOpen(); } }, '-',
    { l: '작업 목록…', fn: openProjList }, { l: '설정…', k: 'Ctrl+,', fn: () => uiSettings() },
  ]],
  ['편집', () => uiGif() ? [
    { l: '나누기 (재생 위치에서)', k: 'Ctrl+K', fn: gpSplitAtHead }, { l: '복제', k: 'Ctrl+D', fn: gpDup }, { l: '지우기', k: 'Delete', fn: gpDelete, danger: true }, '-',
    { l: '모든 장면 고르기', fn: () => { gs.pick = new Set(gs.slides.map(s => s.id)); gs.focus = 'scene'; if (gs.sel < 0) gs.sel = 0; gsChanged(); } },
  ] : [
    { l: '되돌리기', k: 'Ctrl+Z', fn: undo }, { l: '다시 하기', k: 'Ctrl+Y', fn: redo }, '-',
    { l: '잘라내기', k: 'Ctrl+X', fn: () => uiCopy(true), dis: !sel.length }, { l: '복사', k: 'Ctrl+C', fn: () => uiCopy(false), dis: !sel.length }, { l: '붙여넣기', k: 'Ctrl+V', fn: uiPaste, dis: !(clip && clip.length) },
    { l: '복제', k: 'Ctrl+D', fn: duplicateSel, dis: !sel.length }, { l: '지우기', k: 'Delete', fn: deleteSel, dis: !sel.length, danger: true }, '-',
    { l: '모두 고르기', k: 'Ctrl+A', fn: () => { sel = page().els.filter(x => !x.lock).map(x => x.id); renderProps(); requestRender(); } }, { l: '고르기 풀기', k: 'Esc', fn: () => { sel = []; renderProps(); requestRender(); }, dis: !sel.length }, '-',
    { l: '순서', sub: uiOrderItems, dis: !sel.length }, { l: '묶기', k: 'Ctrl+G', fn: lyGroup, dis: sel.length < 2 }, { l: '묶음 풀기', k: 'Ctrl+Shift+G', fn: lyUngroup, dis: !sel.length },
  ]],
  ['보기', () => [
    ...(uiEd() ? [{ l: '확대', k: 'Ctrl++', fn: () => zoomStep(1) }, { l: '축소', k: 'Ctrl+-', fn: () => zoomStep(-1) }, { l: '화면에 맞추기', k: 'Ctrl+0', fn: fitView }, '-'] : []),
    { l: '왼쪽 패널', chk: !!uiSet.left, fn: () => { uiSet.left = !uiSet.left; uiSave(); uiPanels(); } }, { l: '오른쪽 속성 칸', chk: !!uiSet.right, fn: () => { uiSet.right = !uiSet.right; uiSave(); uiPanels(); } },
    { l: '아래 상태 줄', chk: !!uiSet.status, fn: () => { uiSet.status = !uiSet.status; uiSave(); uiPanels(); } }, { l: '속성 칸 모두 펼치기', fn: () => { uiFolds.clear(); uiFoldSave(); uiFoldApply(); } }, '-',
    { l: '자석', chk: snapOn, fn: () => { const t = $('#snapTgl'); t.checked = !t.checked; t.dispatchEvent(new Event('change')); } },
    { l: '화면 밝기', sub: () => [{ l: '밝게', chk: !isDark() && uiSet.theme !== 'system', fn: () => uiTheme('light') }, { l: '어둡게', chk: isDark() && uiSet.theme !== 'system', fn: () => uiTheme('dark') }, { l: '컴퓨터 설정 따르기', chk: uiSet.theme === 'system', fn: () => uiTheme('system') }] },
    { l: '전체 화면', k: 'F11', fn: uiFull },
  ]],
  ['넣기', () => uiGif() ? [
    { l: '장면 (사진·GIF·영상)…', fn: () => $('#gsFile').click() }, { l: '글자', k: 'T', fn: () => uiG('ov-add') }, { l: '소리…', fn: () => auPick() },
  ] : [
    { l: '컷', fn: addPanel, dis: isImg() }, { l: '말풍선', sub: uiBubbles }, { l: '글자', fn: () => addText() }, { l: '도형', fn: () => setMode('shape') }, '-',
    { l: '레이어', sub: uiLayers }, { l: '그림 레이어…', fn: () => e2Layer('img'), dis: !isImg() }, { l: '그림 넣기…', fn: () => pickFiles(false) },
  ]],
  ['도구', () => [
    { l: '고르기 (도구 끄기)', k: 'Esc', fn: () => setMode(null), chk: !mode }, '-',
    { l: '선택', fn: () => setMode('select'), chk: mode === 'select' }, { l: '가리기·고치기 붓', fn: () => setMode('brush'), chk: mode === 'brush' }, { l: '펜', fn: () => setMode('pen'), chk: mode === 'pen' }, { l: '도형', fn: () => setMode('shape'), chk: mode === 'shape' }, '-',
    { l: '자르기', fn: () => setMode('crop'), dis: !isImg(), chk: mode === 'crop' }, { l: '자유 변형', k: 'Ctrl+T', fn: e2XfToggle, dis: !isImg() }, { l: '뒤틀기…', k: 'Ctrl+Shift+X', fn: lqOpen, dis: !isImg() }, '-',
    { l: '컷 나누기', sub: uiSplits, dis: isImg() }, { l: '자동 배치…', fn: openAutoLayout, dis: isImg() }, { l: '자동 흰칠', fn: openCzMenu },
  ].map(x => x === '-' ? x : Object.assign(x, { dis: x.dis || !uiEd() }))],
  ['AI', () => [
    { l: '자동 흰칠', fn: openCzMenu, dis: !uiEd() }, { l: '페이지 번역…', fn: trOpen, dis: !isImg() || !uiEd() }, { l: '고른 대사 AI 번역·다듬기…', fn: aiTxEl, dis: !uiTxtEl() || !uiEd() },
    { l: '페이지 말풍선 모두 번역…', fn: () => aiTxPages(false), dis: isImg() || !uiEd() }, '-',
    { l: 'AI 더빙…', fn: () => uiTxtEl() && uiEd() ? dbFromEl() : dbOpen() }, { l: 'AI 영상 만들기…', fn: () => uiGif() ? vgFromScene() : vgFromImage(), dis: uiGif() ? !gs.slides[gs.sel] : !isImg() }, { l: '캐릭터 움직이기 (뼈대)…', fn: () => uiGif() ? rgFromScene() : rgFromImage(), dis: uiGif() ? !gs.slides[gs.sel] : !isImg() }, '-',
    { l: 'API 사용 내역…', fn: apiOpenLog }, { l: 'AI 설정·팩 관리…', fn: () => uiSettings('ai') },
  ]],
  ['영상', () => [
    { l: uiGif() ? '편집기로 돌아가기' : '영상·움짤 편집 열기', fn: () => uiGif() ? pjBackToEditor() : pjOpenGif() }, { l: '새 영상·움짤 작업', fn: () => pjNewGif() }, '-',
    { l: '재생 / 멈춤', k: uiGif() ? 'Space' : '', fn: () => gs.playing ? gsPause() : gsPlay(), dis: !uiGif() }, { l: '처음으로', k: 'Home', fn: () => gpSeek(0), dis: !uiGif() }, { l: '지금 화면을 PNG로 저장', fn: uiSaveFrame, dis: !uiGif() || !gs.slides.length }, '-',
    { l: '시퀀스 설정 (해상도·프레임)', fn: async () => { if (!uiGif()) await pjOpenGif(); gs.focus = 'set'; gs.sel = gs.sel; gsChanged(); } }, { l: '내보내기 (MP4·GIF·WebP)…', k: 'Ctrl+M', fn: async () => { if (!uiGif()) await pjOpenGif(); gsExportOpen(); } }, '-',
    { l: 'AI 중간 장면 (부드럽게 잇기)…', fn: async () => { if (!uiGif()) await pjOpenGif(); riOpen(gs.pick.size > 1 ? 'pick' : 'all', gs.sel); } }, { l: 'AI 더빙…', fn: () => dbOpen() }, { l: '영상 기본값·미리보기 설정…', fn: () => uiSettings('video') },
  ]],
  ['도움말', () => [
    { l: '사용법', k: 'F1', fn: openHelp }, { l: '단축키', fn: () => uiSettings('keys') }, { l: '업데이트 기록', fn: () => uiChangelog() }, '-',
    { l: '업데이트 확인', fn: () => checkUpdate(true), dis: !appApi() }, { l: `감자 편집기 ${uiVer()}`, fn: () => uiSettings('about') },
  ]],
];
function uiOrderItems() { return [{ l: '맨 앞으로', fn: () => doAct('front') }, { l: '앞으로', fn: () => doAct('forward') }, { l: '뒤로', fn: () => doAct('backward') }, { l: '맨 뒤로', fn: () => doAct('back') }]; }
let uiMbOpen = null, uiMbAt = 0;
function uiMenubar() {
  const bar = $('#menubar'); if (!bar) return;
  bar.innerHTML = `<span class="mb-logo" title="감자 편집기 ${esc(uiVer())}"><svg width="16" height="16" viewBox="0 0 22 22" aria-hidden="true"><path d="M5.2 4.6C7.9 1.9 13.6 1.5 17 4.3c3.3 2.7 3.6 7.9 1.3 11.4-2.4 3.7-7.7 5.6-11.5 4C2.9 18.1 1.4 13 2.4 9.3c.5-1.9 1.4-3.4 2.8-4.7z" fill="#e8b866" stroke="#8a5a1f" stroke-width="1.3"/></svg></span>` + UI_MENUS.map(([n], i) => `<button class="mb-i" data-mb="${i}" role="menuitem">${n}</button>`).join('');
  const open = b => {
    const i = +b.dataset.mb, r = b.getBoundingClientRect(); uiMenuHide();
    $$('.mb-i', bar).forEach(x => x.classList.toggle('on', x === b)); uiMbOpen = i; uiMbAt = performance.now();
    uiMenuOpen(UI_MENUS[i][1](), r.left, r.bottom + 2); uiMenuClose = () => { uiMbOpen = null; $$('.mb-i', bar).forEach(x => x.classList.remove('on')); };
  };
  bar.addEventListener('click', e => { const b = e.target.closest('.mb-i'); if (!b) return; if (uiMbOpen === +b.dataset.mb) { if (performance.now() - uiMbAt > 350) uiMenuHide(); return; } if (modalOpen()) closeModal(); open(b); });
  bar.addEventListener('pointerover', e => { const b = e.target.closest('.mb-i'); if (b && uiMbOpen != null && uiMbOpen !== +b.dataset.mb) open(b); });
}

/* ---- 우클릭 메뉴 ---- */
function uiCtxEditor(e) {
  const p = toPage(e);
  if (mode) return [{ h: '도구 사용 중' }, { l: '도구 끝내기', k: 'Esc', fn: () => setMode(null) }, ...(mode === 'select' ? [{ l: '선택 되돌리기', k: 'Ctrl+Z', fn: () => selUndo() }] : [])];
  const hit = hitTest(p);
  if (hit && !sel.includes(hit.id)) { sel = [hit.id]; renderProps(); requestRender(); }
  if (!hit && sel.length && !selEls().some(o => hitEl(o, p))) { sel = []; renderProps(); requestRender(); }
  const ss = selEls(), el = ss.length === 1 ? ss[0] : null, T = { panel: '컷', bubble: '말풍선', text: '글자', shape: '도형', pen: '펜 그림', stamp: '그림' };
  const pasteOk = !!(clip && clip.length);
  if (!ss.length) return [
    { l: '붙여넣기', k: 'Ctrl+V', fn: uiPaste, dis: !pasteOk },
    { l: '여기에 글자 넣기', fn: () => uiPlaceAt(p, () => addText()) }, { l: '여기에 말풍선 넣기', sub: () => uiBubbles().map(b => ({ l: b.l, fn: () => uiPlaceAt(p, b.fn) })) },
    ...(!isImg() ? [{ l: '여기에 컷 넣기', fn: () => uiPlaceAt(p, addPanel) }] : []), { l: '레이어 넣기', sub: uiLayers }, '-',
    { l: '모두 고르기', k: 'Ctrl+A', fn: () => { sel = page().els.filter(x => !x.lock).map(x => x.id); renderProps(); requestRender(); } },
    { l: '화면에 맞추기', k: 'Ctrl+0', fn: fitView }, { l: '확대', k: 'Ctrl++', fn: () => zoomStep(1) }, { l: '축소', k: 'Ctrl+-', fn: () => zoomStep(-1) },
    ...(isImg() && uiHasPage() ? ['-', { l: '자르기', fn: () => setMode('crop') }, { l: '자유 변형 (바탕)', k: 'Ctrl+T', fn: e2XfToggle }, { l: '뒤틀기…', fn: lqOpen }, { l: '캐릭터 움직이기 (뼈대)…', fn: rgFromImage }, { l: '페이지 번역…', fn: trOpen }, { l: 'AI 영상 만들기…', fn: vgFromImage }, { l: '영상·움짤 장면으로 보내기', fn: () => uiPageToGif(doc.cur) }] : []),
    '-', { l: '되돌리기', k: 'Ctrl+Z', fn: undo }, { l: '다시 하기', k: 'Ctrl+Y', fn: redo },
  ];
  const txt = el && (el.type === 'text' || el.type === 'bubble');
  return [
    { h: ss.length > 1 ? `${ss.length}개 고름` : (el.name || T[el.type] || '요소') },
    ...(txt ? [{ l: '글자 고치기', k: 'Enter', fn: () => openInline(el) }, { l: 'AI 번역·다듬기…', fn: aiTxEl }, { l: 'AI 더빙…', fn: dbFromEl }, ...(el.type === 'text' ? [{ l: '내 글자 스타일로 저장…', fn: () => myStyleSaveFrom(el) }] : []), '-'] : []),
    { l: '잘라내기', k: 'Ctrl+X', fn: () => uiCopy(true) }, { l: '복사', k: 'Ctrl+C', fn: () => uiCopy(false) }, { l: '붙여넣기', k: 'Ctrl+V', fn: uiPaste, dis: !pasteOk }, { l: '복제', k: 'Ctrl+D', fn: duplicateSel }, '-',
    { l: '순서', sub: uiOrderItems }, { l: '묶기', k: 'Ctrl+G', fn: lyGroup, dis: ss.length < 2 }, { l: '묶음 풀기', k: 'Ctrl+Shift+G', fn: lyUngroup, dis: !ss.some(o => o.gid) },
    { l: '고른 것 합치기', fn: lyMergeSel, dis: ss.length < 2 }, { l: '아래와 합치기', fn: lyMergeDown, dis: ss.length !== 1 }, '-',
    { l: '숨기기', fn: () => { for (const o of ss) o.hidden = true; sel = []; commit(); renderProps(); renderLayers(); requestRender(); } },
    { l: ss.every(o => o.ulock) ? '잠금 풀기' : '잠그기 (화면에서 안 눌려요)', fn: () => { const on = !ss.every(o => o.ulock); for (const o of ss) { if (on) o.ulock = true; else delete o.ulock; } sel = []; commit(); renderProps(); renderLayers(); requestRender(); } },
    ...(el ? [{ l: '이름 바꾸기…', fn: async () => { const n = await askText('레이어 이름', el.name || T[el.type] || '', '바꾸기'); if (n == null) return; if (n.trim()) el.name = n.trim().slice(0, 30); else delete el.name; commit(); renderLayers(); } }] : []),
    '-', { l: '지우기', k: 'Delete', fn: deleteSel, danger: true },
  ];
}
async function uiPageToGif(i) { // 이미지 편집 그림을 보이는 그대로 영상 장면으로
  const pg = doc.pages[i]; if (!pg || pg.ph) return;
  const c = newCanvas(Math.round(pg.w), Math.round(pg.h)); drawPage(c.getContext('2d'), pg, { screen: false, rs: 1, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } });
  const b = await new Promise(r => c.toBlob(r, 'image/png')); await pjOpenGif(); await gsAddFiles([new File([b], (pg.name || '그림').replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' })]); toast('영상·움짤 화면에 장면으로 넣었어요');
}
function uiCtxLib(t) {
  const fo = t.closest('.fold'); if (fo && fo.dataset.fold) { const id = fo.dataset.fold; return [{ h: '폴더' }, { l: '하위 폴더 만들기', fn: () => newFolder(id) }, { l: '이름 바꾸기…', fn: () => renameFolder(id) }, '-', { l: '폴더 지우기', fn: () => deleteFolder(id), danger: true }]; }
  const pt = t.closest('[data-page]'); if (pt) { const i = +pt.dataset.page; return [{ h: (doc.pages[i] && doc.pages[i].name) || '그림' }, { l: '열기', fn: () => gotoPage(i) }, { l: '영상·움짤 장면으로 보내기', fn: () => uiPageToGif(i) }, { l: '페이지 번역…', fn: () => { gotoPage(i); trOpen(); } }, { l: 'AI 영상 만들기…', fn: () => { gotoPage(i); vgFromImage(); } }, '-', { l: '목록에서 빼기', fn: () => deleteImagePage(i), danger: true }]; }
  const th = t.closest('.thumb[data-id]'); if (th) { const id = th.dataset.id, r = images.get(id); return [{ h: r ? r.name : '그림' }, { l: '넣기', fn: () => placeImage(id) }, { l: '고르기 표시', fn: () => { marks = marks.includes(id) ? marks.filter(x => x !== id) : [...marks, id]; renderLib(); } }, { l: '영상·움짤 장면으로 보내기', fn: async () => { const b = await (await fetch(r.src)).blob(); await pjOpenGif(); await gsAddFiles([new File([b], r.name || 'image.png', { type: b.type || 'image/png' })]); } }, '-', { l: '보관함에서 빼기', fn: () => removeImage(id), danger: true }]; }
  return [{ l: '그림 넣기…', fn: () => pickFiles(false) }, { l: '폴더째 넣기…', fn: () => pickFiles(true) }, { l: '새 폴더', fn: () => newFolder(null) }];
}
function uiCtxLayer(t) {
  const row = t.closest('.lyr'); if (!row) return null;
  const id = row.dataset.lid, el = id && findEl(id);
  if (el && !sel.includes(id)) { sel = [id]; renderProps(); renderLayers(); requestRender(); }
  return [
    { l: '이름 바꾸기…', fn: () => uiLact('rename') }, { l: '복제', k: 'Ctrl+D', fn: () => uiLact('dup') }, '-',
    { l: '위로', fn: () => uiLact('up') }, { l: '아래로', fn: () => uiLact('down') }, '-',
    { l: el && el.hidden ? '보이기' : '숨기기', fn: () => { const ss = selEls(); const h = !(el && el.hidden); for (const o of ss) { if (h) o.hidden = true; else delete o.hidden; } commit(); renderLayers(); requestRender(); } },
    { l: el && el.ulock ? '잠금 풀기' : '잠그기', fn: () => { const on = !(el && el.ulock); for (const o of selEls()) { if (on) o.ulock = true; else delete o.ulock; } commit(); renderLayers(); requestRender(); } }, '-',
    { l: '묶기', k: 'Ctrl+G', fn: lyGroup, dis: sel.length < 2 }, { l: '묶음 풀기', fn: lyUngroup }, { l: '고른 것 합치기', fn: lyMergeSel, dis: sel.length < 2 }, { l: '아래와 합치기', fn: lyMergeDown }, { l: '모두 보이기', fn: () => uiLact('showall') }, '-',
    { l: '지우기', k: 'Delete', fn: () => uiLact('del'), danger: true },
  ];
}
function uiCtxPages(t) {
  const it = t.closest('.pg[data-pg]'); if (!it) return null; switchPage(+it.dataset.pg);
  return [{ l: '새 페이지 (뒤에)', fn: () => pageCmd('page-add') }, { l: '복제', fn: () => pageCmd('page-dup') }, '-', { l: '위로', fn: () => pageCmd('page-up') }, { l: '아래로', fn: () => pageCmd('page-down') }, '-', { l: '지우기', fn: () => pageCmd('page-del'), danger: true }];
}
function uiCtxTabs(t) {
  const tb = t.closest('.ptab[data-pj]'); if (!tb) return [{ l: '새 탭…', fn: () => openNewModal(false) }, { l: '작업 목록…', fn: openProjList }];
  const id = tb.dataset.pj, open = projects.filter(p => p.open), i = open.findIndex(p => p.id === id);
  const closeMany = async list => { for (const p of list) if (projects.filter(q => q.open).length > 1) await pjClose(p.id); };
  return [{ l: '이 탭으로', fn: () => pjSwitch(id), dis: id === pjActive() }, { l: '이름 바꾸기', fn: () => pjTabRename(tb) }, '-',
    { l: '닫기', fn: () => pjClose(id), dis: open.length <= 1 }, { l: '다른 탭 모두 닫기', fn: () => closeMany(open.filter(p => p.id !== id)), dis: open.length <= 1 }, { l: '오른쪽 탭 모두 닫기', fn: () => closeMany(open.slice(i + 1)), dis: i >= open.length - 1 }, '-',
    { l: '새 탭…', fn: () => openNewModal(false) }, { l: '작업 목록…', fn: openProjList }];
}
function uiCtxGif(t) {
  const trE = t.closest('.gp-tr[data-ti], .gp-cut[data-ti]');
  if (trE) { const i = +trE.dataset.ti; gpSelTr(i); return [{ h: `${i}번과 ${i + 1}번 장면 사이` }, { l: '넘김 고르기 (오른쪽 칸)', fn: () => gpSelTr(i) }, { l: '서서히 바뀌기', fn: () => { gs.slides[i].tr = 'fade'; gsChanged(); } }, { l: '바로 넘기기 (넘김 없애기)', fn: () => { gs.slides[i].tr = 'none'; gsChanged(); } }, { l: '이 넘김을 모든 장면 사이에', fn: () => uiG('tr-all') }, '-', { l: 'AI 중간 장면으로 잇기…', fn: () => riOpen('one', i - 1) }]; }
  const clipE = t.closest('.gp-clip[data-ci]'), bar = t.closest('.gp-bar[data-bk]'), stage = t.closest('#gsStage'), tl = t.closest('.gp-tl, #gpScroll');
  const base = [{ l: '재생 / 멈춤', k: 'Space', fn: () => gs.playing ? gsPause() : gsPlay() }];
  if (clipE) {
    const i = +clipE.dataset.ci, s = gs.slides[i]; if (!s) return null;
    if (!gs.pick.has(s.id)) { gs.pick = new Set(); } gs.sel = i; gs.focus = 'scene'; gsChanged();
    const st = gsStarts(); const many = gs.pick.size > 1;
    return [{ h: many ? `장면 ${gs.pick.size}개` : `장면 ${i + 1} · ${(s.name || '').slice(0, 24)}` },
      { l: '이 장면 처음으로 가기', fn: () => gpSeek(st[i]) }, { l: '재생 위치에서 나누기', k: 'Ctrl+K', fn: gpSplitAtHead }, { l: '복제', k: 'Ctrl+D', fn: gpDup }, '-',
      { l: '장면 길이', sub: () => [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5].map(d => ({ l: d + '초', chk: Math.abs(gsDur(s) - d) < 1e-3, fn: () => { for (const x of many ? gs.slides.filter(y => gs.pick.has(y.id)) : [s]) x.dur = d; gsChanged(); } })) },
      { l: '장면 넘김 없애기', fn: () => { s.tr = 'none'; gsChanged(); }, dis: i === 0 },
      '-', { l: 'AI 중간 장면 (다음 장면과 잇기)…', fn: () => riOpen(many ? 'pick' : s.clip && gs.slides.filter(x => x.clip === s.clip).length > 1 ? 'clip' : 'one', i), dis: i >= gs.slides.length - 1 && !many }, { l: 'AI 영상으로 바꾸기…', fn: vgFromScene }, { l: '입체 움직임 (AI 깊이)…', fn: dpParaFromScene }, { l: s.rig ? '캐릭터 움직임 다시 고치기…' : '캐릭터 움직이기 (뼈대)…', fn: rgFromScene }, { l: '지금 화면을 PNG로 저장', fn: uiSaveFrame },
      '-', { l: '지우기', k: 'Delete', fn: gpDelete, danger: true }];
  }
  if (bar) {
    const k = bar.dataset.bk, id = bar.dataset.id, L = k === 'o' ? gs.ovs : k === 'f' ? gs.fx : gs.au, x = L.find(y => y.id === id); if (!x) return null;
    if (k === 'o') { gs.osel = id; gs.focus = 'ov'; } else if (k === 'f') { gs.fsel = id; gs.focus = 'fx'; } else { gs.asel = id; gs.focus = 'au'; }
    gsChanged();
    const name = k === 'o' ? '글자' : k === 'f' ? '효과' : '소리';
    return [{ h: name }, { l: '시작으로 가기', fn: () => gpSeek(x.t0 || 0) }, { l: '재생 위치에서 나누기', k: 'Ctrl+K', fn: gpSplitAtHead }, { l: '복제', k: 'Ctrl+D', fn: gpDup },
      { l: x.hidden ? '보이기' : '숨기기 (끄기)', fn: () => { x.hidden = !x.hidden; if (!x.hidden) delete x.hidden; gsChanged(); } },
      ...(k === 'o' && x.kind !== 'image' ? ['-', { l: 'AI 번역·다듬기…', fn: () => aiTxGs('ov-ai') }, { l: 'AI 더빙…', fn: dbFromOv }] : []),
      '-', { l: '지우기', k: 'Delete', fn: gpDelete, danger: true }];
  }
  if (stage) return [...base, { l: '처음으로', k: 'Home', fn: () => gpSeek(0) }, { l: '지금 화면을 PNG로 저장', fn: uiSaveFrame, dis: !gs.slides.length }, '-', { l: '장면 넣기…', fn: () => $('#gsFile').click() }, { l: '시퀀스 설정…', fn: () => { gs.focus = 'set'; gsChanged(); } }, { l: '내보내기…', k: 'Ctrl+M', fn: gsExportOpen, dis: !gs.slides.length }];
  if (tl) return [...base, { l: '재생 위치에 글자 넣기', k: 'T', fn: () => uiG('ov-add') }, { l: '소리 넣기…', fn: () => auPick() }, { l: '장면 넣기…', fn: () => $('#gsFile').click() }, '-', { l: '전체 보기', k: '\\', fn: () => uiG('zoom-fit') }];
  return null;
}
document.addEventListener('contextmenu', e => {
  const t = e.target;
  if (t.closest('input, textarea, [contenteditable="true"], select')) return; // 글 쓰는 칸은 원래 메뉴 (붙여넣기 등)
  if (uiSet.ctxNative && e.shiftKey) return;
  let items = null;
  try {
    if (t.closest('.modal-bg')) { e.preventDefault(); return; }
    if (t.closest('#menubar')) { e.preventDefault(); return; }
    if (t.closest('#ptabs')) items = uiCtxTabs(t);
    else if (uiGif() && t.closest('#gifStudio')) items = uiCtxGif(t);
    else if (t.closest('#lib')) items = uiCtxLib(t);
    else if (t.closest('#layers')) items = uiCtxLayer(t);
    else if (t.closest('#pages')) items = uiCtxPages(t);
    else if (t.closest('#scroller') && uiEd() && uiHasPage()) items = uiCtxEditor(e);
  } catch (err) { console.warn(err); }
  e.preventDefault();
  if (!items) items = [{ l: '되돌리기', k: 'Ctrl+Z', fn: undo, dis: uiGif() }, { l: '다시 하기', k: 'Ctrl+Y', fn: redo, dis: uiGif() }, '-', { l: '설정…', k: 'Ctrl+,', fn: () => uiSettings() }, { l: '사용법', k: 'F1', fn: openHelp }];
  uiMenuOpen(items, e.clientX + 1, e.clientY + 1);
});

/* ---- 상태 줄 ---- */
let uiMouse = null;
function uiStatus() {
  const s = $('#status'); if (!s || !uiSet.status || uiGif()) return;
  const p = uiPg(), ss = (() => { try { return selEls(); } catch (_) { return []; } })(), T = { panel: '컷', bubble: '말풍선', text: '글자', shape: '도형', pen: '펜', stamp: '그림' };
  const MODE = { select: '선택', brush: '가리기 붓', pen: '펜', shape: '도형', crop: '자르기', split: '컷 나누기', mask: '마스크', level: '수평' };
  const L = [];
  L.push(`<b>${uiCz() ? '자동 흰칠' : (PJ_MODE[doc.mode] || '편집')}</b>`);
  if (p && !p.ph) {
    if (isImg()) { const all = realIdx(), k = all.indexOf(doc.cur); L.push(`그림 ${k + 1} / ${all.length}`); } else L.push(`페이지 ${doc.cur + 1} / ${doc.pages.length}`);
    L.push(`${Math.round(p.w)} × ${Math.round(p.h)}`);
  }
  if (mode) L.push(`도구: ${MODE[mode] || mode}`);
  if (ss.length) L.push(ss.length === 1 ? `고름: ${ss[0].name || T[ss[0].type] || '요소'} ${Math.round(ss[0].w)}×${Math.round(ss[0].h)}` : `고름: ${ss.length}개`);
  if (uiMouse) L.push(`x ${Math.round(uiMouse.x)} · y ${Math.round(uiMouse.y)}`);
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), mon = apiLog.filter(j => j.at >= m0).reduce((a, j) => a + (j.usd || 0), 0);
  const R = [];
  const sv = $('#saveState'); if (sv && sv.textContent) R.push(esc(sv.textContent));
  R.push(`<button class="st-b" data-st="zoom" title="화면에 맞추기">${Math.round(zoom * 100)}%</button>`);
  R.push(`<button class="st-b ${uiSet.budget && mon > uiSet.budget ? 'warn' : ''}" data-st="api" title="이번 달 제미나이 API 사용 금액 (누르면 내역)">API ${mon ? apiFmt(mon, true) : '$0'}${uiSet.budget ? ` / $${uiSet.budget}` : ''}</button>`);
  R.push(`<button class="st-b" data-st="ver" title="업데이트 기록">v${esc(uiVer())}</button>`);
  const html = `<span class="st-l">${L.map(x => `<span>${x}</span>`).join('')}</span><span class="st-r">${R.map(x => `<span>${x}</span>`).join('')}</span>`;
  if (s._h !== html) { s._h = html; s.innerHTML = html; }
}
document.addEventListener('pointermove', e => { if (!uiSet.status) return; const sc = $('#scroller'); if (sc && e.target.closest && e.target.closest('#scroller') && uiHasPage()) { try { uiMouse = toPage(e); } catch (_) { } } else if (uiMouse) uiMouse = null; }, { passive: true });
setInterval(uiStatus, 400);

/* ---- 오른쪽 속성 칸 제목 눌러 접기 ---- */
const uiFolds = new Set(); try { for (const x of JSON.parse(localStorage.getItem('potatoFold') || '[]')) uiFolds.add(x); } catch (_) { }
const uiFoldSave = () => { try { localStorage.setItem('potatoFold', JSON.stringify([...uiFolds].slice(-200))); } catch (_) { } };
const uiFoldKey = h => (h.closest('#gsProps') ? 'g:' : 'e:') + h.textContent.trim().slice(0, 40);
function uiFoldApply() { $$('#props .sec > h3, #gsProps .sec > h3').forEach(h => { h.classList.add('foldh'); h.parentElement.classList.toggle('folded', uiFolds.has(uiFoldKey(h))); }); }
document.addEventListener('click', e => {
  const h = e.target.closest('#props .sec > h3, #gsProps .sec > h3'); if (!h || e.target.closest('button, input, select, label, a')) return;
  const k = uiFoldKey(h); uiFolds.has(k) ? uiFolds.delete(k) : uiFolds.add(k); uiFoldSave(); h.parentElement.classList.toggle('folded', uiFolds.has(k));
});
{ let q = 0; const mo = new MutationObserver(() => { if (!q) q = requestAnimationFrame(() => { q = 0; uiFoldApply(); }); }); const watch = () => { for (const id of ['props', 'gsProps']) { const el = document.getElementById(id); if (el && !el._uiw) { el._uiw = 1; mo.observe(el, { childList: true }); } } }; watch(); setInterval(watch, 2000); }

/* ---- 업데이트 기록 ---- */
const UI_TAG = { '새': ['new', '새 기능'], '개선': ['imp', '개선'], '고침': ['fix', '고침'] };
function uiNotesHtml(body) { // 업데이트 알림 창: 릴리스 노트(첫 줄 = 제목, '- ' = 항목)
  const lines = String(body || '').split('\n').map(s => s.trim()).filter(Boolean); if (!lines.length) return '';
  const items = [], rest = []; let title = '';
  for (const l of lines) { if (l.startsWith('- ')) items.push(l.slice(2)); else if (!title && !items.length) title = l; else rest.push(l); }
  return `<div class="upnotes">${title ? `<b>${esc(title)}</b>` : ''}${items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${rest.length ? `<p class="muted small">${esc(rest.join(' '))}</p>` : ''}</div>`;
}
function uiChangelog(opt = {}) {
  const C = window.POTATO_CHANGES || [], cur = uiVer(); if (!C.length) { toast('업데이트 기록이 없어요'); return; }
  let pick = opt.v || C[0].v, q = '', kind = '';
  const m = modal(`<h2>${opt.updated ? `${esc(cur)}로 업데이트됐어요` : '업데이트 기록'}</h2><p class="sub">${opt.updated ? '이번 버전에서 바뀐 점이에요. 나중에 도움말 → 업데이트 기록에서 다시 볼 수 있어요.' : '버전마다 새로 생긴 기능·나아진 점·고친 점이에요.'}</p>
    <div class="cl-bar"><input type="search" id="clQ" placeholder="찾기 (예: 더빙, 번역, MP4)" spellcheck="false"><span class="seg" id="clK"><button class="btn sm on" data-k="">모두</button><button class="btn sm" data-k="new">새 기능</button><button class="btn sm" data-k="imp">개선</button><button class="btn sm" data-k="fix">고침</button></span></div>
    <div class="cl"><nav class="cl-nav" id="clNav"></nav><div class="cl-main" id="clMain"></div></div>
    <div class="foot">${appApi() ? '<button class="btn" id="clUpd">업데이트 확인</button>' : ''}<span class="flex1"></span><button class="btn primary" data-close>닫기</button></div>`, { wide: true });
  m.style.width = 'min(980px, 100%)';
  const tagOf = it => UI_TAG[it.t] || ['etc', it.t || '변경'];
  const card = c => { const its = c.items.filter(it => (!kind || tagOf(it)[0] === kind) && (!q || it.s.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))); if (!its.length) return '';
    return `<section class="cl-ver ${c.v === cur ? 'now' : ''}" id="clv-${c.v.replace(/\./g, '-')}"><header><b>${esc(c.v)}</b>${c.v === cur ? '<span class="cl-now">지금 버전</span>' : ''}<span class="muted small">${esc(c.date)}</span></header><h4>${esc(c.title)}</h4>
      <ul>${its.map(it => { const [k, n] = tagOf(it); return `<li><span class="cl-tag ${k}">${esc(n)}</span><span>${esc(it.s)}</span></li>`; }).join('')}</ul></section>`; };
  const draw = () => {
    const vis = q || kind ? C : C.filter(c => c.v === pick);
    $('#clNav', m).innerHTML = C.map(c => `<button class="${c.v === pick && !q && !kind ? 'on' : ''}" data-v="${esc(c.v)}"><b>${esc(c.v)}</b><span>${esc(c.title)}</span></button>`).join('');
    const h = vis.map(card).join(''); $('#clMain', m).innerHTML = h || '<p class="muted" style="padding:20px">찾는 내용이 없어요.</p>';
  };
  draw();
  $('#clNav', m).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; pick = b.dataset.v; q = ''; kind = ''; $('#clQ', m).value = ''; $$('#clK [data-k]', m).forEach(x => x.classList.toggle('on', !x.dataset.k)); draw(); $('#clMain', m).scrollTop = 0; });
  $('#clQ', m).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
  $$('#clK [data-k]', m).forEach(b => b.addEventListener('click', () => { kind = b.dataset.k; $$('#clK [data-k]', m).forEach(x => x.classList.toggle('on', x === b)); draw(); }));
  const u = $('#clUpd', m); if (u) u.addEventListener('click', () => { closeModal(); checkUpdate(true); });
}
function uiAfterUpdate(n = 0) { // 업데이트하고 처음 켰을 때 바뀐 점 보여 주기
  const cur = uiVer(); if (!cur) return; let seen = null; try { seen = localStorage.getItem('potatoSeenVer'); } catch (_) { }
  if (seen === cur) return;
  if (!seen) { try { localStorage.setItem('potatoSeenVer', cur); } catch (_) { } return; } // 처음 설치
  if (modalOpen()) { if (n < 20) setTimeout(() => uiAfterUpdate(n + 1), 3000); return; }
  try { localStorage.setItem('potatoSeenVer', cur); } catch (_) { }
  uiChangelog({ updated: true });
}

/* ---- 설정 창 ---- */
const UI_SECS = [['general', '일반·화면'], ['edit', '편집'], ['video', '영상·움짤'], ['ai', 'AI와 API'], ['packs', 'AI 처리 팩'], ['storage', '저장 공간'], ['keys', '단축키'], ['about', '정보·업데이트']];
const UI_KEYS = [['공통', [['Ctrl+Z / Ctrl+Y', '되돌리기 / 다시 하기'], ['Ctrl+S', '작업 파일로 저장'], ['Ctrl+,', '설정'], ['F1', '사용법'], ['F11', '전체 화면'], ['우클릭', '그 자리에서 할 수 있는 일 메뉴 (Shift+우클릭 = 브라우저 메뉴, 설정에서 켜면)']]],
  ['편집기', [['Ctrl+C / X / V', '복사 / 잘라내기 / 붙여넣기'], ['Ctrl+D', '복제'], ['Delete', '지우기'], ['Ctrl+A', '모두 고르기'], ['Ctrl+G / Ctrl+Shift+G', '묶기 / 묶음 풀기'], ['Enter', '고른 글자·말풍선 고치기'], ['방향키 (Shift)', '1칸 (10칸) 옮기기'], ['Space+끌기', '화면 옮기기'], ['Ctrl+휠 · Ctrl+0', '확대·축소 · 화면에 맞추기'], ['Alt', '끄는 동안 자석 잠시 끄기'], ['PageUp / PageDown', '이미지 편집: 앞·다음 그림'], ['Ctrl+T', '이미지 편집: 자유 변형'], ['Ctrl+Shift+X', '이미지 편집: 뒤틀기'], ['[ / ]', '붓 크기']]],
  ['영상·움짤', [['Space', '재생 / 멈춤'], ['← / →', '한 프레임 (Shift = 5프레임)'], ['↑ / ↓', '장면 경계로'], ['V / C', '고르기 / 자르기 도구'], ['S', '자석'], ['Ctrl+K', '재생 위치에서 나누기'], ['Ctrl+D / Delete', '복제 / 지우기'], ['T', '글자 넣기'], ['Ctrl+휠 · + / -', '시간 막대 확대·축소'], ['\\', '전체 보기'], ['Ctrl+M', '내보내기'], ['Esc', '고르기 풀기 (한 번 더 = 편집기로)']]]];
function uiSettings(sec) {
  let cur = sec || 'general';
  const m = modal(`<h2>설정</h2><p class="sub">여기서 바꾼 것은 이 컴퓨터에 저장돼요.</p><div class="set"><nav class="set-nav">${UI_SECS.map(([k, n]) => `<button data-sec="${k}" class="${k === cur ? 'on' : ''}">${n}</button>`).join('')}</nav><div class="set-body" id="setBody"></div></div>
    <div class="foot"><button class="btn" id="setReset" title="이 창의 설정만 처음대로 (작업·그림은 그대로)">설정 처음대로</button><span class="flex1"></span><button class="btn primary" data-close>닫기</button></div>`, { wide: true });
  m.style.width = 'min(1000px, 100%)';
  const body = $('#setBody', m);
  const sel = (k, opts, v) => `<select data-us="${k}">${opts.map(([a, b]) => `<option value="${a}" ${String(a) === String(v ?? uiSet[k]) ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
  const chk = (k, l) => `<label class="chk"><input type="checkbox" data-us="${k}" ${uiSet[k] ? 'checked' : ''}> ${l}</label>`;
  const R = (l, c, d) => `<div class="set-row"><div class="set-l">${l}${d ? `<small>${d}</small>` : ''}</div><div class="set-c">${c}</div></div>`;
  const H = {
    general: () => `<h3>화면</h3>${R('화면 밝기', sel('theme', [['light', '밝게'], ['dark', '어둡게'], ['system', '컴퓨터 설정 따르기']], uiSet.theme || (isDark() ? 'dark' : 'light')))}
      ${R('패널', chk('left', '왼쪽 패널 (그림·효과음·레이어)') + '<br>' + chk('right', '오른쪽 속성 칸') + '<br>' + chk('status', '아래 상태 줄'))}
      ${R('속성 칸 접기', `<button class="btn sm" data-sa="unfold">접어 둔 칸 모두 펼치기</button>`, '오른쪽 칸 제목을 누르면 접히고, 다음에도 접힌 채로 나와요')}
      ${R('우클릭', chk('ctxNative', 'Shift+우클릭은 브라우저 원래 메뉴'), '보통 우클릭은 감자 편집기 메뉴예요')}`,
    edit: () => `<h3>편집</h3>${R('자석', chk('snap', '켤 때 자석 켜기'), '움직일 때 컷·페이지 가장자리에 붙게. 끄는 동안 Alt로 잠시 끌 수 있어요')}
      ${R('새 글자 기본 모양', `<button class="btn sm" data-sa="styles">내 글자 스타일 관리…</button>`, '글자를 고르고 오른쪽 칸 \'내 글자 스타일\'에서 저장·기본으로 정해요')}
      ${R('자동 흰칠', `<button class="btn sm" data-sa="cz">자동 흰칠 설정 열기…</button>`)}`,
    video: () => `<h3>새 영상·움짤 작업 기본값</h3>${R('해상도', sel('vSize', GS_SIZES.filter(x => x[0] !== 'custom')))}${R('프레임', sel('vFps', GS_FPS.map(f => [f, f + ' fps'])))}${R('내보내기 형식', sel('vFmt', [['mp4', 'MP4 영상'], ['gif', 'GIF 움짤'], ['webp', 'WebP 움짤']]))}
      <h3>미리보기·내보내기</h3>${R('미리보기 화질', sel('pvMax', [[99999, '원본 그대로 (무거워요)'], [2560, '긴 쪽 2560까지'], [1920, '긴 쪽 1920까지 (추천)'], [1280, '긴 쪽 1280까지 (가볍게)'], [960, '긴 쪽 960까지 (아주 가볍게)']]), '큰 해상도는 미리보기만 줄여 그려요. 내보낼 때는 원래 크기 그대로예요')}
      ${R('MP4 하드웨어 가속', sel('hw', [['no-preference', '자동'], ['prefer-hardware', '그래픽카드 쓰기 (빠름)'], ['prefer-software', 'CPU로 (안정적)']]), '4K·60fps가 안 만들어지면 바꿔 보세요')}
      <p class="muted small">이 컴퓨터가 만들 수 있는 MP4: <span id="setCodec">확인하는 중…</span></p>`,
    ai: () => `<h3>제미나이 API</h3>${R('API 키', `<span style="display:flex;gap:6px"><input type="password" id="setKey" value="${esc(trCfg.key)}" placeholder="AIza…" spellcheck="false" autocomplete="off" style="flex:1"><button class="btn sm" data-sa="keyshow">보기</button><button class="btn sm" data-sa="keytest">확인·모델 불러오기</button></span>`, 'Google AI Studio의 Get API key에서 받아요. 이 컴퓨터에만 저장돼요')}
      ${R('번역 모델', `<select id="setTrModel">${[...new Set([trCfg.model, ...(trCfg.models.length ? trCfg.models : TR_PREF)])].map(x => `<option value="${esc(x)}" ${x === trCfg.model ? 'selected' : ''}>${esc(apiModelLabel(x))}</option>`).join('')}</select>`)}
      ${R('더빙 모델', `<select id="setDbModel">${DB_MODELS.map(([v, l]) => `<option value="${v}" ${v === dbCfg.model ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${R('영상 모델', `<input type="text" id="setVgModel" value="${esc(vgCfg.model)}" spellcheck="false">`, 'AI 영상 만들기 창의 \'목록\'에서도 골라요')}
      <h3>금액</h3>${R('이번 달 예산', `<input type="number" id="setBudget" min="0" step="1" value="${uiSet.budget || 0}" style="width:90px"> 달러 <span class="muted small">(0이면 안 봐요)</span>`, '이번 달 쓴 금액이 넘으면 알려 주고 상태 줄이 빨개져요')}
      ${R('원화 환율', `1달러 = <input type="number" id="setKrw" min="500" max="3000" step="10" value="${+apiCfg.krw || 1340}" style="width:80px">원`)}
      ${R('사용 내역', `<button class="btn sm" data-sa="apilog">API 사용 내역 보기…</button>`)}
      <h3>번역</h3>${R('용어집·말투 메모', `<button class="btn sm" data-sa="trcfg">페이지 번역 설정 열기…</button>`, '이미지 편집에서 열려요')}`,
    packs: () => `<h3>AI 처리</h3>${R('처리 장치', `<select id="setDev"><option value="auto" ${czCfg.device !== 'cpu' ? 'selected' : ''}>자동 (그래픽카드 먼저)</option><option value="cpu" ${czCfg.device === 'cpu' ? 'selected' : ''}>CPU만</option></select>`, '자동 흰칠·배경 지우기·AI 지우개 같은 AI 기능')}
      <h3>AI 팩</h3>${czIsApp() ? '<div id="setPacks" class="czpackbox"></div>' : '<p class="muted small">AI 팩은 설치판(exe)에서 받아 써요.</p>'}`,
    storage: () => `<h3>저장 공간</h3>${R('이 컴퓨터에 쓴 공간', '<span id="setUse">확인하는 중…</span>')}${R('작업', `<button class="btn sm" data-sa="projlist">작업 목록 열기…</button>`, '닫은 탭을 다시 열거나 작업을 지워요')}
      ${R('API 사용 기록', `<button class="btn sm" data-sa="apiclear">기록 지우기…</button>`)}`,
    keys: () => UI_KEYS.map(([g, L]) => `<h3>${g}</h3><table class="set-keys">${L.map(([k, d]) => `<tr><td><kbd>${esc(uiK(k))}</kbd></td><td>${esc(d)}</td></tr>`).join('')}</table>`).join(''),
    about: () => `<h3>감자 편집기</h3>${R('버전', `<b>${esc(uiVer())}</b> · ${appApi() ? '설치판' : '웹판'}`)}${R('업데이트', `${appApi() ? '<button class="btn sm" data-sa="upd">지금 확인</button> ' : ''}<button class="btn sm" data-sa="log">업데이트 기록…</button>`)}${R('', chk('autoUpd', '켤 때 새 버전 확인 (설치판)'))}${R('사용법', '<button class="btn sm" data-sa="help">사용법 보기</button>')}
      <p class="muted small" style="margin-top:14px">모델·글꼴·라이브러리 저작권 안내는 프로그램 맨 아래 주석과 NOTICE에 있어요.</p>`,
  };
  const draw = () => {
    body.innerHTML = H[cur](); $$('.set-nav [data-sec]', m).forEach(b => b.classList.toggle('on', b.dataset.sec === cur)); body.scrollTop = 0;
    if (cur === 'packs' && czIsApp()) czPackBoxRender($('#setPacks', m));
    if (cur === 'storage' && navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(u => { const el = $('#setUse', m); if (el) el.textContent = `${(u.usage / 1048576).toFixed(0)}MB 씀${u.quota ? ` · 쓸 수 있는 공간 약 ${(u.quota / 1073741824).toFixed(0)}GB` : ''}`; }).catch(() => { });
    if (cur === 'video') (async () => { const L = []; for (const [n, W, H, f] of [['1080p 60fps', 1920, 1080, 60], ['1440p 60fps', 2560, 1440, 60], ['4K 30fps', 3840, 2160, 30], ['4K 60fps', 3840, 2160, 60]]) { const c = await gsMp4Codec(W, H, f, gsMp4Bitrate(W, H, f, 75)); L.push(`${n} ${c ? '✓ ' + ({ avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' }[c.mux] || '') : '✗'}`); } const el = $('#setCodec', m); if (el) el.textContent = L.join(' · '); })();
  };
  draw();
  $('.set-nav', m).addEventListener('click', e => { const b = e.target.closest('[data-sec]'); if (b) { cur = b.dataset.sec; draw(); } });
  body.addEventListener('change', e => {
    const t = e.target, k = t.dataset.us;
    if (k) {
      const v = t.type === 'checkbox' ? t.checked : t.tagName === 'SELECT' && /^\d+$/.test(t.value) ? +t.value : t.value; uiSet[k] = v; uiSave();
      if (k === 'theme') uiTheme(v); if (k === 'left' || k === 'right' || k === 'status') uiPanels(); if (k === 'pvMax' && uiGif()) gsFitCanvas();
      if (k === 'snap') { const s = $('#snapTgl'); if (s) { s.checked = !!v; s.dispatchEvent(new Event('change')); } }
      return;
    }
    if (t.id === 'setTrModel') { trCfg.model = t.value; trSaveCfg(); }
    if (t.id === 'setDbModel') { dbCfg.model = t.value; dbSave(); }
    if (t.id === 'setVgModel') { vgCfg.model = t.value.trim() || VG_DEF; vgSave(); }
    if (t.id === 'setKey') { trCfg.key = t.value.trim(); trSaveCfg(); }
    if (t.id === 'setBudget') { uiSet.budget = Math.max(0, +t.value || 0); uiSave(); }
    if (t.id === 'setKrw') { const v = +t.value; if (v >= 500 && v <= 3000) { apiCfg.krw = v; try { localStorage.setItem('potatoApiCfg', JSON.stringify(apiCfg)); } catch (_) { } } }
    if (t.id === 'setDev') { const b = czCfg.device; czCfg.device = t.value; czSaveCfg(); if (b !== czCfg.device) czReset(); }
  });
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-sa]'); if (!b) return; const a = b.dataset.sa;
    if (a === 'unfold') { uiFolds.clear(); uiFoldSave(); uiFoldApply(); toast('모두 펼쳤어요', 1400); }
    if (a === 'keyshow') { const i = $('#setKey', m); i.type = i.type === 'password' ? 'text' : 'password'; }
    if (a === 'keytest') { trCfg.key = $('#setKey', m).value.trim(); trSaveCfg(); if (!trCfg.key) { toast('키를 넣어 주세요'); return; } b.disabled = true; try { const L = await trListModels(); trCfg.models = L; if (L.length && !L.includes(trCfg.model)) trCfg.model = L[0]; trSaveCfg(); toast(`키가 맞아요. 모델 ${L.length}개`, 2600); draw(); } catch (er) { toast(er.message, 5000); } b.disabled = false; }
    if (a === 'apilog') apiOpenLog();
    if (a === 'trcfg') { closeModal(); if (isImg() && uiEd()) trOpen(); else toast('이미지 편집에서 그림을 연 뒤 AI → 페이지 번역에서 열려요', 3600); }
    if (a === 'projlist') { closeModal(); openProjList(); }
    if (a === 'apiclear') { if (confirm('API 사용 기록을 모두 지울까요?')) { apiLog = apiLog.filter(j => j.st === 'run'); apiPersist(); toast('지웠어요'); } }
    if (a === 'upd') { closeModal(); checkUpdate(true); }
    if (a === 'log') uiChangelog();
    if (a === 'help') openHelp();
    if (a === 'cz') { closeModal(); openCzMenu(); }
    if (a === 'styles') { closeModal(); toast('글자를 하나 고르면 오른쪽 칸에 \'내 글자 스타일\'이 나와요', 3600); }
  });
  $('#setReset', m).addEventListener('click', () => { if (!confirm('설정 창의 값을 처음대로 돌릴까요? (작업, 그림, API 키는 그대로예요)')) return; Object.assign(uiSet, UI_SET0); uiSave(); uiTheme('light'); uiPanels(); draw(); });
}
function uiBudgetCheck() {
  if (!uiSet.budget) return;
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), mon = apiLog.filter(j => j.at >= m0).reduce((a, j) => a + (j.usd || 0), 0), key = `${now.getFullYear()}-${now.getMonth()}`;
  if (mon > uiSet.budget && uiSet._warned !== key) { uiSet._warned = key; uiSave(); setTimeout(() => toast(`이번 달 API 사용 금액이 예산($${uiSet.budget})을 넘었어요: ${apiFmt(mon)}`, 7000), 1200); }
}

/* ---- 시작 ---- */
(function uiInit() {
  uiMenubar(); uiPanels();
  if (uiSet.theme === 'system') uiTheme('system'); else if (uiSet.theme === 'dark' || uiSet.theme === 'light') setTheme(uiSet.theme);
  if (!uiSet.snap) { const s = $('#snapTgl'); if (s) { s.checked = false; s.dispatchEvent(new Event('change')); } }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (uiSet.theme === 'system') uiTheme('system'); }); } catch (_) { }
  const st = $('#status'); if (st) st.addEventListener('click', e => { const b = e.target.closest('[data-st]'); if (!b) return; if (b.dataset.st === 'zoom') fitView(); else if (b.dataset.st === 'api') apiOpenLog(); else uiChangelog(); });
  document.addEventListener('keydown', e => {
    if (isTyping(e.target) && e.key !== 'F1') return;
    if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); if (!modalOpen()) uiSettings(); }
    else if (e.key === 'F1') { e.preventDefault(); if (!modalOpen()) openHelp(); }
    else if (e.key === 'F11' && appApi()) { e.preventDefault(); uiFull(); }
  });
  setTimeout(uiAfterUpdate, 2500);
})();
