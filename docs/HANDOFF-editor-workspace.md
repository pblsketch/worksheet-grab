# HANDOFF — worksheet-grab / 비주얼 에디터 + 문서 워크스페이스 (slides-grab 방식)

> 이 문서만 읽어도 새 세션에서 바로 착수할 수 있도록 자기완결적으로 작성됨.
> 함께 읽을 것: `docs/PLAN.md`(Clean Architecture), `README.md`(CLI), `docs/HANDOFF-dynamic-composition.md`(동적 구성 — 이 작업과 자산 공유). 작성일 2026-07-21.

## 0. 한 줄 요약
worksheet-grab을 **slides-grab처럼 생성·편집·저장·내보내기가 되는 흐름**으로 만든다. Plan·Design·Export는 이미 있으므로, **빠진 두 조각 = (1) 브라우저 비주얼 에디터, (2) 문서 단위 저장/워크스페이스**를 짓는다. 단, 활동지는 슬라이드와 달라서 에디터를 **인쇄 문서 편집기**로 설계한다.

## 1. 레퍼런스(slides-grab) ↔ 현재 상태 매핑
레퍼런스: https://github.com/NomaDamas/slides-grab — 4단계 **Plan → Design → Edit(브라우저 비주얼 에디터) → Export**. 로컬에 `~/.claude/skills/slides-grab*` 스킬로도 설치돼 있음.

| slides-grab | worksheet-grab 현재 | 갭 |
|---|---|---|
| Plan(주제→아웃라인) | curriculum-mapper + planner | ✅ 있음 |
| Design(HTML 생성) | generate/assemble → A4 HTML | ✅ 있음(고정템플릿 한계는 dynamic-composition handoff 참고) |
| **Edit(브라우저 bbox 편집·AI 재작성)** | 대화형 CLI `edit`만 | ❌ **핵심 갭 — 이 문서의 주 대상** |
| Export(PDF/PNG/PPTX) | PDF/PNG(Chrome) | ✅ 있음(활동지엔 PPTX 불필요) |
| Save(`slides-dir/`+`.slides-grab/`) | `out/` 납작 파일 | 🔶 부분 — **문서 워크스페이스 필요** |

## 2. ⚠️ 왜 slides-grab 에디터를 그대로 이식하면 안 되나 (설계 대전제)
slides-grab는 **고정 캔버스**(720×405pt, 1슬라이드=1화면)라 픽셀 bbox 편집이 깔끔하다. 활동지는 **A4 다중페이지 리플로우**라 다르다:
- 문항 하나 지우면 아래가 다 밀려 올라감 → 절대좌표 bbox 안 맞음.
- 용지(A4/A3/B4/B3)·방향(세로/가로)이 1급 속성이고 페이지네이션을 지배함.
- **학생/교사 2벌**(정답 토글) — 슬라이드에 없는 개념.
- 답란·빈칸·표 = 학생이 쓸 공간(편집 대상). 인쇄안전(최소폰트·여백·keep-together)이 하드룰.
- 문항 번호 = 의미(삭제 시 자동 재번호).
→ 따라서 "슬라이드 에디터 이식"이 아니라 **A4 흐름용 인쇄 문서 에디터**를 새로 설계한다.

## 3. 확정된 설계 결정 (이번 세션 합의 — 이 문서의 권위)
> 아래는 사용자와의 설계 대화에서 **명시적으로 확정**한 것들이다. 임의로 뒤집지 말 것.

### 3.1 에디터 철학 — 일반 에디터 + 얇은 마크 (❗블록 타입별 인스펙터 아님)
- 초기에 "블록 타입마다 전용 인스펙터"를 검토했으나 **기각**. 이유: 정적·복잡하고, 새 요소마다 개발자가 타입을 추가해야 하는 감옥이 됨.
- **채택: 일반 WYSIWYG 에디터.** 공통 툴바로 서식 자유 편집:
  `[폰트▾] [크기▾] [B I U] [색▾] [정렬] [목록] [표▾] [이미지] [↶↷]` — Google Docs·한글(HWP)처럼.
- **활동지 전용 개념은 "타입"이 아니라 "마크(태그)" 몇 개로만**:
  - **⭐ 정답 표시(확정)** — 아무 내용이나 선택 → "정답으로 표시". 이 마크가 학생/교사 2벌을 자동 생성한다. **필수·비협상**(이게 없으면 교사가 두 벌을 손으로 관리). **근거: 엔진이 이미 블록 타입이 아니라 `.answer` CSS 클래스(마크)로 2벌을 나눈다 → 이 방식이 엔진과 정합.**
  - **✏️ 답란 삽입** — 툴바 버튼으로 학생이 쓸 빈 줄/칸을 꽂음.
  - (선택) 페이지 나눔·같이 붙이기(keep-together) 마크.

### 3.2 재사용 블록 = 사용자 프리셋 (개발자 정의 타입 아님)
- 아무거나 만들어 선택 → **"내 블록으로 저장"** → 재사용. 한글 **상용구**, Notion **템플릿 블록** 개념.
- 기본 제공 프리셋(발문·답란·표·루브릭) 몇 개를 깔되 **편집·삭제·추가 자유.**
- dynamic-composition handoff의 "타입 어휘"는 여기서 **기본 제공 프리셋으로 강등**되어 통합된다. 동적 조립도 이 프리셋을 씨앗으로 쓴다.

### 3.3 용지/방향 — 프리셋 우선 + 고급 자유조합 (확정)
- manifest에 1급 속성으로: `"paper": { "size":"A4", "orientation":"portrait", "margins":"20mm", "columns":1 }`.
- **교사용 UI는 "포맷 프리셋"으로 노출**(드롭다운 아님):
  - A4 세로(기본 1차시) · **A3 접이(→A4 4쪽 소책자, 대단원·모둠)** · A4 가로(연표·포스터·모둠판) · B4 세로(시험지·평가지).
  - 고급에서 크기×방향×여백×단 자유조합.
- 바꾸면 **전체 재페이지네이션.** 연쇄 영향: `assets/paper.css`(@page size·치수를 CSS 변수화), 렌더러(Chrome print 용지 전달), `validate`(여백·최소폰트를 선택 용지 기준으로).

### 3.4 인쇄안전 — 편집 화면 실시간 예고 + 게이트 확정 (확정)
- 원칙: **자유는 앞에서 · 안전은 앞에서 예고 + 게이트에서 확정.**
- **편집 캔버스 = 실제 인쇄 페이지**: 편집 화면을 print와 같은 `paper.css`·용지 치수·폰트로 그려 WYSIWYG 예측기로 만든다.
- 실시간 표시(전부 의존성 0, 브라우저+바닐라 JS): 여백선 / 넘침 실시간 감지(`getBoundingClientRect`로 페이지 바닥 초과 시 빨강 배지) / 최소폰트 즉시 경고 / 문항 분할 예고 / 라이브 검수 바(타이핑 중 갱신).
- **같은 규칙, 두 런타임**: 편집 화면(JS, 즉시·근사) + 게이트(Chrome, 확정·권위). **규칙 정의는 하나**라 갈라지지 않음. **근거: `ValidateWorksheet`/`html-scan.js`가 순수 JS(Chrome 무지)라 브라우저에서도 그대로 실행 가능 → 클라이언트 실시간 검증에 재사용.**
- 정직한 한계: 화면 렌더와 Chrome print가 미세하게 다를 수 있음 → 편집 화면=고정밀 예측기, Chrome=최종 판정. **"정밀 미리보기" 버튼**으로 온디맨드 백그라운드 Chrome 렌더 제공(느리지만 100%).

### 3.5 기술 제약 (확정)
- **의존성 0 유지** — 에디터도 바닐라 JS. 프레임워크(React 등) 도입 안 함. `edit-ui`(가칭)가 로컬 Node 서버로 에디터를 띄운다.
- **무API** — 에디터의 "AI 재작성/예시 채우기"는 API 키가 아니라 **이 세션의 구독 AI(Claude/Codex)** 가 처리(slides-grab 방식). 브리지로 편집 요청↔결과 왕복. **오프라인 편집(서식·마크·프리셋·리플로우)은 AI 없이 전부 결정적으로** 동작 → AI는 그 위의 레이어.
- **manifest = 편집·저장·구성의 단일 소스.** 편집은 manifest 블록에 반영 → 재조립. HTML 직접 진실 아님(2벌·검수·리플로우 안전 위해).

## 4. 아키텍처 정합 (이미 있는 것 재사용)
- **2벌 분기**: `BuildVariants`가 `.answer`/`.plot-ans` 마크 기준으로 student에서 정답을 물리 제거 → 3.1의 "정답 마크" 그대로 얹힘.
- **자유 블록**: 도메인이 블록 HTML을 `BlockContent`(불투명 값)로 다룸 → 자유서식·사용자 프리셋과 정합.
- **페이지 명시성**: manifest `pages[]`가 이미 페이지를 명시 → 에디터는 **페이지마다 용지 크기 박스 하나**를 그리고 박스 넘침을 감지(무거운 CSS paged-media 엔진 불필요, 의존성 0).
- **임의 조립**: `assemble`이 임의 manifest를 렌더 → 편집 후 재조립 경로 그대로.
- **순수 검수**: `ValidateWorksheet`(+`html-scan.js`)가 Chrome 무지 순수 JS → 브라우저 실시간 검증에 재사용(3.4).
- 착수 전 정독: [assets/paper.css](../assets/paper.css)(현재 A4 전제로 보임 — 용지 파라미터화 대상), [src/usecases/BuildVariants.js](../src/usecases/BuildVariants.js), [src/usecases/ValidateWorksheet.js](../src/usecases/ValidateWorksheet.js), [src/usecases/AssembleWorksheet.js](../src/usecases/AssembleWorksheet.js), [manifests/sci.json](../manifests/sci.json).

## 5. 문서 워크스페이스 / 저장 모델
현재 `out/`에 납작 파일(`subject-topic.html`, `-vN`). slides-grab의 `slides-dir/`+`.slides-grab/`를 활동지에 맞게:
```
worksheets/<문서명>/
  worksheet.manifest.json      # 진실의 소스(= 저장 포맷. 이미 교과·테마·성취기준·paper·pages 포함)
  worksheet.html / -student.html / -teacher.html
  worksheet-student.pdf / -teacher.pdf
  assets/                      # 지문 이미지·교사 삽입물
  .worksheet-grab/meta.json    # 교과·성취기준·생성/수정 시각
  history/                     # 편집 스냅샷(manifest 작음 → 매 편집 저장 = 무료 undo)
```
- 명령(가칭): `open <문서>`(에디터 로드) · 문서 목록 · `save`(manifest 쓰고 재렌더).
- manifest에 `paper` 속성(3.3) 추가가 저장 모델의 선행 작업.

## 6. 작업 범위 (Phased) + 수용 기준
> 원칙: 엔진 하부(용지·저장)부터 → 에디터 뷰 → 편집 → 프리셋 → AI. 각 단계는 실물 렌더로 검증.

- **E0 — 용지/방향을 문서 속성으로:** manifest `paper` 스키마 + `paper.css` 용지 파라미터화(@page size·치수 CSS 변수) + 렌더러 용지 전달 + `validate` 용지 기준화. **수용:** A3 가로·B4 세로 활동지를 실제 렌더, 페이지 치수 정확. `node --test` green.
- **E1 — 문서 워크스페이스/저장:** `worksheets/<문서명>/` 폴더 모델 + meta + history 스냅샷 + `open`/목록/`save`. **수용:** 문서 생성→편집→다시 열기→버전 히스토리 왕복.
- **E2 — 에디터 셸(읽기 전용, 인쇄정밀 캔버스):** `edit-ui`가 로컬 서버로 바닐라 JS 에디터 실행. manifest 페이지를 print 정밀 페이지 박스로 렌더 + 여백선 + 학생/교사 토글 + 라이브 검수 바(`ValidateWorksheet` 클라이언트 재사용). 편집은 아직 없음. **수용:** 활동지를 열어 A4 페이지·여백 표시, 2벌 토글, 실시간 검수 바 동작.
- **E3 — 편집(일반 툴바 + 마크):** contenteditable + 공통 툴바(폰트·크기·색·정렬·표·이미지) + ⭐정답 표시 마크 + ✏️답란 삽입 → manifest 역동기화 → 재조립. 넘침·최소폰트·분할 실시간 예고. **수용:** 텍스트 편집; 정답 마킹 → student 빌드에서 물리 제거; 답란 5줄 삽입; 폰트 축소 시 즉시 경고; 넘침 시 배지.
- **E4 — 사용자 프리셋:** 선택 → 이름 붙여 저장 → 프리셋 라이브러리 → 삽입. 기본 프리셋(발문·답란·표·루브릭) 동봉. **수용:** 커스텀 블록 저장 후 다른 문서에서 재사용.
- **E5 — AI 액션(구독 AI 브리지):** 블록 범위 "AI 재작성/예시 채우기"를 이 세션의 Claude/Codex로 라우팅 → manifest 반영. **수용:** 블록 선택→AI 재작성→반영. (오프라인 편집은 E3까지로 이미 완결)
- **E6 — 내보내기 통합/마감:** 정밀 미리보기(백그라운드 Chrome), 에디터에서 export, 포맷 프리셋 UI.

**최종 수용(전체):** 정답 누출 물리 제거(도메인 불변식) 유지, 인쇄안전 통과, 페이지 넘침 없음, 의존성 0 유지(프레임워크 미도입), `node --test` 전부 green.

## 7. 제약 (변경 금지 전제)
- **의존성 0** — 에디터 포함 표준 라이브러리만. 프론트엔드 프레임워크·빌드 스텝 도입 금지.
- **무API** — LLM은 구독 AI가. 엔진/에디터에 API 키 호출 넣지 않음.
- **학생/교사 2벌 & 정답 누출** — `.answer` 마크 기준 물리 제거, `validate` 게이트 fail-closed. 도메인 불변식.
- **인쇄가 진실의 원천** — paper-css, `word-break:keep-all`, `break-inside:avoid`, 최소폰트·여백. Chrome이 최종 판정.
- **범교과** — 교과색은 `themes/*.css` CSS 변수. 자유 색 지정은 예외적 오버라이드로.
- **성취기준 조회만**(gepai CSV 1차·MCP 옵션), 창작 금지. 저작권 지문은 슬롯 유지.
- **훼손 금지** — `.claude/`·`poc/` 원본 참고·복사만. `out/`은 `.gitignore`.

## 8. dynamic-composition handoff와의 관계
- **공유 자산 = manifest + 블록/프리셋.** 이 에디터가 편집하는 대상 = 동적 구성이 생성하는 대상.
- dynamic-composition의 "타입 어휘"(Phase 2) ↔ 이 문서의 "기본 제공 프리셋"(E4)은 **같은 substrate**. 한쪽을 잘 만들면 양쪽이 산다.
- 순서 권고: E0(용지)·E1(저장)은 독립 선행 가능. 에디터 편집(E3)과 동적 구성은 병행 가능하나, 프리셋(E4)에서 합류.

## 9. 환경/재현 (이번 세션 확인)
- Node **v24.15.0**(≥24). Windows 11, PowerShell 1차 + Bash 가능.
- Chrome: `C:/Program Files/Google/Chrome/Application/chrome.exe` 확인(또는 `CHROME_PATH`). 렌더 `--virtual-time-budget` 기본 15000.
- 성취기준 CSV: `E:/github/gepai-mcp/data/source/achievement-standards.csv` 확인.
- 현 상태 확인:
  ```bash
  node bin/worksheet-grab.js pipeline 중2과학 광합성 --out out/   # 생성·2벌·렌더 현행
  node bin/worksheet-grab.js edit out/science-광합성.manifest.json "3번 문항 빼고 성찰 추가"  # 현행 대화형 편집(에디터 대체 예정)
  node --test "test/**/*.test.js"
  ```

## 10. 하지 말 것
- 블록 타입별 전용 인스펙터로 회귀하지 말 것(3.1에서 기각).
- 프레임워크/빌드 스텝 도입 금지(의존성 0).
- 엔진/에디터에 LLM API 넣지 말 것(무API).
- HTML을 진실의 소스로 두지 말 것(manifest가 소스).
- 정답 누출·인쇄안전 게이트 우회(통과 위장) 금지. `.claude/`·`poc/` 훼손 금지.

## 11. 완료(Definition of Done)
E3(일반 툴바 + 정답 마크 + 답란 + 실시간 인쇄안전 예고) 실물 시연 + E1 저장 왕복 + 최종 수용(§6) 통과 + `README.md`·`docs/PLAN.md` 갱신 + 이 문서에 진행 로그 추가. (E4~E6은 후속.)

## 12. 진행 로그

### 2026-07-21 — E0 완료 (용지/방향을 문서 속성으로)
ralplan 합의 계획 v2.1(Planner→Architect→Critic APPROVE) 기준 구현.

**paper 스키마(1급 속성, 확정):**
```json
"paper": { "size": "A4|A3|B4", "orientation": "portrait|landscape", "margins": "<mm shorthand>", "columns": 1 }
```
- 미지정 = 현행 A4 기본, CSS **주입 0**(하위호환: 산출 불변).
- 단일 소스: `src/usecases/paper.js` 가 (CSS 스니펫·PNG 픽셀 치수·validate 여백 기준)을 전부 파생.
- Chrome `@page size` 는 `var()` 불가 → `AssembleWorksheet` 가 **숫자 mm 리터럴**을 paper.css 뒤에 주입(캐스케이드 override — MediaBox 실측으로 지배력 증명). `.sheet` 치수·여백은 `var(--sheet-*)` 폴백.

**확정 결정 3건:**
1. **A4 세로 resolved 기본 여백 = 현행 비대칭 `12mm 15mm 10mm 15mm`** (§3.3 예시 20mm 는 명시 프리셋으로 강등). `paper:{size:"A4"}` 만 붙여도 리플로우 없음 — 폴백-주입 등가성 테스트(`paper-fallback-equivalence.test.js`)가 상시 강제.
2. **B4 = JIS 257×364mm** (한국 시험지 관행; Chrome named B4=ISO 와 무관하게 mm 리터럴 주입). MediaBox 기대치 729×1032pt.
3. **columns 는 스키마 저장까지만** (`--sheet-cols` var 도 미emit). 다단 리플로우는 별도 에픽.

**실측 수용(실 Chrome):** A4 기본 595×842pt · A3 가로 1191×841pt · B4(JIS) 세로 729×1032pt · sci+`paper:{size:A4}` = 595×842pt + 페이지수 불변 · A3 PNG IHDR = paperToPx(1587×1123). 예시 manifest: `manifests/_e0-a3-landscape.json`, `_e0-b4-portrait.json`.

**배선:** `GenerateWorksheet`(템플릿 paper 전파, 없으면 키 미생성) · CLI `renderVariantFiles`(PNG 치수 paperToPx) · `ValidateWorksheet`(paper 기준 여백 + L≠R 경고, CSS 정규식 폴백 유지) · `RunPipeline`(paper 주입) · generate/pipeline 용지 로그 1줄(관측성).

### 2026-07-21 — E1 완료 (문서 워크스페이스/저장)
ralplan 합의 계획 v2.1(Planner→Architect 5건→Critic C1/M1/M2/m1→APPROVE) 기준 구현.

**저장 모델(§5 구현 + E1 확정):** `worksheets/<문서명>/` = `worksheet.manifest.json`(진실) · `worksheet-student.html`(조건부)/`-teacher.html`(항상) · `assets/` · `.worksheet-grab/meta.json`(schemaVersion·revision·createdAt/updatedAt·unsafe — 커밋 마커, 저장 순서 최종) · `history/<0001>-<ISO>.manifest.json`(매 저장 스냅샷 = 무료 undo). **`worksheet.html`(통합본)은 E1 미생성** — MODE_TOKEN 미치환 원본은 정답을 물리 포함한 누출 벡터라 워크스페이스에 두지 않는다(§5 슬롯은 E2 편집 캔버스 소관으로 예약).

**아키텍처:** 순수 정책 `src/usecases/workspace.js`(정규화·레이아웃·일련번호·meta·정합판정) / IO `src/adapters/FsWorkspaceRepository.js` / 오케스트레이션 `SaveDocument`·`OpenDocument`(**E2 에디터 서버의 로드/저장 진입점**). CLI: `doc list/open/save/history/restore` + generate/pipeline/edit `--doc` opt-in(전부 `emitToWorkspace`→`SaveDocument` 단일 경유). 기본 루트 `<cwd>/worksheets`, `--workspaces-dir` override.

**누출 fail-closed × 저장 관대성(P5) 신테시스:** 모든 저장 진입점이 SaveDocument 하나를 경유. manifest·history·teacher·meta 는 항상 저장(작업 손실 0)하되, 정답 누출(error) 감지 시 **student.html 쓰기 보류(잔존 제거) + meta.unsafe=true + 비영 종료**. 정상 재저장 시 unsafe 해제·student 재생성. E6 export 는 unsafe 를 fail-closed 로 승격 예정. **구현 노트(계획 대비 정정):** 누출 판정 피연산자는 student 단독이 아니라 RunPipeline 게이트와 동일하게 **student+teacher 양벌의 error 합집합** — student 는 `.answer` 가 이미 물리 제거된 상태라 answer-leak 규칙이 구조적으로 발화 불가하며, "마크 밖 평문" 탐지는 마크가 살아 있는 teacher 쪽이 담당한다(그 평문이 곧 student 잔존 누출분).

**수용 실증:** §6 왕복(생성→편집→다시 열기→`doc restore` 비파괴 복원+재렌더 일관) e2e green · 누출 3케이스(마킹 정답 안전/평문 누출 보류/재저장 해제) green · `--doc` 미지정 시 out/ 경로 무변경(기존 스위트 무수정 green).

### 2026-07-21 — E2 완료 (에디터 셸 — 읽기 전용, 인쇄정밀 캔버스)
ralplan 합의 계획 v2.1(Planner→Architect 7건→Critic C1/M1/M2/m1→APPROVE) 기준 구현.

**구조:** `edit-ui <문서명>` CLI → `EditorHttpServer`(127.0.0.1 전용, 포트0 기본) → `RenderEditorShell`(순수: Assemble+BuildVariants 재사용, student/teacher 두 물리 문서 + canvasMeta 용지 파생) → `src/editor/`(바닐라 ESM 클라이언트, 빌드 0). 셸 데이터는 **`/shell.json` fetch** — 조립본 head 의 KaTeX `</script>` 인라인 주입 붕괴를 원천 회피.

**§3.4 "같은 규칙, 두 런타임" 실현:** 브라우저가 원본 `ValidateWorksheet` 를 화이트리스트 ESM(`/src/**`)으로 그대로 import. 화이트리스트 = `browserGraph`(간선 추출이 `export … from` re-export 배럴 포함 — domain 6개 파일이 이 경로로 도달)의 전이 집합이며, `browser-purity.test.js` 가 그래프 전 파일의 `node:`/`require`/`process` 부재를 Chrome 없이 상시 단정(브라우저 로드 회귀를 유닛 그물에서 포착).

**검수 훅(E3 승계):** `recompute(mode)` — 입력은 shell.json 문자열(iframe DOM 아님, 지연 로드와 독립). answer-leak 은 항상 teacher(마크 생존측), 인쇄안전은 표시 변형 기준. 여백선은 **부모 오버레이 레이어**(iframe 무주입 — E3 contenteditable 대상 무오염), 학생/교사 토글은 물리 2벌 iframe 지연 로드 스왑.

**실물 실측(실 Chrome + Playwright 관찰):** A4 `.sheet` 793.7×1122.5px(CSS 96dpi 정밀 일치) · A3 가로 1587.4px · 여백선 인셋 56.7/45.3/56.7/37.8px(기대치 ±0.1px, 3페이지 전부) · 학생 토글 시 student iframe DOM 에 정답 텍스트 물리 부재(`.answer` 는 빈 답란 셸로 잔존 — 학생 기입 공간) · 누출 픽스처에서 검수 바 answer-leak error 배지. `editor-shell.render.test.js`(Chrome 게이트, --dump-dom + body dataset 계측 훅)가 자동 회귀로 고정.

### 2026-07-21 — E3 완료 (편집: 일반 툴바 + 마크 — §11 DoD 핵심 단계)
ralplan 합의 계획 v2.1(Planner→Architect 8건→Critic 4건→APPROVE) 기준 구현.

**§3.1 실현(일반 에디터 + 얇은 마크 — 인스펙터 없음):** teacher 캔버스 contenteditable + 공통 툴바(`toolbar.js` 어댑터 — execCommand 랩, **fontSize 는 직접 span style**(execCommand 는 1~7 레거시만 지원하는 실측 함정), 표 2×2·이미지 placeholder 삽입 골격) + **⭐ 정답 표시**(`marks.js`) + **✏️ 답란 5줄 삽입**.

**manifest 역동기화:** `AssembleWorksheet.execute(manifest, {editMode})` 가 teacher 캔버스에만 `<div class="wg-block" data-bp/bi/bt>` 경계 래퍼를 주입(`display:contents` — 실 Chrome 실측으로 .sheet 치수 E2 등가 확인, 기본 경로 바이트 불변). 저장 = DOM 순회 → `resync.js`(순수: 배열→pages, 래퍼 소실 시 잔여 흡수+structureWarning 경고 배너) → `POST /save` → **`SaveDocument` 단일 경유**(리비전·히스토리·누출 게이트). 래퍼·세션 태깅은 저장 산출물에 남지 않는다(무오염 실측 단정).

**⭐ 누출 3중 방어(§3.1 비협상 불변식):** (i) 신규 마크는 `data-wg-mark="session"` — 즉시 unwrap 은 세션 마크만. (ii) 기존 저작 `.answer` 해제는 confirm 게이트(실브라우저 관찰로 발화·거절 시 보존 확인). (iii) **저장 시 마크 소멸 감지** — `SaveDocument` 가 직전 manifest 의 마크 텍스트(`collectTextInside`)를 신규 student 의 `textOutside` 정규화 텍스트에서 전체/앞 20자 부분열로 검색해 `answer-mark-dropped` error 승격(unsafe·student 보류). **한계(정직):** (iii) 는 8자 미만 단답·대폭 수정을 못 잡는 최후 그물이며 주 방어는 (i)(ii)다.

**실시간 예고(§3.4):** input 디바운스 250ms → 페이지 바닥 초과 **빨강 넘침 배지**(부모 오버레이) · 8pt 미만 **즉시 min-font 경고** · 라이브 검수 바(`recompute` 입력을 편집 DOM 직렬화로 확장 — E2 훅 승계). student 토글은 편집 불가 **즉석 파생 미리보기**(`stripElementsByClass` 동일 원시 — 저장 없이 마크의 2벌 효과 체감, contenteditable·편집 하이라이트는 파생 시 제거).

**실물 실증:** 실 Chrome 시드 게이트(`--test-seed` 서버에서만 `?seed=` 활성 — 프로덕션 자동저장 오염 차단 실측): ② 마킹→저장→manifest `.answer` 반영·태깅 제거·student.html 물리 부재 ③ 답란 5줄 manifest 반영 ④ 6pt→min-font 즉시 경고 ⑤ 대량 답란→넘침 배지, + M1 높이 등가. Playwright 관찰: ① 자유 타이핑(insertText) 편집, ⭐마킹→학생 토글 즉석 반영, 기존 마크 confirm 발화·거절 보존, 저장 후 iframe 유지(rev 2, `__liveMarker` 생존 = 커서 컨텍스트 보존), `doc open` 재확인(rev 2·히스토리 2 = E1 저장 왕복).

### 2026-07-21 — E4 완료 (사용자 프리셋 — 재사용 블록)
ralplan 합의 계획 v2(Planner→Architect 7건→APPROVE) 기준 구현.

**§3.2 실현(개발자 타입이 아니라 사용자 프리셋):** 에디터에서 아무 블록이나 선택 → **⧉ 내 블록으로 저장**(`window.prompt` 이름, 취소 미저장) → **📁 프리셋 라이브러리**에서 삽입. 프리셋은 문서 밖 공유 자산 `<워크스페이스>/.presets/presets.json` **단일 인덱스**(userPresets + hiddenBuiltins 오버레이) — 쓰기는 tmp→`.bak` 보존→rename **원자 교체**, 읽기는 정합 실패 시 백업 폴백(자산 손상 폭발 반경 방어). 기본 제공(발문·답란·표·루브릭 등 6종)은 `blocks/vocabulary.json`+`core/*.html` 에서 **런타임 파생한 읽기전용 빌트인**(§8: 동적 조립과 같은 substrate, exemplar 부재 시 개별 스킵) — 삭제=숨김 툼스톤·복원 소액션·동명 사용자 shadow 로 §3.2 "편집·삭제·추가 자유"를 비파괴로 이행.

**아키텍처:** `presets.js`(순수 정책) / `FsPresetRepository`(원자 IO) / `PresetLibrary`(자산 오케스트레이션 — **SaveDocument 미경유**: 프리셋은 문서가 아니라 상용구, 정답 포함 저장 허용). 서버 `GET/POST /presets`·`DELETE /presets/:id`·`POST /presets/restore/:id`. 삽입 = 커서 블록 뒤 `wg-block` 래퍼 추가뿐 — **E3 역동기화(serializeSheets→resync→SaveDocument) 무변경**으로 문서 게이트(누출·마크 소멸 감지)가 프리셋 삽입분에도 그대로 발동.

**§3.1 사각지대 봉합:** 라이브러리 미리보기는 **sandbox iframe(`sandbox=""` — 부모 접근·스크립트 차단 실측)** + 기본 **물리 제거본**(`stripElementsByClass` 동일 원시) 렌더, "정답 보기" 토글로만 원본. 정답 포함 상용구를 저장해도 학생 앞 화면에 정답이 새지 않는다.

**실물 실증:** 시드 dump-dom(저장→목록 등장·아티팩트 정제 / 삽입→저장→manifest +1) + Playwright 관찰: 과학 문서A에서 정답 포함 '변인 정리 표' 저장 → prompt 발화 → 미리보기 기본 정답 부재·토글 시 노출 → 빌트인 숨김→복원 왕복 → **국어 문서B 라이브러리에 등장 → 삽입 → 저장(rev 2) → B manifest 에 variable-table 블록 잔존(§6 수용: 다른 문서에서 재사용)**. CLI `preset list/delete/restore` + `doc list` 의 `.presets` 오인 차단.

### 2026-07-21 — E5 완료 (AI 액션 — 구독 AI 브리지, 무API)
ralplan 합의 계획 v2(Planner→Architect 8건(HIGH 2)→Critic→APPROVE) 기준 구현.

**§3.5 실현(무API):** 에디터의 🤖 AI 재작성/✨ 예시 채우기는 LLM API 를 호출하지 않는다. 요청은 **워크스페이스 파일 큐 `<baseDir>/.ai-bridge/{requests,responses}/`**(tmp→rename 원자 — 부분 파일이 상대 프로세스에 노출되지 않아 TOCTOU 방어)에 기록되고, **별도 프로세스의 구독 AI 세션이 `ai pending --watch`(1s 폴링 감시)로 수신해 `ai respond <id> --from <file>` 로 회신**한다. 상태 소유권: 서버 = pending 생성·cancelled·applied(즉시 prune), CLI = answered(응답 파일). `cancelled` 는 terminal — respond 가 거부하고 getStatus 우선순위로 레이스에서도 취소가 이긴다. **정직한 한계: '반영'은 AI 세션이 pending/watch 활성일 때 일어난다**(무API 의 대가 — SKILL.md 트리거 프로토콜로 명문화).

**§7·§10 코드 강제(타입 가드 3중):** ValidateWorksheet 는 성취기준 변조·저작권 슬롯 침범을 못 잡는다 → `excludedTypes(vocabulary)`(copyrightSlot ∪ gen — 실측 passage·standard-label)를 **순수 정책(assertTargetable) + 서버 400 + 클라이언트 버튼 비활성**으로 강제. 성취기준 원문은 요청 컨텍스트에 **읽기 전용**으로만 동봉.

**적용 안전(심층 방어):** 응답은 **DOMParser 순회 정제**(script·on*·javascript: 제거 — XSS 픽스처 실측: `<script>`·`onerror` 미주입) → **diff 미리보기**(sandbox iframe) → **가역 적용**(innerHTML 스냅샷 + "AI 적용 되돌리기") → `data-ai-req` 마커 즉시 제거(serializeSheets·프리셋 추출 정제 목록에도 편입 — 산출 manifest 무오염 실측) → 저장은 기존 SaveDocument 게이트.

**실물 실증(이 세션이 실제 구독 AI):** 에디터에서 발문 블록 선택→🤖 → `ai pending --json` 으로 수신(성취기준 [9과14-02] 컨텍스트 동봉) → 실제 재작성 → `ai respond` → 에디터 diff(원본/재작성) → 적용(마커 정리·되돌리기 표시) → 저장 rev 2(§6 수용 왕복). **누출 반증:** 정답을 마크 밖 평문으로 넣은 악성 응답을 적용·저장 → `answer-leak` + `answer-mark-dropped` **이중 발화** → unsafe·student.html 보류(디스크 실측) — E3 3중 방어의 최후 그물이 AI 경로에도 그대로 작동. 시드 dump-dom 3/3(요청 발신·타입 가드 차단·적용 왕복+XSS+마커 무오염).

### 2026-07-21 — E6 완료 (내보내기 통합/마감 — 로드맵 최종 단계)
ralplan 합의 계획 v2(Planner→Architect 조건부 승인 MED 4·권장 5 전부 반영→Critic APPROVE) 기준 구현.

**"저장이 곧 게이트" 단일 경로:** export·정밀 미리보기·용지 변경 셋 다 **저장본(SaveDocument 가 게이트 통과시킨 디스크 산출물)만** 대상으로 한다 — 임시 직렬화 같은 두 번째 진실 소스를 만들지 않아 누출 방어선이 모든 산출 경로에 대칭 적용된다. 클라이언트는 dirty-gate save-first(비-dirty 반복 조회는 저장·스냅샷 0, 실측 시드 `export-ui`)로 우회 없이 저장을 선행하고, 실패 시 진행을 중단한다.

**`meta.unsafe` fail-closed 승격(E1 예고의 이행):** 신규 `ExportDocument` 유스케이스(서버 `POST /export` 와 CLI `doc export` 가 **동일 코어 공유**)가 meta.unsafe(또는 meta 부재 = 부분쓰기 의심)면 **student PDF 거부·teacher 는 항상 산출**(§7 정신 = student 차단이 핵심). 스테일 student.pdf 는 SaveDocument 의 removeStudentHtml 과 **대칭으로 물리 제거**. meta 는 안전한데 student.html 부재(불일치)면 throw 대신 `skipped='missing'` graceful 강등으로 teacher PDF 를 보존한다. 워크스페이스에 `worksheet-{student,teacher}.pdf` 슬롯 신설(layout 확장).

**정밀 미리보기(§3.4):** `GET /preview.png?mode=` — 저장본을 백그라운드 Chrome `renderToPng` 로 렌더(scale:2 핀 고정, **IHDR == 2×paperToPx 등식 실측**: A4 1588×2246). E6 은 첫 페이지 고정(페이지별 미리보기는 후속). unsafe 시 student 미리보기 409. 서버 in-flight 가드로 렌더 동시 1개(중복 요청 409 busy — Chrome 겹침 flake 방지).

**포맷 프리셋 UI(§3.3):** 상단 용지 배지 옆 프리셋 선택기(paper.js `PAPER_PRESETS` 4종: A4 세로/A3 접이(가로)/A4 가로/B4 세로 + 고급 size×orientation×margins 자유조합, columns 는 E0 확정대로 스키마만) → save-first → `POST /paper`(resolvePaper 검증·동일 용지 no-op 가드·SaveDocument 경유 = 게이트·히스토리) → **셸 재로드 = 전체 재페이지네이션(E3 "저장 후 iframe 유지" 원칙의 명시적 예외)**. 프리셋 매핑은 화이트리스트·순수·CLI 공유가 이미 보장된 paper.js 에 배치(신규 클라 파일의 화이트리스트 404 함정 회피). **정직한 경계: "A3 접이" = E6 은 A3 가로 단일 시트 렌더까지 — A4 4쪽 소책자 imposition(논리 페이지 재배열)은 후속 에픽**(UI 라벨·README 명문).

**실측(실 Chrome):** PDF MediaBox — A4 595.3×841.9 / A3 가로 1191.1×841.9 / B4(JIS) 728.5×1031.8pt(E0 기준 수치 재확인), unsafe 픽스처에서 student.pdf **물리 부재**·teacher 존재·CLI 종료코드 1. Playwright 실물: 프리셋 A4→A3 접이 변경 → 캔버스 793.7→1587.4px 재페이지네이션(rev 2·배지 동기화) → 정밀 미리보기 `<img>` 3174×2246 표시 → PDF 내보내기 2벌(1191×842pt·3쪽) → 정답 평문 주입·저장(unsafe rev 3) → export 가 "교사용 PDF 만 생성" 차단·디스크에서 student.pdf/html 부재 실측.

**E0~E6 로드맵 완결표:**
| 단계 | 내용 | 핵심 산출 | 상태 |
|------|------|-----------|------|
| E0 | 용지/방향 문서 속성 | paper.js 단일 소스·@page 리터럴 주입·PDF 실측 3종 | ✅ |
| E1 | 문서 워크스페이스/저장 | SaveDocument 단일 게이트·unsafe 보류·history 무료 undo | ✅ |
| E2 | 에디터 셸(읽기 전용) | /shell.json·browserGraph 화이트리스트·인쇄정밀 캔버스 | ✅ |
| E3 | 편집(툴바+마크) | 블록 래퍼→resync→저장·⭐ 3중 방어·라이브 검수 바 | ✅ |
| E4 | 사용자 프리셋 | .presets 원자 IO·빌트인 오버레이·sandbox 미리보기 | ✅ |
| E5 | AI 액션(무API 브리지) | .ai-bridge 파일 큐·타입 가드 3중·가역 적용 | ✅ |
| E6 | 내보내기 통합/마감 | ExportDocument fail-closed·정밀 미리보기·포맷 프리셋 UI | ✅ |

**후속(범위 밖 명시):** A3→A4 4쪽 소책자 imposition · 페이지별 정밀 미리보기 · columns 다단 리플로우(스키마만 존재) · export `--out` override.

### 2026-07-26 — Phase 4 완료 (페이지 범위 AI · AI 스키마 v4)

**AI 브리지 스키마 v4(현행 신규 쓰기).** `AI_SCHEMA_VERSION = 4`, 관용 집합 `{1,2,3,4}`. `validateRequest`/`validateResponse` 는 버전을 관용하되 **형태-버전 정합**만 강제한다 — 디스크에 남은 v1(단일 `block`)·v2(`blocks[]`)·v3(`objects[{id,object}]`) in-flight 파일은 계속 유효하다. **상수 사용 규약: `AI_SCHEMA_VERSION` 은 v4 페이로드에만 쓴다.** v1/v2/v3 를 쓰는 호출부(CLI `--from`/`--html`/`--blocks`/`--objects`, 테스트 픽스처)는 리터럴로 태깅한다 — 상수를 옛 형태에 쓰면 형태-버전 불일치로 검증이 거부한다.

**요청(v4)** — `{schemaVersion:4, id, docName, action, objects:[{id,type,…개체 전체 필드}], instruction, context, scope:'objects'|'page', pageId?, pageVersion?, status}`
- `pageVersions:{pageId: version}` = 이 요청이 **걸친 모든 페이지**의 지문(아래 "보호 범위" 참조). 여러 쪽에 걸친 선택에서도 덮어쓰기를 놓치지 않는다.
- `scope:'page'` = 선택 없이(또는 교사가 명시적으로 토글해) **현재 활성 페이지 전체**를 대상으로 부른 요청. 이때 `objects[]` 에는 그 페이지의 flow+float 개체가 실리되 **`std-box` 는 제외**된다(원칙 3 — 페이지 전체라는 이유로 성취기준 원문이 AI 대상이 되지 않는다).
- 활성 페이지는 **페이지 ID** 로 식별한다(index 금지 — Phase 2 규약).
- `pageVersion` = 요청 시점 페이지 내용 지문(`domain/schema/PageIdentity.computePageVersion`, `pv1-<16진 16자>`). 키 정렬 정규화 후 FNV-1a 2벌 — 같은 내용이면 같은 값, 필드 하나·순서 하나만 바뀌어도 다른 값. 서버는 이 값을 **재계산하지 않고 통과**시킨다(재계산하면 "요청 시점"이라는 의미를 잃는다). `docName` 은 여전히 서버 고정값이다.

**응답(v4)** — `{schemaVersion:4, id, ops:[…]}` — 개수·종류가 자유로운 **계획**이다(1:1 치환 강제 폐기).
- `{op:'replace', id, object}` · `{op:'insert', object, afterId?|beforeId?}` · `{op:'delete', id}`
- `insert` 에 `afterId` 와 `beforeId` 를 **동시에** 주면 거부(어느 기준인지 모호). 신규 개체의 `id` 는 버려지고 적용 시 새로 발급된다(기존 개체와 충돌 방지).
- `insert` 의 앵커는 **본문 흐름(flow) 개체여야 한다.** 자유 배치(float) 개체를 기준으로 주면 거부한다 — `insertFlow` 는 흐름이 아닌 앵커를 만나면 마지막 페이지 끝에 붙이므로, 그대로 두면 AI 가 지목한 자리와 다른 곳에 **조용히** 꽂힌다(유령 앵커를 던지는 것과 같은 원칙).
- **계층 분리:** `aiBridge` 는 프로토콜 형태만 본다. "std-box 를 지우려 든다"·"없는 `afterId` 를 가리킨다"처럼 **문서를 알아야** 하는 판정은 적용 경로(`editor/objectFactory.applyAiOps`)가 맡고, 위반 시 **던진다**(조용한 부분 반영 금지 — 절반만 반영된 채 "AI 가 반영됐다"고 믿게 두지 않는다).
- CLI 회신: `worksheet-grab ai respond <id> --ops <file.json>`(`[{op,…}]` 또는 `{ops:[…]}`). `--objects`(v3)도 그대로 받는다.

**편집기 적용 경로.** 미리보기는 ops 를 수정/신규/삭제로 나눠 보여준다(삭제는 before 만·신규는 after 만) + "대상 N개 → 결과 M개" 개수 변화 표기. 계획 항목이 하나라도 무효면 **적용 버튼 비활성 + 사유 표시**(무음 실패 금지). 적용은 `applyAiOps` 로 만든 단일 next 문서를 `applyDocOp` 에 **한 번만** 통과시킨다 — undo 1스텝이 그 대가다(대상별 반복 호출 금지). 적용 후 선택은 결과 개체 전부로 옮겨간다.

**덮어쓰기 방지(fail-closed).** 적용 직전에 `pageVersion` 을 다시 계산해 요청 시점 값과 비교한다. 다르면 **자동 적용하지 않고** 교사에게 알린 뒤 "그래도 적용 / 폐기"를 준다. 대상 페이지가 그 사이 삭제됐으면 강행 경로 없이 거부한다(적용 위치 자체가 정의되지 않는다).

**보호 범위 = 요청이 걸친 페이지 집합(후속 반영, 2026-07-26 2차).** 초기 구현은 대표 페이지 한 장만 지문을 재서, 1쪽과 2쪽 개체를 함께 고른 요청에서 대기 중 2쪽을 편집하면 충돌로 잡히지 않았다(교사 편집이 조용히 덮임). 지금은 요청이 **걸친 모든 페이지**의 지문을 `pageVersions:{pageId: version}` 으로 싣고 적용 직전에 전부 비교한다. `pageId`/`pageVersion` 은 대표 페이지로 남아 CLI 표시와 하위호환을 맡는다(`pageVersions` 가 없는 옛 in-flight 응답은 대표 한 장으로 폴백 — 검사를 건너뛰지 않는다).

그리고 이 페이지 집합이 곧 **그 요청이 바꿀 수 있는 범위**다: `ops` 가 집합 밖 페이지의 개체를 replace/delete 하거나 그쪽 개체를 삽입 앵커로 삼으면 거부한다. 범위 밖은 (a) `pageVersion` 보호를 못 받고 (b) "대상 N개 → 결과 M개" 표기와도 어긋나기 때문이다.

**검증.** 단위 463/463 · 렌더(직렬) 91/91 · fail 0(기준선 449/83). `test/unit/{page-version,editor-ai-ops,ai-bridge,ai-cli,editor-server}.test.js`, 렌더 `test/render/editor-ai.render.test.js` — 개수 변화 미리보기·적용 1 op·undo 1스텝·페이지 전체 scope(std-box 제외)·충돌 감지·페이지 삭제 거부를 실 Chrome 시드로 단정.

### 2026-07-27 — Phase 5 완료 (모듈 경계 정리)

**성격.** 순수 구조 정리 — **사용자에게 보이는 동작 변화 0**. 완료 근거는 "무엇을 만들었나"가 아니라
"무엇이 안 바뀌었음을 어떻게 증명했나"다. 기준선(단위 463 / 렌더 91, fail 0)을 **개수 감소 없이**
그대로 유지했고, 테스트 기대값은 한 줄도 고치지 않았다.

#### 1) 편집기 모듈 경계

`editor.js` **1,241줄 → 884줄.** 이 파일에 남은 것은 *조립 + 상태 소유 + 문서 변경 단일 관문*뿐이다.

| 새 모듈 | 줄 | 책임 | 주입받는 것 |
|---|---|---|---|
| `saveController.js` | 82 | `save()`·dirty·유휴 30초 자동 체크포인트·rev 배지 | `getDocument`/`setDocument`/`showBanner`/`onSaved`/`onDirty` + DOM 노드 |
| `exportController.js` | 116 | `/export`·`/preview.png`·`/open` + save-first 게이트 | `isDirty`/`save`/`showBanner`/`getMode` + DOM 노드 |
| `reviewChip.js` | 31 | `runReview()`·findings 소유·검수 칩 표시 | `getDocument`/`getTeacherDoc`/`onChipClick` |
| `banner.js` | 14 | 알림 배너(ok 4초 자동 소멸) | 호스트 노드 |
| `shortcuts.js` | 156 | 개체 단축키(삭제·넛지·복사/붙여넣기·저장·undo/redo)·인메모리 개체 클립보드 | `core`/`history`/`selection`/`operations`/`applyDocOp`/… |
| `editorStyle.js` | 113 | teacher iframe 편집 보조 CSS 주입 | (순수) |

**배너를 저장에서 뗀 이유:** 저장 모듈에 두면 내보내기 모듈이 저장 모듈에 의존하게 된다(배너는
저장 전용이 아니다). 독립 모듈로 두고 둘 다 주입받는다.

**불변식 보존:**
- **`applyDocOp` 은 그대로 `editor.js` 소유.** `shortcuts.js` 는 next 문서만 계산하고 반영은
  주입받은 `applyDocOp` 하나로만 보낸다 — 관문이 하나라는 성질이 의존성 방향으로 드러난다.
  유일한 예외인 넛지는 **원래부터** 관문 미경유였다(flow 경계 불변 → 재로드 없이 라이브 좌표만 갱신).
- 새 모듈은 전부 `create*(deps)` 팩토리이고 `core`/`history`/`selection` 을 **import 하지 않는다**
  (필요하면 deps 로 받는다). DOM 도 전역 조회 대신 주입받은 노드만 만진다.
- 브라우저 절대경로 import 규약(`/editor/*`, `/src/*`) 준수 — `/editor/*` 서빙은 디렉토리 기반이라
  새 파일이 자동으로 화이트리스트에 든다.
- `testSeed.js` 는 **한 줄도 바꾸지 않았다.** `editor.js` 가 넘기는 deps 이름(`save`·`runReflow`·
  `handlePageAction`·`getClipboardCount`…)을 그대로 유지했기 때문이다.

#### 2) 서버 라우트 테이블

`EditorHttpServer.js` **550줄 → 84줄**(조립 지점). 라우트 구현은 `src/adapters/editor-routes/` 로.

| 모듈 | 줄 | 라우트 |
|---|---|---|
| `httpKit.js` | 87 | `send`/`sendJson`/본문 리더/`dispatch` — 매칭 계약의 집 |
| `documentRoutes.js` | 157 | `POST /save` · `POST /paper` · `GET /shell.json` |
| `presetRoutes.js` | 64 | `GET|POST /presets` · `DELETE /presets/*` · `POST /presets/restore/*` |
| `renderRoutes.js` | 112 | `POST /export` · `GET /preview.png` · `POST /open` |
| `aiRoutes.js` | 110 | `POST /ai/requests` · `GET /ai/*` · `POST /ai/*/cancel|applied` |
| `assetRoutes.js` | 97 | `POST /assets` · `GET /assets/*` |
| `staticRoutes.js` | 46 | `GET /` · `GET /src/*` · `GET /editor/*` |

**매칭 계약(구 선형 `if` 사슬과 동일한 순서를 선언적으로 재현):**
1. 선언 순서대로 `method` 가 같고 `path`(정확) 또는 `prefix`(접두)가 맞는 첫 라우트를 호출.
2. 핸들러가 `PASS` 를 돌려주면 매칭을 계속한다 — `POST /presets/<restore 아님>`·
   `POST /ai/<cancel|applied 아님>` 처럼 접두는 맞지만 세부 형태가 다른 요청이 원래 사슬에서
   그냥 흘러내리던 동작의 재현이다.
3. 아무도 처리하지 않았고 **GET 이 아니면 405**(`GET only`), **GET 이면 404**.

**보안 성질의 소재(분리하면서 우회 경로가 생기지 않도록 의도적으로 한 모듈에 묶었다):**
- `/src/*` browserGraph 화이트리스트 + `/editor/*` 디렉토리 경계·MIME 표 → `staticRoutes.js` 한 곳.
- 자산 이름 살균·매직바이트 대조·5MB 상한·쓰기/읽기 양쪽 경로 이탈 재검사 → `assetRoutes.js` 한 곳.
- **렌더 in-flight 가드(`renderBusy`)** → `renderRoutes.js` 의 클로저 **하나**. export 와 preview 가
  같은 플래그를 공유해야 Chrome 동시 spawn 이 막힌다 — 모듈을 갈랐으면 가드가 둘로 쪼개졌을 것이다.
- `docName` 서버 고정값 주입은 각 라우트 팩토리가 deps 로 받는다(클라이언트 위조 경로 없음).

**무회귀 증거:** `editor-server.test.js` 12건 전량 + 라우트 20종 실호출 프로브(메서드×경로 조합의
상태코드·Content-Type)를 **리팩터링 전/후 서버에서 각각 돌려 출력이 완전히 동일함**을 확인했다.

#### 3) 렌더·저장 경로 지도

**렌더 — `RenderObjectTree` 는 단일 구현이고 5곳이 각자 `new` 한다.** 이건 중복이 **아니다**:
생성자가 없는 무상태 클래스라 인스턴스가 상태를 나눠 갖지 않는다. 지도는 아래와 같고, 어느 것도
지우지 않았다(각자 다른 소비자가 있다).

| 렌더 경로 | 호출자 | 없으면 깨지는 것 |
|---|---|---|
| `RenderObjectTree.execute(editMode:true)` | `editor/reflow.js` | 리플로우 **측정** — flow 페이지 귀속 재계산 |
| 〃 | `RenderEditorShell.executeObjectTree` | 편집 캔버스 teacher HTML(data-oid 경계 래퍼) |
| `RenderObjectTree.execute()` | `BuildVariants.executeObjectTree` | 저장본 student/teacher 2벌(정답 트리 제거) |
| 〃 | `PaginateObjectTree` | 생성 시 페이지네이션(Chrome 측정 어댑터 경유) |
| 〃 | `editor/ai.js` | AI 미리보기 단일 개체 렌더 |
| `AssembleWorksheet`(레거시 결정적 엔진) | CLI generate/assemble/edit · `SaveDocument.execute` · `RenderEditorShell.execute` · `MigrateManifestToObjectTree` | **HTML manifest 경로 전체** — 아직 CLI `generate` 가 manifest 를 만든다 |

**저장 — `SaveDocument` 의 두 진입점은 중복이 아니다(입력 스키마가 다르다).**

| 진입점 | 입력 | 호출자 | 없으면 깨지는 것 |
|---|---|---|---|
| `execute({name, manifest})` | 레거시 HTML manifest | CLI(`doc save`/`--doc`/`restore`) · `POST /paper`(비-개체트리 저장본) | CLI generate 산출물 저장 · 옛 문서의 용지 변경 |
| `checkpoint({name, document})` | 개체 트리 | `POST /save` · `POST /paper`(개체트리 저장본) | 편집기 저장 전부 |

합치려면 호출부가 전부 개체 트리로 넘어온 뒤여야 하고, 지금은 CLI `generate` 가 아직 manifest 를
만든다. **그래서 합치지 않았다.** 대신 두 경로가 `PAGINATION_STATES` 로 분기하던 판정을
`documentRoutes.isObjectTreeManifest()` 하나로 모아 `/shell.json` 과 `/paper` 가 같은 판정을 쓴다.

**실제로 합친 것 — 같은 입력에 같은 출력을 내던 파생 3종:**

| 새 소재 | 합쳐진 사본 |
|---|---|
| `RenderObjectTree.deriveRenderMeta(document)` | `SaveDocument.checkpoint` · `RenderEditorShell.executeObjectTree` · `editor/reflow.js#buildRenderMeta` (9줄 × 3, 주석에도 "…와 동형 파생"이라 적혀 있었다) |
| `renderAssets.loadRenderAssets(repo, document)` | `SaveDocument.checkpoint` · `RenderEditorShell.executeObjectTree` |
| `renderAssets.loadKnownSubjectHexes(repo)` | `SaveDocument.execute`·`checkpoint` · `RunPipeline` · `EditorHttpServer` · CLI `validate` (5곳) |
| `paper.buildCanvasMeta(paper)` | `RenderEditorShell.execute`·`executeObjectTree` |

`deriveRenderMeta` 를 **`RenderObjectTree.js` 안에** 둔 것이 핵심이다: meta 의 형태는 그 클래스의
계약이고, 이 파일은 browserGraph 화이트리스트 안이라 **편집기(`reflow.js`)가 같은 함수를 그대로**
쓴다. 리플로우 측정(`editMode:true`)과 인쇄(`false`)가 문자 그대로 같은 meta 를 얻어야
**R2-1 편집==인쇄 하드 동치**가 성립한다 — 사본이 셋일 때는 그게 규약이 아니라 우연이었다.
레거시 HTML manifest 지연 마이그레이션(`MigrateManifestToObjectTree`)은 손대지 않았다.

#### 4) 검증

| 항목 | 결과 |
|---|---|
| 단위 | **467/467**, fail 0 (기준선 463 + Phase 5 계약 4건 신규 — **감소 0**) |
| 렌더(직렬 `--test-concurrency=1`) | **91/91**, fail 0 (기준선과 동일) |
| 라우트 동치 | 구 선형 `if` 사슬(HEAD 550줄)과 **A/B 실호출 대조 — 41경로 × 7메서드 = 287조합에서 반례 0**. 접두 일치·세부 불일치 POST(`/ai/*`·`/presets/*`)의 PASS 흘려내림→405, `DELETE /presets`(정확)→405, `GET /presets/foo`→404, `GET /assets`(슬래시 없음)→404, `POST /ai/requests` 의 exact-before-prefix 우선순위까지 동일. 미매칭 12조합은 신규 테스트가 상태코드·Content-Type·본문(`GET only`)으로 영구 고정 |
| 보안 게이트 | `/src`·`/editor` 화이트리스트·경로 이탈, 자산 매직바이트·상한 **A/B 동일**. `/editor/*` 확장자 추출(`abs.slice(abs.lastIndexOf('.'))`)은 HEAD 와 **문자 그대로 같은 술어**라 우회 여지 없음 |
| `applyDocOp` 관문 | `core.setDocument` 호출 지점 **HEAD 5곳 → 신 5곳**, 신규 우회 0. 관문 밖 2곳(넛지·저장 응답 수용)은 HEAD 에서도 관문 밖이었다 |
| 추출 블록 대조 | `injectEditorStyle` CSS 를 HEAD 원본과 기계 대조 — **LF 정규화 후 5,871자 바이트 완전 동일**. 편집 전용 CSS 가 레이아웃 박스를 밀지 않으므로 R2-1 영향 0 |
| 실 Chrome CDP 실입력 | **HEAD 워크트리 vs Phase 5 트리 A/B — 항목별 결과 완전 동일** (아래) |

테스트 기대값은 **한 줄도 고치지 않았다.** 신규 4건(`test/unit/editor-route-table.test.js`)은 구
선형 `if` 사슬이 암묵적으로 갖고 있던 폴백 순서(미처리 non-GET → 405, 미처리 GET → 404),
`/editor/*` 신규 모듈 서빙, 그리고 `readBinaryBody` 상한 누락 거부를 계약으로 고정한 것이다 —
일회성 프로브를 영구 가드로 옮겼다.

> **리팩터링이 삼킨 기본값(리뷰 지적 → 수정).** 구 `EditorHttpServer` 의
> `readBinaryBody(req, cap = MAX_IMAGE_BYTES)` 를 `httpKit` 으로 떼어내며 **기본값이 사라졌다.**
> `cap` 이 `undefined` 면 `size > undefined` 가 항상 false 라 **업로드 상한이 통째로 증발한다.**
> 현재 유일한 호출부(`assetRoutes`)가 상한을 명시하므로 실제 동작은 바뀌지 않았지만, 헬퍼의
> 계약이 조용히 fail-open 으로 약해진 것이라 상한 누락을 **즉시 거부**하도록 되돌리고 테스트로
> 고정했다. "지금은 호출부가 잘 넘기니까 괜찮다"는 종류의 비블로커가 가장 위험하다.
`git diff --stat -- test/` 는 **빈 출력**이고 `test/` 변경은 신규 파일 하나뿐이다.

##### CDP A/B — "동작 무변경"의 직접 증거

한쪽만 돌려서 "통과했다"고 말하면 *무엇과 같은지*를 말하지 못한다. 그래서 `git worktree` 로
**HEAD(`65ef554`, Phase 5 이전)** 를 그대로 꺼내 두고, **같은 스크립트**를 양쪽 트리에 실행해
결과를 항목별로 대조했다(`testSeed:false` — 시드 훅 없이 실제 사용자가 쓰는 편집기 그대로).

통과(양쪽 동일): 부팅(개체 34개 렌더) · 실마우스 클릭 선택 · 검수 칩 갱신 · 실 Ctrl+C/V 개체 +1 ·
실 Ctrl+Z 붙여넣기 원복 · 실 Delete 개체 -1 · 실 Ctrl+S 저장(rev 1→2) · 저장 배너 · 실클릭
미리보기 모달 · 콘솔 에러 0.

미통과 2건도 **양쪽이 개체 수까지 똑같이** 떨어졌다 — 즉 Phase 5 가 만든 것이 아니라 **선행
조건**이다:

1. **삭제 후 `Ctrl+Z` 가 복원하지 않는다**(2회까지 눌러도 33→33). HEAD 에서 동일 재현.
   붙여넣기 undo 는 실입력으로 **100ms 안에** 정상 반영되므로 undo 배선 자체는 살아 있다 —
   삭제 경로에 한정된 선행 이슈이고, Phase 5 는 동작을 바꾸지 않는 단계라 **손대지 않았다.**
2. 위 여파로 삭제된 개체를 다시 겨눈 편집 검증이 `rect 없음`으로 떨어진다(스크립트 종속).

> **순서 함정(기록).** 텍스트 편집도 history 에 한 스텝을 쌓는다. 그래서 "편집 → 붙여넣기 →
> `Ctrl+Z` 한 번"을 검증하면 붙여넣기가 아니라 **편집**이 먼저 되돌아가고 개체 수는 그대로다.
> 이걸 undo 회귀로 오독하기 쉽다 — 개체 undo 는 **앞선 텍스트 편집 없이** 검증하라.

> **CDP 실입력 함정(기록).** `Input.dispatchKeyEvent` 를 `type:'rawKeyDown'` 으로 보내면
> **Ctrl+C/Ctrl+V 가 페이지에 아예 도달하지 않는다**(Chrome 이 기본 클립보드 명령으로 먼저
> 삼킨다 — 캡처 단계 리스너로도 keydown 0건). 같은 방식의 Ctrl+S·Delete 는 정상 도달하므로
> **무결한 코드를 회귀로 오진하기 쉽다.** `type:'keyDown'` 으로 보내면 셋 다 도달한다.
> 실패를 만나면 회귀를 단정하기 전에 "페이지가 무엇을 받았는지"부터 찍어라.
