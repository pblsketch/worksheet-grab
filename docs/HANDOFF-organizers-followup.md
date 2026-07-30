# 핸드오프 — 시각 조직자 후속 작업 (#2 에디터 삽입·편집, #4 교사용 예시 답안)

> 작성일 2026-07-30 · 기준 커밋 main `4681efd` · 새 세션 인계용.
> 시각 조직자 기능 본체는 완료·병합됨. 이 문서는 남은 두 후속 작업의 착수 가이드다.

---

## 0. 현재 상태 (완료·병합됨)

main(`4681efd`)에 다음이 모두 병합되어 있다:

- **시각 조직자 23종** — 표형 16(KWL·프레이어·5W1H·처음중간끝·3-2-1·핵심아이디어·노트정리·문단햄버거·
  관점비교·예측하기·Glow&Grow·신호등·5문단에세이·인물분석·북리뷰·인용저널) + 그림형 7(벤·개념지도·
  피시본·플롯·위계트리·순서흐름도·헥사고날). 전부 범교과 코어 블록, `studentFill`(빈칸).
- **파라메트릭 생성** — 그림형 6종은 `params`(circles/nodes/branches/steps/children/count)로 개수 지정,
  엔진이 결정적으로 그림(`src/usecases/OrganizerGen.js`의 `ORGANIZER_GENERATORS`).
- **용지 자동 맞춤(fit)** — 엔트리 `fit:true`|`{w,h}` → SVG를 용지 여백 박스에 비율 유지로 맞춤
  (`fitSvgToBox`, `paperContentPx`, `AssembleWorksheet.#fitBox`).
- **말로 요청** — `parseOrganizerSpec(text)` + `ComposeWorksheet` `organizers` 옵션.
- **자동 추천** — `ArchetypeLibrary.suggestArchetype`에 조직자 키워드 규칙(기존 추천 불변).
- **아키타입 13종** — 기본 6 + 조직자 세트 7(vocabulary-concept·kwl-inquiry·writing-plan·
  concept-visual·process-structure·literary-response·landscape-organizer).
- **문서** — README "시각 조직자" 섹션. 계획서 `docs/PLAN-graphic-organizers.md`.
- **검증** — 단위 ~785 pass, 실물 Chrome 렌더에서 전 종 편집=인쇄(잘림·넘침 0).

핵심 테스트: `test/unit/organizers.test.js`, `test/unit/archetypes.test.js`,
`test/render/organizers.render.test.js`.

---

## 1. 반드시 지킬 불변식 (깨면 안 됨)

1. **편집=인쇄 기계동치** — 조직자는 `.keep`(page-break-inside:avoid), 큰 표는 섹션 스택. 새 조직자도
   실물 Chrome 렌더에서 편집 쪽수 == 인쇄 쪽수 검증(잘림 0).
2. **개체 스키마(`schema/`) 무변경** — 조직자는 블록층 + 기존 `table`/SVG로 구현. 새 개체 타입 금지
   (편집 가능 그림 개체는 P3 스파이크로 별도 결정).
3. **무API** — 구조는 엔진이 결정적으로, 내용만 구독 AI/교사가 저작. AI는 좌표·타입을 임의 생성하지 않음.
4. **정답 fail-closed** — 정답은 `answer:true`(개체) 또는 `.answer`(셀 HTML) → 학생용에서 물리 제거.
5. **성취기준 조회전용** — 창작 금지.

## 2. 병행 세션 규약 (`docs/CONCURRENT-SESSIONS.md`)

여러 세션이 한 저장소를 공유한다(현재 다른 worktree: editorqa, grab-ext 활성 가능).

- **최신 main 기준 새 worktree**에서 작업: `git worktree add ../worksheet-grab-<작업명> -b feat/<작업명>`
- `git add -A` 금지(경로 명시 스테이징) · worktree에서 브랜치 전환 금지 · stash/reset --hard/clean 금지
- 작게 자주 커밋 · 커밋 전 `git diff --cached --name-only`로 내 파일만 확인
- 렌더 테스트 전 다른 세션 렌더 중인지 확인(`--test-concurrency=1` 직렬)
- 착수 전 `git -C <main> status --porcelain`(비면 안전) · 병합 전 겹침 점검

---

## 3. #4 — 교사용 예시 답안 (작은 다듬기 · 먼저 추천)

### 목표
지금 조직자는 전부 빈칸(학생 채움)이다. 프레이어·인물분석 같은 "정답이 있는" 조직자에 **교사용 모범
예시**를 넣고, 학생용에서는 자동으로 사라지게 한다.

### 메커니즘 (계획서 §5.1)
- **정답 제거는 개체 단위**다(`BuildVariants.stripAnswerObjects`: `answer:true` 개체 통째 제거).
  `table` 개체의 `answer`도 표 전체 단위 — 셀 단위 정답 플래그는 없다.
- 따라서 **셀 단위 교사 예시**는 두 경로로만:
  - **compose/블록 경로**: 셀 HTML 안에 `<span class="answer">모범답안</span>`
    → HTML 2차 방어 `stripElementsByClass(['answer','plot-ans'])`가 학생용에서 제거.
  - **에디터 개체 경로**: "빈 조직자 표 + 인접한 별도 `.answer` 예시 블록"(기존 `content` 관례).
- 빈칸 유지가 맞는 조직자(KWL·노트정리·3-2-1 등)는 그대로.

### 대상 후보
프레이어(정의·특징·예·비예 예시), 인물분석, 핵심아이디어+뒷받침, 5W1H, 관점비교.

### 착수 방식
1. 대상 조직자별로 "교사 예시 슬롯"을 정한다(어느 칸에 모범답안).
2. 방법 선택: (a) 조직자 블록에 `.answer` 예시 변형 추가, 또는 (b) compose **저작 브리프**가 designer
   AI에게 "이 칸에 교사 예시를 `.answer`로 저작"하도록 안내(무API 유지 — AI가 저작).
   → **(b) 저작 브리프 경로가 무API 원칙에 더 맞음.** `ArchetypeLibrary.buildBrief`의 `studentFill` 분기
   근처에 "정답 있는 조직자" 처리를 더한다.
3. 테스트: 교사용엔 예시 있음 / 학생용엔 물리 제거됨(grep 2차 방어) + `validate` 정답 누출 0.

### 관련 파일
`blocks/core/*.html`(대상 조직자), `src/usecases/ArchetypeLibrary.js`(buildBrief),
`src/usecases/BuildVariants.js`(제거 로직·참고), `test/unit/organizers.test.js`.

---

## 4. #2 — 에디터에서 조직자 삽입·편집 (큰 작업 · `/ralplan` 권장)

### 목표
브라우저 편집기(`edit-ui`)에서 교사가 조직자를 **클릭 삽입**하고(예: 삽입 갤러리), 가능하면 내부를
편집(예: 개념지도 노드 추가)하게 한다.

### 왜 큰가
조직자는 **블록층**(`blocks/*.html`)이고, 편집기의 삽입 카탈로그는 **닫힌 개체 10종**이다. 그래서
지금은 편집기에서 조직자가 삽입 목록에 안 뜬다.

### 방법 후보 (계획에서 결정)
- **(a) 내장 프리셋** — 조직자를 "내 블록" 프리셋으로 시드해 좌측 "내 블록" 탭에 노출.
  가장 가벼움. 표형 조직자는 `table` 개체로 표현 가능하니 프리셋화가 자연스럽다.
  단, SVG 그림형은 개체가 아니라 삽입/편집이 제한적.
- **(b) 삽입 카탈로그에 "조직자" 섹션** — `src/editor/leftPanel.js`에 조직자 갤러리 추가 → 클릭 시
  해당 조직자를 개체 트리에 삽입. 표형은 `table` 개체로, 그림형은 잠금 SVG(내부 편집 불가)로.
- **(c) 편집 가능한 그림 개체 신설(P3 스파이크)** — 벤/개념지도를 편집기에서 노드 추가 가능한 개체로.
  개체 스키마 확장(동결 스키마) 필요 → **가장 무겁고 회귀 위험 큼.** 데이터 기반 go/no-go.

**권장 순서:** (a)/(b)로 표형 조직자 삽입부터(저위험) → 그림형은 "잠금 삽입"(내부 편집 X) → (c)는
스파이크로 별도 판단.

### 관련 파일
`src/editor/leftPanel.js`(삽입 카탈로그·내 블록 탭), `src/editor/objectFactory.js`(개체 생성),
`src/editor/editor.js`, 프리셋 시스템(`.presets/presets.json`, 관련 usecase),
`schema/worksheet-object.schema.json`(개체 카탈로그 — (c)에서만 관여),
편집 렌더 테스트 `test/render/editor-*.render.test.js`.

### 착수 방식
**`/ralplan`으로 계획부터** — 특히 (a)/(b)/(c) 선택과 그림형 편집 범위를 합의로 결정한 뒤 실행.

---

## 5. 새 세션 착수 체크리스트

1. `git -C E:/github/worksheet-grab log --oneline -1` — main 최신 확인(4681efd 이후일 수 있음).
2. `git -C E:/github/worksheet-grab worktree add ../worksheet-grab-<작업명> -b feat/<작업명>`
3. 이 문서 + `docs/PLAN-graphic-organizers.md` + `docs/CONCURRENT-SESSIONS.md` 읽기.
4. #4는 바로 착수 가능 / #2는 `/ralplan`으로 계획 먼저.
5. 검증: `npm run test:unit` + 조직자 관련 `npm run test:render`(직렬). 작게 자주 커밋 → 병합.
