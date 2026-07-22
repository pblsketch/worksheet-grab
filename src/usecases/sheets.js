// sheets — 저장본 HTML 의 <section class="sheet"> 슬라이스·재번호·자산 재작성 순수 헬퍼.
// 의존성 0(Chrome·FS 무지). canvaExport 의 섹션 절단 선례(SECTION_OPEN·절단 루프)를
// 이관해 공유하고, 자료집(합본)·페이지 미리보기가 동일 슬라이서를 쓴다.
//
// 불변식(합의 계획 C1/C2/C5):
//  - splitSheets 는 섹션간 바이트(공백 포함)를 보존한다 → head + sections.join('') + tail
//    이 원본과 바이트 동일(C5). canvaExport 출력 바이트 불변의 근거.
//  - renumberRunFoot 는 run-foot 부분문자열에 앵커해 그 안의 쪽번호 숫자만 치환한다.
//    섹션 전역 replace 금지 — run-foot 밖 바이트는 1바이트도 바뀌지 않는다(C1).
//  - rewriteAssetUrls 는 src=/url() 속성 문맥에만 앵커한다 — 일반 텍스트 속 assets/ 는
//    무변경(C1). 치환 수를 반환해 독립 스캔과의 카운트 불변식을 세운다(C2).

export const SECTION_OPEN = '<section class="sheet">';
export const SECTION_CLOSE = '</section>';

// run-foot 형식(AssembleWorksheet.js:149):
//   <div class="run-foot"><span>left</span><span>rightPrefix　N</span></div>
// U+3000(전각 공백) 뒤의 숫자 N 이 쪽번호다.
const RUN_FOOT_OPEN = '<div class="run-foot">';
const RUN_FOOT_CLOSE = '</div>';
const IDEOGRAPHIC_SPACE = '　';

/**
 * 저장본 HTML 을 head + sections[] + tail 로 슬라이스한다.
 *
 * 섹션 사이 바이트(공백 포함)는 **선행 섹션의 꼬리**로 흡수한다(canvaExport.js:32
 * `html.slice(cursor, openIdx)` 관례와 등가). 마지막 섹션은 순수(꼬리 없음)이고 그 뒤
 * 바이트가 tail 로 간다. 따라서 `head + sections.join('') + tail === html`(C5).
 *
 * @param {string} html 저장본 HTML
 * @returns {{head:string, sections:string[], tail:string}}
 */
export function splitSheets(html) {
  if (typeof html !== 'string') throw new TypeError('splitSheets 는 html 문자열이 필요합니다.');

  const firstOpen = html.indexOf(SECTION_OPEN);
  if (firstOpen === -1) return { head: html, sections: [], tail: '' };

  const head = html.slice(0, firstOpen);
  const sections = [];
  let cursor = firstOpen;

  for (;;) {
    const openEnd = cursor + SECTION_OPEN.length;
    const closeIdx = html.indexOf(SECTION_CLOSE, openEnd);
    if (closeIdx === -1) {
      // 닫힘 태그 없는 섹션(방어적) — 끝까지 소비, tail 없음(canvaExport 선례와 등가).
      sections.push(html.slice(cursor));
      return { head, sections, tail: '' };
    }
    const closeEnd = closeIdx + SECTION_CLOSE.length;
    const nextOpen = html.indexOf(SECTION_OPEN, closeEnd);
    if (nextOpen === -1) {
      // 마지막 섹션: 순수(꼬리 없음), 그 뒤가 tail.
      sections.push(html.slice(cursor, closeEnd));
      return { head, sections, tail: html.slice(closeEnd) };
    }
    // 비마지막 섹션: 다음 섹션 시작까지(섹션간 바이트 포함)를 이 섹션의 꼬리로 흡수.
    sections.push(html.slice(cursor, nextOpen));
    cursor = nextOpen;
  }
}

/**
 * 섹션 HTML 의 run-foot 쪽번호만 절대 번호로 치환한다.
 *
 * 계약: run-foot 부분문자열(마지막 `<div class="run-foot">…</div>`)을 먼저 특정하고 그
 * 안의 마지막 U+3000 뒤 숫자만 바꾼다. run-foot 밖 바이트는 무변경(C1). run-foot 가
 * 없으면(표지·목차 섹션) 원본을 그대로 반환한다.
 *
 * @param {string} sectionHtml 섹션 HTML
 * @param {number|string} pageNo 절대 쪽번호
 * @returns {string} 쪽번호가 치환된 섹션 HTML(run-foot 밖 바이트 동일)
 */
export function renumberRunFoot(sectionHtml, pageNo) {
  if (typeof sectionHtml !== 'string') throw new TypeError('renumberRunFoot 는 html 문자열이 필요합니다.');

  // 크롬 run-foot 은 섹션 말미에 온다 — 마지막 run-foot 에 앵커(본문에 섞인 가짜 패턴 봉쇄).
  const rfOpen = sectionHtml.lastIndexOf(RUN_FOOT_OPEN);
  if (rfOpen === -1) return sectionHtml;
  const rfCloseIdx = sectionHtml.indexOf(RUN_FOOT_CLOSE, rfOpen + RUN_FOOT_OPEN.length);
  if (rfCloseIdx === -1) return sectionHtml;
  const rfEnd = rfCloseIdx + RUN_FOOT_CLOSE.length;

  const rf = sectionHtml.slice(rfOpen, rfEnd);

  // rightPrefix 도 U+3000 을 포함할 수 있으므로 **마지막** U+3000 뒤 숫자를 쪽번호로 본다.
  const sepIdx = rf.lastIndexOf(IDEOGRAPHIC_SPACE);
  if (sepIdx === -1) return sectionHtml;

  const digitStart = sepIdx + IDEOGRAPHIC_SPACE.length;
  let digitEnd = digitStart;
  while (digitEnd < rf.length && isDigit(rf.charCodeAt(digitEnd))) digitEnd += 1;
  if (digitEnd === digitStart) return sectionHtml; // 숫자 없음 → 무변경

  const newRf = rf.slice(0, digitStart) + String(pageNo) + rf.slice(digitEnd);
  return sectionHtml.slice(0, rfOpen) + newRf + sectionHtml.slice(rfEnd);
}

function isDigit(code) {
  return code >= 0x30 && code <= 0x39;
}

/**
 * 섹션 HTML 의 상대 자산 참조(assets/…)를 절대 URL 로 치환한다.
 *
 * src=/url() 속성 문맥에만 앵커한다 — 일반 텍스트 속 `assets/` 는 무변경(C1). 커버 변형:
 *   src="assets/…" · src='assets/…' · url(assets/…) · url("assets/…") · url('assets/…')
 * (url() 은 공백 변형 `url( assets/` 도 허용.) 치환 수를 반환해 카운트 불변식을 세운다(C2).
 *
 * @param {string} sectionHtml 섹션 HTML
 * @param {string} memberAssetsAbsUrl 멤버 assets 디렉터리의 절대 URL(예: pathToFileURL 결과)
 * @returns {{html:string, count:number}} 치환된 HTML 과 치환 수
 */
export function rewriteAssetUrls(sectionHtml, memberAssetsAbsUrl) {
  if (typeof sectionHtml !== 'string') throw new TypeError('rewriteAssetUrls 는 html 문자열이 필요합니다.');
  const base = String(memberAssetsAbsUrl).replace(/\/+$/, '');
  let count = 0;

  // src="assets/…" · src='assets/…'
  let html = sectionHtml.replace(/(src\s*=\s*["'])assets\//g, (_m, prefix) => {
    count += 1;
    return `${prefix}${base}/`;
  });
  // url(assets/…) · url("assets/…") · url('assets/…') (+ 공백 변형)
  html = html.replace(/(url\(\s*["']?)assets\//g, (_m, prefix) => {
    count += 1;
    return `${prefix}${base}/`;
  });

  return { html, count };
}
