# HANDOFF — grab 확장 (M4 강조상자 · M5 UX 마감 · B′ 스파이크)

> 이 문서 하나로 **새 세션이 컨텍스트 없이** 세 작업을 이어받아 수행한다.
> 작성: grab(M1·M2·M3a) 병합 직후 (main `9ed0ea9`). 착수 전 §2(함정)를 반드시 읽어라.

## 0. 목표
이미 배포된 인에디터 "grab"(개체/페이지 선택 → AI 부분수정 / 새 섹션 생성) 위에 세 가지 **선택 확장**을 구축한다:
- **M4 — 강조상자(callout) 타입**: AI/교사가 만들 수 있는 새 flow 개체 종류(팁·주의·핵심정리 박스).
- **M5 — UX 마감**: 미리보기/undo 일관, "지시가 어휘 초과" 시 열화 계약, 동시성 가드 확정 등 완성도.
- **B′ 스파이크**: "AI 생성"을 고정 ops 확장으로 계속 갈지 vs 제약 에이전트가 객체트리 프래그먼트를 저작(게이트 통과)하게 할지 **실증 후 결정**(연구/결정 태스크 — 산출은 권고안+ADR).

## 1. 현재 상태 (이미 배포됨 — 재구축 금지)
- 저장소 `E:\github\worksheet-grab`, **main `9ed0ea9`** (grab 병합 + GitHub push 완료: pblsketch/worksheet-grab).
- grab 3기능 완성·검증:
  - **M1** 마퀴(드래그 박스) 선택이 flow 본문 개체(`.wg-obj`)까지 잡음. 순수 `src/editor/marqueeHits.js` + `test/unit/marquee-hits.test.js`. 수집부: `selection.js` finishMarquee.
  - **M2** 썸네일 Ctrl/Cmd 다중선택(`selectedPageIds`, `leftPanel.js`), AI scope N페이지. 순수 `src/editor/pageScope.js` + 테스트. 다중페이지 충돌은 **기존 `pageVersions` 인프라가 자동 처리**(ai.js). 시각표시 `.thumb.multi-selected`(editor.css).
  - **M3a** `insert-section` 원자 op(여러 flow 개체 순서보존 삽입): `aiBridge.js`(AI_OPS 추가+검증), `objectFactory.js`(applyAiOps), `ai.js`(미리보기 카드 펼침), 계약 `cli/index.js`+`.claude/skills/worksheet-grab/SKILL.md`. 테스트 `editor-ai-ops.test.js`·`ai-bridge.test.js`.
- 검증 완료: 유닛 767/758·0fail, 렌더 `editor-select`·`editor-ai`(13/13), 실물 캡처(영역선택·다중페이지·선택→AI요청→미리보기→적용).

## 2. ⚠ 반드시 아는 함정 (착수 전 필독)
1. **동시 세션 실존** — 이 저장소는 여러 워크트리/세션이 동시에 산다(관측: `worksheet-grab-editorqa`, `-organizers` 등). **격리 워크트리에서 작업하라**: `git -C E:/github/worksheet-grab worktree add E:/github/worksheet-grab-<name> -b feat/<name>`. main 워크트리에서 **브랜치 전환 금지 · `git add -A` 금지 · 경로 지정 커밋만**. 착수 전 `git status --porcelain` 비어 있는지 확인. 상세: `CLAUDE.md` §병행세션 · `docs/CONCURRENT-SESSIONS.md`.
2. **불변식(코드로 강제되는 것 vs 정책)** — 아래는 grab 작업 중 실코드로 확인한 정정된 사실이다:
   - **정답누출 fail-closed = 코드 강제**: `SaveDocument.checkpoint`(src/usecases/SaveDocument.js:148-158)가 누출 감지 시 학생 HTML 미기록+`removeStudentHtml`. `reviewChip.js`가 변경마다 재검증. `BuildVariants` 학생본 정답 물리제거. export 재검증. → **학생 PDF로 정답이 새어나갈 수 없다.**
   - **"AI는 HTML·좌표 미생성" = 프롬프트 정책일 뿐(코드 미강제)**: `ai.js` sanitizeAiHtml은 정제만 하고, `ObjectCatalog.js`는 float/rect/HTML을 정상 어휘로 허용. → **B′의 `ValidateAiFragment`가 이걸 구조적으로 강제해야 한다.**
   - **페이지네이션은 파생물**: `applyAiOps`는 pagination을 안 건드리고, export(`PaginateAndExport`)가 항상 재측정. AI는 페이지 경계를 저작하지 않는다.
   - 그 외: 편집==인쇄(render core가 HTML 소유), `applyDocOp` 단일 관문, **무의존성(Node 표준만, sharp/Playwright/subprocess 스택 도입 금지)**.
3. **AI 브리지(무API)** — 에디터가 요청을 파일 큐(`<ws>/.ai-bridge/`, `POST /ai/requests`)에 넣고, 구독 AI가 CLI `worksheet-grab ai respond <id> --ops <file>`로 응답. ops 어휘=`replace|insert|delete|insert-section`(v4, `aiBridge.AI_OPS`). 테스트에서 구독 AI는 `FsAiBridgeRepository.putResponse`로 모의(`test/render/editor-ai.render.test.js`의 `watchAndRespondOps` 참고).
4. **테스트** — `npm run test:unit`(~18s), `npm run test:render`(실 Chrome, 직렬, **매우 김** — 파일 지정 실행 권장: `node --test --test-concurrency=1 test/render/editor-ai.render.test.js`). **순수 로직은 별도 모듈로 추출해 Chrome 없이 유닛 고정**(선례: `marqueeHits.js`·`pageScope.js`·`shouldPromoteBodyDrag`). 렌더 하네스: `startEditServer`+CDP(WebSocket) 패턴은 `editor-ai.render.test.js` 참고. **Chrome은 이 환경에 있다**(export/render 테스트가 실제로 돎).
5. **재사용 우선** — grab 내내 "이미 있는 걸 다시 만들지 말 것"이 반복 교훈이었다(마퀴·다중페이지 충돌·정답누출 방어가 이미 존재했음). 새 코드 전에 **기존 구현부터 grep/read**.

## 3. 작업 상세

### M4 — 강조상자(callout) flow 개체 타입
- **설계**: float 좌표(원칙3 완화) 금지. **flow 개체 + 에디터전용 `widthPct/align`(이미 스키마 허용)**로. variant(tip/warning/note 등) + 제목 + 본문. AI는 이 개체를 `insert`/`insert-section`으로 생성 가능(제외 타입 아님). **단, AI는 `widthPct/align`을 저작 못 하게**(sanitize 경로에서 드롭). 정답을 담지 않는 중립 박스로 시작(answer 처리 불필요).
- **닿는 파일**: `src/domain/schema/ObjectCatalog.js`(12→13 타입) + `schema/worksheet-object.schema.json`(동기, `test/unit/object-schema.test.js`가 강제) · `src/usecases/RenderObjectTree.js`(HTML 방출, 편집==인쇄) · `src/editor/editorStyle.js`/`editor.css`(스타일) · `src/editor/inspector.js`(속성 편집) · `src/editor/leftPanel.js`(삽입 그리드) · `src/editor/objectFactory.js`(createObject 기본값) · `src/editor/ai.js`(sanitize: widthPct/align 드롭) · `src/usecases/BuildVariants.js`·`PaginateObjectTree`(round-trip 확인).
- **수용기준**: 스키마가 callout 수용 · 렌더가 그림(편집==인쇄 렌더 테스트) · ValidateObjectTree 통과 · AI가 insert-section으로 callout 생성 가능(유닛) · BuildVariants/pagination/save round-trip · 유닛+렌더.

### M5 — UX 마감
- **미리보기/undo 일관**: 다중페이지·섹션 편집도 **단일 `applyDocOp`=단일 undo**임을 렌더 테스트로 단정(대부분 이미 성립 — 회귀 방어 추가).
- **열화 계약**: 지시가 ops 어휘를 초과하거나 구독 AI가 표현불가 응답 시 **조용한 실패 금지** → 명확한 "이건 불가" 메시지 + 정의된 동작(거부/부분적용 명시). 현재 `ai.js` buildOpsVersion이 무효 ops를 blockReason으로 막음 — 사용자 친화 메시지+계약으로 확장.
- **동시성 가드 확정**: 다중페이지 `pageVersions` 충돌 감지는 이미 있음(`editor-ai.render.test.js` 충돌 테스트) — 메시징/가드 마감 + 테스트.
- **수용기준**: undo 일관 렌더 테스트 · 열화 메시지 테스트 · 회귀 0.

### B′ 스파이크 (결정 태스크)
- **프로토타입**: 제약 에이전트가 **scaffold·flow-only 객체트리 프래그먼트(JSON)** 저작 → 신설 **`ValidateAiFragment`**(결정적)가 page/pagination/id 필드·float/rect 좌표·에디터전용 size(widthPct/align)·미허용 HTML을 **거부**하되, 정책 허용된 정제-HTML 필드(bodyHtml/richtext.html/answerKey.html/textHtml/promptHtml)는 정제 후 허용. 엔진이 프래그먼트를 **단일 `insert-section` op로 컴파일**.
- **고정 corpus + 임계**: 구조 유효율 · unsupported 비율 · 정책 반려율 · stale-response 반려 · preview/apply 일관 · 순서 정확도 · **미마킹 답안/HTML/좌표 공격 100% 거부**.
- **결정**: B′가 정말 더 개방적이면서 5대 불변식을 지키는가? → *"ops-확장 계속 vs B′ 채택"* 을 데이터로 결정.
- **수용기준**: `ValidateAiFragment` + 거부 매트릭스 유닛 · 스파이크 corpus + 계측 · **ADR(결정문)**. (기능 배포가 아니라 권고안 산출.)

## 4. 권장 순서
grab 착수 게이트(V0 정답누출·M0 동시성)는 grab 작업 중 사실상 해소됨(정답누출 코드강제 확인, 다중페이지 pageVersions로 동시성 처리). 따라서:
- **M4(콜아웃)** 와 **M5(마감)** 는 서로 독립 → 병렬 가능.
- **B′ 스파이크** 는 결정 태스크 → M4의 "AI가 callout 저작" 정책과 맞물리므로, B′ 먼저 하거나 M4와 병행. 새 세션의 계획(`/ralplan`)이 정하라.

## 5. 정의된 완료(DoD)
세 작업 각각: 유닛+렌더 테스트 통과 · **격리 브랜치 커밋** · (사용자 승인 후) main 병합+push · 워크트리 정리. B′는 배포 대신 **ADR/권고안** 산출.

## 6. 핵심 파일 지도
- 계획 전문: (이 저장소 밖) 사용자 워크스페이스 `PLAN-DRAFT.md`(v1) — 없으면 이 핸드오프가 SSOT.
- 문서 모델: `schema/worksheet-object.schema.json`, `src/domain/schema/*`(ObjectCatalog·ValidateObjectTree·PageIdentity·exportGate).
- 렌더: `src/usecases/RenderObjectTree.js`(편집==인쇄), `PaginateObjectTree.js`, `src/editor/reflow.js`.
- 에디터: `src/editor/editor.js`(applyDocOp 단일관문), `objectFactory.js`(ObjOps·applyAiOps), `ai.js`(AI 패널·미리보기), `selection.js`, `leftPanel.js`, `inspector.js`, `editorStyle.js`.
- AI 브리지: `src/usecases/aiBridge.js`, `src/adapters/editor-routes/aiRoutes.js`, `src/adapters/FsAiBridgeRepository.js`, `src/cli/index.js`.
- 검수/불변식: `src/usecases/ValidateWorksheet.js`, `SaveDocument.js`, `BuildVariants.js`, `src/editor/reviewChip.js`.
- 제품 계약: `.claude/skills/worksheet-grab/SKILL.md`, `.claude/agents/worksheet-designer.md`, `worksheet-reviewer.md`.
- 경계/렌더 테스트: `test/unit/harness-boundary.test.js`, `test/render/editor-ai.render.test.js`, `editor-select.render.test.js`.
