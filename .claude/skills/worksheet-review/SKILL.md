---
name: worksheet-review
description: 활동지 HTML을 내보내기 전에 검수한다. 정답 누출·범교과성·성취기준 정합·인쇄 안전·저작권을 검증하고 PASS/FAIL을 판정할 때 사용. "활동지 검수/검증/QA", 내보내기 직전 품질 게이트에서 반드시 사용. 존재 확인이 아니라 렌더 실측 기반 경계면 검증.
---

# worksheet-review (활동지 검수 게이트)

내보내기 직전의 마지막 방어선이다. **모호한 지적은 금지** — 무엇이·어디서·왜·어떻게 고칠지를 적는다.

## 엔진 배선 (기계적 게이트 — worksheet-grab CLI)
축 1·2·4(정답 누출·하드코딩 교과색·최소폰트)는 엔진 `validate` 가 결정적으로 판정한다. 루트: `E:/github/worksheet-grab`.
```bash
node bin/worksheet-grab.js validate out/03_worksheet-student.html   # 정답 누출 시 종료코드 1(FAIL)
node bin/worksheet-grab.js validate out/03_worksheet-teacher.html
```
- 정답 누출(error) → verdict FAIL, 렌더 금지. 하드코딩 교과색/최소폰트 → warning.
- `pipeline` 명령은 이 검수를 fail-closed 게이트로 내장(통과해야 렌더).
- 축 3(성취기준 정합)·5(저작권 슬롯)는 CLI가 자동화하지 않으므로 이 스킬이 사람/에이전트 판단으로 보완한다.
- grep 은 2차 방어(엔진 build-variants 가 student 정답을 이미 제거).

## 검수 5축 (각 항목 근거 명시)

### 1. 정답 누출 (최우선)
- student 빌드에서 `.answer`/`.plot-ans` 내용이 노출되면 안 된다.
- 검사: `data-mode=student`로 치환한 HTML을 렌더 → PDF/HTML에서 정답 문자열 grep. 1건이라도 잡히면 **FAIL**.

### 2. 범교과성 (국어 비특화)
- 교과색은 CSS 변수(`--c` 등)로만, 하드코딩 금지.
- 교과 특수 블록(지문·찬반=국어, 변인표·수식=과학 등)이 **다른 교과 산출물에 새지 않았는지** 확인.

### 3. 성취기준 정합
- 헤더 성취기준 원문이 `01_curriculum_standards.json`의 `text`와 **글자 단위로 일치**. 요약·변형·창작 발견 시 FAIL.

### 4. 인쇄 안전
- 문항이 페이지 경계에서 잘리지 않음(`break-inside:avoid`).
- 본문 최소 폰트(≈9pt+), A4 인쇄 여백 확보, `word-break:keep-all`로 한글 단어 중간 분리 없음.
- 렌더 실측으로 페이지 수·빈 페이지 확인.

### 5. 저작권
- 저작권 지문이 `[지문 삽입 슬롯]`으로만 존재하고 실제 저작 텍스트가 임베드되지 않았는지.

## 실행 방식
- `general-purpose`로 동작(렌더·grep 실행 필요).
- **점진적 검수**: 산출 직후 즉시. 전체 완성 후 1회 몰아서 하지 않는다.
- 렌더 불가 시 정적 검사라도 하고 "렌더 미검증"을 명시(통과 위장 금지).

## 출력
`_workspace/04_review.json`
```json
{ "verdict":"FAIL",
  "findings":[{"severity":"critical","area":"정답누출","detail":"student 3쪽에 '3.0Ω' 노출","fix":"해당 값 .answer로 이동"}] }
```
- `verdict:PASS`일 때만 exporter로 진행. FAIL이면 designer로 반려.
