// 아직 옮기지 않은 작업실. 무엇이 언제 들어오는지만 솔직하게 보여 줘요.
import { h } from '../ui/dom.js';
import { run } from '../core/cmd.js';

const make = (id, title, icon, when, lead, items) => ({
  id, title, icon,
  mount(el) {
    el.append(h('div.stub', null,
      h('p.stub-when', null, when + '에 옮겨 와요'),
      h('h2', null, title + ' 작업실'),
      h('p.stub-lead', null, lead),
      h('ul.stub-list', null, items.map(t => h('li', null, t))),
      h('div.btn-row', null, h('button.btn', { onclick: () => run('room.image') }, '이미지 작업실로 가기'), h('button.btn', { onclick: () => run('help.plan') }, '전체 차례 보기'))));
    return {};
  },
  hint: () => `${title} 작업실은 ${when}에 옮겨 와요. 그때까지는 8.x에서 쓸 수 있어요.`,
});

export const stubRooms = [
  make('cut', '컷', 'cut', '5단계', '웹툰 페이지를 짜고 말풍선과 글자를 얹는 곳이에요.', ['페이지와 컷 나누기, 페이지 한눈에 보기', '말풍선·글자 모양 묶음', '제미나이 번역과 다듬기', 'AI 더빙']),
  make('batch', '일괄 처리', 'batch', '2단계', '그림 여러 장에 같은 처리를 한 번에 하는 곳이에요.', ['자동 흰칠, 배경 지우기, 화질 키우기', '크기·형식을 바꿔 한꺼번에 내보내기']),
];
