# HANDOFF — Phase 4 페이지 범위 AI (완료 · 2026-07-26)

> **상태: 완료.** 아래 5개 스토리(US-P4-2 ~ US-P4-6)를 전부 구현·검증했다. 최종 계약과 설계
> 근거는 `docs/HANDOFF-editor-workspace.md` 의 "2026-07-26 — Phase 4 완료" 절이 권위 문서다.
> 이 문서는 착수 시점의 남은 작업 명세로 남겨 둔다(아래 체크리스트 = 그때의 요구사항).
>
> 완료 근거: 단위 **463/463**, 렌더(직렬) **91/91**, fail 0(기준선 449 / 83). 신규 커버리지 —
> `test/unit/page-version.test.js`(7), `editor-ai-ops.test.js` float 앵커 1건, `ai-bridge.test.js`
> pageVersions 1건, `ai-cli.test.js` v4 4건, `editor-server.test.js` v4 1건,
> `test/render/editor-ai.render.test.js` Phase 4 8건(합치기·무효 계획·버전 왕복 동기화·페이지 scope·
> 충돌·페이지 삭제·다중 페이지 충돌·범위 밖 ops).
> 신규 렌더 2건은 각각 해당 로직을 개악(대표 페이지만 재기 / 범위 판정 무력화)했을 때 실제로
> 실패하는 것을 확인해, 거짓 통과가 아님을 반증했다.
> 합성 이벤트가 거짓 통과를 줄 수 있는 영역(실마우스 클릭·체크박스 토글·실타이핑·Ctrl+Z)은
> 실 Chrome CDP `Input` 실입력으로 별도 재확인했다.
>
> 목적(원문): 새 세션이 이 문서만 읽고 Phase 4 남은 작업을 ralph 로 이어받을 수 있게 한다.
> `prd.json` 은 gitignore 대상이라 **남은 수용 기준을 이 문서에 자립적으로** 옮겨 담았다.

- 기준 커밋: **`d72952a`** (`feat(editor): AI 응답 스키마 v4(ops 계획) + 적용 엔진 — Phase 4 착수`)
- 브랜치: `feat/editor-object-textbox-editing`
- 근거 PRD: `docs/PRD-worksheet-editor-v2-page-object-canvas.md` §9 Phase 4,
  `docs/PRD-worksheet-editor-v2.1-page-multi-object-ai.md` §11~13
- 사용자 결정(2026-07-26): Phase 4 **세 항목 전부 완주**(개수 자유 응답 · 페이지 전체 scope · 충돌 검사)

---

## 1. 어디까지 왔나

### 끝났고 검증됨

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| AI 응답 스키마 v4(`ops[]`) | ✅ | `src/usecases/aiBridge.js` — 단위 15/15 |
| 적용 엔진 `applyAiOps` | ✅ | `src/editor/objectFactory.js` — 단위 10/10 |
| CLI `ai respond --ops` | ✅ | `src/cli/index.js` |
| 하위호환 v1·v2·v3 | ✅ | 전체 단위 449/449, 렌더 83/83, fail 0 |

**사용자에게 보이는 동작 변화는 아직 없다** — 편집기 UI 가 여전히 v3 경로로 돌기 때문이다.
그 배선이 남은 첫 작업이다.

### 착수 전 감사에서 확인된 사실(다시 조사하지 말 것)

복수 개체 **요청**은 이미 된다(`ai.js` `sendRequest` 가 `objects: state.targets.map(...)`).
전후 비교·다중 버전(재생성)·적용/폐기/undo 도 이미 있다. 진짜 결손은 셋뿐이었다:

1. 응답이 1:1 로 묶여 있었다 → **v4 로 계약은 해결, 배선 남음**
2. 선택 0개면 AI 패널이 아예 안 열린다 → 미해결
3. 요청에 `pageId`/`pageVersion` 이 없어 충돌 감지가 불가능하다 → **자리는 만들었고 소비 남음**

---

## 2. 남은 작업 (스토리별 수용 기준)

### US-P4-2 (나머지) — 편집기 적용 경로 배선

`applyAiOps` 는 완성됐다. 남은 것은 편집기가 그걸 쓰게 하는 것.

- [ ] `editor.js` `onApply` 가 v4 `ops` 를 받으면 `applyAiOps` 로 next 문서를 만들고
      `applyDocOp(next, {reflow:true, ai:true})` 를 **한 번만** 호출한다(대상별 반복 호출 금지)
- [ ] undo 1스텝: 3개→1개 합치기 적용 후 Ctrl+Z 한 번으로 세 개체가 모두 원복(실측)
- [ ] 적용 후 선택이 AI 결과 개체로 옮겨간다
- [ ] 기존 v3 경로(1:1 치환·insert 모드) 그대로 동작 — `editor-ai` 렌더 무회귀
- [ ] std-box 는 replace·delete 대상이 될 수 없다 *(엔진에 이미 구현, 배선 후 경로 검증)*
- [ ] 없는 `afterId`/`beforeId` insert 거부 *(엔진에 이미 구현, 동일)*

### US-P4-3 — 미리보기가 개수 변화를 보여준다

현재 `ai.js` `applyResponseAsVersion` 이 `state.targets` 기준 1:1 `items` 를 만들어서,
개수가 바뀌면 "무엇이 사라지고 무엇이 새로 생기는지"를 표현할 수 없다.

- [ ] 미리보기를 `ops` 기준으로 구성 — 수정(replace)/신규(insert)/삭제(delete) 를 구분 표시.
      삭제는 `before` 만, 신규는 `after` 만 보여준다
- [ ] "대상 3개 → 결과 1개" 같은 개수 변화가 패널에 명시적으로 보인다(적용 전에 무엇이
      없어지는지 교사가 안다)
- [ ] ops 를 하나도 못 만들었거나 전부 무효면 적용 버튼 비활성 + 사유 표시(무음 실패 금지)
- [ ] 기존 다중 버전(재생성)·폐기 동작 유지
- [ ] render seed 로 개수 변화 미리보기와 적용 결과를 dataset 단정

### US-P4-4 — 페이지 전체 scope

- [ ] 선택 0개에서 AI 를 부르면 현재 활성 페이지 전체가 대상(`scope:'page'`) — 요청에 그
      페이지의 flow/float 개체가 실린다
- [ ] 선택이 있어도 "현재 페이지 전체"를 명시적으로 고를 수 있다(UI 토글)
- [ ] `scope:'page'` 에서도 std-box 는 수정 대상에서 제외(페이지 전체라는 이유로 성취기준
      원문이 변조되면 안 된다 — 원칙 3)
- [ ] 활성 페이지는 **페이지 ID** 로 식별(index 금지 — Phase 2 규약)
- [ ] render seed 로 (a) 선택 0개 진입 시 scope=page 와 대상 개체 수, (b) std-box 제외 단정

### US-P4-5 — 덮어쓰기 방지(pageVersion 충돌 검사)

- [ ] 순수 함수로 `pageVersion` 계산 — 같은 내용이면 같은 값, 개체 필드가 하나라도 바뀌면
      다른 값, **순서 변경도 감지**. 단위 테스트로 안정성·민감도 검증
- [ ] 요청 시 `pageId` + 그 시점 `pageVersion` 을 함께 보낸다(스키마 자리는 이미 있다)
- [ ] 적용 직전에 현재 `pageVersion` 을 재계산해 비교 — 다르면 자동 적용하지 않고 교사에게
      알리고 선택지를 준다(그래도 적용 / 폐기)
- [ ] 충돌 시 기본 동작은 **적용하지 않음**(fail-closed — 교사의 최신 편집을 조용히 잃지 않는다)
- [ ] 대상 페이지가 그 사이 삭제됐으면(pageId 부재) 적용 거부 + 사유 표시
- [ ] 실측: AI 요청 후 적용 전에 그 페이지를 편집한 뒤 적용을 시도해 충돌 감지를 실브라우저로 확인

### US-P4-6 — 문서·CLI 정합

- [ ] `docs/HANDOFF-editor-workspace.md` 의 AI 스키마 절에 v4(ops 계약·pageId/pageVersion/scope) 반영
- [ ] `test/unit/ai-cli.test.js` · `editor-server.test.js` 가 v4 를 덮는다
- [ ] 전체 단위 + 렌더 직렬 green

---

## 3. 코드 지도 (건드릴 곳)

| 파일 | 지점 | 무엇 |
| --- | --- | --- |
| `src/editor/editor.js` | `onApply` (createAiPanel 인자, 약 1033~1047) | **여기가 첫 배선 지점.** 현재 `mode==='insert'` 면 대상별 `insertFlow`, 아니면 대상별 `replaceObject`. v4 면 `applyAiOps` 한 번으로 대체 |
| `src/editor/ai.js` | `sendRequest` (약 296~313) | 요청 본문 — `pageId`·`pageVersion`·`scope` 를 여기서 싣는다 |
| `src/editor/ai.js` | `applyResponseAsVersion` (약 359~373) | 1:1 `items` 생성 — US-P4-3 의 핵심 개조 지점 |
| `src/editor/ai.js` | `applyCurrent` (약 380~393) | `updates` 를 만들어 `deps.onApply` 호출 — v4 면 `ops` 를 그대로 넘기도록 |
| `src/editor/ai.js` | 대상 수집부 (약 585~595) | `if (targets.length === 0) return;` ← US-P4-4 가 푸는 곳 |
| `src/editor/objectFactory.js` | `applyAiOps` | **완성됨.** 시그니처: `applyAiOps(document, ops, {excludedTypes}) → {document, resultIds}`. 위반 시 **던진다** |
| `src/usecases/aiBridge.js` | `validateRequest`/`validateResponse` | **완성됨.** v4 형태 계약 |
| `src/adapters/EditorHttpServer.js` | 요청 생성부(약 342~) | `schemaVersion: AI_SCHEMA_VERSION`(=4). 클라이언트가 보낸 pageId/pageVersion 을 통과시키려면 여기도 확인 |

---

## 4. 이미 내린 설계 결정 (되풀이하지 말 것)

1. **계층 분리** — `aiBridge` 는 **프로토콜 형태만** 검증한다. "std-box 를 지우려 든다",
   "없는 afterId 를 가리킨다" 처럼 **문서를 알아야** 하는 판정은 `applyAiOps` 책임이다.
   (기존 규약과 동일: 요청 원소 검증도 타입별 완전성을 `ValidateObjectTree` 로 미룬다.)
2. **`AI_SCHEMA_VERSION` 사용 규약** — 이 상수는 **현행 신규 쓰기(v4)** 에만 쓴다. v1/v2/v3
   페이로드에는 **리터럴**을 쓴다. 상수를 옛 형태에 쓰면 형태-버전 불일치로 검증이 거부한다.
   (이미 이 함정으로 테스트 2건이 깨졌다가 정정됐다.)
3. **신규 개체는 새 id** — `applyAiOps` 의 insert 는 AI 가 준 id 를 버리고 `generateId` 로
   새로 만든다. AI 가 기존 id 를 주면 `locate` 가 엉뚱한 것을 집는다.
4. **조용한 부분 반영 금지** — 없는 대상/위치는 건너뛰지 않고 던진다. 건너뛰면 교사는
   "AI 가 반영됐다"고 믿는데 실제로는 절반만 반영된다.

---

## 5. 반드시 지킬 불변식·함정

- **개체 트리가 단일 진실**. `contentHtml` 을 편집 manifest 로 되돌리지 않는다.
- **`applyDocOp()` 가 문서 변경의 단일 관문.** v4 적용도 여기 한 번만 통과해야 undo 가 1스텝.
- **R2-1 편집==인쇄 하드 동치**: 리플로우 측정은 `RenderObjectTree(editMode:true)`, 인쇄는
  `false`. **editMode 전용으로 레이아웃에 영향 주는 DOM 을 추가하면 페이지네이션이 어긋난다.**
  기존 editMode 추가물이 `data-r`/`data-c` 같은 속성뿐인 이유다.
- **무API**: 이 브리지에 LLM 호출은 없다. 파일 큐 왕복뿐(구독 AI 가 CLI 로 회신).
- **std-box 는 AI 불변**(원칙 3). 페이지 전체 scope 에서도 예외 없다.
- **IME 조합 게이트**(Phase 3): `runReflow` 는 진입 시점과 **DOM 치환 직전** 두 번
  `isComposing()` 을 본다. `reloadTeacherFrame` 은 `<body>` 치환 직후 `releaseComposition()`
  을 부른다. AI 적용도 `reloadTeacherFrame` 을 거치므로 이 순서를 깨지 말 것.
  (알려진 잔여 리스크: 조합 도중 구조 변경은 이론적으로 문자 중복 가능 — 근본 해법은
  `reloadTeacherFrame` 초크포인트에서 조합을 먼저 확정시키는 것. Phase 4 가 AI 적용 경로를
  건드리니 **여기서 같이 닫는 것을 검토**하라.)
- **렌더 스위트는 직렬만 신뢰**: `node --test --test-concurrency=1 "test/render/**/*.test.js"`.
  병렬은 Chrome 경합으로 플레이크가 난다.
- **`src/editor/*` 는 브라우저 절대경로(`/src/…`)를 import** 해서 node 가 직접 import 못 한다.
  단위 테스트는 소스의 절대 import 를 file URL 로 치환해 `data:` URL 로 로드한다 —
  `test/unit/editor-ai-ops.test.js` 와 `nudge-float.test.js` 가 그 패턴이다.
- **합성 이벤트는 거짓 통과를 준다**: IME·붙여넣기·드래그·실제 클릭은 render seed(합성)로
  통과해도 실제로는 실패할 수 있다. 실 Chrome CDP 실입력으로 별도 검증하라.

---

## 6. 검증 방법

```bash
npm run test:unit
```

```bash
node --test --test-concurrency=1 "test/render/**/*.test.js"
```

기준선: 단위 **449/449**, 렌더 **83/83**, fail 0 (커밋 `d72952a`).

실브라우저 수동 검증용 편집기 기동:

```bash
node bin/worksheet-grab.js edit-ui page-id-qa --workspaces-dir .omx/manual-qa-workspaces --port 7788
```

> 주의: 그 QA 워크스페이스 문서에는 이전 IME 재현 흔적(`학학학` 등)이 남아 있다. gitignore
> 대상 스크래치라 저장소 영향은 없다.

---

## 7. 완료 정의

- 위 5개 스토리의 모든 체크박스가 실측 근거와 함께 충족
- 전체 단위 + 렌더 직렬 green
- 리뷰어(architect) 승인 — Phase 3 때처럼 **블로커 주장을 코드/실측으로 재확인**할 것.
  리뷰어가 옛 줄 번호로 스테일 판정을 낼 수 있으니 파일을 다시 읽고 판단하라.
