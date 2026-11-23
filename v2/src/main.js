import { h, icon, fmtKeys } from './ui/dom.js';
import { settings } from './core/settings.js';
import { addCmd, cmds, cmd, run, handleKey, keysOf, keyName, setErrHandler } from './core/cmd.js';
import { state, canvasOf, tidyMedia, boot, onChange, onTick, emit, commit, undo, redo, canUndo, canRedo, saveNow, setSaveErrHandler, newProject, openProject, listProjects, deleteProject } from './core/store.js';
import { showMenu, closeMenu, cmdItem, toast, dialog, confirmBox, palette, busy, setErrUi } from './ui/overlay.js';
import { errLog, errClear, errText, logErr, noteDetail } from './core/errlog.js';
import { renderDock, updatePanels, isRendering, togglePanel, hasPanel, resetLayout } from './ui/dock.js';
import { PANELS } from './ui/panels.js';
import { imageRoom, registerImageCmds, setMenuItem } from './rooms/image.js';
import { cutRoom, registerCutCmds } from './rooms/cut.js';
import { registerBinCmds } from './ui/bin.js';
import { batchRoom } from './rooms/batch.js';
import { videoRoom, registerVideoCmds } from './rooms/video.js';
import { registerGeminiCmds } from './ui/geminitools.js';
import { registerVsubCmds } from './ui/vsub.js';
import { characterRoom, registerCharCmds } from './rooms/character.js';
import { naiAccount } from './api/nai.js';
import { registerAiCmds, packsPane } from './ui/aitools.js';
import { registerNaiTools } from './ui/naitools.js';
import { linkState, startWatch, stopWatch, sendOut } from './core/link.js';
import { download } from './core/files.js';
import { costOf, money, totals, krw } from './core/cost.js';
import { registerLiquify, makeField, stroke, warp } from './ui/liquify.js';
import { preamble, check, generate, buildBody, buildInteraction, speak, animate, SAFETY_CATEGORIES, usageLog, usageClear } from './api/gemini.js';

const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
const ROOMS = [imageRoom, cutRoom, videoRoom, characterRoom, batchRoom];
const roomOf = () => ROOMS.find(r => r.id === settings.get('room')) || imageRoom;
const MENUS = ['파일', '편집', '보기', '레이어', '고르기', '컷', '영상', 'AI', '도구', '작업실', '도움말'];

let live = null;      // 지금 가운데에 떠 있는 작업실
const els = {};

// ---------- 명령 ----------
function registerCmds() {
  addCmd({ id: 'file.new', title: '새 작업', menu: '파일', keys: 'Ctrl+Alt+N', run: async () => { await saveNow(); await newProject(); toast('새 작업을 만들었어요.'); } });
  addCmd({ id: 'file.projects', title: '작업 목록…', menu: '파일', keys: 'Ctrl+Shift+O', words: '열기 최근', run: projectsDialog });
  registerImageCmds();
  registerBinCmds();
  registerAiCmds(() => settingsDialog('packs'));
  registerNaiTools();
  registerLiquify();
  registerCharCmds();
  registerGeminiCmds();
  registerVsubCmds();
  registerVideoCmds();
  registerCutCmds();
  addCmd({ id: 'file.import8', title: '8.x 작업 파일 가져오기…', menu: '파일', group: 'import', words: '예전 작업 옮기기 json', run: () => {
    const i = h('input', { type: 'file', accept: '.json,application/json' });
    i.onchange = async () => { const f = i.files[0]; if (!f) return; const b = busy('8.x 작업을 가져오는 중이에요.');
      try { const { import8 } = await import('./core/import8.js'); const r = await import8(f, (n, t) => b.set(`그림을 옮기는 중이에요. ${n} / ${t}`));
        b.done(`'${r.name}'에서 그림 ${r.images}장${r.pages ? `, 페이지 ${r.pages}쪽` : ''}을 가져왔어요.` + (r.skipped ? ` 2.0에 아직 없는 요소 ${r.skipped}개(스티커, 손그림, 효과 등)는 건너뛰었어요.` : '') + (r.failed ? ` 그림 ${r.failed}장은 읽지 못했어요.` : ''));
        if (r.pages) settings.set('room', 'cut'); }
      catch (e) { b.done(e.message || '가져오지 못했어요.', 'err'); } };
    i.click(); } });
  addCmd({ id: 'file.save', title: '지금 저장', menu: '파일', keys: 'Ctrl+S', run: async () => { if (await saveNow()) toast('저장했어요. 평소에는 고칠 때마다 알아서 저장돼요.'); else toast('저장하지 못했어요. 저장 공간이 모자라거나 막혀 있을 수 있어요. 파일 메뉴의 백업으로 작업을 따로 남겨 두세요. (' + state.saveErr + ')', 'err'); } });
  addCmd({ id: 'edit.undo', title: '되돌리기', menu: '편집', keys: 'Ctrl+Z', enabled: canUndo, run: undo });
  addCmd({ id: 'edit.redo', title: '다시 하기', menu: '편집', keys: 'Ctrl+Shift+Z', enabled: canRedo, run: redo });
  addCmd({ id: 'app.settings', title: '설정…', menu: '편집', keys: 'Ctrl+,', run: () => settingsDialog() });
  addCmd({ id: 'view.palette', title: '명령 찾기…', menu: '보기', keys: 'Ctrl+K', words: '검색 찾기', run: palette });
  addCmd({ id: 'view.rooms', title: '화면 방식: 작업실 나누기', menu: '보기', group: 'mode', checked: () => settings.get('layoutMode') === 'rooms', run: () => settings.set('layoutMode', 'rooms') });
  addCmd({ id: 'view.single', title: '화면 방식: 한 화면에 모두', menu: '보기', group: 'mode', checked: () => settings.get('layoutMode') === 'single', run: () => settings.set('layoutMode', 'single') });
  Object.entries(PANELS).forEach(([id, p]) => addCmd({ id: 'panel.' + id, title: p.title + ' 패널', menu: '보기', group: 'panel', checked: () => hasPanel(id), run: () => togglePanel(id) }));
  addCmd({ id: 'view.resetLayout', title: '패널 배치 처음으로', menu: '보기', group: 'panel', run: () => { resetLayout(); toast('이 화면의 패널 배치를 처음 모양으로 돌렸어요.'); } });
  ROOMS.forEach((r, i) => addCmd({ id: 'room.' + r.id, title: r.title + ' 작업실', menu: '작업실', keys: 'Alt+' + (i + 1), checked: () => settings.get('room') === r.id, run: () => settings.set('room', r.id) }));
  addCmd({ id: 'view.full', title: '전체 화면', menu: '보기', keys: 'F11', checked: () => !!document.fullscreenElement, run: async () => { const T = window.__TAURI__; try { if (T && T.window) { const w = T.window.getCurrentWindow(); await w.setFullscreen(!(await w.isFullscreen())); } else if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) { toast('전체 화면으로 바꾸지 못했어요.', 'err'); } } });
  addCmd({ id: 'help.guide', title: '사용법', menu: '도움말', keys: 'F1', run: helpDialog });
  addCmd({ id: 'help.changes', title: '업데이트 기록', menu: '도움말', run: () => { const u = 'https://github.com/harp1455/Potato-editor/releases', T = window.__TAURI__; if (T && T.opener && T.opener.openUrl) T.opener.openUrl(u); else window.open(u, '_blank', 'noopener'); } });
  addCmd({ id: 'file.tidy', title: '안 쓰는 그림 정리', menu: '파일', words: '용량 청소 붓 그리기 임시', run: async () => { const r = await tidyMedia(); toast(r.n ? `안 쓰는 그림 ${r.n}장을 지웠어요 (${(r.bytes / 1048576).toFixed(1)}MB). 보관함에 보이는 그림과 되돌리기에 필요한 그림은 그대로예요.` : '지울 것이 없어요. 붓으로 그린 흔적 같은 안 쓰는 그림은 작업을 열 때와 그리는 중에도 저절로 정리돼요.'); } });
  addCmd({ id: 'help.errors', title: '오류 기록…', menu: '도움말', words: '로그 log 에러 거절', run: errDialog });
  addCmd({ id: 'help.plan', title: '2.0에서 달라지는 것', menu: '도움말', run: planDialog });
  addCmd({ id: 'help.update', title: '새 판 확인', menu: '도움말', run: () => checkUpdate(false) });
  addCmd({ id: 'link.watch', title: 'NAIS3 저장 폴더 지켜보기 (켜기·끄기)', menu: 'AI', group: 'link', words: '연동 nais 폴더 자동 가져오기', checked: () => linkState().on, run: () => (linkState().on ? stopWatch() : startWatch(!linkState().name)) });
  addCmd({ id: 'link.send', title: '지금 그림을 NAIS3로 보내기 (폴더에 저장)', menu: 'AI', group: 'link', keys: 'Ctrl+Shift+E', words: '연동 nais 내보내기', enabled: () => !!canvasOf(), run: () => sendOut(!linkState().out) });
  addCmd({ id: 'tool.swatches', title: '색 견본…', menu: '도구', group: 'color', words: '팔레트 색상 스포이드 palette', run: swatchDialog });
  addCmd({ id: 'help.usage', title: 'API 사용 기록', menu: '도움말', run: usageDialog });
  addCmd({ id: 'help.keys', title: '단축키 보기·바꾸기', menu: '도움말', run: () => settingsDialog('keys') });
  setMenuItem(id => cmdItem(cmd(id)));
}

// ---------- 뼈대 ----------
function build() {
  const app = h('div.app');
  els.menubar = h('nav.menubar', { 'aria-label': '메뉴' });
  els.name = h('input.proj-name', { type: 'text', 'aria-label': '작업 이름', spellcheck: 'false', onchange: e => { state.project.name = e.target.value.trim() || '새 작업'; commit('작업 이름 바꾸기'); } });
  els.switch = h('div.room-switch', { role: 'tablist', 'aria-label': '가운데 화면' });
  const top = h('header.top', null,
    h('div.brand', { title: '감자 편집기 ' + VERSION }, h('span.brand-mark', { 'aria-hidden': 'true' }), h('span.brand-name', null, '감자 편집기')),
    els.menubar, els.name, els.switch, h('span.grow'),
    h('button.top-btn', { title: '명령 찾기 (Ctrl + K)', onclick: () => run('view.palette') }, icon('search'), h('span', null, '명령 찾기'), h('kbd', null, 'Ctrl K')),
    els.mode = h('button.icon-btn', { onclick: () => settings.set('layoutMode', settings.get('layoutMode') === 'rooms' ? 'single' : 'rooms') }),
    h('button.icon-btn', { title: '설정 (Ctrl + ,)', 'aria-label': '설정', onclick: () => run('app.settings') }, icon('gear')));
  els.rail = h('nav.rail', { 'aria-label': '작업실' });
  els.work = h('div.work');
  els.center = h('main.center');
  els.status = h('footer.status');
  app.append(top, h('div.body', null, els.rail, els.work), els.status);
  document.body.append(app);

  MENUS.forEach(name => {
    const b = h('button.mb-item', { 'aria-haspopup': 'menu', onclick: () => openMenu(b, name), onpointerenter: () => { if (document.querySelector('.mb-item.on') && !b.classList.contains('on')) openMenu(b, name); } }, name);
    els.menubar.append(b);
  });
}
function openMenu(b, name) {
  const items = []; let g;
  cmds().filter(c => c.menu === name).forEach(c => { if (items.length && c.group !== g) items.push('-'); g = c.group; items.push(cmdItem(c)); });
  const r = b.getBoundingClientRect();
  showMenu(items, r.left, r.bottom + 2, b);
  b.classList.add('on');
}

function mountRoom() {
  if (live && live.destroy) live.destroy();
  const r = roomOf();
  els.center.replaceChildren(); els.center.dataset.room = r.id;
  live = r.mount(els.center) || {};
  renderDock(els.work, els.center);
}

function renderChrome() {
  const single = settings.get('layoutMode') === 'single', cur = settings.get('room');
  document.body.dataset.mode = settings.get('layoutMode');
  const tab = cls => r => h('button.' + cls + (r.id === cur ? '.on' : ''), { role: 'tab', 'aria-selected': String(r.id === cur), title: `${r.title} 작업실 (${fmtKeys(keysOf('room.' + r.id))})`, onclick: () => settings.set('room', r.id) }, icon(r.icon, cls === 'rail-item' ? 20 : 15), h('span', null, r.title));
  els.rail.replaceChildren(...ROOMS.map(tab('rail-item')));
  els.switch.replaceChildren(...ROOMS.map(tab('switch-item')));
  els.mode.replaceChildren(icon(single ? 'single' : 'panels'));
  els.mode.title = single ? '지금: 한 화면에 모두. 눌러서 작업실 나누기로' : '지금: 작업실 나누기. 눌러서 한 화면에 모두로';
  els.mode.setAttribute('aria-label', '화면 방식 바꾸기');
}

function renderStatus() {
  const r = roomOf();
  const parts = (r.status ? r.status() : []).map(t => h('span.st-cell', null, t));
  const zoom = r.zoomText && r.zoomText();
  els.status.replaceChildren(...[
    settings.get('hints') ? h('span.st-hint', null, r.hint ? r.hint() : '') : h('span.grow'),
    ...parts,
    zoom && h('button.st-cell.st-btn', { title: '화면에 맞추기', onclick: () => run('view.fit') }, zoom),
    h('span.st-cell' + (state.saved ? '' : '.dirty'), null, state.saved ? '저장됨' : state.saveErr ? '저장 못 함' : '저장하는 중'),
    h('button.st-cell.st-btn', { title: '2.0에서 달라지는 것', onclick: () => run('help.plan') }, VERSION),
  ].filter(Boolean));
}

function refresh() {
  if (document.activeElement !== els.name) els.name.value = state.project.name;
  document.title = state.project.name + ' - 감자 편집기';
  if (live && live.update) live.update();
  updatePanels(); renderStatus();
}

// ---------- 창들 ----------
// 밝기: 어둡게 / 밝게 / 컴퓨터 설정 따르기
function applyTheme() { const t = settings.get('theme'); document.documentElement.dataset.theme = t === 'light' || (t === 'system' && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark'; }
// 사용법: 처음 쓰는 사람이 어디서 무엇을 하는지 한눈에 보게
function helpDialog() {
  const sec = (t, rows) => [h('h3', null, t), h('table.plan', null, h('tbody', null, rows.map(([a, b]) => h('tr', null, h('th', { scope: 'row' }, a), h('td', null, b)))))];
  dialog({ title: '사용법', wide: true, buttons: [{ label: '단축키 보기', run: () => { settingsDialog('keys'); } }, { label: '닫기', primary: true }], body: h('div.help', null,
    ...sec('시작하기', [['그림 넣기', '그림이나 폴더를 창에 끌어다 놓거나, 파일 메뉴의 그림 열기·폴더째 넣기를 써요. 넣은 그림은 왼쪽 보관함에 모여요.'], ['작업실', '위쪽 단추나 Alt+1~5로 이미지, 컷, 영상, 캐릭터, 일괄 처리를 오가요.'], ['명령 찾기', 'Ctrl+K를 누르고 하고 싶은 일을 적으면 어느 메뉴에 있든 바로 찾아요.'], ['저장', '작업은 저절로 저장돼요. 파일 메뉴의 작업 목록에서 다른 작업을 열거나 백업해요.']]),
    ...sec('이미지 작업실', [['고르기', '네모·동그라미·올가미·마법봉·마법 붓·AI로 고르기. Shift는 더하기, Alt는 빼기예요.'], ['고른 곳에 하는 일', '고르기 메뉴에서 새 레이어로, 지우기, 흐리게, 모자이크, 색 채우기, 그림판 자르기, 가림막.'], ['보정', '레이어를 고르면 오른쪽 속성에 밝기·대비·곡선이 나와요. 아무것도 안 고르면 전체 보정이에요.'], ['AI', 'AI 메뉴에 배경 지우기, 화질 키우기, AI로 지우기, 자동 흰칠, NovelAI, 제미나이가 있어요.']]),
    ...sec('컷 작업실', [['도구', 'V 고르기, C 컷, B 말풍선, T 글자, L 집중선. Shift를 누르고 누르면 여러 개를 함께 골라요. 화살표로 1칸씩, Shift와 함께면 10칸씩 옮겨요.'], ['말풍선', '오른쪽의 종류 견본을 고르고 끌거나 눌러서 놓아요. 두 번 누르거나 Enter를 누르면 그 자리에서 대사를 고쳐요. 꼬리 끝의 노란 점을 끌어 방향을 바꾸고, 말풍선 여럿을 함께 골라 이어 붙일 수 있어요. 모양·선(펜, 붓, 스케치, 점선)·겹줄·번짐·손맛을 따로 바꿀 수 있어요.'], ['대사', '컷 메뉴에서 번역, 다듬기, 대사 초안, 그림 속 글자 번역을 해요.']]),
    ...sec('영상 작업실', [['장면', '보관함에서 그림을 골라 장면으로 넣어요. 장면마다 길이, 겹쳐 바뀜, 화면 움직임을 정해요.'], ['자막·소리·얹는 그림', '오른쪽 칸에서 넣어요. 움직임 점으로 시간에 따라 바뀌게 할 수 있어요.'], ['내보내기', 'Ctrl+M. MP4, GIF, WebP로 저장해요.']]),
    ...sec('캐릭터 작업실', [['차례', '① 뼈대 맞추기 → ② 부위 나누기 → ③ 움직임 만들기. 다 되면 영상 작업실로 보내거나 파일로 내보내요.']])) });
}
// 오류 기록: 생긴 오류와 거절을 모아 보고, 파일로 저장하거나 복사해요
function errDialog() {
  const L = errLog();
  const d = dialog({ title: '오류 기록', wide: true, buttons: [{ label: '기록 지우기', run: () => { errClear(); } }, { label: '복사', run: () => { navigator.clipboard.writeText(errText()).then(() => toast('오류 기록을 복사했어요.'), () => toast('복사하지 못했어요. 파일로 저장해 주세요.')); return false; } }, { label: '파일로 저장', primary: true, run: () => { download(new Blob([errText()], { type: 'text/plain' }), `감자편집기2 오류 기록 ${new Date().toISOString().slice(0, 10)}.txt`); return false; } }],
    body: L.length ? h('div.vid-form', null, h('p.dlg-text', null, `오류와 거절 ${L.length}건이 남아 있어요. 파일로 저장하거나 복사해서 보내 주시면 원인을 찾기 쉬워요. API 키나 토큰은 기록하지 않아요.`),
      h('div.err-list', null, L.slice(0, 200).map(r => h('div.err-row', null, h('span.plan-when', null, new Date(r.t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'medium' }) + (r.where ? ' · ' + r.where : '')), h('b', null, r.msg), r.detail ? h('code', null, r.detail) : null))))
      : h('p.dlg-text', null, '기록된 오류가 없어요.') });
}
// 색 견본: 자주 쓰는 색을 모아 두면 모든 색 고르는 창에 견본으로 나와요
function swatchList() {
  let dl = document.getElementById('swatches'); if (!dl) { dl = h('datalist', { id: 'swatches' }); document.body.append(dl); new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.querySelectorAll) (n.matches('input[type=color]') ? [n] : n.querySelectorAll('input[type=color]')).forEach(i => i.setAttribute('list', 'swatches')); }).observe(document.body, { childList: true, subtree: true }); }
  dl.replaceChildren(...(settings.get('swatches') || []).map(c => h('option', { value: c })));
}
function swatchDialog() {
  const box = h('div.sw-list'), get = () => settings.get('swatches') || [], set = v => { settings.set('swatches', v.slice(0, 48)); swatchList(); draw(); };
  const pick = h('input', { type: 'color', value: '#d3a94e', 'aria-label': '넣을 색' });
  const draw = () => box.replaceChildren(...get().map(c => h('button.sw', { style: `background:${c}`, title: `${c} (누르면 지워요)`, 'aria-label': `${c} 지우기`, onclick: () => set(get().filter(x => x !== c)) })), !get().length && h('p.empty', null, '아직 모아 둔 색이 없어요.'));
  draw();
  dialog({ title: '색 견본', body: h('div.vid-form', null, box,
    h('div.btn-row', null, pick, h('button.btn.small', { onclick: () => set([...new Set([...get(), pick.value.toLowerCase()])]) }, '이 색 넣기'),
      window.EyeDropper && h('button.btn.small', { title: '화면 아무 곳이나 눌러 그 색을 넣어요', onclick: async () => { try { const r = await new window.EyeDropper().open(); set([...new Set([...get(), r.sRGBHex.toLowerCase()])]); } catch (_) { /* 그만둠 */ } } }, '화면에서 색 뽑기')),
    h('p.dlg-text', null, '여기 모은 색은 말풍선, 글자, 바탕색처럼 색을 고르는 모든 곳에 견본으로 나와요. 다른 작업에서도 같이 써요.')), buttons: [{ label: '닫기', primary: true }] });
}
async function projectsDialog() {
  const list = h('div.proj-list'), find = h('input.text', { type: 'search', placeholder: '작업 이름으로 찾기', 'aria-label': '작업 찾기', oninput: () => draw() });
  const backup = async ids => { const b = busy('백업 파일을 만드는 중이에요.'); try { const { backupZip } = await import('./core/backup.js'), r = await backupZip(ids, (a, n) => b.set(`백업 파일을 만드는 중이에요. ${a} / ${n}`)); download(r.blob, `감자편집기2 백업 ${new Date().toISOString().slice(0, 10)}${ids ? ' ' + (state.project.name || '') : ''}.zip`); b.done(`작업 ${r.count}개를 백업 파일로 저장했어요.`); } catch (e) { b.done('백업하지 못했어요. ' + (e.message || ''), 'err'); } };
  const restore = () => { const i = h('input', { type: 'file', accept: '.zip' }); i.onchange = async () => { if (!i.files[0]) return; const b = busy('백업을 들여오는 중이에요.'); try { const { restoreZip } = await import('./core/backup.js'), r = await restoreZip(i.files[0]); b.done(`작업 ${r.added}개를 들여왔어요.${r.skipped ? ` 이미 있는 ${r.skipped}개는 그대로 뒀어요.` : ''}`); draw(); } catch (e) { b.done(e.message || '들여오지 못했어요.', 'err'); } }; i.click(); };
  const d = dialog({ title: '작업 목록', wide: true, body: h('div.vid-form', null, find, list,
    h('div.btn-row', null, h('button.btn.small', { onclick: () => backup([state.project.id]), title: '지금 작업과 그 안의 그림을 파일 하나로 저장해요' }, '지금 작업 백업'), h('button.btn.small', { onclick: () => backup(null), title: '모든 작업을 파일 하나로 저장해요. 그림이 많으면 파일이 커요.' }, '모든 작업 백업'), h('button.btn.small', { onclick: restore }, '백업 들여오기'))),
    buttons: [{ label: '닫기' }, { label: '새 작업', primary: true, run: () => { run('file.new'); } }] });
  const draw = async () => {
    const q = find.value.trim().toLowerCase(), all = await listProjects(), ps = q ? all.filter(p => p.name.toLowerCase().includes(q)) : all;
    list.replaceChildren(...ps.map(p => h('div.proj' + (p.id === state.project.id ? '.on' : ''), null,
      h('button.proj-open', { onclick: async () => { await saveNow(); await openProject(p.id); d.close(); } },
        h('b', null, p.name), h('span', null, `그림 ${p.media}장, 그림판 ${p.canvases}개`), h('span', null, new Date(p.at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }))),
      p.id === state.project.id ? h('span.proj-now', null, '지금 작업') : h('button.icon-btn', { title: '이 작업 지우기', 'aria-label': `${p.name} 지우기`, onclick: async () => { if (await confirmBox('작업 지우기', `'${p.name}' 작업과 그 안의 그림을 모두 지워요. 되돌릴 수 없어요.`, '지우기', true)) { await deleteProject(p.id); draw(); } } }, icon('trash')))));
    if (!ps.length) list.append(h('p.empty', null, all.length ? '그 이름의 작업이 없어요.' : '저장된 작업이 아직 없어요.'));
  };
  draw();
}

function planDialog() {
  const rows = [
    ['새 틀', '화면 뼈대, 붙였다 떼는 패널, 두 가지 화면 방식, 하나로 합친 되돌리기, 명령 찾기, API 통로', '지금'],
    ['이미지 작업실', '고르는 도구, 보정, AI 도구, NovelAI는 들어왔고, 가림막·고급 보정·AI 지우개·자동 흰칠이 남았어요', '지금'],
    ['캐릭터 작업실', '배경과 인물 나누기, AI로 외곽선 따기, 고른 곳 가져오기, 뼈대와 움직임, 메운 자리를 NovelAI로 바로 다시 그리기', '지금'],
    ['영상 작업실', '장면 잇기와 MP4·WebP·GIF 내보내기는 들어왔고, 글자·넘김 효과·소리·AI 중간 장면이 남았어요', '지금'],
    ['컷 작업실', '페이지, 컷, 손그림 말풍선(종류 견본·이어 붙이기·그 자리에서 고치기), 글자, 대사 번역, 그림 속 글자 번역, 효과음, 모양 묶음이 들어왔어요', '지금'],
    ['일괄 처리 작업실', '배경 지우기, 화질 키우기, 크기·형식 바꾸기, NAI 정보 지우기를 여러 장에 한 번에', '지금'],
    ['8.x 작업 가져오기', '8.x에서 "작업 파일 저장"으로 만든 파일을 파일 메뉴에서 가져와요. 그림은 보관함으로, 페이지는 컷 작업실로', '지금'],
  ];
  dialog({ title: '2.0에서 달라지는 것', wide: true, buttons: [{ label: '닫기', primary: true }],
    body: h('div', null, h('p.dlg-text', null, '감자 편집기 2.0은 새 틀 위에 8.x의 기능을 하나씩 옮겨 담는 중이에요. 아직 옮기지 않은 기능은 8.x에서 그대로 쓸 수 있어요.'),
      h('table.plan', null, h('tbody', null, rows.map(r => h('tr' + (r[2] === '지금' ? '.now' : ''), null, h('th', { scope: 'row' }, r[0]), h('td', null, r[1]), h('td.plan-when', null, r[2])))))) });
}

const KIND = { write: '글쓰기', translate: '번역', dub: '더빙', video: 'AI 영상', edit: '그림 고치기', 'nai generate': 'NovelAI 그림', 'nai img2img': 'NovelAI 다시 그리기', 'nai infill': 'NovelAI 고른 곳', 'nai upscale': 'NovelAI 화질 키우기', 'nai vibe': 'NovelAI 분위기 참고', 'nai lineart': 'NovelAI 선화', 'nai sketch': 'NovelAI 스케치', 'nai colorize': 'NovelAI 색 입히기', 'nai emotion': 'NovelAI 표정', 'nai declutter': 'NovelAI 글자 지우기' };
function usageDialog() {
  const L = usageLog(), T = totals(L);
  const rate = h('input.num', { type: 'number', min: 500, max: 3000, step: 10, value: krw(), 'aria-label': '1달러가 몇 원인지', style: 'width:80px', onchange: e => { settings.set('krw', Math.min(3000, Math.max(500, +e.target.value || 1340))); d.close(); usageDialog(); } });
  const d = dialog({ title: 'API 사용 기록', wide: true, buttons: [{ label: '기록 지우기', run: () => { usageClear(); } }, { label: '닫기', primary: true }],
    body: L.length ? h('div.vid-form', null,
      h('table.plan', null, h('tbody', null, [['오늘', T.day], ['이번 달', T.month], ['전체', T.all]].map(([t, v]) => h('tr', null, h('th', { scope: 'row' }, t), h('td', null, money(v)))))),
      h('p.dlg-text', null, '금액은 제미나이 요금표로 어림한 값이에요. 실제 청구액은 구글이 정해요. NovelAI는 Anlas로 내서 금액에 넣지 않았어요.'),
      h('label.field', null, h('span.field-name', null, '1달러 ='), rate, h('span.field-unit', null, '원')),
      h('table.plan', null, h('tbody', null, L.slice(0, 200).map(r => h('tr', null, h('td.plan-when', null, new Date(r.t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })), h('th', { scope: 'row' }, KIND[r.kind] || r.kind), h('td', null, r.model || ''), h('td.plan-when', null, r.size ? `${r.size}${r.steps ? `, ${r.steps}스텝` : ''}` : `보냄 ${(r.in || 0).toLocaleString('ko-KR')} / 받음 ${((r.out || 0) + (r.th || 0)).toLocaleString('ko-KR')} 토큰`), h('td.plan-when', null, String(r.kind).startsWith('nai') ? 'Anlas' : money(costOf(r))))))))
      : h('p.dlg-text', null, '아직 기록이 없어요. 제미나이나 NovelAI를 쓰면 여기에 남고, 제미나이는 금액도 어림해 보여 줘요.') });
}
// 새 판 확인: 깃허브에 올라온 2.0 판 중 가장 새것과 견줘요
const verNum = v => { const m = /(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?/.exec(v) || []; return [+m[1] || 0, +m[2] || 0, +m[3] || 0, m[4] ? ({ alpha: 0, beta: 1, rc: 2 }[m[4]] ?? 0) : 9, +m[5] || 0]; };
const newer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 5; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
// 설치판: 새 판을 스스로 받아 설치하고 다시 켜요. 안 되면 아래의 '받는 곳 열기' 안내로 넘어가요
async function selfUpdate() {
  const T = window.__TAURI__; if (!T || !T.updater) return false;
  let up = null; try { up = await T.updater.check(); } catch (_) { return false; }
  if (!up) return false;
  const msg = h('p.dlg-text', { role: 'status' }, '\u00a0'), bar = h('div.job-bar', null, h('span', { style: 'width:0%' }));
  const d = dialog({ title: '새 판이 나왔어요', body: h('div.vid-form', null, h('p.dlg-text', null, `지금 쓰는 판은 ${VERSION}, 새 판은 ${up.version}이에요. 받아서 설치한 뒤 감자 편집기가 잠깐 닫혔다가 새 판으로 다시 열려요. 작업은 그대로 남아요.`), bar, msg),
    buttons: [{ label: '나중에' }, { label: '지금 업데이트', primary: true, run: () => { go(); return false; } }] });
  let busyNow = false;
  const go = async () => {
    if (busyNow) return; busyNow = true;
    try {
      await saveNow(); let total = 0, got = 0;
      await up.downloadAndInstall(ev => {
        if (ev.event === 'Started') total = (ev.data && ev.data.contentLength) || 0;
        else if (ev.event === 'Progress') got += (ev.data && ev.data.chunkLength) || 0;
        else if (ev.event === 'Finished') { msg.textContent = '설치하는 중이에요.'; return; }
        bar.firstChild.style.width = (total ? Math.round(got / total * 100) : 50) + '%'; msg.textContent = total ? `${(got / 1e6).toFixed(1)}MB / ${(total / 1e6).toFixed(1)}MB 받는 중이에요.` : '받는 중이에요.';
      });
      if (T.process) await T.process.relaunch(); else d.close();
    } catch (e) { busyNow = false; msg.textContent = '업데이트하지 못했어요. 나중에 다시 해 주세요. (' + String((e && e.message) || e).slice(0, 80) + ')'; }
  };
  return true;
}
async function checkUpdate(quiet) {
  if (await selfUpdate()) { settings.set('updSeen', Date.now()); return true; }
  try {
    const res = await fetch('https://api.github.com/repos/harp1455/Potato-editor/releases?per_page=30', { headers: { Accept: 'application/vnd.github+json' } }); if (!res.ok) throw new Error(String(res.status));
    const top = (await res.json()).filter(r => /^v2\./.test(r.tag_name) && !r.draft).sort((a, b) => newer(a.tag_name, b.tag_name) ? -1 : 1)[0];
    settings.set('updSeen', Date.now());
    if (top && newer(top.tag_name, VERSION)) { dialog({ title: '새 판이 나왔어요', body: h('div', null, h('p.dlg-text', null, `지금 쓰는 판은 ${VERSION}, 새 판은 ${top.tag_name.slice(1)}이에요. 받는 곳에서 설치 파일이나 HTML 파일을 받아 주세요. 작업은 그대로 남아요.`)), buttons: [{ label: '나중에' }, { label: '받는 곳 열기', primary: true, run: () => { window.open(top.html_url, '_blank', 'noopener'); } }] }); return true; }
    if (!quiet) toast('지금 쓰는 판이 가장 새 판이에요.');
  } catch (_) { if (!quiet) toast('새 판이 있는지 확인하지 못했어요. 인터넷 연결을 확인해 주세요.', 'err'); }
  return false;
}

function adultDialog(then) {
  dialog({ title: '성인 확인', dismiss: false,
    body: h('div', null,
      h('p.dlg-text', null, '감자 편집기의 AI 기능(번역, 더빙, 영상 등)은 성인 창작물을 다루도록 맞춰져 있어요. 구글 제미나이에 요청을 보낼 때 안전 설정 5가지를 모두 끄고, "성인인증이 완료된 사용자"라는 안내문을 맨 앞에 붙여 보내요.'),
      h('p.dlg-text', null, '그래서 AI 기능은 성인만 쓸 수 있어요. 그림을 편집하는 기능은 확인하지 않아도 쓸 수 있고, 이 확인은 설정에서 언제든 다시 할 수 있어요.')),
    buttons: [
      { label: '나중에 하기', run: () => { settings.set('askedAdult', true); } },
      { label: '만 19세 이상입니다', primary: true, run: () => { settings.set('askedAdult', true); settings.set('adultAt', new Date().toISOString()); settings.set('adult', true); toast('성인 확인을 마쳤어요. AI 기능을 쓸 수 있어요.'); } },
    ], onClose: () => then && then() });
}

// 단축키를 바꾸려고 새 키를 기다리는 중이면, 그 기다림을 그만두는 함수예요 (한 번에 하나만)
let keyWait = null;
const stopKeyWait = () => { if (keyWait) { const f = keyWait; keyWait = null; f(); } };
function settingsDialog(tab = 'screen') {
  const TABS = [['screen', '화면'], ['api', 'AI와 API'], ['packs', 'AI 팩'], ['keys', '단축키'], ['about', '정보']];
  const nav = h('div.set-nav', { role: 'tablist' }), pane = h('div.set-pane');
  const d = dialog({ title: '설정', wide: true, body: h('div.set', null, nav, pane), buttons: [{ label: '닫기', primary: true }] , onClose: stopKeyWait });
  const radio = (name, cur, opts, on) => h('div.choice', { role: 'radiogroup' }, opts.map(([v, title, desc]) => h('label.choice-item' + (v === cur ? '.on' : ''), null,
    h('input', { type: 'radio', name, checked: v === cur, onchange: () => { on(v); show(tab); } }), h('span', null, h('b', null, title), h('small', null, desc)))));
  const P = {
    screen: () => [
      h('h3', null, '화면 방식'),
      radio('mode', settings.get('layoutMode'), [['rooms', '작업실 나누기', '이미지, 컷, 영상, 캐릭터 작업실을 오가요. 작업실마다 패널 배치를 따로 기억해요.'], ['single', '한 화면에 모두', '패널 배치 하나로 모든 일을 해요. 가운데 화면만 위쪽 단추로 바꿔요.']], v => settings.set('layoutMode', v)),
      h('h3', null, '그림을 끌어다 놓으면'),
      radio('drop', settings.get('dropNew') ? 'new' : 'layer', [['layer', '지금 그림판에 레이어로', '열려 있는 그림 위에 겹쳐 올려요. Shift를 누르고 놓으면 새 그림판으로 열려요.'], ['new', '새 그림판(탭)으로', '그림마다 탭을 새로 열어요. Shift를 누르고 놓으면 지금 그림판에 레이어로 올라가요.']], v => settings.set('dropNew', v === 'new')),
      h('h3', null, '밝기'),
      radio('theme', settings.get('theme'), [['dark', '어두운 화면', '그림의 색이 가장 정확하게 보여요.'], ['light', '밝은 화면', '밝은 곳에서 일하거나 흰 종이 위 그림을 볼 때 편해요.'], ['system', '컴퓨터 설정 따르기', '윈도우의 밝게·어둡게 설정을 따라가요.']], v => { settings.set('theme', v); applyTheme(); }),
      h('h3', null, '도움말'),
      h('label.check', null, h('input', { type: 'checkbox', checked: settings.get('hints'), onchange: e => settings.set('hints', e.target.checked) }), '아래 상태 줄에 지금 도구의 쓰는 법 보여 주기'),
      h('h3', null, '패널'),
      h('p.set-note', null, '패널의 탭을 끌면 왼쪽, 오른쪽, 아래 중 원하는 자리로 옮길 수 있어요. 경계를 끌면 넓이가 바뀌어요.'),
      h('button.btn', { onclick: () => run('view.resetLayout') }, '이 화면의 패널 배치 처음으로'),
    ],
    api: () => {
      const out = h('p.set-note', { role: 'status' });
      const pre = h('pre.preamble', null, preamble('write'));
      const naiOut = h('p.set-note', { role: 'status' });
      return [
        h('h3', null, '성인 확인'),
        settings.get('adult')
          ? h('p.set-note', null, `확인을 마쳤어요 (${new Date(settings.get('adultAt')).toLocaleDateString('ko-KR')}). `, h('button.link', { onclick: () => { settings.set('adult', false); show('api'); } }, '확인 취소'))
          : h('div', null, h('p.set-note', null, 'AI 기능을 쓰려면 성인 확인이 필요해요.'), h('button.btn.primary', { onclick: () => adultDialog(() => show('api')) }, '성인 확인하기')),
        h('h3', null, '구글 제미나이 API 키'),
        h('input.text.wide', { type: 'password', value: settings.get('apiKey'), placeholder: 'AIza…', autocomplete: 'off', 'aria-label': 'API 키', onchange: e => settings.set('apiKey', e.target.value.trim()) }),
        h('p.set-note', null, '키는 이 컴퓨터에만 저장되고, 구글 제미나이 서버로만 보내요.'),
        h('label.field', null, h('span.field-name', null, '글 모델'), h('input.text', { type: 'text', value: settings.get('textModel'), 'aria-label': '글 모델', onchange: e => settings.set('textModel', e.target.value.trim()) })),
        h('div.btn-row', null, h('button.btn', { onclick: async e => { e.target.disabled = true; out.textContent = '확인하는 중이에요.'; try { await check(); out.textContent = '연결됐어요. 안전 설정을 끈 요청을 서버가 받았어요.'; } catch (err) { out.textContent = err.message; } e.target.disabled = false; } }, '연결 확인')), out,
        h('h3', null, 'NovelAI 토큰'),
        h('input.text.wide', { type: 'password', value: settings.get('naiToken'), placeholder: 'pst-…', autocomplete: 'off', 'aria-label': 'NovelAI 토큰', onchange: e => settings.set('naiToken', e.target.value.trim()) }),
        h('p.set-note', null, 'NovelAI 누리집의 계정 설정에서 받는 "Persistent API Token"이에요. 이 컴퓨터에만 저장되고 NovelAI 서버로만 보내요. 오른쪽 NovelAI 패널에서 그림 만들기, 다시 그리기, 고른 곳만 다시 그리기를 써요.'),
        h('div.btn-row', null, h('button.btn', { onclick: async e => { e.target.disabled = true; naiOut.textContent = '확인하는 중이에요.'; try { const a = await naiAccount(); naiOut.textContent = `연결됐어요. ${a.tier}, 남은 Anlas ${a.anlas.toLocaleString('ko-KR')}`; } catch (err) { naiOut.textContent = err.message; } e.target.disabled = false; } }, 'NovelAI 연결 확인')), naiOut,
        h('h3', null, '사용 기록'),
        (() => { const L = usageLog(), m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0); const M = L.filter(r => r.t >= +m0), tin = M.reduce((a, r) => a + (r.in || 0), 0), tout = M.reduce((a, r) => a + (r.out || 0), 0);
          return h('p.set-note', null, `이번 달 요청 ${M.length}번, 보낸 토큰 ${tin.toLocaleString('ko-KR')}, 받은 토큰 ${tout.toLocaleString('ko-KR')}. NovelAI ${M.filter(r => String(r.kind).startsWith('nai')).length}번. `, h('button.link', { onclick: usageDialog }, '기록 보기')); })(),
        h('h3', null, '모든 요청에 먼저 붙는 것'),
        h('p.set-note', null, `안전 설정 ${SAFETY_CATEGORIES.length}가지를 모두 "끔"으로 보내고, 아래 안내문을 다른 지시보다 앞에 둬요. 글 요청은 괴롭힘·혐오·성적 내용·위험한 내용·선거와 시민, 목소리와 영상 요청은 혐오·위험한 내용·괴롭힘·성적 내용·탈옥 판정이에요. 번역, 더빙, 영상은 안내문의 둘째 줄과 넷째 줄만 그 일에 맞게 바뀌어요.`),
        h('div.btn-row', null, [['write', '글쓰기'], ['translate', '번역'], ['dub', '더빙'], ['video', '영상'], ['edit', '그림 고치기']].map(([k, t]) => h('button.btn.small', { onclick: () => { pre.textContent = preamble(k); } }, t))),
        pre,
        h('p.set-note', null, '안전 설정을 꺼도 구글에는 끌 수 없는 거름막이 따로 있어요. 그래서 일부 요청은 여전히 거절될 수 있고, 그때는 어디서 왜 막혔는지 알려 드려요.'),
      ];
    },
    keys: () => [
      h('p.set-note', null, '바꿀 줄을 누른 다음 새 키를 누르세요. Esc는 취소, Backspace는 단축키 없애기예요.'),
      h('div.keys', null, cmds().filter(c => c.title).map(c => {
        const b = h('button.key-btn', { onclick: () => { stopKeyWait(); b.textContent = '새 키를 누르세요'; b.classList.add('wait'); const f = e => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { /* 그대로 */ } else if (e.key === 'Backspace') settings.set('keys', { ...settings.get('keys'), [c.id]: '' }); else { const k = keyName(e); if (!k) return; const clash = cmds().find(o => o.id !== c.id && keysOf(o.id) === k); if (clash) toast(`'${clash.title}'에서 쓰던 키예요. 그쪽 단축키는 비웠어요.`); settings.set('keys', { ...settings.get('keys'), ...(clash ? { [clash.id]: '' } : {}), [c.id]: k }); } stopKeyWait(); show('keys'); }; addEventListener('keydown', f, true); keyWait = () => { removeEventListener('keydown', f, true); b.classList.remove('wait'); b.textContent = fmtKeys(keysOf(c.id)) || '없음'; }; } }, fmtKeys(keysOf(c.id)) || '없음');
        return h('div.key-row', null, h('span.key-menu', null, c.menu || ''), h('span.key-title', null, c.title), b);
      })),
      h('button.btn', { onclick: () => { settings.set('keys', {}); show('keys'); } }, '모든 단축키 처음으로'),
    ],
    about: () => [
      h('h3', null, '감자 편집기 ' + VERSION),
      h('p.set-note', null, '2.0은 새 틀 위에 8.x의 기능을 옮겨 담는 중인 미리보기판이에요. 작업은 이 컴퓨터의 브라우저 저장 공간에 저장되고, 8.x의 작업과는 따로 보관돼요.'),
      h('div.btn-row', null, h('button.btn', { onclick: () => checkUpdate(false) }, '새 판 확인'), h('button.btn', { onclick: () => { d.close(); run('help.plan'); } }, '2.0에서 달라지는 것 보기')),
      h('label.check', null, h('input', { type: 'checkbox', checked: settings.get('autoUpd') !== false, onchange: e => settings.set('autoUpd', e.target.checked) }), '켤 때 하루에 한 번 새 판이 있는지 확인하기'),
    ],
  };
  const show = t => {
    tab = t;
    nav.replaceChildren(...TABS.map(([id, title]) => h('button.set-tab' + (id === t ? '.on' : ''), { role: 'tab', 'aria-selected': String(id === t), onclick: () => show(id) }, title)));
    if (t === 'packs') { pane.replaceChildren(h('p.set-note', null, '팩을 확인하는 중이에요.')); packsPane(() => tab === 'packs' && show('packs')).then(kids => { if (tab === 'packs') pane.replaceChildren(...kids); }); return; }
    pane.replaceChildren(...P[t]());
  };
  show(tab);
}

// ---------- 시작 ----------
async function start() {
  applyTheme(); matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);
  swatchList();
  setErrHandler(e => { console.error(e); noteDetail(e.code || 'error', e.message || '', (e.detail ? e.detail + ' / ' : '') + String(e.stack || '').split('\n').slice(0, 4).join(' | ')); toast(e.message || '문제가 생겼어요.', 'err'); });
  setErrUi(errDialog, () => (ROOMS.find(r => r.id === settings.get('room')) || {}).title || '');
  // 어디서도 잡지 못한 오류도 화면을 막지 않고 기록에만 남겨요
  addEventListener('error', e => logErr('알 수 없는 오류', e.message, `${e.filename || ''}:${e.lineno || ''} ${e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 4).join(' | ') : ''}`));
  addEventListener('unhandledrejection', e => { const r = e.reason || {}; logErr('알 수 없는 오류', r.message || String(r), (r.code ? r.code + ' / ' : '') + (r.detail ? r.detail + ' / ' : '') + String(r.stack || '').split('\n').slice(0, 4).join(' | ')); });
  registerCmds(); build();
  setSaveErrHandler(why => toast('작업을 저장하지 못하고 있어요. 저장 공간이 모자라거나 막혀 있을 수 있어요. 파일 메뉴의 백업으로 작업을 따로 남겨 두세요. (' + why + ')', 'err'));
  const bootErr = await boot(); tidyMedia().catch(() => {});
  if (bootErr) setTimeout(() => toast('마지막 작업을 열지 못해서 새 작업으로 시작했어요. 파일 메뉴의 작업 목록에서 다시 열어 볼 수 있어요. (' + bootErr + ')', 'err'), 300);   // 작업을 열 때 안 쓰는 그림을 치워요
  renderChrome(); mountRoom(); refresh();
  onChange(refresh); onTick(renderStatus);
  settings.on(k => {
    if (k === 'room' || k === 'layoutMode' || k === 'keys') renderChrome();
    if (k === 'room' || k === 'layoutMode') mountRoom();
    if (k === 'layouts') renderDock(els.work, els.center);
    refresh();
  });
  addEventListener('keydown', e => { if (document.querySelector('#vsStudio:not([hidden])')) return;   // 영상 자막 번역 창이 떠 있으면 밑의 편집기는 키를 받지 않아요
    if (document.querySelector('.dlg-back') && (!/^Ctrl\+K$/.test(keyName(e)) || document.querySelector('.pal-dlg'))) return; if (handleKey(e)) closeMenu(); });
  document.addEventListener('focusout', e => { if (!isRendering() && e.target.closest && e.target.closest('.zone-body')) setTimeout(() => updatePanels()); });
  addEventListener('beforeunload', () => { if (!state.saved) saveNow(); });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, .viewport, .layer')) e.preventDefault(); });
  if (!settings.get('askedAdult')) adultDialog();
  else if (settings.get('autoUpd') !== false && Date.now() - (settings.get('updSeen') || 0) > 864e5 && VERSION !== 'dev') setTimeout(() => checkUpdate(true), 4000);
  window.__potato = { state, settings, run, emit, cmds, api: { generate, buildBody, buildInteraction, speak, animate, preamble, check } };
  import('./core/files.js').then(f => { window.__potato.files = f; });
  import('./core/ai.js').then(f => { window.__potato.ai = f; }); import('./core/packs.js').then(f => { window.__potato.packs = f; });
  import('./core/select.js').then(f => { window.__potato.sel = f; });
  import('./api/nai.js').then(f => { window.__potato.nai = f; });
  import('./core/ai.js').then(f => { window.__potato.ai = f; });
  import('./core/encode.js').then(f => { window.__potato.enc = f; });
  import('./rooms/video.js').then(f => { window.__potato.video = f; });
  import('./rooms/image.js').then(f => { window.__potato.image = f; });
  import('./ui/geminitools.js').then(f => { window.__potato.gem = f; });
  import('./rooms/cut.js').then(f => { window.__potato.cut = f; });
  window.__potato.liq = { makeField, stroke, warp };
  window.__potato.tidy = tidyMedia; import('./core/store.js').then(f => { window.__potato.store = f; });
  import('./ui/bin.js').then(f => { window.__potato.picked = f.picked; });
  window.__potato.toastErr = m => toast(m, 'err');
  window.__potato.link = { linkState, startWatch, stopWatch, sendOut };
}
start();
