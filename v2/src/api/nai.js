// NovelAI로 가는 요청이 지나는 통로. 지금은 연결 확인(구독·Anlas)만 있고, 그림 만들기·인페인트는 다음 단계에서 얹어요.
// NovelAI 서버는 브라우저에서 바로 부르는 것을 허용해서(CORS *), 설치판과 HTML판 모두에서 돼요.
import { settings } from '../core/settings.js';
import { ApiError } from './gemini.js';

const HOST = 'https://image.novelai.net';
const TIERS = ['구독 없음', 'Tablet', 'Scroll', 'Opus'];

export async function naiFetch(path, init = {}) {
  const token = settings.get('naiToken').trim();
  if (!token) throw new ApiError('key', 'NovelAI 토큰이 없어요. 설정 > AI와 API에 넣어 주세요.');
  let res;
  try { res = await fetch(HOST + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch (_) { throw new ApiError('net', 'NovelAI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (res.status === 401) throw new ApiError('key', 'NovelAI 토큰이 맞지 않아요. 계정 설정에서 토큰을 다시 받아 주세요.');
  if (res.status === 402) throw new ApiError('quota', 'Anlas가 모자라거나 구독이 끝났어요.');
  if (res.status === 429) throw new ApiError('quota', '지금은 요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.');
  if (!res.ok) throw new ApiError('http', `NovelAI 요청이 실패했어요 (${res.status}).`);
  return res;
}

export async function naiAccount() {
  const j = await (await naiFetch('/user/subscription')).json();
  const steps = j.trainingStepsLeft || {};
  return { tier: TIERS[j.tier || 0] || TIERS[0], anlas: (steps.fixedTrainingStepsLeft || 0) + (steps.purchasedTrainingSteps || 0) };
}
