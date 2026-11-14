// 패널들: 어느 작업실에서든 같은 것을 써요. 어디에 붙일지는 dock.js가 정해요.
import { h, icon } from './dom.js';
import { state, commit, emit, canvasOf, layerOf, history, jump } from '../core/store.js';
import { run } from '../core/cmd.js';
import { draw, ADJ, TONE, CURVE0, curveAt } from '../rooms/image.js';
import { drag } from './dom.js';
import { showMenu, cmdItem } from './overlay.js';
import { cmd } from '../core/cmd.js';
import { binPanel } from './bin.js';
import { naiPanel } from './naipanel.js';
import { jobsPanel } from './aitools.js';
import { dubPanel } from './geminitools.js';

const num = (label, value, step, on, unit) => {
  const i = h('input.num', { type: 'number', value, step, 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) on(v); } });
  return h('label.field', null, h('span.field-name', null, label), i, unit && h('span.field-unit', null, unit));
};

let lastClick = { id: null, t: 0 };

export const PANELS = {
  media: binPanel,
  layers: {
    title: '레이어',
    render(el) {
      const c = canvasOf();
      if (!c) return el.append(h('p.empty', null, '그림판을 열면 레이어가 보여요.'));
      if (!c.layers.length) el.append(h('p.empty', null, '레이어가 없어요. 보관함에서 그림을 올려 보세요.'));
      const list = h('div.layer-list', { role: 'listbox', 'aria-label': '레이어' });
      [...c.layers].reverse().forEach(l => {
        const row = h('div.layer' + (l.id === state.project.sel ? '.on' : '') + (l.visible ? '' : '.off'), { role: 'option', 'aria-selected': String(l.id === state.project.sel), tabindex: '0',
          onclick: e => {
            // 누를 때마다 목록을 다시 그리기 때문에, 두 번 누르기는 시간으로 직접 재요
            const twice = lastClick.id === l.id && Date.now() - lastClick.t < 450; lastClick = { id: l.id, t: Date.now() };
            if (twice && e.target.closest('.layer-name')) return rename(e.target.closest('.layer-name'), l);
            if (state.project.sel !== l.id) { state.project.sel = l.id; emit(); }
          },
          onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { state.project.sel = l.id; emit(); } },
          oncontextmenu: e => { e.preventDefault(); state.project.sel = l.id; emit(); showMenu(['layer.dup', 'layer.up', 'layer.down', '-', 'layer.delete'].map(id => id === '-' ? '-' : cmdItem(cmd(id))), e.clientX, e.clientY); },
        },
          h('button.icon-btn.small', { title: l.visible ? '숨기기' : '보이기', 'aria-label': l.visible ? '숨기기' : '보이기', onclick: e => { e.stopPropagation(); l.visible = !l.visible; commit(l.visible ? '레이어 보이기' : '레이어 숨기기'); } }, icon(l.visible ? 'eye' : 'eyeOff', 14)),
          h('img.layer-thumb', { src: state.thumbs.get(l.mediaId) || '', alt: '' }),
          h('span.layer-name', { title: '두 번 눌러 이름 바꾸기' }, l.name),
          h('button.icon-btn.small' + (l.locked ? '.on' : ''), { title: l.locked ? '잠금 풀기' : '잠그기', 'aria-label': l.locked ? '잠금 풀기' : '잠그기', 'aria-pressed': String(l.locked), onclick: e => { e.stopPropagation(); l.locked = !l.locked; commit(l.locked ? '레이어 잠그기' : '잠금 풀기'); } }, icon('lock', 14)));
        list.append(row);
      });
      el.append(list, h('div.panel-foot', null,
        h('button.icon-btn', { title: '레이어 위로', 'aria-label': '레이어 위로', onclick: () => run('layer.up') }, icon('up')),
        h('button.icon-btn', { title: '레이어 아래로', 'aria-label': '레이어 아래로', onclick: () => run('layer.down') }, icon('down')),
        h('span.grow'),
        h('button.icon-btn', { title: '레이어 지우기', 'aria-label': '레이어 지우기', onclick: () => run('layer.delete') }, icon('trash'))));
    },
  },
  props: {
    title: '속성',
    render(el) {
      const c = canvasOf(), l = layerOf();
      if (!c) return el.append(h('p.empty', null, '고른 것의 값이 여기 보여요.'));
      if (!l) {
        return el.append(h('h3.sec', null, '그림판'),
          h('label.field', null, h('span.field-name', null, '이름'), h('input.text', { type: 'text', value: c.name, 'aria-label': '그림판 이름', onchange: e => { c.name = e.target.value.trim() || c.name; commit('그림판 이름 바꾸기'); } })),
          h('div.field-row', null, num('가로', c.w, 1, v => { c.w = Math.max(1, Math.round(v)); commit('그림판 크기'); }, 'px'), num('세로', c.h, 1, v => { c.h = Math.max(1, Math.round(v)); commit('그림판 크기'); }, 'px')),
          h('h3.sec', null, '전체 보정'),
          ...[...ADJ.filter(a => a[0] !== 'blur'), ...TONE].map(([k, label, min, max]) => {
            const v = (c.adj && c.adj[k]) || 0, out = h('span.field-unit', null, String(v));
            return h('label.field', null, h('span.field-name.w', null, label), h('input.range', { type: 'range', min, max, value: v, 'aria-label': '전체 ' + label,
              oninput: e => { (c.adj || (c.adj = {}))[k] = +e.target.value; out.textContent = e.target.value; draw(); },
              onchange: () => { if (c.adj && !Object.values(c.adj).some(Boolean)) delete c.adj; commit('전체 보정: ' + label); } }), out);
          }),
          curveBox(c),
          h('button.btn.small', { disabled: !c.adj, onclick: () => { delete c.adj; commit('전체 보정 처음으로'); } }, '전체 보정 처음으로'),
          h('p.panel-note', null, '전체 보정은 모든 레이어 위에 한 번에 입혀져요. 레이어를 고르면 그 레이어만 보정할 수 있어요.'));
      }
      const op = h('input.range', { type: 'range', min: '0', max: '100', value: Math.round(l.opacity * 100), 'aria-label': '불투명도',
        oninput: e => { l.opacity = e.target.value / 100; opv.textContent = e.target.value + '%'; draw(); }, onchange: () => commit('불투명도') });
      const opv = h('span.field-unit', null, Math.round(l.opacity * 100) + '%');
      el.append(h('h3.sec', null, '위치와 크기'),
        h('div.field-row', null, num('X', l.x, 1, v => { l.x = Math.round(v); commit('위치'); }, 'px'), num('Y', l.y, 1, v => { l.y = Math.round(v); commit('위치'); }, 'px')),
        h('div.field-row', null, num('크기', +(l.scale * 100).toFixed(1), 1, v => { l.scale = Math.min(50, Math.max(0.01, v / 100)); commit('크기'); }, '%'), num('회전', l.rot, 1, v => { l.rot = v; commit('회전'); }, '°')),
        h('h3.sec', null, '보이기'),
        h('label.field', null, h('span.field-name', null, '불투명도'), op, opv),
        h('h3.sec', null, '보정'),
        ...[...ADJ, ...TONE].map(([k, label, min, max]) => {
          const v = (l.adj && l.adj[k]) || 0, out = h('span.field-unit', null, String(v));
          return h('label.field', null, h('span.field-name.w', null, label), h('input.range', { type: 'range', min, max, value: v, 'aria-label': label,
            oninput: e => { (l.adj || (l.adj = {}))[k] = +e.target.value; out.textContent = e.target.value; draw(); },
            onchange: () => { if (l.adj && !Object.values(l.adj).some(Boolean)) delete l.adj; commit('보정: ' + label); } }), out);
        }),
        curveBox(l),
        h('button.btn.small', { disabled: !l.adj, onclick: () => run('layer.resetAdj') }, '보정 처음으로'),
        h('p.panel-note', null, '보정은 원본 그림을 바꾸지 않아요. 언제든 값을 되돌릴 수 있어요.'));
    },
  },
  history: {
    title: '기록',
    render(el) {
      el.append(h('div.hist-list', { role: 'listbox', 'aria-label': '작업 기록' }, history.items.map((it, i) => h('button.hist' + (i === history.at ? '.on' : '') + (i > history.at ? '.future' : ''), { role: 'option', 'aria-selected': String(i === history.at), onclick: () => jump(i) }, it.label))));
      const on = el.querySelector('.hist.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    },
  },
  nai: naiPanel,
  dub: dubPanel,
  jobs: jobsPanel,
};

function rename(span, l) {
  const i = h('input.text', { type: 'text', value: l.name, 'aria-label': '레이어 이름' });
  let fin = false;
  const done = ok => { if (fin) return; fin = true; if (ok && i.value.trim() && i.value.trim() !== l.name) { l.name = i.value.trim(); commit('레이어 이름 바꾸기'); } else emit(); };
  i.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
  i.addEventListener('blur', () => done(true));
  span.replaceWith(i); i.focus(); i.select();
}

// 곡선 보정: 다섯 점을 위아래로 끌어요. 왼쪽이 어두운 곳, 오른쪽이 밝은 곳
function curveBox(l) {
  const S = 132, c = h('canvas.curve', { width: S, height: S, role: 'img', 'aria-label': '곡선 보정', title: '점을 위아래로 끌어요. 왼쪽이 어두운 곳, 오른쪽이 밝은 곳이에요. 두 번 누르면 처음으로 돌아가요.' }), g = c.getContext('2d');
  const cur = () => (l.adj && l.adj.curve) || CURVE0;
  const paint = () => {
    const cu = cur(), css = getComputedStyle(document.documentElement), col = k => css.getPropertyValue(k).trim();
    g.clearRect(0, 0, S, S); g.strokeStyle = col('--edge'); g.lineWidth = 1; g.beginPath(); for (let i = 1; i < 4; i++) { g.moveTo(i * S / 4 + .5, 0); g.lineTo(i * S / 4 + .5, S); g.moveTo(0, i * S / 4 + .5); g.lineTo(S, i * S / 4 + .5); } g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
    g.strokeStyle = col('--text'); g.lineWidth = 1.5; g.beginPath(); for (let x = 0; x <= S; x += 2) { const y = S - curveAt(cu, x / S) * S; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
    g.fillStyle = col('--potato'); cu.forEach((v, i) => { g.beginPath(); g.arc(Math.min(S - 4, Math.max(4, i * S / 4)), Math.min(S - 4, Math.max(4, S - v * S)), 4, 0, Math.PI * 2); g.fill(); });
  };
  c.addEventListener('pointerdown', e => {
    const r = c.getBoundingClientRect(), i = Math.round((e.clientX - r.left) / r.width * 4), cu = [...cur()]; let mv = false;
    drag(e, ev => { cu[i] = Math.min(1, Math.max(0, 1 - (ev.clientY - r.top) / r.height)); (l.adj || (l.adj = {})).curve = cu; mv = true; paint(); draw(); }, () => mv && commit('보정: 곡선'));
  });
  c.addEventListener('dblclick', () => { if (l.adj && l.adj.curve) { delete l.adj.curve; if (!Object.values(l.adj).some(Boolean)) delete l.adj; commit('곡선 처음으로'); } });
  paint();
  return h('div.field', null, h('span.field-name.w', null, '곡선'), c);
}
