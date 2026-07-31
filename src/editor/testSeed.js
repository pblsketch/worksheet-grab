/**
 * 결정적 시드 스크립트 — 렌더 테스트가 ?seed= 로 구동한다. core-ops/reflow-grow/reflow-once 는
 * US-16/17 회귀 방어(무변경 이식). shell-ui/thumbs-tree 는 이번 S4.3 신 UI 셸 전용.
 */
export async function runEditorTestSeed(seed, {
  shell,
  stage,
  docTitleEl,
  core,
  history,
  selection,
  frames,
  leftPanel,
  objOps,
  wait,
  pollUntil,
  runReflow,
  reloadTeacherFrame,
  setMode,
  updateAll,
  handlePageAction,
  scrollToPage,
  save,
  getCurrentRevision,
  getStudentStale,
  cancelScheduledReflow,
  getClipboardCount,
}) {
  const ObjOps = objOps;
  let doc = frames.teacher.contentDocument;
  if (seed === 'core-ops') {
    const titleEl = doc.querySelector('[data-ot="title"]');
    const questionEl = doc.querySelector('[data-ot="question"]');
    const stdEl = doc.querySelector('[data-ot="std-box"]');

    titleEl.click();
    document.body.dataset.sel1Type = core.findObject(titleEl.dataset.oid)?.obj.type ?? '';
    document.body.dataset.sel1Has = String(selection.state.selectedIds.has(titleEl.dataset.oid));

    questionEl.click();
    document.body.dataset.selSwitched = String(
      selection.state.selectedIds.has(questionEl.dataset.oid) && !selection.state.selectedIds.has(titleEl.dataset.oid),
    );

    titleEl.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    document.body.dataset.multiCount = String(selection.state.selectedIds.size);

    doc.querySelector('.sheet').click();
    document.body.dataset.clearedCount = String(selection.state.selectedIds.size);

    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const titleTarget = titleEl.querySelector('.title-box h1, .title-box h2');
    document.body.dataset.editingId = selection.state.editingId ?? '';
    document.body.dataset.titleCe = titleTarget.getAttribute('contenteditable') ?? '';
    document.body.dataset.othersCe = String(doc.querySelectorAll('[contenteditable="true"]').length);

    const origTitleText = titleTarget.textContent;
    titleTarget.textContent = '수정된 제목';
    titleTarget.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.dataset.titleTextSynced = core.findObject(titleEl.dataset.oid).obj.text;
    history.commit();

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.escEditingAfter = selection.state.editingId ?? '(none)';
    document.body.dataset.escSelectedAfter = [...selection.state.selectedIds].join(',');
    document.body.dataset.titleCeAfterEsc = titleTarget.getAttribute('contenteditable') ?? '(none)';

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.esc2SelectedCount = String(selection.state.selectedIds.size);

    stdEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    document.body.dataset.stdEditingId = selection.state.editingId ?? '(none)';
    document.body.dataset.stdSelected = String(selection.state.selectedIds.has(stdEl.dataset.oid));
    // 학습목표 표기 전환(2026-07-23): 인스펙터 objectives 필드 존재 + codes 읽기전용 확인(회귀 방어).
    document.body.dataset.stdInspObjectivesField = String(!!document.getElementById('insp-std-objectives'));
    document.body.dataset.stdInspCodesReadonly = String(document.getElementById('insp-std-codes')?.hasAttribute('readonly') ?? false);
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    questionEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const qTarget = questionEl.querySelector('.q');
    const qnumText = qTarget.querySelector('.qnum')?.textContent ?? '';
    const origPrompt = core.findObject(questionEl.dataset.oid).obj.prompt;
    const walker = doc.createTreeWalker(qTarget, NodeFilter.SHOW_TEXT);
    let lastText = null;
    while (walker.nextNode()) lastText = walker.currentNode;
    lastText.textContent = `${lastText.textContent}(수정)`;
    qTarget.dispatchEvent(new Event('input', { bubbles: true }));
    history.commit();
    const qObjAfter = core.findObject(questionEl.dataset.oid).obj;
    document.body.dataset.qPromptSynced = qObjAfter.prompt;
    document.body.dataset.qnumStripped = String(qnumText.length > 0 && !qObjAfter.prompt.includes(qnumText));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    history.undo();
    history.undo();
    document.body.dataset.afterUndoTitle = core.findObject(titleEl.dataset.oid).obj.text;
    document.body.dataset.afterUndoOrigMatch = String(core.findObject(titleEl.dataset.oid).obj.text === origTitleText);
    document.body.dataset.afterUndoQuestion = core.findObject(questionEl.dataset.oid).obj.prompt;
    document.body.dataset.afterUndoQuestionOrigMatch = String(core.findObject(questionEl.dataset.oid).obj.prompt === origPrompt);
    history.redo();
    history.redo();
    document.body.dataset.afterRedoTitle = core.findObject(titleEl.dataset.oid).obj.text;
    document.body.dataset.afterRedoQuestion = core.findObject(questionEl.dataset.oid).obj.prompt;

    const floatEl2 = doc.querySelector('.wg-float[data-ot="answer-area"]');

    document.body.dataset.floatPeUnselected = doc.defaultView.getComputedStyle(floatEl2).pointerEvents;
    selection.select(floatEl2.dataset.oid);
    document.body.dataset.floatPeSelected = doc.defaultView.getComputedStyle(floatEl2).pointerEvents;

    const rectBefore = { ...core.findObject(floatEl2.dataset.oid).obj.rect };
    const pe = (type, sx, sy) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, screenX: sx, screenY: sy, clientX: sx, clientY: sy,
    });
    floatEl2.dispatchEvent(pe('pointerdown', 300, 300));
    floatEl2.dispatchEvent(pe('pointermove', 340, 330));
    floatEl2.dispatchEvent(pe('pointerup', 340, 330));
    const rectAfter = core.findObject(floatEl2.dataset.oid).obj.rect;
    document.body.dataset.floatMovedX = String(Math.round(rectAfter.xMm - rectBefore.xMm));
    document.body.dataset.floatMovedY = String(Math.round(rectAfter.yMm - rectBefore.yMm));
    doc.querySelector('.sheet').click();
    document.body.dataset.afterSwallowSelected = String(selection.state.selectedIds.has(floatEl2.dataset.oid));
    doc.querySelector('.sheet').click();
    document.body.dataset.afterSecondClickCount = String(selection.state.selectedIds.size);

    document.body.dataset.revBeforeSave = String(getCurrentRevision() ?? '');
    const saved = await save();
    document.body.dataset.revAfterSave = String(getCurrentRevision() ?? '');
    document.body.dataset.saveOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'reflow-grow') {
    const pageIndexOf = (id) => {
      const d = core.getDocument();
      for (let i = 0; i < d.pages.length; i++) {
        const p = d.pages[i];
        if ((p.flow || []).some((o) => o.id === id)) return i;
        if ((p.float || []).some((o) => o.id === id)) return i;
      }
      return -1;
    };

    document.body.dataset.rgPageCountBefore = String(core.getDocument().pages.length);
    document.body.dataset.rgGrowPageBefore = String(pageIndexOf('rt-grow'));
    document.body.dataset.rgAfterPageBefore = String(pageIndexOf('rt-after'));
    document.body.dataset.rgTablePageBefore = String(pageIndexOf('tbl1'));
    document.body.dataset.rgFloatPageBefore = String(pageIndexOf('f1'));
    const floatRectBefore = { ...core.findObject('f1').obj.rect };
    const tableRowsBefore = core.findObject('tbl1').obj.rows.length;

    let growEl = doc.querySelector('[data-oid="rt-grow"]');
    growEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const longHtml = Array.from({ length: 60 }, (_, i) =>
      `<p>리플로우 실측용 긴 문단 ${i} — 개체 높이를 키워 페이지 넘침을 유발합니다.</p>`).join('');
    growEl.innerHTML = longHtml;
    growEl.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await runReflow();
    doc = frames.teacher.contentDocument;

    document.body.dataset.rgPageCountAfterGrow = String(core.getDocument().pages.length);
    document.body.dataset.rgGrowPageAfterGrow = String(pageIndexOf('rt-grow'));
    document.body.dataset.rgAfterPageAfterGrow = String(pageIndexOf('rt-after'));
    document.body.dataset.rgTablePageAfterGrow = String(pageIndexOf('tbl1'));
    document.body.dataset.rgFloatPageAfterGrow = String(pageIndexOf('f1'));
    const floatRectAfterGrow = core.findObject('f1').obj.rect;
    document.body.dataset.rgFloatRectUnchangedAfterGrow = String(
      floatRectAfterGrow.xMm === floatRectBefore.xMm && floatRectAfterGrow.yMm === floatRectBefore.yMm,
    );
    document.body.dataset.rgTableRowsAfterGrow = String(core.findObject('tbl1').obj.rows.length);

    growEl = doc.querySelector('[data-oid="rt-grow"]');
    growEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    growEl.innerHTML = '<p>다시 짧아진 문단</p>';
    growEl.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await runReflow();
    doc = frames.teacher.contentDocument;

    document.body.dataset.rgPageCountAfterShrink = String(core.getDocument().pages.length);
    document.body.dataset.rgAfterPageAfterShrink = String(pageIndexOf('rt-after'));
    document.body.dataset.rgTablePageAfterShrink = String(pageIndexOf('tbl1'));
    const floatRectAfterShrink = core.findObject('f1').obj.rect;
    document.body.dataset.rgFloatRectUnchangedAfterShrink = String(
      floatRectAfterShrink.xMm === floatRectBefore.xMm && floatRectAfterShrink.yMm === floatRectBefore.yMm,
    );
    document.body.dataset.rgTableRowsAfterShrink = String(core.findObject('tbl1').obj.rows.length);
    document.body.dataset.rgTableRowsOriginal = String(tableRowsBefore);

    document.body.dataset.rgRevBeforeSave = String(getCurrentRevision() ?? '');
    const savedRg = await save();
    document.body.dataset.rgRevAfterSave = String(getCurrentRevision() ?? '');
    document.body.dataset.rgSaveOk = String(savedRg != null && savedRg.unsafe === false);
  } else if (seed === 'reflow-once') {
    await runReflow();
    document.body.dataset.roRevBeforeSave = String(getCurrentRevision() ?? '');
    const savedOnce = await save();
    document.body.dataset.roRevAfterSave = String(getCurrentRevision() ?? '');
    document.body.dataset.roSaveOk = String(savedOnce != null && savedOnce.unsafe === false);
  } else if (seed === 'shell-ui') {
    // ── 앱 바 요소 존재 ──
    document.body.dataset.hasTitle = String(!!document.getElementById('doc-title'));
    document.body.dataset.hasReview = String(!!document.getElementById('btn-review'));
    document.body.dataset.hasPreview = String(!!document.getElementById('btn-preview'));
    document.body.dataset.hasExport = String(!!document.getElementById('btn-export'));
    document.body.dataset.hasSave = String(!!document.getElementById('btn-save'));

    // 제목 인라인 편집
    const origTitle = core.getDocument().docTitle;
    docTitleEl.click();
    docTitleEl.textContent = '수정된 문서 제목';
    docTitleEl.dispatchEvent(new Event('input', { bubbles: true }));
    docTitleEl.blur();
    document.body.dataset.titleSynced = core.getDocument().docTitle;
    document.body.dataset.titleChanged = String(core.getDocument().docTitle !== origTitle);

    // 검수 칩
    document.body.dataset.reviewStatus = document.getElementById('btn-review').dataset.reviewStatus;

    // 툴바: 선택 없음 = empty
    document.body.dataset.tbEmpty = document.getElementById('context-toolbar').dataset.tbMode;

    // 좌측 3탭 존재 + 전환
    const leftPanelEl = document.getElementById('left-panel');
    document.body.dataset.tabsCount = String(leftPanelEl.querySelectorAll('[data-tab]').length);
    document.querySelector('[data-tab="insert"]').click();
    document.body.dataset.leftTabAfterClick = leftPanelEl.dataset.leftTab;
    document.body.dataset.insertPanelVisible = String(!leftPanelEl.querySelector('[data-panel="insert"]').classList.contains('hidden'));

    // 삽입 카탈로그 클릭 → 구조 삽입 → 자동 선택 → 인스펙터/툴바 object 모드
    const beforeCount = core.allObjects().length;
    document.querySelector('#insert-grid [data-insert-key="divider"]').click();
    await wait(150);
    // 삽입이 예약한 리플로우 디바운스(300ms)가 이후 선택 조작 도중 비동기로 발동해 iframe 을
    // 재로드하는 경합을 피한다 — 이 구간 검증은 삽입/선택 자체이지 리플로우 결과가 아니다.
    cancelScheduledReflow();
    document.body.dataset.afterInsertCount = String(core.allObjects().length);
    document.body.dataset.countIncreased = String(core.allObjects().length > beforeCount);
    document.body.dataset.inspAfterInsert = document.getElementById('right-panel').dataset.inspMode;
    document.body.dataset.tbAfterInsert = document.getElementById('context-toolbar').dataset.tbMode;

    document.querySelector('[data-tab="pages"]').click();
    doc = frames.teacher.contentDocument;
    const titleObjEl = doc.querySelector('[data-ot="title"]');
    const tableObjEl = doc.querySelector('[data-ot="table"]');
    const richEl = doc.querySelector('[data-ot="richtext"]');

    titleObjEl.click();
    document.body.dataset.tbOnTitleSelect = document.getElementById('context-toolbar').dataset.tbMode;
    document.body.dataset.inspOnTitleSelect = document.getElementById('right-panel').dataset.inspMode;

    tableObjEl.click();
    document.body.dataset.tbOnTableSelect = document.getElementById('context-toolbar').dataset.tbMode;
    document.body.dataset.hasAddRowBtn = String(!!document.getElementById('tb-add-row'));

    titleObjEl.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    document.body.dataset.tbOnMulti = document.getElementById('context-toolbar').dataset.tbMode;
    document.body.dataset.inspOnMulti = document.getElementById('right-panel').dataset.inspMode;

    doc.querySelector('.sheet').click();
    document.body.dataset.inspOnClear = document.getElementById('right-panel').dataset.inspMode;
    document.body.dataset.reviewListPresent = String(!!document.getElementById('insp-review-list'));

    // 슬래시 메뉴(닫힌 카탈로그만) — richtext 편집 중 `/`
    richEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    richEl.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    document.body.dataset.slashOpenCaptured = document.body.dataset.slashOpen ?? 'false';
    const slashMenuEl = document.getElementById('canvas-slash-menu');
    // US-19/B1: 슬래시 메뉴에 유틸리티 진입점(data-slash-item="ai" · "author-section")이 있다 —
    // "닫힌 카탈로그만 노출" 단정은 카탈로그 항목(10종+qtype 7종=16)만 세고, 유틸리티 항목은 별도로
    // 존재만 확인한다(카운트에서 제외).
    document.body.dataset.slashItemCount = slashMenuEl
      ? String(slashMenuEl.querySelectorAll('button[data-slash-item]:not([data-slash-item="ai"]):not([data-slash-item="author-section"])').length) : '0';
    document.body.dataset.slashHasAiItem = String(!!slashMenuEl?.querySelector('button[data-slash-item="ai"]'));
    document.body.dataset.slashHasAuthorItem = String(!!slashMenuEl?.querySelector('button[data-slash-item="author-section"]'));
    const beforeSlashInsert = core.allObjects().length;
    slashMenuEl?.querySelector('button[data-slash-item="divider"]')?.click();
    await wait(150);
    cancelScheduledReflow();
    document.body.dataset.afterSlashInsertCount = String(core.allObjects().length);
    document.body.dataset.slashInsertIncreased = String(core.allObjects().length > beforeSlashInsert);
    doc = frames.teacher.contentDocument;
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  } else if (seed === 'thumbs-tree') {
    document.body.dataset.thumbCountInitial = String(document.querySelectorAll('#thumb-list .thumb').length);
    document.body.dataset.pageCountInitial = String(core.getDocument().pages.length);

    await handlePageAction('add-after', null);
    document.body.dataset.pageCountAfterAdd = String(core.getDocument().pages.length);
    document.body.dataset.thumbCountAfterAdd = String(document.querySelectorAll('#thumb-list .thumb').length);

    await handlePageAction('duplicate', core.getDocument().pages[0].id);
    document.body.dataset.pageCountAfterDup = String(core.getDocument().pages.length);
    document.body.dataset.thumbCountAfterDup = String(document.querySelectorAll('#thumb-list .thumb').length);

    const beforeDeleteCount = core.getDocument().pages.length;
    await handlePageAction('delete', core.getDocument().pages[beforeDeleteCount - 1].id);
    document.body.dataset.pageCountAfterDelete = String(core.getDocument().pages.length);
    document.body.dataset.thumbCountAfterDelete = String(document.querySelectorAll('#thumb-list .thumb').length);

    // 편집 반영 확인 — 실제 리플로우(runReflow)는 쓰지 않는다: 위 add/duplicate/delete 로 만든
    // 빈 페이지가 콘텐츠 기반 재계산에 휩쓸려 사라지는 걸 피하기 위함(핸들러 주석 참조). 편집은
    // 라이브 iframe DOM 을 직접 바꾸므로 리플로우 없이도 즉시 화면에 반영된다 — history.commit()
    // 으로 개체 트리만 확정하고 썸네일을 수동으로 다시 그린다.
    doc = frames.teacher.contentDocument;
    const titleObjEl = doc.querySelector('[data-ot="title"]');
    titleObjEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const target = titleObjEl.querySelector('.title-box h1, .title-box h2');
    target.textContent = '썸네일 동기화 확인용 제목';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    leftPanel.renderThumbs(doc, core.getDocument().pages);

    const pageIdx = ObjOps.pageIndexOf(core.getDocument(), titleObjEl.dataset.oid);
    const thumbFrame = document.querySelectorAll('#thumb-list .thumb')[pageIdx]?.querySelector('iframe');
    document.body.dataset.thumbSyncOk = String(!!thumbFrame && thumbFrame.srcdoc.includes('썸네일 동기화 확인용 제목'));
    document.body.dataset.thumbSyncPageIdx = String(pageIdx);

    scrollToPage(core.getDocument().pages[0].id);
    await wait(50);
    document.body.dataset.scrollToFirstOk = String(document.getElementById('canvas-wrap').scrollTop >= 0);
  } else if (seed === 'page-management') {
    const initialIds = core.getDocument().pages.map((page) => page.id);
    const firstId = initialIds[0];
    const secondId = initialIds[1];

    let secondThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${secondId}"]`);
    secondThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    document.body.dataset.pmSelectedId = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    document.body.dataset.pmAriaCurrent = secondThumb.getAttribute('aria-current') ?? '';
    document.body.dataset.pmTabIndex = String(secondThumb.tabIndex);
    document.body.dataset.pmHasMenuButton = String(!!secondThumb.querySelector('.thumb-menu'));
    secondThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    document.body.dataset.pmKeyboardMenuCount = String(document.querySelectorAll('.ctx-menu button').length);
    document.body.dataset.pmKeyboardMenuFocus = document.activeElement?.textContent ?? '';
    const keyboardMenuRect = document.querySelector('.ctx-menu').getBoundingClientRect();
    document.body.dataset.pmKeyboardMenuInViewport = String(
      keyboardMenuRect.left >= 0
        && keyboardMenuRect.top >= 0
        && keyboardMenuRect.right <= window.innerWidth
        && keyboardMenuRect.bottom <= window.innerHeight,
    );
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.body.dataset.pmKeyboardMenuNavFocus = document.activeElement?.textContent ?? '';
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.pmKeyboardMenuClosed = String(!document.querySelector('.ctx-menu'));
    document.body.dataset.pmKeyboardMenuReturnFocus = document.activeElement?.dataset.pageId ?? '';

    secondThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await pollUntil(() => core.getDocument().pages.length === initialIds.length + 1);
    await wait(50);
    document.body.dataset.pmKeyboardMenuActivated = String(!document.querySelector('.ctx-menu'));
    document.body.dataset.pmKeyboardMenuPageDelta = String(core.getDocument().pages.length - initialIds.length);
    history.undo();
    secondThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${secondId}"]`);

    const roleSelect = secondThumb.querySelector('.thumb-role');
    roleSelect.value = 'reading';
    roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    await pollUntil(() => core.getDocument().pages.find((page) => page.id === secondId)?.role === 'reading');
    document.body.dataset.pmRoleAfter = core.getDocument().pages.find((page) => page.id === secondId)?.role ?? '';
    history.undo();
    document.body.dataset.pmRoleUndo = core.getDocument().pages.find((page) => page.id === secondId)?.role ?? '';
    document.body.dataset.pmRoleUndoActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    history.redo();
    document.body.dataset.pmRoleRedo = core.getDocument().pages.find((page) => page.id === secondId)?.role ?? '';

    const inactiveThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${firstId}"]`);
    inactiveThumb.focus();
    inactiveThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
    await pollUntil(() => core.getDocument().pages[1].id === firstId);
    document.body.dataset.pmInactiveKeyboardActiveRetained = String(
      document.querySelector('#thumb-list .thumb.active')?.dataset.pageId === secondId,
    );
    document.body.dataset.pmInactiveKeyboardFocusRetained = String(document.activeElement?.dataset.pageId === firstId);
    history.undo();

    secondThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${secondId}"]`);
    secondThumb.focus();
    secondThumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));
    await pollUntil(() => core.getDocument().pages[0].id === secondId);
    document.body.dataset.pmKeyboardOrder = core.getDocument().pages.map((page) => page.id).join(',');
    document.body.dataset.pmKeyboardActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    document.body.dataset.pmKeyboardFocus = document.activeElement?.dataset.pageId ?? '';
    const keyboardSheet = [...frames.teacher.contentDocument.querySelectorAll('.sheet')]
      .find((sheet) => sheet.dataset.pageId === secondId);
    const keyboardExpectedTop = Math.max(0, frames.teacher.offsetTop + keyboardSheet.offsetTop - 16);
    document.body.dataset.pmKeyboardScrollMatches = String(
      Math.abs(document.getElementById('canvas-wrap').scrollTop - keyboardExpectedTop) <= 2,
    );
    history.undo();
    document.body.dataset.pmKeyboardUndoOrder = core.getDocument().pages.map((page) => page.id).join(',');
    await wait(10);
    const keyboardUndoSheet = [...frames.teacher.contentDocument.querySelectorAll('.sheet')]
      .find((sheet) => sheet.dataset.pageId === secondId);
    const keyboardUndoExpectedTop = Math.max(0, frames.teacher.offsetTop + keyboardUndoSheet.offsetTop - 16);
    document.body.dataset.pmKeyboardUndoScrollMatches = String(
      Math.abs(document.getElementById('canvas-wrap').scrollTop - keyboardUndoExpectedTop) <= 2,
    );
    history.redo();
    await wait(10);
    const keyboardRedoSheet = [...frames.teacher.contentDocument.querySelectorAll('.sheet')]
      .find((sheet) => sheet.dataset.pageId === secondId);
    const keyboardRedoExpectedTop = Math.max(0, frames.teacher.offsetTop + keyboardRedoSheet.offsetTop - 16);
    document.body.dataset.pmKeyboardRedoScrollMatches = String(
      Math.abs(document.getElementById('canvas-wrap').scrollTop - keyboardRedoExpectedTop) <= 2,
    );

    secondThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${secondId}"]`);
    const boundaryKey = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    secondThumb.dispatchEvent(boundaryKey);
    document.body.dataset.pmKeyboardBoundaryPrevented = String(boundaryKey.defaultPrevented);

    const cancelledTarget = document.querySelector(`#thumb-list .thumb[data-page-id="${firstId}"]`);
    const cancelledDraggedRect = secondThumb.getBoundingClientRect();
    const cancelledTargetRect = cancelledTarget.getBoundingClientRect();
    const cancelledPointer = (type, y) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 36,
      button: 0,
      clientX: cancelledDraggedRect.left + 10,
      clientY: y,
    });
    secondThumb.dispatchEvent(cancelledPointer('pointerdown', cancelledDraggedRect.top + 5));
    secondThumb.dispatchEvent(cancelledPointer('pointermove', cancelledTargetRect.bottom + 10));
    secondThumb.dispatchEvent(cancelledPointer('pointercancel', cancelledTargetRect.bottom + 10));
    document.body.dataset.pmPointerCancelRestored = String(
      [...document.querySelectorAll('#thumb-list .thumb')].map((thumb) => thumb.dataset.pageId).join(',')
        === core.getDocument().pages.map((page) => page.id).join(','),
    );

    const draggedThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${secondId}"]`);
    const targetThumb = document.querySelector(`#thumb-list .thumb[data-page-id="${firstId}"]`);
    const draggedRect = draggedThumb.getBoundingClientRect();
    const targetRect = targetThumb.getBoundingClientRect();
    const pointer = (type, y) => new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 37,
      button: 0,
      clientX: draggedRect.left + 10,
      clientY: y,
    });
    const pointerDown = pointer('pointerdown', draggedRect.top + 5);
    draggedThumb.dispatchEvent(pointerDown);
    document.body.dataset.pmPointerDownPrevented = String(pointerDown.defaultPrevented);
    draggedThumb.dispatchEvent(pointer('pointermove', targetRect.bottom + 10));
    draggedThumb.dispatchEvent(pointer('pointerup', targetRect.bottom + 10));
    await pollUntil(() => core.getDocument().pages.at(-1).id === secondId);
    document.body.dataset.pmPointerOrder = core.getDocument().pages.map((page) => page.id).join(',');
    document.body.dataset.pmPointerActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    const pointerSheet = [...frames.teacher.contentDocument.querySelectorAll('.sheet')]
      .find((sheet) => sheet.dataset.pageId === secondId);
    const pointerExpectedTop = Math.max(0, frames.teacher.offsetTop + pointerSheet.offsetTop - 16);
    document.body.dataset.pmPointerScrollMatches = String(
      Math.abs(document.getElementById('canvas-wrap').scrollTop - pointerExpectedTop) <= 2,
    );
    const manualSheet = [...frames.teacher.contentDocument.querySelectorAll('.sheet')]
      .find((sheet) => sheet.dataset.pageId === firstId);
    const canvasWrap = document.getElementById('canvas-wrap');
    canvasWrap.scrollTop = Math.max(0, frames.teacher.offsetTop + manualSheet.offsetTop - 16);
    canvasWrap.dispatchEvent(new Event('scroll'));
    document.body.dataset.pmManualScrollActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';

    const added = await handlePageAction('add-after', secondId);
    const addedId = added.activePageId;
    document.body.dataset.pmAddIdUnique = String(!initialIds.includes(addedId));
    document.body.dataset.pmAddActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    document.body.dataset.pmAddSheets = String(frames.teacher.contentDocument.querySelectorAll('.sheet').length);
    history.undo();
    document.body.dataset.pmAddUndoCount = String(core.getDocument().pages.length);
    document.body.dataset.pmAddUndoSheets = String(frames.teacher.contentDocument.querySelectorAll('.sheet').length);
    history.redo();
    document.body.dataset.pmAddRedoActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';

    await handlePageAction('delete', addedId);
    document.body.dataset.pmDeleteActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    history.undo();
    document.body.dataset.pmDeleteUndoActive = document.querySelector('#thumb-list .thumb.active')?.dataset.pageId ?? '';
    document.body.dataset.pmDeleteUndoSheets = String(frames.teacher.contentDocument.querySelectorAll('.sheet').length);
    history.redo();
    document.body.dataset.pmDeleteRedoCount = String(core.getDocument().pages.length);
    document.body.dataset.pmDeleteRedoSheets = String(frames.teacher.contentDocument.querySelectorAll('.sheet').length);

    await save();
    const reopened = await fetch('/shell.json').then((response) => response.json());
    document.body.dataset.pmSavedIds = reopened.document.pages.map((page) => page.id).join(',');
    document.body.dataset.pmSavedReadingRole = String(
      reopened.document.pages.find((page) => page.id === secondId)?.role === 'reading',
    );
  } else if (seed === 'ai-guard') {
    // US-19: 성취기준/저작권 슬롯 개체 선택 시 진입점 3중 방어 확인(§7·§10) — 앱 바 버튼 비활성 ·
    // 우클릭 메뉴 항목 비활성 · 서버 400(심층 방어의 마지막 층, 클라이언트 우회 대비).
    const stdEl = doc.querySelector('[data-oid="std1"]');
    stdEl.click();
    document.body.dataset.aiGuardEntryDisabled = String(document.getElementById('btn-ai').disabled);

    stdEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    const ctxAiBtn = document.getElementById('canvas-ctx-menu')?.querySelector('#ctx-ai');
    document.body.dataset.aiGuardCtxDisabled = String(!!ctxAiBtn?.disabled);
    document.querySelectorAll('.ctx-menu').forEach((n) => n.remove());

    // disabled 버튼은 표준 DOM 동작상 .click() 으로도 click 이벤트가 발생하지 않는다 — 그대로 패널
    // 미개방을 단정해 클라이언트 가드가 실효적임을 확인한다.
    document.getElementById('btn-ai').click();
    document.body.dataset.aiGuardPanelOpened = String(!!document.getElementById('ai-panel'));

    const res = await fetch('/ai/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'std1', type: 'std-box', placement: 'flow', codes: [] }] }),
    });
    document.body.dataset.aiGuardServerStatus = String(res.status);
  } else if (seed === 'ai-request-preview') {
    // US-19: 진입점 통일(앱바 버튼·우클릭·슬래시·컨텍스트 툴바가 전부 같은 패널을 연다) + v3 요청
    // 발신 + 무API "AI 지시문 복사" + 응답 도착 후 미리보기 카드·인라인 diff.
    let qEl = doc.querySelector('[data-oid="q1"]');
    const origPrompt = core.findObject('q1').obj.prompt;

    qEl.click();
    document.getElementById('tb-ai').click();
    document.body.dataset.aiOpenViaToolbar = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');
    document.getElementById('ai-panel-close').click();
    await wait(30);

    qEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
    document.getElementById('canvas-ctx-menu')?.querySelector('#ctx-ai')?.click();
    document.body.dataset.aiOpenViaContextMenu = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');
    document.getElementById('ai-panel-close').click();
    await wait(30);

    qEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    document.getElementById('canvas-slash-menu')?.querySelector('button[data-slash-item="ai"]')?.click();
    document.body.dataset.aiOpenViaSlash = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.getElementById('ai-panel-close').click();
    await wait(30);

    qEl = doc.querySelector('[data-oid="q1"]');
    qEl.click();
    document.body.dataset.aiEntryEnabledOnSelect = String(!document.getElementById('btn-ai').disabled);
    document.getElementById('btn-ai').click();
    document.body.dataset.aiOpenViaEntry = String(document.getElementById('ai-panel')?.dataset.aiPhase === 'compose');

    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    const copyText = document.getElementById('ai-copy-text').value;
    document.body.dataset.aiCopyHasReqId = String(/req-\S+/.test(copyText));
    document.body.dataset.aiCopyHasObjectsFlag = String(copyText.includes('--objects'));
    document.body.dataset.aiRequestId = document.querySelector('.ai-waiting')?.dataset.aiRequestId || '';

    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.aiPreviewShown = 'true';
    const diffEl = document.getElementById('ai-diff-q1');
    document.body.dataset.aiDiffHasAdd = String(!!diffEl?.querySelector('.ai-diff-add'));
    document.body.dataset.aiDiffHasDel = String(!!diffEl?.querySelector('.ai-diff-del'));
    document.body.dataset.aiPreviewBeforeHasOrig = String(
      !!document.querySelector('.ai-preview-before .ai-preview-render')?.textContent.includes(origPrompt),
    );
    document.getElementById('ai-cancel-preview').click();
    // 고정 대기(30ms)는 부하에서 짧다 — `closePanel` 은 취소 POST 를 **await 한 뒤에야** 패널을
    // 지운다(ai.js). 서버 왕복이 30ms 를 넘으면 아직 열려 있는 패널을 재서 "취소해도 안 닫힘"이라는
    // 거짓 실패가 났다(전량 실행에서 실측, 유휴 단독 A/B 10회로는 재현되지 않음).
    // 같은 목적의 폴링이 아래 'ai-apply-cancel-others' 시드에 이미 있다 — 그 관례로 맞춘다.
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    document.body.dataset.aiPanelClosedAfterCancel = String(!document.getElementById('ai-panel'));
  } else if (seed === 'ai-version-apply-undo') {
    // US-19: 재생성(버전 ◀▶ 화살표 왕복) + 적용(교체, history 1 op) + undo 1스텝 복원.
    const qEl = doc.querySelector('[data-oid="q1"]');
    const origPrompt = core.findObject('q1').obj.prompt;
    qEl.click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    const v1Text = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';

    document.getElementById('ai-regenerate').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting');
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview'
      && document.getElementById('ai-version-label')?.textContent === '2 / 2', { timeoutMs: 30000 });
    const v2Text = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';
    document.body.dataset.aiVersionLabelAfterRegen = document.getElementById('ai-version-label').textContent;
    document.body.dataset.aiVersionsDiffer = String(v1Text.length > 0 && v2Text.length > 0 && v1Text !== v2Text);

    document.getElementById('ai-version-prev').click();
    document.body.dataset.aiVersionLabelAfterPrev = document.getElementById('ai-version-label').textContent;
    const v1TextAgain = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';
    document.body.dataset.aiVersionPrevMatchesV1 = String(v1TextAgain === v1Text);

    document.getElementById('ai-version-next').click();
    document.body.dataset.aiVersionLabelAfterNext = document.getElementById('ai-version-label').textContent;

    const idxBeforeApply = history.depth().index;
    document.getElementById('ai-apply-replace').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    // codex#10: 고정 대기 대신 비동기 리플로우+history.amend 완료를 결정적으로 기다린 뒤 검증한다 —
    // amend 가 undo 뒤로 새면 pre-apply 엔트리를 오염시키므로(runReflow 는 in-flight 면 그걸 await),
    // 그 레이스를 이 테스트가 가리지 않고 잡도록 한다.
    await runReflow();
    doc = frames.teacher.contentDocument;
    document.body.dataset.aiApplyOneOp = String(history.depth().index === idxBeforeApply + 1);
    const promptAfterApply = core.findObject('q1').obj.prompt;
    document.body.dataset.aiPromptChangedAfterApply = String(promptAfterApply !== origPrompt);
    document.body.dataset.aiFreshAfterApply = String(doc.querySelector('[data-oid="q1"]')?.getAttribute('data-ai-fresh') === 'true');

    history.undo();
    updateAll();
    await wait(80);
    document.body.dataset.aiUndoRestoredOriginal = String(core.findObject('q1').obj.prompt === origPrompt);
    document.body.dataset.aiUndoOneStep = String(history.depth().index === idxBeforeApply);
  } else if (seed === 'ai-graduate-insert') {
    // US-19: AI 산출 졸업 배지(적용 직후 표시 → 편집 즉시 제거) + "아래 삽입" 액션(원본 보존 확인).
    let qEl = doc.querySelector('[data-oid="q1"]');
    qEl.click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.getElementById('ai-apply-replace').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    doc = frames.teacher.contentDocument;
    qEl = doc.querySelector('[data-oid="q1"]');
    document.body.dataset.aiFreshBeforeEdit = String(qEl.getAttribute('data-ai-fresh') === 'true');

    qEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const editTarget = qEl.querySelector('.q');
    editTarget.textContent = `${editTarget.textContent}(사용자 수정)`;
    editTarget.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    qEl = doc.querySelector('[data-oid="q1"]');
    document.body.dataset.aiFreshAfterEdit = String(qEl.getAttribute('data-ai-fresh') === 'true');

    const titleTextBefore = core.findObject('t1').obj.text;
    const beforeCount = core.allObjects().length;
    doc.querySelector('[data-oid="t1"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.getElementById('ai-apply-insert').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    doc = frames.teacher.contentDocument;
    document.body.dataset.aiInsertCountIncreased = String(core.allObjects().length === beforeCount + 1);
    document.body.dataset.aiInsertOriginalUnchanged = String(core.findObject('t1').obj.text === titleTextBefore);
  } else if (seed === 'ai-passage-preset') {
    // 3층 정책(2026-07-23 2차 델타): passage-slot 은 AI 가드에서 해제됐다 — 진입점 활성 + 지문 전용
    // 프리셋("창작 지문 생성"·"지문 재구성") 노출 + 요청 지시문에 저작권 제약 고지 + 미리보기까지 확인한다.
    const pasEl = doc.querySelector('[data-oid="pas1"]');
    pasEl.click();
    document.body.dataset.passageAiEntryEnabled = String(!document.getElementById('btn-ai').disabled);
    document.getElementById('btn-ai').click();
    document.body.dataset.passageAiPhase = document.getElementById('ai-panel')?.dataset.aiPhase || '(none)';
    document.body.dataset.hasGenerateBtn = String(!!document.getElementById('ai-preset-passage-generate'));
    document.body.dataset.hasRestructureBtn = String(!!document.getElementById('ai-preset-passage-restructure'));

    const topicInput = document.getElementById('ai-passage-topic-input');
    if (topicInput) topicInput.value = '인공지능과 글쓰기';
    document.getElementById('ai-preset-passage-generate').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    const copyText = document.getElementById('ai-copy-text').value;
    document.body.dataset.copyHasGuardNote = String(copyText.includes('실존 저작물'));

    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.passagePreviewShown = 'true';
    const afterRender = document.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '';
    document.body.dataset.previewHasGenerated = String(afterRender.includes('AI가 창작한 지문 본문'));

    document.getElementById('ai-apply-replace').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    document.body.dataset.passageBodyAfterApply = core.findObject('pas1').obj.bodyHtml || '';
    document.body.dataset.passageSourceAfterApply = core.findObject('pas1').obj.source || '';

    // std-box 는 여전히 AI 가드 대상(원칙 3, 무회귀) — 같은 시드 안에서 교차 확인(적용이 iframe 을
    // 재로드했을 수 있으므로 doc 를 다시 잡는다 — ai-graduate-insert 시드와 동형 패턴).
    doc = frames.teacher.contentDocument;
    const stdEl2 = doc.querySelector('[data-oid="std1"]');
    stdEl2.click();
    document.body.dataset.stdAiEntryStillDisabled = String(document.getElementById('btn-ai').disabled);
  } else if (seed === 'ai-ops-merge') {
    // US-P4-2·P4-3: v4 계획(ops) — 문항 3개 선택 → AI 가 "1개로 합치고 안내문 1개 추가"를 계획한다.
    // 미리보기가 수정/신규/삭제를 구분해 보여주고, 적용은 applyDocOp 한 번(=undo 1스텝)이어야 한다.
    const beforeCount = core.allObjects().length;
    const origPrompt = core.findObject('q1').obj.prompt;
    doc.querySelector('[data-oid="q1"]').click();
    doc.querySelector('[data-oid="q2"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    doc.querySelector('[data-oid="q3"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    document.body.dataset.opsSelectedCount = String(selection.state.selectedIds.size);

    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });

    const cards = [...document.querySelectorAll('.ai-preview-card')];
    document.body.dataset.opsCardKinds = cards.map((c) => c.dataset.aiPreviewKind).join(',');
    const counts = document.getElementById('ai-count-change');
    document.body.dataset.opsCountBefore = counts.dataset.aiCountBefore;
    document.body.dataset.opsCountAfter = counts.dataset.aiCountAfter;
    document.body.dataset.opsCountDelete = counts.dataset.aiCountDelete;
    document.body.dataset.opsCountInsert = counts.dataset.aiCountInsert;
    document.body.dataset.opsCountText = counts.textContent;

    const delCard = document.querySelector('.ai-preview-card[data-ai-preview-kind="delete"]');
    document.body.dataset.opsDeleteBeforeText = (delCard?.querySelector('.ai-preview-before .ai-preview-render')?.textContent || '').trim();
    document.body.dataset.opsDeleteAfterText = (delCard?.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '').trim();
    const insCard = document.querySelector('.ai-preview-card[data-ai-preview-kind="insert"]');
    document.body.dataset.opsInsertBeforeText = (insCard?.querySelector('.ai-preview-before .ai-preview-render')?.textContent || '').trim();
    document.body.dataset.opsInsertAfterText = (insCard?.querySelector('.ai-preview-after .ai-preview-render')?.textContent || '').trim();

    const idxBeforeApply = history.depth().index;
    document.getElementById('ai-apply-ops').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    // codex#10: 다중 op(3→1 병합+신규) 는 페이지 귀속을 바꿔 리플로우가 반드시 amend 한다 — 고정 대기
    // 대신 그 완료를 결정적으로 기다린 뒤 history 인덱스·undo 를 검증한다(amend 가 별도 엔트리를 만들면
    // 여기서 index 가 +2 가 되어 즉시 잡힌다).
    await runReflow();
    doc = frames.teacher.contentDocument;
    document.body.dataset.opsHistoryOneOp = String(history.depth().index === idxBeforeApply + 1);
    document.body.dataset.opsCountBeforeApply = String(beforeCount);
    document.body.dataset.opsCountAfterApply = String(core.allObjects().length);
    document.body.dataset.opsMergedAway = String(!core.findObject('q2') && !core.findObject('q3'));
    document.body.dataset.opsQ1Prompt = core.findObject('q1').obj.prompt;
    document.body.dataset.opsStdIntact = String(!!core.findObject('std1') && core.findObject('std1').obj.type === 'std-box');
    const selectedAfter = [...selection.state.selectedIds];
    document.body.dataset.opsSelectionMoved = String(selectedAfter.includes('q1') && !selectedAfter.includes('q2'));
    document.body.dataset.opsSelectionCount = String(selectedAfter.length);
    document.body.dataset.opsInsertedRendered = String(
      !!doc.body.textContent.includes('활동 안내(AI 신규)'),
    );

    history.undo();
    updateAll();
    await wait(80);
    document.body.dataset.opsUndoRestored = String(
      !!core.findObject('q2') && !!core.findObject('q3') && core.findObject('q1').obj.prompt === origPrompt,
    );
    document.body.dataset.opsUndoCount = String(core.allObjects().length);
    document.body.dataset.opsUndoOneStep = String(history.depth().index === idxBeforeApply);
  } else if (seed === 'ai-ops-invalid') {
    // US-P4-3: 계획이 전부 무효(없는 대상 지목)면 적용 버튼이 비활성이고 사유가 보인다(무음 실패 금지).
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.invApplyDisabled = String(document.getElementById('ai-apply-ops').disabled);
    document.body.dataset.invError = document.getElementById('ai-error')?.textContent || '';
    const promptBefore = core.findObject('q1').obj.prompt;
    document.getElementById('ai-apply-ops').click(); // disabled 라 아무 일도 없어야 한다
    await wait(120);
    document.body.dataset.invPanelStillOpen = String(!!document.getElementById('ai-panel'));
    document.body.dataset.invUnchanged = String(core.findObject('q1').obj.prompt === promptBefore);
  } else if (seed === 'ai-ops-version-sync') {
    // US-P4-3: 버전 왕복(◀▶)에서 "적용 가능 여부"와 "사유"가 어긋나면 안 된다 — 무효 버전으로
    // 돌아왔는데 사유가 사라지거나, 정상 버전에 남의 무효 문구가 남으면 교사가 오도된다.
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.vsV1Disabled = String(document.getElementById('ai-apply-ops').disabled);
    document.body.dataset.vsV1Error = document.getElementById('ai-error')?.textContent || '';

    document.getElementById('ai-regenerate').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview'
      && document.getElementById('ai-version-label')?.textContent === '2 / 2', { timeoutMs: 30000 });
    document.body.dataset.vsV2Disabled = String(document.getElementById('ai-apply-ops').disabled);
    document.body.dataset.vsV2Error = document.getElementById('ai-error')?.textContent || '';

    document.getElementById('ai-version-prev').click();
    document.body.dataset.vsBackLabel = document.getElementById('ai-version-label').textContent;
    document.body.dataset.vsBackDisabled = String(document.getElementById('ai-apply-ops').disabled);
    document.body.dataset.vsBackError = document.getElementById('ai-error')?.textContent || '';

    document.getElementById('ai-version-next').click();
    document.body.dataset.vsFwdDisabled = String(document.getElementById('ai-apply-ops').disabled);
    document.body.dataset.vsFwdError = document.getElementById('ai-error')?.textContent || '';
  } else if (seed === 'ai-multipage-conflict') {
    // 후속(다중 페이지 충돌 검사): 요청이 여러 쪽에 걸치면 **걸친 모든 페이지**를 비교해야 한다.
    // 대표 한 장만 재던 구현에서는 "다른 쪽을 편집해도 충돌 없음"으로 통과해 교사 편집이 조용히 덮였다.
    doc.querySelector('[data-oid="q1"]').click();                                   // 1쪽
    doc.querySelector('[data-oid="q4"]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); // 2쪽
    document.body.dataset.mpSelectedCount = String(selection.state.selectedIds.size);

    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    document.body.dataset.mpRequestId = document.querySelector('.ai-waiting')?.dataset.aiRequestId || '';
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });

    // 대기 중 교사가 **2쪽**(대표 페이지가 아닌 쪽) 개체를 직접 편집한다.
    const q4El = doc.querySelector('[data-oid="q4"]');
    q4El.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const q4Target = q4El.querySelector('.q');
    q4Target.textContent = `${q4Target.textContent}(교사가 2쪽에서 수정)`;
    q4Target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    document.body.dataset.mpSecondPageEdited = String(core.findObject('q4').obj.prompt.includes('2쪽에서 수정'));

    const promptBefore = core.findObject('q1').obj.prompt;
    document.getElementById('ai-apply-ops').click();
    await wait(150);
    const box = document.getElementById('ai-conflict');
    document.body.dataset.mpConflictDetected = String(!!box);
    document.body.dataset.mpConflictKind = box?.dataset.aiConflict || '';
    document.body.dataset.mpConflictMessage = box?.querySelector('.ai-conflict-message')?.textContent || '';
    document.body.dataset.mpNotApplied = String(core.findObject('q1').obj.prompt === promptBefore);
  } else if (seed === 'ai-ops-out-of-scope') {
    // 후속(범위 밖 ops): 요청이 근거로 삼지 않은 페이지의 개체를 AI 가 건드리려 하면 거부한다 —
    // 그 페이지는 pageVersion 보호 밖이라 덮어쓰기 검사도 못 받고, 개수 표기도 실제와 어긋난다.
    doc.querySelector('[data-oid="q4"]').click(); // 2쪽 개체만 대상
    document.getElementById('btn-ai').click();
    document.body.dataset.oosTargetCount = document.getElementById('ai-targets-summary').dataset.aiTargetCount;
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });

    document.body.dataset.oosApplyDisabled = String(document.getElementById('ai-apply-ops').disabled);
    document.body.dataset.oosError = document.getElementById('ai-error')?.textContent || '';
    const q1Before = core.findObject('q1').obj.prompt;
    document.getElementById('ai-apply-ops').click();
    await wait(120);
    document.body.dataset.oosQ1Untouched = String(!!core.findObject('q1') && core.findObject('q1').obj.prompt === q1Before);
  } else if (seed === 'ai-page-scope') {
    // US-P4-4: 선택 0개에서 AI 를 부르면 현재 활성 페이지 전체가 대상(scope:'page')이 되고,
    // std-box(성취기준)는 페이지 전체라는 이유로도 대상에 들어가지 않는다(원칙 3).
    doc.querySelector('.sheet').click();
    document.body.dataset.psSelectionCount = String(selection.state.selectedIds.size);
    document.body.dataset.psEntryEnabled = String(!document.getElementById('btn-ai').disabled);

    document.getElementById('btn-ai').click();
    let panel = document.getElementById('ai-panel');
    document.body.dataset.psPhase = panel?.dataset.aiPhase || '(none)';
    document.body.dataset.psScope = panel?.dataset.aiScope || '';
    document.body.dataset.psPageId = panel?.dataset.aiPageId || '';
    document.body.dataset.psFirstPageId = core.getDocument().pages[0].id;
    const pageOfPanel = core.getDocument().pages.find((p) => p.id === panel?.dataset.aiPageId);
    document.body.dataset.psPageFlowCount = String((pageOfPanel?.flow || []).length);
    document.body.dataset.psTargetCount = document.getElementById('ai-targets-summary').dataset.aiTargetCount;
    document.body.dataset.psSummaryText = document.getElementById('ai-targets-summary').textContent;
    document.body.dataset.psScopeToggleDisabled = String(document.getElementById('ai-scope-page').disabled);
    document.getElementById('ai-panel-close').click();
    await wait(30);

    // 선택이 있어도 "현재 페이지 전체"를 명시적으로 고를 수 있다(UI 토글).
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai').click();
    panel = document.getElementById('ai-panel');
    document.body.dataset.psScopeWithSelection = panel.dataset.aiScope;
    document.body.dataset.psTargetCountWithSelection = document.getElementById('ai-targets-summary').dataset.aiTargetCount;
    document.getElementById('ai-scope-page').click();
    document.body.dataset.psScopeAfterToggle = document.getElementById('ai-panel').dataset.aiScope;
    document.body.dataset.psTargetCountAfterToggle = document.getElementById('ai-targets-summary').dataset.aiTargetCount;
    document.getElementById('ai-scope-page').click();
    document.body.dataset.psScopeAfterUntoggle = document.getElementById('ai-panel').dataset.aiScope;
    document.body.dataset.psTargetCountAfterUntoggle = document.getElementById('ai-targets-summary').dataset.aiTargetCount;

    // 다시 페이지 전체로 두고 요청을 보낸다 — 요청 본문(pageId·pageVersion·scope)은 테스트가 큐에서 읽는다.
    document.getElementById('ai-scope-page').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    document.body.dataset.psRequestId = document.querySelector('.ai-waiting')?.dataset.aiRequestId || '';
    document.body.dataset.psCopyHasPageScope = String((document.getElementById('ai-copy-text').value || '').includes('현재 페이지 전체'));
  } else if (seed === 'ai-conflict') {
    // US-P4-5: 요청 후 적용 전에 그 페이지를 편집하면 자동 적용하지 않는다(fail-closed) —
    // 교사에게 알리고 "그래도 적용 / 폐기"를 준다.
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });

    // 그 사이 교사가 같은 페이지의 다른 개체를 편집한다.
    const t1El = doc.querySelector('[data-oid="t1"]');
    t1El.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const titleTarget = t1El.querySelector('.title-box h1, .title-box h2');
    titleTarget.textContent = '교사가 그 사이 고친 제목';
    titleTarget.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();

    const promptBefore = core.findObject('q1').obj.prompt;
    document.getElementById('ai-apply-ops').click();
    await wait(150);
    const box = document.getElementById('ai-conflict');
    document.body.dataset.cfDetected = String(!!box);
    document.body.dataset.cfKind = box?.dataset.aiConflict || '';
    document.body.dataset.cfPanelStillOpen = String(!!document.getElementById('ai-panel'));
    document.body.dataset.cfNotApplied = String(core.findObject('q1').obj.prompt === promptBefore);
    document.body.dataset.cfHasForce = String(!!document.getElementById('ai-conflict-force'));
    document.body.dataset.cfHasDiscard = String(!!document.getElementById('ai-conflict-discard'));

    document.getElementById('ai-conflict-force').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    await wait(80);
    document.body.dataset.cfForcedApplied = String(core.findObject('q1').obj.prompt !== promptBefore);
    document.body.dataset.cfTeacherEditKept = String(core.findObject('t1').obj.text === '교사가 그 사이 고친 제목');
  } else if (seed === 'ai-page-missing') {
    // US-P4-5: 대상 페이지가 그 사이 삭제됐으면 적용을 거부한다(강행 경로 없음).
    const secondPageId = core.getDocument().pages[1].id;
    doc.querySelector('[data-oid="q4"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });

    await handlePageAction('delete', secondPageId);
    await wait(80);
    const countAfterDelete = core.allObjects().length;
    document.getElementById('ai-apply-ops').click();
    await wait(150);
    const box = document.getElementById('ai-conflict');
    document.body.dataset.pmiDetected = String(!!box);
    document.body.dataset.pmiKind = box?.dataset.aiConflict || '';
    document.body.dataset.pmiNoForce = String(!document.getElementById('ai-conflict-force'));
    document.body.dataset.pmiPanelStillOpen = String(!!document.getElementById('ai-panel'));
    document.body.dataset.pmiCountUnchanged = String(core.allObjects().length === countAfterDelete);
    document.body.dataset.pmiMessage = box?.querySelector('.ai-conflict-message')?.textContent || '';
  } else if (seed === 'image-workflow') {
    // US-20(S4.5) — F1 이미지 업로드 재작성: 업로드→개체 src 반영→GET 200 + 이미지가 실린
    // richtext 개체를 정답 마킹→저장 시 학생용 물리 제거(개체 단위 정답 규칙, image-slot 자체는
    // ANSWERABLE_TYPES 밖이라 부분요소 마킹 대신 이 경로로 동형 검증 — us20.md 기능 공백 참조).
    const imgEl = doc.querySelector('[data-oid="img1"]');
    imgEl.click();
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const bin = atob(PNG_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], '시드샷.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const uploadInput = document.getElementById('insp-image-upload');
    uploadInput.files = dt.files;
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 60 && !core.findObject('img1').obj.src; i++) await wait(150);
    const assetPath = core.findObject('img1').obj.src || '';
    document.body.dataset.assetPath = assetPath;
    const assetRes = await fetch(`/${assetPath}`);
    document.body.dataset.assetGet = String(assetRes.status);

    // US-P3-5: 이미지 캡션 — ① 캡션이 없으면 더블클릭해도 편집으로 들어가지 않고 선택만 남는다
    // (editMode 전용 빈 figcaption 을 그리지 않기 때문 — R2-1 편집==인쇄 하드 동치 보존).
    doc = frames.teacher.contentDocument;
    let imgNow = doc.querySelector('[data-oid="img1"]');
    document.body.dataset.imgCapAbsent = String(!imgNow.querySelector('figcaption'));
    imgNow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait(50);
    document.body.dataset.imgNoCaptionNoEdit = String(
      selection.state.editingId === null && selection.state.selectedIds.has('img1'),
    );

    // ② 인스펙터에서 캡션을 달면 figcaption 이 생기고, 그때부터 캔버스 더블클릭으로 편집된다.
    imgNow.click();
    await wait(50);
    const capInput = document.getElementById('insp-image-caption');
    document.body.dataset.imgCaptionFieldExists = String(!!capInput);
    capInput.value = '그림 1. 광합성 장치';
    capInput.dispatchEvent(new Event('change', { bubbles: true }));
    await pollUntil(() => core.findObject('img1')?.obj?.caption === '그림 1. 광합성 장치', { timeoutMs: 10000 }).catch(() => {});
    doc = frames.teacher.contentDocument;
    imgNow = doc.querySelector('[data-oid="img1"]');
    const capEl = imgNow.querySelector('figcaption');
    document.body.dataset.imgCaptionRendered = String(!!capEl && capEl.textContent.includes('광합성 장치'));

    imgNow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await wait(50);
    document.body.dataset.imgCaptionEditEnter = String(selection.state.editingId === 'img1');
    const capTarget = imgNow.querySelector('figcaption');
    if (capTarget) {
      capTarget.textContent = '그림 1. 수정된 캡션';
      capTarget.dispatchEvent(new Event('input', { bubbles: true }));
    }
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(50);
    document.body.dataset.imgCaptionEdited = String(core.findObject('img1')?.obj?.caption === '그림 1. 수정된 캡션');

    doc = frames.teacher.contentDocument;
    const ansEl = doc.querySelector('[data-oid="rt-ans"]');
    ansEl.click();
    document.getElementById('tb-answer-toggle').click();
    document.body.dataset.ansMarked = String(core.findObject('rt-ans').obj.answer === true);

    const saved = await save();
    document.body.dataset.savedOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'undo-answer-toggle') {
    // US-20 — G002 재작성 ①: 정답 마킹이 되돌리기/다시하기 대상에 들어온다(개체 단위 answer:true).
    const r1 = doc.querySelector('[data-oid="r1"]');
    r1.click();
    document.body.dataset.undoMarksBase = core.findObject('r1').obj.answer === true ? '1' : '0';
    document.getElementById('tb-answer-toggle').click();
    await wait(120); // applyDocOp 는 비동기(iframe 재로드 후 커밋) — history.commit() 완료 대기
    document.body.dataset.undoMarksAfter = core.findObject('r1').obj.answer === true ? '1' : '0';
    history.undo();
    document.body.dataset.undoMarksUndone = core.findObject('r1').obj.answer === true ? '1' : '0';
    history.redo();
    document.body.dataset.undoMarksRedone = core.findObject('r1').obj.answer === true ? '1' : '0';
  } else if (seed === 'undo-lines') {
    // US-20 — G002 재작성 ②: 답란 줄 수 변경(구 "답란 5줄 삽입"의 개체 모델 동형)이 되돌리기 대상.
    const aaEl = doc.querySelector('[data-oid="aa1"]');
    aaEl.click();
    document.body.dataset.undoLinesBase = String(core.findObject('aa1').obj.lines);
    const linesInput = document.getElementById('insp-aa-lines');
    linesInput.value = '8';
    linesInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    document.body.dataset.undoLinesAfter = String(core.findObject('aa1').obj.lines);
    history.undo();
    document.body.dataset.undoLinesUndone = String(core.findObject('aa1').obj.lines);
  } else if (seed === 'undo-interleave') {
    // US-20 — G002 재작성 ③: 타이핑과 명령이 교차해도 친 역순으로 풀린다. 타이핑은 유휴
    // 500ms(TYPING_IDLE_MS) 후 자동 커밋되므로, 그 뒤에 명령(정답 토글)을 실행해야 두 단계로
    // 분리된다(즉시 이어치면 한 커밋으로 합쳐진다 — history.js 주석 참조, 의도된 동작).
    let r2 = doc.querySelector('[data-oid="r2"]');
    r2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    r2.innerHTML = '<p>원문(수정)</p>';
    r2.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650); // 유휴 커밋 대기(타이핑 = 1단계)
    doc = frames.teacher.contentDocument;
    r2 = doc.querySelector('[data-oid="r2"]');
    r2.click();
    document.getElementById('tb-answer-toggle').click(); // 명령 = 2단계(별도 커밋)
    await wait(120); // applyDocOp 는 비동기(iframe 재로드 후 커밋) — history.commit() 완료 대기
    document.body.dataset.ilTypedAndMarked = String(
      core.findObject('r2').obj.html.includes('수정') && core.findObject('r2').obj.answer === true,
    );
    history.undo(); // 1차: 명령(정답 마킹)만 취소
    document.body.dataset.ilAfterFirstTyped = String(core.findObject('r2').obj.html.includes('수정'));
    document.body.dataset.ilAfterFirstAnswer = String(core.findObject('r2').obj.answer === true);
    history.undo(); // 2차: 타이핑까지 취소
    document.body.dataset.ilAfterSecondTyped = String(core.findObject('r2').obj.html.includes('수정'));
  } else if (seed === 'answer-mark-save') {
    // US-20 — E3(§6②) 재작성: 정답 마킹→저장 시 학생용 물리 제거(파일 왕복은 테스트가 직접 확인).
    const r1 = doc.querySelector('[data-oid="r1"]');
    r1.click();
    document.getElementById('tb-answer-toggle').click();
    document.body.dataset.markedAnswer = String(core.findObject('r1').obj.answer === true);
    const saved = await save();
    document.body.dataset.savedUnsafe = String(saved?.unsafe);
  } else if (seed === 'lines-save') {
    // US-20 — E3(§6③) 재작성: 답란 줄 수 변경→저장→manifest 반영(개체 모델 동형).
    const aaEl = doc.querySelector('[data-oid="aa1"]');
    aaEl.click();
    const linesInput = document.getElementById('insp-aa-lines');
    linesInput.value = '8';
    linesInput.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(80);
    document.body.dataset.linesAfter = String(core.findObject('aa1').obj.lines);
    const saved = await save();
    document.body.dataset.savedOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'min-font-check') {
    // US-20 — E3(§6④) 재작성: 저장 시 라이브 검수(runReview)가 최소 글자 크기 경고를 반영한다.
    // 신 UI 는 타이핑마다 재검수를 배선하지 않는다(us20.md 기능 공백) — 저장 시점에 반영된다.
    await save();
    document.body.dataset.reviewStatusVal = document.getElementById('btn-review').dataset.reviewStatus;
    document.body.dataset.reviewCountVal = document.getElementById('btn-review').dataset.reviewCount;
  } else if (seed === 'passage-edit-save') {
    // 저작권 지문 2층 정책(2026-07-23): AI 는 여전히 채우지 못하지만(aiBridge 타입 가드 무변경),
    // 교사는 편집기에서 passage-slot 본문을 더블클릭해 직접 입력할 수 있다 — slotLabel 플레이스홀더
    // (.slot)에서 시작해 더블클릭 편집→입력→저장까지 왕복한다(selection.js EDIT_FIELD 등재 검증).
    let pasEl = doc.querySelector('[data-oid="pas1"]');
    document.body.dataset.passageHasSlotBefore = String(!!pasEl.querySelector('.slot'));
    pasEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    document.body.dataset.passageEditingId = selection.state.editingId ?? '(none)';
    const passageTarget = pasEl.querySelector('.slot');
    document.body.dataset.passageClearedOnEnter = String(passageTarget.textContent === '');
    passageTarget.textContent = '이것은 교사가 직접 입력한 지문 본문입니다.';
    passageTarget.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.dataset.passageBodySynced = core.findObject('pas1').obj.bodyHtml;
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();

    // 렌더는 bodyHtml 유무로 .passage-body/.slot 을 분기한다(RenderObjectTree) — 편집 직후의 살아있는
    // DOM 은 아직 옛 .slot 골격 그대로다(contenteditable 은 DOM 을 직접 바꿀 뿐 재렌더는 아니다).
    // runReflow() 는 페이지 귀속이 실제로 바뀔 때만 프레임을 다시 그리므로(변경 없으면 no-op), 여기서는
    // reloadTeacherFrame 을 직접 불러 RenderObjectTree 의 분기 결과를 강제로 실측한다.
    await reloadTeacherFrame(core.getDocument());
    doc = frames.teacher.contentDocument;
    pasEl = doc.querySelector('[data-oid="pas1"]');
    document.body.dataset.passageHasBodyAfterReflow = String(!!pasEl.querySelector('.passage-body'));
    document.body.dataset.passageHasSlotAfterReflow = String(!!pasEl.querySelector('.slot'));

    document.body.dataset.passageRevBeforeSave = String(getCurrentRevision() ?? '');
    const savedPassage = await save();
    document.body.dataset.passageRevAfterSave = String(getCurrentRevision() ?? '');
    document.body.dataset.passageSaveOk = String(savedPassage != null && savedPassage.unsafe === false);
  } else if (seed === 'export-ui') {
    // US-20 — E6 재작성: 앱 바 버튼·문서설정 용지 프리셋 선택기·[A5] 비-dirty save-first 무왕복.
    document.body.dataset.e6Buttons = String(!!document.getElementById('btn-preview') && !!document.getElementById('btn-export'));
    const presetSel = document.getElementById('insp-paper-preset');
    document.body.dataset.paperOptions = String(presetSel.options.length);
    document.body.dataset.paperPresetValue = presetSel.value;
    let saveCalls = 0;
    const origFetch = window.fetch;
    window.fetch = (...args) => { if (String(args[0]).includes('/save')) saveCalls++; return origFetch(...args); };
    presetSel.dispatchEvent(new Event('change', { bubbles: true })); // 같은 값 재선택 = no-op
    await wait(250);
    window.fetch = origFetch;
    document.body.dataset.saveFirstNoop = String(saveCalls === 0);
  } else if (seed === 'preset-workflow') {
    // US-20 — E4 재작성: 우클릭 "내 블록으로 저장" → /presets 등재(정제 포함) → 내 블록 탭
    // 삽입 → 저장 시 manifest 반영.
    const r1 = doc.querySelector('[data-oid="r1"]');
    r1.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 }));
    await wait(30);
    const menuBtns = [...document.querySelectorAll('#popups-host .ctx-menu button')];
    const saveBtn = menuBtns.find((b) => b.textContent.includes('내 블록으로 저장'));
    saveBtn.click();
    let list = { presets: [] };
    for (let i = 0; i < 40 && (list.presets || []).length < 1; i++) {
      await wait(150);
      list = await (await fetch('/presets')).json();
    }
    document.body.dataset.presetSaved = String((list.presets || []).length >= 1);
    const savedPreset = (list.presets || [])[0];
    document.body.dataset.presetClean = String(
      !!savedPreset && !savedPreset.html.includes('contenteditable') && !savedPreset.html.includes('data-oid'),
    );

    document.querySelector('[data-tab="myblocks"]').click();
    await pollUntil(() => Number(document.getElementById('left-panel').dataset.presetCount || '0') >= 1, { timeoutMs: 8000 }).catch(() => {});
    const beforeInsertCount = core.allObjects().length;
    document.querySelector('#preset-list .preset-btn')?.click();
    await pollUntil(() => core.allObjects().length > beforeInsertCount, { timeoutMs: 8000 }).catch(() => {});
    document.body.dataset.presetInserted = String(core.allObjects().length > beforeInsertCount);

    const saved = await save();
    document.body.dataset.presetSaveDocOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'shapes-workflow') {
    // US-20 — US-E3 재작성: 도형(float) 서식 변경이 렌더에 반영·되돌리기 단계 분리·드래그 1:1·저장 왕복.
    let shEl = doc.querySelector('[data-oid="sh1"]');
    shEl.click();
    document.body.dataset.shapeKind = core.findObject('sh1').obj.shapeKind;
    document.body.dataset.shapeWidthPx = String(Math.round(shEl.getBoundingClientRect().width));

    const strokeInput = document.getElementById('tb-shape-stroke');
    strokeInput.value = '#1a7f37';
    strokeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    doc = frames.teacher.contentDocument;
    shEl = doc.querySelector('[data-oid="sh1"]');
    document.body.dataset.shapeStrokeAfter = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).stroke;

    const fillInput = document.getElementById('tb-shape-fill');
    fillInput.value = '#fde68a';
    fillInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    doc = frames.teacher.contentDocument;
    shEl = doc.querySelector('[data-oid="sh1"]');
    document.body.dataset.shapeFillAfter = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).fill;

    history.undo(); // 채우기 변경만 취소(선 색 변경은 유지 — 단계 분리)
    doc = frames.teacher.contentDocument;
    shEl = doc.querySelector('[data-oid="sh1"]');
    document.body.dataset.shapeUndoFill = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).fill;
    document.body.dataset.shapeUndoStrokeKept = doc.defaultView.getComputedStyle(shEl.querySelector('svg')).stroke;

    const rectBefore = { ...core.findObject('sh1').obj.rect };
    const pe = (type, sx, sy) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 9, screenX: sx, screenY: sy, clientX: sx, clientY: sy,
    });
    shEl.click();
    shEl.dispatchEvent(pe('pointerdown', 400, 400));
    shEl.dispatchEvent(pe('pointermove', 438, 424));
    shEl.dispatchEvent(pe('pointerup', 438, 424));
    const rectAfter = core.findObject('sh1').obj.rect;
    const MM_TO_PX = 96 / 25.4;
    document.body.dataset.shapeDragExpectMm = String(Math.round((38 / MM_TO_PX) * 10) / 10);
    document.body.dataset.shapeDragDeltaMm = String(Math.round((rectAfter.xMm - rectBefore.xMm) * 10) / 10);

    const saved = await save();
    document.body.dataset.shapeSaved = String(saved != null && saved.unsafe === false);
  } else if (seed === 'table-ops') {
    // US-20 — 표 구조 편집 재작성: 헤더 중복 없음(add-row 는 header:true 를 붙이지 않음)·
    // 열 추가 시 모든 행 열 수 균일·행 삭제는 최소 1행에서 멈춘다(구버전 "데이터 1행 보존" 정책은
    // 새 모델에 없음 — us20.md 기능 공백).
    document.getElementById('tb-add-row'); // (표 이미 선택된 상태로 fixture 진입)
    const tblEl = doc.querySelector('[data-oid="tbl1"]');
    tblEl.click();
    document.body.dataset.rowsInitial = String(core.findObject('tbl1').obj.rows.length);
    document.body.dataset.headerRowsInitial = String(core.findObject('tbl1').obj.rows.filter((r) => r.every((c) => c.header)).length);

    document.getElementById('tb-add-row').click();
    await wait(80);
    document.body.dataset.rowsAfterAdd = String(core.findObject('tbl1').obj.rows.length);
    document.body.dataset.headerRowsAfterAdd = String(core.findObject('tbl1').obj.rows.filter((r) => r.every((c) => c.header)).length);

    document.getElementById('tb-add-col').click();
    await wait(80);
    const rowsAfterCol = core.findObject('tbl1').obj.rows;
    document.body.dataset.colsAfterAdd = String(rowsAfterCol[0].length);
    document.body.dataset.colsUniform = String(rowsAfterCol.every((r) => r.length === rowsAfterCol[0].length));

    document.getElementById('tb-del-row').click();
    await wait(80);
    document.body.dataset.rowsAfterFirstDel = String(core.findObject('tbl1').obj.rows.length);
    document.getElementById('tb-del-row').click();
    await wait(80);
    document.body.dataset.rowsAfterSecondDel = String(core.findObject('tbl1').obj.rows.length);
    document.getElementById('tb-del-row').click(); // rows.length===1 이면 이제 무시되어야 함
    await wait(80);
    document.body.dataset.rowsFloor = String(core.findObject('tbl1').obj.rows.length);

    const saved = await save();
    document.body.dataset.tableSaveOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'float-richtext') {
    // US-20 — 자유 배치 텍스트 재작성: 신 UI 는 전용 textbox 타입이 아니라 richtext(placement:float)
    // 로 자유배치 텍스트를 표현한다(us20.md 기능 공백: 빈 상자 자동삭제·AI 텍스트 전용 변환은 없음 —
    // 대신 범용 flow⇄float 토글로 어떤 개체든 전환 가능하다).
    document.querySelector('[data-tab="insert"]').click();
    document.getElementById('insert-float-toggle').checked = true;
    document.querySelector('#insert-grid [data-insert-key="richtext"]').click();
    await wait(150);
    cancelScheduledReflow();
    doc = frames.teacher.contentDocument;
    const newId = [...selection.state.selectedIds][0];
    document.body.dataset.newObjType = core.findObject(newId).obj.type;
    document.body.dataset.newObjPlacement = core.findObject(newId).obj.placement;
    document.body.dataset.inspKind = document.getElementById('right-panel').querySelector('[data-insp-type]')?.dataset.inspType || '';

    let el = doc.querySelector(`[data-oid="${newId}"]`);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    el.innerHTML = '<p>자유 배치 텍스트</p>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650);
    document.body.dataset.editedText = String(core.findObject(newId).obj.html.includes('자유 배치 텍스트'));

    doc = frames.teacher.contentDocument;
    el = doc.querySelector(`[data-oid="${newId}"]`);
    el.click();
    const rectBefore = { ...core.findObject(newId).obj.rect };
    const pe = (type, sx, sy) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 11, screenX: sx, screenY: sy, clientX: sx, clientY: sy,
    });
    el.dispatchEvent(pe('pointerdown', 300, 300));
    el.dispatchEvent(pe('pointermove', 320, 315));
    el.dispatchEvent(pe('pointerup', 320, 315));
    const rectAfter = core.findObject(newId).obj.rect;
    document.body.dataset.movable = String(rectAfter.xMm !== rectBefore.xMm || rectAfter.yMm !== rectBefore.yMm);

    doc = frames.teacher.contentDocument;
    doc.querySelector('.sheet').click(); // 드래그 직후 click 1회 삼키기 소진(스파이크 §4-5 패턴)
    const r3 = doc.querySelector('[data-oid="r3"]');
    r3.click();
    document.body.dataset.r3PlacementBefore = core.findObject('r3').obj.placement;
    document.getElementById('tb-flowfloat').click();
    await wait(80);
    document.body.dataset.r3PlacementAfter = core.findObject('r3').obj.placement;

    const saved = await save();
    document.body.dataset.floatSaveOk = String(saved != null && saved.unsafe === false);
    document.body.dataset.savedExists = String(!!core.findObject(newId));
  } else if (seed === 'organizer-insert') {
    // #2 P1a — 표형 시각 조직자 삽입: 좌측 "시각 조직자" 그리드 버튼 클릭 → 미리 채운 table 개체 삽입.
    // 삽입되는 건 새 개체 타입이 아니라 table(스키마 무변경)이며 flow 전용·정답 없음(빈 구조).
    document.querySelector('[data-tab="insert"]').click();
    document.body.dataset.organizerBtnCount = String(document.querySelectorAll('#organizer-grid [data-organizer-key]').length);
    document.querySelector('#organizer-grid [data-organizer-key="frayer"]').click();
    await wait(150);
    cancelScheduledReflow();
    doc = frames.teacher.contentDocument;
    const newId = [...selection.state.selectedIds][0];
    const ins = core.findObject(newId).obj;
    document.body.dataset.insType = ins.type;
    document.body.dataset.insPlacement = ins.placement;
    document.body.dataset.insConceptColspan = String(ins.rows?.[0]?.[0]?.colspan ?? 0);
    document.body.dataset.insRows = String(Array.isArray(ins.rows) ? ins.rows.length : 0);
    document.body.dataset.insHasAnswer = String(ins.answer === true);
    const el = doc.querySelector(`[data-oid="${newId}"]`);
    const rendered = el ? el.innerHTML : '';
    document.body.dataset.insRendersTable = String(!!el && /<table/i.test(rendered));
    document.body.dataset.insHasHeaders = String(/정의/.test(rendered) && /예가 아닌 것/.test(rendered));
    document.body.dataset.insHasColgroup = String(/<colgroup>/.test(rendered)); // 등폭/의도폭 열(colgroup)
    document.body.dataset.insHasCellHeight = String(/height:\d+mm/.test(rendered)); // 필기 높이(h→mm)
    // 그림형(P2) — 벤다이어그램 잠금 삽입(richtext 인라인 SVG). 아래 save() 가 SVG 보존까지 함께 검증한다.
    document.querySelector('#organizer-grid [data-organizer-key="venn"]').click();
    await wait(150);
    cancelScheduledReflow();
    doc = frames.teacher.contentDocument;
    const gId = [...selection.state.selectedIds][0];
    document.body.dataset.ginsType = core.findObject(gId).obj.type;
    const gEl = doc.querySelector(`[data-oid="${gId}"]`);
    document.body.dataset.ginsRendersSvg = String(!!gEl && /<svg/i.test(gEl.innerHTML));
    // 특수 레이아웃(P2b) — 신호등(색이 의미) 잠금 삽입(richtext 블록 HTML). 색·구조 보존 확인.
    document.querySelector('#organizer-grid [data-organizer-key="stoplight"]').click();
    await wait(150);
    cancelScheduledReflow();
    doc = frames.teacher.contentDocument;
    const sId = [...selection.state.selectedIds][0];
    document.body.dataset.sinsType = core.findObject(sId).obj.type;
    const sEl = doc.querySelector(`[data-oid="${sId}"]`);
    document.body.dataset.sinsRendersStoplight = String(!!sEl && /class="[^"]*\bstoplight\b/.test(sEl.innerHTML));
    const saved = await save();
    document.body.dataset.organizerSaveOk = String(saved != null && saved.unsafe === false);
  } else if (seed === 'view-toggle') {
    // US-20 — 눈금자/격자/여백선 재작성: 신 UI 는 CSS 클래스 토글(전역 보기 메뉴)만 제공한다
    // (us20.md 기능 공백: 픽셀 단위 눈금 개수·드래그 중 중앙 스냅 안내선은 없음).
    const classesOf = () => [...frames.teacher.contentDocument.body.classList].join(',');
    document.body.dataset.marginsOnInitial = String(classesOf().includes('wg-show-margins'));
    document.body.dataset.rulerOnInitial = String(classesOf().includes('wg-show-ruler'));
    document.body.dataset.gridOnInitial = String(classesOf().includes('wg-show-grid'));

    document.getElementById('tb-view-menu').click();
    document.querySelector('#tb-view-dropdown input[data-view-key="grid"]').click();
    document.querySelector('#tb-view-dropdown input[data-view-key="margins"]').click();
    await wait(30);
    document.body.dataset.gridOnAfter = String(classesOf().includes('wg-show-grid'));
    document.body.dataset.marginsOnAfter = String(classesOf().includes('wg-show-margins'));
    document.body.dataset.rulerStillOn = String(classesOf().includes('wg-show-ruler'));

    const floatEl = doc.querySelector('.wg-float[data-oid]');
    floatEl.click();
    document.body.dataset.floatHandlePresent = String(!!doc.querySelector('.wg-float.wg-selected .wg-float-handle'));
  } else if (seed === 'migration-edit') {
    // US-20 — 마이그레이션 UX 종단: 지연 마이그레이션으로 승격된 개체(mig-0-0)를 실제로 편집한다.
    document.body.dataset.migratedFlag = String(shell.migrated);
    const titleEl = doc.querySelector('[data-oid="mig-0-0"]');
    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const target = titleEl.querySelector('.title-box h1, .title-box h2');
    target.textContent = '편집된 제목(마이그레이션 후)';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650);
    const saved = await save();
    document.body.dataset.savedOk = String(saved != null && saved.unsafe === false);
    document.body.dataset.savedPagination = core.getDocument().pagination;
  } else if (seed === 'student-fresh') {
    // US-E1: 교사 편집(제목) → '학생용' 전환 시 학생 프레임이 최신 편집을 반영하고, 편집 크롬 없이
    // (비 editMode = data-oid 래퍼 부재) answer 개체가 물리 제거된 학생 변형으로 렌더되는지 확인.
    const titleEl = doc.querySelector('[data-oid="t1"]');
    titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const target = titleEl.querySelector('.title-box h1, .title-box h2');
    target.textContent = '학생 미리보기 최신화 확인 제목';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(650); // 타이핑 유휴 커밋(TYPING_IDLE_MS)

    document.body.dataset.studentStaleBeforeSwitch = String(getStudentStale());
    await setMode('student');
    await pollUntil(() => {
      const sf = frames.student?.contentDocument;
      return !!sf && sf.body && sf.body.textContent.includes('학생 미리보기 최신화 확인 제목');
    }, { timeoutMs: 20000 }).catch(() => {});
    const sdoc = frames.student?.contentDocument;
    document.body.dataset.studentHasEdit = String(!!sdoc && sdoc.body.textContent.includes('학생 미리보기 최신화 확인 제목'));
    // 학생용은 편집 모드가 아니다 — data-oid 편집 래퍼가 없어야 한다.
    document.body.dataset.studentNoEditWrappers = String(!!sdoc && sdoc.querySelectorAll('[data-oid]').length === 0);
    // answer:true 개체(rt-ans)의 정답 텍스트는 학생용에 물리적으로 없어야 한다(BuildVariants student).
    document.body.dataset.studentAnswerHidden = String(!!sdoc && !sdoc.body.textContent.includes('정답전용텍스트'));
    document.body.dataset.studentStaleAfterSwitch = String(getStudentStale());
  } else if (seed === 'nudge') {
    // US-E2: 자유 개체 선택 후 방향키 넛지(1mm)·Shift 큰 이동(10mm)·다른 축 불변·undo 원복.
    const f1 = doc.querySelector('[data-oid="f1"]');
    f1.click(); // float 선택(합성 클릭은 pointer-events 와 무관하게 대상에 발화)
    document.body.dataset.nudgeSelected = String(selection.state.selectedIds.has('f1'));
    const rect0 = { ...core.findObject('f1').obj.rect };

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const rectR = { ...core.findObject('f1').obj.rect };
    document.body.dataset.nudgeRightDx = String(Math.round((rectR.xMm - rect0.xMm) * 10) / 10);
    document.body.dataset.nudgeRightYUnchanged = String(rectR.yMm === rect0.yMm);

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, shiftKey: true }));
    const rectD = { ...core.findObject('f1').obj.rect };
    document.body.dataset.nudgeShiftDownDy = String(Math.round((rectD.yMm - rectR.yMm) * 10) / 10);

    history.undo();
    history.undo();
    const rectU = core.findObject('f1').obj.rect;
    document.body.dataset.nudgeUndone = String(rectU.xMm === rect0.xMm && rectU.yMm === rect0.yMm);

    // flow 개체는 방향키에 반응하지 않는다(넛지는 float 전용).
    doc.querySelector('.sheet').click();
    const q1 = doc.querySelector('[data-oid="q1"]');
    q1.click();
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    document.body.dataset.nudgeFlowNoRect = String(core.findObject('q1').obj.rect === undefined);
  } else if (seed === 'copy-paste') {
    // US-E3: 개체 복사(Ctrl+C) → 다른 개체 선택 → 붙여넣기(Ctrl+V): 개체 수 +1, 새 id≠원본,
    // 필드 복제, 원본 보존, 새 개체 자동 선택, undo 로 원복. 붙여넣기 앵커는 현재 선택(t1) 뒤.
    const q1 = doc.querySelector('[data-oid="q1"]');
    q1.click();
    const beforeCount = core.allObjects().length;
    const q1Prompt = core.findObject('q1').obj.prompt;

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    document.body.dataset.cpClipboardCount = String(getClipboardCount());

    const t1 = doc.querySelector('[data-oid="t1"]');
    t1.click();
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    // applyDocOp 은 비동기(core.setDocument → await reloadTeacherFrame → selection.select 순) — 개체
    // 수 증가만이 아니라 선택 확정까지 기다린다(카운트만 보면 selection.select 이전에 읽는 경합).
    await pollUntil(() => {
      const sel = [...selection.state.selectedIds];
      return core.allObjects().length === beforeCount + 1
        && sel.length === 1 && sel[0] !== 't1' && core.findObject(sel[0])?.obj?.type === 'question';
    }, { timeoutMs: 15000 }).catch(() => {});
    document.body.dataset.cpCountIncreased = String(core.allObjects().length === beforeCount + 1);

    const newId = [...selection.state.selectedIds][0];
    const newObj = newId ? core.findObject(newId)?.obj : null;
    document.body.dataset.cpNewSelected = String(!!newId && newId !== 'q1');
    document.body.dataset.cpNewIsQuestion = String(newObj?.type === 'question');
    document.body.dataset.cpNewPromptMatches = String(newObj?.prompt === q1Prompt);
    document.body.dataset.cpOriginalPreserved = String(!!core.findObject('q1') && core.findObject('q1').obj.prompt === q1Prompt);
    // 붙여넣은 개체는 앵커(t1, index 0) 바로 뒤에 온다.
    const flow0 = core.getDocument().pages[0].flow.map((o) => o.id);
    document.body.dataset.cpPastedAfterAnchor = String(flow0[0] === 't1' && flow0[1] === newId);

    history.undo();
    await wait(60);
    document.body.dataset.cpUndone = String(core.allObjects().length === beforeCount);
  } else if (seed === 'affordance') {
    // US-E4: 교사 친화 표현(배치 전환 버튼에 원시 용어 없음) + 색상 라벨 + 편집 발견성 힌트.
    const q1 = doc.querySelector('[data-oid="q1"]');
    q1.click();
    const flowfloatTitle = document.getElementById('tb-flowfloat')?.title || '';
    document.body.dataset.affFlowfloatNoRawTerm = String(!flowfloatTitle.includes('기본 개체') && !flowfloatTitle.includes('자유 개체'));
    // 편집 가능 개체(question) 선택 → 편집 힌트 존재.
    document.body.dataset.affEditHintOnEditable = String(!!document.getElementById('tb-edit-hint'));
    // 글자색 컨트롤에 식별용 title(라벨) 존재.
    const colorInput = document.getElementById('tb-color');
    document.body.dataset.affColorHasTitle = String(!!colorInput && colorInput.title.length > 0);
    // 인스펙터 헤더 배치 라벨에 원시 용어 없음(question=본문 배치).
    const inspHeader = document.querySelector('#right-panel h3')?.textContent || '';
    document.body.dataset.affInspNoRawTerm = String(!inspHeader.includes('기본 개체') && !inspHeader.includes('자유 개체'));
    document.body.dataset.affInspHasFriendly = String(inspHeader.includes('본문 배치'));

    // std-box(비편집) 선택 → 편집 힌트 없음.
    doc.querySelector('.sheet').click();
    const s1 = doc.querySelector('[data-oid="s1"]');
    s1.click();
    document.body.dataset.affNoHintOnStdBox = String(!document.getElementById('tb-edit-hint'));
  } else if (seed === 'zoom') {
    // 이월 항목: 확대(>100%) 시 좌우·상하 잘림 수정 — 스케일된 콘텐츠 전체가 스크롤로 접근되는지 실측.
    const canvasWrap = document.getElementById('canvas-wrap');
    const zoomIn = document.getElementById('tb-zoom-in');
    for (let i = 0; i < 5; i++) zoomIn.click(); // 100 → 150%
    await wait(60);
    document.body.dataset.zoomLabel = document.getElementById('tb-zoom-label').textContent;
    const rect = stage.getBoundingClientRect();
    // 스크롤 영역이 스케일된 콘텐츠 전체를 담아야(좌우/상하 접근 가능) 잘리지 않는다.
    document.body.dataset.zoomScrollWidthOk = String(canvasWrap.scrollWidth + 2 >= Math.round(rect.width));
    document.body.dataset.zoomScrollHeightOk = String(canvasWrap.scrollHeight + 2 >= Math.round(rect.height));
    document.body.dataset.zoomOriginAt150Left = String(/left/.test(stage.style.transformOrigin)); // 브라우저는 'top left'를 'left top'으로 직렬화
    document.body.dataset.zoomMarginReserved = String(parseFloat(stage.style.marginRight) > 0 && parseFloat(stage.style.marginBottom) > 0);
    // 100% 복귀 시 여백 해제 + 가운데 정렬 origin 복귀.
    const zoomOut = document.getElementById('tb-zoom-out');
    for (let i = 0; i < 5; i++) zoomOut.click(); // 150 → 100%
    await wait(60);
    document.body.dataset.zoomLabelBack = document.getElementById('tb-zoom-label').textContent;
    document.body.dataset.zoomOriginBackCenter = String(/center/.test(stage.style.transformOrigin));
    document.body.dataset.zoomMarginCleared = String(!stage.style.marginRight && !stage.style.marginBottom);
  } else if (seed === 'format-text') {
    // 이월 항목: 문항/제목 인라인 서식(굵게) — 편집 중 선택 텍스트에 bold 적용 → promptHtml 저장,
    // 평문 prompt 유지, 렌더에 서식 반영, 저장 왕복, 하위호환(평문 편집은 htmlField 미생성).
    const win = doc.defaultView;
    const qEl = doc.querySelector('[data-oid="q1"]');
    qEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const qTarget = qEl.querySelector('.q');
    document.body.dataset.ftBoldEnabled = String(!document.getElementById('tb-bold')?.disabled);

    // .q 안 프롬프트 텍스트 노드(qnum 배지 제외) 일부를 선택한 뒤 굵게.
    const walker = doc.createTreeWalker(qTarget, NodeFilter.SHOW_TEXT);
    let textNode = null;
    while (walker.nextNode()) { if (!walker.currentNode.parentElement.closest('.qnum')) { textNode = walker.currentNode; break; } }
    const range = doc.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, Math.min(2, textNode.textContent.length));
    const sel = win.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    document.getElementById('tb-bold').click();
    await wait(30);
    const q1 = core.findObject('q1').obj;
    document.body.dataset.ftPromptHtmlHasMarkup = String(typeof q1.promptHtml === 'string' && /<(b|strong|i|em|u|span|font)\b/i.test(q1.promptHtml));
    document.body.dataset.ftPlainPromptPreserved = String(typeof q1.prompt === 'string' && !/</.test(q1.prompt));

    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    history.commit();
    // 재렌더로 promptHtml 이 렌더 DOM 에 서식 요소로 반영되는지 확인(qnum 은 별도 span 이라 제외).
    await reloadTeacherFrame(core.getDocument());
    doc = frames.teacher.contentDocument;
    const qAfter = doc.querySelector('[data-oid="q1"] .q');
    document.body.dataset.ftRenderedMarkup = String(!!qAfter && !!qAfter.querySelector('b, strong, i, em, u, [style*="bold"], [style*="font-weight"]'));

    // 하위호환: 평문만 편집한 제목엔 textHtml 이 생기지 않는다.
    const t1El = doc.querySelector('[data-oid="t1"]');
    t1El.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const tTarget = t1El.querySelector('.title-box h1, .title-box h2');
    tTarget.textContent = '평문만 제목';
    tTarget.dispatchEvent(new Event('input', { bubbles: true }));
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dataset.ftPlainTitleNoHtml = String(core.findObject('t1').obj.textHtml === undefined);

    const saved = await save();
    document.body.dataset.ftSaveOk = String(saved != null && saved.unsafe === false);
    // 저장 왕복 후 서버 저장본에도 promptHtml 이 실렸는지 교차 확인.
    const shell2 = await (await fetch(`/shell.json?_=${Date.now()}`)).json();
    const savedQ = shell2.document.pages.flatMap((p) => p.flow).find((o) => o.id === 'q1');
    document.body.dataset.ftSavedPromptHtmlPersisted = String(typeof savedQ?.promptHtml === 'string' && /<(b|strong|i|em|u|span|font)\b/i.test(savedQ.promptHtml));
  } else if (seed === 'enter-edit') {
    // US-P3-4: 더블클릭과 Enter 가 같은 판정 지점(enterEdit)을 거친다 — 편집 가능 타입은 진입하고
    // 편집 불가 타입은 선택만 유지된다. 실입력(실브라우저 CDP) 검증은 별도로 수행했고, 이 시드는
    // 회귀 방어용이다(핸들러가 e.key/state 만 보므로 합성 keydown 으로 충분).
    const q1 = doc.querySelector('[data-oid="q1"]');
    const t1 = doc.querySelector('[data-oid="t1"]');
    const std = doc.querySelector('[data-ot="std-box"]');

    // 1) 편집 가능 타입: 선택 → Enter → 편집 진입
    q1.click();
    document.body.dataset.eeSelectedBefore = String(selection.state.editingId === null);
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(30);
    document.body.dataset.eeEnterOpenedEdit = String(selection.state.editingId === 'q1');

    // 2) Escape 는 선택 상태로 복귀
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(30);
    document.body.dataset.eeEscapeToSelect = String(
      selection.state.editingId === null && selection.state.selectedIds.has('q1'),
    );

    // 3) 제목(다른 편집 가능 타입)도 같은 경로로 진입
    t1.click();
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(30);
    document.body.dataset.eeEnterOpenedTitle = String(selection.state.editingId === 't1');
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(30);

    // 4) 편집 불가 타입(std-box): Enter 로 빈 편집이 열리지 않고 선택만 남는다
    std.click();
    const stdId = std.dataset.oid;
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await wait(30);
    document.body.dataset.eeNonEditableNoEdit = String(
      selection.state.editingId === null && selection.state.selectedIds.has(stdId),
    );

    // 5) 수식 키가 붙은 Enter 는 개입하지 않는다(단축키 충돌 방지)
    q1.click();
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    await wait(30);
    document.body.dataset.eeShiftEnterIgnored = String(selection.state.editingId === null);
  } else if (seed === 'part-edit-ux') {
    // 2026-07-28 UX 배치 — 개체 부가 텍스트의 본문 인라인 편집(#1·#1b), 근거 성취기준 선택 표시(#1),
    // 지문 박스 서식(#3), 연결점 간격(#4), 문항 항목 증감(#5)을 실 DOM 이벤트로 재현한다.
    const partEl = (sel) => doc.querySelector(sel);
    /** 조각을 더블클릭해 열고 텍스트를 바꾼 뒤(input) 상태를 남긴다 — partEdit 은 캡처 dblclick 소유. */
    const editPart = (sel, text) => {
      const el = partEl(sel);
      if (!el) return null;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return el;
    };

    // 1) 학습목표 문장 — 인스펙터를 열지 않고 본문에서 바로 고친다
    const goal0 = editPart('.wg-part[data-part="objectives"][data-i="0"]', '본문에서 고친 목표');
    document.body.dataset.peObjective0 = core.findObject('s1').obj.objectives[0];
    document.body.dataset.peObjectiveOther = core.findObject('s1').obj.objectives[1];
    // Enter = 줄바꿈이 아니라 편집 종료(조각 값에 개행이 섞이지 않는다)
    goal0.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(20);
    document.body.dataset.peEnterClosed = String(!goal0.hasAttribute('contenteditable'));
    document.body.dataset.peObjectiveNoNewline = String(!core.findObject('s1').obj.objectives[0].includes('\n'));

    // 2) 박스 제목(heading) — "학습 목표" 라는 제목 자체도 본문에서 고친다
    editPart('.wg-part[data-part="heading"]', '오늘의 목표');
    document.body.dataset.peHeading = core.findObject('s1').obj.heading ?? '(none)';

    // 3) 제목 박스 배지·모서리 표기 — 인스펙터 전용이던 meta.* 를 본문에서 고친다
    editPart('.wg-part[data-part="meta.pill"]', '중2 · 3차시');
    document.body.dataset.pePill = core.findObject('t1').obj.meta.pill;
    editPart('.wg-part[data-part="meta.page"]', '');
    document.body.dataset.pePageCleared = String(core.findObject('t1').obj.meta.page === undefined);

    // 4) 지문 제목·출처("출처: " 접두는 편집 대상 밖 — 값만 되읽는다)
    editPart('.passage .wg-part[data-part="title"]', '지문 (다)');
    document.body.dataset.pePassageTitle = core.findObject('p1').obj.title;
    editPart('.passage .src .wg-part[data-part="source"]', '중학교 사회 2');
    document.body.dataset.pePassageSource = core.findObject('p1').obj.source;

    // 5) 근거 성취기준: 기본은 숨김, 인스펙터 체크박스로 켜면 교사용에 나타난다
    document.body.dataset.peStdRefDefault = String(doc.querySelectorAll('.std-ref').length);
    partEl('[data-oid="s1"]').click();
    await wait(20);
    const showCb = document.getElementById('insp-std-show-standards');
    document.body.dataset.peStdCheckboxExists = String(!!showCb);
    document.body.dataset.peStdCheckboxDefault = String(showCb?.checked === false);
    showCb.checked = true;
    showCb.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(120);
    doc = frames.teacher.contentDocument; // applyDocOp 가 프레임을 갈아끼운다
    document.body.dataset.peStdRefOn = String(doc.querySelectorAll('.std-ref').length);
    document.body.dataset.peStdCodesKept = String((core.findObject('s1').obj.codes || []).length);

    // 6) 지문 박스 서식(#3) — 색/두께가 CSS 변수로 실제 렌더에 반영된다
    doc.querySelector('[data-oid="p1"]').click();
    await wait(20);
    const psBorder = document.getElementById('insp-slot-border-color');
    document.body.dataset.pePassageStyleFields = String(
      !!psBorder && !!document.getElementById('insp-slot-border-width') && !!document.getElementById('insp-slot-bg-color'));
    psBorder.value = '#2563eb';
    psBorder.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(120);
    doc = frames.teacher.contentDocument;
    const passageEl = doc.querySelector('.passage');
    document.body.dataset.pePassageBorderVar = passageEl.style.getPropertyValue('--wg-ps-border').trim();
    document.body.dataset.pePassageBorderComputed = doc.defaultView.getComputedStyle(passageEl).borderTopColor;

    // 7) 연결형 연결점(#4) — 점이 가운데 뭉치지 않고 각자 항목 쪽 끝에 붙는다(실측)
    const dots = doc.querySelectorAll('.q-match tr:first-child .q-match-dot');
    const lCell = doc.querySelector('.q-match tr:first-child .q-match-l');
    const rCell = doc.querySelector('.q-match tr:first-child .q-match-r');
    if (dots.length === 2 && lCell && rCell) {
      const d0 = dots[0].getBoundingClientRect();
      const d1 = dots[1].getBoundingClientRect();
      const lr = lCell.getBoundingClientRect();
      const rr = rCell.getBoundingClientRect();
      document.body.dataset.peDotGapBetween = String(Math.round(d1.left - d0.right));
      document.body.dataset.peDotToLeftItem = String(Math.round(d0.left - lr.right));
      document.body.dataset.peDotToRightItem = String(Math.round(rr.left - d1.right));
    }

    // 8) 문항 항목 증감(#5) — 연결형 쌍을 인스펙터에서 늘린다(전엔 삽입 기본값에 갇혀 있었다)
    doc.querySelector('[data-oid="q1"]').click();
    await wait(20);
    const addBtn = document.getElementById('insp-q-add-item');
    document.body.dataset.peAddItemExists = String(!!addBtn);
    addBtn.click();
    await wait(120);
    doc = frames.teacher.contentDocument;
    const q1obj = core.findObject('q1').obj;
    document.body.dataset.peMatchPairs = `${q1obj.left.length}/${q1obj.right.length}`;
    document.body.dataset.peMatchRows = String(doc.querySelectorAll('.q-match tbody tr').length);

    // 9) 이미지 자리(#2) — 맨 글자가 아니라 실제 박스로 그려진다(실측 높이·점선 테두리)
    const ph = doc.querySelector('.image-slot.placeholder');
    const phRect = ph.getBoundingClientRect();
    const phStyle = doc.defaultView.getComputedStyle(ph);
    document.body.dataset.peImageHeight = String(Math.round(phRect.height));
    document.body.dataset.peImageBorderStyle = phStyle.borderTopStyle;
    document.body.dataset.peImageHasIcon = String(!!ph.querySelector('svg.is-icon'));
  } else if (seed === 'ai-author-section') {
    // B1(프래그먼트 저작 UI 진입) — 새 섹션 저작 종단: (A) 개체 앵커(선택 개체 뒤), (B) 빈 페이지
    // pageId 앵커. 모의 구독 AI 는 --fragment 로 회신한다(watchAndRespondFragment). 응답측 파이프라인
    // (buildFragmentVersion→prepareAiFragment→buildOpsVersion)은 재사용 — 진입만 새로 검증한다.

    // ── A. 개체 앵커 저작(q1 뒤) ──
    const beforeCount = core.allObjects().length; // opsDocument = 6
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai-author').click();
    let panel = document.getElementById('ai-panel');
    document.body.dataset.aEntryIntent = panel?.dataset.aiIntent || '';
    document.body.dataset.aPhase = panel?.dataset.aiPhase || '';
    let summary = document.getElementById('ai-targets-summary');
    document.body.dataset.aAnchorMode = summary?.dataset.aiAnchorMode || '';
    document.body.dataset.aSummaryText = summary?.textContent || '';
    document.body.dataset.aRewriteBtnAbsent = String(!document.getElementById('ai-preset-easier')); // 저작 뷰엔 rewrite 프리셋 없음

    document.getElementById('ai-author-prompt').value = '분수 곱셈 연습 섹션을 만들어줘';
    document.getElementById('ai-author-send').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    const copyText = document.getElementById('ai-copy-text').value;
    document.body.dataset.aCopyHasFragment = String(copyText.includes('--fragment'));
    document.body.dataset.aCopyNoOps = String(!copyText.includes('--ops') && !copyText.includes('--objects'));
    document.body.dataset.aRequestId = document.querySelector('.ai-waiting')?.dataset.aiRequestId || '';

    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    const cardsA = [...document.querySelectorAll('.ai-preview-card')];
    document.body.dataset.aCardKinds = cardsA.map((c) => c.dataset.aiPreviewKind).join(',');
    document.body.dataset.aCountInsert = document.getElementById('ai-count-change')?.dataset.aiCountInsert || '';
    document.body.dataset.aPreviewHasTitle = String(
      !!document.querySelector('.ai-preview-after .ai-preview-render')?.textContent.includes('분수 곱셈 활동'));

    const idxBeforeA = history.depth().index;
    document.getElementById('ai-apply-ops').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    cancelScheduledReflow(); // reflow 가 페이지 귀속을 바꾸기 전에 문서 순서를 실측(작은 콘텐츠라 넘침 없음)
    doc = frames.teacher.contentDocument;
    document.body.dataset.aHistoryOneOp = String(history.depth().index === idxBeforeA + 1);
    document.body.dataset.aCountAfter = String(core.allObjects().length);
    // 문서 순서(페이지 병합에 강인): q1 바로 뒤가 저작된 title 이어야 한다.
    const allFlowA = core.getDocument().pages.flatMap((p) => p.flow);
    const q1i = allFlowA.findIndex((o) => o.id === 'q1');
    const afterQ1 = allFlowA[q1i + 1];
    document.body.dataset.aInsertedAfterQ1 = String(!!afterQ1 && afterQ1.type === 'title' && !['q2', 'q3', 'std1', 't1'].includes(afterQ1.id));
    document.body.dataset.aStdIntact = String(!!core.findObject('std1') && core.findObject('std1').obj.type === 'std-box');
    document.body.dataset.aInsertedRendered = String(doc.body.textContent.includes('분수 곱셈 활동'));

    history.undo();
    updateAll();
    await wait(80);
    document.body.dataset.aUndoRestored = String(
      core.allObjects().length === beforeCount && !!core.findObject('q2') && !!core.findObject('q3'));

    // ── B. 후행 빈 페이지: pageId 가 아니라 "문서 마지막 flow 개체 뒤"로 앵커한다(안정) — 빈 페이지는
    // reflow 가 지우므로 pageId 앵커는 무API 왕복에서 스테일이 된다(authorAnchor.js). compose 만 확인한다
    // (적용은 완전 빈 문서 시드 ai-author-empty-doc 가 pageId 경로로 종단한다 — 유일 페이지라 안정).
    const secondPageId = core.getDocument().pages[1].id;
    const added = await handlePageAction('add-after', secondPageId);
    const emptyPageId = added.activePageId;
    document.body.dataset.bEmptyPageFlow0 = String((core.getDocument().pages.find((p) => p.id === emptyPageId)?.flow || []).length);
    selection.clearAll?.();
    updateAll();
    document.getElementById('btn-ai-author').click();
    panel = document.getElementById('ai-panel');
    document.body.dataset.bIntent = panel?.dataset.aiIntent || '';
    summary = document.getElementById('ai-targets-summary');
    document.body.dataset.bAnchorMode = summary?.dataset.aiAnchorMode || '';   // 'after'(문서 마지막 flow 뒤), 'page' 아님
    document.body.dataset.bAnchorLabel = summary?.textContent || '';
    document.getElementById('ai-panel-close').click();
    await wait(30);
  } else if (seed === 'ai-author-empty-doc') {
    // B1 — 완전 빈 문서(유일 빈 페이지)에 첫 섹션 저작: pageId 앵커(유일 페이지라 reflow 가 못 지움 = 안정).
    document.body.dataset.edFlow0 = String((core.getDocument().pages[0].flow || []).length);
    document.getElementById('btn-ai-author').click(); // 선택 없음 → 활성(유일) 페이지
    const panel = document.getElementById('ai-panel');
    document.body.dataset.edIntent = panel?.dataset.aiIntent || '';
    const summary = document.getElementById('ai-targets-summary');
    document.body.dataset.edAnchorMode = summary?.dataset.aiAnchorMode || '';   // 'page'
    document.body.dataset.edTargetCount = summary?.dataset.aiTargetCount || '';  // 0
    document.getElementById('ai-author-prompt').value = '첫 섹션을 만들어줘';
    document.getElementById('ai-author-send').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'waiting'
      && (document.getElementById('ai-copy-text')?.value || '').includes('req-'));
    document.body.dataset.edCopyHasFragment = String((document.getElementById('ai-copy-text')?.value || '').includes('--fragment'));
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    document.body.dataset.edApplyEnabled = String(!document.getElementById('ai-apply-ops')?.disabled);
    document.getElementById('ai-apply-ops').click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    cancelScheduledReflow();
    const page0 = core.getDocument().pages[0];
    document.body.dataset.edFlowAfter = String((page0?.flow || []).length);      // 2
    document.body.dataset.edFirstType = String(page0?.flow?.[0]?.type || '');     // title
    doc = frames.teacher.contentDocument;
    document.body.dataset.edRendered = String(doc.body.textContent.includes('분수 곱셈 활동'));
  } else if (seed === 'ai-author-passage') {
    // B3 — 지문 저작 권한: 교사 opt-in(토글)이 있어야 fragment 의 passage bodyHtml 이 통과한다. 모의
    // 구독 AI 는 응답 context 에 allowPassageContent:true 를 실어 보내지만(self-grant 시도), 그것만으론
    // 통과하지 못한다 — 권한은 교사 요청측 grant(state.context)가 권위다. 라운드 1=OFF(차단), 2=ON(적용).

    // ── 라운드 1: 토글 OFF → 차단(AI 응답 self-grant 무시) ──
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai-author').click();
    document.body.dataset.pTogglePresent = String(!!document.getElementById('ai-allow-passage'));
    document.getElementById('ai-allow-passage').checked = false; // 명시 OFF
    document.getElementById('ai-author-prompt').value = '지문과 문항이 있는 독해 섹션을 만들어줘';
    document.getElementById('ai-author-send').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    const applyOff = document.getElementById('ai-apply-ops');
    document.body.dataset.pOffApplicable = String(!!applyOff && !applyOff.disabled);
    document.body.dataset.pOffReason = document.getElementById('ai-error')?.textContent || ''; // showVersion 이 blockReason 을 실어둠
    document.getElementById('ai-panel-close').click();
    await wait(30);

    // ── 라운드 2: 토글 ON → 승인·적용·렌더 ──
    doc = frames.teacher.contentDocument;
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai-author').click();
    document.getElementById('ai-allow-passage').checked = true; // 교사 opt-in
    document.getElementById('ai-author-prompt').value = '지문과 문항이 있는 독해 섹션을 만들어줘';
    document.getElementById('ai-author-send').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    const applyOn = document.getElementById('ai-apply-ops');
    document.body.dataset.pOnApplicable = String(!!applyOn && !applyOn.disabled);
    applyOn.click();
    await pollUntil(() => !document.getElementById('ai-panel'), { timeoutMs: 15000 });
    cancelScheduledReflow();
    doc = frames.teacher.contentDocument;
    const passObj = core.getDocument().pages.flatMap((p) => p.flow)
      .find((o) => o.type === 'passage-slot' && typeof o.bodyHtml === 'string' && o.bodyHtml.includes('지문 본문 예시'));
    document.body.dataset.pOnAppliedBody = String(!!passObj);
    document.body.dataset.pOnRendered = String(doc.body.textContent.includes('교사가 넣은 지문 본문 예시'));
  } else if (seed === 'ai-ops-malformed-insert') {
    // B4 — --ops 경로 구조 게이트: AI 가 insert 로 malformed 신규 개체(카탈로그 밖 qtype)를 계획하면
    // 미리보기에서 차단된다(적용 버튼 비활성 + 사유). 유효 insert 회귀는 ai-ops-merge 가 지킨다.
    doc.querySelector('[data-oid="q1"]').click();
    document.getElementById('btn-ai').click();
    document.getElementById('ai-preset-easier').click();
    await pollUntil(() => document.getElementById('ai-panel')?.dataset.aiPhase === 'preview', { timeoutMs: 30000 });
    const applyBtn = document.getElementById('ai-apply-ops');
    document.body.dataset.mApplicable = String(!!applyBtn && !applyBtn.disabled);
    document.body.dataset.mReason = document.getElementById('ai-error')?.textContent || ''; // showVersion 이 blockReason 을 실어둠
    document.getElementById('ai-panel-close').click();
    await wait(30);
  }
  document.body.dataset.seedDone = seed;
}
