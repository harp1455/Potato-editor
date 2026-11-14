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
  dialog({ title: '움직임을 어떻게 내보낼까요?', body: h('div', null,
    h('p.dlg-text', null, `장면 ${frames.length}장, 초당 ${fps}장(${(frames.length / fps).toFixed(1)}초)이에요. 영상 작업실이 들어오면 시간 막대로 바로 보낼 수 있게 할 거예요.`)),
    buttons: [
      { label: '닫기' },
      { label: '장면을 보관함에 넣기', run: () => { (async () => {
        const b = busy(`장면을 보관함에 넣는 중이에요. 0 / ${frames.length}`), folder = ensureFolder('캐릭터 움직임/' + name);
        for (let i = 0; i < frames.length; i++) { await addMedia(new File([await png(frames[i])], `${name} ${String(i + 1).padStart(3, '0')}.png`, { type: 'image/png' }), folder); b.set(`장면을 보관함에 넣는 중이에요. ${i + 1} / ${frames.length}`); }
        commit('움직임 장면 넣기'); b.done(`장면 ${frames.length}장을 보관함의 '캐릭터 움직임' 폴더에 넣었어요.`);
      })(); } },
      { label: '영상 파일로 저장 (WebM)', primary: true, run: () => { (async () => {
        const b = busy(`영상을 만드는 중이에요. 움직임 길이(${(frames.length / fps).toFixed(1)}초)만큼 걸려요.`);
        try { download(await toWebm(frames, fps), name + ' 움직임.webm'); b.done(`'${name} 움직임.webm'으로 저장했어요.`); } catch (e) { b.done('영상을 만들지 못했어요. ' + (e.message || ''), 'err'); }
      })(); } },
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
        h('p.lead', null, '처음 열 때 AI 팩(배경 지우기, AI 지우개, 캐릭터 움직이기 등)을 받아야 해요. 만든 움직임은 영상 파일(WebM)로 저장하거나 장면 그림으로 보관함에 넣을 수 있어요.'));
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
