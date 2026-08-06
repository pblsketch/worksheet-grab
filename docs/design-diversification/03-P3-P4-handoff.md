# Handoff — P3(용지 방향) · P4(목적→무드 자동선택) · /ultragoal 착수용

> 자기완결 핸드오프. 새 세션에서 `/ultragoal` 로 P3·P4 두 목표를 굴린다. 상세 맥락은 같은 폴더의
> `PLAN.md`(RALPLAN 합의) · `02-mood-pack.md`(무드 축 P2 전 단계) 참조.
> 대상: `E:/github/worksheet-grab` (K-12 활동지 엔진, Clean Arch, Node≥24, HTML/CSS+Chrome print, 의존성0·빌드0).

## 새 세션 시작 프롬프트 (복붙용)
```
worksheet-grab(E:/github/worksheet-grab)의 "활동지 디자인 다양화" P3·P4를 /ultragoal 로 이어서 한다.
먼저 docs/design-diversification/03-P3-P4-handoff.md 를 정독하라(PLAN.md·02-mood-pack.md 는 배경).

- 현재: 무드 축(P2-a~P2-c-7) 완료·origin/main 푸시(머지 a0bd13f). 5무드 서랍 + 레이아웃 변형 동작.
- /ultragoal 목표 2개 등록:
  · P3 페이지별 방향 혼합(복합 세트): 단일 방향(3a)은 이미 end-to-end 동작(착수 시 재확인만) → 3b가
    핵심·최고위험. 순서 = 스파이크(측정)→데이터모델(페이지 메타 optional)→렌더(named @page·페이지별
    .sheet 치수)→페이지네이션. flow 전용 초판(교사 float 개체 페이지 제외). 새 개체 타입 0.
  · P4 목적→무드 자동선택: worksheet-designer/worksheet-planner 에 "교사 자연어 목적 → 닫힌 5무드
    (calm/exam/wide/angular/soft) 이름만 선택" 단계. AI 는 이름만 고르고 CSS/좌표/토큰 미저작. 근거 기록.
- 불변식 절대 준수: 편집==인쇄 · 의존성0·빌드0 · 단일진실원천(applyDocOp/서버 라우트) · fail-closed ·
  htmlAllowlist·닫힌 개체 카탈로그(14종) 무변경 · AI 좌표(rect) 미생성 · .sheet 기하(float 원점·border 0) 불변.
- git: add -A/브랜치/reset/clean 금지, 경로 명시 스테이징. 착수 전 git status --porcelain. behind 면
  머지(리베이스 아님)로 통합 후 테스트. 렌더 --test-concurrency=1, 부하 플래키는 그 파일만 단독 재확인.
- 무회귀 검증(전부 그린 유지):
  npm run test:unit
  node --test --test-concurrency=1 test/render/acceptance.render.test.js test/render/paper.render.test.js test/render/editor-print-parity.render.test.js
- 시각 확인(디자인): RenderImage(Chrome --screenshot)→임시 PNG→cokacdir --sendfile 로 사용자 육안 확인
  (임시 스크립트/이미지 git 스테이징 금지·사용 후 삭제).
- P3 가 위험·부피 크니 P3 스파이크(측정)부터. 이질 용지 페이지네이션이 편집==인쇄를 깨면 즉시 멈추고
  사용자와 범위 재협의(PLAN 이 "최고 위험·후속"으로 명시한 지점).
```

## 0. 현재 상태 (2026-08-06 기준)
- **무드 축(P2-a~P2-c-7) 완료·푸시됨.** origin/main 과 동기화(머지 `a0bd13f` = 무드 작업 + 메인테이너 beta 릴리스/CI 정리).
  5무드 서랍(calm/exam/wide/angular/soft) × 레이아웃 변형(헤더·표밀도·섹션헤딩·지시문·callout·표헤더) + 편집기 UI 동작.
- 검증 그린(머지 후): unit **969** · acceptance(sci 3·ko 4쪽 불변) · 편집==인쇄 parity · mood.render 5 · editor-objects.
- ⚠ 이 beta 릴리스가 `docs/CONCURRENT-SESSIONS.md`·`.claude/hooks/concurrency-check.mjs`·`.omc/ultragoal/*`(구 ledger) 등
  dev 스캐폴딩을 삭제했다. `/ultragoal` 은 `.omc/ultragoal/` 아래 **새 ledger 를 새로 만든다**(구 것 없어도 무방).

## 1. 절대 불변식 (P3·P4 공통 — 어떤 확장도 우회 금지)
- **편집==인쇄(R2-1)**: 편집기 리플로우 측정과 인쇄 PDF 의 페이지 경계가 하드 동치. `reflow.js` 가 teacher `<style>`
  를 측정에 이식하고, `PaginateObjectTree`(Chrome 측정)가 인쇄 경계를 정한다.
- **의존성0·빌드0**: 외부 라이브러리 도입은 정책 결정(함부로 금지). node:test/node:assert 만.
- **단일 진실원천**: 문서 변경은 `applyDocOp`(브라우저) / 서버 라우트(`/paper`,`/theme`,`/mood` = SaveDocument 게이트)로만.
- **fail-closed**: 정답 누출 시 산출 차단. 닫힌 개체 카탈로그(14종) 무변경 · htmlAllowlist · **AI 좌표(rect) 미생성**.
- **⚠ 최고 위험 지점(P3 핵심)**: `.sheet` 기하 고정 전제 — 자유배치(`.wg-float`)는 `.sheet` 직속 `position:absolute`
  자식이고, 절대배치 containing block 은 `.sheet` 의 **padding edge** 인데 현재 `border-width:0` 이라 padding edge ==
  물리 모서리로 일치한다. 편집기 실측 승격(`selection.js`)도 이 일치를 전제로 좌표 변환 없이 rect 를 쓴다. `.sheet` 에
  border 추가 금지(화면 테두리는 outline/box-shadow). `assets/paper.css` 의 `.sheet` 주석 경고 정독.

## 2. git · 검증 규칙 (병행 세션 안전)
- 착수 전 `git status --porcelain`. **금지**: `git add -A`/`commit -a`, 브랜치 생성·전환, `stash`/`reset --hard`/
  `checkout --`/`clean`. 스테이징은 **경로 명시**. main 이 origin 보다 뒤처지면(behind) 푸시 전 **머지**(리베이스 아님 —
  문서가 커밋 해시 참조)로 통합 후 테스트.
- 렌더 테스트는 `--test-concurrency=1`(Chrome 동시 1개), 병합 전 전체 렌더 1회. **부하 시 플래키 가능**(B1/B3 등
  AI 렌더 테스트) → 실패 시 그 파일만 단독 재실행해 진짜 회귀인지 확인.
- 무회귀 검증(전부 그린 유지):
  ```
  npm run test:unit                                  # 순수 JS, Chrome 불필요
  node --test --test-concurrency=1 test/render/acceptance.render.test.js test/render/paper.render.test.js test/render/editor-print-parity.render.test.js
  node --test test/unit/mood-pack.test.js test/unit/mood-object-tree.test.js test/unit/mood-route.test.js test/unit/mood-editor-lifecycle.test.js
  ```
- 시각 확인(디자인 기능): 렌더는 구조·페이지수·parity만 보장하고 미관은 못 본다 →
  `RenderImage`(Chrome `--screenshot`)로 임시 PNG 렌더 후 `cokacdir --sendfile` 로 사용자에게 전송해 육안 확인.
  임시 스크립트/이미지는 git 스테이징 금지·사용 후 삭제.

---

## GOAL P3 — 페이지별 방향 혼합(복합 세트), flow 전용 초판
> **단일 방향(3a)은 이미 end-to-end 동작한다** — `resolvePaper`(orientation portrait/landscape·invalid throw),
> `paperDims`(landscape 면 장·단변 swap), `paperCss`(`--sheet-w/h` + `@page` 리터럴), `PAPER_PRESETS`(a4-landscape/
> a3-fold/b4-2col), 인스펙터 방향 select→`onPaperChange`→`/paper` 라우트, `paper.render.test.js` E0(A3 가로 =
> 1191×841 W>H·PNG IHDR) 그린. **P3 의 실제 목표는 3b(페이지별 혼합)** 이며, 착수 시 3a 가 여전히 그린인지만 재확인.

**목표**: 한 문서 안에서 **페이지마다 방향이 다른 복합 세트**(예: 1쪽 세로 + 2쪽 가로)를 생성·인쇄한다.
초판은 **flow 전용 페이지로 범위 한정**(교사 float 개체 제외 — float 원점 전제가 이질적 용지에서 깨지는지 별도 검증 전까지).

**최고 위험**(PLAN pre-mortem #3 / §1 불변식): 페이지별 방향은 `.sheet` 기하 고정 전제(float rect 원점·border 0)와
Chrome 실측 페이지네이션이 이질적 용지 크기에서 깨지지 않는지 먼저 검증해야 한다.

**접근(권장 순서)**:
1. **스파이크(무변경·측정)**: 페이지별 크기가 다른 문서를 Chrome named `@page` + 페이지별 `.sheet` 치수로 렌더해
   PDF MediaBox 가 페이지별로 다르게 나오는지, `PaginateObjectTree` 실측이 이질 용지에서 각 페이지 가용 높이를
   올바로 계산하는지 확인. flow-only 픽스처로.
2. **데이터 모델**: 방향은 **문서 메타/페이지 메타** — 문서 전체 `document.paper`(기존) 위에 **페이지별 override**
   (`page.paper` 또는 `page.orientation`)를 optional 로. 개체 카탈로그·개체 트리 노드 스키마 **무변경**(페이지 메타일 뿐).
   `applyDocOp`/서버 라우트 단일 관문으로만 변경.
3. **렌더**: `RenderObjectTree`/`AssembleWorksheet` 가 페이지별 방향을 named `@page` + `.sheet` per-page 치수로 방출.
   미지정 페이지 = 문서 방향(무회귀). paper.css 의 `.sheet` 는 `--sheet-w/h` 소비 — 페이지별 변수 주입 방법 설계.
4. **페이지네이션**: `PaginateObjectTree`/`reflow.js` 가 페이지별 가용 높이를 페이지 방향에 맞춰 계산(현재는 문서 단일
   방향 전제일 수 있음 — 여기가 핵심 난점).

**수용 기준(AC)**:
- AC-P3-1: 방향 미지정 문서·페이지가 현행과 **동치**(무회귀) — unit + acceptance + parity 그린.
- AC-P3-2: 복합 세트(1쪽 세로 + 2쪽 가로) PDF 가 **페이지별 MediaBox 방향 혼합**으로 생성(pt 치수 실측).
- AC-P3-3: 학생용 정답 제거 유지 · 편집==인쇄 하드 동치가 **이질 용지 페이지에서도** 성립(3자 동치 렌더 테스트 확장).
- AC-P3-4: 초판은 **flow 전용 페이지로 범위 한정**(교사 float 개체 있는 페이지는 방향 혼합 제외 또는 명시적 차단).
- AC-P3-5: 새 개체 타입 0(닫힌 카탈로그 무변경) · AI 좌표 미생성.

**접점 파일**: `assets/paper.css`(`.sheet`·`@page`·`--sheet-*`), `src/usecases/paper.js`(`resolvePaper`/`paperDims`/
`paperCss`/`paperToPx`/`PAPER_PRESETS`), `src/usecases/RenderObjectTree.js`·`AssembleWorksheet.js`(paper 주입 지점),
`src/usecases/PaginateObjectTree.js`·`src/editor/reflow.js`(가용 높이 계산), `src/adapters/PaginationMeasurer.js`,
`src/editor/inspector.js`(방향 컨트롤 — 페이지별로 확장?), 스키마(page 메타 optional), `test/render/paper.render.test.js`·
`workbook.render.test.js`(복합 세트 스냅샷).

---

## GOAL P4 — 교사 자연어 목적 → 닫힌 무드 이름 선택 (에이전트)
**목표**: `worksheet-planner`/`worksheet-designer` 파이프라인에 "교사 자연어 목적 → **닫힌 무드 목록 중 이름만** 선택"
단계를 추가한다. **AI 는 무드 '이름'만 고른다** — CSS/좌표/토큰을 저작하지 않고, 개체 트리를 건드리지 않는다.
선택 근거를 산출물에 남겨 검수 대상으로 삼는다.

**무드 카탈로그(닫힌 목록, 현재 5종 — 단일 원천 `themes/moods/*.css`, 서버 `listMoods()`/`availableMoods`)**:
- `calm` 차분한 기본(일반 수업) · `exam` 시험지형(시험·평가) · `wide` 넓은 필기(서술·탐구) ·
  `angular` 각진 실무(발표·실무) · `soft` 둥근 파스텔(저학년·활동).
- 무드 적용 관문: manifest 경로 `manifest.mood`, 개체트리 경로 `document.mood`(applyDocOp/`/mood` 라우트).
  렌더는 `loadRenderAssets`/`AssembleWorksheet` 가 fail-closed 로 해석(미지 무드 차단).

**수용 기준(AC)**:
- AC-P4-1: 에이전트가 자연어 목적(예: "저학년 컬러링 활동", "중간고사 대비 문제지")에서 **닫힌 5무드 중 하나의
  이름**을 선택. 목록 밖 이름·CSS·좌표 저작 시 실패/차단.
- AC-P4-2: 선택 근거(왜 이 무드인가)를 산출물(협의 브리프/문서 메타)에 기록.
- AC-P4-3: 선택된 무드가 `manifest.mood`/`document.mood` 단일 필드로만 반영(2차 원천 금지).
- AC-P4-4: 무드 미선택 = 현행(무드 없음) — 무회귀.

**접점 파일**: `.claude/agents/worksheet-designer.md`(+`worksheet-planner.md`), `.claude/skills/worksheet-design/SKILL.md`
(+`references/themes.md` — 무드 규약 추가), 무드 카탈로그(`themes/moods/*.css` / `listMoods`), 협의 브리프 스키마
(`.claude/skills/worksheet-consult/references/brief-schema.md` — `designTheme` 옆 `mood` 힌트?).

---

## /ultragoal 사용 노트
- 두 목표는 **독립**(P3=엔진 조판, P4=에이전트 규약). 병렬 가능하나 P3 가 위험·부피 큼 → P3 스파이크부터 권장.
- 각 목표를 `/ultragoal` goal 로 등록하고 위 AC 를 완료 기준으로. P3 는 반드시 **스파이크(측정)→데이터모델→렌더→
  페이지네이션** 순, 단계마다 red→green + 렌더 직렬 검증. 시각 결과는 PNG→텔레그램 전송으로 사용자 확인.
- P3-b 가 이질 용지 페이지네이션에서 편집==인쇄를 깨면 즉시 멈추고 사용자와 범위 재협의(복합세트는 PLAN 이
  "최고 위험·후속"으로 명시한 지점).
