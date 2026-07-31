// htmlAllowlist — 필드별 HTML 허용목록 검증기(순수, Node 안전, 의존성 0). B′ 스파이크 산출.
//
// **왜 새 검증기인가 — 기존 sanitizeAiHtml 을 재사용할 수 없다.**
// src/editor/ai.js#sanitizeAiHtml 은 브라우저 DOMParser 로 순회하며 script·on*·javascript: 만
// 제거한다(블랙리스트). 두 가지 문제:
//   1) DOMParser 는 Node 표준에 없다 — 결정적 검증기를 Node 유닛/CLI 에서 돌릴 수 없다(무의존성
//      원칙상 jsdom 등 도입 금지). html-scan.js 스스로 "완전한 HTML5 파서 아님"을 자인한다.
//   2) 블랙리스트는 style·iframe·object·embed·form·srcdoc·meta·CSS url()·임의 class/id/data 속성을
//      전부 통과시킨다(codex #6). AI 저작 HTML 에는 부족하다.
//
// 그래서 B′ 는 **필드별 allowlist 를 토큰 단위로 엄격 승인**한다. 정규식 스캐너로 태그·속성·URL 을
// 하나씩 훑어, 허용목록 밖 요소를 만나면 **조용히 지우지 않고 즉시 반려**(reason 반환)한다 — 이래야
// "공격 100% 거부" 지표가 거짓이 되지 않는다(정제 후 통과 = 스트립 = 우회 가능). 승인된 HTML 은
// **원문 그대로**이므로(허용 요소만 남았다) preview==apply 드리프트가 구조적으로 없다.
//
// 반환: { ok:true, plaintext } | { ok:false, rule, message, offset, detail }.

// **허용 범위는 "AI 저작 프로파일" — 엔진 방출 마크업이 아니다(B2 감사 결론).**
// allowlist 는 AI 가 5개 위치(passage.bodyHtml·richtext.html·callout.body·title.textHtml·
// question.promptHtml)에 **저작**하는 자유 HTML 만 규율한다. 표·qbox·조직자 같은 구조 마크업은
// 개체 타입(structured field)에서 엔진(RenderObjectTree)이 방출하므로 이 목록과 무관하다 — 즉
// blocks.css 의 .qbox/.db/.slot 같은 class 어휘를 여기 허용하는 것은 범주 오류다. 마이그레이션
// richtext 는 원문 HTML 을 그대로 담아(검증 우회) 렌더하므로 이 목록이 그 다양성을 떠받칠 필요도 없다.
// 그래서 목록은 **깨끗한 시맨틱 저작 집합**으로 좁게 유지하고, 속성/class 봉쇄(아래 ALLOWED_ATTRS)를
// 보안 경계로 삼는다. 새 태그는 "속성 없이도 안전하고, 실제 저작에 쓰이며, 제품이 렌더하는" 것만.

/** 인라인 서식 태그(제목/발문 등 한 줄 서식). code=인라인 등폭(코드·기호·수식 조각). */
export const INLINE_TAGS = Object.freeze(['strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'code', 'span', 'br', 'a']);

/** 블록 태그(지문/richtext/callout 본문 — 문단·목록·인용·정의목록·표). 인라인을 포함한다.
 *  caption 은 표 캡션(blocks.css `.obj-table caption` 이 이미 스타일 — 마이그레이션도 <caption> 추출),
 *  pre=서식보존 블록, dl/dt/dd=정의(용어) 목록(어휘·용어 정리에 시맨틱하게 맞다). */
export const BLOCK_TAGS = Object.freeze([
  ...INLINE_TAGS,
  'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'h3', 'h4', 'pre', 'hr',
  'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/** 닫는 태그가 없는 void 요소(우리 집합에서). */
const VOID_TAGS = new Set(['br', 'hr']);

/** 평문 추출 시 앞뒤에 단어 경계(공백)를 넣을 블록/개행 태그 — "문단1</p><li>가" 가 붙지 않도록. */
const BLOCK_SEPARATORS = new Set([
  'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'h3', 'h4', 'pre', 'hr', 'br',
  'table', 'caption', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/** 유일하게 허용되는 속성: a 요소의 href. 그 외 모든 속성(style·class·id·data-*·on*·srcdoc…)은 거부. */
const ALLOWED_ATTRS = Object.freeze({ a: new Set(['href']) });

/** href 로 허용되는 스킴(정규화·엔티티 디코드 후 접두 일치). 상대·앵커·data:·javascript: 는 거부. */
const ALLOWED_URL_SCHEMES = Object.freeze(['http:', 'https:', 'mailto:']);

const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
  colon: ':', tab: '\t', newline: '\n', sol: '/', bsol: '\\', lpar: '(', rpar: ')',
});

/** 최소 엔티티 디코드(숫자 10/16진 + 소수의 명명). URL 스킴 우회(java&#115;cript:)를 잡기 위함. */
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (m, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const key = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
  });
}

/** URL 이 허용 스킴인지 — 디코드 후 제어문자·공백 제거하고 스킴 접두를 본다. 스킴 없는(상대/앵커) URL 도 거부. */
function isAllowedUrl(raw) {
  // 제어문자·모든 공백을 제거해 "java	script:" · 공백 삽입 우회를 무력화(s 는 tab/newline/CR/FF/VT 포함).
  const cleaned = decodeEntities(raw).replace(/\s+/g, '').toLowerCase();
  return ALLOWED_URL_SCHEMES.some((scheme) => cleaned.startsWith(scheme));
}

function fail(rule, message, offset, detail) {
  return { ok: false, rule, message, offset, detail };
}

/**
 * 하나의 HTML 문자열을 필드 프로파일에 맞춰 엄격 검증한다.
 * @param {string} html 검증 대상.
 * @param {'inline'|'block'} profile 허용 태그 프로파일.
 * @returns {{ok:true, plaintext:string}|{ok:false, rule:string, message:string, offset:number, detail?:string}}
 */
export function validateHtmlField(html, profile = 'block') {
  if (typeof html !== 'string') {
    return fail('html-not-string', 'HTML 필드는 문자열이어야 합니다.', 0, typeof html);
  }
  const allowed = new Set(profile === 'inline' ? INLINE_TAGS : BLOCK_TAGS);
  const stack = [];
  const textParts = [];
  const n = html.length;
  let i = 0;

  while (i < n) {
    const ch = html[i];
    if (ch !== '<') {
      // '<' 이 아니면 텍스트. 다음 '<' 까지 모아 평문에 붙인다.
      let j = i + 1;
      while (j < n && html[j] !== '<') j += 1;
      textParts.push(html.slice(i, j));
      i = j;
      continue;
    }

    // ch === '<'
    const next = html[i + 1];
    // 주석·doctype·CDATA·PI 는 필드 HTML 에 허용하지 않는다(조용한 스트립 금지 → 반려).
    if (next === '!') return fail('disallowed-markup', '주석/doctype/CDATA 는 허용되지 않습니다.', i);
    if (next === '?') return fail('disallowed-markup', '처리 명령(<?…)은 허용되지 않습니다.', i);

    // '<' 뒤가 이름/슬래시가 아니면 리터럴 '<'(예: "3 < 5")로 본다 — 오탐 방지.
    const isClose = next === '/';
    const nameStart = isClose ? i + 2 : i + 1;
    if (!/[a-zA-Z]/.test(html[nameStart] || '')) {
      textParts.push('<');
      i += 1;
      continue;
    }

    // 태그 이름 파싱.
    let k = nameStart;
    while (k < n && /[a-zA-Z0-9]/.test(html[k])) k += 1;
    const tag = html.slice(nameStart, k).toLowerCase();

    if (!allowed.has(tag)) {
      return fail('disallowed-tag', `허용되지 않은 태그 <${tag}> (프로파일: ${profile}).`, i, tag);
    }

    // 블록/개행 태그(여는·닫는 무관)는 평문에서 단어 경계가 되도록 공백을 끼운다(정규화가 중복 흡수).
    if (BLOCK_SEPARATORS.has(tag)) textParts.push(' ');

    if (isClose) {
      // 닫는 태그: '>' 까지 공백만 허용.
      while (k < n && /\s/.test(html[k])) k += 1;
      if (html[k] !== '>') return fail('malformed-tag', `닫는 태그 </${tag}> 형식이 올바르지 않습니다.`, i);
      if (VOID_TAGS.has(tag)) return fail('malformed-tag', `<${tag}> 는 닫는 태그를 가질 수 없습니다.`, i);
      const top = stack.pop();
      if (top !== tag) return fail('unbalanced-tag', `태그 중첩 불일치: </${tag}> (기대: ${top ? '</' + top + '>' : '없음'}).`, i);
      i = k + 1;
      continue;
    }

    // 여는 태그: 속성 파싱.
    const attrs = ALLOWED_ATTRS[tag] || null;
    let selfClose = false;
    while (k < n) {
      // 공백 스킵.
      while (k < n && /\s/.test(html[k])) k += 1;
      if (html[k] === '>') { k += 1; break; }
      if (html[k] === '/' && html[k + 1] === '>') { selfClose = true; k += 2; break; }
      if (k >= n) return fail('malformed-tag', `태그 <${tag}> 가 닫히지 않았습니다.`, i);

      // 속성 이름.
      const attrStart = k;
      while (k < n && /[^\s/>=]/.test(html[k])) k += 1;
      if (k === attrStart) return fail('malformed-tag', `태그 <${tag}> 에 형식 오류가 있습니다.`, i);
      const attrName = html.slice(attrStart, k).toLowerCase();

      // 속성 값(있으면).
      let attrValue = '';
      let skip = k;
      while (skip < n && /\s/.test(html[skip])) skip += 1;
      if (html[skip] === '=') {
        skip += 1;
        while (skip < n && /\s/.test(html[skip])) skip += 1;
        const q = html[skip];
        if (q === '"' || q === "'") {
          const end = html.indexOf(q, skip + 1);
          if (end === -1) return fail('malformed-tag', `속성 값 인용부호가 닫히지 않았습니다(<${tag} ${attrName}>).`, i);
          attrValue = html.slice(skip + 1, end);
          k = end + 1;
        } else {
          const vStart = skip;
          while (skip < n && /[^\s>]/.test(html[skip])) skip += 1;
          attrValue = html.slice(vStart, skip);
          k = skip;
        }
      } else {
        k = skip; // 값 없는 속성(예: disabled).
      }

      // 속성 정책: a.href 만 허용. 그 외 전면 거부(style·class·id·data-*·on*·srcdoc…).
      if (!attrs || !attrs.has(attrName)) {
        return fail('disallowed-attr', `<${tag}> 의 속성 '${attrName}' 는 허용되지 않습니다.`, i, attrName);
      }
      if (attrName === 'href' && !isAllowedUrl(attrValue)) {
        return fail('disallowed-url', `href 는 http/https/mailto 만 허용됩니다: ${attrValue}`, i, attrValue);
      }
    }

    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(tag);
    i = k;
  }

  if (stack.length > 0) {
    return fail('unbalanced-tag', `닫히지 않은 태그가 있습니다: <${stack[stack.length - 1]}>.`, n);
  }

  // 승인 — 평문(diff/누출 스캔용) 을 함께 낸다. 태그를 벗기고 엔티티 디코드 후 공백 정규화.
  const plaintext = decodeEntities(textParts.join('')).replace(/\s+/g, ' ').trim();
  return { ok: true, plaintext };
}
