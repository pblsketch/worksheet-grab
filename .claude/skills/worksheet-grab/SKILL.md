---
name: worksheet-grab
description: 한국 교사용 활동지(활동지)를 생성·편집·내보내기하는 전체 파이프라인 오케스트레이터. "활동지 만들어줘", "OO교과 OO단원/주제 활동지", "워크시트 제작", "학습지 만들어", "성취기준으로 활동지", "활동지 수정/편집", "다시/재실행/보완", "학생용 교사용 PDF"를 요청하면 반드시 이 스킬로 팀을 조율한다. 성취기준 조회→기획→디자인→검수→내보내기를 에이전트 팀으로 수행. 범교과(국어 비특화).
---

# worksheet-grab (활동지 파이프라인 오케스트레이터)


**실행 모드: 에이전트 팀** (5명). 패턴: **Pipeline + Producer-Reviewer**.
`curriculum-mapper → worksheet-planner → worksheet-designer → worksheet-reviewer(게이트) → worksheet-exporter`

목표: 교사의 한 문장 요청("중2 과학 옴의 법칙 활동지")을 학생용/교사용 A4 PDF 2벌로. 사용자 구독 AI가 엔진(무API). 성취기준 원문은 gepai에서만, 저작권 지문은 슬롯.

## 엔진 배선 (worksheet-grab CLI — 코어 + 동적 조립)
결정적 조립·검증·렌더는 코어 엔진 CLI가 담당한다. 루트: 프로젝트 저장소 최상위(현재 작업 디렉터리 기준). 세 경로:
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
- **편집 경로**: `node bin/worksheet-grab.js edit <base>.manifest.json "3번 문항 빼고 성찰 추가" --out out/`
  — 매니페스트에 편집을 왕복 반영(문항 제거·성찰 추가)한 뒤 2벌 재조립·재렌더. `--remove <N>`/`--add reflection` 플래그도 가능.
  부분 수정 요청("3번 문항 빼줘")은 이 경로가 1차. 5-에이전트 재실행은 맞춤 저작이 필요할 때만.
- **교과 범위**: 국어(korean)·과학(science)·사회(social: 지도·연표)·영어(english: 어휘·대화문). 교과색은 `themes/*.css` 토큰만.
- **풍부한 경로(rich path)**: 아래 5-에이전트 팀 — 맞춤 콘텐츠 저작·부분 재실행·다회 검수 루프가 필요할 때.
  각 에이전트는 자기 산출물을 위 엔진 명령으로 실행/검증한다(curriculum→search, **designer→compose 스캐폴드 저작 후 assemble**, review→validate, export→build-variants/render).
  designer 는 `compose` 가 낸 아키타입 스캐폴드 + 저작 브리프를 받아 인라인 html 을 주제에 맞게 저작한다(엔진 무API 준수).
- 두 경로 모두 **검수 PASS 후 HITL**(교사 검토) 게이트를 지키고, student 정답은 엔진이 물리 제거한다.

## Phase 0: 컨텍스트 확인
- 작업 디렉토리에 `_workspace/` 존재 여부로 실행 모드 판별:
  - 없음 → **초기 실행**
  - 있음 + 부분 수정 요청("3번 문항 빼줘") → **부분 재실행**(해당 에이전트만)
  - 있음 + 새 주제 → 기존을 `_workspace_prev/`로 이동 후 **새 실행**

## Phase 1: 입력 정리 + 협의 라우팅
- 교사 요청에서 `{subject, gradeBand, topic, 차시?}`를 추출. 결손 필드는 **한 번에 하나씩** 질문(교과→학년→주제 순). 확정 후 요약 확인.
- **협의(consult) 발동 판정 — 가중치 없는 이진/정성 트리거(점수 계산 없음):**
  - **발동**: (a) explicit 협의 신호("같이 설계하자/협의하자/딸깍 말고/먼저 질문해줘/수업 의도부터/평가부터/PBL·수행평가 연계") → Deep 프로파일. (b) hard 필드(subject·gradeBand·topic) 결손 → Quick 경량(결손 필드만 확인).
  - **스킵(기본)**: hard 3필드가 갖춰진 **완결 요청은 학생 맥락 언급("우리 반이 그래프를 어려워해서")이 섞여도 자동 인터뷰 진입 금지** — 곧장 Phase 2. 맥락 신호가 있으면 최대 **1-메타확인** 한 줄("바로 만들까요, 아니면 2~3가지만 먼저 맞춰볼까요?")만 허용하고 기본 편향은 skip(빠른 경로 불가침).
  - 인터뷰가 열리는 **유일한** 조건 = explicit 협의 신호 또는 hard 필드 결손. 프로파일 출처: explicit > router-inferred > skill-default(Standard).

## Phase 1.5: 협의 (조건부·독립 단계)
- 발동 시 `worksheet-consult` 스킬로 협의(수업 의도·학생 맥락·평가 증거·오개념 + 활동지 특화 차원)를 수행하고 `_workspace/00_brief.json` 을 산출한 뒤 **종료**한다.
- Phase 2 는 그 파일을 **새로 읽어** 시작한다(협의 대화와 파이프라인 조율을 한 컨텍스트에 섞지 않음). 미발동이면 brief 없이 오늘과 동일하게 진행.

## Phase 2: 팀 구성 & 작업 할당
`TeamCreate`로 5명 구성, `TaskCreate`로 의존성 있는 작업 생성. 모든 Agent 호출은 `model:"opus"`.

| 순서 | 에이전트 | 스킬 | 산출물 |
|---|---|---|---|
| 1 | curriculum-mapper | worksheet-curriculum | `01_curriculum_standards.json` |
| 2 | worksheet-planner | worksheet-plan | `02_outline.json`(블록 `type`은 닫힌 카탈로그 10종·`questionType`은 qtype 7종 어휘) |
| 3 | worksheet-designer | worksheet-design | `03_worksheet.json`(개체 트리, `pagination:'scaffold'`) + `03_manifest.json` |
| 4 | worksheet-reviewer | worksheet-review | `04_review.json`(1층 구조 검증 + 2층 렌더 실측 findings, PASS/FAIL) |
| — | *(페이지네이션 패스)* | — | `03_worksheet.json`의 `pagination`을 `scaffold→paginated`로 승격(Chrome 측정 경계 산출). `worksheet-exporter`는 `paginated` 문서만 받는다(`scaffold` 는 거부). |
| 5 | worksheet-exporter | worksheet-export | `{제목}_{subject}_student.pdf` / `_teacher.pdf`(입력 문서는 `pagination:'paginated'` 필수) |

> **`00_brief.json` 연동(Phase 1.5 산출물이 있을 때만):** planner 가 optional 입력으로 소비하고, reviewer 가 brief-fidelity advisory 로 반영도를 계측한다(verdict 불변). curriculum-mapper 는 `brief.meta.groundedStandards` 를 seed 로 대조하되 **자기 해결이 권위** — 재조정 결과는 brief 가 아니라 자기 산출물 `01_curriculum_standards.json` 에 기록하고(brief 는 consult write-once, 팀은 읽기 전용), 불일치 시 brief 종속 필드(inquiryLadder·assessmentEvidence 등)를 unresolved 취급으로 planner 에 통지한다. consult 는 대화형 독립 단계이지 팀 에이전트가 아니다.

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

## 삽화(생성 이미지) 필요 시
designer가 사진/일러스트가 필요하다고 판단하면:
1. 사용자 로컬 `codex-image` 스킬로 생성한다(gpt-image-2·OAuth, 무API 원칙 유지 — 장당 약 2~6분 소요하니
   여러 장이면 미리 안내하고 순차 진행).
2. 산출 PNG를 워크스페이스 자산 폴더 `worksheets/<문서명>/assets/`에 저장한다(파일명은 안전문자·확장자 `.png`).
   `edit-ui` 가 떠 있으면 에디터의 이미지 픽커·붙여넣기·드래그앤드롭으로 같은 경로에 직접 업로드해도 된다
   (`POST /assets` — png/jpg/jpeg/gif/webp·5MB 이하·SVG 제외).
3. 블록에는 `<img src="assets/<파일명>" style="width:__mm" alt="설명">`처럼 **로컬 상대경로**로만 참조한다.
   원격 URL 인라인은 금지(`worksheet-design` 스킬 규칙과 동일 — 오프라인 인쇄·저작권 추적 위험).
4. 교사가 이미 가진 이미지도 동일하게 `assets/` 경유로 다룬다(에디터 픽커·붙여넣기·DnD 또는 파일 직접 복사) —
   생성 이미지와 별도 취급하지 않는다.

## 자료집(합본) 배치 생성 반복 절차 (workbook 모드 — 여러 활동지를 한 벌 PDF로)
교사가 "이 N개 주제를 묶어서 자료집 하나로", "단원 전체 활동지 모아서 PDF 한 벌로" 등을 요청하면 발동한다.
**무API 원칙상 배치는 콘텐츠를 저작하는 CLI 명령이 아니다** — CLI는 멱등 장부(`workbook.json`)만 관리하고,
콘텐츠 저작은 **이 세션(하네스)이 pending 목록을 순회하며 기존 경로로 반복 수행**한다.

1. **목록 파일 준비**: 요청에서 `{subject(교과), grade(학년), topic(주제), standardCode?(성취기준 코드),
   title?(목차 표기)}` 행 목록을 뽑아 JSON(배열)·JSONL(줄당 객체)·CSV 중 하나로 만든다.
   **마크다운 표/리스트는 지원하지 않는다**(`batchList.parseBatchList` 가 명시 거부 — 조용한 절단 방지).
2. **자료집 생성 + 장부 등록**(멱등 — 동일 목록 재실행 안전):
   ```bash
   node bin/worksheet-grab.js workbook create <자료집명> [--title <t>] [--paper a4|a3|b4]
   node bin/worksheet-grab.js workbook batch-plan <자료집명> --from list.json [--csv]
   ```
   각 행이 `<자료집명>-NN-<주제슬러그>` docName(`workbook.buildDocName`)으로 `status:pending` 등록된다
   (콘텐츠는 아직 생성되지 않는다). `--csv` 는 형식을 CSV로 강제하는 불리언 플래그(값 없음).
3. **pending 순회 저작**: `node bin/worksheet-grab.js workbook status <자료집명>` 로 재개 대상(status≠saved)
   목록을 확인하고, 각 docName 을 위 "동적 조립 경로"(compose→designer 저작→assemble) 또는 "빠른 경로"
   (pipeline)로 그대로 저작하되, 산출은 반드시 **`--doc <docName>`** 으로 지정한다(SaveDocument 게이트
   경유 — 정답 누출 재검증·히스토리 스냅샷이 배치 경로에도 대칭 적용된다).
4. **결과를 장부에 기록**: 저작·저장이 성공(`meta.unsafe:false`)하면
   `node bin/worksheet-grab.js workbook mark <자료집명> <docName> saved`,
   실패(정답 누출로 student 보류·저작 포기 등)면
   `node bin/worksheet-grab.js workbook mark <자료집명> <docName> failed`. (saved 는 terminal — 재전이 불가.)
5. **재개**: 세션이 끊기거나 일부만 마쳤으면 `workbook status <자료집명>` 으로 saved 는 자동 스킵하고
   나머지(pending·failed)만 이어서 저작한다. `batch-plan` 을 동일 목록으로 재실행해도 기존 멤버의
   status 는 보존된다(신규 행만 추가).
6. **완성 후 합본 export**:
   ```bash
   node bin/worksheet-grab.js workbook export <자료집명> [--out <dir>] [--workspaces-dir <dir>] [--portable]
   ```
   `workbooks/<자료집명>/workbook-{student,teacher}.pdf` 2벌 산출(단일 head·연속 쪽번호·계산된 목차
   시작쪽). unsafe(정답 누출) 멤버가 하나라도 남아 있으면 **student 합본 전체가 차단**되고 멤버가
   지목된다(teacher 는 항상 산출) — `workbook status` 로 원인 문서를 찾아 재저작(4단계부터) 후 재-export.

## AI 액션 브리지 (에디터의 "AI 재작성/예시 채우기")
교사가 브라우저 에디터(`edit-ui <문서명>`)에서 🤖/✨ 버튼을 누르면 요청이
`<워크스페이스>/.ai-bridge/` 파일 큐에 쌓인다. **구독 AI(이 세션)가 그 요청의 처리자다** — 무API.

**트리거 프로토콜(필수):** `edit-ui` 를 띄운 세션은 같은 워크스페이스에서
`node bin/worksheet-grab.js ai pending --watch [--workspaces-dir <dir>]` 를 병행 실행해
요청 도착을 감시한다(감시가 없으면 에디터의 "반영"은 일어나지 않는다).

**처리 절차:**
1. `ai pending --json` 으로 요청 페이로드를 읽는다 — 요청은 **두 형태**가 온다:
   - **v2(범위 선택, 기본)**: `blocks:[{slot,bp,bi,bt,html}, …]` — 교사가 여러 블록을 한 번에 선택한 것.
     각 원소의 `slot`(0부터) 이 회신 매칭 키다.
   - **v1(단일, 하위호환)**: `block:{bt,html}` — 예전 형태. 여전히 유효하며 `--from/--html` 로 회신한다.
   공통: `action`(rewrite=문장 다듬기·명료화 / fill-example=예시·빈칸 채우기),
   `context`(교과·문서 제목·성취기준 원문 — **읽기 전용 품질 컨텍스트**).
2. 재작성 규칙(§7·§10 — 위반 시 저장 게이트·타입 가드가 차단하지만 애초에 지켜라):
   - **블록 본문만** 재작성한다. 성취기준 원문은 인용만 하고 절대 창작·변조하지 않는다.
   - 저작권 지문 슬롯(passage 등)·성취기준(standard-label)은 요청에 **애초에 포함되지 않는다**
     (선택 집합에 하나라도 섞이면 서버가 요청 전체를 400 으로 거부) — 오면 응답하지 말 것.
   - **정답은 반드시 `<span class="answer">…</span>` 마크 안에** 둔다(블록마다 개별 적용 — 학생용 물리 제거의 유일 기준).
   - 범교과: 교과색 하드코딩 금지(`var(--*)` 토큰만), 기존 블록의 클래스 구조 유지.
   - 인쇄안전: 8pt 미만 폰트 금지, 블록 분량은 원본과 비슷하게(페이지 넘침 방지).
3. 회신 형식(입력형에 맞춰):
   - **v2 다중 블록**: `[{slot, html}, …]` JSON 파일을 만들어 `ai respond <id> --blocks <file.json>` 로 회신한다.
     `slot` 은 요청의 blocks 순서(0부터)와 **정확히 일치**시킨다(위치가 아니라 slot 으로 재부착 —
     교사가 대기 중 블록을 옮기거나 삽입해도 어긋나지 않는다). 일부 블록만 고쳤다면 그 slot 만 넣어도 된다.
   - **v1 단일 블록**: 재작성 HTML 을 파일로 저장 후 `ai respond <id> --from <file>`(또는 `--html <inline>`).
   - **v4 개체 계획(개체 트리 편집·생성)**: `[{op,…}]` JSON 을 `ai respond <id> --ops <file.json>` 로 회신한다.
     `op`∈`replace`(치환)·`insert`(단일 신규)·`delete`(삭제)·`insert-section`(여러 개체를 한 번에·순서대로
     **새 섹션**으로 생성 — `{op:'insert-section', objects:[…], afterId|beforeId}`, 예: "여기에 연습문제 묶음
     만들어줘"). 새 개체가 성취기준이면 거부된다(원칙 3). 삽입 위치는 `afterId`/`beforeId` 중 하나만.
   - **B′ 프래그먼트 저작(새 섹션을 개체트리로 직접 씀)**: `id 없는` scaffold 개체 배열 JSON 을
     `ai respond <id> --fragment <file.json> [--after <id>|--before <id>]` 로 회신한다. 에디터가
     **`ValidateAiFragment` 결정 게이트**를 통과시킨 뒤 단일 `insert-section` 으로 컴파일한다(ADR:
     `docs/ADR-bspike-ai-fragment.md`). **저작 어휘(엄격)**:
     - 타입 9종만: `title`·`passage-slot`·`question`·`table`·`image-slot`·`answer-area`·`divider`·
       `richtext`·`callout`. (`std-box`·`shape`·`spacer`·`page-break` 는 금지.)
     - **쓰지 말 것**(있으면 프래그먼트 전체 반려): 개체 `id`·`placement`·좌표(`rect`/`xMm…`)·크기
       (`widthPct`/`minHeightMm`/`align`)·`opacity`/`angle`·`page*`/`pagination`·표현필드
       (`borderColor`/`bgColor`…)·`image-slot.src`·**답안(`answer`/`answerKey`)**. (id·자리·조판·정답은
       엔진/교사 몫 — 답안은 이 경로로 만들지 않는다.)
     - HTML 은 5위치만 허용(정제 allowlist 통과분만): `passage-slot.bodyHtml`(권한 필요 — 교사 opt-in, 아래 B3)·`richtext.html`·
       `callout.body`(=block)·`title.textHtml`·`question.promptHtml`(=inline). 허용 태그는 **깨끗한 시맨틱
       집합**뿐 — inline: `strong`/`em`/`b`/`i`/`u`/`s`/`sub`/`sup`/`mark`/`code`/`span`/`br`/`a`; block: 위 인라인 +
       `p`/`ul`/`ol`/`li`/`dl`/`dt`/`dd`/`blockquote`/`h3`/`h4`/`pre`/`hr`/`table`(+`caption`/`thead`/`tbody`/`tr`/`th`/`td`).
       **속성은 `a.href`(http/https/mailto)만** 허용 — `class`/`id`/`style`/`data-*` 는 전부 반려(정답 위장
       `class="answer"` 포함). `<script>`/`iframe`/`div`/`img`/`on*`/`javascript:` 등도 반려. 구조(표·조직자·qbox)는
       자유 HTML 이 아니라 **개체 타입**으로 저작한다(엔진이 class 마크업을 방출). 표 셀·choices 등 **중첩 id 는 정상**.
   에디터가 폴링으로 수신해 교사에게 diff 미리보기(다중이면 결합 뷰)를 보여주고, 적용·저장은 교사가 한다.
   - **에디터 진입(B1)**: 교사가 "새 섹션 AI 저작"(앱 바 `＋섹션` · 우클릭/슬래시)을 누르면 요청에
     `context.intent:'author-section'` 신호가 실린다 — 이 신호를 받으면 구독 AI 는 rewrite(`--ops`/`--objects`)가
     아니라 **`--fragment`** 로 회신해야 한다(위 저작 어휘 준수). **삽입 위치(anchor)는 교사가 정한다** —
     응답의 `--after`/`--before` 는 무시되고 에디터가 클릭 위치(선택 개체 뒤 · 페이지 말미 · 빈 페이지)에 삽입한다.
     저작 요청은 대상 개체가 없을 수 있다(빈 페이지 첫 섹션) — 그래도 정상 요청이다.
   - **지문 권한(B3)**: `passage-slot.bodyHtml`(저작권 본문)은 교사가 저작 뷰의 **"지문도 AI가 채우도록
     허용" 토글**을 켠 요청에서만 허용된다(요청 `context.allowPassageContent:true`). **권한은 교사 요청측
     grant 가 권위** — 에디터가 적용 시 이 값으로 검증하므로, 응답이 스스로 `allowPassageContent` 를 실어도
     권한을 만들 수 없다(self-grant 차단). 토글 OFF 면 bodyHtml 은 반려되고 빈 슬롯 안내만 남는다. 어느
     경우든 실존 저작물 원문을 그대로 재현하지 않는다(교사 책임·로컬 처리).
   - **답안 포함 섹션(B5, 2단계)**: 프래그먼트는 답안을 저작하지 않는다(결정 (a)) — "연습문제를 정답까지
     한 번에"는 **2단계**로 이룬다. ① B1 저작으로 **답 없는 scaffold 섹션**을 만들어 적용하고, ② 적용된 새
     `question` 을 선택해 **기존 rewrite(`--ops` replace)** 로 `question.answerKey` 를 부착한다. answerKey 는
     question 의 정식 필드라 rewrite 경로는 허용하되(프래그먼트 경로에서만 금지), 정답은 교사 벌에만 보이고
     학생 벌은 BuildVariants 가 물리 제거한다(누출 방어 상존). answerKey 를 프래그먼트에 직접 실으면 반려된다.
