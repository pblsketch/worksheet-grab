# HANDOFF — worksheet-grab / 동적 구성(Dynamic Composition) 전환

> 이 문서만 읽어도 새 세션에서 바로 착수할 수 있도록 자기완결적으로 작성됨.
> 함께 읽을 것: `docs/PLAN.md`(Clean Architecture 전체 설계), `README.md`(CLI 사용법), `docs/HANDOFF.md`(M1 원본). 작성일 2026-07-21.

## 0. 한 줄 요약
현재 활동지 생성이 **교과당 고정 템플릿 1개**에 의존해, 주제가 달라도 구조·본문이 PoC 뼈대와 거의 같다. 이걸 **"요청마다 AI가 블록 어휘로 manifest를 그때그때 구성하는 동적 조립"** 으로 바꾼다. 템플릿 증식은 하지 않는다.

## 1. 문제 정의 (이번에 진단한 것)
`pipeline 중2과학 광합성`을 돌리면 산출물이 옴의법칙 PoC와 구조·본문이 거의 같다. 원인을 코드로 추적한 결과:

- **`generate`/`pipeline`(fast path)은 콘텐츠를 저작하지 않는다.** 하는 일: ① 성취기준 CSV 조회(주제별로 실제 다름 ✅) ② `templates/{subject}.json` 로드 ③ `{topic}`/`{subjectLabel}` **변수만** 치환 ④ 나머지 본문은 `［…슬롯］`으로 **비워 둠** ⑤ 2벌 분기·검수·렌더.
- 따라서 주제마다 실제로 달라지는 건 **(a) 제목/단원 글자, (b) 성취기준 원문** 딱 둘뿐. 교육적 본문(탐구문제·가설·변인·그래프축·문항·루브릭)은 전부 옴의법칙에서 뽑은 **고정 뼈대 + 빈 슬롯**.
- 근거 파일: [templates/science.json](../templates/science.json), [src/usecases/GenerateWorksheet.js](../src/usecases/GenerateWorksheet.js)(`buildManifest`가 변수 치환 + 슬롯 비움), 재현된 산출물 매니페스트 `out/science-광합성.manifest.json`.

## 2. 핵심 통찰 (설계 방향의 근거)
**템플릿 = "얼려둔 manifest"** 다. 특별한 존재가 아니라 그냥 미리 짜서 고정한 조립 명세.
- `assemble <manifest.json>`(CLI)은 **임의의 manifest를 렌더한다**(README §CLI). manifest는 `pages[] → 블록 배열`이라는 **자유 조립 IR(중간표현)**.
- 즉 "요청마다 유연하게 구성"은 **엔진에 이미 있는 능력**이고, `generate`가 편의상 고정 템플릿으로 우회하고 있을 뿐이다.
- 그래서 진짜 질문은 **"manifest를 누가 짜느냐 — 사람이 미리(템플릿) vs AI가 요청마다(동적)"**. → **동적**을 택한다.

**왜 템플릿 증식(대안)을 버리는가:** 필요는 곱셈(교과 × 주제 × 차시 × 활동유형)인데 템플릿 추가는 덧셈이라 롱테일을 못 덮고, 템플릿 내부는 여전히 경직되며, 유지보수가 늘어난다.

## 3. 채택한 목표 아키텍처 — "제약 안에서의 생성"
무API·범교과·인쇄 진실원천 원칙과 충돌 없음. 조립·저작은 **사용자 구독 AI(designer 에이전트)**, 검증은 **결정적 엔진**. 이미 설계에 있는 ContentAuthor 포트 + rich path를 완성하는 일이지 재작성이 아니다.

| 층 | 역할 | 현재 상태 |
|---|---|---|
| **블록 어휘(vocabulary)** | 타입별·인쇄안전 재사용 부품 (코어: header·standard-label·directive·question·answer-slot·rubric·reflection / 교과팩: 변인표·데이터표·SVG그래프·formula·지도·연표·어휘·대화문) | ⚠️ **병목**(§4) |
| **동적 조립(compose)** | 요청+성취기준+아키타입 → manifest를 AI가 그때그때 생성 | 엔진은 지원(`assemble`), 배선 필요 |
| **아키타입(archetype)** | 교과 초월 구조 패턴 5~6개: 실험탐구 / 자료해석 / 읽기·독해 / 토론·의사결정 / 개념구조화 / 프로젝트·제작 | 없음 (템플릿을 이걸로 강등) |
| **검수 게이트(validate)** | 정답누출·인쇄안전·페이지맞춤·하드코딩색 — fail-closed | ✅ 있음([src/usecases/ValidateWorksheet.js](../src/usecases/ValidateWorksheet.js)) |

## 4. 병목 — 블록 라이브러리가 "어휘"가 아니라 "PoC 조각"
`node bin/worksheet-grab.js list-blocks` → **81개**인데 이름이 `ko/p1-01-header`, `sci/p3-05-answer-line`처럼 **위치기반(page-position) 슬라이스**다. 두 PoC를 쪽·순서별로 자른 것이라 `answer-line`·`subq`·`question`·`content`가 위치마다 중복. 실제 구분 타입은 **~20종**인데 81개로 부풀어 있다.
→ **1순위 작업: 위치기반 조각 → 타입기반 어휘로 리팩터링**(각 블록에 계약: 슬롯 목록·인쇄안전 보장·허용 교과·코어/교과팩 구분). 이게 되어야 AI가 그 어휘로 manifest를 짤 수 있다.

## 5. 작업 범위 (Phased) + 수용 기준
> 원칙: 가장 위험한 가정을 먼저 싸게 검증(Phase 1) → 자산 정비(2~3) → 배선(4) → 정리(5).

- **Phase 1 — 동적 조립 실증(de-risk, 반나절):** 기존 블록만으로 광합성에 *실제로 맞는* manifest를 손으로 조립(실험탐구 아키타입 + 광합성 특화 변인·그래프축 저작)해 `assemble`→`build-variants`→`render`. **수용:** 템플릿 없이 임의 manifest가 A4로 정상 렌더되고 검수 PASS. (엔진이 오늘 동적 조립을 지원함을 실물로 증명)
- **Phase 2 — 블록 어휘 리팩터링:** 81 위치조각 → ~20 타입 어휘 + 블록 계약 스키마(JSON/문서). 코어 블록은 `var(--*)`만 참조(하드코딩색 0). **수용:** 코어 블록이 ≥2교과에서 렌더(범교과 게이트), 중복 제거 후 두 PoC를 새 어휘로 재조립해 페이지수·주요 컴포넌트 유지, `node --test` green.
- **Phase 3 — 아키타입 라이브러리:** 교과 초월 구조 패턴 5~6개 정의(어느 타입 블록을 어떤 순서로). 교과팩이 특수 블록 공급. **수용:** 한 아키타입(예: 실험탐구)이 과학·사회 등 ≥2교과에서 성립.
- **Phase 4 — 동적 조립 배선:** `compose`(요청+성취기준+아키타입+어휘 → manifest) 경로. 담당은 designer 에이전트([.claude/agents/worksheet-designer.md](../.claude/agents/worksheet-designer.md)) 또는 신규 `compose` 유스케이스/CLI. 검수 게이트는 fail-closed 유지, HITL 보존. **수용:** **같은 교과 다른 두 주제가 구조적으로 다른, 주제 적합 활동지**로 나온다(같은 뼈대 재탕 아님). 비(非)실험 과학 주제가 "변인표+직선그래프"에 강제되지 않는다.
- **Phase 5 — 템플릿 강등 + 정리:** `templates/*.json`은 삭제하지 말고 **프리셋/few-shot 시드**로 강등. 오케스트레이터 스킬([.claude/skills/worksheet-grab/SKILL.md](../.claude/skills/worksheet-grab/SKILL.md)) fast/rich 경로 문구 갱신. `README.md`·`docs/PLAN.md` 로드맵에 반영.

**최종 수용(전체):** 정답 누출은 여전히 물리 제거(도메인 불변식), 인쇄안전 통과, 페이지 넘침 없음, `node --test` 전부 green.

## 6. 제약 (변경 금지 전제)
- **무API**: 콘텐츠 저작은 사용자 구독 AI(Claude/Codex). 엔진에 LLM API 호출 넣지 않는다. 엔진은 결정적(조립·검증·렌더).
- **범교과(국어 비특화)**: 교과색은 `themes/*.css`의 CSS 변수로만. 교과 특수 블록은 해당 교과에서만. 코어 블록은 ≥2교과 통과 필수.
- **인쇄가 진실의 원천**: paper-css A4 다중페이지. `word-break:keep-all`, 문항 `break-inside:avoid`, 최소폰트·여백.
- **성취기준 원문은 조회만**(gepai CSV 1차·MCP 옵션), 창작 금지. 저작권 지문은 `[지문 삽입 슬롯]` 유지(실제 텍스트 채우지 않음).
- **학생용 정답 물리 제거**: `.answer`/`.plot-ans` 안에만 정답, student 빌드에서 DOM 제거. `validate` 정답누출 게이트는 fail-closed.
- **훼손 금지**: `.claude/`(하네스)와 `poc/` 원본은 참고·복사만. `out/`은 `.gitignore` 대상(산출물 폴더).

## 7. 방향 관련 기록 (동적 조립의 위험 & 완화)
순수 동적의 위험 = ① 페이지 넘침/인쇄 깨짐 ② AI 편차·슬롭 ③ 검수 어려움. 완화책이 곧 §3 구조: 블록이 태생적 인쇄안전(`break-inside:avoid`), `validate` fail-closed, 아키타입이 구조 앵커(AI가 백지에서 안 짬), HITL 최종. **가드레일 없는 동적 = 슬롭 / 가드레일 있는 동적 = 정답.**

## 8. 환경/재현 (이번 세션에서 확인)
- Node **v24.15.0**(≥24). 셸은 PowerShell 1차 + Bash 사용 가능(Windows 11).
- Chrome: `C:/Program Files/Google/Chrome/Application/chrome.exe` **존재 확인**(또는 `CHROME_PATH`). 렌더 `--virtual-time-budget` 짧으면 웹폰트·KaTeX·SVG 깨짐(기본 15000).
- 성취기준 CSV: `E:/github/gepai-mcp/data/source/achievement-standards.csv` **존재 확인**. 컬럼: `학교,과목,학년(학년군),성취기준 코드,성취기준 내용`.
- gepai MCP는 세션 중 끊길 수 있음 → 어댑터가 CSV 자동 폴백([src/adapters/GepaiCurriculum.js](../src/adapters/GepaiCurriculum.js)).
- 재현 명령:
  ```bash
  node bin/worksheet-grab.js pipeline 중2과학 광합성 --out out/   # 현 상태(고정 뼈대) 확인
  node bin/worksheet-grab.js list-blocks                          # 81 위치조각 확인(§4)
  node bin/worksheet-grab.js assemble sci --out out/sci.html      # manifest→렌더 경로 확인
  node --test "test/**/*.test.js"                                 # 회귀
  ```
- 먼저 읽을 코드: [src/usecases/AssembleWorksheet.js](../src/usecases/AssembleWorksheet.js)(manifest 스키마·블록 로드 방식), [manifests/ko.json](../manifests/ko.json)/[manifests/sci.json](../manifests/sci.json)(자유 조립 명세 실물), [src/usecases/GenerateWorksheet.js](../src/usecases/GenerateWorksheet.js).

## 9. 하지 말 것
- 교과별/주제별 고정 템플릿을 **더 만들지 않는다**(§2 근거).
- 엔진에 LLM API를 넣지 않는다(무API).
- 성취기준을 하드코딩·창작하지 않는다. 저작권 지문을 채우지 않는다.
- `.claude/`·`poc/` 원본을 삭제·훼손하지 않는다.
- 인쇄안전·정답누출 게이트를 우회(통과 위장)하지 않는다.

## 10. 완료(Definition of Done)
Phase 4 수용("같은 교과 다른 주제 → 구조적으로 다른 주제 적합 활동지") 실물 렌더로 시연 + 최종 수용(§5) 전부 통과 + `docs/PLAN.md`·`README.md` 갱신 + 이 문서에 결과 요약 추가.

## 11. 진행 로그

### Phase 1 — 동적 조립 실증 ✅ 완료 (2026-07-21)
**결과: 수용 기준 충족. 엔진이 오늘 동적 조립을 지원함을 실물로 증명.**

- **한 일:** 템플릿을 전혀 거치지 않고, "실험탐구 아키타입"에 광합성 특화 내용을 **인라인 `html` 블록으로 손수 저작**한 매니페스트를 만들어 `assemble→build-variants→validate→render` 전 체인을 통과시켰다. 성취기준 `[9과12-01]`("환경 요인과 광합성의 관계를 탐구하는 실험 설계")를 CSV에서 조회해 연결.
- **산출물:** [manifests/sci-photosynthesis.json](../manifests/sci-photosynthesis.json) (3쪽, 신규 커밋 대상). 렌더 결과는 `out/`(gitignore).
- **옴의법칙과의 구조적 차이(같은 아키타입·다른 주제 실증):**
  - 조작변인 = 전압 → **빛의 세기**(전등 거리), 종속변인 = 전류 → **1분당 기포 수**.
  - 그래프: 직선 비례(V∝I) → **포화 곡선**(빛↑ → 광합성량↑ 하다 일정 세기 이상 포화). 데이터도 8→18→28→33→35로 체감 증가.
  - 분석 개념: 옴의 법칙(비례식) → **한정 요인(limiting factor)**. 뼈대 재탕이 아니라 주제에 실제로 맞는 내용.
- **검증(실물):**
  - `validate` student/teacher 둘 다 PASS(exit 0) — 정답누출·하드코딩색·최소폰트 통과.
  - 정답 물리 제거 확인: 학생용 PNG에서 가설 상자·변인표 셀이 **비어 있음**, 교사용은 파란 정답으로 채워짐.
  - Chrome 렌더 3쪽 A4 정상, 페이지 넘침 없음. SVG 그래프 x축 라벨 겹침 1건 발견→수정(축 제목 중앙 하단 재배치)→재렌더로 확인(그라운딩 루프).
  - 회귀: `node --test` **79/79 green**(코드 무변경, 매니페스트만 추가).
- **재현:**
  ```bash
  node bin/worksheet-grab.js assemble sci-photosynthesis --out out/sci-photosynthesis.html
  node bin/worksheet-grab.js build-variants out/sci-photosynthesis.html --out out/
  node bin/worksheet-grab.js validate out/sci-photosynthesis-student.html   # exit 0
  node bin/worksheet-grab.js render out/sci-photosynthesis-teacher.html --out out/t.pdf --png out/t.png
  ```
- **다음:** Phase 2(81 위치조각 → ~20 타입 어휘 + 블록 계약). Phase 1이 인라인 `html` 저작으로 동작함을 확인했으므로, 어휘 리팩터링은 이 인라인 저작을 재사용 가능한 타입 블록으로 승격하는 작업이 된다.

### Phase 2 — 블록 어휘 리팩터링 ✅ 완료 (2026-07-21)
**결과: 수용 기준 충족. 81 위치조각 → 28 타입 어휘 + 계약 레지스트리. PoC 무손실 유지.**

- **한 일:**
  1. **계약 레지스트리** [blocks/vocabulary.json](../blocks/vocabulary.json) 신설 — 28타입(코어 14 · 교과팩 14). 타입별 계약: `category`(core|pack)·`subjects`·`slots`·`printSafe`·`keepTogether`·`cssClass`·특수플래그(gen/katex/저작권슬롯).
  2. **타입 캐논 exemplar** 27개 생성 — `blocks/core/*.html`(13, 주제 중립·`var(--*)`만) + `blocks/pack-{science,korean,social,english}/*.html`(14). `standard-label`은 gen(파일 없음).
  3. **PoC 매니페스트 무손실 마이그레이션** — `manifests/ko.json`(45)·`sci.json`(36)의 `file` 참조를 블록 내용 그대로 인라인 `html`로 치환. **재조립 SHA256이 마이그레이션 전 베이스라인과 IDENTICAL**(ko 5쪽·sci 3쪽, 주요 컴포넌트 전부 유지). 그 후 위치조각 81개 삭제.
  4. **배선** — `BlockRepository.readVocabulary()` 포트/어댑터 + CLI `list-vocab [--subject <교과>] [--json]`. `list-blocks`는 81→27로 자연 축소.
  5. **지뢰 제거** — `tools/extract-blocks.js`(`npm run extract`)가 옛 위치조각을 되살리지 않도록 인라인 `html` 매니페스트를 산출하게 수정. 실행 결과 매니페스트가 마이그레이션본과 **바이트 동일**(extract 로직과 마이그레이션의 등가성 역증명), `blocks/{ko,sci}` 미생성.
- **검증(실물):**
  - `node --test` **84/84 green**(기존 79 + 신규 `test/unit/vocabulary.test.js` 5: 로더·계약무결성·분류·**코어 하드코딩색 0**·**코어 exemplar ≥2교과 렌더**).
  - 기존 `assemble.test.js`가 이미 "재조립 ko=5쪽/sci=3쪽 + 주요 컴포넌트 유지"를 검증 → 마이그레이션 후에도 통과(Phase 2 수용의 핵심).
  - 마이그레이션 ko PoC 렌더·검수 PASS(exit 0, 저작권 지문 슬롯 warning은 의도된 설계). 시각적 무결성 확인.
- **정리:** `README.md` 갱신(list-vocab·새 blocks 구조·extract 설명). 코어 블록 범교과 게이트(`var(--*)`만)를 테스트로 상시 강제.
- **다음:** Phase 3(아키타입 라이브러리 5~6개). 어휘와 계약이 준비됐으므로, 아키타입은 "어느 타입을 어떤 순서로"를 교과 초월 구조 패턴으로 정의하는 작업이 된다(교과팩이 특수 블록 공급).

### Phase 3 — 아키타입 라이브러리 ✅ 완료 (2026-07-21)
**결과: 수용 기준 충족. 교과 초월 구조 패턴 6개 정의. 실험탐구가 과학·사회 ≥2교과에서 실물 성립.**

- **한 일:**
  1. **범용표 코어 재분류(Phase 2 교정)** — `memo-table`·`comparison-table`·`label-value`은 `var(--*)`만 쓰는 교과 무관 표라 교과팩→**코어**로 이동(core 14→17, pack 14→11). `SUBJECT_PACK_TYPES`도 정렬. `Block.category`는 렌더 무관이라 ko/sci 재조립 **바이트 동일 유지**.
  2. **아키타입 레지스트리** [blocks/archetypes.json](../blocks/archetypes.json) — 6개: 실험탐구·자료해석·읽기독해·토론의사결정·개념구조화·프로젝트제작. 각 아키타입은 **role 기반 페이지 시퀀스**(step = 고정 코어 `type` 또는 `packRole`). `packRoles` 7종은 의미 슬롯→교과별 블록 바인딩(**기본값은 코어**, pack 블록은 해당 교과 전용 → 교과 누출 0).
  3. **ArchetypeLibrary 유스케이스** [src/usecases/ArchetypeLibrary.js](../src/usecases/ArchetypeLibrary.js) — `resolve(id, subject)`(교과 바인딩 + 누출 검사), `toSkeletonManifest`(렌더 가능한 exemplar 스켈레톤; 콘텐츠 저작은 Phase 4 compose 몫), `subjectsFor`/`bindType`. `readArchetypes()` 포트/어댑터 + CLI `list-archetypes [--subject] [--json]`.
- **수용 증명(실물):**
  - **실험탐구를 과학·사회로 바인딩해 각각 3쪽 A4 렌더 + validate exit0.** 구조(header→지시→자료→예상→조건→기록→시각화→해석→정리)는 동일하고, packRole 자리만 재바인딩: 과학=`hypothesis-box·variable-table·data-table·svg-graph`, 사회=`content·memo-table·comparison-table·map`. "같은 아키타입, 다른 교과"가 실물로 성립.
  - `node --test` **90/90 green**(79 + vocabulary 5 + archetypes 6). 신규 [test/unit/archetypes.test.js](../test/unit/archetypes.test.js): 계약·**바인딩 누출 0**·모든 아키타입 교과 초월 해석·실험탐구 ≥2교과 성립·스켈레톤 조립.
- **경계:** Phase 3은 **구조**까지다. 스켈레톤은 exemplar 자리표시(문항 번호·예시 텍스트 반복)이며, **요청·성취기준으로 실제 콘텐츠를 저작하는 것은 Phase 4 compose**. `toSkeletonManifest`가 그 진입점(콘텐츠를 채워 대체).
- **다음:** Phase 4(동적 조립 배선). `compose`(요청+성취기준+아키타입+어휘 → manifest) 경로 — designer 에이전트 또는 신규 usecase/CLI. 검수 게이트 fail-closed·HITL 유지. 수용: **같은 교과 다른 두 주제가 구조적으로 다른, 주제 적합 활동지**로 나온다(뼈대 재탕 아님).

### Phase 4 — 동적 조립 배선 ✅ 완료 (2026-07-21) · **Definition of Done 도달**
**결과: 수용 충족. 같은 과학인데 광합성=실험탐구(변인표+포화곡선그래프), 생물분류=개념구조화(비교표+구조표)로 구조적으로 다른 주제 적합 활동지 산출. 비실험 주제가 변인표+그래프에 강제되지 않음.**

- **채택 방향(무API):** 하이브리드 — 엔진은 결정적으로 **스캐폴드**(아키타입 구조 + 제목·성취기준 채움 + 저작 브리프)만 만들고, 교육적 콘텐츠 저작은 **designer AI(사용자 구독)/교사**가 한다. 엔진에 LLM 없음. 이 세션에서는 Claude 가 designer 역할로 실증 콘텐츠를 저작.
- **한 일:**
  1. **`compose` 유스케이스/CLI** [src/usecases/ComposeWorksheet.js](../src/usecases/ComposeWorksheet.js) — 요청(학년교과+주제) → 성취기준 조회(창작 금지) + 아키타입 선택 + 저작 대기 스캐폴드(인라인 html) + 블록별 저작 브리프. `compose <학년교과> <주제> [--archetype <id>] [--standards ..] [--render]`.
  2. **주제→아키타입 휴리스틱** `ArchetypeLibrary.suggestArchetype` — 키워드 매칭(실험/탐구→실험탐구, 분류/비교→개념구조화, 토론/찬반→토론의사결정 …) + 교과 기본값. 항상 해당 교과에 적용 가능한 아키타입 보장. `--archetype` 로 교사/AI 가 덮어씀.
  3. **설계 결함 교정(실증이 발견):** concept-structuring·project-making 이 packRole `conditions`(과학→변인표)를 써서 비실험 주제에 변인표가 강제되던 문제 → 범용 표(label-value/memo-table, 코어)로 고정. 변인표·SVG그래프는 이제 실험탐구 전용.
- **수용 실증(실물):**
  - `compose 중2과학 광합성` → **experimental-inquiry**(3쪽, 변인표·포화곡선 그래프). `compose 중2과학 "생물 다양성과 분류"` → **concept-structuring**(2쪽, 비교표·5계 구조표, 변인표·그래프 0). 같은 과학, 다른 주제 → 구조·본문·페이지수 모두 다름.
  - designer AI 저작 산출물: [manifests/sci-photosynthesis.json](../manifests/sci-photosynthesis.json)(실험탐구) · [manifests/sci-bio-classification.json](../manifests/sci-bio-classification.json)(개념구조화). 둘 다 student/teacher **validate PASS(exit0)**, A4 렌더 정상, 학생용 정답 물리 제거 확인.
- **검증:** 단위 테스트 **114/114 green**(신규 [test/unit/compose.test.js](../test/unit/compose.test.js) 6: 휴리스틱·같은 교과 다른 주제 구조 상이·변인표 강제 안 됨·override/거부·스캐폴드 조립). 렌더 스위트는 병렬 Chrome 자원 경합으로 간헐 60s 타임아웃(오답 아님) — 실패 3건을 `--test-concurrency=1` 직렬 재실행 시 **7/7 통과**로 회귀 아님 확정.
- **DoD(§10):** Phase 4 수용 실물 시연 ✅ · 최종 수용(§5: 정답 물리 제거·인쇄안전·페이지 넘침 0·단위 green) ✅ · `README.md`·이 문서 갱신 ✅.

### Phase 5 — 템플릿 강등 + 정리 ✅ 완료 (2026-07-21)
- **템플릿 강등(비파괴):** `templates/*.json` 은 삭제하지 않고 **프리셋/few-shot 시드**로 위상 변경. [templates/README.md](../templates/README.md) 신설(세 구조 원천 — 아키타입/어휘/템플릿 — 의 관계 명시). `generate`/`pipeline` 빠른 경로는 그대로 동작(스모크 확인).
- **오케스트레이터 스킬:** [.claude/skills/worksheet-grab/SKILL.md](../.claude/skills/worksheet-grab/SKILL.md) 엔진 배선을 **세 경로**(빠른/프리셋 · 동적 조립 compose · 풍부한 5-에이전트)로 갱신. designer 가 compose 스캐폴드+브리프를 저작하는 흐름 명시(무API 준수). 하네스 구조는 보존(추가 방식).
- **로드맵/문서:** `docs/PLAN.md` §5 에 **M7 — 동적 조립(Phase 1~4)** 마일스톤 추가. `README.md` 에 "동적 조립" 아키텍처 절 + 디렉토리 설명(blocks=어휘+아키타입, templates=프리셋) 갱신.
- **결과:** 동적 조립 전환 완결. fast(프리셋)·dynamic(compose)·rich(에이전트) 3경로가 문서·엔진·하네스에서 일관.
