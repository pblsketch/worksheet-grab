const PAGE_ID_PREFIX = 'page-';

export function createPageId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${PAGE_ID_PREFIX}${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return `${PAGE_ID_PREFIX}${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  throw new Error('페이지 ID를 생성할 수 있는 crypto API가 없습니다.');
}

function nextUniquePageId(unavailable, idGenerator) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const generated = idGenerator();
    const candidate = typeof generated === 'string' ? generated.trim() : '';
    if (candidate && !unavailable.has(candidate)) return candidate;
  }
  throw new Error('고유한 페이지 ID를 생성하지 못했습니다.');
}

export function createUniquePageId(pages, { idGenerator = createPageId } = {}) {
  const unavailable = new Set(
    (Array.isArray(pages) ? pages : [])
      .map((page) => (typeof page?.id === 'string' ? page.id.trim() : ''))
      .filter(Boolean),
  );
  return nextUniquePageId(unavailable, idGenerator);
}

export function normalizePageIdentity(document, { idGenerator = createPageId, repairInvalid = true } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new TypeError('normalizePageIdentity 는 문서 object가 필요합니다.');
  }

  const sourcePages = Array.isArray(document.pages) ? document.pages : [];
  const unavailable = new Set(
    sourcePages
      .map((page) => (typeof page?.id === 'string' ? page.id.trim() : ''))
      .filter(Boolean),
  );
  const assigned = new Set();
  let changed = !Array.isArray(document.pages);
  const pages = sourcePages.map((sourcePage) => {
    const page = sourcePage && typeof sourcePage === 'object' && !Array.isArray(sourcePage)
      ? sourcePage
      : {};
    const currentId = typeof page.id === 'string' ? page.id.trim() : '';
    const invalidPresentId = Object.hasOwn(page, 'id') && !currentId;
    const duplicateId = currentId && assigned.has(currentId);
    if (!repairInvalid && (invalidPresentId || duplicateId)) {
      throw new TypeError(invalidPresentId
        ? '페이지 ID는 비어 있지 않은 문자열이어야 합니다.'
        : `페이지 ID가 중복되었습니다: ${currentId}`);
    }
    const id = currentId && !assigned.has(currentId)
      ? currentId
      : nextUniquePageId(unavailable, idGenerator);
    assigned.add(id);
    unavailable.add(id);
    if (page === sourcePage && page.id === id) return page;
    changed = true;
    return { ...page, id };
  });

  return changed ? { ...document, pages } : document;
}
