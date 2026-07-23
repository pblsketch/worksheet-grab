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
// validateRequest/validateResponse 는 schemaVersion∈{1,2,3} 를 관용하고 형태-버전 정합만 강제한다.
export const AI_SCHEMA_VERSION = 3;
export const AI_SCHEMA_VERSIONS = new Set([1, 2, 3]);
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

export function validateRequest(req) {
  if (!req || typeof req !== 'object') return false;
  if (!AI_SCHEMA_VERSIONS.has(req.schemaVersion)) return false;
  if (typeof req.id !== 'string' || !req.id) return false;
  if (typeof req.docName !== 'string' || !req.docName) return false;
  if (!AI_ACTIONS.includes(req.action)) return false;
  if (!AI_STATUSES.includes(req.status ?? 'pending')) return false;
  // 형태-버전 정합: v1 = 단일 block 필수, v2 = 비어있지 않은 blocks[] 필수,
  // v3 = 비어있지 않은 objects[](개체 ID 에코) 필수.
  if (req.schemaVersion === 1) return isValidBlock(req.block);
  if (req.schemaVersion === 2) return Array.isArray(req.blocks) && req.blocks.length > 0 && req.blocks.every(isValidBlock);
  return Array.isArray(req.objects) && req.objects.length > 0 && req.objects.every(isValidObjectItem);
}

export function validateResponse(res) {
  if (!res || typeof res !== 'object') return false;
  if (!AI_SCHEMA_VERSIONS.has(res.schemaVersion)) return false;
  if (typeof res.id !== 'string' || !res.id) return false;
  // v1 = 단일 html, v2 = blocks[{slot:정수≥0, html:비어있지 않음}], v3 = objects[{id,object}].
  if (res.schemaVersion === 1) return typeof res.html === 'string' && !!res.html.trim();
  if (res.schemaVersion === 2) {
    return Array.isArray(res.blocks) && res.blocks.length > 0 && res.blocks.every((b) =>
      !!b && typeof b === 'object'
      && Number.isInteger(b.slot) && b.slot >= 0
      && typeof b.html === 'string' && !!b.html.trim());
  }
  return Array.isArray(res.objects) && res.objects.length > 0 && res.objects.every(isValidEchoItem);
}
