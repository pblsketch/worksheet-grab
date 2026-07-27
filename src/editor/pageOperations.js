export function createPageActionHandler({ getDocument, getActivePageId = () => null, applyDocument, operations }) {
  let commandQueue = Promise.resolve();

  async function execute(action, pageId, payload = {}) {
    const doc = getDocument();
    const pages = doc.pages || [];
    const index = pageId == null ? null : pages.findIndex((page) => page.id === pageId);
    if (pageId != null && index < 0) return null;

    const currentActivePageId = getActivePageId();
    let next;
    let activePageId = currentActivePageId;
    if (action === 'add-before') {
      next = operations.addPage(doc, { afterIndex: index == null ? null : index - 1 });
      activePageId = next.pages[index == null ? next.pages.length - 1 : index]?.id ?? currentActivePageId;
    } else if (action === 'add-after') {
      next = operations.addPage(doc, { afterIndex: index });
      activePageId = next.pages[index == null ? next.pages.length - 1 : index + 1]?.id ?? currentActivePageId;
    } else if (action === 'duplicate') {
      next = operations.duplicatePage(doc, index);
      activePageId = next.pages[index + 1]?.id ?? currentActivePageId;
    } else if (action === 'delete') {
      next = operations.removePage(doc, index);
      if (pageId === currentActivePageId && next !== doc) {
        activePageId = next.pages[Math.min(index, next.pages.length - 1)]?.id ?? null;
      }
    } else if (action === 'move-up') {
      next = operations.movePage(doc, index, index - 1);
    } else if (action === 'move-down') {
      next = operations.movePage(doc, index, index + 1);
    } else if (action === 'reorder') {
      next = operations.reorderPages(doc, payload.pageIds);
    } else if (action === 'set-role') {
      next = operations.setPageRole(doc, pageId, payload.role);
    } else {
      return null;
    }
    if (next === doc) return null;

    if (!next.pages.some((page) => page.id === activePageId)) {
      activePageId = next.pages[0]?.id ?? null;
    }
    await applyDocument(next, { reflow: false, activePageId });
    return { document: next, activePageId };
  }

  return function handlePageAction(action, pageId, payload) {
    const command = commandQueue.then(() => execute(action, pageId, payload));
    commandQueue = command.catch(() => {});
    return command;
  };
}
