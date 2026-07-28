# 편집기 결함 대장 — 2026-07-28

기준 커밋 `6723312` · 격리 워크트리 `feat/editor-ux-qa` · 문서 `worksheets/편집기검증0728`.
> 아래 `scratchpad/probeNN` 은 조사에 쓴 일회용 프로브다(gitignore 대상 — 재현 절차는 이 문서와
> `test/render/editor-edit-guard.render.test.js` 에 남겼으므로 프로브 자체는 보존하지 않는다).
**확증**은 실 Chrome + CDP **실 마우스·실 키보드**로 재현한 것만 붙인다(합성 이벤트 아님).
출처 `실측` = 이 세션의 프로브, `codex` = 독립 교차 리뷰(코드 근거), `codex+실측` = 지적을 받아 내가 재현.

---

## A. 고친 것 — 확증 → 수정 → 실입력 재검증 → 변이 실험 통과

> 회귀 테스트: `test/render/editor-edit-guard.render.test.js`(신규 6건 — 실 Chrome 실마우스·실키보드,
> 마퀴 대조군 포함) + `test/unit/save-controller.test.js`(신규 3건).
> **테스트가 결함을 실제로 잡는지 확인**: D1~D4 는 수정을 하나씩 되돌리는 변이 실험으로 전부 빨간불을
> 확인했고, D5 는 수정 **전에** 테스트를 먼저 세워 실패(`'A' !== 'B'`)를 본 뒤 고쳐 초록으로 만들었다.

### D1 [P0] 표 셀·조각 편집 중 Backspace/Delete 가 **개체 전체를 삭제**한다 (codex+실측)
- 재현: 표 셀을 더블클릭해 편집 상태에서 Backspace 1회 → **표 4개 → 3개**(편집하던 표가 통째로 사라짐).
  학습목표 문장(`.wg-part`)에서도 동일 → **개체 24 → 23, `std-box` 1 → 0**.
- 원인: `tableEdit.js`/`partEdit.js` 는 자기 지역 상태(`editingCell`/`editingEl`)만 세우고 공통
  `selection.state.editingId` 를 세우지 않는다. `shortcuts.js` 의 "입력 중인가" 판정은 실제 이벤트
  대상이 아니라 **부모 문서의 `activeElement`** 를 보므로 iframe 안 contenteditable 을 못 본다
  → 삭제 단축키가 그대로 통과한다.
- 영향: 교사가 글자 하나 지우려다 표/학습목표 박스를 잃는다. 되돌리기가 있어도 데이터 파괴적.

### D2 [P1] flow 크기 손잡이를 끌면 **마퀴 선택이 같이 돌아** 드롭 순간 선택이 해제된다 (실측)
- 재현: 개체 클릭(손잡이 3개 표시) → se 손잡이 드래그 → 크기는 바뀌지만 `.wg-selected` 0개,
  손잡이 0개. 연속 조정이 불가능하고 "크기 원래대로"도 누를 수 없다.
- 원인: `selection.js:720-733` 의 pointerdown 이 `.wg-size-handle`(오버레이라 `[data-oid]` 밖)을
  **빈 배경**으로 판정해 마퀴를 시작한다. 드롭에서 `finishMarquee` 가
  `state.selectedIds = new Set(hits)` 를 실행하는데 문서에 float 이 없으면 `hits = []` → 선택 증발.
  `canvasInline.js:362` 의 `stopPropagation()` 은 무력하다 — 두 리스너가 **같은 `doc` 노드**에 달려
  있어 전파 중단이 형제 리스너를 막지 못한다.

### D3 [P1] 드래그 뒤 **다음 클릭 한 번이 통째로 먹힌다** (실측)
- 재현: 개체 본체 드래그로 재정렬 → 다른 개체 클릭 → 선택 안 바뀜 → **한 번 더 클릭해야** 바뀐다.
  크기조정 뒤에도 같다.
- 원인: 드래그 종료 시 `swallowNextClick = true` 로 무장하는데(`selection.js:446,593,713`),
  계측 결과 **드래그 뒤 click 이벤트가 아예 오지 않는다**(pointerdown 대상이 재장식으로 DOM 에서
  떨어져 나가 브라우저가 click 을 만들지 않는다). 소비되지 못한 플래그가 남아 사용자의 다음
  진짜 클릭을 먹는다. 이벤트 로그 근거: 드래그 구간에 `pointerdown`/`pointerup` 만 있고 `click` 0건.

### D4 [P2] 불가능한 **'자유 배치로 전환'** 이 활성 버튼으로 노출되고 눌러도 조용히 무동작 (codex+실측)
- 재현: 제목 개체 선택 → 인스펙터 "자유 배치로 전환" (enabled) 클릭 → `.wg-float` 0개, 클래스 불변,
  인스펙터 문구도 그대로. 아무 피드백이 없다.
- 원인: `title`·`std-box`·`page-break` 는 `TYPE_SPECS.placements` 가 flow 전용인데 UI 가 그 계약을
  보지 않는다(`contextToolbar.js:178-195`, `inspector.js:195-206`).

### D5 [P0] 저장 왕복 중 입력한 편집이 **응답 도착 순간 유실**된다 (codex+실측)
- 재현: 저장(수 초 — 서버가 재렌더한다) 중에 계속 입력한다. 응답이 오면 화면·모델이 **요청 시점
  문서로 되돌아가고** `dirty` 까지 내려가 뒤이은 자동저장도 그 유실을 되돌리지 못한다.
  내 단위 재현: 왕복 중 문서를 A→B 로 바꾸고 응답을 풀면 `'A' !== 'B'` 로 실패(수정 전).
- 원인: `saveController.save()` 가 응답의 `result.document` 를 **무조건** `setDocument` 한 뒤
  `dirty=false` 로 만들고 자동저장 타이머까지 지운다. 요청 식별자도, 시작 이후 변경 여부 검사도 없다.

### 수정 요약
| # | 파일 | 한 일 |
|---|---|---|
| D1 | `src/editor/shortcuts.js` | `isTypingContext(e)` 가 **이벤트 대상**을 먼저 본다 — 부모 `activeElement` 만 보던 판정은 캐럿이 iframe 안에 있을 때 늘 false 였다 |
| D2 | `src/editor/selection.js` | pointerdown 이 `.wg-flow-overlay` 안이면 즉시 양보 — 오버레이 컨트롤은 자기 드래그를 갖는다 |
| D3 | `src/editor/selection.js` | 새 pointerdown 마다 `swallowNextClick` 무장 해제 — click 은 항상 다음 pointerdown 보다 먼저 오므로 정상 경로는 무손상 |
| D4 | `src/domain/schema/ObjectCatalog.js` · `inspector.js` · `contextToolbar.js` | `PLACEMENT_TOGGLEABLE_TYPES`(두 배치 다 지원하는 타입) 파생 상수를 신설해 UI 두 곳이 같은 계약을 본다 |
| D5 | `src/editor/saveController.js` | `editSeq`(markDirty 마다 증가)를 요청 시점과 대조 — 왕복 중 편집이 있었으면 서버 문서를 채택하지 않고 dirty 를 유지한다. 배너도 "저장하는 동안 수정한 내용은 아직 저장 전"이라고 밝힌다 |

---

## B. 보고만 — codex 지적, 내가 아직 재현하지 못함

| # | 심각도 | 요약 | 상태 |
|---|---|---|---|
| C2 | P1 | 저장 실패를 무시하고 용지·테마 변경·PNG·PDF 가 진행 | 미검증 |
| C5 | P1 | flow 없는 다쪽 float 문서가 편집 후 1쪽으로 축소 | codex 순수 프로브 재현 |
| C6 | P1 | float 을 '내 블록'으로 저장하면 `⠿`·리사이즈 손잡이 DOM 이 인쇄물에 섞임 | **전제 확인됨** — float 자식에 `wg-float-handle` + `wg-resize-handle` 8개 실재 |
| C7 | P1 | 병합된 셀 재병합 시 colspan/rowspan 붕괴 | 미검증 |
| C4 | P1 | 타이핑 직후 명령이 한 undo 단계로 병합 | 미검증 |
| C8~C15 | P2 | 편집 중 리플로우가 캐럿·편집상태를 끊음 · 모드 토글 경합 · 검수 칩/썸네일 미갱신 · 제목 undo 미반영 · 빈 페이지로 드래그 불가 · 프리셋 실패 은폐 | 미검증 |

## C. 관측했으나 결함 아님
- 되돌리기 단계 수: 삭제·재정렬·크기조정·붙여넣기 모두 **정확히 1단계** ✓
- 붙여넣기 위치(선택 개체 바로 뒤) ✓ · 페이지 추가 ✓ · 학생/교사 물리 2벌 ✓
- 줌 0.5~1.6 클램프, 어느 배율에서도 캔버스 잘림 없음 ✓
- 로드~전 조작에서 콘솔 오류 **0건** ✓
