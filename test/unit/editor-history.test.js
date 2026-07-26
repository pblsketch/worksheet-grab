import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../../src/editor/history.js';

function makeHarness() {
  let documentState = {
    pages: [
      { id: 'page-a', role: 'cover', flow: [], float: [] },
      { id: 'page-b', flow: [], float: [] },
    ],
  };
  let activePageId = 'page-a';
  const body = { innerHTML: '<section class="sheet" data-page-id="page-a"></section><section class="sheet" data-page-id="page-b"></section>' };
  const restores = [];
  const core = {
    getDocument: () => documentState,
    setDocument: (next) => { documentState = next; },
  };
  const history = createHistory({
    core,
    getDoc: () => ({ body }),
    captureUiState: () => ({ activePageId }),
    restoreUiState: (state) => { activePageId = state?.activePageId ?? null; },
    onRestore: (context) => restores.push(context),
  });
  return {
    history,
    body,
    getDocument: () => documentState,
    setDocument: (next) => { documentState = next; },
    getActivePageId: () => activePageId,
    setActivePageId: (next) => { activePageId = next; },
    restores,
  };
}

test('history는 role-only 변경과 빈 페이지 reorder를 별도 단계로 기록한다', () => {
  const h = makeHarness();
  h.history.reset();

  h.setDocument({
    ...h.getDocument(),
    pages: h.getDocument().pages.map((page) => page.id === 'page-b' ? { ...page, role: 'reading' } : page),
  });
  h.history.commit();

  h.setDocument({ ...h.getDocument(), pages: [...h.getDocument().pages].reverse() });
  h.body.innerHTML = '<section class="sheet" data-page-id="page-b"></section><section class="sheet" data-page-id="page-a"></section>';
  h.history.commit();

  assert.deepEqual(h.history.depth(), { index: 2, length: 3 });
  assert.equal(h.history.undo(), true);
  assert.deepEqual(h.getDocument().pages.map((page) => page.id), ['page-a', 'page-b']);
  assert.equal(h.getDocument().pages[1].role, 'reading');
  assert.equal(h.history.undo(), true);
  assert.equal(h.getDocument().pages[1].role, undefined);
});

test('history는 add/delete 구조와 activePageId를 undo/redo에서 함께 복원한다', () => {
  const h = makeHarness();
  h.history.reset();

  h.setDocument({ ...h.getDocument(), pages: [h.getDocument().pages[1]] });
  h.body.innerHTML = '<section class="sheet" data-page-id="page-b"></section>';
  h.setActivePageId('page-b');
  h.history.commit();

  assert.equal(h.history.undo(), true);
  assert.deepEqual(h.getDocument().pages.map((page) => page.id), ['page-a', 'page-b']);
  assert.match(h.body.innerHTML, /page-a/);
  assert.equal(h.getActivePageId(), 'page-a');
  assert.equal(h.restores.at(-1).pageStructureChanged, true);

  assert.equal(h.history.redo(), true);
  assert.deepEqual(h.getDocument().pages.map((page) => page.id), ['page-b']);
  assert.doesNotMatch(h.body.innerHTML, /page-a/);
  assert.equal(h.getActivePageId(), 'page-b');
});
