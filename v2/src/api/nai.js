// NovelAI로 가는 요청이 지나는 통로: 연결 확인, 글로 그림 만들기, 그림 바탕으로 다시 그리기, 고른 곳만 다시 그리기(인페인트).
// NovelAI 서버는 브라우저에서 바로 부르는 것을 허용해서(CORS *), 설치판과 HTML판 모두에서 돼요.
// 요청 모양은 공개된 구현들(DNT-LAB/NAIA_novel_ai_entrypoint, sunho/SDStudio — MIT)과 NAIS3·NAIA2.0의 설명을 참고해 새로 썼어요.
import { settings } from '../core/settings.js';
import { unzipFirst } from '../core/files.js';
import { ApiError } from './gemini.js';

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
  return { blob: new Blob([png], { type: 'image/png' }), seed: body.parameters.seed };
}
