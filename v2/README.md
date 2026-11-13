# 감자 편집기 2.0 (만드는 중)

8.x(`src/`)는 그대로 두고, 이 폴더에서 2.0을 새 틀로 만들어요. 설계는 프로젝트 문서 `메모/8-감자편집기-2.0-설계.md`.

    cd v2
    npm install
    node build.mjs              # → ../dist/v2/index.html, ../dist/감자편집기2.html
    python3 -I tests/smoke.py   # 기본 시험 (끝에 폴더를 주면 화면 캡처를 남겨요)

- `src/core` 작업 구조와 저장, 하나로 합친 되돌리기(store), 명령 목록(cmd), 설정(settings)
- `src/ui` 패널 배치(dock), 패널(panels), 메뉴·창·명령 찾기(overlay)
- `src/rooms` 작업실. 지금은 이미지만 동작하고 나머지는 안내 화면
- `src/api/gemini.js` 제미나이로 가는 모든 요청이 지나는 통로 (안전 설정 끔 + 성인 창작 안내문 먼저)
