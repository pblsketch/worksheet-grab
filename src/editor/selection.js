// selection.js — editor-v4 개체 우선 선택·인라인 편집 모델(S4.1).
//
// 문서 전체 contenteditable(구 editor.js 의 doc.body.contentEditable='true')을 폐지하고,
// 클릭=개체 선택 · 더블클릭=그 개체 하나만 contenteditable 진입 · Esc=편집종료→선택복귀→
// (다시 Esc)선택해제 의 3단 상태기계로 대체한다(스파이크 scratchpad/spike-editor-v4/prototype.html
// 실증 문법 그대로 — enterEditing/exitEditing/Esc 사다리·드래그 후 click 1회 삼키기 패턴).
//
// DOM 은 RenderObjectTree(editMode:true) 가 낸 data-oid 래퍼(.wg-obj = flow, .wg-float = float)를
// 그대로 쓴다 — 클라이언트가 새로 마크업을 주입하지 않는다(개체↔DOM 동기화는 data-oid 매칭만).

import { normalizePastedHtml, normalizePastedText } from '/editor/pasteNormalize.js';

const MM_TO_PX = 96 / 25.4; // editor.js 구 관례와 동일(고정, zoom/DPR 무관)

/**
 * 더블클릭으로 진입 가능한 "텍스트 개체류"의 편집 대상 매핑(닫힌 카탈로그 10종 중 5종).
 * selector 가 null 이면 .wg-obj 자기 자신이 편집 대상(richtext = 보존 HTML 전체가 그 필드).
 * stripSelector 는 텍스트를 읽어낼 때 제외할 자식(question 의 qnum 배지 — 번호는 obj.qnum
 * 소관이지 obj.prompt 에 섞이면 안 된다).
 * field:'html'|'bodyHtml' 인 항목은 readField 가 innerHTML(무손실 HTML)로 읽는다 — richtext.html
 * 과 동형 관례(RenderObjectTree 도 두 필드를 이스케이프 없이 그대로 방출한다).
 * passage-slot(2층 정책, 2026-07-23): AI 는 여전히 이 필드를 채우지 못하지만(aiBridge 타입 가드),
 * 교사는 편집기에서 본문(bodyHtml)을 더블클릭·붙여넣기로 직접 입력할 수 있다. 렌더가 bodyHtml
 * 유무로 .passage-body/.slot 중 하나만 그리므로 selector 는 둘 다 커버한다.
 * 나머지 4종(std-box·table·image-slot·divider·shape)은 구조/슬롯 편집이 필요해 S4.1 범위 밖 —
 * 더블클릭해도 선택만 유지된다(us16.md 비활성 목록 기록).
 */
const EDIT_FIELD = Object.freeze({
  // htmlField(선택): 인라인 서식(굵게/기울임 등)을 적용하면 그 살균 HTML 을 이 필드에 병행 저장한다
  // (평문 field 는 그대로 유지 — 정답 누출 스캔·diff·평문 소비자용). 렌더는 htmlField 가 있으면
  // 그걸, 없으면 평문 field 를 이스케이프해 방출한다(RenderObjectTree, 하위호환).
  title: Object.freeze({ field: 'text', htmlField: 'textHtml', selector: '.title-box h1, .title-box h2' }),
  question: Object.freeze({ field: 'prompt', htmlField: 'promptHtml', selector: '.q', stripSelector: '.qnum' }),
  richtext: Object.freeze({ field: 'html', selector: null }),
  'answer-area': Object.freeze({ field: 'label', selector: '.aa-label' }),
  'passage-slot': Object.freeze({ field: 'bodyHtml', selector: '.passage-body, .slot' }),
  // 이미지 캡션(US-P3-5) — **이미 캡션이 있을 때만** 편집 대상이 생긴다. editMode 전용 빈
  // <figcaption> 을 새로 그리지 않는 이유: 리플로우 측정은 editMode:true, 인쇄는 false 라
  // editMode 에만 있는 요소는 높이를 만들어 "편집==인쇄 하드 동치"(R2-1)를 깨뜨린다
  // (그래서 기존 editMode 추가물은 data-r/data-c 처럼 레이아웃에 영향 없는 속성뿐이다).
  // 캡션이 없는 이미지에 캡션을 **새로 다는 것**은 인스펙터(insp-caption) 담당이다.
  'image-slot': Object.freeze({ field: 'caption', selector: 'figcaption' }),
});

// contenteditable 산출·붙여넣기 HTML 을 안전하게 정제(ai.js sanitizeAiHtml 과 동형 규약을 이 저수준
// 모듈에 로컬 복제 — selection 이 기능 모듈 ai.js 에 역방향 의존하지 않도록). script·on* 핸들러·
// javascript: URL 제거.
function sanitizeInlineHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  for (const s of doc.querySelectorAll('script')) s.remove();
  for (const node of doc.body.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      else if (/^(href|src|xlink:href|action|formaction)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        node.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML;
}

// 인라인 서식/줄바꿈 마크업이 있는지(=평문이 아닌지) 판정 — 있을 때만 htmlField 를 저장한다(순수
// 평문이면 htmlField 를 지워 렌더가 이스케이프 평문으로 폴백 = 하위호환·문서 정갈).
function hasInlineMarkup(html) {
  return /<(b|strong|i|em|u|s|sub|sup|font|span|mark|br)\b/i.test(html);
}

function cssEscapeId(id) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
  return String(id).replace(/["\\]/g, '\\$&'); // CSS.escape 부재 환경 최소 폴백
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * @param {{core:object, onDirty?:(kind:'text'|'move')=>void, onSelectionChange?:()=>void}} deps
 *   core: core.js 의 createDocumentStore() 인스턴스. onDirty: 편집이 실제로 문서를 바꿨을 때
 *   호출(editor.js 가 history 커밋·자동저장 타이머를 여기서 건다 — selection.js 는 history 를
 *   모른다, 관심사 분리).
 */
export function createSelectionController({ core, onDirty = () => {}, onSelectionChange = () => {}, onFloatPageChange = () => {} } = {}) {
  const state = { selectedIds: new Set(), editingId: null };
  let currentDoc = null;
  let swallowNextClick = false; // 드래그 직후 따라오는 click 1회를 삼킨다(스파이크 §4-5 실증 패턴)

  function objEl(id) {
    return currentDoc ? currentDoc.querySelector(`[data-oid="${cssEscapeId(id)}"]`) : null;
  }

  function editTarget(el, type) {
    const spec = EDIT_FIELD[type];
    if (!spec || !el) return null;
    return spec.selector ? el.querySelector(spec.selector) : el;
  }

  function readField(targetEl, spec) {
    if (spec.field === 'html' || spec.field === 'bodyHtml') {
      // 편집 크롬(자유 개체 드래그 ⠿ 손잡이·리사이즈 손잡이)이 richtext/지문 innerHTML 에 섞여
      // 저장되지 않도록 걸러낸다(자유 개체 richtext 는 래퍼 자신이 편집 대상이라 손잡이가 자식으로 들어온다).
      if (!targetEl.querySelector('.wg-float-handle, .wg-resize-handle')) return targetEl.innerHTML;
      const clone = targetEl.cloneNode(true);
      for (const n of clone.querySelectorAll('.wg-float-handle, .wg-resize-handle')) n.remove();
      return clone.innerHTML;
    }
    if (spec.stripSelector) {
      const clone = targetEl.cloneNode(true);
      for (const n of clone.querySelectorAll(spec.stripSelector)) n.remove();
      return clone.textContent.trim();
    }
    return targetEl.textContent.trim();
  }

  /** 편집 대상의 서식 보존 HTML 을 읽는다(qnum 배지·편집 크롬 제외 후 정제). title/question 전용. */
  function readHtmlField(targetEl, spec) {
    const clone = targetEl.cloneNode(true);
    for (const n of clone.querySelectorAll('.wg-float-handle, .wg-resize-handle')) n.remove();
    if (spec.stripSelector) for (const n of clone.querySelectorAll(spec.stripSelector)) n.remove();
    return sanitizeInlineHtml(clone.innerHTML.trim());
  }

  /** 현재 편집 중인 개체의 DOM 내용을 obj 필드로 되읽는다(편집 종료·매 input 이벤트에 호출). */
  function syncEditingField() {
    if (!state.editingId) return;
    const found = core.findObject(state.editingId);
    if (!found) return;
    const spec = EDIT_FIELD[found.obj.type];
    if (!spec) return;
    const el = objEl(state.editingId);
    const target = editTarget(el, found.obj.type);
    if (!target) return;
    found.obj[spec.field] = readField(target, spec); // 평문 필드(text/prompt/label/html/bodyHtml)
    // 서식 보존 필드(title.textHtml·question.promptHtml) — 실제 서식이 있을 때만 저장, 없으면 삭제.
    if (spec.htmlField) {
      const html = readHtmlField(target, spec);
      if (hasInlineMarkup(html)) found.obj[spec.htmlField] = html;
      else delete found.obj[spec.htmlField];
    }
  }

  /** float 래퍼에 항상 클릭 가능한 작은 손잡이를 붙인다(미선택 float pointer-events:none 정책의
   *  탈출구 — 스파이크 §4-5: float 이 아래 flow 개체 클릭을 가로채는 z-order 문제 완화). */
  function decorateFloats(doc) {
    for (const el of doc.querySelectorAll('.wg-float[data-oid]')) {
      if (!el.querySelector(':scope > .wg-float-handle')) {
        const handle = doc.createElement('div');
        handle.className = 'wg-float-handle';
        handle.textContent = '⠿';
        handle.setAttribute('aria-hidden', 'true');
        el.prepend(handle);
      }
    }
  }

  const RESIZE_DIRS = Object.freeze(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);

  /** 단일 선택된(편집 중이 아닌) 자유 개체에 8방향 리사이즈 손잡이를 붙인다(마우스 크기 조정, #8).
   *  편집 진입 시(editingId) 손잡이를 떼어 richtext innerHTML 오염을 막는다(readField 방어와 짝). */
  function refreshResizeHandles(doc) {
    const singleFloat = state.selectedIds.size === 1 && !state.editingId
      ? [...state.selectedIds][0] : null;
    for (const el of doc.querySelectorAll('.wg-float[data-oid]')) {
      const want = el.dataset.oid === singleFloat;
      const has = !!el.querySelector(':scope > .wg-resize-handle');
      if (want && !has) {
        for (const dir of RESIZE_DIRS) {
          const h = doc.createElement('div');
          h.className = `wg-resize-handle wg-rh-${dir}`;
          h.dataset.dir = dir;
          h.setAttribute('aria-hidden', 'true');
          el.appendChild(h);
        }
      } else if (!want && has) {
        for (const h of el.querySelectorAll(':scope > .wg-resize-handle')) h.remove();
      }
    }
  }

  /** 선택·편집·float 손잡이 상태를 DOM 클래스/속성에 되비춘다. undo/redo 로 .sheet 를 통째로
   *  교체한 뒤(history.js)에도 이걸 다시 부르면 화면이 즉시 정합해진다. */
  function refreshVisual() {
    if (!currentDoc) return;
    decorateFloats(currentDoc);
    refreshResizeHandles(currentDoc);
    for (const el of currentDoc.querySelectorAll('[data-oid]')) {
      const id = el.dataset.oid;
      el.classList.toggle('wg-selected', state.selectedIds.has(id));
      const editing = state.editingId === id;
      el.classList.toggle('wg-editing', editing);
      if (!editing) {
        const target = editTarget(el, el.dataset.ot);
        if (target && target.hasAttribute('contenteditable')) target.removeAttribute('contenteditable');
      }
    }
    if (state.editingId) {
      const target = editTarget(objEl(state.editingId), core.findObject(state.editingId)?.obj?.type);
      if (target) target.setAttribute('contenteditable', 'true');
    }
  }

  function placeCaretAtEnd(target) {
    const win = target.ownerDocument.defaultView;
    const range = target.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    target.focus();
  }

  /** 편집 중 캐럿의 "편집 대상 내 텍스트 오프셋"을 캡처한다(리플로우 iframe 재로드 대비).
   *  편집 중이 아니거나 캐럿이 편집 대상 밖이면 null. */
  function captureCaret() {
    if (!state.editingId || !currentDoc) return null;
    const found = core.findObject(state.editingId);
    const target = editTarget(objEl(state.editingId), found?.obj?.type);
    const sel = currentDoc.defaultView?.getSelection?.();
    if (!target || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!target.contains(range.startContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(target);
    pre.setEnd(range.startContainer, range.startOffset);
    return { id: state.editingId, offset: pre.toString().length };
  }

  /** iframe 재로드 후 편집 포커스·캐럿을 복원한다 — srcdoc 교체는 포커스를 파괴하므로(활성 요소가
   *  body 로 리셋) 복원하지 않으면 리플로우 직후의 키 입력이 조용히 사라진다. */
  function restoreCaret(saved) {
    if (!state.editingId || !currentDoc) return;
    const effective = saved && saved.id === state.editingId ? saved : null;
    const found = core.findObject(state.editingId);
    const target = editTarget(objEl(state.editingId), found?.obj?.type);
    if (!target) return;
    if (!effective) { placeCaretAtEnd(target); return; }
    const doc = target.ownerDocument;
    const walker = doc.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let remaining = effective.offset;
    let node = walker.nextNode();
    while (node && remaining > node.textContent.length) {
      remaining -= node.textContent.length;
      node = walker.nextNode();
    }
    const range = doc.createRange();
    if (node) range.setStart(node, Math.min(remaining, node.textContent.length));
    else { range.selectNodeContents(target); range.collapse(false); }
    range.collapse(true);
    const sel = doc.defaultView.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    target.focus();
  }

  /** 클릭=선택. additive(Shift/Ctrl)면 집합에 토글, 아니면 단일 교체. 편집 중 다른 개체를
   *  고르면 먼저 편집을 종료(필드 동기화)한다. */
  function select(id, { additive = false } = {}) {
    if (state.editingId && state.editingId !== id) exitEdit();
    if (additive) {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      state.selectedIds = next;
    } else {
      state.selectedIds = new Set([id]);
    }
    refreshVisual();
    onSelectionChange();
  }

  /** 빈 캔버스 클릭 = 전체 해제(편집 중이었으면 먼저 종료) — 스파이크 canvasEl click 핸들러와 동형. */
  function clearAll() {
    if (state.editingId) exitEdit();
    if (state.selectedIds.size === 0) return;
    state.selectedIds = new Set();
    refreshVisual();
    onSelectionChange();
  }

  /** 더블클릭=그 개체만 contenteditable 진입(텍스트 개체류 한정 — EDIT_FIELD 미등재 타입은 선택만). */
  function enterEdit(id) {
    const found = core.findObject(id);
    if (!found) return;
    const spec = EDIT_FIELD[found.obj.type];
    if (!spec) { select(id); return; }
    if (state.editingId === id) return;
    // 편집 대상 DOM 이 실제로 없으면(예: 캡션이 아직 없는 image-slot) 편집 상태로 들어가지
    // 않는다 — 캐럿 없는 유령 편집 상태를 만들지 않기 위함이다(선택만 남긴다).
    if (!editTarget(objEl(id), found.obj.type)) { select(id); return; }
    if (state.editingId) exitEdit();
    state.selectedIds = new Set([id]);
    state.editingId = id;
    refreshVisual();
    // refreshVisual() 이 DOM 을 건드리므로 편집 대상은 여기서 다시 잡는다.
    const target = editTarget(objEl(id), found.obj.type);
    // passage-slot 이 아직 본문 없이 슬롯 플레이스홀더(slotLabel 안내 문구)만 보이는 상태라면,
    // 편집 진입 시 안내 문구를 지우고 빈 칸에서 시작한다 — 그러지 않으면 안내 문구 뒤에 이어
    // 타이핑되어 "［지문 삽입 슬롯］"이 실제 본문에 섞여 들어간다.
    if (target && found.obj.type === 'passage-slot' && !(typeof found.obj.bodyHtml === 'string' && found.obj.bodyHtml.trim())) {
      target.textContent = '';
    }
    if (target) placeCaretAtEnd(target);
    onSelectionChange();
  }

  /** Esc/다른 개체 선택/바깥 클릭 시 편집을 닫는다 — DOM 내용을 obj 필드로 확정하고 선택은
   *  그 개체에 남긴다(편집종료→선택복귀, 완전 해제 아님 — 스파이크 실증 문법). */
  function exitEdit() {
    if (!state.editingId) return;
    syncEditingField();
    state.editingId = null;
    refreshVisual();
    onSelectionChange();
  }

  /** Esc 키 — 편집 중이면 종료(선택 복귀), 아니면 선택 해제. */
  function handleEscape() {
    if (state.editingId) { exitEdit(); return; }
    if (state.selectedIds.size > 0) clearAll();
  }

  /** float 개체 드래그 이동(rect.xMm/yMm, mm 단위) — 화면 좌표(screenX/Y)로 재는 이유는
   *  editor.js 구 startShapeDrag 주석과 동일: iframe↔부모 경계를 넘나들어도 screen 좌표는
   *  단일 원점이라 어긋나지 않는다. 끝나면 다음 click 1회를 삼킨다(공통조상 오인 방지). */
  function startFloatDrag(e, el, id) {
    if (state.editingId === id) return; // 편집 중인 개체는 캐럿 이동이 우선
    const found = core.findObject(id);
    if (!found || !found.obj.rect) return;
    e.preventDefault();
    select(id);
    const startX = e.screenX;
    const startY = e.screenY;
    const base = { ...found.obj.rect };
    let moved = false;
    const onMove = (ev) => {
      const dxMm = (ev.screenX - startX) / MM_TO_PX;
      const dyMm = (ev.screenY - startY) / MM_TO_PX;
      if (Math.abs(dxMm) + Math.abs(dyMm) > 0.5) moved = true;
      found.obj.rect.xMm = round1(base.xMm + dxMm);
      found.obj.rect.yMm = round1(base.yMm + dyMm);
      el.style.left = `${found.obj.rect.xMm}mm`;
      el.style.top = `${found.obj.rect.yMm}mm`;
    };
    const onUp = (ev) => {
      try { el.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      if (moved) {
        swallowNextClick = true; // editor.js:664-667(구) / 스파이크 swallowNextClick 과 동형 방어
        // 페이지 넘나들기(#2 2차): 드롭 지점이 다른 .sheet 위면 그 페이지로 이관하고 rect 를 새 페이지
        // 기준으로 보정한다(줌 스케일 반영). 같은 페이지면 좌표만 커밋.
        const target = crossPageTarget(el, ev.clientX, ev.clientY);
        if (target) onFloatPageChange(id, target.pageIndex, target.rect);
        else onDirty('move');
      }
    };
    try { el.setPointerCapture(e.pointerId); } catch { /* 캡처 불가 환경 */ }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('lostpointercapture', onUp);
  }

  /** 드롭 지점이 현재 페이지가 아닌 .sheet 위면 {pageIndex, rect(새 페이지 기준 mm)} 반환, 아니면 null. */
  function crossPageTarget(el, clientX, clientY) {
    if (!currentDoc) return null;
    const sheets = [...currentDoc.querySelectorAll('.sheet')];
    const curIdx = sheets.findIndex((s) => s.contains(el));
    const targetIdx = sheets.findIndex((s) => {
      const r = s.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    });
    if (targetIdx < 0 || targetIdx === curIdx) return null;
    const sheet = sheets[targetIdx];
    const sr = sheet.getBoundingClientRect();
    const scale = sheet.offsetWidth ? sr.width / sheet.offsetWidth : 1;
    const fr = el.getBoundingClientRect();
    return {
      pageIndex: targetIdx,
      rect: {
        xMm: round1((fr.left - sr.left) / scale / MM_TO_PX),
        yMm: round1((fr.top - sr.top) / scale / MM_TO_PX),
      },
    };
  }

  /** 리사이즈 손잡이 드래그 — dir(nw/n/ne/e/se/s/sw/w)에 따라 rect{wMm/hMm(+xMm/yMm)}을 갱신한다.
   *  좌표는 startFloatDrag 와 동일하게 screen 기준(iframe 경계 무관), 최소 10mm 로 클램프. */
  function startFloatResize(e, el, id, dir) {
    if (state.editingId === id) return;
    const found = core.findObject(id);
    if (!found || !found.obj.rect) return;
    e.preventDefault();
    e.stopPropagation();
    select(id);
    const startX = e.screenX;
    const startY = e.screenY;
    const base = { ...found.obj.rect };
    const MIN = 10;
    let moved = false;
    const onMove = (ev) => {
      const dxMm = (ev.screenX - startX) / MM_TO_PX;
      const dyMm = (ev.screenY - startY) / MM_TO_PX;
      if (Math.abs(dxMm) + Math.abs(dyMm) > 0.5) moved = true;
      const r = { ...base };
      if (dir.includes('e')) r.wMm = base.wMm + dxMm;
      if (dir.includes('s')) r.hMm = base.hMm + dyMm;
      if (dir.includes('w')) { r.wMm = base.wMm - dxMm; r.xMm = base.xMm + dxMm; }
      if (dir.includes('n')) { r.hMm = base.hMm - dyMm; r.yMm = base.yMm + dyMm; }
      if (r.wMm < MIN) { if (dir.includes('w')) r.xMm = base.xMm + (base.wMm - MIN); r.wMm = MIN; }
      if (r.hMm < MIN) { if (dir.includes('n')) r.yMm = base.yMm + (base.hMm - MIN); r.hMm = MIN; }
      found.obj.rect.xMm = round1(r.xMm);
      found.obj.rect.yMm = round1(r.yMm);
      found.obj.rect.wMm = round1(r.wMm);
      found.obj.rect.hMm = round1(r.hMm);
      el.style.left = `${found.obj.rect.xMm}mm`;
      el.style.top = `${found.obj.rect.yMm}mm`;
      el.style.width = `${found.obj.rect.wMm}mm`;
      el.style.height = `${found.obj.rect.hMm}mm`;
    };
    const onUp = (ev) => {
      try { el.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      if (moved) { swallowNextClick = true; onDirty('move'); onSelectionChange(); }
    };
    try { el.setPointerCapture(e.pointerId); } catch { /* 캡처 불가 환경 */ }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('lostpointercapture', onUp);
  }

  /** iframe 문서에 조작 리스너를 배선한다. editor.js 가 teacher iframe load 마다 호출한다. */
  function attach(doc) {
    currentDoc = doc;
    decorateFloats(doc);
    refreshVisual();

    doc.addEventListener('click', (e) => {
      if (swallowNextClick) { swallowNextClick = false; return; }
      const el = e.target.closest('[data-oid]');
      if (!el) { clearAll(); return; }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      select(el.dataset.oid, { additive });
    });

    doc.addEventListener('dblclick', (e) => {
      const el = e.target.closest('[data-oid]');
      if (!el) return;
      enterEdit(el.dataset.oid);
    });

    // 편집 중 입력마다 obj 필드를 즉시 되읽는다 — history 스냅샷(idle 코얼레싱)이 언제 찍히든
    // core.document 가 항상 최신이어야 한다(디바운스 유휴 스냅샷이 낡은 값을 찍지 않도록).
    // 단 IME 조합 중(e.isComposing)에는 되읽지 않는다 — 조합 중 되읽기는 리플로우를 예약해
    // 편집 노드를 교체시키고, 그러면 확정 시 문자가 중복된다(composition.js 주석의 실측 근거).
    doc.addEventListener('input', (e) => {
      if (e.isComposing) return;
      if (!state.editingId) return;
      const el = e.target.closest('[data-oid]');
      if (!el || el.dataset.oid !== state.editingId) return;
      syncEditingField();
      onDirty('text');
    });

    // 붙여넣기는 항상 정규화해서 넣는다 — Word/HWP/웹의 style·class·표 마크업이 그대로 들어오면
    // 테마 CSS 를 덮어써 활동지 서식이 깨진다(pasteNormalize.js 정책 주석 참조).
    // 편집 중이 아닐 때는 개입하지 않는다(브라우저 기본 동작 우선 — 폼 필드·인스펙터 입력 등).
    doc.addEventListener('paste', (e) => {
      if (!state.editingId) return;
      const el = e.target.closest('[data-oid]');
      if (!el || el.dataset.oid !== state.editingId) return;
      const data = e.clipboardData;
      if (!data) return;
      const html = data.getData('text/html');
      // HTML 이 정규화 후 비면(예: 이미지만 복사한 경우) 평문으로 되돌아간다 — 그러지 않으면
      // 기본 동작만 막고 아무것도 넣지 않아 붙여넣기가 조용히 사라진다.
      let clean = html ? normalizePastedHtml(html) : '';
      if (!clean) clean = normalizePastedText(data.getData('text/plain'));
      e.preventDefault();
      if (!clean) return;
      // insertHTML 은 현재 선택 범위를 대체하고 캐럿을 삽입 끝으로 옮긴다(브라우저 기본 undo 스택
      // 과도 정합 — beforeinput historyUndo 훅이 이 편집기의 history 로 되돌린다).
      currentDoc.execCommand('insertHTML', false, clean);
      syncEditingField();
      onDirty('text');
    });

    // 조합 확정 시 한 번만 동기화한다 — 조합 한 번 = undo 1스텝(자모 단위로 쪼개지지 않는다).
    // Chrome 은 compositionend 뒤 isComposing:false 인 input 을 한 번 더 줄 수 있는데, 그 경우
    // 위 리스너가 같은 값으로 다시 동기화할 뿐이라 무해하다(멱등).
    doc.addEventListener('compositionend', () => {
      if (!state.editingId) return;
      syncEditingField();
      onDirty('text');
    });

    doc.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.wg-resize-handle');
      if (handle) {
        const floatEl = handle.closest('.wg-float[data-oid]');
        if (floatEl) startFloatResize(e, floatEl, floatEl.dataset.oid, handle.dataset.dir);
        return;
      }
      const el = e.target.closest('.wg-float[data-oid]');
      if (!el) return;
      startFloatDrag(e, el, el.dataset.oid);
    });

    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); handleEscape(); }
      // Enter = 더블클릭과 같은 편집 진입(PRD §3.2 "더블클릭 또는 Enter로 개체 내용 편집").
      // 두 경로 모두 enterEdit() 한 곳을 거치므로 어떤 타입이 편집 가능한지 판정은 EDIT_FIELD
      // 한 군데에만 있다 — 편집 불가 타입은 enterEdit 이 select() 로 떨어뜨린다.
      else if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        // 이미 무언가를 편집 중이면(개체 본문·표 셀·부분요소) Enter 는 줄바꿈이다 — 개입 금지.
        if (state.editingId || e.target.closest?.('[contenteditable="true"]')) return;
        if (state.selectedIds.size !== 1) return;
        e.preventDefault();
        enterEdit([...state.selectedIds][0]);
      }
    });
  }

  return {
    state, attach, select, clearAll, enterEdit, exitEdit, handleEscape, refreshVisual, syncEditingField,
    captureCaret, restoreCaret,
    isEditableType: (type) => !!EDIT_FIELD[type],
  };
}
