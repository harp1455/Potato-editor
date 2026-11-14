// 컷 작업실 (첫 판): 페이지에 컷을 나누고 그림을 담고, 말풍선과 글자를 얹어요.
// 요소 = 컷(panel) · 말풍선(bubble) · 글자(text). 모두 페이지 좌표의 x, y, w, h를 가져요.
import { h, icon, clamp, drag } from '../ui/dom.js';
import { state, commit, emit, tick, uid, ensureBitmap } from '../core/store.js';
import { settings } from '../core/settings.js';
import { addCmd, run } from '../core/cmd.js';
import { saveFiles, download } from '../core/files.js';
import { generate } from '../api/gemini.js';
import { dialog, toast, busy, showMenu } from '../ui/overlay.js';

const SIZES = [[800, 1280, '웹툰 한 화면 (800 × 1280)'], [1080, 1920, '세로 (1080 × 1920)'], [1600, 2260, '만화 원고 (1600 × 2260)'], [1920, 1080, '가로 (1920 × 1080)'], [1080, 1080, '정사각형 (1080 × 1080)']];
const LAYOUTS = [['1', '한 컷', [[0, 0, 1, 1]]], ['2', '위아래 2컷', [[0, 0, 1, .5], [0, .5, 1, .5]]], ['3', '위아래 3컷', [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]], ['4', '4컷 (2 × 2)', [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]]], ['t', '위 큰 컷 + 아래 2컷', [[0, 0, 1, .6], [0, .6, .5, .4], [.5, .6, .5, .4]]]];
const FONTS = [['', '기본'], ['"Malgun Gothic", "Apple SD Gothic Neo", sans-serif', '고딕'], ['"Batang", "Nanum Myeongjo", serif', '명조'], ['"Gungsuh", serif', '궁서'], ['"Comic Sans MS", "Nanum Pen Script", cursive', '손글씨']];
const TOOLS = [['pick', '고르기', 'V', 'move', '요소를 눌러 고르고 끌어 옮겨요. Shift를 누르고 누르면 여러 개를 함께 골라요. 모서리 점으로 크기를 바꿔요. 컷 안의 그림은 Alt를 누르고 끌면 옮겨지고 휠로 커져요.'], ['panel', '컷 만들기', 'C', 'cut', '끌어서 컷을 만들어요. 보관함 그림을 컷 위로 끌면 그 컷에 담겨요.'], ['bubble', '말풍선', 'B', 'bubble', '끌어서 말풍선을 만들어요. 꼬리 끝의 점을 끌어 말하는 사람 쪽으로 돌려요.'], ['text', '글자', 'T', 'text', '누른 자리에 글자를 놓아요. 오른쪽에서 내용과 모양을 바꿔요.'], ['lines', '집중선', 'L', 'lines', '끌어서 집중선을 넣어요. 가운데가 비고 가장자리에서 선이 모여들어요. 컷 위에 겹쳐 쓰면 돼요.']];
const V = { tool: 'pick', zoom: 1, ox: 0, oy: 0, fitted: null, sel: null, draft: null };
let cv = null, ctx = null, wrap = null;

const pages = () => state.project.pages || (state.project.pages = []);
export const pageOf = () => pages().find(p => p.id === state.project.activePage) || pages()[0] || null;
const elOf = () => { const p = pageOf(); return p ? p.els.find(e => e.id === V.sel) || null : null; };
// 함께 고른 요소들: Shift를 누르고 누르면 더해져요. 맨 마지막에 누른 것이 설정을 보여 주는 요소예요.
const extra = () => (V.more && V.more.anchor === V.sel ? V.more.ids : null);
const group = () => { const p = pageOf(), x = extra(); return p ? p.els.filter(e => e.id === V.sel || (x && x.has(e.id))) : []; };
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
function linesOf(g, e, maxW) {
  g.font = fontOf(e); const out = [];
  for (const raw of String(e.text || '').split('\n')) {
    if (!maxW) { out.push(raw); continue; }
    // 영어처럼 띄어 쓰는 말은 낱말 단위로, 한글·한자·가나는 글자 단위로 줄을 바꿔요
    let line = '';
    for (const tok of raw.match(/[A-Za-z0-9À-ɏЀ-ӿ'’.,!?;:()\-]+\s*|\s+|./gu) || []) {
      if (line && g.measureText((line + tok).trimEnd()).width > maxW) { out.push(line.trimEnd()); line = tok.trim() ? tok : ''; } else line += tok;
    }
    out.push(line.trimEnd());
  }
  return out;
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
function drawEl(g, e) {
  if (e.type === 'panel') {
    g.save(); g.beginPath(); g.rect(e.x, e.y, e.w, e.h); g.clip();
    g.fillStyle = '#e9e9e9'; g.fillRect(e.x, e.y, e.w, e.h);
    const b = e.mediaId && state.bitmaps.get(e.mediaId);
    if (e.mediaId && !b) ensureBitmap(e.mediaId);
    if (b) { const k = Math.max(e.w / b.width, e.h / b.height) * (e.is || 1), dw = b.width * k, dh = b.height * k; g.imageSmoothingQuality = 'high'; g.drawImage(b, e.x + (e.w - dw) / 2 + (e.ix || 0), e.y + (e.h - dh) / 2 + (e.iy || 0), dw, dh); }
    g.restore();
    if (e.bw) { g.lineWidth = e.bw; g.strokeStyle = e.bc || '#111'; g.strokeRect(e.x, e.y, e.w, e.h); }
  } else if (e.type === 'bubble') {
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2, shape = () => {
      g.beginPath();
      if (e.shape === 'rect') g.roundRect(e.x, e.y, e.w, e.h, Math.min(e.w, e.h) * 0.18);
      else if (e.shape === 'cloud') { const n = Math.max(8, Math.round((e.w + e.h) / 70)), rx = e.w / 2 * 0.86, ry = e.h / 2 * 0.86; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, r = Math.PI * Math.max(rx, ry) / n * 1.25; g.moveTo(cx + Math.cos(a) * rx + r, cy + Math.sin(a) * ry); g.arc(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, r, 0, Math.PI * 2); } g.moveTo(cx + rx, cy); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); }
      else if (e.shape === 'shout') { const n = Math.max(12, Math.round((e.w + e.h) / 40)) * 2; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, k = i % 2 ? 0.74 : 1 - ((i * 7) % 5) * 0.03; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * e.w / 2 * k, cy + Math.sin(a) * e.h / 2 * k); } g.closePath(); }
      else g.ellipse(cx, cy, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
    };
    g.lineJoin = 'round'; g.lineWidth = (e.bw ?? 3) * 2; g.strokeStyle = e.bc || '#111'; g.fillStyle = e.fill || '#ffffff';
    const tail = () => { if (!e.tail) return; const a = Math.atan2(e.ty - cy, e.tx - cx), s = Math.min(e.w, e.h) * 0.16; g.beginPath(); g.moveTo(cx + Math.cos(a + Math.PI / 2) * s, cy + Math.sin(a + Math.PI / 2) * s); g.lineTo(e.tx, e.ty); g.lineTo(cx + Math.cos(a - Math.PI / 2) * s, cy + Math.sin(a - Math.PI / 2) * s); g.closePath(); };
    if (e.bw !== 0) { tail(); if (e.tail) g.stroke(); shape(); g.stroke(); }
    tail(); if (e.tail) g.fill(); shape(); g.fill();
    drawText(g, e, cx, cy, e.w * (e.shape === 'rect' ? 0.88 : e.shape === 'ellipse' || !e.shape ? 0.72 : 0.6));
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
export function renderPage(g, pg) { g.fillStyle = pg.bg || '#fff'; g.fillRect(0, 0, pg.w, pg.h); pg.els.forEach(e => drawEl(g, e)); }
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
const hit = (pg, p) => { for (let i = pg.els.length - 1; i >= 0; i--) { const e = pg.els[i]; if (p.x >= e.x && p.y >= e.y && p.x <= e.x + e.w && p.y <= e.y + e.h) return e; } return null; };

// ---- 번역: 페이지의 대사를 모아 제미나이에 보내고, 같은 차례로 받아 넣어요 ----
const LANGS = [['Korean', '한국어'], ['English', '영어'], ['Japanese', '일본어'], ['Simplified Chinese', '중국어 (간체)'], ['Traditional Chinese', '중국어 (번체)'], ['Spanish', '스페인어']];
export async function translateTexts(texts, lang, tone) {
  const r = await generate('translate', settings.get('textModel'), {
    systemInstruction: { parts: [{ text: `You translate comic dialogue into ${lang}. The input is a JSON array of lines in reading order. Return ONLY a JSON array of strings with exactly the same number of items in the same order. Keep line breaks (\\n) where they help the line fit a speech bubble. Keep names, sound effects and tone natural for ${lang} comics.${tone ? ' Tone: ' + tone : ''}` }] },
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
      let found = 0;
      if (T.img) { const list = T.all ? pages() : [pg]; for (let i = 0; i < list.length; i++) { b.set(`그림 속 글자를 찾는 중이에요. ${i + 1} / ${list.length}쪽`); found += (await translateImage(list[i], T.lang)).length; } }   // 먼저 그림(원래 대사가 보이는 상태)을 읽어요
      if (els.length) { b.set(`대사 ${els.length}줄을 번역하는 중이에요.`); const out = await translateTexts(els.map(e => e.text), T.lang, T.tone); els.forEach((e, i) => { e.text = out[i]; }); }
      commit(`${langName}로 번역`); b.done(`대사 ${els.length}줄을 번역했어요.` + (T.img ? ` 그림 속 글자는 ${found}곳을 찾아 덮었어요.` : ''));
    } catch (e) { b.done(e.message || '번역하지 못했어요.', 'err'); }
  })(); } }] });
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
    const e = { id: uid('e'), type: 'bubble', x, y, w, h: hh, shape: 'rect', text, size, color: lum > 140 ? '#111111' : '#ffffff', fill: '#' + med.map(hex).join(''), bc: '#111111', bw: 0, tail: false, tx: x, ty: y + hh, bold: false, from: String(it.text || '') };
    pg.els.push(e); made.push(e);
  }
  return made;
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
          const d = V.draft; V.draft = null; if (d.w < 12 || d.h < 12) { draw(); return; }
          const n = kind === 'lines' ? { id: uid('e'), type: 'lines', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), color: '#111111', count: 90, hole: 45, thick: 1, seed: 1 + Math.floor(Math.random() * 99999) }
            : kind === 'panel' ? { id: uid('e'), type: 'panel', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), mediaId: null, ix: 0, iy: 0, is: 1, bw: 4, bc: '#111111' }
            : { id: uid('e'), type: 'bubble', x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), shape: 'ellipse', text: '대사', size: Math.round(pg.w / 26), color: '#111111', fill: '#ffffff', bc: '#111111', bw: 3, tail: true, tx: Math.round(d.x + d.w * 0.3), ty: Math.round(d.y + d.h + d.h * 0.35) };
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
      drag(e, ev => { const dx = Math.round((ev.clientX - e.clientX) / V.zoom), dy = Math.round((ev.clientY - e.clientY) / V.zoom); if (dx || dy) mv = true; t.x = x0 + dx; t.y = y0 + dy; if (t.type === 'bubble') { t.tx = tx0 + dx; t.ty = ty0 + dy; } draw(); }, () => mv && commit('옮기기'));
    });
    cv.addEventListener('dblclick', () => { const e = elOf(); if (e && e.type !== 'panel') { const ta = side.querySelector('textarea'); if (ta) { ta.focus(); ta.select(); } } });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); if (!elOf()) return; showMenu([{ label: '맨 앞으로', run: () => run('cut.front') }, { label: '맨 뒤로', run: () => run('cut.back') }, { label: '복제', run: () => run('cut.dup') }, '-', { label: '지우기', run: () => run('cut.delete') }], e.clientX, e.clientY); });
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
      const num = (label, k, o = e, step = 1) => { const i = h('input.num', { type: 'number', value: Math.round((o[k] || 0) * 100) / 100, step, 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { o[k] = v; commit(label); } } }); return h('label.field', null, h('span.field-name.w', null, label), i); };
      const col = (label, k, def) => h('label.field', null, h('span.field-name.w', null, label), h('input', { type: 'color', value: e[k] || def, 'aria-label': label, onchange: ev => { e[k] = ev.target.value; commit(label); } }));
      const textBox = () => [h('label.stack', null, h('span.field-name', null, '대사'), h('textarea.text.area', { rows: 4, 'aria-label': '대사', value: e.text || '', oninput: ev => { e.text = ev.target.value; draw(); }, onchange: () => commit('대사 고치기') })),
        h('div.field-row', null, num('크기', 'size'), h('label.field', null, h('span.field-name.w', null, '글꼴'), h('select.text', { 'aria-label': '글꼴', onchange: ev => { e.font = ev.target.value; commit('글꼴'); } }, FONTS.map(([v, t]) => h('option', { value: v, selected: (e.font || '') === v }, t))))),
        h('div.field-row', null, col('글자색', 'color', '#111111'), h('label.check', null, h('input', { type: 'checkbox', checked: !!e.bold, onchange: ev => { e.bold = ev.target.checked; commit('굵게'); } }), '굵게')),
        h('label.check', null, h('input', { type: 'checkbox', checked: !!e.vert, onchange: ev => { e.vert = ev.target.checked; commit('세로쓰기'); } }), '세로쓰기')];
      side.replaceChildren(...(!pg ? [h('p.empty', null, '페이지를 만들면 설정이 여기 보여요.')] : !e ? [
        h('h3.sec', null, '페이지'),
        h('label.field', null, h('span.field-name.w', null, '이름'), h('input.text', { type: 'text', value: pg.name, 'aria-label': '페이지 이름', onchange: ev => { pg.name = ev.target.value.trim() || pg.name; commit('페이지 이름'); } })),
        h('label.field', null, h('span.field-name.w', null, '크기'), h('select.text', { 'aria-label': '페이지 크기', onchange: ev => { const s = SIZES[+ev.target.value]; if (s) { pg.w = s[0]; pg.h = s[1]; V.fitted = null; commit('페이지 크기'); } } }, [h('option', { value: -1, selected: true }, `${pg.w} × ${pg.h}`), ...SIZES.map(([, , t], i) => h('option', { value: i }, t))])),
        h('label.field', null, h('span.field-name.w', null, '바탕'), h('input', { type: 'color', value: pg.bg || '#ffffff', 'aria-label': '바탕색', onchange: ev => { pg.bg = ev.target.value; commit('바탕색'); } })),
        h('h3.sec', null, '내보내기와 번역'),
        h('div.btn-row', null, h('button.btn.small', { onclick: () => run('cut.export') }, '이 페이지 PNG'), h('button.btn.small', { onclick: () => run('cut.exportAll') }, '모든 페이지 저장')),
        h('div.btn-row', null, h('button.btn.small', { onclick: () => run('cut.translate') }, '대사 번역…')),
        h('p.panel-note', null, '요소를 누르면 그 요소의 설정이 보여요. 보관함 그림을 컷 위로 끌어 담아요.'),
      ] : [
        h('h3.sec', null, { panel: '컷', bubble: '말풍선', text: '글자', lines: '집중선' }[e.type]),
        ...(e.type === 'panel' ? [h('div.field-row', null, num('테두리', 'bw'), col('테두리색', 'bc', '#111111')), h('div.btn-row', null, h('button.btn.small', { disabled: !e.mediaId, onclick: () => { e.ix = 0; e.iy = 0; e.is = 1; commit('그림 가운데로'); } }, '그림 가운데로'), h('button.btn.small', { disabled: !e.mediaId, onclick: () => { e.mediaId = null; commit('그림 빼기'); } }, '그림 빼기')), h('p.panel-note', null, 'Alt를 누르고 끌면 컷 안의 그림이 움직이고, Alt를 누르고 휠을 돌리면 커져요.')] : []),
        ...(e.type === 'bubble' ? [...textBox(), h('div.field-row', null, h('label.field', null, h('span.field-name.w', null, '모양'), h('select.text', { 'aria-label': '모양', onchange: ev => { e.shape = ev.target.value; commit('말풍선 모양'); } }, [['ellipse', '둥글게'], ['rect', '네모나게'], ['cloud', '구름 (생각)'], ['shout', '뾰족하게 (외침)']].map(([v, t]) => h('option', { value: v, selected: e.shape === v }, t)))), h('label.check', null, h('input', { type: 'checkbox', checked: !!e.tail, onchange: ev => { e.tail = ev.target.checked; commit('말풍선 꼬리'); } }), '꼬리')),
          h('div.field-row', null, col('바탕색', 'fill', '#ffffff'), col('테두리색', 'bc', '#111111')), num('테두리', 'bw')] : []),
        ...(e.type === 'lines' ? [h('div.field-row', null, num('선 수', 'count'), num('굵기', 'thick', e, 0.1)), h('div.field-row', null, num('가운데 빈 곳 %', 'hole'), col('색', 'color', '#111111')), h('div.btn-row', null, h('button.btn.small', { onclick: () => { e.seed = 1 + Math.floor(Math.random() * 99999); commit('집중선 다시 뿌리기'); } }, '다르게 뿌리기'))] : []),
        ...(e.type === 'text' ? [...textBox(), h('div.field-row', null, num('테두리', 'sw'), col('테두리색', 'sc', '#ffffff'))] : []),
        h('h3.sec', null, '자리'),
        h('div.field-row', null, num('X', 'x'), num('Y', 'y')), e.type !== 'text' && h('div.field-row', null, num('가로', 'w'), num('세로', 'h')),
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
  status() { const pg = pageOf(), e = elOf(); return pg ? [`${pg.w} × ${pg.h}`, `${pages().indexOf(pg) + 1} / ${pages().length}쪽`, e ? { panel: '컷', bubble: '말풍선', text: '글자', lines: '집중선' }[e.type] : ''].filter(Boolean) : []; },
  hint: () => pageOf() ? (TOOLS.find(t => t[0] === V.tool) || TOOLS[0])[4] : '컷 나누기를 골라 첫 페이지를 만들어요.',
  zoomText: () => pageOf() ? Math.round(V.zoom * 100) + '%' : '',
};

export function registerCutCmds() {
  const on = () => !!cv && !!pageOf(), has = () => on() && !!elOf();
  const order = front => { const pg = pageOf(), e = elOf(); pg.els.splice(pg.els.indexOf(e), 1); front ? pg.els.push(e) : pg.els.unshift(e); commit(front ? '맨 앞으로' : '맨 뒤로'); };
  addCmd({ id: 'cut.newPage', title: '새 페이지', menu: '컷', enabled: () => !!cv, run: () => { const c = pageOf(); newPage(c ? c.w : 800, c ? c.h : 1280, '1'); commit('새 페이지'); } });
  addCmd({ id: 'cut.dupPage', title: '페이지 복제', menu: '컷', enabled: on, run: () => { const pg = pageOf(), n = JSON.parse(JSON.stringify(pg)); n.id = uid('g'); n.name = pg.name + ' 복사'; n.els.forEach(e => { e.id = uid('e'); }); pages().splice(pages().indexOf(pg) + 1, 0, n); state.project.activePage = n.id; commit('페이지 복제'); } });
  addCmd({ id: 'cut.deletePage', title: '페이지 지우기', menu: '컷', enabled: on, run: () => { const pg = pageOf(), i = pages().indexOf(pg); pages().splice(i, 1); state.project.activePage = (pages()[Math.min(i, pages().length - 1)] || {}).id || null; V.sel = null; V.fitted = null; commit('페이지 지우기'); } });
  addCmd({ id: 'cut.front', title: '맨 앞으로', menu: '컷', group: 'el', enabled: has, run: () => order(true) });
  addCmd({ id: 'cut.back', title: '맨 뒤로', menu: '컷', group: 'el', enabled: has, run: () => order(false) });
  addCmd({ id: 'cut.dup', title: '요소 복제', menu: '컷', group: 'el', enabled: has, run: () => { const pg = pageOf(), e = elOf(), n = { ...e, id: uid('e'), x: e.x + 24, y: e.y + 24, ...(e.type === 'bubble' ? { tx: e.tx + 24, ty: e.ty + 24 } : {}) }; pg.els.push(n); V.sel = n.id; commit('요소 복제'); } });
  addCmd({ id: 'cut.delete', title: '요소 지우기', menu: '컷', group: 'el', enabled: has, run: () => { const pg = pageOf(), g = new Set(group().map(e => e.id)); pg.els = pg.els.filter(e => !g.has(e.id)); V.sel = null; commit(g.size > 1 ? `요소 ${g.size}개 지우기` : '요소 지우기'); } });
  addCmd({ id: 'cut.translate', title: '대사 번역… (제미나이)', menu: '컷', group: 'ai', words: 'translate 번역', enabled: () => !!pageOf(), run: translateDialog });
  addCmd({ id: 'cut.export', title: '이 페이지를 PNG로', menu: '컷', group: 'out', enabled: () => !!pageOf(), run: async () => { const pg = pageOf(), c = await pageCanvas(pg); download(await new Promise(r => c.toBlob(r, 'image/png')), pg.name + '.png'); toast(`'${pg.name}.png'로 저장했어요.`); } });
  addCmd({ id: 'cut.exportAll', title: '모든 페이지 저장…', menu: '컷', group: 'out', enabled: () => pages().length > 0, run: async () => { const b = busy('페이지를 그리는 중이에요.'), files = []; for (const [i, pg] of pages().entries()) { const c = await pageCanvas(pg); files.push({ name: `${String(i + 1).padStart(3, '0')} ${pg.name}.png`, blob: await new Promise(r => c.toBlob(r, 'image/png')) }); b.set(`페이지를 그리는 중이에요. ${i + 1} / ${pages().length}`); } b.done(''); const r = await saveFiles(files, state.project.name + ' 페이지.zip'); if (r) toast(`페이지 ${files.length}쪽을 저장했어요.`); } });
  addEventListener('keydown', e => {
    if (!cv || document.querySelector('.dlg-back, #modalRoot .modal-bg')) return; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.code === 'Space' && !typing) { V.space = true; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = TOOLS.find(x => x[2] === e.key.toUpperCase()); if (t) { V.tool = t[0]; emit(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && elOf()) { run('cut.delete'); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener('keyup', e => { if (e.code === 'Space') V.space = false; });
}
