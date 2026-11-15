// 설정: 이 컴퓨터에만 남는 값 (화면 방식, 패널 배치, 단축키, API 키, 성인 확인)
const KEY = 'potato2.settings';
const DEFAULTS = {
  layoutMode: 'rooms',      // rooms = 작업실 나누기, single = 한 화면에 모두
  room: 'image',
  layouts: {},              // 화면 방식·작업실마다 저장된 패널 배치
  keys: {},                 // 내가 바꾼 단축키 { 명령 이름: 'Ctrl+K' }
  theme: 'dark',
  iop: { url: 'http://127.0.0.1:8080', prompt: '', neg: 'lowres, bad anatomy, bad hands, worst quality', steps: 25, strength: 1, mode: 'layer' },   // IOPaint(사용자 PC에서 따로 켠 채우기 프로그램)
  parts: { url: 'http://127.0.0.1:8091', mergeFace: true },   // 부위 서버(이 PC에서 따로 켠 See-through 부위 모델)
  samModel: 'fast',         // 윤곽 모델: fast(작은 모델) | big(큰 모델, 정밀 윤곽 팩)
  adult: false,             // 성인 확인을 마쳤는지
  adultAt: '',
  askedAdult: false,
  apiKey: '',
  textModel: 'gemini-3.8-flash',
  imageModel: 'gemini-3.1-flash-image',   // 말로 그림 고치기에 쓰는 모델
  hints: true,
  meta: 'strip',            // 저장할 때 NAI 정보: strip = 지우기, keep = 남기기
  naiToken: '',
  nai: null,                // NovelAI 패널에 적어 둔 값
  selOpt: {},               // 고르는 도구 값 (허용 범위, 붓 굵기, 번짐)
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
