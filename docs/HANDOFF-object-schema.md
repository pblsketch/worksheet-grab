# HANDOFF — editor-v4 개체 스키마 (M1 / S1.1·S1.2 동결본)

> 이 문서만 읽어도 새 세션에서 바로 이어 착수할 수 있도록 자기완결적으로 작성됨.
> 함께 읽을 것: `scratchpad/ralplan/editor-v4/06_plan_final.md`(계획서 본체, S1.1 128~133행·S1.2 134~137행),
> `scratchpad/spike-editor-v4/`(candidate-schema.md·candidate-schema.json·REPORT.md — 폐기용 스파이크 산출물,
> 이 문서가 동결한 스키마의 실증 근거), `docs/PLAN.md` §4(Clean Architecture 레이어).
> 산출물: `src/domain/schema/*.js`(런타임 상수·검증기, 무빌드 바닐라 ESM) + `schema/worksheet-object.schema.json`
> (계약 문서용 JSON Schema) + `src/usecases/ValidateObjectTree.js`(S1.2 순수 유스케이스). 작성일 2026-07-23.

## 0. 한 줄 요약

editor-v4 문서 모델은 **닫힌 카탈로그 10종**의 타입 있는 개체 트리다. `title`·`passage-slot`·`question`
(qtype 7종)·`table`(분할불가)·`image-slot`·`answer-area`·`divider`·`shape`·`richtext`(탈출구)·`std-box`
(성취기준 주입 전용). 공통 속성은 `{id, type, answer?, placement:'flow'|'float', rect?}`. 문서 수준
`pagination:'scaffold'|'paginated'`(R2-4)가 페이지네이션 권한(D-A: Chrome 측정 패스 단일 귀속)의 영속
경계를 표시한다.

## 1. 닫힌 카탈로그 10종

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
