---
name: worksheet-consult
description: 활동지 생성 전 교사와의 협의(공동 설계) 단계. 수업 의도·학생 맥락·평가 증거·예상 오개념을 함께 확정해 `_workspace/00_brief.json`을 산출한다. "같이 설계하자", "협의하자", "딸깍 말고", "먼저 질문해줘", "수업 의도부터", "학생 수준에 맞춰 같이", PBL/수행평가 연계 공동 설계 요청, 또는 worksheet-grab 오케스트레이터 Phase 1.5 가 조건부로 위임할 때 사용. 완결 요청(교과·학년·주제가 모두 있는 빠른 경로)에서는 발동하지 않는다.
---

# worksheet-consult (활동지 협의·공동 설계)


교사와 AI가 활동지의 **왜(의도)·누구(학생 맥락)·무엇으로 확인(평가 증거)·어디서 헷갈릴지(오개념)**에
대한 공유된 이해를 만든 뒤에 초안으로 넘어가게 하는 조건부 단계다.
k-teacher-skills 의 grill-me-for-k-teacher + grill-with-curriculum + to-lesson-brief 를
worksheet-grab 도메인에 맞게 통합 재저작했다(adapted from k-teacher-skills v2.5.1+).

**독립 단계 규약:** 이 스킬은 인터뷰를 수행하고 `_workspace/00_brief.json` 을 **쓰고 종료**한다.
파이프라인(오케스트레이터 Phase 2)은 이 파일을 **새로 읽어** 시작한다. 이 스킬은 팀 에이전트가
아니며, 파이프라인 조율과 한 컨텍스트에 섞지 않는다.

## 1. 발동 조건 — 가중치 없는 이진/정성 판정

발동 판정에 **점수는 없다.** 점수식은 upstream 문서(`references/interview-readiness.md`) 하나만
존재하며, 그것도 인터뷰 **내부**의 readiness 판정에서 heuristic prior 로만 쓴다(§3).

인터뷰가 열리는 조건은 정확히 둘뿐이다:

1. **explicit 협의 신호** — "같이 설계하자 / 협의하자 / 딸깍 말고 / 먼저 질문해줘 /
   수업 의도부터 / 평가부터 / PBL·수행평가와 연계해서".
2. **hard 필드 결손** — `{subject(교과), gradeBand(학년), topic(주제)}` 중 하나 이상이 없음.
   이때는 **결손 필드만** 한 번에 하나씩 묻는 경량 발동이다(풀 인터뷰 아님).

**불가침 규칙(빠른 경로):** hard 3필드가 갖춰진 완결 요청은 학생 맥락 언급("우리 반이
그래프를 어려워해서")이 섞여 있어도 **자동으로 인터뷰에 진입하지 않는다.** 이 경우 허용되는
최대치는 1-메타확인 한 줄 — "바로 만들까요, 아니면 2~3가지만 먼저 맞춰볼까요?" — 이고,
기본 편향은 **바로 생성(skip)** 이다.

## 2. 프로파일 (Quick / Standard / Deep)

| Profile | 적용 | max rounds |
|---|---|---|
| Quick | 결손 hard 필드 보충만 | 4 |
| Standard | 일반 협의(신호 없이 발동 시 기본) | 8 |
| Deep | explicit 공동 설계·PBL·수행평가 연계 | 12 |

프로파일 출처는 `explicit`(사용자 직접 지정) > `router-inferred`(오케스트레이터 Phase 1 추론) >
`skill-default`(Standard) 우선순위로 정하고, 인터뷰 첫 줄에
`Readiness profile: {…} | source: {…}` 로 공개한다(upstream §1).

## 3. 인터뷰 절차

판정·절차의 SSOT 는 `references/interview-readiness.md`(upstream Gate v2, **verbatim 번들 —
편집 금지**)다. 이 스킬이 실제로 조작하는 것은 아래 **최소 부분집합**이다:

- **Intent-first 순서(§3)**: 수업 의도 → 학생 맥락 → 평가 증거 → 오개념. 의도가 흐릿하면
  뒤 차원으로 넘어가지 않는다.
- **anchor 4버킷(§2)**: 각 차원을 0.0(없음)/0.3(막연)/0.6(부분)/1.0(충분) **정성 라벨**로만
  본다. 가장 약한 차원 하나만 골라 질문한다.
- **mandatory hard-gate 체크리스트(§4, binary)**: ① 비목표 명시 ② 교사 결정경계 명시
  ③ **개인정보 비요구**(실명·민감정보·실제 학생 사례 금지) ④ 평가 증거가 관찰 가능한 형태
  ⑤ 압박 패스 1회 이상(§5 — AI 가 evidence/assumption/boundary/essence 중 하나로 압박했는가.
  **AI 수행 여부를 묻는 프로세스 게이트**이지 교사 답변 품질 심사가 아니다).
- **closure audit(§6)**: 산출 직전 "다음 질문이 산출물을 실질적으로 바꾸는가, 표현만 다듬는가"
  를 자문 — 표현만 다듬으면 산출로 넘어간다.

**십진 공식 선언:** upstream §2 의 가중 ambiguity 공식(brownfield 등)은 **provenance 전용**으로
번들만 한다. 이 스킬은 그 공식을 **절대 계산하지 않고, 어떤 산출물에도 계산값을 emit 하지
않는다.** 4버킷 라벨과 binary 게이트만이 실행 대상이다.

**질문 형식**(`references/questioning-style.md`): 한 번에 하나, 선택지 3~5개 + `기타: 직접 적기`,
추천 답변과 이유를 함께 제시해 교사 부담을 줄인다.

**활동지 특화 차원(Standard 이상, 필요한 것만):** 활동 구성(아키타입 후보 —
`node bin/worksheet-grab.js list-archetypes` 참조) · 분량·차시 · 디자인 테마(교과색은
`var(--*)` 토큰만) · 사고 루틴(`references/thinking-routines-matrix.md` — 선택 시 블록 시퀀스로
번역) · 탐구 문항 사다리(`references/concept-based-inquiry.md` — 사실적/개념적/논쟁적 3층,
일반화는 학생이 도출) · UDL 3장벽(`references/udl-barrier-check.md` — 참여/표상/표현).

**성취기준 fact-routing(§7 적용):** 성취기준은 교사에게 묻지 않는다 — **gepai MCP**
(`search_standards` 등, 폴백 `data/achievement-standards.csv`)로 AI 가 조회해 원문을 **진술**하고
확인만 받는다. 원문 창작·변조 금지. 근거화한 코드는 `00_brief.json` 의
`meta.groundedStandards` 에 기록한다(대조 권위는 Phase 2 의 curriculum-mapper).

## 4. worksheet-grab 마감 정책

> **(worksheet-grab 마감 정책 — upstream §4 는 verbatim 유지된다. 아래는 upstream 의
> "If max rounds are reached" 절과 §6 closure 정신을 활동지 도메인에 구체화한 보충이며,
> upstream 원문의 각색이 아니다.)**

- **max rounds 도달 시**: 교사 의존 게이트(비목표·결정경계·관찰가능 증거)가 미충족이면 질문을
  늘리지 않는다. 해당 `hardGates.*=false` + 종속 필드를 `unresolved` 로 기록하고 **brief 산출을
  진행**한다(모든 추정·미확정 명시).
- **게이트 ③(개인정보 비요구)은 절대 차단** — 어떤 경우에도 실명·민감정보를 요구·기록한 채
  산출하지 않는다.
- **게이트 ⑤(압박 패스)는 강등 대상이 아니다** — AI 가 §5 사다리에서 압박 질문 1회를
  수행하면 충족된다(Deep 은 실제로 수행한다. 라벨만 달지 않는다).

## 5. 산출 — `_workspace/00_brief.json`

스키마 SSOT: `references/brief-schema.md`. 핵심 규약:

- 전 필드 optional. 미확정은 지어내지 않고 `unresolved` 에 남긴다.
- `meta.readiness` 에는 anchors 4버킷 라벨·hardGates 불리언·profile·rounds 만 기록
  (합성 ambiguity 소수 금지).
- 정답성 콘텐츠(`inquiryLadder.generalization` 등)는 planner 의 `teacherAnswerPlan` →
  `<span class="answer">` 경로로만 전달되도록 스키마 소비 규약을 따른다.
- brief 는 **write-once**: 이 스킬만 쓰고, 파이프라인 에이전트는 읽기 전용(재조정은
  curriculum-mapper 가 자기 산출물 `01_curriculum_standards.json` 에 기록).
- 산출 직후 교사에게 공유된 이해를 요약 확인받고 **종료** — 이후는 오케스트레이터 Phase 2.

## 6. 비대화 채널 degrade

텔레그램 등 다회 문답이 어려운 환경에서는 인터뷰를 늘어놓지 않는다 — 핵심 질문을 **1회
묶음**으로 보내거나 Standard 로 강등하고, 미응답 항목은 `unresolved` 로 산출 후 비동기 검토를
요청한다.

## Red flags

- 완결 요청(교과·학년·주제 완비)에 인터뷰를 끼워 넣는다. ← 빠른 경로 침해, 최우선 금지
- 발동 여부나 readiness 를 십진 점수 계산으로 판정한다. ← 점수는 존재하지 않는다
- 성취기준을 교사에게 묻거나 지어낸다. ← gepai 로 조회·진술
- 학생 실명·민감정보를 요구한다. ← 절대 차단
- 미확정 항목을 확정처럼 brief 에 쓴다. ← `unresolved` 로
- brief 산출 후에도 파이프라인 조율을 이 컨텍스트에서 계속한다. ← 독립 단계 위반
- 번들 references 원문을 편집한다. ← verbatim, 각색은 이 SKILL.md 에만

## References

- `references/interview-readiness.md` — upstream Gate v2 (verbatim SSOT)
- `references/questioning-style.md` — 선택지 기반 질문 형식 (verbatim)
- `references/thinking-routines-matrix.md` · `references/concept-based-inquiry.md` ·
  `references/udl-barrier-check.md` — 확장 차원 자료 (verbatim)
- `references/brief-schema.md` — 00_brief.json 스키마 (worksheet-grab original)
- `examples/sample-consult-dialogue.md` — 4 시나리오 대화 예시
