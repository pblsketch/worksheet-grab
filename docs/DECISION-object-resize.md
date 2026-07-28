# 결정 기록 — 개체 크기 조정 (flow·float 공통)

> 작성일 2026-07-28 · 대상 기준선 **`948cece`**(코드는 `c0a992c` 와 동일)
> 입력 문서: `docs/HANDOFF-object-resize.md` · 함께 읽을 것: `docs/HANDOFF-object-schema.md`(원칙 3)
> **상태: 구현 완료(2026-07-28).** 격리 worktree `feat/object-resize` 에서 4커밋으로 착지.
> 실측 결과는 §9 참조 — 계획과 달랐던 지점 3건을 함께 기록했다.

---

## 0. 왜 지금 이 문서만 있는가

착수 시점에 작업 트리가 핸드오프 §6 게이트를 만족하지 않았다.

- 다른 세션이 **동시에** 이 저장소를 편집 중이었다(수정 파일 3 → 4 → 9개로 3분 새 증가).
  그 작업은 크기 조정과 무관한 별개 기능 묶음이다(지문 박스 색, `std-box.heading`/`showStandards`,
  `.wg-part` 인라인 편집, 이미지 슬롯 플레이스홀더, 연결형 점 위치).
- 그 결과 `npm run test:unit` 이 **실패 중**이라 "단위 642 · 렌더 102 · fail 0" 기준선을 잡을 수 없었다.
  (예: `test/unit/render-object-tree.test.js:146` 이 `class="std-box std-ref"` 를 기대하는데
  WIP 가 `showStandards` 기본값을 `false` 로 바꿔 그 박스가 방출되지 않는다.)
- 겹치는 파일이 5개다 — `ObjectCatalog.js` · `RenderObjectTree.js` · `worksheet-object.schema.json` ·
  `inspector.js` · `editorStyle.js`. 전부 핸드오프 §4 가 크기 조정 때 고치라고 지목한 파일이다.

그래서 **공유 소스를 건드리지 않고 설계 결정만** 먼저 확정했다(사용자 선택). 조사는 더러운 작업본이
아니라 `git show HEAD:` 로 꺼낸 기준선 사본을 읽어서 했다 — 나중에 실제로 착수할 코드와 같은 것을 봐야 하므로.

---

## 1. 결정 — **A안 채택**: `widthPct` + `minHeightMm`

| 안 | 판정 |
|---|---|
| **A. `widthPct` + `minHeightMm`** | **채택** |
| B. `widthMm` + `minHeightMm` | 기각 |
| C. flow 에 `rect` 허용 | 기각 |

### 1.1 C안을 기각하는 이유

원칙 3 이전에 **구조가 성립하지 않는다.** flow 개체는 `.sheet-body`(다단 컨테이너) 안의 정상 흐름
블록이다. `rect` 는 `position:absolute; left/top` 으로만 의미를 갖는데(`RenderObjectTree.js:144`),
absolute 로 빼는 순간 그 개체는 흐름에서 빠져 **리플로우 대상이 아니게 된다** — `assignFlowToPages`
가 높이 0으로 보고 페이지 경계 계산에서 사라진다. "본문 배치인데 좌표를 갖는다"는 상태 자체가
모순이다. 원칙 3 위반은 그 위에 얹히는 두 번째 이유일 뿐이다.

### 1.2 A안이 B안을 이기는 이유 — `.sheet` 는 mm 고정이고 `.sheet-body` 는 다단이다

```css
/* assets/paper.css:17 */  .sheet { width: var(--sheet-w, 210mm); … }
/* assets/paper.css:40 */  .sheet-body { column-count: var(--sheet-cols, 1); column-gap: var(--sheet-colgap, 8mm); }
```

flow 개체의 포함 블록은 `.sheet-body` 의 **열(column) 폭**이다. 따라서:

- **%는 "본문 폭 대비"가 정확히 그 뜻이 된다.** 1단이면 지면 본문 폭, 2단이면 열 폭 — 교사가
  화면에서 보는 "가로로 얼마나 차지하는가"와 1:1로 맞는다.
- **mm 는 용지·단 수를 바꾸는 순간 깨진다.** A4 1단에서 잡은 `widthMm:150` 은 2단(열 폭 ≈ 91mm)
  으로 바꾸면 열을 넘겨 삐져나온다. B안의 "클램프 규칙 필요"가 바로 이것인데, 클램프는 값을 **조용히
  잘라먹는** 복원 불가능한 손실이다(교사가 다시 1단으로 되돌려도 150 은 이미 91 로 덮여 있다).
  %는 클램프가 필요 없다 — `60%` 는 어느 폭에서도 유효하다.
- R2-1 관점에서는 둘 다 안전하다. `.sheet` 가 뷰포트가 아니라 **mm 고정**이므로, 측정 iframe
  (`reflow.js` 1200px)과 Chrome 측정(`--window-size=1200,1600`)과 실제 인쇄가 전부 같은 폭을 본다.
  즉 이 축은 결정 근거가 되지 못하고, 위의 용지·다단 강건성이 결정한다.

**교사 직관(mm) 문제는 UI 로 흡수한다** — 저장은 %, 인스펙터는 % 입력 옆에 환산 mm 를 보조 표시.
드래그 손잡이가 있으므로 실제 조작은 직접 조작이 주 경로이고 숫자는 미세 조정용이다.

### 1.3 왜 `height` 가 아니라 `minHeight` 인가

flow 개체의 높이는 내용이 정한다. 고정 `height` 를 주면 내용이 넘칠 때 잘리거나 삐져나온다 —
그리고 그 넘침은 **측정에 잡히지 않아** 페이지 경계가 조용히 어긋난다(R2-1 붕괴). `min-height` 는
"최소한 이만큼"이라 내용이 늘면 따라 늘고, 측정도 항상 실제 점유 높이를 낸다.

순수 여백만 필요하면 `spacer` 타입이 이미 있다(2026-07-28 신설) — 중복 어휘가 아니다.

### 1.4 원칙 3 과의 관계 (기록으로 남기는 판단)

**크기는 좌표가 아니다.** 원칙 3 이 막는 것은 *AI 가 지면 위 위치를 지어내는 것*이다. `widthPct` 는
위치를 말하지 않는다 — 흐름 안에서의 상대 폭만 말한다. 개체를 어디에 놓을지는 여전히 **흐름 순서**가
정하고, 페이지 경계는 여전히 `assignFlowToPages` 혼자 정한다(D-A 무접촉).

다만 **AI 저작 어휘에서는 제외한다.** `spacer`/`page-break` 를 편집기 전용으로 둔 것과 같은 이유다 —
AI 가 "이 표는 60%" 같은 판단을 할 근거가 없고, 하게 두면 원칙 3 의 정신(구조만 저작)이 사문화된다.
→ **designer 에이전트 프롬프트/스킬 문서에 이 두 필드를 넣지 않는다.**

---

## 2. R2-1 을 지키는 구조 — 핸드오프가 놓친 함정 1건

### 2.1 `.wg-obj` 래퍼는 **편집 모드에서만 존재한다**

```js
// src/usecases/RenderObjectTree.js:134-139 (기준선)
function renderFlowObject(obj, ctx) {
  const inner = renderAnswerWrap(obj, renderByType(obj, ctx));
  if (!ctx.editMode) return inner;            // ← 인쇄에는 래퍼가 아예 없다
  return `<div class="wg-obj" data-oid="…" data-ot="…">${inner}</div>`;
}
```

핸드오프 §4 는 "flow/float 래퍼에 인라인 style 방출"이라고만 적었다. 그대로 `.wg-obj` 에 폭을 얹으면
**편집에만 적용되고 인쇄에는 빠진다** — R2-1 이 정확히 이 지점에서 무너진다. 편집 전용 CSS 를 피하라는
경고는 지켰는데도 같은 결과가 나오는, 더 은밀한 경로다.

### 2.2 해법 — 래퍼 방출 조건을 `editMode` 에서 **`editMode || 크기 있음`** 으로

```js
function renderFlowObject(obj, ctx) {
  const inner = renderAnswerWrap(obj, renderByType(obj, ctx));
  const boxStyle = flowBoxStyle(obj);            // '' | width / min-height / margin-inline 조합
  if (!ctx.editMode && !boxStyle) return inner;  // 선언 없는 개체의 인쇄 출력은 기준선과 바이트 동일
  const oid = ctx.editMode ? ` data-oid="…" data-ot="…"` : '';
  const style = boxStyle ? ` style="${boxStyle}"` : '';
  return `<div class="wg-obj"${oid}${style}>${inner}</div>`;
}
```

이 형태가 갖는 성질:

1. **크기를 안 준 개체는 인쇄 출력이 지금과 바이트 단위로 같다** → 기존 렌더 테스트 회귀 0.
2. **크기를 준 개체는 편집·인쇄가 같은 래퍼·같은 선언**을 갖는다 → R2-1 이 *구조적으로* 성립한다.
   "양쪽에 잊지 않고 넣었나"를 사람이 지킬 필요가 없다.
3. **`.wg-obj` 를 클래스로 겨냥하는 CSS 규칙이 저장소 전체에 하나도 없다**(`--include=*.css` 전수
   grep 0건 — JS 의 `querySelector` 참조만 존재). `.wg-obj` 에 실제로 걸리는 규칙은 `editorStyle.js`
   의 속성 선택자 `[data-oid] { cursor:pointer }` 와 `.wg-selected { outline }` 뿐인데 둘 다
   **레이아웃 박스를 바꾸지 않고**, 애초에 인쇄에는 주입되지 않는다.
   따라서 인라인 선언이 유일한 크기 출처이고 편집 전용 CSS 와 경합하지 않는다.

### 2.3 왜 이 방식이 실제로 "표 크기 조절"을 해결하는가

```css
/* assets/paper.css:63 */  table { border-collapse: collapse; width: 100%; }
```

표는 포함 블록을 100% 채운다. 60% 래퍼 안에 들어가면 표가 60%가 된다 — 교사가 요구한 "표 자체의
폭"이 별도 표 전용 코드 없이 나온다. `tableEdit.js` 의 열 너비 조정은 그대로 남아 **표 안 비율**을
담당하고, 새 `widthPct` 는 **표 전체 폭**을 담당한다. 두 수단이 겹치지 않고 층이 갈린다.

---

## 3. 핸드오프 §3 "두 측정 경로의 대칭" — 정정

핸드오프는 `reflow.js`(브라우저)와 `PaginateObjectTree.js`(Chrome) 양쪽에 대칭으로 손대라고 적었다.
**이번 과제에서는 그 손댐이 불필요하다.** 두 곳의 `items` 구성은 이렇다:

```js
// src/editor/reflow.js:157  /  src/usecases/PaginateObjectTree.js:188 — 문자 그대로 동일
const items = flatFlow.map((obj) => ({ id: obj.id, heightPx: heights?.[obj.id] ?? 0, breakBefore: obj.type === 'page-break' }));
```

`heightPx` 는 **렌더된 DOM 을 실측한 값**이다. 크기 선언이 렌더 출력(§2.2)에 들어가면 두 경로 모두
자동으로 그 값을 잰다. `breakBefore` 가 양쪽에 명시적으로 필요했던 이유는 그것이 **DOM 에서 유도할 수
없는 의미 플래그**이기 때문인데, 크기는 정반대로 DOM 에 물리적으로 나타난다.

→ **`items` 두 곳은 무변경.** 대신 §5 의 파리티 렌더 테스트로 이 자동 대칭이 실제로 성립하는지 확인한다
(코드를 안 고쳤다는 것이 동치의 증거는 아니다).

---

## 4. flow 리사이즈 손잡이 — 핸드오프 §4 정정

핸드오프는 "`refreshResizeHandles` 가 `.wg-float` 만 순회한다 → flow 로 확장"이라고 적었다.
**그대로 확장하면 안 된다.** float 의 손잡이는 `.wg-float` **안에** 자식으로 들어가는데
(`selection.js:174` `el.appendChild(h)`), flow 에 같은 짓을 하면 저장소가 명시적으로 금지한 패턴이 된다:

```js
// src/editor/canvasInline.js:7-9
// 핸들/삽입 버튼은 `.wg-obj` **안**이 아니라 `.sheet` 에 딸린 별도 오버레이 레이어에 절대좌표로
// [배치한다] … `.wg-obj` 자신이 contenteditable 대상이 되므로, 그 안에 자식을 넣으면 selection.js 의
// [readField 가 오염된다]
```

`selection.js:104-120` 이 필드를 읽을 때 `.wg-float-handle, .wg-resize-handle` 을 복제본에서 제거하는
방어 코드를 갖고 있는 것이 그 오염의 흔적이다 — float 은 그 방어로 버티는 중이고, flow 는 애초에
오버레이 규약으로 그 문제를 피해 왔다.

→ **flow 손잡이는 `canvasInline.js` 의 오버레이 레이어에 만든다**(`.wg-flow-handle`/`.wg-flow-insert`
와 같은 층). 부수 효과로 `.wg-obj` 에 `position:relative` 를 줄 필요가 없어져, `editorStyle.js` 의
"레이아웃 박스를 바꾸지 않는다" 규약을 건드리지 않는다.

**손잡이 개수:** flow 는 8방향이 아니라 **3개**로 한다 — `e`(우측: 폭), `s`(하단: 최소 높이),
`se`(둘 다). 좌/상 방향은 좌표가 없는 flow 에서 의미가 없다(왼쪽으로 끌어도 개체는 흐름 시작점에
붙어 있다 — 끌면 폭이 줄 뿐인데 손잡이가 따라오지 않아 조작감이 어긋난다).

---

## 5. 구현 계획

착수 전제: **작업 트리가 깨끗하고 `npm run test:unit` / `npm run test:render` 가 초록**일 것
(핸드오프 §6). 지금은 성립하지 않으므로 다른 세션 작업이 착지한 뒤 다시 측정해서 시작한다.

### Phase 0 — 게이트 재확인
```bash
git status --porcelain            # 비어 있어야 한다
npm run test:unit                 # 기준 개수 기록(핸드오프는 642, 동시 작업이 바꿨을 수 있음)
node -e "import('./test/helpers/tmp.js').then(m=>m.sweepStaleWsgTmp(0))"
npm run test:render               # 기준 개수 기록(핸드오프는 102)
```
> 핸드오프의 642/102 를 그대로 신뢰하지 않는다 — 동시 진행된 기능이 테스트를 추가/변경했다면
> 기준선 숫자 자체가 이동했다. **그때 실측한 값**을 기준선으로 삼고 문서에 갱신한다.

### Phase 1 — 스키마 (순수, UI 없음)
| 파일 | 변경 |
|---|---|
| `src/domain/schema/ObjectCatalog.js` | `SIZE_FIELDS = ['widthPct','minHeightMm','align']` 신설. `ALWAYS_ALLOWED_FIELDS` 가 아니라 **타입별 `optional`** 에 추가 — 크기가 의미 없는 타입(`page-break`, `divider`, `spacer`)에는 주지 않는다. `spacer` 는 이미 `heightMm` 가 있어 `minHeightMm` 와 중복이다. |
| `validateObjectShape.js` | 새 규칙 `size-forbidden-in-float` — float 은 `rect` 가 크기를 이미 갖는다(한 가지 일에 두 수단 금지). 값 검증: `widthPct` 는 `5~100` 유한수, `minHeightMm` 는 `0 초과` 유한수, `align` 은 `left|center|right`. **`rect-forbidden-in-flow` 는 무변경.** |
| `schema/worksheet-object.schema.json` | 위와 1:1(`object-schema.test.js` 가 발산을 즉시 잡는다). |

검증: 신규 단위 테스트 — 허용 타입 통과 / `page-break` 거부 / float 거부 / 범위 밖 값 거부.

### Phase 2 — 렌더 (R2-1 핵심)
| 파일 | 변경 |
|---|---|
| `src/usecases/RenderObjectTree.js` | `flowSizeStyle(obj)` 순수 헬퍼 + `renderFlowObject` 방출 조건 변경(§2.2). `renderSpacer` 의 주석 규약을 그대로 따른다. |

검증: 단위 — ① 크기 없는 개체는 `editMode:false` 출력이 기준선과 **문자열 동일** ② 크기 있는 개체는
`editMode` true/false 두 출력의 래퍼 `style` 이 **동일** ③ `%`/`mm` 단위가 붙는지.

### Phase 3 — 편집 UI
| 파일 | 변경 |
|---|---|
| `src/editor/objectFactory.js` | `resizeFlow(document, id, {widthPct, minHeightMm})` 순수 함수 — 범위 클램프를 여기 한 곳에 둔다(`toggleFlowFloat` 이 rect 삭제 계약을 순수 함수 안에 둔 선례와 동형). |
| `src/editor/canvasInline.js` | flow 3방향 오버레이 손잡이 + 드래그. 드래그 중엔 DOM 에 직접 `style.width` 를 써서 즉시 반응시키고, 드롭에서만 `applyDocOp` 관문으로 문서를 바꾼다(`startFloatResize` 의 즉시반영 패턴 동형). |
| `src/editor/editorStyle.js` | 손잡이 **모양만**. `outline`/`position:absolute` 오버레이 외 금지 — 크기는 절대 여기 두지 않는다. |
| `src/editor/inspector.js` | flow 전용 크기 필드(% 입력 + 환산 mm 보조표시 + "원래대로" 버튼). float 의 X/Y/W/H 그리드는 무변경. |

### Phase 4 — 검증 (실제로)
1. **파리티 렌더 테스트 신규** — `test/render/editor-print-parity.render.test.js` 에 케이스 추가:
   `widthPct`/`minHeightMm` 를 준 개체를 섞어 페이지를 거의 채우는 문서로, 편집기 리플로우
   페이지 귀속 == Chrome 측정 페이지 귀속 == 실제 인쇄 페이지 수. 기존 2개 케이스와 같은 골격
   (`computeEditorPagination` / `computeChromePagination` / `countPrintedPages`)을 재사용한다.
2. **CDP 실마우스 프로브** — 손잡이 드래그는 합성 이벤트로 검증하지 않는다(핸드오프 §5-1).
   `scratchpad/ultraqa/harness.mjs` 로 실제 pointer 이동. 줌은 100% 로 고정한다
   (`rectOf` 가 `#stage` 의 `transform:scale` 을 보정하지 않는다 — §5-2).
3. **기준선 유지** — Phase 0 에서 실측한 개수 이상, fail 0. 렌더는 직렬(`npm run test:render`).
   실행 전후 `sweepStaleWsgTmp()`.

### Phase 5 — 문서
`CLAUDE.md` 변경 이력 1행 + `docs/HANDOFF-object-schema.md` 카탈로그 필드 갱신 + 이 문서에 실측 결과 추가.

---

## 6. 열린 결정 2건 — **확정됨**(사용자 승인 2026-07-28)

1. **`align` 을 이번에 포함한다.** ✅
   `align:'left'|'center'|'right'` 를 크기 필드와 함께 넣는다. 렌더는 `margin-inline` 으로만 낸다
   (`center` → `auto auto`, `right` → `auto 0`, `left` → 선언 생략 = 기본값). **높이에 영향이 없어
   R2-1 위험이 0**이고, 폭을 줄인 표가 왼쪽에 붙어 있는 것은 곧바로 아쉬워질 자리였다.
   - `widthPct` 가 없으면(=100% 폭) `align` 은 시각적 효과가 없다 → 인스펙터에서 폭을 줄이기 전까지
     비활성 표시.
   - 크기 필드와 **같은 인라인 style 선언에 실린다** — 즉 §2.2 의 방출 조건(`editMode || 선언있음`)
     판정에 `align` 도 포함해야 한다. `align` 만 주고 폭을 안 준 개체도 인쇄에 래퍼가 필요하다.
2. **AI 저작 어휘에서 제외한다.** ✅
   `spacer`/`page-break` 와 같이 **편집기 전용 필드**로 둔다 — `worksheet-designer` 에이전트 프롬프트와
   `worksheet-design` 스킬의 카탈로그 어휘에 `widthPct`/`minHeightMm`/`align` 을 넣지 않는다.
   AI 가 폭을 정하게 하려면 별도 결정이 필요하다(원칙 3 의 정신: AI 는 구조만 저작).

---

## 7. 이 과제에서 하지 않는 것

핸드오프 §8 을 그대로 승계한다 — 선행 결함 2건(⠿ 가 `+` 버튼에 덮임, 미선택 float 손잡이 무반응),
`shape` 클릭 가로채기, 회전 개체 OBB 겹침, 회전 후 손잡이 각도 보정. 여기에 하나 추가:

- **다단 문서의 열 간 높이 재배분** — `reflow.js:25-27` 이 기록한 기존 한계다. `widthPct` 는 열 폭
  기준으로 동작하므로 이 한계를 악화시키지 않지만, 해소하지도 않는다.

---

## 9. 실측 결과 (2026-07-28 구현 완료)

격리 worktree(`E:/github/wsg-resize-wt`, 브랜치 `feat/object-resize`)에서 진행했다 — main 트리를
다른 세션이 동시에 쓰고 있어 기준선 측정이 불가능했기 때문이다(`docs/CONCURRENT-SESSIONS.md`).

### 커밋

| 커밋 | 내용 |
|---|---|
| `495f3e8` | 스키마 — `SIZE_FIELDS` 3종 · 검증 규칙 2종 · JSON 스키마 1:1 (main 에 직접) |
| `9dd9efa` | 렌더 — 인라인 방출, 방출 조건 `editMode \|\| 선언있음` |
| `c54aa22` | `resizeFlow` — 클램프 단일 관문(순수) |
| `d3996fb` | 편집 UI — 오버레이 손잡이 3방향 + 인스펙터 |

### 테스트

| | 착수 기준선 | 완료 | 증분 |
|---|---|---|---|
| 단위 | 670 | **694** | +24 (스키마 10 · 렌더 11 · resizeFlow 13 중 신규분) |
| 렌더 | 111 | **118** | +7 (파리티 크기 1 · 실입력 6) |
| fail / skip | 0 / 0 | **0 / 0** | — |

> 핸드오프가 적어 둔 642/102 는 쓰지 않았다 — 동시 진행된 다른 작업이 테스트를 추가해 기준선이
> 이미 이동해 있었다. 격리 트리에서 **다시 실측한 670/111** 을 기준으로 삼았다(`worksheets/`
> 픽스처를 복사해 skip 0 상태로 측정 — 그래야 main 트리와 숫자가 직접 비교된다).

### 계획과 달랐던 것 3건

1. **`.wg-obj` 래퍼가 editMode 전용이었다(§2.1).** 핸드오프의 "래퍼에 인라인 style 방출"을 그대로
   따랐다면 인쇄에서 크기가 빠져 R2-1 이 깨졌다. 방출 조건 자체를 바꿔야 했다.
2. **파리티 대조가 이 결함을 못 잡는다.** 변이 실험(방출 조건을 옛 형태로 되돌림)에서 기존 파리티
   2건은 **둘 다 통과**했다. 두 측정 경로가 모두 `editMode:true` 로 렌더하기 때문이다 — 편집에만
   반영되는 결함은 서로 일치해 버린다. 공허한 통과 방지로 넣은 "인쇄 HTML 에 선언이 있는가" 단정이
   실제 검출기였다. 이 하네스의 구조적 한계이므로 다음 사람을 위해 테스트 주석에 남겼다.
3. **선택 변경 시 오버레이가 갱신되지 않았다.** `refreshDecoration` 이 문서 변경·리플로우·뷰 토글에만
   걸려 있었다(종전 오버레이 내용물은 선택과 무관했으므로). 크기 손잡이가 **아예 뜨지 않았고**,
   합성 이벤트로는 잡히지 않는 부류였다 — 실마우스 테스트로만 드러났다.

### 초안에서 바로잡은 판단 1건

`divider` 를 크기 대상에서 제외한다고 적었으나 **포함**으로 바꿨다. 폭을 줄여 가운데 정렬한 짧은
구분선은 실제로 쓰이는 조판 요소다 — `spacer`(이미 heightMm 소유)·`page-break`(높이 0 표식)와
같은 부류로 묶은 것이 잘못이었다.

### 열린 결정 이행 확인

- `align` 포함 ✅ — `margin-inline` 으로만 방출(높이 무영향). 인스펙터에서 폭이 100%면 비활성.
- AI 저작 어휘 제외 ✅ — `worksheet-designer.md` · `worksheet-design/SKILL.md` 에 명시.
- **% 선택의 대가였던 "mm 환산 UI"** ✅ — 인스펙터가 `본문 폭 NNNmm 기준 약 NNmm` 를 함께 보인다
  (용지·단 수에서 열 폭을 계산). %로 저장해 용지를 바꿔도 비율이 유지되면서 교사는 mm 로 감을 잡는다.

### 남은 것

- **파리티 하네스 보강(권고)** — §9-2 의 한계는 크기 조정만의 문제가 아니다. 편집·인쇄 양쪽에
  들어가야 하는 선언을 새로 추가할 때마다 같은 맹점이 생긴다. 인쇄 출력 직접 단정을 파리티
  테스트의 기본 골격으로 올리는 것을 검토할 만하다.
- 범위 밖으로 둔 것은 §7 그대로(선행 결함 2건 · shape 클릭 가로채기 · 회전 OBB · 다단 열 재배분).
