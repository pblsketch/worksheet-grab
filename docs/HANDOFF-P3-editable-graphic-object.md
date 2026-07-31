# HANDOFF — P3: 에디터에서 편집 가능한 그림 개체 (선택 스파이크)

> **작성 2026-07-31.** 새 세션이 이 문서를 **SSOT**로 읽고, 코드 변경 전에 `/ralplan`으로 계획부터 잡는다.
> P3 는 계획서(`docs/PLAN-graphic-organizers.md` §136·§183)가 뒤로 뺀 **선택 스파이크 · 데이터 기반 go/no-go**다.
> 산출물은 배포 코드가 아니라 **작동 프로토타입 + 권고안(ADR)**이 1차 목표다.

---

## 0. 지금까지 완료된 것 (이 스파이크의 출발선)

핸드오프 후속 작업 #4·#2 는 **전부 완료·main 병합**됨:

| 작업 | 내용 | 상태 |
|---|---|---|
| #4 | 정답 있는 조직자 5종에 교사용 예시(`.answer`) — 학생 빌드 물리 제거(fail-closed) | ✅ |
| #2 P1a | 표형 조직자 10종 클릭 삽입(편집 가능 `table` 개체) + 디테일 개선(등폭·병합 개념·필기 높이) | ✅ |
| #2 P2 | 그림형 6종 잠금 삽입(richtext 인라인 SVG, OrganizerGen 단일 출처) | ✅ |
| #2 P2b | 특수 레이아웃 7종 잠금 삽입(richtext 블록 HTML, 블록↔번들 parity) | ✅ |
| #2 P1b | 마이그레이션 대칭 — compose 조직자 활동지를 열면 표형은 편집 가능 `table` 로 승격 | ✅ |

- **편집기 삽입 가능 조직자: 23/23종.** 표형은 편집 가능한 `table`, **그림형·특수형은 잠금 richtext**(이동·삭제 가능, 내부 편집 불가).
- 이번 세션 산출: 셀 `h`/`align` 렌더 지원(RenderObjectTree), `parseTableRows` export, `ORGANIZER_INSERTS`/`GRAPHIC_ORGANIZER_INSERTS`/`SPECIAL_ORGANIZER_INSERTS`(objectFactory), `TABLE_ORGANIZER_TYPES`(MigrateManifestToObjectTree).
- **모든 불변식 유지**: 개체 스키마 무변경 · 무API(단일 출처) · 정답 fail-closed · 편집=인쇄 실물 Chrome 검증 · 성취기준 조회전용.

---

## 1. P3 가 무엇인가 (그리고 무엇이 아닌가)

**목표**: 그림형 조직자(벤다이어그램·개념지도·피시본·순서흐름도·위계트리·헥사고날)를 **에디터 안에서 편집 가능한 개체**로 만든다.
- **지금(P2)**: 그림형은 잠금 richtext — 넣고/옮기고/지우기만 됨. 원 개수·노드 라벨을 편집기에서 못 고침.
- **P3 후**: 인스펙터에서 "원 개수 2↔3", "노드 라벨 수정" 같은 **구조 편집**.

**P3 가 아닌 것 (혼동 주의)**:
- ❌ **B′ 스파이크(bspike)** 와 무관하다. B′ 는 "AI 저작을 고정 ops 확장 vs 제약 에이전트 프래그먼트로 갈지" 결정하는 별개 태스크(`ValidateAiFragment`·`htmlAllowlist`). P3(그림 편집)와 목적·파일이 다르다. (이전 세션이 "bspike=P3" 라 한 것은 오기 — 정정함.)
- ❌ 표형 조직자는 대상 아님(이미 편집 가능 `table`).

---

## 2. 진짜 어려운 이유 (crux) — 여기서 대부분의 위험이 나온다

1. **편집기는 "닫힌 개체 카탈로그"** (title·question·table·image-slot·answer-area·divider·shape·richtext·std-box·callout·spacer·page-break). **"개수 조절 가능한 다이어그램"을 표현하는 타입이 없다.**
2. **generic `shape` 로는 안 된다** — 계획서 §74: `renderShape` 는 `viewBox 0 0 100 100 preserveAspectRatio="none"` 로 **왜곡**(원→타원). 그림형은 **엔진 소유 고정비율 SVG 뼈대 + 이름 붙은 텍스트 슬롯**이어야 한다(§75). AI/교사는 **슬롯 텍스트·개수만** 지정, 좌표·도형은 못 만진다(원칙 3).
3. 결국 **새 개체 타입**이 필요 → 이번 #2 내내 지킨 **"개체 스키마 무변경" 불변식을 의도적으로 여는 일**. 그래서 계획서가 "선택 스파이크 · go/no-go"로 분리했다(§136·§178 "새 개체 타입 없음").
   - **→ 스키마를 여는 결정이므로 착수 전 사용자 승인이 필수.**

---

## 3. 결정적 유리함 — callout 선례가 이미 길을 냈다

**grab-ext(M4)가 "강조상자(callout)"로 새 편집 가능 개체 타입을 이미 풀 스택으로 추가**했다(main 병합됨). P3 는 이 패턴을 **그대로 본뜨면** 위험이 크게 준다. 미러링 대상 파일:

| 층 | 파일 | callout 참고 지점 |
|---|---|---|
| 스키마 | `schema/worksheet-object.schema.json` | `type:"callout"` 개체 정의(variant/body) |
| 카탈로그·검증 | `src/domain/schema/ObjectCatalog.js`, `validateObjectShape.js` | 카탈로그 등록 + shape 검증 |
| 렌더러 | `src/usecases/RenderObjectTree.js` | `renderCallout`(≈638행) — body 는 살균 HTML raw 방출 |
| 삽입 팩토리 | `src/editor/objectFactory.js` | `CATALOG_ITEMS` 의 callout 항목 + `defaultFieldsFor('callout')` |
| 인스펙터 | `src/editor/inspector.js` | callout variant/제목/본문 편집 컨트롤 |
| 테스트 | `test/unit/catalog-insert.test.js` | 카탈로그↔팩토리↔스키마 삼각 고정 |

**P3 는 여기에 "그림형은 좌표 미생성(엔진 소유 SVG)" 제약을 더한 버전이다** — callout 의 body(자유 HTML)와 달리, 그림 개체는 `{kind, params:{개수}, labels?:[...]}` 만 저작하고 SVG 는 엔진(OrganizerGen)이 그린다.

---

## 4. 재사용할 기존 자산 (P3 가 새로 만들 필요 없음)

- **`src/usecases/OrganizerGen.js`** — 파라메트릭 SVG 생성기(순수 모듈, 브라우저+노드). `ORGANIZER_GENERATORS = {venn, conceptmap, fishbone, flowchart, hierarchy, hexagon}`. 개수(params)로 결정적 SVG. **P3 렌더러가 이걸 호출**하면 된다.
- **`GRAPHIC_ORGANIZER_INSERTS`** (`src/editor/objectFactory.js`) — 현재 잠금 richtext 로 삽입하는 그림형 6종. P3 는 이걸 **편집 가능 타입 삽입으로 승격**.
- **파라메트릭 파싱**: `parseOrganizerSpec("벤다이어그램 3원")`(OrganizerGen), `AssembleWorksheet` 의 `entry.params`/`fit` — 개수→SVG 경로가 이미 검증됨.
- **fit-to-page**: `fitSvgToBox`(OrganizerGen) — 용지 맞춤.

---

## 5. 스파이크가 저울질할 선택지 (go/no-go 판정 대상)

- **A안 — 새 개체 타입 `organizer`(또는 `diagram`)**: `{type:'organizer', kind:'venn', params:{circles:3}, labels?:[...]}`. 렌더러=OrganizerGen, 인스펙터=개수/라벨 컨트롤. callout 풀 스택 미러링. **스키마 변경 O** → 가장 개방적·정공법이나 승인 필요.
- **B안 — richtext 유지 + 제한적 재생성**: 잠금 richtext 에 인스펙터 액션(예 "원 개수" 셀렉트)만 붙여 OrganizerGen 으로 html 을 **통째 재생성**. **스키마 변경 X**, 가볍지만 라벨 개별 편집 불가·hacky.
- **C안 — no-go**: P2 잠금 삽입으로 충분하다고 판정. compose 에서 개수 지정·재삽입으로 우회.

스파이크는 **작은 프로토타입 + 5대 불변식 준수 여부**를 데이터로 재서 A/B/C 를 권고한다(ADR).

---

## 6. 반드시 지킬 불변식

- **개체 스키마**: A안은 이걸 **여는** 결정 — callout 선례 절차(승인+ADR)를 따른다. B/C안은 무변경.
- **무API / 좌표 미생성**: 그림 SVG 좌표·도형은 **엔진(OrganizerGen)이 소유**. AI/교사는 개수·라벨 텍스트만(원칙 3, PLAN §75).
- **정답 fail-closed**: 그림형엔 정답 개념이 약하나, 만약 라벨에 정답을 담으면 `.answer`/`answer:true` 규약 준수.
- **편집=인쇄 기계동치**: 실물 Chrome 렌더로 편집 쪽수==인쇄 쪽수, SVG 넘침·왜곡 0 검증(PLAN R1).
- **성취기준 조회전용**.

---

## 7. 진행 방식 (병행 세션 규약 — `docs/CONCURRENT-SESSIONS.md`)

- **착수 전 겹침 실측**: 최신 main 기준. **B′(bspike)가 `src/domain/schema/*` 를 건드렸으니** P3(스키마)와 겹칠 소지 — 착수 시점에 `git rev-list --left-right --count main...feat/bspike` 로 재확인. (2026-07-31 관측: main HEAD `6f744ab "Merge ... into feat/bspike"` → B′ 가 main 에 반영된 것으로 보임. **새 세션이 반드시 재검증**.)
- 최신 main 에서 **새 worktree**(`git worktree add ../worksheet-grab-<작업명> -b feat/<작업명>`)에서만 작업. main·타 worktree 무접촉.
- `git add` 경로 명시 · 작게 자주 커밋 · 렌더 테스트 직렬(`npm run test:render`).
- **1차 산출은 ADR/권고**; 코드 채택은 사용자 승인 후 main 병합.

---

## 8. 첫 단계 (새 세션이 할 일 순서)

1. 이 문서 + `docs/PLAN-graphic-organizers.md`(§52·§74·§136·§178·§183) + callout 4개 파일(§3 표) 실측.
2. **`/ralplan`** 으로 A/B/C go/no-go 계획 수립(합의). **코드 변경 전 정지 · 사용자 승인 대기.**
3. 승인 후: 작은 프로토타입(예: venn 개수 토글이 되는 최소 개체) → 실물 렌더 → 불변식 계측 → **ADR/권고**.
4. 검증: `npm run test:unit` + 조직자/에디터 관련 `npm run test:render`(직렬). 비개발자에게 쉬운 말로 설명 + 결과물 PNG 캡처.

## 9. 참고 (근거 위치)

- 설계: `docs/PLAN-graphic-organizers.md` — §28(원칙1 재사용), §52·§74~75(왜곡·엔진 소유 SVG), §136(P3 스파이크), §178(2트랙·새 타입 없음), §183(P3 후속).
- 이번 세션 커밋(참고): P1a `1b30a02`/`1cdabb9`, 디테일 `7d32601`/`24e9f04`, P2 `bf73e42`, P2b `bc30427`, P1b `ad9ccfd`.
- callout 선례: `docs/HANDOFF-grab-M4-M5-Bspike.md`. (B′ 자체는 `docs/HANDOFF-grab-Bspike.md`·`ADR-bspike-ai-fragment.md` — P3 아님.)
- README "시각 조직자" 섹션.
