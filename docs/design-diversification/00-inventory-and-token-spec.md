# P0-1 · blocks.css/paper.css 하드코딩 인벤토리 + 확장 토큰 스펙 초안

> 대상 저장소: `E:/github/worksheet-grab` (읽기 전용 분석 — 소스 미수정)
> 관련 계획: `C:/Users/wnsdl/.cokacdir/workspace/xr9oi751/wsdemo/DESIGN-DIVERSIFICATION-PLAN.md` Phase 0
> 작업자: worker-1 (wg-design-diversify) · 작성일 2026-08-05

---

## 0. 렌더 파이프라인 요약 (CSS 조립 지점)

CSS는 **3개 파일이 하나의 `<style>` 블록으로 문자열 concat**되어 최종 HTML에 주입된다. 무드 토큰을 얹을 때 이 조립 순서/경로가 접점이 된다.

| 단계 | 파일/함수 | 역할 |
|---|---|---|
| 1 | `assets/paper.css` | 용지 코어(A4, `.sheet`, 다단, running head/foot, mode-badge). 교과 무관. |
| 1b | `src/usecases/paper.js` → `paperCss(resolved)` | `manifest.paper` 있을 때만 `@page` 숫자 리터럴 + `:root{--sheet-w/-h/-pad/-pad-l/-pad-r/-cols/-colgap/-colh}` 를 paper.css **뒤에** 인라인 삽입(미지정 시 주입 0 = 바이트 불변). |
| 2 | `assets/blocks.css` (480줄) | 전 교과 공유 블록 컴포넌트(제목/표/조직자/문항 등). 교과색은 `var(--c* )` 6종만 참조하는 것이 원칙(주석 규정, 실제로는 대량의 크기/색/간격 하드코딩 존재 — 본 문서의 대상). |
| 3 | `themes/{ko,sci,social,english}.css` | `Theme` 클래스(`src/domain/Theme.js`)가 정의하는 `THEME_TOKENS = ['--c','--c2','--clite','--cstrip','--clabel','--cink']` 6종만 `:root`에 선언. `FsBlockRepository.loadThemeCss()`가 파일로 로드. |
| 조립 | `src/usecases/AssembleWorksheet.js` → `buildDocumentHtml()` (274~292행) | `<style>${paperCss}\n\n${blocksCss}\n\n${themeCss}</style>` 순서로 단순 문자열 결합. `RenderObjectTree.execute()` (개체 트리 경로)도 동일 함수를 재사용해 같은 골격을 방출. |

**핵심 관찰**: 색 토큰(`Theme`)은 이미 "값은 테마 CSS, 참조는 `var()`"로 분리되어 있으나, **크기/간격/괘선/모서리는 이 분리가 전혀 없다** — blocks.css에 리터럴로 박혀 있어 "교과색만 바뀌는 recolor-only" 한계의 실제 원인이다(계획서 문제정의와 일치).

**기존 선례 — 이미 존재하는 `--wg-*` 인라인 오버라이드 패턴** (신규 토큰 네이밍 충돌 방지용으로 반드시 확인):

| 변수 | 위치 | 용도 |
|---|---|---|
| `--wg-ps-border`, `--wg-ps-bw`, `--wg-ps-bg` | blocks.css `.passage` / `RenderObjectTree.js` 307~313행 | 개체별 지문 박스 테두리색/두께/배경 인라인 오버라이드 |
| `--wg-tb-color`, `--wg-tb-width` | blocks.css `.obj-table` / `RenderObjectTree.js` 471~473행 | 개체별 표 테두리색/두께 인라인 오버라이드 |
| `--wg-fs`, `--wg-color`, `--wg-align` | blocks.css `.wg-text` | 텍스트 상자 개체 폰트크기/색/정렬 |
| `--wg-fill`, `--wg-stroke`, `--wg-sw`, `--wg-dash` | blocks.css `.wg-shape` / `RenderObjectTree.js` 562~569행 | 도형 개체 채움/선 스타일 |
| `--wg-grid-alpha` | `src/editor/editorStyle.js` 171행 | 편집기 화면 전용 격자 투명도(인쇄본 무관) |

→ 이들은 **개체(instance) 단위** 오버라이드다. 아래 4장에서 제안하는 신규 토큰은 **문서(mood) 단위** 기본값이므로 이름공간이 겹치지 않게 별도 접두어(`--wg-fs-*` 복수형 스케일, `--wg-space-*`, `--wg-rule-*`, `--wg-radius-*`, `--wg-head-*`)를 썼다. 위 8개 기존 이름과 충돌 없음을 확인했다(계획서 66행이 제안한 접두어와 합치).

---

## 1. 하드코딩 인벤토리

값은 blocks.css/paper.css 전수 스캔(정규식 추출 + 빈도 집계) 결과. **빈도는 "완전히 동일한 리터럴 문자열" 기준**이며, 같은 의미라도 단위/소수점이 다르면(`1px` vs `1.2px`) 별도 행이다.

### 1-a. font-size (blocks.css, 총 78개 선언 중 상위)

| 값 | 빈도 | 대표 위치 |
|---|---|---|
| `9.5pt` | 32 | `.q-choices li`, `.lv-table td`, 표 계열 td 다수(가장 흔한 "본문/셀" 크기) |
| `9pt` | 14 | `.std-box .std-head`, `.callout-head`, `.qbox .lab`, `h2.sec .n` 등 "라벨/헤드" 계열 |
| `8.7pt` | 8 | `.corner-ref`, `.title-src`, `.image-slot figcaption`, `.org-cap` 등 "캡션/보조정보" |
| `12pt` | 6 | `.passage h3`, `h2.sec`, `.formula`, `.quotejournal` 등 "소제목/수식" |
| `9.3pt` | 4 | `.timeline .tl-year`, `.rubric td`, `.vocab td.w` |
| `8pt` | 2 | `.kwl th span`, `.exit321`(주석 텍스트) |
| `8.5pt` | 2 | `.corner-ref`(파일 내 중복 다른 값), `.image-slot .is-alt` |
| `10pt` | 2 | `.pc th`, `.hierarchy`(참고: 파일 내 표기 편차) |
| `8.3pt` | 1 | `.passage .fn` |
| `20pt` | 1 | `.title-box h1` (문서 제목 — 최대값) |
| `18pt` | 1 | `.stoplight td.sl` (신호등 이모지) |
| `13pt` | 1 | `.direct::before` (방향 지시 글리프 아이콘) |
| `11pt` | 1 | `.direct`, `--wg-fs`(`.wg-text` 폴백) |
| `10.5pt` | 1 | `.pill` (배지 텍스트) |
| `.92em` | 1 | `code`(상대 단위, 본문 대비 배율) |

→ 실질적으로 **3단 클러스터**(캡션 8.7~9pt대 / 본문 9.3~9.5pt대 / 소제목 12pt대) + **outlier 4~5개**(제목 20pt, 배지 10.5pt, 아이콘 13pt, 강조 11pt, 신호등 18pt)로 요약된다.

### 1-b. 색상 hex (blocks.css, 소문자 정규화 기준 상위 — 전체 56종 중 발췌)

| 값 | 빈도 | 대표 위치 | 성격 |
|---|---|---|---|
| `#cbd5c0` | 29 | 표/박스 테두리(`.std-box`, `.lv-table td`, `.obj-table` 폴백 등) 전역 | **구조색(hairline border)** — 토큰화 최우선 후보 |
| `#fff` | 16 | `.callout`, `.image-slot.placeholder`(아이콘 원), 각종 흰 배경 | 구조색(카드/필드 배경) |
| `#555` | 10 | `.corner-ref`, `.namefield`, `.passage .src` 등 보조 텍스트 | 텍스트 잉크(회색조 스케일 일부) |
| `#fbfcfb` | 8 | `.strip .sb`, `.qbox`, `.q-match-l/r` 등 옅은 카드 배경 | 구조색 |
| `#777` | 8 | 다이어그램(SVG organizer) 선/텍스트 잉크 | 조직자 전용 잉크 |
| `#ccc` | 6 | `.ans-line`, `.ansbox`, `.cmp td` 테두리 | 구조색(밑줄/얇은 테두리) |
| `#bbb` | 6 | `.passage`(폴백), `.q-short-line`, `.dialogue .blank` 밑줄 | 구조색 |
| `#888` | 6 | `.q-box`, 순서흐름도/헥사곤 SVG 잉크 | 조직자 전용 잉크 |
| `#666` | 6 | `.title-src` 주석 텍스트, SVG 잉크 | 텍스트 잉크 |
| `#333` | 6 | `.passage p`, SVG venn/hierarchy 텍스트 fill | 텍스트 잉크(본문 기본) |
| `#f6f6f6` | 5 | `.w5h1 td.lab`, `.character td.lab` 등 라벨 셀 배경 | 구조색 |
| `#1a5fb4` | 3 | `.answer`, `.data td .a` — **정답 하이라이트 블루** | **의미색(고정, 교과·무드 무관)** — 파일 헤더 주석에 명시된 예외 |
| `#f0a500` | 2 | `.rubric td.stars` — 별점 골드 | **의미색(고정)** |
| 기타 43종 | 각 1~2 | callout 3변형(tip/warning/summary), pro/con, stoplight, mode-badge, SVG 조직자별 잉크 등 | 대부분 **의미색/조직자 전용색** (아래 3장 제외근거 참조) |

이미 토큰화된 색(비교 기준) — `Theme.THEME_TOKENS`(themes/*.css `:root`에서 정의, blocks.css는 `var(--c/--c2/--clite/--cstrip/--clabel/--cink)`로만 참조):

| 토큰 | 국어 green | 과학 teal | 사회 amber | 영어 indigo |
|---|---|---|---|---|
| `--c` | #7cb342 | #00838f | #b26a00 | #3949ab |
| `--c2` | #8bc34a | #26a69a | #cc7a1a | #5c6bc0 |
| `--clite` | #f6faf0 | #e0f2f1 | #fbf1e2 | #e8eaf6 |
| `--cstrip` | #9ccc65 | #4db6ac | #dd9a4a | #7986cb |
| `--clabel` | #dcedc8 | #b2dfdb | #f0d9b5 | #c5cae9 |
| `--cink` | #558b2e | #00695c | #8a5200 | #283593 |

> 참고(범위 밖 발견): `.claude/skills/worksheet-design/references/themes.md`의 사회 팔레트 표기(`#b8860b` 등)가 실제 `themes/social.css`(`#b26a00` 등)와 어긋나 있다. 토큰 스펙과 무관한 문서 드리프트이므로 별도 기록만 남긴다.

### 1-c. 간격 — padding / margin / gap (blocks.css)

**세로 리듬(블록 간 상단 여백, mm 단위)** — 가장 반복적인 패턴:

| 값 | 빈도 | 대표 위치 |
|---|---|---|
| `margin-top: 3mm` | 16 | `.std-box`, `.dash-box`, `.strip`, `.rubric`, `.mapbox`, `.timeline`, `.vocab`, `.dialogue`, `.kwl/.frayer/...`(시각 조직자군), `.essayplan` 등 — **컴포넌트 진입 간격의 사실상 표준값** |
| `margin-top: 2mm` | 7 | `.qbox`, `.hbox`, `.vartable`(부모 선언), `.data`, `.formula`, `.graphwrap`, `.obj-table`(margin 단축형) |
| `margin: 7mm 0 3mm`(`.direct`), `margin-top: 5mm`(`.unit-line`) 등 | 각 1 | 섹션급 대여백(문항 지시문 진입 등) |

**박스 내부 padding(px 단위, shorthand)** — 상위 빈도:

| 값 | 빈도 | 대표 위치 |
|---|---|---|
| `8px 10px` | 9 | `.lv-table td`, `.vartable td`, `.kwl/.frayer/...td` 계열(표 셀) |
| `8px 12px` | 3 | `.callout-body`, `.qbox`, `.hbox` |
| `6px 9px` | 2 | `.obj-table th/td`, `.vocab td` |
| `padding: 0`(초기화) | 5 | `code pre`, 다수 리셋 |
| `2px 10px`~`5px 12px` 등 | 각 1~3 | 라벨칩류(`.dash-box .dh`, `.qbox .lab`, `.mapbox .maphead`) — 서로 미묘히 다른 값이 난립 |

**flex `gap`(px)**: `8px`(4곳: `.direct`, `h2.sec`, `.dialogue .turn`, `.q-order li`), `6px`(4곳: `.q-choices`, `.q-tf label`, `.q-tf-list`, `.timeline .tl-row`, `.q-bank`), `4px`(1곳), `24px`(1곳, `.q-tf` 좌우 큰 간격 — 의도적 outlier).

→ 간격은 색·크기보다 **분산이 큼**(같은 "표 셀 padding" 의도인데도 `8px 10px`/`8px 12px`/`6px 9px`/`5px 9px`/`5px 10px` 등 미세하게 다른 값이 컴포넌트마다 존재) — 전량 단일 토큰화 시 시각적 균질화 위험(4장/5장에서 다룸).

### 1-d. 모서리 — border-radius (blocks.css, 36개 선언)

| 값 | 빈도 | 대표 위치 |
|---|---|---|
| `6px` | 10 | `.strip`, `.ansbox`, `pre`, `.image-slot img`, `.timeline .tl-box` 등 — **중간 크기 박스 표준** |
| `8px` | 9 | `.std-box`, `.callout`, `.title-box`(과 함께 14px 별도), `.qbox`, `.hbox`, `.mapbox`, `.passage` — **큰 카드 박스 표준** |
| `4px` | 5 | `.corner-ref`, `.pill`(과 함께 20px 별도 요소), `.dash-box .dh`, `.q-order-box`, `h2.sec` 배지류 |
| `50%`(원형) | 4 | `.qnum`, `.timeline .tl-dot`, `h2.sec .n`, `.q-tf .q-box`류 원/점 — **구조적 형태(shape), 모서리 "정도"가 아님** |
| `3px` | 3 | `code`, `.cmp .hl` |
| `10px` | 2 | `.image-slot.placeholder`, `.princ` |
| `20px` | 1 | `.pill`(알약형 배지 — shape) |
| `14px` | 1 | `.title-box`(문서 제목 카드 — 유일하게 8px 클러스터를 벗어난 특대값) |
| `12px` | 1 | `.q-bank-chip`(알약형 칩 — shape) |
| `5px` | 1 | `.passage .slot` |

→ `4/6/8px` 3단 클러스터가 지배적이며, `50%`/`20px`/`12px`는 "둥근 정도"가 아니라 **원·알약 형태(shape) 그 자체**라 무드가 바뀌어도 형태는 유지돼야 함(제외 후보, 3장 참조).

### 1-e. 괘선(border) 두께/색

**두께(px, `solid|dashed|dotted`와 함께 쓰인 border 선언 57건 기준)**:

| 두께 | 빈도 | 대표 위치 |
|---|---|---|
| `1px` | 42 (전체의 74%) | 표 셀(`.lv-table`, `.cmp`, `.obj-table` 등 거의 전 표), 밑줄(`.ans-line`, `.q-short-line`) — **사실상의 기본 헤어라인** |
| `1.6px` | 4 | `.callout`, `.dash-box`, `.image-slot.placeholder`, `.hbox`(강조 대시 박스류) |
| `1.4px` | 3 | `.callout`, `.dialogue`(과목색 `var(--c2)` 강조 테두리), `.q-box`(체크박스, `#888`) |
| `1.5px`, `1.2px` | 각 2 | `.passage`(폴백 1.5px), `.q-order-box`/`.q-tf-list` 근접값 |
| `2px`, `2.2px` | 각 1 | `.timeline`(3px는 별도 top-border), `.title-box`(2.2px — 문서 제목 카드, 유일 특대값) |

**색(테두리 전용 hex, 1-b와 중복되나 "선" 맥락만 발췌)**: `#cbd5c0`(29, 압도적 1위 — 표/박스 공통 헤어라인 색), `#ccc`/`#bbb`(밑줄류 12), `#999`/`#888`(구두점·체크박스 보더) — **`#cbd5c0` + `1px`이 blocks.css 전체에서 가장 지배적인 "괘선 아이덴티티"**임이 정량적으로 확인된다.

> 이미 이 정확한 패턴을 토큰화한 선례가 파일 안에 있다: `.obj-table th, .obj-table td { border: var(--wg-tb-width, 1px) solid var(--wg-tb-color, #cbd5c0); }`(124~128행), `.passage { border: var(--wg-ps-bw, 1.5px) solid var(--wg-ps-border, #bbb); }`(112행). 4장 제안 토큰은 이 선례를 "개체별 오버라이드"에서 "**문서(무드) 기본값**"으로 한 단계 위에 얹는 것과 같은 모양이다.

---

## 2. paper.css 하드코딩 스캔 (84줄, 참고용 — 블록과 성격이 다름)

paper.css는 애초에 **"교과 무관 공통 코어"**로 설계되어 색 하드코딩이 거의 없고(`#222`/`#eee`/`#fff`/`#8a8f98` 등 6개뿐, 전부 레이아웃 뼈대색), 이미 `--sheet-*` 변수군(`--sheet-w/-h/-pad/-pad-l/-pad-r/-cols/-colgap/-colh`)으로 상당 부분 파라미터화되어 있다(`paper.js`가 주입). 무드가 건드릴 여지가 있는 것은:

- `font-size: 10.5pt`(body 기본 크기, 9행) — blocks.css의 `.pill` 10.5pt와 우연히 같은 값이나 별개 선언.
- `.mode-badge`/`.run-head`/`.run-foot` 의 `font-size: 8pt`, `color: #8a8f98` — 학생/교사 배지·러닝헤더 색(의미색 성격, 교과·무드와 무관하게 고정 권장).
- `border-radius: 4px`(`.mode-badge`) — blocks.css `4px` 클러스터와 동일값(토큰 재사용 가능 후보).

paper.css 자체는 인벤토리 표에서 별도 집계하지 않고 위 3줄 관찰로 충분(볼륨이 작고 이미 파라미터화 선례가 확립돼 있어 리스크가 낮음).

---

## 3. 제외 근거 (무드 무관 하드코딩 — 토큰화하지 않음)

브리핑 원칙("무드가 실제로 바꿀 속성만" 대상) 및 계획서 Phase 1 범위(53행: "무드가 실제로 바꾸는 속성으로 범위 한정")에 따라 아래 카테고리는 **의도적으로 토큰 스펙에서 제외**한다.

| 카테고리 | 예시 | 제외 근거 |
|---|---|---|
| **의미색(semantic color)** | 정답 블루 `#1a5fb4`(3곳), 별점 골드 `#f0a500`(2곳), callout 3변형(tip `#b9d8c4/#e6f2ea/#235c39`, warning `#eccfa3/#fbeedd/#895014`, summary `#c7cdef/#eceefa/#313c78`), 찬반 `#f7d9df/#a03a52`·`#dfe6f2/#35507e`, 신호등 `#d32f2f/#f9a825/#388e3c`, 모드배지 `#eef4fc/#1a5fb4`·`#fdeaea/#c0392b` | 색 자체가 **의미를 나르는 상태 신호**(정답/경고/찬반/모드)다. blocks.css 헤더 주석(4~5행)에 이미 "교과 무관 고정색" 예외로 명문화. 무드가 바뀌어도 "정답=파랑" 판독성이 유지돼야 하므로 무드 축에서 변형하면 안 된다. |
| **조직자 전용 잉크(diagram ink)** | venn/conceptmap/fishbone/hierarchy/flowchart/hexagon SVG의 `#333/#777/#888/#999/#aaa/#eef1f4/#666` 등 | `OrganizerGen`이 생성하는 SVG 전용 색으로, 이미 자체적으로 반복 사용되는 소규모 스케일(사실상 이미 "일관됨")이며 blocks.css 나머지 UI 요소와 별개 서브시스템. 무드 확장 시 별도 워크스트림(diagram-ink 팩)으로 분리하는 편이 안전 — 이번 스펙 범위 밖. |
| **중립 배경 화이트/그레이 계열** | `#fff`(16), `#fbfcfb`(8), `#f6f6f6`(5), `#f2f2f2`/`#ededed`(각 1~2) | 저채도 배경은 시각적 임팩트가 낮고, 컴포넌트마다 미묘히 다른 톤(순백 vs 옅은 그레이)이 "표/입력칸 구분"이라는 기능적 이유로 쓰여 하나의 토큰으로 뭉치면 오히려 구분력을 잃는다. v2 후보(`--wg-surface-alt`)로만 메모. |
| **텍스트 잉크 그레이 스케일** | `#555/#666/#777/#888/#999/#333/#444/#2f2f2f/#8a8a8a` | 이미 사실상 하나의 잘 분화된 스케일(캡션은 연하게, 라벨은 진하게)로 기능하고 있고, 각 값의 반복이 낮아(1~10회) 무드별로 통째 스왑할 만큼의 "무드 임팩트"가 크지 않음. 잘못 뭉치면 정보 위계가 오히려 붕괴. |
| **원형/알약형 반경(shape radius)** | `50%`(4곳: `.qnum`, `.tl-dot`, `h2.sec .n` 등), `20px`(`.pill`), `12px`(`.q-bank-chip`) | "둥근 정도"가 아니라 **원·캡슐 형태 자체**를 정의하는 값. 무드가 "각진" 쪽이어도 배지가 사각형이 되면 안 되는 종류의 하드코딩(형태 불변식) — radius 스케일 토큰 대상에서 제외. |
| **`@page { size: A4; margin: 0; }`** | paper.css 5행 | Chrome이 `@page`에서 `var()`를 해석하지 못함(파일 자체 주석 15~16행 명시). 애초에 CSS 커스텀 프로퍼티로 표현 불가능 — 토큰화 대상이 아니라 `paper.js`가 숫자 리터럴을 직접 덮어쓰는 별도 메커니즘으로 이미 처리 중. |
| **`.sheet` 자체의 border(현재 미선언=0)** | paper.css 17~30행 주석 | 값이 아니라 "속성을 추가하지 않는 것" 자체가 불변식(4장 아래 리스크 메모 참조). 토큰 대상 아님. |

---

## 4. 확장 토큰 스펙 초안 (총 20개)

계획서(Phase 1, 66행)가 예고한 접두어(`--wg-fs-*`, `--wg-space-*`, `--wg-rule-*`, `--wg-radius-*`, `--wg-head-*`)를 그대로 채택해 다운스트림(Phase 1 구현자)이 바로 쓸 수 있게 했다. **모든 토큰은 `var(--token, 현행리터럴)` 형태로 fallback = 1-a~1-e에서 실측한 현행 리터럴과 정확히 일치**시켜야 "무드 미지정 = 바이트 무회귀"(계획서 AC1)가 성립한다.

### 4-a. 타이포 스케일 (6개)

| 토큰 | 타입 | 현행 폴백 리터럴 | 매핑되는 현행 하드코딩 위치(1-a) |
|---|---|---|---|
| `--wg-fs-title` | `<length>`(pt) | `20pt` | `.title-box h1` (문서 제목, 유일 대형값) |
| `--wg-fs-heading` | `<length>`(pt) | `12pt` | `.passage h3`, `h2.sec`, `.formula`, `.frayer caption` 등 6곳 |
| `--wg-fs-pill` | `<length>`(pt) | `10.5pt` | `.pill` (교과 배지 텍스트) |
| `--wg-fs-label` | `<length>`(pt) | `9pt` | `.std-box .std-head`, `.callout-head`, `.qbox .lab`, `.mapbox .maphead` 등 14곳(라벨/헤드 클러스터) |
| `--wg-fs-body` | `<length>`(pt) | `9.5pt` | 표 셀·리스트 항목 등 32곳(가장 넓은 "본문" 클러스터) |
| `--wg-fs-caption` | `<length>`(pt) | `8.7pt` | `.corner-ref`, `.title-src`, `.image-slot figcaption`, `.org-cap` 등 8곳 |

### 4-b. 간격 리듬 (6개)

| 토큰 | 타입 | 현행 폴백 리터럴 | 매핑되는 현행 하드코딩 위치(1-c) |
|---|---|---|---|
| `--wg-space-block` | `<length>`(mm) | `3mm` | 16곳의 `margin-top: 3mm`(컴포넌트 진입 간격 표준) |
| `--wg-space-block-sm` | `<length>`(mm) | `2mm` | 7곳의 `margin-top: 2mm`(`.qbox`, `.data`, `.formula` 등) |
| `--wg-space-box-y` | `<length>`(px) | `8px` | 표 셀/카드 padding 세로값(9곳, `8px 10px`/`8px 12px` 등의 첫 성분) |
| `--wg-space-box-x` | `<length>`(px) | `10px` | 표 셀/카드 padding 가로값(가장 흔한 둘째 성분, `.lv-table td` 등) |
| `--wg-space-gap-sm` | `<length>`(px) | `6px` | flex `gap`(`.q-choices`, `.q-tf-list`, `.q-bank` 등 4곳) |
| `--wg-space-gap-md` | `<length>`(px) | `8px` | flex `gap`(`.direct`, `h2.sec`, `.dialogue .turn`, `.q-order li` 4곳) |

> **의도적 미포함**: 표 셀 padding은 실측상 `8px 10px`/`8px 12px`/`6px 9px`/`5px 9px`/`5px 10px` 등으로 컴포넌트별 미세 편차가 존재(1-c). `--wg-space-box-y/x`는 **가장 흔한 값을 대표 토큰화**한 것이며, 편차가 있는 나머지 개별 선언까지 전량 이 두 토큰으로 강제 치환하는 것은 이번 초안의 범위가 아니다(5장 리스크 6 참조 — 균질화는 별도 검토 필요).

### 4-c. 괘선 (2개)

| 토큰 | 타입 | 현행 폴백 리터럴 | 매핑되는 현행 하드코딩 위치(1-e) |
|---|---|---|---|
| `--wg-rule-w` | `<length>`(px) | `1px` | 표/박스 테두리 42곳(전체 border 선언의 74%) — 사실상의 기본 헤어라인 두께 |
| `--wg-rule-color` | `<color>` | `#cbd5c0` | 표/박스 테두리 29곳 — blocks.css 전체 최다 빈도 hex |

> 기존 `--wg-tb-width`/`--wg-tb-color`(`.obj-table`), `--wg-ps-bw`/`--wg-ps-border`(`.passage`)는 **개체별 오버라이드**로 존치하되, 그 자체의 폴백을 `1px`/`#cbd5c0`(및 `.passage`는 `1.5px`/`#bbb` 그대로) 대신 `var(--wg-rule-w, 1px)`/`var(--wg-rule-color, #cbd5c0)`로 한 단계 더 연결하면, "무드가 괘선 두께/색 기본값을 바꾸되 개체별 저작 오버라이드는 여전히 최우선"이라는 계층이 자연스럽게 완성된다(선택적 2차 개선, 이번 스펙엔 필수 아님).

### 4-d. 모서리 (3개)

| 토큰 | 타입 | 현행 폴백 리터럴 | 매핑되는 현행 하드코딩 위치(1-d) |
|---|---|---|---|
| `--wg-radius-sm` | `<length>`(px) | `4px` | `.corner-ref`, `.dash-box .dh`, `.q-order-box` 등 5곳 |
| `--wg-radius-md` | `<length>`(px) | `6px` | `.strip`, `.ansbox`, `pre`, `.image-slot img` 등 10곳 |
| `--wg-radius-lg` | `<length>`(px) | `8px` | `.std-box`, `.callout`, `.qbox`, `.mapbox`, `.passage` 등 9곳(가장 넓은 "카드" 클러스터) |

> 원형(`50%`)·알약형(`20px`/`12px`)·`.title-box`의 특대값(`14px`)은 3장 사유로 이 스케일에서 제외.

### 4-e. 헤더 처리 (3개, 스칼라 슬라이스만 — 구조 변형은 범위 밖)

| 토큰 | 타입 | 현행 폴백 리터럴 | 매핑되는 현행 하드코딩 위치 |
|---|---|---|---|
| `--wg-head-weight` | `<font-weight>` | `700` | `.std-head`, `.callout-head`, `.strip .sh`, `h2.sec` 등 색-스트립/라벨 헤더 텍스트 굵기(전부 700으로 통일돼 있어 안전한 단일 토큰) |
| `--wg-head-pad-y` | `<length>`(px) | `4px` | `.std-box .std-head`(`4px 12px`), `.strip .sh`(`4px 10px`) 등 헤더 밴드 세로 padding |
| `--wg-head-pad-x` | `<length>`(px) | `12px` | 위와 동일 위치의 가로 padding(대표값; `.callout-head`는 12px, `.mapbox .maphead`는 12px로 일치율 높음) |

> **범위 밖으로 명시**: "헤더 처리"의 더 큰 의미(색 스트립 헤더 ↔ 밑줄형 헤더 ↔ 헤더 없음 같은 **구조적 변형**)는 단일 CSS 커스텀 프로퍼티로 표현되지 않는다(형태 자체가 바뀜). 이는 계획서 Phase 2("① 토큰값 세트 + ② 소수의 렌더계층 레이아웃 변형", 71행)가 다루는 **class 단위 변형**의 몫이며, 본 문서(Phase 0/P0-1)는 그중 "스칼라로 표현 가능한 부분"(굵기·패딩)만 토큰화 후보로 올린다. 5-6 리스크 항목에서 재차 강조.

### 요약 — 제안 토큰 수: **20개**

| 카테고리 | 개수 |
|---|---|
| 타이포 스케일 (`--wg-fs-*`) | 6 |
| 간격 리듬 (`--wg-space-*`) | 6 |
| 괘선 (`--wg-rule-*`) | 2 |
| 모서리 (`--wg-radius-*`) | 3 |
| 헤더 처리 (`--wg-head-*`, 스칼라 슬라이스) | 3 |
| **합계** | **20** |

참고로 blocks.css에는 이번에 스캔한 것만 해도 font-size 78곳·색 hex 약 150+곳(고유값 56종)·border 57곳·radius 36곳·padding/margin/gap 수십 곳이 있다 — 20개 토큰은 그중 **"무드가 실제로 손댈 몫"만 추린 부분집합**이며, 나머지는 3장 근거로 의도적 보존이다.

---

## 5. 리팩터 위험 메모

1. **`@page { size: … }`는 `var()` 불가** — paper.css 15~16행 주석이 명시. 무드 토큰이 용지 물리 치수에 영향을 주는 설계는 애초에 불가능하므로(이번 20개 토큰 중 해당 없음), 향후 "무드가 여백/치수도 바꾼다"는 요구가 나오면 `paper.js`의 숫자 리터럴 오버레이 메커니즘을 그대로 재사용해야 한다(새 var 경로 추가 금지).

2. **`.sheet`에 `border`를 추가하면 모든 float 개체의 절대좌표 원점이 이동한다** — paper.css 23~28행 주석: `.wg-float`(자유배치 개체)는 `.sheet` 기준 padding-edge를 원점으로 삼고, 지금은 `border-width:0`이라 padding-edge == border-edge다. 편집기 `selection.js`의 `measureRectMm`도 이 일치를 전제로 좌표 변환 없이 그대로 쓴다. **"헤더 처리" 무드가 만약 `.sheet` 자체에 테두리를 얹는 형태로 확장되면(예: 카드형 프레임 무드) `selection.js` 좌표계까지 동시 수정해야 한다** — 이번 20개 토큰 중 `.sheet` border를 건드리는 항목은 없지만, Phase 2에서 헤더/프레임 계열 무드를 논의할 때 반드시 재확인.

3. **3-파일 concat 순서(`paperCss → blocksCss → themeCss`)와 `:root` 이름 충돌** — `AssembleWorksheet.buildDocumentHtml`이 세 CSS를 단순 문자열 결합한다. 신규 무드 토큰을 어느 계층(`:root`)에서 선언할지 정할 때, 기존 `THEME_TOKENS`(`--c/--c2/--clite/--cstrip/--clabel/--cink`, 색 6종) 이름과 겹치지 않는지 확인 완료(접두어 `--wg-*`라 충돌 없음). 다만 향후 무드 CSS를 **어디에 삽입할지**(paper.css 뒤/blocks.css 앞, 혹은 themeCss 뒤 4번째 계층)는 "무드 값이 테마 색과 같은 `:root`에서 캐스케이드 나중에 와야 하는지"에 따라 결정해야 하며, 이번 P0-1에서는 확정하지 않는다(P0-2/Phase 1 설계 사항으로 이관).

4. **기존 `--wg-*` 인라인 오버라이드와의 우선순위** — `.obj-table`(`--wg-tb-color/-width`), `.passage`(`--wg-ps-*`), `.wg-text`/`.wg-shape`(`--wg-fs/-color/-align/-fill/-stroke/-sw/-dash`)는 이미 **개체별 인라인 `style="--x:...")`**로 값을 주입받는 패턴이다. 새 `--wg-rule-w/-color` 등을 이들의 폴백 체인에 연결(4-c 제안)하려면 캐스케이드 우선순위(인라인 style > `:root`)가 실제로 "개체 오버라이드가 항상 이긴다"를 보장하는지 반드시 렌더 테스트로 재확인해야 한다 — CSS 커스텀 프로퍼티는 상속되므로 이론상 문제없지만(인라인 style이 해당 요소에서 가장 구체적), **다단 폴백 체인(`var(--wg-tb-color, var(--wg-rule-color, #cbd5c0))`)을 도입하는 순간 폴백 계산 순서가 미묘해지므로** 실측 검증 없이는 4-c의 "선택적 2차 개선"을 자동 적용하지 말 것.

5. **`1px` 단일화의 시각적 균질화 위험** — 현재 border 두께는 `1px`(74%)가 압도지만 `1.6px`(`.callout`/`.dash-box`)·`1.5px`(`.passage`)·`1.4px`·`2.2px`(`.title-box`, 유일 특대)처럼 **의도적으로 굵게 준 강조 테두리**가 섞여 있다. `--wg-rule-w` 폴백을 `1px`로 잡는 것 자체는 안전(가장 흔한 값이므로)하지만, "무드가 괘선을 굵게"로 설계할 때 `.callout`/`.dash-box`처럼 이미 `1.6px`로 차등을 준 컴포넌트까지 전부 같은 `--wg-rule-w`를 참조하게 리팩터하면 **기존의 "이 요소는 강조 테두리"라는 상대적 차이가 사라진다**. 최초 스윕 대상은 `1px` 그룹(순수 헤어라인)으로 한정하고, `1.4~2.2px` 그룹은 "강조 괘선"이라는 별도 성격이 있는지 여부를 Phase 1 실무자가 컴포넌트별로 재검토할 것을 권고.

6. **"헤더 처리"는 스칼라 토큰만으로 완결되지 않는다** — 4-e에서 이미 명시했듯 `--wg-head-*` 3개는 굵기/패딩만 커버한다. 색 스트립 유/무, 밑줄형 전환 같은 **구조 변형**은 클래스 단위 변형(계획서 Phase 2 몫)이며, 이를 착각해 "헤더 처리 토큰화 = 완료"로 오인하면 계획서가 경계한 "Phase 1(토큰화)에 과투자, 정작 구성 다양성의 원천(레이아웃 변형)을 가볍게 다룸"(Architect 반론, 계획서 44행)이 재현된다. P0-1 산출물은 어디까지나 **스칼라 슬라이스**이며 헤더의 "형태" 변형은 별도 워크스트림임을 재차 명기한다.

7. **폴백 리터럴 오기 시 바이트 회귀** — `paper.js` 주석(15~19행)이 이미 "`--sheet-*` var() 폴백 리터럴이 `paper.js`의 JS 리터럴과 정확히 일치해야 하며, 이를 `paper-fallback-equivalence` 테스트가 강제한다"는 선례를 보여준다. 4장에서 제안한 20개 토큰도 실제 구현 시 **폴백을 반올림·재작성 없이 1-a~1-e 실측값 그대로** 넣어야 하며(예: `--wg-fs-body: 9.5pt` — `9pt`로 뭉개면 32곳의 렌더가 달라짐), 유사한 계약 테스트(`blocks-fallback-equivalence`)를 P0-2(현행 렌더 골든 베이스라인) 산출물과 짝지어 설계할 것을 권고한다.

8. **변경 표면 크기 — 단계적 적용 권고** — blocks.css는 480줄 단일 파일에 폰트크기 78·색 hex 150+·border 57·radius 36건이 몰려 있어, 20개 토큰을 실제로 전부 스윕하면 파일 대부분의 줄이 한 번에 바뀐다. 회귀 진단(무드×과목×학생/교사 모드의 조합 폭발, 계획서 pre-mortem #3)을 감당하려면 **괘선(4-c, 가장 균질) → 모서리(4-d) → 간격(4-b) → 타이포(4-a, 가장 이질적)** 순으로 단계 적용하고, 매 단계마다 무드 미지정 골든 스냅샷(P0-2 산출물)과 diff 0을 확인한 뒤 다음 단계로 넘어갈 것을 권고한다.

---

## 결론 요약 (5줄)

1. CSS는 `paper.css → blocks.css → themes/{name}.css` 3파일이 `AssembleWorksheet.buildDocumentHtml()`에서 단순 concat되며, 색 6종(`--c/--c2/--clite/--cstrip/--clabel/--cink`)만 이미 토큰화돼 있고 크기·간격·괘선·모서리는 blocks.css에 리터럴로 하드코딩돼 있다(font-size 78곳·색 hex 150+곳·border 57곳·radius 36곳).
2. 정량 분석 결과 지배적 클러스터가 뚜렷하다 — 본문 크기 `9.5pt`(32회), 괘선 `1px #cbd5c0`(각 42/29회, 전체 최다), 모서리 `6~8px`(19회), 블록 간격 `margin-top:3mm`(16회) — 이들이 토큰화 최우선 대상이다.
3. 정답 블루·별점 골드·callout 3변형·찬반색·신호등·모드배지 등 **의미색**과, 원형/알약형 **shape radius**, `@page` 물리치수는 "무드 무관"으로 명시적 제외했다(브리핑 원칙 및 blocks.css 자체 주석과 합치).
4. 계획서(`DESIGN-DIVERSIFICATION-PLAN.md`) Phase 1이 예고한 접두어(`--wg-fs-*/-space-*/-rule-*/-radius-*/-head-*`)를 그대로 채택해 총 **20개** 토큰을 제안했으며, 기존 개체별 인라인 오버라이드(`--wg-tb-*`, `--wg-ps-*`, `--wg-fs`/`-color`/`-align` 등 8개)와 이름 충돌이 없음을 확인했다.
5. 최대 리스크는 (a) `.sheet` border 추가 시 float 좌표 원점 이동(paper.css 명문 경고), (b) `1px` 단일화가 `.callout`/`.dash-box` 등 의도적 강조 괘선(1.4~2.2px)의 차별성을 지울 위험, (c) "헤더 처리"는 스칼라 토큰만으로 완결되지 않고 구조 변형(Phase 2 몫)이 별도로 필요하다는 점 — 세 가지 모두 5장에 상세 기록했다.

**제안 토큰 개수: 20개** (타이포 6 · 간격 6 · 괘선 2 · 모서리 3 · 헤더 3)
