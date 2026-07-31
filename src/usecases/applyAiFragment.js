// applyAiFragment — B′ 저작 경로의 준비 단계(순수, Node 안전). 결정문 docs/ADR-bspike-ai-fragment.md
// 의 권고("검증 계층을 채택하되 insert-section 프로토콜은 전송 계층으로 유지")를 실제 코드로 배선한다.
//
// 흐름: 제약 AI 가 저작한 **scaffold·flow-only 프래그먼트(JSON)** →
//   1) validateAiFragment 결정 검증(좌표·id·조판·답안·미허용 HTML 거부 — B′ 게이트).
//   2) compileFragmentToInsertSection: 엔진 id·placement:'flow' 주입, 순서 보존, anchor 필수,
//      요청시점 pageVersions 바인딩(적용 직전 stale 대조용).
//   3) **구조 floor**: 컴파일 개체를 validateObjectShape 로 한 번 더 검사한다(ADR §10.1 — applyAiOps
//      가 개체 스키마를 검증하지 않으므로, 프래그먼트 경로가 malformed 개체를 흘리지 않도록 방어).
// 산출은 단일 `insert-section` op 로, 기존 적용 엔진(objectFactory.applyAiOps)이 그대로 소비한다
// (이 모듈은 objectFactory 를 import 하지 않는다 — 순수·Node 테스트 가능. 실제 적용은 호출부 몫).

import {
  validateAiFragment, compileFragmentToInsertSection, validateObjectShape,
} from '../domain/schema/index.js';

/** findings 를 사람에게 보일 짧은 사유로 접는다(조용한 실패 금지 — 사용자에게 왜 막혔는지 보인다). */
export function fragmentBlockReason(findings, prefix = 'AI 프래그먼트를 적용할 수 없습니다') {
  const msgs = [];
  for (const f of findings || []) {
    const m = f.path ? `${f.message} (${f.path})` : f.message;
    if (m && !msgs.includes(m)) msgs.push(m);
    if (msgs.length >= 3) break;
  }
  const more = (findings?.length || 0) > msgs.length ? ` 외 ${findings.length - msgs.length}건` : '';
  return `${prefix}: ${msgs.join(' / ')}${more}`;
}

/**
 * B′ 프래그먼트를 검증·컴파일해 적용 가능한 단일 insert-section op 를 만든다(적용은 하지 않는다).
 * @param {Array<object>|{objects:Array<object>}} fragment 제약 AI 가 저작한 scaffold 개체 배열.
 * @param {{
 *   ctx?: {allowPassageContent?:boolean},
 *   anchor?: {afterId?:string, beforeId?:string},
 *   requestPageVersions?: object|null,
 *   genId?: ()=>string,
 * }} [opts]
 * @returns {{ok:true, op:object, requestPageVersions:object|null}
 *          | {ok:false, stage:'validate'|'anchor'|'shape', findings:object[], blockReason:string}}
 */
export function prepareAiFragment(fragment, opts = {}) {
  const { ctx = {}, anchor = {}, requestPageVersions = null, genId } = opts;

  // 1) B′ 결정 검증.
  const v = validateAiFragment(fragment, ctx);
  if (!v.ok) {
    return { ok: false, stage: 'validate', findings: v.findings, blockReason: fragmentBlockReason(v.findings) };
  }

  // 2) 단일 insert-section 컴파일(anchor 필수 — 없으면 문서 말미로 새는 것을 막는다).
  let compiled;
  try {
    compiled = compileFragmentToInsertSection(v.objects, { anchor, pageVersions: requestPageVersions, genId });
  } catch (e) {
    const findings = [{ rule: 'anchor-required', message: e.message }];
    return { ok: false, stage: 'anchor', findings, blockReason: fragmentBlockReason(findings) };
  }

  // 3) 구조 floor — 컴파일 개체가 닫힌 카탈로그 구조를 만족하는지(applyAiOps 미검증분 방어).
  const shapeFindings = [];
  for (const o of compiled.op.objects) {
    const s = validateObjectShape(o);
    if (!s.ok) shapeFindings.push(...s.findings.map((f) => ({ ...f, objectType: o.type })));
  }
  if (shapeFindings.length) {
    return { ok: false, stage: 'shape', findings: shapeFindings, blockReason: fragmentBlockReason(shapeFindings) };
  }

  return { ok: true, op: compiled.op, requestPageVersions: compiled.requestPageVersions };
}
