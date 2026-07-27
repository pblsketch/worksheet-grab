# HANDOFF — 개체 크기 조정 (flow·float 공통)

> 이 문서만 읽어도 새 세션에서 바로 착수할 수 있도록 자기완결적으로 작성됨.
> 작성일 2026-07-28 · 기준 커밋 **`c0a992c`** (main)
> 함께 읽을 것: `docs/HANDOFF-object-schema.md`(카탈로그·원칙 3), `docs/PLAN.md` §4(레이어)

---

## 0. 한 줄 요약

교사가 **개체의 가로·세로 크기를 직접 조절**하게 한다. 지금은 자유 배치(float)만 되고 본문
배치(flow)는 전혀 안 된다. flow 에 `rect`(좌표)를 줄 수는 없으므로(원칙 3), **좌표가 아닌
크기 필드**를 새로 정의해야 한다 — 그래서 이건 UI 추가가 아니라 **스키마 결정**이 먼저인 과제다.

---

## 1. 지금 되는 것 / 안 되는 것 (실측)

| 대상 | 가로 | 세로 | 근거 |
|---|---|---|---|
| **float** | 8방향 손잡이 + 인스펙터 W/H | 동일 | `selection.js` `refreshResizeHandles`(`.wg-float` 만 순회) · `startFloatResize` · `inspector.js` 의 X/Y/W/H 그리드(`obj.placement === 'float' && obj.rect` 조건) |
| **flow** | **없음** | **없음** | `.wg-obj` 는 폭 관련 CSS 가 **하나도 없는** 블록 div — 단(column) 폭을 그대로 채운다(grep 확인) |
| 표(flow·float 공통) | **열 너비만** 가능 | 없음 | `tableEdit.js` `decorateColumnHandles` — 표를 **선택해야** 열 경계에 손잡이가 뜬다. 표 전체 크기가 아니라 열 비율만 바꾼다 |

교사가 "표 크기를 못 바꾼다"고 느끼는 지점이 정확히 여기다 — 열 비율은 되는데 그 사실이 잘
드러나지 않고, 표 자체의 폭·높이는 아예 수단이 없다.

---

## 2. 핵심 설계 질문 — 왜 그냥 rect 를 주면 안 되는가

`placement:'flow'` 개체는 **rect 를 가질 수 없다.** 스키마가 `rect-forbidden-in-flow` 로 거부한다
(`src/domain/schema/validateObjectShape.js`). 원칙 3("AI 는 좌표를 만들지 않는다")의 구현이다.

**그러나 크기는 좌표가 아니다.** 원칙 3 이 막는 것은 *AI 가 위치를 지어내는 것*이지 *교사가 폭을
줄이는 것*이 아니다. 그래서 rect 와 분리된 크기 필드는 원칙과 충돌하지 않는다 — 다만 그 판단을
**명시적으로 기록하고 스키마에 반영**해야 한다(이 과제의 첫 산출물).

**선례가 있다.** `opacity`·`angle` 은 `ALWAYS_ALLOWED_FIELDS`(`validateObjectShape.js`)로 전 타입
허용되고 렌더에서만 float 에 적용된다. 크기도 같은 패턴을 쓸 수 있다 — 단 flow 에도 적용된다는
점이 다르다.

### 후보 필드 (택일 또는 조합 — 결정 필요)

| 안 | 필드 | 장점 | 함정 |
|---|---|---|---|
| **A** | `widthPct`(본문 폭 대비 %) + `minHeightMm` | 단 폭이 바뀌어도(용지·다단 변경) 비율이 유지된다. 인쇄 안전 | 픽셀 단위 정밀 조절 불가 |
| **B** | `widthMm` + `minHeightMm` | 교사가 mm 로 직관 조절 | 용지/다단을 바꾸면 본문 폭을 넘길 수 있다 — 클램프 규칙 필요 |
| **C** | float 처럼 `rect` 허용 | 구현 최소 | **원칙 3 위반** · flow 의 "좌표 없음" 불변식 붕괴 → 기각 권장 |

> `minHeight` 인 이유: flow 개체의 높이는 내용이 정한다. 고정 `height` 를 주면 내용이 잘리거나
> 넘친다. "최소 높이"는 빈 여백을 확보하면서 내용이 늘면 따라 늘어난다.
> (내용 없이 순수 여백만 필요하면 이미 `spacer` 타입이 있다 — 2026-07-28 신설.)

---

## 3. 반드시 지켜야 할 것 (깨면 조용히 인쇄가 어긋난다)

### R2-1 — 편집 == 인쇄 하드 동치 (**이 과제의 최대 위험**)

리플로우는 편집기 iframe 에서 **실제 DOM 높이를 재서** 페이지 경계를 정한다
(`src/editor/reflow.js` `measureFlow` → `assignFlowToPages`). 그 측정값이 인쇄와 같으려면
**크기 선언이 편집·인쇄 양쪽에 동일하게 들어가야 한다.**

- ✅ 옳은 방법: `RenderObjectTree` 가 **인라인 style 로 방출**한다. 편집 렌더와 인쇄 렌더가 같은
  함수를 쓰므로 자동으로 같아진다. (`spacer.heightMm` 이 정확히 이 패턴 — 참고 구현)
- ❌ 틀린 방법: `editorStyle.js`(편집 전용 CSS)에 크기를 준다. 측정은 그 값을 보고 인쇄는 못 봐서
  페이지 수가 갈린다. `editorStyle.js` 상단 규약에 "margin/padding/width 를 쓰지 않는다"가 명문화돼
  있는 이유가 이것이다.

**검증 수단:** `test/render/editor-print-parity.render.test.js` 가 이미 있다. 크기를 준 문서로
파리티 케이스를 추가하라.

### 페이지 경계의 단일 권한 (D-A)

크기가 바뀌면 높이가 바뀌고 → 페이지 경계가 바뀐다. 경계 계산은 `assignFlowToPages` **하나**만
한다. CSS `break-*` 를 새로 도입하지 마라(`page-break` 타입이 왜 CSS 를 안 쓰는지 —
`HANDOFF-object-schema.md` §11 참조).

### 두 측정 경로의 대칭

`items` 를 만드는 곳이 둘이다 — `src/editor/reflow.js`(브라우저) 와
`src/usecases/PaginateObjectTree.js`(Chrome 측정). **한쪽만 고치면 편집과 인쇄가 갈린다.**
(직전 `page-break` 작업에서 `breakBefore` 를 양쪽에 대칭으로 실은 선례가 있다.)

### 브라우저 모듈 경로 규약

`src/editor/*` 는 `/editor/*` 로 서빙되어 화이트리스트 검사가 없지만, 거기서 import 하는
`/src/*` 는 `browserGraph` 화이트리스트 밖이면 **404 → ESM 그래프 사망 → 편집기 백지**다.
새 모듈을 만들면 절대 specifier 를 쓰고 의존이 그래프 안에 있는지 확인하라
(`test/unit/float-layout.test.js` 마지막 테스트가 그 멤버십을 단정하는 선례).

---

## 4. 손댈 곳 (코드 지도 — 기준 `c0a992c`)

| 파일 | 할 일 |
|---|---|
| `src/domain/schema/ObjectCatalog.js`(127줄) | 크기 필드를 `ALWAYS_ALLOWED_FIELDS` 로 갈지 타입별 `optional` 로 갈지 결정해 반영 |
| `src/domain/schema/validateObjectShape.js` | 값 범위 검증(양수·상한 클램프). `rect-forbidden-in-flow` 는 **그대로 유지** |
| `schema/worksheet-object.schema.json` | 런타임 상수와 1:1 유지(갈라지면 `object-schema.test.js` 가 즉시 잡는다) |
| `src/usecases/RenderObjectTree.js`(483줄) | flow/float 래퍼에 인라인 style 방출. **`renderSpacer` 가 참고 구현** |
| `src/editor/selection.js`(700줄) | `refreshResizeHandles` 가 `.wg-float` 만 순회한다 → flow 로 확장. `startFloatResize` 는 `rect` 를 직접 쓰므로 flow 용 별도 경로 필요 |
| `src/editor/inspector.js`(356줄) | X/Y/W/H 그리드가 float 전용 → flow 용 크기 필드 UI 추가 |
| `src/editor/editorStyle.js`(136줄) | 손잡이 스타일만. **크기 자체는 절대 여기 두지 마라**(R2-1) |
| `src/editor/objectFactory.js` | 크기 patch 순수 연산(`patchObject` 재사용 가능) + 클램프 |
| `test/unit/*` | 스키마·렌더·클램프 단위. `render-object-tree.test.js` 의 spacer 테스트가 형식 참고 |
| `test/render/editor-print-parity.render.test.js` | **R2-1 파리티 케이스 추가(필수)** |

---

## 5. 이 리포에서 반복해서 데는 함정 (직전 세션 실측)

1. **드래그는 합성 이벤트로 검증되지 않는다.** `dispatchEvent` 는 hit-test 와 `pointer-events` 를
   건너뛴다. 반드시 CDP 실마우스(`scratchpad/ultraqa/harness.mjs`)로 확인하라.
   직전 세션에서 이 방식으로만 잡힌 버그가 2건이다.
2. **하네스 함정 2개** — `pressKey` 는 `type:'keyDown'`(이미 수정됨, `dd76d0f`). `rectOf` 는
   `fr.left + er.left` 로 계산해 **부모 `#stage` 의 `transform:scale` 을 보정하지 않는다** —
   줌 100% 가 아니면 엉뚱한 좌표를 클릭한다. 줌 케이스를 재려면 먼저 고칠 것.
3. **`centerOf` 는 `{x, y, rect}` 를 돌려준다.** 높이는 `.rect.height`. 잘못 쓰면 NaN 좌표로
   `CDP -32602 Invalid parameters`.
4. **렌더 스위트는 직렬만 신뢰.** `npm run test:render` 는 `--test-concurrency=1` 을 이미 포함한다
   (자료집 모드 커밋 `06c5b43` 에서 들어옴). 직접 `node --test` 로 돌릴 때는 그 플래그를
   빠뜨리지 마라 — 병렬이면 Chrome 경합으로 무작위 실패한다.
5. **`wsg-*` 임시파일 누적**이 무작위 Chrome 500/타임아웃을 만든다. 실행 전후로
   `test/helpers/tmp.js` 의 `sweepStaleWsgTmp()` 를 돌려라.
6. **미선택 float 손잡이·⠿ 핸들은 실마우스로 동작하지 않는다(선행 결함).** 프로브에서 float 을
   선택하려면 **본문**을 클릭하라. `⠿` 는 `+` 삽입 버튼에 덮여 있다.
7. **검수 칩 id 는 `btn-review`**(`review-chip` 아님). 잘못 누르면 목록이 비어 **공허한 통과**가
   된다 — 측정 스크립트에 "목록이 비면 throw" 가드를 넣어라.
8. **측정은 레이아웃이 잡힌 뒤에.** 프레임 재렌더 직후엔 `getBoundingClientRect()` 가 전부 0 이다
   (`reviewChip` 이 rAF 2회 뒤로 미루는 이유).

---

## 6. 착수 게이트

```bash
git rev-parse --short HEAD          # c0a992c 가 아니면 코드 지도부터 다시 뜰 것
npm run test:unit                   # 642/642 fail 0
node -e "import('./test/helpers/tmp.js').then(m=>m.sweepStaleWsgTmp(0))"
npm run test:render                 # 102/102 fail 0 (스크립트에 --test-concurrency=1 포함)
```

**기준선: 단위 642 · 렌더 102 · fail 0.** 이 개수가 줄면 실패다. 테스트를 고쳐서 통과시키면
그 순간 의미가 사라진다 — 단, **계약이 실제로 바뀌면** 기대값을 고치되 근거를 테스트 주석에 남겨라
(직전 커밋 `c0a992c` 의 "10종 → 12종" 갱신이 그 선례).

---

## 7. 새 세션용 프롬프트 (그대로 붙여넣기)

```
편집기 개체의 크기 조정 기능을 설계·구현해줘. 핸드오프: docs/HANDOFF-object-resize.md
(그 문서만으로 자기완결적이니 먼저 끝까지 읽어).

요구: 교사가 표·제목 등 개체의 가로·세로 크기를 직접 조절할 수 있어야 한다. 지금은 자유
배치(float)만 되고 본문 배치(flow)는 전혀 안 된다. 둘 다 되게 해줘.

이건 UI 추가가 아니라 스키마 결정이 먼저인 과제다. flow 개체는 rect(좌표)를 가질 수 없으므로
(원칙 3) 좌표가 아닌 크기 필드를 새로 정의해야 한다. 핸드오프 §2 에 후보 3안(widthPct+minHeightMm /
widthMm+minHeightMm / rect 허용)과 각각의 함정이 정리돼 있으니, 근거를 대서 고르고 그 판단을
기록으로 남겨줘.

규모가 크고 R2-1(편집==인쇄 하드 동치)에 직접 걸리는 작업이라 /ralplan 으로 합의 계획부터
세운 뒤 착수해줘. 특히 이 두 가지를 계획 단계에서 반드시 다뤄야 한다:
  1) 크기 선언이 편집 렌더와 인쇄 렌더에 **동일하게** 들어가는가(인라인 style 방출 — spacer 가
     참고 구현). 편집 전용 CSS 에 크기를 두면 페이지 수가 갈린다.
  2) items 를 만드는 두 곳(reflow.js 브라우저 측 · PaginateObjectTree Chrome 측정 측)의 대칭.

검증은 반드시 실제로: 단위·렌더(직렬) 기준선 유지 + editor-print-parity 에 크기 케이스 추가 +
드래그 손잡이는 CDP 실마우스로 확인(합성 이벤트는 이 리포에서 실버그를 여러 번 놓쳤다).
핸드오프 §5 의 함정 8개를 착수 전에 읽어줘 — 직전 세션에서 실제로 밟은 것들이다.
```

---

## 8. 범위 밖으로 두는 것 (같이 하지 말 것)

- **선행 결함 2건 수정** — ⠿ 핸들이 `+` 버튼에 덮이는 문제, 미선택 float 손잡이 드래그 무반응.
  별도 과제(수정하면 `scratchpad/probe-flow-body-drag.mjs` 의 2.3/2.5 특성화 check 를 갱신해야 함).
- **shape 클릭 가로채기** — `HANDOFF-object-schema.md` §8 의 미해결 항목.
- **회전 개체의 정확한 겹침 판정(OBB)** — 현재는 회전 개체를 배치 advisory 규칙에서 제외한다.
- **자유 배치 개체의 회전 후 리사이즈 손잡이 각도 보정** — `progress.txt` 에 기록된 기존 한계.
