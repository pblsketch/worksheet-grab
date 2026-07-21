// resync — 편집 DOM ↔ manifest 역동기화의 순수 코어(DOM 무접촉).
// editor.js(브라우저)가 teacher iframe 을 시트별로 순회해 만든 구조를 받아
// manifest.pages 를 재구성한다. DOM innerHTML 순회가 유일한 실경로이며,
// 이 모듈은 "배열 → pages" 변환만 담당한다(검증경로=실행경로 분기 금지).
//
// 래퍼 소실 폴백: contenteditable 의 파괴적 편집으로 .wg-block 밖에 남은 콘텐츠
// (leftoverHtml)는 해당 페이지 말미의 content 블록으로 흡수한다 — 작업 손실 0.
// 단 블록 구조(type 경계)는 손실되므로 structureWarning 으로 가시화한다(조용한 손실 금지).
//
// 참고: gen 블록(standard-label 등)은 편집 화면에 렌더된 결과가 인라인 html 로
// 동결된다 — manifest 단일 소스 규약 그대로(성취기준 원문은 이미 조회·주입된 상태).

/**
 * @param {Array<{blocks:Array<{type:string, html:string}>, leftoverHtml?:string}>} sheets
 *   시트(페이지) 순서대로: blocks = .wg-block 순회 결과(data-bt, innerHTML),
 *   leftoverHtml = 래퍼 밖에 남은 콘텐츠(run-head/foot/mode-badge 제외) HTML.
 * @param {object} manifest 기존 manifest(페이지 외 필드 보존의 원본)
 * @returns {{manifest:object, structureWarning:boolean}}
 */
export function resyncManifest(sheets, manifest) {
  if (!Array.isArray(sheets)) throw new TypeError('resyncManifest: sheets 배열이 필요합니다.');
  let structureWarning = false;
  const pages = sheets.map((sheet) => {
    const blocks = (sheet.blocks ?? []).map((b) => ({
      type: b.type || 'content',
      html: b.html,
    }));
    const leftover = (sheet.leftoverHtml ?? '').trim();
    if (leftover) {
      structureWarning = true;
      blocks.push({ type: 'content', html: leftover });
    }
    return blocks;
  });
  return { manifest: { ...manifest, pages }, structureWarning };
}
