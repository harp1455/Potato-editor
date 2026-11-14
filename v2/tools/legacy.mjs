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

// 2) rig.js가 쓰는 8.x의 작은 계산 함수들을 그대로 가져와요
function pick(file, names) {
  const text = read(file), ast = parse(text, { ecmaVersion: 2023, sourceType: 'script', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  return names.map(n => { const f = ast.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === n); if (!f) throw new Error(`${file}에 ${n}이 없어요`); return text.slice(f.start, f.end); }).join('\n');
}
const helpers = [pick('cz.js', ['czDeepest', 'czLargest']), pick('depth.js', ['dpBox', 'dpNormBlur', 'dpFill']), pick('ai.js', ['aiMask'])].join('\n');

const DEPS = ['$', '$$', 'clamp', 'esc', 'uid', 'newCanvas', 'toast', 'modal', 'closeModal', 'czLoad', 'czCall', 'cz', 'czIsApp', 'czPacksReady', 'czPackState', 'czProgress', 'czErrText', 'idb', 'safeName', 'saveFiles'];
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
console.log(`캐릭터 움직이기 묶음: 코드 ${(rig.length / 1024).toFixed(0)} KB, 꾸밈 규칙 ${rules.length}개`);
