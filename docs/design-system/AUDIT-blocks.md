# blocks.css 디자인 전수 감사 (impeccable critique)

> 대상: `assets/blocks.css` 전 블록(~50 클래스군). 기준: `PAPER.impeccable.md` 계약 + critique 체크리스트(polish·quieter·rhythm·contrast·restraint·consistency).
> 근거: 실물 렌더(과학 광합성·국어 설명문읽기, neutral 기본) + CSS 전문. 우선순위 없이 **전수**.
> 상태: 진단(read-only). 반영은 `PLAN-blocks-refine.md`/후속 커밋에서 L0 baseline 갱신과 함께.

## 범례
- 🟥 실질 개선 여지(계약 이탈/불일치) · 🟨 경미·취향 · 🟩 양호(참고)
- 각 항목: 관찰 → 계약 기준 → 개선안. **불변식(편집==인쇄·L0 동결·의미색/shape 고정)** 안에서만.

---

## A. 시스템 findings (전 블록 관통 패턴 — 최고 가치)

### S1 🟥 세로 리듬(블록 간 간격) 토큰화 불완전 — *rhythm*
- 관찰: 블록 진입 여백이 `--wg-space-block`(3mm)·`--wg-space-block-sm`(2mm) 토큰과 raw 값이 혼재.
  - 토큰: `.callout/.dash-box/.strip/.cmp/.pc/.rubric/.vocab/.dialogue/조직자` = `var(--wg-space-block,3mm)`; 과학군(`.qbox/.hbox/.vartable/.data/.formula/.graphwrap/.timeline tl-box`) = `--wg-space-block-sm(2mm)`.
  - raw: `.std-box{margin:4mm 0 0}` · `.direct{margin:7mm 0 3mm}` · `.q{margin:2.5mm 0 1.5mm}` · `.subq{margin:2mm 0 1mm}` · `.section h2.sec{margin:3mm 0 1.5mm}` · `.unit-line{margin-top:5mm}`.
- 기준(rhythm): 블록 간 리듬은 소수의 토큰 스케일로 예측 가능해야 한다.
- 개선: 진입 여백을 스케일(예: `--wg-space-block`=3mm 표준, `-sm`=2mm 조밀, 신규 `-lg`=5mm 섹션 진입)로 수렴. `.direct` 7mm→섹션 진입 토큰, `.q/.subq`는 조밀 토큰. **L0: font/rule/radius 외 margin 토큰은 baseline 재생성 필요.**

### S2 🟥 폰트 크기 아웃라이어 — *restraint/hierarchy*
- 관찰: 대부분 `--wg-fs-*`이나 raw pt 잔존. **가장 큰 문제는 `9.3pt` 클러스터**(`.answer`·`.rubric td`·`.vocab td`·`.timeline .tl-year`) — 토큰 스케일(9pt label / 9.5pt body)에 없는 중간값이 4곳. 그 외 `.corner-ref 8.5pt`·`.direct 11pt`·`.cmp th/.pc th/h2.sec .n 10pt`·`.passage .fn 8.3pt`·`.image-slot .is-alt 8.5pt`·`.kwl th span/.mapbox .map-source 8pt`.
- 기준: 타이포는 닫힌 스케일. 임의 중간값 금지.
- 개선: `9.3pt`→`--wg-fs-label(9pt)` 또는 `body(9.5pt)`로 흡수. `8.5/8.3/8pt`→`--wg-fs-caption(8.7pt)` 또는 신규 `--wg-fs-fine`. `10pt`→`--wg-fs-label`+bold 또는 신규 `--wg-fs-sub`. `.direct 11pt`→신규 `--wg-fs-directive` 또는 heading 스케일. **L0-1f 카운트(62) 변동 → 갱신.**

### S3 🟥 강조 괘선 난립 — *restraint/emphasis*
- 관찰: 강조 테두리 폭이 `1.2/1.3/1.4/1.5/1.6/2.2px` 6종 산발. `.callout/.dialogue/.q-box 1.4` · `.passage(fallback)/.qbox/.mapbox 1.5` · `.dash-box/.image-slot.placeholder/.princ/.hbox 1.6` · `.title-box 2.2` · `.q-order-box/.q-bank 1.2` · SVG stroke 1.3. 계약이 정의한 `--wg-rule-w-emph(1.6px)`를 **아무도 안 씀**.
- 기준: 괘선 2단(헤어라인 + 강조). 근사 중복 폭 금지.
- 개선: 강조 폭을 `--wg-rule-w-emph`(1.6px) 1개(또는 +강조강 `-emph2` 2.2px 제목 전용)로 수렴. `1.4/1.5/1.6`→emph 토큰, `2.2`(title-box)→emph2 또는 유지. `1.2`(작은 체크박스)는 hairline로. **L0: border-width는 현재 미토큰 → 토큰 도입 시 baseline 재생성.**

### S4 🟨 회색 잉크 규율 부재 — *consistency*
- 관찰: 같은 "캡션/출처" 역할에 `#555/#666/#777`가 혼용(`.title-src #666`·`.passage .src #555`·`.gcap #555`·`.org-cap #666`·`.map-source #777`). 본문 잉크도 `#333/#2f2f2f/#444` 혼재.
- 기준: 잉크 스케일은 역할별 1값(캡션=연한 1단, 본문=진한 1단).
- 개선: 역할→값 매핑 고정(캡션 `#666`, 부가주석 `#777`, 본문 `#333`, 강본문 `#2f2f2f`). 계약 inkScale를 "역할표"로 승격. **allowlist 색이라 design-lint는 통과 — 순수 일관성 정리.**

### S5 🟨 헤더밴드 유형 혼재 — *consistency*
- 관찰: 헤더 밴드가 3계열 혼용 — 옅은틴트(`.std-head`·`.qbox .lab`=`--clite`+`--cink`) / 강채움(`.strip .sh`·`.data th`·`.rubric th`·`.memo th`·`.vocab th`=`--cstrip`+#fff) / 라벨(`.lv-table .label`·조직자 th=`--clabel`+`--cink`). 유형 선택 규칙이 문서화 안 됨.
- 기준: 헤더 유형은 의미(주 섹션/표머리/라벨)에 매핑돼 예측 가능해야.
- 개선: 계약에 "헤더 3종 + 언제 무엇" 규칙 명문화(코드 변경 최소, 문서화 위주). 필요 시 소수 재배치.

### S6 🟥 정보 위계 — 교사 전용 참조박스가 주 정보와 동일 무게 — *polish*
- 관찰: `.std-ref`(근거성취기준, 교사전용 2차)가 `.std-box`(학습목표, 1차)와 **완전 동일** 렌더(실물 확인). 위계 신호 0.
- 기준: 주 vs 부 위계 시각화.
- 개선: `.std-ref` 헤더 무채색화 + 옅은 테두리(surface/ink allowlist). ※ 이전 시도가 L0 충돌로 롤백 → **이번엔 baseline 갱신과 함께** 정식 반영.

### S7 🟨 radius 아웃라이어 — *restraint*
- 관찰: 대부분 `--wg-radius-*`(4/6/8)이나 raw: `.title-box 14px`·`.image-slot.placeholder/.princ 10px`·`.pill 20px`·`.q-bank-chip 12px`. 이 중 `pill 20px`·`chip 12px`는 shape 불변(알약)이라 유지 대상. `14px/10px`는 스케일 밖.
- 개선: `14px`→`--wg-radius-lg(8px)` 또는 신규 `-xl`; `10px`→`-lg`. 알약/원은 shapeInvariants 유지.

---

## B. 블록 그룹별 전수 감사

### B1. 헤더(title-wrap·pill·corner-ref·title-box·unit-line·namefield)
- 🟩 title-box 위계·중앙정렬 양호. 🟨 `.title-box` border 2.2px(S3)·radius 14px(S7)·`.title-src #666`(S4)·`.corner-ref 8.5pt`(S2). 🟨 pill radius 20px=알약(유지). 🟩 namefield 밑줄 적절.

### B2. std-box / std-ref (학습목표·성취기준)
- 🟥 **S6 위계**(핵심). 🟩 나머지(토큰·색) 양호.

### B3. callout(note/tip/warning/summary)
- 🟩 의미색 체계·헤더밴드 일관 양호(계약 준수). 🟨 border 1.4px(S3). 🟩 tip/warning/summary 대비 흑백에서도 톤차 유지(양호).

### B4. 시맨틱 태그(code/pre/dl/dt/dd)
- 🟩 무채색 고정·surface 배경 양호. 🟨 `code #f2f3f5`·`pre #f7f8fa`(surface allowlist, OK).

### B5. directive(.direct)·qnum·subq
- 🟥 `.direct 11pt` raw(S2)·`margin 7mm`(S1). 🟩 glyph 분기·qnum 원형(shape 유지) 양호. 🟨 `.subq/.q` 리듬 raw(S1).

### B6. lv-table / dash-box / strip / cmp (국어)
- 🟨 dash-box border 1.6px(S3)·`.dash-box .dh`·`.cmp th 10pt`(S2)·`.cmp .hl #efe6f7`(비allowlist 하이라이트 — baseline 유예 중이나 의미색 후보). 🟩 strip 헤더밴드 양호.

### B7. passage(지문 박스)
- 🟩 슬롯 의미색(#b06a00 계열)·인라인 오버라이드 토큰(--wg-ps-*) 양호. 🟨 border 1.5px fallback(S3)·`.fn 8.3pt`(S2)·`.src #555`(S4).

### B8. obj-table(공통 표)
- 🟩 인라인 오버라이드(--wg-tb-*)·토큰 양호. 🟩 caption·th 틴트 양호.

### B9. image-slot
- 🟩 max-width·figcaption 양호. 🟨 placeholder border 1.6px(S3)·radius 10px(S7)·`.is-alt 8.5pt`(S2)·아이콘 stroke 1.6(S3 계열).

### B10. question + answer + qtype 변형(choices/tf/box/match/order/short/essay/bank)
- 🟩 qtype별 시각 구분 잘 됨(양호). 🟨 `.q-box 1.4px`·`.q-order-box 1.2px`·`.q-bank 1.2px dashed`(S3)·`.q-bank-label 8.7pt`(OK). 🟨 `.ans-line/.ansbox #ccc`(잉크 S4). 🟩 answer 의미색(#1a5fb4) 고정 양호.

### B11. pro/con·memo·reflection(princ)·rubric
- 🟩 pc 의미색(찬반)·rubric 별점(#f0a500) 고정 양호. 🟥 `.answer/.rubric td 9.3pt`(S2 핵심 클러스터). 🟨 princ border 1.6px·radius 10px(S3/S7).

### B12. shape(wg-shape)·text(wg-text)
- 🟩 인라인 오버라이드 토큰·non-scaling-stroke 양호. 🟩 좌표 앵커 모델 불변식 준수(건드리지 말 것).

### B13. section heading(h2.sec)
- 🟨 `.n 10pt`(S2)·원형(shape 유지). 🟩 flex 정렬 양호.

### B14. 과학(qbox/hbox/vartable/data/formula/graphwrap)
- 🟩 조밀 리듬(-sm)·헤더 강채움 일관 양호. 🟨 qbox/hbox border 1.5/1.6px(S3)·`.data td .a #1a5fb4`(정답 의미색, 양호).

### B15. 사회(mapbox/timeline)
- 🟨 mapbox border 1.5px(S3)·`.map-source #777 8pt`(S2/S4)·`.tl-year 9.3pt`(S2 클러스터). 🟩 SVG 잉크(map-land 등) 조직자 잉크 subsystem(baseline 유예, 유지).

### B16. 영어(vocab/dialogue)
- 🟥 `.vocab td 9.3pt`(S2 클러스터). 🟨 dialogue border 1.4px(S3). 🟩 헤더 강채움 일관.

### B17. 조직자 Track A 표형(kwl/frayer/w5h1/bme/exit321/mainidea)
- 🟩 라벨 헤더밴드·토큰 리듬 일관 양호. 🟨 `.kwl th span 8pt`(S2). 🟩 셀 높이 고정 적절.

### B18. 조직자 배치2(notetaking/hamburger/perspectives/prediction/glowgrow/stoplight)
- 🟩 표형 일관 양호. 🟩 stoplight 의미색(신호등) 고정 양호. 🟨 `.stoplight td.sl 18pt`(아이콘 크기 — 사실상 글리프, 유지 가능).

### B19. 조직자 Track B SVG(venn/conceptmap/fishbone/plotdiagram/hierarchy/flowchart/hexagon)
- 🟩 CSS-only 색(HTML SVG hex 0)·범교과 게이트 준수 양호. 🟨 SVG stroke 1.2~1.4(S3 계열이나 SVG는 별 subsystem — 유지 가능). 🟩 텍스트 fill #333 일관.

### B20. 조직자 배치3(character/bookreview/quotejournal)·essayplan
- 🟩 표형·섹션 스택 일관 양호. 🟨 lab 배경 #f6f6f6(surface, OK).

---

## C. 개선 카탈로그 (전수·비우선순위) — 반영 대상

| # | 항목 | 성격 | 반영 방식 | L0 영향 |
|---|---|---|---|---|
| C1 | S6 정보 위계(.std-ref 무채색화) | 🟥 polish | blocks.css + surface/ink allowlist | baseline 재생성 |
| C2 | S3 강조괘선 → `--wg-rule-w-emph` 수렴 | 🟥 restraint | 1.4/1.5/1.6→emph 토큰, 2.2 title 유지/emph2 | baseline 재생성 |
| C3 | S2 9.3pt 클러스터 → label/body 흡수 | 🟥 restraint | answer/rubric/vocab/tl-year | L0-1f 카운트 갱신 |
| C4 | S2 기타 pt 아웃라이어(8.5/8.3/8/10/11) 토큰화 | 🟨 | caption/신규 fine·sub·directive 토큰 | L0-1f 갱신 |
| C5 | S1 리듬 raw(std-box/direct/q/subq/unit-line) 토큰화 | 🟥 rhythm | space 토큰 스케일 확장 | baseline 재생성 |
| C6 | S7 radius 14/10px → 스케일 | 🟨 | radius-lg/신규-xl | L0-1c 갱신 |
| C7 | S4 잉크 역할표 고정(캡션/주석/본문) | 🟨 consistency | 값 통일(allowlist) | baseline 재생성 |
| C8 | S5 헤더밴드 3종 규칙 문서화 | 🟨 | 계약 문서(코드 최소) | 없음 |

## 반영 순서(안전)
1. **C1(위계)** — 가장 명확·저위험(색만). 2. **C3(9.3pt)** — 토큰 흡수(카운트 갱신). 3. **C2(강조괘선)** — 토큰 수렴. 4. C5(리듬)·C7(잉크)·C6(radius)·C4(잔여 pt). 5. C8(문서).
각 batch: blocks.css 편집 → `blocks-css-baseline.json` 재생성(신규 스크립트) → L0-1b~f 카운트 조정 → design-lint + L0 + 렌더 + parity + PNG 육안.

## 불변식 준수(전 항목)
편집==인쇄 · 닫힌 카탈로그(신규 타입 0) · `.sheet` 기하 · 의미색/shape/조직자 잉크 무드 무변형 · AI 좌표 미생성. blocks.css 변경은 반드시 L0 baseline 갱신 동반.
