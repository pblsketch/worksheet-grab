# HANDOFF — B′ 후속 과제 (프래그먼트 저작 배선 이후)

> 이 문서 하나로 **새 세션이 컨텍스트 없이** B′ 후속을 이어받는다. 착수 전 §2(함정)를 반드시 읽어라.
> **B′ 결정 + 라이브 배선은 main 에 병합·푸시 완료**(GitHub pblsketch/worksheet-grab).
> 결정문 SSOT: `docs/ADR-bspike-ai-fragment.md`. 재구축 금지.

## 0. 지금까지 (완료 — 재구축 금지)
"AI 생성"을 고정 ops 확장으로 갈지 vs 제약 AI 가 객체트리 프래그먼트를 저작(게이트 통과)하게 할지의
결정 태스크(B′)가 **채택 + 배포**로 끝났다. 검증 계층을 얹되 `insert-section` 은 전송 계층으로 유지한다.

- **결정 검증기**: `src/domain/schema/validateAiFragment.js` — scaffold·flow-only 프래그먼트를 결정적으로
  게이트(좌표·id·조판·SIZE·opacity/angle·page키·표현필드·image src·std-box/shape/spacer/page-break·
  **answer/answerKey**·미허용 HTML 거부, 중첩까지). 컴파일러가 엔진 id·`placement:'flow'` 주입·순서
  보존·anchor 필수·요청시점 pageVersions 바인딩.
- **HTML allowlist**: `src/domain/schema/htmlAllowlist.js` — 순수 Node 토큰 검증(DOMParser 없이). 금지
  요소 발견 시 조용한 삭제 없이 **전체 반려**. 속성은 `a.href`(http/https/mailto)만.
- **적용 배선**: `src/usecases/applyAiFragment.js#prepareAiFragment`(검증→컴파일→`validateObjectShape`
  구조 floor) · `src/usecases/aiBridge.js`(프래그먼트 봉투 `{fragment,afterId?|beforeId?}` +
  `isFragmentResponse`) · `src/editor/ai.js#buildFragmentVersion`(가산 분기 — 검증·컴파일 후 기존
  `buildOpsVersion` 파이프라인 재사용) · `src/cli/index.js`(`ai respond --fragment`) ·
  `src/editor/browserGraph.js`(applyAiFragment.js 화이트리스트 등재).
- **계약**: `.claude/skills/worksheet-grab/SKILL.md`·`.claude/agents/worksheet-designer.md` "B′ 프래그먼트
  저작" 절.
- **검증**: 유닛 `test/unit/{validate-ai-fragment,html-allowlist,bprime-corpus,apply-ai-fragment}.test.js`
  전량 PASS(전체 스위트 0 fail) · 렌더 `editor-ai` 13/13 · 계측 `test/fixtures/spike-bprime/run-spike.mjs`
  ALL-GATES-PASS(공격 11클래스 100% 거부).

## 1. 남은 과제 (우선순위 순)

### B1 — 프래그먼트 저작 **UI 진입점** (P1, 배선은 있으나 진입이 없음)
현재 프래그먼트 **응답**은 처리되지만(`buildFragmentVersion`), 교사가 "여기에 새 활동 섹션을 만들어줘"를
누를 **진입점이 없다**. 구독 AI 가 스스로 `--fragment` 로 답해야만 경로가 탄다.
- 필요한 것: (a) 진입 UX(앱바/슬래시/우클릭에 "새 섹션 AI 저작") + 클릭 위치에서 **anchor 산출**(선택
  개체 뒤 or 페이지 말미), (b) 요청 컨텍스트에 "이건 섹션 저작 요청" 신호를 실어 designer 가 `--fragment`
  로 응답하도록, (c) 필요하면 `AI_ACTIONS`(현재 `rewrite|fill-example`, `aiBridge.js`)에 `author-section`
  추가.
- **주의**: 응답측 파이프라인(`ai.js#applyResponseAsVersion`→`buildFragmentVersion`→`buildOpsVersion`)은
  이미 완성이다 — anchor 는 `buildFragmentVersion` 이 `response.afterId/beforeId` 또는 마지막 target 에서
  뽑는다(§src/editor/ai.js). 진입쪽만 없다.
- **수용기준**: 실 Chrome 에서 "새 섹션" 진입→요청→(모의 구독 AI `--fragment` 응답)→미리보기→적용이
  단일 undo 로 도는 **렌더 테스트**(seed 시나리오). 순수 e2e 는 이미 `apply-ai-fragment.test.js` 에 있다.

### B2 — HTML allowlist **프로파일 확장** (P1, 현재 안전 최소집합)
`htmlAllowlist.js` 의 `INLINE_TAGS`/`BLOCK_TAGS` 는 의도적으로 좁다(strong/em/…/p/ul/li/blockquote/h3/h4/
table…). 제품이 실제 렌더하는 태그와 **정합**시켜야 실사용 프래그먼트가 반려되지 않는다.
- 방법: `src/usecases/RenderObjectTree.js`(방출 마크업)·`assets/blocks.css`(지원 클래스)를 감사해 실제
  지원 태그/클래스를 **데이터 기반**으로 확정. `<a>` 링크·상대 URL·특정 class(예: 렌더 기능용) 허용
  정책 결정.
- **주의**: 넓힐수록 공격면이 는다 — 넓힌 태그마다 `html-allowlist.test.js` 에 승인/반려 케이스 추가.
  `class=answer|plot-ans` 등 정답 위장 클래스는 **계속 거부**(누출 방어).
- **수용기준**: 실 워크시트 corpus 로 거짓 반려율 계측 → 0 을 목표. 확장분 유닛 고정.

### B3 — `allowPassageContent` **권한 연결** (P2, 현재 항상 거부)
프래그먼트 경로는 `passage-slot.bodyHtml` 을 `ctx.allowPassageContent` 없이는 거부한다. 그런데
`buildFragmentVersion` 은 `response.context` 만 보고, 그 값이 채워지는 경로가 없다 → 지문 저작이 사실상
**항상 거부**된다.
- 필요한 것: 교사가 "지문도 AI 가 채우게 허용"을 명시한 요청에서 그 권한을 응답 컨텍스트까지 실어
  `prepareAiFragment({ctx:{allowPassageContent:true}})` 로 전달. 저작권 경계(로컬 처리·교사 책임)는
  `passageSlotObject` 스키마 주석·SKILL 계약 참조.
- **수용기준**: 권한 유/무에 따라 bodyHtml 승인/반려가 갈리는 유닛 + 실 경로 렌더.

### B4 — **비프래그먼트 ops 경로 구조 게이트** (P2, 선택 하드닝)
`validateObjectShape` 구조 floor 는 **프래그먼트 경로에만** 있다. 일반 `--ops`(replace/insert/
insert-section) 로 들어온 AI 신규 개체는 `objectFactory.applyAiOps` 가 **구조 미검증**으로 적용한다
(ADR §10.1 잔여분). malformed v4 를 여기서도 막으려면 게이트가 필요하다.
- **함정(중요)**: `applyAiOps` 안에서 `validateObjectShape` 를 걸면 **기존 유닛이 대거 깨진다** —
  `test/unit/editor-ai-ops.test.js` 는 `placement` 없는 최소 개체(`{id,type,prompt}`)를 넘긴다. 게이트는
  **`ai.js#buildOpsVersion` 의 insert/insert-section 분기**(신규 저작분, `sanitizeAiObject` 직후)에 걸어
  problems 로 막는 편이 안전하다(적용 버튼 비활성 + 사유 — 조용한 실패 금지 규약과 정합).
- **수용기준**: 신규 저작 malformed 개체가 미리보기 단계에서 차단되는 렌더/유닛 + 회귀 0.

### B5 — **답안 포함 섹션 저작** (P3, 제품 결정 필요)
B′ 는 답안을 저작하지 않는다(결정 (a), ADR §7). "연습문제 섹션을 정답까지 한 번에"를 원하면 설계가
필요하다: (i) 2단계 — 프래그먼트로 scaffold 저작 후, 새 question 개체에 `--ops`/answerKey 로 답안 부착,
또는 (ii) B′ 를 완화해 `answerKey` 를 **더 엄격한 누출 게이트와 함께** 허용. 순수 결정 태스크가 아니라
제품/UX 판단이다 — 필요 시 별도 ADR.

### B6 — 프래그먼트 **렌더 seed 테스트** (P2, 테스트 부채)
배선은 순수 e2e(`apply-ai-fragment.test.js`: `prepareAiFragment`→실제 `applyAiOps` 적용)로 고정했지만,
브라우저에서 `buildFragmentVersion`→미리보기→적용까지 도는 **seed 구동 렌더 테스트는 없다**. B1 을 하면
자연히 함께 생긴다(같은 시나리오). 렌더 하네스는 seed 구동(`?seed=...`)이라 브라우저측 seed 코드 추가가
필요하다 — 모의 구독 AI 는 `test/render/editor-ai.render.test.js#watchAndRespondOps` 패턴을 `--fragment`
버전으로 확장(`putResponse({schemaVersion:4, id, fragment:[…], afterId})`).

## 2. ⚠ 반드시 아는 함정 (착수 전 필독)
1. **동시 세션 실존** — main 이 빠르게 전진한다(관측: 조직자/그림개체 세션 병렬). **격리 워크트리에서
   작업**: `git -C E:/github/worksheet-grab worktree add E:/github/worksheet-grab-<name> -b feat/<name>`.
   main 워크트리에서 브랜치 전환 금지·`git add -A` 금지·경로 지정 커밋만. `docs/CONCURRENT-SESSIONS.md`.
2. **origin 지연** — 여러 세션이 로컬 main 에 병합만 하고 push 를 미룬다. push 는 **다른 세션 미push 작업까지
   함께 밀어낸다** — 단독 push 금지, 사용자/세션 소유자 확인 후에만.
3. **무의존성 = 비협상** — Node 표준만. 브라우저 서빙 `/src/*` 는 `browserGraph` 화이트리스트(검수 체인
   전이 도달분)만 → **에디터가 새로 import 하는 `/src/` 파일은 `browserGraph.js#DEFAULT_ENTRIES` 에
   등재**하지 않으면 404 → AI 패널 백지(B′ 배선 때 실제로 겪음). `apply-ai-fragment.test.js` 의 404 가드·
   `test/render/editor-resize.render.test.js` "콘솔 오류 없음" 이 상시 단정.
4. **preview==apply 불변** — 승인 HTML 은 원문 그대로라 재-sanitize 금지(드리프트). 검증된 정제 결과 ==
   미리보기 == 실제 적용 개체.
5. **답안 미생성 유지** — B5 를 건드리지 않는 한 프래그먼트는 answer/answerKey 를 거부한다(누출 100%
   구조 차단). 완화 시 `ValidateWorksheet.js` 누출 검사(8자 미만 미검사, `MIN_ANSWER_LEN`)의 한계를 반드시
   함께 고려.
6. **테스트** — 순수 로직은 별도 모듈로 추출해 Chrome 없이 유닛 고정(선례: htmlAllowlist·validateAiFragment·
   applyAiFragment). 렌더는 `node --test --test-concurrency=1 test/render/editor-ai.render.test.js`(매우 김).

## 3. 정의된 완료(DoD)
각 과제: 유닛(+해당 시 렌더) 통과·회귀 0 · 격리 브랜치 커밋 · (사용자 승인 후) main 병합. B2/B5 는 결정
문서(계약/ADR) 갱신 동반.

## 4. 핵심 파일 지도
- 결정문: `docs/ADR-bspike-ai-fragment.md`(§10 후속·§13 배선 기록).
- 검증기/컴파일러: `src/domain/schema/validateAiFragment.js`·`htmlAllowlist.js`(+ `index.js` 재수출).
- 적용 배선: `src/usecases/applyAiFragment.js`(prepareAiFragment) · `src/usecases/aiBridge.js`(fragment
  봉투·`AI_ACTIONS`·`validateResponse`) · `src/editor/ai.js`(`buildFragmentVersion`·`buildOpsVersion`·
  `applyResponseAsVersion`·`detectConflict`) · `src/editor/objectFactory.js`(`applyAiOps`).
- 서빙/경계: `src/editor/browserGraph.js`(DEFAULT_ENTRIES) · `src/adapters/editor-routes/staticRoutes.js`
  (/src 화이트리스트·/editor 라우트) · `src/adapters/editor-routes/aiRoutes.js`.
- 계약: `.claude/skills/worksheet-grab/SKILL.md` · `.claude/agents/worksheet-designer.md`.
- 렌더: `src/usecases/RenderObjectTree.js`(편집==인쇄) · `assets/blocks.css`.
- 테스트: `test/unit/{validate-ai-fragment,html-allowlist,bprime-corpus,apply-ai-fragment,browser-purity}.test.js`
  · `test/fixtures/spike-bprime/{corpus.js,run-spike.mjs,spike-metrics.json}` · `test/render/editor-ai.render.test.js`.
