// history — 개체 트리 인메모리 조작 히스토리(S4.1, S2.4 정합). 전면 개정.
//
// 구판(editor-v3)은 문서 전체가 contenteditable 이라 되돌리기 단위가 DOM(.sheet innerHTML)
// 스냅샷 하나뿐이었다. editor-v4 는 저장의 단일 진실이 개체 트리(core.js 의 document)로
// 바뀌었으므로, 매 커밋마다 두 스냅샷을 함께 찍는다:
//   1) document(개체 트리) 의 깊은 복사 — /save 왕복·검증의 근거, undo/redo 의 "진짜" 상태.
//   2) 그 순간 캔버스 body HTML — 페이지 추가·삭제·순서 변경까지 되돌리는 렌더 스냅샷.
// 두 스냅샷은 항상 같은 commit() 호출 안에서 함께 찍히므로 서로 어긋나지 않는다.
//
// 조작 단위(op): 텍스트 편집(coalesced noteInput)·float 이동(드래그 종료)·기타 명령(run) —
// 전부 이 스택 하나로 합류한다. 브라우저 기본 undo(execCommand('undo'))는 이 스택 밖이므로
// editor.js 가 beforeinput(historyUndo/historyRedo) 을 가로채 이 스택으로 돌린다.

const MAX_DEPTH = 80; // 스냅샷 × 깊이 — 활동지(수십 KB) 규모에서 메모리가 문제되지 않는 선
const TYPING_IDLE_MS = 500; // 연속 타이핑을 한 단계로 묶는 유휴 시간

/**
 * @param {{
 *   core:object,
 *   getDoc:() => Document|null,
 *   captureUiState?:() => object|null,
 *   restoreUiState?:(state:object|null) => void,
 *   onRestore?:(context:{pageStructureChanged:boolean}) => void,
 * }} deps
 *   core: core.js 의 createDocumentStore() 인스턴스(getDocument/setDocument).
 *   getDoc: 현재 teacher iframe 의 contentDocument(없으면 null) — 되돌리기 대상 캔버스.
 *   onRestore: undo/redo 로 문서·DOM 이 바뀐 뒤 호출(selection.js 의 refreshVisual 재적용 등).
 */
export function createHistory({
  core,
  getDoc,
  captureUiState = () => null,
  restoreUiState = () => {},
  onRestore = () => {},
} = {}) {
  let stack = [];
  let index = -1;
  let typingTimer = null;
  let restoring = false; // 복원 중 발생하는 DOM 이벤트로 재기록되는 것 차단

  function capture() {
    const doc = getDoc();
    if (!doc) return null;
    const document = structuredClone(core.getDocument());
    return {
      document,
      documentJson: JSON.stringify(document),
      bodyHtml: doc.body.innerHTML,
      uiState: structuredClone(captureUiState()),
    };
  }

  const sameState = (a, b) =>
    a && b && a.documentJson === b.documentJson && a.bodyHtml === b.bodyHtml;

  function restore(state) {
    if (!state) return;
    const previousPages = core.getDocument()?.pages || [];
    const nextPages = state.document?.pages || [];
    const pageStructureChanged = JSON.stringify(previousPages.map(({ id, role }) => ({ id, role })))
      !== JSON.stringify(nextPages.map(({ id, role }) => ({ id, role })));
    restoring = true;
    try {
      core.setDocument(structuredClone(state.document));
      const doc = getDoc();
      if (doc && doc.body.innerHTML !== state.bodyHtml) doc.body.innerHTML = state.bodyHtml;
      restoreUiState(structuredClone(state.uiState));
    } finally {
      restoring = false;
    }
    onRestore({ pageStructureChanged });
  }

  /** 현재 상태를 한 단계로 확정한다. 직전 단계와 화면이 같으면 새 단계로 세지 않는다. */
  function commit() {
    if (restoring) return;
    clearTimeout(typingTimer);
    typingTimer = null;
    const state = capture();
    if (!state) return;
    if (index >= 0 && sameState(stack[index], state)) {
      stack[index] = state;
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
    /**
     * 대기 중인 타이핑을 **지금** 확정한다 — 뒤이어 실행되는 구조 명령이 그 타이핑을 자기 단계에
     * 삼키지 않도록(2026-07-28).
     *
     * 타이핑은 유휴 500ms 로 묶여 확정되는데, 그 안에 복제·삭제·속성 변경 같은 명령이 들어오면
     * `applyDocOp` 의 `commit()` 이 **타이핑과 명령을 한 상태로** 찍었다. 그 결과 Ctrl+Z 한 번에
     * 명령뿐 아니라 직전에 친 글자까지 사라졌다. 원래 이 목적의 `run(fn)` 래퍼가 있었지만
     * **호출부가 하나도 없었다** — 쓰이지 않는 래퍼 대신, 문서 변경의 단일 관문(applyDocOp)이
     * 직접 부를 수 있는 최소 원시 연산으로 바꾼다.
     *
     * 대기 중인 타이핑이 없으면 무동작이고, 있어도 상태가 같으면 `commit` 이 제자리 갱신하므로
     * 빈 단계가 쌓이지 않는다.
     */
    flushTyping() {
      if (typingTimer) commit();
    },
    commit,
    /**
     * 파생 재계산(리플로우) 확정 — **새 단계를 만들지 않고 현재 단계를 제자리 갱신한다.**
     *
     * 리플로우는 사용자 조작이 아니라 flow 높이 실측에서 나오는 파생값이라 되돌리기 단위가 아니다.
     * 여기서 commit() 을 쓰면 undo 가 리플로우 단계에 갇힌다: 삭제 → commit(index 1) → 리플로우
     * commit(index 2) → Ctrl+Z 로 index 2→1 → onRestore 가 리플로우를 다시 예약 → 또 commit 해
     * index 가 2 로 도로 밀린다. 몇 번을 눌러도 화면이 그대로인 이유가 이것이었다(실측: 8회 연속
     * Ctrl+Z 에 body.innerHTML 길이 불변). amend 는 index 를 움직이지 않으므로 다음 undo 가
     * 리플로우를 건너뛰고 그 조작 이전으로 정상 진입한다.
     *
     * redo 꼬리는 자르지 않는다 — 리플로우는 현재 상태에서 파생됐을 뿐 새 편집이 아니다.
     */
    amend() {
      if (restoring) return;
      // 미확정 타이핑이 걸려 있으면 제자리 갱신이 **타이핑 이전 단계를 덮어써** 그 단계를 잃는다.
      // 이때는 타이핑을 자기 단계로 먼저 확정한다(리플로우 결과가 그 단계에 함께 담긴다).
      if (typingTimer) { commit(); return; }
      const state = capture();
      if (!state) return;
      if (index < 0) { stack = [state]; index = 0; return; }
      stack[index] = state;
    },
    refreshUiState() {
      if (typingTimer) commit();
      if (index < 0) return;
      stack[index] = { ...stack[index], uiState: structuredClone(captureUiState()) };
    },
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
