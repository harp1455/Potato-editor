// AI 도구: 인물만 고르기, 배경 지우기, 인물·배경 나누기, 화질 키우기. 팩이 없으면 받는 법을 안내해요.
import { h } from './dom.js';
import { state, commit, canvasOf, layerOf, addMedia, ensureBitmap, uid } from '../core/store.js';
import { addCmd, run } from '../core/cmd.js';
import { MAN, PACK_PAGE, canDownload, missingFiles, packGet, packAdd, packState, packDel, idsOfPack, mb, packDirOf, movePacks } from '../core/packs.js';
import { runJob, charMask, upscale, samMask, jobs, aiReset, fileIdOf, peopleMasks, splitPieces } from '../core/ai.js';
import { openSplit } from './peoplesplit.js';
import PARTS_SERVER from '../../tools/potato_parts_server.py';
import { download } from '../core/files.js';
import { sel, selFor, selMask, selBounds } from '../core/select.js';
import { fillHole, legacyAi, aiLine } from '../legacy/shim.js';
import { settings } from '../core/settings.js';
import { h as H } from './dom.js';
import { flatten, samPick, layerFromBlob, layerPic, selInLayer } from '../rooms/image.js';
import { dialog, toast, busy, confirmBox } from './overlay.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const png = c => new Promise(r => c.toBlob(r, 'image/png'));
const mediaOf = l => state.project.media.find(m => m.id === l.mediaId);
const base = n => n.replace(/\.[a-z0-9]+$/i, '');

function pickPackFiles() {
  return new Promise(res => { const i = h('input', { type: 'file', multiple: true, accept: '.gz' }); i.onchange = () => res([...i.files]); i.oncancel = () => res([]); i.click(); });
}
// 필요한 팩이 다 있는지 보고, 없으면 받거나 넣게 해요. 준비되면 true
export const ensurePacks = models => ensureModels(['czWasm', ...models.map(fileIdOf)]);
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
    const l = layerOf(), bmp = await layerPic(l);
    await swapImage(l, cut(bmp, await charMask(bmp, j, say)), '배경 지움'); commit('배경 지우기');
  }) });
  addCmd({ id: 'ai.people', title: '사람별로 나누기 (조각 골라서)…', menu: 'AI', words: '사람 캐릭터 분리 두 명 여러 명 인물 겹친', enabled: hasLayer, run: () => job('사람별로 나누기', ['isnet', 'samE', 'samD', 'detP', 'detH', 'detN'], async (j, say) => {
    const c = canvasOf(), l = layerOf(), bmp = await layerPic(l), name = l.name, S = await splitPieces(bmp, j, say);
    if (!S.pieces.length) { toast('인물을 찾지 못했어요.'); return; }
    openSplit(S, '사람별로 나누기', async masks => {
      const all = document.createElement('canvas'); all.width = S.W; all.height = S.H; const ag = all.getContext('2d'); let at = c.layers.indexOf(l);
      for (const [i, m] of masks.entries()) { ag.drawImage(m, 0, 0); const n = { ...l, ...(l.adj ? { adj: { ...l.adj } } : {}), id: uid('l'), name: `${name} 사람 ${i + 1}` }; await swapImage(n, cut(bmp, m), '사람'); c.layers.splice(++at, 0, n); }
      await swapImage(l, cut(bmp, all, true), '배경'); l.name = name + ' 배경'; commit('사람별로 나누기'); toast(`사람 ${masks.length}명을 따로 레이어로 나눴어요.`);
    });
  }) });
  addCmd({ id: 'ai.peopleAuto', title: '인물별로 레이어 나누기 (전신 그림, 자동)', menu: 'AI', words: '사람 캐릭터 분리 두 명 여러 명 인스턴스', enabled: hasLayer, run: () => job('인물별로 나누기', ['isnet', 'people'], async (j, say) => {
    const c = canvasOf(), l = layerOf(), bmp = await layerPic(l), name = l.name, ppl = await peopleMasks(bmp, j, say);
    if (ppl.length < 2) { toast('인물을 두 명 이상 찾지 못했어요. 몸 전체가 보이는 그림에서 잘 되고, 얼굴이나 몸 일부만 크게 나온 그림은 못 찾는 일이 많아요.'); return; }
    const all = document.createElement('canvas'); all.width = bmp.width; all.height = bmp.height; const ag = all.getContext('2d'); let at = c.layers.indexOf(l);
    for (const [i, p] of ppl.entries()) { ag.drawImage(p.mask, 0, 0); const n = { ...l, ...(l.adj ? { adj: { ...l.adj } } : {}), id: uid('l'), name: `${name} 인물 ${i + 1}` }; await swapImage(n, cut(bmp, p.mask), '인물'); c.layers.splice(++at, 0, n); }
    await swapImage(l, cut(bmp, all, true), '배경'); l.name = name + ' 배경'; commit('인물별로 나누기'); toast(`인물 ${ppl.length}명을 따로 레이어로 나눴어요. 왼쪽 사람부터 차례예요.`);
  }) });
  addCmd({ id: 'ai.bgSplit', title: '인물과 배경을 레이어로 나누기', menu: 'AI', words: '누끼 분리 캐릭터', enabled: hasLayer, run: () => job('인물과 배경 나누기', ['isnet'], async (j, say) => {
    const c = canvasOf(), l = layerOf(), bmp = await layerPic(l), mask = await charMask(bmp, j, say), name = l.name;
    const front = { ...l, ...(l.adj ? { adj: { ...l.adj } } : {}), id: uid('l'), name: name + ' 인물' };
    await swapImage(front, cut(bmp, mask), '인물'); await swapImage(l, cut(bmp, mask, true), '배경'); l.name = name + ' 배경';
    c.layers.splice(c.layers.indexOf(l) + 1, 0, front);
    state.project.sel = front.id; commit('인물과 배경 나누기');
  }) });
  for (const [k, model, label] of [[2, 'sr6', '화질 2배로 키우기'], [4, 'sr6', '화질 4배로 키우기'], [2, 'sr4', '화질 2배로 키우기 (빠르게)']]) {
    addCmd({ id: `ai.up${k}${model === 'sr4' ? 'f' : ''}`, title: label, menu: 'AI', group: 'sr', words: '업스케일 해상도 선명', enabled: hasLayer, run: () => job(label, [model], async (j, say) => {
      const l = layerOf(), bmp = await layerPic(l);
      await swapImage(l, await upscale(bmp, k, model, j, say), `${k}배`, { hidden: false, rescale: k }); commit(label);
    }) });
  }
  // ---- 8.x에서 가져온 계산을 쓰는 도구들 ----
  // 결과를 '그 레이어와 같은 자리'에 새 레이어로 올려요 (원본을 안 바꾸니 끄고 켜며 견줄 수 있어요)
  const overlay = async (l, canvas, name) => { const c = canvasOf(), n = await layerFromBlob(c, await png(canvas), name, { hidden: true }); Object.assign(n, { x: l.x, y: l.y, scale: l.scale * (mediaOf(l).w / canvas.width), rot: l.rot }); const i = c.layers.indexOf(n); c.layers.splice(i, 1); c.layers.splice(c.layers.indexOf(l) + 1, 0, n); return n; };
  addCmd({ id: 'ai.iopaint', title: '고른 곳을 IOPaint로 그려 넣기…', menu: 'AI', group: 'erase', words: '채우기 가려진 곳 이어 그리기 인페인트 stable diffusion sd brushnet powerpaint iopaint', enabled: () => !!canvasOf() && sel.any, run: () => iopaintDialog() });
  addCmd({ id: 'ai.parts', title: '부위별로 레이어 나누기 (부위 서버)…', menu: 'AI', words: '머리카락 얼굴 팔 다리 옷 부위 나누기 see-through 리깅', enabled: hasLayer, run: () => partsDialog() });
  addCmd({ id: 'help.parts', title: '부위 서버 켜는 법', menu: '도움말', words: 'see-through 부위 설치', run: () => partsHelp() });
  addCmd({ id: 'help.iopaint', title: 'IOPaint 켜는 법', menu: '도움말', words: '채우기 그려 넣기 설치', run: () => iopHelp() });
  addCmd({ id: 'ai.censor', title: '자동 흰칠', menu: 'AI', group: 'cz', keys: 'Ctrl+Shift+W', words: '가리기 모자이크 검열 성기', enabled: hasLayer, run: () => { const k = censorCfg(); return job('자동 흰칠', ['deep', 'deepn', k.model === 'precise' ? 'segM' : 'segN', 'samE', 'samD'], async (j, say) => {
    const l = layerOf(), bmp = await layerPic(l), r = await censorMask(bmp, j, say);
    if (!r.found) { toast('가릴 곳을 찾지 못했어요. 설정에서 민감도를 올려 볼 수 있어요.'); return; }
    const n = await overlay(l, r.canvas, l.name + ' 흰칠'); if (n) n.paint = true;   // 지우개와 가리기 붓으로 고칠 수 있게
    commit('자동 흰칠');
  }); } });
  addCmd({ id: 'ai.censorCfg', title: '자동 흰칠 설정…', menu: 'AI', group: 'cz', run: censorDialog });
  addCmd({ id: 'ai.line', title: '선화 추출', menu: 'AI', group: 'fx', words: '라인 스케치 lineart', enabled: hasLayer, run: () => job('선화 추출', ['lineF'], async (j, say) => {
    const l = layerOf(), bmp = await layerPic(l); say('선을 따는 중', 0.3); aiLine.model = 'F'; aiLine.gain = 1;
    await overlay(l, await legacyAi().aiLineArt({ im: bmp, W: bmp.width, H: bmp.height }, j), l.name + ' 선화'); commit('선화 추출');
  }) });
  addCmd({ id: 'ai.censorManual', title: '수동 흰칠 (가리기 붓)', menu: 'AI', group: 'cz', words: '모자이크 블러 가리기 직접 칠하기 흰칠', enabled: () => !!canvasOf(), run: () => { if (settings.get('room') !== 'image') settings.set('room', 'image'); run('tool.cover'); toast('가리기 붓이에요. 위쪽 줄에서 흰칠·모자이크·흐리게와 붓·타원·네모를 고른 뒤, 그림 위를 칠하거나 끌어 주세요.'); } });
  // 입체 움짤(8.x에서 옮김): 깊이를 재서 인물과 배경을 따로 움직여요. 미리 본 뒤 영상 작업실로 보내요
  addCmd({ id: 'ai.parallax', title: '입체 움짤 만들기…', menu: 'AI', group: 'fx', words: '패럴랙스 3d 깊이 depth 움직이는 사진', enabled: hasLayer, run: () => job('입체 움짤 준비', ['depth', 'isnet', 'lama'], async (j, say) => {
    const l = layerOf(), bmp = await layerPic(l), k = Math.min(1, 720 / Math.max(bmp.width, bmp.height)), W = Math.round(bmp.width * k), Hh = Math.round(bmp.height * k), A = legacyAi(), src = mk(W, Hh); src.getContext('2d').drawImage(bmp, 0, 0, W, Hh);
    const P = await A.dpPrepare(src, W, Hh, null, { set: (t, p) => say(String(t).replace('…', ''), p), get stop() { return j.stop; } });
    const O = { move: 'orbit', amt: 50, base: 'subj', secs: 2, fps: 15, ...(settings.get('parallax') || {}) }, cv = h('canvas.liq-view', { width: W, height: Hh, 'aria-label': '입체 움짤 미리 보기' }), g = cv.getContext('2d'), buf = g.createImageData(W, Hh);
    let raf = 0, last = 0; const t0 = performance.now(), loop = now => { if (!cv.isConnected) return; raf = requestAnimationFrame(loop); if (now - last < 1000 / O.fps - 2) return; last = now; A.dpFrame(P, ((now - t0) / 1000 / O.secs) % 1, O, buf); g.putImageData(buf, 0, 0); };
    const sel = (label, key, list, num) => h('label.field', null, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: e => { O[key] = num ? +e.target.value : e.target.value; } }, list.map(([v, t]) => h('option', { value: v, selected: String(O[key]) === String(v) }, t))));
    const send = async () => { settings.set('parallax', O); const b = busy('입체 움짤을 만드는 중이에요.'); try { const n = Math.max(2, Math.round(O.secs * O.fps)), frames = []; for (let i = 0; i < n; i++) { const c = mk(W, Hh), id = c.getContext('2d').createImageData(W, Hh); A.dpFrame(P, i / n, O, id); c.getContext('2d').putImageData(id, 0, 0); frames.push(c); if (i % 4 === 0) { b.set(`입체 움짤을 만드는 중이에요. ${i + 1} / ${n}`); await new Promise(r => setTimeout(r)); } }
      const { addFrames } = await import('../rooms/video.js'); await addFrames(frames, O.fps, l.name + ' 입체', (i, t) => b.set(`영상 작업실로 보내는 중이에요. ${i} / ${t}`)); b.done(`장면 ${n}개를 영상 작업실에 넣었어요. 영상 작업실에서 MP4·GIF·WebP로 내보내요.`); } catch (e) { b.done(e.message || '만들지 못했어요.', 'err'); } };
    dialog({ title: '입체 움짤', wide: true, onClose: () => cancelAnimationFrame(raf), body: h('div.liq', null, h('div.liq-stage', null, cv), h('div.liq-side', null,
      sel('움직임', 'move', [['orbit', '빙글'], ['sway', '좌우'], ['nod', '위아래'], ['zoom', '다가가기']]), sel('기준', 'base', [['subj', '인물 고정 (배경이 움직임)'], ['bg', '배경 고정 (인물이 움직임)']]),
      h('label.field', null, h('span.field-name.w', null, '세기'), h('input.range', { type: 'range', min: 10, max: 100, value: O.amt, 'aria-label': '세기', oninput: e => { O.amt = +e.target.value; } })),
      sel('길이', 'secs', [[1.5, '1.5초'], [2, '2초'], [3, '3초'], [4, '4초']], true), sel('빠르기', 'fps', [[10, '초당 10장'], [12, '초당 12장'], [15, '초당 15장'], [24, '초당 24장']], true),
      h('p.dlg-text', null, /lama/.test(P.by) ? '인물 뒤 배경은 AI가 메웠어요. 세기가 크면 메운 자리가 흐릿하게 보일 수 있어요.' : '세기가 크면 가장자리가 어색해질 수 있어요.'))),
      buttons: [{ label: '닫기' }, { label: '영상 작업실로 보내기', primary: true, run: () => { send(); } }] });
    raf = requestAnimationFrame(loop);
  }) });
  for (const [amt, label] of [[30, '배경 흐리게 (약하게)'], [60, '배경 흐리게 (보통)'], [95, '배경 흐리게 (강하게)']]) addCmd({ id: 'ai.dof' + amt, title: label, menu: 'AI', group: 'fx', words: '아웃포커스 깊이 심도 depth', enabled: hasLayer, run: () => job(label, ['depth'], async (j, say) => {
    const l = layerOf(), bmp = await layerPic(l), k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height)), W = Math.round(bmp.width * k), Hh = Math.round(bmp.height * k), A = legacyAi();
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
    window.__TAURI__ && window.__TAURI__.dialog && h('b', null, 'AI 팩 저장 폴더'),
    window.__TAURI__ && window.__TAURI__.dialog && h('div.disk-pick', null,
      h('p.set-note', null, packDirOf() ? h('code.disk-path', null, packDirOf()) : '기본 자리 (C 드라이브의 사용자 폴더 안)', ' 팩은 모두 합치면 1GB가 넘어요. 바꾸면 이미 받은 팩도 새 폴더로 옮겨요.'),
      h('div.btn-row', null,
        h('button.btn', { onclick: async () => { const T = window.__TAURI__, d = await T.dialog.open({ directory: true, title: 'AI 팩을 둘 폴더' }); if (!d) return; const to = await T.path.join(String(d), '감자편집기 AI 팩'); if (to === packDirOf()) return; await moveTo(to); redraw(); } }, '다른 폴더 고르기'),
        packDirOf() && h('button.btn', { onclick: async () => { await moveTo(''); redraw(); } }, '기본 자리로'))),
    h('b', null, '윤곽 모델'),
    h('div.choice', { role: 'radiogroup' }, [['fast', '빠르게', '작은 모델이에요. 금방 끝나고 기본 팩만 있으면 돼요.'], ['big', '정밀하게', '큰 모델이에요. 옷, 팔, 다리 같은 부위를 훨씬 잘 나눠요. 정밀 윤곽 팩(약 300MB)이 필요하고, 그림을 처음 읽을 때 더 걸려요.']].map(([v, t, d]) => h('label.choice-item' + (settings.get('samModel') === v ? '.on' : ''), null, h('input', { type: 'radio', name: 'samm', checked: settings.get('samModel') === v, onchange: () => { settings.set('samModel', v); aiReset(); redraw(); } }), h('span', null, h('b', null, t), h('small', null, d))))),
    h('p.set-note', null, 'AI로 고르기, 캐릭터 움직이기의 부위 나누기, 자동 흰칠이 이 모델로 윤곽을 따요.'),
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

// IOPaint 잇기: 사용자 PC에서 따로 켠 IOPaint(무료, 그림 채우기 프로그램)에 고른 곳을 보내 그려 넣어요.
// 애니 체크포인트(SD1.5)를 쓰면 가려졌던 팔, 다리 같은 것을 새로 그릴 수 있어요. 그림은 이 PC 밖으로 나가지 않아요
const iopCfg = () => ({ ...settings.defaults.iop, ...(settings.get('iop') || {}) });
const b64 = c => new Promise(r => c.toBlob(b => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }, 'image/png'));
async function iopFetch(path, opt = {}, ms = 8000, base = iopCfg().url, who = 'IOPaint') {
  const u = base.replace(/\/+$/, '') + path, ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  // 설치판은 앱의 연결 기능으로 보내요 (웹 화면에서 이 PC 안 주소로 바로 보내는 것을 막는 경우가 있어서). 안 되면 보통 방식으로
  const T = window.__TAURI__, go = async () => { if (T && T.http && T.http.fetch) { try { return await T.http.fetch(u, { ...opt, signal: ac.signal }); } catch (e) { if (e.name === 'AbortError') throw e; } } return fetch(u, { ...opt, signal: ac.signal }); };
  try { const r = await go(); if (!r.ok) { let msg = 'HTTP ' + r.status; try { const j = await r.json(); msg += ' ' + (j.detail || j.errors || JSON.stringify(j)).toString().slice(0, 200); } catch { } throw new Error(msg); } return r; }
  catch (e) { if (e.name === 'AbortError') throw new Error(`${who}가 제때 답하지 않았어요.`); if (e instanceof TypeError) throw new Error(`${who}에 연결하지 못했어요. 켜져 있는지, 주소가 맞는지 봐 주세요.`); throw e; }
  finally { clearTimeout(t); }
}
export const iopModel = async () => (await (await iopFetch('/api/v1/model')).json());
async function iopaintDialog() {
  const C = iopCfg(), c = canvasOf(), l = layerOf();
  const url = H('input.text', { value: C.url, 'aria-label': 'IOPaint 주소' }), state2 = H('span.iop-state', null, '확인하는 중');
  const prompt = H('textarea.text.area', { rows: 2, placeholder: '그려 넣을 것을 영어로. 예: muscular arm, bare shoulder', 'aria-label': '그려 넣을 것', value: C.prompt });
  const neg = H('input.text', { value: C.neg, 'aria-label': '빼고 싶은 것' });
  const steps = H('input.text.num', { type: 'number', min: 5, max: 60, value: C.steps, 'aria-label': '단계 수' });
  const mode = H('select.text', { 'aria-label': '보낼 그림' }, H('option', { value: 'layer', selected: C.mode === 'layer' }, '고른 레이어만 (가려졌던 곳을 레이어에 채워 넣기)'), H('option', { value: 'view', selected: C.mode === 'view' }, '보이는 그대로 (새 레이어로 얹기)'));
  let model = null;
  const check = async () => { settings.set('iop', { ...iopCfg(), url: url.value.trim() }); state2.textContent = '확인하는 중'; try { model = await iopModel(); state2.textContent = `연결됨: ${model.name}${model.model_type ? ` (${model.model_type})` : ''}`; } catch (e) { model = null; state2.textContent = e.message; } };
  url.addEventListener('change', check); check();
  dialog({ title: 'IOPaint로 그려 넣기', wide: true, body: H('div.form', null,
    H('p.set-note', null, '이 PC에 IOPaint를 켜 두면, 고른 곳을 거기로 보내 그려 넣어요. 그림은 이 PC 밖으로 나가지 않아요. 가려졌던 팔이나 다리를 이어 그리려면 애니 모델(예: Sanster/anything-4.0-inpainting)로 켜 주세요. 켜는 법은 도움말 > IOPaint 켜는 법에 있어요.'),
    H('label.field', null, H('span', null, '주소'), url, state2),
    H('label.field', null, H('span', null, '보낼 그림'), mode),
    H('label.field', null, H('span', null, '그려 넣을 것'), prompt),
    H('label.field', null, H('span', null, '빼고 싶은 것'), neg),
    H('label.field', null, H('span', null, '단계 수'), steps, H('small', null, '많을수록 꼼꼼하지만 오래 걸려요. 4GB 그래픽카드면 20~30이 알맞아요.'))),
    buttons: [{ label: '취소' }, { label: '그려 넣기', primary: true, run: () => {
      const cfg = { ...iopCfg(), url: url.value.trim(), prompt: prompt.value.trim(), neg: neg.value.trim(), steps: Math.max(5, Math.min(60, +steps.value || 25)), mode: mode.value };
      settings.set('iop', cfg);
      if (cfg.mode === 'layer' && (!l || l.locked)) { toast('채워 넣을 레이어를 먼저 골라 주세요.'); return false; }
      runIop(c, l, cfg).catch(e => toast('IOPaint로 그려 넣기: ' + (e.message || '실패했어요'), 'err'));
    } }] });
}
async function runIop(c, l, cfg) {
  await runJob('IOPaint로 그려 넣기', async (j, say) => {
    say('그림을 준비하는 중', 0.05);
    let src, M;
    if (cfg.mode === 'layer') { src = await layerPic(l); M = await selInLayer(l); }
    else { src = await flatten(c); M = sel.cv; }
    const W0 = src.width, H0 = src.height, md = (() => { const t = mk(W0, H0), g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(M, 0, 0, W0, H0); return g.getImageData(0, 0, W0, H0).data; })();
    let x0 = W0, y0 = H0, x1 = -1, y1 = -1;
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) if (md[(y * W0 + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) throw new Error(cfg.mode === 'layer' ? '고른 곳이 이 레이어와 겹치지 않아요.' : '고른 곳이 없어요.');
    // 둘레를 넉넉히 함께 보내야 어울리게 그려요 (8의 배수로 맞춰요)
    const pad = Math.max(64, Math.round(Math.max(x1 - x0, y1 - y0) * 0.75)); x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W0, x1 + pad); y1 = Math.min(H0, y1 + pad);
    const W = Math.max(8, Math.floor((x1 - x0) / 8) * 8), H = Math.max(8, Math.floor((y1 - y0) / 8) * 8);
    const img = mk(W, H), g = img.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); g.drawImage(src, -x0, -y0);   // 투명한 곳은 회색으로 (그 자리도 함께 그려요)
    const m = mk(W, H), mg = m.getContext('2d', { willReadFrequently: true }); mg.drawImage(M, 0, 0, M.width, M.height, -x0 * M.width / W0, -y0 * M.height / H0, M.width * W0 / M.width, M.height * H0 / M.height);
    const mdd = mg.getImageData(0, 0, W, H); for (let i = 0; i < W * H; i++) { const v = mdd.data[i * 4 + 3] > 20 ? 255 : 0; mdd.data[i * 4] = mdd.data[i * 4 + 1] = mdd.data[i * 4 + 2] = v; mdd.data[i * 4 + 3] = 255; } mg.putImageData(mdd, 0, 0);
    let isSd = false; try { const mi = await iopModel(); isSd = mi.model_type && mi.model_type !== 'inpaint'; } catch (e) { throw e; }
    say(isSd ? 'IOPaint가 그리는 중 (4GB 그래픽카드면 1~3분쯤 걸려요)' : 'IOPaint가 메우는 중', 0.2);
    const body = { image: await b64(img), mask: await b64(m), prompt: cfg.prompt, negative_prompt: cfg.neg, sd_steps: cfg.steps, sd_strength: cfg.strength, sd_seed: -1, sd_mask_blur: 8, sd_keep_unmasked_area: true, sd_match_histograms: false, hd_strategy: 'Crop', hd_strategy_crop_margin: 128, hd_strategy_crop_trigger_size: 800, hd_strategy_resize_limit: 1280 };
    const r = await iopFetch('/api/v1/inpaint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 30 * 60 * 1000);
    if (j.stop) return;
    const out = await createImageBitmap(await r.blob()); say('받은 그림을 넣는 중', 0.9);
    // 고른 곳만 가져와요 (가장자리는 살짝 부드럽게)
    const piece = mk(W, H), pg = piece.getContext('2d'); pg.drawImage(out, 0, 0, W, H); pg.globalCompositeOperation = 'destination-in'; pg.filter = 'blur(2px)'; pg.drawImage(m, 0, 0); pg.filter = 'none';
    { const t = mk(W, H), tg = t.getContext('2d', { willReadFrequently: true }); tg.drawImage(m, 0, 0); const d = tg.getImageData(0, 0, W, H); for (let i = 0; i < W * H; i++) d.data[i * 4 + 3] = d.data[i * 4]; tg.putImageData(d, 0, 0); pg.globalCompositeOperation = 'destination-in'; pg.filter = 'blur(2px)'; pg.drawImage(t, 0, 0); pg.filter = 'none'; }
    if (cfg.mode === 'layer') {
      const full = mk(W0, H0), fg = full.getContext('2d'); fg.drawImage(src, 0, 0); fg.drawImage(piece, x0, y0);
      await swapImage(l, full, '채움', { hidden: true }); commit('IOPaint로 채우기');
    } else { await layerFromBlob(c, await png(piece), '그려 넣은 자리', { x: x0, y: y0, hidden: true }); commit('IOPaint로 그려 넣기'); }
  });
}

// 따로 설치하는 것(파이썬, IOPaint 모델, 부위 서버)을 둘 디스크와 폴더. 두 도움말이 함께 써요
const LETTERS = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
async function drivesHere() {   // 설치판은 실제로 있는 디스크만, HTML판은 알 수 없어서 흔한 글자들
  const T = window.__TAURI__; if (!(T && T.fs)) return null;
  const out = []; for (const L of LETTERS) { try { if (await T.fs.exists(L + ':\\')) out.push(L); } catch (_) { /* 없음 */ } } return out.length ? out : null;
}
const toolBase = () => settings.get('toolDir') || ((settings.get('packDir') || 'C:').slice(0, 2) + '\\감자편집기');
function diskChooser(onChange) {
  const T = window.__TAURI__, set = v => { settings.set('toolDir', v); onChange(v); show.textContent = v; };
  const show = H('code.disk-path', null, toolBase());
  const sel = H('select.text', { 'aria-label': '저장할 디스크' }, ...LETTERS.slice(0, 6).map(L => H('option', { value: L, selected: toolBase()[0] === L }, L + ' 드라이브')));
  sel.addEventListener('change', () => set(sel.value + ':' + toolBase().slice(2)));
  drivesHere().then(ds => { if (!ds) return; sel.replaceChildren(...ds.map(L => H('option', { value: L, selected: toolBase()[0] === L }, L + ' 드라이브'))); if (!ds.includes(toolBase()[0])) set(ds[0] + ':' + toolBase().slice(2)); });
  const pick = T && T.dialog && H('button.btn.small', { onclick: async () => { const d = await T.dialog.open({ directory: true, title: '따로 설치하는 것을 둘 폴더' }); if (d) { set(String(d)); sel.value = String(d)[0]; } } }, '폴더 고르기');
  return H('div.disk-pick', null, H('label.field.disk-row', null, H('span', null, '저장할 곳'), sel, pick), H('p.set-note', null, '아래 명령에 들어가는 폴더: ', show), H('p.set-note', null, 'C 드라이브가 모자라면 다른 디스크를 골라 주세요.' + (T ? '' : ' HTML판은 이 PC에 어떤 디스크가 있는지 알 수 없어서, 실제로 있는 드라이브를 골라 주세요.')));
}
const iopCmd = b => `iopaint start --model=Sanster/anything-4.0-inpainting --device=cuda --low-mem --no-half --disable-nsfw-checker --port=8080 --model-dir="${b}\\iopaint-models"`;
const PIP_TORCH = 'pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121';
const copyBtn = t => H('button.btn.small', { onclick: async () => { try { await navigator.clipboard.writeText(typeof t === 'function' ? t() : t); toast('복사했어요.'); } catch { toast('복사하지 못했어요. 직접 골라서 복사해 주세요.'); } } }, '복사');
const codeBox = t => { const c = H('code', null, typeof t === 'function' ? t() : t); return { el: H('div.iop-code', null, c, copyBtn(t)), redo: () => { c.textContent = typeof t === 'function' ? t() : t; } }; };
export function iopHelp() {
  const py = H('p', null), boxes = [codeBox(PIP_TORCH), codeBox('pip install --no-cache-dir iopaint'), codeBox(() => iopCmd(toolBase()))];
  const redo = () => { py.textContent = `python.org에서 Python 3.11을 받아 설치해요. 첫 화면에서 "Add python.exe to PATH"를 꼭 체크하고, "Customize installation" → 다음 → 설치 폴더(Customize install location)를 ${toolBase()}\\Python311로 바꿔 주세요.`; boxes.forEach(b => b.redo()); };
  redo();
  dialog({ title: 'IOPaint 켜는 법', wide: true, body: H('div.form.iop-help', null,
    H('p', null, 'IOPaint는 무료 그림 채우기 프로그램이에요. 이 PC에서 켜 두면 감자 편집기의 AI > 고른 곳을 IOPaint로 그려 넣기가 그림을 거기로 보내요. 처음 한 번만 설치하면 돼요.'),
    diskChooser(redo),
    H('b', null, '1. 파이썬 설치'), py,
    H('b', null, '2. IOPaint 설치'),
    H('p', null, '시작 메뉴에서 "cmd"를 찾아 명령 프롬프트를 열고, 아래 두 줄을 차례로 붙여 넣어요. 몇 GB를 받아서 10분쯤 걸려요. --no-cache-dir은 받은 파일 사본을 C 드라이브에 남기지 않게 해요.'),
    boxes[0].el, boxes[1].el,
    H('b', null, '3. 켜기 (쓸 때마다)'),
    H('p', null, '명령 프롬프트에 아래 줄을 붙여 넣어요. 처음 켤 때 애니 채우기 모델(약 2GB)을 위에서 고른 곳에 받아요. 창은 쓰는 동안 열어 두세요.'),
    boxes[2].el,
    H('p.set-note', null, '--disable-nsfw-checker를 빼면 성인 그림의 결과가 까맣게 나와요. --no-half는 GTX 16 계열에서 그림이 까맣게 나오는 것을 막아요. "out of memory"가 나오면 끝에 --cpu-offload를 붙여 다시 켜 주세요. 느려지지만 4GB에서도 돌아가요.'),
    H('p.set-note', null, '그래픽카드에서 실제로 돌려 보지는 못했어요. 안 되면 명령 프롬프트에 나온 마지막 몇 줄을 알려 주세요.')),
    buttons: [{ label: '닫기', primary: true }] });
}

// 부위 서버 잇기: 이 PC에서 켠 부위 서버(See-through 19부위 모델)에 레이어 그림을 보내고, 부위마다 레이어로 나눠요
const PART_KO = ['머리카락', '모자', '얼굴', '눈', '안경', '귀', '귀걸이', '코', '입', '목', '목 장식', '윗옷과 몸통', '팔과 손', '아랫도리', '다리', '신발', '꼬리', '날개', '물건'];
const FACE_IN = new Set([3, 4, 5, 6, 7, 8]);   // 눈, 안경, 귀, 귀걸이, 코, 입 → 얼굴에 합치기
const partsCfg = () => ({ ...settings.defaults.parts, ...(settings.get('parts') || {}) });
const partsFetch = (path, opt, ms) => iopFetch(path, opt, ms, partsCfg().url, '부위 서버');
function partsDialog() {
  const C = partsCfg(), l = layerOf(), url = H('input.text', { value: C.url, 'aria-label': '부위 서버 주소' }), st = H('span.iop-state', null, '확인하는 중');
  const merge = H('input', { type: 'checkbox', checked: C.mergeFace });
  const check = async () => { settings.set('parts', { ...partsCfg(), url: url.value.trim() }); st.textContent = '확인하는 중'; try { const i = await (await partsFetch('/info')).json(); st.textContent = `연결됨: ${i.device === 'cuda' ? '그래픽카드' : 'CPU'}로 돌아가요`; } catch (e) { st.textContent = e.message; } };
  url.addEventListener('change', check); check();
  dialog({ title: '부위별로 레이어 나누기', body: H('div.form', null,
    H('p.set-note', null, '고른 레이어를 이 PC의 부위 서버로 보내 머리카락, 얼굴, 윗옷과 몸통, 팔과 손, 다리 같은 부위로 나눠요. 두 사람이 겹친 그림은 먼저 사람별로 나누고 한 사람씩 하면 더 잘 돼요. 켜는 법은 도움말 > 부위 서버 켜는 법에 있어요.'),
    H('label.field', null, H('span', null, '주소'), url, st),
    H('label.check', null, merge, '눈, 코, 입, 귀는 얼굴에 합치기')),
    buttons: [{ label: '취소' }, { label: '나누기', primary: true, run: () => {
      settings.set('parts', { ...partsCfg(), url: url.value.trim(), mergeFace: merge.checked });
      runParts(canvasOf(), l, merge.checked).catch(e => toast('부위별로 나누기: ' + (e.message || '실패했어요'), 'err'));
    } }] });
}
async function runParts(c, l, mergeFace) {
  await runJob('부위별로 나누기', async (j, say) => {
    const bmp = await layerPic(l), name = l.name, W = bmp.width, H0 = bmp.height, k = Math.min(1, 1600 / Math.max(W, H0));
    const send = mk(Math.round(W * k), Math.round(H0 * k)), sg = send.getContext('2d'); sg.fillStyle = '#ffffff'; sg.fillRect(0, 0, send.width, send.height); sg.drawImage(bmp, 0, 0, send.width, send.height);   // 투명한 곳은 흰 바탕으로
    say('부위 서버가 나누는 중 (그래픽카드면 수십 초, CPU면 몇 분 걸려요)', 0.2);
    const r = await (await partsFetch('/parts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: await b64(send) }) }, 30 * 60 * 1000)).json();
    if (r.error) throw new Error(r.error); if (j.stop) return;
    const labImg = await createImageBitmap(await (await fetch(r.labels)).blob()), lc = mk(W, H0), lg = lc.getContext('2d', { willReadFrequently: true });
    lg.imageSmoothingEnabled = false; lg.drawImage(labImg, 0, 0, W, H0); const ld = lg.getImageData(0, 0, W, H0).data;
    const ac = mk(W, H0), ag = ac.getContext('2d', { willReadFrequently: true }); ag.drawImage(bmp, 0, 0); const ad = ag.getImageData(0, 0, W, H0).data;
    const N = W * H0, groups = new Map();
    for (let i = 0; i < N; i++) { if (ad[i * 4 + 3] < 8) continue; let p = ld[i * 4] - 1; if (p >= 0 && mergeFace && FACE_IN.has(p)) p = 2; groups.set(p, (groups.get(p) || 0) + 1); }
    const keep = [...groups].filter(([p, n]) => p >= 0 && n > N * 0.002).map(([p]) => p).sort((a, b) => a - b);
    if (!keep.length) { toast('나눌 부위를 찾지 못했어요.'); return; }
    say('레이어를 만드는 중', 0.9); let at = c.layers.indexOf(l); const made = [];
    for (const p of [...keep, -1]) {
      const m = mk(W, H0), mg = m.getContext('2d'), md = mg.createImageData(W, H0); let any = 0;
      for (let i = 0; i < N; i++) { let q = ld[i * 4] - 1; if (q >= 0 && mergeFace && FACE_IN.has(q)) q = 2; if (p === -1 ? (q < 0 || !keep.includes(q)) : q === p) { md.data[i * 4 + 3] = 255; any++; } }
      if (!any) continue; mg.putImageData(md, 0, 0);
      const n = { ...l, ...(l.adj ? { adj: { ...l.adj } } : {}), id: uid('l'), name: `${name} ${p === -1 ? '나머지' : PART_KO[p]}` }; await swapImage(n, cut(bmp, m), p === -1 ? '나머지' : PART_KO[p]); made.push(n);
    }
    // 그리는 순서: 다리·아랫도리가 아래, 머리카락이 위 (대략)
    const ORDER = [17, 16, 14, 15, 13, 11, 9, 10, 12, 2, 5, 6, 3, 4, 7, 8, 1, 0, 18];
    made.sort((a, b) => ORDER.indexOf(PART_KO.findIndex(t => a.name.endsWith(t))) - ORDER.indexOf(PART_KO.findIndex(t => b.name.endsWith(t))));
    c.layers.splice(at, 1, ...made); commit('부위별로 나누기'); toast(`부위 ${made.length}개로 나눴어요. 원래 레이어는 되돌리기로 돌아와요.`);
  });
}
export function partsHelp() {
  const where = H('p', null), boxes = [codeBox('pip install --no-cache-dir einops pillow numpy'), codeBox(() => `cd /d "${toolBase()}"`), codeBox('python potato_parts_server.py')];
  const redo = () => { where.textContent = `받은 파일을 ${toolBase()} 폴더에 넣어 주세요. 모델(약 1.3GB)은 그 옆의 potato-parts 폴더에 받아요.`; boxes.forEach(b => b.redo()); };
  redo();
  dialog({ title: '부위 서버 켜는 법', wide: true, body: H('div.form.iop-help', null,
    H('p', null, '부위 서버는 See-through의 부위 나누기 모델을 이 PC에서 돌리는 작은 프로그램이에요. 모델이 커서(약 1.3GB) 편집기 안에서는 못 돌리고, 따로 켜서 이어요. 그림은 이 PC 밖으로 나가지 않아요.'),
    diskChooser(redo),
    H('b', null, '1. 준비'),
    H('p', null, 'IOPaint 켜는 법의 1, 2번(파이썬과 torch 설치)을 먼저 해 주세요. 그다음 명령 프롬프트에 아래 줄을 붙여 넣어요.'),
    boxes[0].el,
    H('b', null, '2. 서버 파일 받기'),
    H('p', null, H('button.btn.small', { onclick: () => download(new Blob([PARTS_SERVER], { type: 'text/x-python' }), 'potato_parts_server.py') }, 'potato_parts_server.py 받기')), where,
    H('b', null, '3. 켜기 (쓸 때마다)'),
    H('p', null, '명령 프롬프트에 아래 두 줄을 차례로 붙여 넣어요. 처음 켤 때 모델을 받아요.'),
    boxes[1].el, boxes[2].el,
    H('p.set-note', null, '"준비됐어요"가 나오면 쓸 수 있어요. 그래픽카드 메모리가 모자라다고 나오면 python potato_parts_server.py --cpu로 켜 주세요. CPU로는 한 장에 몇 분 걸려요.'),
    H('p.set-note', null, '이 모델은 옷 입은 캐릭터로 배운 모델이라, 맨살인 팔은 "팔과 손", 다리는 "다리"로 나오고 몸통은 "윗옷과 몸통"으로 나와요. 시험해 보니 빨간 옷을 머리카락으로 착각하는 일도 있었어요.')),
    buttons: [{ label: '닫기', primary: true }] });
}

// AI 팩 저장 폴더 옮기기 (진행은 AI 작업 줄에 보여요)
async function moveTo(to) {
  try { await runJob('AI 팩 옮기기', async (j, say) => { say('옮기는 중', 0.02); const n = await movePacks(to, (d, t) => say(`옮기는 중 (${mb(d)} / ${mb(t)})`, t ? d / t : 1)); toast(n ? `팩 파일 ${n}개를 옮겼어요. 이제 ${to || '기본 자리'}에 저장해요.` : `이제 AI 팩을 ${to || '기본 자리'}에 저장해요.`); }); }
  catch (e) { toast('AI 팩을 옮기지 못했어요. ' + (e.message || e), 'err'); }
}
