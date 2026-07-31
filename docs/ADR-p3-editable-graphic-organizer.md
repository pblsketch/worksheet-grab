# ADR — P3: 에디터에서 편집 가능한 그림 개체 (go/no-go)

> **상태: GO (A안 채택) — 작동 프로토타입으로 실증.** 2026-07-31.
> 대상: `E:/github/worksheet-grab` · 브랜치: `feat/p3-editable-organizer` · 스파이크 커밋 `67da4cd`.
> 근거 문서: `docs/HANDOFF-P3-editable-graphic-object.md`, `docs/PLAN-graphic-organizers.md`(§74·136·178).
>
> **업데이트(2026-07-31, 확장):** 스파이크 GO 후 형 승인으로 **그림형 6종 전부**(venn·conceptmap·
> fishbone·flowchart·hierarchy·hexagon)를 편집 가능 organizer 로 확장하고, **라벨을 슬롯 이름 키**로
> 저장(§6-1 remap 해소)했다. test:unit 891 pass, 조직자/에디터 렌더 12 pass. 기본 라벨 미지정 시 생성기
> 출력은 바이트 동일이라 compose/인쇄 경로 회귀 0.

---

## 0. 한눈에

그림형 조직자(벤다이어그램 등)를 "잠금 삽입"에서 **에디터에서 개수·라벨을 편집 가능한 개체**로
만들 수 있는가? → **가능하다(GO).** 새 개체 타입 `organizer`(A안)를 callout 선례대로 풀스택 추가하고,
**venn 한 종류로 개수(2↔3)·라벨 편집을 작동 프로토타입으로 실증**했다. 5대 불변식이 데이터로 전부
통과했다. B안(richtext 재생성)은 라벨을 저장할 구조 필드가 없어 막히고, C안(no-go)은 목표를 못 이룬다.

---

## 1. 결정 (Decision)

**A안 채택 — 새 개체 타입 `organizer{kind, params, labels}`.**
- `kind` = 조직자 종류(`ORGANIZER_KINDS` = venn·conceptmap·fishbone·flowchart·hierarchy·hexagon).
- `params` = 개수(예 `{circles:3}`) — 엔진(OrganizerGen)이 범위 clamp·해석.
- `labels` = 슬롯 텍스트 배열(교사 저작·선택). 슬롯의 순서·좌표는 엔진 소유(원칙 3).
- flow 전용, **answer 미허용**(중립·fail-closed). 렌더는 OrganizerGen 단일 출처.

**프로토타입 범위: venn 만** 잠금 richtext → 편집 가능 organizer 로 승격(개수·라벨). 나머지 5종은
잠금 richtext 유지(스키마·렌더 배선은 이미 6종 모두 열려 있어 점진 확대가 값싸다).

## 2. 동인 (Drivers)

- P3 목표 = "에디터 인스펙터에서 개수·라벨 구조 편집" — A안만 이를 구조 필드로 정면 표현한다.
- 동결 스키마를 여는 회귀 위험 최소화 — callout(M4)이 이미 풀스택 선례를 냈고, `validateObjectShape`
  가 데이터 주도라 커스텀 코드가 최소(kind 닫힘 규칙 1개, question qtype·table splittable 과 동형).
- 병행 세션(editorqa)이 designer 어휘·blocks 를 건드림 → 스파이크를 에디터·스키마 JS 로 좁혀 겹침 0.

## 3. 스파이크가 잰 것 (데이터) — 작동 프로토타입 계측

`scratchpad/p3-organizer-demo.mjs`(에디터 개체 트리 → RenderObjectTree 실경로) + 실물 Chrome 렌더
(`scratchpad/p3-venn-demo.png`):

| 불변식 | 측정 | 결과 |
|---|---|---|
| 무API / 좌표 미생성 | 문서에 좌표(rect) 개수 | **0개** — 엔진이 SVG 소유 |
| 스키마 유효 | organizer 3종(2원·2원+라벨·3원+라벨) 검증 | **전부 ok** |
| 편집=인쇄 기계동치 | editMode true/false 렌더의 venn 블록 문자 비교 | **3/3 문자 동일** |
| 〃 레이아웃 선언 파리티 | 인라인 style 목록(R2-1 가드) | **동일** |
| 왜곡 0 | circle 개수 / 고정비율 viewBox | **7개(2+2+3) / 3개** (원→원, 타원 아님) |
| 라벨 슬롯 반영 | 교사 라벨 7개 / 미편집분 기본 라벨 유지 | **7/7 반영 · 기본 유지** |
| 정답 fail-closed | organizer 에 answer:true | **unknown-field 로 거부** |
| 인쇄 적합 | A4 한 쪽에 3개 조직자(넘침·잘림) | **한 쪽 · 잘림 0**(PNG) |

유닛: `test:unit` **891 pass / 0 fail**(기준선 884 + 신규 7). 렌더 회귀: `organizers.render`(compose·
AssembleWorksheet 경로, venn 하위호환) + `editor-print-parity`(에디터 경로) 통과.

**결정적 관찰:** venn 은 params 로 개수가 이미 열려 있어 **개수 편집은 A안·B안 둘 다 쉽다** — 즉 개수는
A/B 를 가르지 못한다. 실제 갈림길은 **라벨**이다: A안은 labels 를 구조 필드로 저장해 재렌더에도 보존
(위 "라벨 슬롯 반영")하지만, B안은 라벨이 구운 SVG 안에만 있어 저장할 곳이 없고 개수 재생성이 라벨을
덮어쓴다. 그래서 프로토타입을 **개수만이 아니라 개수+라벨**로 잡아 이 갈림길을 실측했다.

## 4. 검토한 대안 (Alternatives)

- **B안 — richtext 유지 + 개수 재생성:** 스키마 무변경으로 가볍다. 그러나 richtext 는 kind/params/labels
  를 담을 구조 필드가 없어 마커/파싱이 필요하고, 개수 변경 시 html 통째 재생성이 **교사가 손으로 넣은
  라벨을 덮어쓴다**. 라벨 편집을 하려면 사실상 A안의 구조 필드를 재발명해야 한다 → 기각.
- **C안 — no-go:** P2 잠금 삽입으로 충분하다고 보고 compose 재삽입으로 우회. 목표("에디터 구조 편집")
  미달성 → 기각.

## 5. 결과 (Consequences)

- 닫힌 카탈로그 13 → **14종**(organizer). `object-schema.test` 등 드리프트 가드 픽스처 갱신.
- 그림형 조직자 삽입이 비대칭: **venn = 편집 가능 organizer**, 나머지 5종 = 잠금 richtext(하위호환 —
  기존 활동지의 richtext 조직자는 그대로 열린다).
- OrganizerGen `vennSvg` 시그니처 `(params, labels)` — 라벨 미지정 시 출력 바이트 동일(하위호환).

## 6. 스파이크가 드러낸 주의점 (생산화 전 처리)

1. **라벨 슬롯 키화 — 해소됨(2026-07-31 확장).** 처음엔 labels 를 배열 index 로 저장해 개수를 2→3 으로
   바꾸면 "가운데" 라벨이 밀렸다. 이를 **슬롯 이름 키**(venn 2원 left/right/common · 3원 a/b/c/common —
   공통은 둘 다 common)로 바꿔 개수를 바꿔도 공통 라벨이 유지되게 했다. 6종 전부 같은 이름-키 모델
   (`ORGANIZER_EDIT_SPECS[kind].slots(count)` 가 `{key,label,def}` 단일 출처).
2. **PDF 쪽수 파리티** — 에디터 organizer 경로의 "인쇄 PDF 쪽수 == 편집 쪽수"는 이번엔 구조 동치
   (venn 블록 문자 동일)와 A4 한 쪽 육안 확인으로 갈음했다. `editor-print-parity.render` 에 organizer
   픽스처를 넣어 PDF 쪽수까지 못 박는 것을 후속으로 권고.

## 7. 후속 (Follow-ups) — 승인 후 별도 작업

- ~~나머지 5종 슬롯화~~ · ~~라벨 슬롯 이름 키화~~ — **완료(2026-07-31 확장).** 6종 전부 개수·라벨 편집.
- **마이그레이션 대칭**(P1b 선례) — compose/기존 문서의 richtext 조직자를 organizer 로 승격.
- **에디터 organizer PDF 쪽수 파리티 테스트**(§6-2) — `editor-print-parity.render` 에 organizer 픽스처 추가.
- **designer 저작 어휘** — AI 가 kind·개수·슬롯 텍스트를 저작(좌표 아님). editorqa(worksheet-design) 와
  겹치므로 그 세션 병합 후 별도 승인.

## 8. ADR 메타

- **결정:** A안(새 `organizer` 타입) GO. venn 개수+라벨 편집 프로토타입 실증.
- **불변식:** 무API·좌표 미생성 · 정답 fail-closed · 편집=인쇄(구조 동치+실물 Chrome) · 성취기준 무접촉 — 전부 유지.
- **역전 조건:** 없었음(프로토타입이 5대 불변식을 데이터로 통과). 남은 위험은 §6 의 두 주의점(생산화 몫).
