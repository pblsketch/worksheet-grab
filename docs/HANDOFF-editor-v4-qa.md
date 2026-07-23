# HANDOFF — editor-v4 전면 재설계 QA (ultraqa 용)

> 작성: 2026-07-23. 대상: 새 세션의 QA 워크플로(ultraqa).
> 이 문서는 "무엇을 검증해야 하고, 무엇은 이미 알려진 상태인가"의 단일 출발점이다.

## 1. 무엇이 바뀌었나 (QA 대상)

편집기를 contenteditable 문서 모델에서 **개체 우선 모델**(Slides/Figma식: 클릭=선택, 더블클릭=개체 편집, Esc=복귀)로 전면 재설계했다. 브랜치 `feat/editor-object-textbox-editing`, 커밋 4개:

| 커밋 | 범위 |
|---|---|
| `9e4ab4c` M1 | 닫힌 개체 스키마(카탈로그 10종·qtype 7종), ValidateObjectTree, 무손실 마이그레이션(개체화율 게이트) |
| `61101c5` M2 | 순수 render-core(3소비자 공유), BuildVariants answer:true 필터, SaveDocument 2층(체크포인트), D-A 페이지네이션(Chrome 측정 단일 권한) |
| `591e445` M3 | 하네스(에이전트 5·스킬 3) 개체 트리 계약, ExportDocument scaffold 거부 배선, PaginateAndExport |
| `51a8b99` M4 | 편집기 클라이언트 재구축(서버 계약 이관·조작 코어·리플로우·신 UI 셸·AI UX), 렌더 테스트 재작성 |

지문(passage-slot) 정책: 교사 직접 입력 허용 + **명시 요청 시** AI 창작·재구성 허용(실존 저작물 원문 재현 금지는 프롬프트 계약). AI 완전 제외는 std-box(성취기준)만.

## 2. 계약·근거 문서

- **승인 계획(가드레일 포함)**: `scratchpad/ralplan/editor-v4/06_plan_final.md` — Must/Must-NOT 절이 QA 판정 기준
- 스키마 스펙: `docs/HANDOFF-object-schema.md`
- 스토리별 구현 보고서: `scratchpad/ralph-reports/us01.md ~ us20.md`, `passage-input.md`(지문 정책), `final-verify.md`(Architect APPROVED)
- **기능 공백 공식 목록**: `scratchpad/ralph-reports/us20.md` §기능 공백 — **여기 있는 항목은 버그로 보고하지 말 것**(설계 변경/후속 범위로 이미 판정됨)

## 3. 실행·검증 방법

```bash
# 단위 (Chrome 불필요, ~45s)
node --test "test/unit/**/*.test.js"        # 기준선: 379/379

# 렌더 (반드시 1파일씩 직렬 — 병렬 시 Chrome 경합 플레이크)
for f in test/render/*.render.test.js; do node --test "$f"; done   # 기준선: 25파일 73/73

# 편집기 실사용 구동
node src/cli/index.js edit-ui <문서명>      # 예: edit-ui 데모활동지 → http://127.0.0.1:<port>/
# 워크스페이스 문서: worksheets/{데모활동지,문학의가치-UDL,편집테스트,개체편집테스트}
# 구 HTML manifest 문서를 열면 지연 마이그레이션(메모리 내) → 첫 저장(Ctrl+S)에서 새 스키마 커밋

# 실마우스 검증 스크립트(CDP Input — 합성 이벤트 아님, 재실행 가능)
node scratchpad/ralph-reports/us16-evidence/verify-us16-mouse.mjs   # 선택/편집/Esc/드래그
node scratchpad/ralph-reports/us17-evidence/verify-us17-mouse.mjs   # 타이핑→리플로우
node scratchpad/ralph-reports/us18-evidence/verify-us18-mouse.mjs   # UI 셸 스모크
node scratchpad/ralph-reports/us19-evidence/verify-us19-mouse.mjs   # AI 플로우
node scratchpad/ralph-reports/us20-evidence/verify-us20-mouse.mjs   # 종단(생성→편집→AI→저장→export)

# 파이프라인/내보내기
node src/cli/index.js pipeline "<한 문장 요청>" ...   # 생성 종단
node --test test/render/pipeline.render.test.js       # scaffold 거부·경계 일치 계약
```

## 4. 불변식 (위반 발견 = 심각 버그)

1. **정답 누출 0**: student 산출물(HTML/PDF)에 answer:true 개체 텍스트·answerKey·`class="answer"` 잔존 금지 (3중 방어: 트리 물리 제거 + stripElementsByClass + grep 게이트)
2. **편집==인쇄 조판 일치**: 편집기 리플로우 귀속 == PaginateObjectTree(Chrome) 귀속 == print-to-pdf 페이지 (허용오차 ±2px, "개체→페이지 귀속" 기준 — 바이트 아님)
3. **scaffold 직접 export 거부** (checkExportGate fail-closed), unsafe 문서 student export 차단
4. **조작은 디스크 무접촉**: 체크포인트(Ctrl+S·유휴 30s)에서만 rev+1·스냅샷 1개 (rev==스냅샷 개수 불변식)
5. **두-런타임 순수성**: browserGraph 화이트리스트 모듈은 node:/require/process 무접촉 (browser-purity 테스트)
6. **마이그레이션 무손실**: 구 문서 텍스트가 개체 트리 어딘가에 100% 보존(richtext 폴백), 구 manifest 원본은 읽기 전용
7. **AI 는 좌표(rect)·신규 타입을 만들지 않음**, std-box 는 AI 요청 400
8. **표는 페이지 분할 금지**(통째 이동)

## 5. 알려진 한계 (버그 아님 — 재보고 금지)

- `scratchpad/ralph-reports/us20.md` 기능 공백 표 14건 (이미지 mm 폭 리사이즈 없음, 도형 파선 없음, 셀 단위 중첩 선택 없음, float z-order 앞뒤 보내기 비활성 등)
- 평문 필드(title/question/answer-area)는 B/I/U 서식 적용 시 태그 소실(richtext 만 서식 유지) — us16.md
- 인스펙터 color 입력은 드래그 중 재렌더 이슈 잔존(텍스트 필드는 change 커밋으로 수정됨) — us18.md
- 페이지 수동 추가(+새 페이지)는 리플로우를 예약하지 않음 — 빈 페이지가 다음 콘텐츠 편집 시 리플로우로 사라질 수 있음(D-A 설계 한계, us18.md)
- 다단(columns) 열 간 높이 재배분 최적화 미구현(열 래퍼 자체는 재현) — us17.md
- undo 는 문서 전체 스냅샷 방식(MAX_DEPTH 80)
- Windows Chrome 프로필 락 플레이크는 근본 수정됨(EBUSY 재시도) — 재발 시에만 보고

## 6. QA 환경 주의사항 (실측으로 확립된 규칙)

- **렌더 테스트는 직렬만 신뢰** — Chrome 동시 1개. 병렬 실행 금지.
- **드래그·클릭 검증은 실제 마우스(CDP Input.dispatchMouseEvent)** — dispatchEvent 합성은 실버그 4건을 놓쳤던 전력이 있음(pointer-events, width:0 슬롯, 인스펙터 포커스 파괴, 드래그-후-click)
- 임시 파일: wsg-* 접두사, 60분+ 잔존은 `test/helpers/tmp.js` 훅이 자동 청소. 수동 정리 시에도 wsg- 접두사 한정.
- virtual-time-budget 은 외부 실시간 프로세스(AI 응답 폴링)와 상극 — 그런 시나리오는 CDP 실시간으로.
- AI 응답은 무API 설계: 편집기 AI 요청은 `node src/cli/index.js ai pending --json` → `ai respond <id> --objects <file.json>` 으로 모의 응답 주입.

## 7. ultraqa 권장 초점 (기존 자동화가 약한 곳)

1. **실사용 탐색 QA**: edit-ui 를 실제로 띄우고 실마우스로 자유 시나리오 — 연속 편집·빠른 타이핑 중 리플로우 경합, 다중 선택 조작, float↔flow 전환 연쇄, undo 폭탄(수십 회), 페이지 추가/삭제 조합, 지문 붙여넣기(긴 본문·특수문자·중첩 HTML)
2. **경계값**: 매우 긴 단일 개체(페이지보다 큰 richtext), 빈 문서, 표 25행+, 이미지 슬롯 대량, A3/B4/가로 용지 전환 후 리플로우
3. **마이그레이션 회귀**: 워크스페이스 4문서 + manifests/ 4종 각각 열기→편집→저장→재열기 왕복
4. **누출 공격**: 정답을 richtext 평문·표 셀·이미지 캡션 등 우회 위치에 넣고 student 산출 검사
5. **하네스 드라이런**: worksheet-grab 파이프라인으로 신규 생성 1건 종단(생성→검수→페이지네이션→export)
6. 발견 버그는 **재현 스크립트(CDP)와 함께** 기록 — 합성 이벤트 재현은 증거로 불충분

## 8. 기준선 요약

- 단위 379/379, 렌더 25파일 73/73(직렬), 종단 실마우스 6/6×2회
- Architect 최종 검증 APPROVED(결함 0): `scratchpad/ralph-reports/final-verify.md`
- 이 기준선에서 벗어나는 모든 것이 QA 의 관심사다.
