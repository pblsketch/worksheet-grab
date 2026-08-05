# P0-2 · worksheet-grab 렌더 베이스라인 + 무회귀 게이트 설계

- 대상 저장소: `E:/github/worksheet-grab` (읽기 전용 — 소스 미수정, git 미조작)
- 착수 전 `git status --porcelain`: `?? docs/HANDOFF-cross-provider-agents-md.md` (untracked, 내 대상 아님·M 아님) → 중단 사유 없음, 진행.
- Node: v24.15.0. Chrome 발견: `C:/Program Files/Google/Chrome/Application/chrome.exe` → 렌더 스위트 스킵되지 않음.

---

## 1. 테스트 인프라 파악

### 1.1 스크립트 (package.json)

| 스크립트 | 명령 | 비고 |
|---|---|---|
| `npm test` | `node --test "test/**/*.test.js"` | unit+render 전체, 동시성 기본값(위험 — 렌더는 Chrome 동시 1개 전제) |
| `npm run test:unit` | `node --test "test/unit/**/*.test.js"` | 932건, 순수 JS, Chrome 불필요, 병렬 가능 |
| `npm run test:render` | `node --test --test-concurrency=1 "test/render/**/*.test.js"` | Chrome CDP/헤드리스 구동, **직렬 필수**(MEMORY 주석: "렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개") |

의존성 0개(devDependencies 없음) — node:test/node:assert만 사용, 스냅샷 라이브러리 없음. 모든 "골든" 비교는 직접 짠 파서/비교 함수로 이루어진다.

### 1.2 디렉터리 구조

```
test/
  unit/     102개 파일, 932 tests — 순수 함수·유스케이스·CLI·CSS 정적 구조 검증
  render/   35개 파일, ~138 tests(test( 호출 개수 기준 추정) — Chrome 실렌더(PDF/PNG) 검증
  helpers/  cdp.js · fidelity.js · renderParity.js · pdf.js · tmp.js — 렌더 테스트 공용 유틸
  fixtures/ clean-student.html·leak-student.html(정적 안전 게이트용 소형 fixture) · spike-bprime/
```

### 1.3 렌더가 HTML/PDF를 만드는 경로 (골든 설계의 전제)

```
FsBlockRepository.readAsset('blocks.css')  → 파일 내용 그대로(가공 없음) 문자열
                                            ↓
RenderObjectTree.execute(document, {paperCss, blocksCss, themeCss}, meta, opts)
   → buildDocumentHtml() 이 blocksCss 를 <style> 블록에 **그대로(raw) 삽입**
   → 완전한 A4 HTML 문자열 반환 (`src/usecases/RenderObjectTree.js:117-129`)
                                            ↓
ChromeRenderer(RenderPdf / RenderImage) → 실 Chrome --headless print-to-pdf / --screenshot
   → PDF(MediaBox·페이지수) / PNG(IHDR 치수)
```

**결정적(pure) 렌더 코어**: `RenderObjectTree`는 FS/Chrome/DOM을 모르는 순수 함수 — 같은 입력이면 항상 같은 HTML 문자열(주석에 명시: "Date.now/Math.random/전역 상태 참조 없음"). `blocksCss`는 가공 없이 그대로 `<style>`에 박히므로, **blocks.css 파일의 바이트가 그대로 최종 HTML의 `<style>` 내용이 된다.**

이 사실이 게이트 설계의 핵심 제약이다(§3 참조): P1이 `리터럴` → `var(--token, 리터럴)`로 텍스트를 바꾸면, **HTML `<style>` 텍스트 자체는 반드시 바뀐다** — 그러므로 "렌더 HTML 전체를 문자열로 골든 고정 후 diff=0" 전략은 P1 자체에서 항상 실패해 무용하다. 골든은 **소스 텍스트가 아니라 브라우저가 계산한 값(computed style)과 인쇄 결과(페이지수·치수·픽셀)**를 기준으로 잡아야 한다.

### 1.4 기존 "폴백-주입 등가성" 계약 테스트 — 직접적 선례

`test/unit/paper-fallback-equivalence.test.js` (paper.css 전용, blocks.css 아님)가 정확히 이 문제의 축소판을 이미 풀어 놓았다:

- `assets/paper.css`에서 정규식(`/var\(\s*(--sheet-[\w-]+)\s*,\s*([^)]+)\)/g`)으로 **폴백 리터럴**을 파싱.
- `paperCss(resolvePaper({size:'A4'}))`(JS 함수가 주입하는 `:root{--sheet-w:...}` 값)와 **변수별 정확 일치**를 단정.
- 각주가 게이트 이유를 명시: "paper.css 의 var() 폴백 리터럴(현행 A4 인쇄틀)과 paperCss()가 주입하는 값이 갈라지면 … 조용한 리플로우가 생긴다."

blocks.css에는 이미 이 패턴이 **부분 적용**되어 있다(P1 전에도 존재):
```css
.passage { border: var(--wg-ps-bw, 1.5px) solid var(--wg-ps-border, #bbb); ...
  background: var(--wg-ps-bg, #fcfcfa); }
.obj-table th, .obj-table td { border: var(--wg-tb-width, 1px) solid var(--wg-tb-color, #cbd5c0); ... }
.wg-shape > * { fill: var(--wg-fill, none); stroke: var(--wg-stroke, #333); stroke-width: var(--wg-sw, 1.6); ... }
.wg-text { font-size: var(--wg-fs, 11pt); color: var(--wg-color, #333333); text-align: var(--wg-align, left); ... }
```
**중요한 차이(발견 — P0-1과 공유 필요)**: 이 기존 `--wg-*` 토큰들은 정적 기본값이 아니라 **개체별 런타임 오버라이드 훅**이다. `RenderObjectTree.js`(307-313, 471-473, 548-569행)가 문서 개체의 `borderColor`/`borderWidth`/`strokeColor`/`fontSize` 등을 인라인 `style="--wg-ps-border:...;"`로 방출해 값이 실제로 바뀌게 만든다(그래서 폴백이 안 쓰이는 문서가 훨씬 많다 — 개체가 필드를 지정하면 폴백을 덮어쓰는 게 **의도된 동작**). P1이 새로 추가할 토큰(범교과 고정 여백/반경/무채색 등)은 이것과 성격이 다르다 — **아무도 값을 세팅하지 않아 항상 폴백으로 떨어져야** "바이트 무회귀"가 성립한다. 따라서:
- P1 신규 토큰명은 기존 `--wg-ps-*` / `--wg-tb-*` / `--wg-fill,--wg-stroke,--wg-sw,--wg-dash` / `--wg-fs,--wg-color,--wg-align` / `--wg-left,--wg-right,--wg-grid-alpha`(editor.css)와 충돌 금지.
- 게이트는 "새 토큰이 `:root`(themes/*.css)에도, `RenderObjectTree.js`가 방출하는 인라인 오버라이드 목록에도 없다"를 확인해야 한다(§3 T1).

---

## 2. 현행 베이스라인

### 2.1 Unit (`node --test "test/unit/**/*.test.js"`) — 완료

```
tests 932
pass  932
fail  0
cancelled 0 / skipped 0 / todo 0
duration_ms 17421.8
```
**그린 932/932.** `test/unit/paper-fallback-equivalence.test.js`(3 tests) 포함 전부 통과. `test/unit/theme-purity.test.js`도 통과 — 정적 CSS 구조 검사(정규식 기반 규칙/선언 파서)가 이 저장소의 확립된 관용구임을 재확인(§3 T1 설계의 직접 근거).

### 2.2 Render (`node --test --test-concurrency=1 "test/render/**/*.test.js"`) — 백그라운드 실행, 부분 결과

35개 파일 · `test(` 호출 개수 기준 약 138건 추정. Chrome 스폰 오버헤드 때문에 건당 1~6초, 전체 완주까지 장시간(30분 근접) 소요 — 이 문서 제출 시점 기준 부분 결과(관측 ~115줄, engine/editor/organizers/export/paper/E0/E6/B1/B3/B4/US-19/US-P4 계열 다수 통과). 완주 로그는 `/tmp/wsg-render-baseline.log`(이 세션 한정 임시 경로, 저장소 밖)에 계속 누적 중이다.

**관측된 레드 1건(P1/blocks.css와 무관 — 기존 상태 그대로 기록)**:
```
✖ 시각 조직자 삽입(#2 P1a): "시각 조직자" 그리드 버튼 → 미리 채운 table 개체 삽입·렌더·저장 왕복 (2299.8507ms)
```
- 위치: `test/render/editor-objects.render.test.js:173`.
- 이 실행에서 소스 파일을 전혀 건드리지 않았으므로(가드레일 준수) 이 실패는 **이 저장소의 기존 상태**다 — 내가 유발한 회귀가 아니다. 상세 스택은 node spec reporter가 전체 실행 종료 시 요약에 모아 출력하는 방식이라 완주 전에는 확보되지 않았다(부분 결과의 한계).
- 이 테스트는 조직자(organizer) 삽입 UX(실 CDP 마우스/클릭 흐름)를 검증하는 것으로, blocks.css 토큰화(P1) 범위와 무관해 보인다 — 다만 P1 착수 전 팀 리드가 별도로(이 태스크 범위 밖) 원인을 확인해, "P1이 만든 신규 레드"와 "기존 레드"가 섞이지 않게 해야 한다. §3.6의 실행 순서 요약에서 L2 판정 시 **이 1건은 P1과 무관한 기지(known) 실패로 격리**하고, 그 외 137건 그린 유지가 L2 통과 기준이라고 명시해 둔다.
- 나머지 관측 범위(114건)는 전부 그린 — 이 1건을 제외하면 실패 0건.

**설계에 필요한 결론은 이미 확정**: render 스위트 안에 blocks.css 영향 범위를 실제로 게이팅하는 기존 테스트가 이미 존재한다 —
- `test/render/acceptance.render.test.js` — ko 4쪽/sci 3쪽(재페이지네이션 실측 페이지수), std-box/표 컴포넌트 존재.
- `test/render/paper.render.test.js` — PDF MediaBox pt 치수(A4/A3/B4), PNG IHDR 폭·높이(`paperToPx`와 실측 일치).
- `test/render/workbook.render.test.js` — 합본 페이지수·MediaBox·연속쪽번호.
- `test/render/editor-print-parity.render.test.js` + `test/helpers/renderParity.js` — 편집 렌더 vs 인쇄 렌더의 인라인 `style=` 선언 목록이 문서 순서까지 완전히 일치해야 함(R2-1).

이들은 blocks.css의 padding/margin/border/line-height 리터럴이 바뀌면(값이 실제로 달라지면) 페이지수나 MediaBox나 style 목록이 흔들려 **이미 레드로 떨어지는 구조**다. P1은 이 기존 스위트를 그대로 통과시키는 것이 1차 방어선이며, §3에서 이를 "L2(기존 인쇄-진실 계약)"로 명명해 게이트에 편입한다.

---

## 3. 무회귀 게이트 설계

### 3.1 원칙 — 저장소가 이미 선언한 철학을 따른다

`test/render/paper.render.test.js` 17행: *"인쇄가 진실의 원천 — 정적 CSS 검사로 대체하지 않는다."* 이 문장이 게이트 설계의 최우선 제약이다. 따라서 **정적 텍스트 비교만으로 P1을 승인하지 않는다** — 정적 비교는 빠른 1차 스모크로만 쓰고, 최종 판정은 실 Chrome 인쇄 결과로 내린다. 4개 층(L0~L3)으로 나눈다.

### 3.2 L0 — 정적 구조적 등가성 (신규, Chrome 불필요, 초 단위)

**파일**: `test/unit/blocks-token-equivalence.test.js` (신규, `paper-fallback-equivalence.test.js`와 자매 파일)

**사전 준비(P1 착수 전, 지금 캡처)**: 현재 `assets/blocks.css`를 규칙 단위로 파싱해(`theme-purity.test.js`의 `parseCssBlocks` 스타일 재사용 — 주석 제거 → `selector { body }` 정규식 추출 → `body`를 `;` 분해해 `{prop, value}` 목록화) `test/fixtures/golden/blocks-css-baseline.json`에 **(selector, propertyIndex) → 정규화된 값 리터럴** 맵으로 고정한다. 값 정규화는 공백만 접기(`\s+`→단일 스페이스, trim) — 세미콜론 순서·개행은 서식이라 무시.

**어서션(P1 착수 후)**:
1. **선언 카운트 불변**: baseline과 after의 (selector, propertyIndex) 키 집합이 완전히 같아야 한다(추가/삭제 금지 — 순수 리터럴→var() 치환만 허용, 신규 규칙·삭제 규칙은 이 테스트 범위 밖이므로 실패시켜 사람이 검토).
2. **값은 둘 중 하나만 허용**:
   - (a) `after === before`(치환 대상이 아니었던 선언 — 완전 동일 텍스트), 또는
   - (b) `after`가 정규식 `^var\(\s*(--[\w-]+)\s*,\s*(.+)\)$`(또는 단축 속성처럼 여러 var()가 섞인 복합값이면 `var(--X, LITERAL)` 부분 매치들)에 매치하고, 그 안의 `LITERAL`이 공백 정규화 후 `before`와 **완전 일치**.
   그 외(값이 달라졌거나 var() 폴백이 원래 리터럴과 다르면) 실패 — 실패 메시지에 selector·속성·before/after 값을 모두 출력(디버그 가능하게, `paper-fallback-equivalence.test.js`의 어서션 메시지 스타일 준수).
3. **토큰 이름 충돌 금지**: 새로 등장한 모든 `--*` 토큰명을 수집해, (i) `themes/*.css`의 `:root` 6종(`THEME_TOKENS` — `--c/--c2/--clite/--cstrip/--clabel/--cink`)과 겹치지 않고, (ii) 기존 인라인 오버라이드 계열(`--wg-ps-*`, `--wg-tb-*`, `--wg-fill`, `--wg-stroke`, `--wg-sw`, `--wg-dash`, `--wg-fs`, `--wg-color`, `--wg-align`)과도 겹치지 않는지 확인(§1.4 발견 사항 반영). 겹치면 실패 — "이미 런타임에 값이 세팅되는 토큰이라 폴백 무회귀 가정이 깨진다"는 이유를 메시지에 명시.
4. **단일 소스 재확인**: 새 토큰이 `assets/paper.css`·`themes/*.css`의 어느 `:root`/선택자 블록에도 `--token: 값;` 형태로 정의돼 있지 않아야 한다(정의돼 있으면 폴백이 아니라 그 값이 항상 이긴다 — "바이트 무회귀"가 우연이 아니라 구조적으로 보장돼야 하므로).

**"변이 실험을 자동 회귀 테스트로 승격"(핵심 설계 결정)**: 실제 파일을 일부러 망가뜨렸다가 되돌리는 수작업 대신, **비교 함수 자체를 조작(sabotage) 합성 입력으로 영구 테스트한다** — `paper-fallback-equivalence.test.js`류가 실제 파일만 검사하는 것과 달리, 이 파일에는 추가로:
```js
test('회귀탐지 자기검증: 폴백 리터럴을 원본과 다르게 바꾸면 비교기가 반드시 실패를 던진다', () => {
  const before = parseDecls('.x { padding: 8px; }');           // 합성 최소 CSS, 실파일 아님
  const mutatedWrong = parseDecls('.x { padding: var(--wg-tok-x, 9px); }'); // 리터럴 9px ≠ 8px(고의 오염)
  assert.throws(() => assertTokenEquivalence(before, mutatedWrong), /LITERAL.*불일치|폴백.*다름/);
  const mutatedRight = parseDecls('.x { padding: var(--wg-tok-x, 8px); }'); // 정상 치환
  assert.doesNotThrow(() => assertTokenEquivalence(before, mutatedRight));
});
```
이렇게 하면 "게이트가 실제로 민감한가"를 **매 실행마다** 증명한다(트리거 파일을 실제로 훼손했다가 복구하는 1회성 수작업에 의존하지 않음 — 실행할 때마다 회귀탐지력을 계속 재확인). 이 자기검증 유닛이 바로 요청된 "변이 실험"을 CI-안전한 상시 테스트로 번역한 것이다.

**보완(수동 러너 절차, 1회 실증용)**: 자동화된 자기검증과 별개로, P1 PR이 올라오면 팀 리드가 1회 다음을 실행해 "진짜 파일"에서도 게이트가 작동함을 눈으로 확인한다(문서화된 런북, 코드에 남기지 않음):
```bash
# 치환된 선언 하나 골라 폴백 리터럴만 한 글자 틀리게 임시 수정 후
node --test test/unit/blocks-token-equivalence.test.js   # → 반드시 레드
git checkout -- assets/blocks.css                        # 원복
node --test test/unit/blocks-token-equivalence.test.js   # → 다시 그린
```

### 3.3 L1 — 실 Chrome computed-style 골든 (신규, Chrome 필요)

L0은 "소스 텍스트가 규칙을 지켰는가"만 본다 — CSS 파서 버그·단축 속성 파싱 실수·브라우저별 var() 해석 차이는 못 잡는다. **원칙(§3.1)을 지키려면 브라우저가 실제로 계산한 값**을 봐야 한다.

**파일**: `test/render/blocks-token-computed.render.test.js` (신규)

**방법**:
1. P0-1 인벤토리에서 나올 (selector, property) 목록 — 지금 시점 후보 카테고리(직접 카운트, §1.3 근거): hex 색상(예 `#cbd5c0`(다회 반복)·`#f6f6f6`·`#1a5fb4`·`#f0a500`·`#888` 등)과 길이 리터럴(`1px`(47회)·`8px`(41회)·`9.5pt`(32회)·`4px`(31회)·`3mm`(18회) 등, `assets/blocks.css` 전수 스캔 결과) — 대표로 `.pill`(padding/border-radius/font-size), `.title-box`(border/border-radius/padding), `.std-box .std-head`(padding/font-size), `.callout-warning .callout-head` / `.callout-summary .callout-head`(4변형 배경·글자색), `.dash-box`(border-style dashed 두께), `.lv-table td.label`(padding), `.obj-table th,td`(border — 이미 var() 부분 적용, §1.4 사례와 회귀 방지 동시 확인), `.q-box`(border-radius), `.rubric td.stars`(color `#f0a500`), 조직자 표 계열(`.kwl th`/`.frayer td.fq`/`.bme td` 등 height) 정도를 최소 대표군으로 삼는다. **정확한 최종 목록은 P0-1 산출물(하드코딩 인벤토리)을 그대로 흡수** — 이 문서는 그 목록을 꽂아 넣을 수 있는 골격만 고정한다.
2. 대표 문서: `manifests/ko.json`(국어, passage/callout/std-box 밀집) · `manifests/sci.json`(과학, table/formula/plot 밀집) · social/english 테마 확인용 소형 매니페스트 1종(현재 `manifests/`에는 ko/sci만 있음 — social/english 커버는 `themes/social.css`·`themes/english.css`를 `assets`에 대신 주입해 **같은 blocks.css**를 다른 테마로 렌더하는 합성 케이스로 충분, `test/unit/vocabulary.test.js`의 "범교과 재사용: 코어 exemplar가 ≥2 교과 테마에서 렌더된다" 패턴 재사용) · 조직자/표/영어 대화문 등 blocks.css 후반부(260~480행) 커버용 합성 문서 1종(신규, organizers.render.test.js가 쓰는 소형 개체 트리 헬퍼 재사용 가능한지 우선 확인 후 없으면 최소 fixture 작성).
3. `RenderObjectTree.execute(document, assets, meta, {editMode:false})`로 HTML 생성 → tmp 파일 저장 → `test/helpers/cdp.js`의 `openCdpSession(fileUrl)`로 실 Chrome 로드 → `evaluate()`로 각 (selector, property)에 대해 `getComputedStyle(document.querySelector(sel))[prop]` 수집(색상은 브라우저가 `rgb(...)`로 정규화해 반환 — hex 표기 차이를 흡수하는 부수 효과도 있음).
4. **골든 캡처(지금, P1 착수 전)**: 위 절차로 얻은 JSON을 `test/fixtures/golden/blocks-computed-style-baseline.json`에 저장.
5. **P1 이후 어서션**: 같은 절차로 재수집한 값이 골든과 **정확히 일치**(색상 문자열·px 계산값 모두 등호 비교 — 허용오차 없음. paper.render.test.js의 pt 오차(±3)는 "measured layout"용이고, 여기는 정적 CSS 리터럴이라 오차가 있으면 그 자체가 회귀).

이 계층이 "값이 진짜로 안 바뀌었다"를 브라우저 기준으로 못박는 핵심 게이트다.

### 3.4 L2 — 기존 인쇄-진실 계약 (신규 아님, 통과 유지가 게이트)

P1 PR은 §2.2에 나열한 기존 render 스위트(acceptance/paper/workbook/editor-print-parity 등, ~138 tests)를 **추가 수정 없이 그대로 통과**해야 한다. 이들은 blocks.css의 box-model 리터럴(padding/margin/border-width/line-height)이 실제로 달라지면 페이지수·MediaBox·style-parity가 흔들리도록 이미 짜여 있다 — "인쇄가 진실의 원천" 원칙의 실물 구현체이므로 새로 만들 필요 없이 **베이스라인 대비 재실행 결과가 100% 동일(그린 수·페이지수·치수 전부)**한지만 재확인한다. §2.2의 부분 그린 결과(기지 실패 1건 격리, `editor-objects.render.test.js:173` — P1과 무관)가 이 문서의 재실행 대조 기준선이 된다. P1 PR 판정 시 이 1건이 여전히 같은 이유로 레드면 "기존 상태 유지"로 통과, 반대로 **그린으로 바뀌거나 다른 실패로 성격이 변하면** 오히려 조사 대상이다(우연이 아니라 뭔가 실제로 건드렸다는 신호).

### 3.5 L3 — PNG 픽셀 바이트 골든 (선택, 환경 민감도 명시)

"바이트 무회귀"를 가장 문자 그대로 만족하는 계층이지만 **이식성 위험**이 있어 선택 사항으로 둔다:
- `RenderImage`(`test/render/paper.render.test.js` E0 수용 #4 패턴 — IHDR 폭/높이를 `paperToPx`와 대조하는 기존 코드 재사용)로 대표 페이지(표지/callout 밀집 1쪽, 표·조직자 밀집 1쪽) PNG 렌더 → 파일 SHA-256 해시를 골든으로 고정.
- **위험**: 폰트 렌더링(서브픽셀 안티앨리어싱)이 Chrome 버전·OS 폰트 캐시에 따라 같은 CSS에도 다른 픽셀을 낼 수 있어, 다른 머신/Chrome 업데이트 후 재현 안 되는 거짓 레드 가능성이 있다(같은 로직으로 `test/render/paper.render.test.js`가 PDF는 pt 좌표만 보고 PNG는 IHDR "치수"만 보지 픽셀 해시는 안 쓰는 이유로 추정). 따라서 **L3는 CI 하드 게이트로 승격하지 않고**, 로컬(동일 개발 머신)에서 P1 작업자가 "육안 확인 대체용"으로 1회 돌리는 선택 스크립트(`test/fixtures/golden/`가 아닌 별도 `tools/` 또는 문서화된 수동 절차)로 둔다. 팀 리드가 강하게 원하면 승격 가능하나, 이 설계 문서는 L0~L2를 필수 게이트로 권고한다.

### 3.6 실행 순서 요약 (P1 PR 검증 절차)

```
1. npm run test:unit         (L0 포함, 932+α, 초 단위)
2. npm run test:render       (L1 신규 포함 + L2 기존 전체, --test-concurrency=1 필수, 장시간)
3. (선택) L3 로컬 PNG 해시 대조
```
셋 다 그린이어야 P1 머지 승인. L0 레드 → 값 자체가 달라졌거나 토큰이 충돌(가장 흔한 실수, 수정 빠름). L1 레드 → 브라우저 계산값이 골든과 다름(파싱/단축속성 실수 의심). L2 레드 → 페이지수/치수/파리티가 흔들림(레이아웃에 실질적 영향 — 가장 심각, 즉시 롤백 검토).

---

## 4. 신규/확장 파일 목록 (구현 시 P1 담당자가 만들 것 — 이 문서는 설계만)

| 파일 | 신규/확장 | 내용 |
|---|---|---|
| `test/unit/blocks-token-equivalence.test.js` | 신규 | L0 — 정적 등가성 + 토큰 충돌 검사 + 자기검증(합성 사보타주) |
| `test/fixtures/golden/blocks-css-baseline.json` | 신규(지금 캡처) | L0 골든 — (selector, propIdx)→정규화 리터럴 |
| `test/render/blocks-token-computed.render.test.js` | 신규 | L1 — CDP getComputedStyle 골든 대조 |
| `test/fixtures/golden/blocks-computed-style-baseline.json` | 신규(지금 캡처) | L1 골든 — (doc, selector, prop)→computed 값 |
| 기존 35개 `test/render/*.render.test.js` | 확장 없음(그대로 재실행) | L2 — 통과 유지가 게이트 |

---

## 요약 (팀 리드 보고용)

1. **파일**: `C:/Users/wnsdl/.cokacdir/workspace/xr9oi751/wsdemo/design-tokens/02-baseline-and-regression-gate.md`
2. **베이스라인**: unit **932/932 그린**(17.4s, fail 0) — 확정. render는 `--test-concurrency=1`로 백그라운드 실행 중(Chrome 실렌더라 장시간, 전체 ~138건 완주 진행 중 — 부분 결과) — 관측 범위 ~115건 중 **114건 그린 · 1건 레드**(`editor-objects.render.test.js:173` "시각 조직자 삽입(#2 P1a)" — 이 세션에서 소스를 전혀 안 건드렸으므로 P1과 무관한 기존 상태, §2.2에 상세 기록 및 격리 처리).
3. **무회귀 게이트 한 줄 요지**: "소스 텍스트 diff는 P1 자체에서 항상 바뀌므로 무용 — 정적 등가성(L0: 리터럴↔var(token,리터럴) 1:1 대응 + 토큰 미정의 확인, 자기검증 포함)으로 빠르게 걸러내고, 최종 판정은 저장소 철학("인쇄가 진실의 원천")대로 실 Chrome computed-style 골든(L1, 신규)과 기존 페이지수/MediaBox/편집=인쇄 파리티 스위트(L2, 그대로 재사용) 전원 그린으로 내린다."
