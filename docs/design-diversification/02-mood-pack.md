# P2-a · 무드 팩(레지스터) 데이터 + 매니페스트 경로 주입

> 대상: `E:/github/worksheet-grab`. 선행: P1(디자인 토큰화 13토큰·181곳, `HANDOFF.md`/`00`/`01`).
> 상태: **구현 완료** — 무드 미지정 무회귀(L0/L2 그린) + 무드 지정 주입 스냅샷(신규) 그린.

## 무엇을 했나 (한 줄)
과목=강조색 6개에 용접돼 있던 recolor-only 디자인에, **"목적/상황이 고르는" 무드(레지스터) 축**의
첫 증분을 얹었다 — 무드는 **데이터(themes/moods/\*.css)** 이고, 매니페스트 경로 렌더러가 theme 레이어
**뒤에** 한 겹 주입한다. 내용(과목·성취기준)과 디자인(무드)은 직교.

## 데이터 모델 — `themes/moods/*.css`
- 각 무드 = `:root { --wg-*: 값; }` **단일 블록**. blocks.css 가 `var(--wg-*, 현행리터럴)` 로 소비하는
  **닫힌 13토큰**에만 값을 준다(P1 어휘와 동일 SSOT):
  - 괘선 `--wg-rule-color` / `--wg-rule-w`
  - 모서리 `--wg-radius-sm` / `-md` / `-lg`
  - 블록 리듬 `--wg-space-block` / `-sm`
  - 타이포 `--wg-fs-title` / `-heading` / `-pill` / `-label` / `-body` / `-caption`
- **직교 불변식**: 무드는 과목 색토큰(`--c*`)이나 개체별 인라인 오버라이드(`--wg-ps-*`/`--wg-tb-*`/`--wg-fs`
  등)를 **절대 건드리지 않는다**. 원형·알약 형태(`50%`/`20px`/`12px`)와 의미색(정답 블루 등)은 애초에
  토큰화 대상이 아니라 무드와 무관하게 형태·판독성이 유지된다.
- 초판 3종(HANDOFF 예시 `soft/angular/exam` 그대로):

| 무드 | 성격 | 괘선색 | 괘선폭 | 모서리(sm/md/lg) | 리듬(block/sm) | 본문 fs |
|---|---|---|---|---|---|---|
| `exam` | 시험지형(격식·조밀) | `#9aa3ad` | `1px` | `2/2/3px` | `2.4/1.6mm` | `9.5pt` |
| `soft` | 둥근 파스텔(저학년·여유) | `#d8c9b0` | `1.2px` | `8/12/16px` | `4/3mm` | `10.5pt` |
| `angular` | 각진 실무형(모던) | `#7b8794` | `1px` | `0/0/2px` | `3/2mm` | `9.5pt` |

> 모든 무드의 폰트 크기는 ≥8.5pt(ValidateWorksheet 최소 글자 8pt 경고 임계 위) — 인쇄 가독성 유지.

## 주입 지점 — `buildDocumentHtml`(공유 순수 함수)
`src/usecases/AssembleWorksheet.js`의 `buildDocumentHtml`에 optional `moodCss`/`moodName` 추가.
CSS concat 순서 `paper → blocks → theme` **뒤에** 무드 한 겹을 append한다:

```
<style>
${paperCss}

${blocksCss}

/* ===== 교과 테마 토큰 (themes/{theme}.css) ===== */
${themeCss}${mood}        ← mood = '' 이면 아무것도 안 붙음(현행 바이트 동일)
</style>
```
- `moodCss` 빈 문자열(기본)=미주입 → **산출 바이트가 현행과 동일**(무드 미지정=무회귀).
- 무드 이름은 파일 로드가 아니라 이미 문자열로 해석되어 주입된다(themeCss 와 동일 계층 규약 —
  repo 접근은 호출부 책임, 함수는 순수 문자열 조립). 두 렌더 경로(manifest·개체트리)가 이 함수를
  공유하므로, **개체트리/편집기 경로의 무드 배선은 P2-b**(applyDocOp 단일 관문)에서 얹는다.

## 매니페스트 계약 — `manifest.mood`(optional)
`AssembleWorksheet.#serialize`:
- `manifest.mood` 미지정(없음/`''`/`null`) → repo 무드 메서드를 **호출조차 하지 않음** → 현행 그대로.
- 지정 → `repo.listMoods()`(닫힌 카탈로그)로 검증 후 `repo.loadMoodCss(name)` 로드 → 주입.
- **미지 무드 = fail-closed** — 조용히 무시하지 않고 `Error`("알 수 없는 무드 …")로 차단. 단일
  진실원천은 `manifest.mood` 하나. 개체 카탈로그(12/14종)·개체 트리 스키마 **무변경**.

리포지토리(`FsBlockRepository`)에 `loadMoodCss(name)`(경로이탈 차단)·`listMoods()`(없으면 `[]`) 추가,
포트(`BlockRepository`)에 스텁 추가. `themes/moods/` 하위폴더는 `listThemes()`/`theme-purity`의
`.css` 필터가 자연히 제외하므로 기존 테마 검사와 충돌 없음.

## 게이트(무회귀 검증 — 전부 그린)
- **L0** `test/unit/blocks-token-equivalence.test.js`(11) — blocks.css P2-a 무변경이라 단정 그대로.
  L0-3에 "themes/moods/ 는 옵트인 오버라이드라 여기서 검사 안 함(mood-pack 이 담당)" 주석 추가.
- **무드팩(신규)** `test/unit/mood-pack.test.js`(8):
  - (A) 카탈로그 정합 — 각 무드는 `:root` 단일 블록·닫힌 13토큰 부분집합·중복/비변수/미지토큰 금지·
    직교(테마색/오버라이드 토큰 불가).
  - (B) 주입 무회귀 — 미지정=무주입, `''`/`null`=미지정과 바이트 동일, 지정 시 **무드 레이어 한 겹을
    도로 떼면 미지정 산출과 완전히 동일**(그 외 바이트 불변), 미지 무드 throw.
- **L2** 인쇄-진실(변경 없이 재실행 그린): `acceptance`·`paper`·`editor-print-parity`(13). 무드 미지정
  코퍼스라 페이지수·MediaBox·편집=인쇄 파리티 전부 불변.

검증 커맨드:
```
node --test test/unit/blocks-token-equivalence.test.js test/unit/mood-pack.test.js   # 19
npm run test:unit                                                                     # 951
node --test --test-concurrency=1 test/render/acceptance.render.test.js test/render/paper.render.test.js test/render/editor-print-parity.render.test.js  # 13
```

## 불변식 준수 확인
편집==인쇄(무드는 `<style>` 공유 레이어라 편집·인쇄 동일 주입) · 의존성0·빌드0 · 단일 진실원천
(`manifest.mood`) · fail-closed(미지 무드 차단) · htmlAllowlist·닫힌 개체 카탈로그 무변경 ·
AI 좌표 미생성(무드는 엔진 방출 토큰값 세트일 뿐).

## P2-b — 개체트리/편집기 무드 (3단계)
무드는 색만 바꾸는 테마(`/theme` 라우트: reload-only)와 달리 **타이포·간격을 바꿔 리플로우가 필요**하다
(`/paper` 라우트와 동류). 위험을 분리해 3단계로 진행한다.

- **P2-b1 — ✅ 완료(엔진 렌더 경로)**:
  - `loadRenderAssets(repo, document)` 가 `document.mood` 를 themeCss 와 동형으로 해석 → `moodCss`/
    `moodName` 반환(닫힌 카탈로그 fail-closed 검증). 미지정=repo 무드 메서드 미호출=현행.
  - `RenderObjectTree.execute` 가 optional `assets.moodCss`/`moodName` 를 `buildDocumentHtml` 로 전달
    (기본 `''`=미주입). `loadRenderAssets` 를 쓰는 개체트리 소비자(RenderEditorShell·SaveDocument.checkpoint)가
    자동으로 무드를 존중; 직접 assets 를 짜는 호출부(acceptance·BuildVariants·PaginateObjectTree·reflow)는
    `moodCss` 미설정이라 완전 하위호환.
  - 게이트 `test/unit/mood-object-tree.test.js`(5) — 미지정=무주입 · 지정=레이어 한 겹만 · 미지 무드 throw
    · **manifest 경로와 동일 무드 레이어 방출(두 경로 일관성)**.
- **P2-b2 — ✅ 완료(문서 생명주기: carry + persist)**:
  - `documentRoutes.buildLegacyDocument` 가 `manifest.mood → document.mood` 를 조건부 승계(없으면 필드
    미부여=비침습). 저작된 레거시 manifest 가 편집기(GET /shell.json)에서 무드로 렌더된다.
  - `SaveDocument.checkpoint` 는 문서 전체를 `writeManifest`/`writeSnapshot` 하므로 `document.mood` 가 **왕복
    자동 보존**(JSDoc 명시). `ValidateObjectTree`(POST /save 검증)는 `paper`/`themeName` 처럼 mood 문서
    메타를 그대로 통과(테스트로 증명).
  - 게이트 `test/unit/mood-editor-lifecycle.test.js`(3) — 실 편집기 서버 왕복: carry(GET /shell.json →
    document.mood) · persist(POST /save → readManifest·재GET 보존) · 무드미저작=필드 부재(무회귀).
- **P2-b3-server — ✅ 완료(서버 게이트)**:
  - `/mood` POST 라우트 = `/theme` 동형(`listMoods` 화이트리스트·fail-closed 400·no-op 가드) →
    `checkpoint`/`execute` 단일 게이트. 무드는 **해제 가능** — 빈 값이면 `delete next.mood`(기본 복귀,
    `/paper` 의 null→delete 관례). 무드/레거시 양쪽 같은 `.mood` 필드.
  - GET /shell.json 페이로드에 `availableMoods`(=`listMoods()`) 노출 — 인스펙터 무드 드롭다운용
    (`availableThemes` 동형).
  - 게이트 `test/unit/mood-route.test.js`(5) — set/persist · no-op · 미지 400 · 해제(제거) · 카탈로그 노출.
- **P2-b3-client — ✅ 완료(브라우저 UI) → 무드 축 end-to-end 완성**:
  - `editor.js changeMood(moodName)` = `changePaper` 미러 — dirty 면 먼저 `save()` → POST `/mood` →
    `noop` 아니면 **리플로우 플래그 + `location.reload()`**. 무드 변경은 `/theme`(색-only, reload) 이 아니라
    `/paper`(레이아웃, reload+리플로우) 계열이라, 재로드 후 1회 리플로우로 flow 경계를 재계산한다.
  - 리플로우 플래그를 `wgReflowAfterPaperChange` → **`wgReflowAfterReload`** 로 일반화(용지·무드 공용, editor.js
    3곳 + 소비부 editor.js:1165).
  - 인스펙터 문서 모드에 무드 드롭다운(`insp-mood`, `availableMoods` 소비, 테마 드롭다운 동형). **'기본 (무드
    없음)'(빈 값)=무드 해제** 옵션 포함. `createInspector` 에 `onMoodChange` 콜백 + `MOOD_LABELS`(시험지형/둥근
    파스텔/각진 실무형).
  - 게이트: browser-purity(editor.js/inspector.js FS-순수 유지) + 전체 렌더 스위트 fail 0(에디터가 실 Chrome 에
    로드·렌더·파리티 통과). 테마/용지 인스펙터 컨트롤도 전용 e2e 없이 이 방어선을 쓰므로 무드도 동일 기준.

## 무드 축 완성 요약
`themes/moods/*.css`(데이터) → `buildDocumentHtml` 주입 → 매니페스트(`AssembleWorksheet`)·개체트리
(`loadRenderAssets`) 두 렌더 경로 → 문서 승계(`buildLegacyDocument`)·저장 왕복(`checkpoint`) → 서버 변경
게이트(`/mood`)·카탈로그 노출(`availableMoods`) → 편집기 UI(인스펙터 무드 드롭다운 + `changeMood` 리플로우).
전 구간 fail-closed·닫힌 카탈로그·무드 미지정 바이트 무회귀. 게이트 5종:
`mood-pack`(8)·`mood-object-tree`(5)·`mood-editor-lifecycle`(3)·`mood-route`(5) + L0(11)·browser-purity·전체 렌더.

## P2-c — 무드 레이아웃 변형 (PLAN 71행의 "② 렌더계층 레이아웃 변형")
무드 = ① 토큰 값 세트(P2-a~b3) + **② 소수의 렌더계층 레이아웃 변형**. PLAN/Architect 반론이 "다양성의
진짜 원천"으로 지목한 축. 새 개체 타입 없이(닫힌 카탈로그 무변경) 무드 파일의 CSS 규칙으로만 실현.

- **P2-c-1 — ✅ 완료(메커니즘 + 첫 변형: exam 밑줄 헤더)**:
  - 무드 파일이 `:root{⊆13토큰}`(블록1) **뒤에 레이아웃 오버라이드 규칙**을 가질 수 있게 확장. 규칙은
    전역이지만 **해당 무드가 활성일 때만 로드**되므로 무드 미지정 문서는 무변경(byte무회귀 유지).
  - **편집==인쇄 자동 성립**: `reflow.js` 가 측정 시 teacher iframe 의 `<style>`(= `loadRenderAssets` 로
    무드 포함)을 그대로 이식한다 → 편집 측정도 무드 레이아웃을 본다. 무드 변경 시 `changeMood` 의 리플로우가
    새 무드로 재측정. (토큰 무드도 같은 이유로 parity 성립 — 사후 확인.)
  - **fail-closed 가드**(`mood-pack.test.js` `assertMoodFileSafe`): 레이아웃 규칙은 `.sheet`(float 원점)·
    `.answer/.plot-ans`(정답안전)·`.mode-badge/.run-head/.run-foot`(크롬)·`.wg-float`·`@`·`*`·중복 `:root` 를
    **절대 못 건드리고**, `position/inset/top/right/bottom/left/z-index/float/content` 속성·`url()` 도 금지.
    자기검증(변이)로 매 실행 검출력 증명.
  - **첫 변형**: `exam`(시험지형) → **밑줄형 헤더** — 교과색 밴드를 쓰는 구조 색 헤더 5종(`.std-head`,
    `.dash-box .dh`, `.qbox .lab`, `.strip .sh`, `.mapbox .maphead`)을 밑줄로 대체(밴드 색은 밑줄 색으로 보존).
    의미색 callout(tip/warning/summary)은 밴드 유지.
  - 게이트: `mood-pack`(가드 재설계+자기검증+메커니즘 단정) + `test/render/mood.render.test.js`(exam 무드
    문서가 실 Chrome 에서 유효 PDF 로 렌더 — 레이아웃 변형이 인쇄를 안 깸) + 전체 렌더 스위트 fail 0.
- **다음(P2-c-2+)**: 밑줄 헤더를 soft/angular 등 다른 무드로 확장하거나 다른 변형(표 조밀↔여유, 헤더 밴드
  유/무) 추가. 문항 1단↔2단은 `paper.columns` 와 겹쳐 충돌 소지 → 후순위. 변형마다 무드 렌더 골든 추가.

## 다음 (무드 축 밖)
- "디자인 방향 서랍" 정식 무드 팩 확장(차분한기본·시험지형·넓은필기·모던) + (선택) L1 Chrome
  computed-style 무드 골든 + 전용 무드-변경 e2e(테마/용지와 공통 개선).
- 무드 삽화 통로(P5, 별도 PRD) · 용지 방향 단일화(P3, PLAN 참조).
- 이어서 "디자인 방향 서랍" 정식 팩 확장(차분한기본·시험지형·넓은필기·모던) + 무드별 골든(선택적으로 L1
  Chrome computed-style 무드 골든 추가) + **무드 레이아웃 변형**(class 단위, 새 개체 타입 없이 — PLAN 71행).
