// validateAiFragment — B′ 스파이크의 핵심 산출물. 제약 AI 에이전트가 저작한 **scaffold·flow-only
// 객체트리 프래그먼트(JSON)** 를 **결정적으로** 게이트한다(순수, Node 안전, 의존성 0).
//
// 왜 필요한가: 현행 "AI 는 HTML·좌표·조판을 만들지 않는다"는 **프롬프트 정책일 뿐** 코드로
// 강제되지 않는다(ObjectCatalog 는 float/rect/HTML/SIZE 를 정상 어휘로 허용, validateObjectShape 는
// opacity/angle 를 전 타입 통과시킴 — src/domain/schema/validateObjectShape.js:30). B′ 는 그 정책을
// **프래그먼트 전체 구조로 확장**해 코드로 강제할 수 있는지 실증한다.
//
// 설계 원칙(codex 적대 리뷰 §2·§5~§7 반영):
//   1. 조용한 삭제 금지 — 금지 요소가 하나라도 있으면 **프래그먼트 전체 반려**(부분 스트립은
//      "공격 100% 거부" 지표를 거짓으로 만든다).
//   2. 중첩까지 결정적 — 최상위 필드뿐 아니라 choices/rows/meta 등 중첩 객체의 타입·enum·추가필드까지.
//   3. HTML 은 지정된 5위치만, htmlAllowlist 로 토큰 검증. 승인된 HTML 은 원문 그대로라 preview==apply.
//   4. 답안 미생성(결정 (a), ADR 참조) — answer/answerKey 는 구조적으로 거부. 답안은 별도 경로.
//   5. id/placement 미저작 — 컴파일러가 발급/주입. 좌표·SIZE·표현속성 전면 거부.
//
// 반환: { ok, findings:[{rule, path, message, detail?}], objects? } (ok 면 승인된 개체 배열 동봉).

import { CALLOUT_VARIANTS, QUESTION_TYPES, ORGANIZER_KINDS } from './ObjectCatalog.js';
import { validateHtmlField } from './htmlAllowlist.js';

/** AI 가 저작 가능한 타입(10종). std-box(원문 불변)·shape(float 전용)·spacer/page-break(조판 어휘)는 제외.
 *  organizer(P3, 편집 가능 그림형 조직자)는 kind·개수·슬롯 글자만 저작하고 좌표·도형은 엔진 소유(원칙 3). */
export const AI_AUTHORABLE_TYPES = Object.freeze([
  'title', 'passage-slot', 'question', 'table', 'image-slot', 'answer-area', 'divider', 'richtext', 'callout', 'organizer',
]);
const FORBIDDEN_TYPES = Object.freeze(['std-box', 'shape', 'spacer', 'page-break']);

/** HTML 이 허용되는 5위치(type→field→profile). answerKey.html 은 답안 미생성 결정으로 제외. */
export const HTML_POSITIONS = Object.freeze({
  'passage-slot': { bodyHtml: 'block' },
  'richtext': { html: 'block' },
  'callout': { body: 'block' },
  'title': { textHtml: 'inline' },
  'question': { promptHtml: 'inline' },
});

// 명시적 거부 키 → 규칙(거부 매트릭스의 명확성 — unknown-field 로 뭉뚱그리지 않는다).
const FORBIDDEN_KEY_RULES = Object.freeze({
  id: 'forbidden-id',                 // ID 는 컴파일러가 발급(최상위만 — 중첩 id 는 정상)
  placement: 'forbidden-placement',   // 컴파일러가 flow 주입
  rect: 'forbidden-coordinate', xMm: 'forbidden-coordinate', yMm: 'forbidden-coordinate',
  wMm: 'forbidden-coordinate', hMm: 'forbidden-coordinate',
  opacity: 'forbidden-transform', angle: 'forbidden-transform',
  widthPct: 'forbidden-size', minHeightMm: 'forbidden-size', align: 'forbidden-size',
  pagination: 'forbidden-page-authoring', pages: 'forbidden-page-authoring',
  page: 'forbidden-page-authoring', pageId: 'forbidden-page-authoring',
  pageIndex: 'forbidden-page-authoring', role: 'forbidden-page-authoring',
  flow: 'forbidden-page-authoring', float: 'forbidden-page-authoring',
  answer: 'forbidden-answer', answerKey: 'forbidden-answer',
  borderColor: 'forbidden-presentation', borderWidth: 'forbidden-presentation',
  bgColor: 'forbidden-presentation', strokeColor: 'forbidden-presentation',
  fillColor: 'forbidden-presentation', strokeWidth: 'forbidden-presentation',
  dash: 'forbidden-presentation', sourceType: 'forbidden-presentation',
  titleHtml: 'forbidden-html-position', // callout 은 title 평문만 — titleHtml 은 허용 5위치 밖
});

function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function isStr(v) { return typeof v === 'string'; }
function isInt(v) { return Number.isInteger(v); }
function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

/** 한 개체의 허용 필드 명세(값 검증기 포함). type 은 판별자라 별도. id/placement 는 컴파일러 몫이라 부재. */
const TYPE_FIELDS = {
  'title': {
    required: ['text'],
    fields: {
      text: (v) => isStr(v) || 'text 는 문자열이어야 합니다',
      level: (v) => v === 1 || v === 2 || 'level 은 1 또는 2 여야 합니다',
      textHtml: 'html',
      meta: 'meta',
    },
  },
  'passage-slot': {
    required: ['slotLabel'],
    fields: {
      slotLabel: (v) => isStr(v) || 'slotLabel 은 문자열이어야 합니다',
      title: (v) => isStr(v) || 'title 은 문자열이어야 합니다',
      source: (v) => isStr(v) || 'source 는 문자열이어야 합니다',
      footnotes: (v) => (Array.isArray(v) && v.every(isStr)) || 'footnotes 는 문자열 배열이어야 합니다',
      bodyHtml: 'html-gated', // allowPassageContent 권한 필요
    },
  },
  'question': {
    required: ['qtype', 'prompt'],
    fields: {
      qtype: (v) => QUESTION_TYPES.includes(v) || `qtype 이 7종 밖입니다: ${v}`,
      prompt: (v) => isStr(v) || 'prompt 는 문자열이어야 합니다',
      promptHtml: 'html',
      qnum: (v) => v === null || isStr(v) || 'qnum 은 문자열 또는 null 이어야 합니다',
      lines: (v) => (isInt(v) && v >= 0) || 'lines 는 0 이상의 정수여야 합니다',
      choices: 'itemsWithText', blanks: 'blanks',
      left: 'itemsWithText', right: 'itemsWithText', items: 'itemsWithText',
    },
  },
  'table': {
    required: ['splittable', 'rows'],
    fields: {
      splittable: (v) => v === false || 'splittable 은 항상 false 여야 합니다(표는 분할 금지)',
      rows: 'rows',
      caption: (v) => isStr(v) || 'caption 은 문자열이어야 합니다',
      headerRows: (v) => (isInt(v) && v >= 0) || 'headerRows 는 0 이상의 정수여야 합니다',
      headerCol: (v) => typeof v === 'boolean' || 'headerCol 은 boolean 이어야 합니다',
    },
  },
  'image-slot': {
    required: [],
    fields: {
      alt: (v) => isStr(v) || 'alt 는 문자열이어야 합니다',
      caption: (v) => isStr(v) || 'caption 은 문자열이어야 합니다',
      // src 는 FORBIDDEN_KEY_RULES 밖이지만 image-slot 전용 거부 — 아래 validateOne 에서 특수 처리.
    },
  },
  'answer-area': {
    required: ['style'],
    fields: {
      style: (v) => ['line', 'box', 'dots'].includes(v) || `style 는 line|box|dots 여야 합니다: ${v}`,
      lines: (v) => (isInt(v) && v >= 1) || 'lines 는 1 이상의 정수여야 합니다',
      label: (v) => isStr(v) || 'label 은 문자열이어야 합니다',
    },
  },
  'divider': { required: [], fields: {} },
  'richtext': {
    required: ['html'],
    fields: { html: 'html' },
  },
  'callout': {
    required: ['variant', 'body'],
    fields: {
      variant: (v) => CALLOUT_VARIANTS.includes(v) || `variant 이 ${CALLOUT_VARIANTS.join('|')} 밖입니다: ${v}`,
      title: (v) => isStr(v) || 'title 은 문자열이어야 합니다',
      body: 'html',
    },
  },
  // 편집 가능 그림형 조직자(P3) — AI 는 kind(종류)·params(개수)·labels(슬롯 글자)만 저작한다. 좌표·도형은
  // 엔진(OrganizerGen)이 그린다(원칙 3): rect·개별좌표는 FORBIDDEN_KEY_RULES 가 이미 막고, params 는 엔진이
  // 종류별 범위로 clamp, labels 값은 엔진이 escText 로 이스케이프하며 모르는 슬롯 키는 무시한다. 그래서
  // params/labels 는 "안전한 스칼라 맵"(정수/문자열)으로만 검증한다 — 엔진이 sanitizer 다. answer·HTML 은
  // 조직자에 없다(HTML_POSITIONS 밖 → html 계열 필드는 unknown-field 로 거부).
  'organizer': {
    required: ['kind'],
    fields: {
      kind: (v) => ORGANIZER_KINDS.includes(v) || `kind 이 조직자 종류(${ORGANIZER_KINDS.join('|')}) 밖입니다: ${v}`,
      params: 'organizerParams',
      labels: 'organizerLabels',
    },
  },
};

/** 중첩 {id?, text} 원소 배열(choices/left/right/items) — text 필수, id 선택(중첩 id 는 정상). */
function validateItemsWithText(arr, path, findings) {
  if (!Array.isArray(arr)) { findings.push({ rule: 'nested-shape', path, message: '배열이어야 합니다.' }); return; }
  arr.forEach((it, idx) => {
    const p = `${path}[${idx}]`;
    if (!isPlainObject(it)) { findings.push({ rule: 'nested-shape', path: p, message: '원소는 객체여야 합니다.' }); return; }
    if (!isStr(it.text)) findings.push({ rule: 'nested-shape', path: p, message: "'text'(문자열) 가 필요합니다." });
    for (const k of Object.keys(it)) {
      if (k !== 'text' && k !== 'id') findings.push({ rule: 'nested-additional', path: `${p}.${k}`, message: `허용되지 않은 중첩 필드 '${k}'.` });
      if (k === 'id' && !isStr(it.id)) findings.push({ rule: 'nested-shape', path: `${p}.id`, message: 'id 는 문자열이어야 합니다.' });
    }
  });
}

/** fill-blank 의 blanks — {id} 필수(빈칸 토큰 id, 중첩이라 정상). */
function validateBlanks(arr, path, findings) {
  if (!Array.isArray(arr)) { findings.push({ rule: 'nested-shape', path, message: '배열이어야 합니다.' }); return; }
  arr.forEach((it, idx) => {
    const p = `${path}[${idx}]`;
    if (!isPlainObject(it)) { findings.push({ rule: 'nested-shape', path: p, message: '원소는 객체여야 합니다.' }); return; }
    if (!isStr(it.id)) findings.push({ rule: 'nested-shape', path: p, message: "'id'(문자열) 가 필요합니다." });
    for (const k of Object.keys(it)) {
      if (k !== 'id') findings.push({ rule: 'nested-additional', path: `${p}.${k}`, message: `허용되지 않은 중첩 필드 '${k}'.` });
    }
  });
}

/** table.rows — 배열의 배열, 셀 {text?, colspan?, header?}. 그 외 셀 필드 거부. */
function validateRows(rows, path, findings) {
  if (!Array.isArray(rows)) { findings.push({ rule: 'nested-shape', path, message: 'rows 는 배열이어야 합니다.' }); return; }
  rows.forEach((row, r) => {
    if (!Array.isArray(row)) { findings.push({ rule: 'nested-shape', path: `${path}[${r}]`, message: '행은 배열이어야 합니다.' }); return; }
    row.forEach((cell, c) => {
      const p = `${path}[${r}][${c}]`;
      if (!isPlainObject(cell)) { findings.push({ rule: 'nested-shape', path: p, message: '셀은 객체여야 합니다.' }); return; }
      for (const k of Object.keys(cell)) {
        if (k === 'text') { if (!isStr(cell.text)) findings.push({ rule: 'nested-shape', path: `${p}.text`, message: 'text 는 문자열이어야 합니다.' }); }
        else if (k === 'colspan') { if (!(isInt(cell.colspan) && cell.colspan >= 1)) findings.push({ rule: 'nested-shape', path: `${p}.colspan`, message: 'colspan 은 1 이상의 정수여야 합니다.' }); }
        else if (k === 'header') { if (typeof cell.header !== 'boolean') findings.push({ rule: 'nested-shape', path: `${p}.header`, message: 'header 는 boolean 이어야 합니다.' }); }
        else findings.push({ rule: 'nested-additional', path: `${p}.${k}`, message: `허용되지 않은 셀 필드 '${k}'.` });
      }
    });
  });
}

/** organizer.params — 개수 파라미터 맵. 값은 작은 양의 정수만(엔진이 종류별 범위로 clamp). 키는 종류별로
 *  다르고 엔진이 모르는 키를 무시하므로 제한하지 않는다 — 좌표가 될 수 없는 스칼라 맵임을 보장한다. */
function validateOrganizerParams(v, path, findings) {
  if (!isPlainObject(v)) { findings.push({ rule: 'nested-shape', path, message: 'params 는 객체여야 합니다.' }); return; }
  for (const k of Object.keys(v)) {
    if (!(isInt(v[k]) && v[k] >= 1 && v[k] <= 20)) findings.push({ rule: 'nested-shape', path: `${path}.${k}`, message: `params.${k} 는 1~20 정수여야 합니다(엔진이 종류별 범위로 clamp).` });
  }
}

/** organizer.labels — 슬롯 이름→글자 맵. 값은 문자열만(엔진이 이스케이프). 키는 엔진이 모르면 무시하므로
 *  제한하지 않는다 — 주입 벡터가 될 수 없는 문자열 맵임을 보장한다. */
function validateOrganizerLabels(v, path, findings) {
  if (!isPlainObject(v)) { findings.push({ rule: 'nested-shape', path, message: 'labels 는 객체여야 합니다.' }); return; }
  for (const k of Object.keys(v)) {
    if (!isStr(v[k])) findings.push({ rule: 'nested-shape', path: `${path}.${k}`, message: `labels.${k} 는 문자열이어야 합니다.` });
  }
}

/** title.meta — {pill?, page?, source?} 닫힌 형태. */
function validateMeta(meta, path, findings) {
  if (!isPlainObject(meta)) { findings.push({ rule: 'nested-shape', path, message: 'meta 는 객체여야 합니다.' }); return; }
  for (const k of Object.keys(meta)) {
    if (['pill', 'page', 'source'].includes(k)) { if (!isStr(meta[k])) findings.push({ rule: 'nested-shape', path: `${path}.${k}`, message: `${k} 는 문자열이어야 합니다.` }); }
    else findings.push({ rule: 'nested-additional', path: `${path}.${k}`, message: `허용되지 않은 meta 필드 '${k}'.` });
  }
}

/** 개체 하나를 검증. findings 에 위반을 누적한다(조기 반환하지 않고 최대한 모아 보고). */
function validateOne(obj, index, ctx, findings) {
  const path = `[${index}]`;
  if (!isPlainObject(obj)) { findings.push({ rule: 'invalid-object', path, message: '개체는 객체여야 합니다.' }); return; }

  const type = obj.type;
  if (FORBIDDEN_TYPES.includes(type)) {
    findings.push({ rule: 'forbidden-type', path, message: `AI 저작 불가 타입입니다: ${type} (std-box/shape/spacer/page-break).`, detail: type });
    return;
  }
  if (!AI_AUTHORABLE_TYPES.includes(type)) {
    findings.push({ rule: 'unknown-type', path, message: `닫힌 카탈로그 밖 또는 미상 타입: ${type}`, detail: String(type) });
    return;
  }

  const spec = TYPE_FIELDS[type];
  const htmlPositions = HTML_POSITIONS[type] || {};

  for (const key of Object.keys(obj)) {
    if (key === 'type') continue;
    const p = `${path}.${key}`;

    // image-slot.src 전용 거부(원격 URL·구운 정답·경로 탈출을 fragment validator 가 판정 불가).
    if (type === 'image-slot' && key === 'src') {
      findings.push({ rule: 'forbidden-image-src', path: p, message: 'image-slot.src 는 AI 가 저작할 수 없습니다(검증된 로컬 자산 토큰 주입 경로 없음).' });
      continue;
    }
    // 명시적 거부 키.
    if (FORBIDDEN_KEY_RULES[key]) {
      findings.push({ rule: FORBIDDEN_KEY_RULES[key], path: p, message: `AI 저작 금지 필드 '${key}' (${FORBIDDEN_KEY_RULES[key]}).`, detail: key });
      continue;
    }
    // 타입 허용 필드가 아니면 unknown.
    const validator = spec.fields[key];
    if (!validator) {
      findings.push({ rule: 'unknown-field', path: p, message: `${type} 에 허용되지 않은 필드 '${key}'.`, detail: key });
      continue;
    }

    const val = obj[key];
    // HTML 필드.
    if (validator === 'html' || validator === 'html-gated') {
      if (validator === 'html-gated' && !ctx.allowPassageContent) {
        findings.push({ rule: 'passage-content-denied', path: p, message: `${type}.${key} 는 allowPassageContent 권한이 있어야 저작할 수 있습니다(저작권 경계).` });
        continue;
      }
      const profile = htmlPositions[key] || 'block';
      const r = validateHtmlField(val, profile);
      if (!r.ok) findings.push({ rule: `html-${r.rule}`, path: p, message: `${key}: ${r.message}`, detail: r.detail });
      continue;
    }
    // 중첩 구조 검증기.
    if (validator === 'itemsWithText') { validateItemsWithText(val, p, findings); continue; }
    if (validator === 'blanks') { validateBlanks(val, p, findings); continue; }
    if (validator === 'rows') { validateRows(val, p, findings); continue; }
    if (validator === 'meta') { validateMeta(val, p, findings); continue; }
    if (validator === 'organizerParams') { validateOrganizerParams(val, p, findings); continue; }
    if (validator === 'organizerLabels') { validateOrganizerLabels(val, p, findings); continue; }
    // 스칼라 검증기(함수).
    const res = validator(val);
    if (res !== true) findings.push({ rule: 'invalid-value', path: p, message: `${key}: ${res}`, detail: key });
  }

  // 필수 필드.
  for (const req of spec.required) {
    if (obj[req] === undefined) findings.push({ rule: 'missing-field', path: `${path}.${req}`, message: `${type} 는 필수 필드 '${req}' 가 없습니다.`, detail: req });
  }

  // 평문 정합(codex #6): textHtml↔text, promptHtml↔prompt 가 다르면 렌더는 HTML·검사기는 평문을 보아
  // 내용이 어긋난다. 정제 HTML 의 평문 == 병행 평문(정규화) 이어야 한다.
  checkPlaintextPair(obj, 'title', 'textHtml', 'text', path, findings);
  checkPlaintextPair(obj, 'question', 'promptHtml', 'prompt', path, findings);
}

function checkPlaintextPair(obj, type, htmlField, plainField, path, findings) {
  if (obj.type !== type || typeof obj[htmlField] !== 'string' || typeof obj[plainField] !== 'string') return;
  const r = validateHtmlField(obj[htmlField], HTML_POSITIONS[type][htmlField]);
  if (!r.ok) return; // HTML 자체가 이미 반려됨 — 중복 보고 안 함.
  if (norm(r.plaintext) !== norm(obj[plainField])) {
    findings.push({
      rule: 'plaintext-mismatch',
      path: `${path}.${htmlField}`,
      message: `${htmlField} 의 평문("${norm(r.plaintext)}")이 ${plainField}("${norm(obj[plainField])}")과 다릅니다 — 렌더/검사기 불일치 위험.`,
    });
  }
}

/**
 * B′ 프래그먼트 결정 검증.
 * @param {Array<object>|{objects:Array<object>}} fragment scaffold·flow-only 개체 배열(또는 {objects}).
 * @param {{allowPassageContent?:boolean}} [ctx] 요청 컨텍스트 권한.
 * @returns {{ok:boolean, findings:object[], objects?:object[]}}
 */
export function validateAiFragment(fragment, ctx = {}) {
  const objects = Array.isArray(fragment) ? fragment : (fragment && Array.isArray(fragment.objects) ? fragment.objects : null);
  if (!objects) return { ok: false, findings: [{ rule: 'invalid-fragment', path: '', message: '프래그먼트는 개체 배열(또는 {objects:[]})이어야 합니다.' }] };
  if (objects.length === 0) return { ok: false, findings: [{ rule: 'empty-fragment', path: '', message: '프래그먼트가 비어 있습니다.' }] };

  const findings = [];
  objects.forEach((obj, i) => validateOne(obj, i, ctx, findings));

  if (findings.length > 0) return { ok: false, findings };
  // 승인 — 원문 그대로 반환(승인된 HTML 은 허용 요소만 남아 있어 정제가 곧 원문 = preview==apply).
  return { ok: true, findings: [], objects: structuredClone(objects) };
}

// ── 컴파일 / stale ────────────────────────────────────────────────────────────

let _seq = 0;
function defaultIdGen() {
  const stamp = Date.now().toString(36);
  return () => `frag-${stamp}-${(_seq++).toString(36)}`;
}

/**
 * 승인된 개체 배열을 **단일 insert-section op** 로 컴파일한다. 엔진 ID·placement:'flow' 를 주입하고
 * (프래그먼트는 저작 못 함), 순서를 보존하며, anchor(afterId|beforeId|pageId 정확히 하나)를 필수화한다
 * (anchor 없는 insert-section 은 문서 말미로 새어 들어간다 — 선택 페이지 생성 목표와 어긋남).
 * 개체 앵커(afterId/beforeId)는 지목할 개체가 있을 때, pageId 앵커는 **빈 페이지**(지목할 flow 개체가
 * 없는 새 페이지)에 섹션을 저작할 때 쓴다 — applyAiOps 가 pageId→그 페이지 flow 말미 append 로 해석한다.
 * 요청 시점 pageVersions 를 봉투에 묶어 적용 직전 stale 비교에 쓴다.
 *
 * @param {object[]} objects validateAiFragment().objects (승인 개체).
 * @param {{anchor:{afterId?:string, beforeId?:string, pageId?:string}, pageVersions?:object, genId?:()=>string}} opts
 * @returns {{op:object, requestPageVersions:object|null}}
 */
export function compileFragmentToInsertSection(objects, opts = {}) {
  if (!Array.isArray(objects) || objects.length === 0) throw new Error('컴파일 대상 개체 배열이 비어 있습니다.');
  const { anchor = {}, pageVersions = null, genId } = opts;
  const hasAfter = typeof anchor.afterId === 'string' && !!anchor.afterId;
  const hasBefore = typeof anchor.beforeId === 'string' && !!anchor.beforeId;
  const hasPage = typeof anchor.pageId === 'string' && !!anchor.pageId;
  if ([hasAfter, hasBefore, hasPage].filter(Boolean).length !== 1) {
    throw new Error('anchor 는 afterId·beforeId·pageId 중 정확히 하나가 필요합니다(anchor 필수).');
  }

  const gen = genId || defaultIdGen();
  const compiledObjects = objects.map((o) => ({ ...structuredClone(o), id: gen(), placement: 'flow' }));
  const op = { op: 'insert-section', objects: compiledObjects };
  if (hasAfter) op.afterId = anchor.afterId;
  else if (hasBefore) op.beforeId = anchor.beforeId;
  else op.pageId = anchor.pageId;
  return { op, requestPageVersions: pageVersions ? { ...pageVersions } : null };
}

/**
 * 적용 직전 stale 판정 — 요청 시점 pageVersions 와 현재 pageVersions 를 비교(M2 인프라 재사용 발상).
 * requestPageVersions 가 없으면 검사 불가 → false(호출부가 정책 결정). 하나라도 어긋나면 stale.
 */
export function isFragmentStale(requestPageVersions, currentPageVersions) {
  if (!requestPageVersions || typeof requestPageVersions !== 'object') return false;
  for (const [pid, ver] of Object.entries(requestPageVersions)) {
    if (!currentPageVersions || currentPageVersions[pid] !== ver) return true;
  }
  return false;
}
