// AI 도구: 인물만 고르기, 배경 지우기, 인물·배경 나누기, 화질 키우기. 팩이 없으면 받는 법을 안내해요.
import { h } from './dom.js';
import { state, commit, canvasOf, layerOf, addMedia, ensureBitmap, uid } from '../core/store.js';
import { addCmd } from '../core/cmd.js';
import { MAN, PACK_PAGE, canDownload, missingFiles, packGet, packAdd, packState, packDel, idsOfPack, mb } from '../core/packs.js';
import { runJob, charMask, upscale, samMask, jobs, aiReset } from '../core/ai.js';
import { sel, selFor, selMask, selBounds } from '../core/select.js';
import { fillHole, legacyAi, aiLine } from '../legacy/shim.js';
import { settings } from '../core/settings.js';
import { h as H } from './dom.js';
import { flatten, samPick, layerFromBlob } from '../rooms/image.js';
import { dialog, toast, busy, confirmBox } from './overlay.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const png = c => new Promise(r => c.toBlob(r, 'image/png'));
const mediaOf = l => state.project.media.find(m => m.id === l.mediaId);
const base = n => n.replace(/\.[a-z0-9]+$/i, '');

function pickPackFiles() {
  return new Promise(res => { const i = h('input', { type: 'file', multiple: true, accept: '.gz' }); i.onchange = () => res([...i.files]); i.oncancel = () => res([]); i.click(); });
}
// 필요한 팩이 다 있는지 보고, 없으면 받거나 넣게 해요. 준비되면 true
export const ensurePacks = models => ensureModels(['czWasm', ...models.map(m => 'czM_' + m)]);
// packs = 모델 파일 이름(id)들
export async function ensureModels(packs) {
  let miss = await missingFiles(packs);
  if (!miss.length) return true;
  const names = [...new Set(miss.map(f => MAN.packs[f.pack].label))].join(', '), size = mb(miss.reduce((a, f) => a + f.size, 0));
  if (canDownload()) {
    if (!await confirmBox('AI 팩 받기', `이 기능에는 ${names}(${size})이 필요해요. 한 번 받아 두면 계속 쓸 수 있어요.`, '받기')) return false;
    const b = busy('AI 팩을 받는 중이에요.');
    try { await packGet(packs, (n, t) => b.set(`AI 팩을 받는 중이에요. ${mb(n)} / ${mb(t)}`)); b.done('AI 팩을 받았어요.'); return true; }
    catch (e) { b.done(''); if (window.__TAURI__) { toast('AI 팩을 받지 못했어요. 인터넷 연결을 확인해 주세요.', 'err'); return false; } }
    miss = await missingFiles(packs);
  }
  // 직접 넣기: 브라우저는 깃허브의 큰 파일을 바로 받을 수 없어서, 내려받은 파일을 넣어 줘야 해요
  return new Promise(res => {
    const list = h('ul.pack-files'), note = h('p.set-note', { role: 'status' });
    const draw = () => list.replaceChildren(...miss.map(f => h('li', null, h('code', null, f.file), h('span', null, mb(f.size)))));
    draw();
    const d = dialog({ title: 'AI 팩 넣기', wide: true, onClose: async () => res(!(await missingFiles(packs)).length),
      body: h('div', null,
        h('p.dlg-text', null, `이 기능에는 ${names}이 필요해요. HTML판은 팩을 스스로 받을 수 없어서, 아래 파일을 내려받아 넣어 주세요. 한 번 넣으면 이 브라우저에 보관돼요. 설치판에서는 단추 하나로 받아져요.`),
        list,
        h('div.btn-row', null, h('a.btn', { href: PACK_PAGE, target: '_blank', rel: 'noopener' }, '팩 받는 곳 열기'),
          h('button.btn.primary', { onclick: async () => {
            const fs = await pickPackFiles(); if (!fs.length) return;
            note.textContent = '파일을 확인하는 중이에요.';
            const r = await packAdd(fs); miss = await missingFiles(packs); draw();
            note.textContent = (r.added.length ? `${r.added.length}개를 넣었어요. ` : '') + (r.bad.length ? `${r.bad.join(', ')}은 맞는 팩 파일이 아니거나 덜 받아진 파일이에요. ` : '') + (miss.length ? '' : '모두 준비됐어요.');
            if (!miss.length) setTimeout(() => d.close(), 700);
          } }, '받은 파일 넣기')),
        note),
      buttons: [{ label: '닫기' }] });
  });
}

async function job(title, packs, fn) {
  if (!await ensurePacks(packs)) return;
  try { await runJob(title, fn); }
  catch (e) { if (/memory|allocation/i.test(e.message)) aiReset(); toast(`${title}: ${e.message || '실패했어요'}`, 'err'); }
}
// 레이어의 그림을 바꿔 끼워요 (원본은 보관함에 남아서 되돌릴 수 있어요)
async function swapImage(l, canvas, tag, { hidden = true, rescale = 1 } = {}) {
  const m = mediaOf(l), nm = await addMedia(new File([await png(canvas)], `${base(m.name)} ${tag}.png`, { type: 'image/png' }), m.folder || null, hidden ? { hidden: true } : {});
  l.mediaId = nm.id; l.scale /= rescale; await ensureBitmap(nm.id);
}
const cut = (bmp, mask, invert) => { const c = mk(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0); g.globalCompositeOperation = invert ? 'destination-out' : 'destination-in'; g.drawImage(mask, 0, 0, c.width, c.height); return c; };

const hasCanvas = () => !!canvasOf(), hasLayer = () => !!layerOf() && !layerOf().locked;
export function registerAiCmds(openPacks) {
  addCmd({ id: 'ai.bgSelect', title: '인물만 고르기', menu: 'AI', words: '누끼 배경 선택 캐릭터', enabled: hasCanvas, run: () => job('인물만 고르기', ['isnet'], async (j, say) => {
    const c = canvasOf(), l = layerOf(), mask = await charMask(await flatten(c, l ? l.id : null), j, say);
    selFor(c); selMask('new', mask);
  }) });
  // 'AI로 고르기' 도구가 부르는 명령: 찍어 둔 점·상자로 외곽선을 따서 고른 곳으로
  addCmd({ id: 'sel.sam', title: '', run: () => job('AI로 고르기', ['samE', 'samD'], async (j, say) => {
    const c = canvasOf(), pick = samPick; if (!c || !pick) return;
    const img = await flatten(c), key = 'v2:' + c.id + ':' + c.layers.map(l => l.id + l.mediaId + l.x + ',' + l.y + ',' + l.scale + ',' + l.rot + (l.visible ? 1 : 0)).join('|');
    selFor(c); selMask('new', await samMask(img, key, pick.pts, pick.box, j, say));
  }) });
  // AI 지우개: 고른 곳을 둘레에 어울리게 메워요. 고른 곳 둘레만 잘라서 처리하니 큰 그림에서도 또렷해요
  addCmd({ id: 'ai.erase', title: '고른 곳을 AI로 지우기', menu: 'AI', group: 'erase', words: '지우개 메우기 인페인트 lama', enabled: () => !!canvasOf() && sel.any, run: () => job('AI로 지우기', ['lama'], async (j, say) => {
    const c = canvasOf(), b = selBounds(); if (!b) return;
    const pad = Math.max(48, Math.round(Math.max(b.w, b.h) * 0.6)), x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad), x1 = Math.min(c.w, b.x + b.w + pad), y1 = Math.min(c.h, b.y + b.h + pad), W = x1 - x0, H = y1 - y0;
    const img = mk(W, H), g = img.getContext('2d', { willReadFrequently: true }); g.drawImage(await flatten(c), -x0, -y0);
    const m = mk(W, H), mg = m.getContext('2d', { willReadFrequently: true }); mg.filter = `blur(${Math.max(1, Math.round(Math.max(W, H) / 300))}px)`; mg.drawImage(sel.cv, -x0, -y0);
    const px = g.getImageData(0, 0, W, H).data, md = mg.getImageData(0, 0, W, H).data, hole = new Float32Array(W * H);
    for (let i = 0; i < hole.length; i++) hole[i] = Math.min(1, md[i * 4 + 3] / 255 * 2.2);   // 가장자리를 조금 넉넉하게
    say('둘레에 어울리게 메우는 중', 0.3);
    const r = await fillHole(px, hole, W, H, j);
    const out = new ImageData(new Uint8ClampedArray(r.px), W, H); for (let i = 0; i < hole.length; i++) out.data[i * 4 + 3] = Math.round(hole[i] * 255);
    g.clearRect(0, 0, W, H); g.putImageData(out, 0, 0);
    await layerFromBlob(c, await png(img), '지운 자리', { x: x0, y: y0, hidden: true }); commit('AI로 지우기');
  }) });
  addCmd({ id: 'ai.bgCut', title: '배경 지우기', menu: 'AI', words: '누끼 투명', enabled: hasLayer, run: () => job('배경 지우기', ['isnet'], async (j, say) => {
    const l = layerOf(), bmp = await ensureBitmap(l.mediaId);
    await swapImage(l, cut(bmp, await charMask(bmp, j, say)), '배경 지움'); commit('배경 지우기');
  }) });
  addCmd({ id: 'ai.bgSplit', title: '인물과 배경을 레이어로 나누기', menu: 'AI', words: '누끼 분리 캐릭터', enabled: hasLayer, run: () => job('인물과 배경 나누기', ['isnet'], async (j, say) => {
    const c = canvasOf(), l = layerOf(), bmp = await ensureBitmap(l.mediaId), mask = await charMask(bmp, j, say), name = l.name;
    const front = { ...l, ...(l.adj ? { adj: { ...l.adj } } : {}), id: uid('l'), name: name + ' 인물' };
    await swapImage(front, cut(bmp, mask), '인물'); await swapImage(l, cut(bmp, mask, true), '배경'); l.name = name + ' 배경';
    c.layers.splice(c.layers.indexOf(l) + 1, 0, front);
    state.project.sel = front.id; commit('인물과 배경 나누기');
  }) });
  for (const [k, model, label] of [[2, 'sr6', '화질 2배로 키우기'], [4, 'sr6', '화질 4배로 키우기'], [2, 'sr4', '화질 2배로 키우기 (빠르게)']]) {
    addCmd({ id: `ai.up${k}${model === 'sr4' ? 'f' : ''}`, title: label, menu: 'AI', group: 'sr', words: '업스케일 해상도 선명', enabled: hasLayer, run: () => job(label, [model], async (j, say) => {
      const l = layerOf(), bmp = await ensureBitmap(l.mediaId);
      await swapImage(l, await upscale(bmp, k, model, j, say), `${k}배`, { hidden: false, rescale: k }); commit(label);
    }) });
  }
  // ---- 8.x에서 가져온 계산을 쓰는 도구들 ----
  // 결과를 '그 레이어와 같은 자리'에 새 레이어로 올려요 (원본을 안 바꾸니 끄고 켜며 견줄 수 있어요)
  const overlay = async (l, canvas, name) => { const c = canvasOf(), n = await layerFromBlob(c, await png(canvas), name, { hidden: true }); Object.assign(n, { x: l.x, y: l.y, scale: l.scale * (mediaOf(l).w / canvas.width), rot: l.rot }); const i = c.layers.indexOf(n); c.layers.splice(i, 1); c.layers.splice(c.layers.indexOf(l) + 1, 0, n); return n; };
  addCmd({ id: 'ai.censor', title: '자동 흰칠', menu: 'AI', group: 'cz', keys: 'Ctrl+Shift+W', words: '가리기 모자이크 검열 성기', enabled: hasLayer, run: () => { const k = censorCfg(); return job('자동 흰칠', ['deep', 'deepn', k.model === 'precise' ? 'segM' : 'segN', 'samE', 'samD'], async (j, say) => {
    const l = layerOf(), bmp = await ensureBitmap(l.mediaId), r = await censorMask(bmp, j, say);
    if (!r.found) { toast('가릴 곳을 찾지 못했어요. 설정에서 민감도를 올려 볼 수 있어요.'); return; }
    await overlay(l, r.canvas, l.name + ' 흰칠'); commit('자동 흰칠');
  }); } });
  addCmd({ id: 'ai.censorCfg', title: '자동 흰칠 설정…', menu: 'AI', group: 'cz', run: censorDialog });
  addCmd({ id: 'ai.line', title: '선화 추출', menu: 'AI', group: 'fx', words: '라인 스케치 lineart', enabled: hasLayer, run: () => job('선화 추출', ['lineF'], async (j, say) => {
    const l = layerOf(), bmp = await ensureBitmap(l.mediaId); say('선을 따는 중', 0.3); aiLine.model = 'F'; aiLine.gain = 1;
    await overlay(l, await legacyAi().aiLineArt({ im: bmp, W: bmp.width, H: bmp.height }, j), l.name + ' 선화'); commit('선화 추출');
  }) });
  for (const [amt, label] of [[30, '배경 흐리게 (약하게)'], [60, '배경 흐리게 (보통)'], [95, '배경 흐리게 (강하게)']]) addCmd({ id: 'ai.dof' + amt, title: label, menu: 'AI', group: 'fx', words: '아웃포커스 깊이 심도 depth', enabled: hasLayer, run: () => job(label, ['depth'], async (j, say) => {
    const l = layerOf(), bmp = await ensureBitmap(l.mediaId), k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), W = Math.round(bmp.width * k), Hh = Math.round(bmp.height * k), A = legacyAi();
    const src = mk(W, Hh); src.getContext('2d').drawImage(bmp, 0, 0, W, Hh); say('깊이를 재는 중', 0.3);
    const D = await A.dpDepth(src, W, Hh, null, j), cut0 = A.dpOtsu(D); let s2 = 0, n2 = 0; for (let i = 0; i < D.length; i++) if (D[i] > cut0) { s2 += D[i]; n2++; }
    say('흐리는 중', 0.8); await swapImage(l, A.dpDof(src, W, Hh, D, { focus: n2 ? s2 / n2 : 0.7, band: 0.06, amt, subj: null }), '배경 흐림', { rescale: k }); commit(label);
  }) });
  addCmd({ id: 'ai.packs', title: 'AI 팩 관리…', menu: 'AI', group: 'packs', run: openPacks });
}

// 작업 줄 패널
export const jobsPanel = {
  title: 'AI 작업',
  render(el) {
    if (!jobs.length) return el.append(h('p.empty', null, '오래 걸리는 AI 작업이 여기 줄을 서요. 진행 상황을 보고 멈출 수 있어요.'));
    el.append(...jobs.map(j => h('div.job.' + j.state, null,
      h('div.job-head', null, h('b', null, j.title), j.state === 'run' && h('button.btn.small', { onclick: () => { j.stop = true; j.text = '멈추는 중'; } }, '멈추기')),
      h('div.job-bar', { role: 'progressbar', 'aria-valuenow': Math.round(j.p * 100), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span', { style: `width:${Math.round(j.p * 100)}%` })),
      h('p.job-text', null, j.text))));
  },
};

// 설정 창의 'AI 팩' 칸
export async function packsPane(redraw) {
  const st = await packState(), dl = canDownload();
  return [
    h('p.set-note', null, dl ? 'AI 도구가 쓰는 모델 묶음이에요. 필요한 것만 받아 두면 돼요. 그림은 이 컴퓨터 안에서만 처리해요.' : 'AI 도구가 쓰는 모델 묶음이에요. HTML판은 팩을 스스로 받을 수 없어서, 내려받은 파일을 넣어 줘야 해요. 그림은 이 컴퓨터 안에서만 처리해요.'),
    h('div.btn-row', null, h('a.btn', { href: PACK_PAGE, target: '_blank', rel: 'noopener' }, '팩 받는 곳 열기'),
      h('button.btn', { onclick: async () => { const fs = await pickPackFiles(); if (!fs.length) return; const b = busy('파일을 확인하는 중이에요.'); const r = await packAdd(fs); b.done(r.added.length ? `팩 파일 ${r.added.length}개를 넣었어요.` : '맞는 팩 파일이 없어요.', r.added.length ? '' : 'err'); redraw(); } }, '받은 파일 넣기')),
    h('div.packs', null, Object.entries(MAN.packs).map(([k, p]) => h('div.pack' + (st[k] ? '.on' : ''), null,
      h('div', null, h('b', null, p.label), h('small', null, p.desc)),
      h('span.pack-size', null, mb(p.size)),
      st[k] ? h('button.btn.small', { onclick: async () => { await packDel(k); aiReset(); redraw(); } }, '지우기')
        : dl ? h('button.btn.small', { onclick: async () => { const b = busy('AI 팩을 받는 중이에요.'); try { await packGet(idsOfPack(k), (n, t) => b.set(`AI 팩을 받는 중이에요. ${mb(n)} / ${mb(t)}`)); b.done(`${p.label}을 받았어요.`); } catch (_) { b.done('받지 못했어요. 인터넷 연결을 확인하거나 파일을 직접 넣어 주세요.', 'err'); } redraw(); } }, '받기')
          : h('span.pack-none', null, '없음')))),
  ];
}

// ---- 자동 흰칠 ----
const CZ_DEF = { model: 'fast', shape: 'contour', pad: 3, sens: 50, male: true, female: true, anus: false, color: '#ffffff' };
export const censorCfg = () => ({ ...CZ_DEF, ...(settings.get('censor') || {}) });
// 그림(비트맵·캔버스) → { canvas(가릴 곳만 색칠, 나머지 투명), found }. 그림은 이 컴퓨터 안에서만 처리해요
export async function censorMask(src, job, say) {
  const A = legacyAi(), k = censorCfg(), ds = Math.min(1, 4096 / Math.max(src.width, src.height)), W = Math.round(src.width * ds), Hh = Math.round(src.height * ds);
  Object.assign(A.czCfg, { model: k.model, shape: k.shape, pad: k.pad, sens: k.sens, male: k.male, female: k.female, anus: k.anus, color: k.color });
  const cv = mk(W, Hh), g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh); g.drawImage(src, 0, 0, W, Hh);
  const st = A.czNewState(W, Hh, k.pad * Math.max(W, Hh) / 1000);
  await A.czAnalyze(cv, st, job, t => say && say(String(t).replace('…', ''), 0.5));
  let M = A.czComposeMask(st); const pad = Math.round(k.pad * Math.max(W, Hh) / 1000); if (pad > 0) M = A.czDilate(M, W, Hh, pad);
  const out = mk(W, Hh), og = out.getContext('2d'), id = og.createImageData(W, Hh), col = [1, 3, 5].map(i => parseInt(k.color.slice(i, i + 2), 16)); let found = 0;
  for (let i = 0; i < M.length; i++) if (M[i]) { id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = 255; found++; }
  og.putImageData(id, 0, 0);
  return { canvas: out, found };
}
function censorDialog() {
  const k = censorCfg(), set = (key, v) => { k[key] = v; settings.set('censor', k); draw(); }, box = H('div.vid-form');
  const chk = (key, label) => H('label.check', null, H('input', { type: 'checkbox', checked: !!k[key], onchange: e => set(key, e.target.checked) }), label);
  const rng = (key, label, min, max, unit) => H('label.field', null, H('span.field-name.w', null, label), H('input.range', { type: 'range', min, max, value: k[key], 'aria-label': label, onchange: e => set(key, +e.target.value) }), H('span.field-unit', null, k[key] + unit));
  const draw = () => box.replaceChildren(
    H('p.dlg-text', null, '그림 속 성기를 찾아 그 모양대로 가려요. 결과는 새 레이어로 올라가서 끄고 켜거나 지울 수 있어요. 그림은 이 컴퓨터 안에서만 처리해요.'),
    H('div.choice', { role: 'radiogroup' }, [['fast', '빠르게', '가벼운 모델로 모양을 따요. 대부분 이걸로 충분해요.'], ['precise', '정밀하게', '큰 모델이라 모양이 더 정확하고 항문도 잘 찾아요. 몇 배 느려요.']].map(([v, t, d]) => H('label.choice-item' + (k.model === v ? '.on' : ''), null, H('input', { type: 'radio', name: 'czm', checked: k.model === v, onchange: () => set('model', v) }), H('span', null, H('b', null, t), H('small', null, d))))),
    H('div.btn-row', null, chk('male', '남성 성기'), chk('female', '여성 성기'), chk('anus', '항문')),
    H('label.field', null, H('span.field-name.w', null, '모양'), H('select.text', { 'aria-label': '모양', onchange: e => set('shape', e.target.value) }, [['contour', '윤곽을 따라'], ['ellipse', '타원으로']].map(([v, t]) => H('option', { value: v, selected: k.shape === v }, t)))),
    rng('sens', '민감도', 0, 100, ''), rng('pad', '여유', 0, 12, ''),
    H('label.field', null, H('span.field-name.w', null, '색'), H('input', { type: 'color', value: k.color, 'aria-label': '가리는 색', onchange: e => set('color', e.target.value) })));
  draw();
  dialog({ title: '자동 흰칠 설정', body: box, buttons: [{ label: '닫기', primary: true }] });
}
