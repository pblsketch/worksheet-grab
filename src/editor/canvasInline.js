// canvasInline.js — editor-v4 S4.3 캔버스 인라인 조작: 텍스트 편집 중 버블 툴바, `/` 슬래시 메뉴
// (닫힌 카탈로그 삽입), flow 개체 hover ⠿ 핸들(드래그 재정렬)+`+` 삽입 버튼, 우클릭 메뉴.
//
// selection.js 와 마찬가지로 iframe 문서에 매 load 마다 attach() 로 리스너를 다시 건다. 팝업(버블·
// 슬래시·컨텍스트 메뉴)은 iframe 밖(부모 문서)에 fixed 포지션으로 띄운다.
//
// 핸들/삽입 버튼은 `.wg-obj` **안**이 아니라 `.sheet` 에 딸린 별도 오버레이 레이어에 절대좌표로
// 띄운다(getBoundingClientRect 상대 계산) — richtext 개체는 EDIT_FIELD(selector:null) 규약상
// `.wg-obj` 자신이 contenteditable 대상이 되므로, 그 안에 자식을 넣으면 selection.js 의
// readField(innerHTML 그대로 읽기)가 핸들/버튼 마크업까지 obj.html 에 섞어 저장해 콘텐츠를
// 오염시킨다(실제로 처음엔 안에 넣었다가 이 문제를 realize 하고 오버레이 방식으로 다시 짰다).

import { CATALOG_ITEMS } from './objectFactory.js';

function closeAll(popupsHost) {
  popupsHost.replaceChildren();
}

/**
 * @param {{
 *   popupsHost: HTMLElement,
 *   getSelectionState: () => {editingId:string|null, selectedIds:Set<string>},
 *   findObject: (id:string) => {obj:object}|null,
 *   onFormat: (cmd:string, value?:string) => void,
 *   onAnswerToggle: (id:string) => void,
 *   onInsertAfter: (item:object, afterId:string) => void,
 *   onDuplicate: (id:string) => void,
 *   onDelete: (id:string) => void,
 *   onFlowFloat: (id:string) => void,
 *   onSaveAsPreset: (id:string) => void,
 *   onReorderStep: (id:string, direction:'up'|'down') => void,
 *   onReorderCommit: () => void,
 *   excludedAiTypes: Set<string>, // US-19 — std-box(§7, 원칙 3) 는 AI 진입점 비활성(passage-slot 은
 *   3층 정책, 2026-07-23 2차 델타로 해제)
 *   onAiOpen: (id:string) => void, // US-19 — AI 패널을 이 개체로 연다
 * }} deps
 */
export function createCanvasInline(deps) {
  const { popupsHost } = deps;
  const excludedAiTypes = deps.excludedAiTypes || new Set();
  let currentDoc = null;
  let currentFrame = null;

  // ── 버블 툴바(텍스트 선택 중, richtext 편집 한정 — us16.md 서식 한계 동형) ──
  function updateBubble() {
    closeBubbleOnly();
    const { editingId } = deps.getSelectionState();
    if (!editingId) return;
    const found = deps.findObject(editingId);
    if (!found || found.obj.type !== 'richtext') return;
    const sel = currentDoc.defaultView.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const frameRect = currentFrame.getBoundingClientRect();

    const bubble = document.createElement('div');
    bubble.className = 'bubble-toolbar';
    bubble.id = 'canvas-bubble';
    bubble.style.left = `${frameRect.left + rect.left + rect.width / 2}px`;
    bubble.style.top = `${frameRect.top + rect.top - 36}px`;
    for (const [cmd, label] of [['bold', 'B'], ['italic', 'I'], ['underline', 'U']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.cmd = cmd;
      b.addEventListener('mousedown', (e) => { e.preventDefault(); deps.onFormat(cmd); });
      bubble.appendChild(b);
    }
    const color = document.createElement('input');
    color.type = 'color';
    color.addEventListener('mousedown', (e) => e.preventDefault());
    color.addEventListener('input', () => deps.onFormat('foreColor', color.value));
    bubble.appendChild(color);
    const answerBtn = document.createElement('button');
    answerBtn.textContent = '★';
    answerBtn.dataset.cmd = 'answer';
    answerBtn.addEventListener('mousedown', (e) => { e.preventDefault(); deps.onAnswerToggle(editingId); });
    bubble.appendChild(answerBtn);
    popupsHost.appendChild(bubble);
  }
  function closeBubbleOnly() { popupsHost.querySelector('#canvas-bubble')?.remove(); }

  // ── `/` 슬래시 메뉴(닫힌 카탈로그만) ──
  function openSlashMenu(caretRect, afterId) {
    closeAll(popupsHost);
    const frameRect = currentFrame.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'slash-menu';
    menu.id = 'canvas-slash-menu';
    menu.dataset.slashOpen = 'true';
    menu.dataset.slashCount = String(CATALOG_ITEMS.length);
    menu.style.left = `${frameRect.left + caretRect.left}px`;
    menu.style.top = `${frameRect.top + caretRect.bottom + 4}px`;
    // US-19: 슬래시 메뉴도 AI 패널 진입점 — afterId(직전 개체) 를 대상으로 연다.
    const target = deps.findObject?.(afterId);
    const aiBtn = document.createElement('button');
    aiBtn.textContent = 'AI 로 편집';
    aiBtn.dataset.slashItem = 'ai';
    aiBtn.disabled = !target || excludedAiTypes.has(target.obj.type);
    aiBtn.addEventListener('click', () => {
      closeAll(popupsHost);
      document.body.dataset.slashOpen = 'false';
      deps.onAiOpen?.(afterId);
    });
    menu.appendChild(aiBtn);
    for (const item of CATALOG_ITEMS) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.dataset.slashItem = item.key;
      b.addEventListener('click', () => {
        closeAll(popupsHost);
        document.body.dataset.slashOpen = 'false';
        deps.onInsertAfter(item, afterId);
      });
      menu.appendChild(b);
    }
    popupsHost.appendChild(menu);
    document.body.dataset.slashOpen = 'true';
    document.body.dataset.slashCount = String(CATALOG_ITEMS.length);
    setTimeout(() => document.addEventListener('click', () => { closeAll(popupsHost); document.body.dataset.slashOpen = 'false'; }, { once: true }), 0);
  }

  // ── flow 개체 hover ⠿ 핸들 + `+` 삽입 버튼(오버레이 — `.wg-obj` 밖) ──
  function decorateFlowHandles(doc) {
    for (const sheet of doc.querySelectorAll('.sheet')) {
      if (getComputedStyle(sheet).position === 'static') sheet.style.position = 'relative';
      let overlay = sheet.querySelector(':scope > .wg-flow-overlay');
      if (!overlay) {
        overlay = doc.createElement('div');
        overlay.className = 'wg-flow-overlay';
        sheet.appendChild(overlay);
      }
      overlay.replaceChildren();
      const sheetRect = sheet.getBoundingClientRect();
      for (const objEl of sheet.querySelectorAll(':scope .wg-obj[data-oid]')) {
        const r = objEl.getBoundingClientRect();
        const top = r.top - sheetRect.top;
        const handle = doc.createElement('div');
        handle.className = 'wg-flow-handle';
        handle.dataset.forOid = objEl.dataset.oid;
        handle.textContent = '⠿';
        handle.style.top = `${top}px`;
        overlay.appendChild(handle);
        const plus = doc.createElement('button');
        plus.className = 'wg-flow-insert';
        plus.type = 'button';
        plus.dataset.forOid = objEl.dataset.oid;
        plus.textContent = '+';
        plus.style.top = `${top + Math.max(0, r.height - 11)}px`;
        overlay.appendChild(plus);
      }
    }
  }

  let dragState = null;
  function startFlowDrag(e, handleEl) {
    const id = handleEl.dataset.forOid;
    const objEl = currentDoc.querySelector(`[data-oid="${cssEscape(id)}"]`);
    if (!objEl) return;
    e.preventDefault();
    dragState = { id, lastY: e.screenY };
    handleEl.setPointerCapture?.(e.pointerId);
    const onMove = (ev) => {
      if (!dragState) return;
      const dy = ev.screenY - dragState.lastY;
      const rowHeight = objEl.getBoundingClientRect().height || 40;
      if (Math.abs(dy) < rowHeight / 2) return;
      const direction = dy > 0 ? 'down' : 'up';
      const sib = direction === 'down' ? objEl.nextElementSibling : objEl.previousElementSibling;
      if (sib && sib.matches?.('.wg-obj[data-oid]')) {
        if (direction === 'down') objEl.parentNode.insertBefore(sib, objEl);
        else objEl.parentNode.insertBefore(objEl, sib);
        deps.onReorderStep(id, direction);
        dragState.lastY = ev.screenY;
        decorateFlowHandles(currentDoc);
      }
    };
    const onUp = () => {
      handleEl.removeEventListener('pointermove', onMove);
      handleEl.removeEventListener('pointerup', onUp);
      handleEl.removeEventListener('lostpointercapture', onUp);
      dragState = null;
      deps.onReorderCommit();
    };
    handleEl.addEventListener('pointermove', onMove);
    handleEl.addEventListener('pointerup', onUp);
    handleEl.addEventListener('lostpointercapture', onUp);
  }

  function cssEscape(id) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
    return String(id).replace(/["\\]/g, '\\$&');
  }

  // ── 우클릭 메뉴(복제·삭제·flow⇄float·내 블록으로 저장·앞/뒤로 보내기) ──
  function openContextMenu(e, id) {
    e.preventDefault();
    closeAll(popupsHost);
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.id = 'canvas-ctx-menu';
    const frameRect = currentFrame.getBoundingClientRect();
    menu.style.left = `${frameRect.left + e.clientX}px`;
    menu.style.top = `${frameRect.top + e.clientY}px`;
    const targetForAi = deps.findObject?.(id);
    const aiDisabled = !targetForAi || excludedAiTypes.has(targetForAi.obj.type);
    const items = [
      ['AI 로 편집', () => deps.onAiOpen?.(id), aiDisabled, aiDisabled ? '(성취기준·저작권 슬롯 제외)' : '', 'ctx-ai'],
      ['복제', () => deps.onDuplicate(id), false, '', null],
      ['삭제', () => deps.onDelete(id), false, '', null],
      ['flow⇄float 전환', () => deps.onFlowFloat(id), false, '', null],
      ['내 블록으로 저장', () => deps.onSaveAsPreset(id), false, '', null],
      ['앞으로 보내기', null, true, '(스파이크 §4-5 후속)', null],
      ['뒤로 보내기', null, true, '(스파이크 §4-5 후속)', null],
    ];
    for (const [label, action, disabled, suffix, itemId] of items) {
      const b = document.createElement('button');
      b.textContent = disabled ? `${label}${suffix}` : label;
      b.disabled = disabled;
      if (itemId) b.id = itemId;
      if (action) b.addEventListener('click', () => { closeAll(popupsHost); action(); });
      menu.appendChild(b);
    }
    popupsHost.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => closeAll(popupsHost), { once: true }), 0);
  }

  function attach(doc, frameEl) {
    currentDoc = doc;
    currentFrame = frameEl;
    decorateFlowHandles(doc);

    doc.addEventListener('selectionchange', () => updateBubble());
    doc.addEventListener('mouseup', () => updateBubble());

    doc.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.wg-flow-handle');
      if (handle) startFlowDrag(e, handle);
    });

    doc.addEventListener('click', (e) => {
      const plus = e.target.closest('.wg-flow-insert');
      if (!plus) return;
      const rect = plus.getBoundingClientRect();
      openSlashMenu(rect, plus.dataset.forOid);
    });

    doc.addEventListener('contextmenu', (e) => {
      const el = e.target.closest('[data-oid]');
      if (!el) return;
      openContextMenu(e, el.dataset.oid);
    });

    // `/` = 슬래시 메뉴(현재 편집 중인 개체 뒤에 삽입). 문자 자체는 본문에 남기지 않는다.
    doc.addEventListener('keydown', (e) => {
      if (e.key !== '/') return;
      const { editingId } = deps.getSelectionState();
      if (!editingId) return;
      e.preventDefault();
      const sel = doc.defaultView.getSelection();
      let caretRect = { left: 0, bottom: 0 };
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0).cloneRange();
        const rects = r.getClientRects();
        if (rects.length > 0) caretRect = rects[0];
      }
      openSlashMenu(caretRect, editingId);
    });
  }

  function refreshDecoration() {
    if (currentDoc) decorateFlowHandles(currentDoc);
  }

  return { attach, refreshDecoration, closeAll: () => closeAll(popupsHost) };
}
