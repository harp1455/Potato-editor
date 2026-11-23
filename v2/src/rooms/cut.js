// 컷 작업실 (첫 판): 페이지에 컷을 나누고 그림을 담고, 말풍선과 글자를 얹어요.
// 요소 = 컷(panel) · 말풍선(bubble) · 글자(text). 모두 페이지 좌표의 x, y, w, h를 가져요.
import { logErr } from '../core/errlog.js';
import { h, icon, clamp, drag } from '../ui/dom.js';
import { state, commit, emit, tick, uid, ensureBitmap, addMedia, ensureFolder } from '../core/store.js';
import { picked } from '../ui/bin.js';
import { settings } from '../core/settings.js';
import { addCmd, run } from '../core/cmd.js';
import { saveFiles, download } from '../core/files.js';
import { generate } from '../api/gemini.js';
import { dialog, toast, busy, showMenu, askText } from '../ui/overlay.js';
import { SHAPES, LINES, TAILS, PRESETS, drawBubbles, inBubble, insetOf } from '../core/bubble.js';
import { TEXT_STYLES, SFX_PRESETS, LOOK_KEYS, drawLettering } from '../core/lettering.js';
import { FX, FX_KEYS, MOODS, hasFx, imageFilter, drawPanelFx } from '../core/panelfx.js';

const SIZES = [[800, 4000, '웹툰 세로 스크롤 (800 × 4000)'], [800, 1280, '웹툰 한 화면 (800 × 1280)'], [1000, 1414, '만화 페이지 (1000 × 1414)'], [1080, 1350, '인스타툰 세로 (1080 × 1350)'], [1080, 1920, '세로 (1080 × 1920)'], [1600, 2260, '만화 원고 (1600 × 2260)'], [1920, 1080, '가로 (1920 × 1080)'], [1080, 1080, '정사각형 (1080 × 1080)']];
const LAYOUTS = [['1', '한 컷', [[0, 0, 1, 1]]], ['2', '위아래 2컷', [[0, 0, 1, .5], [0, .5, 1, .5]]], ['3', '위아래 3컷', [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]], ['4', '4컷 (2 × 2)', [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]], ['t', '위 큰 컷 + 아래 2컷', [[0, 0, 1, .6], [0, .6, .5, .4], [.5, .6, .5, .4]]]];
const FONTS = [['', '기본 (고딕)'], ['"Pretendard", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', '또렷한 고딕'], ['"NanumSquareRound", "나눔스퀘어라운드", "Nanum Gothic", "Malgun Gothic", sans-serif', '둥근 고딕'], ['"Batang", "Nanum Myeongjo", "Noto Serif KR", serif', '명조'], ['"Gungsuh", serif', '궁서'], ['"Nanum Pen Script", "나눔손글씨 펜", "Comic Sans MS", cursive', '손글씨 (펜)'], ['"Nanum Brush Script", "나눔손글씨 붓", "Gungsuh", cursive', '손글씨 (붓)']];
// 글꼴 파일(TTF·OTF·WOFF): 작업에 같이 저장하고, 작업을 열 때마다 다시 올려요. 다른 컴퓨터에서 열어도 같은 글꼴로 보여요
const fontsLoaded = new Set();
async function loadProjectFonts() {
  for (const f of state.project.fonts || []) { if (fontsLoaded.has(f.id)) continue; fontsLoaded.add(f.id); try { const { idb } = await import('../core/store.js'), b = await idb.get('blobs', 'font:' + f.id); if (!b) continue; const ff = new FontFace(f.name, await b.arrayBuffer()); await ff.load(); document.fonts.add(ff); emit(); } catch (_) { /* 못 읽는 글꼴은 기본 글꼴로 보여요 */ } }
}
function addFontFile(then) {
  const i = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2' }); i.onchange = async () => { const f = i.files[0]; if (!f) return;
    try { const name = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/["\\]/g, '').slice(0, 40) || '내 글꼴', ff = new FontFace(name, await f.arrayBuffer()); await ff.load(); document.fonts.add(ff); const { idb } = await import('../core/store.js'), id = uid('f'); await idb.put('blobs', 'font:' + id, f); fontsLoaded.add(id); (state.project.fonts || (state.project.fonts = [])).push({ id, name }); then(`"${name}"`); toast(`'${name}' 글꼴을 이 작업에 넣었어요.`); }
    catch (_) { toast('글꼴 파일을 읽지 못했어요. TTF, OTF, WOFF 파일을 넣어 주세요.', 'err'); } }; i.click();
}
// 내 컴퓨터 글꼴: 브라우저가 허락하면 깔려 있는 글꼴 이름을 받아 와서 목록에 더해요 (이름만 기억해요)
const localFonts = () => settings.get('localFonts') || [];
async function loadLocalFonts() {
  if (!window.queryLocalFonts) { toast('이 환경에서는 컴퓨터 글꼴 목록을 볼 수 없어요. 설치판이나 크롬·엣지에서 써 주세요.', 'err'); return; }
  try { const fs = await window.queryLocalFonts(), names = [...new Set(fs.map(f => f.family))].sort((a, b) => a.localeCompare(b, 'ko')); settings.set('localFonts', names.slice(0, 600)); emit(); toast(names.length ? `컴퓨터 글꼴 ${names.length}개를 글꼴 목록에 더했어요.` : '글꼴을 찾지 못했어요. 글꼴 접근을 허용해 주세요.'); }
  catch (_) { toast('글꼴 목록을 받지 못했어요. 글꼴 접근을 허용해 주세요.', 'err'); }
}
const TOOLS = [['pick', '고르기', 'V', 'move', '요소를 눌러 고르고 끌어 옮겨요. Shift를 누르고 누르면 여러 개를 함께 골라요. 모서리 점으로 크기를 바꿔요. 컷 안의 그림은 Alt를 누르고 끌면 옮겨지고 휠로 커져요.'], ['panel', '컷 만들기', 'C', 'cut', '끌어서 컷을 만들어요. 보관함 그림을 컷 위로 끌면 그 컷에 담겨요.'], ['bubble', '말풍선', 'B', 'bubble', '끌어서 말풍선을 만들어요. 꼬리 끝의 점을 끌어 말하는 사람 쪽으로 돌려요.'], ['slice', '선으로 자르기', 'K', 'shape', '컷 위에 선을 그으면 그 선을 따라 컷이 둘로 나뉘어요. 비스듬히 그어도 돼요. 고른 컷이 있으면 그 컷만, 없으면 선이 지나간 컷을 모두 잘라요. 컷 사이 간격은 오른쪽에서 정해요.'], ['pen', '펜', 'P', 'brush', '페이지 위에 손으로 그려요. 이어서 그으면 한 그림으로 모이고, 다른 도구로 바꾸면 끝나요. 색과 굵기는 오른쪽에서 바꿔요.'], ['cover', '가리기', 'X', 'cover', '끌어서 그 자리를 가려요. 흰칠·모자이크·흐리게와 네모·타원은 오른쪽에서 골라요. 가린 것은 요소라서 옮기거나 지울 수 있어요.'], ['text', '글자', 'T', 'text', '누른 자리에 글자를 놓아요. 오른쪽에서 내용과 모양을 바꿔요.'], ['lines', '집중선', 'L', 'lines', '끌어서 집중선을 넣어요. 가운데가 비고 가장자리에서 선이 모여들어요. 컷 위에 겹쳐 쓰면 돼요.']];
const V = { tool: 'pick', zoom: 1, ox: 0, oy: 0, fitted: null, sel: null, draft: null };
let cv = null, ctx = null, wrap = null;

const pages = () => state.project.pages || (state.project.pages = []);
export const pageOf = () => pages().find(p => p.id === state.project.activePage) || pages()[0] || null;
// 모양 묶음: 말풍선·글자의 생김새를 이름 붙여 두고 다른 요소에 입혀요 (작업이 달라도 같이 써요)
const LOOK = ['line', 'bw', 'bc', 'fill', 'fill2', 'fop', 'soft', 'sh', 'dbl'];   // 이어 붙인 말풍선끼리 같이 쓰는 생김새
const STYLE_KEYS = { bubble: ['shape', 'size', 'color', 'bold', 'vert', 'font', 'sw', 'sc', 'tailKind', 'tailW', 'tailBend', 'wob', ...LOOK], text: [...LOOK_KEYS, 'rot'] };
const styles = () => settings.get('cutStyles') || [];
// 페이지 한눈에 보기: 모든 페이지를 작게 늘어놓고, 눌러서 가거나 순서를 바꿔요
function overview() {
  const grid = h('div.cut-over');
  const d = dialog({ title: '페이지 한눈에 보기', wide: true, body: grid, buttons: [{ label: '닫기', primary: true }] });
  const paint = () => grid.replaceChildren(...pages().map((p, i) => { const t = h('canvas'); t.width = 220; t.height = Math.max(40, Math.round(220 * p.h / p.w)); const g = t.getContext('2d'); g.scale(220 / p.w, 220 / p.w); renderPage(g, p);
    const mv = k => { pages().splice(i, 1); pages().splice(i + k, 0, p); commit('페이지 옮기기'); paint(); };
    return h('div.cut-over-item' + (p.id === (pageOf() || {}).id ? '.on' : ''), null, h('button.cut-over-pic', { title: `${p.name}로 가기`, onclick: () => { state.project.activePage = p.id; V.sel = null; emit(); d.close(); } }, t),
      h('div.btn-row', null, h('span.grow', null, `${i + 1}. ${p.name}`), h('button.icon-btn', { title: '앞으로 옮기기', 'aria-label': `${p.name} 앞으로 옮기기`, disabled: i === 0, onclick: () => mv(-1) }, icon('up')), h('button.icon-btn', { title: '뒤로 옮기기', 'aria-label': `${p.name} 뒤로 옮기기`, disabled: i === pages().length - 1, onclick: () => mv(1) }, icon('down')))); }));
  paint();
}
let clip = [];   // 복사해 둔 요소들
const elOf = () => { const p = pageOf(); return p ? p.els.find(e => e.id === V.sel) || null : null; };
// 함께 고른 요소들: Shift를 누르고 누르면 더해져요. 맨 마지막에 누른 것이 설정을 보여 주는 요소예요.
const extra = () => (V.more && V.more.anchor === V.sel ? V.more.ids : null);
const group = () => { const p = pageOf(), x = extra(); if (!p) return []; const base = p.els.filter(e => e.id === V.sel || (x && x.has(e.id))), gids = new Set(base.map(e => e.gid).filter(Boolean)); return gids.size ? p.els.filter(e => base.includes(e) || gids.has(e.gid)) : base; };
// 자석: 옮길 때 다른 요소와 페이지의 가장자리·가운데에 가까우면 달라붙어요 (Alt를 누르면 안 붙어요)
function snapEl(pg, t, x, y) {
  V.guides = null; if (settings.get('cutSnap') === false) return { x, y };
  const lim = 8 / V.zoom, xs = [0, pg.w / 2, pg.w], ys = [0, pg.h / 2, pg.h]; for (const o of pg.els) if (o !== t) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
  const near = (pos, size, marks) => { let best = null, at = null; for (const m of marks) for (const off of [0, size / 2, size]) { const d = m - (pos + off); if (Math.abs(d) <= lim && (best === null || Math.abs(d) < Math.abs(best))) { best = d; at = m; } } return [best === null ? pos : pos + best, at]; };
  const [nx, gx] = near(x, t.w, xs), [ny, gy] = near(y, t.h, ys); V.guides = { x: gx, y: gy };   // 붙은 자리에 분홍 안내선을 그어요
  return { x: Math.round(nx), y: Math.round(ny) };
}
// 돌린 요소 다루기: 페이지의 점을 요소의 '돌리기 전' 자리로, 또 그 반대로
const rotPt = (p, cx, cy, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), dx = p.x - cx, dy = p.y - cy; return { x: cx + dx * c - dy * sn, y: cy + dx * sn + dy * c }; };
const toLocal = (e, p) => (e.rot ? rotPt(p, e.x + e.w / 2, e.y + e.h / 2, -e.rot) : p);
// 손잡이 여덟 개(모서리·변)와 돌리기 손잡이. [돌리기 전 자리 x, y, 잡은 쪽 fx(0 왼·0.5 가운데·1 오른), fy]
const handlesOf = e => [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]].filter(([fx, fy]) => e.type !== 'text' || (fx !== 0.5 && fy !== 0.5)).map(([fx, fy]) => [e.x + e.w * fx, e.y + e.h * fy, fx, fy]);
const knobOf = e => ({ x: e.x + e.w / 2, y: e.y - 24 / V.zoom });
function newPage(w, hh, layout) {
  const pg = { id: uid('g'), name: `${pages().length + 1}쪽`, w, h: hh, bg: '#ffffff', els: [] }, m = Math.round(Math.min(w, hh) * 0.04), gap = Math.round(m * 0.6);
  for (const [fx, fy, fw, fh] of (LAYOUTS.find(l => l[0] === layout) || LAYOUTS[0])[2]) {
    const x = m + fx * (w - 2 * m), y = m + fy * (hh - 2 * m), ww = fw * (w - 2 * m), hhh = fh * (hh - 2 * m);
    pg.els.push({ id: uid('e'), type: 'panel', x: Math.round(x + (fx ? gap / 2 : 0)), y: Math.round(y + (fy ? gap / 2 : 0)), w: Math.round(ww - (fx ? gap / 2 : 0) - (fx + fw < 1 ? gap / 2 : 0)), h: Math.round(hhh - (fy ? gap / 2 : 0) - (fy + fh < 1 ? gap / 2 : 0)), mediaId: null, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' });
  }
  pages().push(pg); state.project.activePage = pg.id; V.sel = null; return pg;
}

// ---- 그리기 ----
const fontOf = e => `${e.bold ? '700 ' : ''}${e.size || 32}px ${e.font || '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'}`;
// 줄 나누기: widthAt(몇 번째 줄) = 그 줄에 들어갈 수 있는 너비. 없으면 줄을 바꾸지 않아요
function wrapText(g, e, widthAt) {
  g.font = fontOf(e); const out = [];
  for (const raw of String(e.text || '').split('\n')) {
    if (!widthAt) { out.push(raw); continue; }
    // 영어처럼 띄어 쓰는 말은 낱말 단위로, 한글·한자·가나는 글자 단위로 줄을 바꿔요
    let line = '';
    for (const tok of raw.match(/[A-Za-z0-9À-ɏЀ-ӿ'’.,!?;:()\-]+\s*|\s+|./gu) || []) {
      if (line && g.measureText((line + tok).trimEnd()).width > widthAt(out.length)) { out.push(line.trimEnd()); line = tok.trim() ? tok : ''; } else line += tok;
    }
    out.push(line.trimEnd());
  }
  return out;
}
// box: 숫자면 그 너비로, { w, h, p }면 둥근 말풍선 안쪽처럼 위아래 줄일수록 좁게 나눠요
function linesOf(g, e, box) {
  if (!box) return wrapText(g, e, null);
  if (typeof box === 'number') return wrapText(g, e, () => box);
  if (!box.p) return wrapText(g, e, () => box.w);
  const lh = (e.size || 32) * 1.3; let ls = [];
  for (let n = 1; n <= 40; n++) {
    const half = Math.max(box.h / 2, n * lh * 0.62);
    ls = wrapText(g, e, i => { const y = Math.min(0.97, (Math.abs(i - (n - 1) / 2) * lh + lh * 0.3) / half); return box.w * Math.pow(1 - Math.pow(y, box.p), 1 / box.p); });
    if (ls.length <= n) break;
  }
  return ls;
}
function drawText(g, e, cx, cy, maxW) {
  if (e.vert) {   // 세로쓰기: 줄은 오른쪽에서 왼쪽으로, 글자는 위에서 아래로
    const size = e.size || 32, cols = String(e.text || '').split('\n').map(t => [...t]), cw = size * 1.25, ch = size * 1.08, rows = Math.max(1, ...cols.map(c => c.length)), x0 = cx + (cols.length - 1) * cw / 2, y0 = cy - (rows - 1) * ch / 2;
    g.font = fontOf(e); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    cols.forEach((col, ci) => col.forEach((chr, ri) => { const x = x0 - ci * cw, y = y0 + ri * ch, rot = /[ー―—~〜…\-（）()「」『』]/.test(chr); g.save(); g.translate(x, y); if (rot) g.rotate(Math.PI / 2); if (e.sw) { g.strokeStyle = e.sc || '#ffffff'; g.lineWidth = e.sw * 2; g.strokeText(chr, 0, 0); } g.fillStyle = e.color || '#111111'; g.fillText(chr, 0, 0); g.restore(); }));
    return { w: cols.length * cw, h: rows * ch };
  }
  const ls = linesOf(g, e, maxW), lh = (e.size || 32) * 1.3, y0 = cy - (ls.length - 1) * lh / 2;
  g.font = fontOf(e); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  ls.forEach((t, i) => { if (e.sw) { g.strokeStyle = e.sc || '#ffffff'; g.lineWidth = e.sw * 2; g.strokeText(t, cx, y0 + i * lh); } g.fillStyle = e.color || '#111111'; g.fillText(t, cx, y0 + i * lh); });
  return { w: Math.max(1, ...ls.map(t => g.measureText(t).width)), h: ls.length * lh };
}
function bubbleText(g, e) {
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2, [fw, fh, p] = insetOf(e);
  g.save(); if (e.rot) { g.translate(cx, cy); g.rotate(e.rot * Math.PI / 180); g.translate(-cx, -cy); }
  drawText(g, e, cx, cy, { w: e.w * fw, h: e.h * fh, p }); g.restore();
}
function drawEl(g, e) {
  if (e.rot) { g.save(); g.translate(e.x + e.w / 2, e.y + e.h / 2); g.rotate(e.rot * Math.PI / 180); g.translate(-(e.x + e.w / 2), -(e.y + e.h / 2)); drawEl0(g, e); g.restore(); } else drawEl0(g, e);
}
// 스티커에 색을 입히거나 테두리를 두른 그림 (같은 설정이면 다시 만들지 않아요)
const stickerCache = new Map();
function stickerPic(e, b) {
  if (!e.tint && !e.ol) return { c: b, pad: 0 };
  const key = [e.mediaId, e.tint || '', e.ol || 0, e.olc || ''].join('|'); let r = stickerCache.get(key); if (r) return r;
  const k = Math.min(1, 1024 / Math.max(b.width, b.height)), w = Math.max(1, Math.round(b.width * k)), hh = Math.max(1, Math.round(b.height * k)), pad = e.ol ? 0.06 : 0, px = Math.round(w * pad), py = Math.round(hh * pad);
  const body = document.createElement('canvas'); body.width = w; body.height = hh; const bg = body.getContext('2d'); bg.drawImage(b, 0, 0, w, hh);
  if (e.tint) { bg.globalCompositeOperation = 'source-in'; bg.fillStyle = e.tint; bg.fillRect(0, 0, w, hh); }
  const c = document.createElement('canvas'); c.width = w + px * 2; c.height = hh + py * 2; const g = c.getContext('2d');
  if (e.ol) { const sil = document.createElement('canvas'); sil.width = w; sil.height = hh; const sg = sil.getContext('2d'); sg.drawImage(b, 0, 0, w, hh); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = e.olc || '#ffffff'; sg.fillRect(0, 0, w, hh); const rr = Math.max(1, Math.max(w, hh) * 0.06 * Math.min(1, e.ol / 10)); for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; g.drawImage(sil, px + Math.cos(a) * rr, py + Math.sin(a) * rr); } }
  g.drawImage(body, px, py); r = { c, pad }; if (stickerCache.size > 60) stickerCache.clear(); stickerCache.set(key, r); return r;
}
function drawEl0(g, e) {
  if (e.type === 'panel') {
    const rad = Math.min(e.br || 0, e.w / 2, e.h / 2), shape = () => { g.beginPath(); if (e.poly) { e.poly.forEach(([fx, fy], i) => g[i ? 'lineTo' : 'moveTo'](e.x + fx * e.w, e.y + fy * e.h)); g.closePath(); } else if (rad > 0) g.roundRect(e.x, e.y, e.w, e.h, rad); else g.rect(e.x, e.y, e.w, e.h); };   // poly: 선으로 자른 컷의 모양 (상자 안의 비율 좌표)
    g.save(); shape(); g.clip();
    const b = e.mediaId && state.bitmaps.get(e.mediaId);
    g.fillStyle = e.bgc || (b ? '#ffffff' : '#e9e9e9'); g.fillRect(e.x, e.y, e.w, e.h);
    if (e.mediaId && !b) ensureBitmap(e.mediaId);
    if (b) { const k = Math.max(e.w / b.width, e.h / b.height) * (e.is || 1), dw = b.width * k, dh = b.height * k; g.save(); if (hasFx(e)) { const t = g.getTransform(), f = imageFilter(e, Math.hypot(t.a, t.b) || 1); if (f !== 'none') g.filter = f; } g.imageSmoothingQuality = 'high'; g.globalAlpha *= e.io ?? 1; g.translate(e.x + e.w / 2 + (e.ix || 0), e.y + e.h / 2 + (e.iy || 0)); if (e.ir) g.rotate(e.ir * Math.PI / 180); if (e.ifx) g.scale(-1, 1); g.drawImage(b, -dw / 2, -dh / 2, dw, dh); g.restore(); }
    if (hasFx(e)) drawPanelFx(g, e);   // 분위기·스크린톤·효과선은 컷 모양 안쪽에만
    g.restore();
    if (e.bw) { g.lineWidth = e.bw; g.strokeStyle = e.bc || '#111'; g.lineJoin = 'miter'; shape(); g.stroke(); }
  } else if (e.type === 'pic') {   // 스티커: 효과음 그림처럼 컷 밖에 자유롭게 놓는 그림. 색 입히기·테두리·뒤집기
    const b = e.mediaId && state.bitmaps.get(e.mediaId); if (e.mediaId && !b) ensureBitmap(e.mediaId);
    if (b) { const src = stickerPic(e, b); g.save(); g.globalAlpha *= e.op ?? 1; g.imageSmoothingQuality = 'high'; if (e.fx) { g.translate(e.x * 2 + e.w, 0); g.scale(-1, 1); } const o = src.pad || 0; g.drawImage(src.c, e.x - e.w * o, e.y - e.h * o, e.w * (1 + 2 * o), e.h * (1 + 2 * o)); g.restore(); }
  } else if (e.type === 'draw') { drawStrokes(g, e);
  } else if (e.type === 'lines') {
    // 집중선: 네모 가장자리에서 가운데 타원을 향해 쐐기 모양 선이 모여요. 같은 씨앗이면 늘 같은 모양
    let sd = (e.seed || 1) >>> 0; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2, n = Math.max(8, e.count || 90), far = Math.hypot(e.w, e.h), hole = (e.hole ?? 45) / 100;
    g.save(); g.beginPath(); g.rect(e.x, e.y, e.w, e.h); g.clip(); g.fillStyle = e.color || '#111111'; g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i + rnd() * 0.8) / n * Math.PI * 2, wd = (0.25 + rnd() * 0.75) * Math.PI / n * (e.thick ?? 1), k = hole * (0.85 + rnd() * 0.45);
      g.moveTo(cx + Math.cos(a) * e.w / 2 * k, cy + Math.sin(a) * e.h / 2 * k); g.lineTo(cx + Math.cos(a - wd) * far, cy + Math.sin(a - wd) * far); g.lineTo(cx + Math.cos(a + wd) * far, cy + Math.sin(a + wd) * far); g.closePath();
    }
    g.fill(); g.restore();
  } else if (e.type === 'text') {
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2, m = drawLettering(g, e, cx, cy); if (Math.abs(m.w - e.w) > 0.01 || Math.abs(m.h - e.h) > 0.01) { e.w = m.w; e.h = m.h; e.x = cx - m.w / 2; e.y = cy - m.h / 2; }
  }
}
// 이어 붙인 말풍선(join이 같은 것)은 맨 아래 것의 차례에 한 덩어리로 그려요
const joined = (pg, e) => (e.join ? pg.els.filter(o => o.type === 'bubble' && o.join === e.join) : [e]);
// 손그림(펜): 획들을 부드럽게 이어 그려요. 획의 좌표는 만들 때의 크기(bw0 × bh0) 기준이라 늘리면 같이 늘어나요
function drawStrokes(g, e) {
  const kx = e.w / (e.bw0 || e.w || 1), ky = e.h / (e.bh0 || e.h || 1), k = (kx + ky) / 2, pass = (w, col) => { g.strokeStyle = g.fillStyle = col; g.lineWidth = w; for (const st of e.strokes || []) { if (st.length === 1) { g.beginPath(); g.arc(e.x + st[0][0] * kx, e.y + st[0][1] * ky, w / 2, 0, Math.PI * 2); g.fill(); continue; } g.beginPath(); g.moveTo(e.x + st[0][0] * kx, e.y + st[0][1] * ky); for (let i = 1; i < st.length - 1; i++) g.quadraticCurveTo(e.x + st[i][0] * kx, e.y + st[i][1] * ky, e.x + (st[i][0] + st[i + 1][0]) / 2 * kx, e.y + (st[i][1] + st[i + 1][1]) / 2 * ky); const l = st.at(-1); g.lineTo(e.x + l[0] * kx, e.y + l[1] * ky); g.stroke(); } };
  g.save(); g.globalAlpha *= e.op ?? 1; g.lineCap = g.lineJoin = 'round'; const w = (e.size || 6) * k; if (e.ol) pass(w + e.ol * 2 * k, e.olc || '#ffffff'); pass(w, e.color || '#111111'); g.restore();
}
// 가리기 요소: 흰칠은 색으로 덮고, 모자이크·흐리게는 지금까지 그려진 그림의 그 자리를 읽어서 뭉개요 (화면에서도 내보낼 때도 같은 식)
function drawCover(g, e) {
  const path = () => { g.beginPath(); if (e.shape === 'ellipse') g.ellipse(e.x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2); else g.rect(e.x, e.y, e.w, e.h); };
  if ((e.kind || 'white') === 'white') { g.save(); g.fillStyle = e.color || '#ffffff'; path(); g.fill(); g.restore(); return; }
  const t = g.getTransform(), k = Math.hypot(t.a, t.b) || 1, dx = Math.floor(t.a * e.x + t.e), dy = Math.floor(t.d * e.y + t.f), dw = Math.ceil(e.w * t.a), dh = Math.ceil(e.h * t.d); if (dw < 2 || dh < 2 || !g.canvas) return;
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(g.canvas.width, dx + dw), y1 = Math.min(g.canvas.height, dy + dh); if (x1 - x0 < 2 || y1 - y0 < 2) return;
  const cw = x1 - x0, chh = y1 - y0, str = Math.max(2, (e.str ?? 18) * k), copy = document.createElement('canvas'); copy.width = cw; copy.height = chh; copy.getContext('2d').drawImage(g.canvas, x0, y0, cw, chh, 0, 0, cw, chh);
  g.save(); path(); g.clip(); g.setTransform(1, 0, 0, 1, 0, 0);
  if (e.kind === 'mosaic') { const sw = Math.max(1, Math.round(cw / str)), sh = Math.max(1, Math.round(chh / str)), sm = document.createElement('canvas'); sm.width = sw; sm.height = sh; const sg = sm.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(copy, 0, 0, sw, sh); g.imageSmoothingEnabled = false; g.drawImage(sm, 0, 0, sw, sh, x0, y0, cw, chh); g.imageSmoothingEnabled = true; }
  else { g.filter = `blur(${(str * 0.6).toFixed(1)}px)`; g.drawImage(copy, x0, y0); g.drawImage(copy, x0, y0); g.filter = 'none'; }
  g.restore();
}
export function renderPage(g, pg) {
  g.fillStyle = pg.bg || '#fff'; g.fillRect(0, 0, pg.w, pg.h); const done = new Set();
  for (const e of pg.els) {
    if (e.hide) continue;
    if (e.type === 'cover') { drawCover(g, e); continue; }
    if (e.type !== 'bubble') { drawEl(g, e); continue; }
    if (done.has(e.id)) continue;
    const grp = joined(pg, e).filter(o => !o.hide); grp.forEach(o => done.add(o.id)); drawBubbles(g, grp); grp.forEach(o => bubbleText(g, o));
  }
}
async function pageCanvas(pg, k = 1) {
  await Promise.all(pg.els.filter(e => e.mediaId).map(e => ensureBitmap(e.mediaId)));
  const c = document.createElement('canvas'); c.width = Math.round(pg.w * k); c.height = Math.round(pg.h * k); const g = c.getContext('2d'); g.scale(k, k); renderPage(g, pg); return c;
}
function fit() { const pg = pageOf(); if (!pg || !wrap) return; const W = wrap.clientWidth, H = wrap.clientHeight; V.zoom = clamp(Math.min((W - 48) / pg.w, (H - 48) / pg.h), 0.02, 16); V.ox = (W - pg.w * V.zoom) / 2; V.oy = (H - pg.h * V.zoom) / 2; V.fitted = pg.id; draw(); }
function draw() {
  if (!cv) return; const pg = pageOf(), dpr = devicePixelRatio || 1, W = wrap.clientWidth, H = wrap.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); if (!pg) return;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(V.ox + 2, V.oy + 3, pg.w * V.zoom, pg.h * V.zoom);
  ctx.save(); ctx.translate(V.ox, V.oy); ctx.scale(V.zoom, V.zoom); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pg.w, pg.h); ctx.clip(); renderPage(ctx, pg); ctx.restore();
  const e = elOf(), px = 1 / V.zoom;
  for (const o of group()) if (o !== e) { ctx.lineWidth = px; ctx.strokeStyle = '#4b9fe8'; ctx.strokeRect(o.x, o.y, o.w, o.h); }
  for (const o of [e].filter(Boolean)) {
    ctx.save(); if (o.rot) { ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.rotate(o.rot * Math.PI / 180); ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2)); }
    ctx.lineWidth = px; ctx.strokeStyle = V.pan === o.id ? '#d3a94e' : '#4b9fe8'; ctx.strokeRect(o.x, o.y, o.w, o.h); ctx.fillStyle = '#fff'; const r = 3.5 * px;
    if (V.pan !== o.id) { for (const [x, y] of handlesOf(o)) { ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.strokeRect(x - r, y - r, r * 2, r * 2); }
      const kn = knobOf(o); ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, o.y); ctx.lineTo(kn.x, kn.y); ctx.stroke(); ctx.beginPath(); ctx.arc(kn.x, kn.y, 4.5 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    if (o.type === 'bubble' && o.tail) { ctx.beginPath(); ctx.arc(o.tx, o.ty, 4.5 * px, 0, Math.PI * 2); ctx.fillStyle = '#d3a94e'; ctx.fill(); ctx.stroke(); }
  }
  if (V.guides) { ctx.lineWidth = px; ctx.strokeStyle = '#ff4fa3'; ctx.beginPath(); if (V.guides.x != null) { ctx.moveTo(V.guides.x, -1e5); ctx.lineTo(V.guides.x, 1e5); } if (V.guides.y != null) { ctx.moveTo(-1e5, V.guides.y); ctx.lineTo(1e5, V.guides.y); } ctx.stroke(); }
  const d = V.draft; if (d) { ctx.lineWidth = px; ctx.strokeStyle = '#eaf4ff'; ctx.setLineDash([4 * px, 3 * px]); ctx.strokeRect(d.x, d.y, d.w, d.h); }
  if (V.penLine && V.penLine.pts.length) { const L = V.penLine; ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = L.color; ctx.lineWidth = L.size; ctx.setLineDash([]); ctx.beginPath(); L.pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y)); ctx.stroke(); ctx.restore(); }
  if (V.cutLine) { const c = V.cutLine; ctx.lineWidth = 2 * px; ctx.strokeStyle = '#ff4fa3'; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(c.a.x, c.a.y); ctx.lineTo(c.b.x, c.b.y); ctx.stroke(); }
  ctx.restore();
}
const toPage = (sx, sy) => ({ x: (sx - V.ox) / V.zoom, y: (sy - V.oy) / V.zoom });
const hit = (pg, p0) => { for (let i = pg.els.length - 1; i >= 0; i--) { const e = pg.els[i], p = toLocal(e, p0); if (e.hide || e.lock) continue; if ((p.x >= e.x && p.y >= e.y && p.x <= e.x + e.w && p.y <= e.y + e.h) || (e.type === 'bubble' && e.tail && inBubble(e, p0.x, p0.y))) return e; } return null; };

// ---- 번역: 페이지의 대사를 모아 제미나이에 보내고, 같은 차례로 받아 넣어요 ----
const LANGS = [['polish', '번역하지 않고 다듬기만'], ['Korean', '한국어'], ['English', '영어'], ['Japanese', '일본어'], ['Simplified Chinese', '중국어 (간체)'], ['Traditional Chinese', '중국어 (번체)'], ['Spanish', '스페인어']];
export async function translateTexts(texts, lang, tone) {
  const r = await generate('translate', settings.get('textModel'), {
    systemInstruction: { parts: [{ text: lang === 'polish' ? `You polish comic dialogue without translating it: keep each line in its original language and meaning, and make it read naturally as spoken dialogue (fix awkward wording, spacing and punctuation). The input is a JSON array of lines in reading order. Return ONLY a JSON array of strings with exactly the same number of items in the same order. Keep line breaks (\\n) where they help the line fit a speech bubble.${tone ? ' Tone: ' + tone : ''}` : `You translate comic dialogue into ${lang}. The input is a JSON array of lines in reading order. Return ONLY a JSON array of strings with exactly the same number of items in the same order. Keep line breaks (\\n) where they help the line fit a speech bubble. Keep names, sound effects and tone natural for ${lang} comics.${tone ? ' Tone: ' + tone : ''}` }] },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(texts) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } });
  let out; try { out = JSON.parse(r.text.replace(/^```(?:json)?|```$/g, '').trim()); } catch (_) { throw new Error('제미나이의 답을 읽지 못했어요. 다시 해 주세요.'); }
  if (!Array.isArray(out) || out.length !== texts.length) throw new Error(`대사 ${texts.length}줄을 보냈는데 ${Array.isArray(out) ? out.length : 0}줄이 돌아왔어요. 다시 해 주세요.`);
  return out.map(String);
}
function translateDialog() {
  const T = { lang: 'Korean', all: false, tone: '', ...(settings.get('tr') || {}) }, pg = pageOf(); if (!pg) return;
  const count = all => (all ? pages() : [pg]).reduce((n, p) => n + p.els.filter(e => e.type !== 'panel' && String(e.text || '').trim()).length, 0);
  const box = h('div.vid-form'), drawBox = () => box.replaceChildren(
    h('p.dlg-text', null, '말풍선과 글자의 대사를 제미나이로 번역해 그 자리에 바꿔 넣어요. 되돌리기로 원래 대사로 돌아갈 수 있어요.'),
    h('label.field', null, h('span.field-name.w', null, '어느 말로'), h('select.text', { 'aria-label': '번역할 말', onchange: e => { T.lang = e.target.value; } }, LANGS.map(([v, t]) => h('option', { value: v, selected: T.lang === v }, t)))),
    h('label.field', null, h('span.field-name.w', null, '말투'), h('input.text', { type: 'text', value: T.tone, placeholder: '비워 두면 원문 그대로. 예: 반말, 거친 말투', 'aria-label': '말투', onchange: e => { T.tone = e.target.value.trim(); } })),
    h('label.check', null, h('input', { type: 'checkbox', checked: T.all, onchange: e => { T.all = e.target.checked; drawBox(); } }), `모든 페이지 (${pages().length}쪽)`),
    h('label.check', null, h('input', { type: 'checkbox', checked: !!T.img, onchange: e => { T.img = e.target.checked; drawBox(); } }), '그림 속에 그려진 글자도 찾아서 번역 (그 자리를 덮고 번역을 올려요)'),
    h('p.set-note', null, `번역할 대사는 ${count(T.all)}줄이에요.`));
  drawBox();
  dialog({ title: '대사 번역', body: box, buttons: [{ label: '취소' }, { label: '번역하기', primary: true, run: () => { settings.set('tr', T); (async () => {
    const els = (T.all ? pages() : [pg]).flatMap(p => p.els.filter(e => e.type !== 'panel' && String(e.text || '').trim()));
    if (!els.length && !T.img) { toast('번역할 대사가 없어요.', 'err'); return; }
    const b = busy('번역하는 중이에요.'), langName = (LANGS.find(l => l[0] === T.lang) || [])[1] || T.lang;
    try {
      // 쪽마다 따로 보내요: 한 쪽이 거절되거나 실패해도 멈추지 않고 오류 기록에 남긴 뒤 다음 쪽으로 가요
      let found = 0, done = 0, fails = 0; const list = T.all ? pages() : [pg], miss = (p, e, what) => { fails++; logErr('대사 번역', `${p.name} ${what}: ${e.message || '실패'}`, (e.code || '') + (e.detail ? ' / ' + e.detail : '')); };
      if (T.img) for (let i = 0; i < list.length; i++) { b.set(`그림 속 글자를 찾는 중이에요. ${i + 1} / ${list.length}쪽`); try { found += (await translateImage(list[i], T.lang)).length; } catch (e) { miss(list[i], e, '그림 속 글자'); } }   // 먼저 그림(원래 대사가 보이는 상태)을 읽어요
      for (let i = 0; i < list.length; i++) { const le = list[i].els.filter(e => e.type !== 'panel' && String(e.text || '').trim() && els.includes(e)); if (!le.length) continue; b.set(`대사를 번역하는 중이에요. ${i + 1} / ${list.length}쪽`); try { const out = await translateTexts(le.map(e => e.text), T.lang, T.tone); le.forEach((e, k) => { e.text = out[k]; }); done += le.length; } catch (e) { miss(list[i], e, '대사'); } }
      if (done || found) commit(`${langName}로 번역`);
      b.done(`대사 ${done}줄을 번역했어요.` + (T.img ? ` 그림 속 글자는 ${found}곳을 찾아 덮었어요.` : '') + (fails ? ` ${fails}건은 하지 못해 오류 기록에 남겼어요 (도움말 > 오류 기록).` : ''), fails && !done && !found ? 'err' : '');
    } catch (e) { b.done(e.message || '번역하지 못했어요.', 'err'); }
  })(); } }] });
}

// 대사 초안: 페이지 그림과 장면 설명을 보여 주고, 지금 놓인 말풍선 수만큼 대사를 받아 채워요
export async function draftLines(pg, note) {
  const bubbles = pg.els.filter(e => e.type === 'bubble'); if (!bubbles.length) throw new Error('먼저 말풍선을 놓아 주세요. 놓인 말풍선 수만큼 대사를 써 줘요.');
  const c = await pageCanvas({ ...pg, els: pg.els.filter(e => e.type === 'panel') }), k = Math.min(1, 1400 / Math.max(c.width, c.height)), t = document.createElement('canvas'); t.width = Math.round(c.width * k); t.height = Math.round(c.height * k); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  const spots = bubbles.map((b, i) => `${i + 1}: bubble at x ${Math.round((b.x + b.w / 2) / pg.w * 100)}%, y ${Math.round((b.y + b.h / 2) / pg.h * 100)}% of the page${b.shape === 'cloud' ? ' (thought)' : b.shape === 'shout' ? ' (shout)' : ''}`).join('\n');
  const r = await generate('write', settings.get('textModel'), {
    systemInstruction: { parts: [{ text: 'You write dialogue for a comic page. Look at the page image and the scene note, then write one line for each speech bubble listed, in the same language as the scene note (Korean if there is no note). Keep each line short enough to fit a speech bubble. Return ONLY a JSON array of strings, one per bubble, in the listed order.' }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: t.toDataURL('image/jpeg', 0.9).split(',')[1] } }, { text: `Scene note: ${note || '(none)'}\nBubbles:\n${spots}` }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } });
  let out; try { out = JSON.parse(r.text.replace(/^```(?:json)?|```$/g, '').trim()); } catch (_) { throw new Error('제미나이의 답을 읽지 못했어요. 다시 해 주세요.'); }
  if (!Array.isArray(out)) throw new Error('제미나이의 답이 목록이 아니에요. 다시 해 주세요.');
  bubbles.forEach((b, i) => { if (typeof out[i] === 'string' && out[i].trim()) b.text = out[i].trim(); });
  return Math.min(bubbles.length, out.length);
}
function draftDialog() {
  const pg = pageOf(), ta = h('textarea.text.area', { rows: 4, 'aria-label': '장면 설명', placeholder: '예: 오랜만에 만난 두 사람. 한 명은 반가워하고 한 명은 어색해해요. 말투는 반말.', value: settings.get('draftNote') || '' });
  dialog({ title: '대사 초안', body: h('div.vid-form', null, h('p.dlg-text', null, `이 페이지에 놓인 말풍선 ${pg.els.filter(e => e.type === 'bubble').length}개에 들어갈 대사를 제미나이가 써 줘요. 지금 적힌 대사는 새 대사로 바뀌어요(되돌릴 수 있어요).`), ta),
    buttons: [{ label: '취소' }, { label: '대사 받기', primary: true, run: () => { settings.set('draftNote', ta.value); (async () => { const b = busy('제미나이가 대사를 쓰는 중이에요.'); try { const n = await draftLines(pg, ta.value.trim()); commit('대사 초안'); b.done(`말풍선 ${n}개에 대사를 채웠어요.`); } catch (e) { b.done(e.message || '대사를 받지 못했어요.', 'err'); } })(); } }] });
}
// 그림 속 글자 번역: 페이지 그림을 제미나이에 보여 주고, 글자가 있는 자리와 번역을 받아 그 위에 덮어요
export async function translateImage(pg, lang) {
  const c = await pageCanvas(pg), k = Math.min(1, 1600 / Math.max(c.width, c.height)), t = document.createElement('canvas'); t.width = Math.round(c.width * k); t.height = Math.round(c.height * k); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  const r = await generate('translate', settings.get('textModel'), {
    systemInstruction: { parts: [{ text: `Find every piece of text drawn inside this comic page image (speech bubbles, captions, sound effects, signs) and translate it into ${lang}. Return ONLY a JSON array. Each item: {"box":[ymin,xmin,ymax,xmax] with values 0-1000 relative to the image, "text": original text, "translation": the ${lang} translation, "vertical": true if the original is written vertically}. Group one bubble or caption as one item. Skip text that is already in ${lang}. If there is no text, return [].` }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: t.toDataURL('image/jpeg', 0.9).split(',')[1] } }, { text: 'Translate the text in this page.' }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } });
  let out; try { out = JSON.parse(r.text.replace(/^```(?:json)?|```$/g, '').trim()); } catch (_) { throw new Error('제미나이의 답을 읽지 못했어요. 다시 해 주세요.'); }
  if (!Array.isArray(out)) throw new Error('제미나이의 답이 목록이 아니에요. 다시 해 주세요.');
  const g = c.getContext('2d', { willReadFrequently: true }), hex = v => v.toString(16).padStart(2, '0'), made = [];
  for (const it of out) {
    const b = it && it.box; if (!Array.isArray(b) || b.length !== 4 || !String(it.translation || '').trim()) continue;
    const x = Math.round(b[1] / 1000 * pg.w), y = Math.round(b[0] / 1000 * pg.h), w = Math.max(24, Math.round((b[3] - b[1]) / 1000 * pg.w)), hh = Math.max(24, Math.round((b[2] - b[0]) / 1000 * pg.h));
    // 덮을 색: 상자 테두리 바로 안쪽의 가운데 색 (말풍선 안이면 흰색, 색 있는 칸이면 그 색)
    const px = [], at = (ax, ay) => { const d = g.getImageData(Math.min(pg.w - 1, Math.max(0, ax)), Math.min(pg.h - 1, Math.max(0, ay)), 1, 1).data; px.push([d[0], d[1], d[2]]); };
    for (let i = 0; i <= 8; i++) { at(x + w * i / 8, y + 2); at(x + w * i / 8, y + hh - 2); at(x + 2, y + hh * i / 8); at(x + w - 2, y + hh * i / 8); }
    const med = [0, 1, 2].map(ch => px.map(p => p[ch]).sort((a, b2) => a - b2)[px.length >> 1]), lum = med[0] * 0.3 + med[1] * 0.59 + med[2] * 0.11;
    const text = String(it.translation).trim(), lines = text.split('\n'), longest = Math.max(1, ...lines.map(l => [...l].length));
    const size = Math.max(10, Math.round(Math.min(hh / (lines.length * 1.35), w * 0.86 / (longest * 0.95), pg.w / 14)));
    const e = { id: uid('e'), type: 'bubble', x, y, w, h: hh, shape: 'box', wob: 0, line: 'clean', text, size, color: lum > 140 ? '#111111' : '#ffffff', fill: '#' + med.map(hex).join(''), bc: '#111111', bw: 0, tail: false, tx: x, ty: y + hh, bold: false, from: String(it.text || '') };
    pg.els.push(e); made.push(e);
  }
  return made;
}

// ---- 놓기·고르기·정렬 (8.x에서 한 번에 되던 것들) ----
const viewCenter = () => (wrap ? toPage(wrap.clientWidth / 2, wrap.clientHeight / 2) : { x: 0, y: 0 });
const contentBottom = pg => Math.max(0, ...pg.els.map(e => e.y + e.h));
const setSel = ids => { V.sel = ids.length ? ids.at(-1) : null; V.more = ids.length > 1 ? { anchor: V.sel, ids: new Set(ids.slice(0, -1)) } : null; };
const mediaOf = id => state.project.media.find(m => m.id === id);
// 그림으로 새 컷: 그림 비율 그대로, 페이지 폭에 넉넉히 들어가게
function newImagePanel(pg, id, at) {
  const m = mediaOf(id); if (!m) return null; const mg = Math.round(pg.w * 0.04), w = Math.min(pg.w - 2 * mg, Math.max(160, Math.round(pg.w * 0.7))), hh = Math.round(w * m.h / m.w), c = at || viewCenter();
  const n = { id: uid('e'), type: 'panel', x: Math.round(clamp(c.x - w / 2, 0, Math.max(0, pg.w - w))), y: Math.round(Math.max(0, c.y - hh / 2)), w, h: hh, mediaId: id, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' };
  pg.els.push(n); ensureBitmap(id); return n;
}
// 보관함 그림 놓기: 컷을 골라 뒀으면 그 컷에 담고, 아니면 화면 가운데에 새 컷으로
export function placeInCut(ids) {
  const pg = pageOf(); if (!pg) { toast('먼저 페이지를 만들어 주세요.'); return false; } const e = elOf(), list = [].concat(ids).filter(mediaOf); if (!list.length) return false;
  if (list.length === 1 && e && e.type === 'panel') { Object.assign(e, { mediaId: list[0], ix: 0, iy: 0, is: 1 }); ensureBitmap(list[0]); commit('컷에 그림 담기'); return true; }
  const c = viewCenter(), made = list.map((id, i) => newImagePanel(pg, id, { x: c.x + i * 24, y: c.y + i * 24 })).filter(Boolean); setSel(made.map(n => n.id)); commit('그림으로 컷 만들기'); return true;
}
// 스티커 놓기(효과음 등): 페이지 폭의 3분의 1쯤 되는 넓이로
export function placeSticker(id, at, look = {}) {
  const pg = pageOf(), m = mediaOf(id); if (!pg || !m) return false; const k = Math.sqrt(Math.pow(pg.w * 0.32, 2) / (m.w * m.h)), w = Math.round(m.w * k), hh = Math.round(m.h * k), c = at || viewCenter();
  const n = { id: uid('e'), type: 'pic', mediaId: id, x: Math.round(c.x - w / 2), y: Math.round(c.y - hh / 2), w, h: hh, ...look }; pg.els.push(n); ensureBitmap(id); V.sel = n.id; V.more = null; V.tool = 'pick'; commit('효과음 넣기'); return true;
}
// 컴퓨터의 그림 파일을 보관함에 넣고 곧바로 페이지에 놓아요 (끌어다 놓기·붙여넣기)
export async function placeFiles(files, at) {
  const pg = pageOf(), fs = [...files].filter(f => /^image\//.test(f.type)); if (!pg || !fs.length) return 0; const { hasMeta } = await import('../core/files.js'), made = [];
  for (const [i, f] of fs.slice(0, 20).entries()) { try { const m = await addMedia(f, null, { meta: await hasMeta(f) }), c = at || viewCenter(), n = newImagePanel(pg, m.id, { x: c.x + i * 24, y: c.y + i * 24 }); if (n) made.push(n.id); } catch (_) { /* 그림이 아니면 건너뜀 */ } }
  if (made.length) { setSel(made); commit('그림으로 컷 만들기'); } else toast('그림 파일(PNG, JPG, WebP 등)만 넣을 수 있어요.', 'err');
  return made.length;
}
// 정렬: 여럿이면 서로에게, 하나면 페이지에 맞춰요
function alignSel(how) {
  const pg = pageOf(), g = group(); if (!g.length) return; const one = g.length === 1, x0 = one ? 0 : Math.min(...g.map(e => e.x)), x1 = one ? pg.w : Math.max(...g.map(e => e.x + e.w)), y0 = one ? 0 : Math.min(...g.map(e => e.y)), y1 = one ? pg.h : Math.max(...g.map(e => e.y + e.h));
  for (const e of g) { const ox = e.x, oy = e.y; if (how === 'l') e.x = x0; else if (how === 'r') e.x = x1 - e.w; else if (how === 'cx') e.x = Math.round((x0 + x1 - e.w) / 2); else if (how === 't') e.y = y0; else if (how === 'b') e.y = y1 - e.h; else if (how === 'cy') e.y = Math.round((y0 + y1 - e.h) / 2); if (isB(e)) { e.tx += e.x - ox; e.ty += e.y - oy; } }
  commit('정렬');
}
function distributeSel(ax) {
  const g = [...group()]; if (g.length < 3) return; const k = ax === 'x' ? 'x' : 'y', s = ax === 'x' ? 'w' : 'h'; g.sort((a, b) => a[k] - b[k]);
  const total = g.reduce((v, e) => v + e[s], 0), gap = (g.at(-1)[k] + g.at(-1)[s] - g[0][k] - total) / (g.length - 1); let at = g[0][k];
  for (const e of g) { const o = e[k]; e[k] = Math.round(at); at += e[s] + gap; if (isB(e)) { if (ax === 'x') e.tx += e[k] - o; else e.ty += e[k] - o; } }
  commit('간격 똑같이');
}
// 세로로 자동 배치(웹툰): 그림들을 페이지 폭에 맞춰 위에서 아래로 쌓고, 모자라면 페이지를 아래로 늘려요
function stackDialog() {
  const pg = pageOf(), ms = (picked.size ? [...picked].map(mediaOf).filter(Boolean) : state.project.media.filter(m => !m.hidden)); if (!pg) return; if (!ms.length) { toast('보관함에 그림이 없어요.'); return; }
  const O = { m: Math.round(pg.w * 0.04), gap: Math.round(pg.w * 0.05), bw: 4, cont: pg.els.length > 0, ...(settings.get('cutStack') || {}) };
  const numF = (label, k, max) => h('label.field', null, h('span.field-name.w', null, label), h('input.num', { type: 'number', min: 0, max, value: O[k], 'aria-label': label, onchange: ev => { O[k] = clamp(parseFloat(ev.target.value) || 0, 0, max); } }));
  dialog({ title: '세로로 자동 배치', body: h('div.vid-form', null, h('p.dlg-text', null, `${picked.size ? '보관함에서 고른' : '보관함의'} 그림 ${ms.length}장을 페이지 폭에 맞춰 위에서 아래로 쌓아요. 페이지가 모자라면 아래로 늘어나요.`),
    h('div.field-row', null, numF('옆 여백', 'm', 400), numF('컷 사이 간격', 'gap', 2000)), h('div.field-row', null, numF('테두리', 'bw', 40), h('label.check', null, h('input', { type: 'checkbox', checked: O.cont, onchange: ev => { O.cont = ev.target.checked; } }), '지금 내용 아래에 이어서'))),
    buttons: [{ label: '취소' }, { label: '배치하기', primary: true, run: () => {
      settings.set('cutStack', { m: O.m, gap: O.gap, bw: O.bw }); if (!O.cont) pg.els = []; let y = O.cont && pg.els.length ? contentBottom(pg) + O.gap : O.m; const w = pg.w - 2 * O.m, made = [];
      for (const m of ms) { const hh = Math.round(w * m.h / m.w), n = { id: uid('e'), type: 'panel', x: O.m, y, w, h: hh, mediaId: m.id, ix: 0, iy: 0, is: 1, bw: O.bw, bc: '#111111' }; pg.els.push(n); made.push(n.id); ensureBitmap(m.id); y += hh + O.gap; }
      pg.h = Math.max(pg.h, y - O.gap + O.m); setSel([]); V.fitted = null; commit('세로로 자동 배치'); toast(`그림 ${ms.length}장을 쌓았어요. 페이지는 ${pg.w} × ${pg.h}이 됐어요.`);
    } }] });
}
// 내보내기 창: 어느 페이지를, 어떤 파일로, 몇 배로, 얼마마다 잘라서
function exportDialog() {
  const pg = pageOf(); if (!pg) return; const O = { scope: 'page', fmt: 'png', k: 1, cut: 0, ...(settings.get('cutExport') || {}) }, box = h('div.vid-form');
  const sel = (label, k, opts, num) => h('label.field', null, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: ev => { O[k] = num ? +ev.target.value : ev.target.value; } }, opts.map(([v, t]) => h('option', { value: v, selected: String(O[k]) === String(v) }, t))));
  box.append(h('div.field-row', null, sel('내보낼 것', 'scope', [['page', '이 페이지'], ['all', `모든 페이지 (${pages().length}쪽)`]]), sel('파일', 'fmt', [['png', 'PNG (가장 깨끗함)'], ['jpeg', 'JPG (작은 용량)'], ['webp', 'WebP']])),
    h('div.field-row', null, sel('크기', 'k', [[1, '그대로'], [2, '2배'], [0.5, '절반']], true), h('label.field', { title: '웹툰처럼 긴 페이지를 올리기 좋게 세로로 잘라 여러 장으로 저장해요. 0이면 자르지 않아요.' }, h('span.field-name.w', null, '세로로 자르기'), h('input.num', { type: 'number', min: 0, step: 100, value: O.cut, 'aria-label': '세로로 자르기', onchange: ev => { O.cut = Math.max(0, Math.round(parseFloat(ev.target.value) || 0)); } }))),
    h('p.dlg-text', null, '세로로 자르기에 1280처럼 적으면 그 높이마다 잘라 차례로 번호를 붙여요. 여러 장이면 폴더나 ZIP으로 저장돼요.'));
  dialog({ title: '내보내기', body: box, buttons: [{ label: '취소' }, { label: '내보내기', primary: true, run: () => { settings.set('cutExport', O); (async () => {
    const b = busy('페이지를 그리는 중이에요.'), files = [], list = O.scope === 'all' ? pages() : [pg], ext = O.fmt === 'jpeg' ? 'jpg' : O.fmt, blobOf = c => new Promise(r => c.toBlob(r, 'image/' + O.fmt, 0.92));
    try {
      for (const [i, p] of list.entries()) {
        const c = await pageCanvas(p, O.k), base = (list.length > 1 ? String(i + 1).padStart(3, '0') + ' ' : '') + p.name, step = O.cut ? Math.round(O.cut * O.k) : 0;
        if (!step || c.height <= step) files.push({ name: `${base}.${ext}`, blob: await blobOf(c) });
        else for (let y = 0, n = 1; y < c.height; y += step, n++) { const t = document.createElement('canvas'); t.width = c.width; t.height = Math.min(step, c.height - y); t.getContext('2d').drawImage(c, 0, -y); files.push({ name: `${base}-${String(n).padStart(2, '0')}.${ext}`, blob: await blobOf(t) }); }
        b.set(`페이지를 그리는 중이에요. ${i + 1} / ${list.length}`);
      }
      if (files.some(f => !f.blob)) throw new Error('그림이 너무 커서 만들지 못했어요. 크기를 줄이거나 세로로 잘라 주세요.');
      b.done('');
      if (files.length === 1) { if (await download(files[0].blob, files[0].name)) toast(`'${files[0].name}'로 저장했어요.`); }
      else if (await saveFiles(files, state.project.name + ' 페이지.zip')) toast(`그림 ${files.length}장을 저장했어요.`);
    } catch (e) { b.done(e.message || '내보내지 못했어요.', 'err'); }
  })(); } }] });
}
// 컷 모양 견본 (8.x의 12가지). rows: 줄마다 칸의 비율, cols: 기둥마다 칸의 비율
const TEMPLATES = [
  { n: '1컷', rows: [[1]] }, { n: '2단', rows: [[1], [1]] }, { n: '좌우 2컷', rows: [[1, 1]] }, { n: '3단', rows: [[1], [1], [1]] },
  { n: '위1 아래2', rows: [[1], [1, 1]] }, { n: '위2 아래1', rows: [[1, 1], [1]] }, { n: '4컷', rows: [[1, 1], [1, 1]] }, { n: '세로 4컷', rows: [[1], [1], [1], [1]] },
  { n: '큰 컷 + 2', rows: [{ h: 2, c: [1] }, { h: 1, c: [1, 1] }] }, { n: '6컷', rows: [[1, 1], [1, 1], [1, 1]] },
  { n: '왼쪽 큰 컷', cols: [{ w: 1.3, r: [1] }, { w: 1, r: [1, 1] }] }, { n: '엇갈림', rows: [{ h: 1, c: [2, 1] }, { h: 1, c: [1, 2] }, { h: 1, c: [2, 1] }] },
];
function tplRects(t, ax, ay, aw, ah, g) {
  const out = [];
  if (t.rows) { const rows = t.rows.map(r => (Array.isArray(r) ? { h: 1, c: r } : r)), tH = rows.reduce((v, r) => v + r.h, 0), avH = ah - g * (rows.length - 1); let y = ay; for (const r of rows) { const rh = avH * r.h / tH, tW = r.c.reduce((v, c) => v + c, 0), avW = aw - g * (r.c.length - 1); let x = ax; for (const c of r.c) { const cw = avW * c / tW; out.push({ x, y, w: cw, h: rh }); x += cw + g; } y += rh + g; } }
  else { const tW = t.cols.reduce((v, c) => v + c.w, 0), avW = aw - g * (t.cols.length - 1); let x = ax; for (const c of t.cols) { const cw = avW * c.w / tW, tH = c.r.reduce((v, r) => v + r, 0), avH = ah - g * (c.r.length - 1); let y = ay; for (const r of c.r) { const rh = avH * r / tH; out.push({ x, y, w: cw, h: rh }); y += rh + g; } x += cw + g; } }
  return out;
}
function templateDialog() {
  const pg = pageOf(); if (!pg) return; const O = { m: Math.round(Math.min(pg.w, 1600) * 0.04), bw: 4, clear: true, ...(settings.get('cutTpl') || {}) }, tall = pg.h > pg.w * 1.8;
  const apply = t => {
    settings.set('cutTpl', { m: O.m, bw: O.bw, clear: O.clear }); const gap = settings.get('cutGap') ?? 12; if (O.clear) pg.els = pg.els.filter(e => !(e.type === 'panel' && !e.mediaId));
    // 긴 페이지(웹툰)는 지금 내용 아래에 한 화면 높이로 이어 붙이고, 그 밖에는 페이지를 꽉 채워요
    const top = tall && pg.els.length ? contentBottom(pg) + gap : O.m, ah = tall ? Math.round((pg.w - 2 * O.m) * 1.4) : pg.h - 2 * O.m, made = [];
    for (const r of tplRects(t, O.m, top, pg.w - 2 * O.m, ah, gap)) { const n = { id: uid('e'), type: 'panel', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), mediaId: null, ix: 0, iy: 0, is: 1, bw: O.bw, bc: '#111111' }; pg.els.push(n); made.push(n.id); }
    if (tall) pg.h = Math.max(pg.h, top + ah + O.m); setSel(made); commit('컷 모양: ' + t.n); d.close();
  };
  const numF = (label, k, max) => h('label.field', null, h('span.field-name.w', null, label), h('input.num', { type: 'number', min: 0, max, value: O[k], 'aria-label': label, onchange: ev => { O[k] = clamp(parseFloat(ev.target.value) || 0, 0, max); } }));
  const d = dialog({ title: '모양 골라서 컷 나누기', wide: true, body: h('div.vid-form', null,
    h('div.tpl-grid', null, TEMPLATES.map(t => { const c = h('canvas'), g2 = c.getContext('2d'); c.width = 120; c.height = 150; g2.fillStyle = '#fff'; g2.fillRect(0, 0, 120, 150); g2.strokeStyle = '#222'; g2.lineWidth = 3; for (const r of tplRects(t, 10, 10, 100, 130, 7)) g2.strokeRect(r.x, r.y, r.w, r.h); return h('button.tpl-item', { title: t.n, onclick: () => apply(t) }, c, h('span', null, t.n)); })),
    h('div.field-row', null, numF('바깥 여백', 'm', 400), numF('테두리', 'bw', 40)),
    h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '컷 사이 간격'), h('input.num', { type: 'number', min: 0, max: 400, value: settings.get('cutGap') ?? 12, 'aria-label': '컷 사이 간격', onchange: ev => settings.set('cutGap', clamp(parseFloat(ev.target.value) || 0, 0, 400)) })), h('label.check', null, h('input', { type: 'checkbox', checked: O.clear, onchange: ev => { O.clear = ev.target.checked; } }), '빈 컷은 지우고 만들기')),
    h('p.dlg-text', null, tall ? '긴 페이지라서 지금 내용 아래에 이어 붙여요. 페이지가 모자라면 아래로 늘어나요.' : '페이지를 꽉 채워 나눠요. 그림이 든 컷과 말풍선은 그대로 둬요.')), buttons: [{ label: '닫기' }] });
}
// 컷 모양대로 나누기(지금 페이지에): 빈 컷은 지우고, 내용이 있으면 그 아래에 이어서 놓아요
function applyLayout(key) {
  const pg = pageOf(); if (!pg) return; const L = (LAYOUTS.find(l => l[0] === key) || LAYOUTS[0])[2], m = Math.round(Math.min(pg.w, 1600) * 0.04), gap = Math.round(m * 0.6);
  pg.els = pg.els.filter(e => !(e.type === 'panel' && !e.mediaId)); const top = pg.els.length ? contentBottom(pg) + gap : m, area = Math.min(pg.h - 2 * m, Math.round((pg.w - 2 * m) * 1.5)), made = [];
  for (const [fx, fy, fw, fh] of L) { const n = { id: uid('e'), type: 'panel', x: Math.round(m + fx * (pg.w - 2 * m) + (fx ? gap / 2 : 0)), y: Math.round(top + fy * area + (fy ? gap / 2 : 0)), w: Math.round(fw * (pg.w - 2 * m) - (fx ? gap / 2 : 0) - (fx + fw < 1 ? gap / 2 : 0)), h: Math.round(fh * area - (fy ? gap / 2 : 0) - (fy + fh < 1 ? gap / 2 : 0)), mediaId: null, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' }; pg.els.push(n); made.push(n.id); }
  pg.h = Math.max(pg.h, top + area + m); setSel([]); commit('컷 모양대로 나누기');
}
// 선으로 컷 자르기: 선의 양쪽으로 컷 모양을 나누고, 사이를 간격만큼 띄워요. 그림은 제자리에 이어져 보이게 둬요
const polyOf = e => (e.poly ? e.poly.map(([fx, fy]) => [e.x + fx * e.w, e.y + fy * e.h]) : [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]]);
function clipHalf(pts, nx, ny, d) {   // n·p <= d 인 쪽만 남겨요
  const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d; if (da <= 0) out.push(a); if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
  return out;
}
const polyArea = pts => Math.abs(pts.reduce((v, p, i) => { const q = pts[(i + 1) % pts.length]; return v + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
function sliceCut(a, b) {
  const pg = pageOf(); let dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy); if (!pg || len < 12) return 0;
  if (Math.abs(dy) < len * 0.035) { dy = 0; } else if (Math.abs(dx) < len * 0.035) { dx = 0; }   // 거의 반듯하면 반듯하게
  const l2 = Math.hypot(dx, dy), nx = -dy / l2, ny = dx / l2, d = nx * a.x + ny * a.y, gap = settings.get('cutGap') ?? 12, picked0 = group().filter(e => e.type === 'panel'), made = [];
  const crosses = pts => { let lo = false, hi = false; for (const p of pts) { const v = nx * p[0] + ny * p[1] - d; if (v < -1) lo = true; if (v > 1) hi = true; } if (!(lo && hi)) return false; const ux = dx / l2, uy = dy / l2, ts = pts.map(p => (p[0] - a.x) * ux + (p[1] - a.y) * uy); return Math.max(...ts) > 0 && Math.min(...ts) < l2; };   // 그은 선이 실제로 지나간 컷만
  for (const e of (picked0.length ? picked0 : pg.els.filter(o => o.type === 'panel'))) {
    if (e.rot) continue; const pts = polyOf(e); if (!crosses(pts)) continue;
    const parts = [clipHalf(pts, nx, ny, d - gap / 2), clipHalf(pts, -nx, -ny, -d - gap / 2)].filter(q => q.length >= 3 && polyArea(q) > 400); if (parts.length < 2) continue;
    const m = e.mediaId ? mediaOf(e.mediaId) : null, k0 = m ? Math.max(e.w / m.w, e.h / m.h) * (e.is || 1) : 1, icx = e.x + e.w / 2 + (e.ix || 0), icy = e.y + e.h / 2 + (e.iy || 0), at = pg.els.indexOf(e);
    const ns = parts.map((q, i) => { const x0 = Math.min(...q.map(p => p[0])), y0 = Math.min(...q.map(p => p[1])), x1 = Math.max(...q.map(p => p[0])), y1 = Math.max(...q.map(p => p[1])), w = Math.max(1, x1 - x0), hh = Math.max(1, y1 - y0);
      const n = { ...JSON.parse(JSON.stringify(e)), id: i ? uid('e') : e.id, x: x0, y: y0, w, h: hh, br: 0, poly: q.map(p => [(p[0] - x0) / w, (p[1] - y0) / hh]) };
      if (q.length === 4 && q.every(p => (Math.abs(p[0] - x0) < 0.5 || Math.abs(p[0] - x1) < 0.5) && (Math.abs(p[1] - y0) < 0.5 || Math.abs(p[1] - y1) < 0.5))) delete n.poly;   // 반듯하게 잘렸으면 그냥 네모
      if (m) { n.is = k0 / Math.max(w / m.w, hh / m.h); n.ix = icx - (x0 + w / 2); n.iy = icy - (y0 + hh / 2); }
      return n; });
    pg.els.splice(at, 1, ...ns); made.push(...ns.map(n => n.id));
  }
  if (made.length) { setSel(made); commit('선으로 컷 자르기'); } else toast('선이 지나간 컷이 없어요. 컷을 가로질러 그어 주세요.');
  return made.length;
}
// 글자 모양 입히기: 고른 글자들에 견본을 입혀요. 효과음 견본의 크기는 800 폭 기준이라 페이지 폭에 맞춰 바꿔요
function applyTextLook(p) { const pg = pageOf(), ts = group().filter(e => e.type === 'text'); if (!ts.length) return; for (const e of ts) Object.assign(e, p, p.size ? { size: Math.round(p.size * pg.w / 800) } : {}, p.sw ? { sw: Math.max(1, Math.round(p.sw * (p.size ? pg.w / 800 : 1))) } : {}, p.sw2 ? { sw2: Math.max(1, Math.round(p.sw2 * (p.size ? pg.w / 800 : 1))) } : {}); commit('글자 모양'); }
function addSfxText(i) {
  const pg = pageOf(), sp = SFX_PRESETS[i] || SFX_PRESETS[0]; if (!pg) return; const c = viewCenter(), k = pg.w / 800;
  const t = { id: uid('e'), type: 'text', x: Math.round(c.x - 60), y: Math.round(c.y - 40), w: 120, h: 80, text: sp.text, font: '', color: '#111111', sc: '#ffffff', ...sp.p, size: Math.round(sp.p.size * k), sw: Math.max(1, Math.round((sp.p.sw || 0) * k)), sw2: Math.round((sp.p.sw2 || 0) * k), seed: 1 + Math.floor(Math.random() * 999), rot: i === 0 ? -12 : 0 };
  pg.els.push(t); V.sel = t.id; V.more = null; V.tool = 'pick'; commit('효과음 넣기');
}
// 자동 흰칠(컷 페이지에서): 컷마다 보이는 그림을 그대로 읽어 가릴 곳을 찾고, 그 컷 위에 '흰칠' 그림을 얹어 컷과 묶어요
async function censorPanels(onlySel) {
  const pg = pageOf(); if (!pg) return; const { ensurePacks, censorMask, censorCfg } = await import('../ui/aitools.js'), k = censorCfg();
  const targets = (onlySel ? group() : pg.els).filter(e => e.type === 'panel' && e.mediaId && !e.hide); if (!targets.length) { toast(onlySel ? '그림이 든 컷을 골라 주세요.' : '이 페이지에 그림이 든 컷이 없어요.'); return; }
  if (!await ensurePacks(['deep', 'deepn', k.model === 'precise' ? 'segM' : 'segN', 'samE', 'samD'])) return;
  const b = busy(`가릴 곳을 찾는 중이에요. 0 / ${targets.length}`), job = { stop: false }; let hits = 0;
  try {
    await Promise.all(targets.map(e => ensureBitmap(e.mediaId)));
    for (const [i, e] of targets.entries()) {
      const sc = Math.min(2, Math.max(1, 1400 / Math.max(e.w, e.h))), c = document.createElement('canvas'); c.width = Math.max(8, Math.round(e.w * sc)); c.height = Math.max(8, Math.round(e.h * sc)); const g = c.getContext('2d'); g.scale(sc, sc); g.translate(-e.x, -e.y); drawEl(g, { ...e, bw: 0, rot: 0 });
      const r = await censorMask(c, job, t => b.set(`가릴 곳을 찾는 중이에요. ${i + 1} / ${targets.length} (${t})`));
      pg.els = pg.els.filter(o => !(o.cz === e.id));   // 이 컷의 예전 흰칠은 새것으로 바꿔요
      if (r.found) { const m = await addMedia(new File([await new Promise(res => r.canvas.toBlob(res, 'image/png'))], '흰칠.png', { type: 'image/png' }), null, { hidden: true }); await ensureBitmap(m.id); if (!e.gid) e.gid = uid('g'); const at = pg.els.indexOf(e); pg.els.splice(at + 1, 0, { id: uid('e'), type: 'pic', mediaId: m.id, x: e.x, y: e.y, w: e.w, h: e.h, cz: e.id, gid: e.gid, lock: true, ...(e.rot ? { rot: e.rot } : {}) }); hits++; }
    }
    commit('자동 흰칠'); b.done(hits ? `컷 ${hits}개에 흰칠을 얹었어요. 흰칠은 컷과 묶여 함께 움직여요. 모자란 곳은 가리기 도구(X)로 덧가려요.` : '가릴 곳을 찾지 못했어요. 가리기 도구(X)로 직접 가릴 수 있어요.');
  } catch (err) { b.done('자동 흰칠을 하지 못했어요. ' + ((err && err.message) || ''), 'err'); }
}
function clearCensor() { const pg = pageOf(), n = pg.els.filter(o => o.cz).length; if (!n) { toast('이 페이지에 자동 흰칠이 없어요.'); return; } pg.els = pg.els.filter(o => !o.cz); commit('자동 흰칠 지우기'); }
// 대사 하나만 번역·다듬기 (고른 말풍선·글자)
async function translateOne(lang) {
  const es = group().filter(e => (e.type === 'bubble' || e.type === 'text') && String(e.text || '').trim()); if (!es.length) return; const b = busy(lang === 'polish' ? '대사를 다듬는 중이에요.' : '대사를 번역하는 중이에요.');
  try { const out = await translateTexts(es.map(e => e.text), lang, ''); es.forEach((e, i) => { if (typeof out[i] === 'string' && out[i].trim()) e.text = out[i]; }); commit(lang === 'polish' ? '대사 다듬기' : '대사 번역'); b.done(`대사 ${es.length}개를 바꿨어요. 마음에 안 들면 Ctrl+Z`); }
  catch (err) { b.done((err && err.message) || '바꾸지 못했어요.', 'err'); }
}
const TYPE_NAME = { panel: '컷', bubble: '말풍선', text: '글자', lines: '집중선', pic: '스티커', cover: '가리기', draw: '손그림' };
const nameOf = e => e.name || (e.cz ? '자동 흰칠' : e.type === 'bubble' || e.type === 'text' ? (String(e.text || '').split('\n')[0].slice(0, 12) || TYPE_NAME[e.type]) : e.type === 'panel' ? (e.mediaId ? ((mediaOf(e.mediaId) || {}).name || '컷').replace(/\.[a-z0-9]+$/i, '').slice(0, 14) : '빈 컷') : TYPE_NAME[e.type]);
// 화면 가운데에 곧바로 넣기 (위쪽 줄의 단추)
function addAtCenter(kind) {
  const pg = pageOf(); if (!pg) return; const c = viewCenter(); let n;
  if (kind === 'panel') { const w = Math.round(pg.w * 0.6), hh = Math.round(w * 0.7); n = { id: uid('e'), type: 'panel', x: Math.round(c.x - w / 2), y: Math.round(c.y - hh / 2), w, h: hh, mediaId: null, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' }; }
  else if (kind === 'bubble') { const w = Math.round(pg.w * 0.3), hh = Math.round(w * 0.58); n = newBubble(pg, { x: c.x - w / 2, y: c.y - hh / 2, w, h: hh }); }
  else n = { id: uid('e'), type: 'text', x: Math.round(c.x - 60), y: Math.round(c.y - 20), w: 120, h: 40, text: '글자', size: Math.round(pg.w / 22), color: '#111111', sw: 3, sc: '#ffffff', bold: true };
  pg.els.push(n); V.sel = n.id; V.more = null; V.tool = 'pick'; commit({ panel: '컷 만들기', bubble: '말풍선 넣기', text: '글자 넣기' }[kind]);
  if (kind !== 'panel') setTimeout(editInPlace, 30);
}
const zoomBy = f => { if (!wrap || !pageOf()) return; const W = wrap.clientWidth, H = wrap.clientHeight, p = toPage(W / 2, H / 2), z = clamp(V.zoom * f, 0.02, 16); V.zoom = z; V.ox = W / 2 - p.x * z; V.oy = H / 2 - p.y * z; draw(); emit(); };

// ---- 말풍선 다루기 ----
const isB = e => !!e && e.type === 'bubble';
const syncLook = e => { if (isB(e) && e.join) for (const o of joined(pageOf(), e)) if (o !== e) LOOK.forEach(k => { o[k] = e[k]; }); };
// 새 말풍선: 마지막으로 고른 종류(V.look)를 입혀요. 선 굵기는 페이지 크기에 맞춰요
const lineUnit = pg => Math.max(2, Math.round(pg.w / 300)) / 3;
function newBubble(pg, d) {
  const look = V.look || PRESETS[0].props;
  return { id: uid('e'), type: 'bubble', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), text: '대사', size: Math.round(pg.w / 26), seed: 1 + Math.floor(Math.random() * 99999), ...look, bw: Math.round(look.bw * lineUnit(pg) * 2) / 2,
    tx: Math.round(d.x + d.w * 0.28), ty: Math.round(d.y + d.h + Math.min(d.h * 0.32, pg.w * 0.08)) };
}
function applyLook(props) {
  V.look = props; const pg = pageOf(), bs = group().filter(isB);
  if (!bs.length) { emit(); return; }
  for (const o of bs) { Object.assign(o, props, { bw: Math.round(props.bw * lineUnit(pg) * 2) / 2 }); syncLook(o); }
  commit('말풍선 종류');
}
// 글자에 맞추기: 대사가 넉넉히 들어가게 말풍선 크기를 바꿔요 (가운데는 그대로)
function fitText(e) {
  const g = ctx; if (!g || !isB(e)) return; const [fw, fh, p] = insetOf(e), size = e.size || 32, lh = size * 1.3, cx = e.x + e.w / 2, cy = e.y + e.h / 2; let w, hh;
  if (e.vert) { const cols = String(e.text || '').split('\n'); w = cols.length * size * 1.25; hh = Math.max(1, ...cols.map(c => [...c].length)) * size * 1.08; }
  else {
    g.font = fontOf(e); let ls = wrapText(g, e, null); const tw = Math.max(1, ...ls.map(t => g.measureText(t).width));
    if (ls.length === 1 && tw > size * 9) { const target = Math.max(size * 6, Math.sqrt(tw * lh * 2.4)); ls = wrapText(g, e, () => target); }
    w = Math.max(size, ...ls.map(t => g.measureText(t).width)); hh = ls.length * lh;
  }
  e.w = Math.round(Math.max(48, w / fw * (p ? 1.16 : 1.04) + size * 0.6)); e.h = Math.round(Math.max(40, hh / fh * (p ? 1.2 : 1.05) + size * 0.5)); e.x = Math.round(cx - e.w / 2); e.y = Math.round(cy - e.h / 2);
}
// 그 자리에서 고치기: 말풍선·글자 위에 글 상자를 띄워 바로 써요. 바깥을 누르거나 Esc·Ctrl+Enter로 끝내요
function editInPlace() {
  const e = elOf(); if (!e || !wrap || (e.type !== 'bubble' && e.type !== 'text')) return; if (V.editor) V.editor.blur();
  const before = e.text || '', z = V.zoom, w = Math.max(140, e.w * z), hh = Math.max(64, e.h * z), dark = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); if (!m) return false; const v = parseInt(m[1], 16); return ((v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11) < 128; };
  const fg = e.color || '#111111', bg = isB(e) && (e.fop ?? 100) > 50 ? (e.fill || '#ffffff') : dark(fg) ? '#ffffff' : '#222222';
  const ta = h('textarea.cut-edit', { 'aria-label': '대사 바로 고치기', value: before, spellcheck: false, style: `left:${V.ox + (e.x + e.w / 2) * z - w / 2}px;top:${V.oy + (e.y + e.h / 2) * z - hh / 2}px;width:${w}px;height:${hh}px;font:${e.bold ? 700 : 400} ${clamp((e.size || 32) * z, 11, 44)}px ${e.font || 'sans-serif'};color:${fg};background:${bg}`,
    oninput: () => { e.text = ta.value; if (e.auto) fitText(e); draw(); }, onkeydown: ev => { ev.stopPropagation(); if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ta.blur(); } },
    onblur: () => { if (V.editor !== ta) return; V.editor = null; ta.remove(); if ((e.text || '') !== before) commit('대사 고치기'); else emit(); } });
  V.editor = ta; wrap.append(ta); ta.focus(); ta.select();
}

// ---- 화면 ----
export const cutRoom = {
  id: 'cut', title: '컷', icon: 'cut',
  mount(el) {
    const tools = h('div.tools', { role: 'toolbar', 'aria-label': '도구' }), side = h('div.vid-side'), strip = h('div.cut-pages');
    cv = h('canvas.viewport', { tabindex: '0', 'aria-label': '페이지' }); ctx = cv.getContext('2d');
    const empty = h('div.empty-room', null, h('h2', null, '페이지를 만들어 시작해요'), h('p', null, '컷을 나눈 페이지를 만들고, 보관함의 그림을 컷 위로 끌어다 놓아요. 그 위에 말풍선과 글자를 얹어요.'),
      h('div.btn-row', null, LAYOUTS.map(([k, t]) => h('button.btn', { onclick: () => { newPage(800, 1280, k); commit('새 페이지'); } }, t))));
    wrap = h('div.viewport-wrap', null, cv, empty);
    const bar = h('div.optbar.cut-bar', { role: 'toolbar', 'aria-label': '넣기와 보기' });
    el.append(tools, h('div.vid-room', null, bar, h('div.vid-top', null, wrap, side), strip));
    const ro = new ResizeObserver(() => { if (V.fitted !== (pageOf() || {}).id) fit(); else draw(); }); ro.observe(wrap);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, pg = pageOf(), p = toPage(sx, sy), t = pg && (e.altKey || V.pan) ? (V.pan ? pg.els.find(x => x.id === V.pan) : hit(pg, p)) : null;
      if (t && t.type === 'panel' && t.mediaId) { t.is = clamp((t.is || 1) * Math.exp(-e.deltaY * 0.0015), 0.05, 8); draw(); clearTimeout(V.wt); V.wt = setTimeout(() => commit('컷 안 그림 크기'), 400); return; }
      if (!(e.ctrlKey || e.metaKey)) { if (e.shiftKey) V.ox -= e.deltaY || e.deltaX; else { V.oy -= e.deltaY; V.ox -= e.deltaX; } draw(); return; }   // 긴 페이지는 휠로 내려요. Ctrl+휠이 확대예요
      const z = clamp(V.zoom * Math.exp(-e.deltaY * 0.0015), 0.02, 16); V.zoom = z; V.ox = sx - p.x * z; V.oy = sy - p.y * z; draw(); tick();
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      const pg = pageOf(); if (!pg) return; cv.focus();
      const r = cv.getBoundingClientRect(), at = ev => toPage(ev.clientX - r.left, ev.clientY - r.top), p = at(e);
      if (e.button === 1 || V.space) { const ox = V.ox, oy = V.oy; return drag(e, ev => { V.ox = ox + ev.clientX - e.clientX; V.oy = oy + ev.clientY - e.clientY; draw(); }); }
      if (e.button !== 0) return;
      if (V.tool === 'text') { const t = { id: uid('e'), type: 'text', x: Math.round(p.x - 60), y: Math.round(p.y - 20), w: 120, h: 40, text: '글자', size: Math.round(pg.w / 22), color: '#111111', sw: 3, sc: '#ffffff', bold: true }; pg.els.push(t); V.sel = t.id; V.tool = 'pick'; commit('글자 넣기'); return; }
      if (V.tool === 'pen') {
        const pen = settings.get('cutPen') || {}, pts = [[p.x, p.y]]; V.penLine = { pts, color: pen.color || '#111111', size: pen.size || Math.max(3, Math.round(pg.w / 160)) };
        return drag(e, ev => { const q = at(ev), l = pts.at(-1); if (Math.hypot(q.x - l[0], q.y - l[1]) > 1.5 / V.zoom) { pts.push([q.x, q.y]); draw(); } }, () => {
          const L = V.penLine; V.penLine = null; let cur2 = elOf(); if (!cur2 || cur2.type !== 'draw' || cur2.rot || cur2.id !== V.penEl) cur2 = null;
          const old = cur2 ? cur2.strokes.map(st => st.map(([x, y]) => [cur2.x + x * cur2.w / cur2.bw0, cur2.y + y * cur2.h / cur2.bh0])) : [], all = [...old, L.pts], xs = all.flat().map(q => q[0]), ys = all.flat().map(q => q[1]), pad = (cur2 ? cur2.size : L.size) / 2 + 2;
          const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, w = Math.max(...xs) + pad - x0, hh = Math.max(...ys) + pad - y0, strokes = all.map(st => st.map(([x, y]) => [Math.round((x - x0) * 10) / 10, Math.round((y - y0) * 10) / 10]));
          if (cur2) Object.assign(cur2, { x: x0, y: y0, w, h: hh, bw0: w, bh0: hh, strokes }); else { cur2 = { id: uid('e'), type: 'draw', x: x0, y: y0, w, h: hh, bw0: w, bh0: hh, strokes, color: L.color, size: L.size }; pg.els.push(cur2); }
          V.sel = cur2.id; V.more = null; V.penEl = cur2.id; commit('펜으로 그리기');
        });
      }
      if (V.tool === 'slice') { V.cutLine = { a: p, b: p }; return drag(e, ev => { let q = at(ev); if (ev.shiftKey) { const ang = Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 12)) * (Math.PI / 12), L = Math.hypot(q.x - p.x, q.y - p.y); q = { x: p.x + Math.cos(ang) * L, y: p.y + Math.sin(ang) * L }; } V.cutLine.b = q; draw(); }, () => { const c = V.cutLine; V.cutLine = null; if (!sliceCut(c.a, c.b)) draw(); }); }
      if (V.tool === 'panel' || V.tool === 'bubble' || V.tool === 'lines' || V.tool === 'cover') {
        const kind = V.tool; V.draft = { x: p.x, y: p.y, w: 0, h: 0 };
        return drag(e, ev => { const q = at(ev); Object.assign(V.draft, { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }); draw(); }, () => {
          const d = V.draft; V.draft = null; if (d.w < 12 || d.h < 12) { if (kind !== 'bubble') { draw(); return; } const bw = Math.round(pg.w * 0.3), bh = Math.round(bw * 0.58); Object.assign(d, { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh }); }   // 말풍선은 그냥 눌러도 알맞은 크기로 놓여요
          const cvr = settings.get('cutCover') || {};
          const n = kind === 'cover' ? { id: uid('e'), type: 'cover', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), kind: cvr.kind || 'mosaic', shape: cvr.shape || 'rect', str: cvr.str || 18, color: cvr.color || '#ffffff' } : kind === 'lines' ? { id: uid('e'), type: 'lines', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), color: '#111111', count: 90, hole: 45, thick: 1, seed: 1 + Math.floor(Math.random() * 99999) }
            : kind === 'panel' ? { id: uid('e'), type: 'panel', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), mediaId: null, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' }
            : newBubble(pg, d);
          pg.els.push(n); V.sel = n.id; V.tool = 'pick'; if (kind === 'cover') V.tool = 'cover';   // 가리기는 이어서 여러 군데 하기 쉬우라고 도구를 그대로 둬요
          commit(kind === 'panel' ? '컷 만들기' : kind === 'lines' ? '집중선 넣기' : kind === 'cover' ? '가리기' : '말풍선 넣기');
        });
      }
      const cur = elOf(), rr = 7 / V.zoom;
      if (cur && cur.type === 'bubble' && cur.tail && Math.hypot(p.x - cur.tx, p.y - cur.ty) < rr * 1.4) { let mv = false; return drag(e, ev => { const q = at(ev); cur.tx = Math.round(q.x); cur.ty = Math.round(q.y); mv = true; draw(); }, () => mv && commit('말풍선 꼬리')); }
      if (cur && V.pan !== cur.id) {
        const lp = toLocal(cur, p), C = { x: cur.x + cur.w / 2, y: cur.y + cur.h / 2 }, kn = knobOf(cur);
        if (Math.hypot(lp.x - kn.x, lp.y - kn.y) < rr * 1.3) {   // 돌리기 손잡이: Shift는 15도씩, 90도 가까이에서는 딱 맞춰요
          let mv = false; return drag(e, ev => { const q = at(ev); let a = Math.atan2(q.y - C.y, q.x - C.x) * 180 / Math.PI + 90; a = ((a + 180) % 360 + 360) % 360 - 180; if (ev.shiftKey) a = Math.round(a / 15) * 15; else { const n = Math.round(a / 90) * 90; if (Math.abs(a - n) < 3) a = n; } cur.rot = Math.round(a * 10) / 10 || 0; mv = true; draw(); }, () => mv && commit('돌리기'));
        }
        for (const [hx, hy, fx, fy] of handlesOf(cur)) if (Math.abs(lp.x - hx) < rr && Math.abs(lp.y - hy) < rr) {
          const o = { x: cur.x, y: cur.y, w: cur.w, h: cur.h, size: cur.size || 32, rot: cur.rot || 0 }; let mv = false;
          if (cur.type === 'text') {   // 글자는 모서리를 끌면 글자 크기가 바뀌어요 (가운데는 그대로)
            const d0 = Math.hypot(p.x - C.x, p.y - C.y) || 1; return drag(e, ev => { const q = at(ev); cur.size = clamp(Math.round(o.size * Math.hypot(q.x - C.x, q.y - C.y) / d0), 6, 800); draw(); cur.x = Math.round(C.x - cur.w / 2); cur.y = Math.round(C.y - cur.h / 2); mv = true; draw(); }, () => mv && commit('글자 크기'));
          }
          const keep0 = cur.type === 'pic';   // 스티커는 비율을 지키고(Shift로 풀기), 그 밖에는 Shift를 누르면 지켜요
          return drag(e, ev => {
            const q = rotPt(at(ev), C.x, C.y, -o.rot); let x0 = o.x, x1 = o.x + o.w, y0 = o.y, y1 = o.y + o.h;
            if (fx === 0) x0 = Math.min(q.x, x1 - 16); else if (fx === 1) x1 = Math.max(q.x, x0 + 16); if (fy === 0) y0 = Math.min(q.y, y1 - 16); else if (fy === 1) y1 = Math.max(q.y, y0 + 16);
            if ((keep0 !== ev.shiftKey) && fx !== 0.5 && fy !== 0.5) { const k = Math.max((x1 - x0) / o.w, (y1 - y0) / o.h), w = o.w * k, hh = o.h * k; if (fx === 0) x0 = x1 - w; else x1 = x0 + w; if (fy === 0) y0 = y1 - hh; else y1 = y0 + hh; }
            const nc = rotPt({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, C.x, C.y, o.rot), w = Math.round(x1 - x0), hh = Math.round(y1 - y0);   // 돌린 요소도 맞은편이 제자리에 있게
            cur.w = w; cur.h = hh; cur.x = Math.round(nc.x - w / 2); cur.y = Math.round(nc.y - hh / 2); mv = true; draw();
          }, () => mv && commit('크기 바꾸기'));
        }
      }
      const t = hit(pg, p);
      if (e.shiftKey && t) {   // 더하거나 빼기
        const ids = new Set(group().map(x => x.id)); if (ids.has(t.id) && ids.size > 1) { ids.delete(t.id); V.sel = [...ids].at(-1); } else { ids.add(t.id); V.sel = t.id; }
        ids.delete(V.sel); V.more = { anchor: V.sel, ids }; emit(); return;
      }
      const inGroup = t && group().length > 1 && group().includes(t);
      if (!inGroup && V.sel !== (t ? t.id : null)) { V.sel = t ? t.id : null; emit(); }
      if (!t) { V.draft = { x: p.x, y: p.y, w: 0, h: 0 }; return drag(e, ev => { const q = at(ev); Object.assign(V.draft, { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }); draw(); }, () => { const d = V.draft; V.draft = null; if (d.w > 4 || d.h > 4) { setSel(pg.els.filter(o => o.x < d.x + d.w && o.x + o.w > d.x && o.y < d.y + d.h && o.y + o.h > d.y).map(o => o.id)); emit(); } else draw(); }); }   // 빈 곳을 끌면 걸친 요소를 모두 골라요
      if (inGroup) { const g0 = group().map(x => ({ x, x0: x.x, y0: x.y, tx0: x.tx, ty0: x.ty })); let mv = false; return drag(e, ev => { const dx = Math.round((ev.clientX - e.clientX) / V.zoom), dy = Math.round((ev.clientY - e.clientY) / V.zoom); if (dx || dy) mv = true; for (const o of g0) { o.x.x = o.x0 + dx; o.x.y = o.y0 + dy; if (o.x.type === 'bubble') { o.x.tx = o.tx0 + dx; o.x.ty = o.ty0 + dy; } } draw(); }, () => mv && commit('함께 옮기기')); }
      if ((e.altKey || V.pan === t.id) && t.type === 'panel' && t.mediaId) { const ix = t.ix || 0, iy = t.iy || 0; let mv = false; return drag(e, ev => { t.ix = ix + (ev.clientX - e.clientX) / V.zoom; t.iy = iy + (ev.clientY - e.clientY) / V.zoom; mv = true; draw(); }, () => mv && commit('컷 안 그림 옮기기')); }
      const x0 = t.x, y0 = t.y, tx0 = t.tx, ty0 = t.ty; let mv = false;
      drag(e, ev => { let dx = Math.round((ev.clientX - e.clientX) / V.zoom), dy = Math.round((ev.clientY - e.clientY) / V.zoom); if (dx || dy) mv = true; if (!ev.altKey && !t.rot) { const q = snapEl(pg, t, x0 + dx, y0 + dy); dx = q.x - x0; dy = q.y - y0; } else V.guides = null; t.x = x0 + dx; t.y = y0 + dy; if (t.type === 'bubble') { t.tx = tx0 + dx; t.ty = ty0 + dy; } draw(); }, () => { V.guides = null; if (mv) commit('옮기기'); else draw(); });
    });
    cv.addEventListener('dblclick', () => {
      const e = elOf(); if (!e) return; if (e.type !== 'panel') return editInPlace();
      if (e.mediaId) { V.pan = V.pan === e.id ? null : e.id; emit(); if (V.pan) toast('컷 안의 그림을 끌어 옮기고 휠로 키워요. 끝나면 Esc나 바깥을 눌러요.'); return; }
      const i = h('input', { type: 'file', accept: 'image/*' }); i.onchange = async () => { const f = i.files[0]; if (!f) return; try { const { hasMeta } = await import('../core/files.js'), m = await addMedia(f, null, { meta: await hasMeta(f) }); Object.assign(e, { mediaId: m.id, ix: 0, iy: 0, is: 1 }); ensureBitmap(m.id); commit('컷에 그림 담기'); } catch (_) { toast('그림 파일을 열지 못했어요.', 'err'); } }; i.click();
    });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); if (!pageOf()) return; if (!elOf()) { showMenu([{ label: '붙여넣기', disabled: !clip.length, run: () => run('cut.paste') }, '-', { label: '여기에 말풍선 넣기', run: () => addAtCenter('bubble') }, { label: '여기에 글자 넣기', run: () => addAtCenter('text') }, { label: '여기에 컷 넣기', run: () => addAtCenter('panel') }, '-', { label: '모두 고르기', run: () => run('cut.selectAll') }, { label: '화면에 맞추기', run: () => { V.fitted = null; emit(); } }], e.clientX, e.clientY); return; } const e0 = elOf(), txt = e0.type === 'bubble' || e0.type === 'text'; showMenu([...(txt ? [{ label: '대사 고치기', run: () => editInPlace() }] : []), ...(isB(e0) ? [{ label: '글자에 맞추기', run: () => run('cut.fitText') }, { label: '이어 붙이기', disabled: group().filter(isB).length < 2, run: () => run('cut.join') }, { label: '떼어 내기', disabled: !e0.join, run: () => run('cut.unjoin') }, '-'] : []), { label: '맨 앞으로', run: () => run('cut.front') }, { label: '앞으로', run: () => run('cut.forward') }, { label: '뒤로', run: () => run('cut.backward') }, { label: '맨 뒤로', run: () => run('cut.back') }, '-', { label: '숨기기', run: () => { group().forEach(o => { o.hide = true; }); V.sel = null; commit('숨기기'); } }, { label: '잠그기', run: () => { group().forEach(o => { o.lock = true; }); V.sel = null; commit('잠그기'); } }, '-', { label: '잘라내기', run: () => run('cut.cutEl') }, { label: '복사', run: () => run('cut.copy') }, { label: '복제', run: () => run('cut.dup') }, '-', { label: '지우기', run: () => run('cut.delete') }], e.clientX, e.clientY); });
    wrap.addEventListener('dragover', e => e.preventDefault());
    wrap.addEventListener('drop', e => {
      e.preventDefault(); const pg = pageOf(); if (!pg) return; const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top);
      if (e.dataTransfer.files && e.dataTransfer.files.length) { placeFiles(e.dataTransfer.files, p); return; }   // 컴퓨터의 그림 파일
      const sfx = e.dataTransfer.getData('application/x-potato-sfx'); if (sfx) { const [pk, i] = sfx.split('|'); import('../ui/sfxpanel.js').then(m => m.placeSfx(pk, +i, p)); return; }   // 효과음 패널에서 끌어온 것
      const id = e.dataTransfer.getData('application/x-potato-media'); if (!id) return; let ids = [id]; try { ids = JSON.parse(e.dataTransfer.getData('application/x-potato-medias')) || ids; } catch (_) { /* 한 장만 */ }
      const t = ids.length === 1 && !e.shiftKey ? [...pg.els].reverse().find(x => x.type === 'panel' && p.x >= x.x && p.y >= x.y && p.x <= x.x + x.w && p.y <= x.y + x.h) : null;
      if (t) { t.mediaId = id; t.ix = 0; t.iy = 0; t.is = 1; ensureBitmap(id); V.sel = t.id; commit('컷에 그림 담기'); return; }
      // 빈 곳에 놓으면 그림 비율대로 새 컷이 생겨요 (여러 장이면 아래로 차례로)
      let y = p.y; const made = []; for (const [i, mid] of ids.slice(0, 20).entries()) { const n = newImagePanel(pg, mid, { x: p.x, y }); if (!n) continue; if (i) n.y = Math.round(y); y = n.y + n.h + Math.round(pg.w * 0.04) + (i ? 0 : 0); made.push(n.id); y += 0; }
      if (made.length) { setSel(made); commit('그림으로 컷 만들기'); }
    });

    const update = () => {
      const pg = pageOf(), e = elOf(); if (V.pan && (!e || e.id !== V.pan)) V.pan = null; loadProjectFonts();
      const tb = (label, title, fn, ic, cls = '') => h('button.btn.small' + cls, { title, onclick: fn }, ic ? icon(ic, 14) : null, label);
      bar.hidden = !pg; bar.replaceChildren(
        tb('컷', '화면 가운데에 빈 컷을 넣어요. 보관함 그림을 끌어다 놓으면 그림으로 컷이 생겨요.', () => addAtCenter('panel'), 'cut'),
        tb('컷 나누기', '컷 모양을 골라 이 페이지에 넣거나, 고른 컷을 둘·셋·넷으로 나눠요.', ev => showMenu([{ label: '모양 골라서 나누기… (12가지)', run: templateDialog }, '-', { label: '선을 그어 자르기 (비스듬히도)', keys: 'K', run: () => { V.tool = 'slice'; emit(); } }, '-', { head: '고른 컷 나누기' }, ...['cut.splitV', 'cut.splitH', 'cut.split3V', 'cut.split3H', 'cut.split4'].map(id => ({ label: { 'cut.splitV': '좌우 둘로', 'cut.splitH': '위아래 둘로', 'cut.split3V': '좌우 셋으로', 'cut.split3H': '위아래 셋으로', 'cut.split4': '넷으로' }[id], disabled: !(e && e.type === 'panel'), run: () => run(id) }))], ev.clientX, ev.clientY + 14)),
        tb('말풍선', '화면 가운데에 말풍선을 넣고 바로 대사를 적어요. 종류는 오른쪽 견본에서 골라요.', () => addAtCenter('bubble'), 'bubble'),
        tb('글자', '화면 가운데에 글자를 넣고 바로 적어요.', () => addAtCenter('text'), 'text'),
        tb('효과음', '효과음 글자를 견본에서 골라 넣어요. 그림으로 된 효과음은 왼쪽 효과음 탭에 있어요.', ev => showMenu([{ head: '글자로 만드는 효과음' }, ...SFX_PRESETS.map((sp, i) => ({ label: sp.n, run: () => addSfxText(i) }))], ev.clientX, ev.clientY + 14)),
        tb('집중선', '끌어서 집중선을 넣는 도구로 바꿔요.', () => { V.tool = 'lines'; emit(); }, 'lines'),
        tb('펜', '페이지 위에 손으로 그려요 (P).', () => { V.tool = 'pen'; V.penEl = null; emit(); }, 'brush'),
        tb('가리기', '끌어서 흰칠·모자이크·흐리게로 가려요 (X).', () => { V.tool = 'cover'; emit(); }, 'cover'),
        tb('자동 흰칠', '컷 속 그림에서 가릴 곳을 AI가 찾아 그 모양대로 가려요. 그림은 이 컴퓨터 안에서만 처리해요.', ev => showMenu([{ label: '이 페이지의 모든 컷', run: () => censorPanels(false) }, { label: '고른 컷만', disabled: !group().some(o => o.type === 'panel'), run: () => censorPanels(true) }, '-', { label: '이 페이지의 자동 흰칠 지우기', run: clearCensor }, { label: '자동 흰칠 설정…', run: () => run('ai.censorCfg') }], ev.clientX, ev.clientY + 14)),
        h('span.grow'),
        h('label.check', { title: '옮길 때 다른 요소와 페이지의 가장자리·가운데에 달라붙어요. Alt를 누르면 잠깐 꺼져요.' }, h('input', { type: 'checkbox', checked: settings.get('cutSnap') !== false, onchange: ev => settings.set('cutSnap', ev.target.checked) }), '자석'),
        h('button.icon-btn', { title: '작게 (Ctrl+−)', 'aria-label': '작게', onclick: () => zoomBy(1 / 1.25) }, '−'), h('button.btn.small.zoom-pct', { title: '화면에 맞추기 (Ctrl+0)', onclick: () => { V.fitted = null; emit(); } }, Math.round(V.zoom * 100) + '%'), h('button.icon-btn', { title: '크게 (Ctrl++)', 'aria-label': '크게', onclick: () => zoomBy(1.25) }, '+'),
        tb('내보내기', 'PNG·JPG·WebP로, 2배로, 긴 페이지는 세로로 잘라서 저장해요.', exportDialog, 'export', '.primary'));
      tools.replaceChildren(...TOOLS.map(([id, title, key, ic]) => h('button.tool' + (V.tool === id ? '.on' : ''), { title: `${title} (${key})`, 'aria-label': title, 'aria-pressed': String(V.tool === id), onclick: () => { V.tool = id; emit(); } }, icon(ic, 18))));
      empty.hidden = !!pg; cv.hidden = !pg;
      const num = (label, k, o = e, step = 1, lim = {}) => { const i = h('input.num', { type: 'number', value: Math.round((o[k] ?? lim.def ?? 0) * 100) / 100, step, min: lim.min, max: lim.max, 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { o[k] = clamp(v, lim.min ?? -1e6, lim.max ?? 1e6); syncLook(o); commit(label); } } }); return h('label.field', null, h('span.field-name.w', null, label), i); };
      const sel = (label, k, opts, def) => h('label.field', null, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: ev => { e[k] = ev.target.value; syncLook(e); commit(label); } }, opts.map(([v, t]) => h('option', { value: v, selected: (e[k] || def) === v }, t))));
      const chk = (label, k, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: !!e[k], onchange: ev => { e[k] = ev.target.checked; syncLook(e); commit(label); } }), label);
      const col = (label, k, def) => h('label.field', null, h('span.field-name.w', null, label), h('input', { type: 'color', value: e[k] || def, 'aria-label': label, onchange: ev => { e[k] = ev.target.value; syncLook(e); commit(label); } }));
      const textBox = () => [h('label.stack', null, h('span.field-name', null, '대사'), h('textarea.text.area', { rows: 4, 'aria-label': '대사', value: e.text || '', oninput: ev => { e.text = ev.target.value; if (e.auto) fitText(e); draw(); }, onchange: () => commit('대사 고치기') })),
        h('div.field-row', null, num('크기', 'size'), h('label.field', null, h('span.field-name.w', null, '글꼴'), h('select.text', { 'aria-label': '글꼴', onchange: ev => { if (ev.target.value === '\u0000load') { ev.target.value = e.font || ''; loadLocalFonts(); return; } if (ev.target.value === '\u0000file') { ev.target.value = e.font || ''; addFontFile(fam => { e.font = fam; commit('글꼴'); }); return; } e.font = ev.target.value; commit('글꼴'); } }, [...FONTS.map(([v, t]) => h('option', { value: v, selected: (e.font || '') === v }, t)), ...((state.project.fonts || []).length ? [h('optgroup', { label: '이 작업에 넣은 글꼴' }, state.project.fonts.map(f => h('option', { value: `"${f.name}"`, selected: e.font === `"${f.name}"` }, f.name)))] : []), ...(e.font && !FONTS.some(f => f[0] === e.font) && !localFonts().some(n => `"${n}"` === e.font) && !(state.project.fonts || []).some(f => `"${f.name}"` === e.font) ? [h('option', { value: e.font, selected: true }, e.font.replace(/"/g, '').split(',')[0])] : []), ...(localFonts().length ? [h('optgroup', { label: '내 컴퓨터 글꼴' }, localFonts().map(n => h('option', { value: `"${n}"`, selected: e.font === `"${n}"` }, n)))] : []), h('option', { value: '\u0000file' }, '글꼴 파일 넣기… (TTF·OTF·WOFF)'), h('option', { value: '\u0000load' }, localFonts().length ? '컴퓨터 글꼴 다시 불러오기…' : '내 컴퓨터 글꼴 불러오기…')]))),
        h('div.field-row', null, col('글자색', 'color', '#111111'), h('label.check', null, h('input', { type: 'checkbox', checked: !!e.bold, onchange: ev => { e.bold = ev.target.checked; commit('굵게'); } }), '굵게')),
        h('label.check', null, h('input', { type: 'checkbox', checked: !!e.vert, onchange: ev => { e.vert = ev.target.checked; commit('세로쓰기'); } }), '세로쓰기')];
      const gallery = () => h('div.bub-grid', { role: 'group', 'aria-label': '말풍선 종류' }, PRESETS.map(pr => {
        const c = h('canvas'), g2 = c.getContext('2d'); c.width = 112; c.height = 80; g2.scale(0.5, 0.5);
        const d = { x: 22, y: 12, w: 180, h: 104, seed: 12, tx: 58, ty: 152, ...pr.props, bw: pr.props.bw * 1.4 }; drawBubbles(g2, [d]);
        g2.fillStyle = d.color; g2.font = '700 38px sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('가', 112, 66);
        return h('button.bub-pre' + ((V.look || PRESETS[0].props) === pr.props ? '.on' : ''), { title: pr.name, 'aria-label': pr.name + ' 말풍선', onclick: () => applyLook(pr.props) }, c);
      }));
      side.replaceChildren(...(!pg ? [h('p.empty', null, '페이지를 만들면 설정이 여기 보여요.')] : !e ? [
        h('h3.sec', null, '페이지'),
        h('label.field', null, h('span.field-name.w', null, '이름'), h('input.text', { type: 'text', value: pg.name, 'aria-label': '페이지 이름', onchange: ev => { pg.name = ev.target.value.trim() || pg.name; commit('페이지 이름'); } })),
        h('label.field', null, h('span.field-name.w', null, '크기'), h('select.text', { 'aria-label': '페이지 크기', onchange: ev => { const s = SIZES[+ev.target.value]; if (s) { pg.w = s[0]; pg.h = s[1]; V.fitted = null; commit('페이지 크기'); } } }, [h('option', { value: -1, selected: true }, `${pg.w} × ${pg.h}`), ...SIZES.map(([, , t], i) => h('option', { value: i }, t))])),
        h('div.field-row', null, num('폭', 'w', pg, 10, { min: 64, max: 8000 }), num('높이', 'h', pg, 10, { min: 64, max: 60000 })),
        h('label.field', null, h('span.field-name.w', null, '바탕'), h('input', { type: 'color', value: pg.bg || '#ffffff', 'aria-label': '바탕색', onchange: ev => { pg.bg = ev.target.value; commit('바탕색'); } })),
        h('div.btn-row', null, h('button.btn.small', { title: '웹툰처럼 아래로 이어 그릴 때 써요', onclick: () => { pg.h += 1000; commit('아래로 늘리기'); } }, '아래로 1000px 늘리기'), h('button.btn.small', { title: '맨 아래 요소 바로 밑까지만 남겨요', disabled: !pg.els.length, onclick: () => { pg.h = Math.max(64, Math.round(contentBottom(pg) + Math.min(pg.w, 1600) * 0.04)); V.fitted = null; commit('내용 끝에 맞춰 줄이기'); } }, '내용 끝에 맞춰 줄이기')),
        h('div.btn-row', null, h('button.btn.small', { onclick: stackDialog }, '세로로 자동 배치…'), h('button.btn.small', { onclick: () => run('cut.auto'), disabled: !picked.size, title: '보관함에서 고른 그림 수만큼 컷을 나눈 새 페이지를 만들어요' }, '고른 그림으로 컷 채우기')),
        h('label.field', { title: '선으로 자르거나 컷을 나눌 때 컷 사이를 띄우는 너비예요' }, h('span.field-name.w', null, '컷 사이 간격'), h('input.num', { type: 'number', min: 0, max: 400, value: settings.get('cutGap') ?? 12, 'aria-label': '컷 사이 간격', onchange: ev => settings.set('cutGap', clamp(parseFloat(ev.target.value) || 0, 0, 400)) })),
        h('h3.sec', null, '내보내기와 번역'),
        h('div.btn-row', null, h('button.btn.small', { onclick: exportDialog }, '내보내기…'), h('button.btn.small', { onclick: () => run('cut.export') }, '이 페이지 PNG'), h('button.btn.small', { onclick: () => run('cut.exportAll') }, '모든 페이지 저장')),
        h('div.btn-row', null, h('button.btn.small', { onclick: () => run('cut.translate') }, '대사 번역…'), h('button.btn.small', { onclick: () => run('cut.sfx') }, '효과음 넣기')),
        h('h3.sec', null, '요소 목록'),
        pg.els.length ? h('div.el-list', { role: 'list' }, [...pg.els].reverse().map(o => h('div.el-row' + (o.hide ? '.off' : ''), { role: 'listitem' },
          h('button.icon-btn' + (o.hide ? '' : '.on'), { title: o.hide ? '보이기' : '숨기기', 'aria-label': `${nameOf(o)} ${o.hide ? '보이기' : '숨기기'}`, 'aria-pressed': String(!o.hide), onclick: () => { o.hide = !o.hide; if (!o.hide) delete o.hide; commit(o.hide ? '숨기기' : '보이기'); } }, icon('eye')),
          h('button.el-name', { title: '눌러서 고르기', onclick: () => { V.sel = o.id; V.more = null; emit(); } }, h('small', null, TYPE_NAME[o.type] || ''), nameOf(o)),
          h('button.icon-btn' + (o.lock ? '.on' : ''), { title: o.lock ? '잠금 풀기' : '잠그기 (그림판에서 눌러도 안 골라져요)', 'aria-label': `${nameOf(o)} ${o.lock ? '잠금 풀기' : '잠그기'}`, 'aria-pressed': String(!!o.lock), onclick: () => { o.lock = !o.lock; if (!o.lock) delete o.lock; commit(o.lock ? '잠그기' : '잠금 풀기'); } }, icon('lock'))))) : h('p.panel-note', null, '아직 요소가 없어요.'),
        h('h3.sec', null, '새 말풍선 종류'), gallery(),
        h('p.panel-note', null, '종류를 고른 뒤 말풍선 도구(B)로 끌거나 눌러서 놓아요. 요소를 누르면 그 요소의 설정이 보여요. 보관함 그림은 페이지 아무 데나 끌어다 놓으면 컷이 되고, 컷 위에 놓으면 그 컷에 담겨요. 보관함에서 두 번 눌러도 돼요.'),
      ] : [
        h('h3.sec', null, TYPE_NAME[e.type]),
        ...(e.type === 'panel' ? [h('div.field-row', null, num('테두리', 'bw', e, 1, { min: 0, max: 80 }), col('테두리색', 'bc', '#111111')),
          h('div.field-row', null, num('모서리', 'br', e, 2, { min: 0, max: 2000 }), h('label.check', { title: '그림이 비치거나 모자란 곳에 깔리는 색이에요' }, h('input', { type: 'checkbox', checked: !!e.bgc, 'aria-label': '바탕 칠하기', onchange: ev => { e.bgc = ev.target.checked ? '#ffffff' : ''; commit('바탕 칠하기'); } }), e.bgc ? h('input', { type: 'color', value: e.bgc, 'aria-label': '바탕색', onchange: ev => { e.bgc = ev.target.value; commit('바탕색'); } }) : '바탕 칠하기')),
          h('h3.sec', null, '컷 안의 그림'),
          h('div.btn-row', null, h('button.btn.small', { disabled: !e.mediaId, title: '컷을 빈틈없이 채워요', onclick: () => { Object.assign(e, { ix: 0, iy: 0, is: 1 }); commit('꽉 채우기'); } }, '꽉 채우기'), h('button.btn.small', { disabled: !e.mediaId, title: '그림 전체가 컷 안에 보이게 줄여요', onclick: () => { const m = mediaOf(e.mediaId); if (!m) return; Object.assign(e, { ix: 0, iy: 0, is: Math.min(e.w / m.w, e.h / m.h) / Math.max(e.w / m.w, e.h / m.h) }); commit('전체 보이기'); } }, '전체 보이기'), h('button.btn.small', { disabled: !e.mediaId, title: '컷을 그림 비율에 맞춰요 (폭은 그대로)', onclick: () => { const m = mediaOf(e.mediaId); if (!m) return; e.h = Math.round(e.w * m.h / m.w); Object.assign(e, { ix: 0, iy: 0, is: 1 }); commit('그림 비율로'); } }, '그림 비율로')),
          e.mediaId && h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '확대 %'), h('input.num', { type: 'number', min: 5, max: 800, step: 5, value: Math.round((e.is || 1) * 100), 'aria-label': '확대', onchange: ev => { e.is = clamp((parseFloat(ev.target.value) || 100) / 100, 0.05, 8); commit('컷 안 그림 크기'); } })), num('그림 회전', 'ir', e, 1, { min: -180, max: 180 })),
          e.mediaId && h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '진하기 %'), h('input.num', { type: 'number', min: 0, max: 100, step: 5, value: Math.round((e.io ?? 1) * 100), 'aria-label': '그림 진하기', onchange: ev => { e.io = clamp((parseFloat(ev.target.value) || 0) / 100, 0, 1); commit('그림 진하기'); } })), chk('좌우 뒤집기', 'ifx')),
          h('div.btn-row', null, h('button.btn.small' + (V.pan === e.id ? '.primary' : ''), { disabled: !e.mediaId, title: '켜 두면 컷 안의 그림을 끌어 옮기고 휠로 키워요. 컷을 두 번 눌러도 돼요.', onclick: () => { V.pan = V.pan === e.id ? null : e.id; emit(); } }, V.pan === e.id ? '그림 옮기기 끝내기' : '그림 옮기기'), h('button.btn.small', { disabled: !e.mediaId, onclick: () => { e.mediaId = null; commit('그림 빼기'); } }, '그림 빼기')),
          e.poly && h('div.btn-row', null, h('button.btn.small', { title: '선으로 잘라 비스듬해진 컷을 다시 네모로 만들어요', onclick: () => { delete e.poly; commit('사각형으로 되돌리기'); } }, '사각형으로 되돌리기')),
          h('h3.sec', null, '분위기와 효과'),
          h('label.field', null, h('span.field-name.w', null, '분위기'), h('select.text', { 'aria-label': '분위기', onchange: ev => { const m = MOODS[+ev.target.value]; if (!m) return; FX_KEYS.forEach(k => { delete e[k]; }); Object.assign(e, m[1]); commit('분위기: ' + m[0]); } }, [h('option', { value: -1, selected: true }, hasFx(e) ? '고쳐 쓰는 중' : '없음'), ...MOODS.map(([n], i) => h('option', { value: i }, n))])),
          h('details.sec-fold', { open: hasFx(e) }, h('summary', null, '보정·톤·효과선 직접 맞추기'),
            h('div.field-row', null, num('밝기', 'bright', e, 5, { min: 20, max: 200, def: 100 }), num('대비', 'contrast', e, 5, { min: 20, max: 200, def: 100 })),
            h('div.field-row', null, num('채도', 'saturate', e, 5, { min: 0, max: 200, def: 100 }), num('흐림', 'blur', e, 0.5, { min: 0, max: 20 })),
            h('div.field-row', null, chk('흑백', 'gray'), num('빛바랜 색', 'sepia', e, 5, { min: 0, max: 100 })),
            h('div.field-row', null, chk('색 입히기', 'tintOn'), e.tintOn ? col('입힐 색', 'tintColor', FX.tintColor) : h('span')),
            e.tintOn ? h('div.field-row', null, num('색 세기', 'tintA', e, 5, { min: 0, max: 100, def: FX.tintA }), sel('섞는 법', 'tintMode', [['multiply', '어둡게'], ['screen', '밝게'], ['soft-light', '은은하게'], ['source-over', '덮기']], 'multiply')) : null,
            h('div.field-row', null, chk('한쪽에서 물들이기', 'gradOn'), e.gradOn ? col('물들일 색', 'gradColor', FX.gradColor) : h('span')),
            e.gradOn ? h('div.field-row', null, sel('어느 쪽', 'gradDir', [['bottom', '아래'], ['top', '위'], ['left', '왼쪽'], ['right', '오른쪽']], 'bottom'), num('물드는 세기', 'gradA', e, 5, { min: 0, max: 100, def: FX.gradA })) : null,
            h('div.field-row', null, chk('가장자리 어둡게', 'vigOn'), e.vigOn ? col('가장자리 색', 'vigColor', FX.vigColor) : h('span')),
            e.vigOn ? h('div.field-row', null, num('가장자리 세기', 'vigA', e, 5, { min: 0, max: 100, def: FX.vigA }), num('가운데 크기', 'vigSize', e, 5, { min: 10, max: 100, def: FX.vigSize })) : null,
            h('div.field-row', null, chk('스크린톤', 'toneOn'), e.toneOn ? sel('톤 무늬', 'toneType', [['dot', '망점'], ['line', '줄'], ['cross', '그물'], ['sand', '모래']], 'dot') : h('span')),
            e.toneOn ? h('div.field-row', null, num('톤 간격', 'toneGap', e, 1, { min: 3, max: 60, def: FX.toneGap }), num('톤 굵기', 'toneSize', e, 5, { min: 5, max: 100, def: FX.toneSize })) : null,
            e.toneOn ? h('div.field-row', null, num('톤 세기', 'toneA', e, 5, { min: 0, max: 100, def: FX.toneA }), sel('옅어지는 쪽', 'toneFade', [['none', '고르게'], ['top', '위로 갈수록'], ['bottom', '아래로 갈수록'], ['left', '왼쪽으로'], ['right', '오른쪽으로'], ['center', '가운데로'], ['edge', '가장자리로']], 'none')) : null,
            h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '효과선'), h('select.text', { 'aria-label': '효과선', onchange: ev => { const v = ev.target.value; if (v) { e.lineOn = true; e.lineType = v; } else delete e.lineOn; commit('효과선'); } }, [['', '없음'], ['focus', '집중선'], ['speed', '속도선']].map(([v, t]) => h('option', { value: v, selected: (e.lineOn ? (e.lineType || 'focus') : '') === v }, t)))), e.lineOn ? col('선 색', 'lineColor', FX.lineColor) : h('span')),
            e.lineOn ? h('div.field-row', null, num('선 수', 'lineN', e, 10, { min: 4, max: 600, def: FX.lineN }), num('선 굵기', 'lineW', e, 1, { min: 1, max: 30, def: FX.lineW })) : null,
            e.lineOn ? h('div.field-row', null, num('가운데 비움', 'lineIn', e, 5, { min: 0, max: 95, def: FX.lineIn }), (e.lineType || 'focus') === 'speed' ? num('선 방향', 'lineAng', e, 15, { min: -180, max: 180 }) : num('선 세기', 'lineA', e, 5, { min: 0, max: 100, def: FX.lineA })) : null,
            h('div.btn-row', null, h('button.btn.small', { title: '이 컷의 분위기와 효과를 기억해 둬요', onclick: () => { V.fxClip = Object.fromEntries(FX_KEYS.filter(k => e[k] !== undefined).map(k => [k, e[k]])); toast('이 컷의 효과를 복사했어요. 다른 컷을 고르고 붙여넣으세요.'); emit(); } }, '효과 복사'), h('button.btn.small', { disabled: !V.fxClip, onclick: () => { for (const o of group().filter(x => x.type === 'panel')) { FX_KEYS.forEach(k => { delete o[k]; }); Object.assign(o, V.fxClip); } commit('효과 붙여넣기'); } }, '효과 붙여넣기'), h('button.btn.small', { disabled: !hasFx(e), onclick: () => { FX_KEYS.forEach(k => { delete e[k]; }); commit('효과 없애기'); } }, '효과 없애기'))),
        h('p.panel-note', null, '컷을 두 번 누르면 그림 옮기기로 들어가요(빈 컷이면 그림을 골라요). Alt를 누른 채 끌거나 휠을 돌려도 돼요.')] : []),
        ...(e.type === 'pic' ? [h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '진하기 %'), h('input.num', { type: 'number', min: 0, max: 100, step: 5, value: Math.round((e.op ?? 1) * 100), 'aria-label': '진하기', onchange: ev => { e.op = clamp((parseFloat(ev.target.value) || 0) / 100, 0, 1); commit('진하기'); } })), chk('좌우 뒤집기', 'fx')),
          h('div.field-row', null, h('label.check', { title: '효과음 그림의 색을 한 가지 색으로 바꿔요' }, h('input', { type: 'checkbox', checked: !!e.tint, 'aria-label': '색 입히기', onchange: ev => { e.tint = ev.target.checked ? '#e0458f' : ''; commit('색 입히기'); } }), e.tint ? h('input', { type: 'color', value: e.tint, 'aria-label': '입힐 색', onchange: ev => { e.tint = ev.target.value; commit('색 입히기'); } }) : '색 입히기'), num('테두리', 'ol', e, 1, { min: 0, max: 10 })),
          e.ol ? h('div.field-row', null, col('테두리색', 'olc', '#ffffff')) : null,
          h('div.btn-row', null, h('button.btn.small', { title: '그림의 원래 비율로 되돌려요 (폭은 그대로)', onclick: () => { const m = mediaOf(e.mediaId); if (m) { e.h = Math.round(e.w * m.h / m.w); commit('원래 비율로'); } } }, '원래 비율로')),
          h('p.panel-note', null, '모서리를 끌면 비율을 지킨 채 커져요. Shift를 누르면 자유롭게 늘어나요.')] : []),
        ...(e.type === 'bubble' ? [gallery(), ...textBox(),
          h('label.check', { title: '대사를 적는 동안 말풍선 크기가 글자에 맞춰 저절로 바뀌어요' }, h('input', { type: 'checkbox', checked: !!e.auto, onchange: ev => { e.auto = ev.target.checked; if (e.auto) fitText(e); else delete e.auto; commit('글자에 맞춰 크기 자동 조절'); } }), '글자에 맞춰 크기 자동 조절'),
          h('div.btn-row', null, h('button.btn.small', { title: '대사가 넉넉히 들어가게 말풍선 크기를 맞춰요', onclick: () => run('cut.fitText') }, '글자에 맞추기'), h('button.btn.small', { title: '같은 모양을 손으로 다시 그린 것처럼 조금 다르게 그려요', onclick: () => run('cut.reseed') }, '다르게 그리기')),
          h('h3.sec', null, '모양과 선'),
          h('div.field-row', null, sel('모양', 'shape', SHAPES, 'ellipse'), sel('선', 'line', LINES, 'pen')),
          h('div.field-row', null, num('굵기', 'bw', e, 0.5, { min: 0, max: 80, def: 3 }), col('선 색', 'bc', '#111111')),
          h('div.field-row', null, col('바탕색', 'fill', '#ffffff'), h('label.check', { title: '아래로 갈수록 다른 색으로 물들어요' }, h('input', { type: 'checkbox', checked: !!e.fill2, 'aria-label': '아래쪽 색 쓰기', onchange: ev => { e.fill2 = ev.target.checked ? '#ffd3e4' : ''; syncLook(e); commit('아래쪽 색'); } }), e.fill2 ? h('input', { type: 'color', value: e.fill2, 'aria-label': '아래쪽 색', onchange: ev => { e.fill2 = ev.target.value; syncLook(e); commit('아래쪽 색'); } }) : '아래쪽 색')),
          h('div.field-row', null, num('진하기 %', 'fop', e, 5, { min: 0, max: 100, def: 100 }), num('번짐', 'soft', e, 1, { min: 0, max: 40 })),
          h('div.field-row', null, num('손맛 %', 'wob', e, 5, { min: 0, max: 100, def: 40 }), num('그림자', 'sh', e, 1, { min: -60, max: 60 })),
          chk('겹줄 (안쪽에 가는 선 하나 더)', 'dbl'),
          h('h3.sec', null, '꼬리'),
          h('div.field-row', null, chk('꼬리', 'tail'), sel('종류', 'tailKind', TAILS, e.shape === 'cloud' ? 'dots' : 'point')),
          h('div.field-row', null, num('굵기 %', 'tailW', e, 2, { min: 4, max: 70, def: 20 }), num('휘어짐', 'tailBend', e, 5, { min: -100, max: 100, def: 28 })),
          h('p.panel-note', null, '꼬리 끝의 노란 점을 끌어 말하는 사람 쪽으로 돌려요. 말풍선 여럿을 Shift로 함께 고르면 이어 붙일 수 있어요.'),
          (group().filter(isB).length > 1 || e.join) && h('div.btn-row', null, h('button.btn.small', { disabled: group().filter(isB).length < 2, onclick: () => run('cut.join') }, '이어 붙이기'), h('button.btn.small', { disabled: !e.join, onclick: () => run('cut.unjoin') }, '떼어 내기'))] : []),
        ...(e.type === 'draw' ? [h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '색'), h('input', { type: 'color', value: e.color || '#111111', 'aria-label': '펜 색', onchange: ev => { e.color = ev.target.value; settings.set('cutPen', { ...(settings.get('cutPen') || {}), color: e.color }); commit('펜 색'); } })), h('label.field', null, h('span.field-name.w', null, '굵기'), h('input.num', { type: 'number', min: 1, max: 200, value: e.size || 6, 'aria-label': '펜 굵기', onchange: ev => { e.size = clamp(parseFloat(ev.target.value) || 6, 1, 200); settings.set('cutPen', { ...(settings.get('cutPen') || {}), size: e.size }); commit('펜 굵기'); } }))),
          h('div.field-row', null, num('테두리', 'ol', e, 1, { min: 0, max: 60 }), col('테두리색', 'olc', '#ffffff')),
          h('div.btn-row', null, h('button.btn.small', { disabled: (e.strokes || []).length < 2, title: '마지막에 그은 획을 지워요', onclick: () => { e.strokes.pop(); commit('마지막 획 지우기'); } }, '마지막 획 지우기')),
          h('p.panel-note', null, '펜 도구(P)로 이어서 그으면 이 그림에 더해져요. 새 그림으로 시작하려면 다른 곳을 눌러 고른 것을 풀어요.')] : []),
        ...(e.type === 'cover' ? [h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '가리는 법'), h('select.text', { 'aria-label': '가리는 법', onchange: ev => { e.kind = ev.target.value; settings.set('cutCover', { ...(settings.get('cutCover') || {}), kind: e.kind }); commit('가리는 법'); } }, [['mosaic', '모자이크'], ['blur', '흐리게'], ['white', '흰칠 (색)']].map(([v, t]) => h('option', { value: v, selected: (e.kind || 'white') === v }, t)))),
            h('label.field', null, h('span.field-name.w', null, '모양'), h('select.text', { 'aria-label': '가리기 모양', onchange: ev => { e.shape = ev.target.value; settings.set('cutCover', { ...(settings.get('cutCover') || {}), shape: e.shape }); commit('가리기 모양'); } }, [['rect', '네모'], ['ellipse', '타원']].map(([v, t]) => h('option', { value: v, selected: (e.shape || 'rect') === v }, t))))),
          e.kind === 'white' ? h('div.field-row', null, col('색', 'color', '#ffffff')) : num('세기', 'str', e, 2, { min: 4, max: 120, def: 18 }),
          h('p.panel-note', null, '가리기 도구(X)는 끌 때마다 하나씩 생겨요. 모자이크와 흐리게는 그 밑에 있는 그림을 가려요.')] : []),
        ...(e.type === 'lines' ? [h('div.field-row', null, num('선 수', 'count'), num('굵기', 'thick', e, 0.1)), h('div.field-row', null, num('가운데 빈 곳 %', 'hole'), col('색', 'color', '#111111')), h('div.btn-row', null, h('button.btn.small', { onclick: () => { e.seed = 1 + Math.floor(Math.random() * 99999); commit('집중선 다시 뿌리기'); } }, '다르게 뿌리기'))] : []),
        ...(e.type === 'text' ? [
          h('div.bub-grid.txt-grid', { role: 'group', 'aria-label': '글자 모양' }, [...TEXT_STYLES, ...SFX_PRESETS].map((st, i) => {
            const c = h('canvas'), g2 = c.getContext('2d'); c.width = 112; c.height = 64; const smp = { id: 'th' + i, text: st.text || '가나', size: 40, color: '#111111', sc: '#ffffff', sw: 3, bold: true, ...st.p, ...(st.p.size ? { size: 40, sw: Math.round((st.p.sw || 0) * 40 / st.p.size), sw2: Math.round((st.p.sw2 || 0) * 40 / st.p.size) } : {}), vert: false, arc: st.p.arc ? 30 : 0 };
            g2.save(); g2.translate(56, 32); g2.scale(0.9, 0.9); try { drawLettering(g2, smp, 0, 0); } catch (_) { /* 견본만 비어요 */ } g2.restore();
            return h('button.bub-pre', { title: st.n + (st.text ? ' (효과음)' : ''), 'aria-label': st.n + ' 글자 모양', onclick: () => applyTextLook(st.text ? st.p : { ...st.p }) }, c); })),
          ...textBox(),
          h('div.field-row', null, chk('기울임', 'italic'), sel('정렬', 'align', [['center', '가운데'], ['left', '왼쪽'], ['right', '오른쪽']], 'center')),
          h('div.field-row', null, num('줄 간격', 'lh', e, 0.05, { min: 0.6, max: 3, def: 1.3 }), num('글자 간격', 'sp', e, 1, { min: -40, max: 200 })),
          h('details.sec-fold', { open: true }, h('summary', null, '테두리와 색'),
            h('div.field-row', null, num('테두리', 'sw', e, 1, { min: 0, max: 80 }), col('테두리색', 'sc', '#ffffff')),
            h('div.field-row', null, num('바깥 테두리', 'sw2', e, 1, { min: 0, max: 80 }), col('바깥색', 'sc2', '#111111')),
            h('div.field-row', null, chk('색 번짐', 'fillGrad'), e.fillGrad ? col('끝 색', 'fill2', '#ffb300') : h('span')),
            e.fillGrad ? sel('번지는 방향', 'gradDir', [['v', '위에서 아래로'], ['h', '왼쪽에서 오른쪽으로']], 'v') : null,
            num('진하기 %', 'op', e, 5, { min: 0, max: 100, def: 100 })),
          h('details.sec-fold', { open: !!(e.jit || e.grow || e.skew || e.rough || e.arc || e.ext) }, h('summary', null, '효과음 모양'),
            h('div.field-row', null, num('흔들림', 'jit', e, 5, { min: 0, max: 100 }), num('점점 크게', 'grow', e, 5, { min: -80, max: 80 })),
            h('div.field-row', null, num('기울기', 'skew', e, 2, { min: -45, max: 45 }), num('거칠게', 'rough', e, 5, { min: 0, max: 100 })),
            h('div.field-row', null, num('휘기', 'arc', e, 5, { min: -100, max: 100 }), num('입체', 'ext', e, 2, { min: 0, max: 60 })),
            e.ext ? h('div.field-row', null, num('입체 방향', 'extAng', e, 15, { min: 0, max: 360 }), col('입체 색', 'extColor', '#111111')) : null,
            h('div.btn-row', null, h('button.btn.small', { title: '흔들림과 거친 모양을 다르게 뽑아요', onclick: () => { e.seed = 1 + Math.floor(Math.random() * 9999); commit('다르게 흔들기'); } }, '다르게 흔들기'))),
          h('details.sec-fold', { open: !!(e.glow || e.shA || e.boxOn) }, h('summary', null, '후광·그림자·배경 띠'),
            h('div.field-row', null, num('후광', 'glow', e, 5, { min: 0, max: 100 }), col('후광 색', 'glowColor', '#ffe25c')),
            h('div.field-row', null, num('그림자 %', 'shA', e, 5, { min: 0, max: 100 }), col('그림자 색', 'shColor', '#000000')),
            e.shA ? h('div.field-row', null, num('거리', 'shDist', e, 1, { min: 0, max: 60, def: 6 }), num('번짐', 'shBlur', e, 1, { min: 0, max: 60, def: 12 })) : null,
            h('div.field-row', null, chk('배경 띠', 'boxOn'), e.boxOn ? col('띠 색', 'boxColor', '#000000') : h('span')),
            e.boxOn ? h('div.field-row', null, num('띠 진하기', 'boxA', e, 5, { min: 0, max: 100, def: 65 }), num('띠 여백', 'boxPad', e, 5, { min: 0, max: 120, def: 30 })) : null)] : []),
        ...(e.type === 'bubble' || e.type === 'text' ? [h('div.btn-row', null, h('button.btn.small', { title: '고른 대사만 제미나이로 번역하거나 다듬어요', onclick: ev => showMenu(LANGS.map(([v, t]) => ({ label: t, run: () => translateOne(v) })), ev.clientX, ev.clientY + 14) }, 'AI로 번역·다듬기…'))] : []),
        ...(e.type === 'bubble' || e.type === 'text' ? [h('h3.sec', null, '모양 묶음'),
          h('div.btn-row', null, h('select.text', { 'aria-label': '모양 묶음', style: 'flex:1;width:auto', onchange: ev => { const st = styles().filter(x => x.type === e.type)[+ev.target.value]; if (st) { Object.assign(e, st.props); commit('모양 묶음 입히기'); } } }, [h('option', { value: -1, selected: true }, styles().some(x => x.type === e.type) ? '저장한 모양 고르기' : '저장한 모양이 없어요'), ...styles().filter(x => x.type === e.type).map((x, i) => h('option', { value: i }, x.name))]),
            h('button.btn.small', { title: '지금 이 요소의 글자 크기·색·테두리·모양을 이름 붙여 저장해요', onclick: async () => { const name = await askText('모양 묶음 이름', e.type === 'bubble' ? '기본 말풍선' : '기본 글자', '저장'); if (!name) return; const props = {}; STYLE_KEYS[e.type].forEach(k => { if (e[k] !== undefined) props[k] = e[k]; }); settings.set('cutStyles', [...styles().filter(x => !(x.type === e.type && x.name === name)), { name, type: e.type, props }]); emit(); toast(`'${name}' 모양을 저장했어요.`); } }, '지금 모양 저장'))] : []),
        h('h3.sec', null, '자리'),
        h('div.btn-row', { role: 'group', 'aria-label': '정렬' }, [['l', '왼쪽'], ['cx', '가로 가운데'], ['r', '오른쪽'], ['t', '위'], ['cy', '세로 가운데'], ['b', '아래']].map(([k, t]) => h('button.btn.small', { title: group().length > 1 ? '고른 것들을 서로 ' + t + '에 맞춰요' : '페이지의 ' + t + '에 맞춰요', onclick: () => alignSel(k) }, t))),
        group().length > 2 && h('div.btn-row', null, h('button.btn.small', { onclick: () => distributeSel('x') }, '가로 간격 똑같이'), h('button.btn.small', { onclick: () => distributeSel('y') }, '세로 간격 똑같이')),
        e.type === 'panel' && h('div.btn-row', null, h('button.btn.small', { title: '옆 여백 없이 페이지 폭에 꽉 채워요', onclick: () => { const k = pg.w / e.w; e.x = 0; e.w = pg.w; e.h = Math.round(e.h * k); commit('페이지 폭 꽉 채우기'); } }, '페이지 폭 꽉 채우기')),
        h('div.field-row', null, num('X', 'x'), num('Y', 'y')), h('div.field-row', null, num('회전', 'rot')), e.type !== 'text' && h('div.field-row', null, num('가로', 'w'), num('세로', 'h')),
        h('div.btn-row', null, h('button.btn.small', { onclick: () => run('cut.front') }, '맨 앞'), h('button.btn.small', { onclick: () => run('cut.forward') }, '앞으로'), h('button.btn.small', { onclick: () => run('cut.backward') }, '뒤로'), h('button.btn.small', { onclick: () => run('cut.back') }, '맨 뒤'), h('span.grow'), h('button.icon-btn', { title: '지우기', 'aria-label': '지우기', onclick: () => run('cut.delete') }, icon('trash'))),
      ].filter(Boolean)));
      strip.replaceChildren(...pages().map((p, i) => { const t = h('canvas.cut-thumb'); t.width = 96; t.height = Math.max(24, Math.round(96 * p.h / p.w)); const g = t.getContext('2d'); g.scale(96 / p.w, 96 / p.w); renderPage(g, p);
        return h('button.cut-page' + (p.id === (pg || {}).id ? '.on' : ''), { title: p.name, 'aria-pressed': String(p.id === (pg || {}).id), onclick: () => { state.project.activePage = p.id; V.sel = null; emit(); },
          oncontextmenu: ev => { ev.preventDefault(); state.project.activePage = p.id; emit(); showMenu([{ label: '앞으로 옮기기', disabled: i === 0, run: () => { pages().splice(i, 1); pages().splice(i - 1, 0, p); commit('페이지 옮기기'); } }, { label: '뒤로 옮기기', disabled: i === pages().length - 1, run: () => { pages().splice(i, 1); pages().splice(i + 1, 0, p); commit('페이지 옮기기'); } }, { label: '복제', run: () => run('cut.dupPage') }, '-', { label: '페이지 지우기', run: () => run('cut.deletePage') }], ev.clientX, ev.clientY); } }, t, h('span', null, String(i + 1))); }),
        pages().length ? h('button.cut-add', { title: '새 페이지', 'aria-label': '새 페이지', onclick: ev => showMenu(LAYOUTS.map(([k, t]) => ({ label: t, run: () => { const c = pageOf(); newPage(c.w, c.h, k); commit('새 페이지'); } })), ev.clientX, ev.clientY - 150) }, icon('plus', 18)) : '');
      strip.hidden = !pages().length;
      if (pg && V.fitted !== pg.id) fit(); else draw();
    };
    update();
    return { update, destroy: () => { ro.disconnect(); cv = null; wrap = null; } };
  },
  status() { const pg = pageOf(), e = elOf(); return pg ? [`${pg.w} × ${pg.h}`, `${pages().indexOf(pg) + 1} / ${pages().length}쪽`, e ? TYPE_NAME[e.type] : ''].filter(Boolean) : []; },
  hint: () => pageOf() ? (TOOLS.find(t => t[0] === V.tool) || TOOLS[0])[4] : '컷 나누기를 골라 첫 페이지를 만들어요.',
  zoomText: () => pageOf() ? Math.round(V.zoom * 100) + '%' : '',
};

export const pick = id => { V.sel = id; V.more = null; emit(); };   // 요소 하나를 골라요
export const sel = () => V.sel;
export const view = () => ({ zoom: V.zoom, ox: V.ox, oy: V.oy });
export const selected = () => group().map(e => e.id);
export function registerCutCmds() {
  const on = () => !!cv && !!pageOf(), has = () => on() && !!elOf();
  const order = front => { const pg = pageOf(), g = group(), rest = pg.els.filter(e => !g.includes(e)), mine = pg.els.filter(e => g.includes(e)); pg.els = front ? [...rest, ...mine] : [...mine, ...rest]; commit(front ? '맨 앞으로' : '맨 뒤로'); };
  const step = d => { const pg = pageOf(), g = new Set(group()), a = pg.els; if (d > 0) { for (let i = a.length - 2; i >= 0; i--) if (g.has(a[i]) && !g.has(a[i + 1])) [a[i], a[i + 1]] = [a[i + 1], a[i]]; } else for (let i = 1; i < a.length; i++) if (g.has(a[i]) && !g.has(a[i - 1])) [a[i], a[i - 1]] = [a[i - 1], a[i]]; commit(d > 0 ? '앞으로' : '뒤로'); };
  addCmd({ id: 'cut.forward', title: '앞으로', menu: '컷', group: 'el', keys: 'Ctrl+]', enabled: has, run: () => step(1) });
  addCmd({ id: 'cut.backward', title: '뒤로', menu: '컷', group: 'el', keys: 'Ctrl+[', enabled: has, run: () => step(-1) });
  addCmd({ id: 'cut.selectAll', title: '모두 고르기', menu: '컷', group: 'el', keys: 'Ctrl+A', enabled: on, run: () => { setSel(pageOf().els.map(e => e.id)); emit(); } });
  addCmd({ id: 'cut.cutEl', title: '요소 잘라내기', menu: '컷', group: 'el', keys: 'Ctrl+X', enabled: has, run: () => { clip = group().map(e => JSON.parse(JSON.stringify(e))); run('cut.delete'); } });
  addCmd({ id: 'cut.exportDlg', title: '내보내기… (파일 종류·크기·잘라 저장)', menu: '컷', group: 'out', words: 'jpg webp 2배 슬라이스 웹툰', enabled: on, run: exportDialog });
  addCmd({ id: 'cut.stack', title: '세로로 자동 배치… (웹툰)', menu: '컷', group: 'page', enabled: on, run: stackDialog });
  addCmd({ id: 'cut.newPage', title: '새 페이지', menu: '컷', enabled: () => !!cv, run: () => { const c = pageOf(); newPage(c ? c.w : 800, c ? c.h : 1280, '1'); commit('새 페이지'); } });
  addCmd({ id: 'cut.dupPage', title: '페이지 복제', menu: '컷', enabled: on, run: () => { const pg = pageOf(), n = JSON.parse(JSON.stringify(pg)); n.id = uid('g'); n.name = pg.name + ' 복사'; n.els.forEach(e => { e.id = uid('e'); }); pages().splice(pages().indexOf(pg) + 1, 0, n); state.project.activePage = n.id; commit('페이지 복제'); } });
  addCmd({ id: 'cut.deletePage', title: '페이지 지우기', menu: '컷', enabled: on, run: () => { const pg = pageOf(), i = pages().indexOf(pg); pages().splice(i, 1); state.project.activePage = (pages()[Math.min(i, pages().length - 1)] || {}).id || null; V.sel = null; V.fitted = null; commit('페이지 지우기'); } });
  addCmd({ id: 'cut.front', title: '맨 앞으로', menu: '컷', group: 'el', enabled: has, run: () => order(true) });
  addCmd({ id: 'cut.back', title: '맨 뒤로', menu: '컷', group: 'el', enabled: has, run: () => order(false) });
  // 묶기: 묶은 요소들은 하나를 누르면 함께 골라지고 함께 움직여요
  addCmd({ id: 'cut.group', title: '고른 요소 묶기', menu: '컷', group: 'el', keys: 'Ctrl+G', enabled: () => group().length > 1, run: () => { const id = uid('g'); group().forEach(e => { e.gid = id; }); commit('요소 묶기'); } });
  addCmd({ id: 'cut.ungroup', title: '묶음 풀기', menu: '컷', group: 'el', keys: 'Ctrl+Shift+G', enabled: () => group().some(e => e.gid), run: () => { group().forEach(e => { delete e.gid; }); commit('묶음 풀기'); } });
  addCmd({ id: 'cut.snap', title: '자석 (옮길 때 맞춰 붙기)', menu: '컷', group: 'view', checked: () => settings.get('cutSnap') !== false, run: () => settings.set('cutSnap', settings.get('cutSnap') === false) });
  // 스티커: 보관함에서 고른 그림을 페이지에 자유롭게 놓아요 (효과음 그림 등)
  addCmd({ id: 'cut.addPic', title: '보관함에서 고른 그림을 스티커로 넣기', menu: '컷', group: 'el', words: '효과음 이미지 sticker', enabled: () => !!pageOf() && picked.size > 0, run: () => { const pg = pageOf(); let k = 0; for (const id of [...picked].slice(0, 12)) { const m = state.project.media.find(x => x.id === id); if (!m) continue; const w = Math.round(Math.min(pg.w * 0.35, m.w)), hh = Math.round(w * m.h / m.w), n = { id: uid('e'), type: 'pic', mediaId: id, x: Math.round(pg.w / 2 - w / 2 + k * 24), y: Math.round(pg.h / 2 - hh / 2 + k * 24), w, h: hh }; pg.els.push(n); V.sel = n.id; ensureBitmap(id); k++; } commit('스티커 넣기'); } });
  // 효과음 팩: 그림 묶음(ZIP)이나 그림 여러 장을 보관함의 '효과음 팩' 폴더에 넣어요. 거기서 골라 스티커로 넣으면 돼요
  addCmd({ id: 'cut.sfxPack', title: '효과음 팩 넣기… (그림 묶음)', menu: '컷', group: 'el', run: () => { const i = h('input', { type: 'file', accept: '.zip,image/*', multiple: true }); i.onchange = async () => { const b = busy('효과음 팩을 넣는 중이에요.'); let n = 0, bad = 0;
    try { for (const f of i.files) { if (/\.zip$/i.test(f.name)) { const folder = ensureFolder('효과음 팩/' + f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40)), { unzipAll } = await import('../core/files.js'); for (const it of await unzipAll(await f.arrayBuffer())) { if (!/\.(png|webp|jpe?g|gif)$/i.test(it.name)) continue; try { await addMedia(new File([it.data], it.name.split('/').pop(), { type: 'image/' + it.name.split('.').pop().toLowerCase().replace('jpg', 'jpeg') }), folder); n++; } catch (_) { bad++; } } } else { try { await addMedia(f, ensureFolder('효과음 팩')); n++; } catch (_) { bad++; } } }
      commit('효과음 팩 넣기'); b.done(`그림 ${n}장을 보관함의 '효과음 팩' 폴더에 넣었어요. 골라서 컷 메뉴의 스티커로 넣기를 쓰면 돼요.` + (bad ? ` ${bad}장은 열 수 없었어요.` : '')); } catch (e) { b.done(e.message || '넣지 못했어요.', 'err'); } }; i.click(); } });
  // 자동 배치: 보관함에서 고른 그림 수만큼 컷을 알아서 나눠 새 페이지를 만들고 그림을 채워요
  addCmd({ id: 'cut.auto', title: '고른 그림으로 컷 자동 배치', menu: '컷', group: 'page', words: '레이아웃 자동 나누기', enabled: () => picked.size > 0, run: () => { const ms = [...picked].map(id => state.project.media.find(m => m.id === id)).filter(Boolean), ref = pageOf() || { w: 1600, h: 2264 }, PAT = { 1: [1], 2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [2, 1, 2], 6: [2, 2, 2], 7: [2, 3, 2], 8: [3, 2, 3] }; let made = 0;
    for (let s0 = 0; s0 < ms.length; s0 += 8) { const part = ms.slice(s0, s0 + 8), rows = PAT[part.length], pg = { id: uid('g'), name: `${pages().length + 1}쪽`, w: ref.w, h: ref.h, bg: '#ffffff', els: [] }, m = Math.round(Math.min(pg.w, pg.h) * 0.04), gap = Math.round(m * 0.6);
      // 줄 높이는 그 줄 그림들이 세로로 긴 만큼 더 줘요
      let k = 0; const groups = rows.map(n => { const g2 = part.slice(k, k + n); k += n; return g2; }), want = groups.map(g2 => g2.reduce((a, x) => a + x.h / x.w, 0) / g2.length / g2.length), sum = want.reduce((a, v) => a + v, 0), H = pg.h - 2 * m - gap * (rows.length - 1); let y = m;
      groups.forEach((g2, r) => { const rh = r === rows.length - 1 ? pg.h - m - y : Math.round(H * want[r] / sum), tw = pg.w - 2 * m - gap * (g2.length - 1), asp = g2.map(x => x.w / x.h), as = asp.reduce((a, v) => a + v, 0); let x = m;
        g2.forEach((mm, c) => { const w = c === g2.length - 1 ? pg.w - m - x : Math.round(tw * asp[c] / as); pg.els.push({ id: uid('e'), type: 'panel', x, y, w, h: rh, mediaId: mm.id, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' }); ensureBitmap(mm.id); x += w + gap; }); y += rh + gap; });
      pages().push(pg); state.project.activePage = pg.id; made++; }
    V.sel = null; commit('컷 자동 배치'); toast(`그림 ${ms.length}장으로 ${made}쪽을 만들었어요.`); } });
  // 요소 복사·붙여넣기: 다른 페이지에도 붙일 수 있어요
  addCmd({ id: 'cut.copy', title: '요소 복사', menu: '컷', group: 'el', keys: 'Ctrl+C', enabled: has, run: () => { clip = group().map(e => JSON.parse(JSON.stringify(e))); toast(`요소 ${clip.length}개를 복사했어요.`); } });
  addCmd({ id: 'cut.paste', title: '요소 붙여넣기', menu: '컷', group: 'el', keys: 'Ctrl+V', enabled: () => !!pageOf() && clip.length > 0, run: () => { const pg = pageOf(), same = clip.some(c => pg.els.some(e => e.x === c.x && e.y === c.y)), d = same ? 24 : 0, ns = clip.map(c => ({ ...JSON.parse(JSON.stringify(c)), id: uid('e'), x: c.x + d, y: c.y + d, ...(c.type === 'bubble' ? { tx: c.tx + d, ty: c.ty + d } : {}) })); const jm = {}; ns.forEach(n => { if (n.join) n.join = jm[n.join] || (jm[n.join] = uid('j')); }); ns.forEach(n => { if (n.join && ns.filter(o => o.join === n.join).length < 2) delete n.join; }); pg.els.push(...ns); V.sel = ns.at(-1).id; V.more = { anchor: V.sel, ids: new Set(ns.slice(0, -1).map(n => n.id)) }; clip = ns.map(n => JSON.parse(JSON.stringify(n))); commit('요소 붙여넣기'); } });
  // 컷 나누기: 고른 컷을 가로나 세로로 똑같이 나눠요 (사이 틈은 컷 테두리 굵기의 3배)
  const splitCmd = (id, title, cols, rows) => addCmd({ id, title, menu: '컷', group: 'split', enabled: () => !!elOf() && elOf().type === 'panel', run: () => { const pg = pageOf(), e = elOf(), gap = settings.get('cutGap') ?? Math.max(8, Math.round((e.bw || 4) * 3)), w = (e.w - gap * (cols - 1)) / cols, hh = (e.h - gap * (rows - 1)) / rows, i = pg.els.indexOf(e), ns = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ns.push({ ...JSON.parse(JSON.stringify(e)), id: r || c ? uid('e') : e.id, x: Math.round(e.x + c * (w + gap)), y: Math.round(e.y + r * (hh + gap)), w: Math.round(w), h: Math.round(hh), ...(r || c ? { mediaId: null } : {}) }); pg.els.splice(i, 1, ...ns); commit(title); } });
  splitCmd('cut.splitV', '컷을 좌우 둘로 나누기', 2, 1); splitCmd('cut.splitH', '컷을 위아래 둘로 나누기', 1, 2); splitCmd('cut.split3V', '컷을 좌우 셋으로 나누기', 3, 1); splitCmd('cut.split3H', '컷을 위아래 셋으로 나누기', 1, 3); splitCmd('cut.split4', '컷을 넷으로 나누기', 2, 2);
  // 말풍선: 이어 붙이기(겹친 말풍선을 한 덩어리로), 글자에 맞추기, 다르게 그리기, 그 자리에서 고치기
  const selB = () => on() ? group().filter(isB) : [];
  addCmd({ id: 'cut.join', title: '고른 말풍선 이어 붙이기', menu: '컷', group: 'bubble', words: '합치기 연결 union', enabled: () => selB().length > 1, run: () => { const id = uid('j'), bs = selB(), lead = isB(elOf()) ? elOf() : bs[0]; bs.forEach(b => { b.join = id; }); syncLook(lead); commit('말풍선 이어 붙이기'); } });
  addCmd({ id: 'cut.unjoin', title: '이어 붙인 말풍선 떼어 내기', menu: '컷', group: 'bubble', enabled: () => selB().some(b => b.join), run: () => { const pg = pageOf(); selB().forEach(b => { delete b.join; }); pg.els.forEach(b => { if (b.join && joined(pg, b).length < 2) delete b.join; }); commit('말풍선 떼어 내기'); } });
  addCmd({ id: 'cut.fitText', title: '말풍선을 글자에 맞추기', menu: '컷', group: 'bubble', enabled: () => selB().length > 0, run: () => { selB().forEach(fitText); commit('글자에 맞추기'); } });
  addCmd({ id: 'cut.reseed', title: '말풍선 다르게 그리기', menu: '컷', group: 'bubble', words: '다시 모양 seed', enabled: () => selB().length > 0, run: () => { selB().forEach(b => { b.seed = 1 + Math.floor(Math.random() * 99999); }); commit('다르게 그리기'); } });
  addCmd({ id: 'cut.editText', title: '대사 그 자리에서 고치기', menu: '컷', group: 'bubble', enabled: () => has() && (elOf().type === 'bubble' || elOf().type === 'text'), run: editInPlace });
  addCmd({ id: 'cut.dup', title: '요소 복제', menu: '컷', group: 'el', keys: 'Ctrl+D', enabled: has, run: () => { const pg = pageOf(), jm = {}, ns = group().map(e => ({ ...JSON.parse(JSON.stringify(e)), id: uid('e'), x: e.x + 24, y: e.y + 24, ...(isB(e) ? { tx: e.tx + 24, ty: e.ty + 24 } : {}) })); ns.forEach(n => { if (n.join) n.join = jm[n.join] || (jm[n.join] = uid('j')); if (n.gid) n.gid = jm[n.gid] || (jm[n.gid] = uid('g')); }); ns.forEach(n => { if (n.join && ns.filter(o => o.join === n.join).length < 2) delete n.join; }); pg.els.push(...ns); setSel(ns.map(n => n.id)); commit(ns.length > 1 ? `요소 ${ns.length}개 복제` : '요소 복제'); } });
  addCmd({ id: 'cut.delete', title: '요소 지우기', menu: '컷', group: 'el', enabled: has, run: () => { const pg = pageOf(), g = new Set(group().map(e => e.id)); pg.els = pg.els.filter(e => !g.has(e.id)); V.sel = null; commit(g.size > 1 ? `요소 ${g.size}개 지우기` : '요소 지우기'); } });
  addCmd({ id: 'cut.overview', title: '페이지 한눈에 보기…', menu: '컷', words: '전체 목록 순서', enabled: () => pages().length > 0, run: overview });
  addCmd({ id: 'cut.sfx', title: '효과음 글자 넣기', menu: '컷', group: 'el', words: '의성어 쾅 sfx', enabled: on, run: () => addSfxText(0) });
  addCmd({ id: 'cut.draft', title: '대사 초안… (제미나이)', menu: '컷', group: 'ai', words: '대본 글쓰기 write', enabled: () => !!pageOf(), run: draftDialog });
  addCmd({ id: 'cut.translate', title: '대사 번역… (제미나이)', menu: '컷', group: 'ai', words: 'translate 번역', enabled: () => !!pageOf(), run: translateDialog });
  addCmd({ id: 'cut.export', title: '이 페이지를 PNG로', menu: '컷', group: 'out', enabled: () => !!pageOf(), run: async () => { const pg = pageOf(), c = await pageCanvas(pg); download(await new Promise(r => c.toBlob(r, 'image/png')), pg.name + '.png'); toast(`'${pg.name}.png'로 저장했어요.`); } });
  addCmd({ id: 'cut.exportAll', title: '모든 페이지 저장…', menu: '컷', group: 'out', enabled: () => pages().length > 0, run: async () => { const b = busy('페이지를 그리는 중이에요.'), files = []; for (const [i, pg] of pages().entries()) { const c = await pageCanvas(pg); files.push({ name: `${String(i + 1).padStart(3, '0')} ${pg.name}.png`, blob: await new Promise(r => c.toBlob(r, 'image/png')) }); b.set(`페이지를 그리는 중이에요. ${i + 1} / ${pages().length}`); } b.done(''); const r = await saveFiles(files, state.project.name + ' 페이지.zip'); if (r) toast(`페이지 ${files.length}쪽을 저장했어요.`); } });
  addEventListener('keydown', e => {
    if (!cv || document.querySelector('.dlg-back, #modalRoot .modal-bg')) return; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.code === 'Space' && !typing) { V.space = true; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!typing && (e.ctrlKey || e.metaKey) && !e.altKey && pageOf() && ['0', '=', '+', '-'].includes(e.key)) { if (e.key === '0') { V.fitted = null; emit(); } else zoomBy(e.key === '-' ? 1 / 1.25 : 1.25); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && V.pan) { V.pan = null; emit(); e.preventDefault(); return; }
    if (e.key === 'Escape' && (V.sel || V.tool !== 'pick')) { V.sel = null; V.more = null; V.tool = 'pick'; emit(); e.preventDefault(); return; }
    const t = TOOLS.find(x => x[2] === e.key.toUpperCase()); if (t) { V.tool = t[0]; emit(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && elOf()) { run('cut.delete'); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.key === 'Enter' && (e.target === cv || e.target === document.body) && elOf() && elOf().type !== 'panel') { editInPlace(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (/^Arrow/.test(e.key) && elOf()) {   // 화살표: 1칸씩, Shift와 함께면 10칸씩 옮겨요
      const k = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0, dy = e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0;
      for (const o of group()) { o.x += dx; o.y += dy; if (isB(o)) { o.tx += dx; o.ty += dy; } } draw(); clearTimeout(V.nt); V.nt = setTimeout(() => commit('옮기기'), 500); e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  addEventListener('keyup', e => { if (e.code === 'Space') V.space = false; });
}
