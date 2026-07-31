import { AI_EXCLUDED_TYPES } from '../domain/schema/index.js';

// aiBridge — 구독 AI 브리지(E5)의 순수 정책. 무API(§3.5 비협상): 이 모듈과 브리지
// 어디에도 LLM 호출은 없다 — 에디터가 요청 파일을 만들고, 별도 프로세스의 구독 AI
// (Claude/Codex)가 CLI(ai pending/respond)로 읽고 응답할 뿐이다.
//
// §7 강제: ValidateWorksheet 는 성취기준 원문 변조를 자동 감지하지 못한다 — 따라서 성취기준 개체
// (AI_EXCLUDED_TYPES: std-box)를 AI 액션 대상에서 구조적으로 제외하는 이 타입 가드가 유일한
// 강제선이다(순수 정책 + 서버 검증 + 클라이언트 버튼 비활성의 3중). 3층 정책(2026-07-23 2차
// 델타): passage-slot 은 이 가드에서 해제됐다 — 교사가 편집기에서 명시적으로 요청하면 AI가
// 지문을 창작하거나 교사가 넣은 기존 글을 재구성할 수 있다(단 실존 저작물 원문을 그대로
// 재현하는 것은 금지 — 프롬프트 계약 수준, ai.js 의 지시문에 명시). std-box(성취기준)는 여전히
// AI 불변이다 — 원칙 3(창작 금지)은 이 델타로도 바뀌지 않는다.

// AI_SCHEMA_VERSION=3(S4.0, F4 개정): 개체 트리 경로 — 요청 objects:[{id,type,…현재 개체 필드}],
// 응답 objects:[{id,object}](개체 ID 에코, worksheet-designer/US-10 계약과 정합). vocabulary 기반
// bt/slot 타입 가드는 폐기(개체 타입 자체가 닫힌 카탈로그라 vocabulary 조회가 불필요해졌다).
// 디스크에 남은 v1(단일 block)·v2(blocks[]) in-flight 요청/응답은 계속 유효해야 하므로
// validateRequest/validateResponse 는 schemaVersion∈{1,2,3,4} 를 관용하고 형태-버전 정합만 강제한다.
//
// AI_SCHEMA_VERSION=4(Phase 4): 응답이 **개수·종류가 자유로운 계획**이 된다 — v3 의
// objects:[{id,object}] 는 대상 ID 에코라 1:1 치환만 표현할 수 있어서 "문항 3개를 활동 1개로
// 합치기"·"표 1개를 표+설명문으로 나누기"·"이건 삭제"를 담지 못했다(PRD v2.1 §11.3 "응답은
// target별 1:1 replacement를 강제하지 않는다"). v4 응답은 ops:[{op:'replace'|'insert'|'delete'}]
// 로 계획을 그대로 싣는다. 요청은 v3 의 objects[] 를 유지하되 pageId·pageVersion·scope 를
// 선택적으로 더 싣는다(각각 페이지 전체 scope·덮어쓰기 충돌 검사가 소비).
//
// **상수 사용 규약**: AI_SCHEMA_VERSION 은 "신규 쓰기" 형태(v4)에만 쓴다. v1/v2/v3 는 디스크에
// 남은 in-flight 요청·기존 CLI 입력형의 고정 형태라 호출부에서 리터럴로 태깅한다 — 신규 쓰기
// 상수를 옛 형태 페이로드에 쓰면 형태-버전 불일치로 validateRequest 가 거부한다.
export const AI_SCHEMA_VERSION = 4;
export const AI_SCHEMA_VERSIONS = new Set([1, 2, 3, 4]);
/** v4 응답 계획의 연산 종류. */
export const AI_OPS = ['replace', 'insert', 'delete', 'insert-section'];
export const AI_ACTIONS = ['rewrite', 'fill-example'];
// 'unsupported'(M5 열화 계약): 구독 AI 가 "이 요청은 ops 어휘로 표현할 수 없다"를 명시 반려한 상태.
// answered 와 같이 **응답 봉투에서 파생**된다(setStatus 로 서버가 쓰지 않는다 — 응답 파일이
// unsupported:true 면 getStatus 가 이 값을 돌려준다). terminal — 조용한 5분 타임아웃 대신 즉시 사유 표시.
export const AI_STATUSES = ['pending', 'answered', 'cancelled', 'applied', 'unsupported'];

/** 상태 전이: pending→(answered|cancelled|unsupported), answered→(applied|cancelled). cancelled·applied·unsupported = terminal. */
const TRANSITIONS = {
  pending: new Set(['answered', 'cancelled', 'unsupported']),
  answered: new Set(['applied', 'cancelled']),
  cancelled: new Set(),
  applied: new Set(),
  unsupported: new Set(),
};

/** 응답이 열화 반려 봉투('이 요청은 못 한다')인가 — getStatus 가 answered↔unsupported 를 가르는 판별. */
export function isUnsupportedResponse(res) {
  return !!res && typeof res === 'object' && res.unsupported === true;
}

/** 응답이 B′ 프래그먼트 저작 봉투인가 — {fragment:[…scaffold 개체], afterId?|beforeId?}(id 없는 저작).
 *  ops 봉투(1:1/계획)와 달리, 엔진이 validateAiFragment 게이트 후 단일 insert-section 으로 컴파일한다. */
export function isFragmentResponse(res) {
  return !!res && typeof res === 'object' && Array.isArray(res.fragment);
}

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

/** AI 대상 제외 집합(S4.0, 개체 타입 가드): std-box 만 남는다(ObjectCatalog.AI_EXCLUDED_TYPES,
 *  2026-07-23 2차 델타 — passage-slot 은 해제됨, 아래 assertTargetable 참조). */
export function excludedTypes() {
  return new Set(AI_EXCLUDED_TYPES);
}

/** 타입 가드(§7): 성취기준(std-box) 개체는 AI 액션 대상이 아니다(원칙 3 — 창작 금지, 무변경).
 *  passage-slot 은 3층 정책(2026-07-23 2차 델타)으로 가드에서 해제됐다 — 교사가 명시적으로
 *  요청하면 AI가 지문을 창작·재구성할 수 있다(실존 저작물 원문 재현은 금지, 프롬프트 계약). */
export function assertTargetable(type) {
  const t = String(type || '');
  if (excludedTypes().has(t)) {
    throw new Error(`"${t}" 개체는 AI 액션 대상이 아닙니다 — 성취기준 원문은 보존됩니다(§7, 원칙 3).`);
  }
  return t;
}

/** 단일 블록 페이로드 형태 검증(v1 block · v2 blocks[] 원소 공용). */
function isValidBlock(b) {
  return !!b && typeof b === 'object'
    && typeof b.html === 'string'
    && typeof (b.bt ?? 'content') === 'string';
}

/**
 * v3 요청 원소(개체 ID 에코) 검증: {id, type, ...현재 개체 필드}. 요청은 개체 트리의 현재 개체를
 * 전체 필드째 그대로 담아 보낸다(worksheet-designer 계약 — html 요약이 아니라 스키마 그대로) —
 * 여기서는 프로토콜 최소 불변식(id·type 존재)만 확인하고, 타입별 필드 완전성은 ValidateObjectTree
 * (문서 커밋 시점) 소관으로 남긴다.
 */
function isValidObjectItem(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o)
    && typeof o.id === 'string' && !!o.id
    && typeof o.type === 'string' && !!o.type;
}

/** v3 응답 원소(개체 ID 에코) 검증: {id, object} — object 는 id·type 을 실은 개체 페이로드. */
function isValidEchoItem(e) {
  return !!e && typeof e === 'object'
    && typeof e.id === 'string' && !!e.id
    && !!e.object && typeof e.object === 'object' && !Array.isArray(e.object)
    && typeof e.object.id === 'string' && !!e.object.id
    && typeof e.object.type === 'string' && !!e.object.type;
}

/** 개체 페이로드(응답이 싣는 개체 본문) 최소 형태 — id·type 존재. 타입별 필드 완전성은
 *  ValidateObjectTree(문서 커밋 시점) 소관이다(v3 isValidEchoItem 과 동일 계층 규약). */
function isValidObjectPayload(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o)
    && typeof o.id === 'string' && !!o.id
    && typeof o.type === 'string' && !!o.type;
}

/**
 * v4 응답 op 형태 검증. 여기서는 **프로토콜 형태만** 본다 — "std-box 를 지우려 든다"·"없는
 * afterId 를 가리킨다" 같은 판정은 문서를 알아야 하므로 적용 경로(objectFactory.applyAiOps)의
 * 책임이다(요청 원소 검증이 타입별 완전성을 ValidateObjectTree 로 미루는 것과 같은 계층 규약).
 */
function isValidOpItem(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if (!AI_OPS.includes(o.op)) return false;
  if (o.op === 'delete') return typeof o.id === 'string' && !!o.id;
  if (o.op === 'replace') return typeof o.id === 'string' && !!o.id && isValidObjectPayload(o.object);
  if (o.op === 'insert-section') {
    // 여러 개체를 한 번에 삽입(M3a — AI 섹션 생성). objects[] 각각이 유효 페이로드여야 하고, 위치는
    // afterId/beforeId 중 하나만 허용(insert 와 동일 규약). 타입별 완전성·대상 존재는 적용 경로 소관.
    if (!Array.isArray(o.objects) || o.objects.length === 0 || !o.objects.every(isValidObjectPayload)) return false;
    const hasAfterSec = typeof o.afterId === 'string' && !!o.afterId;
    const hasBeforeSec = typeof o.beforeId === 'string' && !!o.beforeId;
    return !(hasAfterSec && hasBeforeSec);
  }
  // insert: 개체 본문 필수. 위치는 afterId 나 beforeId 중 **하나만** 허용한다 — 둘 다 주면
  // 어느 쪽 기준인지 모호해 조용히 엉뚱한 자리에 꽂히므로 형태 단계에서 거부한다.
  if (!isValidObjectPayload(o.object)) return false;
  const hasAfter = typeof o.afterId === 'string' && !!o.afterId;
  const hasBefore = typeof o.beforeId === 'string' && !!o.beforeId;
  return !(hasAfter && hasBefore);
}

/**
 * v4 요청의 선택 필드(pageId·pageVersion·pageVersions·scope) — 있으면 형태를 강제하고, 없으면 관용한다.
 *
 * pageVersions 는 {pageId: pageVersion} 맵으로, 요청이 **걸친 모든 페이지**의 지문이다(대표 한 장만
 * 재면 여러 쪽에 걸친 선택에서 덮어쓰기를 놓친다). pageId/pageVersion 은 대표 페이지로 계속 남아
 * 하위호환과 CLI 표시를 맡는다.
 */
function hasValidOptionalPageFields(req) {
  if (req.pageId != null && (typeof req.pageId !== 'string' || !req.pageId)) return false;
  if (req.pageVersion != null && (typeof req.pageVersion !== 'string' || !req.pageVersion)) return false;
  if (req.scope != null && !['objects', 'page'].includes(req.scope)) return false;
  if (req.pageVersions != null) {
    if (typeof req.pageVersions !== 'object' || Array.isArray(req.pageVersions)) return false;
    const entries = Object.entries(req.pageVersions);
    if (entries.length === 0) return false; // 빈 맵은 "검사 없음"과 구분되지 않으므로 싣지 않는다
    if (!entries.every(([id, version]) => !!id && typeof version === 'string' && !!version)) return false;
  }
  return true;
}

export function validateRequest(req) {
  if (!req || typeof req !== 'object') return false;
  if (!AI_SCHEMA_VERSIONS.has(req.schemaVersion)) return false;
  if (typeof req.id !== 'string' || !req.id) return false;
  if (typeof req.docName !== 'string' || !req.docName) return false;
  if (!AI_ACTIONS.includes(req.action)) return false;
  if (!AI_STATUSES.includes(req.status ?? 'pending')) return false;
  // 형태-버전 정합: v1 = 단일 block 필수, v2 = 비어있지 않은 blocks[] 필수,
  // v3·v4 = 비어있지 않은 objects[](개체 ID 에코) 필수. v4 는 pageId·pageVersion·scope 를
  // 선택적으로 더 싣는다(있으면 형태 강제 — 요청 형태가 바뀌는 건 응답이 아니라 이쪽뿐이다).
  if (req.schemaVersion === 1) return isValidBlock(req.block);
  if (req.schemaVersion === 2) return Array.isArray(req.blocks) && req.blocks.length > 0 && req.blocks.every(isValidBlock);
  if (req.schemaVersion === 4 && !hasValidOptionalPageFields(req)) return false;
  if (!Array.isArray(req.objects)) return false;
  // B1 프래그먼트 저작 요청(context.intent:'author-section')은 대상 개체가 없을 수 있다 — 빈 페이지에
  // 첫 섹션을 저작하는 경우. 여기서 objects 는 "고칠 대상"이 아니라 문맥일 뿐이라 비어 있어도 유효하다.
  // (rewrite 요청은 그대로 비어있지 않은 objects[] 를 강제한다 — 무엇을 고칠지 알아야 하므로.)
  if (req.objects.length === 0) return req.context?.intent === 'author-section';
  return req.objects.every(isValidObjectItem);
}

/**
 * B′ 프래그먼트 봉투 형태 검증(프로토콜 최소 불변식만 — 개체 구조·좌표·HTML 의 결정 검증은
 * 적용 경로의 validateAiFragment/prepareAiFragment 소관, isValidOpItem 이 타입별 완전성을
 * applyAiOps 로 미루는 것과 같은 계층 규약). 여기서는 비어있지 않은 개체 배열 + anchor(afterId|beforeId
 * 동시 금지)만 본다. 개체는 id 없는 저작(엔진이 발급)이라 op 봉투의 id 요구를 적용하지 않는다.
 */
function isValidFragmentEnvelope(res) {
  if (!Array.isArray(res.fragment) || res.fragment.length === 0) return false;
  if (!res.fragment.every((o) => !!o && typeof o === 'object' && !Array.isArray(o) && typeof o.type === 'string' && !!o.type)) return false;
  const hasAfter = typeof res.afterId === 'string' && !!res.afterId;
  const hasBefore = typeof res.beforeId === 'string' && !!res.beforeId;
  return !(hasAfter && hasBefore);
}

export function validateResponse(res) {
  if (!res || typeof res !== 'object') return false;
  if (!AI_SCHEMA_VERSIONS.has(res.schemaVersion)) return false;
  if (typeof res.id !== 'string' || !res.id) return false;
  // 열화 반려(M5): ops/objects 대신 unsupported:true + reason(사용자에게 보일 사유). ops 요구를 우회한다
  // — 구독 AI 가 "합칠 수 없는 지시"·"어휘 초과"를 조용히 무응답으로 두지 않고 명시적으로 돌려보낸다.
  if (res.unsupported === true) return typeof res.reason === 'string' && !!res.reason.trim();
  // B′ 프래그먼트 저작 봉투(전송 계층) — 개체 결정 검증은 적용 경로가 한다(ADR-bspike-ai-fragment.md).
  if (Array.isArray(res.fragment)) return isValidFragmentEnvelope(res);
  // v1 = 단일 html, v2 = blocks[{slot:정수≥0, html:비어있지 않음}], v3 = objects[{id,object}],
  // v4 = ops[{op,…}](개수·종류가 자유로운 계획).
  if (res.schemaVersion === 1) return typeof res.html === 'string' && !!res.html.trim();
  if (res.schemaVersion === 2) {
    return Array.isArray(res.blocks) && res.blocks.length > 0 && res.blocks.every((b) =>
      !!b && typeof b === 'object'
      && Number.isInteger(b.slot) && b.slot >= 0
      && typeof b.html === 'string' && !!b.html.trim());
  }
  if (res.schemaVersion === 4) {
    return Array.isArray(res.ops) && res.ops.length > 0 && res.ops.every(isValidOpItem);
  }
  return Array.isArray(res.objects) && res.objects.length > 0 && res.objects.every(isValidEchoItem);
}
