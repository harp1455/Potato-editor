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
patch('<button class="btn sm" data-rgfx="layer">내보내기</button>', '<button class="btn sm primary" data-rgfn="layer">NovelAI로 바로</button><button class="btn sm" data-rgfx="layer">내보내기</button>', '층 내보내기 단추');
patch('<button class="btn sm" data-rgfx="bg">내보내기</button>', '<button class="btn sm primary" data-rgfn="bg">NovelAI로 바로</button><button class="btn sm" data-rgfx="bg">내보내기</button>', '배경 내보내기 단추');
patch("if (b && (b.dataset.rgfx || b.dataset.rgfi)) {", "if (b && b.dataset.rgfn) { const isBg = b.dataset.rgfn === 'bg', L = rig.layers.find(l => l.id === st.selLayer) || base(), what = isBg ? 'bg' : L, ex = rgFillExport(main, rig, what); if (!ex.any) { toast('다시 그릴 메운 자리가 없어요. 부위를 떼어 낸 뒤에 써 주세요.'); return; } const img = await naiFill(ex.pic, ex.mask, isBg ? '배경' : L.name); if (img) { snap(); rgFillImport(main, rig, what, img); renderSide(); dirty(); toast((isBg ? '배경' : `'${L.name}'`) + '의 메운 자리를 NovelAI로 다시 그렸어요. 마음에 안 들면 Ctrl+Z'); } return; }\n    if (b && (b.dataset.rgfx || b.dataset.rgfi)) {", '메운 자리 단추 처리');
// (나) 이미지 작업실의 고르는 도구(마법 붓·AI로 고르기 등)로 고른 곳을 '칠한 곳'으로 가져오기
patch('data-rga="sam" title="대충 칠한 곳을 AI가 물체 윤곽에 맞춰 줘요">AI로 윤곽 맞추기</button>', 'data-rga="sam" title="대충 칠한 곳을 AI가 물체 윤곽에 맞춰 줘요">AI로 윤곽 맞추기</button><button class="btn sm" data-rga="fromsel" title="이미지 작업실에서 마법 붓, 올가미, AI로 고르기로 고른 곳을 칠한 곳으로 가져와요">고른 곳 가져오기</button>', '윤곽 맞추기 단추');
patch("else if (act === 'sam') {", "else if (act === 'fromsel') { const m = from.selMask ? await from.selMask() : null; if (!m) { toast('이미지 작업실에서 고른 곳이 없어요. 창을 닫고 마법 붓이나 AI로 고르기로 먼저 골라 주세요.'); return; } snap(); if (!st.pm) st.pm = newCanvas(Math.round(rig.W / 2), Math.round(rig.H / 2)); const g = st.pm.getContext('2d'); g.clearRect(0, 0, st.pm.width, st.pm.height); g.drawImage(m, 0, 0, st.pm.width, st.pm.height); g.globalCompositeOperation = 'source-in'; g.fillStyle = 'rgb(255,60,160)'; g.fillRect(0, 0, st.pm.width, st.pm.height); g.globalCompositeOperation = 'source-over'; st.pmAny = true; renderSide(); dirty(); toast('고른 곳을 가져왔어요. 붓으로 더 다듬거나 바로 떼어 낼 수 있어요.'); }\n    else if (act === 'sam') {", '윤곽 맞추기 처리');

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
  const { newCanvas, gs, uiSet, auEncoderCfg, auEncode, Mp4Muxer } = deps;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
${codecs[0]}
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
  const { newCanvas, clamp, czLoad, czCall, cz, aiLine } = deps;
  const dpCache = new Map();
${czHead}
${czSrc.slice(c0, c1)}
${pick('cz.js', ['czDrawShapes'])}
${pick('ai.js', ['aiPixels', 'aiLineArt'])}
${pick('depth.js', ['dpRaw', 'dpBox', 'dpGuided', 'dpGray', 'dpDepth', 'dpOtsu', 'dpNormBlur', 'dpDof'])}
${pick('gif2.js', ['riPlane', 'riRun'])}
  return { czCfg, czNewState, czAnalyze, czComposeMask, czDilate, aiLineArt, dpDepth, dpOtsu, dpDof, riRun };
}
`);
console.log(`캐릭터 움직이기 묶음: 코드 ${(rig.length / 1024).toFixed(0)} KB, 꾸밈 규칙 ${rules.length}개`);
