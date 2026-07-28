// exportController.js — 정밀 미리보기(GET /preview.png)·PDF 내보내기(POST /export)·결과 열기
// (POST /open)의 소유자.
//
// Phase 5 모듈 경계 정리에서 editor.js 로부터 그대로 떼어 왔다(동작 무변경). 두 경로 모두
// save-first 게이트를 공유한다 — 서버는 "저장본"을 렌더하므로 편집 중(dirty)이면 먼저 저장해야
// 화면과 산출물이 어긋나지 않는다. 저장 자체는 이 모듈의 책임이 아니라 주입받은 isDirty/save 다.
//
// DOM 은 전역 조회 대신 주입받은 노드만 만진다(node 단위 테스트에서 가짜 노드 주입 가능).
export function createExportController({
  isDirty,
  save,
  showBanner,
  getMode,
  previewButton = null,
  previewModal,
  previewImg,
  previewStatus,
  previewCloseButton = null,
  exportButton,
  exportResultHost,
}) {
  // 미리보기(#6) — 전엔 저장 전이면 서버가 404(저장본 없음)를 내 img 가 깨진 채로 떴다. dirty 면
  // 먼저 저장하고, PNG 를 fetch 해 에러(409 busy·404·unsafe 409·500)를 모달에 글로 보여준다.
  async function openPreview() {
    previewModal.classList.remove('hidden');
    previewImg.classList.add('hidden');
    previewStatus.classList.remove('hidden');
    previewStatus.textContent = '미리보기 생성 중… (저장 후 Chrome 렌더 — 수 초 걸릴 수 있어요)';
    try {
      // 저장이 실패하면 서버엔 최신 편집이 없다 — 그대로 진행하면 **마지막 저장본**이 렌더돼
      // 화면과 미리보기가 조용히 어긋난다(editor.js:397 의 학생 모드 전환과 같은 형태).
      if (isDirty() && !(await save())) {
        previewStatus.textContent = '미리보기 실패: 저장에 실패해 최신 내용을 렌더할 수 없습니다.';
        return;
      }
      const res = await fetch(`/preview.png?mode=${getMode()}&_=${Date.now()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        previewStatus.textContent = `미리보기 실패: ${body.message || body.error || `HTTP ${res.status}`}`;
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      previewImg.onload = () => {
        if (previewImg.dataset.url) URL.revokeObjectURL(previewImg.dataset.url);
        previewImg.dataset.url = url;
      };
      previewImg.src = url;
      previewImg.classList.remove('hidden');
      previewStatus.classList.add('hidden');
    } catch (e) {
      previewStatus.textContent = `미리보기 실패: ${e.message}`;
    }
  }

  // 내보내기(#5) — 진행표시(버튼 비활성+배너) → dirty 면 save-first → /export → 결과 토스트에
  // 파일/폴더 '열기' 버튼(서버가 OS 기본 앱으로 연다). Chrome 렌더는 수십 초 걸릴 수 있다.
  async function doExport() {
    const origText = exportButton.textContent;
    exportButton.disabled = true;
    exportButton.textContent = '내보내는 중…';
    showBanner('warn', 'PDF 내보내는 중… (Chrome 렌더 — 수십 초 걸릴 수 있어요)');
    try {
      // 미리보기와 같은 이유 — 저장 실패 시 진행하면 낡은 저장본으로 PDF 가 나간다.
      if (isDirty() && !(await save())) {
        showBanner('error', '내보내기 중단: 저장에 실패해 최신 내용을 내보낼 수 없습니다.');
        return;
      }
      const res = await fetch('/export', { method: 'POST' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { showBanner('error', `내보내기 실패: ${result.error ?? result.message ?? res.status}`); return; }
      const skippedMsg = result.skipped?.student ? ` (학생용 생략: ${result.reason || result.skipped.student})` : '';
      showBanner(result.unsafe ? 'warn' : 'ok', `PDF 내보내기 완료 (${(result.rendered || []).length}벌)${skippedMsg}`);
      showExportResult(result, skippedMsg);
    } catch (e) {
      showBanner('error', `내보내기 실패: ${e.message}`);
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = origText;
    }
  }

  function openExportTarget(target) {
    return async () => {
      try {
        const r = await fetch('/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
        if (!r.ok) { const e = await r.json().catch(() => ({})); showBanner('error', `열기 실패: ${e.error || `HTTP ${r.status}`}`); }
      } catch (e) { showBanner('error', `열기 실패: ${e.message}`); }
    };
  }

  function showExportResult(result, skippedMsg) {
    const host = exportResultHost;
    const ownerDocument = host.ownerDocument;
    host.replaceChildren();
    const title = ownerDocument.createElement('div');
    title.className = 'export-result-title';
    title.textContent = `✔ PDF 내보내기 완료 (${(result.rendered || []).length}벌)${skippedMsg}`;
    host.appendChild(title);
    const actions = ownerDocument.createElement('div');
    actions.className = 'export-result-actions';
    const rendered = result.rendered || [];
    const mkBtn = (label, target) => {
      const b = ownerDocument.createElement('button');
      b.textContent = label;
      b.addEventListener('click', openExportTarget(target));
      return b;
    };
    if (rendered.some((r) => r.variant === 'teacher')) actions.appendChild(mkBtn('교사용 PDF 열기', 'teacher-pdf'));
    if (rendered.some((r) => r.variant === 'student')) actions.appendChild(mkBtn('학생용 PDF 열기', 'student-pdf'));
    actions.appendChild(mkBtn('폴더 열기', 'folder'));
    const close = ownerDocument.createElement('button');
    close.className = 'export-result-close';
    close.textContent = '닫기';
    close.addEventListener('click', () => host.classList.add('hidden'));
    actions.appendChild(close);
    host.appendChild(actions);
    host.classList.remove('hidden');
  }

  previewButton?.addEventListener('click', () => openPreview());
  previewCloseButton?.addEventListener('click', () => previewModal.classList.add('hidden'));
  exportButton.addEventListener('click', () => doExport());

  return { openPreview, doExport };
}
