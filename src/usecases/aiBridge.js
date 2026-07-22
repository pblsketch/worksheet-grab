// aiBridge — 구독 AI 브리지(E5)의 순수 정책. 무API(§3.5 비협상): 이 모듈과 브리지
// 어디에도 LLM 호출은 없다 — 에디터가 요청 파일을 만들고, 별도 프로세스의 구독 AI
// (Claude/Codex)가 CLI(ai pending/respond)로 읽고 응답할 뿐이다.
//
// §7·§10 강제: ValidateWorksheet 는 성취기준 원문 변조·저작권 슬롯 침범을 자동
// 감지하지 못한다 — 따라서 성취기준(gen)·저작권 슬롯(copyrightSlot) 블록을
// AI 액션 대상에서 구조적으로 제외하는 이 타입 가드가 유일한 강제선이다
// (순수 정책 + 서버 검증 + 클라이언트 버튼 비활성의 3중).

// AI_SCHEMA_VERSION=2 는 **신규 요청/응답 쓰기에만** 쓴다(범위 선택 다중 블록 = blocks[]).
// 디스크에 남은 v1 in-flight 요청/응답(단일 block/html)은 계속 유효해야 하므로
// validateRequest/validateResponse 는 schemaVersion∈{1,2} 를 관용하고 형태-버전 정합만 강제한다.
export const AI_SCHEMA_VERSION = 2;
export const AI_SCHEMA_VERSIONS = new Set([1, 2]);
export const AI_ACTIONS = ['rewrite', 'fill-example'];
export const AI_STATUSES = ['pending', 'answered', 'cancelled', 'applied'];

/** 상태 전이: pending→(answered|cancelled), answered→(applied|cancelled). cancelled·applied = terminal. */
const TRANSITIONS = {
  pending: new Set(['answered', 'cancelled']),
  answered: new Set(['applied', 'cancelled']),
  cancelled: new Set(),
  applied: new Set(),
};

export function canTransition(from, to) {
  return TRANSITIONS[from]?.has(to) ?? false;
}

/** 요청 id: 시각 + 주입 가능한 난수(테스트 결정성). */
export function newRequestId(now = new Date(), rand = Math.random) {
  const iso = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.floor(rand() * 0xffff).toString(16).padStart(4, '0');
  return `req-${iso}-${suffix}`;
}

export function parseAction(action) {
  if (!AI_ACTIONS.includes(action)) {
    throw new Error(`지원하지 않는 AI 액션: "${action}". 지원: ${AI_ACTIONS.join(', ')}`);
  }
  return action;
}

/** AI 대상 제외 집합: vocabulary 의 copyrightSlot·gen 타입(+최소 보장 standard-label). */
export function excludedTypes(vocabulary) {
  const out = new Set(['standard-label']);
  for (const [type, spec] of Object.entries(vocabulary?.types ?? {})) {
    if (spec?.copyrightSlot || spec?.gen) out.add(type);
  }
  return out;
}

/** 타입 가드(§7·§10): 성취기준·저작권 슬롯 블록은 AI 액션 대상이 아니다. */
export function assertTargetable(bt, vocabulary) {
  const type = String(bt || 'content');
  if (excludedTypes(vocabulary).has(type)) {
    throw new Error(`"${type}" 블록은 AI 액션 대상이 아닙니다 — 성취기준 원문·저작권 지문 슬롯은 보존됩니다(§7·§10).`);
  }
  return type;
}

/** 단일 블록 페이로드 형태 검증(v1 block · v2 blocks[] 원소 공용). */
function isValidBlock(b) {
  return !!b && typeof b === 'object'
    && typeof b.html === 'string'
    && typeof (b.bt ?? 'content') === 'string';
}

export function validateRequest(req) {
  if (!req || typeof req !== 'object') return false;
  if (!AI_SCHEMA_VERSIONS.has(req.schemaVersion)) return false;
  if (typeof req.id !== 'string' || !req.id) return false;
  if (typeof req.docName !== 'string' || !req.docName) return false;
  if (!AI_ACTIONS.includes(req.action)) return false;
  if (!AI_STATUSES.includes(req.status ?? 'pending')) return false;
  // 형태-버전 정합: v1 = 단일 block 필수, v2 = 비어있지 않은 blocks[] 필수.
  if (req.schemaVersion === 1) return isValidBlock(req.block);
  return Array.isArray(req.blocks) && req.blocks.length > 0 && req.blocks.every(isValidBlock);
}

export function validateResponse(res) {
  if (!res || typeof res !== 'object') return false;
  if (!AI_SCHEMA_VERSIONS.has(res.schemaVersion)) return false;
  if (typeof res.id !== 'string' || !res.id) return false;
  // v1 = 단일 html, v2 = blocks[{slot:정수≥0, html:비어있지 않음}].
  if (res.schemaVersion === 1) return typeof res.html === 'string' && !!res.html.trim();
  return Array.isArray(res.blocks) && res.blocks.length > 0 && res.blocks.every((b) =>
    !!b && typeof b === 'object'
    && Number.isInteger(b.slot) && b.slot >= 0
    && typeof b.html === 'string' && !!b.html.trim());
}
