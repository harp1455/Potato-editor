// 일괄 처리 작업실: 보관함의 그림 여러 장에 같은 처리를 하고, 폴더 모양 그대로 저장해요. 보관함의 그림은 바뀌지 않아요.
import { h } from '../ui/dom.js';
import { state, folders, folderPath, mediaBlob } from '../core/store.js';
import { settings } from '../core/settings.js';
import { mediaIn } from '../core/library.js';
import { stripMeta, saveFiles } from '../core/files.js';
import { runJob, charMask, upscale, check } from '../core/ai.js';
import { ensurePacks } from '../ui/aitools.js';
import { picked } from '../ui/bin.js';
import { toast } from '../ui/overlay.js';

const B = { from: 'all', bg: false, up: 0, fit: 0, strip: true, fmt: 'same', q: 92, ...(settings.get('batch') || {}) };
const keep = () => settings.set('batch', { ...B });
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function targets() {
  if (B.from === 'picked') return state.project.media.filter(m => picked.has(m.id) && !m.hidden);
  if (B.from !== 'all') return mediaIn(B.from);
  return mediaIn(null);
}
async function start() {
  const list = targets();
  if (!list.length) { toast('처리할 그림이 없어요.', 'err'); return; }
  const need = [B.bg && 'isnet', B.up && 'sr6'].filter(Boolean);
  if (need.length && !await ensurePacks(need)) return;
  const pixel = B.bg || B.up || B.fit, out = [];
  try {
    await runJob(`일괄 처리 (${list.length}장)`, async (job, say) => {
      for (let i = 0; i < list.length; i++) {
        check(job); const m = list[i]; say(`${i + 1} / ${list.length}: ${m.name}`, i / list.length);
        let blob = await mediaBlob(m.id); if (!blob) continue;
        let type = B.fmt === 'same' ? (EXT[blob.type] ? blob.type : 'image/png') : B.fmt, name = m.name;
        if (pixel || (B.fmt !== 'same' && B.fmt !== blob.type)) {
          const bmp = await createImageBitmap(blob); let c = mk(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
          if (B.bg) { const mask = await charMask(c, job); const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0); g.globalCompositeOperation = 'source-over'; if (type === 'image/jpeg') type = 'image/png'; }
          if (B.up) c = await upscale(c, B.up, 'sr6', job, (t, p) => say(`${i + 1} / ${list.length}: ${m.name} (화질 키우는 중)`, (i + (p || 0)) / list.length));
          if (B.fit && Math.max(c.width, c.height) > B.fit) { const k = B.fit / Math.max(c.width, c.height), d = mk(Math.round(c.width * k), Math.round(c.height * k)), g = d.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, d.width, d.height); c = d; }
          if (type === 'image/jpeg') { const d = mk(c.width, c.height), g = d.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, d.width, d.height); g.drawImage(c, 0, 0); c = d; }   // JPG는 투명이 없어서 흰 바탕
          blob = await new Promise(r => c.toBlob(r, type, B.q / 100));
          name = name.replace(/\.[a-z0-9]+$/i, '') + '.' + EXT[type];
        } else if (B.strip && m.meta) blob = await stripMeta(blob);
        const dir = folderPath(m.folder); out.push({ name: (dir ? dir + '/' : '') + name, blob });
      }
      say('저장하는 중', 1);
    });
  } catch (e) { toast('일괄 처리를 끝내지 못했어요. ' + (e.message || ''), 'err'); return; }
  if (!out.length) return;
  const r = await saveFiles(out, state.project.name + ' 일괄 처리.zip');
  if (r) toast(r === 'dir' ? `그림 ${out.length}장을 고른 폴더에 저장했어요.` : `그림 ${out.length}장을 ZIP으로 묶어 저장했어요.`);
}

export const batchRoom = {
  id: 'batch', title: '일괄 처리', icon: 'batch',
  mount(el) {
    const box = h('div.char-room'); el.append(box);
    const update = () => {
      const n = targets().length, chk = (k, label, note) => h('label.batch-row', null, h('input', { type: 'checkbox', checked: !!B[k], onchange: e => { B[k] = e.target.checked; keep(); update(); } }), h('span', null, h('b', null, label), h('small', null, note)));
      const pick = (k, list, num) => h('select.text', { 'aria-label': k, onchange: e => { B[k] = num ? +e.target.value : e.target.value; keep(); update(); } }, list.map(([v, t]) => h('option', { value: v, selected: String(B[k]) === String(v) }, t)));
      box.replaceChildren(
        h('h2', null, '일괄 처리'),
        h('p.lead', null, '보관함의 그림 여러 장에 같은 처리를 하고, 폴더 모양 그대로 새 파일로 저장해요. 보관함에 든 그림은 바뀌지 않아요.'),
        h('div.char-steps', null,
          h('div.batch-row', null, h('span'), h('span', null, h('b', null, '어떤 그림을'), h('small', null, `지금 고른 대상은 ${n}장이에요.`)), pick('from', [['all', '보관함 전체'], ['picked', `보관함에서 고른 그림 (${picked.size}장)`], ...folders().map(f => [f.id, '폴더: ' + folderPath(f.id, ' › ')])])),
          chk('bg', '배경 지우기', 'AI가 인물만 남기고 배경을 투명하게 해요. JPG는 PNG로 바뀌어요.'),
          h('div.batch-row', null, h('span'), h('span', null, h('b', null, '화질 키우기'), h('small', null, 'AI로 그림을 키워요. 장수가 많으면 오래 걸려요.')), pick('up', [[0, '안 함'], [2, '2배'], [4, '4배']], true)),
          h('div.batch-row', null, h('span'), h('span', null, h('b', null, '크기 줄이기'), h('small', null, '긴 쪽이 이 크기보다 크면 줄여요.')), pick('fit', [[0, '안 함'], [2048, '긴 쪽 2048'], [1536, '긴 쪽 1536'], [1024, '긴 쪽 1024'], [768, '긴 쪽 768']], true)),
          h('div.batch-row', null, h('span'), h('span', null, h('b', null, '파일 형식'), h('small', null, '형식을 바꾸거나 위의 처리를 하면 NAI 정보는 함께 지워져요.')), pick('fmt', [['same', '원래대로'], ['image/png', 'PNG'], ['image/jpeg', 'JPG'], ['image/webp', 'WebP']])),
          chk('strip', 'NAI 정보 지우기', '아무 처리도 안 하는 그림에서도 프롬프트·설정 정보를 지워요.')),
        h('div.btn-row', null, h('button.btn.primary', { disabled: !n, onclick: start }, `${n}장 처리해서 저장`)),
        h('p.lead', null, '진행 상황은 AI 작업 패널에서 보고 멈출 수 있어요.'));
    };
    update();
    return { update };
  },
  hint: () => '보관함의 그림 여러 장에 같은 처리를 하고 새 파일로 저장해요.',
};
