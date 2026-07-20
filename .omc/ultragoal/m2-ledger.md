# Ultragoal Ledger — worksheet-grab M2 (교과 팩 + 커리큘럼)

> omc CLI(v4.14.1 dist 손상)로 ultragoal 명령 실행 불가 → 동등한 증거 기반 게이트 루프로 진행.
> 계약: docs/PLAN.md 5장(M2), docs/HANDOFF.md. 시작 2026-07-20.

## 수용 기준 (PLAN M2)
`generate 중2과학 광합성` 류 명령 → 유효한 A4 student+teacher PDF, 헤더에 올바른 성취기준 원문(CSV 조회).
gepai MCP off 상태에서도 CSV 폴백으로 성공. 범교과·API키금지·창작금지·poc/.claude 무변경.

## 목표(스토리) 순서
- G1 Curriculum search: CurriculumProvider.search({school,subject,grade,keyword}) + GepaiCurriculum CSV 구현. 중2 과학 광합성 → [9과12-01..03] 원문. 단위테스트.
- G2 Subject templates: 교과별 재사용 워크시트 템플릿(header+standard-label+directive+교과팩 블록+rubric/reflection 슬롯). M1 blocks/themes 재사용.
- G3 Generate usecase + CLI: GenerateWorksheet + `generate <중2과학> <광합성>`. 파싱→검색→템플릿+테마+표준헤더 조립. MODE_TOKEN 유지.
- G4 Variants + render: student/teacher A4 PDF 산출. 실물 렌더 유효 A4, 헤더 광합성 원문. MCP off(CSV) 성공.
- G5 Tests + docs + review: 단위+실물렌더 테스트, README, PLAN M2 완료표시, architect+deslop+회귀.

## 원장(append-only)
- 2026-07-20 START: M2 착수. CSV 확인 — 중2 과학 광합성 = [9과12-01],[9과12-02],[9과12-03] 존재.
- 2026-07-20 G1 COMPLETE: CurriculumProvider.search + GepaiCurriculum CSV 검색 구현. 중2 과학 광합성 → 3개 반환. MCP off 폴백 확인. 단위테스트 6/6 pass. 근거: src/adapters/GepaiCurriculum.js, test/unit/curriculum.test.js.
- 2026-07-20 G2 COMPLETE: 교과 템플릿 templates/science.json(청록,3쪽)·korean.json(green,2쪽) 슬롯 기반. AssembleWorksheet 인라인 html 엔트리 지원 추가. M1 blocks 스타일(교과팩) 재사용.
- 2026-07-20 G3 COMPLETE: GenerateWorksheet 유스케이스 + generate CLI. generate 중2과학 광합성 → 3쪽, 헤더에 [9과12-01..03] 원문 주입, 제목=주제, MODE_TOKEN 유지.
- 2026-07-20 G4 COMPLETE: generate --pdf 실물 렌더 → student/teacher 각 3쪽 유효 A4. validate clean. 학생용 정답 슬롯 제거(0), 교사용 유지(2). MCP off(CSV 기본)로 성공. 범교과: 국어 green(data-subject=ko)·과학 teal 동일 엔진 확인.
- 2026-07-20 G5 COMPLETE: 단위테스트(generate.test.js 6) + 실물렌더(generate.render.test.js) 추가. README·PLAN M2 완료표시. node --test 35/35 pass(skip 0).
- 2026-07-20 M2 DONE: architect APPROVE. deslop(parseGrade 미사용 캡처·중복 정리) 후 회귀 35/35 재통과. 수용 기준 전부 충족.
