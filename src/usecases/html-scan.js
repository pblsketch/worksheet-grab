// html-scan.js — 순수 HTML 미니 토크나이저 + 스캔 유틸.
// DOM/프레임워크 의존 없음. 정답 스트립·정답 누출 탐지·하드코딩색 탐지의 결정적 근거.
// PoC HTML(정형·단순)에 맞춘 경량 파서. 완전한 HTML5 파서가 아니다.

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** class="..." / class='...' / class=bare 의 클래스 토큰 배열 추출.
 *  따옴표 없는 형태도 유효 HTML — 정답 제거(불변식)의 근거라 놓치면 누출 벡터가 된다. */
export function extractClasses(rawTag) {
  const m = /\bclass\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(rawTag);
  if (!m) return [];
  const val = m[2] ?? m[3] ?? m[4] ?? '';
  return val.split(/\s+/).filter(Boolean);
}

/** HTML 을 태그/텍스트 토큰 배열로 분해. */
export function tokenizeHtml(html) {
  const tokens = [];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      tokens.push({ type: 'text', raw: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', raw: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end === -1 ? n : end + 3;
      tokens.push({ type: 'tag', kind: 'comment', raw: html.slice(lt, stop) });
      i = stop;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt + 2);
      const stop = end === -1 ? n : end + 1;
      tokens.push({ type: 'tag', kind: 'doctype', raw: html.slice(lt, stop) });
      i = stop;
      continue;
    }
    // 태그 끝(>) 탐색은 따옴표 인지형 — 속성값 안의 '>'(예: title="a>b")에서
    // 태그를 조기 절단하면 class 추출이 실패해 정답 제거·검수가 함께 뚫린다.
    let gt = -1;
    let quote = null;
    for (let j = lt + 1; j < n; j++) {
      const ch = html[j];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        gt = j;
        break;
      }
    }
    if (gt === -1) {
      tokens.push({ type: 'text', raw: html.slice(lt) });
      break;
    }
    const raw = html.slice(lt, gt + 1);
    const inner = html.slice(lt + 1, gt);
    let kind, name;
    if (inner[0] === '/') {
      kind = 'close';
      name = inner.slice(1).trim().split(/\s/)[0].toLowerCase();
    } else {
      name = inner.trim().split(/[\s/>]/)[0].toLowerCase();
      if (/\/\s*$/.test(inner)) kind = 'selfclose';
      else if (VOID.has(name)) kind = 'void';
      else kind = 'open';
    }
    tokens.push({ type: 'tag', kind, name, raw, classes: kind === 'close' ? [] : extractClasses(raw) });
    i = gt + 1;
  }
  return tokens;
}

function matchesTarget(classes, targets) {
  return classes.some((c) => targets.includes(c));
}

/** 지정 클래스(예: answer/plot-ans) 요소의 "내용"을 비운다(여는/닫는 태그는 유지).
 *  student 빌드에서 정답을 물리적으로 제거해 노출을 원천 차단(불변식). */
export function stripElementsByClass(html, targets) {
  const toks = tokenizeHtml(html);
  let out = '';
  let suppressName = null;
  let counter = 0;
  for (const t of toks) {
    if (suppressName !== null) {
      if (t.type === 'tag' && t.kind === 'open' && t.name === suppressName) counter++;
      else if (t.type === 'tag' && t.kind === 'close' && t.name === suppressName) {
        if (counter === 0) { out += t.raw; suppressName = null; continue; }
        counter--;
      }
      continue; // 내부 토큰 폐기
    }
    if (t.type === 'tag' && t.kind === 'open' && matchesTarget(t.classes, targets)) {
      out += t.raw;
      suppressName = t.name;
      counter = 0;
      continue;
    }
    // void/selfclose 태그(img·input 등)에 마크 클래스가 직접 붙으면 비울 "내용"이 없어
    // 태그 자체가 정답 콘텐츠다(예: <img class="answer" src=…>) — fail-closed 로 태그를 통째 제거.
    // 텍스트 기반 누출 탐지는 이미지를 볼 수 없으므로 여기서 막지 않으면 조용한 누출 벡터가 된다.
    if (t.type === 'tag' && (t.kind === 'void' || t.kind === 'selfclose') && matchesTarget(t.classes, targets)) {
      continue;
    }
    out += t.raw;
  }
  return out;
}

function decodeMinimal(s) {
  return s
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#8203;/gi, '');
}

/** 공백/엔티티 정규화. */
export function normalizeText(s) {
  return decodeMinimal(s).replace(/\s+/g, ' ').trim();
}

/** 지정 클래스 요소 "안"의 정규화 텍스트 배열. */
export function collectTextInside(html, targets) {
  const toks = tokenizeHtml(html);
  const res = [];
  let cur = null;
  let name = null;
  let counter = 0;
  for (const t of toks) {
    if (cur !== null) {
      if (t.type === 'text') cur += t.raw;
      else if (t.kind === 'open' && t.name === name) counter++;
      else if (t.kind === 'close' && t.name === name) {
        if (counter === 0) { res.push(normalizeText(cur)); cur = null; name = null; }
        else counter--;
      }
      continue;
    }
    if (t.type === 'tag' && t.kind === 'open' && matchesTarget(t.classes, targets)) {
      cur = '';
      name = t.name;
      counter = 0;
    }
  }
  return res.filter(Boolean);
}

/** 지정 클래스 요소 "밖"의 정규화 텍스트(style/script 내용 제외). */
export function textOutside(html, targets) {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const toks = tokenizeHtml(cleaned);
  let out = '';
  let name = null;
  let counter = 0;
  for (const t of toks) {
    if (name !== null) {
      if (t.type === 'tag' && t.kind === 'open' && t.name === name) counter++;
      else if (t.type === 'tag' && t.kind === 'close' && t.name === name) {
        if (counter === 0) name = null;
        else counter--;
      }
      continue;
    }
    if (t.type === 'tag' && t.kind === 'open' && matchesTarget(t.classes, targets)) {
      name = t.name;
      counter = 0;
      continue;
    }
    if (t.type === 'text') out += t.raw + ' ';
  }
  return normalizeText(out);
}

/** :root { ... } 블록(정당한 테마 변수 정의)을 제거한 HTML. 하드코딩색 탐지 전처리. */
export function stripRootBlocks(html) {
  return html.replace(/:root\s*\{[^}]*\}/gi, ' ');
}
