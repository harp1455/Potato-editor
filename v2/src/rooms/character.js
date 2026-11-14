// 캐릭터 작업실: 그림 속 캐릭터를 나누고, 뼈대를 넣어 움직여요.
// 움직임 편집 창은 8.x의 '캐릭터 움직이기'를 그대로 가져와 써요(legacy/shim.js). 나누는 단계는 2.0의 AI 도구와 고르는 도구로 해요.
import { h } from '../ui/dom.js';
import { state, commit, canvasOf, ensureBitmap, ensureFolder, addMedia } from '../core/store.js';
import { settings } from '../core/settings.js';
import { run } from '../core/cmd.js';
import { addCmd } from '../core/cmd.js';
import { flatten, layerFromBlob, view } from './image.js';
import { openRig, rigSaved } from '../legacy/shim.js';
import { dialog, toast, busy } from '../ui/overlay.js';
import { download } from '../core/files.js';
import { encodeFrames, canMp4 } from '../core/encode.js';
import { addFrames } from './video.js';

const png = c => new Promise(r => c.toBlob(r, 'image/png'));
const mediaOf = l => state.project.media.find(m => m.id === l.mediaId);

// 장면들을 영상 파일(WebM)로: 캔버스에 한 장씩 그리며 녹화해요 (실제 길이만큼 걸려요)
async function toWebm(frames, fps) {
  const c = document.createElement('canvas'); c.width = frames[0].width; c.height = frames[0].height; const g = c.getContext('2d');
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('이 브라우저는 영상 녹화를 지원하지 않아요');
  const stream = c.captureStream(0), track = stream.getVideoTracks()[0], rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.min(40e6, c.width * c.height * fps * 0.18) }), parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const done = new Promise(r => { rec.onstop = r; });
  rec.start();
  for (const f of frames) { g.clearRect(0, 0, c.width, c.height); g.drawImage(f, 0, 0); if (track.requestFrame) track.requestFrame(); await new Promise(r => setTimeout(r, 1000 / fps)); }
  rec.stop(); await done;
  return new Blob(parts, { type: 'video/webm' });
}
function framesDialog(frames, fps, name) {
  const secs = (frames.length / fps).toFixed(1), W = frames[0].width, H = frames[0].height;
  const F = { fmt: canMp4() ? 'mp4' : 'webp', size: 0, loop: true };
  const box = h('div');
  const fmts = [['mp4', '영상 (MP4)', '어디서나 열리고 용량이 작아요. 투명한 배경은 검게 돼요.', canMp4()], ['webp', '움짤 (WebP)', '화질이 좋고 투명한 배경도 돼요.', true], ['gif', '움짤 (GIF)', '어디에나 올릴 수 있지만 256색이고 용량이 커요.', true], ['webm', '영상 (WebM)', 'MP4를 못 만드는 곳에서 쓰는 영상이에요. 실제 길이만큼 걸려요.', !canMp4()]].filter(f => f[3]);
  const draw = () => box.replaceChildren(
    h('p.dlg-text', null, `장면 ${frames.length}장, 초당 ${fps}장(${secs}초), ${W} × ${H}이에요.`),
    h('div.choice', { role: 'radiogroup' }, fmts.map(([v, t, d]) => h('label.choice-item' + (F.fmt === v ? '.on' : ''), null, h('input', { type: 'radio', name: 'fmt', checked: F.fmt === v, onchange: () => { F.fmt = v; draw(); } }), h('span', null, h('b', null, t), h('small', null, d))))),
    h('div.field-row', { style: 'margin-top:12px' },
      h('label.field', null, h('span.field-name.w', null, '크기'), h('select.text', { 'aria-label': '크기', onchange: e => { F.size = +e.target.value; } }, [[0, '그대로'], [1080, '긴 쪽 1080'], [800, '긴 쪽 800'], [640, '긴 쪽 640'], [480, '긴 쪽 480']].filter(([v]) => !v || v < Math.max(W, H)).map(([v, t]) => h('option', { value: v, selected: F.size === v }, t)))),
      F.fmt !== 'mp4' && F.fmt !== 'webm' ? h('label.check', null, h('input', { type: 'checkbox', checked: F.loop, onchange: e => { F.loop = e.target.checked; } }), '계속 되풀이') : h('span')));
  draw();
  const save = () => { (async () => {
    const b = busy('파일을 만드는 중이에요.');
    try {
      const blob = F.fmt === 'webm' ? await toWebm(frames, fps) : await encodeFrames(frames, F.fmt, { fps, size: F.size || 0, loop: F.loop, quality: 90 }, p => b.set(`파일을 만드는 중이에요. ${Math.round(p * 100)}%`));
      download(blob, `${name} 움직임.${F.fmt}`); b.done(`'${name} 움직임.${F.fmt}'로 저장했어요.`);
    } catch (e) { b.done(String(e && e.message) === 'nomp4' ? '이 컴퓨터에서는 MP4를 만들 수 없어요. WebP나 GIF로 저장해 주세요.' : '파일을 만들지 못했어요. ' + ((e && e.message) || ''), 'err'); }
  })(); return false; };
  dialog({ title: '움직임 내보내기', body: box, buttons: [
    { label: '닫기' },
    { label: '영상 작업실로 보내기', run: () => { (async () => {
      const b = busy(`장면을 영상 작업실로 보내는 중이에요. 0 / ${frames.length}`);
      const n = await addFrames(frames, fps, name, (i, t) => b.set(`장면을 영상 작업실로 보내는 중이에요. ${i} / ${t}`));
      b.done(`장면 ${n}개를 영상 작업실에 넣었어요.`); settings.set('room', 'video');
    })(); } },
    { label: '파일로 저장', primary: true, run: save },
  ] });
}

// src = 그림(캔버스·비트맵), key = 이어서 하기용 이름
export async function rigOpen(src, name, key) {
  const c0 = canvasOf();
  await openRig({ src, W: src.width, H: src.height, name, key, goLabel: '내보내기',
    onFrames: async (frames, fps) => { if (frames && frames.length) framesDialog(frames, fps, name); },
    onStill: async cv => { const c = canvasOf() || c0; if (!c) return; await layerFromBlob(c, await png(cv), name + ' 자세', { scale: Math.min(c.w / cv.width, c.h / cv.height), hidden: true }); commit('자세를 레이어로'); toast('이 자세를 새 레이어로 올렸어요.'); },
  });
}
async function rigLayer(l) { const m = mediaOf(l), bmp = await ensureBitmap(l.mediaId); if (bmp) rigOpen(bmp, l.name, state.project.id + ':m' + m.id); }
async function rigCanvas() { const c = canvasOf(); if (c) rigOpen(await flatten(c), c.name, state.project.id + ':c' + c.id); }

export const characterRoom = {
  id: 'character', title: '캐릭터', icon: 'character',
  mount(el) {
    const box = h('div.char-room'); el.append(box);
    const step = (n, title, text, btn) => h('div.char-step', null, h('span.n', null, String(n)), h('div', null, h('b', null, title), h('small', null, text)), btn || h('span'));
    const toImage = tool => () => { view.tool = tool; settings.set('room', 'image'); };
    let seq = 0;
    const update = async () => {
      const c = canvasOf(), my = ++seq;
      const saved = c ? await Promise.all(c.layers.map(l => rigSaved(state.project.id + ':m' + l.mediaId))) : [];
      if (my !== seq) return;
      box.replaceChildren(
        h('h2', null, '캐릭터 움직이기'),
        h('p.lead', null, '그림 한 장에서 캐릭터를 떼어 내 뼈대를 넣고 움직여요. 한 사람만 있는 그림은 3번부터 바로 해도 돼요. 여러 사람이 붙어 있으면 1, 2번으로 먼저 나눠 주세요.'),
        h('div.char-steps', null,
          step(1, '배경과 인물 나누기', '고른 레이어를 인물 레이어와 배경 레이어로 나눠요.', h('button.btn', { disabled: !c, onclick: () => { settings.set('room', 'image'); run('ai.bgSplit'); } }, '나누기')),
          step(2, '인물과 인물 나누기', "이미지 작업실의 'AI로 고르기'로 한 사람을 눌러 외곽선을 따요. 모자란 곳은 마법 붓으로 더하고 빼요. 그다음 '새 레이어로'를 누르면 그 사람만 레이어가 돼요.", h('button.btn', { disabled: !c, onclick: toImage('sam') }, 'AI로 고르기')),
          step(3, '뼈대를 넣고 움직이기', '아래에서 움직일 레이어를 골라요. 뼈대 맞추기, 부위 나누기, 움직임 편집 창이 열려요.')),
        !c ? h('p.lead', null, '먼저 이미지 작업실에서 그림을 열어 주세요.') : h('div.char-list', null,
          [...c.layers].reverse().map((l, i) => h('div.char-item', null, h('img', { src: state.thumbs.get(l.mediaId) || '', alt: '' }),
            h('div', null, h('b', null, l.name), saved[c.layers.length - 1 - i] ? h('small.saved', null, '하던 작업이 있어요') : h('small', null, (m => m ? `${m.w} × ${m.h}` : '')(mediaOf(l)))),
            h('button.btn' + (i === 0 ? '.primary' : ''), { onclick: () => rigLayer(l) }, saved[c.layers.length - 1 - i] ? '이어서 움직이기' : '이 레이어 움직이기'))),
          c.layers.length > 1 && h('div.char-item', null, h('span'), h('div', null, h('b', null, '그림판 전체'), h('small', null, '보이는 레이어를 한 장으로 합쳐서 움직여요. 캐릭터 찾기와 나누기를 AI가 알아서 해요.')), h('button.btn', { onclick: rigCanvas }, '전체로 움직이기'))),
        h('p.lead', null, '처음 열 때 AI 팩(배경 지우기, AI 지우개, 캐릭터 움직이기 등)을 받아야 해요. 만든 움직임은 영상(MP4)이나 움짤(WebP, GIF)로 저장하거나, 영상 작업실로 보내 다른 장면과 이어 붙일 수 있어요.'));
    };
    update();
    return { update };
  },
  hint: () => '움직일 레이어를 고르면 뼈대와 움직임을 편집하는 창이 열려요.',
};

export function registerCharCmds() {
  addCmd({ id: 'char.rigLayer', title: '이 레이어로 캐릭터 움직이기', menu: 'AI', group: 'rig', words: '리깅 뼈대 애니메이션', enabled: () => !!(canvasOf() && canvasOf().layers.find(l => l.id === state.project.sel)), run: () => rigLayer(canvasOf().layers.find(l => l.id === state.project.sel)) });
  addCmd({ id: 'char.rigCanvas', title: '그림판 전체로 캐릭터 움직이기', menu: 'AI', group: 'rig', words: '리깅 뼈대 애니메이션', enabled: () => !!canvasOf(), run: rigCanvas });
}
