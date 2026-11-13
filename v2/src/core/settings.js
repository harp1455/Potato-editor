// 설정: 이 컴퓨터에만 남는 값 (화면 방식, 패널 배치, 단축키, API 키, 성인 확인)
const KEY = 'potato2.settings';
const DEFAULTS = {
  layoutMode: 'rooms',      // rooms = 작업실 나누기, single = 한 화면에 모두
  room: 'image',
  layouts: {},              // 화면 방식·작업실마다 저장된 패널 배치
  keys: {},                 // 내가 바꾼 단축키 { 명령 이름: 'Ctrl+K' }
  theme: 'dark',
  adult: false,             // 성인 확인을 마쳤는지
  adultAt: '',
  askedAdult: false,
  apiKey: '',
  textModel: 'gemini-3.8-flash',
  hints: true,
};

let data = { ...DEFAULTS };
try { data = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { /* 저장된 값이 깨졌으면 기본값으로 */ }

const subs = new Set();
export const settings = {
  get: k => data[k],
  set(k, v) {
    data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* 저장 공간이 막혀 있어도 이번 실행 동안은 유지 */ }
    subs.forEach(f => f(k, v));
  },
  on(f) { subs.add(f); return () => subs.delete(f); },
  defaults: DEFAULTS,
};
