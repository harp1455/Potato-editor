// API 금액 어림: 제미나이 요금표(100만 토큰당 달러, 2026-11-11에 확인한 값)로 계산해요. 실제 청구는 구글이 정해요.
import { settings } from './settings.js';
// [모델 이름, [[이날까지(그날 포함), 입력, 출력] …]] 마지막 칸은 그 뒤로 계속
const PRICES = [
  [/^gemini-4-carbon/, [['2026-11-30', 2, 10], [null, 4, 20]]],
  [/^gemini-4-argon/, [['2026-11-30', 2, 10], [null, 4, 20]]],
  [/^gemini-3\.8-flash-lite-tts/, [['2026-12-31', 0.5, 6], [null, 1, 12]]],
  [/^gemini-3\.8-flash-tts/, [['2026-12-31', 0.5, 9], [null, 1, 18]]],
  [/^gemini-3\.[678]-flash(?!-lite)/, [['2026-12-31', 0.75, 3.75], [null, 1.5, 7.5]]],
  [/^gemini-3\.1-pro/, [[null, 2, 12]]],
  [/^gemini-3\.5-flash-lite/, [[null, 0.3, 2.5]]],
  [/^gemini-3\.5-flash/, [[null, 1.5, 9]]],
  [/^gemini-2\.5-pro/, [[null, 1.25, 10]]],
  [/^gemini-2\.5-flash-lite/, [[null, 0.1, 0.4]]],
  [/^gemini-2\.5-flash/, [[null, 0.3, 2.5]]],
  [/^gemini-omni/, [[null, 1.5, 17.5]]],
];
const dayOf = t => { const d = new Date(t || Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// 기록 한 줄 → 달러 (요금을 모르는 모델이나 NovelAI는 null)
export function costOf(row) {
  const P = PRICES.find(p => p[0].test(String(row.model || ''))); if (!P) return null;
  const day = dayOf(row.t), r = P[1].find(x => !x[0] || day <= x[0]) || P[1].at(-1);
  return ((row.in || 0) * r[1] + ((row.out || 0) + (row.th || 0)) * r[2]) / 1e6;
}
export const krw = () => +settings.get('krw') || 1340;
export function money(usd) {
  if (usd == null) return '모름';
  const w = usd * krw();
  return `${w < 1 ? '1원 미만' : Math.round(w).toLocaleString('ko-KR') + '원'} ($${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)})`;
}
// 오늘, 이번 달, 전체 합계 (달러)
export function totals(log) {
  const now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), sum = f => log.filter(f).reduce((a, r) => a + (costOf(r) || 0), 0);
  return { day: sum(r => r.t >= d0), month: sum(r => r.t >= m0), all: sum(() => true) };
}
