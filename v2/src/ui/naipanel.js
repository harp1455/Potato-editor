// NovelAI 패널: 글로 그림 만들기, 지금 그림 바탕으로 다시 그리기, 고른 곳만 다시 그리기
import { h } from './dom.js';
import { state, commit, emit, canvasOf, newCanvas, addLayer, addMedia, ensureFolder } from '../core/store.js';
import { settings } from '../core/settings.js';
import { sel, selBounds } from '../core/select.js';
import { flatten, layerFromBlob } from '../rooms/image.js';
import { NAI_MODELS, NAI_SAMPLERS, NAI_SIZES, NAI_UC, fitSize, naiGenerate, naiAccount } from '../api/nai.js';
import { run } from '../core/cmd.js';
import { toast } from './overlay.js';

const DEF = { model: 'nai-diffusion-4-5-full', prompt: '', negative: '', size: 0, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 0, quality: true, uc: 'heavy', cfgRescale: 0, variety: false, strength: 0.5, noise: 0, inStrength: 1, more: false };
const F = { ...DEF, ...(settings.get('nai') || {}) };
let saveT = 0;
const keep = () => { clearTimeout(saveT); saveT = setTimeout(() => settings.set('nai', { ...F }), 400); };
const job = { on: false, text: '', ctl: null, anlas: null, last: '' };

const b64 = async blob => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const pngOf = c => new Promise(r => c.toBlob(r, 'image/png'));
function scaled(src, w, h) { const t = document.createElement('canvas'); t.width = w; t.height = h; const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h); return t; }
// NovelAI 인페인트 가림막: 그림과 같은 크기, 8칸 단위로 흰색(다시 그릴 곳)·검정
function naiMask(w, h, r) {   // r = 그림판에서 잘라 볼 자리 { x, y, w, h } (없으면 전체)
  r = r || { x: 0, y: 0, w: sel.w, h: sel.h };
  const s = document.createElement('canvas'); s.width = Math.round(w / 8); s.height = Math.round(h / 8); const g = s.getContext('2d', { willReadFrequently: true }); g.drawImage(sel.cv, r.x, r.y, r.w, r.h, 0, 0, s.width, s.height);
  const id = g.getImageData(0, 0, s.width, s.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const on = d[i + 3] > 20 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = on; d[i + 3] = 255; }
  g.putImageData(id, 0, 0);
  const t = document.createElement('canvas'); t.width = w; t.height = h; const tg = t.getContext('2d'); tg.imageSmoothingEnabled = false; tg.drawImage(s, 0, 0, w, h);
  return t;
}
// 고른 곳 둘레만 잘라 보낼 자리: 고른 곳보다 넉넉하게(주변을 보고 어울리게 그리도록), 그림판 안에서
function cropFor(c) {
  const b = selBounds(); if (!b) return { x: 0, y: 0, w: c.w, h: c.h };
  const pad = Math.max(96, Math.round(Math.max(b.w, b.h) * 0.6)), x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad), x1 = Math.min(c.w, b.x + b.w + pad), y1 = Math.min(c.h, b.y + b.h + pad);
  return (x1 - x) * (y1 - y) > c.w * c.h * 0.7 ? { x: 0, y: 0, w: c.w, h: c.h } : { x, y, w: x1 - x, h: y1 - y };
}
function cropOf(src, r) { const t = document.createElement('canvas'); t.width = r.w; t.height = r.h; t.getContext('2d').drawImage(src, -r.x, -r.y); return t; }
const opts = () => { const [w, h] = NAI_SIZES[F.size] || NAI_SIZES[0]; return { model: F.model, prompt: F.prompt, negative: F.negative, width: w, height: h, steps: +F.steps, scale: +F.scale, sampler: F.sampler, seed: +F.seed || 0, quality: F.quality, uc: F.uc, cfgRescale: +F.cfgRescale, variety: F.variety }; };

async function go(kind) {
  if (job.on) return;
  if (!settings.get('adult')) { toast('성인 확인을 마친 뒤에 쓸 수 있어요.', 'err'); return run('app.settings'); }
  if (!settings.get('naiToken').trim()) { toast('NovelAI 토큰이 없어요. 설정 > AI와 API에 넣어 주세요.', 'err'); return run('app.settings'); }
  if (!F.prompt.trim()) { toast('무엇을 그릴지 프롬프트를 적어 주세요.', 'err'); return; }
  const c = canvasOf(), o = opts();
  job.on = true; job.ctl = new AbortController(); job.text = 'NovelAI가 그리는 중이에요.'; emit();
  try {
    let src = null, fit = null, flat = null, R = null;
    if (kind !== 'new') {
      flat = await flatten(c); R = kind === 'fill' ? cropFor(c) : { x: 0, y: 0, w: c.w, h: c.h };
      // 작은 자리는 키워서 보내요(최대 2배). 그래야 NovelAI가 세밀하게 그려요
      const up = Math.min(2, Math.sqrt(1024 * 1024 / (R.w * R.h))); fit = up > 1 ? fitSize(R.w * up, R.h * up) : fitSize(R.w, R.h); o.width = fit.w; o.height = fit.h;
      src = { image: await b64(await pngOf(scaled(cropOf(flat, R), fit.w, fit.h))), strength: kind === 'fill' ? +F.inStrength : +F.strength, noise: +F.noise };
      if (kind === 'fill') src.mask = await b64(await pngOf(naiMask(fit.w, fit.h, R)));
    }
    const { blob, seed } = await naiGenerate(o, src, job.ctl.signal);
    const folder = ensureFolder('NovelAI'), stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    if (kind === 'new') {
      const m = await addMedia(new File([blob], `nai ${stamp} ${seed}.png`, { type: 'image/png' }), folder, { meta: true });
      addLayer(canvasOf() || newCanvas('NovelAI 그림', m.w, m.h), m); commit('NovelAI로 그림 만들기');
    } else if (kind === 'redo') {
      await layerFromBlob(c, blob, '다시 그림', { scale: c.w / fit.w, folder }); commit('NovelAI로 다시 그리기');
    } else {
      // 결과에서 고른 곳(가장자리는 부드럽게)만 남겨 레이어로 올려요. 나머지는 원래 그림 그대로예요
      const blur = Math.max(2, Math.round(Math.max(R.w, R.h) / 300));
      const m = document.createElement('canvas'); m.width = R.w; m.height = R.h; const mg = m.getContext('2d', { willReadFrequently: true });
      mg.filter = `blur(${blur}px)`; mg.drawImage(naiMask(R.w, R.h, R), 0, 0); mg.filter = 'none';
      const md = mg.getImageData(0, 0, R.w, R.h), d = md.data; for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i];   // 밝기를 투명도로
      mg.putImageData(md, 0, 0);
      const bmp = await createImageBitmap(blob), t = document.createElement('canvas'); t.width = R.w; t.height = R.h; const g = t.getContext('2d');
      g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, R.w, R.h); bmp.close();
      g.globalCompositeOperation = 'destination-in'; g.drawImage(m, 0, 0);
      await layerFromBlob(c, await pngOf(t), '다시 그린 곳', { x: R.x, y: R.y, hidden: true }); commit('NovelAI로 고른 곳 다시 그리기');
    }
    job.last = `씨앗 ${seed}`;
    naiAccount().then(a => { job.anlas = a.anlas; emit(); }).catch(() => {});
  } catch (e) { if (e.code !== 'stop') toast(e.message || 'NovelAI 요청이 실패했어요.', 'err'); }
  job.on = false; job.ctl = null; job.text = ''; emit();
}

// 그림과 가림막(흰 곳 = 다시 그릴 곳)을 받아 NovelAI 인페인트 결과(비트맵)를 돌려줘요. 캐릭터 작업실이 써요
export async function infillCanvas(pic, maskCanvas, prompt, signal) {
  const fit = fitSize(pic.width, pic.height), o = { ...opts(), prompt, width: fit.w, height: fit.h };
  const s = scaled(maskCanvas, fit.w / 8, fit.h / 8), g = s.getContext('2d'), id = g.getImageData(0, 0, s.width, s.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const on = d[i] > 24 && d[i + 3] > 24 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = on; d[i + 3] = 255; }
  g.putImageData(id, 0, 0);
  const m = document.createElement('canvas'); m.width = fit.w; m.height = fit.h; const mg = m.getContext('2d'); mg.imageSmoothingEnabled = false; mg.drawImage(s, 0, 0, fit.w, fit.h);
  const { blob } = await naiGenerate(o, { image: await b64(await pngOf(scaled(pic, fit.w, fit.h))), mask: await b64(await pngOf(m)), strength: 1 }, signal);
  return createImageBitmap(blob);
}
export const naiPrompt = () => F.prompt;

export const naiPanel = {
  title: 'NovelAI',
  render(el) {
    const c = canvasOf(), ready = settings.get('adult') && settings.get('naiToken').trim();
    const bind = (k, num) => ({ value: F[k], oninput: e => { F[k] = num ? +e.target.value : e.target.value; keep(); } });
    const pick = (label, k, list) => h('label.field', null, h('span.field-name', null, label), h('select.text', { 'aria-label': label, onchange: e => { F[k] = isNaN(+e.target.value) || k !== 'size' ? e.target.value : +e.target.value; keep(); emit(); } }, list.map(([v, t]) => h('option', { value: v, selected: String(F[k]) === String(v) }, t))));
    const numf = (label, k, min, max, step) => h('label.field', null, h('span.field-name', null, label), h('input.num', { type: 'number', min, max, step, 'aria-label': label, ...bind(k, true) }));
    const fit = c ? fitSize(c.w, c.h) : null;
    if (!ready) el.append(h('p.empty', null, settings.get('adult') ? 'NovelAI 토큰을 넣으면 편집기 안에서 바로 그림을 만들고 고칠 수 있어요.' : '성인 확인을 마치고 NovelAI 토큰을 넣으면 쓸 수 있어요.'), h('button.btn', { onclick: () => run('app.settings') }, '설정 열기'));
    el.append(...[
      h('label.stack', null, h('span.field-name', null, '프롬프트'), h('textarea.text.area', { rows: 5, placeholder: '1boy, solo, looking at viewer, …', 'aria-label': '프롬프트', ...bind('prompt') })),
      h('label.stack', null, h('span.field-name', null, '빼고 싶은 것'), h('textarea.text.area', { rows: 2, 'aria-label': '빼고 싶은 것', ...bind('negative') })),
      pick('모델', 'model', NAI_MODELS),
      pick('크기', 'size', NAI_SIZES.map(([w, hh, t], i) => [i, `${t} ${w} × ${hh}`])),
      h('div.btn-row.wide', null,
        h('button.btn.primary', { disabled: job.on, onclick: () => go('new') }, '그림 만들기'),
        job.on && h('button.btn', { onclick: () => job.ctl && job.ctl.abort() }, '멈추기')),
      job.on && h('p.nai-busy', { role: 'status' }, job.text),
      h('h3.sec', null, '지금 그림판으로'),
      !c ? h('p.panel-note', null, '그림판을 열면 그 그림을 바탕으로 다시 그리거나, 고른 곳만 다시 그릴 수 있어요.') : h('p.panel-note', null, `전체 다시 그리기는 그림판(${c.w} × ${c.h})을 ${fit.w} × ${fit.h}로 맞춰 보내요. 고른 곳만 다시 그리기는 그 둘레만 잘라 크게 보내서 더 세밀하게 그려요.`),
      h('label.field', null, h('span.field-name', null, '바꾸는 정도'), h('input.range', { type: 'range', min: 0.05, max: 0.99, step: 0.01, 'aria-label': '바꾸는 정도', value: F.strength, oninput: e => { F.strength = +e.target.value; keep(); e.target.nextSibling.textContent = Math.round(F.strength * 100) + '%'; } }), h('span.field-unit', null, Math.round(F.strength * 100) + '%')),
      h('div.btn-row.wide', null,
        h('button.btn', { disabled: job.on || !c, onclick: () => go('redo') }, '전체 다시 그리기'),
        h('button.btn', { disabled: job.on || !c || !sel.any, title: sel.any ? '' : '고르는 도구로 다시 그릴 곳을 먼저 골라 주세요', onclick: () => go('fill') }, '고른 곳만 다시 그리기')),
      c && !sel.any && h('p.panel-note', null, '고른 곳만 다시 그리려면 마법 붓이나 올가미로 그 자리를 먼저 골라 주세요.'),
      h('button.link.more', { 'aria-expanded': String(F.more), onclick: () => { F.more = !F.more; keep(); emit(); } }, F.more ? '자세한 설정 접기' : '자세한 설정 펴기'),
      ...(F.more ? [
        h('div.field-row', null, numf('스텝', 'steps', 1, 50, 1), numf('따르는 정도', 'scale', 0, 10, 0.1)),
        pick('샘플러', 'sampler', NAI_SAMPLERS),
        pick('기본 제외', 'uc', NAI_UC),
        h('div.field-row', null, numf('씨앗', 'seed', 0, 4294967295, 1), numf('리스케일', 'cfgRescale', 0, 1, 0.01)),
        h('label.check', null, h('input', { type: 'checkbox', checked: F.quality, onchange: e => { F.quality = e.target.checked; keep(); } }), '품질 태그 붙이기'),
        h('label.check', null, h('input', { type: 'checkbox', checked: F.variety, onchange: e => { F.variety = e.target.checked; keep(); } }), '다양하게 (Variety+)'),
        h('p.panel-note', null, '씨앗이 0이면 매번 새로 뽑아요. 고른 곳만 다시 그릴 때는 모델의 인페인트판을 알아서 써요.'),
      ] : []),
      (job.last || job.anlas != null) && h('p.panel-note', null, [job.last, job.anlas != null ? `남은 Anlas ${job.anlas.toLocaleString('ko-KR')}` : ''].filter(Boolean).join(', ')),
      h('p.panel-note', null, '크기와 스텝에 따라 Anlas가 들 수 있어요.'),
    ].filter(Boolean));
  },
};
