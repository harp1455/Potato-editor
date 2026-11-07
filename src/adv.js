/* ================= 고급 보정 (그래픽카드 WebGL로 계산) ================= */
// 그림 레이어(컷 그림, 이미지 편집의 바탕 그림)에 붙는 보정값. 기본값과 같으면 계산을 건너뛰어요
const ADV = {
  exposure: 0, hl: 0, sh: 0, whites: 0, blacks: 0, // 빛
  temp: 0, tint: 0, vib: 0, // 색
  lvIn0: 0, lvGam: 1, lvIn1: 255, lvOut0: 0, lvOut1: 255, // 레벨
  sharp: 0, sharpR: 1, clarity: 0, // 디테일
  grain: 0, grainSize: 1.5, fade: 0, stOn: false, stSh: '#1f5f8b', stHi: '#ffb05c', stBal: 0, stA: 35, // 효과
};
const ADV_KEYS = Object.keys(ADV);
const ADV_BANDS = [['빨강', '#e5484d', 0, 25], ['주황', '#f08c2e', 30, 25], ['노랑', '#e7c32b', 60, 35], ['초록', '#46a758', 120, 55], ['하늘', '#2bb7c9', 180, 50], ['파랑', '#3e63dd', 235, 40], ['보라', '#8e4ec6', 275, 30], ['자홍', '#d6409f', 315, 30]];
const advBypass = { on: false }; // '원본 비교'를 누르고 있는 동안
const curveIsId = pts => !pts || (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 255 && pts[1][1] === 255);
const curvesOn = L => !!(L.curves && ['rgb', 'r', 'g', 'b'].some(c => !curveIsId(L.curves[c])));
const hslOn = L => !!(L.hsl && L.hsl.some(b => b && (b[0] || b[1] || b[2])));
// 이 레이어의 고급 보정을 나타내는 짧은 글(캐시 이름). 아무것도 안 바꿨으면 ''
function advKey(L, force) {
  if (!L || (advBypass.on && !force)) return '';
  const p = [];
  for (const k of ADV_KEYS) { if (k === 'stSh' || k === 'stHi' || k === 'stBal' || k === 'stA') continue; const v = L[k]; if (v !== undefined && v !== ADV[k]) p.push(k + v); }
  if (L.stOn) p.push(L.stSh || ADV.stSh, L.stHi || ADV.stHi, L.stBal ?? 0, L.stA ?? ADV.stA);
  if (!p.length && !curvesOn(L) && !hslOn(L)) return '';
  if (curvesOn(L)) p.push('c' + JSON.stringify(L.curves));
  if (hslOn(L)) p.push('h' + JSON.stringify(L.hsl));
  return p.join(',');
}
const advVal = (L, k) => L[k] ?? ADV[k];
function advState(L) { // 보정값만 뽑기 (프리셋 저장, 다른 그림에 적용)
  const st = {};
  for (const k of ADV_KEYS) if (L[k] !== undefined && L[k] !== ADV[k]) st[k] = L[k];
  if (curvesOn(L)) st.curves = JSON.parse(JSON.stringify(L.curves));
  if (hslOn(L)) st.hsl = JSON.parse(JSON.stringify(L.hsl));
  return st;
}
function advClear(L) { for (const k of ADV_KEYS) delete L[k]; delete L.curves; delete L.hsl; }
function advSetState(L, st) { advClear(L); Object.assign(L, JSON.parse(JSON.stringify(st || {}))); }

/* ---- 곡선: 점들을 지나는 부드러운 단조 곡선 (Fritsch–Carlson) → 0~255 표 ---- */
function curveTable(pts) {
  const P = (pts && pts.length >= 2 ? pts : [[0, 0], [255, 255]]).slice().sort((a, b) => a[0] - b[0]);
  const n = P.length, xs = P.map(p => p[0]), ys = P.map(p => p[1]), out = new Uint8Array(256);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  for (let x = 0; x < 256; x++) {
    let y;
    if (x <= xs[0]) y = ys[0]; else if (x >= xs[n - 1]) y = ys[n - 1];
    else {
      let i = 0; while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    }
    out[x] = Math.max(0, Math.min(255, Math.round(y)));
  }
  return out;
}

/* ---- WebGL 계산기 ---- */
const ADV_VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const ADV_FS1 = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform sampler2D lut; uniform int uCurve;
uniform float uExp, uHl, uSh, uWh, uBl, uTemp, uTint, uVib, uFade;
uniform float uIn0, uIn1, uGam, uOut0, uOut1;
uniform int uHslOn; uniform vec3 uHsl[8]; uniform vec2 uBand[8];
uniform int uSt; uniform vec3 uStSh, uStHi; uniform float uStBal, uStA;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 rgb2hsl(vec3 c){
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn), h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float hue2(float p, float q, float t){ t = fract(t); if (t < 1.0/6.0) return p + (q - p) * 6.0 * t; if (t < 0.5) return q; if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0; return p; }
vec3 hsl2rgb(vec3 h){ if (h.y < 1e-5) return vec3(h.z); float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y, p = 2.0 * h.z - q; return vec3(hue2(p, q, h.x + 1.0/3.0), hue2(p, q, h.x), hue2(p, q, h.x - 1.0/3.0)); }
vec3 softl(vec3 b, vec3 t){ return mix(2.0*b*t + b*b*(1.0 - 2.0*t), sqrt(max(b, 0.0))*(2.0*t - 1.0) + 2.0*b*(1.0 - t), step(0.5, t)); }
void main(){
  vec4 s = texture(tex, uv); vec3 c = s.rgb;
  // 노출·화이트밸런스 (선형 공간에서)
  vec3 l = pow(max(c, 0.0), vec3(2.2)) * exp2(uExp);
  vec3 m = vec3(1.0 + 0.32*uTemp, 1.0 + 0.02*uTemp, 1.0 - 0.32*uTemp) * vec3(1.0 + 0.12*uTint, 1.0 - 0.22*uTint, 1.0 + 0.12*uTint);
  m /= luma(m); l *= m;
  c = pow(max(l, 0.0), vec3(1.0/2.2));
  // 밝은 곳·어두운 곳·흰색·검은색 (밝기 기준, 색은 그대로)
  float Y = luma(c);
  float wS = 1.0 - smoothstep(0.0, 0.6, Y), wH = smoothstep(0.4, 1.0, Y), wB = 1.0 - smoothstep(0.0, 0.3, Y), wW = smoothstep(0.7, 1.0, Y);
  float dY = uSh*0.28*wS + uHl*0.28*wH + uBl*0.16*wB + uWh*0.16*wW;
  if (dY != 0.0) { float Y2 = clamp(Y + dY, 0.0, 1.0); c = mix(c + (Y2 - Y), c * (Y2 / max(Y, 0.004)), clamp(Y * 4.0, 0.0, 1.0)); }
  // 레벨
  c = clamp((c - uIn0) / max(uIn1 - uIn0, 0.004), 0.0, 1.0); c = pow(c, vec3(1.0 / uGam)); c = mix(vec3(uOut0), vec3(uOut1), c);
  // 곡선 (RGB 곡선을 거친 뒤 채널 곡선까지 표 하나에)
  if (uCurve == 1) { vec3 k = clamp(c, 0.0, 1.0) * (255.0/256.0) + 0.5/256.0; c = vec3(texture(lut, vec2(k.r, 0.5)).r, texture(lut, vec2(k.g, 0.5)).g, texture(lut, vec2(k.b, 0.5)).b); }
  // 생동감·색상별
  if (uVib != 0.0 || uHslOn == 1) {
    vec3 h = rgb2hsl(clamp(c, 0.0, 1.0));
    if (uVib != 0.0) h.y = clamp(h.y * (1.0 + uVib * (uVib > 0.0 ? (1.0 - h.y) : 1.0)), 0.0, 1.0);
    if (uHslOn == 1 && h.y > 0.0) {
      float dh = 0.0, ds = 0.0, dl = 0.0;
      for (int i = 0; i < 8; i++) {
        float dist = abs(fract(h.x - uBand[i].x + 0.5) - 0.5) * 360.0, w = clamp(1.0 - dist / uBand[i].y, 0.0, 1.0); w = w*w*(3.0 - 2.0*w);
        dh += w * uHsl[i].x; ds += w * uHsl[i].y; dl += w * uHsl[i].z;
      }
      float cw = smoothstep(0.0, 0.25, h.y);
      h.x = fract(h.x + dh * 30.0 / 360.0 * cw); h.y = clamp(h.y * (1.0 + ds * cw), 0.0, 1.0); h.z = clamp(h.z + dl * 0.22 * cw * (1.0 - abs(2.0*h.z - 1.0)), 0.0, 1.0);
    }
    c = hsl2rgb(h);
  }
  // 분할 톤
  if (uSt == 1) {
    float Y3 = luma(c), mid = 0.5 + uStBal * 0.35;
    c = mix(c, softl(c, uStSh), (1.0 - smoothstep(0.0, mid, Y3)) * uStA);
    c = mix(c, softl(c, uStHi), smoothstep(mid, 1.0, Y3) * uStA);
  }
  if (uFade > 0.0) c = c * (1.0 - uFade * 0.22) + uFade * 0.12;
  o = vec4(clamp(c, 0.0, 1.0), s.a);
}`;
const ADV_FS2 = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex; uniform vec2 px; uniform float uSharp, uSharpR, uClar, uClarLod, uGrain, uGrainSize, uSeed;
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32 + uSeed); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec4 s = texture(tex, uv); vec3 c = s.rgb;
  if (uSharp > 0.0) {
    vec3 b = vec3(0.0); float ws = 0.0;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) { float w = exp(-float(x*x + y*y) / 2.5); b += texture(tex, uv + vec2(float(x), float(y)) * px * uSharpR * 0.55).rgb * w; ws += w; }
    b /= ws; vec3 d = c - b; c += d * uSharp * 1.6;
  }
  if (uClar != 0.0) {
    vec3 bl = (textureLod(tex, uv, uClarLod).rgb * 2.0 + textureLod(tex, uv + px * 3.0, uClarLod).rgb + textureLod(tex, uv - px * 3.0, uClarLod).rgb) * 0.25;
    float Y = luma(c), w = 1.0 - pow(abs(2.0 * Y - 1.0), 2.0);
    c += (c - bl) * uClar * 0.8 * w;
  }
  if (uGrain > 0.0) {
    vec2 g = uv / px / uGrainSize; float n = vnoise(g) * 0.6 + vnoise(g * 2.13 + 7.1) * 0.4;
    float Y = luma(c); c += (n - 0.5) * uGrain * 0.22 * (1.0 - 0.55 * abs(2.0 * Y - 1.0));
  }
  o = vec4(clamp(c, 0.0, 1.0), s.a);
}`;
const advG = { gl: null, cv: null, p1: null, p2: null, vao: null, lut: null, t1: null, fb: null, w: 0, h: 0, src: new Map(), max: 4096 };
function advGL() {
  if (advG.gl) return advG.gl;
  if (advG.gl === false) return null;
  try {
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('webgl2');
    const mk = (fs) => {
      const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, ADV_VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), nm = a.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    advG.p1 = mk(ADV_FS1); advG.p2 = mk(ADV_FS2);
    advG.vao = gl.createVertexArray(); gl.bindVertexArray(advG.vao);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    advG.lut = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, advG.lut);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    advG.fb = gl.createFramebuffer(); advG.max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); advG.gl = null; advG.src.clear(); advG.t1 = null; advG.w = advG.h = 0; });
    advG.cv = cv; advG.gl = gl; return gl;
  } catch (e) { console.warn('고급 보정을 쓸 수 없어요', e); advG.gl = false; return null; }
}
function advTex(gl, mips) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
// 원본(그 크기로 줄인 것)을 그래픽카드에 올려 두기. 같은 그림·같은 크기는 다시 안 올려요 (최근 4개)
function advSrcTex(gl, key, im, W, H) {
  const hit = advG.src.get(key); if (hit) { advG.src.delete(key); advG.src.set(key, hit); return hit; }
  let up = im;
  if (im.naturalWidth !== W || im.naturalHeight !== H || im.width !== W) { up = newCanvas(W, H); const g = up.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, W, H); }
  const t = advTex(gl, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, up);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  advG.src.set(key, t);
  while (advG.src.size > 4) { const k = advG.src.keys().next().value; gl.deleteTexture(advG.src.get(k)); advG.src.delete(k); }
  return t;
}
const hexRgb = h => { const n = parseInt(String(h || '#000').replace('#', ''), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
// 그림 im을 W×H 크기로 보정한 캔버스. lv = 원래보다 몇 배 줄였는지 (선명하게·입자 크기를 원래 그림 기준으로 맞춰요)
function advProcess(id, im, W, H, L, lv) {
  const gl = advGL(); if (!gl || W > advG.max || H > advG.max || W < 2 || H < 2) return null;
  const v = k => advVal(L, k);
  const src = advSrcTex(gl, id + '|' + W + 'x' + H, im, W, H);
  const clar = v('clarity') / 100;
  if (!advG.t1 || advG.w !== W || advG.h !== H) {
    if (advG.t1) gl.deleteTexture(advG.t1);
    advG.t1 = advTex(gl, true); gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(W, H))) + 1, gl.RGBA8, W, H);
    advG.w = W; advG.h = H;
  }
  advG.cv.width = W; advG.cv.height = H;
  gl.bindVertexArray(advG.vao);
  // 1단계: 색
  const curve = curvesOn(L);
  if (curve) {
    const C = L.curves, all = curveTable(C.rgb), r = curveTable(C.r), g = curveTable(C.g), b = curveTable(C.b), px = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { px[i * 4] = r[all[i]]; px[i * 4 + 1] = g[all[i]]; px[i * 4 + 2] = b[all[i]]; px[i * 4 + 3] = 255; }
    gl.bindTexture(gl.TEXTURE_2D, advG.lut); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  const P1 = advG.p1, u = P1.u; gl.useProgram(P1.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(u.tex, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, advG.lut); gl.uniform1i(u.lut, 1); gl.uniform1i(u.uCurve, curve ? 1 : 0);
  gl.uniform1f(u.uExp, v('exposure')); gl.uniform1f(u.uHl, v('hl') / 100); gl.uniform1f(u.uSh, v('sh') / 100); gl.uniform1f(u.uWh, v('whites') / 100); gl.uniform1f(u.uBl, v('blacks') / 100);
  gl.uniform1f(u.uTemp, v('temp') / 100); gl.uniform1f(u.uTint, v('tint') / 100); gl.uniform1f(u.uVib, v('vib') / 100); gl.uniform1f(u.uFade, v('fade') / 100);
  gl.uniform1f(u.uIn0, v('lvIn0') / 255); gl.uniform1f(u.uIn1, v('lvIn1') / 255); gl.uniform1f(u.uGam, clamp(v('lvGam'), 0.1, 9.99)); gl.uniform1f(u.uOut0, v('lvOut0') / 255); gl.uniform1f(u.uOut1, v('lvOut1') / 255);
  const ho = hslOn(L); gl.uniform1i(u.uHslOn, ho ? 1 : 0);
  if (ho) {
    const a = new Float32Array(24), bd = new Float32Array(16);
    ADV_BANDS.forEach((B, i) => { const h = (L.hsl[i] || [0, 0, 0]); a[i * 3] = h[0] / 100; a[i * 3 + 1] = h[1] / 100; a[i * 3 + 2] = h[2] / 100; bd[i * 2] = B[2] / 360; bd[i * 2 + 1] = B[3]; });
    gl.uniform3fv(u.uHsl, a); gl.uniform2fv(u.uBand, bd);
  }
  gl.uniform1i(u.uSt, v('stOn') ? 1 : 0);
  if (v('stOn')) { gl.uniform3fv(u.uStSh, hexRgb(v('stSh'))); gl.uniform3fv(u.uStHi, hexRgb(v('stHi'))); gl.uniform1f(u.uStBal, v('stBal') / 100); gl.uniform1f(u.uStA, v('stA') / 100); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, advG.fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, advG.t1, 0);
  gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3);
  // 2단계: 선명하게·또렷함·필름 질감
  gl.bindTexture(gl.TEXTURE_2D, advG.t1);
  if (clar) gl.generateMipmap(gl.TEXTURE_2D);
  const P2 = advG.p2, u2 = P2.u; gl.useProgram(P2.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, advG.t1); gl.uniform1i(u2.tex, 0);
  gl.uniform2f(u2.px, 1 / W, 1 / H);
  gl.uniform1f(u2.uSharp, v('sharp') / 100); gl.uniform1f(u2.uSharpR, Math.max(0.35, v('sharpR') / lv));
  gl.uniform1f(u2.uClar, clar); gl.uniform1f(u2.uClarLod, Math.max(0, Math.log2(Math.max(2, Math.min(W, H) * 0.018))));
  gl.uniform1f(u2.uGrain, v('grain') / 100); gl.uniform1f(u2.uGrainSize, Math.max(0.5, v('grainSize') / lv)); gl.uniform1f(u2.uSeed, (String(id).length * 7.13) % 13);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = newCanvas(W, H); out.getContext('2d').drawImage(advG.cv, 0, 0);
  return out;
}

/* ---- 히스토그램 (레벨·곡선 칸 뒤에 깔아요) ---- */
const advHists = new Map();
function advDrop(id) { // 그림이 바뀌면(자르기·돌리기) 올려 둔 원본과 히스토그램을 버려요
  advHists.delete(id);
  const gl = advG.gl; if (!gl) return;
  for (const k of [...advG.src.keys()]) if (!id || k.startsWith(id + '|')) { gl.deleteTexture(advG.src.get(k)); advG.src.delete(k); }
}
function advHist(id) {
  if (advHists.has(id)) return advHists.get(id);
  const im = imgCache.get(id); if (!im || !im.complete || !im.naturalWidth) return null;
  const s = Math.min(1, 300 / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * s)), h = Math.max(1, Math.round(im.naturalHeight * s));
  const c = newCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, H = { l: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), n: w * h };
  for (let i = 0; i < d.length; i += 4) { H.r[d[i]]++; H.g[d[i + 1]]++; H.b[d[i + 2]]++; H.l[Math.round(d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722)]++; }
  advHists.set(id, H); return H;
}
function drawHist(g, H, ch, W, Hh, color) {
  const a = H[ch] || H.l; let mx = 0; for (let i = 2; i < 254; i++) mx = Math.max(mx, a[i]); mx = mx || 1;
  g.fillStyle = color; g.beginPath(); g.moveTo(0, Hh);
  for (let i = 0; i < 256; i++) g.lineTo(i / 255 * W, Hh - Math.min(1, a[i] / mx) * Hh * 0.95);
  g.lineTo(W, Hh); g.closePath(); g.fill();
}

/* ---- 화면 (오른쪽 속성 칸) ---- */
let advCh = 'rgb', advBand = 0;
const ADV_CH = [['rgb', 'RGB'], ['r', '빨강'], ['g', '초록'], ['b', '파랑']];
const ADV_LOOKS = [ // 기본 보정 프리셋
  ['선명한 애니', { vib: 28, clarity: 22, sharp: 35, sh: 12 }],
  ['자연스럽게 선명', { sharp: 45, sharpR: 1, clarity: 12, vib: 10 }],
  ['따뜻하게', { temp: 28, vib: 10, stOn: true, stSh: '#5a3a2a', stHi: '#ffb35c', stA: 18 }],
  ['차갑게', { temp: -28, tint: 4, vib: 6 }],
  ['영화 느낌', { stOn: true, stSh: '#1c6b8a', stHi: '#ffa85c', stA: 38, vib: 8, fade: 8, curves: { rgb: [[0, 0], [64, 54], [192, 204], [255, 255]] } }],
  ['필름', { fade: 32, grain: 28, grainSize: 1.6, temp: 8, vib: -12, curves: { rgb: [[0, 12], [70, 62], [190, 200], [255, 246]] } }],
  ['빈티지', { fade: 42, temp: 22, vib: -28, grain: 18, stOn: true, stSh: '#3b2a5c', stHi: '#ffd08a', stA: 30 }],
  ['파스텔', { exposure: 0.2, hl: -22, sh: 30, vib: -18, fade: 22 }],
  ['밤 분위기', { exposure: -0.45, temp: -36, tint: 8, hl: -24, stOn: true, stSh: '#0b1a4a', stHi: '#9fb6ff', stA: 30 }],
  ['흑백 진하게', { clarity: 30, vib: -100, curves: { rgb: [[0, 0], [60, 42], [196, 214], [255, 255]] } }],
  ['뽀얗게', { exposure: 0.25, sh: 25, hl: -10, clarity: -30, vib: -6, temp: 6 }],
  ['강렬하게', { vib: 40, clarity: 35, blacks: -25, whites: 15, curves: { rgb: [[0, 0], [70, 56], [186, 202], [255, 255]] } }],
];
const ssec = (id, title, body) => `<details class="sec subsec" data-sec="${id}" ${openSecs.has(id) ? 'open' : ''}><summary>${title}</summary><div class="body">${body}</div></details>`;
openSecs.add('adv-light');
const advLooksUser = () => { try { return JSON.parse(localStorage.getItem('potatoLooks') || '[]'); } catch (_) { return []; } };
const advLooksSave = a => { try { localStorage.setItem('potatoLooks', JSON.stringify(a)); } catch (_) { } };
function advSec(el, A) {
  const on = !!advKey(A, true);
  const mine = advLooksUser();
  const multi = isImg() && realIdx().length > 1;
  const fo = isImg() && page().folder && folderById(page().folder);
  return sec('adv', '고급 보정', `
    <div class="btnrow"><button class="btn sm" data-act="adv-auto" title="가장 어두운 곳과 밝은 곳을 찾아 대비를 맞춰요">자동 보정</button><button class="btn sm" data-advcmp="1" title="누르고 있는 동안 보정 전 그림을 보여 줘요">누르고 원본 보기</button><button class="btn sm" data-act="adv-reset">처음대로</button></div>
    ${ssec('adv-light', '빛·색', LS(row('노출', range('exposure', -2, 2, 0.05)) + row('밝은 곳', range('hl', -100, 100, 1)) + row('어두운 곳', range('sh', -100, 100, 1)) + row('흰색', range('whites', -100, 100, 1)) + row('검은색', range('blacks', -100, 100, 1))
      + row('색 온도', range('temp', -100, 100, 1)) + row('색조', range('tint', -100, 100, 1)) + row('생동감', range('vib', -100, 100, 1))))}
    ${ssec('adv-curve', '곡선', `<p class="muted small" style="margin:0 0 4px">점을 끌어 바꿔요. 빈 곳 클릭 = 점 추가, 두 번 클릭이나 밖으로 끌기 = 지우기</p>
    <div class="seg advchs">${ADV_CH.map(([c, l]) => `<button class="btn sm ${advCh === c ? 'on' : ''}" data-act="adv-ch" data-v="${c}">${l}</button>`).join('')}</div>
    <canvas class="advcurve" width="480" height="480" data-advcurve="1"></canvas>
    <div class="btnrow"><button class="btn sm" data-act="adv-curve-s">S자 (대비)</button><button class="btn sm" data-act="adv-curve-fade">바랜 느낌</button><button class="btn sm" data-act="adv-curve-reset">이 곡선 처음대로</button></div>`)}
    ${ssec('adv-level', '레벨', `<canvas class="advhist" width="480" height="110" data-advhist="1"></canvas>
    ${LS(row('입력 검정', range('lvIn0', 0, 254, 1)) + row('중간(감마)', range('lvGam', 0.1, 4, 0.01)) + row('입력 흰색', range('lvIn1', 1, 255, 1)) + row('출력 검정', range('lvOut0', 0, 255, 1)) + row('출력 흰색', range('lvOut1', 0, 255, 1)))}`)}
    ${ssec('adv-hsl', '색상별 (HSL)', `<div class="advbands">${ADV_BANDS.map(([n, c], i) => `<button class="advband ${advBand === i ? 'on' : ''}" data-act="adv-band" data-v="${i}" title="${n}" style="background:${c}"></button>`).join('')}<span class="muted small">${ADV_BANDS[advBand][0]}</span></div>
    ${['색조', '채도', '밝기'].map((l, k) => row(l, `<input type="range" data-hslk="${k}" min="-100" max="100" step="1" aria-label="${l}"><input type="number" data-hslk="${k}" min="-100" max="100" step="1">`)).join('')}
    <div class="btnrow"><button class="btn sm" data-act="adv-hsl-reset">색상별 처음대로</button></div>`)}
    ${ssec('adv-detail', '디테일·효과', `${LS(row('선명하게', range('sharp', 0, 200, 1)) + row('선명 반경', range('sharpR', 0.5, 4, 0.1)) + row('또렷함', range('clarity', -100, 100, 1))
      + row('필름 질감', range('grain', 0, 100, 1)) + row('입자 크기', range('grainSize', 0.5, 5, 0.1)) + row('색 바램', range('fade', 0, 100, 1)))}
    <div class="btnrow">${LS(check('stOn', '분할 톤 (어두운 곳·밝은 곳에 다른 색)'))}</div>
    ${A.stOn ? LS(row('어두운 곳', color('stSh')) + row('밝은 곳', color('stHi')) + row('균형', range('stBal', -100, 100, 1)) + row('세기', range('stA', 0, 100, 1))) : ''}`)}
    <h4 class="advh">보정 프리셋</h4>
    <div class="advlooks">${ADV_LOOKS.map(([n], i) => `<button class="btn sm" data-act="adv-look" data-v="b${i}">${n}</button>`).join('')}${mine.map((x, i) => `<span class="advmine"><button class="btn sm" data-act="adv-look" data-v="u${i}">${esc(x.name)}</button><button class="btn sm" data-act="adv-look-del" data-v="${i}" title="이 프리셋 지우기">×</button></span>`).join('')}</div>
    <div class="btnrow"><button class="btn sm" data-act="adv-save">지금 보정을 프리셋으로 저장</button></div>
    ${multi ? `<div class="btnrow">${fo ? `<button class="btn sm" data-act="adv-apply" data-v="fold">'${esc(fo.name)}' 폴더 전체에 같은 보정</button>` : ''}<button class="btn sm" data-act="adv-apply" data-v="all">모든 그림에 같은 보정</button></div>` : ''}
    ${advG.gl === false ? '<p class="muted small">이 컴퓨터에서는 고급 보정을 쓸 수 없어요 (WebGL2가 꺼져 있어요).</p>' : ''}`, on ? '켜짐' : '');
}
const advLayer = () => { const el = selEls()[0]; return el && el.type === 'panel' ? activeObj(el) : null; };
function advAct(act, v) {
  const el = selEls()[0], A = advLayer(); if (!A) return;
  const keepCurve = () => { A.curves = A.curves || {}; for (const c of ['rgb', 'r', 'g', 'b']) if (!A.curves[c]) A.curves[c] = [[0, 0], [255, 255]]; };
  switch (act) {
    case 'adv-reset': advClear(A); break;
    case 'adv-auto': {
      const H = advHist(A.img); if (!H) return;
      const pct = q => { let s = 0; for (let i = 0; i < 256; i++) { s += H.l[i]; if (s >= H.n * q) return i; } return 255; };
      const lo = pct(0.004), hi = pct(0.996);
      A.lvIn0 = Math.min(lo, 60); A.lvIn1 = Math.max(hi, 195); if (A.lvIn1 - A.lvIn0 < 40) { A.lvIn0 = 0; A.lvIn1 = 255; }
      const mid = pct(0.5), want = 0.48, cur = clamp((mid - A.lvIn0) / Math.max(1, A.lvIn1 - A.lvIn0), 0.05, 0.95);
      A.lvGam = clamp(Math.round(Math.log(cur) / Math.log(want) * 100) / 100, 0.6, 1.6);
      if (A.vib === undefined) A.vib = 8;
      toast('자동으로 맞췄어요. 레벨과 생동감 값을 바꿔서 더 다듬을 수 있어요'); break;
    }
    case 'adv-ch': advCh = v; renderProps(); return;
    case 'adv-band': advBand = +v; renderProps(); return;
    case 'adv-curve-reset': keepCurve(); A.curves[advCh] = [[0, 0], [255, 255]]; break;
    case 'adv-curve-s': keepCurve(); A.curves[advCh] = [[0, 0], [64, 48], [192, 208], [255, 255]]; break;
    case 'adv-curve-fade': keepCurve(); A.curves[advCh] = [[0, 26], [128, 128], [255, 236]]; break;
    case 'adv-hsl-reset': delete A.hsl; break;
    case 'adv-look': {
      const L = v[0] === 'b' ? ADV_LOOKS[+v.slice(1)] : advLooksUser()[+v.slice(1)];
      if (!L) return; advSetState(A, v[0] === 'b' ? L[1] : L.v); toast(`'${v[0] === 'b' ? L[0] : L.name}' 보정을 넣었어요`); break;
    }
    case 'adv-look-del': { const a = advLooksUser(); a.splice(+v, 1); advLooksSave(a); renderProps(); return; }
    case 'adv-save': {
      const st = advState(A); if (!Object.keys(st).length) { toast('저장할 보정이 없어요. 먼저 보정을 바꿔 주세요'); return; }
      askText('프리셋 이름', '내 보정 ' + (advLooksUser().length + 1), '저장').then(n => { if (!n) return; const a = advLooksUser(); a.push({ name: n.slice(0, 20), v: st }); advLooksSave(a); renderProps(); toast('프리셋을 저장했어요. 다른 그림에서도 쓸 수 있어요'); });
      return;
    }
    case 'adv-apply': {
      const st = advState(A), fo = page().folder;
      const idx = realIdx().filter(i => v === 'all' || inFolder(doc.pages[i].folder, fo));
      let n = 0;
      for (const i of idx) { const P = doc.pages[i], B = P.els.find(e => e.type === 'panel' && e.lock); if (B && B !== el) { advSetState(B, st); n++; } }
      commit(); renderLib(); toast(`${n}장에 같은 보정을 넣었어요`); requestRender(); return;
    }
    default: return;
  }
  commit(); renderProps(); requestRender();
}
// 곡선·레벨 그림, 색상별 입력, 원본 비교 (속성 칸이 다시 그려질 때마다 붙여요)
function advMount() {
  const A = advLayer(); if (!A) return;
  const cv = $('[data-advcurve]', propsEl), hc = $('[data-advhist]', propsEl);
  if (cv) advDrawCurve(cv, A);
  if (hc) { const g = hc.getContext('2d'), H = advHist(A.img); g.clearRect(0, 0, hc.width, hc.height); if (H) { drawHist(g, H, 'l', hc.width, hc.height, 'rgba(120,130,150,.55)'); }
    const x0 = advVal(A, 'lvIn0') / 255 * hc.width, x1 = advVal(A, 'lvIn1') / 255 * hc.width; g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, x0, hc.height); g.fillRect(x1, 0, hc.width - x1, hc.height); }
  for (const x of $$('[data-hslk]', propsEl)) x.value = ((A.hsl && A.hsl[advBand]) || [0, 0, 0])[+x.dataset.hslk];
}
function advDrawCurve(cv, A) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, dark = document.documentElement.dataset.theme === 'dark';
  g.clearRect(0, 0, W, H); g.fillStyle = dark ? '#1d2229' : '#f6f7f9'; g.fillRect(0, 0, W, H);
  const hs = advHist(A.img), col = { rgb: 'rgba(120,130,150,.45)', r: 'rgba(229,72,77,.35)', g: 'rgba(70,167,88,.35)', b: 'rgba(62,99,221,.35)' }[advCh];
  if (hs) drawHist(g, hs, advCh === 'rgb' ? 'l' : advCh, W, H, col);
  g.strokeStyle = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)'; g.lineWidth = 1;
  for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * W / 4, 0); g.lineTo(i * W / 4, H); g.moveTo(0, i * H / 4); g.lineTo(W, i * H / 4); g.stroke(); }
  g.beginPath(); g.moveTo(0, H); g.lineTo(W, 0); g.stroke();
  const pts = (A.curves && A.curves[advCh]) || [[0, 0], [255, 255]], t = curveTable(pts);
  g.strokeStyle = { rgb: dark ? '#e8eaed' : '#222', r: '#e5484d', g: '#46a758', b: '#3e63dd' }[advCh]; g.lineWidth = 3; g.beginPath();
  for (let x = 0; x < 256; x++) { const X = x / 255 * W, Y = H - t[x] / 255 * H; x ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke();
  g.fillStyle = '#fff'; g.strokeStyle = g.strokeStyle; g.lineWidth = 2.5;
  for (const [x, y] of pts) { g.beginPath(); g.arc(x / 255 * W, H - y / 255 * H, 9, 0, Math.PI * 2); g.fill(); g.stroke(); }
}
(() => {
  // 곡선 끌기
  let drag = null;
  const pos = (cv, e) => { const r = cv.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width * 255, 0, 255), clamp((1 - (e.clientY - r.top) / r.height) * 255, -40, 295)]; };
  propsEl.addEventListener('pointerdown', e => {
    const cmp = e.target.closest('[data-advcmp]');
    if (cmp) { advBypass.on = true; requestRender(); const up = () => { advBypass.on = false; requestRender(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); }; window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); return; }
    const cv = e.target.closest('[data-advcurve]'); if (!cv) return;
    const A = advLayer(); if (!A) return;
    A.curves = A.curves || {}; for (const c of ['rgb', 'r', 'g', 'b']) if (!A.curves[c]) A.curves[c] = [[0, 0], [255, 255]];
    const pts = A.curves[advCh], [x, y] = pos(cv, e), r = cv.getBoundingClientRect(), sx = 255 / r.width * 14;
    let i = pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < sx);
    if (i < 0) { pts.push([Math.round(x), Math.round(curveTable(pts)[Math.round(x)])]); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(p => p[0] === Math.round(x)); }
    drag = { cv, i, A }; cv.setPointerCapture(e.pointerId); advDrawCurve(cv, A); requestRender(); e.preventDefault();
  });
  propsEl.addEventListener('pointermove', e => {
    if (!drag) return;
    const pts = drag.A.curves[advCh], [x, y] = pos(drag.cv, e), i = drag.i, n = pts.length;
    const lo = i === 0 ? 0 : pts[i - 1][0] + 2, hi = i === n - 1 ? 255 : pts[i + 1][0] - 2;
    const out = y < -25 || y > 280;
    pts[i] = [i === 0 ? Math.min(Math.round(x), hi) : i === n - 1 ? Math.max(Math.round(x), lo) : clamp(Math.round(x), lo, hi), clamp(Math.round(y), 0, 255)];
    drag.out = out && i > 0 && i < n - 1;
    advDrawCurve(drag.cv, drag.A); requestRender();
  });
  const end = () => { if (!drag) return; const d = drag; drag = null; if (d.out) { d.A.curves[advCh].splice(d.i, 1); advDrawCurve(d.cv, d.A); requestRender(); } commit(); };
  propsEl.addEventListener('pointerup', end); propsEl.addEventListener('pointercancel', end);
  propsEl.addEventListener('dblclick', e => {
    const cv = e.target.closest('[data-advcurve]'); if (!cv) return; const A = advLayer(); if (!A || !A.curves) return;
    const pts = A.curves[advCh], [x, y] = pos(cv, e), r = cv.getBoundingClientRect(), sx = 255 / r.width * 14;
    const i = pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < sx); if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); advDrawCurve(cv, A); requestRender(); commit(); }
  });
  // 색상별 입력
  propsEl.addEventListener('input', e => {
    const t = e.target; if (!t.dataset || t.dataset.hslk === undefined) return;
    const A = advLayer(); if (!A) return; const v = clamp(parseFloat(t.value) || 0, -100, 100), k = +t.dataset.hslk;
    A.hsl = A.hsl || ADV_BANDS.map(() => [0, 0, 0]); A.hsl[advBand][k] = v;
    for (const x of $$(`[data-hslk="${k}"]`, propsEl)) if (x !== t) x.value = v;
    requestRender();
  });
  propsEl.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.hslk !== undefined) commit(); });
  // 레벨 값이 바뀌면 히스토그램 위 그늘도 다시
  propsEl.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.k; if (k === 'lvIn0' || k === 'lvIn1') advMount(); });
  new MutationObserver(() => advMount()).observe(propsEl, { childList: true });
})();
