/* ================= AI 영상 만들기 (제미나이 Omni: 그림 + 프롬프트 → 영상) ================= */
// 그림 한 장과 '어떻게 움직일지' 글을 제미나이에 보내 몇 초짜리 영상(MP4, 소리 포함)을 받아요.
// 받은 영상은 MP4로 저장하거나 움짤 탭에 장면으로 넣어 자르기·글자·효과를 이어서 할 수 있어요.
const VG_DEF = 'gemini-omni-1.1-flash';
const vgCfg = { model: VG_DEF, res: '720p', fit: 'crop', prompt: '', sound: true };
try { Object.assign(vgCfg, JSON.parse(localStorage.getItem('potatoVgCfg') || '{}')); } catch (_) { }
const vgSave = () => { try { localStorage.setItem('potatoVgCfg', JSON.stringify(vgCfg)); } catch (_) { } };
const VG_IDEAS = [['카메라가 천천히 다가가요', 'Slow cinematic push-in toward the subject.'], ['머리카락·옷이 바람에 흔들려요', 'Hair and clothes sway gently in the wind; subtle natural breathing.'], ['눈을 깜빡이고 살짝 웃어요', 'The character blinks and gives a slight smile, small natural head movement.'], ['고개를 돌려 이쪽을 봐요', 'The character slowly turns their head to look at the camera.'], ['배경이 움직여요 (구름·빛·물)', 'The character stays mostly still while the background comes alive: drifting clouds, shifting light, moving water.'], ['카메라가 옆으로 천천히 돌아요', 'Slow orbiting camera move around the subject with parallax.'], ['비가 내려요', 'Rain starts falling, with ripples and wet reflections.'], ['꽃잎이 흩날려요', 'Petals drift through the air across the scene.']];
// 그림을 16:9 / 9:16에 맞추기 (자르기 = 가운데를 채워 자름, 맞추기 = 흐린 배경 위에 통째로)
function vgFrame(src, W, H, fit) {
  const tall = H > W, ar = tall ? 9 / 16 : 16 / 9, ow = tall ? 720 : 1280, oh = tall ? 1280 : 720;
  const c = newCanvas(ow, oh), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (fit === 'crop') { const k = Math.max(ow / W, oh / H); g.drawImage(src, (ow - W * k) / 2, (oh - H * k) / 2, W * k, H * k); }
  else {
    const kb = Math.max(ow / W, oh / H); g.filter = 'blur(28px) brightness(0.7)'; g.drawImage(src, (ow - W * kb) / 2, (oh - H * kb) / 2, W * kb, H * kb); g.filter = 'none';
    const k = Math.min(ow / W, oh / H); g.drawImage(src, (ow - W * k) / 2, (oh - H * k) / 2, W * k, H * k);
  }
  return { c, ratio: tall ? '9:16' : '16:9', same: Math.abs(W / H - ar) < 0.02 };
}
async function vgModels() {
  const j = await trHttp('GET', '/models?pageSize=1000');
  const L = (j.models || []).map(m => m.name.replace(/^models\//, '')).filter(n => /omni/.test(n));
  return L.length ? L : [VG_DEF];
}
// 답에서 영상 찾기 (steps[].content[] 또는 outputs[] 어디에 있든)
function vgFind(o, out = { vids: [], texts: [] }, d = 0) {
  if (!o || d > 8) return out;
  if (Array.isArray(o)) { for (const x of o) vgFind(x, out, d + 1); return out; }
  if (typeof o !== 'object') return out;
  if (o.type === 'video' && (o.data || o.uri)) out.vids.push(o);
  else if (o.type === 'text' && typeof o.text === 'string') out.texts.push(o.text);
  for (const k in o) if (o[k] && typeof o[k] === 'object') vgFind(o[k], out, d + 1);
  return out;
}
async function vgGenerate(canvas, ratio, prompt, tk) {
  const b64 = canvas.toDataURL('image/jpeg', 0.93).split(',')[1];
  const text = `Animate this image into a short video. Keep the art style, characters, colors and composition of the image exactly; start from this image as the first frame.\n${prompt}`;
  const body = { model: vgCfg.model, input: [{ type: 'image', data: b64, mime_type: 'image/jpeg' }, { type: 'text', text }], response_format: { type: 'video', aspect_ratio: ratio, resolution: vgCfg.res }, generation_config: { video_config: { task: 'image_to_video' } } };
  let j;
  try { j = await trHttp('POST', '/interactions', body, tk); }
  catch (e) {
    if (e.code === 'bad' && /video_config|generation_config|task/i.test(e.message)) { delete body.generation_config; j = await trHttp('POST', '/interactions', body, tk); }
    else if (e.code === 'bad' && /block|safety|polic|prohibit|violat/i.test(e.message)) throw trErr('blocked', '제미나이가 이 그림이나 요청을 거절했어요 (사용 정책)');
    else if (e.code === 'model') throw trErr('model', `'${vgCfg.model}' 영상 모델을 이 키로 쓸 수 없어요. 영상은 결제를 연결한 키에서만 돼요`);
    else throw e;
  }
  // 오래 걸리면 진행 중으로 돌아올 수 있어요 → 끝날 때까지 물어봐요
  for (let n = 0; j && j.id && /^(in_progress|queued|pending|running|requires_action)$/.test(j.status || '') && n < 120; n++) {
    if (tk.stop) throw trErr('stop');
    await trSleep(5000, tk); j = await trHttp('GET', `/interactions/${encodeURIComponent(j.id)}`, null, tk);
  }
  const F = vgFind(j), v = F.vids[0];
  if (!v) {
    const why = F.texts.join(' ').slice(0, 200) || (j && (j.error && j.error.message || j.status)) || '';
    throw trErr('blocked', /fail|block|safety|polic/i.test(String(j && j.status) + why) || !why ? `제미나이가 영상을 만들지 않았어요 (그림·요청이 사용 정책에 걸렸을 수 있어요)${why ? ' · ' + why : ''}` : '영상을 받지 못했어요 · ' + why);
  }
  if (v.data) { const bin = atob(v.data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: v.mime_type || 'video/mp4' }); }
  tk.set('영상을 받는 중…');
  let url = v.uri; const m = /files\/([^:/?]+)/.exec(url);
  if (m) url = `${TR_API}/files/${m[1]}:download?alt=media`;
  const res = await fetch(url, { headers: { 'x-goog-api-key': trCfg.key.trim() } }); if (!res.ok) throw trErr('http', `영상을 받지 못했어요 (${res.status})`);
  return new Blob([await res.arrayBuffer()], { type: 'video/mp4' });
}
// src: canvas/bitmap, name, onUse(file, withSound) = 움짤에 넣기
async function vgOpen(T) {
  if (!(await trEnsureKey())) return;
  let fr = vgFrame(T.src, T.W, T.H, vgCfg.fit), blob = null, url = null;
  const m = modal(`<h2>AI 영상 만들기 (제미나이)</h2><p class="sub">그림 한 장과 '어떻게 움직일지' 적은 글로 몇 초짜리 영상을 만들어요. 소리도 같이 만들어져요.</p>
    <div class="vgwrap"><div class="vgprev"><canvas id="vgCv"></canvas><video id="vgVid" controls loop playsinline hidden></video></div>
    <div class="vgside">
      <b class="small">어떻게 움직일까요?</b>
      <textarea id="vgPrompt" rows="5" spellcheck="false" placeholder="예: 남자가 천천히 고개를 들어 이쪽을 보고 웃는다. 머리카락이 바람에 살짝 흔들리고, 카메라는 천천히 다가간다. (한국어로 적어도 돼요)">${esc(vgCfg.prompt)}</textarea>
      <div class="vgideas">${VG_IDEAS.map(([l], i) => `<button class="btn sm" data-vgi="${i}">${l}</button>`).join('')}</div>
      <div class="grid2" style="margin-top:8px">
        <span>화면 맞춤</span><span class="seg" id="vgFit"><button class="btn sm ${vgCfg.fit === 'crop' ? 'on' : ''}" data-v="crop" title="가운데를 채워서 잘라요">채워 자르기</button><button class="btn sm ${vgCfg.fit === 'pad' ? 'on' : ''}" data-v="pad" title="그림을 통째로 넣고 남는 곳은 흐린 배경으로">통째로</button></span>
        <span>화질</span><span><select id="vgRes"><option value="360p" ${vgCfg.res === '360p' ? 'selected' : ''}>360p (싸게 시험)</option><option value="720p" ${vgCfg.res === '720p' ? 'selected' : ''}>720p (기본)</option><option value="1080p" ${vgCfg.res === '1080p' ? 'selected' : ''}>1080p (키움)</option></select></span>
        <span>모델</span><span style="display:flex;gap:6px"><select id="vgModel" style="flex:1"><option>${esc(vgCfg.model)}</option></select><button class="btn sm" id="vgList" title="이 키로 쓸 수 있는 영상 모델을 불러와요">목록</button></span>
      </div>
      <p class="apiest" id="vgEst"></p>
      <p class="muted small" id="vgNote">영상은 ${fr.ratio === '9:16' ? '세로(9:16)' : '가로(16:9)'}로만 만들어져요. 유료예요: 720p 1초에 약 0.1달러, 무료 사용량이 없어서 결제를 연결한 키가 필요해요. 그림이 구글로 보내지고, 노출·성인 그림은 거절돼요.</p>
    </div></div>
    <div class="foot"><button class="btn" data-close>닫기</button><button class="btn" data-apilog>API 사용 내역</button><span class="flex1"></span><span id="vgAfter" hidden style="display:contents"><button class="btn" id="vgDl">MP4로 저장</button><label class="chk" style="margin:0 4px"><input type="checkbox" id="vgSnd" ${vgCfg.sound ? 'checked' : ''}> 소리도</label><button class="btn" id="vgUse">${T.useLabel || '움짤 탭에 넣기'}</button></span><button class="btn primary" id="vgGo">영상 만들기</button></div>`, { wide: true });
  m.style.width = 'min(980px, 100%)';
  const cv = $('#vgCv', m), vid = $('#vgVid', m), draw = () => { cv.width = fr.c.width; cv.height = fr.c.height; cv.getContext('2d').drawImage(fr.c, 0, 0); };
  draw(); $('#vgAfter', m).hidden = true; $('#vgAfter', m).style.display = 'none';
  const est = () => { const md = $('#vgModel', m).value, rs = $('#vgRes', m).value, e = s => apiEstVid(md, rs, s); $('#vgEst', m).textContent = apiEstText('vid', md, e(8), `8초 기준 · 길이에 따라 ${apiFmt(e(3), true)}~${apiFmt(e(10), true)}`); };
  est(); $('#vgRes', m).addEventListener('change', est); $('#vgModel', m).addEventListener('change', est);
  $$('#vgFit [data-v]', m).forEach(b => b.addEventListener('click', () => { vgCfg.fit = b.dataset.v; $$('#vgFit [data-v]', m).forEach(x => x.classList.toggle('on', x === b)); fr = vgFrame(T.src, T.W, T.H, vgCfg.fit); draw(); cv.hidden = false; vid.hidden = true; }));
  $$('[data-vgi]', m).forEach(b => b.addEventListener('click', () => { const ta = $('#vgPrompt', m), add = VG_IDEAS[+b.dataset.vgi][1]; ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + add; ta.focus(); }));
  $('#vgList', m).addEventListener('click', async () => { try { const L = await vgModels(); if (!L.includes(vgCfg.model)) vgCfg.model = L[0]; $('#vgModel', m).innerHTML = L.map(x => `<option ${x === vgCfg.model ? 'selected' : ''}>${esc(x)}</option>`).join(''); est(); toast(`영상 모델 ${L.length}개`, 1800); } catch (e) { toast(e.message, 5000); } });
  const clean = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  const obs = new MutationObserver(() => { if (!m.isConnected) { clean(); obs.disconnect(); } }); obs.observe(document.body, { childList: true, subtree: true });
  $('#vgGo', m).addEventListener('click', async () => {
    const p = $('#vgPrompt', m).value.trim(); if (!p) { toast('어떻게 움직일지 적어 주세요 (아래 단추를 눌러도 돼요)'); return; }
    vgCfg.prompt = p; vgCfg.res = $('#vgRes', m).value; vgCfg.model = $('#vgModel', m).value; vgSave();
    const go = $('#vgGo', m), tk = { stop: false, set: s => { if (s) go.textContent = s; } }; go.disabled = true; go.textContent = '만드는 중… (1~3분)';
    const t0 = Date.now(), tick = setInterval(() => { if (m.isConnected && go.disabled) go.textContent = `만드는 중… ${Math.round((Date.now() - t0) / 1000)}초`; else { clearInterval(tick); tk.stop = !m.isConnected; } }, 1000);
    const job = tk.job = apiJob('vid', `AI 영상 ${vgCfg.res}`, vgCfg.model, apiEstVid(vgCfg.model, vgCfg.res, 8));
    try {
      blob = await vgGenerate(fr.c, fr.ratio, p, tk); clearInterval(tick);
      const dur = await new Promise(r => { const v = document.createElement('video'), u = URL.createObjectURL(blob), fin = d => { URL.revokeObjectURL(u); r(isFinite(d) ? d : 0); }; v.preload = 'metadata'; v.onloadedmetadata = () => fin(v.duration); v.onerror = () => fin(0); setTimeout(() => fin(0), 5000); v.src = u; });
      if (!job.real && dur > 0) apiGuess(job, vgCfg.model, { in: 1500, out: Math.round(dur * (API_VID_TOK[vgCfg.res] || 5792)) }); // 답에 토큰 수가 없으면 영상 길이로
      apiEnd(job, 'ok'); if (!m.isConnected) return;
      clean(); url = URL.createObjectURL(blob); vid.src = url; vid.hidden = false; cv.hidden = true; vid.play().catch(() => { });
      $('#vgAfter', m).hidden = false; $('#vgAfter', m).style.display = 'contents'; go.textContent = '다시 만들기';
      $('#vgEst', m).textContent = `방금 만든 영상 ${dur ? dur.toFixed(1) + '초' : ''} · 쓴 금액 ${apiFmt(job.usd)}${job.guess ? ' (길이로 추정)' : ''}`;
    } catch (e) { clearInterval(tick); apiEnd(job, e.code === 'stop' ? 'stop' : 'fail'); if (m.isConnected) { go.textContent = '영상 만들기'; if (e.code !== 'stop') toast(e.message + apiUsed(job), 8000); } }
    go.disabled = false;
  });
  const fname = () => safeName((T.name || '그림').replace(/\.[^.]+$/, '') + ' 영상') + '.mp4';
  $('#vgDl', m).addEventListener('click', async () => { if (blob && await download(blob, fname())) toast('MP4로 저장했어요'); });
  $('#vgUse', m).addEventListener('click', async () => {
    if (!blob) return; vgCfg.sound = $('#vgSnd', m).checked; vgSave();
    const file = new File([blob], fname(), { type: 'video/mp4' }); closeModal(); await T.onUse(file, vgCfg.sound);
  });
}
async function vgIntoGif(file, snd, replace) {
  const n0 = gs.slides.length, T0 = gsTotal();
  await gsAddFiles([file]);
  const n = gs.slides.length - n0; if (n <= 0) return;
  let t0 = T0;
  if (replace) { const i = gs.slides.indexOf(replace); if (i >= 0) { const add = gs.slides.splice(n0, n); gs.slides.splice(i, 1, ...add); gs.sel = i; t0 = gsStarts()[i] || 0; } }
  if (snd) { try { await auAddFiles([file], t0); } catch (_) { } }
  gsChanged();
}
function vgFromImage() {
  const pg = page(); if (!isImg() || !pg || pg.ph || !baseEl(pg)) { toast('이미지 편집에서 그림을 연 뒤 써 주세요'); return; }
  const c = newCanvas(Math.round(pg.w), Math.round(pg.h)); drawPage(c.getContext('2d'), pg, { screen: false, rs: 1, view: { x0: 0, y0: 0, x1: pg.w, y1: pg.h } }); // 보이는 그대로
  vgOpen({ src: c, W: c.width, H: c.height, name: pg.name, onUse: async (file, snd) => { await pjOpenGif(); await vgIntoGif(file, snd, null); toast('영상을 움짤 탭에 넣었어요. 자르기·글자·효과를 이어서 할 수 있어요', 3600); } });
}
function vgFromScene() {
  const s = gs.slides[gs.sel]; if (!s) return;
  vgOpen({ src: s.bmp, W: s.bmp.width, H: s.bmp.height, name: s.name, useLabel: '이 장면을 영상으로 바꾸기', onUse: async (file, snd) => { await vgIntoGif(file, snd, s); toast('장면을 AI 영상으로 바꿨어요', 3000); } });
}
