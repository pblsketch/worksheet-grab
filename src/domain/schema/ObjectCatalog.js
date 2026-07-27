// ObjectCatalog — editor-v4 개체 스키마의 닫힌 카탈로그(S1.1). 무빌드 바닐라 ESM, 의존성 0.
// 스파이크 산출물(scratchpad/spike-editor-v4/candidate-schema.json)의 실사용 적합성 실증을
// 반영해 동결한 프로덕션 타입 상수다. 상세 근거·판정은 docs/HANDOFF-object-schema.md 참조.
//
// TYPE_SPECS 는 schema/worksheet-object.schema.json 의 per-type properties 와 1:1 대응한다
// (두 산출물이 갈라지면 즉시 회귀 — object-schema.test.js 가 카탈로그 10종 픽스처로 상시 단정).

/** qtype 7종(C-11 스파이크 전량 PASS — candidate-schema.md §4). */
export const QUESTION_TYPES = Object.freeze([
  'multiple-choice', 'short-answer', 'essay', 'fill-blank', 'true-false', 'matching', 'ordering',
]);

/** 개체 배치 2종 — flow(리플로우 순서)·float(페이지 내 절대좌표, D-A). */
export const PLACEMENTS = Object.freeze(['flow', 'float']);

/** 문서 수준 페이지네이션 상태(R2-4) — scaffold=경계 미계산(compose 산출), paginated=Chrome 측정 패스 영속화 완료. */
export const PAGINATION_STATES = Object.freeze(['scaffold', 'paginated']);

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
    optional: Object.freeze(['level', 'textHtml', 'meta', 'answer']),
  }),
  'passage-slot': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze(['slotLabel']),
    optional: Object.freeze(['title', 'bodyHtml', 'source', 'footnotes']),
  }),
  'question': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['qtype', 'prompt']),
    // promptHtml: 발문에 인라인 서식이 적용됐을 때의 살균 HTML(선택, title.textHtml 과 동형). qnum
    // 배지는 포함하지 않는다(렌더가 qnum 을 별도로 붙임). 없으면 prompt 를 이스케이프해 렌더(하위호환).
    // lines: 서술형(essay) 내장 답란 줄 수. 0 이면 내장 답란 없음(마이그레이션 문항 — 별도 answer-area
    // 개체가 답 공간을 제공), 미지정이면 렌더 기본 4줄.
    optional: Object.freeze(['qnum', 'promptHtml', 'lines', 'choices', 'blanks', 'left', 'right', 'items', 'answerKey', 'answer']),
  }),
  'table': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['splittable', 'rows']),
    // borderColor/borderWidth: 표 테두리 서식(편집기에서 직접 지정, #5 2차) — 셀 내부(w/colspan/rowspan/
    // merged)는 셀 오브젝트가 자유롭게 갖는다(validator 는 top-level 필드만 검사).
    optional: Object.freeze(['caption', 'headerRows', 'headerCol', 'answer', 'borderColor', 'borderWidth']),
  }),
  'image-slot': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze([]),
    optional: Object.freeze(['src', 'alt', 'caption']),
  }),
  'answer-area': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['style']),
    optional: Object.freeze(['lines', 'label']),
  }),
  'divider': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze([]),
    optional: Object.freeze([]),
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
    optional: Object.freeze(['sourceType', 'answer']),
  }),
  'std-box': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze([]),
    // objectives: 학습목표 문장 배열 — codes(조회 전용 참조, 원문 창작 금지)와 달리 **저작 영역**이다
    // (성취기준을 해당 차시에 맞게 구체화한 문장, "~할 수 있다" 형식 — 원칙 3의 예외가 아니라 애초에
    // 원칙 3의 대상 밖: 원칙 3은 "성취기준 원문"에만 적용된다). std-box 타입 자체는 여전히
    // AI_EXCLUDED_TYPES 에 남아 편집기 AI 재작성(aiBridge) 요청 대상에서는 제외되지만, designer 의
    // 초안 저작 시점에는 이 필드를 채운다(2026-07-23 학습목표 표기 전환).
    optional: Object.freeze(['codes', 'objectives']),
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

/** 닫힌 카탈로그(12종 — 콘텐츠 10 + 레이아웃 2). TYPE_SPECS 키 순서를 그대로 노출. */
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
