/* ================= AI 더빙 (제미나이 TTS: 대사 + 말투 → 목소리) ================= */
// 대사를 줄마다 적고 목소리·말투를 고르면 제미나이가 감정을 담아 읽어 줘요. 그림이 없어도 열 수 있어요.
// 줄마다 따로 만들기 때문에 하나씩 듣고·다시 만들고·따로 저장할 수 있고, 한 번에 이어 붙여 저장할 수도 있어요.
const DB_MODELS = [['gemini-3.8-flash-tts', '3.8 Flash (연기력 좋음)'], ['gemini-3.8-flash-lite-tts', '3.8 Flash-Lite (빠르고 쌈)']];
// 기본 목소리 30개 [이름, 남/여, 느낌]
const DB_VOICES = [
  ['Charon', 'm', '또렷한'], ['Puck', 'm', '밝은'], ['Fenrir', 'm', '들뜬'], ['Orus', 'm', '단단한'], ['Enceladus', 'm', '숨소리 섞인'], ['Iapetus', 'm', '맑은'], ['Umbriel', 'm', '느긋한'], ['Algieba', 'm', '부드러운'],
  ['Algenib', 'm', '거친'], ['Rasalgethi', 'm', '차분히 설명하는'], ['Alnilam', 'm', '단호한'], ['Schedar', 'm', '고른'], ['Achird', 'm', '친근한'], ['Zubenelgenubi', 'm', '편한'], ['Sadachbia', 'm', '생기 있는'], ['Sadaltager', 'm', '지적인'],
  ['Kore', 'f', '단단한'], ['Zephyr', 'f', '밝은'], ['Leda', 'f', '앳된'], ['Aoede', 'f', '산뜻한'], ['Callirrhoe', 'f', '느긋한'], ['Autonoe', 'f', '밝은'], ['Despina', 'f', '부드러운'], ['Erinome', 'f', '맑은'],
  ['Laomedeia', 'f', '경쾌한'], ['Achernar', 'f', '여린'], ['Gacrux', 'f', '성숙한'], ['Pulcherrima', 'f', '당찬'], ['Vindemiatrix', 'f', '다정한'], ['Sulafat', 'f', '따뜻한'],
];
// 감정 단추: [보이는 말, 말투 칸에 들어갈 말]
const DB_EMO = [['차분하게', 'calm and composed'], ['다정하게', 'warm and affectionate'], ['기쁘게', 'cheerful and bright'], ['신나게', 'excited and energetic'], ['화내며', 'angry, sharp'], ['화를 참으며', 'suppressing anger, tense and low'], ['차갑게', 'cold and curt'],
  ['슬프게', 'sad and subdued'], ['울먹이며', 'tearful, voice trembling'], ['속삭이듯', 'whispering softly'], ['나른하게', 'languid, drowsy, slow'], ['수줍게', 'shy and hesitant'], ['장난스럽게', 'playful, teasing'], ['놀라서', 'surprised, startled'],
  ['겁먹은', 'frightened, shaky voice'], ['숨차게', 'out of breath'], ['낮게 깔아서', 'low, husky, intimate'], ['비웃듯', 'mocking, sneering'], ['단호하게', 'firm and commanding'], ['지친', 'exhausted, weary'], ['내레이션', 'neutral narrator']];
const DB_TAGS = [['웃음', '<laugh>'], ['한숨', '<sigh>'], ['짧은 쉼', '<short pause>'], ['긴 쉼', '<long pause>'], ['기침', '<cough>']];
const DB_SPEED = { '': '', slow2: 'very slow pace', slow: 'slightly slow pace', fast: 'slightly fast pace', fast2: 'very fast pace' };
const DB_SAMPLE = '안녕하세요. 이 목소리로 읽어 드릴게요.';
const dbCfg = { model: DB_MODELS[0][0], voice: 'Charon', gap: 0.4, speed: '', into: 'one', chars: [], lines: [], xv: [], charsOpen: false };
try { Object.assign(dbCfg, JSON.parse(localStorage.getItem('potatoDubCfg') || '{}')); } catch (_) { }
let dbSaveT = 0;
const dbSave = () => { clearTimeout(dbSaveT); dbSaveT = setTimeout(() => { try { localStorage.setItem('potatoDubCfg', JSON.stringify(dbCfg)); } catch (_) { } }, 300); };
const dbAud = new Map(), dbPrev = new Map(), dbBusy = new Set(), dbErrs = new Map(); // 줄 id → { sig, blob(WAV), buf, dur } · 미리 듣기 · 만드는 중 · 실패한 까닭
let dbShape = 0, dbNodes = [], dbTok = 0, dbNow = null; // dbNow = 지금 소리 나는 것 ('all' 또는 줄 id)

const dbLineNew = o => Object.assign({ id: uid(), who: '', voice: dbCfg.voice, style: '', text: '' }, o || {});
const dbChar = id => dbCfg.chars.find(c => c.id === id);
const dbVoiceOf = l => { const c = dbChar(l.who); return (c ? c.voice : l.voice) || 'Charon'; };
const dbJoinStyle = (...a) => a.map(s => String(s || '').trim()).filter(Boolean).join(', ');
const dbStyleOf = l => { const c = dbChar(l.who); return dbJoinStyle(c && c.style, l.style, DB_SPEED[dbCfg.speed]); };
const dbSigOf = (voice, style, text) => [dbCfg.model, voice, style, text].join('\u0001');
const dbSig = l => dbSigOf(dbVoiceOf(l), dbStyleOf(l), l.text.trim());
const dbReady = l => { const a = dbAud.get(l.id); return a && a.sig === dbSig(l) ? a : null; };
function dbVoiceOpts(cur) {
  const o = ([n, , d]) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(n)}${d ? ' · ' + esc(d) : ''}</option>`;
  const known = DB_VOICES.some(v => v[0] === cur) || dbCfg.xv.some(v => v[0] === cur);
  return `${known || !cur ? '' : o([cur])}<optgroup label="남자 목소리">${DB_VOICES.filter(v => v[1] === 'm').map(o).join('')}</optgroup><optgroup label="여자 목소리">${DB_VOICES.filter(v => v[1] === 'f').map(o).join('')}</optgroup>${dbCfg.xv.length ? `<optgroup label="더 불러온 목소리">${dbCfg.xv.map(o).join('')}</optgroup>` : ''}`;
}

/* ---- 소리 다루기 ---- */
function dbWav(f32, sr) { // 한 줄(모노) 소리 → 16비트 WAV
  const n = f32.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
  return new Blob([b], { type: 'audio/wav' });
}
function dbPcmWav(u8, sr) { // 머리말 없는 16비트 PCM → WAV
  const n = u8.length & ~1, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n, true);
  b.set(u8.subarray(0, n), 44); return new Blob([b], { type: 'audio/wav' });
}
function dbJoin(bufs, gap) { // 여러 소리를 쉼을 두고 한 줄로
  const sr = bufs[0].sampleRate, g = Math.round(Math.max(0, gap) * sr); let n = 0;
  bufs.forEach((b, i) => { n += Math.round(b.duration * sr) + (i < bufs.length - 1 ? g : 0); });
  const out = new Float32Array(n); let p = 0;
  for (const b of bufs) {
    const ch = b.numberOfChannels, k = b.sampleRate / sr, len = Math.round(b.duration * sr);
    for (let c = 0; c < ch; c++) { const d = b.getChannelData(c); for (let i = 0; i < len && p + i < n; i++) out[p + i] += (d[Math.min(d.length - 1, Math.round(i * k))] || 0) / ch; }
    p += len + g;
  }
  return dbWav(out, sr);
}
function dbStop() { dbTok++; for (const s of dbNodes) { try { s.onended = null; s.stop(); } catch (_) { } } dbNodes = []; dbNow = null; }
function dbPlay(bufs, gap, what, onEnd) {
  dbStop(); const ctx = auCtxGet(); if (!ctx || !bufs.length) return;
  const tok = dbTok; let at = ctx.currentTime + 0.05; dbNow = what;
  bufs.forEach((b, i) => {
    const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(at); at += b.duration + gap; dbNodes.push(s);
    if (i === bufs.length - 1) s.onended = () => { if (tok === dbTok) { dbNodes = []; dbNow = null; if (onEnd) onEnd(); } };
  });
}

/* ---- 제미나이 부르기 ---- */
function dbFind(o, out = { auds: [], texts: [] }, d = 0) { // 답 어디에 있든 소리를 찾아요
  if (!o || d > 8) return out;
  if (Array.isArray(o)) { for (const x of o) dbFind(x, out, d + 1); return out; }
  if (typeof o !== 'object') return out;
  if (o.type === 'audio' && (o.data || o.uri)) out.auds.push(o);
  else if (o.type === 'text' && typeof o.text === 'string') out.texts.push(o.text);
  for (const k in o) if (o[k] && typeof o[k] === 'object') dbFind(o[k], out, d + 1);
  return out;
}
async function dbTts(text, style, voice, tk) {
  const part = { type: 'text', text }; if (style) part.annotations = [{ type: 'speech_metadata', style }];
  // 문서의 요청 모양이 첫 번째예요. 안 받으면 비슷한 다른 모양으로 한 번씩 더 해 봐요
  const mk = [
    () => ({ input: [{ type: 'user_input', content: [part] }], generation_config: { speech_config: [{ voice }] } }),
    () => ({ input: [part], generation_config: { speech_config: [{ voice }] } }),
    () => ({ input: [{ type: 'user_input', content: [part] }], generation_config: { speech_config: { voice } } }),
  ];
  let j = null, first = null;
  for (let k = 0; k < mk.length && !j; k++) {
    const i = (dbShape + k) % mk.length;
    try { j = await trHttp('POST', '/interactions', Object.assign({ model: dbCfg.model, response_format: { type: 'audio' } }, mk[i]()), tk); dbShape = i; }
    catch (e) {
      if (e.code === 'model') throw trErr('model', `'${dbCfg.model}' 더빙 모델을 이 키로 쓸 수 없어요. 위에서 다른 모델을 골라 보세요`);
      if (e.code !== 'bad') throw e;
      if (/block|safety|polic|prohibit|violat/i.test(e.message)) throw trErr('blocked', '제미나이가 이 대사를 거절했어요 (사용 정책)');
      first = first || e;
    }
  }
  if (!j) throw first;
  for (let n = 0; j && j.id && /^(in_progress|queued|pending|running)$/.test(j.status || '') && n < 60; n++) {
    if (tk && tk.stop) throw trErr('stop');
    await trSleep(2000, tk); j = await trHttp('GET', `/interactions/${encodeURIComponent(j.id)}`, null, tk);
  }
  const F = dbFind(j), a = F.auds[0];
  if (!a) {
    const why = F.texts.join(' ').slice(0, 160) || (j && (j.error && j.error.message || j.status)) || '';
    throw trErr('blocked', `제미나이가 소리를 만들지 않았어요 (대사가 사용 정책에 걸렸을 수 있어요)${why ? ' · ' + why : ''}`);
  }
  let u8;
  if (a.data) u8 = new Uint8Array(b64ToBuf(String(a.data).replace(/-/g, '+').replace(/_/g, '/')));
  else {
    let url = a.uri; const m = /files\/([^:/?]+)/.exec(url); if (m) url = `${TR_API}/files/${m[1]}:download?alt=media`;
    const res = await fetch(url, { headers: { 'x-goog-api-key': trCfg.key.trim() } }); if (!res.ok) throw trErr('http', `소리를 받지 못했어요 (${res.status})`);
    u8 = new Uint8Array(await res.arrayBuffer());
  }
  const mime = String(a.mime_type || a.mimeType || ''), riff = u8.length > 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46;
  if (riff) return new Blob([u8], { type: 'audio/wav' });
  if (!mime || /l16|pcm|raw/i.test(mime)) return dbPcmWav(u8, +(/rate=(\d+)/.exec(mime) || [])[1] || 24000);
  return new Blob([u8], { type: mime.split(';')[0] });
}
async function dbMakeRaw(sig, text, style, voice, tk) {
  const blob = await dbTts(text, style, voice, tk);
  let buf; try { buf = await auDecode(blob); } catch (_) { throw trErr('parse', '받은 소리를 읽지 못했어요'); }
  return { sig, blob, buf, dur: buf.duration };
}
async function dbMake(l, tk) {
  const text = l.text.trim(); if (!text) throw trErr('empty', '대사가 비어 있어요');
  const sig = dbSig(l), got = dbAud.get(l.id); if (got && got.sig === sig) return got;
  const a = await dbMakeRaw(sig, text, dbStyleOf(l), dbVoiceOf(l), tk); dbAud.set(l.id, a); return a;
}
async function dbMoreVoices() { // 확장 목소리 모음 (답 모양이 달라도 이름만 찾아 넣어요)
  const j = await trHttp('GET', '/voices?pageSize=1000');
  const arr = Array.isArray(j) ? j : (j.voices || Object.values(j).find(Array.isArray) || []), base = new Set(DB_VOICES.map(v => v[0])), L = [];
  for (const v of arr) {
    const n = String((v && (v.voice_id || v.voiceId || v.name || v.id)) || '').replace(/^voices\//, ''); if (!n || base.has(n)) continue;
    const g = String(v.gender || '').toLowerCase(), lang = v.language_codes || v.languageCodes || v.languages || v.language_code || v.language || '';
    L.push([n, '', dbJoinStyle(v.display_name || v.displayName, g.startsWith('f') ? '여' : g.startsWith('m') ? '남' : '', Array.isArray(lang) ? lang.slice(0, 3).join('·') : lang).slice(0, 40)]);
  }
  return L.slice(0, 800);
}

/* ---- 말풍선·글자에서 대사 가져오기 ---- */
const dbClean = s => String(s || '').replace(/\s*\n+\s*/g, ' ').trim();
function dbFromDoc(all) {
  if (typeof gifOpen === 'function' && gifOpen()) return gs.ovs.filter(o => o.kind !== 'image' && dbClean(o.text)).sort((a, b) => (a.t0 || 0) - (b.t0 || 0)).map(o => ({ text: dbClean(o.text), t: Math.round((o.t0 || 0) * 100) / 100 }));
  let pgs = []; try { pgs = all ? (isImg() ? realIdx().map(i => doc.pages[i]) : doc.pages) : [page()]; } catch (_) { }
  const out = [];
  for (const p of pgs) {
    if (!p || !p.els) continue;
    const T = p.els.filter(e => (e.type === 'text' || e.type === 'bubble') && dbClean(e.text));
    const row = Math.max(40, (p.h || 1000) / 14); // 위에서 아래로, 같은 높이면 왼쪽부터
    T.sort((a, b) => Math.round((a.y + a.h / 2) / row) - Math.round((b.y + b.h / 2) / row) || a.x - b.x);
    for (const e of T) out.push({ text: dbClean(e.text) });
  }
  return out;
}
function dbAddLines(items) {
  if (dbCfg.lines.length === 1 && !dbCfg.lines[0].text.trim()) dbCfg.lines.length = 0;
  const last = dbCfg.lines[dbCfg.lines.length - 1];
  for (const it of items) dbCfg.lines.push(dbLineNew(Object.assign({ who: last ? last.who : '', voice: last ? last.voice : dbCfg.voice }, it)));
  dbSave();
}

/* ---- 창 ---- */
async function dbOpen(opts) {
  if (!(await trEnsureKey())) return;
  if (opts && opts.add && opts.add.length) dbAddLines(opts.add.map(t => typeof t === 'string' ? { text: dbClean(t) } : t));
  if (!dbCfg.lines.length) dbCfg.lines.push(dbLineNew());
  dbCfg.lines.forEach(l => { if (!l.id) l.id = uid(); if (l.who && !dbChar(l.who)) l.who = ''; });
  const inGif = typeof gifOpen === 'function' && gifOpen();
  const m = modal(`<h2>AI 더빙 (제미나이)</h2><p class="sub">대사를 적고 목소리와 말투를 고르면 감정을 담아 읽어 줘요. 줄을 여러 개 만들어 하나씩 듣고, 이어 붙이거나 따로 저장할 수 있어요.</p>
    <div class="dbtop">
      <label>모델 <select id="dbModel">${DB_MODELS.map(([v, l]) => `<option value="${v}" ${v === dbCfg.model ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>말 빠르기 <select id="dbSpeed">${[['slow2', '아주 느리게'], ['slow', '조금 느리게'], ['', '보통'], ['fast', '조금 빠르게'], ['fast2', '아주 빠르게']].map(([v, l]) => `<option value="${v}" ${v === dbCfg.speed ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label title="이어서 듣거나 이어 붙일 때 대사와 대사 사이에 두는 쉼">대사 사이 쉼 <input type="number" id="dbGap" min="0" max="5" step="0.1" value="${+dbCfg.gap || 0}" style="width:58px"> 초</label>
      <span class="flex1"></span>
      <button class="btn sm" id="dbCharTgl" title="캐릭터마다 목소리와 기본 말투를 저장해 두고 대사에서 골라 써요">캐릭터 목소리 <span id="dbCharN"></span></button>
    </div>
    <div class="dbchars" id="dbChars" hidden></div>
    <div class="dblines" id="dbLines"></div>
    <div class="btnrow"><button class="btn sm" id="dbAdd">+ 대사 추가</button><button class="btn sm" id="dbImp" title="${inGif ? '움짤 글자를 나오는 순서대로 가져와요' : '이 페이지의 말풍선·글자를 위에서부터 가져와요'}">${inGif ? '움짤 글자에서 가져오기' : '말풍선에서 가져오기'}</button>${!inGif && typeof doc !== 'undefined' && doc.pages && doc.pages.length > 1 ? '<button class="btn sm" id="dbImpAll">모든 페이지에서</button>' : ''}<span class="flex1"></span><button class="btn sm" id="dbClear" title="대사 줄을 모두 지워요 (캐릭터 목소리는 남아요)">모두 지우기</button></div>
    <div class="dbchips"><span class="muted small">감정</span>${DB_EMO.map(([l], i) => `<button class="btn sm" data-dbe="${i}">${l}</button>`).join('')}</div>
    <div class="dbchips"><span class="muted small">소리</span>${DB_TAGS.map(([l, t]) => `<button class="btn sm" data-dbt="${esc(t)}" title="대사의 커서 자리에 ${esc(t)}를 넣어요">${l}</button>`).join('')}<span class="muted small">감정은 마지막에 누른 줄의 말투 칸에, 소리는 대사의 커서 자리에 들어가요</span></div>
    <p class="muted small" id="dbNote" style="margin:8px 0 0">말투 칸은 한국어로 적어도 되지만 영어가 더 잘 먹혀요. 대사는 적은 그대로 읽고, 언어는 알아서 맞춰요. 대사가 구글로 보내지고 수위 높은 대사는 거절될 수 있어요.</p>
    <div class="foot dbfoot"><button class="btn" data-close>닫기</button><span class="flex1"></span><span class="muted small" id="dbSum"></span>
      <button class="btn" id="dbPlayAll" title="만들어 둔 대사를 순서대로 들어요">이어서 듣기</button>
      <button class="btn" id="dbSaveEach" title="대사마다 WAV 파일 하나씩">따로 저장</button>
      <button class="btn" id="dbSaveOne" title="모든 대사를 쉼을 두고 이어 붙인 WAV 파일 하나">이어 붙여 저장</button>
      <span class="dbinto"><select id="dbInto" title="움짤 소리 줄에 넣는 방식"><option value="one">한 덩어리로</option><option value="each">대사마다 따로</option><option value="sync">글자 나오는 때에 맞춰</option></select><button class="btn" id="dbToGif" title="움짤 탭의 '소리' 줄에 넣어요 (MP4로 저장하면 같이 들어가요)">움짤에 넣기</button></span>
      <button class="btn primary" id="dbGo">모두 만들기</button></div>`, { wide: true });
  m.style.width = 'min(1020px, 100%)'; m.classList.add('dbmodal');
  const box = $('#dbLines', m), cbox = $('#dbChars', m), tk = { stop: false, set: s => { if (s && m.isConnected) $('#dbSum', m).textContent = s; } };
  let focus = dbCfg.lines[0].id, running = false;
  const obs = new MutationObserver(() => { if (!m.isConnected) { tk.stop = true; dbStop(); obs.disconnect(); } }); obs.observe(document.body, { childList: true, subtree: true });
  const lineOf = id => dbCfg.lines.find(l => l.id === id);
  const rowOf = id => box.querySelector(`.dbl[data-id="${id}"]`);
  const state = l => {
    if (dbBusy.has(l.id)) return ['만드는 중…', 'busy'];
    const a = dbAud.get(l.id); if (a && a.sig === dbSig(l)) return [a.dur.toFixed(1) + '초', 'ok'];
    if (dbErrs.has(l.id)) return [dbErrs.get(l.id), 'err'];
    return a ? ['바뀌었어요 · 다시 만들기', 'old'] : ['', ''];
  };
  const paint = () => { // 줄 상태·아래 합계·단추만 다시 (글 쓰는 칸은 건드리지 않아요)
    let n = 0, T = 0, withT = 0;
    dbCfg.lines.forEach((l, i) => {
      const r = rowOf(l.id); if (!r) return;
      const [s, c] = state(l), st = r.querySelector('.dbst'); st.textContent = s; st.className = 'dbst ' + c; st.title = c === 'err' ? s : '';
      r.querySelector('.dbno').textContent = i + 1; r.classList.toggle('focus', l.id === focus);
      const a = dbReady(l), pb = r.querySelector('[data-dbl="play"]'); pb.textContent = dbNow === l.id ? '■' : '▶'; pb.disabled = dbBusy.has(l.id);
      r.querySelector('[data-dbl="save"]').disabled = !a; r.querySelector('[data-dbl="redo"]').disabled = dbBusy.has(l.id) || !l.text.trim();
      if (a) { n++; T += a.dur; } if (l.t != null) withT++;
    });
    const all = dbCfg.lines.filter(l => l.text.trim()).length;
    if (!running) $('#dbSum', m).textContent = n ? `만든 대사 ${n}/${all}개 · ${(T + Math.max(0, n - 1) * (+dbCfg.gap || 0)).toFixed(1)}초` : '';
    $('#dbPlayAll', m).textContent = dbNow === 'all' ? '■ 멈추기' : '이어서 듣기';
    for (const id of ['dbPlayAll', 'dbSaveEach', 'dbSaveOne', 'dbToGif']) $('#' + id, m).disabled = !n || (running && id !== 'dbPlayAll');
    $('#dbGo', m).textContent = running ? '멈추기' : all && n === all ? '모두 만들었어요' : '모두 만들기'; $('#dbGo', m).disabled = !running && (!all || n === all);
    const so = $('#dbInto option[value="sync"]', m); so.hidden = so.disabled = !withT; if (!withT && dbCfg.into === 'sync') dbCfg.into = 'one'; $('#dbInto', m).value = dbCfg.into;
    $('#dbCharN', m).textContent = dbCfg.chars.length ? `(${dbCfg.chars.length})` : '';
  };
  const whoOpts = l => `<option value="">목소리 직접 고르기</option>${dbCfg.chars.map(c => `<option value="${c.id}" ${c.id === l.who ? 'selected' : ''}>${esc(c.name || '이름 없음')}</option>`).join('')}`;
  const render = () => {
    box.innerHTML = dbCfg.lines.map(l => `<div class="dbl" data-id="${l.id}">
        <div class="dbl-h"><b class="dbno"></b><select data-dbk="who" title="저장해 둔 캐릭터 목소리">${whoOpts(l)}</select><select data-dbk="voice" title="목소리" ${l.who ? 'hidden' : ''}>${dbVoiceOpts(l.voice)}</select>
          <input type="text" data-dbk="style" value="${esc(l.style)}" placeholder="말투·감정 (예: 화를 참으며 낮게, whispering)" spellcheck="false">
          <span class="dbst"></span>
          <button class="btn sm icon" data-dbl="play" title="듣기 (아직 안 만들었으면 만들어서 들려줘요)">▶</button><button class="btn sm" data-dbl="redo" title="같은 대사를 다시 만들어요 (만들 때마다 연기가 조금씩 달라요)">다시</button><button class="btn sm" data-dbl="save" title="이 대사만 WAV로 저장">저장</button>
          <button class="btn sm icon" data-dbl="up" title="위로">↑</button><button class="btn sm icon" data-dbl="down" title="아래로">↓</button><button class="btn sm icon" data-dbl="del" title="이 줄 지우기">×</button></div>
        <textarea data-dbk="text" rows="2" spellcheck="false" placeholder="대사를 적어 주세요">${esc(l.text)}</textarea></div>`).join('');
    paint();
  };
  const renderChars = () => {
    cbox.innerHTML = `${dbCfg.chars.map(c => `<div class="dbc" data-id="${c.id}"><input type="text" data-dbc="name" value="${esc(c.name)}" placeholder="캐릭터 이름" spellcheck="false" style="width:120px"><select data-dbc="voice">${dbVoiceOpts(c.voice)}</select>
        <input type="text" data-dbc="style" value="${esc(c.style)}" placeholder="기본 말투 (예: 낮고 무뚝뚝한 30대 남자, deep and blunt)" spellcheck="false"><button class="btn sm" data-dbcb="play" title="이 목소리와 말투로 짧은 문장을 들어 봐요">${dbNow === 'c:' + c.id ? '■' : '미리 듣기'}</button><button class="btn sm icon" data-dbcb="del" title="캐릭터 지우기">×</button></div>`).join('')}
      <div class="btnrow" style="margin:4px 0 0"><button class="btn sm" id="dbCharAdd">+ 캐릭터 추가</button><button class="btn sm" id="dbMore" title="기본 30개 말고 제미나이의 다른 목소리 목록을 불러와요">목소리 더 불러오기</button><span class="muted small">캐릭터를 고른 대사는 그 목소리와 기본 말투에 줄마다 적은 말투가 더해져요.</span></div>`;
    $('#dbCharAdd', cbox).addEventListener('click', () => { const last = dbCfg.chars[dbCfg.chars.length - 1]; dbCfg.chars.push({ id: uid(), name: '', voice: last ? last.voice : dbCfg.voice, style: '' }); dbSave(); renderChars(); render(); const ins = $$('[data-dbc="name"]', cbox); ins[ins.length - 1].focus(); });
    $('#dbMore', cbox).addEventListener('click', async e => {
      e.target.disabled = true;
      try { const L = await dbMoreVoices(); if (L.length) { dbCfg.xv = L; dbSave(); renderChars(); render(); toast(`목소리 ${L.length}개를 더 불러왔어요. 목소리 고르는 칸 맨 아래에 있어요`, 3600); } else toast('더 불러올 목소리가 없어요'); }
      catch (err) { toast('목소리 목록을 불러오지 못했어요. 기본 30개는 그대로 쓸 수 있어요', 4500); }
      if (e.target.isConnected) e.target.disabled = false;
    });
  };
  cbox.hidden = !dbCfg.charsOpen; renderChars(); render();

  // 한 줄 만들기 (이미 있으면 그대로)
  const make = async (l, force) => {
    if (dbBusy.has(l.id)) return null;
    if (force) dbAud.delete(l.id);
    dbErrs.delete(l.id); dbBusy.add(l.id); paint();
    try { return await dbMake(l, tk); }
    catch (e) { if (e.code !== 'stop') { dbErrs.set(l.id, e.code === 'blocked' ? '거절됨' : e.code === 'empty' ? '' : '실패'); if (m.isConnected && e.code !== 'empty') toast(e.message, 6000); } throw e; }
    finally { dbBusy.delete(l.id); if (m.isConnected) paint(); }
  };
  const done = () => dbCfg.lines.map(l => [l, dbReady(l)]).filter(x => x[1]);
  const lineName = (l, i) => { const c = dbChar(l.who); return safeName(`${String(i + 1).padStart(2, '0')} ${c && c.name ? c.name + ' ' : ''}${l.text.trim().replace(/<[^>]*>/g, '').slice(0, 18)}`.trim()) + '.wav'; };

  box.addEventListener('focusin', e => { const r = e.target.closest('.dbl'); if (r && focus !== r.dataset.id) { focus = r.dataset.id; paint(); } });
  box.addEventListener('input', e => {
    const r = e.target.closest('.dbl'), k = e.target.dataset.dbk, l = r && lineOf(r.dataset.id); if (!l || !k) return;
    l[k] = e.target.value; dbErrs.delete(l.id);
    if (k === 'who') { r.querySelector('[data-dbk="voice"]').hidden = !!l.who; }
    if (k === 'voice') dbCfg.voice = l.voice;
    dbSave(); paint();
  });
  box.addEventListener('click', async e => {
    const b = e.target.closest('[data-dbl]'), r = e.target.closest('.dbl'), l = r && lineOf(r.dataset.id); if (!b || !l) return;
    const a = b.dataset.dbl, i = dbCfg.lines.indexOf(l); focus = l.id;
    if (a === 'play') {
      if (dbNow === l.id) { dbStop(); paint(); return; }
      if (!l.text.trim()) { toast('대사를 먼저 적어 주세요'); return; }
      try { const au = await make(l); if (au && m.isConnected) { dbPlay([au.buf], 0, l.id, () => m.isConnected && paint()); paint(); } } catch (_) { }
    } else if (a === 'redo') { try { const au = await make(l, true); if (au && m.isConnected) { dbPlay([au.buf], 0, l.id, () => m.isConnected && paint()); paint(); } } catch (_) { } }
    else if (a === 'save') { const au = dbReady(l); if (au && await download(au.blob, lineName(l, i))) toast('WAV로 저장했어요'); }
    else if (a === 'del') { dbCfg.lines.splice(i, 1); dbAud.delete(l.id); dbErrs.delete(l.id); if (!dbCfg.lines.length) dbCfg.lines.push(dbLineNew()); focus = (dbCfg.lines[Math.min(i, dbCfg.lines.length - 1)]).id; dbSave(); render(); }
    else if (a === 'up' || a === 'down') { const j = i + (a === 'up' ? -1 : 1); if (j < 0 || j >= dbCfg.lines.length) return; dbCfg.lines.splice(i, 1); dbCfg.lines.splice(j, 0, l); dbSave(); render(); }
  });
  cbox.addEventListener('input', e => {
    const r = e.target.closest('.dbc'), k = e.target.dataset.dbc, c = r && dbChar(r.dataset.id); if (!c || !k) return;
    c[k] = e.target.value; if (k === 'voice') dbCfg.voice = c.voice; dbSave();
    if (k === 'name') $$('[data-dbk="who"]', box).forEach(s => { const l = lineOf(s.closest('.dbl').dataset.id); if (l) s.innerHTML = whoOpts(l); });
    paint();
  });
  cbox.addEventListener('click', async e => {
    const b = e.target.closest('[data-dbcb]'), r = e.target.closest('.dbc'), c = r && dbChar(r.dataset.id); if (!b || !c) return;
    if (b.dataset.dbcb === 'del') { dbCfg.chars = dbCfg.chars.filter(x => x !== c); dbCfg.lines.forEach(l => { if (l.who === c.id) { l.who = ''; l.voice = c.voice; } }); dbSave(); renderChars(); render(); return; }
    if (dbNow === 'c:' + c.id) { dbStop(); renderChars(); return; }
    const style = dbJoinStyle(c.style, DB_SPEED[dbCfg.speed]), sig = dbSigOf(c.voice, style, DB_SAMPLE);
    b.disabled = true; b.textContent = '만드는 중…';
    try {
      let au = dbPrev.get(sig); if (!au) { au = await dbMakeRaw(sig, DB_SAMPLE, style, c.voice, tk); dbPrev.set(sig, au); if (dbPrev.size > 40) dbPrev.delete(dbPrev.keys().next().value); }
      if (m.isConnected) { dbPlay([au.buf], 0, 'c:' + c.id, () => m.isConnected && renderChars()); }
    } catch (err) { if (m.isConnected && err.code !== 'stop') toast(err.message, 6000); }
    if (m.isConnected) renderChars();
  });
  $('#dbCharTgl', m).addEventListener('click', () => { dbCfg.charsOpen = !dbCfg.charsOpen; cbox.hidden = !dbCfg.charsOpen; dbSave(); if (dbCfg.charsOpen && !dbCfg.chars.length) $('#dbCharAdd', cbox).click(); });
  $('#dbModel', m).addEventListener('change', e => { dbCfg.model = e.target.value; dbSave(); paint(); });
  $('#dbSpeed', m).addEventListener('change', e => { dbCfg.speed = e.target.value; dbSave(); paint(); });
  $('#dbGap', m).addEventListener('input', e => { dbCfg.gap = clamp(+e.target.value || 0, 0, 5); dbSave(); paint(); });
  $('#dbInto', m).addEventListener('change', e => { dbCfg.into = e.target.value; dbSave(); });
  $('#dbAdd', m).addEventListener('click', () => { const last = dbCfg.lines[dbCfg.lines.length - 1], l = dbLineNew({ who: last.who, voice: last.voice }); dbCfg.lines.push(l); focus = l.id; dbSave(); render(); const ta = rowOf(l.id).querySelector('textarea'); ta.focus(); ta.scrollIntoView({ block: 'nearest' }); });
  const imp = all => { const L = dbFromDoc(all); if (!L.length) { toast(inGif ? '움짤에 글자가 없어요' : '가져올 말풍선·글자가 없어요'); return; } dbAddLines(L); render(); toast(`대사 ${L.length}개를 가져왔어요. 줄마다 캐릭터와 말투를 골라 주세요`, 3200); };
  $('#dbImp', m).addEventListener('click', () => imp(false));
  if ($('#dbImpAll', m)) $('#dbImpAll', m).addEventListener('click', () => imp(true));
  $('#dbClear', m).addEventListener('click', () => { if (running) return; dbStop(); dbCfg.lines = [dbLineNew()]; dbAud.clear(); dbErrs.clear(); focus = dbCfg.lines[0].id; dbSave(); render(); });
  m.addEventListener('click', e => {
    const eb = e.target.closest('[data-dbe]'), tb = e.target.closest('[data-dbt]'); if (!eb && !tb) return;
    const l = lineOf(focus) || dbCfg.lines[0], r = rowOf(l.id); if (!r) return;
    if (eb) { const inp = r.querySelector('[data-dbk="style"]'), add = DB_EMO[+eb.dataset.dbe][1]; if (!l.style.includes(add)) l.style = dbJoinStyle(l.style, add); inp.value = l.style; inp.focus(); }
    else { const ta = r.querySelector('textarea'), t = tb.dataset.dbt, s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s, pre = ta.value.slice(0, s), add = (pre && !/\s$/.test(pre) ? ' ' : '') + t + ' '; ta.value = pre + add + ta.value.slice(en); l.text = ta.value; ta.focus(); ta.selectionStart = ta.selectionEnd = s + add.length; }
    dbErrs.delete(l.id); dbSave(); paint();
  });
  $('#dbGo', m).addEventListener('click', async () => {
    if (running) { tk.stop = true; return; }
    const todo = dbCfg.lines.filter(l => l.text.trim() && !dbReady(l)); if (!todo.length) return;
    running = true; tk.stop = false; let ok = 0, bad = 0; paint();
    for (let i = 0; i < todo.length && !tk.stop && m.isConnected; i++) {
      tk.set(`${i + 1}/${todo.length} 만드는 중…`);
      try { await make(todo[i]); ok++; }
      catch (e) { if (e.code === 'stop') break; bad++; if (e.code === 'key' || e.code === 'quota' || e.code === 'model' || e.code === 'net') break; }
    }
    running = false; const stopped = tk.stop; tk.stop = !m.isConnected;
    if (m.isConnected) { paint(); if (!bad && !stopped) toast(`대사 ${ok}개를 만들었어요. '이어서 듣기'로 들어 보세요`, 3000); else if (bad) toast(`${ok}개 만들었고 ${bad}개는 못 만들었어요. 빨간 줄을 고쳐서 다시 해 보세요`, 5000); }
  });
  $('#dbPlayAll', m).addEventListener('click', () => {
    if (dbNow === 'all') { dbStop(); paint(); return; }
    const D = done(); if (!D.length) return; dbPlay(D.map(x => x[1].buf), +dbCfg.gap || 0, 'all', () => m.isConnected && paint()); paint();
  });
  $('#dbSaveOne', m).addEventListener('click', async () => { const D = done(); if (!D.length) return; const blob = D.length === 1 ? D[0][1].blob : dbJoin(D.map(x => x[1].buf), +dbCfg.gap || 0); if (await download(blob, safeName('더빙 ' + D[0][0].text.trim().replace(/<[^>]*>/g, '').slice(0, 16)) + '.wav')) toast(`대사 ${D.length}개를 이어 붙여 저장했어요`); });
  $('#dbSaveEach', m).addEventListener('click', async () => {
    const D = done(); if (!D.length) return;
    if (D.length === 1) { if (await download(D[0][1].blob, lineName(D[0][0], dbCfg.lines.indexOf(D[0][0])))) toast('WAV로 저장했어요'); return; }
    const r = await saveFiles(D.map(([l, a]) => ({ name: lineName(l, dbCfg.lines.indexOf(l)), blob: a.blob })), '더빙.zip');
    if (r) toast(r === 'zip' ? `대사 ${D.length}개를 ZIP 하나로 저장했어요` : `대사 ${D.length}개를 폴더에 저장했어요`);
  });
  $('#dbToGif', m).addEventListener('click', async () => {
    const D = done(); if (!D.length) return; const gap = +dbCfg.gap || 0, how = dbCfg.into;
    dbStop(); closeModal(); await pjOpenGif();
    if (!gs.slides.length) { toast('움짤에 장면이 있어야 소리를 넣을 수 있어요. 장면을 넣은 뒤 다시 AI 더빙을 열면 만든 대사가 그대로 있어요', 6000); return; }
    const file = (blob, name) => new File([blob], name, { type: 'audio/wav' });
    if (how === 'one' || D.length === 1) await auAddFiles([file(D.length === 1 ? D[0][1].blob : dbJoin(D.map(x => x[1].buf), gap), '더빙.wav')]);
    else { let t = gpT0(), lane; for (const [l, a] of D) { const at = how === 'sync' && l.t != null ? l.t : t; await auAddFiles([file(a.blob, lineName(l, dbCfg.lines.indexOf(l)))], at, lane); const put = gs.au.find(x => x.id === gs.asel); if (put && how !== 'sync') lane = put.lane; t = Math.round((at + a.dur + gap) * 100) / 100; } }
    toast(`더빙 ${how === 'one' ? '' : D.length + '개'}를 소리 줄에 넣었어요. MP4로 저장하면 같이 들어가요`, 3600);
  });
}
// 고른 말풍선·글자 하나를 더빙 창으로
function dbFromEl() { const el = selEls()[0]; if (!el || (el.type !== 'text' && el.type !== 'bubble') || !dbClean(el.text)) { toast('대사가 적힌 말풍선이나 글자를 골라 주세요'); return; } dbOpen({ add: [el.text] }); }
function dbFromOv() { const o = gs.ovs.find(x => x.id === gs.osel); if (!o || o.kind === 'image' || !dbClean(o.text)) return; dbOpen({ add: [{ text: dbClean(o.text), t: Math.round((o.t0 || 0) * 100) / 100 }] }); }
