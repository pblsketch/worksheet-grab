// saveController.js — 저장(POST /save)·dirty 상태·유휴 자동 체크포인트·리비전 표시의 단일 소유자.
//
// Phase 5 모듈 경계 정리에서 editor.js 로부터 그대로 떼어 왔다(동작 무변경). 편집기 관례대로
// create*(deps) 팩토리이며 core/history/selection 을 import 하지 않는다 — 문서 읽기·쓰기는
// getDocument/setDocument 콜백으로만 한다.
//
// 계약(S2.4): 저장은 명시 Ctrl+S/저장 버튼과 유휴 30초 자동 체크포인트뿐이다. dirty 는 여기서
// 소유하고, "편집이 생겼다"는 사실의 부수효과(학생용 미리보기 stale 표시 등)는 onDirty 콜백으로
// 호출부에 돌려준다 — 이 모듈은 미리보기·프레임을 알지 못한다.
//
// DOM 은 전역 조회 대신 주입받은 노드만 만진다(node 단위 테스트에서 가짜 노드 주입 가능).
export function createSaveController({
  getDocument,
  setDocument,
  showBanner,
  onSaved,
  onDirty,
  revEl,
  bodyEl,
  saveButton = null,
  initialRevision = null,
  autosaveMs = 30000,
}) {
  let currentRevision = initialRevision;
  let dirty = false;
  let autosaveTimer = null;
  // 편집 일련번호 — 저장 왕복(수 초, 서버가 재렌더한다) **중에** 편집이 들어왔는지 판별하는 유일한
  // 근거다. dirty 하나로는 알 수 없다: 응답 처리부가 무조건 dirty 를 내리므로 "왕복 전부터 dirty"와
  // "왕복 중에 새로 dirty"가 구분되지 않는다.
  let editSeq = 0;

  function renderRev() {
    revEl.textContent = currentRevision == null ? '' : `rev ${currentRevision}`;
  }

  /** 유휴 자동 체크포인트(S2.4 계약) — 편집마다 타이머를 재설정한다(디바운스). */
  function resetAutosaveTimer() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { if (dirty) save(); }, autosaveMs);
  }

  function markDirty() {
    dirty = true;
    editSeq += 1;
    onDirty?.();
    resetAutosaveTimer();
  }

  async function save() {
    // 요청 본문은 **지금** 문서다. 응답이 돌아올 때까지 교사는 계속 입력할 수 있으므로,
    // 그 사이 편집이 있었는지는 이 시점 일련번호와 비교해서만 알 수 있다.
    const seqAtRequest = editSeq;
    let res;
    try {
      res = await fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: getDocument() }),
      });
    } catch (e) {
      showBanner('error', `저장 실패: ${e.message}`);
      return null;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      showBanner('error', `저장 실패: ${body.error ?? `HTTP ${res.status}`}`);
      return null;
    }
    const result = await res.json();
    // 왕복 중에 편집이 들어왔으면 서버 문서를 채택하지 않는다(2026-07-28). 종전엔 무조건 덮어써서
    // **응답이 도착하는 순간 그 사이 입력한 내용이 사라졌고**, dirty 까지 내려가 뒤이은 자동저장도
    // 유실을 되돌리지 못했다. 서버 문서는 요청 시점 문서를 정규화한 것이라 지금 화면보다 낡았다 —
    // 최신 편집을 살리고, 정규화는 다음 저장에서 다시 받는다(멱등).
    const editedDuringSave = editSeq !== seqAtRequest;
    if (result.document && !editedDuringSave) setDocument(result.document);
    currentRevision = result.meta?.revision ?? currentRevision;
    renderRev();
    if (!editedDuringSave) {
      dirty = false;
      clearTimeout(autosaveTimer);
    }
    if (result.unsafe) {
      const rules = [...new Set((result.leakFindings ?? []).map((f) => f.rule))].join(', ');
      showBanner('error', `⚠ 저장됨(rev ${currentRevision}) — 정답 누출 감지(${rules}). 학생용 HTML 은 보류되었습니다.`);
    } else if (editedDuringSave) {
      // "저장됨"만 띄우면 교사는 방금 친 글자까지 저장된 줄 안다 — 실제로는 다음 저장 몫이다.
      showBanner('ok', `저장됨 (rev ${currentRevision}) — 저장하는 동안 수정한 내용은 아직 저장 전입니다`);
    } else {
      showBanner('ok', `저장됨 (rev ${currentRevision})`);
    }
    bodyEl.dataset.savedRevision = String(currentRevision);
    onSaved?.();
    return result;
  }

  renderRev();
  saveButton?.addEventListener('click', save);

  return { save, markDirty, isDirty: () => dirty, getRevision: () => currentRevision };
}
