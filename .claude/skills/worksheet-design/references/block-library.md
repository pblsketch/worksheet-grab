# 블록 라이브러리 (references/block-library.md)

PoC(`poc/worksheet.html` 국어, `poc/science.html` 과학)에서 검증된 블록의 HTML/CSS 패턴. 각 블록은 **슬롯**(채워야 할 내용)을 가진다. 새 블록은 이 규약을 따른다.

## 공통 코어 블록 (전 교과)

### header — 단원 헤더
pill(교과명) + 라운드 제목박스 + 교과서/단원 참조 + 학년/반/이름 필드.
- 슬롯: `{pill}`, `{title}`, `{ref}`, `{unit}`
- 핵심 CSS: `.pill{background:var(--c);border-radius:20px}` `.title-box{border:2.2px solid var(--c2);border-radius:14px;text-align:center}`

### standard-label — 성취기준 라벨
`▣ 관련 성취기준` 박스 + `[코드] 원문` 리스트.
- 슬롯: `{standards[]}` — **원문 그대로**(창작 금지)
- `.std-box{border:1px solid;} .std-head{background:var(--clite);color:var(--cink)}`

### directive — 활동 지시문
원형/이모지 불릿 + bold 지시문. 슬롯: `{text}`. `.direct::before{content:"◐";color:var(--c)}`

### resource-box — 자료 제시 박스 (지문·읽기자료·사료·문제상황 공통)
테두리 박스 + 제목 가운데 + 본문 + 출처 + 각주. **저작권 자료는 `[지문 삽입 슬롯]`으로.**
- 슬롯: `{heading}`, `{body|slot}`, `{source}`, `{footnotes[]}`

### answer-slot — 답란
`.ans-line`(밑줄) / `.ansbox`(박스) / 표. 교사 정답은 `.answer`.

### rubric — 점검표/루브릭
`점검 요소 | 점검 결과(☆☆☆☆☆)` 표. `.rubric th{background:var(--cstrip)}`

### reflection — 성찰 문항
질문 + 넓은 답란 + "원칙 N가지" 둥근 박스.

## 교과 블록 팩

### [국어] passage(지문+각주) · pro-con(찬반 논거표) · memo(토론 메모표)
- pro-con: 2열(찬성/반대), 각 칸 `*이유/*근거` + 점선 구분. `.pc th.pro{background:#f7d9df}`(교과 무관 고정색 허용 — 찬반 의미색)

### [과학] variable-table(변인 통제표) · data-table(데이터 기록표) · svg-graph(모눈 그래프) · formula(KaTeX)
- variable-table: 준비물/조작/통제/종속 변인. `.k{background:var(--clabel)}`
- data-table: 측정값 표, 교사용 예시값은 `.answer`
- svg-graph: `<svg>` 모눈+축+라벨. 교사용 최적선은 `.plot-ans`(기본 display:none)
- formula: `$ R=\dfrac{V}{I} $` — KaTeX 로더 필요(export가 대기시간 부여)

### [사회] map(지도 슬롯) · timeline(연표) · source-analysis(자료 해석표)
### [영어] vocab(어휘 박스) · dialogue(대화문) · cloze(빈칸 문법)

## 슬롯 규약
- 슬롯은 `{name}` 표기. 디자이너가 아웃라인 내용으로 채운다.
- 정답이 있는 슬롯은 `.answer`로 감싼다.
- 새 블록 추가 시: 이름·슬롯·핵심 CSS를 이 문서에 등재하고 `03_manifest.json`에 신규 표시(리뷰 대상).
