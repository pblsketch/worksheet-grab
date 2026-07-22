<!-- SOURCE: worksheet-grab original (upstream 문서 아님 — k-teacher-skills 에 이 파일은 존재하지 않는다).
     worksheet-consult 협의 산출물 00_brief.json 의 스키마 SSOT. 2026-07-22 제정.
     upstream Gate v2 기록 규약은 references/interview-readiness.md(verbatim)를 따르되,
     기록 형태는 이 문서가 정의한다. -->

# `_workspace/00_brief.json` 스키마 (SSOT)

worksheet-consult 협의 단계의 산출물. **전 필드 optional** — 파일 자체가 없으면 파이프라인은
오늘과 동일하게 동작한다(빠른 경로). planner 가 소비하고, reviewer 가 brief-fidelity advisory 로
반영도를 계측한다(verdict 에는 영향 없음).

## 기록 원칙 (F3 — 거짓 정밀 금지)

- **합성 ambiguity 소수를 기록하지 않는다.** upstream 의 십진 가중식은 provenance 전용이며
  계산·emit 하지 않는다. 기록은 `anchors`(4버킷 라벨) + `hardGates`(불리언) + `profile` + `rounds` 로 한정.
- anchor 값은 upstream 4버킷 **라벨**(0.0 없음 / 0.3 막연 / 0.6 부분 / 1.0 충분)만 허용 — 중간값 금지.
- 미확정 항목은 지어내지 않고 `unresolved` 배열에 남긴다.
- 학생 실명·민감정보·실제 학생 사례는 어떤 필드에도 기록 금지(§4 hard-gate).

## 스키마

```jsonc
{
  "meta": {
    "profile": "quick|standard|deep",
    "profileSource": "explicit|router-inferred|skill-default",
    "readiness": {
      "base": "brownfield",                       // worksheet-grab 은 성취기준 앵커 도메인
      "rounds": 5,                                 // 실제 진행한 질문 라운드 수
      "anchors": {                                 // upstream §2 차원 × 4버킷 라벨 (계산값 아님)
        "intent": 1.0, "learner": 0.6, "evidence": 1.0, "misconception": 0.6,
        "constraints": 0.6, "boundaries": 0.3, "curriculum_grounding": 1.0
      },
      "hardGates": {                               // upstream §4 — binary
        "nonGoals": true, "decisionBoundary": true, "personalInfo": true,
        "observableEvidence": true, "pressurePass": true
      }
    },
    "groundedStandards": [                         // consult 가 gepai 로 근거화한 성취기준 코드
      { "code": "9과14-02", "source": "gepai|csv", "confidence": "high|low" }
    ],
    "createdBy": "worksheet-consult v1",
    "gateVersion": "v2.5.1+"
  },

  "lessonIntent":   { "why": "", "targetChange": "" },
  "studentContext": { "priorKnowledge": "", "expectedResponses": "", "constraints": "" },
  "assessmentEvidence": { "successCriteria": [], "evidenceType": "" },
  "misconceptions": [ { "belief": "", "revealBy": "" } ],
  "activityDirection": { "archetypeCandidates": [], "chosenArchetype": "", "length": "", "sessions": 1 },
  "thinkingRoutine": { "selected": "", "blockSequence": [], "studentRecordForm": "" },
  "inquiryLadder":  { "factual": [], "conceptual": [], "debatable": [], "generalization": "" },
  "udlAdjustments": { "engagement": "", "representation": "", "expression": "" },
  "pblContext":     { "drivingQuestion": "", "sessionFlow": [], "processEvidence": [] },
  "rubric":         { "criteria": [], "note": "태도 중심 기준 금지(성취 기반)" },
  "unresolved":     [ "미확정 항목 — planner 는 잠정 처리하고 표시" ],
  "designTheme":    { "subjectColorHint": "var(--*) 토큰만", "notes": "" }
}
```

## 소비 규약

- **planner**: 있으면 lessonIntent/assessmentEvidence/misconceptions → 활동·문항 정합,
  `thinkingRoutine.blockSequence` → 블록 순서 시드, `inquiryLadder` → 문항 사다리,
  `udlAdjustments` → 대안 표현/참여 블록. 기존 블록 어휘(`list-vocab`)·아키타입(`list-archetypes`)
  범위 내에서만 매핑(신규 블록 금지). **없으면 오늘과 동일.**
- **answer-span (정답 누출 방어)**: `inquiryLadder.generalization` 및 conceptual/debatable 문항의
  정답성 콘텐츠는 반드시 planner 의 `teacherAnswerPlan` 에 실어 designer 가
  `<span class="answer">…</span>` 로 래핑하게 한다 — 학생용 물리 제거의 유일 기준.
  (grep 은 "마킹된 것의 누출"만 잡으므로, "정답성인데 미마킹" false-negative 는 이 규약이 1차 방어.)
- **groundedStandards 소유권 (F5)**: 이 배열은 consult 가 기록하는 **참고(seed)** 다.
  curriculum-mapper 는 Phase 2 에서 이를 대조하되 **자기 해결이 권위**이며, 재조정 결과는
  brief 가 아니라 자기 산출물 `01_curriculum_standards.json` 에 기록한다(**brief 는 consult
  write-once — 파이프라인의 어떤 에이전트도 brief 를 수정하지 않는다**). 불일치 시 brief 의
  종속 필드(inquiryLadder·assessmentEvidence 등)는 unresolved 취급으로 강등해 planner 에 통지.
- **pblContext**: pbl-design-coach(외부 스킬) 산출을 이어받는 브리지 입력 필드일 뿐,
  PBL 설계 자체는 이 리포 범위 밖.

## 샘플 1 — 최소 (Standard, 결손 필드 확인 후 조기 산출)

```json
{
  "meta": {
    "profile": "standard", "profileSource": "router-inferred",
    "readiness": {
      "base": "brownfield", "rounds": 3,
      "anchors": { "intent": 1.0, "learner": 0.6, "evidence": 1.0, "misconception": 0.3,
                   "constraints": 0.6, "boundaries": 1.0, "curriculum_grounding": 1.0 },
      "hardGates": { "nonGoals": true, "decisionBoundary": true, "personalInfo": true,
                     "observableEvidence": true, "pressurePass": true }
    },
    "groundedStandards": [ { "code": "9과14-02", "source": "gepai", "confidence": "high" } ],
    "createdBy": "worksheet-consult v1", "gateVersion": "v2.5.1+"
  },
  "lessonIntent": { "why": "옴의 법칙을 공식 암기가 아니라 변인 관계로 이해", "targetChange": "V-I 그래프에서 저항 의미를 설명" },
  "assessmentEvidence": { "successCriteria": ["측정값으로 그래프를 그리고 기울기 의미를 서술"], "evidenceType": "산출물+서술" },
  "unresolved": [ "misconception: 전류-전압 인과 방향 오개념 여부 미확인", "constraints: 실험 기기 수 미확인" ]
}
```

## 샘플 2 — 충실 (Deep, 공동 설계)

```json
{
  "meta": {
    "profile": "deep", "profileSource": "explicit",
    "readiness": {
      "base": "brownfield", "rounds": 9,
      "anchors": { "intent": 1.0, "learner": 1.0, "evidence": 1.0, "misconception": 1.0,
                   "constraints": 0.6, "boundaries": 1.0, "curriculum_grounding": 1.0 },
      "hardGates": { "nonGoals": true, "decisionBoundary": true, "personalInfo": true,
                     "observableEvidence": true, "pressurePass": true }
    },
    "groundedStandards": [ { "code": "6사08-02", "source": "gepai", "confidence": "high" } ],
    "createdBy": "worksheet-consult v1", "gateVersion": "v2.5.1+"
  },
  "lessonIntent": { "why": "지역 문제를 자료로 판단하는 시민 역량", "targetChange": "근거 2개로 정책 대안을 비교·선택" },
  "studentContext": { "priorKnowledge": "그래프 읽기 가능, 자료 비교 경험 적음", "expectedResponses": "한쪽 자료만 인용", "constraints": "모둠 4인×6, 45분" },
  "assessmentEvidence": { "successCriteria": ["두 대안의 장단점을 표로 정리", "선택 근거 2개 서술"], "evidenceType": "표+서술" },
  "misconceptions": [ { "belief": "자료 수치가 크면 무조건 좋은 정책", "revealBy": "단위·기준이 다른 두 자료 대조 문항" } ],
  "activityDirection": { "archetypeCandidates": ["비교표", "자료해석"], "chosenArchetype": "비교표", "length": "A4 2면", "sessions": 1 },
  "thinkingRoutine": { "selected": "Claim-Support-Question", "blockSequence": ["directive", "data-table", "claim-support-table", "reflection"], "studentRecordForm": "주장-근거-질문 3단 표" },
  "inquiryLadder": {
    "factual": ["두 정책의 시행 연도와 대상은?"],
    "conceptual": ["두 자료의 기준 차이가 결론에 어떤 영향을 주는가?"],
    "debatable": ["우리 지역에 더 적합한 정책은 무엇인가?"],
    "generalization": "정책 판단은 자료의 출처·기준을 확인한 근거 비교에서 나온다"
  },
  "udlAdjustments": { "engagement": "지역 사례 선택권 2종", "representation": "핵심 용어 카드 병기", "expression": "서술 대신 표+말풍선 선택 허용" },
  "rubric": { "criteria": ["근거의 출처 명시", "비교 기준의 일관성", "선택 이유의 타당성"], "note": "태도 중심 기준 금지(성취 기반)" },
  "unresolved": [ "constraints: 인쇄 흑백 여부 미확인" ],
  "designTheme": { "subjectColorHint": "var(--*) 토큰만", "notes": "사회 amber 계열" }
}
```
