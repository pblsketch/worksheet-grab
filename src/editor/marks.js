// marks — 활동지 전용 마크(§3.1): ⭐ 정답 표시(.answer)와 ✏️ 답란 삽입.
// ⭐ 누출 안전(주 방어): 이번 세션에 새로 단 마크는 data-wg-mark="session" 으로 태깅해
// 즉시 unwrap 을 허용하고, 기존 저작 .answer(태깅 없음)는 명시 confirm 후에만 벗긴다.
// (최후 그물은 SaveDocument 의 마크 소멸 감지 — 긴 정답 한정.)

/** 선택 영역을 감싸거나(신규 세션 마크) 조상 마크를 해제한다. */
export function toggleAnswerMark(doc, { confirmUnwrap = () => true } = {}) {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return { action: 'none' };
  const range = sel.getRangeAt(0);

  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const existing = node?.closest?.('.answer');
  if (existing) {
    const isSession = existing.dataset.wgMark === 'session';
    if (!isSession && !confirmUnwrap()) return { action: 'cancelled' };
    const parent = existing.parentNode;
    while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
    parent.removeChild(existing);
    return { action: 'unwrapped', session: isSession };
  }

  if (sel.isCollapsed) return { action: 'none' };
  const span = doc.createElement('span');
  span.className = 'answer';
  span.dataset.wgMark = 'session';
  try {
    range.surroundContents(span);
  } catch {
    // 요소 경계를 가로지르는 부분 선택: 내용을 추출해 감싼다.
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  sel.removeAllRanges();
  return { action: 'wrapped' };
}

/**
 * 커서가 위치한 블록(.wg-block) 말미에 답란(.ans-line) n줄을 삽입한다.
 * 블록 내부에 넣어 역동기화 구조(leftover 아님)를 유지한다.
 */
export function insertAnswerLines(doc, n = 5) {
  const sel = doc.getSelection();
  let block = null;
  if (sel && sel.rangeCount > 0) {
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    block = node?.closest?.('.wg-block') ?? null;
  }
  if (!block) block = doc.querySelector('.wg-block');
  if (!block) return 0;
  for (let i = 0; i < n; i++) {
    const line = doc.createElement('div');
    line.className = 'ans-line';
    block.appendChild(line);
  }
  return n;
}
