import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPageActionHandler } from '../../src/editor/pageOperations.js';

function makeOperations() {
  return {
    addPage(doc, { afterIndex }) {
      const pages = [...doc.pages];
      const at = afterIndex == null ? pages.length : afterIndex + 1;
      pages.splice(at, 0, { id: `page-new-${at}`, flow: [], float: [] });
      return { ...doc, pages };
    },
    duplicatePage(doc, index) {
      const pages = [...doc.pages];
      pages.splice(index + 1, 0, { ...pages[index], id: `page-copy-${index}` });
      return { ...doc, pages };
    },
    removePage(doc, index) {
      if (doc.pages.length <= 1) return doc;
      return { ...doc, pages: doc.pages.filter((_, pageIndex) => pageIndex !== index) };
    },
    movePage(doc, fromIndex, toIndex) {
      if (toIndex < 0 || toIndex >= doc.pages.length || fromIndex === toIndex) return doc;
      const pages = [...doc.pages];
      const [page] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, page);
      return { ...doc, pages };
    },
    reorderPages(doc, pageIds) {
      if (pageIds.join(',') === doc.pages.map((page) => page.id).join(',')) return doc;
      const byId = new Map(doc.pages.map((page) => [page.id, page]));
      return { ...doc, pages: pageIds.map((id) => byId.get(id)) };
    },
    setPageRole(doc, pageId, role) {
      const page = doc.pages.find((candidate) => candidate.id === pageId);
      if (!page || page.role === role || (!page.role && role == null)) return doc;
      return {
        ...doc,
        pages: doc.pages.map((candidate) => (
          candidate.id === pageId
            ? Object.fromEntries(Object.entries({ ...candidate, role }).filter(([, value]) => value != null))
            : candidate
        )),
      };
    },
  };
}

test('페이지 명령은 ID를 호출 시점의 index로 해석하고 활성 페이지를 함께 중앙 관문에 전달한다', async () => {
  let currentDocument = {
    pages: [
      { id: 'page-a', flow: [], float: [] },
      { id: 'page-b', flow: [], float: [] },
    ],
  };
  let activePageId = 'page-a';
  const calls = [];
  const handlePageAction = createPageActionHandler({
    getDocument: () => currentDocument,
    getActivePageId: () => activePageId,
    operations: makeOperations(),
    applyDocument: async (next, options) => {
      calls.push({ next, options });
      currentDocument = next;
      activePageId = options.activePageId;
    },
  });

  await handlePageAction('add-after', 'page-a');
  assert.equal(calls.at(-1).options.activePageId, 'page-new-1');

  await handlePageAction('duplicate', 'page-b');
  assert.equal(calls.at(-1).options.activePageId, 'page-copy-2');

  await handlePageAction('move-up', 'page-b');
  assert.equal(calls.at(-1).options.activePageId, 'page-copy-2', '비활성 페이지 이동은 현재 활성 ID를 유지');

  activePageId = 'page-b';
  await handlePageAction('delete', 'page-b');
  assert.equal(calls.at(-1).options.activePageId, 'page-new-1', '활성 삭제는 같은 ordinal의 후속 페이지를 선택');

  assert.ok(calls.every(({ options }) => options.reflow === false));
});

test('role·reorder는 ID 기반으로 적용하며 no-op은 dirty 관문을 호출하지 않는다', async () => {
  let currentDocument = {
    pages: [
      { id: 'page-a', role: 'legacy-role', flow: [], float: [] },
      { id: 'page-b', flow: [], float: [] },
    ],
  };
  const calls = [];
  const handlePageAction = createPageActionHandler({
    getDocument: () => currentDocument,
    getActivePageId: () => 'page-a',
    operations: makeOperations(),
    applyDocument: async (next, options) => {
      calls.push({ next, options });
      currentDocument = next;
    },
  });

  await handlePageAction('set-role', 'page-a', { role: 'reading' });
  assert.equal(currentDocument.pages[0].role, 'reading');
  assert.equal(calls.at(-1).options.activePageId, 'page-a');

  await handlePageAction('reorder', 'page-b', { pageIds: ['page-b', 'page-a'] });
  assert.deepEqual(currentDocument.pages.map((page) => page.id), ['page-b', 'page-a']);
  assert.equal(calls.at(-1).options.activePageId, 'page-a');

  const callCount = calls.length;
  await handlePageAction('set-role', 'page-a', { role: 'reading' });
  await handlePageAction('reorder', 'page-b', { pageIds: ['page-b', 'page-a'] });
  await handlePageAction('move-up', 'missing-page');
  await handlePageAction('unknown', 'page-a');
  assert.equal(calls.length, callCount, '동일 상태·없는 ID·알 수 없는 명령은 중앙 관문을 호출하지 않음');
});

test('페이지 명령은 직렬 실행하고 각 실행 시 최신 문서를 다시 읽는다', async () => {
  let currentDocument = {
    pages: [
      { id: 'page-a', flow: [], float: [] },
      { id: 'page-b', flow: [], float: [] },
    ],
  };
  let releaseFirst;
  const firstApply = new Promise((resolve) => { releaseFirst = resolve; });
  const applied = [];
  const handlePageAction = createPageActionHandler({
    getDocument: () => currentDocument,
    getActivePageId: () => 'page-a',
    operations: makeOperations(),
    applyDocument: async (next, options) => {
      applied.push(next.pages.map((page) => page.id));
      if (applied.length === 1) await firstApply;
      currentDocument = next;
      assert.ok(options.activePageId);
    },
  });

  const add = handlePageAction('add-after', 'page-a');
  const move = handlePageAction('move-down', 'page-a');
  await Promise.resolve();
  assert.equal(applied.length, 1, '첫 적용이 끝나기 전에 두 번째 명령을 시작하면 안 됨');

  releaseFirst();
  await Promise.all([add, move]);
  assert.deepEqual(applied[1], ['page-new-1', 'page-a', 'page-b'], '두 번째 명령은 첫 결과를 기준으로 index를 해석');
});
