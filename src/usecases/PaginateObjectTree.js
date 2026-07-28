import { RenderObjectTree } from './RenderObjectTree.js';
import { resolvePaper, paperDims, paperMargins, COLUMN_GAP_MM } from './paper.js';
import { normalizePageIdentity } from '../domain/schema/PageIdentity.js';

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
 * **다단(columns>1)**: 페이지는 열 N 개로 이루어지고, 각 열의 가용 높이는 페이지와 같다(열은
 * 나란히 서므로). `assets/paper.css` 가 `column-fill:auto` + 자식 `break-inside:avoid` 를 쓰므로
 * 브라우저는 **좌열을 끝까지 채우고 다음 열로 넘어가며 블록을 쪼개지 않는다** — 즉 아래의 열 단위
 * 그리디 패킹이 브라우저 동작과 1:1 대응이다. "열 수 × 열 높이"를 한 덩어리 용량으로 합산하면 안
 * 된다: 한 열에 안 들어가는 개체는 다음 열로 밀리며 빈틈을 남기므로 합산은 용량을 과대평가한다.
 *
 * 열 넘김은 CSS 가 하고 **페이지 경계는 계속 이 함수가 혼자 정한다**(D-A 무접촉).
 * columns=1 이면 열 커서가 항상 0 이라 종전 코드와 **완전히 같은 값**을 낸다.
 *
 * @param {Array<{id:string, heightPx:number, breakBefore?:boolean}>} items 순서대로 배치할 flow 개체(평평한 목록). breakBefore 는 page-break 개체 표식.
 * @param {number} availableHeightPx 열 1개의 가용 콘텐츠 높이(px, 상하 여백 제외). 단단이면 곧 페이지 높이.
 * @param {{tolerancePx?:number, columns?:number}} [opts]
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
  const columns = normalizeColumns(opts.columns);

  const pageOfIndex = [];
  const pageOfId = {};
  let cursor = 0;
  let column = 0;
  let page = 0;
  for (const item of items) {
    // page-break 개체: 여기서 페이지를 강제로 끊는다(높이 0). 그리디 패킹만으로는 "여기서
    // 끊어라"를 표현할 방법이 없어 교사가 의도한 페이지 구성이 매 리플로우마다 되돌아갔다.
    // ⚠ 페이지 '용량'을 늘리지는 않는다 — 끊는 위치만 정한다. 넘치는 분량은 여전히 뒤로 밀린다.
    // 이미 새 페이지의 첫 자리(첫 열의 맨 위)면 빈 페이지를 만들지 않도록 건너뛴다.
    if (item?.breakBefore) {
      if (cursor > 0 || column > 0) { page += 1; column = 0; cursor = 0; }
      pageOfIndex.push(page);
      if (item?.id != null) pageOfId[item.id] = page;
      continue;
    }
    const h = Math.max(0, Number(item?.heightPx) || 0);
    // cursor>0(현재 열에 이미 개체가 있음) 이고, 더하면 허용오차를 넘어 넘치면 -> 통째로 다음
    // 열로(열이 남아 있으면), 없으면 다음 페이지 첫 열로. cursor===0(열의 첫 개체)이면 그 개체
    // 혼자 용량을 넘겨도 분할 없이 그대로 싣는다(표 등 분할불가 개체가 "통째 이동"으로 최종
    // 착지하는 지점, R7).
    if (cursor > 0 && cursor + h > availableHeightPx + tolerancePx) {
      if (column + 1 < columns) column += 1;
      else { page += 1; column = 0; }
      cursor = 0;
    }
    pageOfIndex.push(page);
    if (item?.id != null) pageOfId[item.id] = page;
    cursor += h;
  }
  return { pageOfId, pageOfIndex, pageCount: page + 1 };
}

/** 열 수 정규화 — 1 미만·비정수·비수치는 전부 1(단단)로 본다. */
function normalizeColumns(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

// 페이지 경계 안전 버퍼(px) — 실측 근거: 측정은 flow 전체를 단일 논리 페이지로 평탄화해 개체 높이를
// next.top-cur.top 델타로 잰다(인접 개체의 상하 마진은 margin-collapsing 으로 상쇄된 값). 그러나 실제
// 인쇄에서 각 페이지의 "첫 개체"는 상단 마진이 이전 페이지 마지막 개체와 상쇄되지 않고 그대로 살아나
// 페이지 콘텐츠가 델타 합보다 조금 커진다. 콘텐츠가 페이지를 거의 가득 채우면(밀도 높은 활동지) 이
// 누출분(대략 한 블록 상단 마진, ~10~20px)만큼 A4 를 미세 초과해 Chrome 인쇄가 그 페이지를 다음 물리
// 페이지로 쪼갠다(하드 동치 붕괴). 한 줄 남짓의 헤드룸을 예약해 이 누출을 흡수한다 — 편집기 리플로우와
// 엔진 페이지네이터가 같은 함수를 쓰므로 둘의 하드 동치는 유지된다(reflow.js·PaginateObjectTree 공통).
export const PAGE_BOUNDARY_BUFFER_PX = 24;

/**
 * 문서 paper 설정 → 페이지 가용 콘텐츠 높이(px, 상하 여백 + 경계 안전 버퍼 제외). 순수 함수.
 * @param {object|null|undefined} paper manifest.paper 와 동형(미지정이면 A4 세로 기본)
 */
export function computeAvailableHeightPx(paper) {
  const resolved = resolvePaper(paper) ?? resolvePaper({});
  const { h } = paperDims(resolved);
  const m = paperMargins(resolved);
  return (h - m.top - m.bottom) * MM_TO_PX - PAGE_BOUNDARY_BUFFER_PX;
}

/**
 * 문서 paper 설정 → 열 수(1 이상 정수). 순수 함수.
 *
 * 소비자가 둘(편집기 reflow · 엔진 PaginateObjectTree)이라 해석을 여기 한 곳에 둔다 — 둘이
 * 다르게 읽으면 "편집 == 인쇄" 하드 동치가 조용히 깨진다(computeAvailableHeightPx 와 같은 이유).
 * @param {object|null|undefined} paper manifest.paper 와 동형(미지정이면 단단)
 */
export function paperColumns(paper) {
  const resolved = resolvePaper(paper) ?? resolvePaper({});
  return normalizeColumns(resolved?.columns);
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
export function rebuildPaginatedPages(srcPages, pageOfId, pageCount, { idGenerator } = {}) {
  const flatFlow = [];
  const floatByOriginalPage = [];
  for (const p of (Array.isArray(srcPages) ? srcPages : [])) {
    flatFlow.push(...(Array.isArray(p?.flow) ? p.flow : []));
    floatByOriginalPage.push(Array.isArray(p?.float) ? p.float : []);
  }

  const pages = Array.from({ length: pageCount }, (_, index) => ({
    ...(srcPages[index] && typeof srcPages[index] === 'object' ? srcPages[index] : {}),
    flow: [],
    float: [],
  }));
  for (const obj of flatFlow) {
    pages[pageOfId[obj.id] ?? 0].flow.push(obj);
  }
  floatByOriginalPage.forEach((floats, origIdx) => {
    if (floats.length === 0) return;
    const target = Math.min(origIdx, pageCount - 1);
    pages[target].float.push(...floats);
  });
  return normalizePageIdentity(
    { pages },
    idGenerator ? { idGenerator } : undefined,
  ).pages;
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

    const items = flatFlow.map((obj) => ({ id: obj.id, heightPx: heights?.[obj.id] ?? 0, breakBefore: obj.type === 'page-break' }));
    const availableHeightPx = computeAvailableHeightPx(meta.paper);
    const { pageOfId, pageCount } = assignFlowToPages(items, availableHeightPx, {
      tolerancePx: opts.tolerancePx,
      columns: paperColumns(meta.paper),
    });

    // float 재배치를 포함한 pages[] 재구성은 rebuildPaginatedPages(순수) 로 위임 — 브라우저
    // 편집기 리플로우(S4.2, reflow.js)가 이 Chrome 측정 경로와 동일한 함수를 호출해 하드 동치를 보장한다.
    const pages = rebuildPaginatedPages(
      srcPages,
      pageOfId,
      pageCount,
      opts.pageIdGenerator ? { idGenerator: opts.pageIdGenerator } : undefined,
    );

    return { document: { ...document, pagination: 'paginated', pages }, gating, pageOfId };
  }
}
