// history — 개체 트리 인메모리 조작 히스토리(S4.1, S2.4 정합). 전면 개정.
//
// 구판(editor-v3)은 문서 전체가 contenteditable 이라 되돌리기 단위가 DOM(.sheet innerHTML)
// 스냅샷 하나뿐이었다. editor-v4 는 저장의 단일 진실이 개체 트리(core.js 의 document)로
// 바뀌었으므로, 매 커밋마다 두 스냅샷을 함께 찍는다:
//   1) document(개체 트리) 의 깊은 복사 — /save 왕복·검증의 근거, undo/redo 의 "진짜" 상태.
//   2) 그 순간 캔버스 .sheet 들의 innerHTML — undo/redo 시 화면을 값싸게 되돌리는 수단
//      (개체별 재렌더 파이프라인 없이도 정확하다 — RenderObjectTree 는 순수 함수라 같은
//      document 입력이면 항상 같은 HTML 을 내므로, 커밋 시점의 DOM 스냅샷은 그 document
//      스냅샷의 정확한 렌더 결과와 항상 같다).
// 두 스냅샷은 항상 같은 commit() 호출 안에서 함께 찍히므로 서로 어긋나지 않는다.
//
// 조작 단위(op): 텍스트 편집(coalesced noteInput)·float 이동(드래그 종료)·기타 명령(run) —
// 전부 이 스택 하나로 합류한다. 브라우저 기본 undo(execCommand('undo'))는 이 스택 밖이므로
// editor.js 가 beforeinput(historyUndo/historyRedo) 을 가로채 이 스택으로 돌린다.

const MAX_DEPTH = 80; // 스냅샷 × 깊이 — 활동지(수십 KB) 규모에서 메모리가 문제되지 않는 선
const TYPING_IDLE_MS = 500; // 연속 타이핑을 한 단계로 묶는 유휴 시간

/**
 * @param {{core:object, getDoc:() => Document|null, onRestore?:() => void}} deps
 *   core: core.js 의 createDocumentStore() 인스턴스(getDocument/setDocument).
 *   getDoc: 현재 teacher iframe 의 contentDocument(없으면 null) — 되돌리기 대상 캔버스.
 *   onRestore: undo/redo 로 문서·DOM 이 바뀐 뒤 호출(selection.js 의 refreshVisual 재적용 등).
 */
export function createHistory({ core, getDoc, onRestore = () => {} } = {}) {
  let stack = [];
  let index = -1;
  let typingTimer = null;
  let restoring = false; // 복원 중 발생하는 DOM 이벤트로 재기록되는 것 차단

  const sheetsOf = (doc) => [...doc.querySelectorAll('.sheet')];

  function capture() {
    const doc = getDoc();
    if (!doc) return null;
    return {
      document: structuredClone(core.getDocument()),
      sheets: sheetsOf(doc).map((s) => s.innerHTML),
    };
  }

  const sameSheets = (a, b) =>
    a && b && a.sheets.length === b.sheets.length && a.sheets.every((h, i) => h === b.sheets[i]);

  function restore(state) {
    if (!state) return;
    restoring = true;
    try {
      core.setDocument(structuredClone(state.document));
      const doc = getDoc();
      if (doc) {
        const sheets = sheetsOf(doc);
        // 바뀐 시트만 교체 — 전체를 다시 쓰면 스크롤이 튀고 재레이아웃 비용도 커진다.
        for (let i = 0; i < sheets.length && i < state.sheets.length; i++) {
          if (sheets[i].innerHTML !== state.sheets[i]) sheets[i].innerHTML = state.sheets[i];
        }
      }
    } finally {
      restoring = false;
    }
    onRestore();
  }

  /** 현재 상태를 한 단계로 확정한다. 직전 단계와 화면이 같으면 새 단계로 세지 않는다. */
  function commit() {
    if (restoring) return;
    clearTimeout(typingTimer);
    typingTimer = null;
    const state = capture();
    if (!state) return;
    if (index >= 0 && sameSheets(stack[index], state)) {
      stack[index] = state; // 내용은 같고 document 메타만 바뀐 경우(드물다) — 갱신만
      return;
    }
    stack = stack.slice(0, index + 1); // 되돌린 뒤 새로 편집하면 redo 꼬리는 버린다
    stack.push(state);
    if (stack.length > MAX_DEPTH) stack.shift();
    index = stack.length - 1;
  }

  return {
    /** 문서를 처음 열었을 때·iframe 재조립 후 기준점을 새로 잡는다. */
    reset() {
      clearTimeout(typingTimer);
      typingTimer = null;
      const state = capture();
      stack = state ? [state] : [];
      index = state ? 0 : -1;
    },
    /** 사용자의 직접 타이핑 — 유휴 시간만큼 묶어 한 단계로 확정한다. */
    noteInput() {
      if (restoring) return;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(commit, TYPING_IDLE_MS);
    },
    /** 명령(이동 등) 실행 래퍼 — 대기 중인 타이핑을 먼저 확정한 뒤 실행하고 한 단계로 확정한다. */
    run(fn) {
      if (typingTimer) commit();
      const result = fn();
      commit();
      return result;
    },
    commit,
    undo() {
      if (typingTimer) commit(); // 미확정 타이핑부터 한 단계로 만든 뒤 되돌린다
      if (index <= 0) return false;
      index -= 1;
      restore(stack[index]);
      return true;
    },
    redo() {
      if (index >= stack.length - 1) return false;
      index += 1;
      restore(stack[index]);
      return true;
    },
    canUndo: () => index > 0 || typingTimer !== null,
    canRedo: () => index < stack.length - 1,
    depth: () => ({ index, length: stack.length }),
  };
}
