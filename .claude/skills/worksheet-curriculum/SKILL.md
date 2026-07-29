---
name: worksheet-curriculum
description: 활동지의 2022 개정 교육과정 성취기준 원문을 조회·매핑한다. 교과·학년·주제로 성취기준 코드와 원문을 확보할 때, 활동지 헤더의 성취기준 라벨을 채울 때, "성취기준 연계", "성취기준 원문", "교육과정 매핑"을 요청할 때 반드시 사용. gepai MCP 우선, 실패 시 로컬 CSV 폴백. 성취기준 원문은 조회만 하고 절대 창작하지 않는다.
---

# worksheet-curriculum (성취기준 조회·매핑)


성취기준은 교사가 검토·제출하는 공식 근거다. **원문을 지어내면 신뢰가 무너진다.** 그래서 이 스킬은 오직 실제 데이터에서 조회만 한다.

## 엔진 배선 (worksheet-grab CLI)
엔진의 `GepaiCurriculum` 이 이 조회를 코드로 구현한다(CSV 1차·MCP 옵션, 창작 금지 동일). 루트: 프로젝트 저장소 최상위(현재 작업 디렉터리 기준).
- `generate`/`pipeline` 명령은 `search({school, subject, keyword})` 로 학교급·과목·주제 키워드 성취기준을 조회하고, 헤더에 원문을 자동 주입한다.
  - 예: `node bin/worksheet-grab.js generate 중2과학 광합성` → `[9과12-01..03]` 원문 헤더.
- 키워드는 성취기준 **원문에 실제로 등장하는 용어**여야 매칭된다(예 "광합성"·"전류"). 미발견 시 엔진은 창작하지 않고 오류를 낸다 → 이때 코드 직접 지정(`code`)으로 조회.
- MCP off(기본)에서도 CSV 로 성공. 아래 수동 조회는 CLI 부재 시 대체.

## 조회 경로 (폴백 순서)
1. **1차 — gepai MCP**: `mcp__gepai__search_standards` 호출.
   - 파라미터: `query`(주제 키워드) 또는 `code`(코드 접두어), `subject`, `school_level`, `grade`, `limit`.
   - 반환: `{code, school, subject, grade, content}` — `content`가 원문.
2. **2차 — 번들 CSV 폴백** (MCP가 없거나 `No such tool`/연결 끊김일 때):
   - 파일: 번들 CSV `data/achievement-standards.csv` (리포에 포함, `import.meta.url` 기준 해석 — 클론 위치·CWD 무관). `--csv`/`GEPAI_CSV` 로 override 가능.
   - 컬럼: `학교,과목,학년(학년군),성취기준 코드,성취기준 내용`
   - 조회 예: `grep "<과목>" 파일 | grep -E "<키워드>"` 로 후보를 찾고 코드·원문을 추출.
   - 이 번들 CSV 가 유일한 로컬 소스다 — 외부 절대경로 폴백에 의존하지 않는다(모든 사용자 클론만으로 동작).

## 선정 규칙
- 주제에 여러 성취기준이 걸리면 **핵심 1~2개**만 선정하고, 각각 "왜 이 성취기준인가" 한 줄 근거를 남긴다.
- 코드·원문을 **글자 그대로** 보존한다. 요약·의역 금지(헤더엔 원문이 들어가야 함).
- 학년/학교급이 모호하면 후보를 제시하고 planner에게 확인을 요청한다.

## 출력
`_workspace/01_curriculum_standards.json`
```json
{ "status":"resolved",
  "standards":[{"code":"[9과14-02]","text":"...", "subject":"과학"}],
  "rationale":"주제 '옴의 법칙'은 저항·전류·전압 관계 도출 성취기준에 직결",
  "suggestedFlow":"탐구문제→변인설계→측정표→그래프→관계식→성찰" }
```
- 둘 다 실패하면 `"status":"unresolved"` + 사용자에게 코드 직접 입력 요청. 임의 생성 금지.

## 검증
조회한 코드가 실제 CSV/MCP에 존재하는지 1건이라도 역조회로 확인한 뒤 확정한다.
