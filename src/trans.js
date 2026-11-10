/* ================= 페이지 번역 (AI · 제미나이 API) — 이미지 편집 ================= */
// 흐름: 그림을 제미나이에 보내 글자 자리·원문·번역을 한 번에 받음 → 원래 글자만 지움(말풍선은 바탕색, 그림 위는 AI 지우개)
//       → 고칠 수 있는 글자 레이어로 다시 씀. 결과는 '번역 지움' 레이어 + '번역 글자' 묶음이라 언제든 끄거나 지울 수 있어요.
const TR_API = 'https://generativelanguage.googleapis.com/v1beta';
const TR_LANGS = [['ja', '일본어'], ['ko', '한국어'], ['zh', '중국어'], ['en', '영어']];
const TR_LN = { ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English' };
const TR_PREF = ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.1-pro-preview', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash'];
const TR_KINDS = ['speech', 'thought', 'narration', 'sfx', 'sign', 'other'];
const trCfg = { key: '', model: TR_PREF[0], models: [], src: 'auto', dst: 'ko', font: '고딕', style: '', sfx: 'keep', lama: true, ctx: true, gloss: '', notes: '', scope: 'one' };
try { Object.assign(trCfg, JSON.parse(localStorage.getItem('potatoTrCfg') || '{}')); } catch (_) { }
const trSaveCfg = () => { try { localStorage.setItem('potatoTrCfg', JSON.stringify(trCfg)); } catch (_) { } };
const trOff = {}; // 이 모델이 안 받는 선택 항목 (mediaResolution 등)

/* ---- 제미나이 부르기 ---- */
function trErr(code, msg) { const e = new Error(msg || code); e.code = code; return e; }
const trSleep = (ms, tk) => new Promise(r => { const t0 = Date.now(), f = () => (tk && tk.stop) || Date.now() - t0 >= ms ? r() : setTimeout(f, 200); f(); });
async function trHttp(method, path, body, tk) {
  for (let n = 0; ; n++) {
    if (tk && tk.stop) throw trErr('stop');
    let res;
    try { res = await fetch(TR_API + path, { method, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': trCfg.key.trim() }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { if (n < 2) { await trSleep(2500, tk); continue; } throw trErr('net', '인터넷에 연결하지 못했어요'); }
    let j = null; try { j = await res.json(); } catch (_) { }
    if (res.ok) return j || {};
    const em = (j && j.error) || {}, msg = String(em.message || ''), st = String(em.status || '');
    if (res.status === 400 && /API key|API_KEY/i.test(msg + JSON.stringify(em.details || ''))) throw trErr('key', 'API 키가 맞지 않아요. 키를 다시 확인해 주세요');
    if (res.status === 401 || res.status === 403) throw trErr('key', '이 API 키로는 쓸 수 없어요 (권한이 없거나 막힌 키예요)');
    if (res.status === 404) throw trErr('model', `'${trCfg.model}' 모델을 찾지 못했어요. 번역 설정에서 '모델 목록 불러오기'로 다시 골라 주세요`);
    if ((res.status === 429 || res.status >= 500) && n < 4) { // 잠깐 기다렸다 다시
      const rd = ((em.details || []).find(d => d.retryDelay) || {}).retryDelay, w = rd ? parseFloat(rd) * 1000 + 500 : 4000 * Math.pow(2, n);
      if (tk) tk.set(res.status === 429 ? `사용량 한도에 걸려서 ${Math.ceil(w / 1000)}초 기다리는 중…` : `제미나이가 바빠서 다시 시도하는 중…`);
      await trSleep(Math.min(w, 65000), tk); continue;
    }
    if (res.status === 429) throw trErr('quota', '제미나이 사용량 한도를 넘었어요. 조금 뒤에 하거나, 결제를 연결한 키를 써 주세요');
    throw trErr(res.status === 400 ? 'bad' : 'http', `제미나이 오류 (${res.status} ${st}) ${msg.slice(0, 160)}`);
  }
}
async function trListModels() {
  const j = await trHttp('GET', '/models?pageSize=1000');
  const ok = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini/.test(n) && !/(tts|live|image|transcribe|omni|embedding|banana|aqa|robotics|computer|customtools)/.test(n));
  ok.sort((a, b) => { const ia = TR_PREF.indexOf(a), ib = TR_PREF.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.localeCompare(a); });
  return ok;
}
const TR_SCHEMA = {
  type: 'OBJECT', properties: {
    summary: { type: 'STRING', description: 'One or two sentences about what happens on this page, in the target language.' },
    blocks: {
      type: 'ARRAY', items: {
        type: 'OBJECT', properties: {
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '[ymin, xmin, ymax, xmax] of the text itself, 0-1000' },
          kind: { type: 'STRING', enum: TR_KINDS },
          vertical: { type: 'BOOLEAN' },
          speaker: { type: 'STRING' },
          source: { type: 'STRING' },
          translation: { type: 'STRING' },
        }, required: ['box_2d', 'kind', 'source', 'translation'],
      },
    },
  }, required: ['blocks'],
};
function trJson(t) {
  t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (_) { }
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { } }
  // 잘린 JSON: 마지막 완전한 블록까지만
  const m = t.lastIndexOf('},'); if (a >= 0 && m > a) { try { return JSON.parse(t.slice(a, m + 1) + ']}'); } catch (_) { } }
  return null;
}
async function trAsk(prompt, b64, tk, schema = TR_SCHEMA) {
  for (let n = 0; n < 4; n++) {
    const gc = { responseMimeType: 'application/json', maxOutputTokens: 16384 };
    if (!trOff.schema) gc.responseSchema = schema;
    if (!trOff.media) gc.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }], generationConfig: gc };
    let j;
    try { j = await trHttp('POST', `/models/${encodeURIComponent(trCfg.model)}:generateContent`, body, tk); }
    catch (e) { // 모델이 모르는 선택 항목이면 빼고 다시
      if (e.code === 'bad' && !trOff.media && /media/i.test(e.message)) { trOff.media = 1; continue; }
      if (e.code === 'bad' && !trOff.schema && /schema|response_?mime/i.test(e.message)) { trOff.schema = 1; continue; }
      if (e.code === 'bad' && /block|safety|prohibit/i.test(e.message)) throw trErr('blocked', '제미나이가 이 그림을 거절했어요');
      throw e;
    }
    const pf = j.promptFeedback || {}, c = (j.candidates || [])[0];
    if (!c) throw trErr('blocked', pf.blockReason ? `제미나이가 이 그림을 거절했어요 (${pf.blockReason})` : '제미나이가 답하지 않았어요');
    if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|IMAGE_SAFETY|RECITATION/.test(c.finishReason || '') && !(c.content && c.content.parts)) throw trErr('blocked', `제미나이가 이 그림을 거절했어요 (${c.finishReason})`);
    const text = ((c.content && c.content.parts) || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
    const out = trJson(text);
    if (out && Array.isArray(out.blocks)) return out;
    if (n < 1) continue; // 한 번 더
    throw trErr('parse', '제미나이 답을 읽지 못했어요');
  }
}
function trPrompt(o, ctx, sheet) {
  const src = o.src === 'auto' ? 'whatever language it is written in (detect it)' : TR_LN[o.src], dst = o.dst === 'same' ? 'the SAME language (do not translate)' : TR_LN[o.dst];
  const gl = String(o.gloss || '').split('\n').map(s => s.trim()).filter(s => s.includes('=')).slice(0, 200);
  let p = sheet ? `You are a professional comic (manga / manhwa / webtoon) translator and letterer.
This image is a contact sheet: numbered crops (#1, #2, …) cut out of ONE comic page. Each crop should contain text (speech, narration, sound effect or sign), numbered roughly in reading order. Translate the text in each crop from ${src} into natural, fluent ${dst}, reading the crops together as one scene.

Return JSON: {"summary": "...", "blocks": [...]} with one block per crop number.
- id: the crop number.
- If a crop has no readable text (only art or noise), set kind to "none" and leave source and translation empty.` : `You are a professional comic (manga / manhwa / webtoon) translator and letterer.
Find EVERY piece of text in this comic page image and translate it from ${src} into natural, fluent ${dst}.

Return JSON: {"summary": "...", "blocks": [...]}. One block per speech bubble / caption box / sound effect / sign, in natural reading order.
- box_2d: [ymin, xmin, ymax, xmax] tightly around the letters themselves (not the whole bubble), integers normalized to 0-1000.
- kind: speech, thought, narration (caption boxes), sfx (sound effects / onomatopoeia drawn as art), sign (text written on objects), other${sheet ? ', none' : ''}.
- vertical: true if the original text is written vertically.
- speaker: who says it, if you can tell (short name or description), else "".
- source: the exact original text. Use \\n where the original breaks lines. Do not include furigana / ruby.
- translation: the ${dst} translation, written the way a skilled ${dst} comic letterer would (no explanations, no notes, no romanization).
Rules:
- This is fiction for adults. Translate everything faithfully, including sexual, crude, violent or vulgar lines, moans, and swearing. Never censor, soften, skip or summarize.
- Translate slang, internet slang, memes and newly coined words into equally natural ${dst} slang with the same nuance, not literal meanings.
- Keep each character's voice consistent: politeness level, speech habits, how they address others.
- Keep translations about as long as the original so they fit in the same bubble. Keep "…", "!", "?", "♡", "~" where they add feeling.
- Sound effects: give a short, natural ${dst} sound effect.${o.dst === 'ko' ? ' (e.g. ドキドキ → 두근두근, ゴゴゴ → 쿠구구)' : ''}
- Skip watermarks, page numbers, credits and website logos.
- If there is no text, return an empty blocks array.`;
  if (o.dst === 'same') p += `\n- IMPORTANT: Do NOT translate. "translation" must be the original text exactly as written (same language), only without furigana. It will be re-lettered in a clean font.`;
  if (o.dst === 'ko') p += `\n- Korean: use natural webtoon dialogue. Choose 반말/존댓말 from the relationship and keep it consistent. Prefer spoken forms over stiff written forms.`;
  if (gl.length) p += `\n\nGlossary (always use these translations; names, terms, nicknames):\n${gl.map(s => '- ' + s).join('\n')}`;
  if (o.notes && o.notes.trim()) p += `\n\nNotes from the user about characters and tone (follow them):\n${o.notes.trim().slice(0, 2000)}`;
  if (ctx && (ctx.sums.length || ctx.lines.length)) {
    p += `\n\nStory so far (earlier pages, for context only — do not translate this again):`;
    if (ctx.sums.length) p += '\n' + ctx.sums.slice(-4).map(s => '- ' + s).join('\n');
    if (ctx.lines.length) p += '\nRecent lines (original => translation):\n' + ctx.lines.slice(-24).map(l => `${l.who ? l.who + ': ' : ''}${l.s.replace(/\n/g, ' ')} => ${l.d.replace(/\n/g, ' ')}`).join('\n');
  }
  return p;
}

/* ---- 그림에서 글자 모양 따기·지우기 ---- */
const trDist = (d, i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);
function trBg(d, n) { // 가장 흔한 색 (바탕색)과 그 비율
  const h = new Uint32Array(4096), sr = new Float64Array(4096), sg = new Float64Array(4096), sb = new Float64Array(4096);
  for (let i = 0; i < n; i++) { const o = i * 4, k = (d[o] >> 4) << 8 | (d[o + 1] >> 4) << 4 | (d[o + 2] >> 4); h[k]++; sr[k] += d[o]; sg[k] += d[o + 1]; sb[k] += d[o + 2]; }
  let best = 0; for (let k = 1; k < 4096; k++) if (h[k] > h[best]) best = k;
  const c = [sr[best] / h[best], sg[best] / h[best], sb[best] / h[best]];
  let near = 0; for (let i = 0; i < n; i++) if (trDist(d, i * 4, c) < 40) near++;
  return { c, share: near / n };
}
// 블록 하나: 지울 곳(마스크)·바탕색·글자색·글자 크기 짐작
function trAnalyze(g, CW, CH, bx) {
  const bw = bx.x1 - bx.x0, bh = bx.y1 - bx.y0, pad = Math.max(6, Math.round(Math.min(bw, bh) * 0.28));
  const R = { x: Math.max(0, Math.floor(bx.x0 - pad)), y: Math.max(0, Math.floor(bx.y0 - pad)) };
  R.w = Math.min(CW, Math.ceil(bx.x1 + pad)) - R.x; R.h = Math.min(CH, Math.ceil(bx.y1 + pad)) - R.y;
  const id = g.getImageData(R.x, R.y, R.w, R.h), d = id.data, N = R.w * R.h;
  const bg = trBg(d, N);
  // 글자 상자 안에서 바탕색에 가까운 칸 비율 (말풍선이면 높아요)
  let inB = 0, inN = 0;
  const ix0 = Math.max(0, Math.round(bx.x0 - R.x)), iy0 = Math.max(0, Math.round(bx.y0 - R.y)), ix1 = Math.min(R.w, Math.round(bx.x1 - R.x)), iy1 = Math.min(R.h, Math.round(bx.y1 - R.y));
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) { inN++; if (trDist(d, (y * R.w + x) * 4, bg.c) < 40) inB++; }
  const uniform = bg.share > 0.5 && inN > 0 && inB / inN > 0.3;
  const mask = new Uint8Array(N);
  let fsEst = 0, tcol = null;
  if (uniform) {
    // 바탕과 다른 칸 → 이어진 덩어리 → 글자 상자 안에 있고 너무 크지 않은 것만 (말풍선 테두리는 빼요)
    const cand = new Uint8Array(N); for (let i = 0; i < N; i++) if (trDist(d, i * 4, bg.c) > 70) cand[i] = 1;
    const lab = new Int32Array(N), protect = new Uint8Array(N), st = []; let L = 0; const hs = [];
    const ex = bw * 0.1, ey = bh * 0.1, atEdge = (x, y) => (x === 0 && R.x > 0) || (y === 0 && R.y > 0) || (x === R.w - 1 && R.x + R.w < CW) || (y === R.h - 1 && R.y + R.h < CH);
    let tx0 = 1e9, ty0 = 1e9, tx1 = -1, ty1 = -1; const keep = [];
    for (let s = 0; s < N; s++) {
      if (!cand[s] || lab[s]) continue;
      L++; lab[s] = L; st.length = 0; st.push(s); const px = [];
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, edge = false;
      while (st.length) {
        const i = st.pop(), x = i % R.w, y = (i / R.w) | 0; px.push(i);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (atEdge(x, y)) edge = true;
        if (x > 0 && cand[i - 1] && !lab[i - 1]) { lab[i - 1] = L; st.push(i - 1); }
        if (x < R.w - 1 && cand[i + 1] && !lab[i + 1]) { lab[i + 1] = L; st.push(i + 1); }
        if (y > 0 && cand[i - R.w] && !lab[i - R.w]) { lab[i - R.w] = L; st.push(i - R.w); }
        if (y < R.h - 1 && cand[i + R.w] && !lab[i + R.w]) { lab[i + R.w] = L; st.push(i + R.w); }
      }
      const cx = R.x + (x0 + x1) / 2, cy = R.y + (y0 + y1) / 2, cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      const inside = cx >= bx.x0 - ex && cx <= bx.x1 + ex && cy >= bx.y0 - ey && cy <= bx.y1 + ey;
      const ring = edge || (cw > bw * 1.25 && ch > bh * 1.25) || cw > bw * 1.6 || ch > bh * 1.6;
      if (inside && !ring) {
        for (const i of px) { mask[i] = 1; keep.push(i); }
        tx0 = Math.min(tx0, x0); ty0 = Math.min(ty0, y0); tx1 = Math.max(tx1, x1); ty1 = Math.max(ty1, y1); if (ch > 3 && cw > 2) hs.push(Math.max(cw, ch));
      } else for (const i of px) protect[i] = 1;
    }
    if (keep.length) { // 글자색: 테두리 있는 글자(밝은 속 + 어두운 테두리)면 속과 테두리를 나눠요
      const lum = i => d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11, nearBg = i => { const x = i % R.w; for (const j of [x > 0 ? i - 1 : -1, x < R.w - 1 ? i + 1 : -1, i - R.w, i + R.w]) if (j >= 0 && j < N && !cand[j]) return true; return false; };
      const G = { L: [], D: [] }; for (const i of keep) { const v = lum(i); if (v > 170) G.L.push(i); else if (v < 85) G.D.push(i); }
      const mean = a => { let r = 0, g2 = 0, b = 0; for (const i of a) { r += d[i * 4]; g2 += d[i * 4 + 1]; b += d[i * 4 + 2]; } return [r / a.length, g2 / a.length, b / a.length]; };
      if (G.L.length > keep.length * 0.15 && G.D.length > keep.length * 0.15) {
        const adj = a => a.filter(nearBg).length / a.length, fillL = adj(G.L) < adj(G.D);
        tcol = mean(fillL ? G.L : G.D); bx.stroke = mean(fillL ? G.D : G.L); bx.strokeR = (fillL ? G.D : G.L).length / Math.max(1, (fillL ? G.L : G.D).length);
      } else { // 바탕과 가장 다른 쪽 30%
        const sorted = keep.map(i => [trDist(d, i * 4, bg.c), i]).sort((a, b) => b[0] - a[0]); tcol = mean(sorted.slice(0, Math.max(1, (sorted.length * 0.3) | 0)).map(x => x[1]));
      }
    }
    if (tx1 >= 0) {
      hs.sort((a, b) => a - b); const med = hs.length ? hs[(hs.length * 0.7) | 0] : 0; fsEst = med * 1.05;
      bx.t = { x0: R.x + tx0, y0: R.y + ty0, x1: R.x + tx1 + 1, y1: R.y + ty1 + 1 };
    }
    // 조금 넓혀서 글자 테두리 찌꺼기까지 (테두리 선은 지키고)
    const r = Math.max(2, Math.round((fsEst || Math.min(bw, bh) * 0.3) * 0.09));
    trDilate(mask, R.w, R.h, r); for (let i = 0; i < N; i++) if (protect[i]) mask[i] = 0;
  } else {
    // 그림 위 글자: 글자 상자를 조금 넓혀 통째로
    const r = Math.max(3, Math.round(Math.min(bw, bh) * 0.08));
    for (let y = Math.max(0, iy0 - r); y < Math.min(R.h, iy1 + r); y++) for (let x = Math.max(0, ix0 - r); x < Math.min(R.w, ix1 + r); x++) mask[y * R.w + x] = 1;
    // 글자색: 상자 안에서 가장 밝은 것·어두운 것 중 많은 쪽 (보통 흰 글자에 검은 테두리, 또는 그 반대)
    let lo = 0, hi = 0; for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) { const o = (y * R.w + x) * 4, v = d[o] + d[o + 1] + d[o + 2]; if (v > 640) hi++; else if (v < 120) lo++; }
    tcol = hi >= lo ? [255, 255, 255] : [20, 20, 20];
  }
  if (!fsEst) fsEst = (bx.th || Math.min(bw, bh) / Math.max(1, bx.nl || 1)) * 0.95; // 글자 크기 짐작 (글줄 굵기)
  return { R, id, mask, bg: bg.c, uniform, tcol, fsEst, stroke: bx.stroke || null, strokeR: bx.strokeR || 0 };
}
function trDilate(m, w, h, r) { // 네모 모양으로 r칸 넓히기 (가로 → 세로)
  const t = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= r) t[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= r) m[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) m[y * w + x] = 1; } }
}
// AI 지우개 팩이 없을 때: 둘레 색을 피라미드로 밀어 넣어 메우기
function trPushPull(d, m, w, h) {
  const lv = []; let W = w, H = h, c = new Float32Array(W * H * 3), a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) if (!m[i]) { a[i] = 1; c[i * 3] = d[i * 4]; c[i * 3 + 1] = d[i * 4 + 1]; c[i * 3 + 2] = d[i * 4 + 2]; }
  lv.push({ W, H, c, a });
  while (W > 1 || H > 1) {
    const W2 = Math.max(1, (W + 1) >> 1), H2 = Math.max(1, (H + 1) >> 1), c2 = new Float32Array(W2 * H2 * 3), a2 = new Float32Array(W2 * H2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, j = (y >> 1) * W2 + (x >> 1); if (a[i]) { a2[j] += a[i]; c2[j * 3] += c[i * 3] * a[i]; c2[j * 3 + 1] += c[i * 3 + 1] * a[i]; c2[j * 3 + 2] += c[i * 3 + 2] * a[i]; } }
    for (let j = 0; j < W2 * H2; j++) if (a2[j]) { c2[j * 3] /= a2[j]; c2[j * 3 + 1] /= a2[j]; c2[j * 3 + 2] /= a2[j]; a2[j] = Math.min(1, a2[j]); }
    W = W2; H = H2; c = c2; a = a2; lv.push({ W, H, c, a });
  }
  for (let k = lv.length - 2; k >= 0; k--) {
    const L = lv[k], U = lv[k + 1];
    for (let y = 0; y < L.H; y++) for (let x = 0; x < L.W; x++) {
      const i = y * L.W + x; if (L.a[i] >= 1) continue;
      // 위 단계 값을 고르게 (가까운 넷)
      const fx = Math.min(U.W - 1, Math.max(0, (x - 0.5) / 2)), fy = Math.min(U.H - 1, Math.max(0, (y - 0.5) / 2)), x0 = fx | 0, y0 = fy | 0, x1 = Math.min(U.W - 1, x0 + 1), y1 = Math.min(U.H - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const s = (q, ch) => U.c[q * 3 + ch], q00 = y0 * U.W + x0, q10 = y0 * U.W + x1, q01 = y1 * U.W + x0, q11 = y1 * U.W + x1, wa = L.a[i];
      for (let ch = 0; ch < 3; ch++) { const v = (s(q00, ch) * (1 - tx) + s(q10, ch) * tx) * (1 - ty) + (s(q01, ch) * (1 - tx) + s(q11, ch) * tx) * ty; L.c[i * 3 + ch] = L.c[i * 3 + ch] * wa + v * (1 - wa); }
      L.a[i] = 1;
    }
  }
  const c0 = lv[0].c; for (let i = 0; i < w * h; i++) if (m[i]) { d[i * 4] = c0[i * 3]; d[i * 4 + 1] = c0[i * 3 + 1]; d[i * 4 + 2] = c0[i * 3 + 2]; }
}
// AI 지우개(LaMa)로 한 군데 메우기: clean 캔버스의 영역 Q, mk(Q 크기, 1 = 지울 곳)
async function trLama(clean, Q, mk, tk) {
  const S = 512, f = S / Math.max(Q.w, Q.h), w = Math.max(1, Math.round(Q.w * f)), h = Math.max(1, Math.round(Q.h * f));
  const ci = newCanvas(S, S), gi = ci.getContext('2d', { willReadFrequently: true }); gi.imageSmoothingQuality = 'high';
  gi.drawImage(clean, Q.x, Q.y, Q.w, Q.h, 0, 0, w, h);
  if (w < S) gi.drawImage(ci, w - 1, 0, 1, h, w, 0, S - w, h);
  if (h < S) gi.drawImage(ci, 0, h - 1, S, 1, 0, h, S, S - h);
  const mc = newCanvas(Q.w, Q.h), gmc = mc.getContext('2d'), md0 = gmc.createImageData(Q.w, Q.h);
  for (let i = 0; i < mk.length; i++) if (mk[i]) md0.data[i * 4 + 3] = 255;
  gmc.putImageData(md0, 0, 0);
  const cm = newCanvas(S, S), gm = cm.getContext('2d', { willReadFrequently: true }); gm.drawImage(mc, 0, 0, w, h);
  const px = gi.getImageData(0, 0, S, S).data, md = gm.getImageData(0, 0, S, S).data, N = S * S, img = new Float32Array(3 * N), m = new Float32Array(N);
  for (let i = 0; i < N; i++) { img[i] = px[i * 4] / 255; img[N + i] = px[i * 4 + 1] / 255; img[2 * N + i] = px[i * 4 + 2] / 255; m[i] = md[i * 4 + 3] > 10 ? 1 : 0; }
  const r = await czCall({ t: 'run2', key: 'lama', outs: ['output'], feeds: { image: { data: img, dims: [1, 3, S, S] }, mask: { data: m, dims: [1, 1, S, S] } } }, [img.buffer, m.buffer]);
  if (tk && tk.stop) throw trErr('stop');
  const y = r.out.output.data, co = newCanvas(S, S), go = co.getContext('2d'), od = go.createImageData(S, S);
  for (let i = 0; i < N; i++) { od.data[i * 4] = y[i]; od.data[i * 4 + 1] = y[N + i]; od.data[i * 4 + 2] = y[2 * N + i]; od.data[i * 4 + 3] = 255; }
  go.putImageData(od, 0, 0);
  const out = newCanvas(Q.w, Q.h), gO = out.getContext('2d'); gO.imageSmoothingQuality = 'high'; gO.drawImage(co, 0, 0, w, h, 0, 0, Q.w, Q.h);
  gO.globalCompositeOperation = 'destination-in'; gO.drawImage(mc, 0, 0);
  clean.getContext('2d').drawImage(out, Q.x, Q.y);
}
// 말풍선 안쪽 넓이 (번역 글자를 넣을 자리): 지운 뒤 바탕색으로 이어진 곳
function trRoom(g, CW, CH, bx, bgc) {
  const bw = bx.x1 - bx.x0, bh = bx.y1 - bx.y0, pad = Math.max(bw, bh) * 1.1;
  const R = { x: Math.max(0, Math.floor(bx.x0 - pad)), y: Math.max(0, Math.floor(bx.y0 - pad)) }; R.w = Math.min(CW, Math.ceil(bx.x1 + pad)) - R.x; R.h = Math.min(CH, Math.ceil(bx.y1 + pad)) - R.y;
  const s = Math.min(1, 300 / Math.max(R.w, R.h)), w = Math.max(2, Math.round(R.w * s)), h = Math.max(2, Math.round(R.h * s));
  const c = newCanvas(w, h), gc = c.getContext('2d', { willReadFrequently: true }); gc.drawImage(g.canvas, R.x, R.y, R.w, R.h, 0, 0, w, h);
  const d = gc.getImageData(0, 0, w, h).data, seen = new Uint8Array(w * h), st = [];
  let sx = Math.round(((bx.x0 + bx.x1) / 2 - R.x) * s), sy = Math.round(((bx.y0 + bx.y1) / 2 - R.y) * s);
  const ok = i => trDist(d, i * 4, bgc) < 45;
  if (!ok(sy * w + sx)) { let f = false; for (let r = 1; r < 12 && !f; r++) for (let dy = -r; dy <= r && !f; dy++) for (let dx = -r; dx <= r && !f; dx++) { const x = sx + dx, y = sy + dy; if (x >= 0 && y >= 0 && x < w && y < h && ok(y * w + x)) { sx = x; sy = y; f = true; } } if (!f) return null; }
  st.push(sy * w + sx); seen[sy * w + sx] = 1;
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, leak = false;
  while (st.length) {
    const i = st.pop(), x = i % w, y = (i / w) | 0; n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if ((x === 0 && R.x > 0) || (y === 0 && R.y > 0) || (x === w - 1 && R.x + R.w < CW) || (y === h - 1 && R.y + R.h < CH)) leak = true;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && ok(j)) { seen[j] = 1; st.push(j); }
  }
  if (leak || x1 < x0) return null;
  const fw = (x1 - x0 + 1) / s, fh = (y1 - y0 + 1) / s, ratio = n / ((x1 - x0 + 1) * (y1 - y0 + 1)), k = 0.76 + 0.14 * clamp((ratio - 0.76) / 0.16, 0, 1);
  return { cx: R.x + (x0 + x1 + 1) / 2 / s, cy: R.y + (y0 + y1 + 1) / 2 / s, w: fw * k, h: fh * k };
}

/* ---- 번역 글자 넣기 ---- */
const TR_NOSTART = new Set([...'、。，．,.!?！？…‥ー」』）)】〕〉》ゃゅょぁぃぅぇぉっャュョァィゥェォッ~～♡♥']);
function trWrap(el, text, maxW, cjk) {
  mctx.font = fontStr(el); const W = s => mctx.measureText(s).width, out = [];
  for (const para of String(text).split('\n')) {
    if (cjk) { // 일본어·중국어: 글자 단위 (줄 첫머리에 오면 안 되는 글자는 앞줄에)
      let line = '';
      for (const ch of para) { if (line && W(line + ch) > maxW && !TR_NOSTART.has(ch)) { out.push(line); line = ch; } else line += ch; }
      out.push(line); continue;
    }
    const words = para.split(/(\s+)/).filter(s => s.length); let line = '';
    for (const wd of words) {
      if (/^\s+$/.test(wd)) { if (line) line += ' '; continue; }
      if (!line) { line = wd; } else if (W(line + wd) <= maxW) line += wd; else { out.push(line.trimEnd()); line = wd; }
      while (W(line) > maxW && [...line].length > 1) { // 한 낱말이 너무 길면 글자 단위로
        const cs = [...line]; let k = cs.length - 1; while (k > 1 && W(cs.slice(0, k).join('')) > maxW) k--;
        out.push(cs.slice(0, k).join('')); line = cs.slice(k).join('');
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
// 상자(page 좌표)에 맞춰 글자 크기·줄바꿈 정하기
function trFit(el, text, box, cap) {
  const cjk = el.vert || /^(ja|zh)$/.test(el.trL || ''), paras = String(text).split('\n').length;
  const lay = fs => { // 이 크기에서 줄 나누기 → {lines, w, h}
    el.fs = fs;
    if (el.vert) { // 세로쓰기: 줄 = 세로 한 칸
      const per = Math.max(1, Math.floor(box.h / (fs * 1.02))), cols = [];
      for (const para of String(text).split('\n')) { const cs = [...para]; for (let i = 0; i < Math.max(1, cs.length); i += per) cols.push(cs.slice(i, i + per).join('')); }
      return { lines: cols, w: cols.length * fs * el.lh, h: Math.max(...cols.map(c => [...c].length)) * fs * 1.02 };
    }
    const lines = trWrap(el, text, box.w - (el.sw || 0) * 2, cjk); mctx.font = fontStr(el);
    return { lines, w: Math.max(...lines.map(l => mctx.measureText(l).width)), h: lines.length * fs * el.lh };
  };
  const hi = Math.max(5, Math.min(cap || 1e9, box.h, box.w)), lo = Math.max(4, Math.min(box.w, box.h) * 0.05);
  let best = null;
  for (let fs = hi; fs >= lo; fs *= 0.96) { // 크게, 하지만 원래 줄바꿈보다 더 쪼개지면 조금 손해
    const L = lay(fs), sw = (el.sw || 0) * 2; if (L.w + sw > box.w || L.h + sw > box.h) continue;
    const score = fs * Math.pow(0.86, Math.max(0, L.lines.length - paras));
    if (!best || score > best.score) best = { score, fs, lines: L.lines };
    if (L.lines.length <= paras) break; // 원래 줄바꿈 그대로 들어가면 더 작게 할 필요 없음
  }
  if (!best) { const L = lay(lo); best = { fs: lo, lines: L.lines }; }
  el.fs = Math.round(best.fs * 10) / 10; el.text = best.lines.join('\n');
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2; el.x = cx - 5; el.y = cy - 5; el.w = 10; el.h = 10; fitText(el);
}
const trHex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function trMakeText(o, blk, box, info, k) {
  const el = { id: uid(), type: 'text', x: 0, y: 0, w: 10, h: 10, rot: 0, text: '', seed: 1, ...clone(doc.defaults.text) };
  Object.assign(el, { font: o.font || '고딕', bold: blk.kind === 'sfx' || blk.kind === 'sign', italic: false, lh: o.dst === 'ko' ? 1.22 : 1.15, align: 'center', sw: 0, sw2: 0, ext: 0, glow: 0, shA: 0, boxOn: false, jit: 0, grow: 0, sp: 0, skew: 0, rough: 0, fillGrad: false, arc: 0 });
  const dl = o.dst === 'same' ? trGuessLang(blk.translation) : o.dst;
  el.lh = dl === 'ko' ? 1.22 : 1.15;
  el.vert = !!blk.vertical && /^(ja|zh)$/.test(dl);
  el.trL = dl; el.trT = 1;
  const S = o.style && myStyleById(o.style);
  if (S) styleApply(el, S, true);
  else {
    const tc = info.tcol || [17, 17, 17]; el.color = trHex(tc);
    if (info.stroke) el.sc = trHex(info.stroke);
    else if (!info.uniform) { const lum = tc[0] * 0.3 + tc[1] * 0.59 + tc[2] * 0.11; el.sc = lum > 128 ? '#111111' : '#ffffff'; } // 그림 위 글자는 테두리로 잘 보이게
  }
  const cap = info.fsEst ? info.fsEst / k * (info.stroke ? 1 : 1.12) : 0;
  el.trB = { x: box.x, y: box.y, w: box.w, h: box.h }; el.trC = cap || 0;
  const swR = S ? 0 : info.stroke ? 0.075 * clamp(info.strokeR / 2, 0.5, 1.6) : !info.uniform ? 0.09 : 0;
  if (swR) el.sw = 0;
  trFit(el, blk.translation, box, cap);
  if (swR) { el.sw = Math.max(1.5, el.fs * swR); trFit(el, blk.translation, box, cap); el.sw = Math.max(1.5, el.fs * swR); fitText(el); }
  if (S) { const f = el.fs; styleApply(el, S, true); el.fs = f; fitText(el); }
  return el;
}

/* ---- 그림이 거절될 때: 글자 자리만 찾아 잘라 보내기 ---- */
const TR_SCHEMA_SHEET = JSON.parse(JSON.stringify(TR_SCHEMA));
(it => { delete it.properties.box_2d; it.properties.id = { type: 'INTEGER' }; it.properties.kind = { type: 'STRING', enum: [...TR_KINDS, 'none'] }; it.required = ['id', 'kind', 'source', 'translation']; })(TR_SCHEMA_SHEET.properties.blocks.items);
// PP-OCR 검출: 글줄 상자들 (canvas 좌표)
async function trDetect(src, CW, CH, tk) {
  await czLoad('tdet'); if (tk && tk.stop) throw trErr('stop');
  const s = Math.min(1, 1280 / CW), w = Math.max(32, Math.round(CW * s / 32) * 32), sx = w / CW, SH = 1536, ov = 192, lines = [];
  const totH = Math.round(CH * sx);
  for (let y = 0; ; y += SH - ov) {
    const yy = Math.max(0, Math.min(y, totH - SH)), hh = Math.max(32, Math.ceil(Math.min(SH, totH - yy) / 32) * 32);
    const c = newCanvas(w, hh), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh);
    g.drawImage(src, 0, yy / sx, CW, hh / sx, 0, 0, w, hh);
    const d = g.getImageData(0, 0, w, hh).data, N = w * hh, x = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) { x[i] = (d[i * 4 + 2] / 255 - 0.485) / 0.229; x[N + i] = (d[i * 4 + 1] / 255 - 0.456) / 0.224; x[2 * N + i] = (d[i * 4] / 255 - 0.406) / 0.225; }
    const r = await czCall({ t: 'run', key: 'tdet', data: x, dims: [1, 3, hh, w] }, [x.buffer]), P = r.data;
    const seen = new Uint8Array(N), st = [];
    for (let i0 = 0; i0 < N; i0++) {
      if (seen[i0] || P[i0] <= 0.3) continue;
      seen[i0] = 1; st.length = 0; st.push(i0); let n = 0, sum = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      while (st.length) {
        const i = st.pop(), px = i % w, py = (i / w) | 0; n++; sum += P[i];
        if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
        for (const j of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py > 0 ? i - w : -1, py < hh - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && P[j] > 0.3) { seen[j] = 1; st.push(j); }
      }
      if (n < 8 || sum / n < 0.5) continue;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1, off = n * 1.5 / (2 * (bw + bh)); // 테두리 넓히기 (DB unclip)
      lines.push({ x0: (x0 - off) / sx, y0: (yy + y0 - off) / sx, x1: (x1 + 1 + off) / sx, y1: (yy + y1 + 1 + off) / sx });
    }
    if (yy + SH >= totH) break;
  }
  return lines.map(b => ({ x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(CW, b.x1), y1: Math.min(CH, b.y1) })).filter(b => b.x1 - b.x0 > 3 && b.y1 - b.y0 > 3);
}
// 가까운 글줄끼리 한 덩어리 (말풍선 하나·세로 여러 줄)
function trGroup(lines) {
  const n = lines.length, par = lines.map((_, i) => i), f = i => par[i] === i ? i : (par[i] = f(par[i]));
  const th = b => Math.min(b.x1 - b.x0, b.y1 - b.y0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = lines[i], b = lines[j], g = Math.max(3, 0.55 * Math.min(th(a), th(b)));
    if (a.x0 - g < b.x1 && b.x0 - g < a.x1 && a.y0 - g < b.y1 && b.y0 - g < a.y1) par[f(i)] = f(j);
  }
  const m = new Map();
  for (let i = 0; i < n; i++) { const r = f(i), b = lines[i]; const B = m.get(r); if (!B) m.set(r, { ...b, th: th(b), n: 1, v: b.y1 - b.y0 > (b.x1 - b.x0) * 1.5 ? 1 : 0, lines: [b] }); else { B.lines.push(b); B.x0 = Math.min(B.x0, b.x0); B.y0 = Math.min(B.y0, b.y0); B.x1 = Math.max(B.x1, b.x1); B.y1 = Math.max(B.y1, b.y1); B.th = Math.min(B.th, th(b)); B.n++; if (b.y1 - b.y0 > (b.x1 - b.x0) * 1.5) B.v++; } }
  for (const B of m.values()) { const t = B.lines.map(th).sort((a, b) => a - b); B.th = t[(t.length / 2) | 0]; } // 글자 크기 = 글줄 굵기 가운데값
  return [...m.values()];
}
// 잘라 모은 그림들 (한 장에 너무 많으면 여러 장)
function trSheets(src, blocks, CH, rtl) {
  const band = CH * 0.1;
  blocks.sort((a, b) => Math.floor(a.y0 / band) - Math.floor(b.y0 / band) || (rtl ? b.x1 - a.x1 : a.x0 - b.x0));
  const SW = 1400, GAP = 14, LH = 30, items = blocks.map((b, i) => {
    b.id = i + 1; const pad = Math.max(4, b.th * 0.35), R = { x: Math.max(0, b.x0 - pad), y: Math.max(0, b.y0 - pad) }; R.w = Math.min(src.width, b.x1 + pad) - R.x; R.h = Math.min(src.height, b.y1 + pad) - R.y;
    let k = clamp(40 / Math.max(1, b.th), 0.35, 2.5); k = Math.min(k, (SW - 20) / R.w, 1500 / R.h);
    return { b, R, w: Math.max(8, Math.round(R.w * k)), h: Math.max(8, Math.round(R.h * k)) };
  });
  const sheets = []; let cur = null, x = 0, y = 0, rowH = 0;
  const flush = () => { if (cur) { cur.h = y + rowH; sheets.push(cur); } };
  for (const it of items) {
    if (!cur) { cur = { list: [] }; x = 0; y = 0; rowH = 0; }
    if (x > 0 && x + it.w > SW) { x = 0; y += rowH + GAP; rowH = 0; }
    if (y > 0 && y + it.h + LH > 2400) { flush(); cur = { list: [] }; x = 0; y = 0; rowH = 0; }
    cur.list.push({ ...it, px: x, py: y }); x += Math.max(it.w, 60) + GAP; rowH = Math.max(rowH, it.h + LH);
  }
  flush();
  return sheets.map(S => {
    const c = newCanvas(SW, Math.max(40, S.h)), g = c.getContext('2d'); g.fillStyle = '#9aa0a8'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high'; g.font = 'bold 22px sans-serif'; g.textBaseline = 'top';
    for (const it of S.list) {
      g.fillStyle = '#d62828'; const lab = '#' + it.b.id, lw = g.measureText(lab).width + 12; g.fillRect(it.px, it.py, lw, 26); g.fillStyle = '#fff'; g.fillText(lab, it.px + 6, it.py + 3);
      // 글줄 자리만 (둘레 그림은 흰색으로 가려요)
      const k = it.w / it.R.w, py = it.py + LH; g.fillStyle = '#ffffff'; g.fillRect(it.px, py, it.w, it.h);
      g.save(); g.beginPath();
      for (const L of it.b.lines) { const pd = Math.max(2, Math.min(L.x1 - L.x0, L.y1 - L.y0) * 0.12); g.rect(it.px + (L.x0 - pd - it.R.x) * k, py + (L.y0 - pd - it.R.y) * k, (L.x1 - L.x0 + pd * 2) * k, (L.y1 - L.y0 + pd * 2) * k); }
      g.clip(); g.drawImage(src, it.R.x, it.R.y, it.R.w, it.R.h, it.px, py, it.w, it.h); g.restore();
    }
    return { canvas: c, ids: S.list.map(it => it.b.id) };
  });
}
async function trReadText(clean, CW, CH, o, ctx, tk, pre) {
  tk.set(pre + '글자 자리를 찾는 중…');
  const blocks = trGroup(await trDetect(clean, CW, CH, tk)).filter(b => b.x1 - b.x0 > 6 && b.y1 - b.y0 > 6);
  if (!blocks.length) return { blocks: [], summary: '' };
  const rtl = o.src === 'ja' || o.src === 'zh' || (o.src === 'auto' && blocks.filter(b => b.v > b.n / 2).length > blocks.length / 2);
  const sheets = trSheets(clean, blocks, CH, rtl), out = []; let summary = '';
  for (let si = 0; si < sheets.length; si++) {
    const S = sheets[si];
    tk.set(`${pre}글자 부분만 보내서 번역하는 중…${sheets.length > 1 ? ` (${si + 1}/${sheets.length})` : ''}`);
    const r = await trAsk(trPrompt(o, ctx, true), S.canvas.toDataURL('image/jpeg', 0.92).split(',')[1], tk, TR_SCHEMA_SHEET);
    if (r.summary) summary = summary ? summary + ' ' + r.summary : r.summary;
    for (const b of r.blocks || []) {
      const B = blocks.find(x => x.id === +b.id); if (!B || !S.ids.includes(B.id) || b.kind === 'none') continue;
      const src = String(b.source || '').trim(), dst = String(b.translation || '').trim(); if (!src && !dst) continue;
      out.push({ box: { x0: B.x0, y0: B.y0, x1: B.x1, y1: B.y1, th: B.th }, kind: TR_KINDS.includes(b.kind) ? b.kind : 'other', vertical: b.vertical != null ? !!b.vertical : B.v > B.n / 2, speaker: String(b.speaker || '').slice(0, 30), source: src, translation: dst });
      ctx.lines.push({ s: src, d: dst, who: b.speaker || '' });
    }
  }
  return { blocks: out, summary };
}

/* ---- 한 그림 번역 ---- */
async function trReadPage(clean, CW, CH, o, ctx, tk, pre) {
  // 길쭉한 웹툰은 겹치게 잘라 여러 번 (글자를 작게 줄이지 않으려고)
  const tH = Math.round(CW * 1.6), tiles = [];
  if (CH <= tH * 1.15) tiles.push({ y: 0, h: CH, c0: 0, c1: CH });
  else { const ov = Math.round(tH * 0.18); for (let y = 0; ; y += tH - ov) { const yy = Math.min(y, CH - tH), last = yy + tH >= CH; tiles.push({ y: yy, h: tH, c0: tiles.length ? tiles[tiles.length - 1].c1 : 0, c1: last ? CH : yy + tH - ov / 2 }); if (last) break; } }
  const blocks = []; let summary = '';
  for (let ti = 0; ti < tiles.length; ti++) {
    const T = tiles[ti], s = Math.min(1, 2048 / Math.max(CW, T.h), 1536 / Math.min(CW, T.h)), sw = Math.max(1, Math.round(CW * s)), sh = Math.max(1, Math.round(T.h * s));
    const tc = newCanvas(sw, sh), tg = tc.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(clean, 0, T.y, CW, T.h, 0, 0, sw, sh);
    const b64 = tc.toDataURL('image/jpeg', 0.92).split(',')[1];
    tk.set(`${pre}${tiles.length > 1 ? `${ti + 1}/${tiles.length}조각 · ` : ''}제미나이가 읽고 번역하는 중…`);
    const r = await trAsk(trPrompt(o, ctx), b64, tk);
    if (r.summary) summary = summary ? summary + ' ' + r.summary : r.summary;
    for (const b of r.blocks || []) {
      const bb = (b.box_2d || []).map(Number); if (bb.length !== 4 || bb.some(v => !isFinite(v))) continue;
      let [y0, x0, y1, x1] = bb; if (y1 < y0) [y0, y1] = [y1, y0]; if (x1 < x0) [x0, x1] = [x1, x0];
      const box = { x0: clamp(x0, 0, 1000) / 1000 * CW, x1: clamp(x1, 0, 1000) / 1000 * CW, y0: T.y + clamp(y0, 0, 1000) / 1000 * T.h, y1: T.y + clamp(y1, 0, 1000) / 1000 * T.h };
      if (box.x1 - box.x0 < 3 || box.y1 - box.y0 < 3) continue;
      const cy = (box.y0 + box.y1) / 2; if (cy < T.c0 || cy >= T.c1) continue; // 겹치는 곳은 한 조각만
      const src = String(b.source || '').trim(), dst = String(b.translation || '').trim(); if (!src && !dst) continue;
      blocks.push({ box, kind: TR_KINDS.includes(b.kind) ? b.kind : 'other', vertical: !!b.vertical, speaker: String(b.speaker || '').slice(0, 30), source: src, translation: dst });
      ctx.lines.push({ s: src, d: dst, who: b.speaker || '' });
    }
  }
  return { blocks, summary };
}
const trIsMine = e => e.trT || e.trE;
function trClear(p) { p.els = p.els.filter(e => !trIsMine(e)); delete p.tr; lyFixGroups(p); }
async function trPage(p, o, ctx, tk, pre) {
  const B = baseEl(p), rec = B && B.img && images.get(B.img), im = rec && imgCache.get(rec.id);
  if (!B || !im) throw trErr('noimg', '그림을 찾지 못했어요');
  if (!im.complete || !im.naturalWidth) await im.decode().catch(() => { });
  trClear(p);
  // 그림(바탕·그림 레이어)만 원래 해상도로 그려요 (말풍선·글자·효과음은 빼고)
  let k = clamp(rec.w / Math.max(1, B.w), 1, 3); k = Math.min(k, Math.sqrt(30e6 / (p.w * p.h)));
  const CW = Math.max(1, Math.round(p.w * k)), CH = Math.max(1, Math.round(p.h * k));
  const clean = newCanvas(CW, CH), g = clean.getContext('2d', { willReadFrequently: true }); g.fillStyle = p.bg || '#fff'; g.fillRect(0, 0, CW, CH);
  g.setTransform(k, 0, 0, k, 0, 0); const view = { x0: 0, y0: 0, x1: p.w, y1: p.h };
  let at = 0; p.els.forEach((e, i) => { if (!AI_OVER[e.type]) at = i + 1; });
  for (const e of p.els.slice(0, at)) if (!e.hidden && !AI_OVER[e.type]) drawEl(g, e, { screen: false, rs: k, view });
  g.setTransform(1, 0, 0, 1, 0, 0);
  let via = o.send === 'text' ? 'text' : 'page', R0 = null;
  if (via === 'page') {
    try { R0 = await trReadPage(clean, CW, CH, o, ctx, tk, pre); }
    catch (e) { if (e.code === 'blocked' && o.send !== 'page' && o.tdetOk) { via = 'text'; tk.set(pre + '그림이 거절돼서 글자 부분만 보내는 중…'); } else throw e; }
  }
  if (via === 'text') { if (!o.tdetOk) throw trErr('notext', "'글자 부분만 보내기'에는 AI 글자 찾기 팩이 있어야 해요 (설치판)"); R0 = await trReadText(clean, CW, CH, o, ctx, tk, pre); }
  const blocks = R0.blocks, summary = R0.summary;
  // 지우기
  const useLama = o.lama && o.lamaOk, mAll = newCanvas(CW, CH), gmA = mAll.getContext('2d'); let ux0 = 1e9, uy0 = 1e9, ux1 = -1, uy1 = -1;
  const work = [];
  for (const b of blocks) {
    if (b.kind === 'sfx' && o.sfx === 'keep') continue;
    if (!b.translation) continue;
    b.box.nl = String(b.source || '').split('\n').length; const info = trAnalyze(g, CW, CH, b.box); work.push({ b, info });
    const { R, id, mask } = info;
    if (info.uniform) { const d = id.data; for (let i = 0; i < mask.length; i++) if (mask[i]) { d[i * 4] = info.bg[0]; d[i * 4 + 1] = info.bg[1]; d[i * 4 + 2] = info.bg[2]; } g.putImageData(id, R.x, R.y); }
    else if (!useLama) { trPushPull(id.data, mask, R.w, R.h); g.putImageData(id, R.x, R.y); }
    const mi = gmA.createImageData(R.w, R.h); for (let i = 0; i < mask.length; i++) if (mask[i]) mi.data[i * 4 + 3] = 255;
    const tmp = newCanvas(R.w, R.h); tmp.getContext('2d').putImageData(mi, 0, 0); gmA.drawImage(tmp, R.x, R.y);
    if (mask.some(v => v)) { ux0 = Math.min(ux0, R.x); uy0 = Math.min(uy0, R.y); ux1 = Math.max(ux1, R.x + R.w); uy1 = Math.max(uy1, R.y + R.h); }
  }
  if (useLama) {
    const lam = work.filter(w => !w.info.uniform);
    if (lam.length) { tk.set(pre + 'AI 지우개로 그림 위 글자를 지우는 중…'); await czLoad('lama'); }
    for (const { info } of lam) {
      if (tk.stop) throw trErr('stop');
      const { R, mask } = info, side = Math.min(Math.max(CW, CH), Math.max(R.w, R.h) * 2.2);
      const Q = { w: Math.round(Math.min(CW, side)), h: Math.round(Math.min(CH, side)) };
      Q.x = Math.round(clamp(R.x + R.w / 2 - Q.w / 2, 0, CW - Q.w)); Q.y = Math.round(clamp(R.y + R.h / 2 - Q.h / 2, 0, CH - Q.h));
      const mk = new Uint8Array(Q.w * Q.h);
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) if (mask[y * R.w + x]) { const qx = R.x + x - Q.x, qy = R.y + y - Q.y; if (qx >= 0 && qy >= 0 && qx < Q.w && qy < Q.h) mk[qy * Q.w + qx] = 1; }
      await trLama(clean, Q, mk, tk);
    }
  }
  tk.set(pre + '번역 글자를 넣는 중…');
  const add = [];
  if (ux1 > ux0) { // 지운 곳만 남긴 레이어 (가장자리는 살짝 부드럽게)
    const W = ux1 - ux0, H = uy1 - uy0, oc = newCanvas(W, H), og = oc.getContext('2d');
    og.drawImage(clean, ux0, uy0, W, H, 0, 0, W, H); og.globalCompositeOperation = 'destination-in'; og.filter = 'blur(0.6px)'; og.drawImage(mAll, ux0, uy0, W, H, 0, 0, W, H); og.filter = 'none';
    const src = oc.toDataURL('image/png'), im2 = await loadImg(src);
    const nr = { id: uid(), name: '번역 지움.png', src, w: W, h: H, alpha: true, kind: 'stamp' }; addImageRecord(nr, true, im2);
    const P = makePanel((ux0 + W / 2) / k, (uy0 + H / 2) / k, W / k, H / k, nr.id); P.bw = 0; P.radius = 0; P.name = '번역 지움'; P.trE = 1;
    p.els.splice(at, 0, P);
  }
  const trBlocks = [];
  for (const b of blocks) {
    const w = work.find(x => x.b === b);
    if (!w) { trBlocks.push({ src: b.source, dst: b.translation, kind: b.kind, who: b.speaker, id: null }); continue; }
    const bx = b.box, t = bx.t || bx;
    let room = w.info.uniform ? trRoom(g, CW, CH, t, w.info.bg) : null;
    if (room && (room.w < (t.x1 - t.x0) * 0.6 || room.h < (t.y1 - t.y0) * 0.6)) room = null;
    if (!room) {
      const ww = (t.x1 - t.x0), hh = (t.y1 - t.y0), cx = (t.x0 + t.x1) / 2, cy = (t.y0 + t.y1) / 2, vt = /^(ja|zh)$/.test(o.dst === 'same' ? trGuessLang(b.translation) : o.dst);
      if (hh > ww * 1.4 && !vt) { const A = ww * hh * 1.3, w2 = clamp(Math.sqrt(A * 1.1), ww * 1.1, Math.max(ww * 1.1, hh)); room = { cx, cy, w: w2, h: A / w2 * 1.1 }; } // 세로 글 → 가로 글: 넓이를 비슷하게
      else room = { cx, cy, w: Math.max(ww, hh * 0.8) * 1.12, h: Math.max(hh, ww * 0.5) * 1.12 };
    }
    room.w = Math.min(room.w, CW * 0.96); room.h = Math.min(room.h, CH); room.cx = clamp(room.cx, room.w / 2 + CW * 0.02, CW - room.w / 2 - CW * 0.02); room.cy = clamp(room.cy, room.h / 2, CH - room.h / 2); // 그림 밖으로 안 나가게
    const box = { x: (room.cx - room.w / 2) / k, y: (room.cy - room.h / 2) / k, w: room.w / k, h: room.h / k };
    const el = trMakeText(o, b, box, w.info, k); add.push(el);
    trBlocks.push({ src: b.source, dst: b.translation, kind: b.kind, who: b.speaker, id: el.id });
  }
  if (add.length) {
    if (!p.groups) p.groups = [];
    const gr = { id: uid(), name: '번역 글자' }; p.groups.push(gr);
    for (const e of add) { e.gid = gr.id; p.els.push(e); }
    lyFixGroups(p);
  }
  p.tr = { src: o.src, dst: o.dst, model: trCfg.model, via, at: Date.now(), summary: summary.slice(0, 600), blocks: trBlocks };
  if (summary) ctx.sums.push(summary.slice(0, 300));
  return { n: add.length, kept: trBlocks.length - add.length, via };
}

/* ---- 여러 그림 ---- */
let trBusy = false;
async function trRun(idxs, o) {
  if (trBusy) return; trBusy = true;
  const tk = czProgress('AI로 번역하는 중'); let done = 0, txt = 0, skip = [], viaT = 0;
  const ids = idxs.map(i => doc.pages[i].id);
  try {
    o.lamaOk = false;
    o.tdetOk = false;
    if (czIsApp()) { const st = await czPackState(false).catch(() => null); o.lamaOk = !!(o.lama && st && st.base && st.erase); o.tdetOk = !!(st && st.base && st.text); }
    const ctx = { sums: [], lines: [] };
    if (o.ctx) { // 앞 그림에서 번역해 둔 것 (문맥)
      const all = realIdx(), first = all.indexOf(idxs[0]);
      for (const i of all.slice(Math.max(0, first - 2), Math.max(0, first))) { const t = doc.pages[i].tr; if (t) { if (t.summary) ctx.sums.push(t.summary); for (const b of t.blocks.slice(-12)) ctx.lines.push({ s: b.src, d: b.dst, who: b.who }); } }
    }
    for (let n = 0; n < ids.length; n++) {
      if (tk.stop) break;
      const p = doc.pages.find(q => q.id === ids[n]); if (!p) continue;
      const pre = ids.length > 1 ? `${n + 1} / ${ids.length}장 · ` : '';
      tk.set(pre + '그림 준비하는 중…', n / ids.length);
      const back = p.els.slice(), gb = p.groups ? clone(p.groups) : null, trb = p.tr;
      try { const r = await trPage(p, o, o.ctx ? ctx : { sums: [], lines: [] }, tk, pre); done++; txt += r.n; if (r.via === 'text' && o.send !== 'text') viaT++; commit(); }
      catch (e) {
        p.els = back; if (gb) p.groups = gb; else delete p.groups; if (trb) p.tr = trb; else delete p.tr;
        if (e.code === 'stop') break;
        if (e.code === 'blocked' || e.code === 'parse' || e.code === 'noimg' || e.code === 'notext') { skip.push(`${p.name}: ${e.message}`); continue; }
        throw e;
      }
      tk.set(pre + '다 됐어요', (n + 1) / ids.length);
    }
    tk.done(); renderProps(); renderLib(); requestRender();
    const msg = done ? `${done}장을 번역했어요 (글자 ${txt}곳). 글자를 두 번 눌러 고치거나, 오른쪽 '페이지 번역'에서 번역문을 고칠 수 있어요` : '번역한 그림이 없어요';
    toast(msg + (viaT ? ` · ${viaT}장은 그림이 거절돼서 글자 부분만 보냈어요` : '') + (skip.length ? ` · ${skip.length}장은 건너뛰었어요` : '') + (tk.stop ? ' (중간에 멈췄어요)' : ''), 6000);
    if (skip.length) setTimeout(() => modal(`<h2>건너뛴 그림</h2><ul class="tips">${skip.map(s => `<li>${esc(s)}</li>`).join('')}</ul><p class="muted small">그림이 거절되면 '그림 보내기'를 '글자 부분만'으로 바꿔 보세요(AI 글자 찾기 팩 필요). 모델을 바꾸면 될 때도 있어요.</p><div class="foot"><button class="btn primary" data-close>닫기</button></div>`), 300);
  } catch (e) {
    tk.done(); renderProps(); requestRender();
    if (done) commit();
    toast((e && e.message) || '번역하지 못했어요', 7000);
  } finally { trBusy = false; }
}

/* ---- 설정·시작 창 ---- */
function trOpen() {
  const p = page(); if (!isImg() || !p || p.ph) { toast('이미지 편집에서 번역할 그림을 연 뒤 써 주세요'); return; }
  const fo = p.folder && folderById(p.folder), all = realIdx(), inF = fo ? all.filter(i => inFolder(doc.pages[i].folder, p.folder)) : [];
  const models = [...new Set([trCfg.model, ...(trCfg.models.length ? trCfg.models : TR_PREF)])];
  const lang = (id, cur, auto) => `<select id="${id}">${auto ? `<option value="auto" ${cur === 'auto' ? 'selected' : ''}>자동으로 알아내기</option>` : ''}${TR_LANGS.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const fontOpts = [...SYS_FONTS.map(f => f[0]), ...fonts.map(f => f.name)];
  const m = modal(`<h2>페이지 번역 (제미나이)</h2><p class="sub">그림 속 글자를 찾아 번역하고, 원래 글자만 지운 뒤 고칠 수 있는 글자로 다시 써요. 그림은 그대로라 언제든 끄거나 지울 수 있어요.</p>
    <div class="grid2">
      <span>API 키</span><span style="display:flex;gap:6px"><input type="password" id="trKey" value="${esc(trCfg.key)}" placeholder="AIza…" spellcheck="false" autocomplete="off" style="flex:1"><button class="btn sm" id="trKeyShow" title="보이기">보기</button></span>
      <span>모델</span><span style="display:flex;gap:6px"><select id="trModel" style="flex:1">${models.map(x => `<option ${x === trCfg.model ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select><button class="btn sm" id="trList" title="이 키로 쓸 수 있는 모델을 불러와요">모델 목록 불러오기</button></span>
      <span>원문</span><span>${lang('trSrc', trCfg.src, true)}</span>
      <span>번역할 말</span><span><select id="trDst">${TR_LANGS.map(([v, l]) => `<option value="${v}" ${trCfg.dst === v ? 'selected' : ''}>${l}</option>`).join('')}<option value="same" ${trCfg.dst === 'same' ? 'selected' : ''}>번역 없이 원문 그대로 (글자만 깔끔하게 다시 쓰기)</option></select></span>
      <span>대상</span><span class="seg" id="trScope"><button class="btn sm ${trCfg.scope === 'one' || (!fo && trCfg.scope === 'fold') ? 'on' : ''}" data-v="one">이 그림</button>${fo ? `<button class="btn sm ${trCfg.scope === 'fold' ? 'on' : ''}" data-v="fold">'${esc(fo.name)}' 폴더 (${inF.length}장)</button>` : ''}${all.length > 1 ? `<button class="btn sm ${trCfg.scope === 'all' ? 'on' : ''}" data-v="all">모든 그림 (${all.length}장)</button>` : ''}</span>
      <span>글꼴</span><span><select id="trFont">${fontOpts.map(f => `<option ${f === trCfg.font ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></span>
      <span>글자 모양</span><span><select id="trStyle"><option value="">자동 (원래 글자색에 맞춤)</option>${myStyles.map(S => `<option value="${S.id}" ${S.id === trCfg.style ? 'selected' : ''}>내 스타일: ${esc(S.n)}</option>`).join('')}</select></span>
      <span>효과음</span><span><select id="trSfx"><option value="keep" ${trCfg.sfx === 'keep' ? 'selected' : ''}>그대로 두기 (번역 목록에만)</option><option value="tr" ${trCfg.sfx === 'tr' ? 'selected' : ''}>지우고 번역해서 쓰기</option></select></span>
      <span>그림 보내기</span><span><select id="trSend"><option value="auto" ${(trCfg.send || 'auto') === 'auto' ? 'selected' : ''}>자동 (거절되면 글자 부분만)</option><option value="page" ${trCfg.send === 'page' ? 'selected' : ''}>그림 전체 (가장 정확해요)</option><option value="text" ${trCfg.send === 'text' ? 'selected' : ''}>글자 부분만 (그림은 안 보내요)</option></select></span>
      <span></span><span><label class="chk"><input type="checkbox" id="trLama" ${trCfg.lama ? 'checked' : ''}> 그림 위 글자는 AI 지우개로 깔끔하게 (설치판 AI 지우개 팩)</label></span>
      <span></span><span><label class="chk"><input type="checkbox" id="trCtx" ${trCfg.ctx ? 'checked' : ''}> 앞 그림 내용을 참고해서 말투·이름 맞추기</label></span>
    </div>
    <details class="sec" style="margin-top:8px" ${trCfg.gloss || trCfg.notes ? 'open' : ''}><summary>용어집·말투 메모</summary><div class="body">
      <p class="muted small" style="margin:0 0 4px">한 줄에 하나씩 '원문 = 번역'. 이름, 호칭, 신조어·은어를 적어 두면 늘 그렇게 옮겨요.</p>
      <textarea id="trGloss" rows="4" spellcheck="false" style="width:100%" placeholder="カイ = 카이&#10;先輩 = 선배&#10;ぴえん = 흑흑">${esc(trCfg.gloss)}</textarea>
      <p class="muted small" style="margin:8px 0 4px">말투·관계 메모 (예: 카이는 반말, 지호는 카이에게 존댓말. 거친 말투 그대로)</p>
      <textarea id="trNotes" rows="3" spellcheck="false" style="width:100%">${esc(trCfg.notes)}</textarea></div></details>
    <p class="muted small">키는 이 컴퓨터에만 저장돼요. 번역할 그림('글자 부분만'이면 글자 부분 조각만)이 구글(제미나이)로 보내져요. 키는 Google AI Studio(aistudio.google.com)의 'Get API key'에서 받아요.</p>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="trGo">번역 시작</button></div>`, { wide: true });
  let scope = $('#trScope .on', m) ? $('#trScope .on', m).dataset.v : 'one';
  $$('#trScope [data-v]', m).forEach(b => b.addEventListener('click', () => { scope = b.dataset.v; $$('#trScope [data-v]', m).forEach(x => x.classList.toggle('on', x === b)); }));
  $('#trKeyShow', m).addEventListener('click', () => { const i = $('#trKey', m); i.type = i.type === 'password' ? 'text' : 'password'; });
  const read = () => {
    trCfg.key = $('#trKey', m).value.trim(); trCfg.model = $('#trModel', m).value; trCfg.src = $('#trSrc', m).value; trCfg.dst = $('#trDst', m).value;
    trCfg.font = $('#trFont', m).value; trCfg.style = $('#trStyle', m).value; trCfg.sfx = $('#trSfx', m).value; trCfg.lama = $('#trLama', m).checked; trCfg.ctx = $('#trCtx', m).checked;
    trCfg.gloss = $('#trGloss', m).value; trCfg.notes = $('#trNotes', m).value; trCfg.scope = scope; trCfg.send = $('#trSend', m).value; trSaveCfg();
  };
  $('#trList', m).addEventListener('click', async e => {
    read(); if (!trCfg.key) { toast('먼저 API 키를 넣어 주세요'); return; }
    const b = e.currentTarget; b.disabled = true; b.textContent = '불러오는 중…';
    try {
      const L = await trListModels(); if (!L.length) throw trErr('none', '쓸 수 있는 제미나이 모델이 없어요');
      trCfg.models = L; if (!L.includes(trCfg.model)) trCfg.model = L[0]; trSaveCfg();
      $('#trModel', m).innerHTML = L.map(x => `<option ${x === trCfg.model ? 'selected' : ''}>${esc(x)}</option>`).join('');
      toast(`키가 맞아요. 모델 ${L.length}개를 불러왔어요`, 2600);
    } catch (er) { toast(er.message, 5000); }
    b.disabled = false; b.textContent = '모델 목록 불러오기';
  });
  $('#trGo', m).addEventListener('click', async () => {
    read();
    if (!trCfg.key) { toast('제미나이 API 키를 넣어 주세요'); $('#trKey', m).focus(); return; }
    if (trCfg.src !== 'auto' && trCfg.src === trCfg.dst) { toast('원문과 번역할 말이 같아요'); return; }
    const idxs = scope === 'all' ? all.slice() : scope === 'fold' ? inF : [doc.cur];
    const redo = idxs.filter(i => doc.pages[i].tr).length;
    if (redo && !(await askYes(`이미 번역한 그림 ${redo}장은 전에 넣은 번역을 지우고 다시 해요. 할까요?`))) return;
    closeModal();
    if (czIsApp()) {
      const st = await czPackState(false).catch(() => null);
      if (trCfg.lama && st && !st.erase && !(await aiReady('erase'))) trCfg.lama = false;
      if (trCfg.send !== 'page' && st && !st.text && !(await aiReady('text')) && trCfg.send === 'text') return;
    } else if (trCfg.send === 'text') { toast("'글자 부분만 보내기'는 설치판에서 AI 글자 찾기 팩을 받아 쓸 수 있어요", 4600); return; }
    trRun(idxs, { ...trCfg });
  });
}
async function askYes(q) { return new Promise(res => { const m = modal(`<h2>확인</h2><p>${esc(q)}</p><div class="foot"><button class="btn" id="ayN">취소</button><button class="btn primary" id="ayY">계속</button></div>`); $('#ayY', m).addEventListener('click', () => { closeModal(); res(true); }); $('#ayN', m).addEventListener('click', () => { closeModal(); res(false); }); }); }

/* ---- 오른쪽 '페이지 번역' 칸 (번역문 고치기·원문 보기·지우기) ---- */
function trSec() {
  const p = page(); if (!p || p.ph) return '';
  const t = p.tr, hid = t && p.els.some(e => trIsMine(e) && e.hidden);
  const KN = { speech: '대사', thought: '속마음', narration: '설명', sfx: '효과음', sign: '글씨', other: '기타' };
  return sec('trans', '페이지 번역 (AI)', `<p class="muted small" style="margin:0 0 6px">그림 속 글자를 번역해 원래 글자만 지우고 고칠 수 있는 글자로 다시 써요 (제미나이 API 키 필요).</p>
    <div class="btnrow"><button class="btn sm primary" data-act="tr-open">${t ? '다시 번역…' : '번역하기…'}</button>${t ? `<button class="btn sm" data-act="tr-orig">${hid ? '번역 보기' : '원문 보기'}</button><button class="btn sm danger" data-act="tr-clear">번역 지우기</button>` : ''}</div>
    ${t ? `<div class="trlist">${t.blocks.map((b, i) => `<div class="trrow ${b.id ? '' : 'off'}"><div class="trsrc"><b>${KN[b.kind] || ''}${b.who ? ' · ' + esc(b.who) : ''}</b> ${esc(b.src)}</div>${b.id ? `<textarea data-trb="${i}" rows="${Math.min(4, String(b.dst).split('\n').length + (b.dst.length > 24 ? 1 : 0))}" spellcheck="false">${esc(b.dst)}</textarea>` : `<div class="trdst muted">${esc(b.dst)} <span class="small">(그대로 둠)</span></div>`}</div>`).join('')}</div>
    <p class="muted small">번역문을 고치면 그 자리에 맞춰 크기를 다시 맞춰요. 글자를 직접 고르면 글꼴·색·크기도 바꿀 수 있어요.</p>` : ''}`, t ? String(t.blocks.filter(b => b.id).length) : '');
}
function trAct(a) {
  const p = page();
  if (a === 'tr-open') { trOpen(); return; }
  if (!p || !p.tr) return;
  if (a === 'tr-orig') { const mine = p.els.filter(trIsMine), hide = !mine.some(e => e.hidden); for (const e of mine) e.hidden = hide || undefined; if (!hide) for (const e of mine) delete e.hidden; }
  else if (a === 'tr-clear') { trClear(p); sel = []; toast('이 그림의 번역을 지웠어요. Ctrl+Z로 되돌릴 수 있어요'); }
  commit(); renderProps(); renderLayers(); requestRender();
}
propsEl.addEventListener('input', e => {
  const t = e.target; if (!t.dataset || t.dataset.trb === undefined) return;
  const p = page(), b = p.tr && p.tr.blocks[+t.dataset.trb]; if (!b || !b.id) return;
  const el = p.els.find(x => x.id === b.id); b.dst = t.value; if (!el) return;
  if (el.trB) trFit(el, t.value || ' ', el.trB, el.trC || 0); else { el.text = t.value; fitText(el); }
  requestRender();
});
propsEl.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.trb !== undefined) { e2SetHint('번역문 고치기'); commit(); } });

/* ================= 제미나이로 글자 번역·다듬기 (말풍선·글자·움짤 글자) ================= */
function trGuessLang(t) { t = String(t || ''); if (/[\uac00-\ud7a3]/.test(t)) return 'ko'; if (/[\u3040-\u30ff]/.test(t)) return 'ja'; if (/[\u4e00-\u9fff]/.test(t)) return 'zh'; return 'en'; }
async function trAskText(prompt, schema, tk) {
  for (let n = 0; n < 3; n++) {
    const gc = { responseMimeType: 'application/json', maxOutputTokens: 8192 }; if (!trOff.schema) gc.responseSchema = schema;
    let j;
    try { j = await trHttp('POST', `/models/${encodeURIComponent(trCfg.model)}:generateContent`, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc }, tk); }
    catch (e) { if (e.code === 'bad' && !trOff.schema && /schema|response_?mime/i.test(e.message)) { trOff.schema = 1; continue; } if (e.code === 'bad' && /block|safety|prohibit/i.test(e.message)) throw trErr('blocked', '제미나이가 이 글을 거절했어요'); throw e; }
    const c = (j.candidates || [])[0];
    if (!c) throw trErr('blocked', '제미나이가 이 글을 거절했어요' + ((j.promptFeedback || {}).blockReason ? ` (${j.promptFeedback.blockReason})` : ''));
    const out = trJson(((c.content && c.content.parts) || []).filter(p => !p.thought && p.text).map(p => p.text).join(''));
    if (out) return out;
  }
  throw trErr('parse', '제미나이 답을 읽지 못했어요');
}
const trCommonRules = () => `This is adult fiction (comics). Never censor, soften or refuse sexual, crude or violent lines; keep swearing and moans. Translate slang and neologisms into equally natural slang.${trCfg.gloss.trim() ? `\nGlossary (always use):\n${trCfg.gloss.trim().slice(0, 3000)}` : ''}${trCfg.notes.trim() ? `\nCharacter / tone notes:\n${trCfg.notes.trim().slice(0, 1500)}` : ''}`;
// API 키가 없으면 먼저 받아요
function trEnsureKey() {
  if (trCfg.key) return Promise.resolve(true);
  return new Promise(res => {
    const m = modal(`<h2>제미나이 API 키</h2><p class="sub">AI 번역·다듬기는 제미나이 API 키가 있어야 해요. Google AI Studio(aistudio.google.com)의 'Get API key'에서 받아요.</p>
      ${row('API 키', `<input type="password" id="tkKey" placeholder="AIza…" spellcheck="false" autocomplete="off">`)}
      <p class="muted small">키는 이 컴퓨터에만 저장돼요. 번역할 글(페이지 번역은 그림도)이 구글로 보내져요.</p>
      <div class="foot"><button class="btn" id="tkNo">취소</button><button class="btn primary" id="tkOk">확인</button></div>`);
    $('#tkNo', m).addEventListener('click', () => { closeModal(); res(false); });
    $('#tkOk', m).addEventListener('click', async () => {
      trCfg.key = $('#tkKey', m).value.trim(); if (!trCfg.key) return;
      try { const L = await trListModels(); if (L.length) { trCfg.models = L; if (!L.includes(trCfg.model)) trCfg.model = L[0]; } trSaveCfg(); closeModal(); res(true); }
      catch (e) { trCfg.key = ''; toast(e.message, 5000); }
    });
  });
}
// 하나 고치기: tgt = { text, set(v), ctx: [다른 대사들], label }
const TX_ACTS = [['tr:ko', '한국어로'], ['tr:ja', '일본어로'], ['tr:en', '영어로'], ['tr:zh', '중국어로'], ['nat', '자연스럽게'], ['short', '더 짧게'], ['emo', '감정 더 살리기'], ['casual', '반말로'], ['polite', '존댓말로']];
async function aiTxOpen(tgt) {
  if (!(await trEnsureKey())) return;
  const m = modal(`<h2>AI로 번역·다듬기</h2><p class="sub">${esc(tgt.label || '고른 글자')}를 제미나이로 고쳐요. 마음에 드는 것을 누르면 바로 바뀌어요.</p>
    <div class="txsrc">${esc(tgt.text || '(빈 글자)')}</div>
    <div class="txacts">${TX_ACTS.map(([v, l]) => `<button class="btn sm" data-tx="${v}">${l}</button>`).join('')}</div>
    <div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="txReq" placeholder="직접 요청 (예: 더 능글맞게, 사투리로, 효과음처럼)" spellcheck="false" style="flex:1"><button class="btn sm" id="txGo">요청</button></div>
    <div id="txOut" class="txout"></div>
    <div class="foot"><button class="btn" data-close>닫기</button></div>`, { wide: true });
  const out = $('#txOut', m);
  const run = async (act, req) => {
    const what = act && act.startsWith('tr:') ? `Translate it into natural ${TR_LN[act.slice(3)]} comic dialogue.` : ({ nat: 'Rewrite it to sound more natural and fluent, same language and meaning.', short: 'Make it noticeably shorter so it fits a smaller speech bubble, same language and meaning.', emo: 'Make it more emotional and expressive, same language and meaning.', casual: 'Rewrite it in casual / intimate speech (Korean: 반말), same language.', polite: 'Rewrite it in polite speech (Korean: 존댓말), same language.' })[act] || `Do this: ${req}`;
    out.innerHTML = '<p class="muted">제미나이가 생각하는 중…</p>'; $$('button', m).forEach(b => { if (!b.hasAttribute('data-close')) b.disabled = true; });
    try {
      const prompt = `You are an expert comic letterer and translator. Here is one line from a comic:\n"""${tgt.text}"""\n${tgt.ctx && tgt.ctx.length ? `Other lines on the same page, for context:\n${tgt.ctx.slice(0, 40).map(s => '- ' + String(s).replace(/\n/g, ' ')).join('\n')}\n` : ''}${what}\nKeep line breaks short so it fits a speech bubble (use \\n). Give 3 different good options.\n${trCommonRules()}\nReturn JSON {"options": ["...", "...", "..."]}.`;
      const r = await trAskText(prompt, { type: 'OBJECT', properties: { options: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['options'] });
      const ops = (r.options || []).map(s => String(s).trim()).filter(Boolean).slice(0, 5);
      out.innerHTML = ops.length ? ops.map((s, i) => `<button class="txopt" data-i="${i}">${esc(s)}</button>`).join('') : '<p class="muted">답이 비어 있어요. 다시 해 보세요.</p>';
      $$('.txopt', out).forEach(b => b.addEventListener('click', () => { tgt.set(ops[+b.dataset.i]); closeModal(); toast('바꿨어요. Ctrl+Z로 되돌릴 수 있어요', 1800); }));
    } catch (e) { out.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    $$('button', m).forEach(b => b.disabled = false);
  };
  $$('[data-tx]', m).forEach(b => b.addEventListener('click', () => run(b.dataset.tx)));
  $('#txGo', m).addEventListener('click', () => { const v = $('#txReq', m).value.trim(); if (v) run(null, v); });
  $('#txReq', m).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#txGo', m).click(); } });
}
// 여러 개 한꺼번에 번역: items = [{ text, set(v) }]
async function aiTxBatch(items, title, done) {
  items = items.filter(x => String(x.text || '').trim()); if (!items.length) { toast('번역할 글자가 없어요'); return; }
  if (!(await trEnsureKey())) return;
  const m = modal(`<h2>${esc(title)}</h2><p class="sub">글자 ${items.length}개를 한 번에 번역해요. 앞뒤 대사를 같이 보고 말투를 맞춰요.</p>
    ${row('번역할 말', `<select id="tbDst">${TR_LANGS.map(([v, l]) => `<option value="${v}" ${v === (trCfg.bdst || 'ja') ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
    <p class="muted small">용어집·말투 메모는 '페이지 번역' 설정에 적은 것을 같이 써요. 바꾼 뒤 Ctrl+Z로 한 번에 되돌릴 수 있어요.</p>
    <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="tbGo">번역</button></div>`);
  $('#tbGo', m).addEventListener('click', async () => {
    const dst = $('#tbDst', m).value; trCfg.bdst = dst; trSaveCfg(); closeModal();
    const tk = czProgress('AI로 번역하는 중'); tk.set(`글자 ${items.length}개를 번역하는 중…`, 0.2);
    try {
      const all = []; // 너무 많으면 나눠서 (앞 묶음 번역을 문맥으로)
      for (let a = 0; a < items.length; a += 120) {
        const part = items.slice(a, a + 120);
        const prompt = `You are an expert comic translator. Translate each numbered comic text (speech bubbles, captions, sound effects, in reading order) into natural ${TR_LN[dst]}. Keep each character's voice consistent and keep translations short enough for the same bubble; keep \\n line breaks where natural.\n${trCommonRules()}\n${all.length ? `Earlier lines already translated:\n${all.slice(-20).map(x => '- ' + x.replace(/\n/g, ' ')).join('\n')}\n` : ''}Texts:\n${part.map((x, i) => `[${i}] ${String(x.text).replace(/\n/g, '\\n')}`).join('\n')}\nReturn JSON {"items": [{"i": 0, "t": "..."}]} with one entry per text.`;
        const r = await trAskText(prompt, { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, t: { type: 'STRING' } }, required: ['i', 't'] } } }, required: ['items'] }, tk);
        for (const it of r.items || []) { const x = part[it.i]; if (x && typeof it.t === 'string' && it.t.trim()) { x.out = it.t.replace(/\\n/g, '\n'); all.push(it.t); } }
        tk.set(null, Math.min(1, (a + part.length) / items.length));
      }
      tk.done();
      let n = 0; for (const x of items) if (x.out != null) { x.set(x.out); n++; }
      if (done) done(n); toast(`${n}개를 번역했어요${n < items.length ? ` (${items.length - n}개는 그대로)` : ''}. Ctrl+Z로 되돌릴 수 있어요`, 3600);
    } catch (e) { tk.done(); if (e.code !== 'stop') toast(e.message, 6000); }
  });
}
// 편집기: 고른 말풍선·글자 / 페이지 전체
function aiTxEl() {
  const el = selEls()[0]; if (!el || (el.type !== 'text' && el.type !== 'bubble')) return;
  const ctx = page().els.filter(e => e !== el && (e.type === 'text' || e.type === 'bubble') && e.text).map(e => e.text);
  aiTxOpen({ text: el.text, ctx, label: el.type === 'bubble' ? '이 말풍선 대사' : '이 글자', set: v => { if (!findEl(el.id)) return; setProp(el, 'text', v); e2SetHint('AI 번역·다듬기'); commit(); renderProps(); requestRender(); } });
}
function aiTxPages(all) {
  const pgs = all ? (isImg() ? realIdx().map(i => doc.pages[i]) : doc.pages) : [page()], items = [];
  for (const p of pgs) for (const e of p.els) if ((e.type === 'text' || e.type === 'bubble') && !e.trT && String(e.text || '').trim()) items.push({ text: e.text, set: v => setProp(e, 'text', v) });
  aiTxBatch(items, all ? '모든 페이지 말풍선·글자 번역' : '이 페이지 말풍선·글자 번역', () => { e2SetHint('AI 번역'); commit(); renderProps(); requestRender(); });
}
function aiTxSec() {
  if (isImg()) return '';
  return `<div class="sec"><h3>말풍선·글자 번역 (AI)</h3><p class="muted small" style="margin:0 0 6px">이 작품의 말풍선·글자를 제미나이로 번역해요. 다른 나라 말 판을 만들 때 쓰세요 (먼저 '저장'으로 원본을 받아 두면 좋아요).</p>
    <div class="btnrow"><button class="btn sm" data-act="tx-page">이 페이지 번역…</button>${doc.pages.length > 1 ? '<button class="btn sm" data-act="tx-all">모든 페이지 번역…</button>' : ''}</div></div>`;
}
// 움짤 글자
function aiTxGs(a) {
  if (a === 'ov-ai') {
    const o = gs.ovs.find(x => x.id === gs.osel); if (!o || o.kind === 'image') return;
    aiTxOpen({ text: o.text, ctx: gs.ovs.filter(x => x !== o && x.kind !== 'image').map(x => x.text), label: '이 글자', set: v => { o.text = v; o.bmp = null; gsChanged(); } });
  } else aiTxBatch(gs.ovs.filter(x => x.kind !== 'image').map(o => ({ text: o.text, set: v => { o.text = v; o.bmp = null; } })), '움짤 글자 모두 번역', () => gsChanged());
}
