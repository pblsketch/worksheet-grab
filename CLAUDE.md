# worksheet-grab

한국 K-12 교사용 활동지(활동지) 제작 서비스 — 생성·편집·내보내기. 사용자 구독 AI가 엔진(무API). 설계는 `docs/PLAN.md`(Clean Architecture).

## 하네스: 활동지 제작 파이프라인

**목표:** 교사의 한 문장 요청을 학생용/교사용 A4 PDF 2벌로. 활동지 상단 표기는 성취기준 원문이 아니라 해당 차시에 맞게 구체화한 **학습목표**(저작 영역, "~할 수 있다") 중심 — 성취기준 원문은 교사용에만 "근거 성취기준"으로 병기하며 gepai에서만 조회(AI 불변, 원칙 3). 저작권 지문은 교사 직접 입력 + 명시 요청 시 AI 창작·재구성 허용(실존 저작물 원문 재현은 금지, 3층 정책), 범교과(국어 비특화).

**트리거:** 활동지/워크시트/학습지 생성·편집·내보내기 요청 시 `worksheet-grab` 오케스트레이터 스킬을 사용하라. 단순 질문은 직접 응답 가능. 협의/공동설계 신호("같이 설계하자", "딸깍 말고", "먼저 질문해줘") 또는 교과·학년·주제 결손 시에만 `worksheet-consult` 를 조건부 발동한다(완결 요청의 빠른 경로는 불가침).

**팀:** curriculum-mapper → worksheet-planner → worksheet-designer → worksheet-reviewer(검수 게이트) → worksheet-exporter (에이전트 팀, Pipeline + Producer-Reviewer). 상세는 `.claude/agents/`, `.claude/skills/`.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-20 | 초기 구성 (에이전트 5 + 스킬 6) | 전체 | 하네스 신규 구축 |
| 2026-07-22 | k-teacher 하이브리드 이식 — worksheet-consult 스킬 + Gate v2 verbatim 번들 + 조건부 발동(Phase 1/1.5) + 00_brief.json + brief-fidelity advisory | .claude/skills, .claude/agents | 협의형 공동 설계 경로 도입(빠른 경로 보존) |
| 2026-07-23 | editor-v4 US-13(S3.4) — 오케스트레이터 산출물 계약을 개체 트리로 교체: `02_outline.json`(카탈로그 10종·qtype 7종 어휘)→`03_worksheet.json`(개체 트리, `pagination:'scaffold'`)→`04_review.json`(1·2층 findings)→페이지네이션 패스(S3.5/US-14 예정)→export. curriculum-mapper std-box 소비 정합, worksheet-planner 아웃라인 어휘 정합 | .claude/skills/worksheet-grab, .claude/agents/curriculum-mapper.md, .claude/agents/worksheet-planner.md | S3.1~S3.3(designer/reviewer/exporter 개체 트리 계약 개정)에 오케스트레이터·업스트림 계약을 정합, 빠른 경로/consult 발동 로직은 불변 |
| 2026-07-23 | 저작권 지문 슬롯 정책 최종형(3층, 당일 2차 델타로 갱신) — ① 교사 직접 입력: `passage-slot.bodyHtml`/`source`를 편집기에서 직접 입력·수정(저작권법 제25조, 로컬 처리·교사 책임). ② AI 지문 작업(명시 요청 시 허용): `AI_EXCLUDED_TYPES`에서 `passage-slot` 제거(std-box만 잔류) — 교사가 명시 요청하면 AI가 순수 창작 또는 기존 글 재구성/수준 조정/요약 가능, 단 실존 저작물 원문 그대로 재현은 금지(프롬프트 계약). AI 패널에 "창작 지문 생성"·"지문 재구성" 프리셋 신설. ③ std-box(성취기준)는 계속 AI 불변(원칙 3, 무변경). 검수: 저작권을 fail-closed 게이트에서 제외하고 advisory(`passage-copyright`)로 강등 — `source` 미기재·실존 저작물 재현 의심만 권고. `IMMUTABLE_SLOT_TYPES`→`AI_EXCLUDED_TYPES` 개명(개념 명확화, 1차 델타에서 시작) | src/domain/schema, src/usecases/ValidateObjectTree.js·RenderObjectTree.js·aiBridge.js·MigrateManifestToObjectTree.js, src/editor/selection.js·inspector.js·ai.js, .claude/agents/worksheet-designer.md·worksheet-reviewer.md, .claude/skills/worksheet-design·worksheet-review | 사용자 결정 — 1차: "AI 불변, 교사 편집 가능" 2층 분리로 교사 직접 입력 허용. 2차(당일 델타): "AI도 명시 요청 시 지문 생성/재구성 가능"으로 한 단계 더 완화(실존 저작물 원문 재현만 금지) — 실사용성 확대 |
| 2026-07-23 | 학습목표 표기 전환 — 활동지 상단을 "성취기준"에서 "학습목표" 중심으로 개정: `std-box.objectives?:string[]` 신설(codes와 달리 **저작 영역** — 성취기준에서 차시 학습목표를 구체화, 원칙 3 무변경은 "성취기준 원문"에만 적용). objectives 있으면 학생/교사 공통 "학습 목표" 박스 + 교사 전용 "근거 성취기준"(코드+원문, `.std-ref` data-mode CSS로만 숨김 — 정답 아니라 물리 제거 불필요)을 렌더, 없으면(하위호환) 현행 성취기준 박스 그대로. 레거시 결정적 엔진(`AssembleWorksheet#renderStandardLabel`)은 학습목표 저작이 불가하므로 기계 변환으로 표기만 개선(코드 뗀 성취기준 문장 = 목표, 교사용에 코드+원문 병기). 편집기 인스펙터에 objectives 편집 필드(줄 단위) 추가, codes는 읽기 전용으로 전환. planner가 objectives를 저작해 outline에 담고 designer가 std-box로 옮기며, reviewer는 학습목표-성취기준 대응을 advisory로 확인 | src/domain/schema/ObjectCatalog.js, schema/worksheet-object.schema.json, src/usecases/RenderObjectTree.js·AssembleWorksheet.js, assets/blocks.css, src/editor/inspector.js·editor.js, .claude/agents/worksheet-planner.md·worksheet-designer.md·worksheet-reviewer.md, .claude/skills/worksheet-plan·worksheet-design·worksheet-review | 현장 관행(교사 지적) — 활동지에는 성취기준 원문이 아니라 차시에 맞게 구체화한 학습목표를 제시, 성취기준 원문은 교사의 평가 근거 참조용으로만 병기 |
