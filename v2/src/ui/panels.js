// 패널들: 어느 작업실에서든 같은 것을 써요. 어디에 붙일지는 dock.js가 정해요.
import { h, icon } from './dom.js';
import { state, commit, emit, canvasOf, layerOf, history, jump } from '../core/store.js';
import { run } from '../core/cmd.js';
import { draw, ADJ } from '../rooms/image.js';
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
          h('p.panel-note', null, '레이어를 고르면 그 레이어의 위치·크기·투명도를 바꿀 수 있어요.'));
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
        ...ADJ.map(([k, label, min, max]) => {
          const v = (l.adj && l.adj[k]) || 0, out = h('span.field-unit', null, String(v));
          return h('label.field', null, h('span.field-name.w', null, label), h('input.range', { type: 'range', min, max, value: v, 'aria-label': label,
            oninput: e => { (l.adj || (l.adj = {}))[k] = +e.target.value; out.textContent = e.target.value; draw(); },
            onchange: () => { if (l.adj && !Object.values(l.adj).some(Boolean)) delete l.adj; commit('보정: ' + label); } }), out);
        }),
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
