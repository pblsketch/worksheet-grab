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
    onDirty?.();
    resetAutosaveTimer();
  }

  async function save() {
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
    if (result.document) setDocument(result.document);
    currentRevision = result.meta?.revision ?? currentRevision;
    renderRev();
    dirty = false;
    clearTimeout(autosaveTimer);
    if (result.unsafe) {
      const rules = [...new Set((result.leakFindings ?? []).map((f) => f.rule))].join(', ');
      showBanner('error', `⚠ 저장됨(rev ${currentRevision}) — 정답 누출 감지(${rules}). 학생용 HTML 은 보류되었습니다.`);
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
