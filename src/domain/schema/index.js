export {
  QUESTION_TYPES,
  PLACEMENTS,
  PAGINATION_STATES,
  TYPE_SPECS,
  OBJECT_TYPES,
  AI_EXCLUDED_TYPES,
  ANSWERABLE_TYPES,
  SIZE_FIELDS,
  SIZEABLE_TYPES,
  PLACEMENT_TOGGLEABLE_TYPES,
  ALIGN_VALUES,
  CALLOUT_VARIANTS,
  ORGANIZER_KINDS,
  WIDTH_PCT_MIN,
  WIDTH_PCT_MAX,
} from './ObjectCatalog.js';
export { validateObjectShape } from './validateObjectShape.js';
export { checkExportGate } from './exportGate.js';
// B′ 스파이크(결정 태스크) — AI 프래그먼트 결정 검증기 + HTML allowlist. ADR-bspike-ai-fragment.md 참조.
export {
  validateAiFragment,
  compileFragmentToInsertSection,
  isFragmentStale,
  AI_AUTHORABLE_TYPES,
  HTML_POSITIONS,
} from './validateAiFragment.js';
export { validateHtmlField, INLINE_TAGS, BLOCK_TAGS } from './htmlAllowlist.js';
export {
  createPageId,
  createUniquePageId,
  normalizePageIdentity,
  computePageVersion,
} from './PageIdentity.js';
