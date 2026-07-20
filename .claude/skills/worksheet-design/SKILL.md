---
name: worksheet-design
description: 활동지 아웃라인을 실제 A4 HTML(paper-css)로 저작하고 편집한다. 블록 라이브러리·교과 테마를 조립하고 학생용/교사용을 data-mode로 마킹. "활동지 디자인/HTML 제작", "문항 추가·삭제·수정" 편집 요청 시 사용. 범교과 — 교과색은 CSS 변수로만.
---

# worksheet-design (활동지 HTML 저작·편집)

아웃라인(`02_outline.json`)을 실제 인쇄 가능한 A4 HTML로 만든다. PoC(`E:/github/worksheet-grab/poc/worksheet.html`, `science.html`)가 검증된 기준 템플릿이다 — 새로 짜기 전에 참고하라.

## 엔진 배선 (worksheet-grab CLI)
M1/M2 엔진이 블록·테마·성취기준을 결정적으로 조립한다(paper-css 정형화·범교과 var 처리 내장). 루트: `E:/github/worksheet-grab`.
- **템플릿 경로(권장)**: `generate <학년교과> <주제>` — 교과 템플릿(`templates/science.json`·`korean.json`)에 성취기준·주제를 채워 `03_worksheet.html` 상당의 HTML 산출. 콘텐츠는 슬롯(교사/AI 저작).
- **매니페스트 경로**: 블록 순서를 직접 지정하려면 `manifests/*.json` 형태로 기술 후 `assemble <manifest> --out 03_worksheet.html`.
- 블록/테마 자원: `blocks/`, `themes/{ko,sci}.css`, `assets/paper.css`·`blocks.css`. 교과색은 `var(--*)` + 테마 `:root` 로만(하드코딩 금지).
- 저작·편집 후 `validate` 로 즉시 자가 점검(정답 누출·하드코딩색). 아래는 HTML 패턴 참고(수동 저작 시).

## 레이아웃 베이스 (paper-css)
- `@page{size:A4;margin:0}` + `.sheet{width:210mm;min-height:297mm;padding:16mm 15mm 14mm;page-break-after:always}`
- `body{ font-family:"Pretendard","Malgun Gothic",sans-serif; word-break:keep-all; -webkit-print-color-adjust:exact }`
- 각 페이지 = `<section class="sheet">`. 인쇄 시 `margin:0`, 화면 시 그림자.

## 인쇄 안전 규칙 (검수에서 걸리는 것들)
- 문항 단위에 `break-inside:avoid`(페이지 경계 잘림 방지).
- 본문 최소 9pt+, 절대 하한 유지. 한글은 `word-break:keep-all`로 단어 중간 분리 금지.
- 원격 이미지 인라인 금지 → 슬롯/로컬 애셋.

## 정답 모델 (학생용/교사용 한 파일)
- `<html data-mode="MODE_TOKEN">` — export가 student/teacher로 치환.
- 정답은 반드시 `.answer`(또는 그래프 오버레이 `.plot-ans`) 안에만.
  ```css
  .answer{ display:none; }
  [data-mode="teacher"] .answer{ display:block; color:#1a5fb4; }
  ```
- 학생용에서 정답이 DOM에 남더라도 시각적으로만 숨는 게 아니라, **민감 정답은 아예 비노출** 설계를 우선(누출 게이트 통과 목적).

## 조립 절차
1. 아웃라인의 `theme`로 교과 색 토큰을 `:root`에 주입한다 → `references/themes.md`.
2. 블록 순서대로 공통 코어 + 교과 팩 블록을 조립한다 → `references/block-library.md`(블록별 HTML/CSS 패턴·슬롯).
3. 성취기준 라벨에 `01_curriculum_standards.json`의 원문을 **그대로** 넣는다(창작 금지).
4. 저작권 지문은 `[지문 삽입 슬롯]` 박스로.
5. 매니페스트 `03_manifest.json`(사용 블록·테마·폰트/수식 플래그) 기록.

## 편집 모드 (대화형)
- 기존 `03_worksheet.html`을 대상으로 지시된 블록만 수정, 나머지 보존. 전면 재생성은 사용자 명시 시만.
- 편집 후 반드시 reviewer 재검수를 거친다.

## 참조
- `references/block-library.md` — 12+ 블록 HTML/CSS 패턴과 슬롯 정의
- `references/themes.md` — 교과별 CSS 변수 토큰
