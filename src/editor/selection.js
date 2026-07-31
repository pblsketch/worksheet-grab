// selection.js — editor-v4 개체 우선 선택·인라인 편집 모델(S4.1).
//
// 문서 전체 contenteditable(구 editor.js 의 doc.body.contentEditable='true')을 폐지하고,
// 클릭=개체 선택 · 더블클릭=그 개체 하나만 contenteditable 진입 · Esc=편집종료→선택복귀→
// (다시 Esc)선택해제 의 3단 상태기계로 대체한다(실제 마우스 입력으로 검증한
// enterEditing/exitEditing/Esc 사다리·드래그 후 click 1회 삼키기 패턴).
//
// DOM 은 RenderObjectTree(editMode:true) 가 낸 data-oid 래퍼(.wg-obj = flow, .wg-float = float)를
// 그대로 쓴다 — 클라이언트가 새로 마크업을 주입하지 않는다(개체↔DOM 동기화는 data-oid 매칭만).

import { normalizePastedHtml, normalizePastedText } from '/editor/pasteNormalize.js';
import { marqueeHitOids } from '/editor/marqueeHits.js';

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
 * 나머지 타입(std-box·table·divider·shape·spacer·page-break)은 **개체 전체**를 여는 편집 대상이
 * 아니다 — 더블클릭해도 선택만 유지된다(us16.md 비활성 목록 기록).
 * 단 그중 일부는 **개체 안의 조각**을 partEdit.js 가 따로 연다(2026-07-28): std-box 의 학습목표
 * 문장·박스 제목, table 의 캡션, title 의 배지/모서리/출처, passage-slot 의 제목/출처.
 * 여기(EDIT_FIELD)와 거기(EDITABLE_PARTS)는 **겹치면 안 된다** — partEdit 이 캡처 단계에서
 * dblclick 을 가로채므로, 같은 요소를 둘 다 등록하면 이쪽이 조용히 죽는다(image-slot 캡션이 그 예:
 * 여기가 소유하므로 렌더는 figcaption 에 data-part 를 싣지 않는다).
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
  // ul/ol/li/a 추가(서식 확장) — 목록·링크만 있는 편집도 title/question htmlField 로 보존한다
  // (richtext 는 field:'html' 직결이라 이 게이트를 거치지 않음).
  return /<(b|strong|i|em|u|s|sub|sup|font|span|mark|br|ul|ol|li|a)\b/i.test(html);
}

function cssEscapeId(id) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
  return String(id).replace(/["\\]/g, '\\$&'); // CSS.escape 부재 환경 최소 폴백
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** 편집 전용 크롬 — DOM 을 콘텐츠로 굳힐 때 반드시 빼야 하는 것들. 자유 개체는 래퍼 **안**에
 *  손잡이를 넣으므로(decorateFloats·refreshResizeHandles) innerHTML 에 그대로 딸려 온다. */
const EDIT_CHROME_SELECTOR = '.wg-float-handle, .wg-resize-handle';

/**
 * 편집 크롬을 뺀 innerHTML — **DOM 을 문서 콘텐츠로 굳히는 모든 경로가 이 하나를 쓴다.**
 *
 * 2026-07-28: 종전엔 이 제거가 selection.js 안(readField/readHtmlField)에만 있었고,
 * '내 블록으로 저장'(editor.js saveObjectAsPreset)은 `el.innerHTML` 을 날것으로 보냈다.
 * 그래서 자유 개체를 프리셋으로 저장하면 저장된 html 이 `<div class="wg-float-handle">⠿</div>`
 * 로 시작했고(실측), 그 프리셋은 삽입될 때 richtext.html 이 되므로 **⠿ 와 파란 리사이즈 사각형이
 * 학생 배포본에 인쇄**됐다. 제거 규칙이 두 벌로 갈라져 있던 것이 원인이라 하나로 모은다.
 */
export function innerHtmlWithoutChrome(el) {
  if (!el) return '';
  if (!el.querySelector(EDIT_CHROME_SELECTOR)) return el.innerHTML; // 흔한 경로 — 복제 없이
  const clone = el.cloneNode(true);
  for (const n of clone.querySelectorAll(EDIT_CHROME_SELECTOR)) n.remove();
  return clone.innerHTML;
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
      return innerHtmlWithoutChrome(targetEl);
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
    for (const n of clone.querySelectorAll(EDIT_CHROME_SELECTOR)) n.remove();
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
   *  탈출구 — 스파이크 §4-5: float 이 아래 flow 개체 클릭을 가로채는 z-order 문제 완화).
   *
   *  DOM 은 항상 붙이되 **보이는 것은 가리킨 개체의 것뿐**이다(2026-07-28) — CSS 가 기본
   *  opacity:0 이고 여기 붙는 `is-hot` 만 드러낸다. 손잡이를 아예 없앨 수는 없다: 미선택 float
   *  래퍼가 pointer-events:none 이라 이것이 유일한 진입점이고, 얇거나 내용이 비치지 않는 개체는
   *  몸통으로 잡을 수단이 없다. */
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
    applyFloatHot(doc); // 새로 붙인 손잡이에도 현재 hover 상태를 입힌다
  }

  // 가리키는 자유 개체의 손잡이만 드러낸다. canvasInline 의 flow 조작 칩과 같은 규칙이되,
  // 이 손잡이는 selection.js 소관이라 여기서 따로 추적한다(NO_BODY_DRAG_SELECTORS 의 소유 구분).
  let hotFloatOid = null;

  function applyFloatHot(doc) {
    for (const el of doc.querySelectorAll('.wg-float[data-oid]')) {
      const handle = el.querySelector(':scope > .wg-float-handle');
      if (handle) handle.classList.toggle('is-hot', el.dataset.oid === hotFloatOid);
    }
  }

  function setHotFloat(doc, oid) {
    if (hotFloatOid === oid) return;
    hotFloatOid = oid;
    applyFloatHot(doc);
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

  // ── 스냅 / 스마트 가이드(자체구현) — float 드래그 시 같은 페이지 다른 float 의 좌/중/우·상/중/하
  // 선에 정렬한다(객체-대-객체). 가이드선은 transient 오버레이라 모델/저장을 오염시키지 않는다. ──
  const SNAP_MM = 2; // 스냅 임계값(약 7.5px @96dpi)

  /** 드래그 중인 float 과 같은 페이지의 다른 float 개체(스냅 후보). */
  function siblingFloats(id) {
    for (const page of core.getDocument().pages || []) {
      if ((page.float || []).some((o) => o.id === id)) return (page.float || []).filter((o) => o.id !== id && o.rect);
    }
    return [];
  }

  /** 제안 rect(xMm,yMm,wMm,hMm)를 형제 float 의 좌/중/우·상/중/하 선에 스냅. X·Y 독립, 각 축 최근접
   *  후보 1개. {xMm,yMm,gx,gy}(gx/gy = 스냅된 가이드선 mm 또는 null) 반환. */
  function computeSnap(xMm, yMm, wMm, hMm, sibs) {
    const pick = (edges, cands) => {
      let best = null;
      for (const edge of edges) {
        for (const c of cands) {
          const d = c - edge;
          if (Math.abs(d) <= SNAP_MM && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, line: c };
        }
      }
      return best;
    };
    const xCands = [];
    const yCands = [];
    for (const o of sibs) {
      xCands.push(o.rect.xMm, o.rect.xMm + o.rect.wMm / 2, o.rect.xMm + o.rect.wMm);
      yCands.push(o.rect.yMm, o.rect.yMm + o.rect.hMm / 2, o.rect.yMm + o.rect.hMm);
    }
    const bx = pick([xMm, xMm + wMm / 2, xMm + wMm], xCands);
    const by = pick([yMm, yMm + hMm / 2, yMm + hMm], yCands);
    return {
      xMm: round1(bx ? xMm + bx.delta : xMm),
      yMm: round1(by ? yMm + by.delta : yMm),
      gx: bx ? bx.line : null,
      gy: by ? by.line : null,
    };
  }

  function clearGuides(sheet) {
    const root = sheet || currentDoc;
    if (root) for (const g of root.querySelectorAll('.wg-snap-guide')) g.remove();
  }
  function drawGuides(sheet, gx, gy) {
    clearGuides(sheet);
    if (!sheet) return;
    const make = (axis, mm) => {
      const g = currentDoc.createElement('div');
      g.className = 'wg-snap-guide';
      g.setAttribute('aria-hidden', 'true');
      Object.assign(g.style, { position: 'absolute', zIndex: '9998', pointerEvents: 'none', background: '#f43f5e' });
      if (axis === 'v') Object.assign(g.style, { left: `${mm}mm`, top: '0', bottom: '0', width: '1px' });
      else Object.assign(g.style, { top: `${mm}mm`, left: '0', right: '0', height: '1px' });
      return g;
    };
    if (gx != null) sheet.appendChild(make('v', gx));
    if (gy != null) sheet.appendChild(make('h', gy));
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
    const sibs = siblingFloats(id);       // 스냅 후보(같은 페이지 다른 float) — 드래그 시작 시 1회 수집
    const dragSheet = el.closest('.sheet'); // 가이드선을 그릴 시트(float 과 같은 좌표 원점)
    let moved = false;
    const onMove = (ev) => {
      const dxMm = (ev.screenX - startX) / MM_TO_PX;
      const dyMm = (ev.screenY - startY) / MM_TO_PX;
      if (Math.abs(dxMm) + Math.abs(dyMm) > 0.5) moved = true;
      const snap = computeSnap(round1(base.xMm + dxMm), round1(base.yMm + dyMm), base.wMm, base.hMm, sibs);
      found.obj.rect.xMm = snap.xMm;
      found.obj.rect.yMm = snap.yMm;
      el.style.left = `${snap.xMm}mm`;
      el.style.top = `${snap.yMm}mm`;
      drawGuides(dragSheet, snap.gx, snap.gy);
    };
    const onUp = (ev) => {
      try { el.releasePointerCapture(ev.pointerId); } catch { /* 이미 해제됨 */ }
      clearGuides(dragSheet);
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

  /**
   * 개체가 지금 화면에서 차지한 위치·크기를 그 페이지(.sheet) 기준 mm rect 로 실측한다.
   * flow→float 승격이 개체를 **보이던 그 자리에** 고정시키기 위한 입력이다(없으면 좌상단으로 튄다).
   *
   * 좌표 변환이 필요 없는 이유: float 은 `.sheet` 직속 `position:absolute` 자식으로 렌더되고
   * (RenderObjectTree), 절대배치 자식의 containing block 은 CSS 상 **padding edge** 인데
   * `.sheet` 는 border 선언이 없어 `border-width:0` 이라 padding edge == border edge 가 된다.
   * 그래서 `.sheet` 의 border box 기준으로 잰 값이 곧 float rect 다.
   * ⚠ `assets/paper.css` 의 `.sheet` 규칙에 **border 를 추가하면 모든 float 절대좌표 원점이
   *    그만큼 이동한다** — 화면 전용 테두리를 넣고 싶으면 outline/box-shadow 를 쓸 것.
   *
   * 줌 보정은 crossPageTarget(:449) 과 같은 offsetWidth 비율식을 쓴다. 측정은 iframe 내부라
   * 부모 #stage 의 transform:scale 과는 무관하고, 이 비율은 offsetWidth 정수 반올림 보정이다.
   *
   * @returns {{xMm:number,yMm:number,wMm:number,hMm:number}|null} 실측 불가 시 null(호출부 폴백)
   */
  function measureRectMm(id) {
    const el = objEl(id);
    const sheet = el?.closest('.sheet');
    if (!el || !sheet) return null;
    const r = rectToSheetMm(el.getBoundingClientRect(), sheet);
    if (!r || !(r.wMm > 0) || !(r.hMm > 0)) return null; // 미렌더·0치수 → 폴백에 맡긴다
    return r;
  }

  /** 화면 rect → 그 시트 기준 mm rect. 줌 보정은 offsetWidth 비율(측정은 iframe 내부라 부모
   *  #stage 의 transform:scale 과 무관하고, 이 비율은 offsetWidth 정수 반올림 보정이다). */
  function rectToSheetMm(r, sheet) {
    const sr = sheet.getBoundingClientRect();
    const scale = sheet.offsetWidth ? sr.width / sheet.offsetWidth : 1;
    if (!scale) return null;
    return {
      xMm: round1((r.left - sr.left) / scale / MM_TO_PX),
      yMm: round1((r.top - sr.top) / scale / MM_TO_PX),
      wMm: round1(r.width / scale / MM_TO_PX),
      hMm: round1(r.height / scale / MM_TO_PX),
    };
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
    const mm = rectToSheetMm(el.getBoundingClientRect(), sheets[targetIdx]);
    // 통합 전 이 함수는 scale 이 0 이어도 그대로 나눠 Infinity 좌표를 만들었다(폭 0 인 시트 위로
    // 드롭한 극단적 경우). 이제 null 로 떨어져 이관 자체를 안 한다 — 유일한 동작 차이이고,
    // 개체가 화면 밖으로 날아가는 것보다 제자리에 두는 쪽이 맞다.
    if (!mm) return null;
    // 이동만 하므로 좌상단만 넘긴다(크기는 그대로 유지).
    return { pageIndex: targetIdx, rect: { xMm: mm.xMm, yMm: mm.yMm } };
  }

  /** 회전 각도(도) — 렌더와 같은 범위로 클램프한다(RenderObjectTree 는 [-180,180]). */
  function angleOf(obj) {
    const a = typeof obj?.angle === 'number' ? obj.angle : 0;
    return Math.max(-180, Math.min(180, a));
  }

  /** 리사이즈 손잡이 드래그 — dir(nw/n/ne/e/se/s/sw/w)에 따라 rect{wMm/hMm(+xMm/yMm)}을 갱신한다.
   *  좌표는 startFloatDrag 와 동일하게 screen 기준(iframe 경계 무관), 최소 10mm 로 클램프.
   *
   *  **회전 보정(2026-07-28)**: 손잡이는 `.wg-float` 의 자식이라 `transform:rotate()` 를 함께 받아
   *  화면 위치는 이미 맞다. 틀렸던 것은 **계산**이다 — 화면 델타를 그대로 wMm/hMm 에 더하면 45°
   *  돌린 개체의 오른쪽 손잡이를 오른쪽으로 끌 때 폭과 높이가 뒤섞인다. 그래서
   *   ① 화면 델타를 −θ 로 돌려 개체 로컬 축으로 바꾸고,
   *   ② 회전 중심이 rect 중심이므로(transform-origin:center center) 크기가 변하면 중심이 움직인다 —
   *      **반대편 변이 화면에서 제자리에 있도록** 중심을 +θ 로 돌린 만큼 보정한다.
   *  θ=0 이면 이 식은 종전 식과 **정확히 같은 값**을 낸다(회귀 0 의 근거 — 전용 테스트로 고정). */
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
    const rad = (angleOf(found.obj) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // 방향 부호 — 어느 변을 끌고 있는지(반대편이 고정된다).
    const sx = dir.includes('e') ? 1 : (dir.includes('w') ? -1 : 0);
    const sy = dir.includes('s') ? 1 : (dir.includes('n') ? -1 : 0);
    const baseCx = base.xMm + base.wMm / 2;
    const baseCy = base.yMm + base.hMm / 2;

    const onMove = (ev) => {
      const screenDx = (ev.screenX - startX) / MM_TO_PX;
      const screenDy = (ev.screenY - startY) / MM_TO_PX;
      if (Math.abs(screenDx) + Math.abs(screenDy) > 0.5) moved = true;
      // ① 화면 델타 → 개체 로컬 축(−θ 회전).
      const dxMm = screenDx * cos + screenDy * sin;
      const dyMm = -screenDx * sin + screenDy * cos;

      const r = { ...base };
      if (sx) r.wMm = base.wMm + sx * dxMm;
      if (sy) r.hMm = base.hMm + sy * dyMm;
      if (r.wMm < MIN) r.wMm = MIN;
      if (r.hMm < MIN) r.hMm = MIN;

      // ② 중심 보정 — 클램프 뒤의 **실제** 크기 변화만큼만 옮긴다(로컬 → +θ 회전 → 부모 좌표).
      const dw = r.wMm - base.wMm;
      const dh = r.hMm - base.hMm;
      const localShiftX = (sx * dw) / 2;
      const localShiftY = (sy * dh) / 2;
      const cx = baseCx + localShiftX * cos - localShiftY * sin;
      const cy = baseCy + localShiftX * sin + localShiftY * cos;
      r.xMm = cx - r.wMm / 2;
      r.yMm = cy - r.hMm / 2;

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

    // 가리키는 자유 개체의 손잡이만 드러낸다. 미선택 래퍼는 pointer-events:none 이지만 자식은
    // auto 라 **내용 위**에서는 이벤트가 뜬다 — 그래서 hover 로도 발견된다. 손잡이 자신 위도
    // 같은 개체로 친다(래퍼를 벗어나 손잡이로 다가가는 도중에 꺼지면 잡을 수 없다).
    doc.addEventListener('pointermove', (e) => {
      const floatEl = e.target.closest?.('.wg-float[data-oid]');
      setHotFloat(doc, floatEl?.dataset.oid ?? null);
    });
    doc.documentElement.addEventListener('pointerleave', () => setHotFloat(doc, null));

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
      // 편집 세션 소유자가 셋이다 — selection(`state.editingId`) · tableEdit(`editingCell`) ·
      // partEdit(`editingEl`). `editingId` 만 보면 **표 셀·조각을 편집하는 동안의 붙여넣기가
      // 정규화를 통째로 건너뛴다**(그 둘은 지역 상태만 세운다) → 브라우저 기본 삽입으로 Word/HWP
      // 마크업이 화면 DOM 에 들어가고, 리플로우는 그 DOM 을 재서 페이지를 배정한다.
      // D1(단축키 가드)과 같은 규약으로 판정을 **이벤트 대상**으로 넓힌다 — 세 소유자를 다 알
      // 필요 없이 "지금 이 노드가 편집 중인가"만 보면 된다.
      // ⚠ `instanceof Element` 를 쓰면 안 된다 — 이 모듈은 부모 문서 realm 에서 로드되고 캔버스
      //    요소는 **iframe realm** 의 Element 라 크로스 realm instanceof 가 언제나 false 다
      //    (그렇게 썼다가 정규화가 전 경로에서 죽었고 대조군 테스트가 잡았다). 능력으로 판정한다.
      const target = typeof e.target?.closest === 'function' ? e.target : e.target?.parentElement ?? null;
      const host = target?.closest?.('[contenteditable="true"]');
      const el = host?.closest('[data-oid]');
      if (!host || !el) return;
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
      // 되읽기는 **이 개체를 selection 이 편집 중일 때만** 여기서 한다. 표 셀·조각은 각 모듈의
      // input 리스너가 이미 듣고 있고(`tableEdit.js`·`partEdit.js`), `insertHTML` 은 input 을
      // 정확히 1회 발화한다(0.5단계 프로브 실측) — 여기서 또 부르면 이중 동기화가 된다.
      if (state.editingId && el.dataset.oid === state.editingId) {
        syncEditingField();
        onDirty('text');
      }
    });

    // 조합 확정 시 한 번만 동기화한다 — 조합 한 번 = undo 1스텝(자모 단위로 쪼개지지 않는다).
    // Chrome 은 compositionend 뒤 isComposing:false 인 input 을 한 번 더 줄 수 있는데, 그 경우
    // 위 리스너가 같은 값으로 다시 동기화할 뿐이라 무해하다(멱등).
    doc.addEventListener('compositionend', () => {
      if (!state.editingId) return;
      syncEditingField();
      onDirty('text');
    });

    // 마퀴(드래그 박스) 다중선택 — 빈 캔버스에서 드래그해 사각형을 그리고, 교차하는 개체를 모은다.
    // flow(.wg-obj)·float(.wg-float) **둘 다** 대상이다(M1 — 활동지 본문 대부분이 flow 라, float 만
    // 모으면 제목·문항·지문·표를 못 잡아 "영역으로 잡기"가 반쪽이 된다). 시작 규칙은 그대로 —
    // float 위 pointerdown=드래그, 개체 위=클릭/본체드래그, 편집 중=텍스트 선택으로 양보하고,
    // 순수 .sheet 배경에서만 시작한다(교차 판정·중복제거는 marqueeHitOids 순수함수에 위임).
    let marquee = null;
    const marqueeSheetAt = (x, y) => [...doc.querySelectorAll('.sheet')].find((s) => {
      const r = s.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null;
    function updateMarqueeBox(x, y) {
      if (!marquee.box) {
        marquee.box = doc.createElement('div');
        Object.assign(marquee.box.style, {
          position: 'fixed', border: '1px solid #2563eb', background: 'rgba(37,99,235,.12)',
          zIndex: '9999', pointerEvents: 'none', boxSizing: 'border-box',
        });
        marquee.box.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(marquee.box);
      }
      marquee.box.style.left = `${Math.min(marquee.x0, x)}px`;
      marquee.box.style.top = `${Math.min(marquee.y0, y)}px`;
      marquee.box.style.width = `${Math.abs(x - marquee.x0)}px`;
      marquee.box.style.height = `${Math.abs(y - marquee.y0)}px`;
    }
    function finishMarquee(e) {
      const m = marquee;
      marquee = null;
      try { doc.documentElement.releasePointerCapture(e.pointerId); } catch {}
      m.box?.remove();
      if (!m.moved) return; // 실제 드래그가 아니면(제자리 클릭) click 핸들러가 clearAll 처리
      const box = {
        left: Math.min(m.x0, e.clientX), top: Math.min(m.y0, e.clientY),
        right: Math.max(m.x0, e.clientX), bottom: Math.max(m.y0, e.clientY),
      };
      // flow(.wg-obj)·float(.wg-float) 를 함께 모아 교차 판정에 넘긴다(M1). 판정·중복제거는 순수함수.
      const objects = [];
      for (const el of doc.querySelectorAll('.wg-obj[data-oid], .wg-float[data-oid]')) {
        objects.push({ oid: el.dataset.oid, rect: el.getBoundingClientRect() });
      }
      const hits = marqueeHitOids(objects, box);
      swallowNextClick = true; // 드래그 끝에 따라오는 click 이 방금 만든 선택을 지우지 않도록
      state.selectedIds = new Set(hits);
      state.editingId = null;
      refreshVisual();
      onSelectionChange();
    }

    doc.addEventListener('pointerdown', (e) => {
      // 새 제스처가 시작됐다 = 직전 제스처의 click 은 끝내 오지 않았다 → 무장 해제(2026-07-28).
      // 드래그 종료 시 arm 한 플래그는 "곧 따라올 click 1회"를 겨냥한 것인데, 재장식으로 pointerdown
      // 대상이 DOM 에서 떨어져 나가면 브라우저가 그 click 을 아예 만들지 않는다(실측: 드래그 구간
      // 이벤트 로그에 click 0건). 남은 플래그는 사용자의 **다음 진짜 클릭**을 먹어 "한 번 더 눌러야
      // 선택되는" 증상이 됐다. click 은 언제나 다음 pointerdown 보다 먼저 오므로 여기서 지워도
      // 정상 경로는 손상되지 않는다.
      swallowNextClick = false;
      // flow 오버레이(크기 손잡이 ⠿ · + 삽입)는 `.wg-obj` **밖**에 그려진다 — 아래 마퀴 판정이 그걸
      // "빈 배경"으로 보고 마퀴를 함께 시작해, 드롭에서 finishMarquee 가 선택을 float 교차분(문서에
      // float 이 없으면 빈 집합)으로 덮어써 **크기조정 직후 선택이 사라졌다.** 이 컨트롤들은 자기
      // 드래그 핸들러를 가지므로 선택 계층은 손대지 않는다. canvasInline 의 stopPropagation() 은
      // 여기에 닿지 않는다 — 두 리스너가 같은 `doc` 노드에 달려 전파 중단이 형제를 막지 못한다.
      if (e.target.closest?.('.wg-flow-overlay')) return;
      const handle = e.target.closest('.wg-resize-handle');
      if (handle) {
        const floatEl = handle.closest('.wg-float[data-oid]');
        if (floatEl) startFloatResize(e, floatEl, floatEl.dataset.oid, handle.dataset.dir);
        return;
      }
      const el = e.target.closest('.wg-float[data-oid]');
      if (el) { startFloatDrag(e, el, el.dataset.oid); return; }
      if (e.button !== 0 || state.editingId) return;
      if (e.target.closest('[data-oid]')) return; // flow 개체 위 → 클릭 선택 경로에 양보
      if (!marqueeSheetAt(e.clientX, e.clientY)) return; // 시트 밖 여백 → 마퀴 안 함
      marquee = { x0: e.clientX, y0: e.clientY, pointerId: e.pointerId, moved: false, box: null };
      try { doc.documentElement.setPointerCapture(e.pointerId); } catch {}
    });
    doc.addEventListener('pointermove', (e) => {
      if (!marquee || e.pointerId !== marquee.pointerId) return;
      if (!marquee.moved && Math.abs(e.clientX - marquee.x0) < 4 && Math.abs(e.clientY - marquee.y0) < 4) return;
      marquee.moved = true;
      updateMarqueeBox(e.clientX, e.clientY);
      e.preventDefault();
    });
    doc.addEventListener('pointerup', (e) => {
      if (marquee && e.pointerId === marquee.pointerId) finishMarquee(e);
    });
    doc.addEventListener('pointercancel', (e) => {
      if (marquee && e.pointerId === marquee.pointerId) { marquee.box?.remove(); marquee = null; }
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
    captureCaret, restoreCaret, measureRectMm,
    // 드래그 직후 따라오는 click 1회를 삼키게 예약한다. 내부 생산자(startFloatDrag·startFloatResize·
    // 마퀴)와 같은 플래그를 쓰며, canvasInline 의 **본체 드래그**가 네 번째 생산자다 — 그 click 은
    // target 이 공통 조상(.sheet)으로 잡혀 "바깥 클릭 = 선택 해제" 경로를 타기 때문.
    armSwallowClick: () => { swallowNextClick = true; },
    isEditableType: (type) => !!EDIT_FIELD[type],
  };
}
