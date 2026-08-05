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

## 다음(P2-b, 미착수)
- 개체트리/편집기 무드 선택 — `document.mood` + `applyDocOp` 단일 관문 + `loadRenderAssets`→
  `RenderObjectTree`에 `assets.moodCss` 배선(현재 optional 기본 `''` 이라 하위호환). manifest→개체트리
  마이그레이션의 mood carry-through도 여기서.
- "디자인 방향 서랍" 정식 팩 확장(차분한기본·시험지형·넓은필기·모던) + 무드별 골든(선택적으로 L1
  Chrome computed-style 무드 골든 추가).
