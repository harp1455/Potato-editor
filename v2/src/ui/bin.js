// 보관함 패널: 폴더 나무, 끌어서 옮기기, 폴더째 넣기·저장, NAI 정보 지우기
import { h, icon } from './dom.js';
import { state, emit, folders, folderById, folderPath, newCanvas, addLayer, commit } from '../core/store.js';
import { settings } from '../core/settings.js';
import { addCmd, run } from '../core/cmd.js';
import { fromDrop, fromPicker, saveFiles } from '../core/files.js';
import { importItems, mediaIn, moveMedia, moveFolder, newFolder, renameFolder, deleteFolder, removeMedia, layersUsing, collectFiles, stripMedia } from '../core/library.js';
import { placeMedia } from '../rooms/image.js';
import { showMenu, toast, busy, askText, confirmBox, dialog } from './overlay.js';

const closed = new Set();
export const picked = new Set();   // 고른 그림들
let anchor = null, lastClick = { id: null, t: 0 };
const MEDIA = 'application/x-potato-media', MEDIAS = 'application/x-potato-medias', FOLDER = 'application/x-potato-folder';

export async function importInto(items, base = null) {
  if (!items.length) { toast('넣을 그림이 없어요. PNG, JPG, WebP 같은 그림 파일만 넣을 수 있어요.', 'err'); return; }
  const b = items.length > 3 ? busy(`그림을 넣는 중이에요. 0 / ${items.length}`) : null;
  const { made, failed } = await importItems(items, base, (i, n) => b && b.set(`그림을 넣는 중이에요. ${i} / ${n}`));
  if (made.length) commit(made.length > 1 ? `그림 ${made.length}장 넣기` : '그림 넣기');
  const dirs = new Set(items.map(i => i.dir).filter(Boolean)).size;
  const msg = made.length ? `그림 ${made.length}장을 넣었어요.` + (dirs ? ` 폴더 ${dirs}개 모양 그대로예요.` : '') : '';
  if (b) b.done(msg); else if (failed.length === 0 && made.length > 1) toast(msg);
  if (failed.length) toast(`열 수 없는 파일 ${failed.length}개는 건너뛰었어요.`, 'err');
}
function pick(dir) {
  const i = h('input', { type: 'file', accept: 'image/*', multiple: true });
  if (dir) { i.webkitdirectory = true; i.removeAttribute('accept'); }
  i.onchange = () => importInto(dir ? fromPicker(i.files) : [...i.files].map(file => ({ file, dir: '' })));
  i.click();
}

// 저장 창: 무엇을(전체·폴더·고른 것), NAI 정보를 지울지
export function saveDialog(list, { title, root = null, zipName }) {
  if (!list.length) { toast('저장할 그림이 없어요.', 'err'); return; }
  let strip = settings.get('meta') !== 'keep';
  const withMeta = list.filter(m => m.meta).length;
  const opt = (v, t, d) => h('label.choice-item' + (strip === v ? '.on' : ''), null, h('input', { type: 'radio', name: 'meta', checked: strip === v, onchange: () => { strip = v; draw(); } }), h('span', null, h('b', null, t), h('small', null, d)));
  const box = h('div');
  const draw = () => box.replaceChildren(
    h('p.dlg-text', null, `그림 ${list.length}장을 원래 이름과 폴더 모양 그대로 저장해요. ` + (window.showDirectoryPicker ? '저장할 폴더를 고르면 그 안에 바로 만들어요.' : '이 브라우저에서는 ZIP 파일 하나로 묶어 드려요.')),
    h('h3.dlg-sub', null, 'NAI 정보'),
    h('div.choice', { role: 'radiogroup' }, opt(true, '지우고 저장', withMeta ? `${withMeta}장에 든 프롬프트·설정 정보를 지워요. 보관함의 그림은 그대로 둬요.` : '정보가 든 그림이 없어서 그대로 저장돼요.'), opt(false, '남기고 저장', '원래 파일 그대로 저장해요.')));
  draw();
  dialog({ title, body: box, buttons: [{ label: '취소' }, { label: '저장', primary: true, run: () => {
    settings.set('meta', strip ? 'strip' : 'keep');
    (async () => {
      const b = busy(`저장할 파일을 준비하는 중이에요. 0 / ${list.length}`);
      try {
        const files = await collectFiles(list, { strip, root, onStep: (i, n) => b.set(`저장할 파일을 준비하는 중이에요. ${i} / ${n}`) });
        b.set('저장하는 중이에요.');
        const r = await saveFiles(files, zipName);
        b.done(r === 'dir' ? `그림 ${files.length}장을 고른 폴더에 저장했어요.` : r === 'zip' ? `그림 ${files.length}장을 '${zipName}'으로 묶어 저장했어요.` : '');
      } catch (e) { b.done('저장하지 못했어요. ' + (e.message || ''), 'err'); }
    })();
  } }] });
}
async function stripAsk(list, what) {
  const n = list.filter(m => m.meta).length;
  if (!n) { toast('NAI 정보가 든 그림이 없어요.'); return; }
  if (!await confirmBox('NAI 정보 지우기', `${what} 그림 ${n}장에서 프롬프트·설정 정보를 지워요. 그림의 모습은 그대로예요. 보관함에 든 파일 자체를 바꾸기 때문에 되돌리기로 돌아오지 않아요.`, '지우기')) return;
  const b = busy(`NAI 정보를 지우는 중이에요. 0 / ${list.length}`);
  const done = await stripMedia(list, (i, t) => b.set(`NAI 정보를 지우는 중이에요. ${i} / ${t}`));
  b.done(`그림 ${done}장에서 NAI 정보를 지웠어요.`);
}
async function removeAsk(ids) {
  const used = layersUsing(ids);
  if (used && !await confirmBox('보관함에서 빼기', `이 그림을 쓰는 레이어 ${used}개도 함께 지워져요. 되돌리기로 다시 살릴 수 있어요.`, '빼기', true)) return;
  ids.forEach(id => picked.delete(id)); removeMedia(ids);
}
function openAsCanvas(m) { addLayer(newCanvas(m.name.replace(/\.[a-z0-9]+$/i, ''), m.w, m.h), m); commit('새 그림판으로 열기'); }

function dropOn(e, fid) {
  const dt = e.dataTransfer;
  const f = dt.getData(FOLDER);
  if (f) { const r = moveFolder(f, fid); if (r === 'inside') toast('폴더를 자기 안쪽 폴더로는 옮길 수 없어요.', 'err'); return; }
  const ids = dt.getData(MEDIAS);
  if (ids) { moveMedia(JSON.parse(ids), fid); return; }
  if (dt.files && dt.files.length) fromDrop(dt).then(items => importInto(items, fid));
}
const target = (el, fid) => {
  el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); dropOn(e, fid); });
  return el;
};

function mediaEl(m, siblings) {
  const on = picked.has(m.id);
  return h('button.media' + (on ? '.on' : ''), {
    draggable: 'true', 'data-id': m.id, 'aria-pressed': String(on), title: `${m.name}\n${m.w} × ${m.h}` + (m.meta ? '\nNAI 정보가 들어 있어요' : ''),
    onclick: e => {
      const twice = lastClick.id === m.id && Date.now() - lastClick.t < 450; lastClick = { id: m.id, t: Date.now() };
      if (twice) return placeMedia(m.id);
      if (e.shiftKey && anchor && siblings.some(s => s.id === anchor)) { const a = siblings.findIndex(s => s.id === anchor), b = siblings.indexOf(m); siblings.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(s => picked.add(s.id)); }
      else if (e.ctrlKey || e.metaKey) { on ? picked.delete(m.id) : picked.add(m.id); anchor = m.id; }
      else { picked.clear(); picked.add(m.id); anchor = m.id; }
      emit();
    },
    onkeydown: e => { if (e.key === 'Enter') placeMedia(m.id); if (e.key === 'Delete') removeAsk(picked.has(m.id) ? [...picked] : [m.id]); },
    ondragstart: e => {
      const ids = picked.has(m.id) ? [...picked] : [m.id];
      e.dataTransfer.setData(MEDIA, m.id); e.dataTransfer.setData(MEDIAS, JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copyMove';
    },
    oncontextmenu: e => {
      e.preventDefault(); e.stopPropagation();
      if (!picked.has(m.id)) { picked.clear(); picked.add(m.id); anchor = m.id; emit(); }
      const ids = [...picked], list = state.project.media.filter(x => ids.includes(x.id)), many = ids.length > 1;
      showMenu([
        { head: many ? `그림 ${ids.length}장` : m.name },
        { label: '레이어로 올리기', run: () => ids.forEach(placeMedia) },
        { label: '새 그림판으로 열기', disabled: many, run: () => openAsCanvas(m) },
        '-',
        { label: 'NAI 정보 지우기', disabled: !list.some(x => x.meta), run: () => stripAsk(list, '고른') },
        { label: many ? '고른 그림 저장…' : '파일로 저장…', run: () => saveDialog(list, { title: '그림 저장', zipName: '감자 편집기 그림.zip' }) },
        '-',
        { label: '폴더에서 빼기', disabled: !list.some(x => x.folder), run: () => moveMedia(ids, null) },
        { label: '보관함에서 빼기', run: () => removeAsk(ids) },
      ], e.clientX, e.clientY);
    },
  }, h('img', { src: state.thumbs.get(m.id) || '', alt: '', loading: 'lazy' }), m.meta && h('span.media-meta', { 'aria-label': 'NAI 정보 있음' }), h('span.media-name', null, m.name));
}
const grid = list => list.length ? h('div.media-grid', null, list.map(m => mediaEl(m, list))) : null;

function folderEl(f, depth) {
  const kids = folders().filter(x => x.parent === f.id), own = mediaIn(f.id, false), total = mediaIn(f.id).length, shut = closed.has(f.id);
  const headEl = target(h('div.fold' + (shut ? '.closed' : ''), {
    draggable: 'true', role: 'button', tabindex: '0', 'aria-expanded': String(!shut), style: `--d:${depth}`, title: '눌러서 접고 펴기. 그림이나 폴더를 여기로 끌면 이 폴더에 들어가요.',
    onclick: () => { shut ? closed.delete(f.id) : closed.add(f.id); emit(); },
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); shut ? closed.delete(f.id) : closed.add(f.id); emit(); } },
    ondragstart: e => { e.dataTransfer.setData(FOLDER, f.id); e.dataTransfer.effectAllowed = 'move'; },
    oncontextmenu: e => {
      e.preventDefault(); e.stopPropagation();
      const list = mediaIn(f.id);
      showMenu([
        { head: folderPath(f.id, ' › ') },
        { label: '하위 폴더 만들기…', run: async () => { const n = await askText(`'${f.name}' 안에 새 폴더`, '새 폴더', '만들기'); if (n) { closed.delete(f.id); newFolder(n, f.id); } } },
        { label: '이름 바꾸기…', run: async () => { const n = await askText('폴더 이름 바꾸기', f.name, '바꾸기'); if (n) renameFolder(f.id, n); } },
        '-',
        { label: '이 폴더째 저장…', disabled: !list.length, run: () => saveDialog(list, { title: `'${f.name}' 폴더 저장`, root: f.id, zipName: f.name + '.zip' }) },
        { label: '이 폴더의 NAI 정보 지우기', disabled: !list.some(m => m.meta), run: () => stripAsk(list, `'${f.name}' 폴더의`) },
        '-',
        { label: '맨 위로 꺼내기', disabled: !f.parent, run: () => moveFolder(f.id, null) },
        { label: '폴더 지우기', run: async () => { if (await confirmBox('폴더 지우기', `'${f.name}' 폴더만 지워요. 안에 있던 그림과 폴더는 ${f.parent ? `'${folderById(f.parent).name}' 폴더` : '맨 위'}로 옮겨져요.`, '지우기')) deleteFolder(f.id); } },
      ], e.clientX, e.clientY);
    },
  }, h('span.fold-arrow', null, icon('chevron', 12)), icon('folder', 14), h('span.fold-name', null, f.name), h('span.fold-count', null, String(total))), f.id);
  const body = shut ? null : h('div.fold-body', { style: `--d:${depth + 1}` }, kids.map(k => folderEl(k, depth + 1)), grid(own), !kids.length && !own.length && h('p.fold-empty', null, '비어 있어요'));
  return h('div.fold-wrap', null, headEl, body);
}

export const binPanel = {
  title: '보관함',
  render(el) {
    const p = state.project, roots = folders().filter(f => !f.parent), loose = mediaIn(null, false);
    [...picked].forEach(id => { if (!p.media.some(m => m.id === id)) picked.delete(id); });
    const bar = h('div.bin-bar', null,
      h('button.icon-btn', { title: '그림 넣기', 'aria-label': '그림 넣기', onclick: () => pick(false) }, icon('imagePlus')),
      h('button.icon-btn', { title: '폴더째 넣기 (하위 폴더까지 그대로)', 'aria-label': '폴더째 넣기', onclick: () => pick(true) }, icon('folderIn')),
      h('button.icon-btn', { title: '새 폴더', 'aria-label': '새 폴더', onclick: () => run('bin.newFolder') }, icon('folderPlus')),
      h('span.grow'),
      h('button.icon-btn', { title: '보관함 전체를 폴더째 저장', 'aria-label': '폴더째 저장', disabled: !p.media.length, onclick: () => run('bin.saveAll') }, icon('folderOut')));
    const tree = target(h('div.bin-tree', {
      oncontextmenu: e => { e.preventDefault(); showMenu([{ label: '그림 넣기…', run: () => pick(false) }, { label: '폴더째 넣기…', run: () => pick(true) }, { label: '새 폴더…', run: () => run('bin.newFolder') }, '-', { label: '보관함 전체를 폴더째 저장…', disabled: !p.media.length, run: () => run('bin.saveAll') }, { label: '모든 그림의 NAI 정보 지우기', disabled: !p.media.some(m => m.meta), run: () => stripAsk(p.media, '보관함의 모든') }], e.clientX, e.clientY); },
      onclick: e => { if (e.target === tree && picked.size) { picked.clear(); emit(); } },
    }), null);
    if (!p.media.length && !roots.length) tree.append(h('p.empty', null, '그림이나 폴더를 여기로 끌어다 놓으세요. 폴더째 넣으면 하위 폴더까지 그 모양 그대로 들어와요.'));
    else tree.append(...roots.map(f => folderEl(f, 0)), grid(loose) || '');
    el.classList.add('flush'); el.append(bar, tree);
    if (p.media.length) el.append(h('p.bin-foot', null, picked.size > 1 ? `그림 ${picked.size}장을 골랐어요. 폴더 이름 위로 끌면 옮겨져요.` : '두 번 누르면 레이어로 올라가요. Ctrl이나 Shift로 여러 장을 골라요.'));
  },
};

export function registerBinCmds() {
  addCmd({ id: 'file.openFolder', title: '폴더째 넣기…', menu: '파일', keys: 'Ctrl+Shift+I', words: '폴더 불러오기 import', run: () => pick(true) });
  addCmd({ id: 'bin.newFolder', title: '보관함에 새 폴더…', menu: '파일', group: 'bin', run: async () => { const n = await askText('새 폴더 이름', '새 폴더', '만들기'); if (n) newFolder(n); } });
  addCmd({ id: 'bin.saveAll', title: '보관함 전체를 폴더째 저장…', menu: '파일', group: 'bin', keys: 'Ctrl+Shift+S', words: '내보내기 export zip', enabled: () => state.project.media.length > 0, run: () => saveDialog(state.project.media, { title: '보관함 전체 저장', zipName: state.project.name + '.zip' }) });
  addCmd({ id: 'bin.strip', title: '모든 그림의 NAI 정보 지우기', menu: '파일', group: 'bin', words: '메타데이터 프롬프트 metadata', enabled: () => state.project.media.some(m => m.meta), run: () => stripAsk(state.project.media, '보관함의 모든') });
}
