// toolbar — 공통 서식 어댑터(§3.1 일반 WYSIWYG 툴바).
// execCommand 는 deprecated 이나 전 브라우저에서 동작하고 의존성 0 과 정합한다.
// 미래 Selection/Range 구현으로의 교체가 이 얇은 어댑터 경계 안에서 끝나도록
// 호출부는 apply* 함수만 쓴다. 단 fontSize 는 execCommand 가 1~7 레거시 값만
// 받아 pt 지정이 불가하므로(실측 함정) 처음부터 Range 직접 적용이다.

const TABLE_SKELETON =
  '<table><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table><p></p>';
// 업로드 실패/취소 시 폴백(§F1-3). data: URI SVG 는 자산 파일이 아니라 인라인 자리표시라
// 서버 자산 화이트리스트(SVG 제외)와 무관하다(문서에 스크립트 실행 없는 정적 이미지).
export const IMAGE_PLACEHOLDER =
  '<img alt="이미지 자리 — assets/ 에 파일을 넣고 경로를 바꾸세요" style="max-width:60mm"' +
  ' src="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27200%27 height=%27120%27%3E' +
  '%3Crect width=%27200%27 height=%27120%27 fill=%27%23f0f2f5%27 stroke=%27%23c3c9d1%27/%3E' +
  '%3Ctext x=%27100%27 y=%2765%27 text-anchor=%27middle%27 font-size=%2714%27 fill=%27%236b7280%27%3E이미지%3C/text%3E%3C/svg%3E">';

/** 업로드된 자산(assets/<name>)을 삽입할 <img> 마크업. 기본 폭 60mm(리사이즈로 갱신 가능).
 *  alt 는 접근성·인쇄 캡션용(기본 파일명 stem — 호출부가 전달). 빈값이면 attr 생략. */
export function imageMarkup(src, widthMm = 60, alt = '') {
  const enc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const altAttr = alt ? ` alt="${enc(alt)}"` : '';
  return `<img src="${enc(src)}"${altAttr} style="width:${widthMm}mm">`;
}

export function createToolbar(getDoc) {
  const ex = (cmd, value = null) => {
    const doc = getDoc();
    if (doc) doc.execCommand(cmd, false, value);
  };
  return {
    applyBold: () => ex('bold'),
    applyItalic: () => ex('italic'),
    applyUnderline: () => ex('underline'),
    applyColor: (hex) => ex('foreColor', hex),
    applyAlign: (dir) => ex(`justify${dir[0].toUpperCase()}${dir.slice(1)}`), // left|center|right
    applyList: (kind) => ex(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList'),
    applyFontFamily: (name) => ex('fontName', name),
    applyFontSize: (pt) => applyFontSizeDirect(getDoc(), pt),
    insertTable: () => ex('insertHTML', TABLE_SKELETON),
    // 커서 위치에 이미지 마크업 삽입. 인자 없으면 폴백 자리표시(업로드 실패/취소 경로).
    insertImage: (markup = IMAGE_PLACEHOLDER) => ex('insertHTML', markup),
    // 되돌리기/다시하기는 여기 없다 — execCommand 스택은 DOM 직접 조작(정답 표시 등)을
    // 못 담아 history.js 의 통합 스택이 단독으로 소유한다.
  };
}

/**
 * 선택이 "우리가 만든 크기 span 의 내용 전체"와 정확히 일치하면 그 span 을 돌려준다.
 * ± 스테퍼 연타 시 span 이 무한 중첩되는 것을 막는 판별(중첩 대신 값만 갱신).
 */
function soleSizedSpan(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || node.tagName !== 'SPAN' || !node.style.fontSize) return null;
  const full = node.ownerDocument.createRange();
  full.selectNodeContents(node);
  const sameStart = range.compareBoundaryPoints(Range.START_TO_START, full) === 0;
  const sameEnd = range.compareBoundaryPoints(Range.END_TO_END, full) === 0;
  return sameStart && sameEnd ? node : null;
}

/** 선택 영역에 pt 단위 글자 크기를 직접 적용(execCommand fontSize 대체). 성공 시 true. */
export function applyFontSizeDirect(doc, pt) {
  if (!doc) return false;
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);

  const existing = soleSizedSpan(range);
  if (existing) { existing.style.fontSize = `${pt}pt`; return true; }

  const span = doc.createElement('span');
  span.style.fontSize = `${pt}pt`;
  try {
    range.surroundContents(span);
  } catch {
    // 요소 경계를 가로지르는 부분 선택: 내용을 추출해 감싼다.
    span.appendChild(range.extractContents());
    range.insertNode(span);
  }
  // 적용 후 선택을 유지한다 — removeAllRanges 는 ± 를 두 번째 누를 때부터
  // "텍스트를 먼저 선택하세요" 경고가 뜨게 하던 원인이다.
  const after = doc.createRange();
  after.selectNodeContents(span);
  sel.removeAllRanges();
  sel.addRange(after);
  return true;
}
