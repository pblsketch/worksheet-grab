# 핸드오프: PPTX 내보내기 (Canva 편집 가능성)

> 새 세션에서 이 문서를 단일 진실원천으로 삼아 착수한다. 목표: worksheet-grab 산출물을 **PPTX로 내보내** 교사가 Canva(또는 PowerPoint·구글 슬라이드)에서 **표·도형·크기까지 네이티브로 편집**할 수 있게 한다.

## 1. 왜 하는가 (근거)

- 지금 교사가 HTML/PDF를 Canva에 반입하면 **텍스트만 편집 가능**하고 표·도형(SVG)·크기는 편집이 안 된다.
- 원인: Canva의 HTML/PDF 반입은 "페이지를 이미지로 굽고 인식된 텍스트만 편집 레이어로 얹는" 방식이라, HTML `<table>`·인라인 SVG·CSS 박스가 **네이티브 개체로 분해되지 않는다.**
- 반면 Canva는 **PPTX를 반입하면 네이티브 개체로 분해**한다: PPTX 표 → 편집 가능한 Canva 표, PPTX 도형 → 편집 가능한 도형, 텍스트 상자 → 텍스트. 그래서 PPTX가 정공법.
- 현재 `--canva`(`src/usecases/canvaExport.js`)는 HTML에 `data-document-role="page"` 주석만 주입하는 수준이라 이 한계를 못 넘는다. PPTX 경로는 **아직 없다**(내보내기는 PDF·PNG·HTML뿐).

## 2. 반드시 먼저 정할 결정 2가지

### 결정 A — 무의존 vs 라이브러리
- 이 저장소는 **완전 무의존**이다: `package.json` 의 `dependencies`/`devDependencies` 모두 `{}`. 테스트는 `node:test`.
- PPTX는 XML 여러 개를 담은 ZIP(OOXML)이다. 두 갈래:
  - **(a) 무의존 하드롤**: node 내장 `zlib`로 ZIP을 직접 쓰고 슬라이드 XML을 문자열로 생성. 저장소 철학 유지. 대신 OOXML 스펙(슬라이드·표·도형·텍스트·관계 파일) 학습 비용.
  - **(b) `pptxgenjs` 추가**: 개발 속도 빠름. 대신 무의존 철학 깨짐(첫 런타임 의존성). 유지보수·번들 영향 검토 필요.
- **권장**: Phase 0 스파이크에서 (a) 최소 하드롤 PPTX writer가 현실적인지 먼저 측정. 표·텍스트·도형·이미지 4종만 필요하므로 OOXML 표면적이 작다. 감당 안 되면 (b)로 결정하고 사용자에게 무의존 예외를 명시적으로 승인받는다.

### 결정 B — PPTX가 소비할 소스 (개체트리 vs {type,html})
- 렌더 소스가 두 가지다:
  - **개체트리(권장 소스)**: 닫힌 14개 타입(아래) + 필드. `schema/worksheet-object.schema.json`. `src/usecases/RenderObjectTree.js` 가 이걸 HTML로 렌더한다 — **PPTX 렌더러가 그대로 병렬할 모델**.
  - **`{type, html}` 레거시 블록**: `manifests/*.json`·`generate`·손저작 매니페스트가 쓰는 형태. `AssembleWorksheet.js` 가 html 을 concat. HTML을 파싱해 PPTX로 가는 건 지저분하다.
- **권장**: PPTX는 **개체트리를 소비**한다(RenderObjectTree 와 대칭인 `RenderObjectTreePptx`). 첫 과제로 "실제 doc/편집기가 개체트리를 저장하는지, `{type,html}`인지" 확인하고, 개체트리 경로를 1급으로 삼는다. `{type,html}` 전용/`richtext` 탈출구 블록은 텍스트 추출 또는 이미지 폴백.

## 3. 닫힌 개체 카탈로그 14종 (스키마)
`title · passage-slot · question · table · image-slot · answer-area · divider · shape · richtext · std-box · callout · organizer · spacer · page-break`
(불변식: **신규 타입 창설 금지.** PPTX는 이 14종만 매핑한다.)

## 4. 개체 → PPTX 매핑 (제안)
| 개체 타입 | PPTX 표현 | 편집성 |
|---|---|---|
| title | 텍스트 상자(+ 상단 배지/제목 박스는 도형+텍스트) | ✅ |
| question / richtext / callout / std-box | 텍스트 상자(서식 런) | ✅ |
| table | **PPTX 네이티브 표**(행·열·셀 텍스트) | ✅ (핵심) |
| organizer (표형: KWL·프레이어·비교표 등) | PPTX 네이티브 표 | ✅ |
| organizer (도해형: 벤·피시본·개념지도·플롯) | Phase 1: 이미지(PNG). Phase 2: 네이티브 도형 | 1단계 △ |
| shape (사각/원/선/화살표) | PPTX 도형 | ✅ |
| answer-area | 빈 텍스트 상자 또는 테두리 도형(밑줄/박스) | ✅ |
| image-slot | 그림 자리(placeholder 도형 + 캡션 텍스트) | ✅ |
| divider | 선 도형 | ✅ |
| spacer / page-break | 레이아웃(간격/슬라이드 분리). 개체 아님 | — |

- SVG 도해·모눈 그래프(svg-graph): Phase 1은 **기존 Chrome 렌더러로 PNG를 떠서 그림으로 삽입**(위치·크기는 편집되나 내부는 고정). `src/adapters` 의 Chrome 렌더 재사용.
- 색: 디자인 시스템 색을 재사용(중립 팔레트 `--c*`/의미색). 팔레트 값은 `themes/*.css`·`docs/design-system/design-tokens.json`.

## 5. 슬라이드/페이지
- `.sheet` 한 쪽 = 슬라이드 한 장. **A4 비율**(치수는 `src/domain/paper.js` `resolvePaper`/`paperDims`, 세로 210×297mm). 가로/복합 방향도 있으니 페이지 메타(paper) 존중.
- 좌표는 mm→EMU 변환(1mm = 36000 EMU). blocks 는 flow 라 절대좌표가 없다 — PPTX는 **위에서 아래로 흐르며 y를 누적 배치**(개체 높이 측정 필요; 텍스트는 대략 추정 또는 Chrome 측정 재사용 검토).

## 6. 학생용/교사용 (불변식)
- 교사용은 정답 포함, 학생용은 **정답 물리 제거 + 누출 게이트(fail-closed)**. HTML 내보내기의 answer 스트립/누출검증 로직을 재사용해야 한다: `ExportDocument`·`html-scan`(누출 탐지)·`.answer` 처리. PPTX에서도 정답 개체는 학생용에서 물리 제거하고, 누출 감지 시 학생 PPTX 미생성(스테일 제거)한다 — HTML `--canva` 대칭(`src/cli/index.js:989~` 참조).

## 7. 단계 계획
- **Phase 0 · 스파이크(가장 먼저)**: 무의존 하드롤로 **슬라이드 1장 + 텍스트 상자 1 + 네이티브 표 1 + 도형 1**을 담은 최소 PPTX를 만든다. → PowerPoint/LibreOffice/구글 슬라이드로 열려 편집되는지 + **Canva에 업로드해 표·도형이 편집 가능한지 실측**. 이게 전체 feature 최대 위험 해소. (하드롤이 과하면 결정 A를 (b)로.)
- **Phase 1 · 텍스트+표+박스 네이티브**: title/question/richtext/callout/std-box → 텍스트, table/organizer(표형) → PPTX 표, answer-area/divider/shape → 도형, image-slot → 그림. **SVG 도해/그래프는 PNG 이미지**로. 학생/교사 분리 + 누출 게이트.
- **Phase 2 · 도해 네이티브화**: 자주 쓰는 조직자(벤·피시본·개념지도)부터 PPTX 도형으로 승격.
- **Phase 3 · CLI 배선**: `doc export --pptx`(+ `--canva`와 공존), `pipeline`/`generate --pptx` 옵션, 산출 `worksheet-{student,teacher}.pptx`. `--canva` 문구를 "PPTX 업로드 시 편집 가능" 안내로 보강.

## 8. 접점 파일
- 모델: `src/usecases/RenderObjectTree.js`(개체트리→HTML, `renderByType` 디스패처 305~321행 + 타입별 `renderX`). PPTX는 이 구조를 그대로 병렬(`RenderObjectTreePptx` 또는 `src/adapters/PptxRenderer`).
- 타입 계약: `schema/worksheet-object.schema.json`.
- 기존 Canva 경로: `src/usecases/canvaExport.js`, `src/cli/index.js`(`doc export` 배선 ~986행, `--canva`).
- 조립/저장: `src/usecases/AssembleWorksheet.js`, doc 저장 경로(`SaveDocument`).
- 용지: `src/domain/paper.js`. 누출: `html-scan`·`ExportDocument`.
- 신규(예상): `src/adapters/PptxWriter.js`(무의존 OOXML/ZIP writer), `src/usecases/RenderObjectTreePptx.js`, `test/unit/pptx-*.test.js`.

## 9. 검증
- PPTX 유효성: 산출물을 unzip 해 `[Content_Types].xml`·`ppt/slides/slideN.xml` 존재·XML well-formed 확인(무의존 테스트).
- 편집성 실측: PowerPoint/LibreOffice/구글 슬라이드로 열어 표·도형이 개체로 잡히는지. **Canva 반입 확인**은 MCP `import-design-from-url`(공개 HTTPS URL 필요) 또는 Canva UI 직접 업로드. (공개 호스팅 없이 로컬 파일 검증이 1차.)
- 회귀: 기존 유닛/렌더/`design:lint`/편집==인쇄 parity 무붕괴(PPTX는 별도 트랙이라 HTML 경로 불변).
- 테스트 입력 예시: 이 세션에서 만든 30쪽 프로젝트 `worksheets/dw-project15/`(gitignore됨, `scratchpad/dw/build.mjs`로 재생성) — 표·조직자·도형·이미지 슬롯이 골고루 있어 좋은 픽스처.

## 10. 저장소 규약 (필수)
- 착수 전 `git status --porcelain`. **경로 명시 스테이징(add -A 금지).** 커밋은 사용자 요청 시에만. 렌더 테스트는 `--test-concurrency=1`.
- blocks.css 를 건드리면 **L0 baseline 재생성**(`node tools/regen-blocks-baseline.mjs`) + `design:lint`. (PPTX는 blocks.css 무관할 가능성이 크다.)
- **줄바꿈**: 저장소는 CRLF 관행(.gitattributes 없음). sed 사용 시 LF 혼입 주의(`sed -i 's/\r*$/\r/'`로 정규화).
- **em대시(—) 사용 금지**(한국어 산출물·문서). `:`/`,`/`~`로 대체.
- 무의존 유지가 기본. 라이브러리 추가는 사용자 승인 필요(결정 A).

## 11. 이번 세션 맥락(참고)
- 방금 디자인 시스템을 개선함: 색-교과 디커플(기본 팔레트 `neutral`), `--wg-*` 토큰, 의미색 allowlist, 계약 `docs/design-system/PAPER.impeccable.md` + `design-tokens.json` + 검출기 `tools/design-lint.mjs`. PPTX 색은 이 팔레트를 재사용.
- 지시문 `.direct` 는 인라인 글리프로 수정됨(단 나뉨 버그 해결). 매니페스트 `{type,html}` 형식은 `manifests/sci-photosynthesis.json` 참고.
- Canva MCP 도구 사용 가능: `import-design-from-url`(PPTX/HTML/PDF 반입), `export-design`(pptx 지원), `autofill-design`, 브랜드 템플릿.
