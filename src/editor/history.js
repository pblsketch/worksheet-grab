// history — 편집 전체를 덮는 단일 실행취소 스택(§3.1 E3).
//
// 브라우저 기본 undo(execCommand('undo'))는 사용자의 직접 타이핑과 execCommand 편집만
// 추적한다. 그런데 이 에디터의 특징 기능 — ⭐정답 표시(조상 unwrap)·✏️답란 삽입·
// 프리셋 삽입·AI 적용·이미지 리사이즈 — 은 전부 DOM 직접 조작이라 그 스택 밖에 있었다.
// 그래서 "정답 표시를 되돌릴 수 없다"는 문제가 났다.
//
// 두 스택을 병행하면 타이핑과 명령이 교차될 때 되돌리는 순서가 어긋난다(사용자가
// 친 순서와 무관하게 풀림). 그래서 되돌리기를 통째로 이 모듈이 소유하고, 브라우저
// 기본 undo 는 호출부에서 가로채 무력화한다.
//
// 저장 단위는 .sheet 별 innerHTML 스냅샷이다. 복원 시 실제로 바뀐 시트만 교체해
// 스크롤·다른 쪽 레이아웃을 흔들지 않는다. 캐럿은 childNodes 인덱스 경로로 복원한다.

const MAX_DEPTH = 80; // 스냅샷 × 깊이 — 활동지(수십 KB)에서 메모리가 문제되지 않는 선
const TYPING_IDLE_MS = 500; // 연속 타이핑을 한 단계로 묶는 유휴 시간

/** 루트 기준 childNodes 인덱스 경로. 루트 밖 노드면 null. */
function nodePath(root, node) {
  const path = [];
  let cur = node;
  while (cur && cur !== root) {
    const parent = cur.parentNode;
    if (!parent) return null;
    path.unshift([...parent.childNodes].indexOf(cur));
    cur = parent;
  }
  return cur === root ? path : null;
}

/** nodePath 의 역함수. 경로가 끊기면(구조 변경) null. */
function nodeFromPath(root, path) {
  let cur = root;
  for (const i of path) {
    if (!cur.childNodes || !cur.childNodes[i]) return null;
    cur = cur.childNodes[i];
  }
  return cur;
}

export function createHistory({ getDoc, onRestore = () => {} } = {}) {
  let stack = [];
  let index = -1;
  let typingTimer = null;
  let restoring = false; // 복원 중 발생하는 이벤트로 재기록되는 것 차단

  const sheetsOf = (doc) => [...doc.querySelectorAll('.sheet')];

  function captureSelection(doc) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const sheets = sheetsOf(doc);
    const i = sheets.findIndex((s) => s.contains(range.startContainer));
    if (i < 0) return null;
    const start = nodePath(sheets[i], range.startContainer);
    const end = nodePath(sheets[i], range.endContainer);
    if (!start || !end) return null;
    return { sheet: i, start, startOffset: range.startOffset, end, endOffset: range.endOffset };
  }

  function capture() {
    const doc = getDoc();
    if (!doc) return null;
    return { sheets: sheetsOf(doc).map((s) => s.innerHTML), sel: captureSelection(doc) };
  }

  const sameContent = (a, b) =>
    a && b && a.sheets.length === b.sheets.length && a.sheets.every((h, i) => h === b.sheets[i]);

  function restore(state) {
    const doc = getDoc();
    if (!doc || !state) return;
    restoring = true;
    try {
      const sheets = sheetsOf(doc);
      // 바뀐 시트만 교체 — 전체를 다시 쓰면 스크롤이 튀고 재레이아웃 비용도 커진다.
      for (let i = 0; i < sheets.length && i < state.sheets.length; i++) {
        if (sheets[i].innerHTML !== state.sheets[i]) sheets[i].innerHTML = state.sheets[i];
      }
      const s = state.sel;
      if (s && sheets[s.sheet]) {
        const startNode = nodeFromPath(sheets[s.sheet], s.start);
        const endNode = nodeFromPath(sheets[s.sheet], s.end);
        if (startNode && endNode) {
          try {
            const range = doc.createRange();
            range.setStart(startNode, Math.min(s.startOffset, startNode.childNodes?.length ?? startNode.length ?? 0));
            range.setEnd(endNode, Math.min(s.endOffset, endNode.childNodes?.length ?? endNode.length ?? 0));
            const sel = doc.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          } catch { /* 경로가 어긋나면 캐럿 복원만 포기한다(내용 복원은 이미 성공) */ }
        }
      }
    } finally {
      restoring = false;
    }
    onRestore();
  }

  /** 현재 상태를 한 단계로 확정한다. 직전 단계와 내용이 같으면 캐럿만 갱신. */
  function commit() {
    if (restoring) return;
    clearTimeout(typingTimer);
    typingTimer = null;
    const state = capture();
    if (!state) return;
    if (index >= 0 && sameContent(stack[index], state)) {
      stack[index].sel = state.sel; // 선택만 바뀐 경우 — 새 단계로 세지 않는다
      return;
    }
    stack = stack.slice(0, index + 1); // 되돌린 뒤 새로 편집하면 redo 꼬리는 버린다
    stack.push(state);
    if (stack.length > MAX_DEPTH) stack.shift();
    index = stack.length - 1;
  }

  return {
    /** 문서를 처음 열었을 때·재조립 후 기준점을 새로 잡는다. */
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
     * 명령(정답 표시·프리셋 삽입·서식 등) 실행 래퍼.
     * 실행 전에 대기 중인 타이핑을 먼저 확정해 "타이핑 → 명령" 순서를 보존한다.
     */
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
