// canvaExport — F3: Canva 반입용 페이지 주석(annotate). 순수 함수, Chrome·FS 무지.
// AssembleWorksheet.js:137 이 방출하는 <section class="sheet"> (columns>1 이어도 섹션
// 태그 자체는 불변 — 내부에 .sheet-body 래퍼만 추가됨) 각각에
// data-document-role="page" · data-label="<라벨>" 두 속성만 주입한다.
// DOM 파서 재직렬화를 쓰지 않고 문자열 삽입 지점만 최소 수정 — 그 외 바이트는 1바이트도
// 바꾸지 않는다. data-speaker-notes 는 F3 스코프 밖이라 방출하지 않는다.
//
// 섹션 절단은 공유 슬라이서 sheets.splitSheets 로 이관했다(자료집·미리보기 공유). 슬라이서가
// 섹션간 바이트를 보존하므로(C5) 여기 출력 바이트는 이관 전과 동일하다.

import { splitSheets, SECTION_OPEN, SECTION_CLOSE } from './sheets.js';

// 라벨 파생 우선순위: 페이지(섹션) 내부 첫 표제 —
// 1) .title-box 안 h1(활동지 표지, 보통 1페이지) 2) h2.sec(섹션 제목) 3) 그 외 단독 h1.
const TITLE_BOX_H1_RE = /<div class="title-box"[^>]*>\s*<h1[^>]*>([\s\S]*?)<\/h1>/;
const SEC_H2_RE = /<h2 class="sec"[^>]*>([\s\S]*?)<\/h2>/;
const ANY_H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/;

/**
 * @param {string} html AssembleWorksheet 산출(저장본) HTML
 * @param {{docTitle?:string}} opts docTitle: 표제 없는 페이지의 라벨 폴백에 쓰인다.
 * @returns {string} data-document-role/data-label 주입된 HTML(그 외 바이트 불변)
 */
export function annotateCanvaPages(html, { docTitle = '' } = {}) {
  if (typeof html !== 'string') throw new TypeError('annotateCanvaPages 는 html 문자열이 필요합니다.');

  const { head, sections, tail } = splitSheets(html);
  let out = head;
  let pageNo = 0;
  for (const section of sections) {
    pageNo += 1;
    out += annotateSection(section, docTitle, pageNo);
  }
  out += tail;
  return out;
}

// 슬라이스된 섹션 하나(SECTION_OPEN 으로 시작, `</section>` 뒤 섹션간 바이트가 꼬리로 붙을 수
// 있음)에 data-document-role/data-label 을 주입한다. 오프닝 태그만 재작성하고 inner·꼬리
// 바이트는 그대로 둔다.
function annotateSection(section, docTitle, pageNo) {
  const openEnd = SECTION_OPEN.length; // section 은 SECTION_OPEN 으로 시작
  const closeIdx = section.indexOf(SECTION_CLOSE, openEnd);
  const inner = closeIdx === -1 ? section.slice(openEnd) : section.slice(openEnd, closeIdx);
  const rest = closeIdx === -1 ? '' : section.slice(closeIdx); // `</section>` + 섹션간 바이트
  const label = deriveLabel(inner) || `${docTitle} — ${pageNo}쪽`;
  return `<section class="sheet" data-document-role="page" data-label="${escapeAttr(label)}">${inner}${rest}`;
}

function deriveLabel(inner) {
  const m = TITLE_BOX_H1_RE.exec(inner) || SEC_H2_RE.exec(inner) || ANY_H1_RE.exec(inner);
  if (!m) return null;
  // 표제 원문은 HTML 텍스트라 &amp;·&quot;·&#169; 같은 엔티티가 이미 인코딩돼 있다 — 디코드 후
  // escapeAttr 로 한 번만 재인코딩해야 이중 인코딩(&amp;quot; 등)이 안 생긴다.
  // html-scan.js 의 normalizeText 는 누출 탐지 의미론용이라 여기서 재사용하지 않고(그 규약 보호)
  // 라벨 전용 로컬 디코더를 둔다.
  const text = decodeLabelText(stripTags(m[1]));
  return text || null;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, '');
}

// 라벨 텍스트 전용 엔티티 디코더(순수). 숫자 엔티티(&#NNN;·&#xHH;) + 자주 쓰는 명칭 엔티티만
// 디코드하고 공백을 collapse 한다. 결과는 deriveLabel 이 escapeAttr 로 한 번만 재인코딩한다.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', ndash: '–', mdash: '—',
  hellip: '…', middot: '·',
};

function fromCodePoint(cp) {
  return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

function decodeLabelText(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, nm) => (nm in NAMED_ENTITIES ? NAMED_ENTITIES[nm] : whole))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 저장본 HTML 경로 → Canva 반입용 부가 산출 경로(동일 디렉토리, -canva 접미사). */
export function canvaHtmlPath(sourceHtmlPath) {
  return String(sourceHtmlPath).replace(/\.html$/, '-canva.html');
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
