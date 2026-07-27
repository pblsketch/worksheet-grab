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

/**
 * 값 안정 직렬화 — 같은 내용이면 키 순서와 무관하게 같은 문자열이 나온다. JSON.stringify 는 객체
 * 리터럴의 키 삽입 순서를 그대로 쓰므로(같은 페이지를 다시 만들면 키 순서가 달라질 수 있다) 여기서
 * 키를 정렬하고 undefined 필드를 떨군다 — 그래야 "내용이 같으면 같은 값"이 성립한다.
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

/** FNV-1a 32비트(시드 주입형) — 외부 의존 없이 브라우저·node 양쪽에서 동기로 계산된다. */
function fnv1a(text, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 페이지 내용 지문(pageVersion) — Phase 4 US-P4-5 덮어쓰기 방지의 기반.
 *
 * AI 가 응답하는 동안 교사가 그 페이지를 편집하면 낡은 기반의 결과가 최신 편집을 조용히 덮어쓴다.
 * 요청 시점의 지문을 함께 보내고 적용 직전에 다시 계산해 비교하면 그 사이 변화를 감지할 수 있다.
 * 개체 필드가 하나라도 바뀌거나 **순서만 바뀌어도** 다른 값이 나온다(배열은 순서를 보존해 직렬화).
 * 암호학적 용도가 아니라 낙관적 동시성 검사용이므로 32비트 두 벌(16진 16자)로 충분하다.
 */
export function computePageVersion(page) {
  const text = canonicalize(page ?? null);
  const a = fnv1a(text, 0x811c9dc5);
  const b = fnv1a(`${text.length}:${text}`, 0x2fd0b285);
  return `pv1-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
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
