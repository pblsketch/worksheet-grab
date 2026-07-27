# HANDOFF — editor-v4 개체 스키마 (M1 / S1.1·S1.2 동결본)

> 이 문서만 읽어도 새 세션에서 바로 이어 착수할 수 있도록 자기완결적으로 작성됨.
> 함께 읽을 것: `scratchpad/ralplan/editor-v4/06_plan_final.md`(계획서 본체, S1.1 128~133행·S1.2 134~137행),
> `scratchpad/spike-editor-v4/`(candidate-schema.md·candidate-schema.json·REPORT.md — 폐기용 스파이크 산출물,
> 이 문서가 동결한 스키마의 실증 근거), `docs/PLAN.md` §4(Clean Architecture 레이어).
> 산출물: `src/domain/schema/*.js`(런타임 상수·검증기, 무빌드 바닐라 ESM) + `schema/worksheet-object.schema.json`
> (계약 문서용 JSON Schema) + `src/usecases/ValidateObjectTree.js`(S1.2 순수 유스케이스). 작성일 2026-07-23.

## 0. 한 줄 요약

editor-v4 문서 모델은 **닫힌 카탈로그 12종**(콘텐츠 10 + 레이아웃 2)의 타입 있는 개체 트리다. `title`·`passage-slot`·`question`
(qtype 7종)·`table`(분할불가)·`image-slot`·`answer-area`·`divider`·`shape`·`richtext`(탈출구)·`std-box`
(성취기준 주입 전용). 공통 속성은 `{id, type, answer?, placement:'flow'|'float', rect?}`. 문서는
`pages:[{id, role?, flow, float}]`를 사용하며 페이지 `id`도 문서 안에서 유일한 필수 문자열이다. 문서
수준 `pagination:'scaffold'|'paginated'`(R2-4)가 페이지네이션 권한(D-A: Chrome 측정 패스 단일 귀속)의
영속 경계를 표시한다.

## 1. 닫힌 카탈로그 12종 (콘텐츠 10 + 레이아웃 2)

| type | 설명 | placement | 필수 필드(공통 제외) | 비고 |
|---|---|---|---|---|
| `title` | 문서/단원 제목 | flow 고정 | `text` | `level`(1/2)·`meta`(닫힌 object, §3)·`answer` 선택 |
| `passage-slot` | 저작권 지문 슬롯 | flow 고정 | `slotLabel` | 슬롯 불변(§4) — 원문 창작 금지 |
| `question` | 질문(qtype 판별자) | flow\|float | `qtype`, `prompt` | qtype 7종은 §2. `answerKey` 선택(§5) |
| `table` | 표 | flow\|float | `splittable`(const false), `rows` | 페이지 분할 금지 |
| `image-slot` | 이미지 업로드 자리 | flow\|float | 없음 | ko.json 미검증(§6) |
| `answer-area` | 서술용 빈 여백(줄/박스/점) | flow\|float | `style` | emphasis-box 흡수(§7) |
| `divider` | 구분선 | flow\|float | 없음 | ko.json 미검증(§6) |
| `shape` | 자유 도형 | float 고정 | `rect`, `shapeKind` | ko.json 미검증(§6) |
| `richtext` | 탈출구(무손실 흡수) | flow\|float | `html` | 개체화율 게이트(S1.3) 분모 포함·분자 제외 |
| `std-box` | 성취기준 원문 주입 전용 | flow 고정 | 없음(`codes` 선택) | 슬롯 불변(§4) |
| `spacer` | 빈 공간(레이아웃 전용) | flow 고정 | `heightMm` | 편집기 전용 — AI 저작 어휘 아님(§11) |
| `page-break` | 페이지 나누기(레이아웃 전용) | flow 고정 | 없음 | 편집기 전용 — 페이지 용량을 늘리지 않는다(§11) |

공통 속성: `id`(string, 필수) · `type`(enum 10종, 필수) · `placement`(`'flow'|'float'`, 필수) ·
`rect`(`{xMm,yMm,wMm,hMm}`, `placement:'float'`일 때만 필수·`'flow'`일 때는 존재 자체가 위반) ·
`answer`(boolean, 선택 — 타입이 명시적으로 허용한 경우만, §5).

산출 코드: `src/domain/schema/ObjectCatalog.js`(`OBJECT_TYPES`·`TYPE_SPECS`), 계약 문서
`schema/worksheet-object.schema.json`.

## 2. qtype 7종 (question 판별자)

`multiple-choice`(객관식) · `short-answer`(단답) · `essay`(서술) · `fill-blank`(빈칸) ·
`true-false`(참거짓) · `matching`(짝짓기) · `ordering`(순서). S1.0 스파이크(REPORT.md §2)에서
7종 전량 삽입·렌더·더블클릭 편집·실제 키 입력이 실제 마우스(CDP Input)로 실증되어 M1 동결 대상으로
확정됐다(C-11 충족). `src/domain/schema/ObjectCatalog.js`의 `QUESTION_TYPES`.

## 3. 스파이크 발견 5건의 반영 (M1 동결 결정)

`REPORT.md §4`·`candidate-schema.md §6`에 기록된 5건에 대한 이번 동결에서의 최종 결정:

1. **`question.answerKey` 선택 필드 추가** — 인접 정답 콘텐츠(마이그레이션 시 `question` 바로 뒤에
   오는 정답 텍스트 블록)를 하나의 `question`으로 병합하기 위한 착지점. 실제 병합 휴리스틱
   (어떤 인접 블록을 정답으로 판단해 합칠지)은 **S1.3(마이그레이션) 몫**이며, 이 스키마는 그 결과를
   담을 필드 자리만 확정한다. `answerKey`가 있든 없든 `answer:true` 개체 전체가 학생용에서 물리
   제거되는 규칙(BuildVariants, S2.2)에는 영향 없음 — 별개 필드다.
2. **`callout` 신규 타입은 만들지 않는다** — R5(최소 카탈로그 우선)에 따라 기각. `emphasis-box`(스파이크
   원본 명칭)는 신규 타입이 아니라 **구조 분기**로 흡수한다: 내용이 비어 있으면 `answer-area`(학생이
   채울 빈 여백), 내용이 있으면 `richtext`(정적 강조 텍스트). 스파이크 실측(SS2)에서 이 구조 분기가
   정확히 동작함을 확인했다(내용 유무만으로 두 용도가 명확히 갈림 — 별도 타입이 주는 이득이 낮음).
3. **`title.meta` 닫힌 형태로 축소** — 스파이크 원본은 `meta: {type:'object', additionalProperties:true}`
   로 자유 확장을 허용했는데, 이는 사실상 두 번째 탈출구였다(`richtext`가 이미 탈출구 역할을 하므로
   중복). 스파이크 실측에서 관찰된 header 부가정보만 명시 필드로 승격해 **닫힌 스키마**
   (`additionalProperties:false`)로 동결: `pill`(단원/차시 배지) · `page`(교과서 대응 쪽수) ·
   `source`(출처 표기). `schema/worksheet-object.schema.json#/$defs/titleObject/properties/meta`.
4. **`image-slot`/`divider`/`shape` 카탈로그 포함, sci.json 검증은 S1.3 범위** — ko.json(국어 PoC)에는
   세 타입 모두 실사용 예시가 0건이라(REPORT.md §4-4) 스키마 형태는 사전 확정만 하고, `sci.json`
   (과학, 도형/이미지 가능성 높음) 마이그레이션을 통한 실증적 검증은 **S1.3(마이그레이션 + 무손실·
   개체화율 게이트) 범위**로 명시적으로 이관한다. 이 스키마 동결이 세 타입의 실사용 적합성을 보증하지
   않는다는 점을 다음 세션이 인지해야 한다.
5. **float z-order 클릭 가로채기는 스키마 밖 — M4 이관** — §8 참조.

## 4. 슬롯 불변 (성취기준·저작권)

- **`std-box`** — 성취기준 원문 **주입 전용**. 원문 텍스트 자체를 개체에 저장하지 않고 `codes`
  (manifest.standards 코드 배열 참조)만 저장하며, 원문은 렌더 시 성취기준 CSV/gepai에서 주입한다
  (원칙 3 — AI는 구조를 만들되 좌표/원문을 창작하지 않는다). `text`/`html`/`bodyHtml` 등 자유 텍스트
  필드를 실으면 "AI가 성취기준 원문을 창작해 주입"하는 경로가 되므로 스키마가 원천 차단한다
  (`additionalProperties:false` — `ValidateObjectTree`가 `rule:'slot-invariant'`로 거부).
- **`passage-slot`** — 저작권 지문 슬롯. `slotLabel`(슬롯 안내 문구, 필수)이 항상 존재해야 "아직
  콘텐츠가 채워지지 않은 슬롯"임이 렌더·검수 양쪽에서 식별된다. `bodyHtml`은 레이아웃 확인용
  placeholder일 뿐 실제 저작권 지문이 아니다(주석 명시).
- 두 타입 모두 `IMMUTABLE_SLOT_TYPES`(`src/domain/schema/ObjectCatalog.js`)에 등재되어
  `validateObjectShape`가 카탈로그 밖 필드 주입을 일반 `unknown-field`가 아닌 **`slot-invariant`**로
  구분해 보고한다(슬롯 변조를 다른 스키마 위반과 구분해 감사하기 위함).

## 5. answer 위치 규칙

`answer:true`(교사 전용, 학생용에서 물리 제거)는 **`title`·`question`·`table`·`richtext`** 만 실을 수
있다(`ANSWERABLE_TYPES`, `TYPE_SPECS[type].optional`에 `'answer'`가 명시된 타입만 파생). 나머지 6종
(`passage-slot`·`image-slot`·`answer-area`·`divider`·`shape`·`std-box`)에 `answer:true`를 실으면
`additionalProperties:false` 위반(`unknown-field`)으로 거부된다 — `answer-area`는 이미 그 자체가
"학생이 답을 쓸 자리"를 표현하므로 별도의 `answer` 플래그가 의미를 갖지 않는다는 판단.

## 6. 페이지네이션 상태 (D-A / R2-4)

문서 수준 `pagination: 'scaffold' | 'paginated'`:
- **`scaffold`** — `compose` 스캐폴드 산출물. 페이지 경계가 아직 계산되지 않은 상태. **export 거부.**
- **`paginated`** — `pipeline`/편집 저장 산출물. Chrome 측정 패스가 `pages[]` 경계를 영속화 완료한
  상태. **export 허용.**

경계 계산 자체(Chrome 헤드리스 측정 패스)는 M2(S2.5)/M3(S3.5) 소관이며 이 M1 산출물의 책임 밖이다.
이 스키마·유스케이스가 보증하는 것은 **계약**뿐이다: `src/domain/schema/exportGate.js#checkExportGate(document)`
가 `pagination` 값을 받아 `{exportable, reason, message}`를 순수 판정하고, 향후 `ExportDocument`
(M2/S3.5)가 이 판정을 fail-closed 게이트로 승격한다. `ValidateObjectTree`는 `pagination` 값이
두 상태 중 하나인지(구조 유효성)만 확인하며, export 가능 여부 자체는 판정하지 않는다(관심사 분리 —
"문서가 구조적으로 올바른가"와 "지금 export해도 되는가"는 다른 질문).

## 7. emphasis-box 구조 분기 상세 (참고, §3-2 요약의 부연)

스파이크 원본 `emphasis-box`는 빈 상태(dashed border만 있는 강조 박스)와 텍스트가 채워진 상태
(정적 안내문 강조) 두 용도를 겸했다. 마이그레이션 휴리스틱(S1.3 소관)이 다음 기준으로 분기한다:
내용이 비어 있으면 `answer-area`(`style:'box'`), 텍스트가 있으면 `richtext`. 이 판정 자체는
스키마가 아니라 마이그레이터의 책임이며, 이 문서는 **두 착지 타입이 이미 카탈로그에 존재**함을
확인해 별도 타입 신설이 불필요함을 기록하는 것이 목적이다.

## 8. M4 이관 노트 — float z-order 클릭 가로채기

S1.0 스파이크 실측(REPORT.md §2 각주)에서 재현된 이슈: **float 개체가 flow 개체 위를 시각적으로
덮으면, 아래 flow 개체의 클릭/더블클릭을 float 개체가 가로챈다**(DOM 렌더 순서가 `flowHtml` 다음
`floatHtml`이라 float이 항상 위 스택이기 때문). 실측에서는 겹치는 페이지를 분리해 회피했지만, 이는
스키마가 해결할 문제가 아니다 — **개체 스키마 자체에는 z-order 필드도, 겹침 방지 제약도 없다**
(float은 자유 배치가 원칙).

**M4(편집기 클라이언트 재구축)로 이관하는 UX/구현 결정 사항**:
- (a) 미선택 float 개체는 `pointer-events:none` 처리 후 클릭 시에만 hit-test를 활성화하거나,
- (b) 앞으로 보내기/뒤로 보내기(z-index 조작) UI를 제공하거나,
- (c) 위 두 가지를 병행.

이 스키마 동결본은 float/flow 개체가 **좌표상 겹칠 수 있다는 사실 자체는 허용**하며(스키마 위반
아님), 클릭 가로채기를 어떻게 다룰지는 순전히 M4의 편집기 상호작용 설계 몫이다. M1/M2 단계에서는
이 이슈로 인해 스키마에 어떤 필드도 추가하지 않는다.

## 9. 코드 산출물 지도

```
src/domain/schema/
├── ObjectCatalog.js        타입 상수(OBJECT_TYPES·QUESTION_TYPES·PLACEMENTS·PAGINATION_STATES·
│                            TYPE_SPECS·IMMUTABLE_SLOT_TYPES·ANSWERABLE_TYPES)
├── validateObjectShape.js  개체 1개 구조 검증(순수 함수)
├── exportGate.js           checkExportGate — pagination→export 가능 여부 계약(순수 함수)
└── index.js                배럴(도메인 index.js 관례 준수)

schema/worksheet-object.schema.json   JSON Schema 계약 문서(런타임 검증기와 별개, 사람/AI 프롬프트용)

src/usecases/ValidateObjectTree.js    S1.2 — 개체 트리 구조 유효성 순수 검증(ValidateWorksheet 관례)

test/unit/object-schema.test.js       S1.1 수용 기준(카탈로그 10종·미지정 타입·AI 좌표·pagination 계약)
test/unit/validate-object-tree.test.js S1.2 수용 기준(PASS + 위반 4계열 FAIL)
```

## 10. 다음 단계 (이 산출물의 범위 밖)

- **S1.3**: `migrateManifestToObjectTree` — ko.json/sci.json 마이그레이션, richtext 무손실 흡수,
  개체화율 게이트(하드 플로어 50%·목표 70%), `question`+인접 정답 병합 휴리스틱(§3-1), image-slot/
  divider/shape 실사용 검증(§3-4).
- **M2 S2.5**: Chrome 측정 패스가 `pagination:'scaffold'→'paginated'` 전이를 실제로 수행(경계 계산+
  `pages[]` 영속화).
- **M2/S3.5 이후**: `ExportDocument`가 `checkExportGate`를 fail-closed 게이트로 승격.
- **M4**: float z-order 클릭 가로채기 UX 결정(§8), qtype별 인스펙터 UI, 실제 드래그·리플로우 편집기.


## 11. 레이아웃 전용 2종 추가 (2026-07-28 — 동결본 이후 델타)

`spacer`(빈 공간) · `page-break`(페이지 나누기)를 신설해 카탈로그가 10 → **12종**이 됐다.
"신규 타입 창설 금지"(R5)의 취지는 *쓸모가 겹치는 타입을 늘리지 말라*는 것인데, 이 둘은 기존
어느 타입도 대신하지 못한다.

**왜 필요했나(실사용 근거)**
- `spacer` — flow→float **실측 승격**이 들어오면서 개체가 흐름에서 빠지면 아래 내용이 그만큼
  위로 당겨진다. 교사가 그 자리를 되찾으려 해도 flow 에는 "빈 공간"이라는 위치가 없다(순서만
  있고 좌표가 없다). 그래서 자리를 **차지하는 개체**가 있어야 한다.
- `page-break` — 페이지 소속은 `assignFlowToPages` 의 그리디 패킹이 매번 다시 계산하는 **파생값**
  이다. 교사가 개체를 다른 쪽으로 끌어다 놔도 다음 리플로우가 앞 페이지의 남은 자리로 도로 당겨
  올린다. "여기서 끊어라"를 표현할 어휘가 없었다.

**계약**
- 둘 다 **flow 전용**. float 은 흐름을 밀지 않으므로 빈 공간이 성립하지 않고, 페이지 경계와도 무관하다.
- `spacer.heightMm` 은 렌더가 **인라인 height 로 방출**한다 — 편집 측정과 인쇄가 같은 선언을 써야
  R2-1(편집==인쇄)이 성립한다. 편집 전용 CSS 로 높이를 주면 둘이 갈린다.
- `page-break` 는 높이 0 이고 **CSS `break-before` 를 쓰지 않는다.** 페이지 경계의 단일 권한은
  측정 패스이며(D-A), CSS 개행을 섞으면 `pages[]` 와 실제 인쇄가 어긋난다. 개행은
  `assignFlowToPages` 가 `breakBefore` 표식을 만나 커서를 옮기는 것으로만 일어난다.
  ⚠ **페이지 용량을 늘리지 않는다** — 끊는 위치만 정하고, 넘치는 분량은 여전히 뒤로 밀린다.
- 두 `items` 구성 지점(`src/editor/reflow.js` 브라우저 측 · `PaginateObjectTree` Chrome 측정 측)이
  `breakBefore` 를 **대칭으로** 실어야 한다 — 한쪽만 고치면 편집과 인쇄의 페이지 구성이 갈린다.
- **AI 저작 어휘에는 넣지 않는다.** designer/planner 는 계속 콘텐츠 10종만 저작하고, 이 둘은 교사가
  편집기에서 삽입한다(원칙 3 의 연장 — AI 는 내용을 만들고 조판은 교사와 리플로우가 정한다).
  다만 기존 문서에 있으면 **보존**한다.


## 12. 본문 인라인 편집 · 표시 기본값 델타 (2026-07-28)

편집기 UX 피드백 5건을 반영한 스키마/렌더 델타다. 새 **타입**은 없다 — 기존 타입에 필드 5개가 늘고,
렌더가 편집 좌표(`data-part`)를 싣는 범위가 넓어졌다.

### 12-1. `std-box.heading` / `std-box.showStandards`

- `heading` — 학습목표 박스 제목(기본 `'학습 목표'`). 학교·교과마다 부르는 이름이 달라 교사가
  캔버스에서 직접 고친다. `codes`(조회 참조)와 달리 **저작 영역**이라 원칙 3의 대상이 아니다.
- `showStandards` — "근거 성취기준"(코드+원문) 박스를 낼지. **기본 false(미표시)**. 종전에는
  `objectives`가 있으면 항상 함께 나왔는데, *활동지에 얹는 것은 학습목표뿐이고 성취기준 원문은 대개
  넣지 않는다*는 실사용 피드백이 근거다. `true`일 때의 동작은 종전과 같다 — `.std-ref`로 방출해
  학생용에서는 `data-mode` CSS로만 숨긴다(정답과 달리 비밀이 아니므로 물리 제거 불필요).
  ⚠ **표시 여부만 정한다** — 끄더라도 `codes`는 개체에 그대로 남아 검수(objectives-alignment)와
  나중의 재표시가 살아 있다. designer 는 이 필드를 기본적으로 싣지 않는다(사용자 명시 요청 시에만).

### 12-2. `passage-slot.borderColor` / `borderWidth` / `bgColor`

지문 성격(자료·인용·안내)을 색으로 구분하고 싶다는 요구. `table.borderColor/borderWidth`가 이미 쓰던
경로와 동형이다 — 렌더가 인라인 커스텀 프로퍼티(`--wg-ps-border`/`--wg-ps-bw`/`--wg-ps-bg`)로 방출하고
`assets/blocks.css`의 `.passage`가 `var(…, 기본값)`으로 받는다. **미지정 개체는 선언 자체가 붙지 않아
종전 산출과 바이트 동일**하다.

색 값은 `cssColor()`(`RenderObjectTree`)를 통과해야 방출된다 — `#rgb`~`#rrggbbaa` 또는 알파벳 키워드만
허용한다. 인라인 `style` 자리라 `escapeHtml`만으로는 `;`로 선언을 끊고 다른 속성을 주입하는 것을
막지 못하기 때문이다(값이 통과하지 못하면 그 선언을 생략 → 기본값 유지, fail-closed).

### 12-3. 인라인 편집 좌표(`data-part`)의 확대

`.q-part[data-part][data-i]`(문항 선지·항목)에만 있던 규약을 개체 부가 텍스트로 넓혔다.

| 타입 | 조각 | 좌표 |
|------|------|------|
| `std-box` | 학습목표 문장 / 박스 제목 | `objectives`+`data-i` / `heading` |
| `title` | 상단 배지 / 모서리 표기 / 출처 | `meta.pill` / `meta.page` / `meta.source` |
| `passage-slot` | 지문 제목 / 출처 | `title` / `source` |
| `table` | 캡션 | `caption` |

- **속성만 는다.** `partAttr()`은 `editMode`에서만 `data-part`/`data-i`를 붙이므로 인쇄 산출은
  종전과 같고 레이아웃 박스도 편집/인쇄가 동일하다(R2-1).
- **값이 없는 조각은 애초에 그리지 않는다.** 편집 전용 빈 요소를 만들면 편집 측정 높이와 인쇄
  높이가 갈린다 — 새로 다는 것은 인스펙터 몫이다(`selection.js`의 image-slot 캡션 규약과 동일).
- 어떤 (타입, 필드)를 되쓸 수 있는지는 `partEdit.js`의 `EDITABLE_PARTS`가 닫는다. 렌더가 싣는 좌표와
  이 목록의 정합은 `test/unit/part-edit.test.js`가 소스를 파싱해 상시 단정한다.
- `image-slot`의 캡션은 **이 목록에 없다** — `selection.js`의 `EDIT_FIELD`가 이미 `figcaption` 편집을
  소유한다. 한 조각에 편집 주체가 둘이면 캡처 단계의 `partEdit`이 조용히 이긴다.
- 조각 편집 중 **Enter는 줄바꿈이 아니라 편집 종료**다. 조각은 전부 한 줄짜리 값인데 되읽기가
  `textContent`라, `<br>`/`<div>`가 들어가면 개행이 그대로 필드에 섞인다.

### 12-4. `image-slot` 플레이스홀더

`.image-slot` 규칙이 `blocks.css`에 **아예 없어서**(실 Chrome 관측) 빈 자리가 좌측에 붙은 맨 글자로만
보였고, 채운 이미지도 원본 크기 그대로 지면을 넘칠 수 있었다. 아이콘+라벨 구조로 바꾸고 점선 박스로
그린다. `blocks.css`는 학생 배포본도 쓰는 공유 자산이므로 **편집기 안내 문구는 렌더에 넣지 않는다**
(그 안내는 인스펙터가 낸다).
