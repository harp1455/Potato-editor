/* ================= 캐릭터 움직이기 (리깅): AI로 캐릭터를 따내고, 뼈대를 넣어 자세·움직임을 직접 고쳐요 ================= */
// 흐름: 캐릭터 따내기(배경 지우기 팩) → 캐릭터 뒤 배경 메우기(AI 지우개 팩) → 뼈대 찾기·눈 찾기(캐릭터 뼈대 팩)
//      → 그물(삼각형)을 씌우고 관절마다 얼마나 따라갈지 정해요 → 관절을 끌어 자세를 잡고 시간 막대에 저장 → 영상 장면으로 내보내요
// 좌표는 모두 '작업 그림'(긴 쪽 최대 RG_MAX) 픽셀이에요.
const RG_MAX = 2048;
// 관절: [이름표, 부모, 앞뒤 순서(클수록 앞)]. a = 캐릭터의 왼쪽(보통 화면 오른쪽), b = 캐릭터의 오른쪽
const RG_J = {
  root: ['골반', null, 0], waist: ['허리', 'root', 0], spine: ['등', 'waist', 0], chest: ['가슴', 'spine', 0], neck: ['목', 'chest', 1], head: ['머리 끝', 'neck', 1],
  aSho: ['어깨', 'chest', 2], aElb: ['팔꿈치', 'aSho', 2], aWri: ['손목', 'aElb', 2], aHand: ['손끝', 'aWri', 2],
  bSho: ['어깨', 'chest', 2], bElb: ['팔꿈치', 'bSho', 2], bWri: ['손목', 'bElb', 2], bHand: ['손끝', 'bWri', 2],
  aHip: ['다리 뿌리', 'root', -1], aKnee: ['무릎', 'aHip', -1], aAnk: ['발목', 'aKnee', -1], aToe: ['발끝', 'aAnk', -1],
  bHip: ['다리 뿌리', 'root', -1], bKnee: ['무릎', 'bHip', -1], bAnk: ['발목', 'bKnee', -1], bToe: ['발끝', 'bAnk', -1],
};
const RG_STD = Object.keys(RG_J); // 사람 모양 기본 뼈대
// 내 뼈(사용자가 손·팔·다리·목·꼬리 등에 몇 개만 넣는 뼈): x0~x23. 'fix' = 내 뼈가 없는 나머지 몸(제자리에 고정, 전체 옮기기만 따라가요)
const RG_XN = 24, RG_X = Array.from({ length: RG_XN }, (_, i) => 'x' + i);
const RG_IDS = [...RG_STD, 'fix', ...RG_X, 'edge'], // 'edge' = 화면 끝에 닿은 곳(늘 제자리)
   RG_IX = Object.fromEntries(RG_IDS.map((k, i) => [k, i]));
const RG_CHAIN_KINDS = { // 점 이름(누르는 차례), 기본 이름
  hand: { name: '손', pts: ['손목', '손끝'] },
  arm: { name: '팔', pts: ['어깨', '팔꿈치', '손목', '손끝'] },
  leg: { name: '다리', pts: ['다리 뿌리', '무릎', '발목', '발끝'] },
  neck: { name: '목·머리', pts: ['목 뿌리', '머리 끝'] },
  free: { name: '뼈', pts: ['시작점', '점 2', '점 3', '점 4', '점 5', '끝점'] },
};
const rgChainOf = (rig, id) => (rig.chains || []).find(c => c.ids.includes(id)) || null;
const RG_LIMBS = { armA: ['aSho', 'aElb', 'aWri', 'aHand'], armB: ['bSho', 'bElb', 'bWri', 'bHand'], legA: ['aHip', 'aKnee', 'aAnk', 'aToe'], legB: ['bHip', 'bKnee', 'bAnk', 'bToe'] };
const RG_IK = { aWri: ['aSho', 'aElb'], bWri: ['bSho', 'bElb'], aAnk: ['aHip', 'aKnee'], bAnk: ['bHip', 'bKnee'] }; // 끝을 끌면 가운데 관절이 알아서 굽어요
// 부모 관절: 기본 뼈대는 정해져 있고, 내 뼈는 사슬의 앞 점 → 맨 앞 점은 붙인 관절(꺼져 있으면 'fix')
// 몸통이 어디부터 보이는지: 그 관절이 뼈대의 뿌리가 되고, 그 아래(골반 쪽) 관절과 다리는 꺼져요
const RG_TORSO = ['root', 'waist', 'spine', 'chest', 'neck'];
const rgBase = rig => rig && RG_TORSO.includes(rig.cut) ? rig.cut : 'root';
function rgPar(id, rig) {
  if (RG_J[id]) return rig && id !== 'root' && rgBase(rig) === id ? null : RG_J[id][1]; if (id === 'fix' || !rig) return null;
  const c = rgChainOf(rig, id); if (!c) return null; const i = c.ids.indexOf(id);
  if (i > 0) return c.ids[i - 1];
  return c.attach && RG_J[c.attach] && rgOn(rig, c.attach) ? c.attach : 'fix';
}
function rgOn(rig, id) {
  if (id === 'fix') return true;
  for (let k = id; k && k !== 'fix'; k = rgPar(k, rig)) { if (!rig.joints[k] || rig.joints[k].on === false) return false; if (RG_J[k] && (rig.stdOff || (rig.cut && rig.cut !== 'root' && RG_TORSO.indexOf(k) >= 0 && RG_TORSO.indexOf(k) < RG_TORSO.indexOf(rgBase(rig))))) return false; }
  return true;
}
const rgKids = (rig, id) => RG_IDS.filter(k => k !== 'fix' && rgPar(k, rig) === id && rgOn(rig, k));
const rgFixUsed = rig => (rig.chains || []).some(c => rgPar(c.ids[0], rig) === 'fix');
// 끝을 끌면 가운데 관절이 알아서 굽는 곳 → [위, 가운데] 또는 null
function rgIKOf(rig, id) {
  if (RG_IK[id]) return rgOn(rig, RG_IK[id][1]) ? RG_IK[id] : null;
  const c = rgChainOf(rig, id); if (!c) return null; const i = c.ids.indexOf(id);
  if (i < 2) return null; if ((c.kind === 'arm' || c.kind === 'leg') && i !== 2) return null; // 팔·다리는 손목·발목만, 손끝·발끝은 그 마디만 돌려요
  return [c.ids[i - 2], c.ids[i - 1]];
}
const rgJName = (rig, id) => { if (RG_J[id]) return RG_J[id][0]; const c = rgChainOf(rig, id); if (!c) return id; const k = RG_CHAIN_KINDS[c.kind] || RG_CHAIN_KINDS.free, i = c.ids.indexOf(id); return c.name + ' ' + (c.kind === 'free' ? (i === 0 ? '시작점' : i === c.ids.length - 1 ? '끝점' : '점 ' + (i + 1)) : k.pts[i] || '점 ' + (i + 1)); };
const rgSmooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---- AI: 뼈대 찾기 (DWPose, 133점) ---- */
// → [[x, y, 점수] × 133] (그림 좌표). box: 캐릭터가 있는 상자
async function rgPoseRun(src, W, H, box, tk) {
  await czLoad('pose'); if (tk && tk.stop) throw new Error('stop');
  const IW = 288, IH = 384, cx = box.x + box.w / 2, cy = box.y + box.h / 2; let bw = box.w * 1.25, bh = box.h * 1.25;
  if (bw / bh > IW / IH) bh = bw * IH / IW; else bw = bh * IW / IH;
  const c = newCanvas(IW, IH), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#000'; g.fillRect(0, 0, IW, IH); g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, W, H, (0 - (cx - bw / 2)) * IW / bw, (0 - (cy - bh / 2)) * IH / bh, W * IW / bw, H * IH / bh);
  const d = g.getImageData(0, 0, IW, IH).data, n = IW * IH, x = new Float32Array(3 * n), M = [123.675, 116.28, 103.53], S = [58.395, 57.12, 57.375];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) x[k * n + i] = (d[i * 4 + k] - M[k]) / S[k];
  const r = await czCall({ t: 'run2', key: 'pose', outs: ['simcc_x', 'simcc_y'], feeds: { input: { data: x, dims: [1, 3, IH, IW] } } }, [x.buffer]);
  const sx = r.out.simcc_x, sy = r.out.simcc_y, K = sx.dims[1], nx = sx.dims[2], ny = sy.dims[2], out = [];
  for (let k = 0; k < K; k++) {
    let bx = 0, vx = -1e9, by = 0, vy = -1e9;
    for (let i = 0; i < nx; i++) { const v = sx.data[k * nx + i]; if (v > vx) { vx = v; bx = i; } }
    for (let i = 0; i < ny; i++) { const v = sy.data[k * ny + i]; if (v > vy) { vy = v; by = i; } }
    out.push([bx / 2 * bw / IW + cx - bw / 2, by / 2 * bh / IH + cy - bh / 2, Math.min(vx, vy)]);
  }
  return out;
}
/* ---- AI: 눈 찾기 (애니 눈 탐지) ---- */
// → [{x, y, w, h, s}] 점수 높은 순. box 안을 긴 쪽 640으로 보고 찾아요
const rgEyesRun = (src, W, H, box, tk) => rgYolo('eye', src, W, H, box, tk);
const rgChars = rig => [rig, ...(rig.more || [])]; // 캐릭터가 여럿이면 첫 캐릭터의 more에 나머지가 들어 있어요 (그림·배경·내보내기 설정은 같이 써요)
async function rgYolo(key, src, W, H, box, tk) {
  await czLoad(key); if (tk && tk.stop) throw new Error('stop');
  const bx = clamp(Math.floor(box.x), 0, W - 2), by = clamp(Math.floor(box.y), 0, H - 2), bw = clamp(Math.round(box.w), 2, W - bx), bh = clamp(Math.round(box.h), 2, H - by);
  const r = 640 / Math.max(bw, bh), w = Math.max(1, Math.round(bw * r)), h = Math.max(1, Math.round(bh * r)), w32 = Math.ceil(w / 32) * 32, h32 = Math.ceil(h / 32) * 32;
  const c = newCanvas(w32, h32), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = 'rgb(114,114,114)'; g.fillRect(0, 0, w32, h32); g.imageSmoothingQuality = 'high'; g.drawImage(src, bx, by, bw, bh, 0, 0, w, h);
  const d = g.getImageData(0, 0, w32, h32).data, n = w32 * h32, x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { x[i] = d[i * 4] / 255; x[n + i] = d[i * 4 + 1] / 255; x[2 * n + i] = d[i * 4 + 2] / 255; }
  const o = await czCall({ t: 'run', key, data: x, dims: [1, 3, h32, w32] }, [x.buffer]);
  const N = o.dims[2], y = o.data, list = [];
  for (let i = 0; i < N; i++) { const s = y[4 * N + i]; if (s < 0.25) continue; const ww = y[2 * N + i] / r, hh = y[3 * N + i] / r; list.push({ x: y[i] / r - ww / 2 + bx, y: y[N + i] / r - hh / 2 + by, w: ww, h: hh, s }); }
  list.sort((a, b) => b.s - a.s); const keep = [];
  for (const b of list) { if (keep.every(k => { const ix = Math.max(0, Math.min(b.x + b.w, k.x + k.w) - Math.max(b.x, k.x)), iy = Math.max(0, Math.min(b.y + b.h, k.y + k.h) - Math.max(b.y, k.y)); return ix * iy < 0.4 * Math.min(b.w * b.h, k.w * k.h); })) keep.push(b); if (keep.length >= 6) break; }
  return keep;
}

/* ---- 뼈대 만들기 ---- */
// 133점 → 관절 자리. 못 찾은 팔·다리는 꺼 둬요(on: false). conf: 0~1 (얼마나 믿을 만한지)
function rgSkeleton(K, W, H, box) {
  const T = 0.3, ok = i => K && K[i] && K[i][2] >= T && K[i][0] > -W * 0.05 && K[i][0] < W * 1.05 && K[i][1] > -H * 0.05 && K[i][1] < H * 1.05, P = i => ({ x: K[i][0], y: K[i][1] });
  const mid = (a, b, t = 0.5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), J = {};
  const cl = p => ({ x: clamp(p.x, 2, W - 2), y: clamp(p.y, 2, H - 2) });
  if (!(ok(5) && ok(6))) return rgSkeletonGuess(W, H, box);
  const sa = P(5), sb = P(6), chest = mid(sa, sb), sw = Math.max(8, Math.hypot(sa.x - sb.x, sa.y - sb.y));
  const hp = [0, 1, 2, 3, 4].filter(ok).map(P); let hc;
  if (hp.length) hc = { x: hp.reduce((a, p) => a + p.x, 0) / hp.length, y: hp.reduce((a, p) => a + p.y, 0) / hp.length };
  let up = hc ? { x: hc.x - chest.x, y: hc.y - chest.y } : { x: 0, y: -1 }; const ul = Math.hypot(up.x, up.y) || 1; up = { x: up.x / ul, y: up.y / ul };
  if (!hc || ul < sw * 0.25) hc = { x: chest.x + up.x * sw * 0.8, y: chest.y + up.y * sw * 0.8 };
  const hl = Math.hypot(hc.x - chest.x, hc.y - chest.y);
  let root, legs = ok(11) && ok(12), cut = null;
  if (legs) root = mid(P(11), P(12)); else {
    root = { x: chest.x - up.x * sw * 1.35, y: chest.y - up.y * sw * 1.35 };
    // 골반이 화면 밖이면: 가슴에서 화면 끝까지 보이는 만큼만 몸통 뼈를 써요
    if (root.x < 0 || root.y < 0 || root.x > W || root.y > H) { let t = 1; if (root.y > H) t = Math.min(t, (H - 2 - chest.y) / (root.y - chest.y)); if (root.y < 0) t = Math.min(t, (2 - chest.y) / (root.y - chest.y)); if (root.x > W) t = Math.min(t, (W - 2 - chest.x) / (root.x - chest.x)); if (root.x < 0) t = Math.min(t, (2 - chest.x) / (root.x - chest.x)); t = clamp(t, 0, 1); cut = t > 0.75 ? null : t > 0.45 ? 'waist' : t > 0.16 ? 'spine' : 'chest'; root = mid(chest, root, t); }
  }
  root = cl(root);
  if (!cut && Math.hypot(root.x - chest.x, root.y - chest.y) < sw * 0.35) { root = cl({ x: chest.x - up.x * sw * 1.2, y: chest.y - up.y * sw * 1.2 }); legs = false; }
  J.root = root; J.waist = mid(root, chest, 0.2); J.spine = mid(root, chest, 0.58); J.chest = chest;
  if (cut === 'waist') { J.waist = root; J.spine = mid(root, chest, 0.5); } else if (cut === 'spine') { J.waist = root; J.spine = root; }
  J.neck = mid(chest, hc, 0.38); J.head = cl({ x: hc.x + up.x * hl * 0.75, y: hc.y + up.y * hl * 0.75 });
  const limb = (pre, i0, i1, i2, tip) => {
    const a = pre + (i0 === 5 || i0 === 6 ? 'Sho' : 'Hip'), b = pre + (i0 < 7 ? 'Elb' : 'Knee'), c = pre + (i0 < 7 ? 'Wri' : 'Ank'), e = pre + (i0 < 7 ? 'Hand' : 'Toe');
    J[a] = ok(i0) ? P(i0) : null; if (!J[a]) return;
    if (!ok(i1)) { J[b] = { ...mid(J[a], J[a]), on: false }; return; }
    // 다리 뿌리가 화면 끝에 딱 붙어 있으면 다리는 안 보이는 것 → 꺼 둬요
    if (i0 >= 11 && (J[a].y > H * 0.95 || J[a].y < H * 0.05 || J[a].x > W * 0.97 || J[a].x < W * 0.03) && Math.hypot(K[i1][0] - J[a].x, K[i1][1] - J[a].y) < sw * 0.8) { J[b] = { ...P(i1), on: false }; return; }
    J[b] = P(i1);
    if (!ok(i2)) { J[c] = { x: J[b].x * 2 - J[a].x, y: J[b].y * 2 - J[a].y, on: false }; return; }
    J[c] = P(i2); const t = tip(); J[e] = cl(t || { x: J[c].x + (J[c].x - J[b].x) * 0.32, y: J[c].y + (J[c].y - J[b].y) * 0.32 });
  };
  const hand = o => () => { const ids = [5, 9, 13, 17, 8, 12, 16].map(i => o + i).filter(ok); if (ids.length < 3) return null; const p = ids.map(P); return { x: p.reduce((a, q) => a + q.x, 0) / p.length, y: p.reduce((a, q) => a + q.y, 0) / p.length }; };
  const toe = (a, b) => () => ok(a) && ok(b) ? mid(P(a), P(b)) : ok(a) ? P(a) : null;
  limb('a', 5, 7, 9, hand(91)); limb('b', 6, 8, 10, hand(112));
  if (legs) { limb('a', 11, 13, 15, toe(17, 18)); limb('b', 12, 14, 16, toe(20, 21)); }
  const joints = {}; let conf = 0, cn = 0;
  for (const id of RG_STD) {
    const p = J[id];
    if (p) joints[id] = { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H), on: p.on !== false };
    else { const pa = joints[rgPar(id)] || chest; joints[id] = { x: clamp(pa.x + (id[0] === 'a' ? 1 : -1) * sw * 0.25, 0, W), y: clamp(pa.y + sw * 0.6, 0, H), on: false }; }
  }
  for (const i of [5, 6, 7, 8, 9, 10, 11, 12]) { conf += K[i] ? clamp(K[i][2], 0, 1) : 0; cn++; }
  return { joints, conf: conf / cn, auto: true, cut };
}
// AI가 못 찾았을 때: 캐릭터 상자에 맞춘 기본 뼈대 (사용자가 끌어서 맞춰요)
function rgSkeletonGuess(W, H, box) {
  const b = box || { x: W * 0.2, y: H * 0.05, w: W * 0.6, h: H * 0.9 }, X = u => clamp(b.x + b.w * u, 2, W - 2), Y = v => clamp(b.y + b.h * v, 2, H - 2), tall = b.h > b.w * 1.5;
  const T = tall ? { head: [.5, .02], neck: [.5, .16], chest: [.5, .22], spine: [.5, .34], waist: [.5, .43], root: [.5, .47], aSho: [.66, .22], aElb: [.72, .36], aWri: [.76, .48], aHand: [.77, .53], bSho: [.34, .22], bElb: [.28, .36], bWri: [.24, .48], bHand: [.23, .53], aHip: [.58, .49], aKnee: [.59, .72], aAnk: [.6, .93], aToe: [.63, .98], bHip: [.42, .49], bKnee: [.41, .72], bAnk: [.4, .93], bToe: [.37, .98] }
    : { head: [.5, .04], neck: [.5, .36], chest: [.5, .48], spine: [.5, .7], waist: [.5, .88], root: [.5, .96], aSho: [.7, .5], aElb: [.8, .72], aWri: [.84, .9], aHand: [.85, .96], bSho: [.3, .5], bElb: [.2, .72], bWri: [.16, .9], bHand: [.15, .96], aHip: [.6, .97], aKnee: [.6, .98], aAnk: [.6, .99], aToe: [.6, .99], bHip: [.4, .97], bKnee: [.4, .98], bAnk: [.4, .99], bToe: [.4, .99] };
  const joints = {}; for (const id of RG_STD) joints[id] = { x: X(T[id][0]), y: Y(T[id][1]), on: tall || !/Hip|Knee|Ank|Toe/.test(id) };
  return { joints, conf: 0, auto: false };
}

/* ---- 그물 + 관절 따라가기(가중치) ---- */
// 층(L.tex: 투명 바탕 위 그림)마다 바둑판 그물을 씌우고, 칸마다 '그림 안쪽으로 잰 거리'로 어느 관절을 얼마나 따라갈지 정해요
function rgHeapPush(h, d, v) { let i = h.n++; h.d[i] = d; h.v[i] = v; while (i > 0) { const p = (i - 1) >> 1; if (h.d[p] <= h.d[i]) break; const td = h.d[p], tv = h.v[p]; h.d[p] = h.d[i]; h.v[p] = h.v[i]; h.d[i] = td; h.v[i] = tv; i = p; } }
function rgHeapPop(h) { const d = h.d[0], v = h.v[0]; h.n--; if (h.n > 0) { h.d[0] = h.d[h.n]; h.v[0] = h.v[h.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < h.n && h.d[l] < h.d[m]) m = l; if (r < h.n && h.d[r] < h.d[m]) m = r; if (m === i) break; const td = h.d[m], tv = h.v[m]; h.d[m] = h.d[i]; h.v[m] = h.v[i]; h.d[i] = td; h.v[i] = tv; i = m; } } h.od = d; return v; }
function rgGeo(inC, gw, gh, seeds) { // 안쪽 칸(inC)만 지나가며 잰 거리 (칸 단위)
  const D = new Float32Array(gw * gh).fill(Infinity), h = { d: new Float32Array(gw * gh * 8 + 16), v: new Int32Array(gw * gh * 8 + 16), n: 0, od: 0 };
  for (const s of seeds) if (inC[s] && D[s] > 0) { D[s] = 0; rgHeapPush(h, 0, s); }
  while (h.n) {
    const c = rgHeapPop(h), d = h.od; if (d > D[c]) continue;
    const x = c % gw, y = (c / gw) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
      const k = yy * gw + xx; if (!inC[k]) continue;
      if (dx && dy && !(inC[y * gw + xx] || inC[yy * gw + x])) continue; // 모서리로만 닿은 곳은 못 지나가요
      const nd = d + (dx && dy ? 1.4142 : 1); if (nd < D[k]) { D[k] = nd; rgHeapPush(h, nd, k); }
    }
  }
  return D;
}
function rgAlpha(L, W, H) { // 층의 투명도 (0~255)
  if (L.A && L.A.length === W * H && L.Aof === L.tex) return L.A;
  const d = L.tex.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, A = new Uint8Array(W * H);
  for (let i = 0; i < A.length; i++) A[i] = d[i * 4 + 3];
  L.A = A; L.Aof = L.tex; return A;
}
// 화면 끝 붙잡기: 캐릭터가 화면 끝에 많이 닿아 있으면(얼굴 위주·몸 일부만 나온 그림) 끝이 벌어지지 않게 그 자리를 붙잡아요
function rgEdgeCells(rig, inC) {
  const { gw, gh } = rig, cs = []; let tot = 0;
  for (let x = 0; x < gw; x++) for (const y of [0, gh - 1]) { tot++; if (inC[y * gw + x]) cs.push(y * gw + x); }
  for (let y = 1; y < gh - 1; y++) for (const x of [0, gw - 1]) { tot++; if (inC[y * gw + x]) cs.push(y * gw + x); }
  const on = rig.edgePin === true || (rig.edgePin !== false && cs.length / tot >= 0.15);
  return on ? cs : [];
}
let rgFast = false; // 관절을 끄는 동안은 빠른 계산만
function rgBuildLayer(rig, L) {
  const { W, H } = rig, gw = rig.gw, gh = rig.gh, gx = W / gw, gy = H / gh, nC = gw * gh, A = rgAlpha(L, W, H);
  const inC = new Uint8Array(nC);
  for (let y = 0; y < H; y++) { const cy = Math.min(gh - 1, (y / gy) | 0), row = y * W; for (let x = 0; x < W; x++) if (A[row + x] > 40) inC[cy * gw + Math.min(gw - 1, (x / gx) | 0)] = 1; }
  const in2 = new Uint8Array(nC), near = new Int32Array(nC).fill(-1); // in2: 한 칸 넓힌 것(가장자리 반투명까지 그물에 넣기), near: 가장 가까운 안쪽 칸
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const c = y * gw + x; if (inC[c]) { in2[c] = 1; near[c] = c; continue; }
    for (let dy = -1; dy <= 1 && !in2[c]; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && inC[yy * gw + xx]) { in2[c] = 1; near[c] = yy * gw + xx; break; } }
  }
  // 가장자리까지 거리(칸): 굵기를 재는 데 써요
  const E = new Float32Array(nC);
  for (let i = 0; i < nC; i++) E[i] = inC[i] ? 1e9 : 0;
  const pass = (x0, x1, sx, y0, y1, sy) => { for (let y = y0; y !== y1; y += sy) for (let x = x0; x !== x1; x += sx) { const c = y * gw + x; if (!inC[c]) continue; let v = E[c]; const t = (xx, yy, w) => { const q = xx < 0 || yy < 0 || xx >= gw || yy >= gh ? 0 : E[yy * gw + xx]; if (q + w < v) v = q + w; }; t(x - sx, y, 1); t(x, y - sy, 1); t(x - sx, y - sy, 1.4142); t(x + sx, y - sy, 1.4142); E[c] = v; } };
  pass(0, gw, 1, 0, gh, 1); pass(gw - 1, -1, -1, gh - 1, -1, -1);
  const cellOf = (x, y) => clamp((y / gy) | 0, 0, gh - 1) * gw + clamp((x / gx) | 0, 0, gw - 1);
  const nearIn = (c, R) => { // 안쪽 칸이 아니면 둘레 R칸 안에서 가장 가까운 안쪽 칸
    if (inC[c]) return c; const x0 = c % gw, y0 = (c / gw) | 0; let best = -1, bd = 1e9;
    for (let y = Math.max(0, y0 - R); y <= Math.min(gh - 1, y0 + R); y++) for (let x = Math.max(0, x0 - R); x <= Math.min(gw - 1, x0 + R); x++) if (inC[y * gw + x]) { const d = (x - x0) * (x - x0) + (y - y0) * (y - y0); if (d < bd) { bd = d; best = y * gw + x; } }
    return best;
  };
  // 관절마다: 뼈(이 관절 → 자식 관절) 위의 칸에서 출발
  const owned = id => rig.layers.some(o => o !== L && !o.base && o.bind && o.bind.includes(id)); // 다른 부위가 가져간 관절
  const cand = (L.base ? RG_IDS.filter(id => id !== 'fix' && !owned(id)) : (L.bind || [])).filter(id => id !== 'fix' && rgOn(rig, id));
  const segsOf = id => { const p = rig.joints[id], ks = rgKids(rig, id); return ks.map(k => [p, rig.joints[k]]); };
  const js = [];
  for (const id of cand) {
    const segs = segsOf(id); if (!segs.length) continue;
    const seeds = new Set(); let tot = 0, hit = 0;
    for (const [a, b] of segs) { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (Math.min(gx, gy) * 0.5))); for (let i = 0; i <= n; i++) { const c = cellOf(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n), q = nearIn(c, 2); tot++; if (q >= 0) { seeds.add(q); hit++; } } }
    js.push({ id, segs, seeds: [...seeds], cover: tot ? hit / tot : 0 });
  }
  let use = js.filter(j => j.seeds.length && (L.base ? j.cover > 0.25 : true));
  const gmin = Math.min(gx, gy);
  for (const j of use) { const rs = j.seeds.map(s => E[s]).sort((a, b) => a - b); j.R = Math.max(1.5, rs.length ? rs[rs.length >> 1] : 2); if (rgChainOf(rig, j.id)) { const sl = j.segs.reduce((a, [p, q]) => a + Math.hypot(q.x - p.x, q.y - p.y), 0) / Math.max(1, j.segs.length) / gmin; j.R = Math.max(1.5, Math.min(j.R, sl * 0.16)); } }
  // 제자리에 고정된 내 뼈가 있으면: 그 뼈들에서 멀리 떨어진 몸(뼈 끝 너머는 빼고)은 'fix'를 따라 가만히 있어요
  if (L.base && use.length && use.some(j => rgChainOf(rig, j.id)) && rgFixUsed(rig)) {
    const fc = rig.chains.filter(c => rgPar(c.ids[0], rig) === 'fix' && use.some(j => c.ids.includes(j.id))), bones = [];
    for (const c of fc) for (let i = 0; i + 1 < c.ids.length; i++) if (rgOn(rig, c.ids[i + 1])) bones.push({ a: rig.joints[c.ids[i]], b: rig.joints[c.ids[i + 1]], len: c.ids.slice(1).reduce((q, id, n) => q + (rig.joints[id] ? Math.hypot(rig.joints[id].x - rig.joints[c.ids[n]].x, rig.joints[id].y - rig.joints[c.ids[n]].y) : 0), 0), first: i === 0, last: i + 2 === c.ids.length || !rgOn(rig, c.ids[i + 2]) });
    const std = use.filter(j => !rgChainOf(rig, j.id)), g = Math.min(gx, gy);
    const thick = (() => { const v = use.filter(j => rgChainOf(rig, j.id)).map(j => j.R).sort((a, b) => a - b); return Math.max(1.5, v.length ? v[v.length >> 1] : 2) * g; })();
    const seeds = [];
    for (let c = 0; c < nC; c++) {
      if (!inC[c]) continue; const px = (c % gw + 0.5) * gx, py = (((c / gw) | 0) + 0.5) * gy; let bd = 1e18, bb = null, bt = 0;
      for (const B of bones) { const r = rgSegDist(px, py, B.a, B.b); if (r.d < bd) { bd = r.d; bb = B; bt = r.t; } }
      if (!bb || bd < Math.max(thick * 3.2, Math.min(bb.len * 0.5, Math.max(W, H) * 0.2))) continue;
      if (bb.last && bt > 0.999 && bd < Math.hypot(bb.b.x - bb.a.x, bb.b.y - bb.a.y) * 1.5) continue; // 뼈 끝 너머(손·발 끝 등)는 뼈를 따라가요
      if (std.some(j => j.segs.some(([a, b]) => rgSegDist(px, py, a, b).d < thick * 2.5))) continue;
      seeds.push(c);
    }
    if (seeds.length) use.push({ id: 'fix', segs: [], seeds, cover: 1, R: thick / g });
  }
  if (!use.length && !(L.base && rig.stdOff)) { // 뼈가 하나도 안 지나가는 부위(리본·꼬리 등): 가장 가까운 관절에 붙여요 (붙은 자리에서 멀수록 살랑거려요)
    let cxs = 0, cys = 0, cn = 0; for (let c = 0; c < nC; c++) if (inC[c]) { cxs += (c % gw + 0.5) * gx; cys += (((c / gw) | 0) + 0.5) * gy; cn++; }
    const cx0 = cn ? cxs / cn : W / 2, cy0 = cn ? cys / cn : H / 2; let best = null, bd = 1e18;
    const pool = (L.follow && rgOn(rig, L.follow) && segsOf(L.follow).length ? [L.follow] : RG_IDS).filter(id => id !== 'fix' && rgOn(rig, id) && segsOf(id).length);
    for (const id of pool) for (const [a, b] of segsOf(id)) { const d = rgSegDist(cx0, cy0, a, b); if (d.d < bd) { bd = d.d; best = { id, px: d.x, py: d.y }; } }
    if (best && cn) { const q = nearIn(cellOf(best.px, best.py), Math.max(gw, gh)); use = [{ id: best.id, segs: segsOf(best.id), seeds: q >= 0 ? [q] : [], cover: 0, stuck: true }]; L.stuck = best.id; }
  } else L.stuck = null;
  const edgeC = L.base && use.length ? rgEdgeCells(rig, inC) : [];
  if (edgeC.length) use.push({ id: 'edge', segs: [], seeds: [], cover: 1, R: 2, noD: true });
  for (const j of use) {
    if (j.noD) { j.D = new Float32Array(nC).fill(Infinity); continue; }
    j.D = rgGeo(inC, gw, gh, j.seeds);
    if (j.R === undefined) { const rs = j.seeds.map(s => E[s]).sort((a, b) => a - b); j.R = Math.max(1.5, rs.length ? rs[rs.length >> 1] : 2); }
    if (j.stuck) j.R = Math.max(j.R, 2.5);
  }
  // 칸마다 가중치
  const nJ = use.length, Wt = new Float32Array(nC * nJ), rel = new Float32Array(nC).fill(1e9), far = new Float32Array(nC);
  for (let c = 0; c < nC; c++) {
    if (!inC[c]) continue; let sum = 0, any = false;
    for (let k = 0; k < nJ; k++) { const d = use[k].D[c]; if (d === Infinity) continue; any = true; const r = d / use[k].R; if (r < rel[c]) { rel[c] = r; far[c] = Math.max(0, d - use[k].R); } const w = 1 / Math.pow(0.18 + r, 4); Wt[c * nJ + k] = w; sum += w; }
    if (!any) { // 떨어진 조각: 그냥 직선 거리로
      const px = (c % gw + 0.5) * gx, py = (((c / gw) | 0) + 0.5) * gy;
      for (let k = 0; k < nJ; k++) { let d = 1e9; for (const [a, b] of use[k].segs) d = Math.min(d, rgSegDist(px, py, a, b).d); const r = d / Math.min(gx, gy) / use[k].R; if (r < rel[c]) { rel[c] = r; far[c] = Math.max(0, d / Math.min(gx, gy) - use[k].R); } const w = 1 / Math.pow(0.18 + r, 4); Wt[c * nJ + k] = w; sum += w; }
    }
    if (sum > 0) for (let k = 0; k < nJ; k++) Wt[c * nJ + k] /= sum;
  }
  // 이웃끼리 조금 섞어 매끈하게
  if (nJ > 1) for (let it = 0; it < 3; it++) {
    const N = Wt.slice();
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const c = y * gw + x; if (!inC[c]) continue;
      for (let k = 0; k < nJ; k++) { let s = N[c * nJ + k] * 2, n = 2; if (x > 0 && inC[c - 1]) { s += N[(c - 1) * nJ + k]; n++; } if (x < gw - 1 && inC[c + 1]) { s += N[(c + 1) * nJ + k]; n++; } if (y > 0 && inC[c - gw]) { s += N[(c - gw) * nJ + k]; n++; } if (y < gh - 1 && inC[c + gw]) { s += N[(c + gw) * nJ + k]; n++; } Wt[c * nJ + k] = s / n; }
    }
  }
  // 부드럽게 잇기: 뼈 가까운 곳(심)은 뼈를 그대로 따르고, 심과 심 사이는 고무판처럼 고르게 이어요 → 크게 움직여도 찢어지지 않아요
  const edgeW = new Float32Array(nC);
  if (nJ > 1 && !rgFast) {
    const core = new Int16Array(nC).fill(-1), kF = use.findIndex(j => j.id === 'fix'), kE = use.findIndex(j => j.id === 'edge');
    for (let c = 0; c < nC; c++) { if (!inC[c]) continue; let bk = -1, bw = 0.92; for (let k = 0; k < nJ; k++) if (k !== kF && k !== kE && Wt[c * nJ + k] > bw) { bw = Wt[c * nJ + k]; bk = k; } core[c] = bk; }
    if (kF >= 0) for (const c of use[kF].seeds) core[c] = kF;
    if (kE >= 0) { // 화면 끝 둘레는 다른 심을 풀어 줘서 뚝 끊기지 않게
      const N = Math.max(4, Math.round(Math.max(gw, gh) * 0.07)), near2 = new Uint8Array(nC);
      for (const c of edgeC) { const x0 = c % gw, y0 = (c / gw) | 0; for (let y = Math.max(0, y0 - N); y <= Math.min(gh - 1, y0 + N); y++) for (let x = Math.max(0, x0 - N); x <= Math.min(gw - 1, x0 + N); x++) near2[y * gw + x] = 1; }
      for (let c = 0; c < nC; c++) if (near2[c] && core[c] >= 0) core[c] = -1;
      for (const c of edgeC) core[c] = kE;
    }
    const free = []; for (let c = 0; c < nC; c++) { if (!inC[c]) continue; const k0 = core[c]; if (k0 < 0) { free.push(c); continue; } for (let k = 0; k < nJ; k++) Wt[c * nJ + k] = k === k0 ? 1 : 0; }
    const nb = new Int32Array(free.length * 4).fill(-1);
    free.forEach((c, i) => { const x = c % gw, y = (c / gw) | 0; let n = 0; if (x > 0 && inC[c - 1]) nb[i * 4 + n++] = c - 1; if (x < gw - 1 && inC[c + 1]) nb[i * 4 + n++] = c + 1; if (y > 0 && inC[c - gw]) nb[i * 4 + n++] = c - gw; if (y < gh - 1 && inC[c + gw]) nb[i * 4 + n++] = c + gw; });
    const om = 1.86, nF = free.length;
    for (let it = 0; it < 260; it++) {
      for (let q = 0; q < nF; q++) { const i = it & 1 ? nF - 1 - q : q, c = free[i], a = nb[i * 4], b = nb[i * 4 + 1], d = nb[i * 4 + 2], e = nb[i * 4 + 3]; if (a < 0) continue; const n = b < 0 ? 1 : d < 0 ? 2 : e < 0 ? 3 : 4, o = c * nJ;
        for (let k = 0; k < nJ; k++) { let v = Wt[a * nJ + k]; if (n > 1) v += Wt[b * nJ + k]; if (n > 2) v += Wt[d * nJ + k]; if (n > 3) v += Wt[e * nJ + k]; Wt[o + k] += om * (v / n - Wt[o + k]); } }
    }
    for (const c of free) { let sum = 0; for (let k = 0; k < nJ; k++) { const v = Wt[c * nJ + k] = Math.max(0, Wt[c * nJ + k]); sum += v; } if (sum > 0) for (let k = 0; k < nJ; k++) Wt[c * nJ + k] /= sum; }
    if (kE >= 0) for (let c = 0; c < nC; c++) if (inC[c]) edgeW[c] = Wt[c * nJ + kE];
  }
  // 꼭짓점·삼각형
  const vw = gw + 1, vid = new Int32Array(vw * (gh + 1)).fill(-1), VX = [], VY = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (in2[y * gw + x]) for (const [ax, ay] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const v = (y + ay) * vw + x + ax; if (vid[v] < 0) { vid[v] = VX.length; VX.push((x + ax) * gx); VY.push((y + ay) * gy); } }
  const nV = VX.length, V = new Float32Array(nV * 2), JI = new Uint8Array(nV * 4), JW = new Float32Array(nV * 4), loose = new Float32Array(nV), dist = new Float32Array(nV), tris = [], triJ = [];
  const acc = new Float32Array(nJ);
  for (let y = 0; y <= gh; y++) for (let x = 0; x <= gw; x++) {
    const i = vid[y * vw + x]; if (i < 0) continue; V[i * 2] = VX[i]; V[i * 2 + 1] = VY[i];
    acc.fill(0); let n = 0, rl = 0, fr = 0, ew = 0;
    for (const [ax, ay] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const xx = x + ax, yy = y + ay; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const c = near[yy * gw + xx]; if (c < 0) continue; for (let k = 0; k < nJ; k++) acc[k] += Wt[c * nJ + k]; rl += rel[c]; fr += far[c]; ew += edgeW[c]; n++; }
    if (!n) { JI[i * 4] = RG_IX.fix; JW[i * 4] = 1; continue; }
    const ord = [...acc.keys()].sort((a, b) => acc[b] - acc[a]).slice(0, 4); let s = 0; for (const k of ord) s += acc[k];
    for (let q = 0; q < 4; q++) { const k = ord[q]; if (k === undefined || !(acc[k] > 0)) { JI[i * 4 + q] = RG_IX.fix; JW[i * 4 + q] = 0; continue; } JI[i * 4 + q] = RG_IX[use[k].id]; JW[i * 4 + q] = s > 0 ? acc[k] / s : (q ? 0 : 1); }
    if (!(s > 0)) { JI[i * 4] = nJ ? RG_IX[use[0].id] : RG_IX.fix; JW[i * 4] = 1; }
    loose[i] = rgSmooth(1.25, 3.4, rl / n) * Math.max(0, 1 - 2.5 * ew / n); dist[i] = fr / n;
  }
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!in2[y * gw + x]) continue; const a = vid[y * vw + x], b = vid[y * vw + x + 1], c = vid[(y + 1) * vw + x], d = vid[(y + 1) * vw + x + 1];
    if ((x + y) & 1) tris.push(a, b, c, b, d, c); else tris.push(a, b, d, a, d, c);
    const cc = near[y * gw + x]; let bk = 0, bw = -1; for (let k = 0; k < nJ; k++) if (Wt[cc * nJ + k] > bw) { bw = Wt[cc * nJ + k]; bk = k; }
    const jid = nJ ? use[bk].id : 'fix'; triJ.push(jid, jid);
  }
  L.mesh = { relC: rel, nV, V, JI, JW, loose, dist, tris, triJ, inC, nearC: near, joints: use.map(j => j.id), out: new Float32Array(nV * 2), pinW: null, ver: rig.ver };
  rgSortTris(rig, L); rgPinWeights(rig, L);
  return L.mesh;
}
function rgSegDist(px, py, a, b) { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy, t = l2 ? clamp(((px - a.x) * vx + (py - a.y) * vy) / l2, 0, 1) : 0, x = a.x + vx * t, y = a.y + vy * t; return { d: Math.hypot(px - x, py - y), x, y, t }; }
// 삼각형 그리는 순서: 뒤에 있는 부위부터 (팔을 몸 앞에 둘지 뒤에 둘지)
function rgZ(rig, id) { if (id === 'fix') return 0; if (!RG_J[id]) { const c = rgChainOf(rig, id); return c ? (c.z === undefined ? 1.5 : c.z) : 0; } for (const [k, ids] of Object.entries(RG_LIMBS)) if (ids.includes(id) && rig.zs && rig.zs[k] !== undefined) return rig.zs[k]; return RG_J[id][2]; }
function rgSortTris(rig, L) {
  const m = L.mesh, n = m.triJ.length, ord = [...Array(n).keys()].sort((a, b) => rgZ(rig, m.triJ[a]) - rgZ(rig, m.triJ[b]) || a - b);
  const I = new (m.nV > 65535 ? Uint32Array : Uint16Array)(n * 3);
  for (let k = 0; k < n; k++) { const t = ord[k] * 3; I[k * 3] = m.tris[t]; I[k * 3 + 1] = m.tris[t + 1]; I[k * 3 + 2] = m.tris[t + 2]; }
  m.I = I; m.iVer = (m.iVer || 0) + 1;
}
// 핀: 손으로 끌어 움직이는 점. 핀에서 그림 안쪽으로 잰 거리가 반지름 안이면 따라와요
function rgPinWeights(rig, L) {
  const m = L.mesh; if (!m) return; const { W, H } = rig, gw = rig.gw, gh = rig.gh, gx = W / gw, gy = H / gh, g = Math.min(gx, gy); m.pinW = [];
  for (const p of rig.pins) {
    const c0 = clamp((p.y / gy) | 0, 0, gh - 1) * gw + clamp((p.x / gx) | 0, 0, gw - 1); let s = m.inC[c0] ? c0 : -1;
    if (s < 0) { let bd = 9; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = c0 % gw + dx, y = ((c0 / gw) | 0) + dy; if (x >= 0 && y >= 0 && x < gw && y < gh && m.inC[y * gw + x] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; s = y * gw + x; } } }
    if (s < 0) { m.pinW.push(null); continue; }
    const D = rgGeo(m.inC, gw, gh, [s]), R = Math.max(1.5, p.r / g), idx = [], wt = [], vw = gw + 1;
    for (let i = 0; i < m.nV; i++) {
      const vx = Math.round(m.V[i * 2] / gx), vy = Math.round(m.V[i * 2 + 1] / gy); let d = Infinity;
      for (const [ax, ay] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { const xx = vx + ax, yy = vy + ay; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const c = m.nearC[yy * gw + xx]; if (c >= 0 && D[c] < d) d = D[c]; }
      if (d < R) { const t = 1 - d / R; idx.push(i); wt.push(t * t * (3 - 2 * t)); }
    }
    m.pinW.push({ idx: Int32Array.from(idx), wt: Float32Array.from(wt) });
  }
}

/* ---- 자세: 관절마다 돌리기(r)·밀기(d)·크기(s), 전체 옮기기(tx, ty)·돌리기(rot)·크기(sc), 핀(pins), 눈 감기(blink) ---- */
const rgPose0 = () => ({ r: {}, d: {}, s: {}, tx: 0, ty: 0, rot: 0, sc: 1, pins: {}, blink: 0, mouth: 0 });
const rgPoseCopy = p => ({ r: { ...p.r }, d: Object.fromEntries(Object.entries(p.d).map(([k, v]) => [k, [v[0], v[1]]])), s: { ...p.s }, tx: p.tx, ty: p.ty, rot: p.rot, sc: p.sc, pins: Object.fromEntries(Object.entries(p.pins).map(([k, v]) => [k, [v[0], v[1]]])), blink: p.blink || 0, mouth: p.mouth || 0 });
function rgPoseMix(a, b, t) {
  const o = rgPose0(), L = (x, y) => x + (y - x) * t;
  for (const k of new Set([...Object.keys(a.r), ...Object.keys(b.r)])) o.r[k] = L(a.r[k] || 0, b.r[k] || 0);
  for (const k of new Set([...Object.keys(a.s), ...Object.keys(b.s)])) o.s[k] = L(a.s[k] || 1, b.s[k] || 1);
  for (const k of new Set([...Object.keys(a.d), ...Object.keys(b.d)])) { const p = a.d[k] || [0, 0], q = b.d[k] || [0, 0]; o.d[k] = [L(p[0], q[0]), L(p[1], q[1])]; }
  for (const k of new Set([...Object.keys(a.pins), ...Object.keys(b.pins)])) { const p = a.pins[k] || [0, 0], q = b.pins[k] || [0, 0]; o.pins[k] = [L(p[0], q[0]), L(p[1], q[1])]; }
  o.tx = L(a.tx, b.tx); o.ty = L(a.ty, b.ty); o.rot = L(a.rot, b.rot); o.sc = L(a.sc, b.sc); o.blink = L(a.blink || 0, b.blink || 0); o.mouth = L(a.mouth || 0, b.mouth || 0);
  return o;
}
const rgEase = (e, t) => e === 'linear' ? t : e === 'hold' ? 0 : e === 'in' ? t * t : e === 'out' ? 1 - (1 - t) * (1 - t) : t * t * (3 - 2 * t);
// 시간 막대에 저장한 자세만 (자동 움직임 빼고)
function rgKeyPose(rig, t) {
  const A = rig.anim, ks = A.keys; if (!ks.length) return rgPose0();
  if (A.loop && ks.length > 1) t = ((t % A.dur) + A.dur) % A.dur; else t = clamp(t, 0, A.dur);
  if (t <= ks[0].t) return A.loop && ks.length > 1 && ks[0].t > 0 ? rgPoseMix(ks[ks.length - 1].p, ks[0].p, rgEase(ks[ks.length - 1].e, (t + A.dur - ks[ks.length - 1].t) / Math.max(1e-6, ks[0].t + A.dur - ks[ks.length - 1].t))) : rgPoseCopy(ks[0].p);
  for (let i = 0; i < ks.length - 1; i++) if (t < ks[i + 1].t) return rgPoseMix(ks[i].p, ks[i + 1].p, rgEase(ks[i].e, (t - ks[i].t) / Math.max(1e-6, ks[i + 1].t - ks[i].t)));
  const l = ks[ks.length - 1];
  if (A.loop && ks.length > 1 && l.t < A.dur) return rgPoseMix(l.p, ks[0].p, rgEase(l.e, (t - l.t) / Math.max(1e-6, A.dur + ks[0].t - l.t)));
  return rgPoseCopy(l.p);
}
const rgHash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// 움직임 크기의 기준: 몸통 길이. 기본 뼈대를 끈 캐릭터는 내 뼈 길이(없으면 그림 크기)로
function rgUnit(rig) {
  if (!rig.stdOff) return Math.max(20, Math.hypot(rig.joints.chest.x - rig.joints.root.x, rig.joints.chest.y - rig.joints.root.y));
  let L = 0; for (const c of rig.chains || []) { let l = 0; for (let i = 1; i < c.ids.length; i++) { const a = rig.joints[c.ids[i - 1]], b = rig.joints[c.ids[i]]; if (a && b) l += Math.hypot(b.x - a.x, b.y - a.y); } L = Math.max(L, l); }
  return Math.max(20, L ? L * 0.6 : Math.max(rig.W, rig.H) * 0.15);
}
// 자동 움직임의 빠르기: 반복 재생이면 길이 안에 딱 떨어지게
function rgOmega(rig, period) { const A = rig.anim, sp = (A.auto.speed || 100) / 100, P = period / sp; return A.loop ? 2 * Math.PI * Math.max(1, Math.round(A.dur / P)) / A.dur : 2 * Math.PI / P; }
function rgBlinkAuto(rig, t) { // 0~1 (1 = 감음)
  const A = rig.anim, f = A.auto.blink || 0; if (!f) return 0;
  const P = 6.5 - 5 * f / 100, n = Math.max(1, Math.round(A.dur / P)), shape = x => x < 0 ? 0 : x < 0.07 ? x / 0.07 : x < 0.11 ? 1 : x < 0.26 ? 1 - (x - 0.11) / 0.15 : 0;
  let v = 0;
  if (A.loop) { const tt = ((t % A.dur) + A.dur) % A.dur; for (let k = 0; k < n; k++) { const tk = Math.min(A.dur - 0.3, A.dur * (k + 0.45 + 0.3 * (rgHash(k + 1) - 0.5)) / n); v = Math.max(v, shape(tt - tk)); } }
  else { const k = Math.floor(t / P); for (const q of [k - 1, k]) if (q >= 0) v = Math.max(v, shape(t - (q + 0.45 + 0.3 * (rgHash(q + 1) - 0.5)) * P)); }
  return v;
}
// 내 뼈 자동 움직임의 종류: 이름, 한 번 오가는 시간(초)
const RG_AM = { sway: { name: '흔들기', per: 2.2 }, wave: { name: '물결', per: 1.8 }, bend: { name: '굽혔다 펴기', per: 2.4 }, pump: { name: '앞뒤로', per: 1.2 }, shake: { name: '떨림', per: 0.22 } };
// 자동 움직임 한 번에 맞추기
const RG_STYLES = { calm: ['잔잔하게', { breath: 40, sway: 15, head: 15, bounce: 0, wind: 25, follow: 40, arms: 10, hip: 0, shake: 0, jig: 15, speed: 80 }, 22], live: ['살아 있게', { breath: 60, sway: 40, head: 40, bounce: 0, wind: 50, follow: 60, arms: 35, hip: 15, shake: 0, jig: 40, speed: 100 }, 40], active: ['활발하게', { breath: 70, sway: 70, head: 60, bounce: 25, wind: 70, follow: 80, arms: 65, hip: 45, shake: 0, jig: 60, speed: 130 }, 62], hard: ['거칠게', { breath: 100, sway: 55, head: 45, bounce: 0, wind: 60, follow: 90, arms: 40, hip: 60, shake: 40, jig: 80, speed: 170 }, 85] };
// 그 시각의 자세 = 저장한 자세 + 자동 움직임(숨쉬기·몸 흔들기·고개)
function rgPoseAt(rig, t, noAuto) {
  const p = rgKeyPose(rig, t); if (noAuto) return p;
  const a = rig.anim.auto, U = rgUnit(rig), add = (id, v) => { p.r[id] = (p.r[id] || 0) + v; }, mv = (id, x, y) => { const q = p.d[id] || [0, 0]; p.d[id] = [q[0] + x, q[1] + y]; };
  if (a.breath) { const w = rgOmega(rig, 3.4), k = (0.5 - 0.5 * Math.cos(w * t)) * U * 0.02 * a.breath / 50; mv('chest', 0, -k); mv('aSho', 0, -k * 0.35); mv('bSho', 0, -k * 0.35); p.s.chest = (p.s.chest || 1) * (1 + 0.012 * a.breath / 50 * (0.5 - 0.5 * Math.cos(w * t))); }
  if (a.sway) { const w = rgOmega(rig, 4.6), k = 0.028 * a.sway / 50; add('waist', k * Math.sin(w * t)); add('neck', -k * 0.7 * Math.sin(w * t - 0.5)); mv(rgBase(rig), U * 0.012 * a.sway / 50 * Math.sin(w * t), 0); }
  if (a.head) { const w = rgOmega(rig, 5.4), k = 0.05 * a.head / 50; add('neck', k * Math.sin(w * t + 1.1)); mv('head', 0, U * 0.006 * a.head / 50 * Math.sin(2 * w * t)); }
  if (a.arms) { const w = rgOmega(rig, 3.8), k = 0.045 * a.arms / 50; add('aSho', k * Math.sin(w * t + 0.4)); add('aElb', k * 0.8 * Math.sin(w * t - 0.5)); add('bSho', -k * Math.sin(w * t + 1.3)); add('bElb', -k * 0.8 * Math.sin(w * t + 0.4)); add('aWri', k * 0.6 * Math.sin(w * t - 1.2)); add('bWri', -k * 0.6 * Math.sin(w * t - 0.3)); }
  if (a.hip) { const w = rgOmega(rig, 2.4), k = a.hip / 50, sn = Math.sin(w * t); mv(rgBase(rig), U * 0.03 * k * sn, -U * 0.008 * k * Math.cos(2 * w * t)); add(rgBase(rig), 0.03 * k * sn); add('waist', -0.045 * k * Math.sin(w * t - 0.35)); add('neck', 0.012 * k * Math.sin(w * t - 0.9)); }
  if (a.shake) { const w = rgOmega(rig, 0.13), w2 = rgOmega(rig, 0.19), k = U * 0.004 * a.shake / 50, env = 0.65 + 0.35 * Math.sin(rgOmega(rig, 1.7) * t); p.tx += k * env * Math.sin(w * t); p.ty += k * 0.7 * env * Math.sin(w2 * t + 1); add('neck', 0.004 * a.shake / 50 * env * Math.sin(w2 * t)); }
  for (const c of rig.chains || []) { // 내 뼈마다 넣은 자동 움직임 (뿌리에서 끝으로 물결처럼 늦게)
    const m = c.am; if (!m || !m.kind || !m.amt || !RG_AM[m.kind]) continue; const ids = c.ids.filter(id => rgOn(rig, id) && rig.joints[id]); if (ids.length < 2) continue;
    const k = m.amt / 50 * (m.rev ? -1 : 1), w = rgOmega(rig, RG_AM[m.kind].per * 100 / (m.sp || 100)), ph = (m.ph || 0) / 100 * 2 * Math.PI, n = ids.length - 1, x = w * t - ph;
    if (m.kind === 'sway') for (let i = 0; i < n; i++) add(ids[i], 0.1 * k * (i ? 1 : 0.7) / (1 + i * 0.2) * Math.sin(x - i * 0.7));
    else if (m.kind === 'wave') for (let i = 0; i < n; i++) add(ids[i], 0.075 * k * (0.5 + i * 0.5) * Math.sin(x - i * 1.3));
    else if (m.kind === 'bend') for (let i = 0; i < n; i++) add(ids[i], 0.2 * k * (i ? 1 : 0.5) * (0.5 - 0.5 * Math.cos(x - i * 0.25)));
    else if (m.kind === 'pump') { const a0 = rig.joints[ids[0]], b0 = rig.joints[ids[n]], l = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1, sn = Math.sin(x), e = Math.sign(sn) * Math.pow(Math.abs(sn), 0.8) * 0.07 * k * l; mv(ids[0], (b0.x - a0.x) / l * e, (b0.y - a0.y) / l * e); for (let i = 1; i < n; i++) add(ids[i], 0.03 * k * Math.sin(x - 0.9 - i * 0.5)); }
    else if (m.kind === 'shake') { const s1 = Math.sin(x), s2 = Math.sin(1.47 * x + 1); add(ids[0], 0.02 * k * s1); for (let i = 1; i < n; i++) add(ids[i], 0.028 * k * Math.sin(x - i * 1.1) * (0.7 + 0.3 * s2)); }
  }
  if (a.bounce) { const w = rgOmega(rig, 1.1), k = U * 0.03 * a.bounce / 50; p.ty -= k * Math.abs(Math.sin(w * t / 2)); }
  p.blink = Math.max(p.blink || 0, rgBlinkAuto(rig, t));
  if (a.talk) { const A = rig.anim, f = A.loop ? Math.max(1, Math.round(4.6 * A.dur * (a.speed || 100) / 100)) / A.dur : 4.6 * (a.speed || 100) / 100, on = rgHash(Math.floor(t * 1.7) + 7) > 0.22 ? 1 : 0.12, w = Math.pow(Math.abs(Math.sin(Math.PI * f * t)), 0.8) * (0.55 + 0.45 * rgHash(Math.floor(f * t) + 3)); p.mouth = clamp((p.mouth || 0) + w * on * a.talk / 100, -1, 1); }
  return p;
}
/* ---- 관절 행렬 [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f ---- */
const rgMul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
const rgRS = (px, py, r, s) => { const c = Math.cos(r) * s, n = Math.sin(r) * s; return [c, n, -n, c, px - c * px + n * py, py - n * px - c * py]; };
function rgMats(rig, p) { // → { M: 관절마다 행렬, P: 관절의 지금 자리 }
  const J = rig.joints, M = {}, P = {}, R = J.root;
  const G = rgMul([1, 0, 0, 1, p.tx, p.ty], rgRS(R.x, R.y, p.rot, p.sc));
  M.fix = G; // 내 뼈가 없는 나머지 몸: 전체 옮기기만
  const one = id => {
    if (!rgOn(rig, id)) return; const par = rgPar(id, rig), B = par ? M[par] : G, j = J[id], d = p.d[id]; if (!B || !j) return;
    const T = d ? rgMul(B, [1, 0, 0, 1, d[0], d[1]]) : B;
    M[id] = rgMul(T, rgRS(j.x, j.y, p.r[id] || 0, p.s[id] || 1));
    P[id] = { x: T[0] * j.x + T[2] * j.y + T[4], y: T[1] * j.x + T[3] * j.y + T[5] };
  };
  if (!rig.stdOff) for (const id of RG_STD) one(id);
  for (const c of rig.chains || []) for (const id of c.ids) one(id); // 사슬 차례대로라 부모가 늘 먼저예요
  return { M, P };
}
// 그물 꼭짓점을 지금 자세로 옮기기. lagMs: 뒤따라오는 정도가 다른 자세들(늘어진 머리카락·옷자락이 조금 늦게 따라와요)
function rgSkin(rig, L, t, pose, lagMs, still) {
  const m = L.mesh, n = m.nV, V = m.V, O = m.out, a = rig.anim.auto, U = rgUnit(rig);
  const toF = Ms => { const f = new Float32Array(RG_IDS.length * 6); for (let i = 0; i < RG_IDS.length; i++) { const q = Ms[RG_IDS[i]]; if (q) for (let k = 0; k < 6; k++) f[i * 6 + k] = q[k]; else { f[i * 6] = 1; f[i * 6 + 3] = 1; } } return f; };
  const F = toF(lagMs[0].M), F2 = lagMs.length > 1 ? lagMs.slice(1).map(l => toF(l.M)) : null;
  // 핀·살랑임은 원래 자리에서 먼저 더해요
  const dx = m.dx || (m.dx = new Float32Array(n)), dy = m.dy || (m.dy = new Float32Array(n)); dx.fill(0); dy.fill(0);
  const pinAdd = (po, X, Y) => { for (let k = 0; k < rig.pins.length; k++) { const pw = m.pinW && m.pinW[k], v = po.pins[rig.pins[k].id]; if (!pw || !v || (!v[0] && !v[1])) continue; for (let q = 0; q < pw.idx.length; q++) { X[pw.idx[q]] += v[0] * pw.wt[q]; Y[pw.idx[q]] += v[1] * pw.wt[q]; } } };
  pinAdd(pose, dx, dy);
  if (a.wind && !still) {
    const w = rgOmega(rig, 2.6), A = U * 0.05 * a.wind / 50, g = Math.min(rig.W / rig.gw, rig.H / rig.gh);
    for (let i = 0; i < n; i++) { const s = m.loose[i]; if (!s) continue; const ph = m.dist[i] * 0.33 + V[i * 2 + 1] / (U * 2.2), k = A * Math.pow(s, 1.2) * Math.min(1, m.dist[i] * g / (U * 0.5) + 0.25); dx[i] += k * Math.sin(w * t - ph); dy[i] += k * 0.22 * Math.sin(2 * w * t - ph * 1.3 + 0.8); }
  }
  const fol = a.follow || 0, jig = still ? 0 : (a.jig || 0) / 50 * 9;
  const at2 = (Fk, i, x, y) => { let ax = 0, ay = 0; for (let q = 0; q < 4; q++) { const w = m.JW[i * 4 + q]; if (!w) continue; const o = m.JI[i * 4 + q] * 6; ax += w * (Fk[o] * x + Fk[o + 2] * y + Fk[o + 4]); ay += w * (Fk[o + 1] * x + Fk[o + 3] * y + Fk[o + 5]); } return [ax, ay]; };
  for (let i = 0; i < n; i++) {
    const x = V[i * 2] + dx[i], y = V[i * 2 + 1] + dy[i]; let ox = 0, oy = 0;
    for (let q = 0; q < 4; q++) { const w = m.JW[i * 4 + q]; if (!w) continue; const o = m.JI[i * 4 + q] * 6; ox += w * (F[o] * x + F[o + 2] * y + F[o + 4]); oy += w * (F[o + 1] * x + F[o + 3] * y + F[o + 5]); }
    if (F2 && m.loose[i] > 0.02) { // 늦게 따라오기: 멀리 늘어진 곳일수록 더 예전 자세를 따라가요
      let jx = 0, jy = 0;
      if (jig && F2.length > 1) { const c1 = at2(F2[0], i, x, y), c2 = at2(F2[1], i, x, y), lim = U * 0.09 * m.loose[i]; jx = clamp(-jig * m.loose[i] * (ox - 2 * c1[0] + c2[0]), -lim, lim); jy = clamp(-jig * m.loose[i] * (oy - 2 * c1[1] + c2[1]), -lim, lim); }
      if (fol) {
      const lv = m.loose[i] * F2.length, k0 = Math.min(F2.length - 1, Math.floor(lv)), tt = lv - k0;
      const at = (Fk) => { let ax = 0, ay = 0; for (let q = 0; q < 4; q++) { const w = m.JW[i * 4 + q]; if (!w) continue; const o = m.JI[i * 4 + q] * 6; ax += w * (Fk[o] * x + Fk[o + 2] * y + Fk[o + 4]); ay += w * (Fk[o + 1] * x + Fk[o + 3] * y + Fk[o + 5]); } return [ax, ay]; };
      const A0 = k0 === 0 ? [ox, oy] : at(F2[k0 - 1]), A1 = at(F2[k0]); ox = A0[0] + (A1[0] - A0[0]) * tt; oy = A0[1] + (A1[1] - A0[1]) * tt;
      }
      ox += jx; oy += jy;
    }
    O[i * 2] = ox; O[i * 2 + 1] = oy;
  }
  return O;
}
// 한 시각의 모든 것: 자세, 행렬, 뒤따라오기용 예전 행렬
function rgEval(rig, t, fixedPose) {
  const pose = fixedPose || rgPoseAt(rig, t), cur = rgMats(rig, pose), lags = [{ M: cur.M, pose }], f0 = rig.anim.auto.follow || 0, f = f0 || (rig.anim.auto.jig ? 50 : 0);
  if (f && !fixedPose) for (let k = 1; k <= 3; k++) { const tp = t - k * 0.07 * Math.max(f, 25) / 50, ok = rig.anim.loop || tp >= 0, p2 = rgPoseAt(rig, ok ? tp : 0); lags.push({ M: rgMats(rig, p2).M, pose: p2 }); }
  return { pose, M: cur.M, P: cur.P, lags };
}
// 끝 관절(손목·발목)을 목표로: 가운데 관절(팔꿈치·무릎)이 알아서 굽어요
function rgIK(rig, pose, a, b, c, tx, ty) {
  let m = rgMats(rig, pose); const A = m.P[a], B = m.P[b], C = m.P[c]; if (!A || !B || !C) return;
  const la = Math.hypot(B.x - A.x, B.y - A.y), lb = Math.hypot(C.x - B.x, C.y - B.y); if (la < 1 || lb < 1) return;
  const d = clamp(Math.hypot(tx - A.x, ty - A.y), Math.abs(la - lb) + 0.01, la + lb - 0.01), th = Math.atan2(ty - A.y, tx - A.x);
  const al = Math.acos(clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1)), side = Math.sign((C.x - A.x) * (B.y - A.y) - (C.y - A.y) * (B.x - A.x)) || 1;
  pose.r[a] = (pose.r[a] || 0) + rgAngDiff(th + side * al, Math.atan2(B.y - A.y, B.x - A.x));
  m = rgMats(rig, pose); const B2 = m.P[b], C2 = m.P[c];
  pose.r[b] = (pose.r[b] || 0) + rgAngDiff(Math.atan2(ty - B2.y, tx - B2.x), Math.atan2(C2.y - B2.y, C2.x - B2.x));
}
const rgAngDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/* ---- 그리기 (WebGL): 배경 한 장 + 층마다 그물 ---- */
function rgGLNew(cv) {
  const opt = { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true };
  let gl = cv.getContext('webgl2', opt), v2 = !!gl; if (!gl) gl = cv.getContext('webgl', opt); if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader ' + gl.getShaderInfoLog(s)); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 a_pos; attribute vec2 a_uv; uniform vec4 u_view; varying vec2 v_uv; void main(){ v_uv = a_uv; gl_Position = vec4(a_pos.x * u_view.x + u_view.z, a_pos.y * u_view.y + u_view.w, 0.0, 1.0); }'));
  // 눈 감기: 눈 상자 위쪽 살(눈꺼풀 자리)을 아래로 늘이고, 속눈썹 줄은 그대로 내려요
  // 입 벌리기: 입 상자를 위쪽은 그대로 두고 아래로 늘여요(가운데가 가장 많이). 다문 입(선)은 늘어난 안쪽을 입속 색으로 칠해요. 턱 쪽은 그만큼 눌러요
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, `precision highp float; uniform sampler2D u_tex; uniform vec4 u_eye0; uniform vec4 u_eye1; uniform vec2 u_blink; uniform vec4 u_mouth; uniform vec4 u_mo; uniform vec3 u_mcol; uniform float u_op; varying vec2 v_uv;
    float tint;
    vec2 lid(vec2 uv, vec4 b, float c0){ float w = b.z - b.x, h = b.w - b.y; if (uv.x <= b.x - w * 0.08 || uv.x >= b.z + w * 0.08) return uv;
      float u = (uv.x - (b.x - w * 0.08)) / (w * 1.16), mx = smoothstep(0.0, 0.2, u) * smoothstep(0.0, 0.2, 1.0 - u), c = c0 * mx;
      float yT = b.y - h * 0.75, lidY = b.y + h * 0.26, band = h * 0.34, yc = mix(lidY, b.w - h * 0.1, c);
      if (uv.y > yT && uv.y < yc) { if (uv.y > yc - band) uv.y -= (yc - lidY); else uv.y = yT + (uv.y - yT) * ((lidY - band) - yT) / max(1e-5, (yc - band) - yT); }
      return uv; }
    vec2 mouth(vec2 uv, vec4 b){ float w = b.z - b.x, h = b.w - b.y, px = w * 0.1; if (uv.x <= b.x - px || uv.x >= b.z + px) return uv;
      float u = (uv.x - (b.x - px)) / (w + 2.0 * px), mx = sin(3.14159265 * clamp(u, 0.0, 1.0)); mx = pow(mx, 0.75);
      float d = u_mo.x * u_mo.z * mx, y0 = b.y, y1 = b.w, yb = max(y0 + h * 0.3, y1 + d), yE = y1 + u_mo.z * 2.4 + h;
      if (uv.y > y0 && uv.y < yb) { float q = (uv.y - y0) / (yb - y0); if (d > 0.0) tint = smoothstep(0.08, 0.3, q) * smoothstep(0.06, 0.26, 1.0 - q) * clamp(d / (u_mo.z * 0.3), 0.0, 1.0) * smoothstep(0.0, 0.25, mx); uv.y = y0 + q * (y1 - y0); }
      else if (uv.y >= yb && uv.y < yE) uv.y = y1 + (uv.y - yb) * (yE - y1) / (yE - yb);
      return uv; }
    void main(){ vec2 uv = v_uv; tint = 0.0; if (u_blink.x > 0.0) uv = lid(uv, u_eye0, u_blink.x); if (u_blink.y > 0.0) uv = lid(uv, u_eye1, u_blink.y); if (u_mo.x != 0.0) uv = mouth(uv, u_mouth);
      vec4 c = texture2D(u_tex, uv); if (tint > 0.0) c.rgb = mix(c.rgb, u_mcol * c.a, tint * u_mo.y); gl_FragColor = c * u_op; }`));
  gl.bindAttribLocation(pr, 0, 'a_pos'); gl.bindAttribLocation(pr, 1, 'a_uv'); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
  if (!v2) gl.getExtension('OES_element_index_uint');
  const U = n => gl.getUniformLocation(pr, n);
  return { gl, v2, pr, u: { view: U('u_view'), tex: U('u_tex'), eye0: U('u_eye0'), eye1: U('u_eye1'), blink: U('u_blink'), mouth: U('u_mouth'), mo: U('u_mo'), mcol: U('u_mcol'), op: U('u_op') }, tex: new Map(), buf: new Map(), quad: null };
}
function rgGLTex(R, cvs) { // 캔버스 → 텍스처 (한 번 올린 건 다시 안 올려요)
  const { gl } = R; let t = R.tex.get(cvs); if (t) return t;
  t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cvs);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (R.v2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  R.tex.set(cvs, t); return t;
}
function rgGLFree(R) { if (!R) return; const { gl } = R; for (const t of R.tex.values()) gl.deleteTexture(t); for (const b of R.buf.values()) { gl.deleteBuffer(b.pos); gl.deleteBuffer(b.uv); gl.deleteBuffer(b.idx); } R.tex.clear(); R.buf.clear(); const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); }
// view: {k(배율), ox, oy} 작업 그림 좌표 → 캔버스 픽셀. o: {bg: 'fill'|'color'|'none', color, evs(캐릭터마다 rgEval 결과), t, solo: {cid, id}}
function rgGLDraw(R, main, view, o) {
  const { gl } = R, cw = gl.canvas.width, ch = gl.canvas.height, W = main.W, H = main.H, chars = rgChars(main);
  gl.viewport(0, 0, cw, ch); gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  let cc = [0, 0, 0, 0]; if (o.bg === 'color') { const h = (o.color || '#ffffff').replace('#', ''); cc = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1]; }
  gl.clearColor(cc[0], cc[1], cc[2], cc[3]); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(R.pr); gl.uniform4f(R.u.view, 2 * view.k / cw, -2 * view.k / ch, 2 * view.ox / cw - 1, 1 - 2 * view.oy / ch); gl.uniform1i(R.u.tex, 0); gl.activeTexture(gl.TEXTURE0);
  gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
  gl.uniform2f(R.u.blink, 0, 0); gl.uniform4f(R.u.mo, 0, 0, 0, 0); gl.uniform1f(R.u.op, 1);
  if (o.bg === 'fill' && main.bg) {
    if (!R.quad) { R.quad = { pos: gl.createBuffer(), uv: gl.createBuffer() }; gl.bindBuffer(gl.ARRAY_BUFFER, R.quad.uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW); }
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, W, 0, 0, H, W, 0, W, H, 0, H]), gl.DYNAMIC_DRAW); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, R.quad.uv); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, rgGLTex(R, main.bg)); gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  for (const rig of [...chars].sort((a, b) => (a.cz || 0) - (b.cz || 0))) {
    const ev = o.evs[chars.indexOf(rig)]; if (!ev || rig.chide || (o.solo && o.solo.cid !== rig.cid)) continue;
    const bl = ev.pose.blink || 0, E = rig.eyes || [], eb = i => E[i] && E[i].on !== false ? [E[i].x / W, E[i].y / H, (E[i].x + E[i].w) / W, (E[i].y + E[i].h) / H] : [0, 0, 0, 0], Mo = rig.mouth && rig.mouth.on !== false ? rig.mouth : null, mo = Mo ? ev.pose.mouth || 0 : 0;
    gl.uniform4fv(R.u.eye0, eb(0)); gl.uniform4fv(R.u.eye1, eb(1)); gl.uniform2f(R.u.blink, E[0] && E[0].on !== false ? bl : 0, E[1] && E[1].on !== false ? bl : 0);
    if (Mo) { const col = Mo.col || [110, 40, 45]; gl.uniform4f(R.u.mouth, Mo.x / W, Mo.y / H, (Mo.x + Mo.w) / W, (Mo.y + Mo.h) / H); gl.uniform4f(R.u.mo, mo, Mo.type === 'open' ? 0 : 1, (mo < 0 ? Mo.h * 0.85 : Math.max(Mo.w * 0.42, Mo.h * 0.5)) / H, 0); gl.uniform3f(R.u.mcol, col[0] / 255, col[1] / 255, col[2] / 255); } else gl.uniform4f(R.u.mo, 0, 0, 0, 0);
    for (const L of [...rig.layers].sort((a, b) => (a.z || 0) - (b.z || 0))) {
      if (L.hide || (o.solo && o.solo.id !== L.id)) continue;
      if (!L.mesh || L.mesh.ver !== rig.ver) rgBuildLayer(rig, L);
      const m = L.mesh; if (!m.nV) continue; const bk = (rig.cid || '') + ':' + L.id; let b = R.buf.get(bk);
      if (!b) { b = { pos: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer() }; R.buf.set(bk, b); }
      if (b.of !== m) { const uv = new Float32Array(m.nV * 2); for (let i = 0; i < m.nV; i++) { uv[i * 2] = m.V[i * 2] / W; uv[i * 2 + 1] = m.V[i * 2 + 1] / H; } gl.bindBuffer(gl.ARRAY_BUFFER, b.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW); b.of = m; b.iVer = -1; }
      if (b.iVer !== m.iVer) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.I, gl.STATIC_DRAW); b.iVer = m.iVer; }
      const out = rgSkin(rig, L, o.t, ev.pose, ev.lags, ev.still);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.bufferData(gl.ARRAY_BUFFER, out, gl.DYNAMIC_DRAW); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.uv); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx); gl.bindTexture(gl.TEXTURE_2D, rgGLTex(R, L.tex)); gl.uniform1f(R.u.op, L.op === undefined ? 1 : L.op);
      gl.drawElements(gl.TRIANGLES, m.I.length, m.I instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }
  }
}

/* ---- 준비: 그림 → 캐릭터 층 + 메운 배경 + 뼈대 + 눈 ---- */
const rgNewAnim = () => ({ dur: 3, loop: true, keys: [{ t: 0, e: 'ease', p: rgPose0() }], auto: { breath: 50, sway: 30, head: 30, bounce: 0, wind: 40, follow: 50, arms: 20, hip: 0, shake: 0, jig: 30, blink: 50, talk: 0, speed: 100 } });
function rgBBox(A, W, H, thr) { let x0 = W, y0 = H, x1 = -1, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (A[y * W + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }; }
// 캐릭터 가장자리에 원래 배경색이 묻어나지 않게: 반투명한 테두리 색을 안쪽 색으로 바꿔요
function rgCutTex(px, A, W, H) {
  const n = W * H, solid = new Float32Array(n); for (let i = 0; i < n; i++) solid[i] = A[i] >= 250 ? 1 : 0;
  const q = dpNormBlur(px, solid, W, H, Math.max(1.5, Math.max(W, H) / 700)), c = newCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H), d = id.data;
  for (let i = 0; i < n; i++) { const j = i * 4, a = A[i]; if (!a) continue; const e = a < 250 && q[j + 3] > 10; d[j] = e ? q[j] : px[j]; d[j + 1] = e ? q[j + 1] : px[j + 1]; d[j + 2] = e ? q[j + 2] : px[j + 2]; d[j + 3] = a; }
  g.putImageData(id, 0, 0); return c;
}
// 구멍(hole 0~1)만 둘레에 맞게 메우기: 구멍 둘레만 잘라서 메우면 더 또렷해요
// ign(0~1): 메우지는 않지만 AI가 참고하면 안 되는 곳(떼어 낸 부위가 있던 자리, 엉터리로 메워진 배경 등)
async function rgFillRegion(px, hole, W, H, tk, ign) {
  const b = rgBBox(hole, W, H, 0.02); if (!b) return px;
  const pad = Math.max(24, Math.round(Math.max(b.w, b.h) * 0.45)), x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad), x1 = Math.min(W, b.x + b.w + pad), y1 = Math.min(H, b.y + b.h + pad), w = x1 - x0, h = y1 - y0;
  const sp = new Uint8ClampedArray(w * h * 4), sh = new Float32Array(w * h), own = new Float32Array(w * h); let known = 0;
  for (let y = 0; y < h; y++) { sp.set(px.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x1) * 4), y * w * 4); for (let x = 0; x < w; x++) { const i = (y + y0) * W + x + x0, v = hole[i]; own[y * w + x] = v; sh[y * w + x] = ign ? Math.max(v, ign[i]) : v; if (sh[y * w + x] < 0.5) known++; } }
  if (ign && known < w * h * 0.06) sh.set(own); // 참고할 곳이 거의 안 남으면 가리지 않고 메워요
  const r = await dpFill(sp, sh, w, h, tk), o = new Uint8ClampedArray(px);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = own[y * w + x]; if (a <= 0) continue; const q = (y * w + x) * 4, j = ((y + y0) * W + x + x0) * 4; for (let c = 0; c < 3; c++) o[j + c] = px[j + c] * (1 - a) + r.px[q + c] * a; }
  return o;
}
// 부위를 떼어 내서 새로 드러난 배경(R: 0~255)을 그 둘레의 진짜 배경만 보고 다시 메워요.
// (처음에 캐릭터 전체를 한꺼번에 지우고 메운 배경은 가운데로 갈수록 엉터리라서, 드러난 자리만 가까이에서 다시)
async function rgRefillBg(rig, R, chars, tk) {
  const { W, H } = rig, n = W * H, b = rgBBox(R, W, H, 128); if (!b || rig.by === 'smooth') return false;
  const un = new Float32Array(n); for (const c of chars) for (const L of c.layers) { const A = rgAlpha(L, W, H); for (let i = 0; i < n; i++) if (A[i] > 20) un[i] = 1; } for (let i = 0; i < n; i++) if (R[i] > 20) un[i] = 1;
  const grow = dpBox(un, W, H, Math.max(3, Math.round(Math.max(W, H) / 110))), hole = new Float32Array(n); for (let i = 0; i < n; i++) hole[i] = clamp(grow[i] * 5, 0, 1);
  const bid = rig.bg.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H), px = bid.data;
  for (const padK of [0.7, 1.6, 3]) {
    const pad = Math.max(48, Math.round(Math.max(b.w, b.h) * padK)), x0 = Math.max(0, b.x - pad), y0 = Math.max(0, b.y - pad), x1 = Math.min(W, b.x + b.w + pad), y1 = Math.min(H, b.y + b.h + pad), w = x1 - x0, h = y1 - y0;
    const sp = new Uint8ClampedArray(w * h * 4), sh = new Float32Array(w * h); let known = 0;
    for (let y = 0; y < h; y++) { sp.set(px.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x1) * 4), y * w * 4); for (let x = 0; x < w; x++) { const v = hole[(y + y0) * W + x + x0]; sh[y * w + x] = v; if (v < 0.5) known++; } }
    if (known < w * h * 0.15 && padK < 3) continue; if (known < w * h * 0.06) return false; // 둘레에 진짜 배경이 거의 없으면 그대로 둬요
    const r = await dpFill(sp, sh, w, h, tk), rf = new Float32Array(n); for (let i = 0; i < n; i++) rf[i] = R[i] / 255; const use = dpBox(rf, W, H, Math.max(3, Math.round(Math.max(W, H) / 200)));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y + y0) * W + x + x0, a = clamp(use[i] * 3, 0, 1) * hole[i]; if (a <= 0) continue; const q = (y * w + x) * 4; for (let c = 0; c < 3; c++) px[i * 4 + c] = px[i * 4 + c] * (1 - a) + r.px[q + c] * a; }
    const nb = newCanvas(W, H); nb.getContext('2d').putImageData(bid, 0, 0); for (const c of chars) c.bg = nb; rig.bg = nb; return true;
  }
  return false;
}
// 메운 자리 기록(0~255)을 더하기: 나중에 '메운 자리만' 더 좋은 그림으로 바꿔 넣을 수 있게
const rgAddFill = (L, add, n) => { const f = new Uint8ClampedArray(n); if (L.fillM) f.set(L.fillM); for (let i = 0; i < n; i++) if (add[i] > f[i]) f[i] = add[i]; L.fillM = f; };
// 구멍 둘레 배경이 밋밋한지 (단색·부드러운 그라데이션이면 AI 지우개보다 번져 메우는 쪽이 자국이 안 남아요)
function rgFlatAround(px, hole, W, H) {
  const n = W * H, near = dpBox(hole, W, H, Math.max(4, Math.round(Math.max(W, H) / 40))); let c = 0, s = 0, s2 = 0, e = 0;
  for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) { const i = y * W + x; if (hole[i] > 0.01 || near[i] < 0.02) continue; const j = i * 4, l = px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114, lx = px[j + 4] * 0.299 + px[j + 5] * 0.587 + px[j + 6] * 0.114, ly = px[j + W * 4] * 0.299 + px[j + W * 4 + 1] * 0.587 + px[j + W * 4 + 2] * 0.114; c++; s += l; s2 += l * l; e += Math.abs(l - lx) + Math.abs(l - ly); }
  if (c < 200) return false; const sd = Math.sqrt(Math.max(0, s2 / c - (s / c) * (s / c)));
  return e / c < 3.2 && sd < 42;
}
function rgSmoothFill(px, hole, W, H) { // 둘레 색을 여러 크기로 번져 메워요 (작게 줄여서 계산한 뒤 키워요: 어차피 부드러운 색이라 티가 안 나요)
  const n = W * H, k = Math.min(1, 320 / Math.max(W, H)), w = Math.max(2, Math.round(W * k)), h = Math.max(2, Math.round(H * k)), m = w * h;
  const full = newCanvas(W, H), fg = full.getContext('2d'), id = fg.createImageData(W, H); for (let i = 0; i < n; i++) { const j = i * 4, a = hole[i] > 0.01 ? 0 : 255; id.data[j] = px[j]; id.data[j + 1] = px[j + 1]; id.data[j + 2] = px[j + 2]; id.data[j + 3] = a; } fg.putImageData(id, 0, 0);
  const sc = newCanvas(w, h), sg = sc.getContext('2d', { willReadFrequently: true }); sg.imageSmoothingQuality = 'high'; sg.drawImage(full, 0, 0, w, h);
  const sp = sg.getImageData(0, 0, w, h).data, keep = new Float32Array(m), left = new Float32Array(m), o = new Float32Array(m * 3); for (let i = 0; i < m; i++) { keep[i] = sp[i * 4 + 3] > 250 ? 1 : 0; left[i] = 1 - keep[i]; for (let c = 0; c < 3; c++) o[i * 3 + c] = keep[i] ? sp[i * 4 + c] : 0; }
  const sgs = [1.2, 3, 7, 16, 36, 80];
  for (let si = 0; si < sgs.length; si++) { const q = dpNormBlur(sp, keep, w, h, sgs[si]), end = si === sgs.length - 1; for (let i = 0; i < m; i++) { if (left[i] <= 0) continue; const a = q[i * 4 + 3] / 255; if (a < (end ? 0.004 : 0.05)) continue; const take = end ? left[i] : left[i] * clamp(a * 2.2, 0, 1); for (let c = 0; c < 3; c++) o[i * 3 + c] += q[i * 4 + c] * take; left[i] -= take; } }
  const oc = newCanvas(w, h), og = oc.getContext('2d'), od = og.createImageData(w, h); for (let i = 0; i < m; i++) { const t = Math.max(1e-3, 1 - left[i]); od.data[i * 4] = o[i * 3] / t; od.data[i * 4 + 1] = o[i * 3 + 1] / t; od.data[i * 4 + 2] = o[i * 3 + 2] / t; od.data[i * 4 + 3] = 255; } og.putImageData(od, 0, 0);
  const uc = newCanvas(W, H), ug = uc.getContext('2d', { willReadFrequently: true }); ug.imageSmoothingQuality = 'high'; ug.drawImage(oc, 0, 0, W, H);
  const u = ug.getImageData(0, 0, W, H).data, out = new Uint8ClampedArray(px);
  for (let i = 0; i < n; i++) { const a = clamp(hole[i], 0, 1), j = i * 4; if (a) for (let c = 0; c < 3; c++) out[j + c] = px[j + c] * (1 - a) + u[j + c] * a; out[j + 3] = 255; }
  return out;
}
// 몸 앞에 겹친 팔은 알아서 떼어 내요 (안 떼면 팔을 움직일 때 몸까지 같이 끌려가요)
async function rgAutoParts(rig, tk, chars) {
  const { W, H } = rig, J = rig.joints, made = []; if (!rig.autoSk || rig.stdOff) return made;
  const sw = Math.hypot(J.aSho.x - J.bSho.x, J.aSho.y - J.bSho.y), th = sw * 0.34;
  for (const pre of ['a', 'b']) {
    const base = rig.layers.find(l => l.base), A = rgAlpha(base, W, H), S = pre + 'Sho', E = pre + 'Elb', Wr = pre + 'Wri', Hd = pre + 'Hand'; if (!rgOn(rig, Wr)) continue;
    const wide = (a, b, t0) => { let n = 0, k = 0; const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l; for (let t = t0; t <= 1.001; t += 0.125) { const x = a.x + dx * t, y = a.y + dy * t; let w = 0; for (const sg of [1, -1]) for (let d = 0; d < th * 3; d += 2) { const xx = Math.round(x + nx * d * sg), yy = Math.round(y + ny * d * sg); if (xx < 0 || yy < 0 || xx >= W || yy >= H || A[yy * W + xx] < 128) break; w += 2; } n++; if (w > th * 2.1) k++; } return n ? k / n : 0; };
    const fore = wide(J[E], J[Wr], 0.25); if (fore < 0.5) continue;
    const up = wide(J[S], J[E], 0.35) > 0.6, path = [up ? J[S] : J[E], ...(up ? [J[E]] : []), J[Wr], ...(rgOn(rig, Hd) ? [J[Hd]] : [])];
    const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.strokeStyle = '#fff'; g.lineWidth = th * 0.75; g.lineCap = g.lineJoin = 'round'; g.beginPath();
    const p0 = { x: path[0].x + (path[1].x - path[0].x) * 0.18, y: path[0].y + (path[1].y - path[0].y) * 0.18 }; g.moveTo(p0.x, p0.y); for (const p of path.slice(1)) g.lineTo(p.x, p.y); g.stroke();
    const d = g.getImageData(0, 0, W, H).data, M = new Uint8ClampedArray(W * H); let am = 0; for (let i = 0; i < M.length; i++) { M[i] = d[i * 4 + 3] > 128 && A[i] > 128 ? 255 : 0; if (M[i]) am++; }
    if (am < 60) continue;
    tk && tk.set('몸 앞에 겹친 팔을 떼어 내는 중…');
    const N = await rgSamRefine(rig, M, tk); if (!N) continue;
    let an = 0, it = 0; for (let i = 0; i < N.length; i++) { if (A[i] < 128) N[i] = 0; if (N[i] > 128) { an++; if (M[i]) it++; } }
    const inN = p => N[clamp(Math.round(p.y), 0, H - 1) * W + clamp(Math.round(p.x), 0, W - 1)] > 128;
    if (an > am * 4.5 || it < am * 0.55 || inN(J.chest) || inN(J.spine) || inN(J.neck) || inN(J[pre === 'a' ? 'bSho' : 'aSho'])) continue;
    const L = await rgSplit(rig, base, N, rgSideName(rig, pre === 'a' ? 'armA' : 'armB') + (up ? '' : ' 아래쪽'), tk, chars); if (L) { L.auto = true; made.push(L); }
  }
  return made;
}
// 그림을 SAM(윤곽 AI)에 한 번 읽혀 두기 → { s(줄인 배율), tw, th }
async function rgSamEnc(rig, tk) {
  await czLoad('samE'); await czLoad('samD'); if (tk && tk.stop) throw new Error('stop');
  const { W, H } = rig, s = 1024 / Math.max(W, H), tw = Math.max(1, Math.round(W * s)), th = Math.max(1, Math.round(H * s)), key = 'rig:' + rig.uid;
  if (cz.samEnc !== key) {
    const c = newCanvas(tw, th), gc = c.getContext('2d', { willReadFrequently: true }); gc.imageSmoothingQuality = 'high'; gc.drawImage(rig.src, 0, 0, tw, th);
    const px = gc.getImageData(0, 0, tw, th).data, x = new Float32Array(tw * th * 3); for (let i = 0, j = 0; i < tw * th; i++, j += 4) { x[i * 3] = px[j]; x[i * 3 + 1] = px[j + 1]; x[i * 3 + 2] = px[j + 2]; }
    cz.samEnc = ''; await czCall({ t: 'run2', key: 'samE', feeds: { input_image: { data: x, dims: [th, tw, 3] } }, keep: ['image_embeddings'], outs: [] }, [x.buffer]); cz.samEnc = key;
  }
  return { s, tw, th };
}
// 점·상자(줄인 그림 좌표)로 SAM에 물어보기. pts: [[x, y, 1(이것)|0(아님)]…], box: [x0, y0, x1, y1] → { m(후보마다 점수 지도), nm, iou }
async function rgSamAsk(E, pts, box) {
  const np = pts.length + (box ? 2 : 1), pc = new Float32Array(np * 2), pl = new Float32Array(np); pts.forEach(([x, y, l], i) => { pc[i * 2] = x; pc[i * 2 + 1] = y; pl[i] = l; });
  if (box) { pc[pts.length * 2] = box[0]; pc[pts.length * 2 + 1] = box[1]; pl[pts.length] = 2; pc[pts.length * 2 + 2] = box[2]; pc[pts.length * 2 + 3] = box[3]; pl[pts.length + 1] = 3; } else pl[pts.length] = -1;
  const r = await czCall({ t: 'run2', key: 'samD', outs: ['masks', 'iou_predictions'], feeds: { image_embeddings: { ref: 'image_embeddings' }, point_coords: { data: pc, dims: [1, np, 2] }, point_labels: { data: pl, dims: [1, np] },
    mask_input: { data: new Float32Array(256 * 256), dims: [1, 1, 256, 256] }, has_mask_input: { data: new Float32Array([0]), dims: [1] }, orig_im_size: { data: new Float32Array([E.th, E.tw]), dims: [2] } } });
  return { m: r.out.masks.data, nm: r.out.masks.dims[1] || 1, iou: r.out.iou_predictions ? r.out.iou_predictions.data : null };
}
// 줄인 0/1 지도 → 원래 크기 0~255 (가장자리 부드럽게). AI가 망설인 곳의 점박이 무늬와 부스러기는 먼저 정리해요
function rgUpMask(bin0, tw, th, W, H) {
  const bl = dpBox(Float32Array.from(bin0), tw, th, 2), bin = new Uint8Array(tw * th); for (let i = 0; i < bin.length; i++) bin[i] = bl[i] > 0.5 ? 1 : 0;
  { const seen = new Int32Array(tw * th).fill(-1), sizes = []; for (let i0 = 0; i0 < bin.length; i0++) { if (!bin[i0] || seen[i0] >= 0) continue; const id = sizes.length, st = [i0]; seen[i0] = id; let n = 0; while (st.length) { const i = st.pop(), x = i % tw, y = (i / tw) | 0; n++; if (x > 0 && bin[i - 1] && seen[i - 1] < 0) { seen[i - 1] = id; st.push(i - 1); } if (x < tw - 1 && bin[i + 1] && seen[i + 1] < 0) { seen[i + 1] = id; st.push(i + 1); } if (y > 0 && bin[i - tw] && seen[i - tw] < 0) { seen[i - tw] = id; st.push(i - tw); } if (y < th - 1 && bin[i + tw] && seen[i + tw] < 0) { seen[i + tw] = id; st.push(i + tw); } } sizes.push(n); } const big = Math.max(0, ...sizes); for (let i = 0; i < bin.length; i++) if (bin[i] && sizes[seen[i]] < big * 0.03) bin[i] = 0; }
  const oc = newCanvas(tw, th), og = oc.getContext('2d'), oid = og.createImageData(tw, th); for (let i = 0; i < tw * th; i++) { oid.data[i * 4] = oid.data[i * 4 + 1] = oid.data[i * 4 + 2] = 255; oid.data[i * 4 + 3] = bin[i] ? 255 : 0; } og.putImageData(oid, 0, 0);
  const uc = newCanvas(W, H), ug = uc.getContext('2d', { willReadFrequently: true }); ug.imageSmoothingQuality = 'high'; ug.drawImage(oc, 0, 0, W, H);
  const ud = ug.getImageData(0, 0, W, H).data, out = new Uint8ClampedArray(W * H); for (let i = 0; i < W * H; i++) out[i] = clamp((ud[i * 4 + 3] - 96) * 4, 0, 255);
  return out;
}
// 캐릭터가 여럿일 때: 사람 상자 + 뼈대 점으로 SAM에 한 명씩 물어서, 따낸 그림(A0)의 픽셀을 캐릭터마다 나눠요
async function rgInstances(sh, A0, people, tk) {
  const { W, H } = sh, E = await rgSamEnc(sh, tk), { s, tw, th } = E, plane = tw * th, BODY = [0, 5, 6, 11, 12, 7, 8];
  const good = (K, i, t) => K && K[i] && K[i][2] >= t, logit = [];
  for (let a = 0; a < people.length; a++) {
    if (tk && tk.stop) throw new Error('stop');
    const P = people[a], b = P.box, pts = [];
    for (const i of BODY) if (good(P.K, i, 0.4) && P.K[i][0] > b.x && P.K[i][0] < b.x + b.w && P.K[i][1] > b.y && P.K[i][1] < b.y + b.h) pts.push([P.K[i][0] * s, P.K[i][1] * s, 1]);
    if (!pts.length) pts.push([(b.x + b.w / 2) * s, (b.y + b.h * 0.4) * s, 1]);
    for (let o = 0; o < people.length; o++) if (o !== a) for (const i of [0, 5, 6, 11, 12]) { const K = people[o].K; if (!good(K, i, 0.5)) continue; const x = K[i][0], y = K[i][1]; if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue; if (pts.some(q => q[2] === 1 && Math.hypot(q[0] - x * s, q[1] - y * s) < 0.05 * Math.max(tw, th))) continue; pts.push([x * s, y * s, 0]); }
    const r = await rgSamAsk(E, pts, [b.x * s, b.y * s, (b.x + b.w) * s, (b.y + b.h) * s]), ba = b.w * b.h * s * s; let best = 0, bs = -1e9;
    for (let k = 0; k < r.nm; k++) { let ar = 0; for (let i = 0; i < plane; i += 3) if (r.m[k * plane + i] > 0) ar += 3; const sc = (r.iou ? r.iou[k] : 0) - (ar > ba * 1.25 ? 1 : 0) - (ar < ba * 0.12 ? 0.5 : 0); if (sc > bs) { bs = sc; best = k; } }
    logit.push(r.m.slice(best * plane, (best + 1) * plane));
  }
  // 줄인 그림에서 픽셀마다 누구 것인지: SAM 점수가 가장 높은 캐릭터. 아무도 안 가져간 곳은 가까운 캐릭터에게
  const mc = newCanvas(W, H), mg = mc.getContext('2d'), mid = mg.createImageData(W, H); for (let i = 0; i < W * H; i++) { mid.data[i * 4] = mid.data[i * 4 + 1] = mid.data[i * 4 + 2] = 255; mid.data[i * 4 + 3] = A0[i]; } mg.putImageData(mid, 0, 0);
  const lc = newCanvas(tw, th), lg = lc.getContext('2d', { willReadFrequently: true }); lg.imageSmoothingQuality = 'high'; lg.drawImage(mc, 0, 0, tw, th);
  const ld = lg.getImageData(0, 0, tw, th).data, lab = new Int8Array(plane).fill(-2), q = new Int32Array(plane); let qh = 0, qt = 0;
  for (let i = 0; i < plane; i++) { if (ld[i * 4 + 3] <= 90) continue; let b = -1, bv = 0; for (let a = 0; a < people.length; a++) if (logit[a][i] > bv) { bv = logit[a][i]; b = a; } lab[i] = b; if (b >= 0) q[qt++] = i; }
  while (qh < qt) { const i = q[qh++], x = i % tw, y = (i / tw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= tw || yy >= th) continue; const j = yy * tw + xx; if (lab[j] === -1) { lab[j] = lab[i]; q[qt++] = j; } } }
  const out = [];
  for (let a = 0; a < people.length; a++) {
    const bin = new Uint8Array(plane); let n = 0; for (let i = 0; i < plane; i++) if (lab[i] === a) { bin[i] = 1; n++; }
    if (n < plane * 0.004) continue;
    const up = rgUpMask(bin, tw, th, W, H), A = new Uint8ClampedArray(W * H); for (let i = 0; i < A.length; i++) A[i] = Math.round(A0[i] * up[i] / 255);
    const box = rgBBox(A, W, H, 100); if (box) out.push({ A, K: people[a].K, box });
  }
  return out;
}
// 선 지도(0~1): 그림의 선·색 경계가 얼마나 또렷한지. w×h 크기로 한 번 계산해 둬요 (선 따라 칠하는 붓, 자동 나누기 점수에 써요)
function rgEdge(main, w, h) {
  if (main.edge && main.edge.w === w && main.edge.h === h) return main.edge.e;
  const c = newCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(main.src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, e = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let m = 0; const i = (y * w + x) * 4; for (let ch = 0; ch < 3; ch++) { const gx = d[i + 4 + ch] - d[i - 4 + ch] + 0.5 * (d[i + 4 - w * 4 + ch] - d[i - 4 - w * 4 + ch] + d[i + 4 + w * 4 + ch] - d[i - 4 + w * 4 + ch]), gy = d[i + w * 4 + ch] - d[i - w * 4 + ch] + 0.5 * (d[i + w * 4 - 4 + ch] - d[i - w * 4 - 4 + ch] + d[i + w * 4 + 4 + ch] - d[i - w * 4 + 4 + ch]), v = Math.abs(gx) + Math.abs(gy); if (v > m) m = v; } e[y * w + x] = clamp((m - 24) / 150, 0, 1); }
  main.edge = { w, h, e }; return e;
}
// 붙어 있는 두 캐릭터 자동 나누기(가까운 구도용): 몸 곳곳을 찍어 SAM에 '이 점이 든 큰 덩어리'를 물어보고,
// 여러 점에서 똑같이 나온 덩어리(= 진짜 한 사람일 가능성이 큼) 중 선 경계가 또렷하고 양쪽 살색이 다른 것을 골라요 → 그 덩어리(0~255) 또는 null
async function rgAutoTwo(rig, tk) {
  const { W, H } = rig, base = rig.layers.find(l => l.base), A = rgAlpha(base, W, H), E = await rgSamEnc(rig, tk), { s, tw, th } = E, plane = tw * th;
  const lc = newCanvas(tw, th), lg = lc.getContext('2d', { willReadFrequently: true }); lg.imageSmoothingQuality = 'high'; lg.drawImage(base.tex, 0, 0, tw, th);
  const ad = lg.getImageData(0, 0, tw, th).data, blob = new Uint8Array(plane); let nb = 0; for (let i = 0; i < plane; i++) if (ad[i * 4 + 3] > 128) { blob[i] = 1; nb++; }
  if (nb < plane * 0.02) return null;
  lg.clearRect(0, 0, tw, th); lg.drawImage(rig.src, 0, 0, tw, th); const px = lg.getImageData(0, 0, tw, th).data, edge = rgEdge(rig, tw, th);
  // 찍을 점: 몸 안쪽 깊은 곳부터 서로 떨어지게
  const seeds = [], work = blob.slice(), minR = 0.075 * Math.max(tw, th);
  for (let k = 0; k < 14; k++) { const dp = czDeepest(work, tw, th); if (!dp || dp[0] < 0 || dp[1] < 5) break; const i = dp[0], x = i % tw, y = (i / tw) | 0, r = Math.max(minR, dp[1] * 1.15); seeds.push([x, y]); for (let yy = Math.max(0, Math.floor(y - r)); yy < Math.min(th, y + r); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx < Math.min(tw, x + r); xx++) if ((xx - x) * (xx - x) + (yy - y) * (yy - y) < r * r) work[yy * tw + xx] = 0; }
  if (seeds.length < 3) return null;
  // 견줄 때는 3칸마다 한 점만
  const ST = 3, gw = Math.floor(tw / ST), gh = Math.floor(th / ST), gi = []; for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (blob[y * ST * tw + x * ST]) gi.push(y * ST * tw + x * ST);
  const cands = [];
  for (let si = 0; si < seeds.length; si++) {
    if (tk && tk.stop) throw new Error('stop'); tk && tk.set(`캐릭터 경계를 찾는 중… ${si + 1} / ${seeds.length}`);
    const r = await rgSamAsk(E, [[seeds[si][0], seeds[si][1], 1]], null);
    for (let k = 0; k < r.nm; k++) { if (r.iou && r.iou[k] < 0.55) continue; const bits = new Uint8Array(gi.length); let a = 0; for (let j = 0; j < gi.length; j++) if (r.m[k * plane + gi[j]] > 0) { bits[j] = 1; a++; } const f = a / gi.length; if (f < 0.14 || f > 0.86) continue; cands.push({ si, bits, a, f, full: r.m.slice(k * plane, (k + 1) * plane) }); }
  }
  if (!cands.length) return null;
  const iouOf = (p, q) => { let it = 0; for (let j = 0; j < p.bits.length; j++) if (p.bits[j] && q.bits[j]) it++; const same = it / (p.a + q.a - it), pa = p.a, qa = gi.length - q.a, it2 = pa - it; return [same, it2 / (pa + qa - it2)]; }; // [같은 쪽끼리, 반대쪽과]
  const scored = [];
  for (const c of cands) {
    const sup = new Map(); for (const o of cands) { if (o === c) continue; const [a1, a2] = iouOf(c, o); if (a1 > 0.72) sup.set(o.si, { o, flip: false }); else if (a2 > 0.72 && !sup.has(o.si)) sup.set(o.si, { o, flip: true }); }
    sup.delete(c.si);
    // 경계의 선 세기, 양쪽 색 차이
    let es = 0, en = 0; const in1 = new Uint8Array(plane); for (let j = 0; j < gi.length; j++) if (c.bits[j]) in1[gi[j]] = 1;
    const m1 = [0, 0, 0], m2 = [0, 0, 0]; let n1 = 0, n2 = 0;
    for (let j = 0; j < gi.length; j++) { const i = gi[j], q = i * 4; if (c.bits[j]) { m1[0] += px[q]; m1[1] += px[q + 1]; m1[2] += px[q + 2]; n1++; } else { m2[0] += px[q]; m2[1] += px[q + 1]; m2[2] += px[q + 2]; n2++; }
      for (const o of [ST, ST * tw]) { const i2 = i + o; if (i2 >= plane || !blob[i2] || in1[i2] === in1[i]) continue; let mx = 0; for (let t = 0; t <= ST; t++) { const p = i + (o === ST ? t : t * tw); for (const dd of [0, -1, 1, -tw, tw]) { const v = edge[p + dd] || 0; if (v > mx) mx = v; } } es += mx; en++; } }
    const eg = en ? es / en : 0, tone = n1 && n2 ? Math.min(1, Math.hypot(m1[0] / n1 - m2[0] / n2, m1[1] / n1 - m2[1] / n2, m1[2] / n1 - m2[2] / n2) / 55) : 0, bal = 1 - Math.abs(c.f - 0.5) * 0.8;
    if (eg < 0.18) continue;
    scored.push({ c, sup, eg, tone, sc: (Math.min(sup.size, 5) + 1) * (0.35 + eg) * (0.8 + 0.3 * tone) * bal });
  }
  scored.sort((a, b) => b.sc - a.sc);
  // 서로 다른 후보만 몇 개 (같은 덩어리·그 반대쪽은 한 번만)
  const picks = []; for (const q of scored) { if (picks.every(p => { const [a1, a2] = iouOf(p.c, q.c); return a1 < 0.72 && a2 < 0.72; })) picks.push(q); if (picks.length >= 4) break; }
  const out = [];
  for (const best of picks) {
    // 같은 덩어리를 가리킨 답들을 모아 다수결
    const votes = new Float32Array(plane), all = [{ o: best.c, flip: false }, ...best.sup.values()]; for (const { o, flip } of all) for (let i = 0; i < plane; i++) if (blob[i] && ((o.full[i] > 0) !== flip)) votes[i]++;
    const bin = new Uint8Array(plane); for (let i = 0; i < plane; i++) bin[i] = blob[i] && votes[i] > all.length / 2 ? 1 : 0;
    const up = rgUpMask(bin, tw, th, W, H), M = new Uint8ClampedArray(W * H); let a1 = 0, a0 = 0; for (let i = 0; i < M.length; i++) { M[i] = A[i] > 20 ? up[i] : 0; if (A[i] > 128) { if (M[i] > 128) a1++; else a0++; } }
    if (a1 < (a1 + a0) * 0.1 || a0 < (a1 + a0) * 0.1) continue;
    // 얼굴(눈)이 있는 쪽은 지금 캐릭터로 남기고, 반대쪽을 새 캐릭터 후보로
    const eyeIn = (rig.eyes || []).filter(e => M[clamp(Math.round(e.y + e.h / 2), 0, H - 1) * W + clamp(Math.round(e.x + e.w / 2), 0, W - 1)] > 128).length, flip = rig.eyes && rig.eyes.length ? eyeIn * 2 > rig.eyes.length : a1 > a0;
    if (flip) for (let i = 0; i < M.length; i++) M[i] = A[i] > 20 ? 255 - M[i] : 0;
    out.push({ M, votes: all.length, edge: best.eg, tone: best.tone });
  }
  return out.length ? out : null;
}
// 다른 캐릭터(M: 0~255)에 가려진 자리 중 이 캐릭터 몸이 이어질 곳을 메워요 → 떨어뜨려 움직여도 구멍이 안 보이게
async function rgFillBehind(sh, tex, M, tk) {
  const { W, H } = sh, n = W * H, id = tex.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H), d = id.data, rem = new Uint8Array(n); for (let i = 0; i < n; i++) rem[i] = d[i * 4 + 3];
  const enc = rgEnclosed(sh, rem, M); let en = 0; for (let i = 0; i < n; i++) if (enc[i] > 0.5 && rem[i] < 128) en++;
  if (en < 40) return tex;
  const bgd = sh.bg.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, comp = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const j = i * 4, a = rem[i] / 255; comp[j] = d[j] * a + bgd[j] * (1 - a); comp[j + 1] = d[j + 1] * a + bgd[j + 1] * (1 - a); comp[j + 2] = d[j + 2] * a + bgd[j + 2] * (1 - a); comp[j + 3] = 255; }
  const hole = new Float32Array(n); for (let i = 0; i < n; i++) hole[i] = enc[i] * (1 - rem[i] / 255);
  const ign = new Float32Array(n); for (let i = 0; i < n; i++) ign[i] = M[i] > 40 && rem[i] < 128 ? 1 : 0;
  const filled = await rgFillRegion(comp, hole, W, H, tk, ign), fm = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) { const j = i * 4, e = hole[i]; if (e > 0.02) { d[j] = filled[j]; d[j + 1] = filled[j + 1]; d[j + 2] = filled[j + 2]; d[j + 3] = Math.max(rem[i], Math.round(enc[i] * 255)); fm[i] = Math.round(e * 255); } }
  const c = newCanvas(W, H); c.getContext('2d').putImageData(id, 0, 0); c.rgFill = fm; return c;
}
// 입 찾기: 두 눈 아래쪽에서 살색과 다른(어둡거나 붉은) 가로 덩어리. 못 찾으면 어림한 자리(est)
function rgFindMouth(src, W, H, eyes) {
  if (!eyes || eyes.length < 2) return null;
  const c0 = { x: eyes[0].x + eyes[0].w / 2, y: eyes[0].y + eyes[0].h / 2 }, c1 = { x: eyes[1].x + eyes[1].w / 2, y: eyes[1].y + eyes[1].h / 2 }, d = Math.hypot(c1.x - c0.x, c1.y - c0.y); if (d < 8) return null;
  let rx = (c1.x - c0.x) / d, ry = (c1.y - c0.y) / d, dx = -ry, dy = rx; if (dy < 0) { dx = -dx; dy = -dy; }
  const mid = { x: (c0.x + c1.x) / 2, y: (c0.y + c1.y) / 2 }, eh = (eyes[0].h + eyes[1].h) / 2, GW = 96, GH = 72, U0 = -0.45, U1 = 0.45, V0 = Math.max(0.3, eh / d * 0.7), V1 = 1.08; // 애니 얼굴은 눈 사이가 넓어서 입이 눈 줄에서 눈 사이 거리의 0.6배쯤 아래에 있어요
  const g = src.getContext('2d', { willReadFrequently: true }), bx = Math.max(0, Math.floor(mid.x - d * 1.6)), by = Math.max(0, Math.floor(mid.y - d * 0.2)), bw = Math.min(W - bx, Math.ceil(d * 3.2)), bh = Math.min(H - by, Math.ceil(d * 2)); if (bw < 4 || bh < 4) return null;
  const px = g.getImageData(bx, by, bw, bh).data, col = new Float32Array(GW * GH * 3), ok = new Uint8Array(GW * GH), pos = new Float32Array(GW * GH * 2);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const u = U0 + (U1 - U0) * (i + 0.5) / GW, v = V0 + (V1 - V0) * (j + 0.5) / GH, x = mid.x + (rx * u + dx * v) * d, y = mid.y + (ry * u + dy * v) * d, k = j * GW + i; pos[k * 2] = x; pos[k * 2 + 1] = y; const ix = Math.round(x - bx), iy = Math.round(y - by); if (ix < 0 || iy < 0 || ix >= bw || iy >= bh) continue; const q = (iy * bw + ix) * 4; col[k * 3] = px[q]; col[k * 3 + 1] = px[q + 1]; col[k * 3 + 2] = px[q + 2]; ok[k] = 1; }
  const med = ch => { const a = []; for (let k = 0; k < GW * GH; k++) if (ok[k]) a.push(col[k * 3 + ch]); a.sort((p, q) => p - q); return a.length ? a[a.length >> 1] : 200; }, sk = [med(0), med(1), med(2)], sL = sk[0] * 0.3 + sk[1] * 0.59 + sk[2] * 0.11;
  const hot = new Uint8Array(GW * GH); for (let k = 0; k < GW * GH; k++) { if (!ok[k]) continue; const r = col[k * 3], gg = col[k * 3 + 1], b = col[k * 3 + 2], L = r * 0.3 + gg * 0.59 + b * 0.11, sc = Math.max(0, sL - L) + 0.7 * Math.max(0, (r - gg) - (sk[0] - sk[1])); if (sc > 24) hot[k] = 1; }
  const seen = new Uint8Array(GW * GH); let best = null;
  for (let k0 = 0; k0 < GW * GH; k0++) {
    if (!hot[k0] || seen[k0]) continue; const st = [k0]; seen[k0] = 1; let n = 0, x0 = GW, x1 = -1, y0 = GH, y1 = -1, edge = false, cr = 0, cg = 0, cb = 0;
    while (st.length) { const k = st.pop(), x = k % GW, y = (k / GW) | 0; n++; cr += col[k * 3]; cg += col[k * 3 + 1]; cb += col[k * 3 + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x === 0 || x === GW - 1 || y === GH - 1) edge = true; for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) { if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue; const q = yy * GW + xx; if (hot[q] && !seen[q]) { seen[q] = 1; st.push(q); } } }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, cu = U0 + (U1 - U0) * ((x0 + x1 + 1) / 2) / GW, cv = V0 + (V1 - V0) * ((y0 + y1 + 1) / 2) / GH;
    if (edge || n < 3 || w < 2 || h > w * 1.6 || w > GW * 0.75) continue;
    const sc = Math.sqrt(n) * 3 * (1 - Math.min(1, Math.abs(cu) / 0.28)) * Math.exp(-Math.pow((cv - 0.6) / 0.2, 2)) * Math.min(1, w / (h * 1.2));
    if (!best || sc > best.sc) best = { sc, x0, x1, y0, y1, w, h, col: [cr / n, cg / n, cb / n] };
  }
  const boxOf = (i0, j0, i1, j1) => { let X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9; for (const [i, j] of [[i0, j0], [i1, j0], [i0, j1], [i1, j1]]) { const u = U0 + (U1 - U0) * i / GW, v = V0 + (V1 - V0) * j / GH, x = mid.x + (rx * u + dx * v) * d, y = mid.y + (ry * u + dy * v) * d; X0 = Math.min(X0, x); Y0 = Math.min(Y0, y); X1 = Math.max(X1, x); Y1 = Math.max(Y1, y); } return { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 }; };
  if (best && best.sc > 1.5) { const b = boxOf(best.x0 - 1, best.y0 - 0.5, best.x1 + 2, best.y1 + 1.5), open = best.h / best.w > 0.42 && best.h >= 5 && best.w * (U1 - U0) / GW > 0.2, lc = best.col; return { ...b, on: true, type: open ? 'open' : 'line', col: [Math.round(lc[0] * 0.45 + 120 * 0.55), Math.round(lc[1] * 0.45 + 38 * 0.55), Math.round(lc[2] * 0.45 + 44 * 0.55)] }; }
  const cx = mid.x + dx * d * 0.6, cy = mid.y + dy * d * 0.6, w = d * 0.3, h = Math.max(4, d * 0.045);
  return { x: cx - w / 2, y: cy - h / 2, w, h, on: true, type: 'line', est: true, col: [120, 40, 45] };
}
function rgNewChar(sh, tex, sk, eyes, i) {
  const rig = { W: sh.W, H: sh.H, gw: sh.gw, gh: sh.gh, src: sh.src, bg: sh.bg, uid: sh.uid, by: sh.by, cid: 'c' + uid(), cname: '캐릭터 ' + (i + 1), cz: i, joints: sk.joints, conf: sk.conf, autoSk: sk.auto, stdOff: !sk.auto, cut: sk.cut || null, chains: [], zs: {}, pins: [], eyes, mouth: rgFindMouth(sh.src, sh.W, sh.H, eyes), // AI가 뼈대를 못 찾으면(얼굴·어깨가 안 보이는 그림) 사람 모양 뼈대는 꺼 두고 내 뼈를 넣게 해요
 anim: rgNewAnim(), ver: 1, layers: [{ id: 'body', name: '몸 전체', base: true, z: 0, tex }] };
  if (!eyes.length) rig.anim.auto.blink = 0;
  return rig;
}
async function rgPrepare(src, sw, sh0, tk) {
  const k = Math.min(1, RG_MAX / Math.max(sw, sh0)), W = Math.max(8, Math.round(sw * k)), H = Math.max(8, Math.round(sh0 * k));
  const c = newCanvas(W, H), cg = c.getContext('2d', { willReadFrequently: true }); cg.fillStyle = '#fff'; cg.fillRect(0, 0, W, H); cg.imageSmoothingQuality = 'high'; cg.drawImage(src, 0, 0, W, H);
  const px = cg.getImageData(0, 0, W, H).data, n = W * H, g = Math.max(W, H) / 120, sh = { W, H, gw: Math.max(8, Math.round(W / g)), gh: Math.max(8, Math.round(H / g)), src: c, bg: null, uid: uid() };
  const stopQ = () => { if (tk && tk.stop) throw new Error('stop'); }, soft = async (fn, def) => { try { return await fn(); } catch (e) { if (String(e && e.message) === 'stop') throw e; console.warn('rgPrepare', e); return def; } };
  tk && tk.set('캐릭터를 따내는 중…', 0.06);
  const A0 = await aiMask(c, W, H, tk); stopQ();
  const bin = new Uint8Array(n); let tot = 0; for (let i = 0; i < n; i++) { bin[i] = A0[i] > 100 ? 1 : 0; tot += bin[i]; }
  const big = czLargest(bin, W, H); if (!big || big.n < n * 0.004) throw new Error('nochar');
  // 사람이 여럿인지
  tk && tk.set('캐릭터가 몇 명인지 보는 중…', 0.2);
  let boxes = await soft(() => rgYolo('person', c, W, H, { x: 0, y: 0, w: W, h: H }, tk), []); stopQ();
  const inMask = b => { let m = 0, t = 0; for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(H, b.y + b.h); y += 4) for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(W, b.x + b.w); x += 4) { t++; m += bin[y * W + x]; } return t ? m / t : 0; };
  boxes = boxes.filter(b => b.s >= 0.4 && b.w * b.h > W * H * 0.012 && inMask(b) > 0.2).sort((a, b) => b.w * b.h - a.w * a.h);
  const kept = []; for (const b of boxes) { if (kept.every(q => { const ix = Math.max(0, Math.min(b.x + b.w, q.x + q.w) - Math.max(b.x, q.x)), iy = Math.max(0, Math.min(b.y + b.h, q.y + q.h) - Math.max(b.y, q.y)), it = ix * iy; return it / (b.w * b.h + q.w * q.h - it) < 0.55 && !(it > b.w * b.h * 0.8 && b.w * b.h < q.w * q.h * 0.4); })) kept.push(b); if (kept.length >= 4) break; }
  let people = [];
  if (kept.length >= 2) {
    tk && tk.set('캐릭터마다 뼈대를 찾는 중…', 0.26);
    for (const b of kept) { people.push({ box: b, K: await soft(() => rgPoseRun(c, W, H, b, tk), null) }); stopQ(); }
    tk && tk.set('붙어 있는 캐릭터를 나누는 중…', 0.34);
    people = await soft(() => rgInstances(sh, A0, people, tk), []); stopQ();
  }
  if (people.length < 2) { // 한 명: 가장 큰 덩어리(+ 그 둘레의 반투명한 가장자리)만 캐릭터로. 떨어져 있는 다른 것은 배경에 그대로 둬요
    const nearB = dpBox(Float32Array.from(big.bin), W, H, 3), A = new Uint8ClampedArray(n); for (let i = 0; i < n; i++) A[i] = nearB[i] > 0.01 ? A0[i] : 0;
    const box = rgBBox(A, W, H, 100); tk && tk.set('뼈대를 찾는 중…', 0.3);
    people = [{ A, box, K: await soft(() => rgPoseRun(c, W, H, box, tk), null) }]; stopQ();
  }
  tk && tk.set('캐릭터 뒤 배경을 메우는 중…', 0.45);
  const m = new Float32Array(n); for (const P of people) for (let i = 0; i < n; i++) if (P.A[i] > m[i] * 255) m[i] = P.A[i] / 255;
  const mb = dpBox(dpBox(m, W, H, Math.max(3, Math.round(Math.max(W, H) / 90))), W, H, Math.max(2, Math.round(Math.max(W, H) / 180))), hole = new Float32Array(n); for (let i = 0; i < n; i++) hole[i] = clamp(mb[i] * 6, 0, 1);
  const bgr = rgFlatAround(px, hole, W, H) ? { px: rgSmoothFill(px, hole, W, H), by: 'smooth' } : await dpFill(px, hole, W, H, tk); stopQ();
  sh.bg = newCanvas(W, H); sh.bg.getContext('2d').putImageData(new ImageData(bgr.px, W, H), 0, 0); sh.by = bgr.by;
  // 화면 아래쪽에 닿는 캐릭터일수록 앞에 그려요
  people.sort((a, b) => (a.box.y + a.box.h) - (b.box.y + b.box.h) || a.box.w * a.box.h - b.box.w * b.box.h);
  const chars = [];
  for (let i = 0; i < people.length; i++) {
    const P = people[i]; tk && tk.set(people.length > 1 ? `캐릭터 ${i + 1} 준비하는 중…` : '눈을 찾는 중…', 0.6 + 0.1 * i / people.length);
    let tex = rgCutTex(px, P.A, W, H);
    let fillM = null;
    if (people.length > 1) { const M = new Uint8ClampedArray(n); for (const O of people) if (O !== P) for (let q = 0; q < n; q++) if (O.A[q] > M[q]) M[q] = O.A[q]; tex = await soft(() => rgFillBehind(sh, tex, M, tk), tex); fillM = tex.rgFill || null; stopQ(); }
    const sk = rgSkeleton(P.K, W, H, P.box), eyes = await soft(() => rgFindEyes(c, W, H, sk, P.box, tk), []); stopQ();
    chars.push(rgNewChar(sh, tex, sk, eyes, i)); if (fillM) chars[chars.length - 1].layers[0].fillM = fillM;
  }
  // 왼쪽부터 번호를 붙여요
  [...chars].sort((a, b) => a.joints.chest.x - b.joints.chest.x).forEach((r, i) => { r.cname = '캐릭터 ' + (i + 1); });
  const main = chars[0]; main.more = chars.slice(1); main.autoParts = [];
  for (const r of chars) { const made = await soft(() => rgAutoParts(r, tk, chars), []); stopQ(); for (const L of made) main.autoParts.push((chars.length > 1 ? r.cname + ' ' : '') + L.name); }
  tk && tk.set('그물을 씌우는 중…', 0.95);
  for (const r of chars) for (const L of r.layers) rgBuildLayer(r, L);
  return main;
}
async function rgFindEyes(c, W, H, sk, box, tk) {
  const J = sk.joints; let hb;
  if (sk.auto) { const hx = (J.neck.x + J.head.x) / 2, hy = (J.neck.y + J.head.y) / 2, r = Math.max(24, Math.hypot(J.head.x - J.neck.x, J.head.y - J.neck.y) * 1.5); hb = { x: hx - r, y: hy - r, w: r * 2, h: r * 2 }; }
  else hb = { x: box.x, y: box.y, w: box.w, h: Math.min(box.h, box.w * 1.3) };
  let list = await rgEyesRun(c, W, H, hb, tk);
  if (!list.length && sk.auto) list = await rgEyesRun(c, W, H, { x: box.x, y: box.y, w: box.w, h: Math.min(box.h, box.w * 1.4) }, tk);
  const cx0 = box.x - box.w * 0.02, cx1 = box.x + box.w * 1.02; list = list.filter(e => e.x + e.w / 2 > cx0 && e.x + e.w / 2 < cx1 && e.y + e.h / 2 > box.y && e.y + e.h / 2 < box.y + box.h);
  if (!list.length) return [];
  const a = list[0], b = list.slice(1).find(q => { const r = (q.w * q.h) / (a.w * a.h), dx = Math.abs(q.x + q.w / 2 - a.x - a.w / 2), dy = Math.abs(q.y + q.h / 2 - a.y - a.h / 2); return r > 0.25 && r < 4 && dx > Math.max(a.w, q.w) * 0.6 && dx < Math.max(a.w, q.w) * 5 && dy < Math.max(a.h, q.h) * 2.2; });
  return (b ? [a, b] : [a]).sort((p, q) => p.x - q.x).map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h, on: true }));
}

/* ---- 부위 나누기: 칠한 곳(M: 0~255)을 새 층으로 떼어 내고, 떼어 낸 자리는 메워요 ---- */
function rgTexPx(L, W, H) { return L.tex.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H); }
function rgSetTex(L, id) { const c = newCanvas(id.width, id.height); c.getContext('2d').putImageData(id, 0, 0); L.tex = c; L.A = null; L.mesh = null; }
// 떼어 낸 자리 중 '몸이 이어져 있을 곳'(남은 그림에 둘러싸인 곳)만 골라요 (팔이 몸 밖으로 뻗은 부분은 비워 둬요)
// 떼어 낸 자리(M) 중 뒤에 몸이 있을 곳: 둘러싸인 곳 + '남은 몸이 바깥 배경보다 가까운 곳'(가린 물건 뒤의 몸이 이어지게)
function rgEnclosed(rig, rem, M) {
  const { W, H } = rig, enc = rgEnclosedGrid(rig, rem, M), k = Math.min(1, 400 / Math.max(W, H)), w = Math.max(4, Math.round(W * k)), h = Math.max(4, Math.round(H * k)), n = w * h;
  const body = new Float32Array(n).fill(1e9), bgd = new Float32Array(n).fill(1e9), hole = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = Math.min(H - 1, Math.floor((y + 0.5) / k)) * W + Math.min(W - 1, Math.floor((x + 0.5) / k)), q = y * w + x; if (M[i] > 128) hole[q] = 1; else if (rem[i] > 128) body[q] = 0; else bgd[q] = 0; }
  const cham = D => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = y * w + x; let v = D[q]; if (x) v = Math.min(v, D[q - 1] + 1); if (y) { v = Math.min(v, D[q - w] + 1); if (x) v = Math.min(v, D[q - w - 1] + 1.414); if (x < w - 1) v = Math.min(v, D[q - w + 1] + 1.414); } D[q] = v; } for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const q = y * w + x; let v = D[q]; if (x < w - 1) v = Math.min(v, D[q + 1] + 1); if (y < h - 1) { v = Math.min(v, D[q + w] + 1); if (x < w - 1) v = Math.min(v, D[q + w + 1] + 1.414); if (x) v = Math.min(v, D[q + w - 1] + 1.414); } D[q] = v; } };
  cham(body); cham(bgd);
  const c1 = newCanvas(w, h), g1 = c1.getContext('2d'), id = g1.createImageData(w, h);
  for (let q = 0; q < n; q++) { const v = hole[q] && body[q] < 1e8 ? clamp(0.5 + (bgd[q] - body[q]) / 3, 0, 1) : 0; id.data[q * 4] = id.data[q * 4 + 1] = id.data[q * 4 + 2] = 255; id.data[q * 4 + 3] = v * 255; }
  g1.putImageData(id, 0, 0); const c2 = newCanvas(W, H), g2 = c2.getContext('2d', { willReadFrequently: true }); g2.imageSmoothingQuality = 'high'; g2.drawImage(c1, 0, 0, W, H);
  const d = g2.getImageData(0, 0, W, H).data; for (let i = 0; i < W * H; i++) if (M[i] > 0) enc[i] = Math.max(enc[i], d[i * 4 + 3] / 255);
  return enc;
}
function rgEnclosedGrid(rig, rem, M) {
  const { W, H, gw, gh } = rig, gx = W / gw, gy = H / gh, body = new Uint8Array(gw * gh), part = new Uint8Array(gw * gh), cb = new Float32Array(gw * gh), cp = new Float32Array(gw * gh), cn = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) { const cy = Math.min(gh - 1, (y / gy) | 0); for (let x = 0; x < W; x++) { const c = cy * gw + Math.min(gw - 1, (x / gx) | 0), i = y * W + x; cn[c]++; if (M[i] > 128) cp[c]++; else if (rem[i] > 128) cb[c]++; } }
  for (let c = 0; c < gw * gh; c++) { part[c] = cp[c] > cn[c] * 0.3 ? 1 : 0; body[c] = cb[c] > cn[c] * 0.5 ? 1 : 0; }
  const E = new Float32Array(gw * gh), R = Math.max(gw, gh), dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const c = y * gw + x; if (!part[c]) continue; let hit = 0;
    for (const [dx, dy] of dirs) for (let s = 1; s < R; s++) { const xx = x + dx * s, yy = y + dy * s; if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) break; const q = yy * gw + xx; if (body[q]) { hit++; break; } if (!part[q]) break; }
    E[c] = hit >= 6 ? 1 : hit === 5 ? 0.5 : 0;
  }
  // 칸 → 픽셀 (부드럽게)
  const c1 = newCanvas(gw, gh), g1 = c1.getContext('2d'), id = g1.createImageData(gw, gh); for (let i = 0; i < gw * gh; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = E[i] * 255; } g1.putImageData(id, 0, 0);
  const c2 = newCanvas(W, H), g2 = c2.getContext('2d', { willReadFrequently: true }); g2.imageSmoothingQuality = 'high'; g2.drawImage(c1, 0, 0, W, H);
  const d = g2.getImageData(0, 0, W, H).data, out = new Float32Array(W * H); for (let i = 0; i < W * H; i++) out[i] = M[i] > 0 ? clamp((d[i * 4 + 3] / 255 - 0.25) * 2, 0, 1) : 0;
  return out;
}
async function rgSplit(rig, L, M, name, tk, chars) {
  const { W, H } = rig, n = W * H, id = rgTexPx(L, W, H), d = id.data, part = new ImageData(W, H), pd = part.data, rem = new Uint8Array(n); let cnt = 0;
  for (let i = 0; i < n; i++) { const j = i * 4, a = d[j + 3], m = M[i] / 255, pa = Math.round(a * m); if (pa > 0) { pd[j] = d[j]; pd[j + 1] = d[j + 1]; pd[j + 2] = d[j + 2]; pd[j + 3] = pa; if (pa > 128) cnt++; } rem[i] = Math.round(a * (1 - m)); }
  if (cnt < 30) return null;
  const enc = rgEnclosed(rig, rem, M); let en = 0; for (let i = 0; i < n; i++) if (enc[i] > 0.5) en++;
  // 남은 그림: 떼어 낸 자리 중 몸이 이어질 곳은 메워요 (배경을 메운 그림 위에 얹어 놓고 둘레에 맞게)
  const bgd = rig.bg.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, comp = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const j = i * 4, a = rem[i] / 255; comp[j] = d[j] * a + bgd[j] * (1 - a); comp[j + 1] = d[j + 1] * a + bgd[j + 1] * (1 - a); comp[j + 2] = d[j + 2] * a + bgd[j + 2] * (1 - a); comp[j + 3] = 255; }
  let filled = comp;
  if (en > 20) { // 떼어 낸 부위가 있던 자리 전체(조금 넓혀서)는 AI가 참고하지 못하게 가리고, 남은 몸과 진짜 배경만 보고 메워요
    tk && tk.set('떼어 낸 자리를 메우는 중…', 0.5); const mf = new Float32Array(n); for (let i = 0; i < n; i++) mf[i] = M[i] / 255; const mb = dpBox(mf, W, H, 3), ign = new Float32Array(n); for (let i = 0; i < n; i++) ign[i] = mb[i] > 0.02 ? 1 : 0;
    filled = await rgFillRegion(comp, enc, W, H, tk, ign);
  }
  const fm = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) { const j = i * 4, e = enc[i]; if (e > 0.02) { d[j] = filled[j]; d[j + 1] = filled[j + 1]; d[j + 2] = filled[j + 2]; fm[i] = Math.round(e * 255); } d[j + 3] = Math.max(rem[i], Math.round(e * 255)); }
  const oldFill = L.fillM; rgSetTex(L, id); L.fillM = oldFill; rgAddFill(L, fm, n);
  // 새로 드러난 배경(떼어 낸 자리 중 몸으로 메우지 않은 곳)도 가까이에서 다시 메워요
  try { const R = new Uint8ClampedArray(n); let rn = 0; for (let i = 0; i < n; i++) if (M[i] > 128 && enc[i] < 0.5 && pd[i * 4 + 3] > 128) { R[i] = 255; rn++; } if (rn > 60) { tk && tk.set('드러난 배경을 다시 메우는 중…', 0.8); await rgRefillBg(rig, R, chars || [rig], tk); } } catch (e) { if (String(e && e.message) === 'stop') throw e; console.warn('rgRefillBg', e); }
  const N = { id: 'p' + uid(), name: name || '부위', z: Math.max(...rig.layers.map(l => l.z || 0)) + 1, bind: [], follow: null }; rgSetTex(N, part);
  // 이 부위 안을 지나가는 뼈는 이 부위가 가져가요
  const A = rgAlpha(N, W, H);
  for (const jid of RG_IDS) { if (jid === 'fix' || !rgOn(rig, jid)) continue; const ks = rgKids(rig, jid); if (!ks.length) continue; let tot = 0, hit = 0; for (const kid of ks) { const a = rig.joints[jid], b = rig.joints[kid], m = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4)); for (let i = 0; i <= m; i++) { const x = Math.round(a.x + (b.x - a.x) * i / m), y = Math.round(a.y + (b.y - a.y) * i / m); tot++; if (x >= 0 && y >= 0 && x < W && y < H && A[y * W + x] > 128) hit++; } } if (tot && hit / tot >= 0.6 && !['root', 'waist', 'spine', 'chest'].includes(jid) && !rig.layers.some(o => !o.base && o.bind && o.bind.includes(jid))) N.bind.push(jid); }
  rig.layers.push(N); rig.ver++;
  return N;
}
// 캐릭터에서 빼기(배경에 원래 그림을 돌려놓기) / 캐릭터에 넣기(원래 그림에서 가져오기)
async function rgCarve(rig, L, M, add, tk) {
  const { W, H } = rig, n = W * H, id = rgTexPx(L, W, H), d = id.data, sd = rig.src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data, bid = rig.bg.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
  if (add) {
    for (let i = 0; i < n; i++) { const m = M[i]; if (!m) continue; const j = i * 4; if (m > d[j + 3]) { d[j] = sd[j]; d[j + 1] = sd[j + 1]; d[j + 2] = sd[j + 2]; d[j + 3] = m; } }
    const mm = new Float32Array(n); for (let i = 0; i < n; i++) mm[i] = M[i] / 255; const mb = dpBox(mm, W, H, Math.max(3, Math.round(Math.max(W, H) / 90))), hole = new Float32Array(n); for (let i = 0; i < n; i++) hole[i] = clamp(mb[i] * 3, 0, 1);
    tk && tk.set('넣은 자리 뒤 배경을 메우는 중…', 0.5);
    const f = await rgFillRegion(bid.data, hole, W, H, tk); bid.data.set(f);
  } else for (let i = 0; i < n; i++) { const m = M[i] / 255; if (!m) continue; const j = i * 4, a = d[j + 3] / 255 * m; d[j + 3] = Math.round(d[j + 3] * (1 - m)); if (a > 0) for (let k = 0; k < 3; k++) bid.data[j + k] = bid.data[j + k] * (1 - m) + sd[j + k] * m; }
  rgSetTex(L, id); const nb = newCanvas(W, H); nb.getContext('2d').putImageData(bid, 0, 0); rig.bg = nb; rig.ver++;
}
function rgMerge(rig, L) { // 부위를 다시 몸에 합치기
  const base = rig.layers.find(l => l.base); if (!base || L === base) return;
  const c = newCanvas(rig.W, rig.H), g = c.getContext('2d'); g.drawImage(base.tex, 0, 0); g.drawImage(L.tex, 0, 0); base.tex = c; base.A = null; base.mesh = null;
  rig.layers.splice(rig.layers.indexOf(L), 1); rig.ver++;
}
// 칠한 곳을 AI(MobileSAM)로 물체 윤곽에 맞추기. M: 0~255 → 새 M (못 하면 null)
async function rgSamRefine(rig, M, tk) {
  const { W, H } = rig, b = rgBBox(M, W, H, 128); if (!b) return null;
  const E = await rgSamEnc(rig, tk), { s, tw, th } = E, plane = tw * th;
  // 칠한 곳을 줄여 본 것 + 그 안쪽 깊은 점 몇 개를 '이것'으로
  const mc = newCanvas(tw, th), mg = mc.getContext('2d', { willReadFrequently: true }), full = newCanvas(W, H), fg = full.getContext('2d'), fid = fg.createImageData(W, H);
  for (let i = 0; i < W * H; i++) { fid.data[i * 4] = fid.data[i * 4 + 1] = fid.data[i * 4 + 2] = 255; fid.data[i * 4 + 3] = M[i]; } fg.putImageData(fid, 0, 0); mg.drawImage(full, 0, 0, tw, th);
  const md = mg.getImageData(0, 0, tw, th).data, sm = new Uint8Array(plane); for (let i = 0; i < plane; i++) sm[i] = md[i * 4 + 3] > 128 ? 1 : 0;
  const pts = []; let work = sm.slice();
  for (let k = 0; k < 5; k++) { const dp = czDeepest(work, tw, th); if (!dp || dp[1] < 2) break; const i = dp[0], x = i % tw, y = (i / tw) | 0, r = Math.max(6, dp[1] * 1.6); pts.push([x, y, 1]); for (let yy = Math.max(0, Math.floor(y - r)); yy < Math.min(th, y + r); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx < Math.min(tw, x + r); xx++) if ((xx - x) * (xx - x) + (yy - y) * (yy - y) < r * r) work[yy * tw + xx] = 0; }
  if (!pts.length) return null;
  const r = await rgSamAsk(E, pts, [b.x * s, b.y * s, (b.x + b.w) * s, (b.y + b.h) * s]), m = r.m; let best = -1, bs = -1, na = 0; for (let i = 0; i < plane; i++) na += sm[i];
  for (let k = 0; k < r.nm; k++) { let a = 0, it = 0; for (let i = 0; i < plane; i++) if (m[k * plane + i] > 0) { a++; if (sm[i]) it++; } if (!a) continue; const sc = it / (a + na - it) + (r.iou ? r.iou[k] * 0.25 : 0); if (sc > bs) { bs = sc; best = k; } }
  if (best < 0 || bs < 0.3) return null;
  const bin = new Uint8Array(plane); for (let i = 0; i < plane; i++) bin[i] = m[best * plane + i] > 0 ? 1 : 0;
  return rgUpMask(bin, tw, th, W, H);
}

/* ---- 메운 자리를 더 좋은 그림으로: 내보내서 NAI 인페인트 등으로 다시 그린 뒤 불러와요 ---- */
// what: 층(L) 또는 'bg'. → { pic(다른 부위를 뺀 그림), mask(흰 곳 = 메운 자리), any(메운 자리가 있는지) }
function rgFillExport(main, rig, what) {
  const { W, H } = main, n = W * H, pic = newCanvas(W, H), g = pic.getContext('2d'), M = new Uint8ClampedArray(n); let any = 0;
  g.drawImage(main.bg, 0, 0);
  if (what === 'bg') { const un = new Float32Array(n); for (const c of rgChars(main)) for (const L of c.layers) { const A = rgAlpha(L, W, H); for (let i = 0; i < n; i++) if (A[i] > 20) un[i] = 1; } const gr = dpBox(un, W, H, Math.max(3, Math.round(Math.max(W, H) / 110))); for (let i = 0; i < n; i++) { M[i] = gr[i] > 0.02 ? 255 : 0; if (M[i]) any++; } }
  else { g.drawImage(what.tex, 0, 0); if (what.fillM) for (let i = 0; i < n; i++) { M[i] = what.fillM[i] > 20 ? 255 : 0; if (M[i]) any++; } }
  const mask = newCanvas(W, H), mg = mask.getContext('2d'), mi = mg.createImageData(W, H); for (let i = 0; i < n; i++) { mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = M[i]; mi.data[i * 4 + 3] = 255; } mg.putImageData(mi, 0, 0);
  return { pic, mask, M, any };
}
// 불러온 그림(img)을 넣기: 메운 자리가 기록돼 있으면 그 자리만(가장자리는 부드럽게), 없으면 그 층이 보이는 곳 전체
function rgFillImport(main, rig, what, img) {
  const { W, H } = main, n = W * H, c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, W, H);
  const nd = g.getImageData(0, 0, W, H).data, ex = rgFillExport(main, rig, what), wf = new Float32Array(n);
  if (what === 'bg' || ex.any) { for (let i = 0; i < n; i++) wf[i] = ex.M[i] / 255; const b = dpBox(wf, W, H, 2); for (let i = 0; i < n; i++) wf[i] = clamp(b[i] * 2.2, 0, 1); } else wf.fill(1);
  if (what === 'bg') { const id = main.bg.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < n; i++) { const a = wf[i]; if (a > 0) for (let k = 0; k < 3; k++) d[i * 4 + k] = d[i * 4 + k] * (1 - a) + nd[i * 4 + k] * a; } const nb = newCanvas(W, H); nb.getContext('2d').putImageData(id, 0, 0); for (const ch of rgChars(main)) ch.bg = nb; return true; }
  const id = rgTexPx(what, W, H), d = id.data; for (let i = 0; i < n; i++) { const a = wf[i]; if (a > 0 && d[i * 4 + 3] > 0) for (let k = 0; k < 3; k++) d[i * 4 + k] = d[i * 4 + k] * (1 - a) + nd[i * 4 + k] * a; }
  const keep = what.fillM; rgSetTex(what, id); what.fillM = keep; rig.ver++; return true;
}

/* ---- 보관: 이어서 고칠 수 있게 작업을 통째로 저장 (IndexedDB kv 'rig:작업:이름') ---- */
const rgBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
async function rgStore(main, key) {
  if (!key) return false; const chars = [];
  for (const rig of rgChars(main)) {
    const layers = []; for (const L of rig.layers) { if (!L.blob || L.blobOf !== L.tex) { L.blob = await rgBlob(L.tex, 'image/png'); L.blobOf = L.tex; } if (L.fillM && L.fillBlobOf !== L.fillM) { const fc = newCanvas(rig.W, rig.H), fg = fc.getContext('2d'), fi = fg.createImageData(rig.W, rig.H); for (let i = 0; i < L.fillM.length; i++) { fi.data[i * 4] = fi.data[i * 4 + 1] = fi.data[i * 4 + 2] = L.fillM[i]; fi.data[i * 4 + 3] = 255; } fg.putImageData(fi, 0, 0); L.fillBlob = await rgBlob(fc, 'image/png'); L.fillBlobOf = L.fillM; }
      layers.push({ id: L.id, name: L.name, base: !!L.base, z: L.z || 0, bind: L.bind || null, follow: L.follow || null, hide: !!L.hide, blob: L.blob, fill: L.fillM ? L.fillBlob : null }); }
    chars.push({ cid: rig.cid, cname: rig.cname, cz: rig.cz || 0, joints: rig.joints, conf: rig.conf, autoSk: rig.autoSk, stdOff: !!rig.stdOff, cut: rig.cut || null, edgePin: rig.edgePin, chains: rig.chains || [], zs: rig.zs, pins: rig.pins.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r })), eyes: rig.eyes, mouth: rig.mouth || null, anim: rig.anim, layers });
  }
  if (!main.srcBlob) main.srcBlob = await rgBlob(main.src, 'image/webp', 0.95);
  if (!main.bgBlob || main.bgBlobOf !== main.bg) { main.bgBlob = await rgBlob(main.bg, 'image/webp', 0.95); main.bgBlobOf = main.bg; }
  return !!(await idb.set('rig:' + key, { v: 2, at: Date.now(), W: main.W, H: main.H, gw: main.gw, gh: main.gh, uid: main.uid, out: main.out || null, by: main.by, chars, layers: chars[0].layers, src: main.srcBlob, bg: main.bgBlob }));
}
async function rgRestore(key) {
  const d = key && await idb.get('rig:' + key); if (!d || !d.layers || !d.src) return null;
  const cv = async b => { const bm = await createImageBitmap(b), c = newCanvas(bm.width, bm.height); c.getContext('2d', { willReadFrequently: true }).drawImage(bm, 0, 0); return c; };
  try {
    const src = await cv(d.src), bg = await cv(d.bg), sh = { W: d.W, H: d.H, gw: d.gw, gh: d.gh, src, bg, uid: d.uid || uid(), by: d.by }, list = d.chars || [d], chars = []; // v1은 캐릭터 하나가 통째로 들어 있었어요
    for (let i = 0; i < list.length; i++) {
      const q = list[i], rig = { ...sh, cid: q.cid || 'c' + uid(), cname: q.cname || '캐릭터 ' + (i + 1), cz: q.cz || 0, joints: q.joints, conf: q.conf, autoSk: q.autoSk, stdOff: !!q.stdOff, cut: q.cut || null, edgePin: q.edgePin, chains: q.chains || [], zs: q.zs || {}, pins: q.pins || [], eyes: q.eyes || [], mouth: q.mouth === undefined ? rgFindMouth(src, d.W, d.H, q.eyes || []) : q.mouth, anim: q.anim, ver: 1, layers: [] };
      if (rig.anim.auto.talk === undefined) rig.anim.auto.talk = 0;
      for (const l of q.layers) { const tex = await cv(l.blob), L = { id: l.id, name: l.name, base: l.base, z: l.z, bind: l.bind, follow: l.follow, hide: l.hide, tex, blob: l.blob, blobOf: tex }; if (l.fill) { const fd = (await cv(l.fill)).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, d.W, d.H).data, f = new Uint8ClampedArray(d.W * d.H); for (let i = 0; i < f.length; i++) f[i] = fd[i * 4]; L.fillM = f; L.fillBlob = l.fill; L.fillBlobOf = f; } rig.layers.push(L); }
      chars.push(rig);
    }
    const main = chars[0]; main.more = chars.slice(1); main.out = d.out || null; main.srcBlob = d.src; main.bgBlob = d.bg; main.bgBlobOf = bg;
    return main;
  } catch (e) { console.warn('rgRestore', e); return null; }
}

/* ---- 움직임 견본: 지금 자세(맨 앞 저장 자세)를 바탕으로 시간 막대를 채워요 ---- */
const RG_MOVES = [['nod', '끄덕끄덕'], ['tilt', '갸웃갸웃'], ['lean', '좌우로 흔들'], ['hop', '통통 뛰기'], ['shrug', '으쓱'], ['waveA', '손 흔들기'], ['waveB', '손 흔들기'], ['look', '두리번'], ['pant', '숨 가쁘게'], ['laugh', '웃기'], ['sigh', '한숨·축 처지기'], ['startle', '깜짝 놀라기'], ['shiver', '덜덜 떨기'], ['groove', '리듬 타기'], ['rock', '앞뒤로 세게'], ['jump', '크게 뛰기'], ['walk', '제자리 걷기'], ['cSway', '내 뼈 흔들기'], ['cBend', '내 뼈 굽혔다 펴기'], ['cWave', '내 뼈 물결'], ['cPump', '내 뼈 앞뒤로'], ['cShake', '내 뼈 떨기']];
// 견본마다 있어야 하는 관절 (없으면 단추를 숨겨요)
const RG_MOVE_NEED = { nod: ['neck'], tilt: ['neck'], look: ['neck'], lean: ['waist'], shrug: ['aSho', 'bSho'], waveA: ['aWri'], waveB: ['bWri'], hop: [], cSway: null, cBend: null, cWave: null, cPump: null, cShake: null, pant: ['chest'], laugh: ['neck', 'chest'], sigh: ['neck', 'chest'], startle: ['neck'], shiver: [], groove: ['waist'], rock: [], jump: [], walk: ['aKnee', 'bKnee'] };
// 견본을 세게·약하게: 맨 앞 자세에서 달라진 만큼만 키우거나 줄여요
function rgMoveAmp(base, mv, amp) {
  if (amp === 1) return mv; const B = base, f = (b, v) => b + (v - b) * amp;
  for (const k of mv.keys) { const p = k.p; for (const id of Object.keys(p.r)) p.r[id] = f(B.r[id] || 0, p.r[id]); for (const id of Object.keys(p.s)) p.s[id] = Math.max(0.3, f(B.s[id] || 1, p.s[id])); for (const id of Object.keys(p.d)) { const b = B.d[id] || [0, 0]; p.d[id] = [f(b[0], p.d[id][0]), f(b[1], p.d[id][1])]; } p.tx = f(B.tx, p.tx); p.ty = f(B.ty, p.ty); p.rot = f(B.rot, p.rot); p.sc = Math.max(0.3, f(B.sc, p.sc)); }
  return mv;
}
function rgMoveKeys(rig, kind, base) {
  const B = rgPoseCopy(base || (rig.anim.keys[0] ? rig.anim.keys[0].p : rgPose0())), U = rgUnit(rig), K = (t, fn, e) => { const p = rgPoseCopy(B); fn && fn(p); return { t, e: e || 'ease', p }; };
  const R = (p, id, v) => { p.r[id] = (p.r[id] || 0) + v; }, D = (p, id, x, y) => { const q = p.d[id] || [0, 0]; p.d[id] = [q[0] + x, q[1] + y]; };
  if (kind === 'nod') return { dur: 2, keys: [K(0), K(0.5, p => { D(p, 'neck', 0, U * 0.035); p.s.neck = (p.s.neck || 1) * 0.97; }), K(1), K(1.5, p => { D(p, 'neck', 0, U * 0.035); p.s.neck = (p.s.neck || 1) * 0.97; })] };
  if (kind === 'tilt') return { dur: 3.2, keys: [K(0), K(0.8, p => R(p, 'neck', 0.13)), K(1.6), K(2.4, p => R(p, 'neck', -0.13))] };
  if (kind === 'lean') return { dur: 3, keys: [K(0, p => { R(p, 'waist', -0.06); R(p, 'neck', 0.04); }), K(1.5, p => { R(p, 'waist', 0.06); R(p, 'neck', -0.04); })] };
  if (kind === 'hop') return { dur: 1, keys: [K(0, null, 'out'), K(0.3, p => { p.ty -= U * 0.09; }, 'in'), K(0.6, p => { p.sc *= 0.985; D(p, 'chest', 0, U * 0.012); }), K(0.75)] };
  if (kind === 'shrug') return { dur: 2.4, keys: [K(0), K(0.5, p => { D(p, 'aSho', 0, -U * 0.06); D(p, 'bSho', 0, -U * 0.06); D(p, 'neck', 0, U * 0.012); }), K(1.1, p => { D(p, 'aSho', 0, -U * 0.06); D(p, 'bSho', 0, -U * 0.06); D(p, 'neck', 0, U * 0.012); }), K(1.6)] };
  if (kind === 'waveA' || kind === 'waveB') { const e = kind === 'waveA' ? 'aElb' : 'bElb', w = kind === 'waveA' ? 'aWri' : 'bWri'; return { dur: 1.2, keys: [K(0, p => { R(p, e, 0.3); R(p, w, 0.15); }), K(0.3, p => { R(p, e, -0.3); R(p, w, -0.15); }), K(0.6, p => { R(p, e, 0.3); R(p, w, 0.15); }), K(0.9, p => { R(p, e, -0.3); R(p, w, -0.15); })] }; }
  const SH = (p, v) => { D(p, 'aSho', 0, -U * v); D(p, 'bSho', 0, -U * v); };
  if (kind === 'pant') { const up = p => { D(p, 'chest', 0, -U * 0.045); SH(p, 0.035); p.s.chest = (p.s.chest || 1) * 1.035; D(p, 'neck', 0, -U * 0.008); R(p, 'neck', -0.015); }; return { dur: 1, keys: [K(0, p => { D(p, 'chest', 0, U * 0.01); }, 'out'), K(0.42, up, 'ease'), K(0.55, up, 'in')] }; }
  if (kind === 'laugh') { const n = 8, dur = 1.6, keys = []; for (let f = 0; f < n; f++) keys.push(K(dur * f / n, p => { const u = f % 2 === 0; R(p, 'neck', 0.05 + (u ? 0.025 : 0)); D(p, 'chest', 0, u ? -U * 0.035 : U * 0.008); SH(p, u ? 0.045 : 0.01); D(p, 'neck', 0, u ? -U * 0.012 : 0); p.ty += u ? -U * 0.008 : 0; })); return { dur, keys }; }
  if (kind === 'sigh') { const dn = p => { D(p, 'chest', 0, U * 0.04); D(p, 'neck', 0, U * 0.03); R(p, 'neck', 0.07); SH(p, -0.035); p.s.chest = (p.s.chest || 1) * 0.975; }; return { dur: 4.4, keys: [K(0), K(1.1, p => { D(p, 'chest', 0, -U * 0.04); SH(p, 0.03); p.s.chest = (p.s.chest || 1) * 1.03; R(p, 'neck', -0.03); }), K(2.2, dn), K(3.5, dn)] }; }
  if (kind === 'startle') { const j = (p, a) => { p.ty -= U * 0.05 * a; SH(p, 0.08 * a); D(p, 'neck', 0, -U * 0.02 * a); p.s.neck = (p.s.neck || 1) * (1 + 0.03 * a); R(p, 'waist', -0.02 * a); }; return { dur: 2.4, keys: [K(0, null, 'out'), K(0.12, p => j(p, 1)), K(0.3, p => j(p, 0.7)), K(0.42, p => j(p, 0.85)), K(1.1, p => j(p, 0.6)), K(1.9)] }; }
  if (kind === 'shiver') { const n = 10, dur = 1, keys = []; for (let f = 0; f < n; f++) keys.push(K(dur * f / n, p => { const sg = f % 2 ? 1 : -1, a = 0.7 + 0.3 * Math.sin(f * 1.9); p.tx += sg * U * 0.012 * a; R(p, 'neck', sg * 0.012 * a); SH(p, 0.04); D(p, 'aSho', sg * U * 0.006, 0); D(p, 'bSho', sg * U * 0.006, 0); }, 'linear')); return { dur, keys }; }
  if (kind === 'groove') { const side = (p, sg) => { R(p, 'waist', sg * 0.08); D(p, rgBase(rig), sg * U * 0.035, 0); R(p, 'neck', -sg * 0.06); R(p, 'aSho', sg * 0.1); R(p, 'bSho', sg * 0.1); R(p, 'aElb', -sg * 0.12); R(p, 'bElb', -sg * 0.12); }, dip = (p, sg) => { p.ty += U * 0.03; R(p, 'waist', sg * 0.02); D(p, 'chest', 0, U * 0.012); }; return { dur: 2, keys: [K(0, p => side(p, -1)), K(0.25, p => dip(p, -1)), K(0.5, p => side(p, 1)), K(0.75, p => dip(p, 1)), K(1, p => side(p, -1)), K(1.25, p => dip(p, -1)), K(1.5, p => side(p, 1)), K(1.75, p => dip(p, 1))] }; }
  if (kind === 'rock') return { dur: 0.9, keys: [K(0, p => { p.tx -= U * 0.05; p.rot -= 0.02; R(p, 'neck', 0.045); D(p, 'chest', 0, U * 0.01); }, 'ease'), K(0.45, p => { p.tx += U * 0.06; p.rot += 0.025; R(p, 'neck', -0.055); D(p, 'chest', 0, -U * 0.018); SH(p, 0.015); }, 'ease')] };
  if (kind === 'jump') return { dur: 1.6, keys: [K(0, null, 'ease'), K(0.3, p => { p.sc *= 0.96; p.ty += U * 0.05; SH(p, -0.02); R(p, 'aElb', 0.1); R(p, 'bElb', -0.1); }, 'out'), K(0.62, p => { p.ty -= U * 0.24; p.sc *= 1.02; SH(p, 0.06); D(p, 'neck', 0, -U * 0.012); }, 'in'), K(0.95, p => { p.sc *= 0.965; p.ty += U * 0.04; SH(p, -0.03); D(p, 'chest', 0, U * 0.02); }, 'out'), K(1.2)] };
  if (kind === 'walk') { const st = (p, sg) => { const u = sg > 0 ? 'a' : 'b', o = sg > 0 ? 'b' : 'a'; R(p, u + 'Hip', 0.16); R(p, u + 'Knee', -0.3); R(p, o + 'Hip', -0.05); R(p, u + 'Sho', -0.12); R(p, o + 'Sho', 0.12); R(p, u + 'Elb', -0.08); R(p, o + 'Elb', 0.08); R(p, 'waist', sg * 0.025); p.ty -= U * 0.02; }, mid = p => { p.ty += U * 0.012; }; return { dur: 1.2, keys: [K(0, p => st(p, 1)), K(0.3, mid), K(0.6, p => st(p, -1)), K(0.9, mid)] }; }
  if (kind === 'cWave' || kind === 'cPump' || kind === 'cShake') {
    const cs = (rig.chains || []).filter(c => c.ids.length > 1 && rgOn(rig, c.ids[1])); if (!cs.length) return null;
    const n = kind === 'cShake' ? 10 : 8, dur = kind === 'cWave' ? 1.8 : kind === 'cPump' ? 1 : 0.8, keys = [];
    for (let f = 0; f < n; f++) keys.push(K(dur * f / n, p => { for (const c of cs) { const x = 2 * Math.PI * f / n, m = c.ids.length - 1;
      if (kind === 'cWave') c.ids.slice(0, -1).forEach((id, i) => R(p, id, 0.1 * (0.5 + i * 0.5) * Math.sin(x - i * 1.3)));
      else if (kind === 'cPump') { const a0 = rig.joints[c.ids[0]], b0 = rig.joints[c.ids[m]], l = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1, e = Math.sin(x) * 0.08 * l; D(p, c.ids[0], (b0.x - a0.x) / l * e, (b0.y - a0.y) / l * e); c.ids.slice(1, -1).forEach((id, i) => R(p, id, 0.035 * Math.sin(x - 0.9 - i * 0.5))); }
      else c.ids.slice(0, -1).forEach((id, i) => R(p, id, (f % 2 ? 1 : -1) * 0.03 * (i ? 1.3 : 1) * (0.7 + 0.3 * Math.sin(f * 1.9 + i))));
    } }, 'linear'));
    return { dur, keys };
  }
  if (kind === 'cSway' || kind === 'cBend') { // 내 뼈마다: 뿌리부터 끝으로 갈수록 조금씩 늦게 (물결처럼)
    const cs = (rig.chains || []).filter(c => c.ids.length > 1 && rgOn(rig, c.ids[1])); if (!cs.length) return null;
    const n = 8, dur = kind === 'cSway' ? 2 : 2.4, keys = [];
    for (let f = 0; f < n; f++) { const t = dur * f / n; keys.push(K(t, p => { for (const c of cs) c.ids.slice(0, -1).forEach((id, i) => { const ph = 2 * Math.PI * f / n - i * 0.7; R(p, id, kind === 'cSway' ? 0.16 * Math.sin(ph) / (1 + i * 0.25) : 0.22 * (0.5 - 0.5 * Math.cos(2 * Math.PI * f / n)) * (i ? 1 : 0.6)); }); }, 'linear')); }
    return { dur, keys };
  }
  if (kind === 'look') return { dur: 4, keys: [K(0), K(0.7, p => { D(p, 'neck', -U * 0.03, 0); R(p, 'neck', -0.05); }), K(1.7, p => { D(p, 'neck', -U * 0.03, 0); R(p, 'neck', -0.05); }), K(2.4, p => { D(p, 'neck', U * 0.03, 0); R(p, 'neck', 0.05); }), K(3.4, p => { D(p, 'neck', U * 0.03, 0); R(p, 'neck', 0.05); })] };
  return null;
}
// 늘어진 곳(머리카락 다발·꼬리·옷자락·귀 등)을 찾아 뼈를 알아서 넣기 → 새로 넣은 뼈들
function rgAutoBones(rig, max) {
  const L = rig.layers.find(l => l.base); if (!L || rig.stdOff) return [];
  const m = L.mesh && L.mesh.ver === rig.ver && L.mesh.relC ? L.mesh : rgBuildLayer(rig, L), { gw, gh, W, H } = rig, gx = W / gw, gy = H / gh, g = Math.min(gx, gy), nC = gw * gh, inC = m.inC, U = rgUnit(rig);
  const seeds = []; for (let c = 0; c < nC; c++) if (inC[c] && m.relC[c] < 1.35) seeds.push(c); if (!seeds.length) return [];
  const D = rgGeo(inC, gw, gh, seeds), minL = Math.max(5, U * 0.2 / g), taken = new Uint8Array(nC), ord = [];
  for (let c = 0; c < nC; c++) if (inC[c] && D[c] !== Infinity && D[c] >= minL) ord.push(c); ord.sort((a, b) => D[b] - D[a]);
  const used = new Set((rig.chains || []).flatMap(c => c.ids)), free = RG_X.filter(x => !used.has(x)), made = [];
  // 이미 내 뼈가 지나가는 곳은 건너뛰어요
  const mark = (cx, cy, r) => { for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(gh - 1, cy + r); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(gw - 1, cx + r); x++) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) taken[y * gw + x] = 1; };
  for (const c of rig.chains || []) for (let i = 1; i < c.ids.length; i++) { const a = rig.joints[c.ids[i - 1]], b = rig.joints[c.ids[i]]; if (!a || !b) continue; for (let t = 0; t <= 1; t += 0.1) mark((a.x + (b.x - a.x) * t) / gx, (a.y + (b.y - a.y) * t) / gy, Math.max(3, minL * 0.6)); }
  for (const tip of ord) {
    if (made.length >= max || free.length < 3) break; if (taken[tip]) continue;
    const path = [tip]; let cur = tip, guard = 0;
    while (D[cur] > 0 && guard++ < 4000) { const x = cur % gw, y = (cur / gw) | 0; let best = -1, bd = D[cur]; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue; const q = yy * gw + xx; if (inC[q] && D[q] < bd) { bd = D[q]; best = q; } } if (best < 0) break; cur = best; path.push(cur); }
    if (D[cur] > 0 || path.length < minL) { mark(tip % gw, (tip / gw) | 0, 3); continue; }
    if (path.slice(0, Math.ceil(path.length * 0.7)).some(q => taken[q])) { mark(tip % gw, (tip / gw) | 0, 3); continue; } // 이미 뼈를 넣은 다발과 같은 줄기
    const len = path.length * g, np = len > U * 0.75 && free.length >= 4 ? 4 : 3, pts = [];
    for (let i = 0; i < np; i++) { const f = 0.72 - (i / (np - 1)) * 0.66, q = path[Math.min(path.length - 1, Math.round(f * (path.length - 1)))]; pts.push({ x: (q % gw + 0.5) * gx, y: (((q / gw) | 0) + 0.5) * gy }); }
    let attach = null, bd = 1e18; for (const id of RG_STD) { if (!rgOn(rig, id)) continue; for (const kid of rgKids(rig, id)) { if (!RG_J[kid]) continue; const r = rgSegDist(pts[0].x, pts[0].y, rig.joints[id], rig.joints[kid]); if (r.d < bd) { bd = r.d; attach = r.t > 0.85 && rgKids(rig, kid).some(q => RG_J[q]) ? kid : id; } } }
    const ids = free.splice(0, np); ids.forEach((id, i) => { rig.joints[id] = { x: pts[i].x, y: pts[i].y, on: true }; });
    if (!rig.chains) rig.chains = []; const no = rig.chains.filter(q => q.auto).length + 1;
    const ch = { id: 'k' + uid(), kind: 'free', name: '자동 뼈 ' + no, attach, ids, z: attach ? RG_J[attach][2] : 0, auto: true, am: { kind: len > U * 0.75 ? 'wave' : 'sway', amt: 40, sp: Math.round(85 + 30 * rgHash(no * 3.1)), ph: Math.round(100 * rgHash(no * 7.7)) } };
    rig.chains.push(ch); made.push(ch);
    const w = Math.max(3, path.length * 0.38); for (const q of path) mark(q % gw, (q / gw) | 0, w);
  }
  if (made.length) rig.ver++;
  return made;
}
// 화면에서 어느 쪽 팔·다리인지 (이름표용)
const rgSideName = (rig, limb) => { const mine = rig.joints[RG_LIMBS[limb][0]], oth = rig.joints[RG_LIMBS[limb.slice(0, 3) + (limb.endsWith('A') ? 'B' : 'A')][0]]; return (mine.x < oth.x ? '왼쪽 ' : '오른쪽 ') + (limb.startsWith('arm') ? '팔' : '다리'); };
const rgLimbOf = id => Object.keys(RG_LIMBS).find(k => RG_LIMBS[k].includes(id)) || null;

/* ---- 여러 장 그려 내기 ---- */
// o: {size(긴 쪽), fps, bg: 'fill'|'color'|'none', color} → [캔버스…]
async function rgRenderFrames(rig, o, tk, one) {
  const k = Math.min(1, o.size / Math.max(rig.W, rig.H)), w = Math.max(2, Math.round(rig.W * k)), h = Math.max(2, Math.round(rig.H * k)), cv = newCanvas(w, h), R = rgGLNew(cv), chars = rgChars(rig);
  if (!R) throw new Error('webgl');
  try {
    const A = rig.anim, N = one ? 1 : Math.max(2, Math.round(A.dur * o.fps) + (A.loop ? 0 : 1)), frames = [];
    for (let f = 0; f < N; f++) {
      if (tk && tk.stop) throw new Error('stop');
      const t = one ? o.t : f / o.fps;
      rgGLDraw(R, rig, { k, ox: 0, oy: 0 }, { bg: o.bg, color: o.color, evs: chars.map(c => rgEval(c, t)), t });
      const c = newCanvas(w, h); c.getContext('2d').drawImage(cv, 0, 0); frames.push(c);
      if (tk && !one) { tk.set(`장면 그리는 중… ${f + 1} / ${N}`, (f + 1) / N); if (f % 4 === 3) await new Promise(r => setTimeout(r, 0)); }
    }
    return frames;
  } finally { rgGLFree(R); }
}

/* ---- 창 ---- */
// from: { src(그림·캔버스), W, H, name, key(보관 이름), onFrames(frames, fps, key), onStill(canvas) }
const rgUi = { skel: true };
async function rgOpen(from) {
  if (!czIsApp()) { toast('캐릭터 움직이기는 설치판(exe)에서 AI 팩을 받아 쓸 수 있어요. HTML판에는 들어 있지 않아요.', 4600); return; }
  if (!(await czPacksReady(['base', 'bg', 'erase', 'rig']))) return;
  let rig = null;
  const saved = from.key ? await idb.get('rig:' + from.key) : null;
  if (saved && saved.layers) {
    const pick = await new Promise(res => { const m = modal(`<h2>캐릭터 움직이기</h2><p class="sub">이 그림으로 하던 작업이 남아 있어요. 이어서 할까요?</p><div class="foot"><button class="btn" id="rgNew">처음부터 다시</button><button class="btn primary" id="rgCont">이어서 하기</button></div>`); let done = false; const end = v => { if (!done) { done = true; res(v); } }; $('#rgNew', m).addEventListener('click', () => { closeModal(); end('new'); }); $('#rgCont', m).addEventListener('click', () => { closeModal(); end('cont'); }); new MutationObserver((_, ob) => { if (!m.isConnected) { ob.disconnect(); end(null); } }).observe($('#modalRoot'), { childList: true }); });
    if (!pick) return;
    if (pick === 'cont') rig = await rgRestore(from.key);
  }
  if (!rig) {
    const tk = czProgress('캐릭터 움직이기 준비하는 중');
    try { tk.set('AI 모델 준비하는 중… (처음엔 조금 걸려요)', 0.03); rig = await rgPrepare(from.src, from.W, from.H, tk); tk.done(); }
    catch (e) { tk.done(); const msg = String(e && e.message); if (msg !== 'stop') toast(msg === 'nochar' ? '그림에서 캐릭터를 찾지 못했어요. 캐릭터가 또렷이 보이는 그림으로 해 주세요.' : '준비하지 못했어요. ' + czErrText(e), 5200); return; }
  }
  rgWindow(rig, from);
}
function rgWindow(main, from) {
  let rig = main; // 지금 고치는 캐릭터
  const chars = () => rgChars(main), maxSide = Math.max(main.W, main.H);
  main.out = Object.assign({ size: Math.min(1080, maxSide), fps: 24, bg: 'fill', color: '#ffffff' }, main.out || {}); for (const c of chars()) { c.out = main.out; c.anim.dur = main.anim.dur; c.anim.loop = main.anim.loop; if (c.anim.auto.talk === undefined) c.anim.auto.talk = 0; }
  const st = { mode: rig.autoSk === false ? 'bone' : 'pose', t: 0, playing: false, sel: null, selPin: null, selKey: 0, selLayer: 'body', selEye: -1, tool: 'move', brush: 'smart', bsize: 60, view: { k: 1, ox: 0, oy: 0 }, undo: [], redo: [], ev: null, drag: null, pm: null, pmAny: false, solo: false, busy: false };
  const sizes = [...new Set([480, 720, 1080, 1440, maxSide].filter(v => v <= maxSide))].sort((a, b) => a - b);
  const m = modal(`<div class="rg">
    <div class="rg-head"><h2>캐릭터 움직이기</h2>
      <div class="seg" id="rgModes"><button class="btn sm" data-rgm="bone" title="AI가 찾은 관절이 그림과 안 맞으면 끌어서 맞춰요">① 뼈대 맞추기</button><button class="btn sm" data-rgm="part" title="몸 앞에 겹친 팔, 머리카락 같은 곳을 따로 떼어 내요 (안 해도 돼요)">② 부위 나누기</button><button class="btn sm" data-rgm="pose" title="관절을 끌어 자세를 잡고 시간 막대에 저장해요">③ 움직임 만들기</button></div>
      <span class="flex1"></span>
      <label class="chk" title="뼈대 표시를 숨기고 그림만 봐요 (H)"><input type="checkbox" id="rgSkel" ${rgUi.skel ? 'checked' : ''}> 뼈대 보기</label>
      <button class="btn sm" id="rgUndo" title="Ctrl+Z">되돌리기</button><button class="btn sm" id="rgRedo" title="Ctrl+Shift+Z">다시 하기</button><button class="btn sm" id="rgFit" title="그림을 화면에 맞춰요">화면 맞춤</button>
    </div>
    <div class="rg-main">
      <div class="rg-stage" id="rgStage"><canvas id="rgGL"></canvas><canvas id="rgOv"></canvas><div class="rg-tip" id="rgTip"></div></div>
      <div class="rg-side" id="rgSide"></div>
    </div>
    <div class="rg-time" id="rgTime">
      <div class="rg-tbar"><button class="btn sm" id="rgHome" title="맨 앞으로">⏮</button><button class="btn sm primary" id="rgPlay" title="재생·멈춤 (Space)">▶ 재생</button><span class="rg-clock" id="rgClock"></span>
        <button class="btn sm" id="rgKeyAdd" title="지금 보이는 자세를 이 시각에 저장해요">◆ 자세 저장</button><button class="btn sm" id="rgKeyDel" title="고른 ◆를 지워요 (Delete)">◆ 지우기</button>
        <select id="rgEase" title="고른 ◆에서 다음 ◆로 넘어가는 빠르기"><option value="ease">부드럽게</option><option value="linear">일정하게</option><option value="in">천천히 출발</option><option value="out">천천히 도착</option><option value="hold">뚝 끊어서</option></select>
        <span class="flex1"></span><label class="chk" title="끝에서 처음으로 매끄럽게 이어져요"><input type="checkbox" id="rgLoop"> 반복</label><span class="muted small">길이</span><input type="number" id="rgDur" min="0.5" max="20" step="0.5" style="width:58px"><span class="muted small">초</span></div>
      <div class="rg-track" id="rgTrack"><div class="rg-ticks" id="rgTicks"></div><div class="rg-keys" id="rgKeys"></div><i class="rg-ph" id="rgPh"></i></div>
    </div>
    <div class="foot rg-foot"><span class="muted small">내보내기</span><select id="rgOSize" title="긴 쪽 크기">${sizes.map(v => `<option value="${v}">${v}px</option>`).join('')}</select><select id="rgOFps">${[12, 15, 24, 30].map(v => `<option value="${v}">초당 ${v}장</option>`).join('')}</select><select id="rgOBg"><option value="fill">배경 그대로</option><option value="color">단색 배경</option></select><span id="rgOColW"><input type="color" id="rgOCol"></span>
      <span class="flex1"></span><button class="btn" id="rgClose">닫기</button>${from.onStill ? '<button class="btn" id="rgStill" title="지금 보이는 자세 한 장을 그림 레이어로 넣어요">이 자세를 그림으로</button>' : ''}<button class="btn primary" id="rgGo">${esc(from.goLabel || '영상에 넣기')}</button></div>
  </div>`, { wide: true });
  m.classList.add('rg-modal');
  const bgEl = m.parentElement; bgEl.addEventListener('pointerdown', e => { if (e.target === bgEl) e.stopImmediatePropagation(); }, true); // 바깥을 눌러도 닫히지 않게
  const stage = $('#rgStage', m), cv = $('#rgGL', m), ov = $('#rgOv', m), side = $('#rgSide', m), tip = $('#rgTip', m);
  let R = null; try { R = rgGLNew(cv); } catch (e) { console.warn(e); }
  if (!R) { closeModal(); toast('이 컴퓨터에서 그리기 기능(WebGL)을 쓸 수 없어서 열지 못했어요.', 5000); return; }
  const cur = () => rig, A = () => rig.anim, base = () => rig.layers.find(l => l.base), dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const frameT = t => Math.round(t * rig.out.fps) / rig.out.fps;

  /* 되돌리기 */
  const shot = () => ({ cur: rig, bg: main.bg, cs: chars().map(c => ({ c, j: JSON.stringify({ chains: c.chains || [], stdOff: !!c.stdOff, cut: c.cut || null, edgePin: c.edgePin, joints: c.joints, zs: c.zs, pins: c.pins.map(p => ({ id: p.id, x: p.x, y: p.y, r: p.r })), eyes: c.eyes, mouth: c.mouth || null, anim: c.anim, cz: c.cz || 0, cname: c.cname }), layers: c.layers.map(l => ({ ...l })) })) });
  const snap = () => { st.undo.push(shot()); if (st.undo.length > 60) st.undo.shift(); st.redo.length = 0; };
  const put = s => {
    main.more = s.cs.slice(1).map(q => q.c);
    for (const q of s.cs) { const c = q.c, d = JSON.parse(q.j); c.chains = d.chains || []; c.stdOff = !!d.stdOff; c.cut = d.cut || null; c.edgePin = d.edgePin; c.joints = d.joints; c.zs = d.zs; c.pins = d.pins; c.eyes = d.eyes; c.mouth = d.mouth; c.anim = d.anim; c.cz = d.cz; c.cname = d.cname; c.layers = q.layers.map(l => ({ ...l, mesh: null })); c.bg = s.bg; c.ver++; }
    rig = chars().includes(s.cur) ? s.cur : main; if (!rig.layers.some(l => l.id === st.selLayer)) st.selLayer = 'body'; st.selKey = clamp(st.selKey, 0, rig.anim.keys.length - 1); st.sel = null; st.selPin = null; st.selEye = -1; syncTime(); renderSide(); dirty();
  };
  const undo = () => { const s = st.undo.pop(); if (!s) return; st.redo.push(shot()); put(s); }, redo = () => { const s = st.redo.pop(); if (!s) return; st.undo.push(shot()); put(s); };

  /* 화면 */
  const fit = () => { const cw = cv.width, ch = cv.height, k = Math.min(cw / rig.W, ch / rig.H) * 0.94; st.view = { k, ox: (cw - rig.W * k) / 2, oy: (ch - rig.H * k) / 2 }; dirty(); };
  const resize = () => { const r = stage.getBoundingClientRect(), w = Math.max(50, Math.round(r.width * dpr())), h = Math.max(50, Math.round(r.height * dpr())); if (cv.width === w && cv.height === h) return; const first = !st.sized; cv.width = ov.width = w; cv.height = ov.height = h; st.sized = true; if (first) fit(); else dirty(); };
  let raf = 0, lastNow = 0;
  const dirty = () => { if (!raf) raf = requestAnimationFrame(render); };
  const evOf = c => st.mode === 'pose' ? rgEval(c, st.t) : Object.assign(rgEval(c, 0, rgPose0()), { still: true });
  const switchChar = c => { if (c === rig || !chars().includes(c)) return; rig = c; st.sel = null; st.selPin = null; st.selEye = -1; st.selLayer = 'body'; st.selKey = clamp(st.selKey, 0, rig.anim.keys.length - 1); st.ev = st.evs ? st.evs[chars().indexOf(c)] : null; syncTime(); renderSide(); dirty(); };
  function render(now) {
    raf = 0; if (!m.isConnected) return;
    if (st.playing) { const dt = Math.min(0.1, (now - lastNow) / 1000 || 0); lastNow = now; st.t += dt; if (st.t >= A().dur) { if (A().loop) st.t %= A().dur; else { st.t = A().dur; st.playing = false; syncPlay(); } } syncClock(); raf = requestAnimationFrame(render); }
    const cs = chars(), evs = st.evs = cs.map(evOf), ev = st.ev = evs[cs.indexOf(rig)];
    try { rgGLDraw(R, main, st.view, { bg: st.mode === 'part' && st.solo ? 'none' : main.out.bg, color: main.out.color, evs, t: st.t, solo: st.mode === 'part' && st.solo ? { cid: rig.cid, id: st.selLayer } : null }); } catch (e) { console.warn('rgDraw', e); }
    drawOv(ev);
  }
  const X = x => x * st.view.k + st.view.ox, Y = y => y * st.view.k + st.view.oy;
  const COL = id => !RG_J[id] ? '#c58bff' : /^a(Sho|Elb|Wri|Hand)/.test(id) ? '#ff8a5c' : /^b(Sho|Elb|Wri|Hand)/.test(id) ? '#4fb0ff' : /^a/.test(id) ? '#ffc94a' : /^b/.test(id) ? '#6fe0a0' : '#ffffff';
  // 핀의 지금 자리: 가장 가까운 그물 꼭짓점을 따라가요
  const pinPos = p => { let best = null; for (const L of rig.layers) { const me = L.mesh; if (!me || L.hide) continue; if (p.vL !== L.id || p.vVer !== me || p.vi === undefined) { let bi = -1, bd = 1e18; for (let i = 0; i < me.nV; i++) { const d = (me.V[i * 2] - p.x) ** 2 + (me.V[i * 2 + 1] - p.y) ** 2; if (d < bd) { bd = d; bi = i; } } if (!best || bd < best.bd) best = { L, bi, bd }; } else return { x: me.out[p.vi * 2], y: me.out[p.vi * 2 + 1], L, vi: p.vi }; } if (!best) return { x: p.x, y: p.y }; p.vL = best.L.id; p.vVer = best.L.mesh; p.vi = best.bi; return { x: best.L.mesh.out[best.bi * 2], y: best.L.mesh.out[best.bi * 2 + 1], L: best.L, vi: best.bi }; };
  function drawOv(ev) {
    const g = ov.getContext('2d'), d = dpr(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ov.width, ov.height);
    // 그림 테두리
    g.strokeStyle = 'rgba(120,130,150,.55)'; g.lineWidth = 1; g.strokeRect(X(0) + 0.5, Y(0) + 0.5, rig.W * st.view.k, rig.H * st.view.k);
    if (st.mode === 'part') {
      if (st.pm && st.pmAny) { g.save(); g.globalAlpha = 0.5; g.imageSmoothingEnabled = true; g.drawImage(st.pm, X(0), Y(0), rig.W * st.view.k, rig.H * st.view.k); g.restore(); }
      if (st.showFill) { const L = rig.layers.find(l => l.id === st.selLayer) || base(); if (L.fillM) { if (!st.fillC || st.fillOf !== L.fillM) { const fc = newCanvas(rig.W, rig.H), fg = fc.getContext('2d'), fi = fg.createImageData(rig.W, rig.H); for (let i = 0; i < L.fillM.length; i++) { fi.data[i * 4] = 60; fi.data[i * 4 + 1] = 220; fi.data[i * 4 + 2] = 255; fi.data[i * 4 + 3] = L.fillM[i]; } fg.putImageData(fi, 0, 0); st.fillC = fc; st.fillOf = L.fillM; } g.save(); g.globalAlpha = 0.45; g.drawImage(st.fillC, X(0), Y(0), rig.W * st.view.k, rig.H * st.view.k); g.restore(); } }
      if (st.pmTmp && st.tmpAny) { g.save(); g.globalAlpha = 0.22; g.drawImage(st.pmTmp, X(0), Y(0), rig.W * st.view.k, rig.H * st.view.k); g.restore(); }
      if (st.cur) { g.beginPath(); g.arc(st.cur.x, st.cur.y, st.bsize / 2 * d, 0, 7); g.strokeStyle = '#fff'; g.lineWidth = 1.5 * d; g.stroke(); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 0.75 * d; g.stroke(); }
    }
    if (!rgUi.skel && !(st.mode === 'bone')) return;
    // 다른 캐릭터의 뼈대는 흐리게 (누르면 그 캐릭터로 바뀌어요)
    chars().forEach((c, ci) => { if (c === rig || !st.evs[ci]) return; const Q = st.evs[ci].P; g.globalAlpha = 0.4; for (const id of RG_IDS) { const par = rgPar(id, c); if (!par || !Q[id] || !Q[par]) continue; g.beginPath(); g.moveTo(X(Q[par].x), Y(Q[par].y)); g.lineTo(X(Q[id].x), Y(Q[id].y)); g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 4 * d; g.lineCap = 'round'; g.stroke(); g.strokeStyle = '#d8dde6'; g.lineWidth = 1.8 * d; g.stroke(); } for (const id of RG_IDS) { if (!Q[id]) continue; g.beginPath(); g.arc(X(Q[id].x), Y(Q[id].y), 4 * d, 0, 7); g.fillStyle = '#d8dde6'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 1.2 * d; g.stroke(); } });
    g.globalAlpha = st.mode === 'part' ? 0.45 : 1;
    const P = ev.P;
    for (const id of RG_IDS) { const par = rgPar(id, rig); if (!par || !P[id] || !P[par]) continue; g.beginPath(); g.moveTo(X(P[par].x), Y(P[par].y)); g.lineTo(X(P[id].x), Y(P[id].y)); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 5 * d; g.lineCap = 'round'; g.stroke(); g.strokeStyle = COL(id); g.lineWidth = 2.5 * d; g.stroke(); }
    for (const id of RG_IDS) { if (!P[id]) continue; const s = st.sel === id, r = (id === rgBase(rig) ? 7 : 5.5) * d * (s ? 1.35 : 1); g.beginPath(); if (id === rgBase(rig)) g.rect(X(P[id].x) - r, Y(P[id].y) - r, r * 2, r * 2); else g.arc(X(P[id].x), Y(P[id].y), r, 0, 7); g.fillStyle = s ? '#ffe14a' : COL(id); g.fill(); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1.5 * d; g.stroke(); }
    for (const c of rig.chains || []) { const q = P[c.ids[0]]; if (!q || rgPar(c.ids[0], rig) !== 'fix') continue; const r = 9 * d; g.strokeStyle = '#c58bff'; g.lineWidth = 1.5 * d; g.strokeRect(X(q.x) - r, Y(q.y) - r, r * 2, r * 2); }
    // 내 뼈 그리는 중: 찍은 점과 다음 점 안내
    if (st.draft) { const D = st.draft, pts = D.pts.map(q => [X(q.x), Y(q.y)]); if (st.cur && pts.length) pts.push([st.cur.x, st.cur.y]); g.setLineDash([6 * d, 4 * d]); g.strokeStyle = '#c58bff'; g.lineWidth = 2.5 * d; g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); g.setLineDash([]); D.pts.forEach(q => { g.beginPath(); g.arc(X(q.x), Y(q.y), 6 * d, 0, 7); g.fillStyle = '#c58bff'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1.5 * d; g.stroke(); });
      if (st.cur) { const nm = rgDraftName(D); g.font = `${12 * d}px sans-serif`; const tw = g.measureText(nm).width; g.fillStyle = 'rgba(20,22,26,.85)'; g.fillRect(st.cur.x + 12 * d, st.cur.y + 10 * d, tw + 12 * d, 20 * d); g.fillStyle = '#fff'; g.fillText(nm, st.cur.x + 18 * d, st.cur.y + 24 * d); } }
    g.globalAlpha = 1;
    if (st.mode === 'pose') for (const p of rig.pins) { const q = pinPos(p), s = st.selPin === p.id, r = 6.5 * d * (s ? 1.3 : 1); g.save(); g.translate(X(q.x), Y(q.y)); g.rotate(Math.PI / 4); g.fillStyle = s ? '#ffe14a' : '#ff5fd0'; g.fillRect(-r, -r, r * 2, r * 2); g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1.5 * d; g.strokeRect(-r, -r, r * 2, r * 2); g.restore(); if (s) { g.beginPath(); g.arc(X(q.x), Y(q.y), p.r * st.view.k, 0, 7); g.setLineDash([5 * d, 4 * d]); g.strokeStyle = 'rgba(255,95,208,.9)'; g.lineWidth = 1.2 * d; g.stroke(); g.setLineDash([]); } }
    if (st.mode === 'bone') rig.eyes.forEach((e, i) => { g.strokeStyle = e.on === false ? 'rgba(150,150,150,.8)' : i === st.selEye ? '#ffe14a' : '#5cf0ff'; g.lineWidth = 2 * d; g.strokeRect(X(e.x), Y(e.y), e.w * st.view.k, e.h * st.view.k); g.fillStyle = g.strokeStyle; g.fillRect(X(e.x + e.w) - 4 * d, Y(e.y + e.h) - 4 * d, 8 * d, 8 * d); });
    if (st.mode === 'bone' && rig.mouth) { const e = rig.mouth; g.strokeStyle = e.on === false ? 'rgba(150,150,150,.8)' : st.selEye === 'm' ? '#ffe14a' : '#ff7ad9'; g.lineWidth = 2 * d; g.strokeRect(X(e.x), Y(e.y), e.w * st.view.k, e.h * st.view.k); g.fillStyle = g.strokeStyle; g.fillRect(X(e.x + e.w) - 4 * d, Y(e.y + e.h) - 4 * d, 8 * d, 8 * d); }
  }

  /* 시간 막대 */
  const keyAt = (t, tol) => A().keys.findIndex(k => Math.abs(k.t - t) <= (tol || 0.5 / rig.out.fps));
  const keyHere = make => { if (make) st.mvBase = null; let i = keyAt(st.t); if (i < 0 && make) { const k = { t: clamp(frameT(st.t), 0, A().dur), e: 'ease', p: rgKeyPose(rig, st.t) }; A().keys.push(k); A().keys.sort((a, b) => a.t - b.t); i = A().keys.indexOf(k); syncTime(); } if (i >= 0) st.selKey = i; return i >= 0 ? A().keys[i] : null; };
  const syncClock = () => { $('#rgClock', m).textContent = `${st.t.toFixed(2)} / ${A().dur.toFixed(2)}초`; $('#rgPh', m).style.left = (st.t / A().dur * 100) + '%'; };
  const syncPlay = () => { $('#rgPlay', m).textContent = st.playing ? '❚❚ 멈춤' : '▶ 재생'; };
  function syncTime() {
    const a = A(); $('#rgDur', m).value = a.dur; $('#rgLoop', m).checked = !!a.loop;
    const step = a.dur <= 4 ? 0.5 : a.dur <= 10 ? 1 : 2; let h = ''; for (let t = 0; t <= a.dur + 1e-6; t += step) h += `<span style="left:${t / a.dur * 100}%">${+t.toFixed(1)}</span>`; $('#rgTicks', m).innerHTML = h;
    $('#rgKeys', m).innerHTML = a.keys.map((k, i) => `<b class="${i === st.selKey ? 'on' : ''}" data-k="${i}" style="left:${k.t / a.dur * 100}%" title="${k.t.toFixed(2)}초에 저장한 자세. 끌어서 옮겨요">◆</b>`).join('');
    const k = a.keys[st.selKey]; $('#rgEase', m).value = k ? k.e || 'ease' : 'ease'; $('#rgKeyDel', m).disabled = a.keys.length < 2; syncClock();
  }
  const setT = t => { st.t = clamp(t, 0, A().dur); const i = keyAt(st.t); if (i >= 0 && i !== st.selKey) { st.selKey = i; syncTime(); } else syncClock(); if (st.mode === 'pose') renderSideSoon(); dirty(); };
  const track = $('#rgTrack', m);
  track.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.preventDefault(); track.setPointerCapture(e.pointerId);
    const kEl = e.target.closest('[data-k]'), r = track.getBoundingClientRect(), tOf = ev => clamp((ev.clientX - r.left) / r.width, 0, 1) * A().dur;
    if (st.playing) { st.playing = false; syncPlay(); }
    if (st.mode !== 'pose') setMode('pose');
    if (kEl) { const i = +kEl.dataset.k, key = A().keys[i]; st.selKey = i; let moved = false; setT(key.t); syncTime();
      const mv = ev => { const t = frameT(tOf(ev)); if (Math.abs(t - key.t) < 1e-6 || A().keys.some(q => q !== key && Math.abs(q.t - t) < 1e-6)) return; if (!moved) { snap(); moved = true; } key.t = t; A().keys.sort((a, b) => a.t - b.t); st.selKey = A().keys.indexOf(key); st.t = t; syncTime(); dirty(); };
      const up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
      track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up); return; }
    setT(frameT(tOf(e)));
    const mv = ev => setT(frameT(tOf(ev))), up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); track.removeEventListener('pointercancel', up); };
    track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
  });
  $('#rgPlay', m).addEventListener('click', () => togglePlay());
  const togglePlay = () => { if (st.mode !== 'pose') setMode('pose'); st.playing = !st.playing; if (st.playing && !A().loop && st.t >= A().dur - 1e-3) st.t = 0; lastNow = performance.now(); syncPlay(); dirty(); if (!st.playing) renderSide(); };
  $('#rgHome', m).addEventListener('click', () => setT(0));
  $('#rgKeyAdd', m).addEventListener('click', () => { if (st.mode !== 'pose') setMode('pose'); if (keyAt(st.t) >= 0) { toast('이 시각에는 이미 저장한 자세가 있어요. 관절을 끌면 바로 고쳐져요.'); return; } snap(); keyHere(true); syncTime(); toast('지금 자세를 ' + st.t.toFixed(2) + '초에 저장했어요'); });
  const delKey = () => { const a = A(); if (a.keys.length < 2 || !a.keys[st.selKey]) return; snap(); a.keys.splice(st.selKey, 1); st.selKey = clamp(st.selKey, 0, a.keys.length - 1); syncTime(); renderSide(); dirty(); };
  $('#rgKeyDel', m).addEventListener('click', delKey);
  $('#rgEase', m).addEventListener('change', e => { const k = A().keys[st.selKey]; if (!k) return; snap(); k.e = e.target.value; dirty(); });
  $('#rgLoop', m).addEventListener('change', e => { snap(); for (const c of chars()) c.anim.loop = e.target.checked; dirty(); });
  const setDur = v => { for (const c of chars()) { const a = c.anim; a.dur = v; for (const k of a.keys) k.t = Math.min(k.t, v); a.keys = a.keys.filter((k, i) => !a.keys.some((q, j) => j < i && Math.abs(q.t - k.t) < 1e-6)); } st.selKey = clamp(st.selKey, 0, A().keys.length - 1); st.t = Math.min(st.t, v); };
  $('#rgDur', m).addEventListener('change', e => { const v = clamp(+e.target.value || 3, 0.5, 20); snap(); setDur(v); syncTime(); dirty(); });

  /* 오른쪽 칸 */
  let sideT = 0; const renderSideSoon = () => { clearTimeout(sideT); sideT = setTimeout(() => { if (m.isConnected && !st.drag) renderSide(); }, 120); };
  const rng = (label, attr, val, min, max, step, tipTxt) => `<span title="${tipTxt || ''}">${label}</span><span><input type="range" ${attr} min="${min}" max="${max}" step="${step || 1}" value="${val}"></span>`;
  const selName = id => { const l = rgLimbOf(id); return (l ? rgSideName(rig, l) + ' ' : '') + rgJName(rig, id); };
  const rgDraftName = D => { const k = RG_CHAIN_KINDS[D.kind]; return (k.pts[D.pts.length] || '점 ' + (D.pts.length + 1)) + ` 자리를 누르세요 (${D.pts.length + 1}/${k.pts.length})`; };
  // 내 뼈 만들기
  const chainStart = kind => { st.draft = { kind, pts: [] }; st.sel = null; st.selEye = -1; renderSide(); dirty(); };
  const chainFinish = () => {
    const D = st.draft; st.draft = null; if (!D || D.pts.length < 2) { renderSide(); dirty(); if (D && D.pts.length) toast('점을 두 개 이상 찍어야 뼈가 돼요'); return; }
    const used = new Set((rig.chains || []).flatMap(c => c.ids)), free = RG_X.filter(x => !used.has(x)); if (free.length < D.pts.length) { toast('내 뼈 점은 캐릭터마다 ' + RG_XN + '개까지예요'); renderSide(); dirty(); return; }
    snap(); const ids = free.slice(0, D.pts.length), k = RG_CHAIN_KINDS[D.kind], same = (rig.chains || []).filter(c => c.kind === D.kind).length;
    ids.forEach((id, i) => { rig.joints[id] = { x: clamp(D.pts[i].x, 0, rig.W), y: clamp(D.pts[i].y, 0, rig.H), on: true }; });
    // 사람 모양 뼈대를 쓰고 있으면 가장 가까운 뼈에 붙여요 (꼬리는 골반에, 손은 손목에…)
    let attach = null; if (!rig.stdOff) { let bd = rgUnit(rig) * 0.35; for (const id of RG_STD) { if (!rgOn(rig, id)) continue; for (const kid of rgKids(rig, id)) { if (!RG_J[kid]) continue; const r = rgSegDist(D.pts[0].x, D.pts[0].y, rig.joints[id], rig.joints[kid]); if (r.d < bd) { bd = r.d; attach = r.t > 0.85 && rgKids(rig, kid).some(q => RG_J[q]) ? kid : id; } } } }
    if (!rig.chains) rig.chains = []; const c = { id: 'k' + uid(), kind: D.kind, name: k.name + (same ? ' ' + (same + 1) : ''), attach, ids, z: 1.5 }; rig.chains.push(c); rig.ver++;
    st.sel = ids[Math.min(ids.length - 1, 2)]; renderSide(); dirty();
    toast(`'${c.name}' 뼈를 넣었어요. ③ 움직임 만들기에서 ${rgJName(rig, ids[ids.length - 1])}이나 ${rgJName(rig, ids[Math.max(1, ids.length - 2)])}을(를) 끌어 보세요.${attach ? '' : ' 뼈에서 먼 곳은 제자리에 있어요.'}`, 5200);
  };
  const chainDel = cid => { const c = (rig.chains || []).find(q => q.id === cid); if (!c) return; snap(); for (const id of c.ids) { delete rig.joints[id]; for (const k of A().keys) { delete k.p.r[id]; delete k.p.d[id]; delete k.p.s[id]; } } for (const L of rig.layers) { if (L.bind) L.bind = L.bind.filter(id => !c.ids.includes(id)); if (c.ids.includes(L.follow)) L.follow = null; } rig.chains = rig.chains.filter(q => q !== c); if (c.ids.includes(st.sel)) st.sel = null; rig.ver++; renderSide(); dirty(); };
  function renderSide() {
    const a = A().auto, hasMouth = !!(rig.mouth && rig.mouth.on !== false); let h = '';
    if (chars().length > 1) h += `<div class="sec"><h3>캐릭터 (${chars().length}명)</h3><p class="muted small">고친 내용은 고른 캐릭터에만 들어가요. 그림에서 캐릭터를 눌러도 바뀌어요.</p><div class="btnrow">${[...chars()].sort((x, y) => x.cname.localeCompare(y.cname)).map(c => `<button class="btn sm ${c === rig ? 'on' : ''}" data-rgc="${c.cid}">${esc(c.cname)}</button>`).join('')}</div><div class="btnrow"><button class="btn sm" data-rga="cfront" title="이 캐릭터를 다른 캐릭터 앞에 그려요">앞으로</button><button class="btn sm" data-rga="cback" title="이 캐릭터를 다른 캐릭터 뒤에 그려요">뒤로</button><button class="btn sm" data-rga="crename">이름</button></div></div>`;
    if (st.mode === 'pose') {
      const key = A().keys[keyAt(st.t)] || null, p = rgKeyPose(rig, st.t), sj = st.sel && rgOn(rig, st.sel) ? st.sel : null, limb = sj && rgLimbOf(sj), pin = rig.pins.find(q => q.id === st.selPin);
      if (rig.stdOff && !(rig.chains || []).length) h += `<div class="sec"><p class="small"><b>아직 뼈가 없어요.</b> ① 뼈대 맞추기의 '내 뼈'에서 움직일 곳(손·팔·다리·목 등)에 뼈를 넣어 주세요. 뼈가 없어도 숨쉬기·깜빡임·살랑임·전체 크기·기울기는 쓸 수 있어요.</p><div class="btnrow"><button class="btn sm primary" data-rgm2="bone">뼈 넣으러 가기</button></div></div>`;
      h += `<div class="sec"><h3>자세 잡기</h3><p class="muted small">동그란 <b>관절을 끌면</b> 그 부분이 움직여요. 손목·발목을 끌면 팔꿈치·무릎이 알아서 굽어요. 네모(골반)를 끌면 통째로 옮겨요.<br>Ctrl+끌기 = 늘이기, Alt+끌기 = 그 마디만 돌리기.<br>시간 막대의 다른 곳에서 자세를 바꾸면 ◆가 새로 생기고, ◆ 사이는 저절로 이어져요.</p>
        <div class="btnrow"><button class="btn sm" data-rga="pose0" title="이 시각의 자세를 처음 그림 그대로 돌려요">이 자세 처음대로</button><button class="btn sm ${st.tool === 'pin' ? 'on' : ''}" data-rga="pintool" title="머리카락 끝, 옷자락, 꼬리처럼 뼈가 없는 곳을 누르면 끌 수 있는 핀이 생겨요">＋ 핀 꽂기</button></div></div>`;
      if (sj) h += `<div class="sec"><h3>고른 관절: ${esc(selName(sj))}</h3><div class="grid2 rg-g">
        ${rng('돌리기', 'data-rgj="r"', Math.round((p.r[sj] || 0) * 180 / Math.PI), -180, 180, 1, '이 관절에 달린 부분을 돌려요')}
        ${rng('크기', 'data-rgj="s"', Math.round((p.s[sj] || 1) * 100), 50, 160, 1, '이 관절에 달린 부분을 키우거나 줄여요 (멀어지고 가까워지는 느낌)')}</div>
        <div class="btnrow"><button class="btn sm" data-rga="joint0">이 관절 처음대로</button>${limb || rgChainOf(rig, sj) ? `<button class="btn sm" data-rga="zfront" title="이 팔·다리(뼈)를 몸 앞에 그려요">몸 앞으로</button><button class="btn sm" data-rga="zback" title="이 팔·다리(뼈)를 몸 뒤에 그려요">몸 뒤로</button>` : ''}</div></div>`;
      if (pin) h += `<div class="sec"><h3>고른 핀</h3><div class="grid2 rg-g">${rng('범위', 'data-rgp="r"', Math.round(pin.r), Math.round(rgUnit(rig) * 0.08), Math.round(rgUnit(rig) * 1.5), 1, '핀을 끌 때 같이 움직이는 넓이')}</div><div class="btnrow"><button class="btn sm" data-rga="pin0">제자리로</button><button class="btn sm" data-rga="pindel">핀 지우기</button></div></div>`;
      h += `<div class="sec"><h3>전체</h3><div class="grid2 rg-g">${rng('크기', 'data-rgw="sc"', Math.round(p.sc * 100), 50, 160)}${rng('기울기', 'data-rgw="rot"', Math.round(p.rot * 180 / Math.PI), -90, 90)}${rig.eyes.some(e => e.on !== false) ? rng('눈 감기', 'data-rgw="blink"', Math.round((p.blink || 0) * 100), 0, 100, 1, '이 시각에 눈을 얼마나 감을지 (윙크·졸린 눈)') : ''}${hasMouth ? rng('입 벌리기', 'data-rgw="mouth"', Math.round((p.mouth || 0) * 100), rig.mouth.type === 'open' ? -100 : 0, 100, 1, '이 시각에 입을 얼마나 벌릴지. 원래 벌린 입은 왼쪽으로 밀면 다물어요') : ''}</div>${rig.mouth ? '' : '<p class="muted small" style="margin-top:6px">입 벌리기는 ① 뼈대 맞추기에서 입 상자를 넣으면 쓸 수 있어요.</p>'}</div>`;
      h += `<div class="sec"><h3>자동 움직임</h3><p class="muted small">저장한 자세 위에 저절로 더해져요. 0이면 꺼져요.</p><div class="grid2 rg-g">
        ${rng('숨쉬기', 'data-rgau="breath"', a.breath, 0, 100)}${rng('몸 흔들기', 'data-rgau="sway"', a.sway, 0, 100)}${rng('고개', 'data-rgau="head"', a.head, 0, 100)}${rng('통통 튀기', 'data-rgau="bounce"', a.bounce, 0, 100)}
        ${rig.stdOff ? '' : rng('팔 흔들림', 'data-rgau="arms"', a.arms || 0, 0, 100, 1, '팔이 가만히 있지 않고 조금씩 흔들려요') + rng('골반 흔들기', 'data-rgau="hip"', a.hip || 0, 0, 100, 1, '골반이 좌우로 움직이고 윗몸이 균형을 잡아요')}${rng('떨림', 'data-rgau="shake"', a.shake || 0, 0, 100, 1, '온몸이 잘게 떨려요')}${rng('출렁임', 'data-rgau="jig"', a.jig || 0, 0, 100, 1, '움직임이 바뀔 때 머리카락 끝·옷자락이 한 박자 더 출렁여요')}
        ${rng('살랑임', 'data-rgau="wind"', a.wind, 0, 100, 1, '머리카락 끝·옷자락처럼 몸에서 먼 곳이 바람에 살랑거려요')}${rng('늦게 따라오기', 'data-rgau="follow"', a.follow, 0, 100, 1, '몸이 움직일 때 머리카락·옷자락이 조금 늦게 따라와요')}
        ${rig.eyes.some(e => e.on !== false) ? rng('눈 깜빡임', 'data-rgau="blink"', a.blink, 0, 100, 1, '클수록 자주 깜빡여요') : ''}${hasMouth ? rng('말하기', 'data-rgau="talk"', a.talk || 0, 0, 100, 1, '말하는 것처럼 입을 뻥긋거려요. 클수록 크게 벌려요') : ''}${rng('빠르기', 'data-rgau="speed"', a.speed, 40, 250)}</div>
        <div class="btnrow"><button class="btn sm" data-rga="auto0">모두 끄기</button><button class="btn sm" data-rga="auto1">기본값</button></div>
        <p class="muted small" style="margin-top:8px">한 번에 맞추기</p><div class="btnrow">${Object.entries(RG_STYLES).map(([k, v]) => `<button class="btn sm" data-rgsty="${k}">${v[0]}</button>`).join('')}</div>
        ${rig.stdOff ? '' : `<div class="btnrow"><button class="btn sm primary" data-rga="automagic" title="머리카락 다발·꼬리·옷자락처럼 늘어진 곳에 뼈를 알아서 넣고, 자동 움직임을 '살아 있게'로 맞춰요">✨ 알아서 움직이게</button></div>`}</div>`;
      const cs2 = (rig.chains || []).filter(c => c.ids.length > 1);
      if (cs2.length) h += `<div class="sec"><h3>내 뼈 자동 움직임</h3><p class="muted small">뼈마다 저절로 움직이게 해요. 저장한 자세 위에 더해져요.</p>${cs2.map(c => { const am = c.am || {}, on = am.kind && RG_AM[am.kind], open = on && (c.ids.includes(st.sel) || cs2.length <= 2); return `<div class="grid2 rg-g" style="margin-bottom:4px"><span class="small" data-rgchsel="${c.id}" style="cursor:pointer${c.ids.includes(st.sel) ? ';font-weight:700' : ''}">${esc(c.name)}</span><span><select data-rgcamk="${c.id}"><option value="">없음</option>${Object.entries(RG_AM).map(([k, v]) => `<option value="${k}" ${am.kind === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select></span>
        ${on ? rng('크기', `data-rgcam="${c.id}" data-k="amt"`, am.amt === undefined ? 50 : am.amt, 0, 100) : ''}${open ? rng('빠르기', `data-rgcam="${c.id}" data-k="sp"`, am.sp || 100, 30, 300) + rng('엇박', `data-rgcam="${c.id}" data-k="ph"`, am.ph || 0, 0, 100, 1, '다른 뼈와 박자를 어긋나게 해요') + `<span class="small">방향</span><span><label class="chk"><input type="checkbox" data-rgcamr="${c.id}" ${am.rev ? 'checked' : ''}> 반대로</label></span>` : ''}</div>`; }).join('')}${cs2.some(c => c.am && c.am.kind) && cs2.length > 2 ? '<p class="muted small">이름을 누르면 빠르기·엇박·방향도 바꿀 수 있어요.</p>' : ''}</div>`;
      h += `<div class="sec"><h3>움직임 견본</h3><p class="muted small">누르면 맨 앞 자세를 바탕으로 시간 막대를 채워요. 자동 움직임과 함께 쓸 수 있어요.</p><div class="grid2 rg-g">${rng('세기', 'data-rgmva', rgUi.mvAmp || 100, 40, 220, 5, '견본을 얼마나 크게 움직일지. 바꾼 뒤 견본을 다시 누르세요')}</div><div class="btnrow">${RG_MOVES.filter(([k]) => RG_MOVE_NEED[k] === null ? (rig.chains || []).some(c => c.ids.length > 1) : rig.stdOff ? !RG_MOVE_NEED[k].length : RG_MOVE_NEED[k].every(id => rgOn(rig, id))).map(([k, l]) => `<button class="btn sm" data-rgmv="${k}">${l}${/^wave/.test(k) ? ' (' + rgSideName(rig, k === 'waveA' ? 'armA' : 'armB').replace(' 팔', '') + ')' : ''}</button>`).join('')}</div></div>`;
    } else if (st.mode === 'bone') {
      const cs = rig.chains || [];
      h += `<div class="sec"><h3>내 뼈 (원하는 곳에만)</h3><p class="muted small">얼굴이 안 보이거나 몸 일부만 나온 그림은, 움직일 곳에만 뼈를 넣으세요. 고른 뒤 그림에서 <b>차례대로</b> 눌러요. 뼈에서 먼 곳은 제자리에 있어요.</p>
        ${st.draft ? `<p class="small"><b>${esc(RG_CHAIN_KINDS[st.draft.kind].name)}</b>: ${esc(rgDraftName(st.draft))}</p><div class="btnrow"><button class="btn sm primary" data-rga="chainok" ${st.draft.pts.length < 2 ? 'disabled' : ''} title="Enter">여기까지 (${st.draft.pts.length}점)</button><button class="btn sm" data-rga="chainno" title="Esc">취소</button></div>`
        : `${rig.stdOff ? '' : `<div class="btnrow"><button class="btn sm primary" data-rga="autobones" title="머리카락 다발·꼬리·옷자락·귀처럼 몸에서 늘어진 곳을 찾아 뼈를 넣고, 저절로 흔들리게 해요">✨ 늘어진 곳에 뼈 자동으로 넣기</button>${(rig.chains || []).some(c => c.auto) ? '<button class="btn sm" data-rga="autobones0">자동 뼈 지우기</button>' : ''}</div>`}<div class="btnrow">${Object.entries(RG_CHAIN_KINDS).map(([k, v]) => `<button class="btn sm" data-rgch="${k}" title="${esc(v.pts.slice(0, k === 'free' ? 2 : 9).join(' → '))}${k === 'free' ? ' … (꼬리·머리카락·옷자락·물건 등, 2~6점)' : ''}">${k === 'free' ? '그 밖의 것' : esc(v.name)}</button>`).join('')}</div>`}
        ${cs.map(c => `<div class="rg-ly ${c.ids.includes(st.sel) ? 'on' : ''}" data-rgchsel="${c.id}"><span style="color:#9b6fe0;padding:0 4px">●</span><span class="nm">${esc(c.name)} <span class="muted small">${c.ids.length}점</span></span><button class="ic" data-rgchsplit="${c.id}" title="이 뼈 부분을 AI로 따로 떼어 내요. 팔·다리가 몸 위에 겹쳐 있을 때 쓰면 몸이 같이 끌려가지 않아요">✂</button><button class="ic" data-rgchren="${c.id}" title="이름 바꾸기">✎</button><button class="ic" data-rgchdel="${c.id}" title="이 뼈 지우기">✕</button></div>
          ${c.ids.includes(st.sel) ? `<div class="btnrow" style="margin-left:10px"><button class="btn sm" data-rga="chpadd" ${c.ids.length >= 6 ? 'disabled' : ''} title="고른 점 바로 뒤에 점을 하나 더 넣어요 (끝점이면 그 너머로 늘려요). 한 뼈에 6점까지">점 넣기</button><button class="btn sm" data-rga="chpdel" ${c.ids.length <= 2 ? 'disabled' : ''} title="고른 점을 빼서 뼈를 줄여요">이 점 빼기</button></div>` : ''}
          ${rig.stdOff ? '' : `<div class="grid2 rg-g" style="margin:2px 0 6px 10px"><span class="small">붙일 곳</span><span><select data-rgchat="${c.id}"><option value="">제자리에 고정</option>${RG_STD.filter(i => rgOn(rig, i)).map(i => `<option value="${i}" ${c.attach === i ? 'selected' : ''}>${esc(selName(i))}</option>`).join('')}</select></span></div>`}`).join('')}</div>
        <div class="sec"><h3>화면 끝 붙잡기</h3><label class="chk"><input type="checkbox" data-rgedge ${(() => { const b = base(); return b && b.mesh && b.mesh.joints.includes('edge') ? 'checked' : rig.edgePin === true ? 'checked' : ''; })()}> 화면 끝에 닿은 곳은 제자리에 붙잡기</label><p class="muted small">얼굴 위주나 몸 일부만 나온 그림은 켜 두세요. 움직여도 그림 가장자리가 벌어지지 않아요. (캐릭터가 화면 끝에 많이 닿아 있으면 알아서 켜져요)</p></div>
        <div class="sec"><h3>사람 모양 뼈대</h3><label class="chk"><input type="checkbox" data-rgstd ${rig.stdOff ? '' : 'checked'}> 사람 모양 뼈대 쓰기</label>
        ${rig.stdOff ? `<p class="muted small">${rig.autoSk === false ? '<b>AI가 사람 모양 뼈대를 찾지 못해서 꺼 두었어요.</b> ' : ''}머리부터 발까지 다 보이는 그림이면 켜고 관절을 맞춰 주세요.</p>` : `<p class="muted small">${rig.autoSk === false ? '<b>AI가 뼈대를 찾지 못해 기본 뼈대를 놓았어요.</b> ' : ''}관절(동그라미)을 끌어 그림의 어깨·팔꿈치·손목·무릎 자리에 맞춰 주세요. 잘 맞을수록 자연스럽게 움직여요.<br>Shift+끌기 = 아래 관절까지 같이 옮기기.</p>
        <div class="btnrow"><button class="btn sm" data-rga="repose">AI로 다시 찾기</button></div></div>
        <div class="sec"><h3>보이는 데까지만 (뼈대 줄이기)</h3><p class="muted small">몸이 다 안 나온 그림은 뼈대를 보이는 만큼만 쓰세요. 잘린 곳의 <b>마지막 점은 화면에 보이는 끝</b>에 두면 돼요.</p>
        <div class="grid2 rg-g"><span class="small" title="몸통 뼈가 시작하는 곳. 네모 점이 그 자리예요">몸통</span><span><select data-rgcut>${[['root', '골반부터 (전신)'], ['waist', '허리부터'], ['spine', '배·등부터'], ['chest', '가슴부터'], ['neck', '목부터 (얼굴 위주)']].map(([k, n]) => `<option value="${k}" ${rgBase(rig) === k ? 'selected' : ''}>${n}</option>`).join('')}</select></span>
        ${Object.keys(RG_LIMBS).filter(k => rgOn(rig, RG_J[RG_LIMBS[k][0]][1])).map(k => { const ids = RG_LIMBS[k], arm = k.startsWith('arm'); let n = 0; while (n < 3 && rig.joints[ids[0]].on !== false && rig.joints[ids[n + 1]].on !== false) n++; return `<span class="small">${rgSideName(rig, k)}</span><span><select data-rgln="${k}">${(arm ? ['없음', '팔꿈치까지 (윗팔만)', '손목까지', '손끝까지'] : ['없음', '무릎까지 (허벅지만)', '발목까지', '발끝까지']).map((t, i) => `<option value="${i}" ${n === i ? 'selected' : ''}>${t}</option>`).join('')}</select></span>`; }).join('')}</div>
        <p class="muted small">더 잘게 나누고 싶은 곳(손가락·머리카락·귀 등)은 위의 '내 뼈'를 넣고 붙일 곳을 고르세요. 내 뼈의 점을 누르면 점을 더 넣거나 뺄 수 있어요.</p>`}</div>
        <div class="sec"><h3>눈 (깜빡임용)</h3><p class="muted small">하늘색 상자가 눈이에요. 속눈썹 위부터 아래까지 딱 맞게 끌어 맞추면 깜빡임이 자연스러워요. 오른쪽 아래 모서리를 끌면 크기가 바뀌어요.</p>
        ${rig.eyes.map((e, i) => `<label class="chk"><input type="checkbox" data-rge="${i}" ${e.on !== false ? 'checked' : ''}> 눈 ${i + 1}</label>`).join('')}
        <div class="btnrow"><button class="btn sm" data-rga="eyefind">AI로 눈 다시 찾기</button><button class="btn sm" data-rga="eyeadd" ${rig.eyes.length >= 2 ? 'disabled' : ''}>눈 상자 추가</button>${st.selEye >= 0 && rig.eyes[st.selEye] ? '<button class="btn sm" data-rga="eyedel">고른 눈 지우기</button>' : ''}</div></div>
        <div class="sec"><h3>입 (입 벌리기·말하기용)</h3><p class="muted small">분홍 상자가 입이에요. 입술 선(벌린 입이면 입 전체)에 딱 맞게 맞춰 주세요.${rig.mouth && rig.mouth.est ? ' <b>입을 또렷이 찾지 못해 어림한 자리예요.</b>' : ''}</p>
        ${rig.mouth ? `<label class="chk"><input type="checkbox" data-rgmo="on" ${rig.mouth.on !== false ? 'checked' : ''}> 입 쓰기</label><div class="grid2 rg-g"><span>입 모양</span><span><select data-rgmo="type"><option value="line" ${rig.mouth.type !== 'open' ? 'selected' : ''}>다문 입 (선)</option><option value="open" ${rig.mouth.type === 'open' ? 'selected' : ''}>벌린 입</option></select></span><span title="다문 입을 벌렸을 때 보이는 입속 색">입속 색</span><span><input type="color" data-rgmo="col" value="#${(rig.mouth.col || [110, 40, 45]).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}"></span></div>` : ''}
        <div class="btnrow"><button class="btn sm" data-rga="mouthfind">입 다시 찾기</button>${rig.mouth ? '<button class="btn sm" data-rga="mouthdel">입 상자 지우기</button>' : '<button class="btn sm" data-rga="mouthadd">입 상자 추가</button>'}</div></div>`;
    } else {
      const L = rig.layers.find(l => l.id === st.selLayer) || base();
      h += `<div class="sec"><h3>부위 나누기</h3><p class="muted small">몸 앞에 겹친 팔, 앞머리, 꼬리처럼 <b>따로 움직이고 싶은 곳</b>을 붓으로 칠한 뒤 '떼어 내기'를 눌러요. 떼어 낸 자리는 AI가 메워요. 안 나눠도 움직일 수 있어요.<br>캐릭터 둘이 한 덩어리로 따졌다면 '붙어 있는 캐릭터 찾기'를 눌러 보세요.</p>
        <div class="seg"><button class="btn sm ${st.brush === 'smart' ? 'on' : ''}" data-rgb="smart" title="붓이 그림의 선을 넘지 않고 선 안쪽만 채워요. 대충 그어도 선에 맞춰져요">선 따라 칠하기</button><button class="btn sm ${st.brush === 'add' ? 'on' : ''}" data-rgb="add" title="그은 그대로 칠해요">그대로 칠하기</button><button class="btn sm ${st.brush === 'sub' ? 'on' : ''}" data-rgb="sub" title="Alt를 누른 채 칠해도 돼요">지우기</button></div>
        <div class="grid2 rg-g" style="margin-top:6px">${rng('붓 크기', 'data-rgbs', st.bsize, 8, 240, 1, '[ ] 키로도 바꿔요')}</div>
        <div class="btnrow"><button class="btn sm" data-rga="sam" title="대충 칠한 곳을 AI가 물체 윤곽에 맞춰 줘요">AI로 윤곽 맞추기</button><button class="btn sm" data-rga="pmclear">칠한 것 지우기</button></div>
        <div class="btnrow"><button class="btn sm primary" data-rga="split">떼어 내기 (새 부위)</button><button class="btn sm" data-rga="newchar" title="붙어 있는 다른 캐릭터를 칠한 뒤 누르면, 뼈대를 따로 가진 새 캐릭터가 돼요">새 캐릭터로 떼기</button></div>
        <div class="btnrow"><button class="btn sm" data-rga="autotwo" title="캐릭터 둘이 바짝 붙어 한 덩어리로 따졌을 때: AI가 한 명으로 보이는 곳을 찾아 칠해 줘요. 맞으면 '새 캐릭터로 떼기'를, 아니면 한 번 더 눌러 다른 후보를 보세요">붙어 있는 캐릭터 찾기 (AI)${st.two && st.two.list.length > 1 ? ` · 후보 ${st.two.i + 1}/${st.two.list.length}` : ''}</button></div>
        <div class="btnrow"><button class="btn sm" data-rga="carve" title="캐릭터가 아닌데 같이 따진 곳을 배경으로 돌려보내요">캐릭터에서 빼기</button><button class="btn sm" data-rga="uncarve" title="캐릭터인데 빠진 곳을 원래 그림에서 가져와요">캐릭터에 넣기</button></div></div>
        <div class="sec"><h3>부위 목록</h3><p class="muted small">위에 있을수록 앞에 그려요.</p><div class="rg-layers">${[...rig.layers].sort((x, y) => (y.z || 0) - (x.z || 0)).map(l => `<div class="rg-ly ${l.id === L.id ? 'on' : ''}" data-rgly="${l.id}"><button class="ic" data-rgeye="${l.id}" title="보이기·숨기기">${l.hide ? '○' : '●'}</button><span class="nm">${esc(l.name)}</span><button class="ic" data-rgup="${l.id}" title="앞으로">▲</button><button class="ic" data-rgdn="${l.id}" title="뒤로">▼</button></div>`).join('')}</div>
        <label class="chk"><input type="checkbox" data-rga2="solo" ${st.solo ? 'checked' : ''}> 고른 부위만 보기</label>
        <label class="chk" title="AI가 메운 자리를 하늘색으로 보여 줘요"><input type="checkbox" data-rga2="showfill" ${st.showFill ? 'checked' : ''}> 메운 자리 보기</label>
        ${L.base ? '' : `<div class="grid2 rg-g" style="margin-top:6px"><span title="이 부위가 어느 관절을 따라 움직일지">따라갈 곳</span><span><select data-rgfollow><option value="">알아서${L.bind && L.bind.length ? ' (' + L.bind.map(i => rgJName(rig, i)).join('·') + ')' : L.stuck ? ' (' + selName(L.stuck) + ')' : ''}</option>${RG_IDS.filter(i => i !== 'fix' && rgOn(rig, i) && rgKids(rig, i).length).map(i => `<option value="${i}" ${L.follow === i ? 'selected' : ''}>${esc(selName(i))}</option>`).join('')}</select></span></div>
        <div class="btnrow"><button class="btn sm" data-rga="rename">이름 바꾸기</button><button class="btn sm" data-rga="merge" title="떼어 낸 부위를 다시 몸에 붙여요">몸에 다시 합치기</button></div>`}</div>`;
    }
    if (st.mode === 'part') { const L = rig.layers.find(l => l.id === st.selLayer) || base();
      h += `<div class="sec"><h3>메운 자리 더 좋게 (NAI 등)</h3><p class="muted small">AI가 메운 자리가 흐릿하면: <b>내보내기</b>로 그림과 '메울 자리'(흰 곳) 그림을 받아, NAI 인페인트 등에서 그 자리를 다시 그린 뒤 <b>불러오기</b>로 넣어요. 메운 자리만 바뀌고 나머지는 그대로예요.</p>
        <div class="grid2 rg-g"><span>${esc(L.name)}</span><span class="btnrow" style="margin:0"><button class="btn sm" data-rgfx="layer">내보내기</button><button class="btn sm" data-rgfi="layer">불러오기</button></span>
        <span>배경</span><span class="btnrow" style="margin:0"><button class="btn sm" data-rgfx="bg">내보내기</button><button class="btn sm" data-rgfi="bg">불러오기</button></span></div>
        ${L.fillM ? '' : `<p class="muted small" style="margin-top:6px">'${esc(L.name)}'에는 메운 자리가 없어요. 불러오면 이 부위가 보이는 곳 전체가 바뀌어요.</p>`}</div>`; }
    side.innerHTML = h;
  }
  const editPose = fn => { const k = keyHere(true); fn(k.p); dirty(); };
  side.addEventListener('pointerdown', e => { if (e.target.matches('input[type=range], input[type=color]')) snap(); });
  side.addEventListener('input', e => {
    const t = e.target, v = +t.value;
    if (t.dataset.rgau) { A().auto[t.dataset.rgau] = v; dirty(); }
    else if (t.dataset.rgmva !== undefined) rgUi.mvAmp = v;
    else if (t.dataset.rgcam) { const c = (rig.chains || []).find(q => q.id === t.dataset.rgcam); if (c && c.am) { c.am[t.dataset.k] = v; dirty(); } }
    else if (t.dataset.rgj && st.sel) editPose(p => { if (t.dataset.rgj === 'r') p.r[st.sel] = v * Math.PI / 180; else p.s[st.sel] = v / 100; });
    else if (t.dataset.rgw) editPose(p => { if (t.dataset.rgw === 'sc') p.sc = v / 100; else if (t.dataset.rgw === 'rot') p.rot = v * Math.PI / 180; else if (t.dataset.rgw === 'mouth') p.mouth = v / 100; else p.blink = v / 100; });
    else if (t.dataset.rgmo === 'col' && rig.mouth) { const hx = t.value.replace('#', ''); rig.mouth.col = [0, 2, 4].map(i => parseInt(hx.slice(i, i + 2), 16)); dirty(); }
    else if (t.dataset.rgp) { const pin = rig.pins.find(q => q.id === st.selPin); if (pin) { pin.r = v; for (const L of rig.layers) if (L.mesh) rgPinWeights(rig, L); dirty(); } }
    else if (t.dataset.rgbs !== undefined) { st.bsize = v; }
  });
  side.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.rgedge !== undefined) { snap(); rig.edgePin = t.checked; rig.ver++; dirty(); }
    else if (t.dataset.rgcut !== undefined) { snap(); const was = rgBase(rig), now = t.value; rig.cut = now === 'root' ? null : now;
      // 새 뿌리 점이 옛 뿌리보다 아래쪽(골반 쪽)이면 겹쳐 있을 수 있으니 조금 벌려 줘요
      const ti = RG_TORSO.indexOf(now), J = rig.joints; for (let i = RG_TORSO.indexOf(was) - 1; i >= ti; i--) { const a = J[RG_TORSO[i]], b = J[RG_TORSO[i + 1]]; if (Math.hypot(a.x - b.x, a.y - b.y) < rgUnit(rig) * 0.06) { const c = J[RG_TORSO[Math.min(4, i + 2)]], dx = b.x - c.x, dy = b.y - c.y, l = Math.hypot(dx, dy) || 1, st2 = rgUnit(rig) * 0.18; a.x = clamp(b.x + (l > 1 ? dx / l : 0) * st2, 2, rig.W - 2); a.y = clamp(b.y + (l > 1 ? dy / l : 1) * st2, 2, rig.H - 2); } }
      if (!rgOn(rig, st.sel)) st.sel = null; rig.ver++; renderSide(); dirty(); toast(now === 'root' ? '몸통 뼈대를 골반부터 써요.' : '네모 점(' + RG_J[now][0] + ')을 화면에 보이는 몸통의 끝에 두세요. 그 아래 뼈와 다리는 껐어요.', 4200); }
    else if (t.dataset.rgln) { snap(); const ids = RG_LIMBS[t.dataset.rgln], n = +t.value; rig.joints[ids[0]].on = true; for (let i = 1; i < ids.length; i++) rig.joints[ids[i]].on = i <= n; if (n) fixLimb(ids.slice(0, n + 1)); if (!rgOn(rig, st.sel)) st.sel = null; rig.ver++; renderSide(); dirty(); }
    else if (t.dataset.rgl || t.dataset.rgl2) { snap(); const ids = RG_LIMBS[t.dataset.rgl || t.dataset.rgl2], from0 = t.dataset.rgl ? 1 : 2; if (t.dataset.rgl) rig.joints[ids[0]].on = true; for (let i = from0; i < ids.length; i++) rig.joints[ids[i]].on = t.checked; if (t.checked) fixLimb(ids); rig.ver++; renderSide(); dirty(); }
    else if (t.dataset.rge) { snap(); rig.eyes[+t.dataset.rge].on = t.checked; dirty(); }
    else if (t.dataset.rgstd !== undefined) { snap(); rig.stdOff = !t.checked; if (st.sel && RG_J[st.sel]) st.sel = null; for (const L of rig.layers) if (L.bind) L.bind = L.bind.filter(id => !RG_J[id] || !rig.stdOff); rig.ver++; renderSide(); dirty(); }
    else if (t.dataset.rgcamk) { const c = (rig.chains || []).find(q => q.id === t.dataset.rgcamk); if (!c) return; snap(); c.am = Object.assign({ amt: 50, sp: 100, ph: 0 }, c.am || {}, { kind: t.value || null }); renderSide(); dirty(); }
    else if (t.dataset.rgcamr) { const c = (rig.chains || []).find(q => q.id === t.dataset.rgcamr); if (!c || !c.am) return; snap(); c.am.rev = t.checked; dirty(); }
    else if (t.dataset.rgchat) { const c = (rig.chains || []).find(q => q.id === t.dataset.rgchat); if (!c) return; snap(); c.attach = t.value || null; rig.ver++; renderSide(); dirty(); }
    else if (t.dataset.rgmo === 'on' && rig.mouth) { snap(); rig.mouth.on = t.checked; dirty(); }
    else if (t.dataset.rgmo === 'type' && rig.mouth) { snap(); rig.mouth.type = t.value; dirty(); }
    else if (t.dataset.rga2 === 'solo') { st.solo = t.checked; dirty(); }
    else if (t.dataset.rga2 === 'showfill') { st.showFill = t.checked; dirty(); }
    else if (t.dataset.rgfollow !== undefined) { const L = rig.layers.find(l => l.id === st.selLayer); if (!L || L.base) return; snap(); L.follow = t.value || null; if (L.follow) L.bind = []; rig.ver++; renderSide(); dirty(); }
  });
  // 켠 팔·다리의 관절이 한 점에 뭉쳐 있으면 보기 좋게 펴 놓아요
  const fixLimb = ids => { for (let i = 1; i < ids.length; i++) { const a = rig.joints[ids[i - 1]], b = rig.joints[ids[i]]; if (Math.hypot(a.x - b.x, a.y - b.y) < rgUnit(rig) * 0.08) { b.x = clamp(a.x + (ids[0][0] === 'a' ? 1 : -1) * rgUnit(rig) * 0.08, 2, rig.W - 2); b.y = clamp(a.y + rgUnit(rig) * (i === 3 ? 0.15 : 0.4), 2, rig.H - 2); } } };
  const pmMask = () => { if (!st.pm || !st.pmAny) return null; const c = newCanvas(rig.W, rig.H), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(st.pm, 0, 0, rig.W, rig.H); const d = g.getImageData(0, 0, rig.W, rig.H).data, M = new Uint8ClampedArray(rig.W * rig.H); let n = 0; for (let i = 0; i < M.length; i++) { M[i] = clamp((d[i * 4 + 3] - 64) * 2, 0, 255); if (M[i] > 128) n++; } return n > 20 ? M : null; };
  const pmFrom = M => { const c = newCanvas(rig.W, rig.H), g = c.getContext('2d'), id = g.createImageData(rig.W, rig.H); for (let i = 0; i < M.length; i++) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 60; id.data[i * 4 + 2] = 160; id.data[i * 4 + 3] = M[i]; } g.putImageData(id, 0, 0); const pg = st.pm.getContext('2d'); pg.clearRect(0, 0, st.pm.width, st.pm.height); pg.drawImage(c, 0, 0, st.pm.width, st.pm.height); st.pmAny = true; };
  const busy = async (title, fn) => { // 오래 걸리는 일: 이 창 위에 진행 표시
    if (st.busy) return; st.busy = true; const tk = { stop: false, set: (msg) => { tip.textContent = msg || title; tip.style.display = 'block'; }, done() { } }; tk.set(title);
    try { await new Promise(r => setTimeout(r, 30)); await fn(tk); } catch (e) { console.warn(e); toast('하지 못했어요. ' + czErrText(e), 4600); } finally { st.busy = false; tip.style.display = 'none'; if (m.isConnected) { renderSide(); dirty(); } }
  };
  side.addEventListener('click', async e => {
    const b = e.target.closest('button'), ly = e.target.closest('[data-rgly]'); if (st.busy) return;
    if (b && b.dataset.rgm2) { setMode(b.dataset.rgm2); return; }
    if (b && (b.dataset.rgfx || b.dataset.rgfi)) {
      const isBg = (b.dataset.rgfx || b.dataset.rgfi) === 'bg', L = rig.layers.find(l => l.id === st.selLayer) || base(), what = isBg ? 'bg' : L, nm = safeName((from.name || '그림').replace(/\.[^.]+$/, '') + '_' + (isBg ? '배경' : (chars().length > 1 ? rig.cname + '_' : '') + L.name));
      if (b.dataset.rgfx) { const ex = rgFillExport(main, rig, what), r = await saveFiles([{ name: nm + '.png', blob: await rgBlob(ex.pic, 'image/png') }, { name: nm + '_메울자리.png', blob: await rgBlob(ex.mask, 'image/png') }], nm + '.zip'); if (r) toast(`그림 두 장을 저장했어요. '${nm}.png'를 NAI 인페인트에 넣고 '_메울자리' 그림의 흰 곳을 칠해 다시 그린 뒤, 불러오기로 넣어 주세요.${ex.any ? '' : ' (메운 자리가 없어서 메울 자리 그림은 까매요)'}`, 9000); return; }
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
      inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; if (!f) return; try { const bm = await createImageBitmap(f), r0 = bm.width / bm.height, r1 = main.W / main.H; if (Math.abs(r0 - r1) / r1 > 0.03 && !(await rgAsk('불러온 그림의 가로세로 비율이 달라요. 늘여서 맞추면 어긋날 수 있어요. 그래도 넣을까요?'))) return; snap(); rgFillImport(main, rig, what, bm); renderSide(); dirty(); toast((isBg ? '배경' : `'${L.name}'`) + '에 불러온 그림을 넣었어요. 마음에 안 들면 Ctrl+Z'); } catch (e) { console.warn(e); toast('그림을 읽지 못했어요'); } });
      inp.click(); return;
    }
    if (b && b.dataset.rgch) { chainStart(b.dataset.rgch); toast(rgDraftName(st.draft) + '. 다 찍으면 Enter, 그만두려면 Esc', 4200); return; }
    if (b && b.dataset.rgchdel) { if (await rgAsk('이 뼈를 지울까요? 이 뼈로 만든 자세도 같이 지워져요.')) chainDel(b.dataset.rgchdel); return; }
    if (b && b.dataset.rgchsplit) {
      const c = (rig.chains || []).find(q => q.id === b.dataset.rgchsplit); if (!c) return; const L0 = base();
      busy(`'${c.name}' 부분을 떼어 내는 중…`, async tk => {
        const { W, H } = rig, ids = c.ids.filter(id => rgOn(rig, id)); if (ids.length < 2) return;
        let len = 0; for (let i = 1; i < ids.length; i++) len += Math.hypot(rig.joints[ids[i]].x - rig.joints[ids[i - 1]].x, rig.joints[ids[i]].y - rig.joints[ids[i - 1]].y); len /= ids.length - 1;
        const cv = newCanvas(W, H), g = cv.getContext('2d', { willReadFrequently: true }); g.strokeStyle = '#fff'; g.lineWidth = len * 0.26; g.lineCap = g.lineJoin = 'round'; g.beginPath(); ids.forEach((id, i) => { const q = rig.joints[id]; i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }); g.stroke();
        const d = g.getImageData(0, 0, W, H).data, A = rgAlpha(L0, W, H), M = new Uint8ClampedArray(W * H); let am = 0; for (let i = 0; i < M.length; i++) { M[i] = d[i * 4 + 3] > 128 && A[i] > 128 ? 255 : 0; if (M[i]) am++; }
        if (am < 40) { toast('뼈가 캐릭터 위에 있지 않아요'); return; }
        let N = await rgSamRefine(rig, M, tk), an = 0; if (N) { for (let i = 0; i < N.length; i++) { if (A[i] < 20) N[i] = 0; if (N[i] > 128) an++; } }
        // AI 윤곽이 너무 크거나(몸 전체) 작으면, 뼈를 따라 그은 띠를 그대로 써요
        if (!N || an > am * 3.5 || an < am * 0.5) N = M; else { const f = new Float32Array(M.length); for (let i = 0; i < M.length; i++) f[i] = M[i] / 255; const bl = dpBox(f, W, H, Math.max(3, Math.round(len * 0.05))); for (let i = 0; i < N.length; i++) if (bl[i] > 0.97) N[i] = Math.max(N[i], A[i]); }
        const before = shot(), P = await rgSplit(rig, L0, N, c.name, tk, chars()); if (!P) { toast('떼어 낼 곳을 찾지 못했어요'); return; }
        P.bind = [...new Set([...(P.bind || []), ...ids.slice(0, -1)])]; rig.ver++; st.undo.push(before); st.redo.length = 0;
        toast(`'${c.name}' 부분을 따로 떼어 냈어요. 모자라거나 넘친 곳은 ② 부위 나누기에서 고칠 수 있어요.`, 4600);
      }); return;
    }
    if (b && b.dataset.rgchren) { const c = (rig.chains || []).find(q => q.id === b.dataset.rgchren); if (!c) return; const v = await rgPrompt('뼈 이름', c.name); if (v) { snap(); c.name = v.slice(0, 20); renderSide(); } return; }
    const chs = e.target.closest('[data-rgchsel]'); if (chs && !b) { const c = (rig.chains || []).find(q => q.id === chs.dataset.rgchsel); if (c) { st.sel = c.ids[Math.min(c.ids.length - 1, 1)]; renderSide(); dirty(); } return; }
    if (b && b.dataset.rga === 'chainok') { chainFinish(); return; }
    if (b && b.dataset.rga === 'chainno') { st.draft = null; renderSide(); dirty(); return; }
    if (b && b.dataset.rgeye) { const L = rig.layers.find(l => l.id === b.dataset.rgeye); snap(); L.hide = !L.hide; renderSide(); dirty(); return; }
    if (b && (b.dataset.rgup || b.dataset.rgdn)) { const up = !!b.dataset.rgup, id = b.dataset.rgup || b.dataset.rgdn, ord = [...rig.layers].sort((x, y) => (x.z || 0) - (y.z || 0)), i = ord.findIndex(l => l.id === id), j = i + (up ? 1 : -1); if (j < 0 || j >= ord.length) return; snap(); [ord[i], ord[j]] = [ord[j], ord[i]]; ord.forEach((l, k) => { l.z = k; }); renderSide(); dirty(); return; }
    if (ly && !b) { st.selLayer = ly.dataset.rgly; renderSide(); dirty(); return; }
    if (!b) return;
    if (b.dataset.rgc) { const c = chars().find(q => q.cid === b.dataset.rgc); if (c) { switchChar(c); renderSide(); } return; }
    if (b.dataset.rgb) { st.brush = b.dataset.rgb; renderSide(); return; }
    if (b.dataset.rgsty) { const S = RG_STYLES[b.dataset.rgsty]; snap(); Object.assign(A().auto, S[1]); for (const c of rig.chains || []) if (c.am && c.am.kind) c.am.amt = S[2]; renderSide(); dirty(); return; }
    if (b.dataset.rgmv) { const mb = st.mvBase && st.mvBase.rig === rig && st.mvBase.keys === A().keys ? st.mvBase.base : rgPoseCopy(A().keys[0] ? A().keys[0].p : rgPose0()), mv = rgMoveKeys(rig, b.dataset.rgmv, mb); if (!mv) return; rgMoveAmp(mb, mv, (rgUi.mvAmp || 100) / 100); if (A().keys.length > 1 && !(await rgAsk('시간 막대에 저장해 둔 자세들이 견본으로 바뀌어요. 계속할까요?'))) return; snap(); A().keys = mv.keys; if (chars().length < 2 || mv.dur > A().dur) setDur(mv.dur); else if (mv.dur < A().dur) { const n = Math.max(1, Math.round(A().dur / mv.dur)), ks = []; for (let r = 0; r < n; r++) for (const k of mv.keys) ks.push({ t: Math.round((k.t + r * mv.dur) * A().dur / (n * mv.dur) * 1000) / 1000, e: k.e, p: rgPoseCopy(k.p) }); A().keys = ks; } st.mvBase = { rig, keys: A().keys, base: mb }; for (const c of chars()) c.anim.loop = true; st.selKey = 0; st.t = 0; syncTime(); renderSide(); if (!st.playing) togglePlay(); return; }
    const act = b.dataset.rga; if (!act) return;
    if (act === 'pose0') { snap(); editPose(p => { Object.assign(p, rgPose0()); }); renderSide(); }
    else if (act === 'pintool') { st.tool = st.tool === 'pin' ? 'move' : 'pin'; renderSide(); if (st.tool === 'pin') toast('핀을 꽂을 곳(머리카락 끝·옷자락 등)을 눌러 주세요'); }
    else if (act === 'joint0' && st.sel) { snap(); editPose(p => { delete p.r[st.sel]; delete p.s[st.sel]; delete p.d[st.sel]; }); renderSide(); }
    else if ((act === 'zfront' || act === 'zback') && st.sel) { const l = rgLimbOf(st.sel), ch = rgChainOf(rig, st.sel); if (!l && !ch) return; snap(); if (ch) ch.z = act === 'zfront' ? 2 : -2; else rig.zs[l] = act === 'zfront' ? 2 : -2; for (const L of rig.layers) if (L.mesh) rgSortTris(rig, L); dirty(); }
    else if (act === 'pin0') { snap(); editPose(p => { delete p.pins[st.selPin]; }); }
    else if (act === 'pindel') { snap(); rig.pins = rig.pins.filter(q => q.id !== st.selPin); for (const k of A().keys) delete k.p.pins[st.selPin]; st.selPin = null; for (const L of rig.layers) if (L.mesh) rgPinWeights(rig, L); renderSide(); dirty(); }
    else if (act === 'auto0') { snap(); for (const k of ['breath', 'sway', 'head', 'bounce', 'wind', 'follow', 'blink', 'talk', 'arms', 'hip', 'shake', 'jig']) A().auto[k] = 0; for (const c of rig.chains || []) if (c.am) c.am.kind = null; renderSide(); dirty(); }
    else if (act === 'autobones' || act === 'automagic') {
      snap(); const made = []; for (const r of act === 'automagic' ? chars() : [rig]) { if (!(r.chains || []).some(c => c.auto)) made.push(...rgAutoBones(r, 6)); if (act === 'automagic') { const bl = r.anim.auto.blink, tk = r.anim.auto.talk; Object.assign(r.anim.auto, RG_STYLES.live[1], { blink: bl, talk: tk }); for (const c of r.chains || []) if (c.am && c.am.kind) c.am.amt = RG_STYLES.live[2]; } for (const L of r.layers) L.mesh = null; } renderSide(); dirty();
      toast(made.length ? `늘어진 곳 ${made.length}군데에 뼈를 넣었어요. 어색한 뼈는 ① 뼈대 맞추기에서 지우거나 점을 끌어 고치세요.` : act === 'automagic' ? "자동 움직임을 '살아 있게'로 맞췄어요. 뼈를 더 넣을 만큼 늘어진 곳은 찾지 못했어요." : '뼈를 넣을 만큼 늘어진 곳을 찾지 못했어요. 내 뼈를 직접 넣어 보세요.', 5200);
    }
    else if (act === 'chpadd' || act === 'chpdel') {
      const c = rgChainOf(rig, st.sel); if (!c) return; const i = c.ids.indexOf(st.sel), J = rig.joints;
      if (act === 'chpadd') {
        const used = new Set((rig.chains || []).flatMap(q => q.ids)), nid = RG_X.find(x => !used.has(x)); if (c.ids.length >= 6 || !nid) { toast('점을 더 넣을 수 없어요.'); return; }
        snap(); const a = J[c.ids[i]], b = J[c.ids[i + 1]], pv = J[c.ids[i - 1]];
        J[nid] = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true } : { x: clamp(a.x + (pv ? (a.x - pv.x) * 0.6 : rgUnit(rig) * 0.15), 2, rig.W - 2), y: clamp(a.y + (pv ? (a.y - pv.y) * 0.6 : 0), 2, rig.H - 2), on: true };
        c.ids.splice(i + 1, 0, nid); st.sel = nid;
      } else {
        if (c.ids.length <= 2) return; snap(); const id = st.sel; delete J[id]; for (const q of chars()) for (const k of q.anim.keys) { delete k.p.r[id]; delete k.p.d[id]; delete k.p.s[id]; }
        for (const L of rig.layers) { if (L.bind) L.bind = L.bind.filter(q => q !== id); if (L.follow === id) L.follow = c.ids[Math.max(0, i - 1)] === id ? c.ids[1] : c.ids[Math.max(0, i - 1)]; }
        c.ids.splice(i, 1); st.sel = c.ids[Math.min(i, c.ids.length - 1)];
      }
      c.kind = 'free'; rig.ver++; renderSide(); dirty();
    }
    else if (act === 'autobones0') { for (const c of (rig.chains || []).filter(q => q.auto)) chainDel(c.id); }
    else if (act === 'auto1') { snap(); Object.assign(A().auto, rgNewAnim().auto); if (!rig.eyes.length) A().auto.blink = 0; renderSide(); dirty(); }
    else if (act === 'repose') busy('뼈대를 다시 찾는 중…', async tk => { const bx = rgBBox(rgAlpha(base(), rig.W, rig.H), rig.W, rig.H, 100) || { x: 0, y: 0, w: rig.W, h: rig.H }; const K = await rgPoseRun(rig.src, rig.W, rig.H, bx, tk), sk = rgSkeleton(K, rig.W, rig.H, bx); snap(); const keep = Object.fromEntries(RG_X.filter(x => rig.joints[x]).map(x => [x, rig.joints[x]])); rig.joints = { ...sk.joints, ...keep }; rig.cut = sk.cut || null; rig.autoSk = sk.auto; rig.conf = sk.conf; if (sk.auto) rig.stdOff = false; rig.ver++; if (!sk.auto) toast('AI가 뼈대를 찾지 못해서 기본 뼈대를 놓았어요. 끌어서 맞춰 주세요.', 4200); });
    else if (act === 'eyefind') busy('눈을 찾는 중…', async tk => { const bx = rgBBox(rgAlpha(base(), rig.W, rig.H), rig.W, rig.H, 100) || { x: 0, y: 0, w: rig.W, h: rig.H }; const ey = await rgFindEyes(rig.src, rig.W, rig.H, { joints: rig.joints, auto: true }, bx, tk); snap(); rig.eyes = ey; st.selEye = -1; toast(ey.length ? `눈 ${ey.length}개를 찾았어요` : '눈을 찾지 못했어요. 눈 상자를 직접 추가해 주세요.'); });
    else if (act === 'eyeadd') { snap(); const J = rig.joints, s = Math.max(16, Math.hypot(J.head.x - J.neck.x, J.head.y - J.neck.y) * 0.3); rig.eyes.push({ x: (J.head.x + J.neck.x) / 2 - s / 2 + (rig.eyes.length ? s * 1.4 : -s * 0.7), y: (J.head.y + J.neck.y) / 2 - s * 0.35, w: s, h: s * 0.7, on: true }); st.selEye = rig.eyes.length - 1; renderSide(); dirty(); }
    else if (act === 'eyedel') { snap(); rig.eyes.splice(st.selEye, 1); st.selEye = -1; renderSide(); dirty(); }
    else if (act === 'cfront' || act === 'cback') { const ord = [...chars()].sort((x, y) => (x.cz || 0) - (y.cz || 0)), i = ord.indexOf(rig), j = i + (act === 'cfront' ? 1 : -1); if (j < 0 || j >= ord.length) { toast(act === 'cfront' ? '이미 맨 앞이에요' : '이미 맨 뒤예요'); return; } snap(); [ord[i], ord[j]] = [ord[j], ord[i]]; ord.forEach((c, k) => { c.cz = k; }); dirty(); }
    else if (act === 'crename') { const v = await rgPrompt('캐릭터 이름', rig.cname); if (v) { snap(); rig.cname = v.slice(0, 20); renderSide(); } }
    else if (act === 'mouthfind') { const mo = rgFindMouth(main.src, main.W, main.H, rig.eyes.filter(e => e.on !== false)); if (!mo) { toast('입을 찾으려면 눈 상자 두 개가 있어야 해요. 입 상자를 직접 추가해도 돼요.', 4200); return; } snap(); rig.mouth = mo; renderSide(); dirty(); toast(mo.est ? '입을 또렷이 찾지 못해 어림한 자리에 놓았어요. 끌어서 맞춰 주세요.' : '입을 찾았어요'); }
    else if (act === 'mouthadd') { snap(); const J = rig.joints, s = Math.max(14, Math.hypot(J.head.x - J.neck.x, J.head.y - J.neck.y) * 0.28); rig.mouth = { x: J.neck.x - s / 2, y: J.neck.y - s * 1.1, w: s, h: Math.max(4, s * 0.16), on: true, type: 'line', col: [120, 40, 45] }; st.selEye = 'm'; renderSide(); dirty(); }
    else if (act === 'mouthdel') { snap(); rig.mouth = null; if (st.selEye === 'm') st.selEye = -1; renderSide(); dirty(); }
    else if (act === 'newchar') {
      const M = pmMask(); if (!M) { toast('먼저 따로 떼어 낼 캐릭터를 붓으로 칠해 주세요 (붙어 있는 캐릭터 찾기를 쓰면 편해요)', 4200); return; } if (chars().length >= 4) { toast('캐릭터는 4명까지 나눌 수 있어요'); return; }
      busy('새 캐릭터로 나누는 중…', async tk => {
        const before = shot(), old = rig, N = await rgSplit(rig, base(), M, '몸 전체', tk, chars()); if (!N) { toast('칠한 곳에 캐릭터가 거의 없어요'); return; }
        rig.layers.splice(rig.layers.indexOf(N), 1); rig.ver++;
        const W = main.W, H = main.H, found = async (tex, hint) => { const bx = rgBBox(rgAlpha({ tex }, W, H), W, H, 100) || { x: 0, y: 0, w: W, h: H }; let K = null, eyes = []; const only = newCanvas(W, H), og = only.getContext('2d', { willReadFrequently: true }); og.fillStyle = '#8a8a8a'; og.fillRect(0, 0, W, H); og.drawImage(tex, 0, 0); /* 이 캐릭터만 보이는 그림으로 찾아요 */ try { K = await rgPoseRun(only, W, H, bx, tk); } catch (e) { console.warn(e); } const sk = rgSkeleton(K, W, H, bx); try { eyes = await rgFindEyes(only, W, H, sk, bx, tk); } catch (e) { console.warn(e); } const A2 = rgAlpha({ tex }, W, H); eyes = eyes.filter(e => A2[clamp(Math.round(e.y + e.h / 2), 0, H - 1) * W + clamp(Math.round(e.x + e.w / 2), 0, W - 1)] > 100); return { sk, eyes }; };
        tk.set('새 캐릭터의 뼈대를 찾는 중…'); const f = await found(N.tex), c = rgNewChar(main, N.tex, f.sk, f.eyes, chars().length); c.bg = main.bg; c.out = main.out; c.anim.dur = main.anim.dur; c.anim.loop = main.anim.loop; c.cz = Math.max(...chars().map(q => q.cz || 0)) + 1; c.cname = '캐릭터 ' + (chars().length + 1);
        // 남은 캐릭터도 뼈대를 못 찾았던 거라면 자기 몸만 보고 다시 찾아요 (둘이 한 덩어리일 때는 AI가 헷갈려요)
        if (old.autoSk === false) { tk.set('남은 캐릭터의 뼈대를 다시 찾는 중…'); const g2 = await found(base().tex); if (g2.sk.auto) { old.joints = { ...old.joints, ...g2.sk.joints }; old.cut = g2.sk.cut || null; old.autoSk = true; old.conf = g2.sk.conf; old.stdOff = false; } else if (!(old.chains || []).length) old.stdOff = true; if (g2.eyes.length) { old.eyes = g2.eyes; old.mouth = rgFindMouth(main.src, W, H, g2.eyes); } old.ver++; }
        else { const A2 = rgAlpha(base(), W, H); old.eyes = old.eyes.filter(e => A2[clamp(Math.round(e.y + e.h / 2), 0, H - 1) * W + clamp(Math.round(e.x + e.w / 2), 0, W - 1)] > 100); }
        main.more = [...(main.more || []), c]; st.undo.push(before); st.redo.length = 0; st.pm.getContext('2d').clearRect(0, 0, st.pm.width, st.pm.height); st.pmAny = false; st.two = null; switchChar(c);
        const bad = [old, c].filter(q => q.autoSk === false).map(q => q.cname);
        toast(`'${c.cname}'(으)로 따로 나눴어요.${bad.length ? ' ' + bad.join(', ') + '은(는) 뼈대를 찾지 못해 기본 뼈대를 놓았으니 ① 뼈대 맞추기에서 맞춰 주세요.' : ''}`, 5600);
      });
    }
    else if (act === 'autotwo') {
      if (st.two && st.two.of === rig && st.two.ver === rig.ver && st.two.list.length > 1) { st.two.i = (st.two.i + 1) % st.two.list.length; if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); pmFrom(st.two.list[st.two.i].M); renderSide(); dirty(); toast(`후보 ${st.two.i + 1} / ${st.two.list.length}이에요. 맞으면 '새 캐릭터로 떼기'를 눌러 주세요.`); return; }
      busy('붙어 있는 캐릭터를 찾는 중…', async tk => {
        const list = await rgAutoTwo(rig, tk); if (!list) { toast('나눌 곳을 찾지 못했어요. 한 명을 붓으로 칠한 뒤 \'새 캐릭터로 떼기\'를 눌러 주세요.', 5000); return; }
        st.two = { of: rig, ver: rig.ver, list, i: 0 }; if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); pmFrom(list[0].M);
        toast(`분홍색으로 칠한 곳이 다른 캐릭터로 보이는 곳이에요. 맞으면 '새 캐릭터로 떼기'를 누르세요.${list.length > 1 ? ' 아니면 한 번 더 눌러 다른 후보를 보거나' : ' 아니면'} 붓으로 고쳐 주세요.`, 7000);
      });
    }
    else if (act === 'pmclear') { if (st.pm) st.pm.getContext('2d').clearRect(0, 0, st.pm.width, st.pm.height); st.pmAny = false; dirty(); }
    else if (act === 'sam') { const M = pmMask(); if (!M) { toast('먼저 맞출 곳을 붓으로 대충 칠해 주세요'); return; } busy('AI가 윤곽을 맞추는 중…', async tk => { const N = await rgSamRefine(rig, M, tk); if (!N) { toast('윤곽을 맞추지 못했어요. 칠한 그대로 쓰거나 조금 더 칠해 보세요.'); return; }
      // 칠한 곳의 안쪽은 AI가 빼먹어도 그대로 두고, 칠한 곳에서 멀리 벗어난 곳은 버려요 (가장자리만 AI 윤곽을 따라가요)
      const n = M.length, f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = M[i] / 255; const bl = dpBox(f, rig.W, rig.H, Math.max(4, Math.round(Math.max(rig.W, rig.H) / 110))); let lost = 0, tot = 0;
      for (let i = 0; i < n; i++) { if (M[i] > 128) { tot++; if (N[i] < 128) lost++; } N[i] = bl[i] > 0.97 ? 255 : bl[i] < 0.03 ? 0 : N[i]; }
      pmFrom(N); if (tot && lost / tot > 0.35) toast('AI가 윤곽을 잘 못 잡은 곳은 칠한 그대로 뒀어요. 가장자리를 붓으로 다듬어 주세요.', 4200); }); }
    else if (act === 'split' || act === 'carve' || act === 'uncarve') {
      const M = pmMask(); if (!M) { toast('먼저 붓으로 칠해 주세요'); return; }
      const L = act === 'uncarve' ? (rig.layers.find(l => l.id === st.selLayer) || base()) : base();
      busy(act === 'split' ? '부위를 떼어 내는 중…' : '고치는 중…', async tk => {
        const before = shot();
        if (act === 'split') { const name = '부위 ' + rig.layers.length, N = await rgSplit(rig, L, M, name, tk, chars()); if (!N) { toast('칠한 곳에 캐릭터가 거의 없어요'); return; } st.undo.push(before); st.redo.length = 0; st.selLayer = N.id; toast(`'${N.name}'을(를) 떼어 냈어요. ③ 움직임 만들기에서 움직여 보세요.${N.bind.length ? '' : ' 뼈가 없는 부위라 가까운 관절을 따라가요.'}`, 4200); }
        else { await rgCarve(rig, L, M, act === 'uncarve', tk); for (const c of chars()) c.bg = rig.bg; st.undo.push(before); st.redo.length = 0; }
        st.pm.getContext('2d').clearRect(0, 0, st.pm.width, st.pm.height); st.pmAny = false;
      });
    }
    else if (act === 'merge') { const L = rig.layers.find(l => l.id === st.selLayer); if (!L || L.base) return; snap(); rgMerge(rig, L); st.selLayer = 'body'; renderSide(); dirty(); }
    else if (act === 'rename') { const L = rig.layers.find(l => l.id === st.selLayer); if (!L) return; const v = await rgPrompt('부위 이름', L.name); if (v) { snap(); L.name = v.slice(0, 20); renderSide(); } }
  });

  /* 그림판에서 끌기 */
  const toRig = e => { const r = ov.getBoundingClientRect(), d = ov.width / r.width, cx = (e.clientX - r.left) * d, cy = (e.clientY - r.top) * d; return { x: (cx - st.view.ox) / st.view.k, y: (cy - st.view.oy) / st.view.k, cx, cy }; };
  const hitJoint = q => { const P = st.ev && st.ev.P; if (!P) return null; let best = null, bd = (13 * dpr() / st.view.k) ** 2; for (const id of RG_IDS) { if (!P[id]) continue; const d = (P[id].x - q.x) ** 2 + (P[id].y - q.y) ** 2; if (d < bd) { bd = d; best = id; } } return best; };
  const hitPin = q => { let best = null, bd = (13 * dpr() / st.view.k) ** 2; for (const p of rig.pins) { const w = pinPos(p), d = (w.x - q.x) ** 2 + (w.y - q.y) ** 2; if (d < bd) { bd = d; best = p; } } return best; };
  // 화면에서 누른 곳이 원래 그림의 어디인지 (지금 자세로 옮겨진 그물에서 거꾸로 찾기)
  const pickRest = (q, c0) => { const rig = c0 || cur(); for (const L of [...rig.layers].sort((a, b) => (b.z || 0) - (a.z || 0))) { const me = L.mesh; if (!me || L.hide) continue; const O = me.out, I = me.I, V = me.V, A2 = rgAlpha(L, rig.W, rig.H); for (let t = I.length - 3; t >= 0; t -= 3) { const a = I[t], b = I[t + 1], c = I[t + 2], x1 = O[a * 2], y1 = O[a * 2 + 1], x2 = O[b * 2], y2 = O[b * 2 + 1], x3 = O[c * 2], y3 = O[c * 2 + 1], den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3); if (Math.abs(den) < 1e-9) continue; const u = ((y2 - y3) * (q.x - x3) + (x3 - x2) * (q.y - y3)) / den, v = ((y3 - y1) * (q.x - x3) + (x1 - x3) * (q.y - y3)) / den, w = 1 - u - v; if (u < 0 || v < 0 || w < 0) continue; const rx = u * V[a * 2] + v * V[b * 2] + w * V[c * 2], ry = u * V[a * 2 + 1] + v * V[b * 2 + 1] + w * V[c * 2 + 1], ix = clamp(Math.round(rx), 0, rig.W - 1), iy = clamp(Math.round(ry), 0, rig.H - 1); if (A2[iy * rig.W + ix] > 30) return { x: rx, y: ry, L }; } } return null; };
  const paint = (q0, q1, sub) => { if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); const g = st.pm.getContext('2d'), s = st.pm.width / rig.W, r = st.bsize / 2 * dpr() / st.view.k; g.globalCompositeOperation = sub ? 'destination-out' : 'source-over'; g.strokeStyle = g.fillStyle = 'rgb(255,60,160)'; g.lineWidth = r * 2 * s; g.lineCap = g.lineJoin = 'round'; g.beginPath(); g.moveTo(q0.x * s, q0.y * s); g.lineTo(q1.x * s + 0.01, q1.y * s); g.stroke(); g.globalCompositeOperation = 'source-over'; if (!sub) st.pmAny = true; dirty(); };
  // 선 따라 칠하기: 그은 선의 가운데에서 퍼져 나가되, 그림의 선(경계)은 넘기 힘들게 → 붓 크기 안에서 선 안쪽만 채워져요
  const tmpPaint = (q0, q1) => { if (!st.pmTmp) st.pmTmp = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); const g = st.pmTmp.getContext('2d'), s = st.pmTmp.width / rig.W, r = st.bsize / 2 * dpr() / st.view.k; g.strokeStyle = 'rgb(255,60,160)'; g.lineWidth = r * 2 * s; g.lineCap = g.lineJoin = 'round'; g.beginPath(); g.moveTo(q0.x * s, q0.y * s); g.lineTo(q1.x * s + 0.01, q1.y * s); g.stroke(); st.tmpAny = true; dirty(); };
  const smartFill = D => {
    if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2));
    const w = st.pm.width, h = st.pm.height, s = w / rig.W, E = rgEdge(main, w, h), r = Math.max(2.5, D.r * s), rc = Math.max(1, r * 0.3), bud = Math.max(2, r - rc), pts = D.pts.map(p => [p[0] * s, p[1] * s]);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 = Math.max(0, Math.floor(x0 - r - 2)); y0 = Math.max(0, Math.floor(y0 - r - 2)); x1 = Math.min(w - 1, Math.ceil(x1 + r + 2)); y1 = Math.min(h - 1, Math.ceil(y1 + r + 2)); const bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bw < 1 || bh < 1) return;
    const dist = new Float32Array(bw * bh).fill(Infinity), hp = { d: new Float32Array(bw * bh * 8 + 16), v: new Int32Array(bw * bh * 8 + 16), n: 0, od: 0 };
    const seed = (x, y) => { for (let yy = Math.max(y0, Math.floor(y - rc)); yy <= Math.min(y1, Math.ceil(y + rc)); yy++) for (let xx = Math.max(x0, Math.floor(x - rc)); xx <= Math.min(x1, Math.ceil(x + rc)); xx++) { if ((xx - x) * (xx - x) + (yy - y) * (yy - y) > rc * rc) continue; const k = (yy - y0) * bw + xx - x0; if (dist[k] > 0) { dist[k] = 0; rgHeapPush(hp, 0, k); } } };
    for (let i = 0; i < pts.length; i++) { const a = pts[Math.max(0, i - 1)], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let t = 0; t <= n; t++) seed(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n); }
    while (hp.n) { const k = rgHeapPop(hp), d = hp.od; if (d > dist[k]) continue; const x = k % bw, y = (k / bw) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue; const q = yy * bw + xx, e = E[(yy + y0) * w + xx + x0], nd = d + (dx && dy ? 1.4142 : 1) * (1 + e * e * bud * 1.6); if (nd <= bud && nd < dist[q]) { dist[q] = nd; rgHeapPush(hp, nd, q); } } }
    const c = newCanvas(bw, bh), g = c.getContext('2d'), id = g.createImageData(bw, bh); for (let k = 0; k < bw * bh; k++) if (dist[k] <= bud) { id.data[k * 4] = 255; id.data[k * 4 + 1] = 60; id.data[k * 4 + 2] = 160; id.data[k * 4 + 3] = 255; } g.putImageData(id, 0, 0);
    const pg = st.pm.getContext('2d'); pg.globalCompositeOperation = D.sub ? 'destination-out' : 'source-over'; pg.drawImage(c, x0, y0); pg.globalCompositeOperation = 'source-over'; if (!D.sub) st.pmAny = true;
  };
  const invLin = (M, dx, dy) => { const det = M[0] * M[3] - M[1] * M[2] || 1; return [(M[3] * dx - M[2] * dy) / det, (-M[1] * dx + M[0] * dy) / det]; };
  ov.addEventListener('pointerdown', e => {
    if (st.busy) return; const q = toRig(e); ov.setPointerCapture(e.pointerId); e.preventDefault();
    if (e.button === 1 || e.button === 2 || st.space) { st.drag = { kind: 'pan', cx: q.cx, cy: q.cy, ox: st.view.ox, oy: st.view.oy }; return; }
    if (e.button !== 0) return;
    if (st.playing) { st.playing = false; syncPlay(); }
    if (st.mode === 'part') { const smart = st.brush === 'smart' || (st.brush === 'sub' && e.shiftKey); st.drag = { kind: 'paint', last: q, sub: e.altKey || st.brush === 'sub', smart, pts: [[q.x, q.y]], r: st.bsize / 2 * dpr() / st.view.k }; st.two = null; if (smart) tmpPaint(q, q); else paint(q, q, st.drag.sub); return; }
    // 다른 캐릭터를 눌렀으면 그 캐릭터로 바꿔요
    // 내 뼈 점 찍기 (같은 자리를 한 번 더 누르면 끝)
    if (st.mode === 'bone' && st.draft) { const D = st.draft, last = D.pts[D.pts.length - 1]; if (last && Math.hypot(last.x - q.x, last.y - q.y) * st.view.k < 6 * dpr()) { chainFinish(); return; } D.pts.push({ x: clamp(q.x, 0, rig.W), y: clamp(q.y, 0, rig.H) }); if (D.pts.length >= RG_CHAIN_KINDS[D.kind].pts.length) chainFinish(); else { renderSide(); dirty(); } return; }
    if (chars().length > 1 && st.tool !== 'pin' && !hitJoint(q) && !(st.mode === 'pose' && hitPin(q))) { const cs = chars(), tolC = (13 * dpr() / st.view.k) ** 2; let to = null; for (let ci = 0; ci < cs.length && !to; ci++) { if (cs[ci] === rig || !st.evs || !st.evs[ci]) continue; const Q = st.evs[ci].P; for (const id of RG_IDS) if (Q[id] && (Q[id].x - q.x) ** 2 + (Q[id].y - q.y) ** 2 < tolC) { to = cs[ci]; break; } } if (!to && !pickRest(q)) for (const c of [...cs].sort((x, y) => (y.cz || 0) - (x.cz || 0))) if (c !== rig && pickRest(q, c)) { to = c; break; } if (to) switchChar(to); }
    if (st.mode === 'bone') {
      if (rig.mouth) { const ey = rig.mouth, tol = 9 * dpr() / st.view.k; if (Math.abs(q.x - ey.x - ey.w) < tol && Math.abs(q.y - ey.y - ey.h) < tol) { snap(); st.selEye = 'm'; st.drag = { kind: 'mouthSize', x: q.x, y: q.y }; renderSide(); return; } }
      for (let i = rig.eyes.length - 1; i >= 0; i--) { const ey = rig.eyes[i], tol = 9 * dpr() / st.view.k; if (Math.abs(q.x - ey.x - ey.w) < tol && Math.abs(q.y - ey.y - ey.h) < tol) { snap(); st.selEye = i; st.drag = { kind: 'eyeSize', i, x: q.x, y: q.y, w: ey.w, h: ey.h }; renderSide(); return; } }
      const j = hitJoint(q);
      if (j) { snap(); st.sel = j; st.drag = { kind: 'rest', id: j, x: q.x, y: q.y, tree: e.shiftKey }; dirty(); return; }
      for (let i = rig.eyes.length - 1; i >= 0; i--) { const ey = rig.eyes[i]; if (q.x > ey.x && q.x < ey.x + ey.w && q.y > ey.y && q.y < ey.y + ey.h) { snap(); st.selEye = i; st.drag = { kind: 'eyeMove', i, x: q.x, y: q.y }; renderSide(); dirty(); return; } }
      if (rig.mouth) { const ey = rig.mouth; if (q.x > ey.x && q.x < ey.x + ey.w && q.y > ey.y - 3 && q.y < ey.y + ey.h + 3) { snap(); st.selEye = 'm'; st.drag = { kind: 'mouthMove', x: q.x, y: q.y }; renderSide(); dirty(); return; } }
      st.drag = { kind: 'pan', cx: q.cx, cy: q.cy, ox: st.view.ox, oy: st.view.oy }; return;
    }
    const pin = hitPin(q);
    if (pin) { snap(); st.selPin = pin.id; st.sel = null; keyHere(true); st.drag = { kind: 'pin', pin, x: q.x, y: q.y }; renderSide(); dirty(); return; }
    const j = hitJoint(q);
    if (j && st.tool !== 'pin') { snap(); st.sel = j; st.selPin = null; keyHere(true); st.drag = { kind: 'joint', id: j, x: q.x, y: q.y, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey }; renderSide(); dirty(); return; }
    if (st.tool === 'pin') { const r = pickRest(q); if (!r) { toast('캐릭터 위를 눌러 주세요'); return; } snap(); const p = { id: 'n' + uid(), x: r.x, y: r.y, r: Math.round(rgUnit(rig) * 0.4) }; rig.pins.push(p); for (const L of rig.layers) if (L.mesh) rgPinWeights(rig, L); st.selPin = p.id; st.sel = null; st.tool = 'move'; renderSide(); dirty(); return; }
    st.sel = null; st.selPin = null; renderSideSoon();
    st.drag = { kind: 'pan', cx: q.cx, cy: q.cy, ox: st.view.ox, oy: st.view.oy }; dirty();
  });
  ov.addEventListener('pointermove', e => {
    const q = toRig(e), D = st.drag; st.cur = { x: q.cx, y: q.cy };
    if (!D) { if (st.mode === 'part' || st.draft) dirty(); return; }
    if (D.kind === 'pan') { st.view.ox = D.ox + q.cx - D.cx; st.view.oy = D.oy + q.cy - D.cy; dirty(); return; }
    if (D.kind === 'paint') { if (D.smart) { tmpPaint(D.last, q); D.pts.push([q.x, q.y]); } else paint(D.last, q, D.sub); D.last = q; return; }
    const dx = q.x - D.x, dy = q.y - D.y; D.x = q.x; D.y = q.y;
    if (D.kind === 'rest') { rgFast = true; const ids = D.tree ? RG_IDS.filter(k => { for (let p = k; p && p !== 'fix'; p = rgPar(p, rig)) if (p === D.id) return true; return false; }) : [D.id]; for (const k of ids) { rig.joints[k].x = clamp(rig.joints[k].x + dx, 0, rig.W); rig.joints[k].y = clamp(rig.joints[k].y + dy, 0, rig.H); } D.moved = true; dirty(); return; }
    if (D.kind === 'eyeMove') { const ey = rig.eyes[D.i]; ey.x += dx; ey.y += dy; dirty(); return; }
    if (D.kind === 'mouthMove') { rig.mouth.x += dx; rig.mouth.y += dy; rig.mouth.est = false; dirty(); return; }
    if (D.kind === 'mouthSize') { rig.mouth.w = Math.max(6, rig.mouth.w + dx); rig.mouth.h = Math.max(3, rig.mouth.h + dy); rig.mouth.est = false; dirty(); return; }
    if (D.kind === 'eyeSize') { const ey = rig.eyes[D.i]; ey.w = Math.max(6, ey.w + dx); ey.h = Math.max(4, ey.h + dy); dirty(); return; }
    const key = keyHere(true), p = key.p, mats = rgMats(rig, p);
    if (D.kind === 'pin') { const w = pinPos(D.pin), Mj = w.L ? mats.M[RG_IDS[w.L.mesh.JI[w.vi * 4]]] : null, v = Mj ? invLin(Mj, dx, dy) : [dx, dy], o = p.pins[D.pin.id] || [0, 0]; p.pins[D.pin.id] = [o[0] + v[0], o[1] + v[1]]; dirty(); return; }
    if (D.kind === 'joint') {
      const id = D.id, par = rgPar(id, rig), P = mats.P, ik = rgIKOf(rig, id);
      if (id === rgBase(rig) && !D.ctrl) { p.tx += dx; p.ty += dy; }
      // 제자리에 고정된 내 뼈의 맨 앞 점은 끌면 그 뼈째 옮겨져요
      else if (D.ctrl || par === 'fix') { const B = par ? mats.M[par] : rgMul([1, 0, 0, 1, p.tx, p.ty], rgRS(rig.joints.root.x, rig.joints.root.y, p.rot, p.sc)), v = invLin(B, dx, dy), o = p.d[id] || [0, 0]; p.d[id] = [o[0] + v[0], o[1] + v[1]]; }
      else if (ik && !D.alt) rgIK(rig, p, ik[0], ik[1], id, P[id].x + dx, P[id].y + dy);
      else if (par) p.r[par] = (p.r[par] || 0) + rgAngDiff(Math.atan2(P[id].y + dy - P[par].y, P[id].x + dx - P[par].x), Math.atan2(P[id].y - P[par].y, P[id].x - P[par].x));
      dirty();
    }
  });
  const endDrag = () => { const D = st.drag; st.drag = null; if (!D) return; if (rgFast) { rgFast = false; for (const c of chars()) c.ver++; dirty(); } if (D.kind === 'paint' && D.smart) { try { smartFill(D); } catch (e) { console.warn('smartFill', e); } if (st.pmTmp) st.pmTmp.getContext('2d').clearRect(0, 0, st.pmTmp.width, st.pmTmp.height); st.tmpAny = false; dirty(); } if (D.kind === 'rest' && D.moved) { rig.ver++; dirty(); } if (D.kind === 'joint' || D.kind === 'pin') renderSide(); };
  ov.addEventListener('pointerup', endDrag); ov.addEventListener('pointercancel', endDrag);
  ov.addEventListener('pointerleave', () => { st.cur = null; if (st.mode === 'part') dirty(); });
  ov.addEventListener('contextmenu', e => e.preventDefault());
  ov.addEventListener('wheel', e => { e.preventDefault(); const q = toRig(e), f = e.deltaY < 0 ? 1.12 : 1 / 1.12, k = clamp(st.view.k * f, 0.05, 12); st.view.ox = q.cx - q.x * k; st.view.oy = q.cy - q.y * k; st.view.k = k; dirty(); }, { passive: false });

  /* 위쪽 단추·단축키 */
  function setMode(v) { st.mode = v; st.draft = null; st.playing = false; syncPlay(); st.tool = 'move'; $$('[data-rgm]', m).forEach(b => b.classList.toggle('on', b.dataset.rgm === v)); $('#rgTime', m).classList.toggle('off', v !== 'pose'); ov.style.cursor = v === 'part' ? 'none' : 'default'; renderSide(); dirty(); }
  $$('[data-rgm]', m).forEach(b => b.addEventListener('click', () => setMode(b.dataset.rgm)));
  $('#rgUndo', m).addEventListener('click', undo); $('#rgRedo', m).addEventListener('click', redo); $('#rgFit', m).addEventListener('click', fit);
  $('#rgSkel', m).addEventListener('change', e => { rgUi.skel = e.target.checked; dirty(); });
  const key = e => {
    if (!m.isConnected) { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', keyUp, true); return; }
    if ($('#modalRoot').lastElementChild !== bgEl) return; // 위에 다른 창(확인 등)이 떠 있으면 그쪽에 맡겨요
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') { if (e.key === 'Escape') e.target.blur(); e.stopPropagation(); return; }
    const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(); let used = true;
    if (c && k === 'z') { e.shiftKey ? redo() : undo(); } else if (c && k === 'y') redo();
    else if (c) used = false;
    else if (e.key === ' ') { st.space = true; if (!e.repeat && !st.drag) togglePlay(); }
    else if (k === 'h') { rgUi.skel = !rgUi.skel; $('#rgSkel', m).checked = rgUi.skel; dirty(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (st.mode === 'pose' && st.selPin) side.querySelector('[data-rga="pindel"]')?.click(); else if (st.mode === 'pose') delKey(); }
    else if (e.key === '[' || e.key === ']') { st.bsize = clamp(Math.round(st.bsize * (e.key === ']' ? 1.15 : 1 / 1.15)), 8, 240); const r = side.querySelector('[data-rgbs]'); if (r) r.value = st.bsize; dirty(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { if (st.mode === 'pose') setT(frameT(st.t) + (e.key === 'ArrowRight' ? 1 : -1) / rig.out.fps); }
    else if (e.key === 'Escape') { if (st.draft) { st.draft = null; renderSide(); dirty(); return void e.preventDefault(); } st.sel = null; st.selPin = null; st.tool = 'move'; renderSide(); dirty(); }
    else if (e.key === 'Enter' && st.draft) chainFinish();
    else if (k === '1' || k === '2' || k === '3') setMode(['bone', 'part', 'pose'][+k - 1]);
    else used = false;
    e.stopPropagation(); if (used) e.preventDefault(); // 이 창이 떠 있는 동안 편집기 단축키는 막아요
  };
  const keyUp = e => { if (e.key === ' ') st.space = false; };
  window.addEventListener('keydown', key, true); window.addEventListener('keyup', keyUp, true);
  const ro = new ResizeObserver(() => { if (m.isConnected) { resize(); } else ro.disconnect(); }); ro.observe(stage);

  /* 내보내기·닫기 */
  const oS = $('#rgOSize', m), oF = $('#rgOFps', m), oB = $('#rgOBg', m), oC = $('#rgOCol', m);
  oS.value = sizes.includes(rig.out.size) ? rig.out.size : sizes[sizes.length - 1]; rig.out.size = +oS.value; oF.value = rig.out.fps; oB.value = rig.out.bg; oC.value = rig.out.color; $('#rgOColW', m).style.display = rig.out.bg === 'color' ? '' : 'none';
  oS.addEventListener('change', () => { rig.out.size = +oS.value; }); oF.addEventListener('change', () => { rig.out.fps = +oF.value; syncTime(); });
  oB.addEventListener('change', () => { rig.out.bg = oB.value; $('#rgOColW', m).style.display = oB.value === 'color' ? '' : 'none'; dirty(); }); oC.addEventListener('input', () => { rig.out.color = oC.value; dirty(); });
  const keep = async () => { try { await rgStore(main, from.key); } catch (e) { console.warn('rgStore', e); } };
  const shut = () => { cancelAnimationFrame(raf); raf = 0; ro.disconnect(); window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', keyUp, true); rgGLFree(R); closeModal(); };
  $('#rgClose', m).addEventListener('click', async () => { if (st.busy) return; st.busy = true; tip.textContent = '작업을 보관하는 중…'; tip.style.display = 'block'; await keep(); shut(); toast('하던 작업을 보관했어요. 같은 그림에서 다시 열면 이어서 할 수 있어요.', 3600); });
  $('#rgGo', m).addEventListener('click', async () => {
    if (st.busy) return; const n = Math.round(A().dur * rig.out.fps), k = Math.min(1, rig.out.size / maxSide), px = Math.round(rig.W * k) * Math.round(rig.H * k) * n;
    if (px > 380e6 && !(await rgAsk(`${n}장을 ${rig.out.size}px로 만들면 컴퓨터가 버거울 수 있어요. 크기나 초당 장 수를 줄이는 게 좋아요. 그래도 만들까요?`))) return;
    st.busy = true; st.playing = false; await keep(); shut();
    const tk = czProgress('움직임을 그리는 중');
    try { const frames = await rgRenderFrames(main, main.out, tk); tk.done(); await from.onFrames(frames, rig.out.fps, from.key); }
    catch (e) { tk.done(); if (String(e && e.message) !== 'stop') toast('만들지 못했어요. ' + czErrText(e), 5000); }
  });
  if (from.onStill) $('#rgStill', m).addEventListener('click', async () => {
    if (st.busy) return; st.busy = true; const t = st.mode === 'pose' ? st.t : 0; await keep(); shut();
    try { const fr = await rgRenderFrames(main, { size: maxSide, fps: main.out.fps, bg: 'fill', t }, null, true); await from.onStill(fr[0], main); }
    catch (e) { toast('만들지 못했어요. ' + czErrText(e), 5000); }
  });
  setMode(st.mode); syncTime(); syncPlay(); resize();
  const nC = chars().length, noSk = chars().filter(c => c.autoSk === false);
  if (nC > 1) toast(`캐릭터 ${nC}명을 따로 나눴어요. 그림에서 캐릭터를 누르면 그 캐릭터를 움직일 수 있어요.${noSk.length ? ' ' + noSk.map(c => c.cname).join(', ') + '은(는) 뼈대를 찾지 못했으니 ① 뼈대 맞추기에서 맞춰 주세요.' : ''}`, 6500);
  else if (rig.autoSk === false) toast(rig.stdOff ? 'AI가 사람 모양 뼈대를 찾지 못했어요. ① 뼈대 맞추기의 \'내 뼈\'에서 움직일 곳(손·팔·다리·목 등)에만 뼈를 넣어 주세요.' : 'AI가 뼈대를 찾지 못했어요. ① 뼈대 맞추기에서 관절을 그림에 맞춰 주세요.', 6500);
  else if (main.autoParts && main.autoParts.length) toast(`몸 앞에 겹친 ${main.autoParts.join(', ')}은(는) 따로 움직이게 떼어 놨어요. (② 부위 나누기에서 다시 합칠 수 있어요)`, 5600);
  else if ((rig.conf || 0) < 0.45) toast('뼈대가 조금 어긋났을 수 있어요. ① 뼈대 맞추기에서 확인해 보세요.', 4600);
  main.autoParts = null;
  window.__rg = { get rig() { return rig; }, main, chars, switchChar, st, setMode, setT, dirty, render: () => render(performance.now()) }; // 시험용
}
// 이 창 위에 뜨는 작은 물음·입력 창 (modal()은 창을 하나만 띄워서 따로 만들어요)
function rgMini(html, onMount) {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.style.zIndex = 70; bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`; $('#modalRoot').appendChild(bg);
    const end = v => { bg.remove(); res(v); }; onMount(bg.firstElementChild, end);
    bg.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') end(null); }, true);
  });
}
const rgAsk = q => rgMini(`<h2>확인</h2><p>${esc(q)}</p><div class="foot"><button class="btn" data-n>취소</button><button class="btn primary" data-y>계속</button></div>`, (m, end) => { $('[data-n]', m).addEventListener('click', () => end(false)); $('[data-y]', m).addEventListener('click', () => end(true)); setTimeout(() => $('[data-y]', m).focus(), 30); });
const rgPrompt = (label, val) => rgMini(`<h2>${esc(label)}</h2><input type="text" value="${esc(val || '')}" style="width:100%;height:32px;border:1px solid var(--line2);border-radius:6px;padding:0 9px" maxlength="20"><div class="foot"><button class="btn" data-n>취소</button><button class="btn primary" data-y>확인</button></div>`, (m, end) => { const i = $('input', m); setTimeout(() => { i.focus(); i.select(); }, 30); $('[data-n]', m).addEventListener('click', () => end(null)); $('[data-y]', m).addEventListener('click', () => end(i.value.trim())); i.addEventListener('keydown', e => { if (e.key === 'Enter') end(i.value.trim()); }); });

/* ---- 여는 곳: 이미지 편집의 그림 / 영상 장면 ---- */
function rgFromImage() {
  const pg = page(); if (!isImg() || !pg || pg.ph) { toast('이미지 편집에서 그림을 연 뒤 써 주세요'); return; }
  const ss = selEls(), s0 = ss.length === 1 ? ss[0] : null, el = s0 && !s0.lock && imgLayerEl(s0) && s0.img ? s0 : baseEl(pg); if (!el) { toast('그림이 없어요'); return; }
  const L = el.type === 'panel' ? activeObj(el) : el, o = aiImg(L); if (!o) { toast('그림을 아직 읽는 중이에요. 잠시 뒤에 다시 눌러 주세요'); return; }
  const nm = (pg.name || '그림').replace(/\.[^.]+$/, '');
  rgOpen({ src: o.im, W: o.W, H: o.H, name: nm, key: edPj + ':i' + o.rec.id, goLabel: '영상·움짤 탭에 넣기',
    onFrames: async (frames, fps, key) => {
      await pjOpenGif(); const clip = 'c' + uid(); let n = 0;
      for (let i = 0; i < frames.length; i++) if (gsAddBitmap(frames[i], nm + ' 움직임', { dur: Math.round(1000 / fps) / 1000, motion: 'none', tr: i ? 'none' : null, fit: 'contain', clip, rig: key })) n++;
      if (n < frames.length) gsFull();
      gs.sel = Math.max(0, gs.slides.length - n); gsChanged(); toast(`움직이는 장면 ${n}장을 영상·움짤 탭에 넣었어요. 장면을 고르고 '캐릭터 움직이기'를 누르면 다시 고칠 수 있어요`, 5200);
    },
    onStill: async c => {
      const B = baseEl(pg), src = c.toDataURL('image/png'), im = await loadImg(src), nr = { id: uid(), name: nm + ' (자세).png', src, w: c.width, h: c.height, kind: 'stamp' }; addImageRecord(nr, true, im);
      const P = makePanel(el.x + el.w / 2, el.y + el.h / 2, el.w, el.h, nr.id); P.bw = 0; P.radius = 0; P.name = '자세 바꿈'; if (el.rot) P.rot = el.rot; if (el.flip) P.flip = el.flip;
      pg.els.splice(pg.els.indexOf(el) + 1, 0, P); sel = [P.id]; e2SetHint('자세 바꿈'); commit(); renderProps(); renderLayersSoon(); requestRender();
      toast("지금 자세를 새 레이어 '자세 바꿈'으로 넣었어요. 마음에 안 들면 Ctrl+Z", 3600);
    } });
}
function rgFromScene() {
  const s = gs.slides[gs.sel]; if (!s) { toast('먼저 장면을 골라 주세요'); return; }
  const key = s.rig || (gifPj + ':s' + s.id);
  rgOpen({ src: s.bmp, W: s.bmp.width, H: s.bmp.height, name: s.name, key, goLabel: s.rig ? '장면 바꾸기' : '이 장면을 바꾸기',
    onFrames: async (frames, fps) => {
      const i0 = gs.slides.indexOf(s); if (i0 < 0) return;
      const olds = s.rig && s.clip ? gs.slides.filter(x => x.clip === s.clip && x.rig === s.rig) : [s], at = gs.slides.indexOf(olds[0]), clip = 'c' + uid();
      const add = frames.map((c, k) => ({ ...olds[0], id: uid(), bmp: c, blob: null, blobOf: null, w: c.width, h: c.height, dur: Math.round(1000 / fps) / 1000, motion: 'none', tr: k ? 'none' : olds[0].tr, trd: k ? undefined : olds[0].trd, kf: k ? undefined : olds[0].kf, clip, rig: key, name: (s.name || '장면').replace(/ 움직임$/, '') + ' 움직임' }));
      for (const x of olds.slice(1)) gs.slides.splice(gs.slides.indexOf(x), 1);
      gs.slides.splice(gs.slides.indexOf(olds[0]), 1, ...add);
      gs.sel = at; gs.pick = new Set(); gsChanged(); toast(`장면을 움직이는 장면 ${add.length}장으로 바꿨어요. 다시 '캐릭터 움직이기'를 누르면 이어서 고칠 수 있어요`, 4600);
    } });
}
