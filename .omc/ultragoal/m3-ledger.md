# Ultragoal Ledger — worksheet-grab M3 (스킬 파이프라인 Plan→Design→Export)

> omc CLI 미작동 → 동등한 증거 기반 게이트 루프. 계약: docs/PLAN.md 5장(M3), docs/HANDOFF.md.

## 수용 기준 (PLAN M3)
교사의 한 문장 프롬프트가 종단 구동(성취기준 조회→기획→디자인→검수→내보내기), HITL 검토 게이트.
한 문장 프롬프트 → 검토 후 활동지 산출. slides-grab-plan/design/export SKILL.md 구조 미러.

## 발견 (착수 전)
- .claude/skills(6)·agents(5) 하네스는 M0에 작성되어 M1/M2 엔진보다 먼저 존재 → raw sed/grep/chrome 사용, 실제 CLI(generate/assemble/build-variants/validate/render) 미배선.
- generate(M2)가 이미 curriculum→assemble→variants→render 를 수행. M3는 여기에 validate 검토 게이트 + HITL 를 종단 파이프라인으로 묶고, 스킬을 엔진에 배선.
- 제약: .claude 하네스는 구조·의도 보존(건설적 정비만), poc 무변경, 창작 금지, 범교과.

## 목표(스토리)
- G1 실행 파이프라인 + 검토 게이트: `pipeline <학년교과> <주제>` CLI = generate → validate(fail-closed) → render student/teacher. 테스트.
- G2 스킬 엔진 배선: worksheet-curriculum/plan/design/review/export/오케스트레이터를 실제 CLI로 교정(구조 보존).
- G3 종단 데모 + docs + PLAN M3 완료표시 + architect+deslop+회귀.

## 원장(append-only)
- 2026-07-20 START: M3 착수. 하네스 정독 완료. generate가 파이프라인 코어임을 확인.
- 2026-07-20 G1 COMPLETE: RunPipeline 유스케이스 + pipeline CLI(조회→조립→2벌→검수 fail-closed 게이트→렌더). 단위테스트 2/2.
- 2026-07-20 G2 COMPLETE: 6개 스킬(worksheet-grab·curriculum·plan·design·review·export)에 "엔진 배선" 섹션 추가. frontmatter·기존 구조 보존(건설적 추가). 실제 CLI(generate/assemble/build-variants/validate/render/pipeline) 구동.
- 2026-07-20 G3 COMPLETE: 실물렌더 acceptance(pipeline.render.test.js — 한 문장→게이트 PASS→3쪽 A4). README·PLAN M3 완료표시. node --test 38/38.
- 2026-07-20 M3 DONE: architect APPROVE(동기 재실행). deslop(cmdGenerate/cmdPipeline 중복→worksheetBase·writeVariantTrio 헬퍼) 후 회귀 38/38 재통과. 수용 기준 전부 충족.
