// 감자 편집기 2.0 묶기:  node build.mjs
//   → ../dist/v2/index.html      (설치판 안에 들어가는 화면)
//   → ../dist/감자편집기2.html   (파일 하나로 여는 HTML판)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;
execFileSync(process.execPath, [join(here, 'tools', 'legacy.mjs')], { stdio: 'inherit' });
const out = await build({ entryPoints: [join(here, 'src/main.js')], bundle: true, format: 'iife', target: 'es2020', write: false, charset: 'utf8', loader: { '.py': 'text' }, define: { __VERSION__: JSON.stringify(version), __PACKS__: readFileSync(join(here, 'packs.json'), 'utf8') } });
const js = out.outputFiles[0].text;
if (/<\/script/i.test(js)) throw new Error('묶은 코드 안에 </script 가 있어요');
// AI 실행 도구(onnxruntime-web, MIT)를 일꾼에서 바로 쓸 수 있는 모양으로 바꿔 같이 넣어요
mkdirSync(join(here, '..', 'dist'), { recursive: true });
const ortOut = join(here, '..', 'dist', '.ort_classic.js');
execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-I', join(here, '..', 'tools', 'ort_classic.py'), join(here, '..', 'vendor', 'ort', 'ort.webgpu.bundle.min.mjs'), ortOut], { stdio: 'ignore' });
const ort = readFileSync(ortOut, 'utf8');
for (const bad of ['</script', '<!--', '<script']) if (ort.toLowerCase().includes(bad)) throw new Error('실행 도구 안에 ' + bad + ' 가 있어요');
const mux = readFileSync(join(here, '..', 'vendor', 'mp4-muxer', 'mp4-muxer.js'), 'utf8');   // MP4 저장 (MIT)
if (/<\/script/i.test(mux)) throw new Error('mp4-muxer 안에 </script 가 있어요');
// 내장 효과음 묶음(8.x와 같은 것): 컷 작업실의 효과음 패널이 처음 쓸 때 읽어요
const sfx = readFileSync(join(here, '..', 'src', 'sfx-packs.html'), 'utf8').trim();
if ((sfx.match(/<script/g) || []).length !== 1 || !sfx.startsWith('<script type="application/json" id="cutSfxPacks">')) throw new Error('sfx-packs.html 모양이 달라졌어요');
const notice = readFileSync(join(here, '..', 'tools', 'notice.txt'), 'utf8').trim();
const css = readFileSync(join(here, 'src/style.css'), 'utf8') + '\n' + readFileSync(join(here, 'src/legacy/rig.gen.css'), 'utf8') + '\n' + readFileSync(join(here, 'src/legacy/legacy.css'), 'utf8');
const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>감자 편집기</title>
<style>
${css}</style>
</head>
<body>
<script type="text/plain" id="ortJs">${ort}</script>
${sfx}
<script>
${mux}</script>
<script>
${js}</script>
${notice}
</body>
</html>
`;
const dist = join(here, '..', 'dist');
mkdirSync(join(dist, 'v2'), { recursive: true });
writeFileSync(join(dist, 'v2', 'index.html'), html);
writeFileSync(join(dist, '감자편집기2.html'), html);
console.log(`감자 편집기 ${version}: ${(html.length / 1024).toFixed(0)} KB`);
