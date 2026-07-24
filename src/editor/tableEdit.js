// tableEdit.js — 표(table) 셀 인라인 편집·병합/분할·열 너비 마우스 조정(#10).
//
// selection.js/canvasInline.js 와 동형으로 teacher iframe 문서에 매 load 마다 attach() 한다. 표 셀은
// 개체(data-oid)가 아니라 그 안의 td/th 라, RenderObjectTree 가 editMode 에서 실어 주는 data-r/data-c
// 로 rows[][] 배열과 1:1 매핑한다. 셀 텍스트 편집은 core 개체를 직접 변이(reload 없이 — selection.js
// 텍스트 편집과 동형)하고, 구조 변경(병합/분할/열 너비)만 onTablePatch 로 문서 교체·재로드한다.

const MM_TO_PX = 96 / 25.4;

function cssEscape(id) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(id);
  return String(id).replace(/["\\]/g, '\\$&');
}

/**
 * @param {{
 *   findObject: (id:string)=>{obj:object}|null,
 *   getSelectionState: ()=>{selectedIds:Set<string>, editingId:string|null},
 *   onCellText: ()=>void,                 // 셀 텍스트 변이 후(코얼레싱·리플로우 예약) — reload 없음
 *   onTablePatch: (id:string, patch:object)=>void, // 구조 변경(rows 교체) → applyDocOp(reload)
 * }} deps
 */
export function createTableEditor({ findObject, getSelectionState, onCellText, onTablePatch }) {
  let currentDoc = null;
  const active = { id: null, r: null, c: null };
  let editingCell = null;

  function wrapOf(el) { return el.closest('.wg-obj[data-oid], .wg-float[data-oid]'); }
  function tableObjOf(id) { const f = findObject(id); return f && f.obj.type === 'table' ? f.obj : null; }

  function clearActiveClass() {
    for (const n of currentDoc?.querySelectorAll('.wg-cell-active') || []) n.classList.remove('wg-cell-active');
  }
  function setActive(td) {
    const wrap = wrapOf(td); if (!wrap) return;
    active.id = wrap.dataset.oid; active.r = Number(td.dataset.r); active.c = Number(td.dataset.c);
    clearActiveClass(); td.classList.add('wg-cell-active');
  }
  function clearActive() { active.id = null; active.r = null; active.c = null; clearActiveClass(); }

  function finishEdit() {
    if (!editingCell) return;
    const td = editingCell; editingCell = null;
    syncCell(td);
    td.removeAttribute('contenteditable');
    td.classList.remove('wg-cell-editing');
  }

  function beginEdit(td) {
    finishEdit();
    editingCell = td;
    td.setAttribute('contenteditable', 'true');
    td.classList.add('wg-cell-editing');
    const range = currentDoc.createRange();
    range.selectNodeContents(td); range.collapse(false);
    const sel = currentDoc.defaultView.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    td.focus();
  }

  function syncCell(td) {
    const wrap = wrapOf(td); if (!wrap) return;
    const obj = tableObjOf(wrap.dataset.oid); if (!obj) return;
    const r = Number(td.dataset.r); const c = Number(td.dataset.c);
    if (obj.rows?.[r]?.[c] && obj.rows[r][c].text !== td.textContent) {
      obj.rows[r][c].text = td.textContent; // core 개체 직접 변이(reload 없이)
      onCellText();
    }
  }

  /** 활성 셀 기준 병합(오른쪽/아래) 또는 분할. rows 를 깊은 복제해 새 문서로 넘긴다. */
  function merge(dir) {
    if (active.id == null) return;
    const obj = tableObjOf(active.id); if (!obj) return;
    const rows = obj.rows.map((row) => row.map((cell) => ({ ...cell })));
    const { r, c } = active;
    const cell = rows[r]?.[c];
    if (!cell || cell.merged) return;
    if (dir === 'right') {
      const span = cell.colspan || 1;
      const target = rows[r][c + span];
      if (!target || target.merged) return;
      target.merged = true; target.text = '';
      cell.colspan = span + 1;
    } else if (dir === 'down') {
      const span = cell.rowspan || 1;
      const target = rows[r + span]?.[c];
      if (!target || target.merged) return;
      target.merged = true; target.text = '';
      cell.rowspan = span + 1;
    } else if (dir === 'split') {
      const cs = cell.colspan || 1; const rs = cell.rowspan || 1;
      for (let rr = r; rr < r + rs; rr++) {
        for (let cc = c; cc < c + cs; cc++) {
          if (rr === r && cc === c) continue;
          if (rows[rr]?.[cc]) rows[rr][cc].merged = false;
        }
      }
      delete cell.colspan; delete cell.rowspan;
    } else return;
    onTablePatch(active.id, { rows });
  }

  /** 현재 단일 선택된 표의 id(없으면 null). */
  function selectedTableId() {
    const st = getSelectionState();
    if (st.editingId || st.selectedIds.size !== 1) return null;
    const id = [...st.selectedIds][0];
    return tableObjOf(id) ? id : null;
  }

  // ── 열 너비 드래그(#10) — 선택된 표의 열 경계마다 세로 손잡이를 얹고, 드래그로 좌측 열 w(%)를 바꾼다. ──
  function decorateColumnHandles(doc) {
    for (const layer of doc.querySelectorAll('.wg-col-overlay')) layer.remove();
    const id = selectedTableId(); if (!id) return;
    const wrap = doc.querySelector(`[data-oid="${cssEscape(id)}"]`); if (!wrap) return;
    const table = wrap.querySelector('table'); if (!table) return;
    const headerCells = [...table.querySelector('tr')?.children || []].filter((el) => el.dataset.c != null);
    if (headerCells.length < 2) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    const wrapRect = wrap.getBoundingClientRect();
    // 줌(스테이지 transform)으로 iframe 이 시각적으로 스케일되므로 getBoundingClientRect(스크린 px)를
    // 레이아웃 px 로 환산한다(offsetWidth 는 스케일 무관). 100% 줌이면 scale=1.
    const scale = wrap.offsetWidth ? wrapRect.width / wrap.offsetWidth : 1;
    const overlay = doc.createElement('div');
    overlay.className = 'wg-col-overlay';
    for (let i = 0; i < headerCells.length - 1; i++) {
      const cell = headerCells[i];
      const cr = cell.getBoundingClientRect();
      const h = doc.createElement('div');
      h.className = 'wg-col-handle';
      h.dataset.c = cell.dataset.c;
      h.style.left = `${(cr.right - wrapRect.left) / scale - 3}px`;
      overlay.appendChild(h);
    }
    wrap.appendChild(overlay);
  }

  function startColResize(e, handle, id) {
    const obj = tableObjOf(id); if (!obj) return;
    const wrap = handle.closest('[data-oid]');
    const table = wrap.querySelector('table'); if (!table) return;
    e.preventDefault(); e.stopPropagation();
    const cIdx = Number(handle.dataset.c);
    const tableRect = table.getBoundingClientRect();
    const cellRect = [...table.querySelector('tr').children].find((el) => Number(el.dataset.c) === cIdx)?.getBoundingClientRect();
    if (!cellRect) return;
    const scale = wrap.offsetWidth ? wrap.getBoundingClientRect().width / wrap.offsetWidth : 1;
    let pct = 20;
    const onMove = (ev) => {
      // pct 는 비율이라 줌에 무관(분자·분모 모두 스크린 px). 손잡이 위치만 레이아웃 px 로 환산한다.
      pct = Math.max(5, Math.min(90, ((ev.clientX - cellRect.left) / tableRect.width) * 100));
      handle.style.left = `${(ev.clientX - wrap.getBoundingClientRect().left) / scale - 3}px`;
    };
    const onUp = (ev) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      const rows = obj.rows.map((row) => row.map((cell) => ({ ...cell })));
      if (rows[0]?.[cIdx]) { rows[0][cIdx].w = Math.round(pct * 10) / 10; onTablePatch(id, { rows }); }
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }

  function reapplyActive() {
    if (active.id == null || !currentDoc) return;
    const td = currentDoc.querySelector(`[data-oid="${cssEscape(active.id)}"] [data-r="${active.r}"][data-c="${active.c}"]`);
    if (td) { clearActiveClass(); td.classList.add('wg-cell-active'); }
  }

  function attach(doc) {
    currentDoc = doc;
    reapplyActive();
    decorateColumnHandles(doc);

    doc.addEventListener('click', (e) => {
      const handle = e.target.closest('.wg-col-handle');
      if (handle) return; // pointerdown 이 리사이즈 처리
      const td = e.target.closest('td[data-r], th[data-r]');
      if (!td) { finishEdit(); clearActive(); return; }
      if (editingCell && editingCell !== td) finishEdit();
      setActive(td);
    });

    doc.addEventListener('dblclick', (e) => {
      const td = e.target.closest('td[data-r], th[data-r]');
      if (!td) return;
      setActive(td); beginEdit(td);
    });

    doc.addEventListener('input', (e) => {
      const td = e.target.closest('td[data-r], th[data-r]');
      if (td && td === editingCell) syncCell(td);
    });

    doc.addEventListener('keydown', (e) => {
      if (editingCell && e.key === 'Escape') { e.stopPropagation(); finishEdit(); }
    });

    doc.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.wg-col-handle');
      if (!handle) return;
      const wrap = handle.closest('[data-oid]');
      if (wrap) startColResize(e, handle, wrap.dataset.oid);
    });
  }

  function refresh() { if (currentDoc) { reapplyActive(); decorateColumnHandles(currentDoc); } }

  return { attach, merge, refresh, hasActive: () => active.id != null, finishEdit };
}
