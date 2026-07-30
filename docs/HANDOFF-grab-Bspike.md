# HANDOFF — B′ 스파이크 (ValidateAiFragment 결정 태스크)

> 이 문서 하나로 **새 세션이 컨텍스트 없이** B′ 를 수행한다. 착수 전 §2(함정)를 반드시 읽어라.
> 선행 grab(M1·M2·M3a) + M4(강조상자) + M5(UX 마감) 는 **모두 main 에 병합·푸시 완료**
> (main `50876d4`, GitHub pblsketch/worksheet-grab). 재구축 금지.

## 0. B′ 는 무엇인가 (결정 태스크 — 기능 배포 아님)
현재 "AI 생성"은 **고정 ops 어휘**(`replace|insert|delete|insert-section`, `aiBridge.AI_OPS`)로 표현한다.
B′ 는 그 대안을 **실증**한다: 제약된 AI 에이전트가 **scaffold·flow-only 객체트리 프래그먼트(JSON)** 를
직접 저작 → 신설 **`ValidateAiFragment`**(결정적 검증기)가 게이트 → 엔진이 프래그먼트를 **단일
`insert-section` op 로 컴파일**. 산출은 코드가 아니라 **ADR(결정문)**: *"고정 ops 확장 계속 vs B′ 채택"*
을 데이터로 판정한다.

## 1. 현재 상태 (이미 배포됨 — 재구축 금지)
- grab 3기능(M1 마퀴선택·M2 다중페이지·M3a insert-section) 배포됨.
- M4 강조상자(callout, 13번째 개체 타입) 배포됨: `ObjectCatalog`·`calloutObject` 스키마·
  `RenderObjectTree.renderCallout`·삽입팔레트·인스펙터.
- M5 배포됨: **열화 계약**(`unsupported` 상태+reason 봉투 — `aiBridge`/`FsAiBridgeRepository`/
  `aiRoutes`/`ai.js`/`cli`), **undo 회귀가드**(`testSeed.js` runReflow), echo/stale 정책 유지.
- **M4 방어(B′ 의 직접 선행)**: `src/editor/aiLayoutGuard.js#enforceAiLayout` — AI 가 SIZE_FIELDS/
  opacity/angle 를 저작 못 하게 적용 경로(`ai.js#sanitizeAiObject` 단일관문)에서 강제. B′ validator 는
  이 발상을 **프래그먼트 전체 구조**로 확장하는 것이다.
- 유닛 805 pass·0 fail, 렌더 editor-ai 13/13.

## 2. ⚠ 반드시 아는 함정 (착수 전 필독)
1. **동시 세션 실존** — `git -C E:/github/worksheet-grab worktree list` 로 확인(관측: `-editorqa`).
   **격리 워크트리**: `git -C E:/github/worksheet-grab worktree add E:/github/worksheet-grab-bspike -b feat/bspike`.
   main 워크트리에서 **브랜치 전환 금지 · `git add -A` 금지 · 경로 지정 커밋만**.
2. **무의존성 = 비협상** — Node 표준만. **`Node 에 DOMParser 가 없다`** — 브라우저 `sanitizeAiHtml`
   을 Node 유스케이스에서 그대로 못 부른다. `src/usecases/html-scan.js` 는 스스로 "완전한 HTML5
   파서 아님"을 자인한다. → B′ 는 **제한 HTML 문법을 토큰 단위로 엄격 승인**하거나, validator 실행을
   **브라우저로 한정**한다는 보안 경계 결정을 ADR 에 남겨라(codex #6).
3. **5대 불변식(코드강제 vs 정책)** — 정답누출 fail-closed=코드강제(`SaveDocument.checkpoint`
   :148-158·`BuildVariants`·export 재검증). "AI 는 HTML·좌표 미생성"=**프롬프트 정책일 뿐**
   (`ObjectCatalog` 는 float/rect/HTML 을 정상 어휘로 허용) → **B′ validator 가 이걸 구조적으로 강제해야
   한다**. 페이지네이션=파생물(`applyAiOps` 무접촉, export 재측정). 편집==인쇄(render core 소유).
   `applyDocOp` 단일관문.
4. **재사용 우선** — 새 코드 전에 `aiBridge.js`·`validateObjectShape.js`·`objectFactory.applyAiOps`·
   `ai.js#sanitizeAiObject`/`aiLayoutGuard.js`·`ValidateWorksheet.js`(누출검사) 를 먼저 read.
5. **테스트** — 순수 로직은 별도 모듈로 추출해 Chrome 없이 유닛 고정(선례: `marqueeHits.js`·
   `pageScope.js`·`aiLayoutGuard.js`). 렌더 하네스는 `test/render/editor-ai.render.test.js`.

## 3. `ValidateAiFragment` 정확한 계약 (codex 적대적 리뷰 §2 반영)

### 거부할 것 (하나라도 있으면 **fragment 전체 반려** — 조용한 삭제 금지)
- **문서/페이지 저작**: `pagination`, `pages`, `page`, `pageId`, `pageIndex`, `role`, `flow`, `float`.
- **개체 최상위 `id`** (ID 는 컴파일러가 발급). **단 내부 id 는 정상** — `question.choices[].id`,
  `blanks[].id`, `left/right/items[].id`. **재귀적 id 전면 금지 금물**.
- **`placement`**: 아예 금지하고 컴파일러가 `flow` 주입(허용한다면 정확히 문자열 `'flow'` 만).
- **`rect`·`xMm/yMm/wMm/hMm`·`opacity`·`angle`** (opacity/angle 은 런타임 전 타입 공통 허용
  `validateObjectShape.js:28-30` 이라 **별도 AI 게이트 없으면 통과**한다).
- **`widthPct`·`minHeightMm`·`align`** (SIZE_FIELDS **3종 전부** — 핸드오프 구판의 "widthPct/align"은 불완전).
- **타입**: `std-box`(원문 불변)·`shape`(float 전용)·`spacer`·`page-break`(AI 비저작 조판 어휘).
- **AI 비저작 표현 필드**: `borderColor`·`borderWidth`·`bgColor`·`strokeColor`·`fillColor`·
  `strokeWidth`·`dash`·`sourceType`.
- **`image-slot.src`**: 검증된 로컬 자산 토큰을 엔진이 주입하는 경로가 없으면 거부(원격 URL·정답
  구운 이미지·경로 탈출을 fragment validator 가 판정 불가).
- **`additionalProperties` 전부** — `validateObjectShape` 는 최상위 이름만 닫고 **중첩 구조는 불충분**
  (codex #5). 중첩 객체 타입·enum·추가필드까지 결정적 검사.
- **`answerKey` 임의 객체** → `{text?:string, html?:string}` 닫힌 형태로 재정의.

### 허용할 것
- 허용 타입의 `TYPE_SPECS.required/optional` 중 **AI 저작 필드만**.
- `table.splittable` 은 오직 `false`. `callout.variant` 는 닫힌 enum(`CALLOUT_VARIANTS`).
- **HTML 은 지정된 6위치만**: `passage-slot.bodyHtml`·`richtext.html`·`question.answerKey.html`·
  `title.textHtml`·`question.promptHtml`·`callout.body`.
- `passage-slot.bodyHtml` 은 요청 컨텍스트에 `allowPassageContent:true` 같은 **명시 권한** 있을 때만.
- `answer:true` 는 `ANSWERABLE_TYPES` 소속 타입만.

### HTML 정제 (블랙리스트 아닌 **필드별 allowlist** — codex #6)
- 현 `sanitizeAiHtml` 은 `script`·`on*`·`javascript:` URL 만 제거 → `style`·`iframe`·`object`·
  `embed`·`form`·`srcdoc`·CSS url()·`meta refresh`·임의 class/id/data 속성 통과. **부족**.
- 인라인 필드: `strong/em/b/i/u/s/sub/sup/mark/br/span`. 블록 필드: +`p/ul/ol/li/blockquote/table…`
  (제품이 실제 지원하는 최소 집합). `style`·`id`·`data-*`·`contenteditable`·`class=answer|plot-ans`
  AI 직접 주입 거부. 링크 `https/http/mailto` 만. 이미지는 `image-slot` 으로만.
- **평문 정합**: `textHtml/promptHtml` ↔ 평문 `text/prompt` 가 다르면 렌더는 HTML·diff/검사기는
  평문을 본다(`RenderObjectTree` 278-280·317-325). 정제 HTML 에서 평문 재계산 또는 정규화 일치 강제.

### 미마킹 답안 (codex #7 — "100% 거부"는 일반적으로 불가능)
결정적 검증기는 "정답은 4이다"가 답인지 설명인지 의미적으로 모른다(누출검사도 `.answer/.plot-ans`
안의 알려진 정답을 바깥과 비교할 뿐 — `ValidateWorksheet.js` 92-110, 8자 미만 미검사). **수용기준을
축소**하라(택1):
- (a) **B′ 에서 답안 생성 금지**(권장 — 가장 깨끗). 답은 별도 경로.
- (b) 답안은 `question.answerKey`/`answer:true` 개체로만 받고, **corpus 가 준 알려진 답안 문자열의
  미마킹 공격을 100% 거부**한다고 한정. 자유텍스트 의미론적 미마킹은 human/reviewer 영역이라 명시.

## 4. 스파이크 계측 + 함정
- **고정 corpus + 임계**: 구조 유효율 · unsupported 비율 · 정책 반려율 · stale 반려 · preview/apply
  일관 · 순서 정확도 · **미마킹답안/HTML/좌표 공격 100% 거부**.
- **컴파일/적용 함정**(codex):
  - `aiBridge` 는 삽입 개체에도 id 요구하나 B′ 는 AI id 거부 → validator 통과 후 컴파일러가 임시/엔진
    ID 주입 or 프로토콜 변경.
  - `objectFactory.applyAiOps` 는 새 ID 재발급하나 **개체 스키마 미검증** → ValidateAiFragment 를 안
    거친 일반 v4 ops 도 malformed 개체 적용 가능(별도 방어 필요).
  - anchor 없는 `insert-section` 은 문서 말미로 들어간다 — 선택 페이지 생성이 목표면 anchor 필수화.
  - **stale 반려는 fragment 구조검증 책임 아님** → 컴파일 결과에 요청 당시 `pageVersions` 를 묶고
    적용 직전 비교(M2 pageVersions 인프라 재사용).
  - "정제 후 허용" vs "공격 100% 반려" 문구 충돌 → 위험제거=승인 / 위험존재=반려로 계측 기준 분리.
  - **검증한 정제 결과 = 미리보기 = 실제 적용 객체가 동일**해야 한다(검증 뒤 원본 재-sanitize/compile
    하면 preview/apply 드리프트).

## 5. 정의된 완료(DoD)
`ValidateAiFragment` + 거부 매트릭스 유닛 · 스파이크 corpus + 계측 · **ADR(결정문)**. 격리 브랜치 커밋 ·
(사용자 승인 후) main 병합. **기능 배포가 아니라 권고안 산출.**

## 6. 핵심 파일 지도
- 문서 모델: `schema/worksheet-object.schema.json`, `src/domain/schema/*`(ObjectCatalog·
  validateObjectShape·exportGate).
- AI 브리지: `src/usecases/aiBridge.js`(AI_OPS·validateResponse·**M5 unsupported**),
  `src/adapters/FsAiBridgeRepository.js`, `src/adapters/editor-routes/aiRoutes.js`, `src/cli/index.js`.
- 적용/컴파일: `src/editor/objectFactory.js`(applyAiOps), `src/editor/ai.js`(sanitizeAiObject·미리보기),
  **`src/editor/aiLayoutGuard.js`**(M4 방어 — B′ 의 발상적 선행).
- 누출/불변식: `src/usecases/ValidateWorksheet.js`·`SaveDocument.js`·`BuildVariants.js`·
  `src/usecases/html-scan.js`("완전 파서 아님" 자인).
- 선행 계획: `docs/HANDOFF-grab-M4-M5-Bspike.md`(§3 B′ 요약), codex 리뷰 전문은 세션 밖
  워크스페이스 `codex_ext.md`(있으면).
- 렌더 하네스: `test/render/editor-ai.render.test.js`, 순수추출 선례 `src/editor/aiLayoutGuard.js`.
