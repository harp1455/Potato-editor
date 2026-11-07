# 움짤 연출 프리셋 만들기 → src/presets.js (만들어진 파일을 저장소에 같이 넣어요)
#   python tools/gen_presets.py ANIMATE_CSS_DIR GL_TRANSITIONS_DIR
# - Animate.css 4.1.1 (MIT, https://github.com/animate-css/animate.css): @keyframes를 숫자 데이터로
# - gl-transitions (MIT, https://github.com/gl-transitions/gl-transitions): 라이선스가 MIT이고 그림 두 장만 쓰는 장면 넘김
import json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A, G = sys.argv[1], sys.argv[2]
css = open(os.path.join(A, 'animate.css'), encoding='utf-8').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
num = lambda s: float(s)

def parse_len(v):
    v = v.strip()
    if v.endswith('%'): return [num(v[:-1]), '%']
    if v.endswith('px'): return [num(v[:-2]), 'px']
    if v in ('0', '0.0'): return [0.0, 'px']
    raise ValueError('len ' + v)

def parse_angle(v):
    v = v.strip()
    if v.endswith('deg'): return num(v[:-3])
    if v.endswith('turn'): return num(v[:-4]) * 360
    if v == '0': return 0.0
    raise ValueError('ang ' + v)

def parse_transform(t):
    out = {}
    for fn, args in re.findall(r'([a-zA-Z0-9]+)\(([^)]*)\)', t):
        a = [x.strip() for x in args.split(',')]
        if fn in ('translate3d', 'translate'):
            out['tx'] = parse_len(a[0]); out['ty'] = parse_len(a[1]) if len(a) > 1 else [0.0, 'px']
        elif fn == 'translateX': out['tx'] = parse_len(a[0])
        elif fn == 'translateY': out['ty'] = parse_len(a[0])
        elif fn == 'translateZ': pass
        elif fn in ('scale3d', 'scale'):
            out['sx'] = num(a[0]); out['sy'] = num(a[1]) if len(a) > 1 else num(a[0])
        elif fn == 'scaleX': out['sx'] = num(a[0])
        elif fn == 'scaleY': out['sy'] = num(a[0])
        elif fn in ('rotate', 'rotateZ'): out['r'] = parse_angle(a[0])
        elif fn == 'rotateX': out['rx'] = parse_angle(a[0])
        elif fn == 'rotateY': out['ry'] = parse_angle(a[0])
        elif fn == 'rotate3d':
            x, y, z, ang = num(a[0]), num(a[1]), num(a[2]), parse_angle(a[3])
            if z and not x and not y: out['r'] = ang * (1 if z > 0 else -1)
            elif x and not y and not z: out['rx'] = ang * (1 if x > 0 else -1)
            elif y and not x and not z: out['ry'] = ang * (1 if y > 0 else -1)
            else: raise ValueError('rotate3d ' + args)
        elif fn == 'skewX': out['kx'] = parse_angle(a[0])
        elif fn == 'skewY': out['ky'] = parse_angle(a[0])
        elif fn == 'skew': out['kx'] = parse_angle(a[0]); out['ky'] = parse_angle(a[1]) if len(a) > 1 else 0.0
        elif fn == 'perspective': pass
        else: raise ValueError('fn ' + fn)
    return out

def parse_ease(v):
    v = v.strip()
    named = {'ease': [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1], 'linear': [0, 0, 1, 1]}
    if v in named: return named[v]
    m = re.match(r'cubic-bezier\(([^)]*)\)', v)
    if m: return [num(x) for x in m.group(1).split(',')]
    raise ValueError('ease ' + v)

anims = {}
for m in re.finditer(r'(?<!-)@keyframes (\w+)\s*\{', css):
    name, i, depth = m.group(1), m.end(), 1
    j = i
    while depth: depth += {'{': 1, '}': -1}.get(css[j], 0); j += 1
    body = css[i:j - 1]
    frames = []
    for sel, decl in re.findall(r'([^{}]+)\{([^{}]*)\}', body):
        props = {}
        for d in decl.split(';'):
            if ':' not in d: continue
            k, v = [x.strip() for x in d.split(':', 1)]
            if k.startswith('-webkit-'): continue
            if k == 'transform': props.update(parse_transform(v) if v != 'none' else {'tx': [0.0, 'px']})
            elif k == 'opacity': props['op'] = num(v)
            elif k == 'animation-timing-function': props['ease'] = parse_ease(v)
            elif k == 'transform-origin': props['origin'] = v
        props.setdefault('_t', 'transform' in decl.replace('-webkit-transform', '').replace('transform-origin', ''))
        for s in sel.split(','):
            s = s.strip(); off = 0.0 if s == 'from' else 1.0 if s == 'to' else num(s[:-1]) / 100
            frames.append([off, dict(props)])
    frames.sort(key=lambda f: f[0])
    anims[name] = {'kf': frames}
# 클래스마다 회전 기준점·길이
for name, a in anims.items():
    m = re.search(r'\.animate__' + name + r'\s*\{([^}]*)\}', css)
    if not m: continue
    body = m.group(1)
    o = re.search(r'(?<!-webkit-)transform-origin:\s*([^;]+);', body)
    if o: a['origin'] = o.group(1).strip()
    d = re.search(r'(?<!-webkit-)animation-duration:\s*calc\(var\(--animate-duration\)\s*\*\s*([\d.]+)\)', body)
    if d: a['dur'] = float(d.group(1))
    d2 = re.search(r'(?<!-webkit-)animation-duration:\s*([\d.]+)s', body)
    if d2: a['dur'] = float(d2.group(1))
    tf = re.search(r'(?<!-webkit-)animation-timing-function:\s*([^;]+);', body)
    if tf: a['ease'] = parse_ease(tf.group(1))
# 숫자를 짧게
def short(o):
    if isinstance(o, float): return round(o, 4)
    if isinstance(o, list): return [short(x) for x in o]
    if isinstance(o, dict): return {k: short(v) for k, v in o.items()}
    return o
anims = short(anims)

# gl-transitions: MIT, 추가 그림(sampler) 안 쓰는 것만
trans = []
for fn in sorted(os.listdir(os.path.join(G, 'transitions'))):
    if not fn.endswith('.glsl'): continue
    src = open(os.path.join(G, 'transitions', fn), encoding='utf-8').read()
    lic = re.search(r'//\s*License:\s*(.+)', src)
    if not lic or 'MIT' not in lic.group(1).upper(): continue
    if 'sampler2D' in src: continue
    auth = re.search(r'//\s*Authors?:\s*(.+)', src)
    unis = []
    for t, n, d in re.findall(r'uniform\s+(\w+)\s+(\w+)\s*;\s*(?://\s*=\s*([^\n]+))?', src):
        unis.append({'t': t, 'n': n, 'd': (d or '').strip().rstrip(';')})
    body = re.sub(r'uniform\s+\w+\s+\w+\s*;[^\n]*\n', '', src)
    trans.append({'name': fn[:-5], 'by': (auth.group(1).strip() if auth else ''), 'u': unis, 'glsl': body})
out = os.path.join(ROOT, 'src', 'presets.js')
with open(out, 'w', encoding='utf-8') as f:
    f.write('/* ================= 움짤 연출 프리셋 (tools/gen_presets.py로 만든 파일이에요. 직접 고치지 마세요) ================= */\n')
    f.write('// Animate.css 4.1.1 — Copyright (c) 2020 Daniel Eden, MIT License. @keyframes를 숫자로 옮김\n')
    f.write('const ANIM_CSS = ' + json.dumps(anims, ensure_ascii=False, separators=(',', ':')) + ';\n')
    f.write('// gl-transitions — Copyright (c) 2017-present gl-transitions contributors, MIT License. 글마다 지은이를 by에 적어 뒀어요\n')
    f.write('const GL_TRANS = ' + json.dumps(trans, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';\n')
print('animations', len(anims), 'transitions', len(trans), 'bytes', os.path.getsize(out))
