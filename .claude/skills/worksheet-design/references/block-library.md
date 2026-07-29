# 옛 블록 패턴 → 닫힌 카탈로그 매핑 (references/block-library.md)


예전 문서에서 쓰이던 블록 패턴을, 닫힌 카탈로그 10종 중 어느 타입으로 착지시킬지 정리한 매핑표다.
엔진의 마이그레이션이 실제로 이 매핑을 구현하므로,
디자이너가 새로 저작할 때도 같은 규칙을 따르면 마이그레이션 산출물과 일관된 개체 트리가 된다.

**신규 타입 창설 금지** — 아래 표에 없는 새로운 표현이 필요해도 카탈로그를 늘리지 말고 `richtext`로
담는다(`sourceType`에 원래 의도한 이름을 남긴다).

## 공통 코어 패턴

| 옛 블록 | 착지 타입 | 구성 |
|---|---|---|
| header(단원 헤더) | `title` | `text`(제목), `level:1`, `meta:{pill, page, source}`(단원/차시 배지·쪽수·출처 — 닫힌 형태, 그 외 자유 필드 금지) |
| section-heading(소제목) | `title` | `text`, `level:2` |
| standard-label(성취기준 라벨) | `std-box` | `codes:[...]`만(원문 창작 금지 — 슬롯 불변) |
| directive(활동 지시문) | `richtext` | `sourceType:'directive'` — 불릿/이모지 장식은 렌더러 몫이라 개체는 텍스트만 |
| resource-box(자료 제시 박스, 저작권 지문) | `passage-slot` | `slotLabel`(안내), `title`(제목), `source`, `footnotes[]` — 본문 원문은 절대 채우지 않음 |
| resource-box(label+value 1행 구조) | `table` | `rows:[[{text:라벨, header:true}, {text:값}]]` |
| answer-slot(밑줄) | `answer-area` | `style:'line'` |
| answer-slot(점선 박스) | `answer-area` | `style:'box'` |
| rubric(점검표) | `table` | `rows`에 점검 요소·점검 결과 열 구성 |
| reflection(성찰, "원칙 N가지" 둥근 박스) | `answer-area` | `style:'dots'` |

## 질문형 패턴 → question(qtype)

| 옛 문항 유형 | qtype |
|---|---|
| 단답 | `short-answer` |
| 서술형 | `essay` |
| 객관식(보기 있음) | `multiple-choice`(`choices:[{id,text}, ...]`) |
| 빈칸 채우기 | `fill-blank`(`blanks:[{id}, ...]`, `prompt` 내 `{{빈칸ID}}` 토큰) |
| 참/거짓 | `true-false` |
| 짝짓기 | `matching`(`left`/`right` 배열) |
| 순서 배열 | `ordering`(`items:[{id,text}, ...]`) |

인접한 정답 콘텐츠(질문 바로 뒤에 오는 정답 텍스트)는 별도 개체로 두지 말고 해당 `question`의
`answerKey:{text, html}`로 합친다.

## 교과 블록 팩

### [국어] passage · pro-con · memo
- `passage`(지문+각주) → `passage-slot`
- `pro-con`(2열 찬반 논거표) → `table`(`rows`에 찬성/반대 열, `caption`으로 표 제목)
- `memo-table`(토론 메모표) → `table`

### [과학] variable-table · data-table · svg-graph · formula
- `variable-table`(변인 통제표) → `table`
- `data-table`(데이터 기록표) → `table`(교사용 예시값 행은 `answer:true`)
- `svg-graph`(모눈 그래프 + 교사용 최적선) → `richtext`(`sourceType:'svg-graph'`, `answer:true` 오버레이가
  필요하면 별도 `richtext` 개체로 분리) — SVG 좌표 도형은 카탈로그 10종에 없으므로 탈출구로 흡수
- `formula`(KaTeX 수식) → `richtext`(`sourceType:'formula'`, `html`에 `$...$` 원문) — 매니페스트에
  KaTeX 플래그 필수

### [사회] map · timeline · source-analysis
- `map`(지도 슬롯) → `image-slot`(교사가 지도 이미지를 채우는 자리) 또는 표현이 애매하면 `richtext`
- `timeline`(연표) → `table`(가로 1행 다열 또는 세로 다행)
- `source-analysis`(자료 해석표) → `table`

### [영어] vocab · dialogue · cloze
- `vocab`(어휘 박스) → `table`(단어/뜻 2열) 또는 `richtext`
- `dialogue`(대화문) → `richtext`(`sourceType:'dialogue'`) — 화자 교대 서식은 표현 여지가 없어 탈출구
- `cloze`(빈칸 문법) → `question`(`qtype:'fill-blank'`)

## emphasis-box 구조 분기 (신규 타입 아님)
스파이크 원본 `emphasis-box`(강조 박스)는 신규 타입으로 만들지 않고 구조로 분기한다: 내용이 비어 있으면
`answer-area`(`style:'box'`, 학생이 채울 빈 여백), 텍스트가 채워져 있으면 `richtext`(정적 강조 텍스트).

## 매핑표 갱신 규칙
(카탈로그의 나머지 2종 `spacer`·`page-break` 은 레이아웃 전용 — 교사가 편집기에서 넣으므로 이 매핑표
대상이 아니다.)

새 패턴을 다뤄야 하면: (1) 위 10종 중 구조가 합치하는 타입이 있는지 먼저 확인, (2) 없으면 `richtext`로
흡수하고 `sourceType`에 이름을 남긴 뒤 이 문서에 임시 항목으로 등재, (3) `03_manifest.json`에
`escapeHatch: true`로 표시해 리뷰 대상으로 넘긴다. 카탈로그 자체를 확장하는 결정은 이 스킬의 권한 밖이다
(스키마 변경은 별도 계획 승인 필요).
