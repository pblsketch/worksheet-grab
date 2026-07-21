# worksheet-grab — 계획서 (PLAN.md)

> 상태: **pending approval** (실행 승인 전 — 이 문서는 계획 산출물이며, 승인 전 소스 변경/실행 없음)
> 방식: ralplan 합의(Planner 초안 → Architect 검토 반영 → Critic 기준 하드닝)
> 최종 갱신: 2026-07-20

## 0. 목표

slides-grab처럼 **생성(Generate) · 편집(Edit) · 내보내기(Export)** 가 모두 가능한 **한국 K-12 교사용 활동지 제작 서비스**. 사용자가 이미 구독한 AI(Claude Code/Codex)가 엔진이 되어 **API 키 없이** 구동한다. 목표 스타일 레퍼런스는 지학사 PBL 자료집. **범교과(국어 비특화)가 하드 제약.**

## 1. 원칙 (Principles)

1. **콘텐츠는 사용자 에이전트가 저작** — 별도 LLM API 없음, 한계비용 0.
2. **문서는 HTML/CSS(AI 네이티브), 인쇄가 진실의 원천**(paper-css A4/B4).
3. **구조적 범교과** — 얇은 공통 코어 + 교과 블록 팩 + 테마 토큰. 국어는 한 인스턴스일 뿐.
4. **Human-in-the-Loop** — 교사가 인쇄 전 검토·편집. 성취기준 원문은 gepai(권위 출처)에서만, 창작 금지.
5. **최소 종단(end-to-end) 먼저** — 생성→편집→내보내기 되는 실물 하나를 먼저 완성하고 교과를 넓힌다.

## 2. 결정 동인 (Decision Drivers)

1. 편집성 + 범교과 재사용 (hwpx를 떠나는 이유 그 자체)
2. 무(無)API 운영 모델 (교사의 기존 구독 위에서 구동)
3. 지학사 인쇄 스타일 충실도 + 성취기준 정확성

## 3. 대안 비교 (Viable Options)

- **A. slides-grab 포크/확장** — 에디터·export·스킬 구조 상속. 단 고정 캔버스(720×405pt) 모델이라 A4 다중페이지 흐름·교과 블록 리트로핏이 코어와 충돌, 상류 결합 부담.
- **B. 패턴 재사용 독립 저장소** ✅ — slides-grab 패턴(스킬 파이프라인·validate 루프·print-to-pdf)만 차용하고 활동지 전용 엔진(paper-css 흐름·블록 라이브러리·교과 팩)을 신설. PoC가 이 렌더 경로를 이미 검증. 에디터/export 배관은 재구현 필요.
- **C. 순수 스킬(커스텀 CLI 없음) + 얇은 렌더 스크립트** — 가장 단순·빠름. 재사용 비주얼 에디터·블록 검증엔 약함.

**결정: B(독립·패턴 재사용) + v1은 C의 "얇은 CLI" 철학 채택.** 근거: PoC가 B 렌더 경로를 이미 실증했고, slides-grab의 고정캔버스 에디터가 유일하게 이식이 깔끔치 않은 조각이라 포크(A)는 이득 대비 마찰만 수입.

## 4. 아키텍처 — Clean Architecture (Ports & Adapters)

**의존성 규칙: 모든 의존성은 안쪽(도메인)으로만 향한다.** 도메인은 Chrome·gepai·Node·paper-css를 전혀 모른다. 바깥 계층만 안쪽을 안다.

```
┌─ Frameworks & Drivers ── Node CLI · Chrome headless · paper-css/KaTeX · FS · gepai MCP · Skill 런타임
│  ┌─ Interface Adapters ── 포트 구현체(어댑터) · Presenter(HTML+manifest 직렬화)
│  │  ┌─ Use Cases ──────── 애플리케이션 규칙 (포트에만 의존)
│  │  │  ┌─ Entities ────── 순수 도메인 (프레임워크 무지)
```

### 4.1 Entities (도메인 — 순수, 의존성 0)
- `Worksheet`(ordered `Block[]`, subject, theme, `Standard[]`), `Block`(type, slots, content, core|subjectPack), `Question`/`AnswerSlot`, `Variant`(student|teacher), `Standard`(code, text, subject), `Rubric`, `Theme`(tokens).
- **불변식(invariants)**: 블록 순서 유효성 · **student 빌드에 정답 배제** · 성취기준은 외부 주입만(창작 금지) · 지문은 슬롯.

### 4.2 Use Cases (애플리케이션 규칙 — 포트에만 의존)
`ResolveStandards` · `AssembleWorksheet` · `BuildVariants(student/teacher)` · `ValidateWorksheet` · `RenderPdf` / `RenderPng` · `EditWorksheet` · `SaveDocument`/`OpenDocument`(E1 워크스페이스) · `RenderEditorShell`(E2/E3 에디터 합성). 어떤 유스케이스도 Chrome·gepai·파일시스템을 직접 부르지 않는다.

### 4.2b 에디터(E0~E3) 아키텍처 — HANDOFF-editor-workspace.md §12 상세
- **용지(E0)**: `paper.js` 단일 소스 — manifest `paper` 1급 속성 → @page 숫자 mm 리터럴 주입 + `--sheet-*` var. A4 기본 여백은 현행 비대칭과 단일화(폴백-주입 등가성 테스트로 강제).
- **워크스페이스(E1)**: `worksheets/<문서명>/`(manifest 진실 + 2벌 HTML + meta 리비전 + history 스냅샷). 모든 저장은 `SaveDocument` 단일 경유 — 누출 시 student.html 보류 + `meta.unsafe`(fail-closed 는 export 게이트로 승격 예정).
- **에디터 셸(E2)**: `edit-ui` → `EditorHttpServer`(127.0.0.1) → `RenderEditorShell` → 바닐라 ESM 클라이언트. "같은 규칙, 두 런타임" — 브라우저가 원본 `ValidateWorksheet` 를 `browserGraph` 화이트리스트 ESM 으로 실행(무빌드), 순수성은 `browser-purity` 가드가 Chrome 없이 상시 단정.
- **편집(E3)**: teacher 캔버스만 `editMode` 블록 경계 래퍼(`display:contents`, 저장 시 clean 재조립로 소멸) → DOM 순회 → `resync`(순수) → POST `/save` → `SaveDocument`. 일반 툴바(execCommand 어댑터, fontSize 는 직접 style) + ⭐ 정답 마크(세션 태깅·기존 마크 confirm·저장 시 마크 소멸 감지 3중 방어) + ✏️ 답란. 실시간 예고(넘침 배지·최소폰트·라이브 검수 바)는 편집 DOM 직렬화 입력. student 는 편집 불가 즉석 파생 미리보기(`stripElementsByClass` 동일 원시).
- **프리셋(E4)**: `.presets/presets.json` 단일 인덱스(원자 교체·.bak 폴백) + 빌트인 런타임 파생·오버레이. 프리셋 = 자산(SaveDocument 미경유), 미리보기는 sandbox iframe + 물리 제거본 기본.
- **AI 브리지(E5, 무API)**: 에디터 요청 → `.ai-bridge/` 파일 큐(`aiBridge` 순수 + `FsAiBridgeRepository` 원자 IO) → 구독 AI 세션이 `ai pending --watch`/`ai respond` CLI 로 왕복(엔진에 LLM 호출 0). 성취기준·저작권 슬롯 블록은 타입 가드 3중(정책·서버·클라)으로 대상 제외 — Validate 가 못 잡는 §7·§10 을 코드로 강제. 적용 = DOMParser 정제 → diff 미리보기(sandbox) → 가역 교체(스냅샷·되돌리기) → 마커 제거 → 기존 SaveDocument 게이트.

### 4.3 Interface Adapters (포트 & 어댑터) — **실제로 변하는 경계에만 DIP**
- `CurriculumProvider` 포트 → `GepaiMcpAdapter` / `GepaiCsvAdapter`(폴백). ← R4 해소
- `Renderer` 포트 → `ChromeHeadlessAdapter` (교체가능: Playwright·wkhtmltopdf). ← R2 해소
- `BlockRepository` 포트 → `FsBlockAdapter` (블록 HTML·테마 토큰 로드)
- `ContentAuthor` 포트 → **사용자 에이전트(Claude/Codex)** — 무API 모델을 포트로 표현
- `Presenter` → 도메인 → HTML(+worksheet.json manifest) 직렬화

### 4.4 Frameworks & Drivers (가장 바깥)
Node CLI(`validate`·`render`·`png`·`build-variants`·`list-blocks`·`list-themes`) · Chrome · paper-css/KaTeX · 파일시스템 · gepai MCP · Skill 런타임.

### 4.5 핵심 긴장 & 해소 (HTML-first vs 도메인 순수성)
Clean Architecture는 구조화된 엔티티를 원하지만, 우리의 강점(과 PoC)은 **AI가 HTML을 자유롭게 저작**하는 것이다. 엄격한 DSL로 강제하면 그 유연성이 죽는다.
→ **해소**: 결정적·테스트 대상인 **엔진(assemble·validate·variants·export·curriculum)에만 Clean Architecture 적용**. 블록 HTML은 `BlockContent` 값객체로 감싸 **가장자리 detail로 격리**한다. AI는 여전히 HTML을 자유 저작하고, 도메인은 그것을 불투명 값으로만 다룬다. → AI 유연성 + 도메인 순수성 양립.

### 4.6 과설계 경계 (실용 헥사고날)
DIP는 **변하는 3경계**(Curriculum, Renderer, ContentAuthor)에만 강하게. 나머지(테마·블록 IO)는 얇은 포트로. 그 외 추상화는 v1에서 지양 — Clean Architecture의 원칙을 지키되 계층 과잉을 만들지 않는다.

### 4.7 이 설계가 주는 이득(테스트/리스크)
- `AssembleWorksheet`·`ValidateWorksheet`·`BuildVariants`를 **Chrome 없이 단위 테스트**(Renderer 목).
- gepai MCP↔CSV **교체가 유스케이스 무변경**(R4), 렌더러 교체 자유(R2), Claude↔Codex 교체(무API).
- **정답 누출 게이트**를 도메인 불변식으로 강제(student Variant는 answer 미포함) → grep은 2차 방어.

### 4.8 부수 결정
- **매니페스트**(`worksheet.json`: subject·theme·standards[]·블록순서·mode)는 Presenter 산출물이자 재조립·변형·검증의 단일 소스. DSL 승격은 M3 이후 재평가.
- **교과 테마 토큰**: `/themes/{subject}.css` (CSS 변수). 국어=초록, 과학=청록.
- **정답 모델**: 단일 HTML, `data-mode=student|teacher`, `.answer`/`.plot-ans` 토글 → PDF 2벌.
- **저작권**: 지문은 슬롯(교사 삽입), 저작권 텍스트 자동 임베드 금지.

## 5. 로드맵 (Phased) + 수용 기준(테스트 가능)

- **M0 (완료)**: PoC 국어(선풍기토론 5p)·과학(옴의법칙 3p), 렌더 경로·2벌·성취기준·수식·그래프 실증.
- **M1 — 코어 엔진 ✅ (완료 2026-07-20)**: CLI `validate`+`render`+`build-variants`(+`assemble`·`list-blocks`·`list-themes`); paper-css 베이스 정형화; PoC에서 공통 코어 + 교과 블록 추출(`blocks/`); 테마 2종(국어 green·과학 teal). Clean Architecture(domain·usecases·adapters·cli). 성취기준은 gepai CSV 1차·MCP 옵션.
  - *수용(전부 통과)*: 블록 라이브러리에서 두 PoC를 재조립해 렌더 → 페이지수 일치(국어 5쪽·과학 3쪽)·주요 컴포넌트 존재. 정답 누출 FAIL 탐지, 하드코딩 교과색 경고, MODE_TOKEN 2벌 치환, Chrome 없이 도메인/유스케이스 단위테스트. `node --test` 26/26 pass. 상세는 `README.md`·`progress.txt`.
  - *비고*: 원본 국어 PoC는 authored 5섹션이나 5쪽째 콘텐츠가 A4를 넘겨 실물 6쪽이던 것을, 엔진의 paper-css 정형화로 5쪽에 안착시킴(poc 원본 무변경).
- **M2 — 교과 팩 + 커리큘럼 ✅ (완료 2026-07-20)**: 국어·과학 교과 템플릿(`templates/*.json`, 슬롯 기반) + 테마 토큰 + gepai 어댑터(코드→원문 `resolve` + 조건 `search`, CSV 1차·MCP 옵션). `GenerateWorksheet` 유스케이스 + `generate <학년교과> <주제>` CLI.
  - *수용(전부 통과)*: `generate 중2과학 광합성` → student+teacher A4 PDF(각 3쪽), 헤더에 [9과12-01..03] 성취기준 원문(CSV 조회, 창작 금지). gepai MCP off(CSV 기본)에서 성공. 범교과: 동일 엔진이 국어(green)·과학(teal)을 템플릿+테마만으로 생성. `node --test` 35/35 pass. 상세는 `README.md`·`.omc/ultragoal/m2-ledger.md`.
- **M3 — 스킬 파이프라인(Plan→Design→Export) ✅ (완료 2026-07-20)**: 교사 프롬프트가 종단 구동, HITL 검토 게이트. 실행 가능한 `pipeline <학년교과> <주제>` CLI(+`RunPipeline` 유스케이스) = 조회→조립→2벌→검수 게이트(fail-closed)→렌더. `.claude/skills` 하네스(plan·curriculum·design·review·export·오케스트레이터)를 엔진 CLI에 배선(구조 보존, 추가 방식).
  - *수용(전부 통과)*: 한 문장 프롬프트(`pipeline 중2과학 광합성`) → 검수 PASS 후 student/teacher A4 PDF 산출(각 3쪽), 검수 실패 시 렌더 중단. HITL 안내 포함. slides-grab plan/design/export 구조 미러(하네스). `node --test` 37/37 pass. 상세는 `README.md`·`.omc/ultragoal/m3-ledger.md`.
- **M4 — 편집 ✅ (완료 2026-07-21)**: 대화형 편집 루프. `edit <manifest.json> "<지시>"` CLI(+`EditWorksheet` 유스케이스) = 지시문 파싱→매니페스트 편집(문항 제거·성찰 추가)→재조립(2벌)→재렌더. `generate`/`pipeline` 이 재편집용 `<base>.manifest.json` 산출(왕복 근거). 비주얼 에디터 스파이크는 폴백=대화형 원칙에 따라 대화형 CLI로 충족.
  - *수용(통과)*: `edit … "3번 문항 빼고 성찰 추가"` 가 manifest.json·student/teacher HTML 양쪽에 반영, 재렌더 A4 정상(2~4쪽). `node --test`.
- **M5 — 교과 확장 + 검증 룰 ✅ (완료 2026-07-21)**: 사회(social: 지도 `.mapbox`·연표 `.timeline`)·영어(english: 어휘 `.vocab`·대화문 `.dialogue`) 팩(`templates/*.json`+`themes/*.css`, 고유 팔레트) + 인쇄 안전 룰(`ValidateWorksheet`: print-margin·min-font·keep-together, warning). 코어 블록은 var(--*)만 참조.
  - *수용(통과)*: `generate 중2사회|중2영어` 가 각 블록·테마로 A4 렌더(2쪽), 하드코딩색 0. 공통 코어 블록(header·std-box·h2.sec·rubric)이 국어·과학·사회·영어 4교과에서 존재+검증 통과. 인쇄안전 위반 픽스처 FAIL/정상 PASS. `node --test`.
- **M6 — 패키징 ✅ (완료 2026-07-21)**: 설치형(`package.json` bin/files, 의존성 0), PNG/카드 export(`render --png` / `generate|pipeline --png`, `RenderImage`+`renderToPng`), 문서(README quickstart·M4~M6 예시), `.claude/skills` 오케스트레이터를 M1~M6 CLI로 배선.
  - *수용(통과)*: 임의 CWD(새 환경 모사)에서 `pipeline 중2과학 광합성` 한 문장 생성 스모크 성공(root=bin 기준 해결, CWD 무관). PNG 유효 시그니처 산출. `node --test`.
- **M7 — 동적 조립(Dynamic Composition) ✅ (완료 2026-07-21)**: "교과당 고정 템플릿 1개" 의존을 걷어내고 "요청마다 AI가 어휘로 manifest를 조립"하는 경로를 완성. 4단계로 진행(상세: `docs/HANDOFF-dynamic-composition.md`).
  - **Phase 1(실증)**: 템플릿 없이 손저작 manifest(광합성)로 `assemble→2벌→validate→render` 실증 — 엔진의 동적 조립 능력 실물 증명.
  - **Phase 2(어휘)**: 위치기반 81조각 → 타입기반 어휘 28종(`blocks/vocabulary.json` 계약 레지스트리 + `core/`·`pack-*/` exemplar). 두 PoC 매니페스트를 인라인으로 무손실 마이그레이션(재조립 바이트 동일).
  - **Phase 3(아키타입)**: 교과 초월 구조 패턴 6종(`blocks/archetypes.json`: 실험탐구·자료해석·읽기독해·토론의사결정·개념구조화·프로젝트제작) + `ArchetypeLibrary`(role→교과 바인딩, 누출 0). 실험탐구가 과학·사회 ≥2교과에서 성립.
  - **Phase 4(배선, DoD)**: `compose`(요청+성취기준+아키타입+어휘 → 저작 대기 스캐폴드 + 브리프) 유스케이스/CLI. 무API: 엔진은 결정적 스캐폴드만, 콘텐츠 저작은 designer AI.
  - *수용(통과)*: **같은 교과 다른 주제 → 구조적으로 다른 주제 적합 활동지.** `compose 중2과학 광합성`=실험탐구(변인표+포화곡선), `compose 중2과학 "생물 다양성과 분류"`=개념구조화(비교표+5계 구조표, 변인표·그래프 강제 0). 두 데모 validate PASS·A4 렌더. 단위 `node --test` 114/114 pass(렌더 flake는 병렬 Chrome 타임아웃, 직렬 통과). 템플릿은 프리셋/few-shot 시드로 강등(비파괴, `templates/README.md`).

## 6. 리스크 & 완화

- **R1 비주얼 에디터 다중페이지 미이식** → 대화형 편집이 1차, 에디터는 스파이크(의존성 아님).
- **R2 웹폰트/KaTeX 헤드리스 로딩 타이밍** → `--virtual-time-budget`, 로컬 폰트 폴백, 셀프호스트 옵션.
- **R3 범교과 스코프 크립/국어 편향** → 코드리뷰에서 공통코어/교과팩 분리 강제; 모든 코어 블록은 **2교과 테스트** 통과 필수.
- **R4 gepai MCP 가용성**(세션 중 끊김) → 어댑터가 로컬 CSV 폴백.
- **R5 문항 페이지 분할** → 블록에 `break-inside:avoid` 기본 내장.

## 7. 검증 전략

각 마일스톤마다 실물 PDF 재렌더 + 지학사 레퍼런스·직전 PoC와 시각 diff. **범교과 게이트 = 모든 공통 코어 블록이 ≥2교과에서 렌더됨.** student 빌드 정답 누출 grep 게이트.

## 8. ADR (Architecture Decision Record)

- **결정**: 독립 저장소(Option B) + 얇은 CLI + HTML-first 블록/매니페스트. slides-grab은 패턴 참고만, 포크 안 함.
- **동인**: 편집성·범교과·무API·인쇄 충실도.
- **고려한 대안**: A(포크) — 고정캔버스 충돌로 기각. C(순수 스킬) — 에디터/검증 약해 v1 철학만 차용.
- **선택 이유**: PoC가 B 렌더 경로를 이미 실증; A는 이식 마찰만 수입.
- **결과(Consequences)**: 에디터/export 배관 재구현 필요(비용). 대신 A4 흐름·교과 팩에 깔끔히 맞고 상류 결합 없음.
- **후속(Follow-ups)**: 비주얼 에디터 다중페이지 스파이크(M4), DSL 승격 여부는 M3 이후 재평가.

## 9. 실행 경로 (승인 시)

- 권장: **team**(병렬 코디네이트) 또는 **ralph**(순차+검증). M1부터 착수.
- 미승인 상태: 본 문서는 pending approval. 실행 승인 전 소스 변경/커밋/PR 없음.
