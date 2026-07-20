# worksheet-grab

한국 K-12 교사용 활동지(활동지) 제작 서비스 — 생성·편집·내보내기. 사용자 구독 AI가 엔진(무API). 설계는 `docs/PLAN.md`(Clean Architecture).

## 하네스: 활동지 제작 파이프라인

**목표:** 교사의 한 문장 요청을 학생용/교사용 A4 PDF 2벌로. 성취기준 원문은 gepai에서만, 저작권 지문은 슬롯, 범교과(국어 비특화).

**트리거:** 활동지/워크시트/학습지 생성·편집·내보내기 요청 시 `worksheet-grab` 오케스트레이터 스킬을 사용하라. 단순 질문은 직접 응답 가능.

**팀:** curriculum-mapper → worksheet-planner → worksheet-designer → worksheet-reviewer(검수 게이트) → worksheet-exporter (에이전트 팀, Pipeline + Producer-Reviewer). 상세는 `.claude/agents/`, `.claude/skills/`.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-20 | 초기 구성 (에이전트 5 + 스킬 6) | 전체 | 하네스 신규 구축 |
