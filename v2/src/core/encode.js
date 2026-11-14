// 장면들을 영상·움짤 파일로: MP4, GIF, WebP. 저장 도구는 8.x 것을 그대로 가져와 써요(legacy/enc.gen.js).
import { makeEnc } from '../legacy/enc.gen.js';

const set = { loop: true, dither: true, q: 90 };
let enc = null;
const load = () => enc || (enc = makeEnc({
  newCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; },
  gs: { set }, uiSet: { hw: 'no-preference' }, auEncoderCfg: async () => null, auEncode: async () => {}, Mp4Muxer: window.Mp4Muxer,
}));
export const canMp4 = () => typeof VideoEncoder !== 'undefined' && !!window.Mp4Muxer;

// 그려 주는 함수로 만들기: src = { W, H, fps, total(초), render(g, t, w, h) }. fmt = 'mp4' | 'gif' | 'webp'. o = { loop, size(긴 쪽, 줄일 때만), quality }
export async function encodeRender(src, fmt, o, onProg) {
  const E = load(), k = Math.min(1, (o.size || 1e9) / Math.max(src.W, src.H));
  const W = Math.max(2, Math.round(src.W * k)), H = Math.max(2, Math.round(src.H * k)), fps = fmt === 'gif' ? Math.min(50, src.fps) : src.fps, n = Math.max(1, Math.round(src.total * fps));
  set.loop = o.loop !== false; set.q = o.quality || 90;
  const prog = (a, b) => onProg && onProg(a / b);
  if (fmt === 'mp4') {
    const bitrate = Math.min(150e6, W * H * Math.pow(fps, 0.75) * 2.2 * (0.04 + (set.q / 100) * 0.22));
    return E.encodeMp4(W, H, fps, src.total, (g, t, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); src.render(g, t, w, h); }, prog, bitrate, null);
  }
  const list = Array.from({ length: n }, (_, i) => ({ t: i * 1000 / fps, s: i * 1000 / fps, dur: 1000 / fps }));
  const draw = (g, t, w, h) => { g.clearRect(0, 0, w, h); src.render(g, t, w, h); };
  return fmt === 'gif' ? E.encodeGif(W, H, list, draw, prog, 256) : E.encodeWebp(W, H, list, draw, prog, set.q);
}
// frames = 같은 크기의 캔버스들. o.fps = 장면 빠르기
export function encodeFrames(frames, fmt, o, onProg) {
  const f0 = frames[0], at = t => frames[Math.min(frames.length - 1, Math.max(0, Math.round(t * o.fps)))];
  return encodeRender({ W: f0.width, H: f0.height, fps: o.fps, total: frames.length / o.fps, render: (g, t, w, h) => { g.imageSmoothingQuality = 'high'; g.drawImage(at(t), 0, 0, w, h); } }, fmt, o, onProg);
}
