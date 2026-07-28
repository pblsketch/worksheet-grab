// shortcuts.js — 개체 단축키(삭제·넛지·복사/붙여넣기·저장·undo/redo)와 인메모리 개체 클립보드.
//
// Phase 5 모듈 경계 정리에서 editor.js 로부터 그대로 떼어 왔다(동작 무변경). 편집기 관례대로
// create*(deps) 팩토리이며 core/history/selection 을 import 하지 않고 전부 주입받는다.
//
// 문서를 바꾸는 조작(삭제·붙여넣기)은 여기서 next 문서만 계산하고 반영은 주입받은 applyDocOp
// 하나로만 보낸다 — 문서 변경의 단일 관문은 여전히 editor.js 소유다. 예외는 넛지 하나인데,
// 이건 원래부터 관문을 타지 않는다: flow 경계가 안 바뀌므로 재로드 없이 라이브 DOM 의 좌표만
// 갱신하고 history 1 op 로 확정한다(드래그 커밋과 동형).

const NUDGE_DELTAS = Object.freeze({
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
});

// 단축키 안내 시트(발견성)의 단일 원천 — 아래 onKeydown 이 실제로 처리하는 키와 1:1 대응한다.
// editor.js 가 이 목록을 도움말 모달로 렌더한다(하드코딩 중복 금지).
export const SHORTCUTS = Object.freeze([
  { keys: 'Ctrl+S', desc: '저장' },
  { keys: 'Ctrl+Z', desc: '실행 취소' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', desc: '다시 실행' },
  { keys: 'Ctrl+C', desc: '선택 개체 복사' },
  { keys: 'Ctrl+V', desc: '개체 붙여넣기' },
  { keys: 'Delete / Backspace', desc: '선택 개체 삭제' },
  { keys: '방향키', desc: '자유 배치 개체 1mm 이동' },
  { keys: 'Shift+방향키', desc: '자유 배치 개체 10mm 이동' },
  { keys: 'Esc', desc: '선택·편집 해제' },
]);

export function createShortcuts({
  core,
  history,
  selection,
  operations,
  applyDocOp,
  save,
  markDirty,
  updateAll,
  getSingleSelectedId,
  getTeacherDoc,
  hostDocument,
}) {
  // US-E3: 개체 복사·붙여넣기용 인메모리 클립보드. 시스템 클립보드가 아니라 앱 내부 버퍼 —
  // 개체 트리 구조를 통째로 담아 같은 문서 안 다른 위치/페이지로 재삽입한다(원본은 지워져도 무관).
  let objectClipboard = [];

  /** 선택된 개체(단일/다중)를 문서에서 제거한다(#7 Delete/Backspace). 리플로우 예약(빈 자리 재계산). */
  function deleteSelectedObjects() {
    const ids = [...selection.state.selectedIds];
    if (ids.length === 0) return;
    let next = core.getDocument();
    for (const id of ids) next = operations.removeObject(next, id);
    selection.clearAll();
    applyDocOp(next, { reflow: true });
  }

  /** 텍스트 편집 중이거나 폼 필드/제목에 포커스가 있으면 개체 단축키(삭제·넛지·복사/붙여넣기)를
   *  가로채지 않는다 — 정상 글자 입력/삭제/복사가 우선(#7·US-E2·US-E3 공통 가드).
   *
   *  **이벤트 대상을 먼저 본다(2026-07-28).** 종전엔 `selection.state.editingId` 와 **부모 문서의**
   *  `activeElement` 만 봤는데, 표 셀(tableEdit)·조각(partEdit)은 자기 지역 상태만 세우고 공통
   *  editingId 를 세우지 않고, 캐럿이 iframe 안에 있으면 부모 activeElement 는 `<iframe>` 요소라
   *  contentEditable 이 아니다 — 두 판정이 모두 false 라 **글자 하나 지우려던 Backspace 가 표·학습목표
   *  박스를 통째로 삭제했다**(실 Chrome 재현: 표 4→3, std-box 1→0). 키가 실제로 어디서 났는지는
   *  `e.target` 이 알고 있고, 이 핸들러는 부모와 teacher iframe 양쪽에 걸려 있으므로 그것으로 족하다. */
  function isTypingContext(e) {
    if (selection.state.editingId) return true;
    const candidates = [e?.target, e?.target?.ownerDocument?.activeElement, hostDocument.activeElement];
    return candidates.some((n) => n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)));
  }

  /** 단일 선택된 float 개체를 dxMm/dyMm 넛지한다(US-E2). 전체 재로드 없이 라이브 DOM 의 해당
   *  float 좌표만 갱신하고(드래그 커밋과 동형 — flow 경계 불변이라 리플로우 불필요) history 1 op 로
   *  확정한다. nudgeFloat 순수 연산으로 다음 문서를 계산해 core 에 반영한다. */
  function nudgeSelectedFloat(dxMm, dyMm) {
    const id = getSingleSelectedId();
    const found = id ? core.findObject(id) : null;
    if (!found || found.obj.placement !== 'float' || !found.obj.rect) return false;
    const next = operations.nudgeFloat(core.getDocument(), id, dxMm, dyMm);
    core.setDocument(next);
    const nObj = core.findObject(id)?.obj;
    const doc = getTeacherDoc();
    const escId = window.CSS && CSS.escape ? CSS.escape(id) : id;
    const el = doc?.querySelector(`[data-oid="${escId}"]`);
    if (el && nObj?.rect) { el.style.left = `${nObj.rect.xMm}mm`; el.style.top = `${nObj.rect.yMm}mm`; }
    history.commit();
    markDirty();
    updateAll();
    return true;
  }

  /** 선택된 개체(단일/다중)를 클립보드에 깊은 복사한다(Ctrl+C). 편집/폼 컨텍스트나 빈 선택이면 무동작. */
  function copySelectedObjects() {
    const ids = [...selection.state.selectedIds];
    if (ids.length === 0) return false;
    const clones = [];
    for (const id of ids) {
      const found = core.findObject(id);
      if (found) clones.push(structuredClone(found.obj));
    }
    if (clones.length === 0) return false;
    objectClipboard = clones;
    return true;
  }

  /** 클립보드 개체를 새 id 로 붙여넣는다(Ctrl+V). flow 는 현재 선택 개체 뒤(없으면 마지막 페이지 끝),
   *  float 은 +8mm 오프셋으로 현재 선택 개체의 페이지에 삽입한다 — 앵커가 현재 선택이므로 다른
   *  페이지의 개체를 고른 뒤 붙여넣으면 그 페이지로 들어간다(페이지 간 붙여넣기). applyDocOp 단일
   *  관문·리플로우 예약을 거치고 첫 새 개체를 선택한다. */
  async function pasteObjects() {
    if (objectClipboard.length === 0) return false;
    const anchorId = getSingleSelectedId();
    let next = core.getDocument();
    let runningAnchor = anchorId;
    const newIds = [];
    for (const src of objectClipboard) {
      const obj = { ...structuredClone(src), id: operations.generateId(src.type) };
      if (obj.placement === 'float') {
        if (obj.rect) obj.rect = { ...obj.rect, xMm: (obj.rect.xMm || 0) + 8, yMm: (obj.rect.yMm || 0) + 8 };
        next = operations.insertFloat(next, obj, { nearId: anchorId });
      } else {
        next = operations.insertFlow(next, obj, { afterId: runningAnchor });
        runningAnchor = obj.id; // 다음 개체는 방금 붙여넣은 개체 뒤(붙여넣기 순서 보존)
      }
      newIds.push(obj.id);
    }
    selection.clearAll();
    await applyDocOp(next, { reflow: true, selectId: newIds[0] ?? null });
    return true;
  }

  function onKeydown(e) {
    // Esc — 편집 종료/선택 해제의 주인은 selection.js 지만, 그 핸들러는 **teacher iframe 문서에만**
    // 걸려 있다. 캔버스 개체를 실마우스로 클릭해도 포커스는 부모 문서에 남는다(실측: 부모
    // activeElement=BODY, iframe 은 focus 아님) — 그래서 부모로 온 Esc 는 아무도 받지 못하고
    // 선택이 풀리지 않았다. 나머지 단축키가 멀쩡했던 건 이 핸들러가 부모 window 에도 걸려
    // 있기 때문이고, Esc 만 여기서 빠져나가고 있었다.
    //
    // **부모에 온 것만** 넘긴다: iframe 에서 온 이벤트까지 처리하면 selection.js 와 이중 실행되어
    // Esc 한 번에 '편집 종료'와 '선택 해제'가 같이 일어난다(2단계여야 한다).
    if (e.key === 'Escape') {
      if (e.target?.ownerDocument === hostDocument) {
        e.preventDefault();
        selection.handleEscape();
        updateAll();
      }
      return;
    }
    // Delete/Backspace = 선택 개체 삭제(#7). 단, 텍스트 편집 중이거나 폼 필드/제목 편집에 포커스가
    // 있으면 개입하지 않는다(정상 글자 삭제가 우선). 개체 선택만 된 상태에서만 개체를 지운다.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (isTypingContext(e)) return;
      if (selection.state.selectedIds.size === 0) return;
      e.preventDefault();
      deleteSelectedObjects();
      return;
    }
    // 방향키 = 단일 선택된 자유 개체 미세 이동(1mm, Shift=10mm) — US-E2. 텍스트/폼 편집 중엔 무개입.
    if (NUDGE_DELTAS[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isTypingContext(e)) return;
      const [dx, dy] = NUDGE_DELTAS[e.key];
      const step = e.shiftKey ? 10 : 1;
      if (nudgeSelectedFloat(dx * step, dy * step)) e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      save();
    } else if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      history.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      history.redo();
    } else if (key === 'c') {
      // 개체 복사(US-E3) — 텍스트 편집/폼 컨텍스트면 브라우저 기본 복사가 우선.
      if (isTypingContext(e)) return;
      if (copySelectedObjects()) e.preventDefault();
    } else if (key === 'v') {
      // 개체 붙여넣기(US-E3) — 텍스트 편집/폼 컨텍스트면 브라우저 기본 붙여넣기가 우선.
      if (isTypingContext(e)) return;
      if (objectClipboard.length) { e.preventDefault(); pasteObjects(); }
    }
  }

  return {
    onKeydown,
    /** teacher iframe 은 로드마다 새 document 라 그때마다 같은 핸들러를 다시 건다. */
    attach: (doc) => doc.addEventListener('keydown', onKeydown),
    getClipboardCount: () => objectClipboard.length,
  };
}
