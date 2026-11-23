// NovelAI로 가는 요청이 지나는 통로: 연결 확인, 글로 그림 만들기, 그림 바탕으로 다시 그리기, 고른 곳만 다시 그리기(인페인트).
// NovelAI 서버는 브라우저에서 바로 부르는 것을 허용해서(CORS *), 설치판과 HTML판 모두에서 돼요.
// 요청 모양은 공개된 구현들(DNT-LAB/NAIA_novel_ai_entrypoint, sunho/SDStudio — MIT)과 NAIS3·NAIA2.0의 설명을 참고해 새로 썼어요.
import { settings } from '../core/settings.js';
import { unzipFirst } from '../core/files.js';
import { ApiError, logUse } from './gemini.js';

const HOST = 'https://image.novelai.net';
const TIERS = ['구독 없음', 'Tablet', 'Scroll', 'Opus'];

export const NAI_MODELS = [
  ['nai-diffusion-4-5-full', 'V4.5 Full'],
  ['nai-diffusion-4-5-curated', 'V4.5 Curated'],
  ['nai-diffusion-5-full', 'V5 Full'],
  ['nai-diffusion-5-curated', 'V5 Curated'],
  ['nai-diffusion-4-full', 'V4 Full'],
];
export const NAI_SAMPLERS = [['k_euler_ancestral', 'Euler Ancestral'], ['k_euler', 'Euler'], ['k_dpmpp_2m', 'DPM++ 2M'], ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'], ['k_dpmpp_sde', 'DPM++ SDE'], ['k_dpmpp_2m_sde', 'DPM++ 2M SDE']];
export const NAI_SIZES = [[832, 1216, '세로'], [1216, 832, '가로'], [1024, 1024, '정사각형'], [1024, 1536, '세로 크게'], [1536, 1024, '가로 크게'], [512, 768, '세로 작게'], [768, 512, '가로 작게']];
const QUALITY = ', very aesthetic, masterpiece, no text';
const UC_HEAVY = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
const UC = { heavy: UC_HEAVY, light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page', human: UC_HEAVY + ', @_@, mismatched pupils, glowing eyes, bad anatomy', none: '' };
export const NAI_UC = [['heavy', '강하게'], ['light', '가볍게'], ['human', '사람 중심'], ['none', '없음']];
const UC_INDEX = { heavy: 0, light: 1, human: 3, none: 4 }, UC_HINT = { heavy: 2, light: 3, human: 4, none: 0 };

// NovelAI는 64의 배수 크기만 받아요. 넓이는 maxArea(기본 1024×1024)를 넘지 않게 맞춰요.
export function fitSize(w, h, maxArea = 1024 * 1024) {
  const k = Math.min(1, Math.sqrt(maxArea / (w * h)));
  let W = Math.max(64, Math.round(w * k / 64) * 64), H = Math.max(64, Math.round(h * k / 64) * 64);
  while (W * H > maxArea) { if (W >= H) W -= 64; else H -= 64; }
  return { w: W, h: H };
}
export const randomSeed = () => Math.floor(Math.random() * 4294967295);

// 요청 모양을 만드는 곳 (시험에서 이 함수만 따로 확인해요)
//   o = { model, prompt, negative, width, height, steps, scale, sampler, seed, quality, uc, cfgRescale, variety }
//   src = { image(base64), mask(base64), strength, noise } — image만 있으면 다시 그리기, mask도 있으면 고른 곳만
export const NAI_SPOTS = { lt: ['왼쪽 위', 0.1, 0.1], t: ['위', 0.5, 0.1], rt: ['오른쪽 위', 0.9, 0.1], l: ['왼쪽', 0.1, 0.5], c: ['가운데', 0.5, 0.5], r: ['오른쪽', 0.9, 0.5], lb: ['왼쪽 아래', 0.1, 0.9], b: ['아래', 0.5, 0.9], rb: ['오른쪽 아래', 0.9, 0.9] };
export function buildNai(o, src = null) {
  const v5 = o.model.startsWith('nai-diffusion-5-'), infill = !!(src && src.mask);
  const prompt = o.prompt.trim() + (o.quality ? QUALITY : '');
  let neg = [UC[o.uc] ?? '', (o.negative || '').trim()].filter(Boolean).join(', ');
  // Full 모델은 프롬프트에 nsfw가 없으면 서버 쪽 웹 화면이 원치 않는 내용 칸 맨 앞에 nsfw를 넣어요
  if (o.uc !== 'none' && /-full$/.test(o.model) && !/\bnsfw\b/i.test(prompt)) neg = 'nsfw, ' + neg;
  const seed = o.seed > 0 ? o.seed : randomSeed();
  const p = {
    params_version: v5 ? 4 : 3, width: o.width, height: o.height, scale: o.scale, sampler: o.sampler, steps: o.steps, n_samples: 1,
    ucPreset: UC_INDEX[o.uc] ?? 4, qualityToggle: !!o.quality, autoSmea: false, dynamic_thresholding: false, controlnet_strength: 1, legacy: false,
    add_original_image: true, cfg_rescale: o.cfgRescale || 0, noise_schedule: v5 ? 'karras' : 'karras', legacy_v3_extend: false,
    skip_cfg_above_sigma: o.variety ? (o.model.includes('4-5') ? 58 : 19) * Math.sqrt(o.width * o.height / (832 * 1216)) : null,
    use_coords: false, normalize_reference_strength_multiple: true, legacy_uc: false, seed, extra_noise_seed: seed,
    v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: true },
    v4_negative_prompt: { caption: { base_caption: neg, char_captions: [] }, legacy_uc: false },
    characterPrompts: [], negative_prompt: neg, deliberate_euler_ancestral_bug: false, prefer_brownian: true, image_format: 'png',
  };
  if (v5) { p.tag_hint_qt = o.quality ? 1 : 0; p.tag_hint_uc_preset = UC_HINT[o.uc] ?? 0; }
  if (infill) Object.assign(p, { image: src.image, mask: src.mask, noise: 0, request_type: 'NativeInfillingRequest', inpaintImg2ImgStrength: src.strength ?? 1 });
  else if (src) Object.assign(p, { image: src.image, strength: src.strength ?? 0.5, noise: src.noise ?? 0, color_correct: true });
  // 인물별 설명: 한 줄에 한 명 (여섯 명까지). 자리는 정하지 않고 가운데로 보내요
  // 자리를 하나라도 정하면(charPos) 모두 그 자리로 보내요. 안 정한 인물은 가운데
  const pos = o.charPos || [], coords = String(o.chars || '').split('\n').map((t, i) => [t.trim(), pos[i]]).filter(x => x[0]).slice(0, 6);
  const chars = coords.map(([t, k]) => ({ prompt: t, uc: '', center: NAI_SPOTS[k] ? { x: NAI_SPOTS[k][1], y: NAI_SPOTS[k][2] } : { x: 0.5, y: 0.5 } }));
  if (chars.length) {
    if (coords.some(x => NAI_SPOTS[x[1]])) { p.use_coords = true; p.v4_prompt.use_coords = true; }
    p.characterPrompts = chars;
    p.v4_prompt.caption.char_captions = chars.map(c => ({ char_caption: c.prompt, centers: [c.center] }));
    p.v4_negative_prompt.caption.char_captions = chars.map(c => ({ char_caption: '', centers: [c.center] }));
  }
  // 분위기 참고(바이브): 미리 바꿔 둔 참고 그림과 세기. V5는 받지 않아요
  if (o.vibes && o.vibes.length && !v5) { p.reference_image_multiple = o.vibes.map(v => v.data); p.reference_strength_multiple = o.vibes.map(v => v.strength); }
  return { action: infill ? 'infill' : src ? 'img2img' : 'generate', input: prompt, model: infill && !o.model.includes('inpainting') ? o.model + '-inpainting' : o.model, parameters: p };
}

export async function naiFetch(path, init = {}) {
  const token = settings.get('naiToken').trim();
  if (!token) throw new ApiError('key', 'NovelAI 토큰이 없어요. 설정 > AI와 API에 넣어 주세요.');
  let res;
  try { res = await fetch(HOST + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch (e) { if (e && e.name === 'AbortError') throw new ApiError('stop', '멈췄어요.'); throw new ApiError('net', 'NovelAI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (res.ok) return res;
  let msg = ''; try { msg = String((await res.json()).message || ''); } catch (_) { /* 본문이 없을 수 있음 */ }
  if (res.status === 401) throw new ApiError('key', 'NovelAI 토큰이 맞지 않아요. 계정 설정에서 토큰을 다시 받아 주세요.');
  if (res.status === 402) throw new ApiError('quota', 'Anlas가 모자라거나 구독이 끝났어요.');
  if (res.status === 429) throw new ApiError('quota', '다른 그림을 만드는 중이거나 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
  if (res.status === 400) throw new ApiError('bad', 'NovelAI가 요청을 받아들이지 않았어요. ' + (msg || '설정 값을 확인해 주세요.'), msg);
  throw new ApiError('http', `NovelAI 요청이 실패했어요 (${res.status}). ${msg}`, msg);
}

export async function naiAccount() {
  const j = await (await naiFetch('/user/subscription')).json();
  const steps = j.trainingStepsLeft || {};
  return { tier: TIERS[j.tier || 0] || TIERS[0], anlas: (steps.fixedTrainingStepsLeft || 0) + (steps.purchasedTrainingSteps || 0) };
}

// 그림 한 장을 만들어 PNG Blob으로 돌려줘요
export async function naiGenerate(o, src, signal) {
  const body = buildNai(o, src);
  const res = await naiFetch('/ai/generate-image', { method: 'POST', body: JSON.stringify(body), signal });
  const png = await unzipFirst(await res.arrayBuffer());
  logUse('nai ' + body.action, body.model, null, { size: body.parameters.width + ' × ' + body.parameters.height, steps: body.parameters.steps });
  return { blob: new Blob([png], { type: 'image/png' }), seed: body.parameters.seed };
}

// 디렉터 도구: 그림 한 장을 받아 선화·스케치·색 입히기·표정 바꾸기·군더더기 지우기를 해 줘요
export const NAI_TOOLS = [['lineart', '선화로 바꾸기'], ['sketch', '스케치로 바꾸기'], ['colorize', '색 입히기'], ['emotion', '표정 바꾸기'], ['declutter', '글자와 효과 지우기']];
export const NAI_EMOTIONS = [['neutral', '무표정'], ['happy', '기쁨'], ['sad', '슬픔'], ['angry', '화남'], ['scared', '겁먹음'], ['surprised', '놀람'], ['tired', '지침'], ['excited', '신남'], ['nervous', '긴장'], ['thinking', '생각 중'], ['confused', '어리둥절'], ['shy', '수줍음'], ['disgusted', '싫음'], ['smug', '우쭐'], ['bored', '지루함'], ['laughing', '웃음'], ['irritated', '짜증'], ['aroused', '달아오름'], ['embarrassed', '부끄러움'], ['worried', '걱정'], ['love', '사랑'], ['determined', '결심'], ['hurt', '다침'], ['playful', '장난기']];
export function buildAugment(o) {
  const b = { image: o.image, req_type: o.tool, width: o.width, height: o.height };
  if (o.tool === 'colorize' || o.tool === 'emotion') { b.defry = Math.max(0, Math.min(5, o.weaken | 0)); b.prompt = o.tool === 'emotion' ? `${o.emotion || 'neutral'};;${o.prompt || ''}` : (o.prompt || ''); }
  return b;
}
export async function naiAugment(o, signal) {
  const res = await naiFetch('/ai/augment-image', { method: 'POST', body: JSON.stringify(buildAugment(o)), signal });
  const png = await unzipFirst(await res.arrayBuffer());
  logUse('nai ' + o.tool, 'director', null, { size: o.width + ' × ' + o.height });
  return new Blob([png], { type: 'image/png' });
}

// 화질 2배로 키우기. 그림 한 장(3,145,728픽셀 이하)을 보내면 가로세로 2배인 PNG가 와요
export const NAI_UP_MAX = 3145728;
export const upscaleCost = (w, h) => { const p = w * h; return p > NAI_UP_MAX ? 0 : p <= 1048576 ? 1 : p <= 1747627 ? 2 : p <= 2446678 ? 3 : 4; };
export async function naiUpscale(image, w, h, signal) {
  const res = await naiFetch('/ai/upscale', { method: 'POST', body: JSON.stringify({ image, model: 'nai-diffusion-5-curated', declared_blur_sigma: 0 }), signal });
  const png = await unzipFirst(await res.arrayBuffer());
  if (![137, 80, 78, 71].every((v, i) => png[i] === v)) throw new ApiError('bad', 'NovelAI가 그림이 아닌 것을 돌려줬어요. 잠시 뒤에 다시 해 주세요.');
  logUse('nai upscale', 'upscale', null, { size: w + ' × ' + h });
  return new Blob([png], { type: 'image/png' });
}

// 분위기 참고 그림을 NovelAI가 쓰는 꼴로 바꿔요 (한 번 바꾸면 같은 그림·모델·정보량은 다시 안 바꿔요. Anlas가 들어요)
const vibeCache = new Map();
export async function naiVibe(key, image, model, info, signal) {
  const k = [key, model, info].join('|'); if (vibeCache.has(k)) return vibeCache.get(k);
  const res = await naiFetch('/ai/encode-vibe', { method: 'POST', body: JSON.stringify({ image, model: model.replace(/-inpainting$/, ''), information_extracted: info }), signal });
  const u = new Uint8Array(await res.arrayBuffer()); let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  const data = btoa(t); vibeCache.set(k, data); logUse('nai vibe', model, null, {});
  return data;
}
