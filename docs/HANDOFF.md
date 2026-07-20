# HANDOFF — worksheet-grab / Milestone M1 (Core Engine)

> 이 문서만 읽어도 새 세션에서 작업을 시작할 수 있도록 자기완결적으로 작성됨.
> 함께 읽을 것: `docs/PLAN.md`(Clean Architecture 전체 설계). 작성일 2026-07-20.

## 0. 한 줄 요약
slides-grab처럼 **생성·편집·내보내기**가 되는 한국 교사용 활동지 서비스. 지금까지 계획·하네스·PoC가 끝났고, **다음 할 일은 M1 "코어 엔진"(Node CLI + 블록 라이브러리 추출)을 구현**하는 것이다.

## 1. 지금까지 확정된 것 (변경 금지 전제)
- **운영 모델**: 사용자 구독 AI(Claude/Codex)가 콘텐츠를 저작. **API 키 없음.**
- **문서 = HTML/CSS**, 인쇄가 진실의 원천(**paper-css**, A4/B4 다중페이지).
- **Clean Architecture(Ports & Adapters)** — `docs/PLAN.md` 4장. 변하는 3경계에만 DIP: Curriculum(gepai MCP↔CSV), Renderer(Chrome), ContentAuthor(에이전트).
- **범교과(국어 비특화)가 하드 제약.** 교과색은 CSS 변수로만, 교과 특수 블록은 해당 교과에서만.
- **학생용/교사용 2벌**: 단일 HTML `data-mode="MODE_TOKEN"` + `.answer`/`.plot-ans` 토글 → 치환해 2벌.
- **성취기준 원문**: gepai에서만 조회, 창작 금지. **저작권 지문은 슬롯**(교사 삽입).

## 2. 이미 존재하는 자산 (재사용/근거)
- `poc/worksheet.html` — 국어(선풍기토론) 활동지, 검증됨. 렌더 시 **5쪽**.
- `poc/science.html` — 과학(옴의법칙) 활동지, 검증됨. 렌더 시 **3쪽**. KaTeX·SVG그래프·변인표 포함.
- `poc/*_student.pdf`, `poc/*_teacher.pdf` — 각 PoC의 렌더 결과(비교 기준).
- `docs/PLAN.md` — Clean Architecture 설계 + 로드맵 M0~M6 + ADR.
- `.claude/agents/` (5), `.claude/skills/` (6) — 하네스(런타임 에이전트 팀). **M1은 이 팀이 나중에 위임할 CLI 엔진을 만드는 것.**
- 성취기준 CSV(gepai MCP 대체 폴백): `E:/github/gepai-mcp/data/source/achievement-standards.csv`
  - 컬럼: `학교,과목,학년(학년군),성취기준 코드,성취기준 내용`. 예: `중학교,과학,1~3학년,[9과14-02],전기 회로에서 전류를 모형으로...`

## 3. M1 범위 (구현 대상) — 이것만 한다
Clean Architecture 계층으로 Node CLI(`worksheet-grab`)를 만든다.

### 3.1 디렉토리(제안)
```
src/
  domain/        # 순수 엔티티: Worksheet, Block, Variant, Standard (프레임워크 의존 0)
  usecases/      # AssembleWorksheet, BuildVariants, ValidateWorksheet, RenderPdf (포트에만 의존)
  adapters/      # ChromeRenderer, FsBlockRepository, GepaiCurriculum(MCP+CSV폴백)
  cli/           # 커맨드 파서
bin/worksheet-grab.js   # 엔트리
blocks/          # poc에서 추출한 공통코어+교과 블록 HTML 파셜(+슬롯)
themes/          # 교과 CSS 토큰 (.claude/skills/worksheet-design/references/themes.md 기준)
assets/paper.css # paper-css 베이스
test/            # 수용 테스트
```

### 3.2 CLI 커맨드 (M1 필수)
- `build-variants <in.html> --out <dir>` → `MODE_TOKEN`을 student/teacher로 치환한 2 HTML.
- `render <in.html> --out <file.pdf>` → Chrome 헤드리스 `--print-to-pdf`.
- `validate <in.html>` → 인쇄안전(keep-together·최소폰트)·**정답 누출**·범교과(하드코딩색) 정적 검사.
- `list-blocks`, `list-themes` → 라이브러리 나열.

### 3.3 블록/테마 추출
- `poc/worksheet.html`·`science.html`에서 공통 코어 블록(header·standard-label·directive·resource-box·answer-slot·rubric·reflection)과 교과 팩(국어: passage·pro-con·memo / 과학: variable-table·data-table·svg-graph·formula)을 `blocks/*.html` 파셜로 추출. 슬롯 규약은 `.claude/skills/worksheet-design/references/block-library.md`.
- 교과 색은 `themes/{subject}.css`로 분리(하드코딩 제거).

## 4. 수용 기준 (테스트 가능 — 전부 통과해야 M1 완료)
1. `node bin/worksheet-grab.js build-variants poc/worksheet.html --out out/` → `worksheet-student.html`, `worksheet-teacher.html` 생성.
2. `node bin/worksheet-grab.js render out/worksheet-student.html --out out/ko-student.pdf` → PDF 생성, **국어=5쪽**. 과학은 **3쪽**.
3. `validate`가 **정답 누출을 탐지**한다: student HTML에 `.answer` 밖으로 정답 텍스트를 일부러 심은 픽스처를 넣으면 FAIL을 반환(양성 탐지 단위 테스트).
4. `validate`가 **하드코딩 교과색**(예: `#7cb342` 직접 사용)을 범교과 위반으로 경고.
5. **블록 라이브러리에서 재조립**한 국어·과학 활동지가 원본 PoC와 시각적으로 근사(페이지 수 일치 + 주요 컴포넌트 존재). `test/`에 자동 검사.
6. 도메인/유스케이스가 **Chrome 없이 단위 테스트** 가능(Renderer 목으로 AssembleWorksheet·BuildVariants·ValidateWorksheet 테스트).

## 5. 검증 방법 (매 루프 실행)
```bash
# 유닛/수용 테스트
node --test            # 또는 채택한 러너
# 실물 렌더 확인(수동 게이트)
node bin/worksheet-grab.js render poc/science.html --out out/sci.pdf   # 3쪽 확인
```
- PDF 페이지 수는 렌더 후 확인. 정답 누출은 student HTML/PDF에서 정답 문자열 grep으로 2차 확인.

## 6. 환경/함정 (실제로 겪은 것)
- OS Windows, **Node 24**, 셸은 Git Bash. 크롬 경로: `/c/Program Files/Google/Chrome/Application/chrome.exe`.
- 렌더 명령: `--headless=new --disable-gpu --no-sandbox --print-to-pdf-no-header --virtual-time-budget=15000`. **virtual-time-budget이 짧으면 Pretendard 웹폰트·KaTeX·SVG가 깨진다.**
- **한글 단어 중간 분리**(예: "작/성") → `body{word-break:keep-all}` 필수.
- **gepai MCP는 세션 중 끊길 수 있다**(실제로 `No such tool` 발생). 그래서 코드에서 **CSV를 1차/동등 경로로** 두고 MCP는 옵션.
- 문항 페이지 잘림 → 블록에 `break-inside:avoid`.
- 정답은 반드시 `.answer` 안에만. 학생용 빌드에서 민감 정답은 비노출.

## 7. 하지 말 것 (스코프 아웃 — M1 아님)
- 스킬 파이프라인/에이전트 팀 자동화(M3), 비주얼 에디터(M4), 사회·영어 팩(M5), PNG/카드(M6)는 **건드리지 않는다**.
- 성취기준 원문을 코드에 하드코딩하거나 창작하지 않는다(CSV/MCP 조회만).
- 저작권 지문 텍스트를 채우지 않는다(슬롯 유지).
- `.claude/`(하네스)와 `poc/` 원본은 **삭제·훼손 금지**(참고·복사만).

## 8. 완료(Definition of Done)
4장의 수용 기준 1~6 전부 통과 + `docs/PLAN.md` 로드맵 M1 항목에 완료 표시 + 짧은 `README.md`(설치·CLI 사용법) 작성.
