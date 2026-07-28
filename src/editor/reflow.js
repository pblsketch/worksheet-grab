// reflow.js — editor-v4 S4.2(M4a) 편집기 내장 브라우저 paginator(D-A 의 편집기 측 절반).
//
// PaginateObjectTree.js(US-09/S2.5)의 순수 계산부(assignFlowToPages·computeAvailableHeightPx·
// rebuildPaginatedPages)를 그대로 재사용한다 — 측정만 Chrome 어댑터(PaginationMeasurer.js) 대신
// 편집기 자신의 브라우저(숨은 iframe)로 대체한다(과제 지시 §필독 3: "편집기 자신이 브라우저").
// 이 파일은 browserGraph 화이트리스트 대상이 아니다(/editor/ 경로는 검수 체인과 무관하게 항상
// 서빙된다, EditorHttpServer.js:457) — 다만 여기서 정적 import 하는 /src/usecases/*.js 는
// browserGraph 의 PaginateObjectTree.js 엔트리(및 그 전이 그래프)로 이미 화이트리스트되어 있다.
//
// 측정 규약은 US-09 어댑터(src/adapters/PaginationMeasurer.js)와 완전히 동일해야 "편집==인쇄
// 하드 동치"(R2-1)가 성립한다:
//   1) flow 전체를 단일 논리 페이지로 평탄화해 렌더(RenderObjectTree, editMode:true) — float 은
//      제외(리플로우 대상 아님, float 은 페이지 절대좌표 귀속을 그대로 유지한다).
//   2) document.fonts.ready + (KaTeX auto-render 스크립트가 있으면) window.renderMathInElement
//      등록 완료까지 게이팅.
//   3) 개체별 "점유 높이"는 자기 자신의 bounding height 가 아니라 다음 개체 top 까지의 델타
//      (margin-collapsing 보정, PaginationMeasurer.js measureInPage 주석과 동일 근거).
//
// 측정용 HTML 은 RenderObjectTree.execute(assets 빈 문자열)로 뼈대(head/pagesHtml 구조·컬럼 래퍼
// 등)만 얻고, 실제 CSS 는 이미 로드되어 있는 teacher iframe 의 <style> 원문을 그대로 이식한다 —
// 서버에 paperCss/blocksCss/themeCss 를 별도로 요청하는 새 엔드포인트 없이 이미 초기 셸 로드 시
// 받은 teacherHtml 문자열 안의 CSS 를 재사용한다(과제 범위: EditorHttpServer 등 엔진 유스케이스는
// 손대지 않는다).
//
// 다단(columns) 지원(2026-07-29): assignFlowToPages 에 열 수를 넘겨 열 단위로 채운다. 여기서
// 재는 높이는 열 폭 기준으로 이미 맞다 — 측정 렌더도 문서와 같은 columns 를 쓰므로 본문이 열 폭에서
// 접힌다.
//
// 알려진 미세 오차(기록): 측정은 flow 전체를 단일 논리 페이지에 펼치므로 열 경계에서 다음 개체의
// top 이 되돌아가 `next.top - cur.top` 델타가 음수가 되고, 상류에서 0 으로 잘린다 — 열 경계마다
// 개체 하나의 높이가 0 으로 계산된다. 측정 중에만 열을 하나로 접어 없앨 수 있으나, 2단·3단 픽스처
// 어느 쪽으로도 페이지 귀속이 달라지지 않아(변이 실험) **검증할 수 없는 코드는 싣지 않았다.**
// 이 오차가 실제로 경계를 바꾸는 사례를 만나면 그때 접는 방식을 넣을 것.

import { RenderObjectTree, deriveRenderMeta } from '/src/usecases/RenderObjectTree.js';
import { assignFlowToPages, computeAvailableHeightPx, paperColumns, rebuildPaginatedPages } from '/src/usecases/PaginateObjectTree.js';

const renderer = new RenderObjectTree();
const STYLE_RE = /<style>[\s\S]*?<\/style>/;
const MEASURE_IFRAME_WIDTH = 1200; // ChromePaginationMeasurer 의 --window-size=1200,1600 과 동일(측정 폭 정합).

/** document(개체 트리) 의 pages[] 를 순서대로 이어붙인 평평한 flow 목록(float 제외). */
export function flattenFlow(document) {
  const flow = [];
  for (const p of document?.pages || []) {
    if (Array.isArray(p?.flow)) flow.push(...p.flow);
  }
  return flow;
}

/** RenderObjectTree 렌더용 meta — 파생 규칙은 RenderObjectTree.js 가 소유한다(Phase 5: 저장·셸
 *  조립·리플로우 세 경로가 문자 그대로 같은 meta 를 얻어야 R2-1 편집==인쇄 동치가 성립한다).
 *  편집기 호출부는 이 이름을 그대로 쓰므로 재수출로 남긴다. */
export { deriveRenderMeta as buildRenderMeta };

/** teacherHtml(문서 전체 HTML 문자열) 에서 <style>…</style> 블록 원문을 그대로 뽑아낸다. */
export function extractStyleTag(teacherHtml) {
  const m = STYLE_RE.exec(String(teacherHtml || ''));
  return m ? m[0] : '<style></style>';
}

/** flatFlow 를 단일 논리 페이지로 렌더한 "뼈대" HTML 에 실제 CSS(styleTag)를 이식한다. */
function buildMeasureHtml(flatFlow, { renderMeta, styleTag }) {
  const measureDoc = { pagination: 'scaffold', pages: [{ flow: flatFlow, float: [] }] };
  const { html: skeleton } = renderer.execute(
    measureDoc,
    { paperCss: '', blocksCss: '', themeCss: '' },
    renderMeta,
    { editMode: true },
  );
  return STYLE_RE.test(skeleton) ? skeleton.replace(STYLE_RE, styleTag) : skeleton;
}

/** RenderObjectTree(교사용, editMode:true) 전체 문서를 렌더 + 실제 CSS 이식 — 리플로우 후 재로드용. */
export function buildFullHtml(document, { renderMeta, styleTag }) {
  const { html: skeleton } = renderer.execute(
    document,
    { paperCss: '', blocksCss: '', themeCss: '' },
    renderMeta,
    { editMode: true },
  );
  return STYLE_RE.test(skeleton) ? skeleton.replace(STYLE_RE, styleTag) : skeleton;
}

/** document.fonts.ready + KaTeX 완료 게이팅(PaginationMeasurer.js gateInPage 와 동형, 페이지 컨텍스트 재사용 불가라 복제). */
async function gateReady(win) {
  const doc = win.document;
  await doc.fonts.ready;
  const hadKatex = !!doc.querySelector('script[src*="auto-render"]');
  if (hadKatex) {
    await new Promise((resolve) => {
      const check = () => {
        if (typeof win.renderMathInElement === 'function') { resolve(); return; }
        win.requestAnimationFrame(check);
      };
      check();
    });
  }
  return { fontsReady: true, katexReady: true, hadKatex, gatedAt: Date.now() };
}

/** data-oid 개체의 top 델타 측정(margin-collapsing 보정) — PaginationMeasurer.js measureInPage 와 동일 규약. */
function measureTopDeltas(win) {
  const els = [...win.document.querySelectorAll('[data-oid]')];
  const rects = els.map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-oid'), top: r.top, height: r.height };
  });
  const out = {};
  for (let i = 0; i < rects.length; i++) {
    const cur = rects[i];
    const next = rects[i + 1];
    out[cur.id] = next ? (next.top - cur.top) : cur.height;
  }
  return out;
}

/**
 * measureFlow — flatFlow 를 숨은 iframe 에 단일 논리 페이지로 렌더해 게이팅 후 실측한다
 * (ChromePaginationMeasurer.measure 와 동형 계약: {html} 대신 {flatFlow, renderMeta, styleTag} 를
 * 받고, Chrome CDP 대신 이 브라우저 자신의 iframe 을 쓴다).
 * @param {object[]} flatFlow
 * @param {{renderMeta:object, styleTag:string, timeoutMs?:number, doc?:Document}} opts
 * @returns {Promise<{heights:Record<string,number>, gating:object}>}
 */
export async function measureFlow(flatFlow, { renderMeta, styleTag, timeoutMs = 10000, doc = document } = {}) {
  if (!Array.isArray(flatFlow) || flatFlow.length === 0) {
    return { heights: {}, gating: { fontsReady: true, katexReady: true, hadKatex: false, gatedAt: Date.now() } };
  }
  const html = buildMeasureHtml(flatFlow, { renderMeta, styleTag });

  const iframe = doc.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = `position:fixed; left:-99999px; top:0; width:${MEASURE_IFRAME_WIDTH}px; height:10px; visibility:hidden; border:0;`;
  doc.body.appendChild(iframe);
  try {
    const loaded = new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
    iframe.srcdoc = html;
    await Promise.race([
      loaded,
      new Promise((_, reject) => setTimeout(() => reject(new Error('reflow 측정 iframe 로드 타임아웃')), timeoutMs)),
    ]);
    const gating = await gateReady(iframe.contentWindow);
    const heights = measureTopDeltas(iframe.contentWindow);
    return { heights, gating };
  } finally {
    iframe.remove();
  }
}

/**
 * applyReflow — 순수 계산: 실측 heights → assignFlowToPages(US-09) → rebuildPaginatedPages(US-09) 로
 * 새 pages[] 를 구성한다. float 은 계산 입력(items)에 아예 포함되지 않는다(리플로우 제외 원칙) —
 * rebuildPaginatedPages 가 원래 페이지 인덱스를 그대로 보존(페이지 자체가 사라진 극단적 경우만 클램프).
 * @param {object} document 현재 편집기 문서(core.getDocument())
 * @param {Record<string,number>} heights measureFlow 산출
 * @param {{tolerancePx?:number}} [opts]
 * @returns {{document:object, pageOfId:Record<string,number>, changed:boolean}}
 */
export function applyReflow(document, heights, opts = {}) {
  const srcPages = Array.isArray(document?.pages) ? document.pages : [];
  const flatFlow = flattenFlow(document);
  const items = flatFlow.map((obj) => ({ id: obj.id, heightPx: heights?.[obj.id] ?? 0, breakBefore: obj.type === 'page-break' }));
  const availableHeightPx = computeAvailableHeightPx(document?.paper ?? null);
  const { pageOfId, pageCount } = assignFlowToPages(items, availableHeightPx, {
    tolerancePx: opts.tolerancePx,
    columns: paperColumns(document?.paper ?? null),
  });
  const pages = rebuildPaginatedPages(
    srcPages,
    pageOfId,
    pageCount,
    opts.pageIdGenerator ? { idGenerator: opts.pageIdGenerator } : undefined,
  );

  const changed = pageAssignmentChanged(srcPages, pages);
  return { document: { ...document, pages }, pageOfId, changed };
}

/** flow 개체의 id→페이지 인덱스 매핑이 이전과 완전히 같은지(순서·페이지 수 포함) 비교. */
function pageAssignmentChanged(srcPages, nextPages) {
  if (srcPages.length !== nextPages.length) return true;
  for (let i = 0; i < srcPages.length; i++) {
    const a = (srcPages[i]?.flow || []).map((o) => o.id);
    const b = (nextPages[i]?.flow || []).map((o) => o.id);
    if (a.length !== b.length || a.some((id, idx) => id !== b[idx])) return true;
  }
  return false;
}

/**
 * reflowDocument — measureFlow + applyReflow 결합(편집기 편의 API). editor.js 는 이 함수 하나만
 * 부르면 된다.
 * @param {object} document
 * @param {{styleTag:string, tolerancePx?:number, timeoutMs?:number, doc?:Document}} opts
 * @returns {Promise<{document:object, pageOfId:Record<string,number>, changed:boolean, gating:object}>}
 */
export async function reflowDocument(document, { styleTag, tolerancePx, timeoutMs, doc } = {}) {
  const flatFlow = flattenFlow(document);
  const renderMeta = deriveRenderMeta(document);
  const { heights, gating } = await measureFlow(flatFlow, { renderMeta, styleTag, timeoutMs, doc });
  const result = applyReflow(document, heights, { tolerancePx });
  return { ...result, gating };
}
