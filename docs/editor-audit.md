# 편집기 요소 감사 (Editor Element Audit)

> 목적: "이 문서 편집기에 무엇이 들어가야 하는가"를 성숙한 오픈소스 편집기의
> **문서·스키마(사실상의 명세서)**와 worksheet-grab의 실제 구현을 1:1 대조하여
> ① 이미 있음 ② 빠졌고 필요함 ③ 활동지엔 불필요/후순위 로 분류한다.
> 남의 편집기를 "이식"하는 것이 아니라 **내 편집기를 "감사"**하는 것이 목표다
> (의존성0·manifest 단일 진실원천·fail-closed 불변식을 깨지 않는다).

## 참조 표준(무엇과 대조했나)

- **엔진 서브시스템** ← ProseMirror Guide/Reference, Lexical docs
- **요소(개체) 카탈로그** ← Editor.js block tools(blocks/inlines/tunes 3층), Tiptap extensions
- **캔버스 개체 조작 UX** ← tldraw(shape/tool/layer), moveable/selecto(drag·resize·rotate·snap·marquee)
- **인쇄/페이지드** ← CSS Paged Media, Paged.js
- **UI 아나토미/접근성** ← ARIA Authoring Practices Guide(APG)

## 검증 방법(근거)

`src/editor/*` 소스를 정규식으로 전수 스캔하고 카탈로그(`blocks/`·`schema/`)를 파싱해 확인.
주의: 1차 스캔에서 `\|`를 이스케이프해 리터럴로 처리된 오탐이 있었고, 2차에서 정상
정규식으로 재확인해 정정했다(줌·눈금자·격자·리사이즈·정렬은 **이미 존재**함).

---

## A. 엔진 서브시스템 (vs ProseMirror/Lexical) — 강점, 거의 완비

| 서브시스템 | 상태 | 근거 |
|---|---|---|
| Document model(진실원천) | ✅ | manifest + `schema/worksheet-object.schema.json` |
| Node selection(개체 선택) | ✅ | `selection.js` `selectedIds:Set` |
| Transaction/atomic op | ✅ | `applyDocOp(next,{reflow,selectId,ai})` |
| History(undo/redo) | ✅ | `history.js` — coalesce · MAX_DEPTH · redo 꼬리 폐기 |
| Decoration/overlay | ✅ | AI 미리보기 `diffToHtml` · 오버레이 핸들 |
| Serialization/export | ✅ | manifest → HTML → PDF/PNG |
| Normalization/검수 | ✅ | `runReview` 게이트 + fail-closed 정답 누출 차단 |
| Clipboard | ✅ | 개체 copy/paste + `sanitizeAiHtml` |

## B. 요소(개체) 카탈로그 (vs Editor.js / Tiptap) — 활동지 도메인엔 충분

`objectFactory.js` 기준 16종(문항 7유형 포함):

- title · question(multiple-choice · short-answer · essay · fill-blank · true-false · matching · ordering)
- table · image-slot · answer-area · richtext · shape · divider · passage-slot · std-box(학습목표)

대조 결과 의미 있는 누락은 거의 없음. 후보만:

- **수식(KaTeX) 블록** — 과학·수학 활동지용. → "필요 후보"
- code / callout(팁·주의 박스) — 선택적
- embed — 오프라인·로컬 처리 원칙과 충돌 → 제외

## C. 캔버스 개체 조작 UX (vs tldraw / moveable) — **갭이 몰린 곳**

| 조작 요소 | 상태 | 참조 |
|---|---|---|
| 리사이즈 핸들 | ✅ 있음 | canvasInline/selection |
| 정렬(align) | ✅ 있음 | inspector `onAlign` |
| 미세이동(방향키, 1/10mm) | ✅ 있음 | `nudgeSelectedFloat` |
| 줌 · 눈금자 · 격자 · 여백선 | ✅ 있음 | `viewState{margins,ruler,grid}` |
| 스냅 / 스마트 가이드 | ❌ 없음 | moveable(snap) |
| z-순서(맨앞/맨뒤) | ❌ 사실상 없음(1 ref) | tldraw layer |
| 마퀴(드래그 박스) 다중선택 | ❌ 없음(다중선택 상태는 존재) | selecto |
| 회전 | ❌ 없음 | moveable(rotate) |
| 그룹 / 잠금 | ⚠️ 부분(코드 흔적 有, 실동작 확인 필요) | tldraw group/lock |

## D. 인쇄/페이지드 (vs CSS Paged Media / Paged.js) — 님 IP, 잘 갖춰짐

- ✅ 리플로우 `reflow.js`(measure → assign → rebuild), 다중페이지, 용지/방향/단/여백
- 후순위 확장 후보: running header/footer(페이지 반복 머리말), break-before/after 개체 속성

## E. UI 아나토미/접근성 (vs ARIA APG) — 소프트 갭

- ⚠️ `aria-`/`role` 흔적은 있으나 부분적. 툴바·인스펙터·컨텍스트메뉴의
  키보드 내비게이션·포커스 관리(roving tabindex)가 APG 기준 미흡.
  교사용 단일 사용자라 우선순위 낮음(완성도 항목).

---

## 종합: "빠졌고 필요함" 우선순위

| 우선 | 항목 | 왜 | 어디서 | 아키텍처 영향 |
|---|---|---|---|---|
| 🔴 높음 | 스냅/스마트 가이드 | 부유 개체 정렬이 수작업 | moveable | manifest 불변(지오메트리만) |
| 🔴 높음 | z-순서(맨앞/맨뒤) | 겹친 float 못 바꿈 | 자체(간단) / tldraw 참조 | 개체 속성 `z` 추가 |
| 🟠 중간 | 마퀴 다중선택 | 다중 개체 편집 편의 | selecto | 선택 상태만 |
| 🟠 중간 | 수식(KaTeX) 블록 | 과학·수학 활동지 | 벤더 KaTeX | 카탈로그 1종 추가 |
| 🟡 낮음 | 회전·그룹·잠금 | 있으면 좋음 | moveable | 개체 속성 |
| ⚪ 후순위 | running header, break-before | 인쇄 정교화 | Paged Media | reflow 확장 |
| ⚪ 후순위 | APG 키보드 내비 | 접근성 완성도 | ARIA APG | UI층만 |
| ❌ 제외 | 실시간 협업 · 댓글 | 로컬 단일 사용자 철학과 충돌 | — | — |

## 결론

엔진·요소·인쇄 축은 이미 튼튼하다. 갭은 **캔버스 개체 조작 UX(C 섹션)**에 몰려 있다.
따라서 방향은 "문서편집기(TipTap 등) 통째 채택"이 아니라, **모델을 소유하지 않는
개체조작 부품(moveable/selecto)을 좁게 얹기**다. manifest·리플로우·2벌·fail-closed는
그대로 유지된다.

## 확인 필요(TODO)

- [ ] `group`/`lock` 실동작 여부 확정(코드 흔적만 확인됨)
- [ ] z-순서: 개체 스키마에 `z` 속성 추가 + 맨앞/맨뒤 버튼(자체구현, 의존성0 유지)
- [ ] 스냅 가이드: moveable 벤더링 PoC(의존성0 정책 예외 여부 결정 필요)
