// partEdit.js — 개체 **안의 작은 텍스트 조각**을 더블클릭해 그 자리에서 고친다.
//
// 두 갈래를 한 본문으로 다룬다.
//   `.q-part[data-part][data-i]` — 문항의 선지·연결 항목·순서 항목·참거짓 문장(#3 2차, 기존)
//   `.wg-part[data-part]`        — 학습목표 문장·박스 제목, 제목 배지/모서리/출처, 지문 제목/출처,
//                                  표 캡션, 이미지 캡션(#1·#1b, 2026-07-28 확장)
// 둘 다 RenderObjectTree 가 editMode 에서만 data-part(필드 경로)·data-i(배열 인덱스)를 실어 주고,
// 여기서 그 좌표로 개체 필드를 되쓴다. 텍스트 변이는 core 개체 직접 변이(reload 없이 —
// selection.js 텍스트 편집과 동형), 리플로우만 예약한다.
//
// 어떤 (타입, 필드) 조합을 되쓸 수 있는지는 EDITABLE_PARTS 가 닫아 둔다 — 렌더가 실수로 엉뚱한
// data-part 를 실어도 카탈로그 밖 필드가 생기지 않는다(ValidateObjectTree 의 unknown-field 를
// 편집 시점에 미리 막는 초크포인트).
//
// 캡처 단계에서 dblclick 을 가로채 stopPropagation 하는 이유: selection.js 의 (버블) dblclick 이
// 같은 이벤트로 개체 본문(문항 prompt·제목 등) 편집을 열어 편집 대상이 둘로 충돌하는 걸 막는다.

/**
 * 타입별 인라인 편집 허용 필드 경로. 'meta.pill' 처럼 점을 쓰면 중첩 객체 한 단계까지 들어간다
 * (title.meta 는 스키마가 닫아 둔 3필드짜리 object 라 그 이상은 필요 없다).
 * 배열 필드는 data-i 와 함께 와야 하고, 스칼라 필드는 data-i 가 없어야 한다 — resolve() 가 검사한다.
 */
export const EDITABLE_PARTS = Object.freeze({
  question: Object.freeze({ array: ['choices', 'left', 'right', 'items'], scalar: [] }),
  'std-box': Object.freeze({ array: ['objectives'], scalar: ['heading'] }),
  title: Object.freeze({ array: [], scalar: ['meta.pill', 'meta.page', 'meta.source'] }),
  'passage-slot': Object.freeze({ array: [], scalar: ['title', 'source'] }),
  table: Object.freeze({ array: [], scalar: ['caption'] }),
  // image-slot 의 캡션은 여기 없다 — selection.js EDIT_FIELD 가 figcaption 편집을 이미 소유한다
  // (한 조각에 편집 주체가 둘이면 캡처 단계의 partEdit 이 조용히 이긴다).
});

const PART_SELECTOR = '.q-part[data-part], .wg-part[data-part]';

export function createPartEditor({ findObject, onPartText }) {
  let currentDoc = null;
  let editingEl = null;

  function wrapOf(el) { return el.closest('.wg-obj[data-oid], .wg-float[data-oid]'); }

  /**
   * DOM 조각 → {obj, field, index, container, key} 로 해석한다. 허용 목록 밖이면 null.
   * container/key 는 실제로 값을 쓸 자리다('meta.pill' 이면 container=obj.meta, key='pill').
   */
  function resolve(el) {
    const wrap = wrapOf(el);
    if (!wrap) return null;
    const found = findObject(wrap.dataset.oid);
    if (!found) return null;
    const obj = found.obj;
    const spec = EDITABLE_PARTS[obj.type];
    if (!spec) return null;
    const field = el.dataset.part;
    const hasIndex = el.dataset.i != null && el.dataset.i !== '';

    if (hasIndex) {
      if (!spec.array.includes(field)) return null;
      const arr = obj[field];
      const i = Number(el.dataset.i);
      if (!Array.isArray(arr) || !(i in arr)) return null;
      return { obj, kind: 'array', arr, index: i };
    }
    if (!spec.scalar.includes(field)) return null;
    const dot = field.indexOf('.');
    if (dot < 0) return { obj, kind: 'scalar', container: obj, key: field };
    // 중첩 한 단계(meta.*) — 부모 객체가 없으면 만들지 않는다(렌더가 값이 있을 때만 조각을 내므로
    // 이 경로로 오는 개체는 이미 meta 를 가지고 있다).
    const parent = obj[field.slice(0, dot)];
    if (!parent || typeof parent !== 'object') return null;
    return { obj, kind: 'scalar', container: parent, key: field.slice(dot + 1) };
  }

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
    const t = resolve(el);
    if (!t) return;
    const text = el.textContent;
    if (t.kind === 'array') {
      const cur = t.arr[t.index];
      // 원소는 문자열이거나 {id,text} 객체 둘 다 될 수 있다(마이그레이션·저작 경로 차이).
      if (cur !== null && typeof cur === 'object') {
        if (cur.text !== text) { cur.text = text; onPartText(); }
      } else if (cur !== text) {
        t.arr[t.index] = text; onPartText();
      }
      return;
    }
    if (t.container[t.key] === text) return;
    // 빈 값은 필드를 지운다 — 렌더가 값이 있을 때만 조각을 내므로, 남겨 두면 빈 배지·빈 출처 줄이
    // 다음 재로드까지 유령으로 남는다(제목 meta 인스펙터의 `v || undefined` 규약과 같은 취지).
    if (text === '') delete t.container[t.key];
    else t.container[t.key] = text;
    onPartText();
  }

  function attach(doc) {
    currentDoc = doc;
    doc.addEventListener('dblclick', (e) => {
      const el = e.target.closest(PART_SELECTOR);
      if (!el) return;
      e.stopPropagation(); // 캡처 단계 — selection.js 의 개체 본문 편집 진입을 막는다
      begin(el);
    }, true);
    // IME 조합 중에는 되읽지 않는다(composition.js 규약) — 조합 확정 때 한 번만 반영한다.
    doc.addEventListener('input', (e) => {
      if (e.isComposing) return;
      const el = e.target.closest(PART_SELECTOR);
      if (el && el === editingEl) sync(el);
    });
    doc.addEventListener('compositionend', () => {
      if (editingEl) sync(editingEl);
    });
    doc.addEventListener('keydown', (e) => {
      if (!editingEl) return;
      if (e.key === 'Escape') { e.stopPropagation(); finish(); return; }
      // 조각은 전부 한 줄짜리 값(배지·출처·목표 문장·선지)이다. contenteditable 기본 동작대로
      // 두면 Enter 가 <br>/<div> 를 넣어 화면은 두 줄이 되는데 되읽기는 textContent 라 줄바꿈이
      // 그대로 필드에 섞인다 — 대신 편집을 끝낸다(표 셀 편집과 같은 관례).
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault(); e.stopPropagation(); finish();
      }
    });
    doc.addEventListener('click', (e) => {
      if (editingEl && !e.target.closest(PART_SELECTOR)) finish();
    });
  }

  return { attach, finish };
}
