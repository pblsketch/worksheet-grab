---
name: worksheet-grab
description: 한국 교사용 활동지(활동지)를 생성·편집·내보내기하는 전체 파이프라인 오케스트레이터. "활동지 만들어줘", "OO교과 OO단원/주제 활동지", "워크시트 제작", "학습지 만들어", "성취기준으로 활동지", "활동지 수정/편집", "다시/재실행/보완", "학생용 교사용 PDF"를 요청하면 반드시 이 스킬로 팀을 조율한다. 성취기준 조회→기획→디자인→검수→내보내기를 에이전트 팀으로 수행. 범교과(국어 비특화).
---

# worksheet-grab (활동지 파이프라인 오케스트레이터)

**실행 모드: 에이전트 팀** (5명). 패턴: **Pipeline + Producer-Reviewer**.
`curriculum-mapper → worksheet-planner → worksheet-designer → worksheet-reviewer(게이트) → worksheet-exporter`

목표: 교사의 한 문장 요청("중2 과학 옴의 법칙 활동지")을 학생용/교사용 A4 PDF 2벌로. 사용자 구독 AI가 엔진(무API). 성취기준 원문은 gepai에서만, 저작권 지문은 슬롯.

## 엔진 배선 (worksheet-grab CLI — M1~M6 코어 + 동적 조립)
결정적 조립·검증·렌더는 코어 엔진 CLI가 담당한다. 루트: `E:/github/worksheet-grab`. 세 경로:
- **빠른 경로(fast/preset path)**: `node bin/worksheet-grab.js pipeline <학년교과> <주제> --out out/`
  — 한 명령이 성취기준 조회→조립→2벌→검수 게이트(fail-closed)→렌더를 종단 수행. **표준 주제·1차시**에 적합.
  구조는 교과 **프리셋 템플릿**(`templates/*.json`, few-shot 시드로 강등)에서 온다.
  단계별 명령: `generate`(조회+조립+2벌, `--pdf`/`--png` 렌더) · `validate`(검수 게이트: 정답누출·하드코딩색·인쇄안전) · `render`(A4 `--out` PDF / `--png` 미리보기) · `assemble`(블록 재조립).
  - pipeline/generate 는 재편집용 `<base>.manifest.json` 을 함께 산출한다.
- **동적 조립 경로(dynamic path)**: `node bin/worksheet-grab.js compose <학년교과> <주제> [--archetype <id>] --out out/`
  — **주제에 맞는 아키타입(구조)** 을 골라(키워드 추천 또는 `--archetype` 지정) 성취기준·제목을 채운
  "저작 대기 스캐폴드" 매니페스트 + **블록별 저작 브리프**를 낸다. 엔진은 구조만(결정적), 교육적 본문은
  **designer 가 인라인 html 을 저작**(무API). 저작 후 `assemble`/`pipeline` 로 렌더(검수 게이트).
  같은 교과라도 주제에 따라 구조가 달라진다(예: 실험 주제=변인표+그래프, 비실험=비교표+구조표 — 강제 없음).
  참고 명령: `list-archetypes [--subject]`(구조 패턴 6종) · `list-vocab [--subject]`(타입 어휘+계약). **맞춤 구조가 필요한 비표준 주제**에 1차.
- **편집 경로(M4)**: `node bin/worksheet-grab.js edit <base>.manifest.json "3번 문항 빼고 성찰 추가" --out out/`
  — 매니페스트에 편집을 왕복 반영(문항 제거·성찰 추가)한 뒤 2벌 재조립·재렌더. `--remove <N>`/`--add reflection` 플래그도 가능.
  부분 수정 요청("3번 문항 빼줘")은 이 경로가 1차. 5-에이전트 재실행은 맞춤 저작이 필요할 때만.
- **교과 범위(M5)**: 국어(korean)·과학(science)·사회(social: 지도·연표)·영어(english: 어휘·대화문). 교과색은 `themes/*.css` 토큰만.
- **풍부한 경로(rich path)**: 아래 5-에이전트 팀 — 맞춤 콘텐츠 저작·부분 재실행·다회 검수 루프가 필요할 때.
  각 에이전트는 자기 산출물을 위 엔진 명령으로 실행/검증한다(curriculum→search, **designer→compose 스캐폴드 저작 후 assemble**, review→validate, export→build-variants/render).
  designer 는 `compose` 가 낸 아키타입 스캐폴드 + 저작 브리프를 받아 인라인 html 을 주제에 맞게 저작한다(엔진 무API 준수).
- 두 경로 모두 **검수 PASS 후 HITL**(교사 검토) 게이트를 지키고, student 정답은 엔진이 물리 제거한다.

## Phase 0: 컨텍스트 확인
- 작업 디렉토리에 `_workspace/` 존재 여부로 실행 모드 판별:
  - 없음 → **초기 실행**
  - 있음 + 부분 수정 요청("3번 문항 빼줘") → **부분 재실행**(해당 에이전트만)
  - 있음 + 새 주제 → 기존을 `_workspace_prev/`로 이동 후 **새 실행**

## Phase 1: 입력 정리
- 교사 요청에서 `{subject, gradeBand, topic, 차시?}`를 추출. 모호하면 **한 번에 하나씩** 질문(교과→학년→주제 순). 확정 후 요약 확인.

## Phase 2: 팀 구성 & 작업 할당
`TeamCreate`로 5명 구성, `TaskCreate`로 의존성 있는 작업 생성. 모든 Agent 호출은 `model:"opus"`.

| 순서 | 에이전트 | 스킬 | 산출물 |
|---|---|---|---|
| 1 | curriculum-mapper | worksheet-curriculum | `01_curriculum_standards.json` |
| 2 | worksheet-planner | worksheet-plan | `02_outline.json` |
| 3 | worksheet-designer | worksheet-design | `03_worksheet.html` + `03_manifest.json` |
| 4 | worksheet-reviewer | worksheet-review | `04_review.json` (PASS/FAIL) |
| 5 | worksheet-exporter | worksheet-export | `{제목}_{subject}_student.pdf` / `_teacher.pdf` |

## Phase 3: 검수 게이트 루프 (Producer-Reviewer)
- reviewer가 **FAIL**이면 findings와 함께 designer로 반려 → 수정 → 재검수. 최대 3회.
- 3회 후에도 critical 결함이 남으면 진행을 멈추고 사용자에게 상태를 보고한다(통과 위장 금지).
- **PASS 시 HITL 게이트**: 내보내기 전 사용자에게 "이대로 PDF 뽑을까요?" 확인(교사 검토). 텔레그램 등 비대화 환경이면 산출 후 검토 요청.

## Phase 4: 내보내기 & 전달
- exporter가 2벌 PDF 생성 + 정답 누출 최종 grep. 산출 경로를 사용자에게 전달.

## 데이터 전달 프로토콜
- **파일 기반**(`_workspace/{NN}_{agent}_{artifact}`) + **태스크 기반**(TaskCreate 의존성) + **메시지 기반**(SendMessage 실시간 조율).
- 최종 PDF만 지정 경로 출력, `_workspace/`는 감사·재실행용 보존.

## 에러 핸들링
- 성취기준 `unresolved`: 헤더 슬롯 비우고 진행, 사용자에게 코드 직접 입력 요청.
- gepai MCP 끊김: curriculum이 CSV 폴백(자동). 
- 1회 재시도 후 재실패면 해당 결과 없이 진행하고 보고서에 누락 명시. 상충 데이터는 삭제 말고 출처 병기.

## 테스트 시나리오
- **정상**: "중2 과학 옴의 법칙 활동지" → 성취기준[9과14-02] 조회 → 아웃라인 → HTML → 검수 PASS → student/teacher PDF 2벌.
- **에러**: gepai MCP off → curriculum이 CSV 폴백으로 [9과14-02] 원문 확보 → 정상 진행. / reviewer가 student PDF에서 정답 발견 → designer 반려 → 수정 → 재검수 PASS.

## 후속/재실행
- "성찰 문항만 다시" → planner+designer만 부분 재실행. "다른 교과로" → 새 실행. "색 바꿔" → designer만(theme 교체).
