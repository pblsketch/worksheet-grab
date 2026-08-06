# PAPER.impeccable.md — 활동지 종이 출력 디자인 계약

> impeccable(github.com/pbakaus/impeccable)의 `.impeccable.md` 컨벤션을 **프린트-우선 도메인**에 이식한 디자인 계약이다.
> 머신리더블 짝: [`design-tokens.json`](./design-tokens.json) · 강제: [`../../tools/design-lint.mjs`](../../tools/design-lint.mjs) (`npm run design:lint`).
> 이 문서는 **종이 출력(활동지 캔버스)** 의 디자인 언어를 규정한다. 편집기 크롬(UI)의 계약은 별도 문서 [`../../DESIGN.md`](../../DESIGN.md) 소유.

## Design Context

### Users
- **대상**: 한국 초·중·고 교사. AI에게 한 문장으로 활동지를 요청하고, 편집기에서 다듬어 학생에게 **인쇄 배포**한다.
- **핵심 맥락**: 최종 산출물은 화면이 아니라 **A4 종이**다. 학교 인쇄는 **흑백/회색조가 흔하다**. 편집 화면과 인쇄본은 **1바이트도 어긋나면 안 된다(편집==인쇄 불변식)**.
- **제작 주체**: 콘텐츠는 AI(디자이너 에이전트)가 **개체 트리 JSON**으로 저작한다 — CSS·좌표·`--wg-*` 토큰을 직접 쓰지 않는다. 시각 규칙은 전부 이 계약(=blocks.css·themes)이 소유한다.

### Aesthetic Direction
- **톤**: 차분하고 실용적인 교사용 학습지. 장식이 아니라 **정보 위계·판독성·인쇄 예측성**이 주인공.
- **참고**: 잘 조판된 교과서·학습지·워크북(균질한 괘선, 명료한 헤더, 여백의 리듬).
- **안티-레퍼런스**: 장식 과잉(불필요한 그림자·그라디언트·아이콘 타일), **색에만 의존하는 정보 전달**(흑백에서 붕괴), 요소마다 제각각인 임의 수치(자간·괘선·모서리 난립).

### Design Principles
1. **하드코딩 금지, 토큰 소비** — 구조적 크기·괘선·모서리·색은 raw 리터럴이 아니라 `var(--wg-*)`/`var(--c*)` 로 참조한다. 리터럴의 정당한 거처는 **토큰 정의부(`--*: value`, themes)** 와 **var() 폴백**뿐이다.
2. **편집==인쇄 불변** — 어떤 다듬기도 렌더 계층(토큰/class)에서만. `.sheet` 기하(`border:0`)를 건드리지 않는다(float 좌표 원점이 이동해 편집기 `selection.js` 가 깨진다).
3. **흑백 판독성** — 색만으로 정보를 나르지 않는다. 명도차·패턴·라벨을 병행한다.
4. **의미색은 상태 신호** — 정답·경고·찬반·신호등 색은 의미를 나르므로 교과·무드와 무관하게 **고정**한다.

## Design System

CSS 조립 순서(`src/usecases/AssembleWorksheet.js` → `buildDocumentHtml`): `paper.css` → `blocks.css` → `themes/{name}.css` → (무드 지정 시) `themes/moods/{mood}.css`. 뒤 계층이 앞 토큰을 오버라이드한다.

### 1. 팔레트 `--c*` (색 축 — 교과와 **분리**)
`--c · --c2 · --clite · --cstrip · --clabel · --cink`. **기본 팔레트는 `neutral`(slate)** — 교과가 색을 강제하지 않으며, 교과 팔레트(ko/sci/social/english)는 **선택형 프리셋**이다(교사/AI가 색 있는 룩을 원할 때만 `themeName`으로 선택, 미지정=neutral). **값의 단일 진실원천은 `themes/{neutral,ko,sci,social,english}.css` 의 `:root`.** 소비부(blocks.css)는 `var()` 로만 참조하고, 이 계약·`themes.md` 참조표는 값을 **복제만** 한다(드리프트 가드가 정합 강제). 수학(math)은 문서상 예약 — `themes/math.css` 미구현.

### 2. 디자인 토큰 `--wg-*` (무드 무관 기본값)
타이포 6(`--wg-fs-title/heading/pill/label/body/caption`) · 간격 6(`--wg-space-*`) · 괘선 2(`--wg-rule-w`, `--wg-rule-color`) · 모서리 3(`--wg-radius-sm/md/lg`) · 헤더 3(`--wg-head-*`). 폴백값 원본은 [`design-tokens.json`](./design-tokens.json). 무드(`themes/moods/*.css`)가 이 토큰을 오버라이드해 "같은 레이아웃, 다른 질감"을 만든다.

### 3. 괘선은 2단
- **헤어라인** `--wg-rule-w`(1px) — 표·박스 구조 구분(기본).
- **강조** `--wg-rule-w-emph`(1.6px) — 주목 유도(callout·대시박스류).
- 둘을 뒤섞지 않는다. 새 블록에서 강조 테두리가 필요하면 raw `1.6px` 대신 `var(--wg-rule-w-emph, 1.6px)` 를 쓴다 → 검출기 통과 + 무드 조율 가능(균질화 방지, AC6).

### 4. 색 allowlist (재사용 가능한 닫힌 어휘)
- **의미색**: 정답 `#1a5fb4`·별점 `#f0a500`·callout(tip/warning/summary)·찬반·신호등·슬롯. 무드 축 변형 금지.
- **잉크 스케일**: 중립 텍스트 그레이(`#333`~`#aaa`, 캡션은 연하게·라벨은 진하게). 임의의 새 회색 금지 — 이 스케일 안에서 재사용.
- **서피스 스케일**: 저채도 배경/화이트(표·입력칸 구분). 이 안에서 재사용.
- 전체 목록은 [`design-tokens.json`](./design-tokens.json). **목록 밖 새 색을 임의로 도입하지 않는다.**

### 5. Shape 불변 / 금지 속성
- 원(`50%`)·알약(`20px`/`12px`)·제목 카드(`14px`)는 "둥근 정도"가 아니라 **형태 자체** — radius 토큰 대상 아님, 무드가 각져도 유지.
- **금지(paper.css 예외)**: `url()`(외부 자산 인라인) · `.sheet` 셀렉터 수정 · 신규 `float`/`position:absolute|fixed`. 이유는 프린트 안전과 `.sheet` 기하 불변식.

## 새 요소(블록/개체) 추가 절차

1. **닫힌 카탈로그 우선** — 표현하려는 구조가 개체 타입 12종에 맞는지 먼저 본다. 안 맞으면 새 타입을 만들지 말고 `richtext` 탈출구(`sourceType` 기록, 리뷰 대상)로 담는다.
2. **토큰·allowlist만 소비** — 새 blocks.css 규칙은 크기=`--wg-fs-*`, 괘선=`--wg-rule-*`(+강조 토큰), 모서리=`--wg-radius-*`, 색=`--c*`/allowlist. raw 리터럴을 쓰지 않는다.
3. **프리미티브 조합** — 밑바닥부터 그리지 말고 기존 헤더밴드(`.std-head`)·표(`.obj-table`)·박스(`.callout`) 패턴을 조합한다("자동으로 잘 디자인됨"은 좋은 프리미티브 재사용에서 나온다).
4. **검출기 통과** — `npm run design:lint`. 정당한 신규 토큰/색이면 `design-tokens.json` 갱신 후 `npm run design:baseline` 로 baseline 을 고정한다.
5. **critique 자기점검**(아래) 후 커밋.

## 강제 메커니즘 — 결정론 + critique

**"새 요소 자동 예쁨"은 두 겹이다:**
- **(a) 자동 온-시스템(일관)** = 결정론적 검출기 `design-lint` 가 기계적으로 보증. 신규 하드코딩 폰트/색·금지속성·`.sheet` 이탈을 CI/테스트(`test/design/design-contract.test.js`)에서 차단. 이것이 **내구적 보증**이다.
- **(b) 자동 잘 디자인됨(미적)** = 검출기는 판정 못 한다. **좋은 프리미티브 조합 + 아래 critique 체크리스트**로 확보한다.

### critique 체크리스트 (디자이너 에이전트 self-critique — impeccable 어휘)
- **polish**: 위계가 한눈에 읽히나? 제목>섹션>라벨>본문>캡션 크기·굵기 대비가 토큰 스케일을 따르나?
- **quieter**: 강조가 남발되지 않았나? 강조 괘선/색이 실제 "주목 가치" 있는 곳에만 있나?
- **rhythm**: 블록 간 세로 여백(`--wg-space-block`)이 일정한가? 표 셀 밀도가 무드와 맞나?
- **contrast(흑백)**: 회색조로 인쇄해도 라벨/헤더/본문이 구분되나? 색만으로 나르는 정보는 없나?
- **restraint**: 새 색·새 수치를 도입했나? 도입했다면 allowlist/토큰으로 승격 가능한가, 아니면 불필요한가?

## impeccable 명령 어휘 매핑 (프린트 도메인)
| impeccable | 이 프로젝트에서의 의미 |
|---|---|
| `polish` | 토큰 스케일로 위계·리듬 정돈(raw 값 → 토큰) |
| `critique` | 위 체크리스트로 블록/무드 점검 |
| `bolder` / `quieter` | 강조 괘선(`--wg-rule-w-emph`)·의미색 사용 강약 조절(형태·의미색 팔레트는 불변) |
| `distill` | 중복 수치를 토큰/allowlist로 수렴 |

## 절대 불변식 (계약이 보호하는 것)
편집==인쇄 · fail-closed 검증 · 닫힌 카탈로그 12종(신규 타입 창설 금지) · AI 좌표 미생성(flow에서 `rect` 금지) · `.sheet` 기하(`border:0`) · 의미색/shape/조직자 잉크의 무드 무변형.
