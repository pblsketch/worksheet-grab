import { tokenizeHtml } from '../../src/usecases/html-scan.js';

// 내용 손실 측정기 — 편집기를 갈아끼울 때 "글자가 조용히 사라졌는가"를 재는 단일 자.
//
// 왜 필요한가: ProseMirror/TipTap 계열은 스키마에 없는 요소를 경고 없이 버린다(공식 문서
// 명시, 끄는 설정 없음). 이 제품의 안전 속성은 "정답이 학생용에서 물리적으로 제거된다"인데,
// 조용한 소실은 그 게이트가 지켜야 할 것과 정확히 같은 종류의 사고다. 그래서 이식 전후를
// 같은 자로 재고, 줄어들면 테스트가 깨지게 만든다.
//
// 파서는 누출 게이트와 같은 tokenizeHtml 을 쓴다 — 안전 판정과 같은 눈으로 봐야
// "게이트는 통과하는데 지문은 못 잡는" 사각지대가 생기지 않는다.

/** 공백만으로 이뤄진 텍스트 노드인가 — 태그 사이 들여쓰기는 내용이 아니라 서식이다. */
function isFormattingOnly(raw) {
  return !raw.replace(/&nbsp;/g, ' ').trim();
}

/**
 * 서식 차이는 무시하고 글자만 남긴다.
 * 태그 사이 들여쓰기(`</td>\n    <td>`)는 버리고, 텍스트 노드 안의 공백
 * (`항목 1`, `<b>단원</b>　단원명`)은 지킨다 — 앞은 서식이고 뒤는 내용이다.
 * 이 구분이 없으면 파서가 pretty-print 를 지웠을 뿐인데 "글자 소실"로 오탐한다.
 */
function normalizeText(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/[ \t\r\n]+/g, ' ').trim();
}

/** 값까지 봐야 하는 속성 — 이게 사라지면 그림·연결·표 구조가 깨진다. */
const VALUE_ATTRS = /\b(data-[a-z-]+|src|alt|href|colspan|rowspan|viewBox|points|d|x1|y1|x2|y2|cx|cy|rx|ry|width|height)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function attrPairs(rawTag) {
  const out = [];
  for (const m of rawTag.matchAll(VALUE_ATTRS)) {
    const name = m[1].toLowerCase();
    const value = (m[3] ?? m[4] ?? m[5] ?? '').trim().replace(/\s+/g, ' ');
    out.push(`${name}=${value}`);
  }
  return out;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * HTML 의 내용 지문. 여는 태그만 센다(닫는 태그는 쌍이라 중복).
 * @returns {{text:string, tags:object, classes:object, attrs:object}}
 */
export function fingerprint(html) {
  const tags = new Map();
  const classes = new Map();
  const attrs = new Map();
  let text = '';
  for (const t of tokenizeHtml(html ?? '')) {
    if (t.type === 'text') {
      if (!isFormattingOnly(t.raw)) text += t.raw;
      continue;
    }
    if (t.kind === 'close' || t.kind === 'comment' || t.kind === 'doctype') continue;
    bump(tags, t.name);
    for (const c of t.classes) bump(classes, c);
    for (const a of attrPairs(t.raw)) bump(attrs, a);
  }
  return { text: normalizeText(text), tags: toObject(tags), classes: toObject(classes), attrs: toObject(attrs) };
}

/**
 * before 에 있던 것이 after 에서 줄었는지만 본다(늘어나는 건 통과 — 이식이 래퍼를
 * 추가하는 건 정상이고, 우리가 막아야 하는 건 소실뿐이다).
 * @returns {string[]} 손실 목록(비어 있으면 무손실)
 */
export function fidelityLosses(before, after) {
  const losses = [];
  if (before.text && !after.text.includes(before.text)) {
    // 글자가 통째로 보존되지 않으면 어디가 잘렸는지 짚어준다.
    const b = before.text;
    const a = after.text;
    let i = 0;
    while (i < b.length && i < a.length && b[i] === a[i]) i++;
    losses.push(`텍스트 소실: …"${b.slice(Math.max(0, i - 20), i + 40)}" 부근 (원문 ${b.length}자 → ${a.length}자)`);
  }
  for (const [group, key] of [['태그', 'tags'], ['클래스', 'classes'], ['속성', 'attrs']]) {
    for (const [name, count] of Object.entries(before[key])) {
      const now = after[key][name] ?? 0;
      if (now < count) losses.push(`${group} 소실: ${name} ${count}개 → ${now}개`);
    }
  }
  return losses;
}

/** 편의: HTML 두 벌을 바로 비교. */
export function compareHtml(beforeHtml, afterHtml) {
  return fidelityLosses(fingerprint(beforeHtml), fingerprint(afterHtml));
}
