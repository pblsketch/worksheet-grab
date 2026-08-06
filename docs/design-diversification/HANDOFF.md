# Handoff — 활동지 디자인 다양화 (P2-c-1 무드 레이아웃 변형 완성 → 후속)

> 이 폴더만 읽어도 이어갈 수 있게 자기완결로 정리. 상세는 같은 폴더의 `PLAN.md`,
> `00-inventory-and-token-spec.md`, `01-baseline-and-regression-gate.md`,
> `02-mood-pack.md`(P2-a + P2-b 전 단계) 참조.
> 최종 검증: unit 966 · L0 11 · 무드게이트(pack/object-tree/editor-lifecycle/route) · browser-purity 4 ·
> 무드렌더(exam 밑줄헤더 실 Chrome) · 전체 렌더 스위트 fail 0(D14 paste todo 기존·무관) 그린 (2026-08-05).
> P2-a `4f2b97f`/`2ca275f` · P2-b1 `4ba4de8`/`fd682b3` · P2-b2 `f3f071f`/`cb7ab26` · P2-b3-server `22ca4b0`/`aaec9b5`
> · P2-b3-client `596996a`/`114307d`. **P2-c-1(레이아웃 변형) 아직 미커밋.**

## 새 세션 시작 프롬프트 (복붙용)
```
worksheet-grab(E:/github/worksheet-grab)의 "활동지 디자인 다양화"를 이어서 한다.
먼저 docs/design-diversification/HANDOFF.md · PLAN.md · 02-mood-pack.md 를 정독하라.
- P1(토큰화 13토큰·181곳) + P2-a(매니페스트 경로) + P2-b1(개체트리 렌더 경로) + P2-b2(문서 생명주기) 완료.
  P2-a: themes/moods/{exam,soft,angular}.css + buildDocumentHtml optional moodCss(theme 뒤 한 겹,
  미지정=바이트 무회귀) + AssembleWorksheet manifest.mood fail-closed + FsBlockRepository.loadMoodCss/listMoods.
  P2-b1: loadRenderAssets 가 document.mood 읽어(fail-closed) assets.moodCss/moodName 반환 + RenderObjectTree 전달.
  P2-b2: documentRoutes.buildLegacyDocument 가 manifest.mood→document.mood 조건부 carry(비침습) + checkpoint
  왕복 보존(whole-document, JSDoc).
  P2-b3-server: /mood POST 라우트(=/theme 동형·listMoods·fail-closed 400·no-op·해제=빈값→delete) + availableMoods.
  P2-b3-client: editor.js changeMood(=changePaper 미러) + 인스펙터 무드 드롭다운 + wgReflowAfterReload 일반화.
  P2-c-1(무드 레이아웃 변형): 무드 파일이 :root{13토큰} 뒤 레이아웃 오버라이드 규칙 허용(활성 시만 로드=무회귀),
  fail-closed 가드(.sheet/.answer/크롬/float·position·url() 금지)+자기검증. 첫 변형=exam 밑줄 헤더 5종.
  편집==인쇄는 reflow.js 가 teacher <style>(무드 포함) 이식으로 자동 성립. 게이트 mood-pack + mood.render(실 Chrome).
- 다음(택1): (A) P2-c-2 무드 레이아웃 변형 확장(밑줄헤더를 다른 무드로 / 표 조밀↔여유 / 헤더 밴드 유무.
  문항 1단↔2단은 paper.columns 충돌로 후순위. 변형마다 무드 렌더 골든). (B) "디자인 방향 서랍" 팩 확장.
  (C) P3 용지 방향 단일화. (D) P5 삽화 무드(별도 PRD).
- 불변식 절대 준수: 편집==인쇄 · 의존성0·빌드0 · 단일진실원천(applyDocOp) · fail-closed ·
  htmlAllowlist·닫힌 카탈로그 무변경 · AI 좌표 미생성.
- git: add -A/브랜치/reset/clean 금지, 경로 명시 스테이징. 착수 전 `git status --porcelain`.
  렌더 테스트는 `--test-concurrency=1`, 병합 전 전체 렌더 1회.
- 무회귀 검증(전부 그린 유지):
  node --test test/unit/blocks-token-equivalence.test.js test/unit/mood-pack.test.js test/unit/mood-object-tree.test.js test/unit/mood-editor-lifecycle.test.js test/unit/mood-route.test.js
  npm run test:unit
  node --test --test-concurrency=1 test/render/acceptance.render.test.js test/render/paper.render.test.js test/render/editor-print-parity.render.test.js test/render/mood.render.test.js
  브라우저 배선 변경 시 node --check + browser-purity + 전체 렌더 스위트로 편집기 로드 무결성 확인.
  새 토큰/무드 추가 시 L0-1 sanity 토큰집합 + 축별 카운트 단정 + mood-pack 13토큰 어휘를 갱신할 것.
  무드 레이아웃 변형 추가 시 mood-pack 가드(assertMoodFileSafe) 통과 + 무드 렌더 골든(mood.render) 추가.
다음 단계(A/B/C/D) 중 하나를 사용자와 정한 뒤 계획을 확인하고 착수하라.
```

## 목표
과목=강조색 6개에 용접된 **recolor-only** 디자인을, **"사용자의 목적/상황이 디자인을 고르는"**
무드(레지스터) 축으로 확장한다. 내용(과목·성취기준)과 디자인(목적→무드)을 직교 분리.

## 지금까지 (DONE)
| 커밋 | 내용 |
|---|---|
| `7bc8f75` | 기존 stale test 수정 (venn 조직자 P3 organizer 타입 반영, 제품코드 불변) |
| `eb828a3` | P1-a 괘선 색 `#cbd5c0`→`var(--wg-rule-color)` (29) + **L0 무회귀 게이트 구축** |
| `1035d32` | P1-b 모서리 `border-radius 4/6/8px`→`var(--wg-radius-sm/md/lg)` (24) |
| `74b399d` | P1-c 괘선폭 `border-width 1px`→`var(--wg-rule-w)` (43) |
| `16b0d97` | P1-d 블록리듬 `margin-top 3mm/2mm`→`var(--wg-space-block/-sm)` (23) |
| `673b684` | P1-e 타이포 `font-size 6클러스터`→`var(--wg-fs-*)` (62) |
| `0286ac2` | P1 완료 핸드오프 + 토큰/게이트 설계 문서 |
| `4f2b97f` | P2-a 무드 팩 — `themes/moods/{exam,soft,angular}.css` + `buildDocumentHtml` moodCss 주입 + `AssembleWorksheet` manifest.mood(fail-closed) + `FsBlockRepository.loadMoodCss/listMoods` + `test/unit/mood-pack.test.js`(8) + `02-mood-pack.md`. 상세: `02-mood-pack.md` |
| `2ca275f` | P2-a 커밋 해시·전체 렌더 결과 문서 반영 |
| `4ba4de8` | P2-b1 개체트리 렌더 경로 무드 — `loadRenderAssets` 가 `document.mood` 읽어(fail-closed) `assets.moodCss/moodName` 반환 + `RenderObjectTree`→`buildDocumentHtml` 전달 + `test/unit/mood-object-tree.test.js`(5, 두 경로 일관성 포함). blocks.css·AssembleWorksheet 무변경 |
| `fd682b3` | P2-b1 커밋 해시 문서 반영 |
| `f3f071f` | P2-b2 문서 생명주기 — `documentRoutes.buildLegacyDocument` 의 `manifest.mood→document.mood` 조건부 carry(비침습) + `SaveDocument.checkpoint` 왕복 보존(whole-document, JSDoc) + `test/unit/mood-editor-lifecycle.test.js`(3, 실 편집기 서버 carry/persist/무회귀). `ValidateObjectTree` 가 mood 문서메타 수용 증명 |
| `cb7ab26` | P2-b2 커밋 해시 문서 반영 |
| `22ca4b0` | P2-b3-server 무드 변경 서버 게이트 — `/mood` POST 라우트(=/theme 동형·listMoods·fail-closed 400·no-op·해제=빈값→delete) + GET /shell.json `availableMoods` 노출 + `test/unit/mood-route.test.js`(5). 클라이언트 리플로우는 b3-client |
| `aaec9b5` | P2-b3-server 커밋 해시 문서 반영 |
| `596996a` | P2-b3-client 편집기 무드 UI — `editor.js changeMood`(=changePaper 미러: dirty→save→POST /mood→리플로우+reload) + 인스펙터 무드 드롭다운(insp-mood, '기본(무드 없음)'=해제) + `wgReflowAfterReload` 일반화. browser-purity + 전체 렌더 fail 0. 무드 축 end-to-end 완성 |
| `114307d` | P2-b3-client 커밋 해시 문서 반영 · 무드 축 완결 |
| **미커밋** | **P2-c-1 무드 레이아웃 변형 — 무드 파일이 `:root{⊆13토큰}` 뒤 레이아웃 오버라이드 규칙 허용(활성 시만 로드=무회귀). fail-closed 가드(`.sheet/.answer/크롬/float`·position·url() 금지)+자기검증. 첫 변형=exam 밑줄 헤더 5종. `mood.render.test.js`(실 Chrome PDF) + 전체 렌더 fail 0. 편집==인쇄는 reflow 가 무드 `<style>` 이식으로 자동 성립 |

**총 13토큰 · 181곳.** 모든 토큰은 `var(--토큰, 현행리터럴)` 이며 **어디에도 정의하지 않음**
→ 폴백=현행 → 계산값·인쇄 출력 동치(무드 미지정 = 무회귀). 무드 팩(P2)이 이 토큰에 값을 넣는다.

### 토큰 어휘 (13)
| 축 | 토큰 | 현행 폴백 | 치환수 |
|---|---|---|---|
| 괘선 색 | `--wg-rule-color` | `#cbd5c0` | 29 |
| 괘선 폭 | `--wg-rule-w` | `1px` | 43 |
| 모서리 | `--wg-radius-sm/md/lg` | `4/6/8px` | 24 |
| 블록 리듬 | `--wg-space-block/-sm` | `3mm/2mm` | 23 |
| 타이포 | `--wg-fs-title/heading/pill/label/body/caption` | `20/12/10.5/9/9.5/8.7pt` | 62 |

### 무회귀 게이트 (핵심 — "바이트 무회귀"의 실제 의미)
- `blocksCss` 는 `<style>` 에 **raw 삽입**되어 리터럴→`var()` 치환 시 **HTML 텍스트는 반드시 바뀐다**
  → "raw HTML diff=0" 은 불가능. 무회귀는 아래 3계층으로 정의(설계: `01-baseline-and-regression-gate.md`).
  - **L0** `test/unit/blocks-token-equivalence.test.js` (+ `test/fixtures/golden/blocks-css-baseline.json`):
    선언 개수·순서 불변 + 각 값이 (리터럴 동일) 또는 (`var(token,리터럴)` 로 리터럴==원본) +
    토큰이 어디에도 정의 안 됨 + **자기검증(사보타주)**. 스윕마다 **도입 토큰집합 sanity + 축별 카운트 단정**을 누적 갱신.
  - **L1** 실 Chrome computed-style 골든 — **설계만, 미구현**(원하면 추가). 지금은 L0+L2로 충분히 방어.
  - **L2** 기존 인쇄-진실 렌더(신규 아님, 통과 유지가 게이트): `acceptance`·`paper`·`editor-print-parity`.
- 검증 커맨드:
  ```
  node --test test/unit/blocks-token-equivalence.test.js          # L0 (현재 11 tests)
  npm run test:unit                                               # 943 그린
  node --test --test-concurrency=1 test/render/acceptance.render.test.js test/render/paper.render.test.js test/render/editor-print-parity.render.test.js  # L2 13 그린
  ```

### 시연 (엔진 밖, 참고)
- (workspace) `wsdemo/mood-demo/build.mjs` — 실제 `blocks.css`+`paper.css`+`themes/sci.css` 에
  mood `:root` 오버라이드만 얹어 같은 활동지가 기본/각진실무형/둥근파스텔로 바뀜을 렌더로 확인.
  P2 렌더 주입이 실제로 해야 할 일의 프로토타입.

## 남은 작업 (TODO)
### P2 — 진짜 무드 기능 (엔진)
- **P2-a (첫 증분) — ✅ 완료(미커밋)**. 상세: `02-mood-pack.md`.
  1. ✅ `themes/moods/{exam,soft,angular}.css` — `:root{ --wg-* }` 닫힌 13토큰 값 세트.
  2. ✅ `buildDocumentHtml()` optional `moodCss`/`moodName` — `theme` **뒤에** 한 겹 append(빈값=바이트 무회귀).
  3. ✅ `AssembleWorksheet.#serialize` 가 `manifest.mood` 를 `listMoods()`(닫힌 카탈로그)로 **fail-closed** 검증 후
     `loadMoodCss` 로드. `FsBlockRepository.loadMoodCss/listMoods` + 포트 스텁. 개체 카탈로그·트리 스키마 무변경.
  4. ✅ 게이트 `test/unit/mood-pack.test.js`(8) — 카탈로그 정합 + 주입 무회귀(레이어 한 겹 제거=미지정 동일). L0/L2 그린 유지.
- **P2-b1 — ✅ 완료(`4ba4de8`)**: 개체트리 렌더 경로 — `loadRenderAssets` 가 `document.mood` 를 fail-closed
  해석 → `assets.moodCss/moodName` → `RenderObjectTree`→`buildDocumentHtml`. `test/unit/mood-object-tree.test.js`(5).
- **P2-b2 — ✅ 완료(미커밋)**: 문서 생명주기 — `buildLegacyDocument` 의 `manifest.mood→document.mood` 조건부
  carry(비침습) + `checkpoint` 왕복 보존(whole-document, JSDoc). `test/unit/mood-editor-lifecycle.test.js`(3).
- **P2-b3-server — ✅ 완료(미커밋)**: `/mood` POST 라우트(=/theme 동형·listMoods·fail-closed 400·no-op·해제=빈값→
  delete) + GET /shell.json `availableMoods` 노출. `test/unit/mood-route.test.js`(5).
- **P2-b3-client — ✅ 완료(미커밋)**: `editor.js changeMood`(=changePaper 미러) + 인스펙터 무드 드롭다운
  (`insp-mood`, '기본(무드 없음)'=해제) + `wgReflowAfterReload` 일반화. **무드 축 end-to-end 완성.**
- **다음(무드 축 밖)** — **"디자인 방향 서랍"** 정식 무드 팩:
  차분한기본 · 시험지형 · 넓은필기 · 모던(에디토리얼/카드) · (삽화형은 P5). 리서치 근거는 대화기록/PLAN 참조.
- **P3**: 용지 방향 — **단일 방향(문서 전체 가로/세로) 먼저**, 페이지별 혼합(복합 세트)은 **후속·flow 전용**
  (최고 위험: 실측 페이지네이션 + `.sheet` float rect 원점 전제. `paper.css` 주석 경고 참조).
- **P4**: `worksheet-designer` 파이프라인에 "교사 자연어 목적 → **닫힌 무드 이름** 선택"(AI는 이름만, CSS/좌표 미저작).
- **P5 (후속 PRD)**: 삽화 필요 무드(저학년/컬러링) — 안전한 장식 자산 통로(SVG/이미지 슬롯 + allowlist/카탈로그 확장). 별도.
- **P1 잔여(선택)**: 셀 padding/gap(`--wg-space-box-y/x`, `--wg-space-gap-*`) — 값 편차 커서 보류(01 인벤토리 4-b 주석).
  헤더 구조 변형(색스트립↔밑줄↔없음)은 스칼라 토큰이 아니라 **레이아웃 변형**(P2-b class 단위).

## 핵심 접점 파일
- `assets/blocks.css` (토큰 소비), `assets/paper.css` (용지 `--sheet-*` 파라미터·orientation 여지),
  `themes/*.css` (+신규 `themes/moods/`), `src/usecases/AssembleWorksheet.js`(`buildDocumentHtml` = **mood 주입 지점**),
  `src/usecases/RenderObjectTree.js`, `src/domain/Theme.js`(`THEME_TOKENS`), 스키마(manifest mood/orientation optional),
  `.claude/agents/worksheet-designer.md`.

## 불변식·규칙 (반드시)
- 편집==인쇄(R2-1) · 의존성0·빌드0(외부 라이브러리 도입은 정책결정) · 단일 진실원천(`applyDocOp`) ·
  fail-closed(정답 누출 시 산출 차단) · htmlAllowlist·닫힌 개체 카탈로그(12종) 무변경 · AI 좌표(rect) 미생성.
- **병행 세션**: 이 저장소는 여러 세션이 한 작업트리를 공유. 착수 전 `git status --porcelain` — 내가 만질 파일이
  남의 손에 `M` 이면 멈추고 알린다. **금지**: `git add -A`/`commit -a`, 브랜치 생성·전환, `stash`/`reset --hard`/`checkout --`/`clean`.
  스테이징은 경로 명시. (상세: `docs/CONCURRENT-SESSIONS.md`)
- 렌더 스위트 직렬 `--test-concurrency=1`, 병합 전 전체 렌더 1회.

## 이 하네스 특유의 운영 노트
- 백그라운드 서브에이전트/셸은 세션 종료 시 중단되고 결과 회수가 불안정할 수 있음 →
  위임 워커에는 **파일 산출물**을 지시(파일로 회수), 렌더 테스트는 **포그라운드(timeout 크게)** 권장.
- 기존 known-red(`editor-objects.render.test.js:173`)는 `7bc8f75` 에서 해결됨(stale test).
