# worksheet-grab

한국 K-12 교사용 **활동지 제작 코어 엔진**(Milestone M1~M6 완료). Clean Architecture(Ports & Adapters)로 만든 Node CLI.
문서는 HTML/CSS, **인쇄가 진실의 원천**(paper-css, A4 다중페이지). 교과색은 CSS 변수로만 주입하는 **범교과** 설계(국어·과학·사회·영어).
한 문장 생성(`pipeline`/`generate`) → 대화형 편집(`edit`) → PDF/PNG 내보내기까지 종단 지원.

- API 키 없음 — 콘텐츠는 사용자 구독 AI가 저작.
- 성취기준 원문은 gepai CSV/MCP **조회만**(창작 금지). 저작권 지문은 슬롯 유지.
- 학생용/교사용 2벌은 단일 HTML의 `data-mode` 토글 + 정답 제거로 생성.

## 요구 환경

- **Node ≥ 24** (의존성 0 — 표준 라이브러리만 사용)
- 렌더에 **Google Chrome** 필요. 자동 탐색 경로:
  `C:/Program Files/Google/Chrome/Application/chrome.exe` (또는 `CHROME_PATH` 환경변수)
- (선택) 성취기준 CSV: `E:/github/gepai-mcp/data/source/achievement-standards.csv`

## 설치

```bash
git clone <repo> worksheet-grab
cd worksheet-grab
# 별도 install 불필요(의존성 없음)
node bin/worksheet-grab.js help
```

전역 링크(선택):

```bash
npm link          # 이후 `worksheet-grab <command>` 로 실행
```

## 빠른 시작 — 새 환경에서 한 문장으로 (M6)

의존성 0이라 클론만 하면 바로 한 문장으로 활동지가 나온다(Chrome·성취기준 CSV는 아래 요구 환경 참고).

```bash
git clone <repo> worksheet-grab && cd worksheet-grab

# 한 문장 → 검수 게이트 통과 시 student/teacher A4 PDF
node bin/worksheet-grab.js pipeline 중2과학 광합성 --out out/

# 렌더 없이 초안만(교사 검토 후 인쇄): --no-render
node bin/worksheet-grab.js pipeline 중2사회 인구 --out out/ --no-render

# 편집: 산출된 매니페스트에 지시 반영 → 재조립·재렌더
node bin/worksheet-grab.js edit out/science-광합성.manifest.json "3번 문항 빼고 성찰 추가" --out out/

# 미리보기 PNG(카드)까지
node bin/worksheet-grab.js generate 중2영어 감정 --out out/ --png
```

`npm link`(또는 `npm pack` 후 설치) 하면 `worksheet-grab pipeline …` 처럼 어디서나 실행된다.
`.claude/skills/worksheet-grab` 오케스트레이터가 이 CLI를 그대로 구동하므로, AI 에이전트가 "활동지 만들어줘" 한 문장으로도 동일 파이프라인을 돌린다.

## CLI 사용법

```bash
# 1) MODE_TOKEN → 학생용/교사용 2벌 치환
node bin/worksheet-grab.js build-variants <in.html> --out <dir>
#   → <dir>/<base>-student.html, <dir>/<base>-teacher.html
#     student 벌은 .answer/.plot-ans 정답 내용을 물리적으로 제거한다.

# 2) Chrome 헤드리스로 PDF 렌더
node bin/worksheet-grab.js render <in.html> --out <file.pdf> \
    [--virtual-time-budget 15000] [--chrome <path>]
#   virtual-time-budget 이 짧으면 웹폰트·KaTeX·SVG 가 깨진다(기본 15000).

# 3) 정적 검사(정답 누출·미기입 슬롯·하드코딩 교과색·최소폰트)
node bin/worksheet-grab.js validate <in.html>
#   정답 누출 발견 시 종료코드 1(FAIL). 하드코딩 교과색·미기입 슬롯(［…슬롯］ 잔존)은 경고.

# 4) 블록 라이브러리에서 활동지 재조립(블록 + 테마 + 성취기준 CSV)
node bin/worksheet-grab.js assemble <ko|sci|manifest.json> --out <file.html>

# 5) 학년+교과+주제로 활동지 생성(M2) — 성취기준 CSV 조회 + 교과 템플릿
node bin/worksheet-grab.js generate <학년교과> <주제> [--out <dir>] [--pdf] [--standards <코드,..>] [--limit <N>]
#   예: generate 중2과학 광합성  ("중2 과학 광합성" 처럼 띄어 써도 됨)
#   → 성취기준을 CSV(MCP off에서도)에서 조회해 헤더에 원문 주입, 교과 템플릿으로
#     활동지 + student/teacher 2벌 생성. --pdf 지정 시 A4 PDF까지 렌더.
#   --standards [9과12-01],[9과12-02] 로 성취기준 직접 선택, --limit 로 자동 조회 개수 제한(기본 6).
#   학년을 생략해 학교급(중/고)이 섞이면 fail-closed 오류로 막는다.
#   CSV 위치는 --csv <경로> 또는 GEPAI_CSV 환경변수로 지정(기본: E:/github/gepai-mcp/...).

# 6) 종단 파이프라인(M3) — 조회→조립→2벌→검수 게이트→렌더
node bin/worksheet-grab.js pipeline <학년교과> <주제> [--out <dir>] [--no-render]
#   검수(정답 누출·하드코딩색) 실패 시 렌더 중단(fail-closed). HITL: 교사 검토 후 인쇄.

# 6.5) 동적 조립(Phase 4) — 주제에 맞는 아키타입으로 "저작 대기 스캐폴드" + 저작 브리프
node bin/worksheet-grab.js compose <학년교과> <주제> [--archetype <id>] [--standards <코드,..>] [--out <dir>] [--render]
#   예: compose 중2과학 광합성            → 실험탐구 아키타입(변인표·그래프)
#       compose 중2과학 "생물 분류"        → 개념구조화 아키타입(비교표·구조표, 변인표/그래프 강제 안 됨)
#   주제 키워드로 아키타입을 추천(‑‑archetype 로 직접 지정). 성취기준·제목은 결정적으로 채우고,
#   교육적 본문은 designer AI/교사가 인라인 html 을 저작(무API). 이후 assemble/pipeline 로 렌더(검수 게이트).

# 7) 대화형 편집(M4) — 매니페스트에 지시 반영 → 재조립·재렌더
node bin/worksheet-grab.js edit <base>.manifest.json "3번 문항 빼고 성찰 추가" [--out <dir>] [--no-render] [--in-place]
#   pipeline/generate 가 산출한 <base>.manifest.json 을 입력. --remove <N> / --add reflection 플래그도 가능.
#   기본은 원본 보존: 편집본은 <base>-v2, -v3 … 로 저장(--in-place 지정 시에만 덮어쓰기).
#   복수 문항 지시("1번과 2번 문항 빼줘", "1, 3번 제거")를 지원하며, 이해하지 못한 번호가 남으면
#   일부만 적용하지 않고 전체를 중단한다(부분 적용 방지). 제거 후 문항 번호는 1..N 로 재부여.

# 8) PNG 미리보기/카드(M6) — 첫 A4 페이지만 렌더된다(카드/썸네일 용도)
node bin/worksheet-grab.js render <in.html> --png <out.png>
node bin/worksheet-grab.js generate 중2영어 감정 --out out/ --png   # 2벌 PNG 동시 산출

# 9) 문서 워크스페이스(E1) — worksheets/<문서명>/ 폴더 단위 저장·히스토리
node bin/worksheet-grab.js generate 중2과학 광합성 --doc 광합성탐구   # out/ 대신 문서로 생성
node bin/worksheet-grab.js edit --doc 광합성탐구 "3번 문항 빼줘"      # 문서명으로 편집(스냅샷 자동)
node bin/worksheet-grab.js doc list                                   # 문서 목록(리비전·unsafe 배지)
node bin/worksheet-grab.js doc open 광합성탐구                        # 로드·상태 표시(에디터 기동은 E2)
node bin/worksheet-grab.js doc history 광합성탐구                     # 편집 스냅샷 목록(무료 undo)
node bin/worksheet-grab.js doc restore 광합성탐구 0001                # 비파괴 복원(새 리비전으로 저장)
node bin/worksheet-grab.js doc save 광합성탐구 --from x.manifest.json # 원시 저장 진입점(E2 서버용)
node bin/worksheet-grab.js edit-ui 광합성탐구                         # 브라우저 에디터(E3): 편집·마크·저장
#   교사용 캔버스에서 자유 편집(툴바: 폰트·크기·B/I/U·색·정렬·목록·표·이미지·↶↷).
#   ⭐ 정답 표시: 아무 내용이나 선택해 마크 → 학생용에서 자동 물리 제거(2벌 자동 생성).
#   ✏️ 답란 삽입: 현재 블록에 답란 5줄. 저장(Ctrl+S) = manifest 반영 + 히스토리 스냅샷.
#   실시간 예고: 페이지 넘침 빨강 배지 · 8pt 미만 즉시 경고 · 라이브 검수 바.
#   manifest 가 진실의 소스. 매 저장 = history/ 스냅샷 + meta 리비전(.worksheet-grab/meta.json).
#   정답 누출(마크 밖 평문) 감지 시 student.html 을 보류하고 meta.unsafe 를 남긴다(작업은 저장됨).
#   워크스페이스 루트는 기본 <cwd>/worksheets, --workspaces-dir 로 변경.

# 10) 라이브러리 나열
node bin/worksheet-grab.js list-blocks                    # 타입 exemplar 파일(core/*, pack-*/*)
node bin/worksheet-grab.js list-vocab                     # 블록 타입 어휘 + 계약(코어/교과팩·슬롯)
node bin/worksheet-grab.js list-vocab --subject science  # 과학에서 쓸 수 있는 타입만
node bin/worksheet-grab.js list-archetypes               # 교과 초월 구조 패턴 6개(동적 조립용)
node bin/worksheet-grab.js list-archetypes --subject science  # 아키타입을 교과에 바인딩한 시퀀스
node bin/worksheet-grab.js list-themes
```

### M4 예시 (edit — 대화형 편집 왕복)

```bash
node bin/worksheet-grab.js generate 중2과학 광합성 --out out/   # → out/science-광합성.manifest.json
node bin/worksheet-grab.js edit out/science-광합성.manifest.json "3번 문항 빼고 성찰 추가" --out out/
#   매니페스트·HTML 양쪽에 3번 문항 제거 + 성찰 섹션 추가 반영 후 재렌더.
```

### M5 예시 (교과 확장 — 사회·영어)

```bash
node bin/worksheet-grab.js generate 중2사회 인구 --out out/ --pdf   # social(amber) 지도·연표
node bin/worksheet-grab.js generate 중2영어 감정 --out out/ --pdf   # english(indigo) 어휘·대화문
#   영어 성취기준은 언어기능 중심 → 주제는 기능 키워드(감정/정보/의도 등)로 조회된다.
```

### M2 예시 (generate)

```bash
node bin/worksheet-grab.js generate 중2과학 광합성 --out out/ --pdf
#   out/science-광합성.html (+ -student/-teacher .html, .pdf)
#   헤더에 [9과12-01..03] 성취기준 원문(CSV 조회, 창작 금지).
node bin/worksheet-grab.js generate 중3국어 매체 --out out/   # 국어(green) 템플릿
```

### M3 예시 (pipeline — 한 문장 종단 구동 + 검수 게이트)

```bash
node bin/worksheet-grab.js pipeline 중2과학 광합성 --out out/
#   ▶ 1) 성취기준 조회 → 2) 조립+2벌 → 3) 검수 게이트(PASS/FAIL) → 4) 렌더
#   검수 FAIL(정답 누출 등)이면 렌더하지 않고 종료코드 1(fail-closed).
#   .claude/skills 하네스(plan·curriculum·design·review·export)가 이 엔진 CLI를 구동한다.
```

### 종단 예시 (재조립 → 2벌 → 렌더)

```bash
node bin/worksheet-grab.js assemble ko --out out/ko.html
node bin/worksheet-grab.js build-variants out/ko.html --out out/
node bin/worksheet-grab.js render out/ko-student.html --out out/ko-student.pdf   # 국어 5쪽
node bin/worksheet-grab.js render out/ko-teacher.html --out out/ko-teacher.pdf
```

## 아키텍처 (Clean Architecture)

```
src/
  domain/      순수 엔티티(프레임워크 의존 0): Worksheet, Block, BlockContent, Variant, Standard, Theme
  usecases/    애플리케이션 규칙(포트에만 의존): AssembleWorksheet, BuildVariants, ValidateWorksheet, RenderPdf
                 + ports.js(Renderer·CurriculumProvider·BlockRepository) + html-scan.js(순수 HTML 스캐너)
  adapters/    포트 구현: ChromeRenderer, FsBlockRepository, GepaiCurriculum(CSV 1차·MCP 옵션)
  cli/         커맨드 파서
bin/worksheet-grab.js  엔트리
blocks/        타입 어휘: vocabulary.json(계약 레지스트리) + archetypes.json(구조 패턴 6) + core/*·pack-*/*(exemplar)
themes/        교과 테마 토큰 CSS(ko=green, sci=teal). 교과색은 여기 :root 변수로만.
assets/        paper.css(인쇄 베이스) + blocks.css(블록 스타일, var(--*)만 참조)
manifests/     재조립 명세(ko.json, sci.json) — 인라인 html 콘텐츠(동적 조립 모델)
templates/     교과 프리셋/few-shot 시드(강등) — generate 빠른 경로용. 상세: templates/README.md
tools/         extract-blocks.js(poc → 인라인 매니페스트 추출기)
test/          unit/(Chrome 불필요) + render/(실물 Chrome, 페이지수 검증)
```

**의존성 규칙**: 모든 의존성은 안쪽(도메인)으로만 향한다. 도메인은 Chrome·gepai·FS 를 모른다.
DIP 는 실제로 변하는 3경계(Curriculum·Renderer·ContentAuthor)에만 강하게 적용한다.

### 동적 조립(Dynamic Composition)

주제마다 구조가 달라지도록, 세 층으로 조립한다(상세: [docs/HANDOFF-dynamic-composition.md](docs/HANDOFF-dynamic-composition.md)):
1. **어휘 + 계약**(`blocks/vocabulary.json`): 타입별 재사용 부품·인쇄안전 계약(코어 17·교과팩 11). 코어는 `var(--*)`만.
2. **아키타입**(`blocks/archetypes.json`): 교과 초월 구조 패턴 6종(실험탐구·자료해석·읽기독해·토론의사결정·개념구조화·프로젝트제작). "어느 타입을 어떤 순서로" + packRole 교과 바인딩.
3. **compose**(`ComposeWorksheet`): 요청+성취기준+아키타입 → 저작 대기 스캐폴드 + 저작 브리프. 엔진은 구조만(결정적), 교육적 본문은 designer AI/교사가 저작(무API).

같은 교과라도 주제가 다르면 구조가 다르다 — `compose 중2과학 광합성`(실험탐구: 변인표+그래프) vs `compose 중2과학 "생물 분류"`(개념구조화: 비교표+구조표). 비실험 주제가 실험 구조에 강제되지 않는다. 템플릿(`templates/*.json`)은 빠른 경로용 프리셋/시드로 강등.

### 블록 재조립 & 페이지 정형화

`assemble` 은 `manifests/*.json`(페이지별 블록 순서 + 성취기준 코드)과 `blocks/`,
`themes/`, `assets/` 를 결합해 활동지 HTML 을 만든다. 성취기준 라벨은 CSV(또는 MCP)에서
원문을 조회해 주입한다(창작 금지). paper.css 는 authored 섹션 수 = 인쇄 페이지 수가 되도록
수직 리듬을 정형화한다(원본 국어 PoC 의 5쪽째 오버플로우를 5쪽에 안착).

## 검증

```bash
npm test            # 전체(단위 + 실물 렌더). Chrome 없으면 렌더 테스트는 스킵.
npm run test:unit   # Chrome 불필요 단위/수용 테스트
npm run test:render # 실물 Chrome 렌더로 국어=5쪽·과학=3쪽 검증
npm run extract     # poc → manifests/ 재생성(인라인 html; 위치조각은 만들지 않음)
```

## M1 수용 기준 (전부 통과)

1. `build-variants` 가 MODE_TOKEN 을 student/teacher 2벌로 치환.
2. `render` 로 국어=5쪽·과학=3쪽 PDF 생성(`--virtual-time-budget 15000`).
3. `validate` 가 `.answer` 밖 정답 누출을 FAIL 로 탐지.
4. `validate` 가 하드코딩 교과색(#7cb342 등)을 범교과 위반으로 경고.
5. 블록 라이브러리에서 재조립한 국어·과학이 원본 PoC 와 페이지수 일치 + 주요 컴포넌트 존재.
6. 도메인/유스케이스가 Chrome 없이 단위 테스트(Renderer 목).

## 로드맵 진행 (M1~M6 완료)

- **M1 코어 엔진** — build-variants·render·validate·assemble, 블록/테마 추출.
- **M2 교과 팩 + 커리큘럼** — 템플릿·gepai 어댑터·`generate`.
- **M3 스킬 파이프라인** — `pipeline`(조회→조립→2벌→검수 게이트→렌더) + HITL.
- **M4 편집** — `edit`(매니페스트↔HTML 왕복: 문항 제거·성찰 추가·재렌더).
- **M5 교과 확장 + 검증 룰** — 사회(지도·연표)·영어(어휘·대화문) 팩 + 인쇄안전(여백·최소폰트·keep-together). 공통 코어 블록 4교과 통과.
- **M6 패키징** — 설치형(bin/files), PNG/카드 export, 새 환경 한 문장 생성 문서.

세부 수용·함정 기록은 `progress.txt`(로컬 작업 로그 — 저장소에는 포함되지 않음), 마일스톤 원장은 `.omc/ultragoal/`.
`.claude/`(하네스)와 `poc/` 원본은 참고·복사만 하며 훼손하지 않는다.
