// 효과음 패널: 내장 효과음 글자(8.x에서 가져온 묶음)를 찾아서, 눌러서 페이지에 스티커로 놓아요.
// 묶음은 화면에 같이 실려 있고(#cutSfxPacks) 처음 쓸 때 읽어요. 놓은 그림은 작업의 보이지 않는 그림으로 들어가요.
import { h } from './dom.js';
import { state, addMedia } from '../core/store.js';
import { settings } from '../core/settings.js';
import { toast } from './overlay.js';

const VAR = [['ink', '먹선'], ['outline', '흰 테두리'], ['white', '흰펜']];
let packs = null, query = '', cat = '';
function load() {
  if (packs) return packs; packs = [];
  const s = document.getElementById('cutSfxPacks'); if (!s) return packs;
  try { packs = JSON.parse(s.textContent); } catch (_) { packs = []; }
  s.remove(); return packs;
}
const variant = () => settings.get('sfxVar') || 'ink';
// 그 글자의 그림을 작업에 넣고(이미 넣었으면 그것을) 돌려줘요. 고른 모양이 없으면 먹선을 주고, 흰펜·흰 테두리는 스티커 설정으로 흉내 내요
async function mediaFor(pk, i) {
  const w = pk.words[i], want = variant(), v = w.v[want] ? want : (w.v.ink ? 'ink' : Object.keys(w.v)[0]), key = `${pk.id}:${i}:${v}`;
  let m = state.project.media.find(x => x.sfx === key);
  if (!m) { const blob = await (await fetch(w.v[v][0])).blob(); m = await addMedia(new File([blob], `효과음 ${w.t}.${(blob.type.split('/')[1] || 'png')}`, { type: blob.type }), null, { hidden: true, sfx: key }); }
  return { m, look: v === want ? {} : want === 'white' ? { tint: '#ffffff' } : want === 'outline' ? { ol: 4, olc: '#ffffff' } : {} };
}
export async function placeSfx(pkId, i, at) {
  const pk = load().find(p => p.id === pkId); if (!pk || !pk.words[i]) return;
  if (settings.get('room') !== 'cut') { toast('효과음은 컷 작업실의 페이지에 놓아요. 왼쪽에서 컷 작업실로 가 주세요.'); return; }
  try { const { m, look } = await mediaFor(pk, i), cut = await import('../rooms/cut.js'); if (!cut.placeSticker(m.id, at, look)) toast('먼저 페이지를 만들어 주세요.'); }
  catch (e) { toast('효과음을 놓지 못했어요. ' + ((e && e.message) || ''), 'err'); }
}
export const sfxPanel = {
  title: '효과음',
  render(el) {
    const all = load(); if (!all.length) { el.append(h('p.empty', null, '이 판에는 내장 효과음이 들어 있지 않아요. 컷 메뉴의 효과음 팩 넣기로 그림 묶음을 넣어 쓸 수 있어요.')); return; }
    const cats = [...new Set(all.flatMap(p => p.words.map(w => w.c)).filter(Boolean))], grid = h('div.sfx-grid');
    const paint = () => {
      const q = query.trim().toLowerCase(), items = all.flatMap(p => p.words.map((w, i) => ({ p, w, i }))).filter(x => (!cat || x.w.c === cat) && (!q || (x.w.t + (x.w.c || '')).toLowerCase().includes(q)));
      grid.replaceChildren(...items.map(({ p, w, i }) => h('button.sfx-item', { title: `${w.t}\n눌러서 페이지 가운데에 놓거나, 끌어서 원하는 자리에 놓아요`, 'aria-label': `효과음 ${w.t}`, draggable: 'true',
        onclick: () => placeSfx(p.id, i), ondragstart: e => { e.dataTransfer.setData('application/x-potato-sfx', p.id + '|' + i); e.dataTransfer.effectAllowed = 'copy'; } }, h('img', { src: w.th, alt: '', loading: 'lazy', draggable: 'false' }), h('span', null, w.t))),
        ...(items.length ? [] : [h('p.empty', null, '맞는 효과음이 없어요.')]));
    };
    el.append(h('div.sfx-head', null,
      h('input.text', { type: 'search', placeholder: '효과음 찾기 (예: 쾅)', 'aria-label': '효과음 찾기', value: query, oninput: e => { query = e.target.value; paint(); } }),
      h('div.field-row', null,
        h('select.text', { 'aria-label': '갈래', onchange: e => { cat = e.target.value; paint(); } }, [h('option', { value: '', selected: !cat }, '모든 갈래'), ...cats.map(c => h('option', { value: c, selected: cat === c }, c))]),
        h('select.text', { 'aria-label': '모양', title: '먹선은 검은 글자, 흰 테두리는 어두운 그림 위에서도 보이게, 흰펜은 흰 글자예요', onchange: e => settings.set('sfxVar', e.target.value) }, VAR.map(([v, t]) => h('option', { value: v, selected: variant() === v }, t))))),
      grid, h('p.panel-note', null, '눌러서 놓은 뒤 오른쪽에서 색 입히기·테두리·뒤집기를 바꿀 수 있어요. 글자로 직접 만들려면 위쪽 줄의 효과음을 눌러요.'));
    paint();
  },
};
