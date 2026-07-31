# ADR — AI 생성 방식: 고정 ops 확장 유지 vs B′(제약 프래그먼트 저작 + `ValidateAiFragment`)

- **상태**: **Accepted(2026-07-31, 사용자 승인)** — 권고대로 검증 계층을 라이브 적용 경로에 배선 완료
  (feat/bspike). 상세는 §13. main 병합만 사용자 승인 대기. (원 결정 태스크 산출물은 §1~§12에 보존.)
- **날짜**: 2026-07-31
- **브랜치**: `feat/bspike` (격리 워크트리 `E:/github/worksheet-grab-bspike`)
- **선행**: `docs/HANDOFF-grab-Bspike.md`(SSOT) · `docs/HANDOFF-grab-M4-M5-Bspike.md` · codex 적대 리뷰(ITERATE, §2·§5~§7)
- **스파이크 산출물**: `src/domain/schema/validateAiFragment.js` · `src/domain/schema/htmlAllowlist.js` ·
  `test/unit/validate-ai-fragment.test.js` · `test/unit/html-allowlist.test.js` ·
  `test/unit/bprime-corpus.test.js` · `test/fixtures/spike-bprime/{corpus.js,run-spike.mjs,spike-metrics.json}`

---

## 1. 맥락 — 무엇을 결정하는가

현재 "AI 생성"은 **고정 ops 어휘**로 표현한다: `replace | insert | delete | insert-section`
(`src/usecases/aiBridge.js:34` `AI_OPS`). 구독 AI 는 대상 개체 ID 를 에코하거나 개체 본문을 실어
보내고, 엔진이 그 ops 를 적용한다. 새로운 콘텐츠 형태가 필요할 때마다 이 어휘를 **확장**해 왔다
(M3a `insert-section` 이 그 예).

B′ 는 그 대안을 **실증**한다: 제약된 AI 에이전트가 **scaffold·flow-only 객체트리 프래그먼트(JSON)**
를 직접 저작 → 신설 **`ValidateAiFragment`**(결정적 검증기)가 게이트 → 엔진이 프래그먼트를 **단일
`insert-section` op 로 컴파일**한다. 산출은 코드가 아니라 이 **결정문**이다:
*"고정 ops 확장을 계속할 것인가, B′ 를 채택할 것인가"* 를 **데이터로** 판정한다.

핵심 질문(HANDOFF §0): **B′ 가 정말 더 개방적이면서 5대 불변식을 지키는가?**

---

## 2. 결정 동인 — 5대 불변식 (코드 강제 vs 정책)

grab 작업 중 실코드로 확인된 정정 사실(HANDOFF §2·codex):

1. **정답 누출 fail-closed = 코드 강제**. `SaveDocument.checkpoint`(:148-158)·`BuildVariants` 학생본
   물리제거·export 재검증. → 학생 PDF 로 정답이 새지 않는다.
2. **"AI 는 HTML·좌표 미생성" = 프롬프트 정책일 뿐(코드 미강제)**. `ObjectCatalog` 는 float/rect/
   HTML/SIZE 를 정상 어휘로 허용하고, `validateObjectShape.js:30` 은 `opacity/angle` 을 전 타입
   통과시킨다. → **B′ 의 `ValidateAiFragment` 가 이걸 구조적으로 강제해야 한다.**
3. **페이지네이션 = 파생물**. `applyAiOps` 는 pagination 무접촉, export 가 항상 재측정.
4. **편집 == 인쇄**(render core 가 HTML 소유), `applyDocOp` 단일 관문.
5. **무의존성**(Node 표준만 — sharp/Playwright/subprocess/jsdom 도입 금지).

불변식 2 가 이 결정의 심장이다: 현재 개방성은 "프롬프트가 새면 무너진다". B′ 는 그 방어를
**프래그먼트 전체 구조로 확장**할 수 있는지 묻는다.

---

## 3. 선택지

### 옵션 A — 고정 ops 확장 유지(현행)
- 장점: 이미 배포·검증됨. 프로토콜 안정. `enforceAiLayout`(M4 방어)·`sanitizeAiObject` 단일 관문 존재.
- 단점: **개방성이 어휘 추가에 종속**된다("문항 3개를 활동으로 묶기" 같은 새 형태마다 op 신설).
  개체 구조 강제는 여전히 **부분적** — `objectFactory.applyAiOps`(:243-279)는 새 ID 만 재발급하고
  **개체 스키마를 검증하지 않아** malformed 개체가 적용될 수 있다(codex). 불변식 2 는 프롬프트·
  `enforceAiLayout`(레이아웃 필드 한정)에만 기댄다.

### 옵션 B′ — 제약 프래그먼트 저작 + `ValidateAiFragment`
- AI 는 **닫힌 카탈로그의 콘텐츠 필드만** 저작한다. 결정적 검증기가 게이트하고, 승인분만 단일
  `insert-section` op 로 컴파일한다. 개방성(AI 가 객체트리를 직접 구성)과 강제(구조적 게이트)를
  **동시에** 얻으려는 시도.

---

## 4. 스파이크 증거 (`spike-metrics.json`)

고정 corpus **42 케이스**(정상 scaffold 5 · 공격 34(11개 클래스) · 정책 3)를 `ValidateAiFragment`
+ 컴파일러에 통과시켜 계측. `node test/fixtures/spike-bprime/run-spike.mjs` → **VERDICT: ALL-GATES-PASS**.

| 지표 | 임계 | 결과 |
|---|---|---|
| 구조 유효율(정상 승인) | 100% | **100%** (5/5) |
| 공격 거부율(전체) | 100% | **100%** (34/34) |
| 임계 클래스 거부 — coordinate / html / answer | 100% | **100% / 100% / 100%** |
| 순서 정확도(컴파일 후) | 100% | **100%** |
| preview==apply 일관(드리프트 0) | 100% | **100%** |
| 컴파일 op → `aiBridge.validateResponse`(v4) | 100% | **100%** |
| 컴파일 개체 → `validateObjectShape` | 100% | **100%** |
| 정책(권한/평문 정합) 정확도 | 100% | **100%** |
| stale 감지(요청시점 pageVersions 대조) | 동작 | **동작(동일=미stale·변경=stale·소실=stale)** |

거부한 11개 공격 클래스: `coordinate`(rect·xMm·placement:float) · `layout`(SIZE·opacity/angle) ·
`page`(pageId·pagination·flow·role) · `identity`(최상위 id) · `answer`(answer:true·answerKey·
answerKey.html) · `html`(script·iframe·on*·style·javascript:·data:·엔티티위장·class=answer·img·
callout.titleHtml) · `type`(std-box·shape·spacer·page-break·미상) · `presentation`(borderColor·
bgColor…) · `image`(image-slot.src) · `enum`(variant·qtype·splittable) · `nested`(중첩 추가필드·
셀 추가필드·미상 필드).

유닛: `validate-ai-fragment.test.js`(거부 매트릭스 34행 + 컴파일/stale/통합) ·
`html-allowlist.test.js`(토큰 검증기) · `bprime-corpus.test.js`(corpus 회귀 가드). **전량 PASS.**

---

## 5. 5대 불변식을 B′ 가 **구조적으로** 지키는 방식

| 불변식 | 옵션 A(현행) | 옵션 B′(구조 강제) |
|---|---|---|
| ① 정답 누출 | SaveDocument/BuildVariants 코드강제(유지) | **동일 + 답안 미생성으로 표면 축소**(§7) |
| ② AI HTML·좌표·조판 미생성 | 프롬프트 정책 + `enforceAiLayout`(레이아웃 필드만) | **`ValidateAiFragment` 가 좌표·SIZE·opacity/angle·page키·HTML 을 프래그먼트 전체에서 거부** |
| ③ 페이지네이션 파생물 | export 재측정(유지) | 동일 — 프래그먼트에 page 키 저작 시 **거부**(`forbidden-page-authoring`) |
| ④ 편집==인쇄 | render core 소유 | 동일 — 승인 HTML == 원문이라 렌더 입력 불변 |
| ⑤ 무의존성 | Node 표준 | **DOMParser 없이 순수 토큰 검증기**로 구현(§6) |

불변식 ② 가 B′ 의 실질 이득이다: 현행은 프롬프트가 새면 `ObjectCatalog`/`validateObjectShape` 가
좌표·HTML·opacity 를 통과시키지만, B′ 는 그 통과 경로를 **결정적으로 닫는다**.

---

## 6. 보안 경계 결정 — HTML 정제 (codex #6)

- **문제**: 현 `src/editor/ai.js#sanitizeAiHtml` 은 (1) 브라우저 `DOMParser` 의존이라 **Node 에서 못
  돌린다**(불변식 ⑤ 상 jsdom 도입 금지), (2) 블랙리스트라 `style·iframe·object·embed·form·srcdoc·
  meta·CSS url()·임의 class/id/data 속성`을 통과시킨다.
- **결정**: B′ 는 **필드별 allowlist 를 토큰 단위로 엄격 승인**한다(`htmlAllowlist.js`, 순수 Node·
  의존성 0). 태그·속성·URL 을 스캐너로 하나씩 훑어 **허용목록 밖 요소를 만나면 조용히 지우지 않고
  프래그먼트 전체 반려**한다. 속성은 `a.href` 만 허용(스킴 `http/https/mailto`, 엔티티·공백 위장
  디코드 후 검사), 그 외 전면 거부.
- **드리프트 제거(codex)**: 승인된 HTML 은 **허용 요소만 남아 원문 그대로**다 → *검증 결과 == 미리보기
  == 실제 적용*이 **구조적으로** 성립한다(적용 직전 재-sanitize 불필요 — 재정제가 없으니 드리프트도
  없다). "정제 후 허용 vs 공격 100% 반려" 문구 충돌은 이렇게 해소된다: **위험요소 존재 = 반려,
  위험요소 없음 = 원문 통과**(스트립 경유가 없다).
- **평문 정합(codex)**: `textHtml↔text`·`promptHtml↔prompt` 는 정제 HTML 의 평문과 병행 평문이
  정규화 일치해야 한다(불일치 시 `plaintext-mismatch` 반려) — 렌더는 HTML·검사기는 평문을 보는
  이중성으로 내용이 어긋나는 것을 막는다.

---

## 7. 답안 결정 — B′ 는 답안을 생성하지 않는다 (codex #7)

결정적 검증기는 "정답은 4이다"가 답인지 설명인지 **의미적으로 모른다**. 누출 검사도
`.answer/.plot-ans` 안의 알려진 정답을 바깥과 비교할 뿐이고 **8자 미만은 검사조차 안 한다**
(`ValidateWorksheet.js:20,97`). 따라서 "미마킹 답안 100% 거부"는 일반적으로 불가능하다.

- **결정**: HANDOFF §3 (a) 채택 — **B′ 에서 답안 생성을 구조적으로 금지**한다. `answer:true` 와
  `answerKey`(및 `answerKey.html`)를 프래그먼트에서 **거부**(`forbidden-answer`). 답안은 B′ 경로
  밖의 별도 경로가 담당한다.
- **효과**: "미마킹 답안 공격 100% 거부"가 **구조적으로 참**이 된다(답안 필드 자체가 프래그먼트에
  존재할 수 없다 — 스파이크 `answer` 클래스 3/3 거부). 자유텍스트 안의 의미론적 미마킹은 여전히
  human/reviewer 영역임을 명시한다.
- **비용**: B′ 로 만든 섹션에는 교사용 정답이 바로 실리지 않는다 → 답안은 이후 별도 op/경로로 붙인다.

---

## 8. 통합 리스크 (채택 시 — codex 함정)

| 리스크 | 현황 | B′ 의 처리 |
|---|---|---|
| `aiBridge` 는 삽입 개체에도 **id 요구**(:136-143) | 프래그먼트는 최상위 id 거부 | **컴파일러가 엔진 id 주입** — 산출 op 는 `validateResponse`(v4) 통과(스파이크 100%) |
| `applyAiOps`(:243-279)는 **개체 스키마 미검증** | validator 안 거친 v4 ops 로도 malformed 개체 적용 가능 | **적용 경로가 B′ 산출만 받도록 배선 필요**(채택 시 별도 방어 — 아래 후속) |
| anchor 없는 `insert-section` 은 문서 말미로 | — | **컴파일러가 anchor(afterId\|beforeId 정확히 하나) 필수화** |
| stale 반려는 구조검증 책임 아님 | — | **컴파일 봉투에 요청시점 `pageVersions` 를 묶어 적용 직전 `isFragmentStale` 비교**(M2 인프라 발상 재사용) |
| preview/apply 드리프트 | 재정제 시 발생 | **재정제 없음 → 드리프트 0**(§6) |

---

## 9. 결정

> **B′ 는 실증에 성공했다**: 제약 프래그먼트 저작 + 결정적 `ValidateAiFragment` 는 **더 개방적이면서
> (AI 가 객체트리를 직접 구성) 5대 불변식을 구조적으로 지킨다**(스파이크 42/42, 전 게이트 통과).
> 특히 불변식 ②(현행의 최대 구멍 — 프롬프트 의존)를 **코드로 닫는다**.

**권고**: **B′ 의 검증 계층(`ValidateAiFragment` + `htmlAllowlist`)을 채택하되, "고정 ops"와
대립시키지 않고 그 위에 얹는다.** 즉 — ops 프로토콜(`insert-section`)은 **전송 계층으로 유지**하고,
그 안으로 들어오는 **AI 저작 개체를 `ValidateAiFragment` 로 게이트**한다. 두 방식은 배타적이지
않다: B′ 는 "새 콘텐츠 형태마다 op 를 늘리는" 대신 **하나의 열린 저작 관문 + 결정적 게이트**를 주고,
op 프로토콜은 그대로 산다.

이유:
- B′ 의 이득(개방성 + 구조 강제)은 **검증기에 있지 프로토콜 교체에 있지 않다**. `insert-section`
  자체는 유지하는 편이 프로토콜 리스크가 0 이다(스파이크가 v4 정합 100% 로 확인).
- 옵션 A 를 "확장 계속"으로만 두면 불변식 ②/`applyAiOps` 미검증 구멍이 남는다 — B′ 검증기는 이
  구멍을 **어휘 추가 없이** 메운다.

---

## 10. 결과 (채택 시)

**긍정**
- 불변식 ② 를 프롬프트가 아니라 **코드로** 강제(좌표·HTML·조판·답안·표현필드·타입 전면 게이트).
- HTML 공격면을 블랙리스트→allowlist 로 축소하고 **Node 에서 결정적으로** 검증(무의존성 유지).
- preview==apply 드리프트 구조적 제거. 답안 미생성으로 누출 표면 축소.

**부정 / 비용**
- 답안이 B′ 섹션에 바로 실리지 않는다(별도 경로 필요 — §7).
- allowlist 는 **의도적으로 좁다**(예: 상대·앵커 링크, `<div>`, `class` 거부). 제품이 실제로 넓은
  HTML 을 요구하면 프로파일을 데이터로 넓혀야 한다.
- 채택 = 배포이므로 **적용 경로 배선**이 필요하다(아래 후속) — 이 ADR 은 그 배선을 하지 않았다.

**후속 작업(채택을 별도 승인할 때)**
1. `objectFactory.applyAiOps` 또는 그 앞단에서 **B′ 산출 op 만 통과**하도록 배선(malformed v4 방어).
2. 컴파일 봉투의 `requestPageVersions` 를 적용 직전 실제 `isFragmentStale` 로 대조하는 지점 연결.
3. designer 프롬프트/SKILL 에 "프래그먼트 저작 어휘"(9종 콘텐츠 필드, id/좌표/조판/답안 제외) 계약 추가.
4. HTML allowlist 프로파일을 실제 제품 지원 태그로 데이터 기반 조정(현재는 안전 최소집합).

---

## 11. 범위 밖(이번에 결정하지 않음)
- 위 후속 배선(적용 경로 통합)은 **하지 않았다** — B′ 는 결정 태스크이지 배포가 아니다.
- M4(callout)·M5(열화 계약)는 이미 main 에 있다(재구축 금지). 이 ADR 은 그 위에서 B′ 만 다룬다.
- 답안 생성의 "별도 경로" 설계는 본 결정 밖(답안은 기존 answerKey/answer 개체 경로 유지).

---

## 12. 재현
```
# 격리 워크트리에서
node test/fixtures/spike-bprime/run-spike.mjs          # 계측 → spike-metrics.json (ALL-GATES-PASS)
node --test test/unit/validate-ai-fragment.test.js \
            test/unit/html-allowlist.test.js \
            test/unit/bprime-corpus.test.js \
            test/unit/apply-ai-fragment.test.js       # 유닛 (거부 매트릭스·토큰검증·corpus·배선 e2e)
```

---

## 13. 배선 완료 (2026-07-31 — 채택 후 구현)

권고(§9)대로 **검증 계층을 라이브 적용 경로에 배선**했다. "고정 ops"를 교체하지 않고, insert-section
을 전송 계층으로 유지한 채 그 안으로 들어오는 **B′ 프래그먼트 저작을 게이트**한다. B′ 답안 미생성
결정(§7)과 기존 answerKey 저작이 충돌하므로, B′ 는 기존 경로를 **대체하지 않고 별도 저작 모드로
병존**한다(계층형).

**추가/변경 파일**
- `src/usecases/applyAiFragment.js`(신설) — `prepareAiFragment`: validateAiFragment(결정 게이트) →
  compileFragmentToInsertSection(엔진 id·placement:'flow'·anchor 필수·pageVersions 바인딩) →
  **validateObjectShape 구조 floor**(§10.1 malformed 방어). 산출은 단일 insert-section op. 순수·
  Node 테스트 가능(objectFactory 미import — 적용은 호출부).
- `src/usecases/aiBridge.js` — `validateResponse` 가 프래그먼트 봉투 `{schemaVersion,id,fragment:[…],
  afterId?|beforeId?}` 수용(+`isFragmentResponse`). 전송 계층 형태만 검사(개체 결정 검증은 적용 경로).
- `src/editor/ai.js` — `applyResponseAsVersion` 에 `response.fragment` **가산 분기**(기존 ops/echo 경로
  무영향). `buildFragmentVersion` 이 prepareAiFragment 로 검증·컴파일 후 컴파일 op 를 **기존
  `buildOpsVersion` 에 그대로 흘려보내** 미리보기·앵커·범위·충돌·단일 undo 파이프라인을 통째로 재사용.
  실패 시 blockReason 을 보이는 blocked 버전(조용한 실패 금지).
- `src/cli/index.js` — `ai respond <id> --fragment <file.json> [--after|--before <id>]`(전송) + 도움말.
- `.claude/skills/worksheet-grab/SKILL.md`·`.claude/agents/worksheet-designer.md` — B′ 프래그먼트
  저작 어휘/금지 규칙 계약 문서화.

**검증**
- 유닛 `test/unit/apply-ai-fragment.test.js`(신설, 10 케이스): prepareAiFragment 승인/좌표·답안·HTML
  반려/anchor 필수/구조 floor + **prepareAiFragment→applyAiOps 실제 문서 적용 e2e**(anchor 뒤 순서
  삽입·placement:flow·원본 불변) + aiBridge 프래그먼트 봉투.
- 전체 유닛 **870 pass / 0 fail**(회귀 0). 렌더 `editor-ai.render.test.js` 무회귀(ai.js 가 신 모듈을
  정상 로드·기존 경로 불변 — 새 분기는 fragment 응답에서만 트리거).

**§10 후속 반영**: #1(applyAiOps 앞단 구조 게이트) = prepareAiFragment 의 shape floor 로 충족.
#2(stale 바인딩) = 컴파일 봉투의 requestPageVersions 를 buildOpsVersion 의 pageVersions/detectConflict
경로가 소비. #3(designer 계약) = 완료. #4(HTML allowlist 프로파일 확장) = 안전 최소집합 유지(제품 요구
확인 시 데이터 기반 확장 — 후속).

**미배선(의도적 범위 밖)**: 렌더 하네스에 fragment 전용 seed 시나리오 추가는 하지 않았다(기존
insert-section 파이프라인 재사용이라 순수 유닛 e2e 로 대체 검증). 브라우저 UI 에 "새 섹션 저작" 전용
진입 버튼은 별도 UX 과제.
