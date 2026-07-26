/**
 * 붙여넣기 HTML 정규화 — Word·HWP·웹에서 온 표현 마크업을 활동지 인라인 서식으로 좁힌다.
 *
 * 왜 필요한가: `sanitizeInlineHtml`(selection.js)은 script·on*·javascript: 만 걷어낸다. 교사가
 * 한글(HWP)이나 웹에서 지문을 붙여넣으면 `<span style="font-family:굴림; font-size:14pt">`,
 * `<div>`, 표 마크업, class·id 가 그대로 `textHtml`/`promptHtml`/`html` 필드에 들어가
 * 활동지 타이포그래피(테마 CSS)를 덮어쓴다.
 *
 * 정책: **허용 목록으로 출력을 새로 짓는다**(제거 목록 방식이 아니다). 태그는 활동지에서 의미가
 * 있는 인라인 서식만 남기고, 속성은 **하나도 남기지 않는다**. 따라서 style·class·id·on*·
 * javascript: 는 구조적으로 통과할 수 없다 — 새 위험 속성이 생겨도 자동으로 막힌다.
 *
 * 의도적 손실:
 * - `<a href>` 는 텍스트만 남긴다(URL 검증 책임을 이 계층에 두지 않는다).
 * - `<img>` 는 버린다(이미지는 이미지 개체·업로드 경로로 넣는다 — 붙여넣기로 외부 URL 이
 *   활동지에 박히는 것을 막는다).
 * - 표는 셀 텍스트만 줄바꿈으로 평탄화한다(표가 필요하면 표 개체를 쓴다).
 */

// 활동지에서 의미가 있는 인라인 서식(렌더가 방출하는 집합과 정합 — selection.js hasInlineMarkup 참조).
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'SUB', 'SUP', 'MARK']);
// 줄바꿈 경계로 취급할 블록 태그.
const BLOCK = new Set([
  'P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
]);
// 내용까지 통째로 버릴 태그(스크립트·스타일·미디어).
const DROP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'IMG', 'SVG', 'OBJECT', 'IFRAME']);

/** 텍스트 노드를 HTML 로 안전하게 이스케이프한다(속성 문맥은 만들지 않으므로 &<> 로 충분). */
function escapeText(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 연속·선행·후행 <br> 을 정리한다(블록 평탄화가 만든 잉여 줄바꿈 제거). */
function collapseBreaks(html) {
  return String(html || '')
    .replace(/(?:<br>\s*){2,}/g, '<br>')
    .replace(/^(?:\s*<br>\s*)+/, '')
    .replace(/(?:\s*<br>\s*)+$/, '')
    .trim();
}

/**
 * 최소 노드 인터페이스(`childNodes`/`nodeType`/`tagName`/`nodeValue`)만 쓰는 순수 재귀 직렬화.
 * DOM 구현에 묶이지 않으므로 node 단위 테스트에서 가짜 트리로 직접 검증할 수 있다
 * (프로젝트 의존성 0 원칙 — jsdom 을 들이지 않는다).
 * @param {{childNodes?:Iterable<any>}} root
 * @returns {string} 정규화된 인라인 HTML
 */
export function normalizeNode(root) {
  const out = [];
  walk(root, out);
  return collapseBreaks(out.join(''));
}

function walk(node, out) {
  for (const child of node?.childNodes || []) {
    if (child.nodeType === 3) { // 텍스트
      out.push(escapeText(child.nodeValue));
      continue;
    }
    if (child.nodeType !== 1) continue; // 주석(8) 등은 버린다
    const tag = String(child.tagName || '').toUpperCase();
    if (DROP.has(tag)) continue; // 내용까지 버린다
    if (tag === 'BR') { out.push('<br>'); continue; }

    if (ALLOWED.has(tag)) {
      const t = tag.toLowerCase();
      const inner = [];
      walk(child, inner);
      const innerHtml = inner.join('');
      if (innerHtml) out.push(`<${t}>${innerHtml}</${t}>`); // 빈 서식 태그는 남기지 않는다
      continue;
    }

    // 그 외 태그는 언랩(텍스트 보존) — 블록이면 앞뒤에 줄바꿈 경계를 준다.
    const block = BLOCK.has(tag);
    if (block) out.push('<br>');
    walk(child, out);
    if (block) out.push('<br>');
  }
}

/**
 * 브라우저 진입점 — 붙여넣기 HTML 문자열을 정규화한다.
 * @param {string} html clipboardData 의 text/html
 * @param {(html:string)=>{body:any}} [parse] 테스트 주입용 파서(기본 DOMParser)
 * @returns {string}
 */
export function normalizePastedHtml(html, parse) {
  const doParse = parse || ((h) => new DOMParser().parseFromString(`<body>${h}</body>`, 'text/html'));
  const doc = doParse(String(html ?? ''));
  return normalizeNode(doc?.body ?? doc);
}

/** 평문 붙여넣기(text/plain) — 줄바꿈만 <br> 로 바꾸고 나머지는 이스케이프한다. */
export function normalizePastedText(text) {
  return collapseBreaks(
    escapeText(text).replace(/\r\n?|\n/g, '<br>'),
  );
}
