---
name: worksheet-review
description: 활동지 개체 트리(+렌더 산출)를 내보내기 전에 검수한다. 1층(구조 검증, 코드 판정)·2층(렌더 실측)의 2층 게이트로 정답 누출·범교과성·성취기준 정합·인쇄 안전·저작권을 검증하고 PASS/FAIL을 판정할 때 사용. "활동지 검수/검증/QA", 내보내기 직전 품질 게이트에서 반드시 사용. 존재 확인이 아니라 렌더 실측 기반 경계면 검증.
---

# worksheet-review (활동지 검수 게이트)


내보내기 직전의 마지막 방어선이다. **모호한 지적은 금지** — 무엇이·어디서·왜·어떻게 고칠지를 적는다. 입력은 **개체 트리 JSON**(닫힌 카탈로그 12종 — 콘텐츠 10 + 레이아웃 2, `ValidateObjectTree` 스키마) + 렌더 산출(student/teacher HTML)이다. 검수는 **2층 체계**다 — 1층은 코드가 결정적으로 판정하고, 2층은 코드로 못 잡는 항목을 렌더 실측으로 reviewer가 판단한다.

## 1층 — 구조 검증 (결정적, 코드 판정 — reviewer는 실행·해석만)
`node --test` 로 미리 검증된 순수 함수를 그대로 실행한다. 새 규칙을 직접 만들지 않는다.
```js
import { ValidateObjectTree } from './src/usecases/ValidateObjectTree.js';
import { ValidateWorksheet } from './src/usecases/ValidateWorksheet.js';

const structural = new ValidateObjectTree().execute(objectTreeDoc);      // 구조만
const gated = new ValidateWorksheet().execute(objectTreeDoc, renderedHtml); // 구조 + 2층 렌더 실측(선택)
```
- **타입**: 닫힌 카탈로그(12종 — 콘텐츠 10 + 레이아웃 2) 밖 타입 없는가(`unknown-type`).
  레이아웃 2종(`spacer`·`page-break`)은 교사가 편집기에서 넣는 조판 도구라 내용 판정 대상이 아니다.
- **슬롯 불변**: `std-box`(성취기준 원문)에 **카탈로그 밖** 필드가 없는가(`slot-invariant`) — 원문 창작·변형은 이 규칙으로 자동 FAIL(원칙 3 무변경). `passage-slot`의 카탈로그 필드(`title`·`bodyHtml`·`source`·`footnotes`)는 교사 직접 입력 또는 사용자가 명시 요청한 AI 창작/재구성으로 채워지는 정상 필드라 여기 걸리지 않는다(3층 정책) — 저작권은 아래 advisory 로만 다룬다(더 이상 FAIL 사유 아님).
- **answer 위치**: `answer:true`가 허용된 타입에만 실렸는가.
- **표 분할불가**: `table.splittable === false`인가(`table-splittable-violation`).
- **scaffold/paginated 상태**: `pagination`이 `scaffold`면(경계 미계산) 내보내기 거부 대상 — `paginated` 승격 필요.
- 이 층의 findings는 모두 `severity:'error'` — **하나라도 있으면 반드시 FAIL**(layer:1로 기록).

## 2층 — 렌더 실측 (코드로 다 못 잡는 항목 — reviewer가 실측)
1층은 구조만 본다. `richtext`(무손실 탈출구) 내부에 평문으로 박힌 정답처럼 **구조상 합법이지만 내용이 문제인 경우**는 1층이 못 잡으므로, student/teacher 렌더 문자열을 직접 실측한다.

### 2-1. 정답 누출 (최우선)
- student 렌더에 `.answer`/`.plot-ans` 내용이 노출되면 안 된다.
- 1차: `ValidateWorksheet.execute(objectTreeDoc, renderedHtml)`(renderedHtml 전달 시 누출 grep을 함께 수행, `rule:'answer-leak'`).
- 2차 교차: teacher 렌더의 `.answer`/`.plot-ans` 내부 텍스트(알려진 정답)를 뽑아 student 렌더 문자열에 그대로 남아있는지 grep. `richtext` 안 평문 정답처럼 1층이 놓친 케이스의 최종 방어선이다.
- 1건이라도 잡히면 **FAIL**(layer:2).

### 2-2. 인쇄 안전 warning
- 문항이 페이지 경계에서 잘리지 않음(`break-inside:avoid`/`.keep`).
- 본문 최소 폰트(≈9pt+), A4 인쇄 여백 확보, `word-break:keep-all`로 한글 단어 중간 분리 없음.
- `ValidateWorksheet`의 renderedHtml 경로가 warning으로 산출(게이트를 막지는 않되 반려 권고 근거).

### 2-3. 흑백 대비·이미지 alt 등 코드로 못 잡는 항목
- 흑백 인쇄 대비(회색조에서도 판독 가능한 명도차).
- `<img>` 마다 `alt` 존재, 폭 mm 단위·페이지 폭 이내.
- 정답이 이미지에 "구워진"(baked-in) 경우 `.answer` 마크 안에 있는지(마크 밖이면 정답 누출).
- 원격 URL(`http://`/`https://`) 대신 로컬 `assets/` 상대경로인지, 이미지 저작권 출처 표기(이미지는 무변경).

## Advisory(verdict 산정 제외)
- **저작권 지문**(area: `passage-copyright`, 3층 정책 — FAIL 사유였던 것을 advisory로 강등): `passage-slot.bodyHtml`에 지문이 있는 것 자체는 정상이다(교사 직접 입력이든 사용자가 명시 요청한 AI 창작/재구성이든 — `aiBridge` 타입 가드가 해제돼 AI 도 요청 시 지문을 다룰 수 있다, §7 은 std-box 만 잔류). `source`(출처) 미기재만 `ValidateObjectTree`의 `passage-source-missing`으로 권고하고, `source`가 있어도 표기(예: "AI 창작"/"원문 ○○ 재구성") 없이 실존 저작물 원문을 그대로 재현한 것으로 의심되면 교사 확인을 권고한다.
- **UDL 3장벽**(area: `udl`) — 참여(선택권·짧은 성공 경험)·표상(한 가지 방식만 아닌지)·행동과 표현(쓰기 하나뿐 아닌지).
- **루브릭 품질**(area: `rubric-quality`) — 성취 기반인지, 등급 차이가 관찰 가능한 행동으로 설명되는지.
- **brief 정합**(area: `brief-fidelity`) — `00_brief.json` 존재 시에만, `lessonIntent`·`assessmentEvidence`·`misconceptions`·`inquiryLadder` 미반영 요소 열거.
- **학습목표-성취기준 대응**(area: `objectives-alignment`) — `std-box.objectives`(학습목표, 저작 영역)가 있으면 각 목표 문장이 `std-box.codes`가 참조하는 성취기준에서 무리 없이 도출됐는지(성취기준 범위를 벗어난 창작이 아닌지) 확인해 권고. 확정 판정 아님.

## 범교과성(1층 slot-invariant 보조 + 육안)
- 교과색은 CSS 변수(`--c` 등)로만, 하드코딩 금지(엔진 `validate` 의 `hardcoded-subject-color` warning 교차 확인).
- 교과 특수 블록(지문·찬반=국어, 변인표·수식=과학 등)이 **다른 교과 산출물에 새지 않았는지** 확인.

## 실행 방식
- `general-purpose`로 동작(1층 실행·2층 렌더 실측 필요).
- **점진적 검수**: 산출 직후 즉시. 전체 완성 후 1회 몰아서 하지 않는다.
- 1층은 Chrome 없이 항상 가능 — 개체 트리만 있으면 반드시 실행. 2층 렌더 산출이 없으면 1층만으로 판정하고 "2층 렌더 미검증"을 명시(통과 위장 금지).

## 출력
`_workspace/04_review.json`
```json
{ "verdict":"FAIL",
  "findings":[{"layer":2,"severity":"error","area":"정답누출","detail":"student 3쪽 richtext에 '3.0Ω' 평문 노출","fix":"해당 값을 answer:true 개체 또는 answerKey로 이동"}] }
```
- `layer:1`(구조, 코드 판정) 또는 `layer:2`(렌더 실측, reviewer 실측)를 findings마다 명시한다.
- `verdict:PASS`일 때만 exporter로 진행. FAIL이면 designer로 반려.
