---
name: worksheet-design
description: 활동지 아웃라인을 닫힌 카탈로그 10종의 **개체 트리 JSON**으로 저작하고 편집한다(HTML 직저작 금지). 정답은 answer:true 속성, AI는 좌표(rect)를 만들지 않는다(flow 전용). "활동지 개체 저작/편집", "문항 추가·삭제·수정" 편집 요청 시 사용. 범교과 — 교과색은 themeName 참조로만.
---

# worksheet-design (활동지 개체 트리 저작·편집)


아웃라인(`02_outline.json`)을 개체 트리 스키마(엔진이 검증하는 계약)를 준수하는 **개체 트리 JSON**
으로 만든다. **HTML 문자열을 직접 저작하지 않는다** — paper-css 조립·`.sheet` 페이지 골격·CSS 변수
주입은 렌더 코어(`RenderObjectTree`)의 책임이다. 이 스킬은 "무엇을 어떤 타입으로 표현할지"만
결정한다.

## 단일 진실 원천
- **스키마 계약**: 개체 트리 스키마 문서(사람이 읽는 요약) +
  `schema/worksheet-object.schema.json`(계약 문서) + 엔진의 개체 카탈로그 상수(런타임).
  이 세 산출물이 갈라지면 무조건 코드(`ObjectCatalog.js`/`validateObjectShape.js`)가 맞다.
- **검증**: 엔진의 개체 트리 검증(`ValidateObjectTree`) — 저작·편집 후 개체 트리가 이 검증을 PASS해야 한다.

## 닫힌 카탈로그 — 저작 대상 10종 (신규 타입 창설 금지)

> 카탈로그 자체는 12종이다. 나머지 2종(`spacer` 빈 공간 · `page-break` 페이지 나누기)은
> **레이아웃 전용이며 교사가 편집기에서 넣는다** — 저작 단계에서 만들어 내지 말고, 기존 문서에
> 이미 있으면 그대로 보존하라.
>
> 같은 이유로 **크기·정렬 필드 3종**(`widthPct` 본문 폭 대비 % · `minHeightMm` 최소 높이 ·
> `align` 좌우 정렬)도 저작하지 않는다 — flow 개체에 실을 수 있지만 조판은
> 교사 몫이다. 넣지 않으면 폭 100%·높이 내용대로가 기본이며, 기존 문서의 값은 보존한다.
`title` · `passage-slot` · `question`(qtype 7종: multiple-choice/short-answer/essay/fill-blank/
true-false/matching/ordering) · `table`(분할불가, `splittable:false` 고정) · `image-slot` ·
`answer-area`(`style:line|box|dots`) · `divider` · `shape`(float 전용, **디자이너는 만들지 않음** —
교사 편집 전용) · `richtext`(html 탈출구) · `std-box`(성취기준 원문 주입 전용, `codes`만).

표현하고 싶은 구조가 10종 어디에도 맞지 않으면 **새 타입을 발명하지 말고 `richtext`로 원본 의도를
담는다**(`sourceType`에 원래 이름을 남겨 리뷰 대상 표시). 어떤 옛 블록 패턴이 어느 타입으로 착지하는지는
`references/block-library.md` 매핑표를 참조한다.

## 공통 속성과 배치 규칙
- 모든 개체는 `{id, type, placement, answer?}` 공통 속성을 갖는다.
- **`placement:'flow'`(문서 흐름) 고정, `rect` 절대 금지**: 이 스킬로 저작하는 모든 개체는
  `placement:'flow'`이며 `rect`(좌표) 필드를 싣지 않는다. AI는 좌표를 만들지 않는다(원칙 3) —
  `placement:'float'`(자유배치, `rect`{xMm,yMm,wMm,hMm} 필수)는 **교사가 편집기에서 직접 만드는 것만
  허용되는 편집 전용 기능**이며, 저작·편집 스킬이 스스로 float 개체를 생성하면 `ValidateObjectTree`가
  `rect-forbidden-in-flow`로 거부한다.
- **`pagination:'scaffold'`**: 문서는 `{ pagination:'scaffold', pages:[{ id:'page-...', flow:[...전체
  개체 순서 그대로...], float:[] }] }` 단일 스캐폴드 페이지로 산출한다. 페이지 `id`는 문서 안에서
  유일한 비어 있지 않은 문자열이며 index를 쓰지 않는다. 몇 페이지로 나눌지는 계산하지 않는다 —
  실제 경계는 Chrome 측정 페이지네이션 패스가 산출해 `pagination:'paginated'`로 승격한다.
  `scaffold` 문서는 export가 거부된다(`checkExportGate`, 이 스킬의 책임 밖).

## 교과 테마 (themeName 참조만, CSS 직접 작성 금지)
교과색은 문서 메타의 `themeName` 필드로만 지정한다(`references/themes.md`의 이름 목록). 렌더러가
`themes/${themeName}.css`를 로드해 CSS 변수를 주입하므로, 이 스킬은 CSS를 작성하지 않는다.

## 정답 모델
- `answer:true` 속성을 실을 수 있는 타입은 **`title`·`question`·`table`·`richtext` 4종뿐**이다(다른
  타입에 실으면 `unknown-field`로 거부 — 예: `answer-area`는 그 자체가 "빈 여백"이라 별도 플래그가
  무의미).
- 인접한 정답 콘텐츠는 별도 개체로 흩어 두지 말고 `question.answerKey`(`{text, html}`)로 해당 질문
  개체에 합쳐 담는다.
- 학생용에서는 `answer:true`인 개체 전체가 물리 제거된다(BuildVariants) — 시각적으로만 숨기는
  게 아니라 개체 자체가 학생 문서에 존재하지 않게 된다.

## 슬롯 불변(성취기준, 원문 창작 금지) / 저작권 지문(3층 정책, 명시 요청 시 AI 허용)
- **`std-box`**: `{id, type:'std-box', placement:'flow', codes:['[코드]', ...], objectives?:[...]}`만
  싣는다. 성취기준 원문 텍스트를 절대 개체에 쓰지 않는다 — `curriculum-mapper`가 확정한 `codes`만
  참조하고, 원문은 렌더 시 성취기준 CSV/gepai에서 주입된다. `text`/`html`/`bodyHtml` 등 자유 필드를
  실으면 슬롯 변조(`slot-invariant`)로 거부된다. 이 규칙은 변경 없음(원칙 3).
  - **`objectives`(학습목표)**: `codes`와 달리 **저작 영역**이다.
    활동지 상단에는 성취기준 원문이 아니라 해당 차시 학습목표를 낸다(현장 관행) — `02_outline.json`
    (`worksheet-plan`이 저작)의 `objectives[]`를 그대로 옮긴다(문자열 배열, `"~할 수 있다"` 형식
    2~3개 권장). `objectives`가 있으면 렌더러가 학생/교사 공통 "학습 목표" 박스를 렌더한다.
    `objectives`가 없으면(하위호환) 현행 성취기준 박스를 그대로 렌더한다.
  - **`showStandards`(근거 성취기준 표시)**: 활동지에는 학습목표만 싣는 것이
    기본이라 **이 필드를 설정하지 않는다**(기본 false). 사용자가 명시적으로 요청할 때만
    `showStandards: true`를 실어 "근거 성취기준"(코드+원문) 박스를 함께 낸다 — 그 경우에도 학생용에서는
    `data-mode` CSS로 숨고 교사용에만 보인다(정답이 아니므로 물리 제거는 없다). 표시를 끄더라도
    `codes`는 항상 싣는다(검수·교사 확인용 참조).
  - **`heading`(박스 제목)**: 설정하지 않는다(기본 "학습 목표"). 교사가 편집기에서 직접 고치는 필드다.
- **`passage-slot`**: **기본은 빈 슬롯** — `slotLabel`(필수, 예: `'［지문 삽입
  슬롯］'`)로 안내만 채우고 `bodyHtml`/`source`는 비워 둔다(사용자가 지문을 요청하지 않은 일반 아웃라인
  조립에서는 이전과 동일). **사용자가 명시적으로 지문 생성·재구성을 요청하면** `bodyHtml`을 (a) 순수
  창작 또는 (b) 교사가 넣은 기존 글의 재구성/수준 조정/요약으로 채울 수 있다 — **실존 저작물의 원문을
  그대로 재현하는 것은 금지**(프롬프트 계약 수준, 창작 또는 재구성만). `source`에 성격을 표기한다
  (예: `'AI 창작'` / `'원문 ○○ 재구성'`). `slot-invariant`는 여전히 카탈로그 밖 필드만 막는다(`title`·
  `bodyHtml`·`source`·`footnotes`는 카탈로그 필드라 걸리지 않음).

## 삽화(생성 이미지) 필요 시
1. 사용자 로컬 `codex-image` 스킬로 생성한다(gpt-image-2·OAuth·무API — 장당 약 2~6분 소요).
2. 산출 PNG를 `worksheets/<문서명>/assets/`에 저장한다(안전문자 파일명·`.png`). 교사 보유 이미지도
   동일 경로로 다룬다(에디터 픽커·붙여넣기·DnD 또는 파일 직접 복사 — `POST /assets`, 5MB·SVG 제외).
3. 개체: `{id, type:'image-slot', placement:'flow', src:'assets/<파일명>', alt:'설명'[, caption]}`.
   - **`alt` 필수**(스크린리더·인쇄 실패 대체).
   - 크기(mm 폭) 지정 필드는 스키마에 없다 — flow 배치에서는 렌더러가 기본 폭을 적용한다. 교사가
     편집기에서 float로 전환해 `rect`로 크기·위치를 조정하는 것은 편집 전용 기능이다.
   - **흑백 인쇄 대비**: 색상만으로 구분되는 이미지(예: 색깔별 범례)는 피하거나 명도차·패턴으로
     보완한다(학교 인쇄는 흑백/회색조가 흔하다).
4. 원격 URL 인라인은 금지 — `src`는 항상 `assets/` 상대경로.

## 조립 절차
1. 아웃라인의 `theme`를 문서 메타 `themeName`으로 그대로 옮긴다 → `references/themes.md`.
2. 아웃라인 블록 순서대로 개체를 만든다(어떤 옛 블록 패턴이 어느 타입으로 착지하는지
   → `references/block-library.md`).
3. 성취기준은 `std-box.codes`에 코드만 참조로 싣는다(원문 창작 금지, `01_curriculum_standards.json`
   확정 코드 사용). `02_outline.json.objectives`가 있으면 `std-box.objectives`에 그대로 옮긴다(학습목표
   표기 전환 — 위 "슬롯 불변" 절 참조).
4. 저작권 지문은 기본적으로 `passage-slot`(`slotLabel` 안내만)으로 — 사용자가 지문 생성/재구성을
   명시적으로 요청한 경우에만 위 "저작권 지문(3층 정책)" 절 규칙에 따라 `bodyHtml`을 채운다.
5. `03_manifest.json`에 사용 타입 집계·`richtext` 탈출구 사용 목록·KaTeX/웹폰트 플래그 기록.

## 편집 모드 (대화형)
- 기존 `03_worksheet.json`을 대상으로 지시된 개체(`id`)만 추가·수정·삭제, 나머지는 `id` 보존한 채
  그대로 둔다. 전면 재생성은 사용자 명시 시만.
- 편집 후 반드시 `ValidateObjectTree` 자가 점검 → reviewer 재검수를 거친다.

## 참조
- `references/block-library.md` — 옛 블록 패턴 → 닫힌 카탈로그 10종 매핑표
- `references/themes.md` — 교과별 `themeName` 목록
