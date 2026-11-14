// 8.x의 '캐릭터 움직이기'(src/rig.js)를 2.0 안에서 그대로 쓸 수 있게 묶어요.
// 23만 글자짜리 기능이라 새로 쓰지 않고, 8.x 코드를 그대로 가져와 필요한 바깥 함수만 2.0 것으로 이어 붙여요(src/legacy/shim.js).
// 8.x에서 rig.js를 고치면 2.0에도 그대로 반영돼요.  →  src/legacy/rig.gen.js, rig.gen.css
import { parse } from 'acorn';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), src = join(here, '..', '..', 'src'), out = join(here, '..', 'src', 'legacy');
const read = f => readFileSync(join(src, f), 'utf8');

// 1) rig.js: 8.x 화면에 묶인 '여는 곳' 부분은 빼요 (2.0은 캐릭터 작업실에서 열어요)
let rig = read('rig.js');
const cut = rig.indexOf('/* ---- 여는 곳');
if (cut < 0) throw new Error("rig.js에서 '여는 곳' 표시를 찾지 못했어요");
rig = rig.slice(0, cut);

// 1-2) 2.0에서만 더하는 것. 8.x 파일은 그대로 두고 여기서 덧붙여요. 찾는 글이 없으면(8.x 쪽이 바뀌면) 빌드가 멈춰요
function patch(find, to, what) { if (rig.split(find).length !== 2) throw new Error(`rig.js에서 '${what}' 자리를 찾지 못했어요`); rig = rig.replace(find, () => to); }
// (가) 떼어 낸 자리를 NovelAI로 바로 다시 그리기 (8.x는 내보내기 → NAI → 불러오기를 손으로 했어요)
patch('<h3>메운 자리 더 좋게 (NAI 등)</h3><p class="muted small">AI가 메운 자리가 흐릿하면:', '<h3>메운 자리 더 좋게</h3><p class="muted small"><b>NovelAI로 바로</b>를 누르면 메운 자리만 NovelAI가 다시 그려 넣어요. 직접 하려면:', '메운 자리 설명');
// 2.0에서 더한 얼굴 표정: 눈썹 올리기·내리기(brow), 입꼬리 올리기·내리기(smile). 눈·입 상자를 그대로 써요.
patch("pins: {}, blink: 0, mouth: 0 });", "pins: {}, blink: 0, mouth: 0, brow: 0, smile: 0 });", '표정 기본값');
patch("blink: p.blink || 0, mouth: p.mouth || 0 });", "blink: p.blink || 0, mouth: p.mouth || 0, brow: p.brow || 0, smile: p.smile || 0 });", '표정 복사');
patch("o.mouth = L(a.mouth || 0, b.mouth || 0);", "o.mouth = L(a.mouth || 0, b.mouth || 0); o.brow = L(a.brow || 0, b.brow || 0); o.smile = L(a.smile || 0, b.smile || 0);", '표정 사이값');
patch("uniform float u_op; varying vec2 v_uv;\n    float tint;", "uniform float u_op; uniform vec2 u_face; varying vec2 v_uv;\n    float tint;\n    vec2 brow(vec2 uv, vec4 b, float a){ float w = b.z - b.x, h = b.w - b.y; if (w <= 0.0 || uv.x <= b.x - w * 0.3 || uv.x >= b.z + w * 0.3) return uv;\n      float u = (uv.x - (b.x - w * 0.3)) / (w * 1.6), wx = smoothstep(0.0, 0.25, u) * smoothstep(0.0, 0.25, 1.0 - u), yA = b.y - h * 2.0, yB = b.y - h * 0.05;\n      float wy = smoothstep(yA, yA + h * 0.6, uv.y) * (1.0 - smoothstep(yB - h * 0.35, yB, uv.y)); uv.y += a * h * 0.38 * wx * wy; return uv; }\n    vec2 smile(vec2 uv, vec4 b, float a){ float w = b.z - b.x, h = max(b.w - b.y, w * 0.22), px = w * 0.3; if (w <= 0.0 || uv.x <= b.x - px || uv.x >= b.z + px) return uv;\n      float u = (uv.x - (b.x - px)) / (w + 2.0 * px), k = (2.0 * u - 1.0) * (2.0 * u - 1.0), wx = smoothstep(0.0, 0.12, u) * smoothstep(0.0, 0.12, 1.0 - u);\n      float wy = smoothstep(b.y - h * 1.6, b.y - h * 0.3, uv.y) * (1.0 - smoothstep(b.w + h * 0.3, b.w + h * 1.6, uv.y)); uv.y += a * h * 0.7 * k * wx * wy; return uv; }", '표정 셰이더');
patch("void main(){ vec2 uv = v_uv; tint = 0.0;", "void main(){ vec2 uv = v_uv; tint = 0.0; if (u_face.x != 0.0) { uv = brow(uv, u_eye0, u_face.x); uv = brow(uv, u_eye1, u_face.x); } if (u_face.y != 0.0) uv = smile(uv, u_mouth, u_face.y);", '표정 적용');
patch("mo: U('u_mo'),", "mo: U('u_mo'), face: U('u_face'),", '표정 변수');
patch("gl.uniform2f(R.u.blink, 0, 0); gl.uniform4f(R.u.mo, 0, 0, 0, 0);", "gl.uniform2f(R.u.blink, 0, 0); gl.uniform2f(R.u.face, 0, 0); gl.uniform4f(R.u.mo, 0, 0, 0, 0);", '표정 처음값');
patch("gl.uniform4fv(R.u.eye0, eb(0)); gl.uniform4fv(R.u.eye1, eb(1));", "gl.uniform4fv(R.u.eye0, eb(0)); gl.uniform4fv(R.u.eye1, eb(1)); gl.uniform2f(R.u.face, ev.pose.brow || 0, Mo ? (ev.pose.smile || 0) : 0);", '표정 보내기');
patch("'이 시각에 입을 얼마나 벌릴지. 원래 벌린 입은 왼쪽으로 밀면 다물어요') : ''}", "'이 시각에 입을 얼마나 벌릴지. 원래 벌린 입은 왼쪽으로 밀면 다물어요') : ''}${rig.eyes.some(e => e.on !== false) ? rng('눈썹', 'data-rgw=\"brow\"', Math.round((p.brow || 0) * 100), -100, 100, 1, '오른쪽으로 밀면 눈썹이 올라가고(놀람), 왼쪽으로 밀면 내려가요(찡그림)') : ''}${hasMouth ? rng('입꼬리', 'data-rgw=\"smile\"', Math.round((p.smile || 0) * 100), -100, 100, 1, '오른쪽으로 밀면 웃는 입, 왼쪽으로 밀면 처진 입이 돼요') : ''}", '표정 조절 칸');
patch("else if (t.dataset.rgw === 'mouth') p.mouth = v / 100; else p.blink = v / 100;", "else if (t.dataset.rgw === 'mouth') p.mouth = v / 100; else if (t.dataset.rgw === 'brow') p.brow = v / 100; else if (t.dataset.rgw === 'smile') p.smile = v / 100; else p.blink = v / 100;", '표정 값 받기');
patch('  const key = e => {', '  const key = e => {\n    if (window.__rigAway) return;   // 창을 접고 그림판에서 고르는 동안은 단축키를 가로채지 않아요', '단축키 쉬기');
patch('<button class="btn sm" data-rgfx="layer">내보내기</button>', '<button class="btn sm primary" data-rgfn="layer">NovelAI로 바로</button><button class="btn sm" data-rgfx="layer">내보내기</button>', '층 내보내기 단추');
patch('<button class="btn sm" data-rgfx="bg">내보내기</button>', '<button class="btn sm primary" data-rgfn="bg">NovelAI로 바로</button><button class="btn sm" data-rgfx="bg">내보내기</button>', '배경 내보내기 단추');
patch("if (b && (b.dataset.rgfx || b.dataset.rgfi)) {", "if (b && b.dataset.rgfn) { const isBg = b.dataset.rgfn === 'bg', L = rig.layers.find(l => l.id === st.selLayer) || base(), what = isBg ? 'bg' : L, ex = rgFillExport(main, rig, what); if (!ex.any) { toast('다시 그릴 메운 자리가 없어요. 부위를 떼어 낸 뒤에 써 주세요.'); return; } const img = await naiFill(ex.pic, ex.mask, isBg ? '배경' : L.name); if (img) { snap(); rgFillImport(main, rig, what, img); renderSide(); dirty(); toast((isBg ? '배경' : `'${L.name}'`) + '의 메운 자리를 NovelAI로 다시 그렸어요. 마음에 안 들면 Ctrl+Z'); } return; }\n    if (b && (b.dataset.rgfx || b.dataset.rgfi)) {", '메운 자리 단추 처리');
// (나) 이미지 작업실의 고르는 도구(마법 붓·AI로 고르기 등)로 고른 곳을 '칠한 곳'으로 가져오기
patch('data-rga="sam" title="대충 칠한 곳을 AI가 물체 윤곽에 맞춰 줘요">AI로 윤곽 맞추기</button>', 'data-rga="sam" title="대충 칠한 곳을 AI가 물체 윤곽에 맞춰 줘요">AI로 윤곽 맞추기</button><button class="btn sm" data-rga="fromsel" title="이미지 작업실에서 마법 붓, 올가미, AI로 고르기로 고른 곳을 칠한 곳으로 가져와요">고른 곳 가져오기</button><button class="btn sm" data-rga="pick2" title="이 창을 잠시 접고, 그림판에서 마법 붓·올가미·AI로 고르기로 고른 뒤 돌아와요">그림판에서 고르기</button>', '윤곽 맞추기 단추');
patch("else if (act === 'sam') {", "else if (act === 'pick2') { if (from.pickOutside && await from.pickOutside()) { const b2 = document.querySelector('#modalRoot [data-rga=fromsel]'); if (b2) b2.click(); } return; }\n    else if (act === 'fromsel') { const m = from.selMask ? await from.selMask() : null; if (!m) { toast('이미지 작업실에서 고른 곳이 없어요. 창을 닫고 마법 붓이나 AI로 고르기로 먼저 골라 주세요.'); return; } snap(); if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); const g = st.pm.getContext('2d'); g.clearRect(0, 0, st.pm.width, st.pm.height); g.drawImage(m, 0, 0, st.pm.width, st.pm.height); g.globalCompositeOperation = 'source-in'; g.fillStyle = 'rgb(255,60,160)'; g.fillRect(0, 0, st.pm.width, st.pm.height); g.globalCompositeOperation = 'source-over'; st.pmAny = true; renderSide(); dirty(); toast('고른 곳을 가져왔어요. 붓으로 더 다듬거나 바로 떼어 낼 수 있어요.'); }\n    else if (act === 'sam') {", '윤곽 맞추기 처리');
// 2.0에서 더한 것: 눌러서 고르기. 부위를 한 번 누르면 AI가 그 부위의 윤곽을 잡아 칠해 줘요. 더 누르면 넓어지고, Alt를 누른 채 누르면 그 자리는 빠져요.
patch("/* ---- 메운 자리를 더 좋은 그림으로:", `// 누른 점들(P = [[x, y, 1(여기) 또는 0(여기는 빼기)], …])로 윤곽을 물어봐요
async function rgSamPoints(rig, P, tk) {
  const { W, H } = rig, E = await rgSamEnc(rig, tk), { s, tw, th } = E, plane = tw * th;
  const r = await rgSamAsk(E, P.map(p => [p[0] * s, p[1] * s, p[2]]), null), m = r.m; let best = -1, bs = -1;
  for (let k = 0; k < r.nm; k++) { let a = 0, ok = true; for (let i = 0; i < plane; i++) if (m[k * plane + i] > 0) a++; if (!a || a > plane * 0.9) continue;
    for (const p of P) { const v = m[k * plane + clamp(Math.round(p[1] * s), 0, th - 1) * tw + clamp(Math.round(p[0] * s), 0, tw - 1)] > 0; if (v !== !!p[2]) ok = false; }   // 누른 점의 뜻(여기 / 빼기)을 지키는 후보를 먼저
    const sc = (r.iou ? r.iou[k] : 0) + (ok ? 1 : 0); if (sc > bs) { bs = sc; best = k; } }
  if (best < 0) return null;
  const bin = new Uint8Array(plane); for (let i = 0; i < plane; i++) bin[i] = m[best * plane + i] > 0 ? 1 : 0;
  return rgUpMask(bin, tw, th, W, H);
}
/* ---- 메운 자리를 더 좋은 그림으로:`, '눌러서 고르기 계산');
patch(`data-rgb="sub" title="Alt를 누른 채 칠해도 돼요">지우기</button>`, `data-rgb="sub" title="Alt를 누른 채 칠해도 돼요">지우기</button><button class="btn sm \${st.brush === 'click' ? 'on' : ''}" data-rgb="click" title="떼고 싶은 부위를 한 번 누르면 AI가 그 부위의 윤곽을 잡아 칠해 줘요. 모자라면 더 눌러 넓히고, Alt를 누른 채 누르면 그 자리는 빠져요. 다 되면 떼어 내기를 눌러요">눌러서 고르기</button>`, '눌러서 고르기 단추');
patch("    if (st.mode === 'part') { const smart = st.brush === 'smart'", `    if (st.mode === 'part' && st.brush === 'click') {
      if (!st.pmAny || !st.pts) st.pts = []; st.pts.push([q.x, q.y, e.altKey ? 0 : 1]); const P = st.pts.slice();
      if (!P.some(p => p[2])) { st.pts.pop(); toast('먼저 떼고 싶은 부위를 눌러 주세요. Alt를 누른 채 누르는 것은 빼고 싶은 자리예요.'); return; }
      busy('AI가 누른 곳의 윤곽을 찾는 중…', async tk => { const N = await rgSamPoints(rig, P, tk); if (!N) { st.pts.pop(); toast('윤곽을 찾지 못했어요. 조금 옆을 눌러 보세요.'); return; } if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); pmFrom(N); });
      return;
    }
    if (st.mode === 'part') { const smart = st.brush === 'smart'`, '눌러서 고르기 누르기');
patch("      if (st.pmTmp && st.tmpAny) { g.save(); g.globalAlpha = 0.22;", `      if (st.brush === 'click' && st.pts && st.pmAny) for (const p of st.pts) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 5 * d, 0, 7); g.fillStyle = p[2] ? '#35c46a' : '#e5484d'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5 * d; g.stroke(); }
      if (st.pmTmp && st.tmpAny) { g.save(); g.globalAlpha = 0.22;`, '눌러서 고르기 점 표시');
// 2.0에서 더한 것: 겹친 다리 떼기. 두 다리가 서로(또는 몸에) 겹쳐 한 덩어리로 보이면, 한쪽 다리를 따로 떼어요.
patch("  return made;\n}\n// 그림을 SAM(윤곽 AI)에 한 번 읽혀 두기", `  return made;
}
// 단추로만 불러요(처음 준비할 때 알아서 떼지는 않아요: 치마·긴 옷을 다리로 잘못 뗄 수 있어서). force = 겹쳤는지 따지지 않고 해 봄
async function rgAutoLegs(rig, tk, chars, force) {
  const { W, H } = rig, J = rig.joints, made = []; if (rig.stdOff || !J.aHip || !J.bHip) return made;
  const base = rig.layers.find(l => l.base), A = rgAlpha(base, W, H), sw = Math.hypot(J.aSho.x - J.bSho.x, J.aSho.y - J.bSho.y), hw = Math.hypot(J.aHip.x - J.bHip.x, J.aHip.y - J.bHip.y), th = Math.max(hw * 0.85, sw * 0.3);
  // 뼈를 따라가며 옆으로 잰 폭이 다리 하나보다 훨씬 넓은 곳의 비율 (겹쳐 있으면 넓게 나와요)
  const wide = (a, b, t0) => { let n = 0, k = 0; const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l; for (let t = t0; t <= 1.001; t += 0.125) { const x = a.x + dx * t, y = a.y + dy * t; let w = 0; for (const sg of [1, -1]) for (let d = 0; d < th * 3; d += 2) { const xx = Math.round(x + nx * d * sg), yy = Math.round(y + ny * d * sg); if (xx < 0 || yy < 0 || xx >= W || yy >= H || A[yy * W + xx] < 128) break; w += 2; } n++; if (w > th * 1.7) k++; } return n ? k / n : 0; };
  const cand = [];
  for (const pre of ['a', 'b']) {
    const Hp = pre + 'Hip', Kn = pre + 'Knee', An = pre + 'Ank', To = pre + 'Toe', oth = pre === 'a' ? 'b' : 'a'; if (!rgOn(rig, Kn) || !rgOn(rig, An)) continue;
    const low = wide(J[Kn], J[An], 0.15), up = wide(J[Hp], J[Kn], 0.4); if (!force && low < 0.5) continue;
    cand.push({ pre, oth, Hp, Kn, An, To, low, up });
  }
  cand.sort((p, q) => q.low - p.low);
  for (const c of cand) {
    const whole = c.up > 0.6 || force, path = [...(whole ? [J[c.Hp]] : []), J[c.Kn], J[c.An], ...(rgOn(rig, c.To) ? [J[c.To]] : [])];
    const cv = newCanvas(W, H), g = cv.getContext('2d', { willReadFrequently: true }); g.strokeStyle = '#fff'; g.lineWidth = th * 0.55; g.lineCap = g.lineJoin = 'round'; g.beginPath();
    const p0 = { x: path[0].x + (path[1].x - path[0].x) * 0.2, y: path[0].y + (path[1].y - path[0].y) * 0.2 }; g.moveTo(p0.x, p0.y); for (const p of path.slice(1)) g.lineTo(p.x, p.y); g.stroke();
    const d = g.getImageData(0, 0, W, H).data, M = new Uint8ClampedArray(W * H); let am = 0; for (let i = 0; i < M.length; i++) { M[i] = d[i * 4 + 3] > 128 && A[i] > 128 ? 255 : 0; if (M[i]) am++; }
    if (am < 80) continue;
    tk && tk.set('겹친 다리를 떼어 내는 중…');
    const N = await rgSamRefine(rig, M, tk); if (!N) continue;
    let an = 0, it = 0; for (let i = 0; i < N.length; i++) { if (A[i] < 128) N[i] = 0; if (N[i] > 128) { an++; if (M[i]) it++; } }
    const inN = p => !!p && N[clamp(Math.round(p.y), 0, H - 1) * W + clamp(Math.round(p.x), 0, W - 1)] > 128;
    // 윤곽이 다리 하나를 넘어서면(몸통·반대쪽 다리까지 잡히면) 그만둬요
    if (an > am * 4.5 || it < am * 0.55 || inN(J.waist) || inN(J.spine) || inN(J.chest) || (rgOn(rig, c.oth + 'Knee') && inN(J[c.oth + 'Knee'])) || (rgOn(rig, c.oth + 'Ank') && inN(J[c.oth + 'Ank']))) continue;
    const L = await rgSplit(rig, base, N, rgSideName(rig, c.pre === 'a' ? 'legA' : 'legB') + (whole ? '' : ' 아래쪽'), tk, chars); if (L) { L.auto = true; made.push(L); break; }   // 한쪽을 떼면 다른 쪽은 이미 따로예요
  }
  return made;
}
// 그림을 SAM(윤곽 AI)에 한 번 읽혀 두기`, '겹친 다리 떼기');
patch('<button class="btn sm" data-rga="pick2"', '<button class="btn sm" data-rga="autolegs" title="겹친 다리를 따로 떼어요. 뼈대가 맞춰져 있으면 알아서 찾고, 아니면 다리를 따라 붓으로 한 번 그은 뒤 누르면 윤곽을 맞춰 바로 떼어요">겹친 다리 떼기</button><button class="btn sm" data-rga="pick2"', '겹친 다리 단추');
patch("else if (act === 'pick2') {", "else if (act === 'autolegs') { const M0 = pmMask(); busy('겹친 다리를 떼어 내는 중…', async tk => { const before = shot(); if (M0) { let N = await rgSamRefine(rig, M0, tk); if (N) { const n = M0.length, f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = M0[i] / 255; const bl = dpBox(f, rig.W, rig.H, Math.max(4, Math.round(Math.max(rig.W, rig.H) / 110))); for (let i = 0; i < n; i++) N[i] = bl[i] > 0.97 ? 255 : bl[i] < 0.03 ? 0 : N[i]; } else N = M0; const P = await rgSplit(rig, base(), N, '다리 ' + rig.layers.length, tk, chars()); if (!P) { toast('칠한 곳에 캐릭터가 거의 없어요'); return; } st.undo.push(before); st.redo.length = 0; st.selLayer = P.id; st.pm.getContext('2d').clearRect(0, 0, st.pm.width, st.pm.height); st.pmAny = false; toast(`'${P.name}'를 따로 떼어 냈어요. ③ 움직임 만들기에서 움직여 보세요.`, 4600); return; } const made = await rgAutoLegs(rig, tk, chars(), true); if (!made.length) { toast('뼈대만으로는 떼어 낼 다리를 찾지 못했어요. 떼고 싶은 다리를 따라 붓으로 한 번 그은 뒤 이 단추를 다시 눌러 주세요. 윤곽을 맞춰서 바로 떼어 드려요.', 6500); return; } rig.ver++; st.undo.push(before); st.redo.length = 0; toast(`'${made[0].name}'를 따로 떼어 냈어요. 모자라거나 넘친 곳은 붓으로 고칠 수 있어요.`, 4600); }); return; }\n    else if (act === 'pick2') {", '겹친 다리 처리');

// 2) rig.js가 쓰는 8.x의 작은 계산 함수들을 그대로 가져와요
function pick(file, names) {
  const text = read(file), ast = parse(text, { ecmaVersion: 2023, sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  return names.map(n => { const f = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); if (!f) throw new Error(`${file}에 ${n}이 없어요`); return text.slice(f.start, f.end); }).join('\n');
}
const helpers = [pick('cz.js', ['czDeepest', 'czLargest']), pick('depth.js', ['dpBox', 'dpNormBlur', 'dpFill']), pick('ai.js', ['aiMask'])].join('\n');

const DEPS = ['$', '$$', 'clamp', 'esc', 'uid', 'newCanvas', 'toast', 'modal', 'closeModal', 'czLoad', 'czCall', 'cz', 'czIsApp', 'czPacksReady', 'czPackState', 'czProgress', 'czErrText', 'idb', 'safeName', 'saveFiles', 'naiFill'];
writeFileSync(join(out, 'rig.gen.js'), `// 자동으로 만든 파일이에요. 고치지 마세요 (tools/legacy.mjs가 8.x의 src/rig.js에서 만들어요)
/* eslint-disable */
export function makeRig(deps) {
  const { ${DEPS.join(', ')} } = deps;
${helpers}
${rig}
  return { rgOpen, dpFill };
}
`);

// 3) 모양: 8.x 화면 꾸밈 중에서 이 창이 쓰는 것만 골라, #modalRoot 안에서만 먹게 해요
const head = read('head.html'), css = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const used = new Set(['modal', 'modal-bg', 'wide', 'btn', 'primary', 'sm', 'muted', 'small', 'sub', 'foot', 'czbar', 'seg', 'on', 'chk', 'flex1', 'grid2', 'btnrow', 'sec', 'ic', 'nm', 'row', 'danger', 'ghost', 'num', 'rng']);
for (const m of rig.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`$<>]+)/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
const rules = [];
(function walk(text, wrap) {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i); if (open < 0) break;
    let depth = 1, j = open + 1; while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const sel = text.slice(i, open).trim(), body = text.slice(open + 1, j - 1);
    if (sel.startsWith('@media')) walk(body, sel);
    else if (!sel.startsWith('@') && !/^(:root|html|body)\b/.test(sel)) {
      const keep = sel.split(',').map(s => s.trim()).filter(s => {
        const cls = [...s.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
        if (/#(?!modalRoot)/.test(s)) return false;
        return cls.length ? (cls.some(c => c.startsWith('rg')) || cls.every(c => used.has(c))) : /^(button|input|select|textarea|label|h2|h3|p|b|small|kbd|a)\b/.test(s);
      }).map(s => '#modalRoot ' + s);
      if (keep.length) rules.push((wrap ? wrap + '{' : '') + keep.join(',') + '{' + body.trim() + '}' + (wrap ? '}' : ''));
    }
    i = j;
  }
})(css, '');
writeFileSync(join(out, 'rig.gen.css'), '/* 자동으로 만든 파일이에요 (tools/legacy.mjs) */\n' + rules.join('\n') + '\n');

// 4) 영상·움짤 저장 도구(MP4·GIF·WebP)도 8.x 것을 그대로 가져와요
const main = read('main.js'), a0 = main.indexOf('class ByteOut {'), w0 = main.indexOf('async function encodeWebp(');
if (a0 < 0 || w0 < a0) throw new Error('main.js에서 저장 도구를 찾지 못했어요');
let d = 0, e0 = main.indexOf('{', w0); for (let i = e0; i < main.length; i++) { if (main[i] === '{') d++; else if (main[i] === '}' && --d === 0) { e0 = i + 1; break; } }
const encMain = main.slice(a0, e0); parse(encMain, { ecmaVersion: 2023, sourceType: 'script' });
const gif2 = read('gif2.js'), codecs = /const GS_CODECS = .*;/.exec(gif2);
if (!codecs) throw new Error('gif2.js에 GS_CODECS가 없어요');
writeFileSync(join(out, 'enc.gen.js'), `// 자동으로 만든 파일이에요. 고치지 마세요 (tools/legacy.mjs가 8.x의 main.js·gif2.js에서 만들어요)
/* eslint-disable */
export function makeEnc(deps) {
  const { newCanvas, gs, uiSet, Mp4Muxer } = deps;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
${codecs[0]}
${pick('audio.js', ['auEncoderCfg', 'auEncode'])}
${pick('gif2.js', ['gsMp4Codec', 'encodeMp4'])}
${encMain}
  return { encodeMp4, encodeGif, encodeWebp };
}
`);

// 5) AI 도구들: 자동 흰칠(찾기·모양 따기), 선화 추출, 깊이 흐림, AI 중간 장면
const czSrc = read('cz.js'), h0 = czSrc.indexOf('const CZ_MODELS = {'), h1 = czSrc.indexOf('/* ---- 일꾼'), c0 = czSrc.indexOf('function czPrep('), c1 = czSrc.indexOf('function czProgress(');
if (h0 < 0 || h1 < h0 || c0 < h1 || c1 < c0) throw new Error('cz.js에서 자동 흰칠 부분을 찾지 못했어요');
const czHead = czSrc.slice(h0, h1).replace(/\(\(\) => \{ try \{ return JSON\.parse\(localStorage\.getItem\('cutCzCfg'\)[^\n]*/, '{});');
writeFileSync(join(out, 'ai2.gen.js'), `// 자동으로 만든 파일이에요. 고치지 마세요 (tools/legacy.mjs가 8.x의 cz.js·ai.js·depth.js·gif2.js에서 만들어요)
/* eslint-disable */
export function makeAi2(deps) {
  const { newCanvas, clamp, czLoad, czCall, cz, aiLine, czPackState, aiMask } = deps;
  const dpCache = new Map();
${czHead}
${czSrc.slice(c0, c1)}
${pick('cz.js', ['czDrawShapes'])}
${pick('ai.js', ['aiPixels', 'aiLineArt'])}
${pick('depth.js', ['dpRaw', 'dpBox', 'dpGuided', 'dpGray', 'dpDepth', 'dpSubject', 'dpOtsu', 'dpNormBlur', 'dpDof', 'dpFill', 'dpExtend', 'dpPrepare', 'dpFrame'])}
${pick('gif2.js', ['riPlane', 'riRun'])}
  return { czCfg, czNewState, czAnalyze, czComposeMask, czDilate, aiLineArt, dpDepth, dpOtsu, dpDof, dpPrepare, dpFrame, riRun };
}
`);
// 6) 움짤 연출: 움직임 97가지(Animate.css), 장면 넘김 196가지(gl-transitions), 입자·화면 효과, 카메라 화면
{
  const an = read('anim.js'), e2 = read('edit2.js'), cut = (t, a, b) => { const i = t.indexOf(a), j = t.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`연출 코드에서 '${a}' 부분을 찾지 못했어요`); return t.slice(i, j); };
  const tm0 = e2.indexOf('const TMPL_KINDS'), tm1 = e2.indexOf('function drawTmplEl('); if (tm0 < 0 || tm1 < tm0) throw new Error('edit2.js에서 카메라 화면 부분을 찾지 못했어요');
  writeFileSync(join(out, 'fx.gen.js'), `// 자동으로 만든 파일이에요. 고치지 마세요 (tools/legacy.mjs가 8.x의 anim.js·presets.js·edit2.js에서 만들어요)
/* eslint-disable */
export function makeFx(deps) {
  const { newCanvas, clamp, uid, gsTotal, gs } = deps;
  const DEG = Math.PI / 180, bezC = new Map(), hash1 = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  const fontCss = () => '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif', doc = { defaults: { text: { font: '' } } };
  let fxCopyC = null, fxNoiseC = null;
${read('presets.js')}
${e2.slice(tm0, tm1)}
${cut(an, 'function bezier(', 'const TX_IN')}
${cut(an, 'const EMOJIS', 'const FX_KINDS').split('\n')[0]}
${cut(an, 'const FX_KINDS', 'const FX_PRESETS')}
${cut(an, 'function fxCopy(', 'function gsRenderExtras(')}
${cut(an, 'const GLT_KO', 'function gltPickRandom(')}
  return { EMOJIS, ANIM_CSS, AN_KO, AN_ALL, AN_LOOP, AN_IN, AN_OUT, animAt, animApply, FX_KINDS, FXK, FX_DEF, fxParticles, fxScreen, GL_TRANS, GLT_KO, GLT_TOP, gltRender, glt: () => glt };
}
`);
}
console.log(`캐릭터 움직이기 묶음: 코드 ${(rig.length / 1024).toFixed(0)} KB, 꾸밈 규칙 ${rules.length}개`);
