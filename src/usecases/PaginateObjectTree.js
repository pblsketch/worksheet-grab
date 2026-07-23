import { RenderObjectTree } from './RenderObjectTree.js';
import { resolvePaper, paperDims, paperMargins } from './paper.js';

// PaginateObjectTree — S2.5(M2) 페이지네이션 패스 모듈(06_plan_final.md 167~172행, D-A/R2-1).
//
// 아키텍처 경계(과제 지시 — 측정/계산 분리):
//   1) 순수 계산부(이 파일의 assignFlowToPages/computeAvailableHeightPx) — Chrome/FS/DOM 전혀
//      무접촉. 높이 배열 + 가용 높이 → 개체별 출력 페이지 인덱스만 계산한다. 단위 테스트 가능
//      (test/unit/paginate-assign.test.js), browserGraph 화이트리스트 등재 대상(순수성 보증).
//   2) 측정(Chrome I/O)은 어댑터에 위임 — 이 파일은 `measurer{measure}` 포트를 생성자로 주입받을
//      뿐, Chrome 어댑터 모듈을 정적 import 하지 않는다(ExportDocument 가 Renderer 를 주입받는
//      관례와 동형). 실제 구현은 src/adapters/PaginationMeasurer.js(ChromePaginationMeasurer).
//
// 입력: pagination:'scaffold' 문서(경계 미확정, flow 개체가 한 논리 흐름 — pages[] 는 있어도
// 그 flow 버킷들은 전부 이어붙여 "하나의 흐름"으로 취급한다. float 버킷만은 원래 페이지 인덱스를
// "지정 페이지" 로 존중해 재배치 후에도 그 위치에 잔류시킨다).
// 출력: pages[] 경계가 영속화된 pagination:'paginated' 새 문서(입력은 절대 변형하지 않는다 —
// 새 배열/새 문서 객체만 구성하고, 개체 자신은 참조를 그대로 옮겨 담는다).

/** CSS 사양 고정 변환값(zoom/DPR 무관) — src/editor/editor.js:23 의 MM_TO_PX 관례와 동일. */
export const MM_TO_PX = 96 / 25.4;

/** R2-1 허용오차 기본값(px) — 폰트 힌팅/서브픽셀 미세변동에서 귀속이 뒤집히지 않도록 하는 마진. */
export const DEFAULT_TOLERANCE_PX = 2;

/**
 * assignFlowToPages — 순수 귀속 계산(D-A 순수 계산부, Chrome 무관).
 * 실측 높이 배열(문서 흐름 순서) + 페이지 가용 높이 → 개체별 출력 페이지 인덱스.
 * 어떤 개체도 분할하지 않는다(표 포함, R7) — 페이지에 다 안 실리면 개체를 통째로 다음 페이지로 옮긴다.
 * 개체 혼자서도 가용 높이를 넘는 경우(예: 매우 큰 표)는 그 개체 하나만 담은 페이지로 "최선을 다해"
 * 배치한다(분할이 불가능하므로 넘침 자체는 허용 — 인쇄 CSS 의 break-inside:avoid 가 조판 안전망).
 *
 * @param {Array<{id:string, heightPx:number}>} items 순서대로 배치할 flow 개체(이미 평평한 목록)
 * @param {number} availableHeightPx 페이지 1개의 가용 콘텐츠 높이(px, 상하 여백 제외)
 * @param {{tolerancePx?:number}} [opts]
 * @returns {{pageOfId:Record<string,number>, pageOfIndex:number[], pageCount:number}}
 */
export function assignFlowToPages(items, availableHeightPx, opts = {}) {
  if (!Array.isArray(items)) {
    throw new TypeError('assignFlowToPages 는 items(array) 가 필요합니다.');
  }
  if (!(Number(availableHeightPx) > 0)) {
    throw new TypeError('assignFlowToPages 는 availableHeightPx(양수) 가 필요합니다.');
  }
  const tolerancePx = opts.tolerancePx ?? DEFAULT_TOLERANCE_PX;

  const pageOfIndex = [];
  const pageOfId = {};
  let cursor = 0;
  let page = 0;
  for (const item of items) {
    const h = Math.max(0, Number(item?.heightPx) || 0);
    // cursor>0(현재 페이지에 이미 개체가 있음) 이고, 더하면 허용오차를 넘어 넘치면 -> 통째로 다음
    // 페이지로. cursor===0(새 페이지의 첫 개체)이면 그 개체 혼자 용량을 넘겨도 분할 없이 그대로
    // 싣는다(표 등 분할불가 개체가 "통째 이동"으로 최종 착지하는 지점, R7).
    if (cursor > 0 && cursor + h > availableHeightPx + tolerancePx) {
      page += 1;
      cursor = 0;
    }
    pageOfIndex.push(page);
    if (item?.id != null) pageOfId[item.id] = page;
    cursor += h;
  }
  return { pageOfId, pageOfIndex, pageCount: page + 1 };
}

/**
 * 문서 paper 설정 → 페이지 가용 콘텐츠 높이(px, 상하 여백 제외). 순수 함수(paper.js 순수 코어 재사용).
 * @param {object|null|undefined} paper manifest.paper 와 동형(미지정이면 A4 세로 기본)
 */
export function computeAvailableHeightPx(paper) {
  const resolved = resolvePaper(paper) ?? resolvePaper({});
  const { h } = paperDims(resolved);
  const m = paperMargins(resolved);
  return (h - m.top - m.bottom) * MM_TO_PX;
}

/**
 * rebuildPaginatedPages — 순수 계산부(Chrome/FS/DOM 무접촉). 원본 pages[](flow/float 버킷 —
 * 마이그레이션 안 된 flow 재배정 전 원본 배치)과 새 flow 귀속(assignFlowToPages 산출
 * pageOfId/pageCount)을 받아 새 pages[] 를 구성한다.
 *
 * float 재배치 규약: 원래 페이지 인덱스를 "지정 페이지"로 존중해 그대로 잔류시키되, 새
 * pageCount 를 넘으면(흐름이 짧아져 원래 페이지가 사라진 경우) 마지막 페이지로 클램프한다
 * (고아 방지 — C-10 float 한계는 계획서 기록된 후속 과제). flow 개체 자신은 참조를 그대로
 * 옮겨 담을 뿐 새 객체를 만들지 않는다(입력 불변형 유지는 호출부 책임 — 이 함수는 새 배열만
 * 구성한다).
 *
 * S4.2(브라우저 편집기 리플로우, 06_plan_final.md 217~221행)가 PaginateObjectTree.execute()
 * (Chrome 측정 경로)와 완전히 동일한 재구성 규칙을 공유해야 "하드 동치"가 성립하므로, 두
 * 소비자가 이 함수 하나를 호출한다(재구현 시 발산 위험 제거).
 *
 * @param {Array<{flow?:object[], float?:object[]}>} srcPages
 * @param {Record<string,number>} pageOfId
 * @param {number} pageCount
 * @returns {Array<{flow:object[], float:object[]}>}
 */
export function rebuildPaginatedPages(srcPages, pageOfId, pageCount) {
  const flatFlow = [];
  const floatByOriginalPage = [];
  for (const p of (Array.isArray(srcPages) ? srcPages : [])) {
    flatFlow.push(...(Array.isArray(p?.flow) ? p.flow : []));
    floatByOriginalPage.push(Array.isArray(p?.float) ? p.float : []);
  }

  const pages = Array.from({ length: pageCount }, () => ({ flow: [], float: [] }));
  for (const obj of flatFlow) {
    pages[pageOfId[obj.id] ?? 0].flow.push(obj);
  }
  floatByOriginalPage.forEach((floats, origIdx) => {
    if (floats.length === 0) return;
    const target = Math.min(origIdx, pageCount - 1);
    pages[target].float.push(...floats);
  });
  return pages;
}

export class PaginateObjectTree {
  /**
   * @param {{measurer:{measure:(args:{html:string, timeoutMs?:number}) =>
   *   Promise<{heights:Record<string,number>, gating:object}>}}} deps
   * measurer 는 Chrome I/O 어댑터 포트(구체 구현: src/adapters/PaginationMeasurer.js) — 이 클래스는
   * 정적 import 하지 않고 주입만 받는다(browserGraph 순수성 보증, ExportDocument#renderer 관례 동형).
   */
  constructor({ measurer }) {
    if (!measurer || typeof measurer.measure !== 'function') {
      throw new TypeError('PaginateObjectTree 는 measurer{measure} 가 필요합니다.');
    }
    this.measurer = measurer;
    this.renderer = new RenderObjectTree();
  }

  /**
   * @param {{pagination:string, pages:Array<{flow:object[], float:object[]}>}} document scaffold 문서
   * @param {{paperCss:string, blocksCss:string, themeCss:string}} assets RenderObjectTree 와 동일 계약
   * @param {object} [meta] RenderObjectTree 와 동일 계약(paper 포함 — 가용 높이 산정에 사용)
   * @param {{tolerancePx?:number, timeoutMs?:number}} [opts]
   * @returns {Promise<{document:{pagination:'paginated', pages:Array}, gating:object,
   *   pageOfId:Record<string,number>}>}
   */
  async execute(document, assets, meta = {}, opts = {}) {
    if (!document || typeof document !== 'object' || document.pagination !== 'scaffold') {
      throw new TypeError('PaginateObjectTree.execute 는 pagination:"scaffold" 문서가 필요합니다.');
    }
    if (!assets || typeof assets.paperCss !== 'string' || typeof assets.blocksCss !== 'string' || typeof assets.themeCss !== 'string') {
      throw new TypeError('PaginateObjectTree.execute 는 assets{paperCss,blocksCss,themeCss}(문자열)가 필요합니다.');
    }

    const srcPages = Array.isArray(document.pages) ? document.pages : [];
    // flow = 전체 논리 흐름(입력 pages[] 의 flow 버킷을 전부 이어붙임 — 경계는 아직 미확정).
    const flatFlow = [];
    for (const p of srcPages) flatFlow.push(...(Array.isArray(p?.flow) ? p.flow : []));

    // 측정용 단일 논리 flow 문서 — editMode:true 로 개체별 data-oid 래퍼를 방출해 실측 매핑(D-A §2).
    const measureDoc = { pagination: 'scaffold', pages: [{ flow: flatFlow, float: [] }] };
    const { html } = this.renderer.execute(measureDoc, assets, meta, { editMode: true });

    // 측정은 어댑터 소관(document.fonts.ready + KaTeX onload 게이팅 이후에만 수행 — R2-1, 어댑터 계약).
    const { heights, gating } = await this.measurer.measure({ html, timeoutMs: opts.timeoutMs });

    const items = flatFlow.map((obj) => ({ id: obj.id, heightPx: heights?.[obj.id] ?? 0 }));
    const availableHeightPx = computeAvailableHeightPx(meta.paper);
    const { pageOfId, pageCount } = assignFlowToPages(items, availableHeightPx, { tolerancePx: opts.tolerancePx });

    // float 재배치를 포함한 pages[] 재구성은 rebuildPaginatedPages(순수) 로 위임 — 브라우저
    // 편집기 리플로우(S4.2, reflow.js)가 이 Chrome 측정 경로와 동일한 함수를 호출해 하드 동치를 보장한다.
    const pages = rebuildPaginatedPages(srcPages, pageOfId, pageCount);

    return { document: { pagination: 'paginated', pages }, gating, pageOfId };
  }
}
