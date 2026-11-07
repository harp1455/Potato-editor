# ESM 묶음(ort.webgpu.bundle.min.mjs)을 일반 스크립트로: export → self.ort, import.meta.url → 가짜 주소
import re, sys
src = open(sys.argv[1], encoding='utf-8').read().replace('//# sourceMappingURL=ort.webgpu.bundle.min.mjs.map', '').rstrip()
m = re.search(r'export\{([^}]*)\};?\s*$', src)
assert m, 'no export'
pairs = []
for part in m.group(1).split(','):
    a, b = [x.strip() for x in part.split(' as ')]
    pairs.append(f'{b}:{a}')
body = src[:m.start()]
n = body.count('import.meta.url')
body = body.replace('import.meta.url', '"https://local.invalid/ort/ort.webgpu.bundle.min.mjs"')
assert 'import.meta' not in body
out = '(function(){"use strict";\n' + body + '\nself.ort={' + ','.join(pairs) + '};\n})();'
open(sys.argv[2], 'w', encoding='utf-8').write(out)
print('import.meta.url replaced', n, 'exports', len(pairs), len(out))
