// ObjectCatalog — editor-v4 개체 스키마의 닫힌 카탈로그(S1.1). 무빌드 바닐라 ESM, 의존성 0.
// 실사용 적합성 검증을 반영해 동결한 프로덕션 타입 상수다.
// 상세 계약은 docs/HANDOFF-object-schema.md 참조.
//
// TYPE_SPECS 는 schema/worksheet-object.schema.json 의 per-type properties 와 1:1 대응한다
// (두 산출물이 갈라지면 즉시 회귀 — object-schema.test.js 가 카탈로그 12종 픽스처로 상시 단정).

/** qtype 7종(C-11 스파이크 전량 PASS — candidate-schema.md §4). */
export const QUESTION_TYPES = Object.freeze([
  'multiple-choice', 'short-answer', 'essay', 'fill-blank', 'true-false', 'matching', 'ordering',
]);

/** 개체 배치 2종 — flow(리플로우 순서)·float(페이지 내 절대좌표, D-A). */
export const PLACEMENTS = Object.freeze(['flow', 'float']);

/** 문서 수준 페이지네이션 상태(R2-4) — scaffold=경계 미계산(compose 산출), paginated=Chrome 측정 패스 영속화 완료. */
export const PAGINATION_STATES = Object.freeze(['scaffold', 'paginated']);

/**
 * 본문 배치(flow) 개체의 크기·정렬 필드 3종(2026-07-28 신설 — docs/DECISION-object-resize.md).
 *
 * **좌표가 아니라 크기다.** flow 개체는 rect(좌표)를 가질 수 없지만(rect-forbidden-in-flow, 원칙 3)
 * 원칙 3 이 막는 것은 "AI 가 지면 위 위치를 지어내는 것"이지 교사가 폭을 줄이는 것이 아니다. 이 세
 * 필드는 위치를 말하지 않는다 — 흐름 안에서의 상대 폭·최소 높이·좌우 정렬만 말한다. 개체가 어디에
 * 놓이는지는 여전히 흐름 순서가 정하고, 페이지 경계는 여전히 assignFlowToPages 혼자 정한다(D-A 무접촉).
 *
 *  - widthPct    본문 폭(=`.sheet-body` 열 폭) 대비 % (5~100). mm 가 아닌 이유: 용지·단 수를 바꾸면
 *                mm 는 열을 넘겨 클램프가 필요하고, 클램프는 값을 되돌릴 수 없게 덮어쓴다. %는 어느
 *                폭에서도 유효하다(DECISION §1.2).
 *  - minHeightMm 최소 높이(mm). 고정 height 가 아닌 이유: 내용이 넘치면 잘리는데 그 넘침은 측정에
 *                잡히지 않아 페이지 경계가 조용히 어긋난다(R2-1 붕괴). min- 은 내용이 늘면 따라 는다.
 *  - align       폭을 줄였을 때의 좌우 정렬(margin-inline). 높이에 영향이 없어 R2-1 위험이 없다.
 *
 * **float 에는 실을 수 없다**(validateObjectShape 의 size-forbidden-in-float) — float 은 rect 가 이미
 * 크기를 갖는다. 한 가지 일에 수단을 둘 두지 않는다.
 *
 * **AI 저작 어휘가 아니다** — spacer/page-break 와 같이 편집기 전용이다(교사가 조판을 정한다).
 * designer 프롬프트·worksheet-design 스킬의 카탈로그 어휘에 넣지 않는다.
 */
export const SIZE_FIELDS = Object.freeze(['widthPct', 'minHeightMm', 'align']);

/** align 허용값 — left 는 기본값이라 렌더가 선언 자체를 생략한다. */
export const ALIGN_VALUES = Object.freeze(['left', 'center', 'right']);

/** 강조상자(callout) variant 4종(2026-07-30 신설 — M4). 팁/주의/노트/핵심정리. */
export const CALLOUT_VARIANTS = Object.freeze(['tip', 'warning', 'note', 'summary']);

/**
 * 편집 가능 그림형 조직자(organizer) 종류(P3 스파이크, 2026-07-31). OrganizerGen.ORGANIZER_GENERATORS
 * 키와 1:1 대응 — 엔진이 개수(params)로 SVG 를 결정적으로 그리고, 교사/AI 는 개수와 슬롯 텍스트(labels)
 * 만 지정한다(원칙 3: 좌표·도형은 엔진 소유). renderOrganizer·validateObjectShape 가 이 목록으로
 * kind 를 닫는다(미지의 kind → 스타일 없는 빈 SVG 로 새는 것 방지, callout variant 접기와 동형).
 */
export const ORGANIZER_KINDS = Object.freeze(['venn', 'conceptmap', 'fishbone', 'flowchart', 'hierarchy', 'hexagon']);

/** widthPct 범위 — 5% 미만은 내용이 뭉개져 실용적이지 않고, 100% 초과는 열을 넘긴다. */
export const WIDTH_PCT_MIN = 5;
export const WIDTH_PCT_MAX = 100;

/**
 * 타입별 배치 허용·필수/선택 필드. id/type/placement/rect 는 공통 처리(validateObjectShape)라
 * 여기 목록에는 넣지 않는다. `answer` 는 타입이 optional 에 명시했을 때만 허용(= answer 위치 규칙 —
 * ANSWERABLE_TYPES 로 파생).
 */
export const TYPE_SPECS = Object.freeze({
  'title': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze(['text']),
    // textHtml: 인라인 서식(굵게/기울임 등)이 적용된 제목의 살균 HTML(선택). 있으면 렌더가 text 대신
    // 이걸 그대로 방출한다(richtext.html·passage bodyHtml 과 동형 — 입력에서 살균, 렌더는 이스케이프
    // 없이 방출). 없으면 text 를 이스케이프해 렌더(하위호환). text 는 항상 평문으로 병행 보관(정답
    // 누출 스캔·diff·평문 소비자용).
    optional: Object.freeze(['level', 'textHtml', 'meta', 'answer', ...SIZE_FIELDS]),
  }),
  'passage-slot': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze(['slotLabel']),
    // borderColor/borderWidth/bgColor: 지문 박스 서식(교사가 편집기에서 직접 지정, #3). table 의
    // borderColor/borderWidth 와 같은 CSS 변수 경로를 쓴다 — 렌더가 인라인 커스텀 프로퍼티로
    // 방출하고 blocks.css `.passage` 가 var() 기본값으로 받는다(편집==인쇄 동일 선언).
    optional: Object.freeze(['title', 'bodyHtml', 'source', 'footnotes', 'borderColor', 'borderWidth', 'bgColor', ...SIZE_FIELDS]),
  }),
  'question': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['qtype', 'prompt']),
    // promptHtml: 발문에 인라인 서식이 적용됐을 때의 살균 HTML(선택, title.textHtml 과 동형). qnum
    // 배지는 포함하지 않는다(렌더가 qnum 을 별도로 붙임). 없으면 prompt 를 이스케이프해 렌더(하위호환).
    // lines: 서술형(essay) 내장 답란 줄 수. 0 이면 내장 답란 없음(마이그레이션 문항 — 별도 answer-area
    // 개체가 답 공간을 제공), 미지정이면 렌더 기본 4줄.
    optional: Object.freeze(['qnum', 'promptHtml', 'lines', 'choices', 'blanks', 'left', 'right', 'items', 'answerKey', 'answer', ...SIZE_FIELDS]),
  }),
  'table': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['splittable', 'rows']),
    // borderColor/borderWidth: 표 테두리 서식(편집기에서 직접 지정, #5 2차) — 셀 내부(w/colspan/rowspan/
    // merged)는 셀 오브젝트가 자유롭게 갖는다(validator 는 top-level 필드만 검사).
    optional: Object.freeze(['caption', 'headerRows', 'headerCol', 'answer', 'borderColor', 'borderWidth', ...SIZE_FIELDS]),
  }),
  'image-slot': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze([]),
    optional: Object.freeze(['src', 'alt', 'caption', ...SIZE_FIELDS]),
  }),
  'answer-area': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['style']),
    optional: Object.freeze(['lines', 'label', ...SIZE_FIELDS]),
  }),
  'divider': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze([]),
    // 크기 필드 포함 — 폭을 줄이고 가운데 정렬한 짧은 구분선은 실제로 쓰이는 조판 요소다
    // (spacer/page-break 와 달리 divider 는 눈에 보이는 선이라 폭이 의미를 갖는다).
    optional: Object.freeze([...SIZE_FIELDS]),
  }),
  'shape': Object.freeze({
    placements: Object.freeze(['float']),
    required: Object.freeze(['shapeKind']),
    // strokeWidth(mm 아닌 px 상대값)·dash(solid|dashed|dotted): 선 두께·유형 서식(#5 2차).
    optional: Object.freeze(['strokeColor', 'fillColor', 'strokeWidth', 'dash']),
  }),
  'richtext': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['html']),
    optional: Object.freeze(['sourceType', 'answer', ...SIZE_FIELDS]),
  }),
  'std-box': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze([]),
    // objectives: 학습목표 문장 배열 — codes(조회 전용 참조, 원문 창작 금지)와 달리 **저작 영역**이다
    // (성취기준을 해당 차시에 맞게 구체화한 문장, "~할 수 있다" 형식 — 원칙 3의 예외가 아니라 애초에
    // 원칙 3의 대상 밖: 원칙 3은 "성취기준 원문"에만 적용된다). std-box 타입 자체는 여전히
    // AI_EXCLUDED_TYPES 에 남아 편집기 AI 재작성(aiBridge) 요청 대상에서는 제외되지만, designer 의
    // 초안 저작 시점에는 이 필드를 채운다(2026-07-23 학습목표 표기 전환).
    //
    // heading: 학습목표 박스 제목(기본 '학습 목표'). 교사가 본문에서 직접 고칠 수 있다 —
    //   "오늘의 목표"·"성취 목표"처럼 학교/교과마다 부르는 이름이 다르다(#1).
    // showStandards: 근거 성취기준(코드+원문) 박스를 **교사용에** 함께 낼지. **기본은 표시하지
    //   않는다**(2026-07-28) — 현장에서 활동지에 얹는 것은 학습목표뿐이고 성취기준 원문은 대개
    //   넣지 않는다는 실사용 피드백에 따른 기본값 전환이다. true 일 때만 `.std-ref` 박스를 낸다
    //   (그마저도 학생용에서는 CSS 로 숨는다 — 종전과 같음). 이 필드는 표시 여부만 정하며
    //   codes(조회 참조)는 그대로 보존된다 — 껐다 켜도 성취기준 정보가 소실되지 않는다.
    optional: Object.freeze(['codes', 'objectives', 'heading', 'showStandards', ...SIZE_FIELDS]),
  }),
  // ── 강조상자(2026-07-30 신설 — M4) ─────────────────────────────────────────
  // 팁·주의·핵심정리 박스. flow 전용. body 는 살균 HTML(정제 allowlist). **answer 없음**(중립 박스라
  // 정답을 담지 않는다 — BuildVariants 학생본 제거·정답누출 검사 확장 불필요). SIZE_FIELDS 는 편집기
  // 전용(AI 저작 어휘 아님 — designer 어휘에는 variant/title/body 만 넣는다).
  'callout': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze(['variant', 'body']),
    optional: Object.freeze(['title', 'titleHtml', ...SIZE_FIELDS]),
  }),
  // ── 편집 가능 그림형 조직자(P3 스파이크, 2026-07-31 신설) ─────────────────────
  // 벤다이어그램 등 파라메트릭 SVG 조직자. flow 전용(엔진이 소유한 고정비율 SVG — 좌표·도형을
  // 교사/AI 가 만들지 않는다, 원칙 3). kind=조직자 종류(ORGANIZER_KINDS), params=개수(예 {circles:3}),
  // labels=슬롯 텍스트 배열(교사 저작, 없으면 엔진 기본 라벨). **answer 없음**(그림형은 중립 —
  // callout 과 동형, fail-closed 확장 불필요). 렌더는 OrganizerGen 이 단일 출처로 SVG 를 그린다
  // (편집==인쇄: 잠금 richtext 가 굽던 것과 문자 그대로 같은 생성기 출력). params/labels 내부는
  // validator 가 검사하지 않는다(table rows 와 동일 — 엔진이 clamp·해석). kind 만 닫힌 집합으로 검증.
  'organizer': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze(['kind']),
    optional: Object.freeze(['params', 'labels', ...SIZE_FIELDS]),
  }),
  // ── 레이아웃 전용 2종(2026-07-28 신설) ─────────────────────────────────────
  // 둘 다 "내용"이 아니라 **조판 의도**를 담는다. flow 전용인 이유가 각각 있다(아래 주석).
  // 교사가 편집기에서 삽입하는 도구이며, designer AI 의 저작 어휘에는 넣지 않는다
  // (AI 는 활동 내용을 만들고 조판은 리플로우와 교사가 정한다 — 원칙 3 의 연장).
  'spacer': Object.freeze({
    // float 은 흐름을 밀지 않으므로 "빈 공간"이 성립하지 않는다 — flow 전용.
    placements: Object.freeze(['flow']),
    required: Object.freeze(['heightMm']),
    optional: Object.freeze(['label']),
  }),
  'page-break': Object.freeze({
    // 페이지 경계를 강제하는 표식. 높이 0 이라 인쇄에는 아무것도 남기지 않는다.
    placements: Object.freeze(['flow']),
    required: Object.freeze([]),
    optional: Object.freeze([]),
  }),
});

/** 닫힌 카탈로그(14종 — 콘텐츠 12[+callout M4·+organizer P3] + 레이아웃 2). TYPE_SPECS 키 순서를 그대로 노출. */
export const OBJECT_TYPES = Object.freeze(Object.keys(TYPE_SPECS));

/**
 * AI 대상 제외 타입 — std-box(성취기준 원문 주입 전용, 창작 금지·원칙 3, 완전 불변)만 남는다.
 * 3층 정책(2026-07-23 2차 델타): passage-slot 은 AI 가드에서 해제됐다 — 교사가 편집기에서
 * 명시적으로 요청하면 AI가 지문을 (a) 순수 창작하거나 (b) 교사가 넣은 기존 글을 재구성·수준
 * 조정·요약할 수 있다(단 실존 저작물 원문을 그대로 재현하는 것은 금지 — 프롬프트 계약 수준,
 * aiBridge/ai.js 가 지시문에 명시). std-box 는 여전히 완전 불변(codes 참조만, 원문 창작 금지) —
 * 카탈로그 밖 필드가 실리면 슬롯 변조로 간주한다(validateObjectShape 의 rule:'slot-invariant').
 * (구 이름 IMMUTABLE_SLOT_TYPES → AI_EXCLUDED_TYPES 개명 — passage-slot 이 빠지며 "AI 대상 제외"라는
 * 이름의 뜻이 더 명확해졌다.)
 */
export const AI_EXCLUDED_TYPES = Object.freeze(['std-box']);

/** answer:true 를 실을 수 있는 타입(TYPE_SPECS.optional 에 'answer' 를 명시한 타입만 — answer 위치 규칙의 근거). */
export const ANSWERABLE_TYPES = Object.freeze(
  OBJECT_TYPES.filter((t) => TYPE_SPECS[t].optional.includes('answer')),
);

/**
 * 크기·정렬을 실을 수 있는 타입(TYPE_SPECS.optional 에 SIZE_FIELDS 를 명시한 타입만) — 편집기
 * 인스펙터/손잡이가 "이 개체에 크기 UI 를 낼지"를 이 목록으로 판정한다.
 * 제외: spacer(이미 heightMm 소유 — 중복 어휘), page-break(높이 0 표식), shape(float 전용이라
 * flow 전용인 크기 필드가 애초에 성립하지 않는다).
 */
export const SIZEABLE_TYPES = Object.freeze(
  OBJECT_TYPES.filter((t) => SIZE_FIELDS.every((f) => TYPE_SPECS[t].optional.includes(f))),
);

/**
 * '본문 배치 ⇄ 자유 배치' 전환을 **제안해도 되는** 타입 — 두 배치를 다 지원하는 타입만(2026-07-28).
 * 편집기 UI 가 이 목록을 보지 않던 탓에, flow 전용인 제목·학습목표 박스에도 "자유 배치로 전환"이
 * 활성 버튼으로 나왔고 누르면 **아무 일도 일어나지 않았다**(실 Chrome 재현: .wg-float 0개, 클래스
 * 불변, 아무 피드백 없음). float 전용인 shape 도 같은 이유로 제외된다 — 되돌아갈 flow 가 없다.
 */
export const PLACEMENT_TOGGLEABLE_TYPES = Object.freeze(
  OBJECT_TYPES.filter((t) => ['flow', 'float'].every((p) => TYPE_SPECS[t].placements.includes(p))),
);
