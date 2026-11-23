// 일괄 처리 작업실: 보관함의 그림 여러 장에 같은 처리를 하고, 폴더 모양 그대로 저장해요. 보관함의 그림은 바뀌지 않아요.
import { logErr } from '../core/errlog.js';
import { h } from '../ui/dom.js';
import { state, folders, folderPath, mediaBlob } from '../core/store.js';
import { settings } from '../core/settings.js';
import { mediaIn } from '../core/library.js';
import { stripMeta, saveFiles } from '../core/files.js';
import { runJob, charMask, upscale, check } from '../core/ai.js';
import { ensurePacks, censorMask, censorCfg } from '../ui/aitools.js';
import { picked } from '../ui/bin.js';
import { toast } from '../ui/overlay.js';

const B = { from: 'all', follow: false, cz: false, bg: false, up: 0, fit: 0, strip: true, fmt: 'same', q: 92, ...(settings.get('batch') || {}) };
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
  const need = [B.bg && 'isnet', B.up && 'sr6', ...(B.cz ? ['deep', 'deepn', censorCfg().model === 'precise' ? 'segM' : 'segN', 'samE', 'samD'] : [])].filter(Boolean);
  if (need.length && !await ensurePacks(need)) return;
  // 따라 하기(8.x의 동작 기록): 지금 그림판의 맨 아래 그림 자리에 다른 그림을 끼워 넣고 똑같이 합쳐요.
  // 보정·뒤집기·돌리기·그림판 자르기·전체 보정·위에 얹은 레이어·그린 것이 그대로 따라가요
  const ref = B.follow ? (state.project.canvases.find(c => c.id === state.project.activeCanvas) || state.project.canvases[0]) : null, base = ref && ref.layers[0], baseM = base && state.project.media.find(m => m.id === base.mediaId);
  if (B.follow && !baseM) { toast('따라 할 그림판이 없어요. 이미지 작업실에서 그림 한 장을 먼저 손봐 주세요.', 'err'); return; }
  const followed = async m => { const k = base.scale * baseM.w / m.w, cy = base.y + baseM.h * base.scale / 2; const { flatten } = await import('./image.js'); return flatten({ ...ref, layers: ref.layers.map(l => (l === base ? { ...l, mediaId: m.id, scale: k, y: Math.round(cy - m.h * k / 2), maskId: undefined } : l)) }); };
  const pixel = B.follow || B.cz || B.bg || B.up || B.fit, out = []; let hits = 0, fails = 0;
  try {
    await runJob(`일괄 처리 (${list.length}장)`, async (job, say) => {
      for (let i = 0; i < list.length; i++) {
        check(job); const m = list[i]; say(`${i + 1} / ${list.length}: ${m.name}`, i / list.length);
        try {
        let blob = await mediaBlob(m.id); if (!blob) continue;
        let type = B.fmt === 'same' ? (EXT[blob.type] ? blob.type : 'image/png') : B.fmt, name = m.name;
        if (pixel || (B.fmt !== 'same' && B.fmt !== blob.type)) {
          let c; if (B.follow) c = await followed(m); else { const bmp = await createImageBitmap(blob); c = mk(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close(); }
          if (B.cz) { const r = await censorMask(c, job); if (r.found) { c.getContext('2d').drawImage(r.canvas, 0, 0, c.width, c.height); hits++; } }
          if (B.bg) { const mask = await charMask(c, job); const g = c.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.drawImage(mask, 0, 0); g.globalCompositeOperation = 'source-over'; if (type === 'image/jpeg') type = 'image/png'; }
          if (B.up) c = await upscale(c, B.up, 'sr6', job, (t, p) => say(`${i + 1} / ${list.length}: ${m.name} (화질 키우는 중)`, (i + (p || 0)) / list.length));
          if (B.fit && Math.max(c.width, c.height) > B.fit) { const k = B.fit / Math.max(c.width, c.height), d = mk(Math.round(c.width * k), Math.round(c.height * k)), g = d.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, d.width, d.height); c = d; }
          if (type === 'image/jpeg') { const d = mk(c.width, c.height), g = d.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, d.width, d.height); g.drawImage(c, 0, 0); c = d; }   // JPG는 투명이 없어서 흰 바탕
          blob = await new Promise(r => c.toBlob(r, type, B.q / 100));
          name = name.replace(/\.[a-z0-9]+$/i, '') + '.' + EXT[type];
        } else if (B.strip && m.meta) blob = await stripMeta(blob);
        const dir = folderPath(m.folder); out.push({ name: (dir ? dir + '/' : '') + name, blob });
        } catch (e) { if (job.stop || e.message === 'stop') throw e; fails++; logErr('일괄 처리', `${m.name}: ${e.message || '실패'}`, e.detail || ''); }   // 한 장이 안 돼도 멈추지 않고 다음 그림으로
      }
      say('저장하는 중', 1);
    });
  } catch (e) { toast('일괄 처리를 끝내지 못했어요. ' + (e.message || ''), 'err'); return; }
  if (!out.length) return;
  const r = await saveFiles(out, state.project.name + ' 일괄 처리.zip');
  if (r) toast((r === 'dir' ? `그림 ${out.length}장을 고른 폴더에 저장했어요.` : `그림 ${out.length}장을 ZIP으로 묶어 저장했어요.`) + (B.cz ? ` 자동 흰칠은 ${hits}장에 들어갔어요.` : '') + (fails ? ` ${fails}장은 하지 못해 오류 기록에 남겼어요.` : ''));
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
          chk('follow', '지금 그림판에서 한 일 따라 하기', '이미지 작업실에서 한 장을 손본 뒤 켜면, 그 그림판의 보정·뒤집기·자르기·위에 얹은 레이어·그린 것을 다른 그림에도 똑같이 해요. 맨 아래 레이어 자리에 그림이 하나씩 들어가요.'),
          chk('cz', '자동 흰칠', 'AI가 성기를 찾아 가려요. 모양과 민감도는 AI 메뉴의 자동 흰칠 설정을 따라요. 저장 전에 결과를 꼭 확인해 주세요.'),
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
