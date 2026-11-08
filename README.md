# 감자 편집기

NAI 그림용 로컬 컷·이미지 편집기예요. 그림은 내 컴퓨터 안에서만 처리하고 어디로도 보내지 않아요.

## 받기

[Releases](https://github.com/harp1455/Potato-editor/releases/latest)에서 받아요.

- **설치판(추천)**: `PotatoEditor_…_x64-setup.exe`
  - 새 버전이 나오면 켤 때 알려 주고, 누르면 업데이트돼요.
  - 자동 흰칠 모델은 처음 쓸 때 팩으로 받아요. 기본 팩은 57MB, 정밀 팩은 44MB예요.
  - 처음 설치할 때 윈도우가 'PC 보호' 경고를 띄우면 '추가 정보 → 실행'을 누르세요.
- **HTML판**: `PotatoEditor_…_html.html`
  - 파일 하나에 모든 것이 들어 있어요(약 140MB). 크롬이나 엣지로 열어요.

## 만드는 방법 (개발용)

| 경로 | 내용 |
|---|---|
| `src/` | 편집기 화면: `head.html`, `main.js`, 자동 흰칠 `cz.js`, 고급 보정 `adv.js`, 레이어·크기 `layers.js`, 선택·마법 붓·고치기 붓 `sel.js`, 도형·마스크·보정 레이어·카메라 템플릿·기록·수평 `edit2.js`, AI 도구 `ai.js`, 움짤 `gsui.js`(화면·시간 막대)·`gif2.js`·`anim.js`, 효과음 팩 `sfx-packs.html` |
| `tools/gen_presets.py` | Animate.css·gl-transitions로 움짤 프리셋 `src/presets.js`를 만들어요 |
| `tools/build.py app` | 설치판에 들어가는 화면(`dist/app`) |
| `tools/build.py full packs` | HTML판(`dist/감자편집기.html`) |
| `tools/make_packs.py` | 원본 모델을 받아 변환하고 팩(`packs/`)을 만들어요 |
| `src-tauri/` | 설치판 껍데기(Tauri 2) |

릴리스는 깃허브 액션이 만들어요. 액션 탭에서 직접 실행(Run workflow)할 수도 있어요.

- `src/cz.js`의 `CZ_PACK_TAG`(예: packs-1) 릴리스가 없으면 main에 올릴 때 팩 릴리스가 생겨요.
- `src-tauri/tauri.conf.json`의 version을 올려 main에 올리면 그 버전의 윈도우 설치판, HTML판, 업데이트 정보가 생겨요.
- 버전은 `src-tauri/tauri.conf.json`과 `src-tauri/Cargo.toml`에서 같이 올려요. 릴리스 설명은 `release-notes.md`에 써요.

업데이트 서명 키는 저장소 Settings → Secrets → Actions에 `TAURI_SIGNING_PRIVATE_KEY`로 넣어 둬요. 키를 잃어버리면 이미 설치된 프로그램이 새 버전을 받지 못해요.

구성 요소와 라이선스는 [NOTICE.md](NOTICE.md)에 있어요.
