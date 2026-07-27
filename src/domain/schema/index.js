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
  ALIGN_VALUES,
  WIDTH_PCT_MIN,
  WIDTH_PCT_MAX,
} from './ObjectCatalog.js';
export { validateObjectShape } from './validateObjectShape.js';
export { checkExportGate } from './exportGate.js';
export {
  createPageId,
  createUniquePageId,
  normalizePageIdentity,
  computePageVersion,
} from './PageIdentity.js';
