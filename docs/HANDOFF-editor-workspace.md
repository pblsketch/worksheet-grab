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
