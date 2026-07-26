// partEdit.js — 문항의 선지·연결 항목·순서 항목·참거짓 문장(.q-part)을 더블클릭해 인라인 편집(#3 2차).
//
// tableEdit.js 의 셀 편집과 동형: 개체(data-oid)가 아니라 그 안의 조각(.q-part[data-part][data-i])을
// RenderObjectTree 가 editMode 에서 실어 주고, 여기서 해당 배열 원소(문자열 또는 {id,text})를 되쓴다.
// 텍스트 변이는 core 개체 직접 변이(reload 없이 — selection.js 텍스트 편집과 동형), 리플로우만 예약한다.
//
// 캡처 단계에서 dblclick 을 가로채 stopPropagation 하는 이유: selection.js 의 (버블) dblclick 이
// 같은 이벤트로 문항 prompt(.q) 편집을 열어 편집 대상이 둘로 충돌하는 걸 막는다.

export function createPartEditor({ findObject, onPartText }) {
  let currentDoc = null;
  let editingEl = null;

  function wrapOf(el) { return el.closest('.wg-obj[data-oid], .wg-float[data-oid]'); }
  function questionObjOf(id) { const f = findObject(id); return f && f.obj.type === 'question' ? f.obj : null; }

  function finish() {
    if (!editingEl) return;
    const el = editingEl; editingEl = null;
    sync(el);
    el.removeAttribute('contenteditable');
    el.classList.remove('wg-part-editing');
  }

  function begin(el) {
    finish();
    editingEl = el;
    el.setAttribute('contenteditable', 'true');
    el.classList.add('wg-part-editing');
    const range = currentDoc.createRange();
    range.selectNodeContents(el); range.collapse(false);
    const sel = currentDoc.defaultView.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    el.focus();
  }

  function sync(el) {
    const wrap = wrapOf(el); if (!wrap) return;
    const obj = questionObjOf(wrap.dataset.oid); if (!obj) return;
    const field = el.dataset.part; const i = Number(el.dataset.i);
    const arr = obj[field];
    if (!Array.isArray(arr) || !(i in arr)) return;
    const text = el.textContent;
    const cur = arr[i];
    if (cur !== null && typeof cur === 'object') {
      if (cur.text !== text) { cur.text = text; onPartText(); }
    } else if (cur !== text) {
      arr[i] = text; onPartText();
    }
  }

  function attach(doc) {
    currentDoc = doc;
    doc.addEventListener('dblclick', (e) => {
      const el = e.target.closest('.q-part[data-part]');
      if (!el) return;
      e.stopPropagation(); // 캡처 단계 — selection.js 의 prompt 편집 진입을 막는다
      begin(el);
    }, true);
    // IME 조합 중에는 되읽지 않는다(composition.js 규약) — 조합 확정 때 한 번만 반영한다.
    doc.addEventListener('input', (e) => {
      if (e.isComposing) return;
      const el = e.target.closest('.q-part[data-part]');
      if (el && el === editingEl) sync(el);
    });
    doc.addEventListener('compositionend', () => {
      if (editingEl) sync(editingEl);
    });
    doc.addEventListener('keydown', (e) => {
      if (editingEl && e.key === 'Escape') { e.stopPropagation(); finish(); }
    });
    doc.addEventListener('click', (e) => {
      if (editingEl && !e.target.closest('.q-part')) finish();
    });
  }

  return { attach, finish };
}
