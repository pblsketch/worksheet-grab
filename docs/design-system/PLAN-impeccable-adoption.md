# 활동지 디자인 시스템 개선 — impeccable 계약 채택(C-네이티브 하이브리드)

> 상태: **승인됨(execution)**. 실행 방식: `/ralph`(순차). 범위: 하이브리드(impeccable CLI 미설치 — 계약·명령어휘만 채택, detector는 저장소-네이티브).
> 근거: `/ralplan` 합의(Planner→Architect→Critic). 참고: https://github.com/pbakaus/impeccable, 자매 프로젝트 `E:/github/ssampin/.impeccable.md`.
> 상위 배경: `docs/design-diversification/`(무드 P1~P4 완료), `docs/design-diversification/00-inventory-and-token-spec.md`(토큰 인벤토리).

## 목표

1. **개별 요소 다듬기(A)**: AI 생성 활동지의 블록/무드 시각 품질(위계·리듬·여백) 상향.
2. **디자인 시스템 강화(B)**: 앞으로 새 요소(`blocks/core/` 신규 템플릿·신규 개체 타입)를 추가해도 자동으로 온-시스템(일관)·온-콘트랙트를 유지하게 만든다.

## 정직한 분해 — "새 요소 자동 예쁨"

- (a) 자동 **온-시스템(일관)** = **네이티브 detector**가 기계적으로 보증(내구적).
- (b) 자동 **잘 디자인됨(미적)** = 계약 안의 **소수의 잘 만든 프리미티브 조합** + **critique 체크리스트**(디자이너 에이전트). detector가 "예쁨"을 보증한다고 과장하지 않는다.

## 절대 불변식 (어떤 변경도 위반 금지)

- 편집==인쇄 파리티(`reflow.js`가 teacher `<style>`=무드 포함을 측정에 이식).
- fail-closed 검증(`ValidateObjectTree`).
- 닫힌 카탈로그 12종 — **신규 개체 타입 창설 금지**. 변형은 렌더 계층(class/토큰)에서만.
- AI 좌표 미생성(`placement:'flow'`에서 `rect` 금지).
- `.sheet` 기하 불변(border:0 — 추가 시 float 좌표 원점 이동 → 편집기 `selection.js` `measureRectMm` 붕괴).
- 의미색(정답 `#1a5fb4`·별점 `#f0a500`·callout tip/warning/summary·찬반·신호등·모드배지), 조직자 SVG 잉크(OrganizerGen), 원형/알약 shape radius(50%/20px/12px), `@page` 물리치수는 **무드 축 변형 대상 아님**(계약에 기록만).

## 저장소 컨벤션 (ralph 준수)

- 착수 전 `git status --porcelain` 확인(병행 세션). **경로 명시 스테이징 — `add -A` 금지**.
- Phase별 red→green. 렌더 테스트는 `--test-concurrency=1`(Chrome 동시 1개). 병합 전 전체 렌더 1회.
- 골든 변경 시 diff는 **의도분만**, PNG 육안 1회 확인.
- 무의존(node:test) 유지 — impeccable npm 엔진을 런타임 의존성으로 추가하지 않는다.
- 커밋은 **사용자 요청 시에만**(Phase 단위 원자적).

---

## Phase 0 · 정찰 (무변경)

- 기존 `docs/design-diversification/00-inventory-and-token-spec.md` + `.claude/skills/worksheet-design/references/themes.md` + `themes/*.css` + `assets/blocks.css`를 취합해 계약 소스 확정.
- CSS 조립 접점 재확인: `src/usecases/AssembleWorksheet.js` `buildDocumentHtml()`(paper.css→blocks.css→themes/{name}.css→mood), `RenderObjectTree`.
- (선택) 사용자가 풀 impeccable을 원할 때만: throwaway 브랜치에 `npx impeccable install` → `.claude` diff 확인. **기본은 미설치.**
- 산출: 계약에 담을 토큰/의미색/금지속성 최종 목록.

## Phase 1 · 계약 저작 + 조기 플래그십 다듬기

- **계약 문서** `docs/design-system/PAPER.impeccable.md`(impeccable `.impeccable.md` 컨벤션):
  - Users(한국 초·중·고 교사) / 맥락(학교 인쇄=A4·흑백/회색조 흔함).
  - Aesthetic Direction / Anti-references(장식과잉·컬러의존·저대비).
  - **Principles**: ① 하드코딩 금지·토큰 소비 ② 편집==인쇄 불변 ③ 흑백 인쇄 판독성 ④ 의미색은 상태 신호(무드 무관 고정).
  - **Design System**: `--c*` 교과색 6종(값은 themes/*.css) · `--wg-*` 20토큰 · **괘선 2단**(`--wg-rule-w` 헤어라인 1px + 강조 티어) · 의미색 allowlist · 회색 잉크 스케일 · shape 불변 · 인쇄 대비 최소값.
- **머신리더블** `docs/design-system/design-tokens.json`(단일 소스): 토큰명·타입·현행 폴백값·의미색 allowlist·승인 괘선폭 토큰 집합.
- **드리프트 정정**: `.claude/skills/worksheet-design/references/themes.md` 사회 팔레트(`#b8860b` 등)를 실제 `themes/social.css`(`#b26a00` 등)와 1:1 정합.
- **조기 플래그십 다듬기**(즉시 체감): 최다빈도 5블록(title·question·table·callout·section-heading)의 위계/리듬/여백만 토큰 경유로 소폭 개선. 골든 갱신·PNG 육안. 불변식·의미색·shape 불변.

## Phase 2 · 네이티브 detector + 게이트

- `tools/design-lint.mjs`(무의존) — `assets/blocks.css`·`blocks/core/*.html`·`themes/**/*.css` 스캔:
  - R1 하드코딩 `font-size`(pt)·괘선 hex 금지 → `var(--wg-*)` 강제.
  - R2 border-width는 **승인 토큰 집합(헤어라인+강조) 중 하나**여야 통과(매직넘버만 차단 — 균질화 방지).
  - R3 색상은 `--c*`/`--wg-*`/**의미색 allowlist** 밖이면 실패.
  - R4 `url()`·`float`·`position`·`.sheet` 셀렉터 접근 금지(무드게이트를 블록 전반으로 확장).
  - R5 흑백 인쇄 대비 최소값(전경/배경 명도차).
- **baseline 스냅샷**(`test/design/baseline.json`): 기존 잔존 리터럴은 통과(레거시 allowlist), **신규 추가분만 차단**.
- `test/design/design-contract.test.js`(현행 그린) + `test/design/detector-mutation.test.js`(신규 하드코딩 `13pt`/`#999` 괘선/`url()`/`position:absolute`/allowlist밖 색 주입 → 대응 규칙 레드).
- `package.json`에 `design:lint` 스크립트 추가.

## Phase 3 · 요소 다듬기 (critique 기반, detector 그린 유지)

- impeccable 어휘(polish/critique/bolder/quieter)를 다듬기 지침으로 사용해 나머지 블록/무드의 위계·리듬·여백 개선 — **계약 토큰 경유만**.
- 각 변경: 단위 red→green + 골든 diff 의도확인 + PNG 육안 + 편집==인쇄 parity + mood-pack 게이트 그린.
- 의미색·shape·조직자 잉크 불변.

## Phase 4 · 디자이너 에이전트 통합

- `.claude/agents/worksheet-designer.md`에 **self-critique 단계** 추가: 저작 후 `PAPER.impeccable.md` 계약 대비 점검(하드코딩 금지·의미색·흑백대비·프리미티브 조합) 기록을 `03_manifest.json`에 남김.
- `worksheet-export`(또는 조립 경로)에 **export 전 `design:lint` 게이트**(fail-closed) — 위반 시 산출 중단.
- 신규 블록 추가 가이드(계약 §"새 요소 추가 절차")를 계약 문서에 명문화.

---

## 수용 기준 (테스트 가능)

- **AC1** 계약(`PAPER.impeccable.md`)+`design-tokens.json` 존재, 20토큰·의미색 allowlist·괘선 2단·인쇄대비 명세. themes.md 사회팔레트 드리프트 정정(social.css 1:1).
- **AC2** `design:lint` 현행 전량 그린(baseline). 변이: 신규 하드코딩/allowlist밖 색/금지속성 주입 시 대응 규칙 레드.
- **AC3** 무회귀 — 유닛 1001+ 그린, 렌더 골든(무드×과목×학생/교사), 편집==인쇄 parity, mood-pack 게이트 전원 그린.
- **AC4** 다듬기(P1 조기·P3)가 모두 토큰 경유 + 골든 갱신 + PNG 육안. 의미색·shape 불변.
- **AC5** export 전 design-lint 게이트가 위반을 fail-closed로 차단.
- **AC6** 강조 괘선(.callout/.dash-box 1.4~2.2px)이 헤어라인 스윕에 소거되지 않음(승인 토큰으로 보존) — 검증 테스트.
- **AC7** 불변식 무붕괴 — `.sheet` border 미추가, 신규 개체 타입 0, AI 좌표 미생성, fail-closed 유지.

## Pre-mortem

1. detector 과엄격 → 기존 blocks 대량 레드로 개발 마비. **완화**: baseline allowlist(현행 잔존 리터럴 스냅샷), 점증 강화.
2. 요소 다듬기가 골든/파리티 회귀. **완화**: 변경 단위 red→green + 골든 diff 의도확인 + PNG 육안 + parity 스위트.
3. 계약이 코드와 재드리프트. **완화**: `design-tokens.json` 단일 소스, blocks/themes가 그 값을 참조하는지 대조 테스트, themes.md는 계약에서 파생.

## ADR

- **Decision**: impeccable 계약(`.impeccable.md`)·명령어휘 채택 + detector는 저장소-네이티브 구현(하이브리드).
- **Drivers**: 회귀위험 최소 · 확장성(새 요소 자동 온-시스템) · AI 저작 시각품질.
- **Alternatives**: 풀 impeccable install(웹편향 오탐·`.claude` 훅충돌), 순수 자체구축(impeccable 지시 미이행), 요소 먼저 다듬기(게이트 없이 회귀위험·1차목표 역행).
- **Why**: 사용자 검증된 경량 사용법(ssampin=계약파일만)과 저장소 무의존/직렬렌더/경로명시 컨벤션에 정합. "impeccable을 쓴다"를 충족하면서 웹편향·훅충돌 회피.
- **Consequences**: 계약·detector 초기 투자, 시각 체감은 P1 조기 다듬기부터. impeccable 슬래시명령은 미도입(원하면 후속).
- **Follow-ups**: (원할 시) 풀 impeccable 슬래시명령 도입, 조직자 잉크 팩 별도 워크스트림, 삽화 무드 PRD.
