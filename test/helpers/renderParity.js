import assert from 'node:assert/strict';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';

// renderParity.js — "편집 렌더와 인쇄 렌더가 같은 레이아웃 선언을 낸다"를 단정하는 공용 가드.
//
// **왜 필요한가 — 3자 파리티 대조의 구조적 맹점(2026-07-28 변이 실험으로 실증).**
// editor-print-parity 의 pageOfId 대조는 편집기 리플로우와 PaginateObjectTree 를 비교하는데,
// **두 경로 모두 `editMode:true` 로 렌더한다**(`PaginateObjectTree.execute`, `reflow.js`
// `buildMeasureHtml`). 그래서 어떤 선언이 편집 렌더에만 들어가고 인쇄 렌더(`editMode:false`)에서
// 빠지면 두 측정기는 **여전히 서로 일치**하고 대조는 초록으로 통과한다. 어긋나는 것은 실제 인쇄뿐인데,
// 셋째 다리(인쇄 PDF 쪽수)는 높이 차가 마침 페이지 경계를 넘을 때만 걸리는 확률적 검출이다.
//
// 실제로 크기 조정 기능에서 방출 조건을 `editMode` 전용으로 되돌려 R2-1 을 깨자 기존 파리티 2건이
// **둘 다 통과**했다. 그래서 "인쇄 출력을 직접 본다"를 파리티의 기본 골격으로 올린다.
//
// 검사 방법: 두 모드로 렌더한 HTML 에서 인라인 `style="…"` 값을 **문서 순서대로** 뽑아 비교한다.
// 이 목록이 같다는 것은 곧 "레이아웃에 영향을 주는 선언이 한쪽에만 존재하지 않는다"는 뜻이다.
//   - 크기 없는 flow 개체: 편집은 `.wg-obj`(style 없음), 인쇄는 래퍼 자체가 없음 → 양쪽 다 기여 0.
//   - 크기 있는 flow 개체: 양쪽 다 같은 `style` 을 가진 `.wg-obj` → 같은 값 1개씩.
//   - float: 양쪽 다 `.wg-float style="position:absolute; …"` → 같은 값.
//   - 타입 렌더가 내는 선언(spacer 높이·표 테두리·지문 색 등)은 모드와 무관하므로 자연히 같다.
// editMode 는 `data-oid`/`data-part` 같은 **속성만** 늘려야 하며, 그것들은 style 이 아니라 이 검사에
// 걸리지 않는다 — 의도한 설계다(속성은 레이아웃 박스를 바꾸지 않는다).

/** HTML 에서 인라인 style 값을 문서 순서대로 뽑는다. */
export function layoutDeclarations(html) {
  return [...String(html).matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
}

/**
 * 같은 문서를 편집·인쇄 두 모드로 렌더해 레이아웃 선언이 동일한지 단정한다(R2-1 구조 가드).
 *
 * @param {object} document 개체 트리 문서
 * @param {{paperCss:string, blocksCss:string, themeCss:string}} assets
 * @param {object} [meta]
 * @param {string} [label] 실패 메시지에 붙일 식별자
 * @returns {{edit:string[], print:string[]}} 뽑아낸 선언 목록(추가 단정용)
 */
export function assertEditPrintDeclarationParity(document, assets, meta = {}, label = '') {
  const renderer = new RenderObjectTree();
  const edit = layoutDeclarations(renderer.execute(document, assets, meta, { editMode: true }).html);
  const print = layoutDeclarations(renderer.execute(document, assets, meta, { editMode: false }).html);
  const where = label ? `[${label}] ` : '';
  assert.deepEqual(
    print, edit,
    `${where}편집 렌더와 인쇄 렌더의 레이아웃 선언이 갈렸다 — 한쪽에만 들어간 선언이 있으면 `
    + `리플로우가 잰 높이와 실제 인쇄가 어긋나 페이지 수가 조용히 달라진다(R2-1). `
    + `편집 ${edit.length}건 / 인쇄 ${print.length}건`,
  );
  return { edit, print };
}
