# ULTRAQA — editor-v4 전면 재설계 QA 보고서

> 대상: 브랜치 `feat/editor-object-textbox-editing` (9e4ab4c~51a8b99 + d585e4d).
> 근거 문서: docs/HANDOFF-editor-v4-qa.md(불변식 8·알려진 한계·환경 규칙), scratchpad/ralplan/editor-v4/06_plan_final.md(가드레일), scratchpad/ralph-reports/us20.md(기능 공백 14건).
> 수행: 2026-07-23, ultraqa 사이클(테스트→검증→수정→반복). 모든 실사용 검증은 CDP Input 실마우스/실키보드(dispatchEvent 합성 0건).

## 1. 결과 요약

- **발견 버그 3건 — 전량 수정·재검증 완료** (아래 §3). 불변식 위반 0건 잔존.
- 기준선: 단위 379/379 + 렌더 25파일 직렬 그린(기준 73 → 현재 75, 핸드오프 이후 테스트 2건 증가분 포함).
- 탐색 QA 10개 시나리오 + 마이그레이션 8문서 왕복 + 누출 공격(HTML 32벡터 + PDF 레벨) + 엔진/하네스 종단 — 전부 실행.
- **최종 전체 스위트(수정 3건 반영 후): 단위 379/379 + 렌더 25파일 직렬 75/75 — 전량 그린.**

## 2. 실행 시나리오 목록 (재현 스크립트: scratchpad/ultraqa/)

| # | 시나리오 | 스크립트 | 결과 |
|---|---|---|---|
| 0 | 기준선(단위+렌더 직렬 5청크) | — | 379/379 + 25파일 75/75 |
| L | 누출 공격 HTML — answerKey·answer:true(flow/float/title/table캡션)·class=answer 변형 9종(따옴표/bare/다중클래스/중첩/plot-ans/img/attr `>`/공백/탭) | leak-attack.mjs | 32/32 — 전 벡터 방어 |
| 1 | 빠른 연속 타이핑 중 리플로우 경합(버스트 8회×고유 토큰, 리플로우 발화 창 공격) | sc1-typing-reflow.mjs | **버그 #1 발견**→수정 후 4/4 |
| 2 | 다중 선택 연쇄(Shift/Ctrl additive·토글·Esc·단일교체·편집진입·float+flow 혼합·저장 무오염) | sc2-multiselect-ops.mjs | 12/12 |
| 3 | flow⇄float 전환 ×9 + float 드래그 + 저장 왕복(rect 잔존 0) | sc3-flowfloat-cycle.mjs | 10/10 |
| 4 | undo 폭탄(이질 조작 6종 → Ctrl+Z×40 → Ctrl+Y×40 → Ctrl+Z×40, DOM 인벤토리 동치) | sc4-undo-bomb.mjs | 5/5 |
| 5 | 페이지 추가/복제/삭제 조합(썸네일 우클릭 메뉴 실클릭, id 유일성·undo 복원·썸네일 동기화) | sc5-page-combos.mjs | 11/11 |
| 6 | 지문 붙여넣기(2.2k자·특수문자·이모지·의사 HTML `<script>`/onerror/class=answer) → 저장 왕복 | sc6-passage-paste.mjs | 13/13 |
| 7 | AI 왕복(요청→파일큐→모의응답→미리보기→재생성→버전2/2→교체→sanitize→상태전이·std-box 이중가드·rect 주입 차단) | sc7-ai-roundtrip.mjs | 22/22 |
| 8 | 경계값: 빈 문서/페이지보다 큰 단일 개체(무한루프 없음·통째 귀속)/28행 표 분할 금지/A3·B4·가로 용지 전환 | sc8-boundaries.mjs | **버그 #2 발견**→수정 후 27/27 |
| 9 | 마이그레이션 왕복: worksheets 4문서 + manifests 4종 각각 열기→CDP 실편집→저장→재열기(rev+1·migrated 전이·텍스트 무손실·마커 보존) | sc9-migration-roundtrip.mjs | **버그 #3 발견**→수정 후 64/64 |
| 10 | export 종단 + PDF 레벨 누출 grep(pypdf 한글 추출)·scaffold 직접 export 거부 fail-closed | sc10-export-leak.mjs | 21/21 |
| E | 엔진 생성 종단: `bin/worksheet-grab.js pipeline 중2과학 광합성` → 검수 게이트 PASS → 2벌 HTML+PDF | (CLI) | PASS |
| H | 하네스 종단: worksheet-grab 5-에이전트(curriculum→planner→designer→reviewer→exporter), Producer-Reviewer 반려 루프 실작동 | _workspace/ | (§4) |

## 3. 발견·수정 버그 (전량 수정 + 재현 스크립트 + 회귀 검증)

### 버그 #1 — 리플로우 재로드가 편집 포커스를 파괴해 이후 타이핑 전량 무음 유실 (심각)
- **재현**: `node scratchpad/ultraqa/sc1-typing-reflow.mjs` (수정 전: 유실 토큰 35/40, 활성 요소=BODY, 콘솔 에러 0 — 조용한 데이터 손실).
- **원인 사슬**: 타이핑→300ms 디바운스 리플로우→페이지 경계 변경 시 `reloadTeacherFrame()`(srcdoc 교체)→새 문서에서 `refreshVisual()`이 contenteditable 은 복원하지만 **포커스·캐럿은 복원하지 않음**→이후 키 입력이 body 로 흘러 소멸. 실마우스/실키보드와 동일 경로(CDP 아티팩트 아님).
- **기각 가설**: ① reflow 문서 클론이 타이핑을 되돌림(rebuildPaginatedPages 는 개체 참조 공유 + 유실 패턴 불일치로 기각) ② 합성 이벤트 특유 현상(포커스는 렌더러 상태 — 실사용 동일).
- **수정**: `src/editor/selection.js` 에 `captureCaret()`(편집 대상 내 텍스트 오프셋 캡처)·`restoreCaret()`(TreeWalker 로 오프셋 복원+focus) 추가, `src/editor/editor.js` `runReflow()` 가 재로드 전 캡처→재로드 후 복원.
- **검증**: sc1 재실행 유실 0/40 + 인접 렌더 4파일(editor-select/reflow/edit/undo) 직렬 그린.
- **잔존 한계(기록)**: 재로드 진행 중(~수십 ms)에 이미 날아간 키 입력은 원리상 복구 불가(측정상 0건이었으나 창은 존재). 근본 제거는 "편집 중 리플로우 지연" 설계 변경 필요 — D-A 의도(타이핑 중 실시간 경계 재계산)와 상충해 보류.

### 버그 #2 — 용지 전환 후 flow 경계가 낡은 채 유지(재페이지네이션 미실행)
- **재현**: sc8-boundaries.mjs (d) (수정 전: A4 기준 경계의 문서를 A3/B4 로 바꿔도 pages[] 불변 — 시트가 용지 규격을 넘겨 과성장(2176px vs A4 1123px)한 채 1페이지 유지).
- **원인**: `/paper` 는 paper 필드만 checkpoint 하고, 셸 재로드도 재페이지네이션을 하지 않음 — 경계 재계산은 다음 콘텐츠 편집까지 지연. 축소 방향(A3→A4)에서는 편집 없이 인쇄 시 초과 콘텐츠가 발생. 기존 editor-export 테스트는 paper CSS 반영만 단정(경계 재배정 미단정)이라 통과해 왔음.
- **수정**: `src/editor/editor.js` `changePaper()` 가 reload 전 sessionStorage 플래그를 심고, 초기화 완료 시 플래그가 있으면 1회 `scheduleReflow()` — 용지 변경 경로 한정(수동 빈 페이지 보존 설계 D-A 는 불변).
- **검증**: sc8 (d) — A4(21개체)→A3 3p(시트 1123px)→B4 2p(1376px)→A4 3p(1123px), 개체 무손실·무중복, 시트 높이 = 용지 규격. 인접 렌더 4파일(editor-export/paper/editor-shell/editor-reflow) 직렬 그린.

### 버그 #3 — `.worksheet-grab/`·`history/` 없는 문서의 첫 저장이 ENOENT 500 + 부분 커밋 (불변식 4 위반)
- **재현**: `node scratchpad/ultraqa/probe-meta.mjs` (수정 전: POST /save 500 "ENOENT … meta.json", 그런데 manifest 는 이미 개체 트리로 교체됨 — meta 부재·rev↔스냅샷 불일치 부분 커밋 잔존).
- **경위**: 외부 생성/구버전 문서(메타 디렉터리 없음)는 `checkCommitIntegrity` 가 명시적으로 예상하는 입력이지만, `FsWorkspaceRepository.writeMeta/writeSnapshot` 이 부모 디렉터리 보장 없이 writeFile → 첫 저장이 중간에서 던짐.
- **수정**: 두 메서드에 쓰기 직전 `mkdir(recursive)` 보장(`src/adapters/FsWorkspaceRepository.js`).
- **검증**: 맨몸 문서(manifest 단독) 저장 → 200·meta.revision=1·스냅샷 1개, sc9 전체 64/64, 단위 379/379.
- **잔존 리스크(기록)**: checkpoint 쓰기 순서(스냅샷→manifest→meta)는 여전히 비원자적 — 다른 원인으로 중간 실패하면 부분 커밋 가능. `checkCommitIntegrity` 가 로드 시 경고로 탐지하는 설계이므로 수용, 순서 재정렬(메타 마지막→manifest 커밋 포인트화)은 후속 제안.

## 4. 하네스 종단 (worksheet-grab 5-에이전트)

- 요청: 중1 과학 "물질의 상태 변화" 신규 1건.
- curriculum-mapper: gepai 조회 [9과04-03]·[9과04-04]·보조[9과04-02] (원문, unresolved 0) → 01_curriculum_standards.json.
- worksheet-planner: 카탈로그 10종·qtype 7종 어휘 아웃라인 15블록 → 02_outline.json.
- worksheet-designer: 개체 트리 18개체(pagination:scaffold, flow 전용, ValidateObjectTree 자체검증) → 03_worksheet.json.
- worksheet-reviewer: **1차 FAIL** — themeName:"teal" 실존 테마 미해석(loadThemeCss ENOENT 실측). 정답 누출 0·성취기준 변조 0·색 하드코딩 0.
- Producer-Reviewer 반려 루프: designer 수정(themeName→"sci") → 재검수 **PASS** (반려 1회, 3회 한도 내).
- worksheet-exporter: PaginateAndExport(Chrome 측정 패스) scaffold→**paginated 커밋(2쪽)** → `worksheets/상태변화QA/` 학생용/교사용 HTML+PDF 2벌. 최종 누출 grep: student HTML/PDF 0건, teacher 26건(대조군), unsafe:false. → **하네스 종단 그린**. HITL: 산출물은 교사 검토 후 배포(비대화 세션 규칙 — 사용자 검토 요청 상태).
- 부수 확인: 검수 게이트가 실결함(존재하지 않는 themeName)을 실측(loadThemeCss ENOENT)으로 잡아 반려하는 Producer-Reviewer 루프가 실제로 작동함.
- 참고: 핸드오프 §3 의 `node src/cli/index.js …` 표기는 무동작(엔트리 가드 없음) — 실제 엔트리는 `node bin/worksheet-grab.js …`. 문서 수정 권장.

## 5. 최종 전체 스위트 (버그 3건 수정 반영 후, 직렬 실행)

- 단위: `node --test "test/unit/**/*.test.js"` — **379/379 PASS**.
- 렌더(1파일씩 직렬, Chrome 동시 1): 25파일 **75/75 PASS** —
  acceptance 3 · columns 7 · edit 1 · editor-ai 5 · editor-edit 5 · editor-export 2 · editor-image 1 ·
  editor-migration 1 · editor-objects 3 · editor-preset 1 · editor-print-parity 2 · editor-reflow 1 ·
  editor-select 1 · editor-shapes 2 · editor-shell 7 · editor-thumbs 1 · editor-undo 3 · english 1 ·
  export 3 · generate 1 · paginate 11 · paper 5 · pipeline 6 · png 1 · social 1. fail 0.
- 소스 수정 파일: `src/editor/selection.js`(캐럿 캡처/복원), `src/editor/editor.js`(runReflow 캐럿 배선 + 용지 변경 후 1회 리플로우), `src/adapters/FsWorkspaceRepository.js`(writeMeta/writeSnapshot mkdir 보장), `docs/HANDOFF-editor-v4-qa.md`(CLI 엔트리 표기 교정). 커밋 미실행(작업 트리 상태 — 사용자 지시 대기).
- 부산물: `worksheets/상태변화QA/`(하네스 종단 산출물 — HITL 교사 검토 대기), `_workspace/`(감사용), `scratchpad/ultraqa/`(재현 스크립트 일습).

## 6. 잔존 리스크·후속 제안 (버그 아님)

1. 버그 #1 의 재로드 창(수십 ms) 내 키 입력 유실 — 근본 제거는 편집 중 리플로우 지연 설계 필요(보류 사유 §3.1).
2. SaveDocument.checkpoint 쓰기 순서 비원자성 — manifest 를 커밋 포인트로 마지막 이동 제안(§3.3).
3. pdftotext(poppler)는 Chrome PDF 의 한글을 추출하지 못함 — PDF 텍스트 검증은 pypdf 사용(sc10 에 반영). 향후 누출 grep 자동화 시 동일 주의.
4. 콘텐츠 페이지 "삭제"는 개체를 지우지 않고 페이지만 정리(개체 수 불변, sc5 실측) — UX 의도 확인 권장(교사 기대와 다를 수 있음).
5. 핸드오프 §3 CLI 경로 표기 오류(`src/cli/index.js` → `bin/worksheet-grab.js`).
6. 알려진 한계(§5) 전 항목은 재확인만 하고 버그로 미보고(빈 페이지 리플로우 소멸·평문 B/I/U 태그 소실 등).
