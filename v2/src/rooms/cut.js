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

const SIZES = [[800, 1280, '웹툰 한 화면 (800 × 1280)'], [1080, 1920, '세로 (1080 × 1920)'], [1600, 2260, '만화 원고 (1600 × 2260)'], [1920, 1080, '가로 (1920 × 1080)'], [1080, 1080, '정사각형 (1080 × 1080)']];
const LAYOUTS = [['1', '한 컷', [[0, 0, 1, 1]]], ['2', '위아래 2컷', [[0, 0, 1, .5], [0, .5, 1, .5]]], ['3', '위아래 3컷', [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]], ['4', '4컷 (2 × 2)', [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]], ['t', '위 큰 컷 + 아래 2컷', [[0, 0, 1, .6], [0, .6, .5, .4], [.5, .6, .5, .4]]]];
const FONTS = [['', '기본 (고딕)'], ['"Pretendard", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif', '또렷한 고딕'], ['"NanumSquareRound", "나눔스퀘어라운드", "Nanum Gothic", "Malgun Gothic", sans-serif', '둥근 고딕'], ['"Batang", "Nanum Myeongjo", "Noto Serif KR", serif', '명조'], ['"Gungsuh", serif', '궁서'], ['"Nanum Pen Script", "나눔손글씨 펜", "Comic Sans MS", cursive', '손글씨 (펜)'], ['"Nanum Brush Script", "나눔손글씨 붓", "Gungsuh", cursive', '손글씨 (붓)']];
// 내 컴퓨터 글꼴: 브라우저가 허락하면 깔려 있는 글꼴 이름을 받아 와서 목록에 더해요 (이름만 기억해요)
const localFonts = () => settings.get('localFonts') || [];
async function loadLocalFonts() {
  if (!window.queryLocalFonts) { toast('이 환경에서는 컴퓨터 글꼴 목록을 볼 수 없어요. 설치판이나 크롬·엣지에서 써 주세요.', 'err'); return; }
  try { const fs = await window.queryLocalFonts(), names = [...new Set(fs.map(f => f.family))].sort((a, b) => a.localeCompare(b, 'ko')); settings.set('localFonts', names.slice(0, 600)); emit(); toast(names.length ? `컴퓨터 글꼴 ${names.length}개를 글꼴 목록에 더했어요.` : '글꼴을 찾지 못했어요. 글꼴 접근을 허용해 주세요.'); }
  catch (_) { toast('글꼴 목록을 받지 못했어요. 글꼴 접근을 허용해 주세요.', 'err'); }
}
const TOOLS = [['pick', '고르기', 'V', 'move', '요소를 눌러 고르고 끌어 옮겨요. Shift를 누르고 누르면 여러 개를 함께 골라요. 모서리 점으로 크기를 바꿔요. 컷 안의 그림은 Alt를 누르고 끌면 옮겨지고 휠로 커져요.'], ['panel', '컷 만들기', 'C', 'cut', '끌어서 컷을 만들어요. 보관함 그림을 컷 위로 끌면 그 컷에 담겨요.'], ['bubble', '말풍선', 'B', 'bubble', '끌어서 말풍선을 만들어요. 꼬리 끝의 점을 끌어 말하는 사람 쪽으로 돌려요.'], ['text', '글자', 'T', 'text', '누른 자리에 글자를 놓아요. 오른쪽에서 내용과 모양을 바꿔요.'], ['lines', '집중선', 'L', 'lines', '끌어서 집중선을 넣어요. 가운데가 비고 가장자리에서 선이 모여들어요. 컷 위에 겹쳐 쓰면 돼요.']];
const V = { tool: 'pick', zoom: 1, ox: 0, oy: 0, fitted: null, sel: null, draft: null };
let cv = null, ctx = null, wrap = null;

const pages = () => state.project.pages || (state.project.pages = []);
export const pageOf = () => pages().find(p => p.id === state.project.activePage) || pages()[0] || null;
// 모양 묶음: 말풍선·글자의 생김새를 이름 붙여 두고 다른 요소에 입혀요 (작업이 달라도 같이 써요)
const LOOK = ['line', 'bw', 'bc', 'fill', 'fill2', 'fop', 'soft', 'sh', 'dbl'];   // 이어 붙인 말풍선끼리 같이 쓰는 생김새
const STYLE_KEYS = { bubble: ['shape', 'size', 'color', 'bold', 'vert', 'font', 'sw', 'sc', 'tailKind', 'tailW', 'tailBend', 'wob', ...LOOK], text: ['size', 'color', 'sw', 'sc', 'bold', 'vert', 'font', 'rot'] };
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
  if (settings.get('cutSnap') === false) return { x, y };
  const lim = 8 / V.zoom, xs = [0, pg.w / 2, pg.w], ys = [0, pg.h / 2, pg.h]; for (const o of pg.els) if (o !== t) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
  const near = (pos, size, marks) => { let best = null; for (const m of marks) for (const off of [0, size / 2, size]) { const d = m - (pos + off); if (Math.abs(d) <= lim && (best === null || Math.abs(d) < Math.abs(best))) best = d; } return best === null ? pos : pos + best; };
  return { x: Math.round(near(x, t.w, xs)), y: Math.round(near(y, t.h, ys)) };
}
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
function drawEl0(g, e) {
  if (e.type === 'panel') {
    g.save(); g.beginPath(); g.rect(e.x, e.y, e.w, e.h); g.clip();
    g.fillStyle = '#e9e9e9'; g.fillRect(e.x, e.y, e.w, e.h);
    const b = e.mediaId && state.bitmaps.get(e.mediaId);
    if (e.mediaId && !b) ensureBitmap(e.mediaId);
    if (b) { const k = Math.max(e.w / b.width, e.h / b.height) * (e.is || 1), dw = b.width * k, dh = b.height * k; g.imageSmoothingQuality = 'high'; g.drawImage(b, e.x + (e.w - dw) / 2 + (e.ix || 0), e.y + (e.h - dh) / 2 + (e.iy || 0), dw, dh); }
    g.restore();
    if (e.bw) { g.lineWidth = e.bw; g.strokeStyle = e.bc || '#111'; g.strokeRect(e.x, e.y, e.w, e.h); }
  } else if (e.type === 'pic') {   // 스티커: 효과음 그림처럼 컷 밖에 자유롭게 놓는 그림
    const b = e.mediaId && state.bitmaps.get(e.mediaId); if (e.mediaId && !b) ensureBitmap(e.mediaId);
    if (b) { g.save(); g.globalAlpha = e.op ?? 1; g.imageSmoothingQuality = 'high'; g.drawImage(b, e.x, e.y, e.w, e.h); g.restore(); }
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
    const m = drawText(g, e, e.x + e.w / 2, e.y + e.h / 2, 0); e.w = Math.ceil(m.w) + 8; e.h = Math.ceil(m.h);
  }
}
// 이어 붙인 말풍선(join이 같은 것)은 맨 아래 것의 차례에 한 덩어리로 그려요
const joined = (pg, e) => (e.join ? pg.els.filter(o => o.type === 'bubble' && o.join === e.join) : [e]);
export function renderPage(g, pg) {
  g.fillStyle = pg.bg || '#fff'; g.fillRect(0, 0, pg.w, pg.h); const done = new Set();
  for (const e of pg.els) {
    if (e.type !== 'bubble') { drawEl(g, e); continue; }
    if (done.has(e.id)) continue;
    const grp = joined(pg, e); grp.forEach(o => done.add(o.id)); drawBubbles(g, grp); grp.forEach(o => bubbleText(g, o));
  }
}
async function pageCanvas(pg) {
  await Promise.all(pg.els.filter(e => e.mediaId).map(e => ensureBitmap(e.mediaId)));
  const c = document.createElement('canvas'); c.width = pg.w; c.height = pg.h; renderPage(c.getContext('2d'), pg); return c;
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
  if (e) { ctx.lineWidth = px; ctx.strokeStyle = '#4b9fe8'; ctx.strokeRect(e.x, e.y, e.w, e.h); ctx.fillStyle = '#fff'; const r = 3.5 * px; if (e.type !== 'text') for (const [x, y] of [[e.x, e.y], [e.x + e.w, e.y], [e.x, e.y + e.h], [e.x + e.w, e.y + e.h]]) { ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.strokeRect(x - r, y - r, r * 2, r * 2); } if (e.type === 'bubble' && e.tail) { ctx.beginPath(); ctx.arc(e.tx, e.ty, 4.5 * px, 0, Math.PI * 2); ctx.fillStyle = '#d3a94e'; ctx.fill(); ctx.stroke(); } }
  const d = V.draft; if (d) { ctx.lineWidth = px; ctx.strokeStyle = '#eaf4ff'; ctx.setLineDash([4 * px, 3 * px]); ctx.strokeRect(d.x, d.y, d.w, d.h); }
  ctx.restore();
}
const toPage = (sx, sy) => ({ x: (sx - V.ox) / V.zoom, y: (sy - V.oy) / V.zoom });
const hit = (pg, p) => { for (let i = pg.els.length - 1; i >= 0; i--) { const e = pg.els[i]; if ((p.x >= e.x && p.y >= e.y && p.x <= e.x + e.w && p.y <= e.y + e.h) || (e.type === 'bubble' && e.tail && inBubble(e, p.x, p.y))) return e; } return null; };

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
    oninput: () => { e.text = ta.value; draw(); }, onkeydown: ev => { ev.stopPropagation(); if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ta.blur(); } },
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
    el.append(tools, h('div.vid-room', null, h('div.vid-top', null, wrap, side), strip));
    const ro = new ResizeObserver(() => { if (V.fitted !== (pageOf() || {}).id) fit(); else draw(); }); ro.observe(wrap);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, pg = pageOf(), p = toPage(sx, sy), t = pg && e.altKey ? hit(pg, p) : null;
      if (t && t.type === 'panel' && t.mediaId) { t.is = clamp((t.is || 1) * Math.exp(-e.deltaY * 0.0015), 1, 8); draw(); clearTimeout(V.wt); V.wt = setTimeout(() => commit('컷 안 그림 크기'), 400); return; }
      const z = clamp(V.zoom * Math.exp(-e.deltaY * 0.0015), 0.02, 16); V.zoom = z; V.ox = sx - p.x * z; V.oy = sy - p.y * z; draw(); tick();
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      const pg = pageOf(); if (!pg) return; cv.focus();
      const r = cv.getBoundingClientRect(), at = ev => toPage(ev.clientX - r.left, ev.clientY - r.top), p = at(e);
      if (e.button === 1 || V.space) { const ox = V.ox, oy = V.oy; return drag(e, ev => { V.ox = ox + ev.clientX - e.clientX; V.oy = oy + ev.clientY - e.clientY; draw(); }); }
      if (e.button !== 0) return;
      if (V.tool === 'text') { const t = { id: uid('e'), type: 'text', x: Math.round(p.x - 60), y: Math.round(p.y - 20), w: 120, h: 40, text: '글자', size: Math.round(pg.w / 22), color: '#111111', sw: 3, sc: '#ffffff', bold: true }; pg.els.push(t); V.sel = t.id; V.tool = 'pick'; commit('글자 넣기'); return; }
      if (V.tool === 'panel' || V.tool === 'bubble' || V.tool === 'lines') {
        const kind = V.tool; V.draft = { x: p.x, y: p.y, w: 0, h: 0 };
        return drag(e, ev => { const q = at(ev); Object.assign(V.draft, { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) }); draw(); }, () => {
          const d = V.draft; V.draft = null; if (d.w < 12 || d.h < 12) { if (kind !== 'bubble') { draw(); return; } const bw = Math.round(pg.w * 0.3), bh = Math.round(bw * 0.58); Object.assign(d, { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh }); }   // 말풍선은 그냥 눌러도 알맞은 크기로 놓여요
          const n = kind === 'lines' ? { id: uid('e'), type: 'lines', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), color: '#111111', count: 90, hole: 45, thick: 1, seed: 1 + Math.floor(Math.random() * 99999) }
            : kind === 'panel' ? { id: uid('e'), type: 'panel', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), mediaId: null, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' }
            : newBubble(pg, d);
          pg.els.push(n); V.sel = n.id; V.tool = 'pick'; commit(kind === 'panel' ? '컷 만들기' : kind === 'lines' ? '집중선 넣기' : '말풍선 넣기');
        });
      }
      const cur = elOf(), rr = 7 / V.zoom;
      if (cur && cur.type === 'bubble' && cur.tail && Math.hypot(p.x - cur.tx, p.y - cur.ty) < rr * 1.4) { let mv = false; return drag(e, ev => { const q = at(ev); cur.tx = Math.round(q.x); cur.ty = Math.round(q.y); mv = true; draw(); }, () => mv && commit('말풍선 꼬리')); }
      if (cur && cur.type !== 'text') for (const [hx, hy, fx, fy] of [[cur.x, cur.y, 1, 1], [cur.x + cur.w, cur.y, 0, 1], [cur.x, cur.y + cur.h, 1, 0], [cur.x + cur.w, cur.y + cur.h, 0, 0]]) if (Math.abs(p.x - hx) < rr && Math.abs(p.y - hy) < rr) {
        const ax = fx ? cur.x + cur.w : cur.x, ay = fy ? cur.y + cur.h : cur.y; let mv = false;   // 맞은편 모서리를 붙잡고
        return drag(e, ev => { const q = at(ev); cur.x = Math.round(Math.min(ax, q.x)); cur.y = Math.round(Math.min(ay, q.y)); cur.w = Math.max(16, Math.round(Math.abs(q.x - ax))); cur.h = Math.max(16, Math.round(Math.abs(q.y - ay))); mv = true; draw(); }, () => mv && commit('크기 바꾸기'));
      }
      const t = hit(pg, p);
      if (e.shiftKey && t) {   // 더하거나 빼기
        const ids = new Set(group().map(x => x.id)); if (ids.has(t.id) && ids.size > 1) { ids.delete(t.id); V.sel = [...ids].at(-1); } else { ids.add(t.id); V.sel = t.id; }
        ids.delete(V.sel); V.more = { anchor: V.sel, ids }; emit(); return;
      }
      const inGroup = t && group().length > 1 && group().includes(t);
      if (!inGroup && V.sel !== (t ? t.id : null)) { V.sel = t ? t.id : null; emit(); } if (!t) return;
      if (inGroup) { const g0 = group().map(x => ({ x, x0: x.x, y0: x.y, tx0: x.tx, ty0: x.ty })); let mv = false; return drag(e, ev => { const dx = Math.round((ev.clientX - e.clientX) / V.zoom), dy = Math.round((ev.clientY - e.clientY) / V.zoom); if (dx || dy) mv = true; for (const o of g0) { o.x.x = o.x0 + dx; o.x.y = o.y0 + dy; if (o.x.type === 'bubble') { o.x.tx = o.tx0 + dx; o.x.ty = o.ty0 + dy; } } draw(); }, () => mv && commit('함께 옮기기')); }
      if (e.altKey && t.type === 'panel' && t.mediaId) { const ix = t.ix || 0, iy = t.iy || 0; let mv = false; return drag(e, ev => { t.ix = ix + (ev.clientX - e.clientX) / V.zoom; t.iy = iy + (ev.clientY - e.clientY) / V.zoom; mv = true; draw(); }, () => mv && commit('컷 안 그림 옮기기')); }
      const x0 = t.x, y0 = t.y, tx0 = t.tx, ty0 = t.ty; let mv = false;
      drag(e, ev => { let dx = Math.round((ev.clientX - e.clientX) / V.zoom), dy = Math.round((ev.clientY - e.clientY) / V.zoom); if (dx || dy) mv = true; if (!ev.altKey && !t.rot) { const q = snapEl(pg, t, x0 + dx, y0 + dy); dx = q.x - x0; dy = q.y - y0; } t.x = x0 + dx; t.y = y0 + dy; if (t.type === 'bubble') { t.tx = tx0 + dx; t.ty = ty0 + dy; } draw(); }, () => mv && commit('옮기기'));
    });
    cv.addEventListener('dblclick', () => editInPlace());
    cv.addEventListener('contextmenu', e => { e.preventDefault(); if (!elOf()) return; const e0 = elOf(), txt = e0.type === 'bubble' || e0.type === 'text'; showMenu([...(txt ? [{ label: '대사 고치기', run: () => editInPlace() }] : []), ...(isB(e0) ? [{ label: '글자에 맞추기', run: () => run('cut.fitText') }, { label: '이어 붙이기', disabled: group().filter(isB).length < 2, run: () => run('cut.join') }, { label: '떼어 내기', disabled: !e0.join, run: () => run('cut.unjoin') }, '-'] : []), { label: '맨 앞으로', run: () => run('cut.front') }, { label: '맨 뒤로', run: () => run('cut.back') }, { label: '복제', run: () => run('cut.dup') }, '-', { label: '지우기', run: () => run('cut.delete') }], e.clientX, e.clientY); });
    wrap.addEventListener('dragover', e => e.preventDefault());
    wrap.addEventListener('drop', e => {
      e.preventDefault(); const id = e.dataTransfer.getData('application/x-potato-media'), pg = pageOf(); if (!id || !pg) return;
      const r = cv.getBoundingClientRect(), p = toPage(e.clientX - r.left, e.clientY - r.top), t = [...pg.els].reverse().find(x => x.type === 'panel' && p.x >= x.x && p.y >= x.y && p.x <= x.x + x.w && p.y <= x.y + x.h);
      if (!t) { toast('그림을 컷 위에 놓아 주세요. 컷이 없으면 컷 만들기 도구로 먼저 만들어요.'); return; }
      t.mediaId = id; t.ix = 0; t.iy = 0; t.is = 1; ensureBitmap(id); V.sel = t.id; commit('컷에 그림 담기');
    });

    const update = () => {
      const pg = pageOf(), e = elOf();
      tools.replaceChildren(...TOOLS.map(([id, title, key, ic]) => h('button.tool' + (V.tool === id ? '.on' : ''), { title: `${title} (${key})`, 'aria-label': title, 'aria-pressed': String(V.tool === id), onclick: () => { V.tool = id; emit(); } }, icon(ic, 18))));
      empty.hidden = !!pg; cv.hidden = !pg;
      const num = (label, k, o = e, step = 1, lim = {}) => { const i = h('input.num', { type: 'number', value: Math.round((o[k] ?? lim.def ?? 0) * 100) / 100, step, min: lim.min, max: lim.max, 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { o[k] = clamp(v, lim.min ?? -1e6, lim.max ?? 1e6); syncLook(o); commit(label); } } }); return h('label.field', null, h('span.field-name.w', null, label), i); };
      const sel = (label, k, opts, def) => h('label.field', null, h('span.field-name.w', null, label), h('select.text', { 'aria-label': label, onchange: ev => { e[k] = ev.target.value; syncLook(e); commit(label); } }, opts.map(([v, t]) => h('option', { value: v, selected: (e[k] || def) === v }, t))));
      const chk = (label, k, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: !!e[k], onchange: ev => { e[k] = ev.target.checked; syncLook(e); commit(label); } }), label);
      const col = (label, k, def) => h('label.field', null, h('span.field-name.w', null, label), h('input', { type: 'color', value: e[k] || def, 'aria-label': label, onchange: ev => { e[k] = ev.target.value; syncLook(e); commit(label); } }));
      const textBox = () => [h('label.stack', null, h('span.field-name', null, '대사'), h('textarea.text.area', { rows: 4, 'aria-label': '대사', value: e.text || '', oninput: ev => { e.text = ev.target.value; draw(); }, onchange: () => commit('대사 고치기') })),
        h('div.field-row', null, num('크기', 'size'), h('label.field', null, h('span.field-name.w', null, '글꼴'), h('select.text', { 'aria-label': '글꼴', onchange: ev => { if (ev.target.value === '\u0000load') { ev.target.value = e.font || ''; loadLocalFonts(); return; } e.font = ev.target.value; commit('글꼴'); } }, [...FONTS.map(([v, t]) => h('option', { value: v, selected: (e.font || '') === v }, t)), ...(e.font && !FONTS.some(f => f[0] === e.font) && !localFonts().some(n => `"${n}"` === e.font) ? [h('option', { value: e.font, selected: true }, e.font.replace(/"/g, '').split(',')[0])] : []), ...(localFonts().length ? [h('optgroup', { label: '내 컴퓨터 글꼴' }, localFonts().map(n => h('option', { value: `"${n}"`, selected: e.font === `"${n}"` }, n)))] : []), h('option', { value: '\u0000load' }, localFonts().length ? '컴퓨터 글꼴 다시 불러오기…' : '내 컴퓨터 글꼴 불러오기…')]))),
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
        h('label.field', null, h('span.field-name.w', null, '바탕'), h('input', { type: 'color', value: pg.bg || '#ffffff', 'aria-label': '바탕색', onchange: ev => { pg.bg = ev.target.value; commit('바탕색'); } })),
        h('h3.sec', null, '내보내기와 번역'),
        h('div.btn-row', null, h('button.btn.small', { onclick: () => run('cut.export') }, '이 페이지 PNG'), h('button.btn.small', { onclick: () => run('cut.exportAll') }, '모든 페이지 저장')),
        h('div.btn-row', null, h('button.btn.small', { onclick: () => run('cut.translate') }, '대사 번역…'), h('button.btn.small', { onclick: () => run('cut.sfx') }, '효과음 넣기')),
        h('h3.sec', null, '새 말풍선 종류'), gallery(),
        h('p.panel-note', null, '종류를 고른 뒤 말풍선 도구(B)로 끌거나 눌러서 놓아요. 요소를 누르면 그 요소의 설정이 보여요. 보관함 그림은 컷 위로 끌어 담아요.'),
      ] : [
        h('h3.sec', null, { panel: '컷', bubble: '말풍선', text: '글자', lines: '집중선', pic: '스티커' }[e.type]),
        ...(e.type === 'panel' ? [h('div.field-row', null, num('테두리', 'bw'), col('테두리색', 'bc', '#111111')), h('div.btn-row', null, h('button.btn.small', { disabled: !e.mediaId, onclick: () => { e.ix = 0; e.iy = 0; e.is = 1; commit('그림 가운데로'); } }, '그림 가운데로'), h('button.btn.small', { disabled: !e.mediaId, onclick: () => { e.mediaId = null; commit('그림 빼기'); } }, '그림 빼기')), h('p.panel-note', null, 'Alt를 누르고 끌면 컷 안의 그림이 움직이고, Alt를 누르고 휠을 돌리면 커져요.')] : []),
        ...(e.type === 'bubble' ? [gallery(), ...textBox(),
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
        ...(e.type === 'lines' ? [h('div.field-row', null, num('선 수', 'count'), num('굵기', 'thick', e, 0.1)), h('div.field-row', null, num('가운데 빈 곳 %', 'hole'), col('색', 'color', '#111111')), h('div.btn-row', null, h('button.btn.small', { onclick: () => { e.seed = 1 + Math.floor(Math.random() * 99999); commit('집중선 다시 뿌리기'); } }, '다르게 뿌리기'))] : []),
        ...(e.type === 'text' ? [...textBox(), h('div.field-row', null, num('테두리', 'sw'), col('테두리색', 'sc', '#ffffff'))] : []),
        ...(e.type === 'bubble' || e.type === 'text' ? [h('h3.sec', null, '모양 묶음'),
          h('div.btn-row', null, h('select.text', { 'aria-label': '모양 묶음', style: 'flex:1;width:auto', onchange: ev => { const st = styles().filter(x => x.type === e.type)[+ev.target.value]; if (st) { Object.assign(e, st.props); commit('모양 묶음 입히기'); } } }, [h('option', { value: -1, selected: true }, styles().some(x => x.type === e.type) ? '저장한 모양 고르기' : '저장한 모양이 없어요'), ...styles().filter(x => x.type === e.type).map((x, i) => h('option', { value: i }, x.name))]),
            h('button.btn.small', { title: '지금 이 요소의 글자 크기·색·테두리·모양을 이름 붙여 저장해요', onclick: async () => { const name = await askText('모양 묶음 이름', e.type === 'bubble' ? '기본 말풍선' : '기본 글자', '저장'); if (!name) return; const props = {}; STYLE_KEYS[e.type].forEach(k => { if (e[k] !== undefined) props[k] = e[k]; }); settings.set('cutStyles', [...styles().filter(x => !(x.type === e.type && x.name === name)), { name, type: e.type, props }]); emit(); toast(`'${name}' 모양을 저장했어요.`); } }, '지금 모양 저장'))] : []),
        h('h3.sec', null, '자리'),
        h('div.field-row', null, num('X', 'x'), num('Y', 'y')), h('div.field-row', null, num('회전', 'rot')), e.type !== 'text' && h('div.field-row', null, num('가로', 'w'), num('세로', 'h')),
        h('div.btn-row', null, h('button.icon-btn', { title: '맨 앞으로', 'aria-label': '맨 앞으로', onclick: () => run('cut.front') }, icon('up')), h('button.icon-btn', { title: '맨 뒤로', 'aria-label': '맨 뒤로', onclick: () => run('cut.back') }, icon('down')), h('span.grow'), h('button.icon-btn', { title: '지우기', 'aria-label': '지우기', onclick: () => run('cut.delete') }, icon('trash'))),
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
  status() { const pg = pageOf(), e = elOf(); return pg ? [`${pg.w} × ${pg.h}`, `${pages().indexOf(pg) + 1} / ${pages().length}쪽`, e ? { panel: '컷', bubble: '말풍선', text: '글자', lines: '집중선', pic: '스티커' }[e.type] : ''].filter(Boolean) : []; },
  hint: () => pageOf() ? (TOOLS.find(t => t[0] === V.tool) || TOOLS[0])[4] : '컷 나누기를 골라 첫 페이지를 만들어요.',
  zoomText: () => pageOf() ? Math.round(V.zoom * 100) + '%' : '',
};

export const pick = id => { V.sel = id; V.more = null; emit(); };   // 요소 하나를 골라요
export const sel = () => V.sel;
export function registerCutCmds() {
  const on = () => !!cv && !!pageOf(), has = () => on() && !!elOf();
  const order = front => { const pg = pageOf(), e = elOf(); pg.els.splice(pg.els.indexOf(e), 1); front ? pg.els.push(e) : pg.els.unshift(e); commit(front ? '맨 앞으로' : '맨 뒤로'); };
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
  const splitCmd = (id, title, cols, rows) => addCmd({ id, title, menu: '컷', group: 'split', enabled: () => !!elOf() && elOf().type === 'panel', run: () => { const pg = pageOf(), e = elOf(), gap = Math.max(8, Math.round((e.bw || 4) * 3)), w = (e.w - gap * (cols - 1)) / cols, hh = (e.h - gap * (rows - 1)) / rows, i = pg.els.indexOf(e), ns = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ns.push({ ...JSON.parse(JSON.stringify(e)), id: r || c ? uid('e') : e.id, x: Math.round(e.x + c * (w + gap)), y: Math.round(e.y + r * (hh + gap)), w: Math.round(w), h: Math.round(hh), ...(r || c ? { mediaId: null } : {}) }); pg.els.splice(i, 1, ...ns); commit(title); } });
  splitCmd('cut.splitV', '컷을 좌우 둘로 나누기', 2, 1); splitCmd('cut.splitH', '컷을 위아래 둘로 나누기', 1, 2); splitCmd('cut.split3V', '컷을 좌우 셋으로 나누기', 3, 1); splitCmd('cut.split3H', '컷을 위아래 셋으로 나누기', 1, 3); splitCmd('cut.split4', '컷을 넷으로 나누기', 2, 2);
  // 말풍선: 이어 붙이기(겹친 말풍선을 한 덩어리로), 글자에 맞추기, 다르게 그리기, 그 자리에서 고치기
  const selB = () => on() ? group().filter(isB) : [];
  addCmd({ id: 'cut.join', title: '고른 말풍선 이어 붙이기', menu: '컷', group: 'bubble', words: '합치기 연결 union', enabled: () => selB().length > 1, run: () => { const id = uid('j'), bs = selB(), lead = isB(elOf()) ? elOf() : bs[0]; bs.forEach(b => { b.join = id; }); syncLook(lead); commit('말풍선 이어 붙이기'); } });
  addCmd({ id: 'cut.unjoin', title: '이어 붙인 말풍선 떼어 내기', menu: '컷', group: 'bubble', enabled: () => selB().some(b => b.join), run: () => { const pg = pageOf(); selB().forEach(b => { delete b.join; }); pg.els.forEach(b => { if (b.join && joined(pg, b).length < 2) delete b.join; }); commit('말풍선 떼어 내기'); } });
  addCmd({ id: 'cut.fitText', title: '말풍선을 글자에 맞추기', menu: '컷', group: 'bubble', enabled: () => selB().length > 0, run: () => { selB().forEach(fitText); commit('글자에 맞추기'); } });
  addCmd({ id: 'cut.reseed', title: '말풍선 다르게 그리기', menu: '컷', group: 'bubble', words: '다시 모양 seed', enabled: () => selB().length > 0, run: () => { selB().forEach(b => { b.seed = 1 + Math.floor(Math.random() * 99999); }); commit('다르게 그리기'); } });
  addCmd({ id: 'cut.editText', title: '대사 그 자리에서 고치기', menu: '컷', group: 'bubble', enabled: () => has() && (elOf().type === 'bubble' || elOf().type === 'text'), run: editInPlace });
  addCmd({ id: 'cut.dup', title: '요소 복제', menu: '컷', group: 'el', enabled: has, run: () => { const pg = pageOf(), e = elOf(), n = { ...e, id: uid('e'), join: undefined, x: e.x + 24, y: e.y + 24, ...(e.type === 'bubble' ? { tx: e.tx + 24, ty: e.ty + 24 } : {}) }; pg.els.push(n); V.sel = n.id; commit('요소 복제'); } });
  addCmd({ id: 'cut.delete', title: '요소 지우기', menu: '컷', group: 'el', enabled: has, run: () => { const pg = pageOf(), g = new Set(group().map(e => e.id)); pg.els = pg.els.filter(e => !g.has(e.id)); V.sel = null; commit(g.size > 1 ? `요소 ${g.size}개 지우기` : '요소 지우기'); } });
  addCmd({ id: 'cut.overview', title: '페이지 한눈에 보기…', menu: '컷', words: '전체 목록 순서', enabled: () => pages().length > 0, run: overview });
  addCmd({ id: 'cut.sfx', title: '효과음 글자 넣기', menu: '컷', group: 'el', words: '의성어 쾅 sfx', enabled: on, run: () => { const pg = pageOf(), size = Math.round(pg.w / 7), t = { id: uid('e'), type: 'text', x: Math.round(pg.w / 2 - size), y: Math.round(pg.h / 2 - size / 2), w: size * 2, h: size, text: '쾅!', size, color: '#ffffff', sw: Math.max(4, Math.round(size / 12)), sc: '#111111', bold: true, rot: -12 }; pg.els.push(t); V.sel = t.id; V.tool = 'pick'; commit('효과음 넣기'); } });
  addCmd({ id: 'cut.draft', title: '대사 초안… (제미나이)', menu: '컷', group: 'ai', words: '대본 글쓰기 write', enabled: () => !!pageOf(), run: draftDialog });
  addCmd({ id: 'cut.translate', title: '대사 번역… (제미나이)', menu: '컷', group: 'ai', words: 'translate 번역', enabled: () => !!pageOf(), run: translateDialog });
  addCmd({ id: 'cut.export', title: '이 페이지를 PNG로', menu: '컷', group: 'out', enabled: () => !!pageOf(), run: async () => { const pg = pageOf(), c = await pageCanvas(pg); download(await new Promise(r => c.toBlob(r, 'image/png')), pg.name + '.png'); toast(`'${pg.name}.png'로 저장했어요.`); } });
  addCmd({ id: 'cut.exportAll', title: '모든 페이지 저장…', menu: '컷', group: 'out', enabled: () => pages().length > 0, run: async () => { const b = busy('페이지를 그리는 중이에요.'), files = []; for (const [i, pg] of pages().entries()) { const c = await pageCanvas(pg); files.push({ name: `${String(i + 1).padStart(3, '0')} ${pg.name}.png`, blob: await new Promise(r => c.toBlob(r, 'image/png')) }); b.set(`페이지를 그리는 중이에요. ${i + 1} / ${pages().length}`); } b.done(''); const r = await saveFiles(files, state.project.name + ' 페이지.zip'); if (r) toast(`페이지 ${files.length}쪽을 저장했어요.`); } });
  addEventListener('keydown', e => {
    if (!cv || document.querySelector('.dlg-back, #modalRoot .modal-bg')) return; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.code === 'Space' && !typing) { V.space = true; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
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
