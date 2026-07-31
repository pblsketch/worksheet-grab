import {
  OBJECT_TYPES, QUESTION_TYPES, PLACEMENTS, TYPE_SPECS, AI_EXCLUDED_TYPES,
  SIZE_FIELDS, ALIGN_VALUES, WIDTH_PCT_MIN, WIDTH_PCT_MAX, ORGANIZER_KINDS,
} from './ObjectCatalog.js';

// validateObjectShape — 개체 하나의 구조 유효성(닫힌 카탈로그 + 공통 불변식)을 순수 검사한다.
// FS/DOM/Chrome 무접촉 — ValidateObjectTree(usecase)가 트리 순회 중 개체마다 위임 호출한다.
//
// rule 코드:
//   unknown-type              — type 이 닫힌 카탈로그(13종) 밖
//   unknown-placement         — placement 가 flow|float 밖
//   placement-not-allowed     — 해당 타입이 허용하지 않는 placement(예: title 에 float)
//   rect-forbidden-in-flow    — placement:'flow' 인데 rect 존재(AI 는 구조만, 좌표는 만들지 않는다 — 원칙 3)
//   rect-required-in-float    — placement:'float' 인데 rect 부재/불완전
//   missing-field             — 타입별 필수 필드 누락
//   slot-invariant            — std-box/passage-slot(AI 대상 제외 슬롯)에 **카탈로그 밖** 필드(슬롯 변조).
//                                카탈로그가 이미 허용한 필드(passage-slot 의 title/bodyHtml/source/
//                                footnotes)는 교사가 편집기에서 직접 입력·수정할 수 있어 이 규칙의 대상이
//                                아니다(AI 는 aiBridge 타입 가드로 애초에 요청 대상에서 제외된다, §7·§10).
//   unknown-field             — 그 외 타입에 카탈로그 밖 필드(answer 위치 규칙 위반도 여기 포함 — 허용 안 된
//                                타입에 answer:true 를 실으면 카탈로그 밖 필드로 잡힌다)
//   invalid-qtype             — question.qtype 이 7종 밖
//   table-splittable-violation — table.splittable !== false(표는 분할 금지)
//   invalid-organizer-kind    — organizer.kind 가 ORGANIZER_KINDS(조직자 종류) 밖
//   size-forbidden-in-float   — placement:'float' 인데 크기 필드(SIZE_FIELDS) 존재. float 은 rect 가 이미
//                                크기를 가지므로 한 가지 일에 수단을 둘 두지 않는다(rect-forbidden-in-flow 의 짝).
//   invalid-size-value        — widthPct/minHeightMm/align 값이 허용 범위 밖

// id/type/placement/rect(구조) + opacity/angle(자유 배치 표현 속성 — 전 타입 허용하되 렌더는 float
// 에서만 적용, RenderObjectTree.renderFloatObject 참조). 표현값이라 슬롯 불변식(std-box)과 무관하다.
const ALWAYS_ALLOWED_FIELDS = Object.freeze(['id', 'type', 'placement', 'rect', 'opacity', 'angle']);

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidRect(rect) {
  return isPlainObject(rect)
    && ['xMm', 'yMm', 'wMm', 'hMm'].every((k) => typeof rect[k] === 'number' && Number.isFinite(rect[k]));
}

/** @param {object} obj 개체 하나(문서 pages[].flow[]/float[] 원소) @returns {{ok:boolean, findings:object[]}} */
export function validateObjectShape(obj) {
  if (!isPlainObject(obj)) {
    return { ok: false, findings: [{ rule: 'invalid-object', message: '개체는 object 여야 합니다.' }] };
  }

  const findings = [];
  const { type, placement } = obj;

  if (!OBJECT_TYPES.includes(type)) {
    findings.push({ rule: 'unknown-type', message: `닫힌 카탈로그(14종) 밖의 타입입니다: ${type}`, objectId: obj.id ?? null });
    return { ok: false, findings }; // 타입 미상이면 이후 필드별 검사가 무의미하다.
  }

  const spec = TYPE_SPECS[type];

  if (!PLACEMENTS.includes(placement)) {
    findings.push({ rule: 'unknown-placement', message: `placement 는 flow|float 여야 합니다: ${placement}`, objectId: obj.id });
  } else if (!spec.placements.includes(placement)) {
    findings.push({
      rule: 'placement-not-allowed',
      message: `${type} 는 placement:'${placement}' 를 허용하지 않습니다(허용: ${spec.placements.join('|')}).`,
      objectId: obj.id,
    });
  } else if (placement === 'flow' && obj.rect !== undefined) {
    findings.push({
      rule: 'rect-forbidden-in-flow',
      message: "placement:'flow' 개체는 rect(좌표)를 가질 수 없습니다(AI 는 구조만, 좌표는 만들지 않는다 — 원칙 3).",
      objectId: obj.id,
    });
  } else if (placement === 'float' && !isValidRect(obj.rect)) {
    findings.push({
      rule: 'rect-required-in-float',
      message: "placement:'float' 개체는 유효한 rect{xMm,yMm,wMm,hMm}(number)가 필수입니다.",
      objectId: obj.id,
    });
  }

  for (const field of spec.required) {
    if (obj[field] === undefined) {
      findings.push({ rule: 'missing-field', message: `${type} 는 필수 필드 '${field}' 가 없습니다.`, objectId: obj.id });
    }
  }

  const allowedFields = new Set([...ALWAYS_ALLOWED_FIELDS, ...spec.required, ...spec.optional]);
  for (const key of Object.keys(obj)) {
    if (allowedFields.has(key)) continue;
    if (AI_EXCLUDED_TYPES.includes(type)) {
      findings.push({
        rule: 'slot-invariant',
        message: `${type}(AI 대상 제외 슬롯)에 허용되지 않은 필드 '${key}' 가 있습니다 — 슬롯 변조 의심.`,
        objectId: obj.id,
      });
    } else {
      findings.push({ rule: 'unknown-field', message: `${type} 에 허용되지 않은 필드 '${key}' 가 있습니다.`, objectId: obj.id });
    }
  }

  // 크기·정렬 필드(2026-07-28) — flow 전용 + 값 범위. 카탈로그가 허용하지 않는 타입(shape/spacer/
  // page-break)에 실린 경우는 위의 unknown-field 검사가 이미 잡으므로 여기서는 중복 검사하지 않는다.
  if (SIZE_FIELDS.some((f) => obj[f] !== undefined)) {
    if (placement === 'float') {
      findings.push({
        rule: 'size-forbidden-in-float',
        message: `placement:'float' 개체는 크기 필드(${SIZE_FIELDS.join('/')})를 가질 수 없습니다 — 크기는 rect 가 정합니다.`,
        objectId: obj.id,
      });
    }
    const pct = obj.widthPct;
    if (pct !== undefined && !(typeof pct === 'number' && Number.isFinite(pct) && pct >= WIDTH_PCT_MIN && pct <= WIDTH_PCT_MAX)) {
      findings.push({
        rule: 'invalid-size-value',
        message: `widthPct 는 ${WIDTH_PCT_MIN}~${WIDTH_PCT_MAX} 범위의 수여야 합니다: ${pct}`,
        objectId: obj.id,
      });
    }
    const minH = obj.minHeightMm;
    if (minH !== undefined && !(typeof minH === 'number' && Number.isFinite(minH) && minH > 0)) {
      findings.push({
        rule: 'invalid-size-value',
        message: `minHeightMm 는 0 보다 큰 수여야 합니다: ${minH}`,
        objectId: obj.id,
      });
    }
    if (obj.align !== undefined && !ALIGN_VALUES.includes(obj.align)) {
      findings.push({
        rule: 'invalid-size-value',
        message: `align 은 ${ALIGN_VALUES.join('|')} 중 하나여야 합니다: ${obj.align}`,
        objectId: obj.id,
      });
    }
  }

  if (type === 'question' && obj.qtype !== undefined && !QUESTION_TYPES.includes(obj.qtype)) {
    findings.push({ rule: 'invalid-qtype', message: `question.qtype 이 7종 밖입니다: ${obj.qtype}`, objectId: obj.id });
  }

  if (type === 'table' && obj.splittable !== undefined && obj.splittable !== false) {
    findings.push({ rule: 'table-splittable-violation', message: '표는 분할할 수 없습니다(splittable 은 항상 false).', objectId: obj.id });
  }

  // organizer.kind 는 닫힌 집합(ORGANIZER_KINDS) 안이어야 한다(question.qtype·table.splittable 과 동형
  // per-type 의미 규칙). params/labels 내부는 검사하지 않는다 — 엔진(OrganizerGen)이 clamp·해석하고,
  // table rows/cell 을 검사하지 않는 것과 같은 경계다(validator 는 top-level 계약만 본다).
  if (type === 'organizer' && obj.kind !== undefined && !ORGANIZER_KINDS.includes(obj.kind)) {
    findings.push({ rule: 'invalid-organizer-kind', message: `organizer.kind 이 알려진 조직자 종류 밖입니다: ${obj.kind}`, objectId: obj.id });
  }

  return { ok: findings.length === 0, findings };
}
