// objectFactory.js — editor-v4 S4.3 개체 삽입/삭제/복제/이동/토글/정렬 순수 연산.
//
// DOM 무지 — 문서(개체 트리)를 입력받아 새 문서를 반환하는 순수 함수만 담는다(undo/redo 는
// history.js 의 스냅샷 커밋 소관, 이 파일은 "다음 문서가 무엇이어야 하는가"만 계산한다).
// editor.js 가 이 함수들을 호출한 뒤 core.setDocument(next) → reloadTeacherFrame → history.commit()
// → scheduleReflow() 순으로 배선한다(구조 변경 후 리플로우 트리거, 과제 지시 §산출 6).
//
// 타입별 필드는 ObjectCatalog.TYPE_SPECS(src/domain/schema)와 항상 정합해야 한다 — 여기서 만드는
// 개체가 ValidateObjectTree 를 통과하지 못하면 저장이 거부된다.

import { QUESTION_TYPES, TYPE_SPECS, OBJECT_TYPES, ANSWERABLE_TYPES } from '/src/domain/schema/index.js';

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
  { key: 'std-box', type: 'std-box', label: '성취기준 박스', floatable: false },
]);

export const QTYPE_LABELS = Object.freeze({
  'multiple-choice': '객관식', 'short-answer': '단답형', essay: '서술형', 'fill-blank': '빈칸',
  'true-false': '참/거짓', matching: '연결형', ordering: '순서배열',
});
export const SHAPE_KINDS = Object.freeze(['rect', 'circle', 'line']);
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
    case 'question': return { qtype: QUESTION_TYPES.includes(qtype) ? qtype : 'short-answer', prompt: '새 문항', ...questionDefaults(qtype) };
    case 'table': return { splittable: false, rows: [[{ text: '', header: true }, { text: '', header: true }], [{ text: '' }, { text: '' }]] };
    case 'image-slot': return {};
    case 'answer-area': return { style: 'line', lines: 3 };
    case 'divider': return {};
    case 'shape': return { shapeKind: 'rect', strokeColor: '#111827', fillColor: 'none' };
    case 'richtext': return { html: '<p>텍스트를 입력하세요.</p>' };
    case 'std-box': return { codes: [] };
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
    obj.rect = rect ? { ...rect } : { xMm: 20, yMm: 20, wMm: 60, hMm: 30 };
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
  if (pages.length === 0) pages.push({ flow: [], float: [] });
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
  if (pages.length === 0) pages.push({ flow: [], float: [] });
  let target = pageIndex;
  if (target == null && nearId) {
    const loc = locate(pages, nearId);
    if (loc) target = loc.page;
  }
  if (target == null || !pages[target]) target = 0;
  pages[target].float.push(obj);
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

/** flow⇄float 전환. flow→float 은 rect 를 새로 부여(기본 위치), float→flow 는 rect 를 제거하고
 *  같은 페이지 flow 끝에 붙인다(원칙 3 정합 — flow 는 rect 를 가질 수 없다). */
export function toggleFlowFloat(document, id) {
  const pages = clonePages(document);
  const loc = locate(pages, id);
  if (!loc) return document;
  const spec = TYPE_SPECS[pages[loc.page][loc.bucket][loc.index].type];
  const [obj] = pages[loc.page][loc.bucket].splice(loc.index, 1);
  if (loc.bucket === 'flow') {
    if (!spec.placements.includes('float')) { pages[loc.page].flow.splice(loc.index, 0, obj); return { ...document, pages }; }
    obj.placement = 'float';
    obj.rect = { xMm: 20, yMm: 20, wMm: 60, hMm: 30 };
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

/** 새 빈 페이지를 index 뒤(생략 시 문서 끝)에 삽입한 새 문서. */
export function addPage(document, { afterIndex = null } = {}) {
  const pages = clonePages(document);
  const at = afterIndex == null ? pages.length : afterIndex + 1;
  pages.splice(at, 0, { flow: [], float: [] });
  return { ...document, pages };
}

/** index 페이지를 복제해 바로 뒤에 삽입(개체는 전부 새 id 로 복제 — 원본과 중복 id 방지). */
export function duplicatePage(document, index) {
  const pages = clonePages(document);
  const src = pages[index];
  if (!src) return document;
  const clonedFlow = (src.flow || []).map((o) => ({ ...structuredClone(o), id: generateId(o.type) }));
  const clonedFloat = (src.float || []).map((o) => ({ ...structuredClone(o), id: generateId(o.type) }));
  pages.splice(index + 1, 0, { flow: clonedFlow, float: clonedFloat });
  return { ...document, pages };
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
