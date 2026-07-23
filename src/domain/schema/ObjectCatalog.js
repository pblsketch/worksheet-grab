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
    optional: Object.freeze(['level', 'meta', 'answer']),
  }),
  'passage-slot': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze(['slotLabel']),
    optional: Object.freeze(['title', 'bodyHtml', 'source', 'footnotes']),
  }),
  'question': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['qtype', 'prompt']),
    optional: Object.freeze(['qnum', 'choices', 'blanks', 'left', 'right', 'items', 'answerKey', 'answer']),
  }),
  'table': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['splittable', 'rows']),
    optional: Object.freeze(['caption', 'headerRows', 'headerCol', 'answer']),
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
    optional: Object.freeze(['strokeColor', 'fillColor']),
  }),
  'richtext': Object.freeze({
    placements: Object.freeze(['flow', 'float']),
    required: Object.freeze(['html']),
    optional: Object.freeze(['sourceType', 'answer']),
  }),
  'std-box': Object.freeze({
    placements: Object.freeze(['flow']),
    required: Object.freeze([]),
    optional: Object.freeze(['codes']),
  }),
});

/** 닫힌 카탈로그(10종). TYPE_SPECS 키 순서를 그대로 노출. */
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
