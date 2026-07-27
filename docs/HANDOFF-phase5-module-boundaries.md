# HANDOFF — Phase 5 모듈 경계 정리 (✅ 완료 — 2026-07-27)

> **이 문서는 착수 명세였고, 역할을 마쳤다. 권위는
> [`HANDOFF-editor-workspace.md` § 2026-07-27 Phase 5 완료](./HANDOFF-editor-workspace.md) 로 넘어갔다.**
> 최종 모듈 경계도·라우트 테이블·렌더/저장 경로 지도는 그 절을 보라. 아래는 착수 시점의 명세로
> 남겨 둔다(무엇을 하기로 했는지의 기록).
>
> **결과:** 4개 스토리(US-P5-1~4) 전량 충족. `editor.js` 1,241→884줄, `EditorHttpServer.js`
> 550→84줄, 진짜 중복 파생 4종 통합(`execute`/`checkpoint` 는 입력 스키마가 달라 **합치지 않음**).
> 단위 **467/467**(기준선 463 + 계약 4건 신규) · 렌더(직렬) **91/91** · fail 0 —
> **테스트 개수 감소 0, 기대값 수정 0.** 실 Chrome CDP 실입력은 **HEAD 워크트리와 A/B** 로
> 돌려 항목별 결과가 완전히 같음을 확인했다(자세한 내역은 이양처 문서의 "CDP A/B" 절).
>
> ---
>
> 목적: 새 세션이 이 문서만 읽고 Phase 5 를 ralph 로 착수할 수 있게 한다.
> `prd.json` 은 gitignore 대상이라 **수용 기준을 이 문서에 자립적으로** 담았다.

- 기준 커밋: **`f34d309`** (`docs: Phase 4 계약 반영 — v4 스키마·보호 범위·완료 표시`)
- 브랜치: `feat/editor-object-textbox-editing`
- 근거 PRD: `docs/PRD-worksheet-editor-v2-page-object-canvas.md` §9 Phase 5
- 선행 조건: Phase 4 완료 — 단위 **463/463**, 렌더(직렬) **91/91**, fail 0, 리뷰어 APPROVED

---

## 1. Phase 5 는 무엇인가 (성격이 이전 단계와 다르다)

PRD §9 의 마지막 단계이고, 항목은 셋뿐이다:

- 편집기 controller 분리
- 서버 route 분리
- 중복 렌더·저장 경로 제거

**이전 단계와 결정적으로 다른 점: 사용자에게 보이는 동작 변화가 하나도 없어야 한다.**
Phase 0~4 는 기능을 더했지만 Phase 5 는 순수 구조 정리다. 따라서 "무엇을 만들었나"가 아니라
**"무엇이 안 바뀌었음을 어떻게 증명했나"**가 완료의 근거다. 기존 스위트(단위 463 / 렌더 91)가
그 증명 장치이므로, **테스트를 고쳐서 통과시키면 그 순간 이 단계의 의미가 사라진다.**

> 리팩터링 중 테스트가 깨지면: 테스트가 아니라 **구현을 되돌려라.** 테스트 기대값을 바꿔야만
> 통과한다면 그건 동작이 바뀐 것이고, Phase 5 의 정의상 실패다. (기대값 수정이 정당한 유일한
> 경우는 테스트가 *구현 세부*(내부 함수명·모듈 경로)를 단정하고 있을 때다 — 이 경우 그 단정을
> 동작 단정으로 **바꿔** 쓰고, 이유를 커밋 메시지에 남겨라.)

---

## 2. 남은 작업 (스토리별 수용 기준)

### US-P5-1 — 편집기 controller 분리

`src/editor/editor.js` 는 **1,241줄**이다. UI 위젯은 이미 모듈로 빠져 있고(아래 §3 목록), 이
파일에 남은 것은 *조립 + 상태 소유 + 몇 개의 독립 기능*이 섞인 덩어리다. 실측 섹션 구조:

| 줄(현재) | 책임 |
| --- | --- |
| 1~235 | import · shell 부트스트랩 · core/history/selection 생성 |
| 236~568 | iframe(teacher/student) 수명주기 · 편집 리스너 배선 · 키보드 핸들러 |
| 569~641 | 선택 상태 → 툴바/인스펙터 반영 · 검수 칩(`runReview`) |
| 642~699 | **`applyDocOp` 단일 관문** |
| 700~850 | 페이지 액션 · 스크롤/활성 페이지 |
| 851~879 | 문서 제목 인라인 편집 |
| 880~975 | 미리보기 · PDF 내보내기 |
| 976~1023 | 저장 |
| 1024~1241 | UI 모듈 조립(콜백 배선) |

- [ ] `editor.js` 가 **조립과 상태 소유**만 남기고, 독립적으로 떼어낼 수 있는 책임은 모듈로
      분리된다. 최소한 다음 셋은 각각 파일로 나온다 — **저장**(`save`·dirty 표시·배너),
      **내보내기/미리보기**(`/export`·`/preview.png` 호출과 save-first 게이트), **검수 칩**(`runReview`).
- [ ] 분리된 모듈은 기존 편집기 모듈 관례를 따른다: `create*(deps)` 팩토리 + 주입받은 콜백,
      전역 상태 직접 참조 금지(`core`·`history`·`selection` 을 import 하지 말고 deps 로 받는다).
- [ ] **`applyDocOp` 은 계속 `editor.js` 가 소유한다** — 문서 변경의 단일 관문이라 분산되면
      Phase 2~4 가 세운 불변식(undo 1스텝·리플로우 예약 순서)이 무너진다. 옮기더라도 **관문이
      하나라는 성질**이 코드로 드러나야 한다(호출처가 여럿이어도 진입은 하나).
- [ ] `editor.js` 줄 수가 유의미하게 준다(목표: **900줄 이하**). 숫자 자체가 목적은 아니지만,
      줄지 않았다면 "옮기기만 하고 경계는 그대로"일 가능성이 크니 근거를 대라.
- [ ] 렌더 스위트 무회귀 — 특히 `editor-*.render.test.js` 전량(시드가 편집기 조립에 직접 의존).

### US-P5-2 — 서버 route 분리

`src/adapters/EditorHttpServer.js` 는 **550줄**이고, 단일 핸들러 안에서 `if (path === …)` 15개가
직렬로 늘어서 있다. 실측 라우트 목록:

`POST /save` · `GET|POST /presets` · `/presets/*` · `POST /export` · `POST /open` · `POST /paper` ·
`POST /ai/requests` · `/ai/*`(GET·cancel·applied) · `POST /assets` · `GET /` · `/shell.json` ·
`/preview.png` · `/src/*` · `/editor/*` · `/assets/*`

- [ ] 라우트가 **주제별 모듈**로 나뉜다(최소: 문서(save/open/paper) · AI 브리지 · 자산 · 정적 서빙 ·
      내보내기/미리보기 · 프리셋). 각 모듈은 순수 함수 또는 `create*(deps)` 팩토리로 노출한다.
- [ ] 라우트 매칭이 선형 `if` 사슬이 아니라 **선언적 테이블**(경로·메서드 → 핸들러)로 바뀐다.
      메서드 불일치 시 405, 미매칭 시 404 는 지금 동작 그대로 유지한다.
- [ ] **보안 성질이 코드로 계속 드러난다** — `/src/*`·`/editor/*` 화이트리스트, 경로 탈출 차단,
      `docName` 서버 고정값 주입, 자산 업로드 매직바이트 검사. 이들이 분리 과정에서 **한 곳으로
      모이거나 각 모듈에 남되, 어느 쪽이든 우회 경로가 생기지 않아야 한다.**
- [ ] `editor-server.test.js`(단위 12건) 전량 무회귀. 이 파일이 라우트 계약의 사실상 명세다.

### US-P5-3 — 중복 렌더·저장 경로 제거

이 항목이 셋 중 **가장 위험하다.** 실측한 중복의 실체:

**렌더** — `RenderObjectTree` 를 5곳이 각자 `new` 한다:
`src/editor/ai.js:34` · `src/editor/reflow.js:32` · `src/usecases/BuildVariants.js:58` ·
`src/usecases/PaginateObjectTree.js:147` · `src/usecases/RenderEditorShell.js:78`.
여기에 레거시 결정적 엔진 `AssembleWorksheet` 가 10개 파일에 얽혀 있다.

**저장** — `SaveDocument` 에 두 진입점이 있다:
`execute({name, manifest})`(레거시 HTML manifest, AssembleWorksheet 경유)와
`checkpoint({name, document})`(개체 트리). `EditorHttpServer.js:309-310` 이
`PAGINATION_STATES.includes(manifest?.pagination)` 로 분기하고, CLI(`src/cli/index.js:178`)는
`execute` 만 쓴다.

- [ ] **먼저 지도를 그려라.** 각 렌더·저장 경로가 *누구를 위해* 존재하는지 표로 정리해
      문서에 남긴다(경로 → 호출자 → 이 경로가 없으면 깨지는 것). 지도 없이 지우면 레거시
      경로를 밟는 사용자를 조용히 깬다.
- [ ] 진짜 중복(같은 입력에 같은 출력을 내는 두 구현)만 합친다. **`execute` 와 `checkpoint` 는
      중복이 아니다** — 입력 스키마가 다르다(HTML manifest vs 개체 트리). 합치려면 호출부가
      전부 개체 트리로 넘어온 뒤여야 하고, 지금은 CLI `generate` 가 아직 manifest 를 만든다.
- [ ] 레거시 HTML manifest 지원은 **유지된다**(지연 마이그레이션 — `MigrateManifestToObjectTree`).
      디스크에 남은 옛 문서를 편집기로 열 수 있어야 한다. `editor-migration.render.test.js` 가 증인.
- [ ] 합친 결과가 **R2-1 편집==인쇄 하드 동치**를 깨지 않는다: 리플로우 측정은
      `RenderObjectTree(editMode:true)`, 인쇄는 `false`. 두 경로가 같은 재구성 규칙을 공유해야
      하며(그래서 `rebuildPaginatedPages` 가 하나로 존재한다), editMode 전용으로 **레이아웃에
      영향 주는 DOM 을 추가하면 페이지네이션이 어긋난다.**
- [ ] `editor-print-parity.render.test.js` · `paginate*.test.js` 무회귀.

### US-P5-4 — 문서 정합

- [ ] `docs/HANDOFF-editor-workspace.md` 에 Phase 5 절 추가: 최종 모듈 경계도(무엇이 어디로
      갔는지), 라우트 테이블, 렌더·저장 경로 지도.
- [ ] 이 문서(`HANDOFF-phase5-module-boundaries.md`)를 완료로 표시하고 권위를 위 절로 넘긴다.
- [ ] 전체 단위 + 렌더 직렬 green.

---

## 3. 코드 지도 (현재 상태)

### 편집기 모듈(줄 수 실측)

| 파일 | 줄 | 성격 |
| --- | --- | --- |
| `testSeed.js` | 1519 | 렌더 테스트 시드(프로덕션 아님 — 분리 대상 아니나 편집기 API 변경에 **직접 깨진다**) |
| `editor.js` | 1241 | **US-P5-1 대상** |
| `ai.js` | 990 | Phase 4 에서 커짐. PRD 명시 대상은 아니나 같은 성격의 후보 |
| `selection.js` | 531 | 선택·편집 진입·IME 연계 |
| `objectFactory.js` | 508 | 개체 순수 연산(`applyAiOps` 포함) |
| `leftPanel.js` 457 · `canvasInline.js` 330 · `inspector.js` 323 · `contextToolbar.js` 288 | | UI 위젯(이미 분리됨) |
| `tableEdit.js` 218 · `reflow.js` 205 · `history.js` 136 · `pasteNormalize.js` 104 · `browserGraph.js` 83 · `partEdit.js` 78 · `composition.js` 72 · `icons.js` 53 · `pageOperations.js` 52 · `core.js` 45 | | 보조 모듈 |

### 서버·유스케이스

| 파일 | 지점 |
| --- | --- |
| `src/adapters/EditorHttpServer.js` | 550줄, 라우트 15개 — **US-P5-2 대상** |
| `src/usecases/SaveDocument.js` | `execute`(33행)·`checkpoint`(132행) 두 진입점 — **US-P5-3** |
| `src/usecases/RenderObjectTree.js` | 개체 트리 렌더(단일 구현, 5곳이 각자 인스턴스화) |
| `src/usecases/AssembleWorksheet.js` | 레거시 결정적 엔진(10개 파일이 참조) |
| `src/usecases/PaginateObjectTree.js` | `rebuildPaginatedPages` — 편집/인쇄가 **공유해야 하는** 재구성 규칙 |
| `src/usecases/MigrateManifestToObjectTree.js` | 레거시 manifest → 개체 트리 지연 마이그레이션 |

---

## 4. 반드시 지킬 불변식·함정

- **개체 트리가 단일 진실.** `contentHtml` 을 편집 manifest 로 되돌리지 않는다.
- **`applyDocOp()` 이 문서 변경의 단일 관문.** 분리하더라도 관문이 하나라는 성질을 유지하라.
- **R2-1 편집==인쇄 하드 동치.** 측정은 `editMode:true`, 인쇄는 `false`. editMode 전용으로
  레이아웃에 영향 주는 DOM 을 추가하면 페이지네이션이 어긋난다(그래서 기존 editMode 추가물이
  `data-r`/`data-c` 같은 속성뿐이다).
- **std-box 는 AI 불변**(원칙 3), **무API**(파일 큐 왕복만), **v1~v4 하위호환**.
- **`AI_SCHEMA_VERSION` 은 신규 쓰기(v4)에만.** v1/v2/v3 페이로드에는 리터럴을 쓴다.
- **`src/editor/*` 는 브라우저 절대경로(`/src/…`, `/editor/…`)를 import** 해서 node 가 직접
  import 못 한다. 단위 테스트는 절대 import 를 file URL 로 치환해 `data:` URL 로 로드한다 —
  `test/unit/editor-ai-ops.test.js`·`nudge-float.test.js`·`page-version.test.js` 가 그 패턴이다.
  **모듈을 새로 만들면 이 import 규약을 지켜야 서버 화이트리스트(`/editor/*`)로 서빙된다.**
- **새 편집기 모듈은 서버 화이트리스트에 걸린다.** `EditorHttpServer` 의 `/editor/*` 서빙이
  파일을 찾지 못하면 편집기가 **빈 화면**으로 뜬다(렌더 테스트에서 seed-error 로 드러난다).
- **`testSeed.js` 는 편집기 내부 API 에 직접 의존한다.** controller 를 분리하면 시드가 참조하는
  심볼(`runReflow`·`save`·`handlePageAction`·`updateAll` 등)의 출처가 바뀐다 — 시드는 **동작을
  단정하는 부분은 그대로 두고 배선만** 고쳐라.
- **렌더 스위트는 직렬만 신뢰**: `node --test --test-concurrency=1 "test/render/**/*.test.js"`.
  병렬은 Chrome 경합으로 플레이크가 난다.
- **합성 이벤트는 거짓 통과를 준다**: IME·붙여넣기·드래그·실제 클릭은 render seed(합성)로
  통과해도 실제로는 실패할 수 있다. 배선을 크게 건드렸다면 실 Chrome CDP 실입력으로 확인하라
  (Phase 4 에서 쓴 방식: CDP `Input.dispatchMouseEvent`/`Input.insertText` 로 실마우스·실타이핑).

---

## 5. 검증 방법

```bash
npm run test:unit
```

```bash
node --test --test-concurrency=1 "test/render/**/*.test.js"
```

기준선: 단위 **463/463**, 렌더 **91/91**, fail 0 (커밋 `f34d309`).
**이 숫자가 줄면 안 된다.** 리팩터링이 테스트를 무력화하지 않았는지 개수로 먼저 확인하라.

실브라우저 수동 확인용 편집기 기동:

```bash
node bin/worksheet-grab.js edit-ui page-id-qa --workspaces-dir .omx/manual-qa-workspaces --port 7788
```

---

## 6. 완료 정의

- 위 4개 스토리의 모든 체크박스가 실측 근거와 함께 충족
- 전체 단위 + 렌더 직렬 green, **테스트 개수 감소 없음**
- 사용자에게 보이는 동작 변화 0 — 바뀐 것은 파일 경계뿐임을 근거로 제시
- 리뷰어 승인 — Phase 3·4 때처럼 **블로커 주장을 코드/실측으로 재확인**할 것. 리뷰어가 옛 줄
  번호로 스테일 판정을 낼 수 있으니 파일을 다시 읽고 판단하라. 리뷰어가 "비블로커"로 낮춘
  항목도 지목 지점을 직접 읽어라 — Phase 4 에서 비블로커 표기 항목 하나가 실제로는 fail-closed
  우회 경로였다.
