# HANDOFF ADDENDUM — codex Critic 반영 (M4/M5/B′ 계획 확정)

> codex 적대 검토 판정: **ITERATE**(2026-07-30). 아래를 `HANDOFF-grab-M4-M5-Bspike.md` §3 작업 상세에 **우선 적용**한다. 착수 전 본문+이 애드덤을 함께 읽어라.

## A. callout(강조상자) 스펙 동결 — M4 (codex #1)
- **placement**: flow 전용.
- **required**: `variant`(enum: `tip`|`warning`|`note`|`summary`), `body`(살균 HTML — 정제 allowlist).
- **optional**: `title`(평문 + 선택 `titleHtml` 살균), `...SIZE_FIELDS`(widthPct/minHeightMm/align — 에디터 전용).
- **answer 없음(중립 박스)**: 강조상자에는 정답을 담지 않는다 → BuildVariants 학생본 제거·정답누출 검사 확장 불필요(codex #9 회피).
- **AI 저작 가능**(insert/insert-section)하되 **AI 저작 금지 필드**: `SIZE_FIELDS` 3종 + `opacity`/`angle`(codex #4), `body`는 살균 allowlist만.
- **ADR**: 과거 "callout 기각" 결정 문서가 있으면 이 결정으로 **대체**(codex #1).

## B. M4 실제 파일 집합 강화 (codex #2·#3)
필수: `src/domain/schema/ObjectCatalog.js`(TYPE_SPECS + 파생셋 자동) · `schema/worksheet-object.schema.json`(type enum + per-type $def + oneOf 배선) · `src/domain/schema/validateObjectShape.js`(공통 처리면 자동, 아니면 확장) · `src/usecases/RenderObjectTree.js`(callout HTML, 편집==인쇄) · **`assets/blocks.css`**(인쇄 CSS — editorStyle.js 아님) · `src/editor/inspector.js`(속성 편집) · `src/editor/leftPanel.js`(삽입 그리드) · `src/editor/objectFactory.js`(createObject 기본값) · **`src/editor/ai.js`**(AI 응답에서 callout의 금지필드 드롭/거부) · **`src/editor/editor.js`**(배선). 계약: `.claude/agents/worksheet-designer.md`·`SKILL.md`에 callout 어휘 추가(**SIZE_FIELDS 제외**).
- **`test/unit/object-schema.test.js` 강화(codex #3)**: 카탈로그↔스키마 **양방향 전수 비교**(required/placement/enum/oneOf), callout 픽스처 + unknown-type 대체값 추가.

## C. B′ ValidateAiFragment 정련 (codex #5·#6·#7)
- **중첩까지 결정적 검증**(codex #5): 최상위 필드뿐 아니라 중첩 객체 타입·enum·추가필드까지 거부/허용을 결정적으로.
- **HTML allowlist(codex #6)**: 명시 허용목록 밖 요소 발견 시 **조용한 삭제 금지 → fragment 전체 반려**.
- **답안(codex #7)**: "미마킹 답안 100% 거부"는 구조적으로 검증 가능한 범위로 축소하거나 **B′에서 답안 생성 자체를 금지**(권장: B′는 답안 미생성).
- **stale/preview 드리프트**: 컴파일 결과에 요청시점 `pageVersions`를 묶어 적용 직전 비교(stale 반려). **검증된 정제 결과 == 미리보기 == 실제 적용 객체**(적용 직전 재sanitize/재compile 금지 — 드리프트 방지).

## D. M5 프로토콜 정련 (codex #8·#10)
- **unsupported/rejected 응답 프로토콜 신설** + CLI/UI 표시. echo 부분응답·stale 강행 정책 명시(조용한 실패 금지).
- **undo 테스트**: 비동기 reflow의 `history.amend()` 완료 후 검증(codex #10) — 타이밍 고정.

## E. 실행 권장
이 계획은 consensus(handoff = Architect/codex 파생) + codex ITERATE 반영으로 확정됐다. **깨끗한 컨텍스트의 새 세션에서 `/ralph`로 실행**하는 것이 품질상 최선(격리 워크트리 규칙 준수). 순서 권장: **M4(강조상자) → M5(UX 마감) → B′ 스파이크(ADR 산출)**. B′는 배포가 아니라 결정문(ADR) 산출.
