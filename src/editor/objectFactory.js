// objectFactory.js — editor-v4 S4.3 개체 삽입/삭제/복제/이동/토글/정렬 순수 연산.
//
// DOM 무지 — 문서(개체 트리)를 입력받아 새 문서를 반환하는 순수 함수만 담는다(undo/redo 는
// history.js 의 스냅샷 커밋 소관, 이 파일은 "다음 문서가 무엇이어야 하는가"만 계산한다).
// editor.js 가 이 함수들을 호출한 뒤 core.setDocument(next) → reloadTeacherFrame → history.commit()
// → scheduleReflow() 순으로 배선한다(구조 변경 후 리플로우 트리거, 과제 지시 §산출 6).
//
// 타입별 필드는 ObjectCatalog.TYPE_SPECS(src/domain/schema)와 항상 정합해야 한다 — 여기서 만드는
// 개체가 ValidateObjectTree 를 통과하지 못하면 저장이 거부된다.

import {
  QUESTION_TYPES,
  TYPE_SPECS,
  OBJECT_TYPES,
  ANSWERABLE_TYPES,
  createUniquePageId,
} from '/src/domain/schema/index.js';

/** 자유 배치 기본 rect — 실측을 못 얻었을 때만 쓰는 폴백(삽입·승격 공통 단일 출처). */
const DEFAULT_FLOAT_RECT = Object.freeze({ xMm: 20, yMm: 20, wMm: 60, hMm: 30 });

/** 자유 개체 최소 치수(mm). selection.js 리사이즈의 MIN 과 같은 하한 — 실측이 그보다 얇아도 잡을 수 있게. */
const MIN_FLOAT_MM = 10;

/**
 * 외부에서 들어온 rect 를 스키마가 받아들이는 형태로 정규화한다. 유한 number 4종이 아니면
 * null 을 돌려 호출부가 폴백을 쓰게 한다 — validateObjectShape 의 isValidRect 와 같은 술어라
 * NaN·부분 rect 가 문서에 실릴 경로가 없다(렌더의 mm() 는 NaNmm 을 조용히 방출한다).
 */
function normalizeFloatRect(rect) {
  if (!rect) return null;
  const keys = ['xMm', 'yMm', 'wMm', 'hMm'];
  if (!keys.every((k) => typeof rect[k] === 'number' && Number.isFinite(rect[k]))) return null;
  return {
    xMm: rect.xMm,
    yMm: rect.yMm,
    wMm: Math.max(MIN_FLOAT_MM, rect.wMm),
    hMm: Math.max(MIN_FLOAT_MM, rect.hMm),
  };
}

let counter = 0;
/** 클라이언트 개체 id — 시각+카운터+난수(충돌 회피, 결정성 불필요). */
export function generateId(prefix = 'o') {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${Date.now().toString(36)}${counter}${rand}`;
}

/** 삽입 카탈로그(좌측 패널 ②·슬래시 메뉴 공용) — 카탈로그 10종 + qtype 7종을 닫힌 목록으로 노출.
 *  passage-slot·std-box 도 카탈로그 10종에 포함되므로 목록엔 있으나 flow 전용(placement 선택 불가). */
export const CATALOG_ITEMS = Object.freeze([
  { key: 'title', type: 'title', label: '제목', floatable: false },
  { key: 'question:multiple-choice', type: 'question', qtype: 'multiple-choice', label: '문항 · 객관식', floatable: true },
  { key: 'question:short-answer', type: 'question', qtype: 'short-answer', label: '문항 · 단답형', floatable: true },
  { key: 'question:essay', type: 'question', qtype: 'essay', label: '문항 · 서술형', floatable: true },
  { key: 'question:fill-blank', type: 'question', qtype: 'fill-blank', label: '문항 · 빈칸', floatable: true },
  { key: 'question:true-false', type: 'question', qtype: 'true-false', label: '문항 · 참/거짓', floatable: true },
  { key: 'question:matching', type: 'question', qtype: 'matching', label: '문항 · 연결형', floatable: true },
  { key: 'question:ordering', type: 'question', qtype: 'ordering', label: '문항 · 순서배열', floatable: true },
  { key: 'table', type: 'table', label: '표', floatable: true },
  { key: 'image-slot', type: 'image-slot', label: '이미지', floatable: true },
  { key: 'answer-area', type: 'answer-area', label: '답란', floatable: true },
  { key: 'richtext', type: 'richtext', label: '자유 텍스트', floatable: true },
  { key: 'shape', type: 'shape', label: '도형', floatable: true, floatOnly: true },
  { key: 'divider', type: 'divider', label: '구분선', floatable: true },
  { key: 'passage-slot', type: 'passage-slot', label: '지문 슬롯', floatable: false },
  { key: 'std-box', type: 'std-box', label: '학습목표 박스', floatable: false },
]);

export const QTYPE_LABELS = Object.freeze({
  'multiple-choice': '객관식', 'short-answer': '단답형', essay: '서술형', 'fill-blank': '빈칸',
  'true-false': '참/거짓', matching: '연결형', ordering: '순서배열',
});
export const SHAPE_KINDS = Object.freeze(['rect', 'circle', 'line']);
export const DASH_STYLES = Object.freeze(['solid', 'dashed', 'dotted']); // 선 유형(#5 2차)
export const ANSWER_AREA_STYLES = Object.freeze(['line', 'dots', 'box']);

export function questionDefaults(qtype) {
  switch (qtype) {
    case 'multiple-choice': return { choices: ['보기 1', '보기 2', '보기 3', '보기 4'] };
    case 'matching': return { left: ['A', 'B'], right: ['1', '2'] };
    case 'ordering': return { items: ['첫 번째', '두 번째', '세 번째'] };
    default: return {};
  }
}

/** 타입(+qtype)의 최소 유효 필드셋(placement/id 는 삽입 시점에 별도 부여). */
export function defaultFieldsFor(type, { qtype = 'short-answer' } = {}) {
  switch (type) {
    case 'title': return { text: '새 제목', level: 1 };
    case 'passage-slot': return { slotLabel: '［지문 삽입 슬롯］' };
    case 'question': {
      const qt = QUESTION_TYPES.includes(qtype) ? qtype : 'short-answer';
      // qtype 별 시작 발문 — 삽입 직후에도 유형이 한눈에 구분되도록(#12). qtype 전환 시엔
      // questionDefaults(구조 필드만) 로 병합하므로 사용자 발문을 덮어쓰지 않는다.
      const prompt = qt === 'fill-blank' ? '다음 빈칸에 알맞은 말을 쓰시오: ( ______ )'
        : qt === 'true-false' ? '다음 설명이 맞으면 O, 틀리면 X 하시오.'
          : '새 문항';
      return { qtype: qt, prompt, ...questionDefaults(qt) };
    }
    case 'table': return { splittable: false, rows: [[{ text: '', header: true }, { text: '', header: true }], [{ text: '' }, { text: '' }]] };
    case 'image-slot': return {};
    case 'answer-area': return { style: 'line', lines: 3 };
    case 'divider': return {};
    case 'shape': return { shapeKind: 'rect', strokeColor: '#111827', fillColor: 'none', strokeWidth: 1.6, dash: 'solid' };
    case 'richtext': return { html: '<p>텍스트를 입력하세요.</p>' };
    // std-box: objectives(학습목표, 저작 영역) 기본 1줄을 담아 삽입 즉시 "학습 목표" 박스로 보이게 한다
    // (2026-07-23 학습목표 표기 전환·사용자 피드백 #13). codes(성취기준 조회 참조)는 비워 시작한다.
    case 'std-box': return { codes: [], objectives: ['핵심 학습목표를 입력하세요 (~할 수 있다).'] };
    default: throw new Error(`objectFactory: 닫힌 카탈로그 밖 타입: ${type}`);
  }
}

/** 새 개체 생성. placement:'float' 이면 rect(mm) 를 부여한다(AI 는 못 하지만 사람 삽입은 좌표를 가진다). */
export function createObject(type, { placement = 'flow', qtype, rect } = {}) {
  if (!OBJECT_TYPES.includes(type)) throw new Error(`objectFactory: 닫힌 카탈로그 밖 타입: ${type}`);
  const spec = TYPE_SPECS[type];
  const finalPlacement = spec.placements.includes(placement) ? placement : spec.placements[0];
  const obj = { id: generateId(type), type, placement: finalPlacement, ...defaultFieldsFor(type, { qtype }) };
  if (finalPlacement === 'float') {
    obj.rect = rect ? { ...rect } : { ...DEFAULT_FLOAT_RECT };
  }
  return obj;
}

function clonePages(document) {
  return structuredClone(document.pages || []);
}

function locate(pages, id) {
  for (let p = 0; p < pages.length; p++) {
    const flowIdx = (pages[p].flow || []).findIndex((o) => o.id === id);
    if (flowIdx >= 0) return { page: p, bucket: 'flow', index: flowIdx };
    const floatIdx = (pages[p].float || []).findIndex((o) => o.id === id);
    if (floatIdx >= 0) return { page: p, bucket: 'float', index: floatIdx };
  }
  return null;
}

/** flow 개체를 afterId 바로 뒤(없으면 마지막 페이지 끝)에 삽입한 새 문서. */
export function insertFlow(document, obj, { afterId = null, pageIndex = null } = {}) {
  const pages = clonePages(document);
  if (pages.length === 0) pages.push({ id: createUniquePageId(pages), flow: [], float: [] });
  const loc = afterId ? locate(pages, afterId) : null;
  if (loc && loc.bucket === 'flow') {
    pages[loc.page].flow.splice(loc.index + 1, 0, obj);
  } else if (pageIndex != null && pages[pageIndex]) {
    pages[pageIndex].flow.push(obj);
  } else {
    pages[pages.length - 1].flow.push(obj);
  }
  return { ...document, pages };
}

/** float 개체를 지정 페이지(없으면 선택 개체의 페이지, 그마저 없으면 0쪽)에 삽입한 새 문서. */
export function insertFloat(document, obj, { pageIndex = null, nearId = null } = {}) {
  const pages = clonePages(document);
  if (pages.length === 0) pages.push({ id: createUniquePageId(pages), flow: [], float: [] });
  let target = pageIndex;
  if (target == null && nearId) {
    const loc = locate(pages, nearId);
    if (loc) target = loc.page;
  }
  if (target == null || !pages[target]) target = 0;
  pages[target].float.push(obj);
  return { ...document, pages };
}

/**
 * AI 결과 계획(v4 ops)을 순서대로 적용한 새 문서 — Phase 4 핵심.
 *
 * v3 는 대상별 1:1 치환뿐이라 "문항 3개를 활동 1개로 합치기"·"표 1개를 표+설명문으로 나누기"를
 * 표현할 수 없었다. 여기서는 replace·insert·delete 를 **AI 가 준 순서 그대로** 적용해 개수와
 * 종류가 바뀌는 결과를 만든다. 호출부는 이 함수가 돌려준 문서를 applyDocOp 에 **한 번만** 넘겨
 * undo 도 한 스텝이 되게 한다.
 *
 * 문서를 알아야 판정할 수 있는 안전장치가 여기 산다(aiBridge 는 프로토콜 형태만 본다):
 *  - AI_EXCLUDED_TYPES(std-box) 개체는 수정·삭제 대상이 될 수 없다(원칙 3, 성취기준 원문 보존)
 *  - 존재하지 않는 개체를 replace/delete 하거나 없는 위치에 insert 하면 **던진다** — 조용히
 *    건너뛰면 교사는 "AI 가 반영됐다"고 믿는데 실제로는 일부만 반영된 상태가 된다.
 *
 * @param {object} document 개체 트리 문서
 * @param {Array<{op:'replace'|'insert'|'delete', id?:string, object?:object, afterId?:string, beforeId?:string}>} ops
 * @param {{excludedTypes?:Iterable<string>}} [opts]
 * @returns {{document:object, resultIds:string[]}} 적용 문서와 결과(치환·신규) 개체 ID 목록
 */
export function applyAiOps(document, ops, { excludedTypes = [] } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('AI 결과 계획(ops)이 비어 있습니다.');
  const excluded = new Set(excludedTypes);
  let doc = document;
  const resultIds = [];

  const findObj = (d, id) => {
    for (const page of d.pages || []) {
      for (const bucket of ['flow', 'float']) {
        const hit = (page[bucket] || []).find((o) => o && o.id === id);
        if (hit) return hit;
      }
    }
    return null;
  };
  const assertTargetable = (d, id, verb) => {
    const cur = findObj(d, id);
    if (!cur) throw new Error(`AI ${verb} 대상 개체를 찾을 수 없습니다: ${id}`);
    if (excluded.has(cur.type)) {
      throw new Error(`"${cur.type}" 개체는 AI ${verb} 대상이 아닙니다 — 성취기준 원문은 보존됩니다(원칙 3).`);
    }
    return cur;
  };

  for (const op of ops) {
    if (!op || typeof op !== 'object') throw new Error('AI 결과 계획에 빈 항목이 있습니다.');
    if (op.op === 'replace') {
      assertTargetable(doc, op.id, '수정');
      doc = replaceObject(doc, op.id, op.object);
      resultIds.push(op.id);
    } else if (op.op === 'delete') {
      assertTargetable(doc, op.id, '삭제');
      doc = removeObject(doc, op.id);
    } else if (op.op === 'insert') {
      const anchorId = op.afterId ?? op.beforeId ?? null;
      if (anchorId != null) {
        const loc = locate(doc.pages || [], anchorId);
        if (!loc) throw new Error(`AI 삽입 기준 개체를 찾을 수 없습니다: ${anchorId}`);
        // 기준이 자유 배치(float) 개체면 insertFlow/insertFlowBefore 가 조용히 **마지막 페이지 끝**에
        // 붙인다 — AI 가 지목한 자리와 다른 곳에 꽂히는 오배치라 여기서 거부한다(유령 앵커를 던지는
        // 것과 같은 원칙: 조용히 엉뚱한 결과를 만들지 않는다).
        if (loc.bucket !== 'flow') {
          throw new Error(`AI 삽입 기준 개체가 본문 흐름 개체가 아닙니다: ${anchorId} — 자유 배치 개체의 앞/뒤에는 삽입할 수 없습니다.`);
        }
      }
      // 신규 개체는 항상 새 id 를 받는다 — AI 가 준 id 를 그대로 쓰면 기존 개체와 충돌해
      // locate 가 엉뚱한 것을 집을 수 있다(편집기 insert 모드와 동일 규약).
      const obj = { ...op.object, id: generateId(op.object?.type || 'o') };
      doc = op.beforeId ? insertFlowBefore(doc, obj, op.beforeId) : insertFlow(doc, obj, { afterId: op.afterId ?? null });
      resultIds.push(obj.id);
    } else {
      throw new Error(`알 수 없는 AI op: ${op.op}`);
    }
  }
  return { document: doc, resultIds };
}

/** flow 개체를 beforeId 개체 **앞**에 끼운 새 문서(insertFlow 의 afterId 대칭 — v4 insert 전용). */
function insertFlowBefore(document, obj, beforeId) {
  const pages = clonePages(document);
  const loc = locate(pages, beforeId);
  if (!loc || loc.bucket !== 'flow') return insertFlow(document, obj, { afterId: null });
  pages[loc.page].flow.splice(loc.index, 0, obj);
  return { ...document, pages };
}

/** id 개체를 문서에서 제거한 새 문서. */
export function removeObject(document, id) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return document;
  pages[loc.page][loc.bucket].splice(loc.index, 1);
  return { ...document, pages };
}

/** id 개체를 복제해 바로 뒤(같은 버킷)에 삽입한 새 문서 + 새 id. float 은 살짝 오프셋해 겹침을 피한다. */
export function duplicateObject(document, id) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return { document, newId: null };
  const src = pages[loc.page][loc.bucket][loc.index];
  const clone = structuredClone(src);
  clone.id = generateId(src.type);
  if (loc.bucket === 'float' && clone.rect) {
    clone.rect = { ...clone.rect, xMm: clone.rect.xMm + 8, yMm: clone.rect.yMm + 8 };
  }
  pages[loc.page][loc.bucket].splice(loc.index + 1, 0, clone);
  return { document: { ...document, pages }, newId: clone.id };
}

/** flow 개체를 같은 페이지 안에서 한 칸 위/아래로 옮긴다(⠿ 핸들 드래그 재정렬의 최소 단위). */
export function moveFlow(document, id, direction) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc || loc.bucket !== 'flow') return document;
  const list = pages[loc.page].flow;
  const to = direction === 'up' ? loc.index - 1 : loc.index + 1;
  if (to < 0 || to >= list.length) return document;
  [list[loc.index], list[to]] = [list[to], list[loc.index]];
  return { ...document, pages };
}

/**
 * DOM 드래그가 확정한 "페이지별 flow id 순서"로 pages[].flow 를 재구성한다(#1·#2 2차 — 연속 재정렬·
 * 페이지 넘나들기). float 은 원 페이지 그대로 둔다. idsByPage 에서 빠진 flow 개체(방어)는 원 페이지
 * 끝에 되붙여 유실을 막는다. 이후 scheduleReflow 가 높이 기준으로 경계를 최종 확정한다(D-A).
 */
export function applyFlowOrder(document, idsByPage) {
  const pages = clonePages(document);
  const byId = new Map();
  for (const p of pages) for (const o of (p.flow || [])) byId.set(o.id, o);
  const placed = new Set();
  const nextPages = pages.map((p, i) => {
    const ids = Array.isArray(idsByPage[i]) ? idsByPage[i] : [];
    const flow = [];
    for (const id of ids) {
      const o = byId.get(id);
      if (o && !placed.has(id)) { flow.push(o); placed.add(id); }
    }
    return { ...p, flow, float: p.float || [] };
  });
  // 방어: 어느 페이지에도 배정되지 않은 flow 개체는 원 페이지 끝에 되붙인다(유실 방지).
  pages.forEach((p, i) => {
    for (const o of (p.flow || [])) {
      if (!placed.has(o.id)) { (nextPages[i] || nextPages[nextPages.length - 1]).flow.push(o); placed.add(o.id); }
    }
  });
  return { ...document, pages: nextPages };
}

/** float 개체를 다른 페이지로 이관한다(#2 2차) — rect(mm)은 새 페이지 기준으로 보정해 전달받는다. */
export function moveFloatToPage(document, id, pageIndex, rect = null) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc || loc.bucket !== 'float' || !pages[pageIndex] || pageIndex === loc.page) return document;
  const [obj] = pages[loc.page].float.splice(loc.index, 1);
  if (rect) obj.rect = { ...obj.rect, ...rect };
  pages[pageIndex].float.push(obj);
  return { ...document, pages };
}

/** float 개체를 dxMm/dyMm 만큼 상대 이동한다(방향키 넛지, US-E2). flow·미존재·rect 없음은 무변경.
 *  좌표는 소수 1자리로 반올림(selection.js 드래그 round1 관례와 동일). 페이지 밖으로 나가는 것은
 *  막지 않는다(드래그 이동과 동일 정책 — 사용자가 소량씩 제어). */
export function nudgeFloat(document, id, dxMm, dyMm) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc || loc.bucket !== 'float') return document;
  const obj = pages[loc.page][loc.bucket][loc.index];
  if (!obj.rect) return document;
  obj.rect = {
    ...obj.rect,
    xMm: Math.round((obj.rect.xMm + dxMm) * 10) / 10,
    yMm: Math.round((obj.rect.yMm + dyMm) * 10) / 10,
  };
  return { ...document, pages };
}

/**
 * flow⇄float 전환. float→flow 는 rect 를 제거하고 같은 페이지 flow 끝에 붙인다
 * (원칙 3 정합 — flow 는 rect 를 가질 수 없다).
 *
 * flow→float 은 `measuredRect` 가 있으면 그 자리에 그대로 고정하고, 없으면 기본 위치로 떨군다.
 * 실측은 DOM 이 있는 편집기(selection.measureRectMm)가 하고 이 함수는 순수하게 남는다 —
 * 같은 파일의 createObject 도 정확히 같은 형태(선택적 rect + 같은 폴백)를 쓴다.
 *
 * ⚠ 강등(float→flow) 방향에서는 `measuredRect` 를 **무시**한다. rect 를 실은 flow 개체는 스키마
 * 위반(원칙 3)이라, 호출부가 실수로 넘겨도 여기서 막는다 — 계약을 순수 함수 안에 둬야 미래
 * 호출자가 뚫지 못한다.
 *
 * @param {object} document 개체 트리 문서
 * @param {string} id
 * @param {{xMm:number,yMm:number,wMm:number,hMm:number}|null} [measuredRect] 승격 시 화면 실측 rect
 */
export function toggleFlowFloat(document, id, measuredRect = null) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return document;
  const spec = TYPE_SPECS[pages[loc.page][loc.bucket][loc.index].type];
  const [obj] = pages[loc.page][loc.bucket].splice(loc.index, 1);
  if (loc.bucket === 'flow') {
    if (!spec.placements.includes('float')) { pages[loc.page].flow.splice(loc.index, 0, obj); return { ...document, pages }; }
    obj.placement = 'float';
    obj.rect = normalizeFloatRect(measuredRect) ?? { ...DEFAULT_FLOAT_RECT };
    pages[loc.page].float.push(obj);
  } else {
    if (!spec.placements.includes('flow')) { pages[loc.page].float.splice(loc.index, 0, obj); return { ...document, pages }; }
    obj.placement = 'flow';
    delete obj.rect;
    pages[loc.page].flow.push(obj);
  }
  return { ...document, pages };
}

/** answer:true 토글(허용 타입만 — TYPE_SPECS.optional 에 'answer' 를 명시한 타입, ANSWERABLE_TYPES). */
export function toggleAnswer(document, id) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return document;
  const obj = pages[loc.page][loc.bucket][loc.index];
  if (!ANSWERABLE_TYPES.includes(obj.type)) return document;
  if (obj.answer === true) delete obj.answer; else obj.answer = true;
  return { ...document, pages };
}

/** 개체 필드 얕은 병합(인스펙터 속성 편집 — text/prompt/qtype/rows/src/shapeKind/rect 등). */
export function patchObject(document, id, patch) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return document;
  Object.assign(pages[loc.page][loc.bucket][loc.index], patch);
  return { ...document, pages };
}

/** id 개체를 nextObj 로 완전히 치환한 새 문서(patchObject 와 달리 부분 병합이 아니라 전체 교체 —
 *  US-19 AI 적용: 응답 개체가 qtype 전환 등으로 필드 집합 자체가 달라질 수 있어 얕은 병합(Object.assign)
 *  으로는 stale 필드가 남는다). id·배치 버킷(flow/float)은 원본 위치를 그대로 보존한다(placement 자체를
 *  바꾸려면 toggleFlowFloat 를 별도로 쓴다). */
export function replaceObject(document, id, nextObj) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return document;
  pages[loc.page][loc.bucket][loc.index] = { ...nextObj, id };
  return { ...document, pages };
}

const ALIGN_MODES = Object.freeze(['left', 'center-h', 'right', 'top', 'middle-v', 'bottom', 'distribute-h', 'distribute-v']);

/** float 다중 선택 정렬/분배(6종 정렬 + 가로/세로 균등 분배) — float 한정(flow 는 좌표가 없다). */
export function alignFloats(document, ids, mode) {
  if (!ALIGN_MODES.includes(mode) || ids.length < 2) return document;
  const pages = clonePages(document);
  const targets = [];
  for (const id of ids) {
    const loc = locate(pages, id);
    if (loc && loc.bucket === 'float') targets.push(pages[loc.page].float[loc.index]);
  }
  if (targets.length < 2) return document;
  if (mode === 'left') { const x = Math.min(...targets.map((o) => o.rect.xMm)); targets.forEach((o) => { o.rect.xMm = x; }); }
  else if (mode === 'right') { const x = Math.max(...targets.map((o) => o.rect.xMm + o.rect.wMm)); targets.forEach((o) => { o.rect.xMm = x - o.rect.wMm; }); }
  else if (mode === 'center-h') { const c = targets.reduce((s, o) => s + o.rect.xMm + o.rect.wMm / 2, 0) / targets.length; targets.forEach((o) => { o.rect.xMm = c - o.rect.wMm / 2; }); }
  else if (mode === 'top') { const y = Math.min(...targets.map((o) => o.rect.yMm)); targets.forEach((o) => { o.rect.yMm = y; }); }
  else if (mode === 'bottom') { const y = Math.max(...targets.map((o) => o.rect.yMm + o.rect.hMm)); targets.forEach((o) => { o.rect.yMm = y - o.rect.hMm; }); }
  else if (mode === 'middle-v') { const c = targets.reduce((s, o) => s + o.rect.yMm + o.rect.hMm / 2, 0) / targets.length; targets.forEach((o) => { o.rect.yMm = c - o.rect.hMm / 2; }); }
  else if (mode === 'distribute-h') {
    const sorted = [...targets].sort((a, b) => a.rect.xMm - b.rect.xMm);
    const min = sorted[0].rect.xMm, max = sorted[sorted.length - 1].rect.xMm;
    const step = (max - min) / (sorted.length - 1);
    sorted.forEach((o, i) => { o.rect.xMm = min + step * i; });
  } else if (mode === 'distribute-v') {
    const sorted = [...targets].sort((a, b) => a.rect.yMm - b.rect.yMm);
    const min = sorted[0].rect.yMm, max = sorted[sorted.length - 1].rect.yMm;
    const step = (max - min) / (sorted.length - 1);
    sorted.forEach((o, i) => { o.rect.yMm = min + step * i; });
  }
  return { ...document, pages };
}

const Z_MODES = Object.freeze(['front', 'back', 'forward', 'backward']);

/** float 개체의 z-순서(= 같은 페이지 float[] 배열 내 위치)를 바꾼다. 배열 뒤 = 앞면(위), 앞 = 뒷면
 *  (아래) — RenderObjectTree 가 float 을 배열 순서대로 .sheet 직속 형제로 방출하고 .wg-float 에
 *  z-index 가 없어 DOM 순서(=배열 순서)가 곧 페인트 순서다(편집 캔버스=인쇄 동일). front=맨앞,
 *  back=맨뒤, forward/backward=한 칸. flow·미존재·단일원소·이미 끝단이면 원본 참조 그대로 반환
 *  (불필요한 dirty/커밋 방지 — 호출부가 참조 동일성으로 무동작 판단). */
export function reorderFloat(document, id, mode) {
  if (!Z_MODES.includes(mode)) return document;
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc || loc.bucket !== 'float') return document;
  const list = pages[loc.page].float;
  if (list.length < 2) return document;
  const i = loc.index;
  const last = list.length - 1;
  if ((mode === 'front' || mode === 'forward') && i === last) return document;
  if ((mode === 'back' || mode === 'backward') && i === 0) return document;
  const [obj] = list.splice(i, 1);
  let to;
  if (mode === 'front') to = list.length;
  else if (mode === 'back') to = 0;
  else if (mode === 'forward') to = i + 1;
  else to = i - 1;
  list.splice(to, 0, obj);
  return { ...document, pages };
}

/** 새 빈 페이지를 index 뒤(생략 시 문서 끝)에 삽입한 새 문서. */
export function addPage(document, { afterIndex = null } = {}) {
  const pages = clonePages(document);
  const at = afterIndex == null ? pages.length : afterIndex + 1;
  pages.splice(at, 0, { id: createUniquePageId(pages), flow: [], float: [] });
  return { ...document, pages };
}

/** index 페이지를 복제해 바로 뒤에 삽입(개체는 전부 새 id 로 복제 — 원본과 중복 id 방지). */
export function duplicatePage(document, index) {
  const pages = clonePages(document);
  const src = pages[index];
  if (!src) return document;
  const clonedFlow = (src.flow || []).map((o) => ({ ...structuredClone(o), id: generateId(o.type) }));
  const clonedFloat = (src.float || []).map((o) => ({ ...structuredClone(o), id: generateId(o.type) }));
  pages.splice(index + 1, 0, {
    ...src,
    id: createUniquePageId(pages),
    flow: clonedFlow,
    float: clonedFloat,
  });
  return { ...document, pages };
}

export function movePage(document, fromIndex, toIndex) {
  const pages = clonePages(document);
  if (!pages[fromIndex] || fromIndex === toIndex || toIndex < 0 || toIndex >= pages.length) return document;
  const [page] = pages.splice(fromIndex, 1);
  pages.splice(toIndex, 0, page);
  return { ...document, pages };
}

export function reorderPages(document, pageIds) {
  const pages = document.pages || [];
  if (!Array.isArray(pageIds) || pageIds.length !== pages.length) return document;
  const byId = new Map(pages.map((page) => [page.id, page]));
  if (byId.size !== pages.length || new Set(pageIds).size !== pageIds.length) return document;
  if (pageIds.some((id) => !byId.has(id))) return document;
  if (pageIds.every((id, index) => pages[index].id === id)) return document;
  return { ...document, pages: pageIds.map((id) => structuredClone(byId.get(id))) };
}

export function setPageRole(document, pageId, role) {
  const pages = document.pages || [];
  const index = pages.findIndex((page) => page.id === pageId);
  if (index < 0) return document;
  const normalizedRole = typeof role === 'string' && role.trim() ? role.trim() : null;
  if ((pages[index].role ?? null) === normalizedRole) return document;
  const nextPages = clonePages(document);
  if (normalizedRole == null) delete nextPages[index].role;
  else nextPages[index].role = normalizedRole;
  return { ...document, pages: nextPages };
}

/** index 페이지를 제거한다(최소 1쪽은 유지). flow 개체는 다음(없으면 이전) 페이지로 이관해
 *  내용 손실을 막고, 이후 scheduleReflow() 가 경계를 다시 계산한다. float 은 이관 페이지에 그대로 붙는다. */
export function removePage(document, index) {
  const pages = clonePages(document);
  if (pages.length <= 1 || !pages[index]) return document;
  const removed = pages[index];
  const targetIdx = index < pages.length - 1 ? index + 1 : index - 1;
  pages[targetIdx].flow.push(...(removed.flow || []));
  pages[targetIdx].float.push(...(removed.float || []));
  pages.splice(index, 1);
  return { ...document, pages };
}

/** id 개체가 속한 페이지 인덱스(없으면 null). */
export function pageIndexOf(document, id) {
  const loc = locate(document.pages || [], id);
  return loc ? loc.page : null;
}
