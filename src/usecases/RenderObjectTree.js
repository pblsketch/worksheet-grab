import { escapeHtml, wrapSheetBody, buildSheetSection, buildDocumentHtml } from './AssembleWorksheet.js';
import { resolvePaper, paperCss as paperCssOverride } from './paper.js';
// 크기 필드 범위(2026-07-28) — 렌더가 방어적으로 재확인한다(아래 flowBoxStyle 주석). ObjectCatalog 는
// browserGraph 화이트리스트에 이미 있으므로 편집기 ESM 그래프에서도 404 나지 않는다(실측 확인).
import { WIDTH_PCT_MIN, WIDTH_PCT_MAX, CALLOUT_VARIANTS, ORGANIZER_KINDS } from '../domain/schema/ObjectCatalog.js';
// 편집 가능 그림형 조직자(P3) — 렌더는 엔진(OrganizerGen)이 SVG 를 그리는 단일 출처를 그대로 호출한다.
// 잠금 richtext 가 삽입 시점에 굽던 것과 같은 생성기라 편집==인쇄가 구조적으로 성립한다(원칙 3·R2-1).
import { ORGANIZER_GENERATORS } from './OrganizerGen.js';

// RenderObjectTree — S2.1(M2) 순수 render-core(06_plan_final.md 150~152행, C-5/GAP-2).
//
// 입력: 개체 트리 문서(ValidateObjectTree 가 검사하는 것과 같은 스키마) + 주입 자산(CSS 문자열 등 —
// 자산 I/O 는 호출부가 미리 읽어(hoist) 인자로 넘긴다. FS/Chrome/DOM 무지).
// 출력: 완전한 A4 HTML 문자열(paper-css `.sheet` 페이지 컨테이너, AssembleWorksheet 산출과 동일 골격
// — head/섹션 조립은 AssembleWorksheet.js 에서 export 된 순수 함수를 재사용해 중복을 피한다, C1).
//
// AssembleWorksheet(블록 HTML manifest 경로)는 존치되며 이 클래스는 개체 트리 문서 전용 신규 경로다.
// 두 경로는 서로 호출하지 않고 head/섹션 조립 조각만 공유한다.
//
// 페이지 경계는 document.pages[] 를 **honor 만** 한다(D-A) — 스스로 페이지를 나누지 않는다. flow 는
// 문서 흐름 순서 그대로, float 은 페이지 컨테이너(.sheet) 안에서 position:absolute(rect, mm 단위)로
// 배치한다. 표(table)는 break-inside:avoid 로 분할을 막는다(splittable:false 불변식, S1.1).
//
// answer:true 개체는 `.answer` 클래스로 감싸 방출한다 — assets/blocks.css 의
// `.answer{display:none}` / `[data-mode="teacher"] .answer{display:block}` 규칙과 MODE_TOKEN 을
// 그대로 승계해, 향후 BuildVariants(S2.2)가 손댈 것 없이 학생/교사 분기를 그대로 적용할 수 있다.
//
/**
 * deriveRenderMeta — 개체 트리 document 에서 execute() 의 meta 인자를 파생한다.
 *
 * Phase 5(중복 렌더 경로 제거): 이 9줄이 SaveDocument.checkpoint · RenderEditorShell.executeObjectTree ·
 * editor/reflow.js 세 곳에 글자 그대로 복제돼 있었다(주석도 "…와 동형 파생"이라 적혀 있었다).
 * meta 의 형태는 RenderObjectTree.execute 의 계약이므로 여기가 그 계약의 집이다. 브라우저
 * 화이트리스트(browserGraph) 안의 파일이라 편집기(reflow.js)도 같은 함수를 그대로 쓴다 —
 * 편집기 측정과 인쇄가 문자 그대로 같은 meta 를 얻어야 R2-1 편집==인쇄 동치가 성립한다.
 *
 * @param {object} document 개체 트리 문서
 * @returns {object} execute() 의 meta 인자
 */
export function deriveRenderMeta(document) {
  return {
    lang: document?.lang || 'ko',
    docTitle: document?.docTitle || '',
    dataSubject: document?.dataSubject || document?.subject || '',
    themeName: document?.themeName || '',
    runHead: document?.runHead || '',
    runFoot: document?.runFoot || {},
    katex: !!(document?.head && document.head.katex),
    paper: document?.paper ?? null,
    standards: Array.isArray(document?.standards) ? document.standards : [],
  };
}

// 결정적(순수 함수) — 같은 document/assets/meta 입력이면 항상 같은 HTML 문자열을 반환한다
// (Date.now/Math.random/전역 상태 참조 없음).
export class RenderObjectTree {
  /**
   * @param {{pagination:string, pages:Array<{flow:object[], float:object[]}>}} document 개체 트리 문서
   * @param {{paperCss:string, blocksCss:string, themeCss:string}} assets 호출부가 미리 읽어 주입한 CSS
   *   문자열(FS 무지 — readAsset/loadThemeCss 는 호출부 책임).
   * @param {{lang?:string, docTitle?:string, dataSubject?:string, themeName?:string, runHead?:string,
   *   runFoot?:{left?:string, rightPrefix?:string, right?:string}, katex?:boolean, paper?:object,
   *   standards?:Array<{code:string, text:string}>}} [meta] std-box 렌더용 성취기준 원문은
   *   meta.standards 로 이미 해석되어 주입되어야 한다(원칙 3 — 렌더 코어는 CSV/MCP 를 조회하지 않는다).
   * @param {{editMode?:boolean}} [opts] editMode: 개체 경계 래퍼(data-oid 기반, D-A/HANDOFF §6) 방출.
   * @returns {{html:string}}
   */
  execute(document, assets, meta = {}, opts = {}) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new TypeError('RenderObjectTree.execute 는 개체 트리 문서(document)가 필요합니다.');
    }
    if (!assets || typeof assets.paperCss !== 'string' || typeof assets.blocksCss !== 'string' || typeof assets.themeCss !== 'string') {
      throw new TypeError('RenderObjectTree.execute 는 assets{paperCss,blocksCss,themeCss}(문자열)가 필요합니다.');
    }
    const editMode = !!opts.editMode;

    // manifest.paper 와 동형 오버라이드(paper.js 는 이미 순수 함수 — AssembleWorksheet 와 같은 경로 재사용).
    const resolvedPaper = resolvePaper(meta.paper ?? null);
    const paperOverride = paperCssOverride(resolvedPaper);
    const paper = paperOverride ? `${assets.paperCss}\n${paperOverride}` : assets.paperCss;
    const columns = resolvedPaper?.columns ?? 1;

    const runHead = meta.runHead || '';
    const runFoot = meta.runFoot || {};
    const footLeft = runFoot.left || '';
    const footRightPrefix = runFoot.rightPrefix ?? runFoot.right ?? '';

    const standardsByCode = new Map(
      (meta.standards || []).map((s) => [String(s.code).replace(/^\[|\]$/g, ''), s.text]),
    );
    const ctx = { standardsByCode, editMode };

    const pages = Array.isArray(document.pages) ? document.pages : [];
    const pagesHtml = pages.map((page, idx) => {
      const pageNo = idx + 1;
      const flow = Array.isArray(page?.flow) ? page.flow : [];
      const float = Array.isArray(page?.float) ? page.float : [];

      // flow = 문서 흐름 순서(배열 순서 그대로 join) — 리플로우 경계 자체는 계산하지 않는다(D-A).
      const flowHtml = flow.map((obj) => renderFlowObject(obj, ctx)).join('\n\n  ');
      const bodyOut = wrapSheetBody(flowHtml, columns);

      // float = 페이지 컨테이너(.sheet) 직속 절대좌표 자식 — 컬럼 흐름 밖(HANDOFF §8, D-A).
      const floatHtml = float.map((obj) => renderFloatObject(obj, ctx)).join('\n');
      const bodyWithFloat = floatHtml ? `${bodyOut}\n\n  ${floatHtml}` : bodyOut;

      return buildSheetSection({
        pageNo,
        pageId: page?.id,
        runHead,
        bodyOut: bodyWithFloat,
        footLeft,
        footRightPrefix,
      });
    }).join('\n\n');

    const html = buildDocumentHtml({
      lang: meta.lang || 'ko',
      docTitle: meta.docTitle || '',
      katexEnabled: !!meta.katex,
      paperCss: paper,
      blocksCss: assets.blocksCss,
      themeCss: assets.themeCss,
      themeName: meta.themeName || '',
      dataSubject: meta.dataSubject || '',
      pagesHtml,
    });

    return { html };
  }
}

// ── 개체 1개 → HTML(flow/float 공통 래핑) ──

/** answer:true 개체는 `.answer` 로 감싼다(타입 무관 — BuildVariants/paper.css 승계, S2.2 예고). */
function renderAnswerWrap(obj, inner) {
  return obj.answer === true ? `<div class="answer">${inner}</div>` : inner;
}

/**
 * flow 개체의 크기·정렬 선언(2026-07-28 — docs/DECISION-object-resize.md). 없으면 빈 문자열.
 *
 * **인라인으로 방출하는 이유(R2-1).** 편집 화면과 인쇄가 같은 선언을 써야 페이지 경계가 갈리지
 * 않는다. 편집 전용 CSS(editorStyle.js)에 크기를 주면 리플로우 측정은 그 값을 보고 인쇄는 못 봐서
 * 페이지 수가 어긋난다 — renderSpacer 의 heightMm 이 정확히 같은 이유로 인라인이다.
 *
 * widthPct 가 %인 것이 핵심이다 — 포함 블록(`.sheet-body` 의 열 폭) 기준으로 해석되므로 용지·단 수를
 * 바꿔도 비율이 유지된다(mm 였다면 열을 넘겨 클램프가 필요하고, 클램프는 값을 되돌릴 수 없게 덮어쓴다).
 *
 * 값 범위를 **여기서 다시 확인하는 이유**: 렌더는 검증을 안 거친 문서(마이그레이션 중간물 등)도 받고,
 * 이 값은 인라인 style 에 그대로 들어간다 — 범위 밖 수가 새어 나가면 조판이 깨진다. 통과 못 한 필드는
 * 선언 자체를 생략해 기본 동작(폭 100%·높이 내용대로)으로 되돌린다.
 *
 * ⚠ min-height 는 마진 상쇄를 막는다(CSS: bottom 마진 상쇄는 height:auto && min-height:0 일 때만).
 * 그래서 크기를 준 개체는 안 준 개체와 상하 간격이 미세하게 다를 수 있다 — 그러나 **편집과 인쇄가
 * 같은 래퍼를 쓰므로 둘 사이의 동치는 그대로 성립한다**(R2-1 이 요구하는 것은 그것뿐이다).
 */
/** 최소높이 선언이 실제로 나가는가 — 아래 style 생성과 `data-minh` 표식이 **같은 판정**을 쓰도록
 *  하나로 묶는다(갈라지면 표식만 붙고 높이는 없거나 그 반대가 되어 stretch 가 조용히 어긋난다). */
function hasMinHeight(obj) {
  const minH = obj?.minHeightMm;
  return typeof minH === 'number' && Number.isFinite(minH) && minH > 0;
}

function flowBoxStyle(obj) {
  const decl = [];
  const pct = obj?.widthPct;
  if (typeof pct === 'number' && Number.isFinite(pct) && pct >= WIDTH_PCT_MIN && pct <= WIDTH_PCT_MAX) {
    decl.push(`width:${pct}%`);
  }
  if (hasMinHeight(obj)) {
    decl.push(`min-height:${obj.minHeightMm}mm`);
  }
  // align 은 margin-inline 으로만 낸다(높이 무영향 = R2-1 무위험). 폭을 줄이지 않았으면 시각 효과가
  // 없지만(auto 마진이 남는 공간이 없다) 선언을 막지는 않는다 — 폭을 나중에 줄이면 바로 살아난다.
  // 'left' 는 기본값이라 선언을 만들지 않는다: 미지정 개체의 출력을 기준선과 문자 그대로 같게 둔다.
  if (obj?.align === 'center') decl.push('margin-inline:auto');
  else if (obj?.align === 'right') decl.push('margin-inline:auto 0');
  return decl.length > 0 ? `${decl.join('; ')};` : '';
}

function renderFlowObject(obj, ctx) {
  const inner = renderAnswerWrap(obj, renderByType(obj, ctx));
  // 방출 조건이 `editMode` 가 아니라 **`editMode || 선언있음`** 인 것이 이 함수의 핵심이다.
  // 이 래퍼는 원래 editMode 에서만 나왔다 — 크기를 여기 얹으면서 조건을 그대로 뒀다면 편집에만
  // 적용되고 인쇄에는 빠져 R2-1(편집==인쇄)이 조용히 깨진다. 편집 전용 CSS 를 피하고도 같은 붕괴가
  // 나는, 더 은밀한 경로다. 선언이 없는 개체는 종전대로 래퍼 없이 inner 만 내므로 인쇄 출력이
  // 기준선과 바이트 단위로 같다(회귀 0) — 이 두 성질을 render-object-size.test.js 가 단정한다.
  const boxStyle = flowBoxStyle(obj);
  if (!ctx.editMode && !boxStyle) return inner;
  // editMode 개체 경계 래퍼 — data-oid 기반(D-A/HANDOFF §6, AssembleWorksheet 의 wg-block 관례와 동형).
  const oidAttrs = ctx.editMode
    ? ` data-oid="${escapeHtml(String(obj.id))}" data-ot="${escapeHtml(obj.type)}"`
    : '';
  const styleAttr = boxStyle ? ` style="${boxStyle}"` : '';
  // 최소높이를 준 개체는 **속 내용도 함께** 늘어나야 한다. 종전엔 래퍼만 커지고 안의 실제 상자
  // (`.title-box` 등)는 제 높이를 지켜서, 교사 눈에는 "영역만 늘어나지 테두리 높낮이는 안 바뀐다"로
  // 보였다(사용자 보고, 실측: 래퍼 93→112px 인데 .title-box 는 93px 그대로).
  // 표식만 붙이고 stretch 는 CSS(paper.css)가 건다 — 인쇄·편집이 같은 스타일시트를 쓰므로 R2-1 유지.
  // 폭만 준 개체에는 붙이지 않는다: 블록 자식은 폭을 이미 채우고, flex 로 바꾸면 마진 상쇄가 사라져
  // 선언 없던 문서의 레이아웃까지 흔든다.
  const minHAttr = hasMinHeight(obj) ? ' data-minh="1"' : '';
  return `<div class="wg-obj"${oidAttrs}${minHAttr}${styleAttr}>${inner}</div>`;
}

function renderFloatObject(obj, ctx) {
  const inner = renderAnswerWrap(obj, renderByType(obj, ctx));
  const rect = obj.rect || {};
  let style = `position:absolute; left:${mm(rect.xMm)}; top:${mm(rect.yMm)}; width:${mm(rect.wMm)}; height:${mm(rect.hMm)};`;
  // 표현 속성(자유 배치 전용) — 기본값(불투명·무회전)이면 style 을 늘리지 않는다(편집=인쇄 동일, 인쇄 반영).
  const opacity = typeof obj.opacity === 'number' ? Math.max(0, Math.min(1, obj.opacity)) : 1;
  if (opacity < 1) style += ` opacity:${opacity};`;
  const angle = typeof obj.angle === 'number' ? Math.max(-180, Math.min(180, obj.angle)) : 0;
  if (angle) style += ` transform:rotate(${angle}deg); transform-origin:center center;`;
  const oidAttrs = ctx.editMode
    ? ` data-oid="${escapeHtml(String(obj.id))}" data-ot="${escapeHtml(obj.type)}"`
    : '';
  return `  <div class="wg-float" style="${style}"${oidAttrs}>${inner}</div>`;
}

function mm(n) {
  return `${Number(n)}mm`;
}

// ── 타입별 렌더 함수(닫힌 카탈로그 12종, HANDOFF §1) — loadBlockHtml(불투명 HTML) 대체 ──

/**
 * 인라인 편집 가능한 "부가 텍스트 조각"의 편집 좌표를 실어 주는 속성 문자열(#1/#1b).
 *
 * `.q-part`(선지·항목)와 같은 규약을 개체 전반으로 넓힌 것이다 — editMode 에서만 data-part(필드 경로)·
 * data-i(배열 인덱스)를 붙이고, editor/partEdit.js 가 그 좌표로 개체 필드를 되쓴다. **속성만** 늘리므로
 * 레이아웃 박스는 편집(editMode:true)과 인쇄(false)가 문자 그대로 같다 — R2-1(편집==인쇄) 안전.
 * 값이 없는 조각은 호출부가 애초에 그리지 않는다(editMode 전용 빈 요소를 만들면 편집 측정 높이와
 * 인쇄 높이가 갈린다 — selection.js 의 image-slot 캡션 주석과 같은 규약, 새로 다는 것은 인스펙터 몫).
 */
function partAttr(ctx, field, index = null) {
  if (!ctx || !ctx.editMode) return '';
  return ` data-part="${escapeHtml(field)}"${index != null ? ` data-i="${index}"` : ''}`;
}

/**
 * 사용자 지정 색을 CSS 값 자리에 넣기 전 검사한다 — 인라인 style 에 들어가므로 escapeHtml 만으로는
 * `;` 로 선언을 끊고 다른 속성을 주입하는 걸 못 막는다. 편집기 색 입력(#rrggbb)과 'transparent'·
 * 'none' 같은 키워드만 통과시킨다. 통과 못 하면 null → 호출부가 그 선언 자체를 생략(기본값 유지).
 */
function cssColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]+$/.test(v)) return v;
  return null;
}

function renderByType(obj, ctx) {
  switch (obj.type) {
    case 'title': return renderTitle(obj, ctx);
    case 'passage-slot': return renderPassageSlot(obj, ctx);
    case 'question': return renderQuestion(obj, ctx);
    case 'table': return renderTable(obj, ctx);
    case 'image-slot': return renderImageSlot(obj, ctx);
    case 'answer-area': return renderAnswerArea(obj);
    case 'divider': return renderDivider();
    case 'shape': return renderShape(obj);
    case 'richtext': return renderRichtext(obj);
    case 'std-box': return renderStdBox(obj, ctx);
    case 'callout': return renderCallout(obj);
    case 'organizer': return renderOrganizer(obj);
    case 'spacer': return renderSpacer(obj);
    case 'page-break': return renderPageBreak();
    default:
      throw new Error(`RenderObjectTree: 닫힌 카탈로그(14종) 밖의 타입입니다: ${obj?.type}`);
  }
}

function renderTitle(obj, ctx = {}) {
  const level = obj.level === 2 ? 2 : 1;
  const tag = level === 1 ? 'h1' : 'h2';
  const meta = obj.meta || {};
  // 배지·모서리 표기·출처는 인스펙터에서만 고칠 수 있었다(#1b) — 값이 있으면 본문에서도
  // 더블클릭으로 바로 고치도록 편집 좌표(meta.*)를 싣는다. 새로 다는 것은 여전히 인스펙터 몫.
  const pill = meta.pill ? `<span class="pill wg-part"${partAttr(ctx, 'meta.pill')}>${escapeHtml(meta.pill)}</span>\n    ` : '';
  const page = meta.page ? `<span class="corner-ref wg-part"${partAttr(ctx, 'meta.page')}>${escapeHtml(meta.page)}</span>\n    ` : '';
  const source = meta.source ? `\n    <div class="title-src wg-part"${partAttr(ctx, 'meta.source')}>${escapeHtml(meta.source)}</div>` : '';
  // textHtml(인라인 서식 살균 HTML)이 있으면 그대로 방출(richtext.html 관례 — 이스케이프 없음),
  // 없으면 평문 text 를 이스케이프(하위호환).
  const titleInner = typeof obj.textHtml === 'string' && obj.textHtml !== '' ? obj.textHtml : escapeHtml(obj.text);
  return `<div class="title-wrap">
    ${pill}${page}<div class="title-box"><${tag}>${titleInner}</${tag}></div>${source}
  </div>`;
}

/**
 * 저작권 지문(2층 정책, 2026-07-23): bodyHtml 이 채워져 있으면 교사가 입력한 본문을 렌더(richtext.html
 * 과 동형 관례 — 무손실 HTML, 이스케이프 없이 그대로 방출)하고, 비어 있으면 현행 슬롯 플레이스홀더
 * 박스(.slot)를 렌더한다. source 는 있으면 출처 표기 줄을 덧붙인다(둘 중 어느 분기든).
 */
function renderPassageSlot(obj, ctx = {}) {
  const titleHtml = obj.title ? `<h3 class="wg-part"${partAttr(ctx, 'title')}>${escapeHtml(obj.title)}</h3>\n  ` : '';
  const hasBody = typeof obj.bodyHtml === 'string' && obj.bodyHtml.trim() !== '';
  const bodyOrSlot = hasBody
    ? `<div class="passage-body">${obj.bodyHtml}</div>`
    : `<div class="slot">${escapeHtml(obj.slotLabel)}</div>`;
  // "출처: " 접두는 고정 문구라 편집 대상 밖에 둔다 — 값만 감싸야 되읽기(textContent)에 접두가 섞이지 않는다.
  const source = obj.source
    ? `\n  <div class="src">출처: <span class="wg-part"${partAttr(ctx, 'source')}>${escapeHtml(obj.source)}</span></div>`
    : '';
  // 박스 서식(#3) — 지문마다 성격이 달라(안내문·인용·자료) 색으로 구분하고 싶다는 요구.
  // blocks.css `.passage` 가 var(--wg-ps-*, 기본값) 로 받으므로 미지정 개체는 현행 그대로다.
  const decl = [];
  const bc = cssColor(obj.borderColor);
  if (bc) decl.push(`--wg-ps-border:${bc}`);
  if (Number.isFinite(obj.borderWidth) && obj.borderWidth >= 0) decl.push(`--wg-ps-bw:${obj.borderWidth}px`);
  const bg = cssColor(obj.bgColor);
  if (bg) decl.push(`--wg-ps-bg:${bg}`);
  const styleAttr = decl.length ? ` style="${decl.join('; ')};"` : '';
  return `<div class="passage"${styleAttr}>
  ${titleHtml}${bodyOrSlot}${source}
</div>`;
}

function renderQuestion(obj, ctx = {}) {
  const qnum = obj.qnum != null ? `<span class="qnum">${escapeHtml(String(obj.qnum))}</span>` : '';
  // promptHtml(인라인 서식 살균 HTML)이 있으면 그대로 방출, 없으면 평문 prompt 이스케이프(하위호환).
  const promptInner = typeof obj.promptHtml === 'string' && obj.promptHtml !== '' ? obj.promptHtml : escapeHtml(obj.prompt);
  const parts = [`<div class="q">${qnum}${promptInner}</div>`];
  const body = renderQuestionBody(obj, ctx);
  if (body) parts.push(body);
  if (obj.answerKey) {
    // answerKey.html 은 마이그레이션이 보존한 원본 마크업(무손실) — 그대로 방출, escape 하지 않는다.
    const akHtml = typeof obj.answerKey.html === 'string' ? obj.answerKey.html : escapeHtml(String(obj.answerKey.text ?? ''));
    parts.push(`<div class="answer">${akHtml}</div>`);
  }
  return `<div class="qbox" data-qtype="${escapeHtml(obj.qtype)}">
  ${parts.join('\n  ')}
</div>`;
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/** 보기/좌우/항목 원소는 문자열이거나 {id,text} 객체 둘 다 될 수 있다(마이그레이션·저작 경로 차이). */
function cellText(x) {
  if (x == null) return '';
  if (typeof x === 'string' || typeof x === 'number') return String(x);
  if (typeof x.text === 'string') return x.text;
  if (typeof x.label === 'string') return x.label;
  return '';
}

/**
 * qtype 7종을 시각적으로 구분되게 렌더한다(전엔 prompt 만 그려 모든 유형이 같은 블록으로 보였다 —
 * 사용자 피드백 #12). 객관식=보기 목록, 참/거짓=문장별 O/X, 연결형=좌우 2열 연결표, 순서배열=번호칸,
 * 단답형=한 줄 답란, 서술형=여러 줄 답란, 빈칸=낱말상자(있을 때). 정답 표기는 answerKey/answer 소관.
 */
/** 선지·항목 등 편집 가능한 조각(#3) — editMode 에서 data-part(배열명)·data-i(인덱스)를 실어
 *  partEdit.js 가 더블클릭 인라인 편집으로 배열 원소를 되쓴다. 인쇄 모드에선 평범한 span. */
function part(text, field, i, ctx, extraClass = '') {
  const cls = `q-part${extraClass ? ` ${extraClass}` : ''}`;
  const attrs = ctx.editMode ? ` data-part="${field}" data-i="${i}"` : '';
  return `<span class="${cls}"${attrs}>${escapeHtml(text)}</span>`;
}

function renderQuestionBody(obj, ctx = {}) {
  switch (obj.qtype) {
    case 'multiple-choice': {
      const choices = Array.isArray(obj.choices) ? obj.choices : [];
      if (choices.length === 0) return '';
      const lis = choices.map((c, i) =>
        `<li><span class="q-mark">${CIRCLED[i] || `${i + 1}.`}</span>${part(cellText(c), 'choices', i, ctx)}</li>`).join('');
      return `<ul class="q-choices">${lis}</ul>`;
    }
    case 'true-false': {
      // 참/거짓은 판별할 문장을 choices 에 담는다(마이그레이션 데이터) — 문장마다 O/X 칸을 준다.
      // 문장이 없으면(신규 저작 기본) 단일 참/거짓 선택칸을 보인다.
      const stmts = Array.isArray(obj.choices) ? obj.choices : [];
      if (stmts.length === 0) {
        return '<div class="q-tf"><label><span class="q-box"></span> 참(O)</label><label><span class="q-box"></span> 거짓(X)</label></div>';
      }
      const lis = stmts.map((s, i) =>
        `<li><span class="q-mark">${CIRCLED[i] || `${i + 1}.`}</span>${part(cellText(s), 'choices', i, ctx, 'q-tf-stmt')}`
        + '<span class="q-tf-ox">( &nbsp; O &nbsp;/ &nbsp; X &nbsp;)</span></li>').join('');
      return `<ul class="q-tf-list">${lis}</ul>`;
    }
    case 'matching': {
      const left = Array.isArray(obj.left) ? obj.left : [];
      const right = Array.isArray(obj.right) ? obj.right : [];
      const n = Math.max(left.length, right.length);
      if (n === 0) return '';
      const rows = Array.from({ length: n }, (_, i) => {
        const l = left[i] != null ? part(cellText(left[i]), 'left', i, ctx) : '';
        const r = right[i] != null ? part(cellText(right[i]), 'right', i, ctx) : '';
        // 연결점은 **각 항목 바로 옆**에 붙어야 학생이 어느 항목의 점인지 안다(#4). 전엔 가운데
        // 칸에 `·&nbsp;&nbsp;&nbsp;·` 를 넣어 두 점이 칸 한가운데 붙어 있었고(실측: 20% 폭 칸의
        // 중앙 ~20px 간격) 양쪽 항목과는 멀었다. 점 2개를 좌우 끝으로 벌리는 일은 CSS(flex
        // space-between)가 하고, 여기서는 좌/우 점을 명시적 요소로만 낸다.
        return `<tr><td class="q-match-l">${l}</td>`
          + '<td class="q-match-mid"><span class="q-match-dots" aria-hidden="true">'
          + '<span class="q-match-dot"></span><span class="q-match-dot"></span></span></td>'
          + `<td class="q-match-r">${r}</td></tr>`;
      }).join('');
      return `<table class="q-match"><tbody>${rows}</tbody></table>`;
    }
    case 'ordering': {
      const items = Array.isArray(obj.items) ? obj.items : [];
      if (items.length === 0) return '';
      const lis = items.map((it, i) => `<li><span class="q-order-box"></span>${part(cellText(it), 'items', i, ctx)}</li>`).join('');
      return `<ul class="q-order">${lis}</ul>`;
    }
    case 'short-answer':
      return '<div class="q-short"><span class="q-short-line"></span></div>';
    case 'essay': {
      // lines:0 = 내장 답란 없음(마이그레이션 문항 — 별도 answer-area 개체가 답 공간을 제공하므로
      // 이중 답란·페이지 넘침을 막는다). 미지정이면 신규 저작 기본 4줄.
      if (obj.lines === 0) return '';
      const lines = Math.max(1, Number(obj.lines) || 4);
      return `<div class="q-essay">${Array.from({ length: lines }, () => '<div class="ans-line"></div>').join('')}</div>`;
    }
    case 'fill-blank': {
      // 빈칸은 발문(prompt) 안에 인라인으로 들어간다 — 보기(낱말상자)가 있으면 함께 제시한다.
      const bank = Array.isArray(obj.choices) ? obj.choices : [];
      if (bank.length === 0) return '';
      const chips = bank.map((c, i) => part(cellText(c), 'choices', i, ctx, 'q-bank-chip')).join('');
      return `<div class="q-bank"><span class="q-bank-label">낱말 상자</span>${chips}</div>`;
    }
    default:
      return '';
  }
}

/** 표 = break-inside:avoid(분할 금지, splittable:false 불변식과 짝을 이루는 인쇄 안전 CSS). */
function renderTable(obj, ctx = {}) {
  const rows = Array.isArray(obj.rows) ? obj.rows : [];
  // 열 너비(%)는 첫 행 셀의 w 필드에 저장한다(top-level table 필드는 스키마가 닫혀 있어 colWidths 를
  // 새로 못 두지만, 셀 내부 필드는 검증 대상이 아니다 — 열 경계 드래그(#10)가 여기에 쓴다). colspan
  // 이 섞이면 colgroup 열 수와 어긋날 수 있어, w 가 하나라도 있을 때만 colgroup 을 낸다.
  const firstRow = Array.isArray(rows[0]) ? rows[0] : [];
  const hasWidths = firstRow.some((c) => typeof c?.w === 'number');
  let colgroup = '';
  if (hasWidths) {
    let colCount = 0;
    for (const c of firstRow) colCount += Math.max(1, Number(c?.colspan) || 1);
    const cols = [];
    for (const c of firstRow) {
      const span = Math.max(1, Number(c?.colspan) || 1);
      for (let s = 0; s < span; s++) {
        const w = typeof c?.w === 'number' ? ` style="width:${(c.w / span).toFixed(2)}%"` : '';
        cols.push(`<col${w}>`);
      }
    }
    colgroup = `\n    <colgroup>${cols.join('')}</colgroup>`;
  }
  const trs = rows.map((row, r) => {
    const cells = (Array.isArray(row) ? row : []).map((cell, c) => {
      if (cell?.merged) return ''; // 병합으로 흡수된 셀은 렌더하지 않는다(#10 셀 병합).
      const tag = cell?.header ? 'th' : 'td';
      const colspan = cell?.colspan > 1 ? ` colspan="${Number(cell.colspan)}"` : '';
      const rowspan = cell?.rowspan > 1 ? ` rowspan="${Number(cell.rowspan)}"` : '';
      // 셀 높이(h, mm)·정렬(align) — 열 너비 w(colgroup)와 동형의 opt-in 셀 필드(스키마 미검증).
      // 시각 조직자 삽입이 필기 공간·라벨 중앙정렬을 표현하는 데 쓴다. 없으면 선언 생략 = 기존 산출 불변.
      const cstyleBits = [];
      if (typeof cell?.h === 'number' && Number.isFinite(cell.h) && cell.h > 0) cstyleBits.push(`height:${cell.h}mm`);
      if (cell?.align === 'center' || cell?.align === 'right') cstyleBits.push(`text-align:${cell.align}`);
      const cstyle = cstyleBits.length > 0 ? ` style="${cstyleBits.join(';')}"` : '';
      // editMode 에서만 셀 좌표를 실어 편집기(tableEdit.js)가 DOM↔rows[] 를 정확히 매핑한다(#10).
      const coord = ctx.editMode ? ` data-r="${r}" data-c="${c}"` : '';
      return `<${tag}${colspan}${rowspan}${cstyle}${coord}>${escapeHtml(cell?.text ?? '')}</${tag}>`;
    }).join('');
    return `    <tr>${cells}</tr>`;
  }).join('\n');
  const caption = obj.caption
    ? `\n    <caption class="wg-part"${partAttr(ctx, 'caption')}>${escapeHtml(obj.caption)}</caption>`
    : '';
  // 표 테두리 서식(#5 2차) — blocks.css `.obj-table` 가 --wg-tb-color/--wg-tb-width 변수로 셀 테두리를 그린다.
  const tbColor = typeof obj.borderColor === 'string' && obj.borderColor ? ` --wg-tb-color:${escapeHtml(obj.borderColor)};` : '';
  const tbWidth = Number.isFinite(obj.borderWidth) && obj.borderWidth > 0 ? ` --wg-tb-width:${obj.borderWidth}px;` : '';
  const styleAttr = `break-inside:avoid;${tbColor}${tbWidth}`;
  return `<table class="obj-table keep" style="${styleAttr}">${caption}${colgroup}
${trs}
  </table>`;
}

/**
 * 이미지 자리. 채워진 이미지는 <figure>+<img>+캡션, 비어 있으면 플레이스홀더 박스다.
 *
 * 전엔 플레이스홀더가 `<div class="image-slot placeholder">［이미지 삽입 자리］</div>` 한 줄이었는데
 * `.image-slot` 규칙이 blocks.css 에 **아예 없어서**(실 Chrome 관측) 좌측에 붙은 맨 글자로만 보였다 —
 * 자리인지 본문인지 구분이 안 됐다(#2). 마크업을 아이콘+라벨 구조로 바꾸고 blocks.css 에서 점선
 * 박스로 그린다. 안내 문구를 여기 넣지 않는 이유: blocks.css 는 인쇄본도 쓰는 공유 자산이라
 * "업로드하세요" 같은 편집기 안내가 학생 배포본에 찍힌다 — 그 안내는 인스펙터 몫이다.
 */
function renderImageSlot(obj, ctx = {}) {
  if (obj.src) {
    // 캡션은 이미 selection.js 의 EDIT_FIELD(image-slot → figcaption)가 더블클릭 편집을 소유한다 —
    // data-part 를 겹쳐 실으면 partEdit 이 캡처 단계에서 가로채 편집 주체가 둘이 된다.
    const caption = obj.caption ? `<figcaption>${escapeHtml(obj.caption)}</figcaption>` : '';
    return `<figure class="image-slot"><img src="${escapeHtml(obj.src)}" alt="${escapeHtml(obj.alt || '')}">${caption}</figure>`;
  }
  // alt(저작 내용)가 있으면 "무엇이 들어갈 자리인지"를 함께 보인다 — 교사가 미리 적어 둔 계획이다.
  const alt = obj.alt ? `<span class="is-alt">${escapeHtml(obj.alt)}</span>` : '';
  return '<div class="image-slot placeholder" role="img" aria-label="이미지 삽입 자리">'
    + '<svg class="is-icon" viewBox="0 0 24 24" aria-hidden="true">'
    + '<rect x="3" y="4" width="18" height="16" rx="2.5"/>'
    + '<circle cx="8.5" cy="9.5" r="1.8"/>'
    + '<path d="M4.5 18.5l4.8-5.2a1.4 1.4 0 0 1 2 0l2.6 2.8 2.1-2a1.4 1.4 0 0 1 1.9 0l3.6 3.3"/>'
    + '</svg>'
    + '<span class="is-label">이미지 삽입 자리</span>'
    + alt
    + '</div>';
}

function renderAnswerArea(obj) {
  const label = obj.label ? `<div class="aa-label">${escapeHtml(obj.label)}</div>\n  ` : '';
  const style = obj.style || 'line';
  if (style === 'dots') return `${label}<div class="princ"><div class="dot"></div></div>`;
  if (style === 'box') return `${label}<div class="ansbox"></div>`;
  // 'line'(기본): lines 개수만큼 밑줄 반복(§1 answer-area.style).
  const lines = Math.max(1, Number(obj.lines) || 1);
  const linesHtml = Array.from({ length: lines }, () => '<div class="ans-line"></div>').join('\n  ');
  return `${label}${linesHtml}`;
}

function renderDivider() {
  return '<hr class="divider">';
}

/**
 * 빈 공간 — 흐름에서 heightMm 만큼 자리만 차지하고 아무것도 그리지 않는다.
 * 높이를 인라인으로 방출하는 이유: 편집 화면과 인쇄가 **같은 선언**을 써야 R2-1(편집==인쇄)이
 * 성립한다. 편집 전용 CSS 로 높이를 주면 측정과 인쇄가 갈린다.
 * label 은 편집 화면 전용이라 data 속성으로만 싣는다(인쇄에 글자가 남지 않는다).
 */
function renderSpacer(obj) {
  const h = Number(obj?.heightMm);
  const mm = Number.isFinite(h) && h > 0 ? h : 10;
  const label = obj?.label ? ` data-spacer-label="${escapeHtml(String(obj.label))}"` : '';
  return `<div class="wg-spacer" style="height:${mm}mm"${label}></div>`;
}

/**
 * 페이지 나누기 — 인쇄에는 아무것도 남기지 않는 높이 0 표식이다.
 * 실제 개행은 페이지네이션(assignFlowToPages)이 이 개체를 만나면 커서를 다음 페이지로 옮겨서
 * 일으킨다. 여기서 CSS `break-before` 를 쓰지 않는 이유: 페이지 경계의 단일 권한은 측정 패스이고
 * (D-A), CSS 개행을 섞으면 pages[] 와 실제 인쇄가 어긋난다.
 * 편집 화면 표식은 editorStyle 이 ::after 로 그린다(레이아웃 박스 불변 — 높이 0 유지).
 */
function renderPageBreak() {
  return '<div class="wg-pagebreak" style="height:0"></div>';
}

// US-20 버그 수정: blocks.css `.wg-shape > * { stroke: var(--wg-stroke,#333); fill: var(--wg-fill,none); }`
// 는 CSS 선언이라 svg 의 stroke/fill 프레젠테이션 속성보다 항상 우선한다(CSS가 프레젠테이션
// 속성을 항상 이긴다 — SVG/CSS 명세) — 그 결과 obj.strokeColor/fillColor 를 지정해도 렌더에는
// 반영되지 않고 항상 기본값(#333/none)으로 보였다(실 Chrome 렌더 테스트로 발견). --wg-stroke/
// --wg-fill 커스텀 프로퍼티를 래퍼 div 에 인라인으로 실어 CSS 변수 경로로 값을 넘긴다.
const DASH_MAP = { solid: '0', dashed: '5 3', dotted: '1.5 3' };

function renderShape(obj) {
  const strokeColor = obj.strokeColor || '#333';
  const fillColor = obj.fillColor || 'none';
  const kind = obj.shapeKind;
  // 전엔 <svg> 안이 비어 있어 도형이 아무것도 그려지지 않았다(사용자 피드백 #11) — shapeKind 별
  // 실제 도형 요소를 방출한다. inset:0 로 자유 개체(.wg-float) 를 가득 채우고, viewBox+
  // preserveAspectRatio:none 으로 가로·세로 리사이즈에 함께 늘어난다. stroke/fill/두께/유형은 blocks.css
  // 의 `.wg-shape > *`(=svg) 규칙이 CSS 변수(--wg-stroke/--wg-fill/--wg-sw/--wg-dash)로 받아 자식에 상속.
  let inner;
  if (kind === 'circle') inner = '<ellipse cx="50" cy="50" rx="48" ry="48" vector-effect="non-scaling-stroke"/>';
  else if (kind === 'line') inner = '<line x1="2" y1="98" x2="98" y2="2" vector-effect="non-scaling-stroke"/>';
  else inner = '<rect x="2" y="2" width="96" height="96" vector-effect="non-scaling-stroke"/>';
  const sw = Number.isFinite(obj.strokeWidth) && obj.strokeWidth > 0 ? ` --wg-sw:${obj.strokeWidth};` : '';
  const dash = obj.dash && DASH_MAP[obj.dash] != null ? ` --wg-dash:${DASH_MAP[obj.dash]};` : '';
  const style = ` style="position:absolute; inset:0; --wg-stroke:${escapeHtml(strokeColor)}; --wg-fill:${escapeHtml(fillColor)};${sw}${dash}"`;
  return `<div class="wg-shape" data-shape="${escapeHtml(kind)}"${style}><svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">${inner}</svg></div>`;
}

/** richtext = 탈출구 — 보존 HTML 그대로 방출(무손실, S1.3 마이그레이션 계약과 정합). */
function renderRichtext(obj) {
  return typeof obj.html === 'string' ? obj.html : '';
}

/**
 * organizer(편집 가능 그림형 조직자, P3) — 엔진(OrganizerGen)이 kind·params·labels 로 SVG 를 결정적으로
 * 그린다. 좌표·도형은 엔진 소유(원칙 3); 교사/AI 는 kind·개수(params)·슬롯 텍스트(labels)만 지정한다.
 * 편집==인쇄: editMode 분기가 없어 편집 렌더와 인쇄 렌더가 문자 그대로 같은 SVG 를 방출한다(R2-1).
 * kind 를 닫힌 집합으로 접는다(미지의 kind → 빈 출력, callout 의 variant 접기와 동형 fail-safe).
 */
function renderOrganizer(obj) {
  const kind = ORGANIZER_KINDS.includes(obj.kind) ? obj.kind : null;
  const gen = kind ? ORGANIZER_GENERATORS[kind] : null;
  if (typeof gen !== 'function') return '';
  const params = (obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params)) ? obj.params : {};
  const labels = (obj.labels && typeof obj.labels === 'object' && !Array.isArray(obj.labels)) ? obj.labels : {};
  return gen(params, labels);
}

/** codes[] → `<li><b>[코드]</b> 원문</li>` 목록(std-box 공용 — 미해석 코드는 코드만 표기). */
function renderStandardCodeList(codes, ctx) {
  return codes.map((rawCode) => {
    const code = String(rawCode).replace(/^\[|\]$/g, '');
    const text = ctx.standardsByCode.get(code);
    return `      <li><b>[${escapeHtml(code)}]</b>${text ? ` ${escapeHtml(text)}` : ''}</li>`;
  }).join('\n');
}

/**
 * std-box = 성취기준 참조 + (선택) 학습목표 저작 전용. RenderObjectTree 는 순수 함수라 CSV/MCP 를
 * 조회하지 않는다 — 호출부가 codes 를 이미 원문으로 해석해 meta.standards 로 주입해야 원문이 실린다
 * (AssembleWorksheet#renderStandardLabel 과 동형 마크업). 미해석 코드는 코드만 표기한다.
 *
 * objectives(2026-07-23 학습목표 표기 전환): 현장 관행상 활동지 상단에는 성취기준 원문이 아니라 해당
 * 차시에 맞게 구체화한 **학습목표**("~할 수 있다")를 제시한다 — objectives 가 있으면 학생/교사 공통
 * "학습 목표" 박스를 렌더한다. objectives 가 없으면(하위호환) 현행 성취기준 박스를 그대로 렌더한다.
 *
 * showStandards(2026-07-28 기본값 전환): "근거 성취기준"(코드+원문) 박스는 **명시적으로 켰을 때만**
 * 낸다. 종전엔 objectives 가 있으면 항상 함께 나왔는데, 현장에서 활동지에 얹는 것은 학습목표뿐이고
 * 성취기준 원문은 대개 넣지 않는다는 사용자 피드백이 근거다. 켰을 때의 동작은 종전과 같다 —
 * `.std-ref` 로 방출해 학생용에서는 data-mode CSS 로만 숨긴다(정답과 달리 비밀이 아니라 물리 제거
 * 불필요). 끄더라도 codes 는 개체에 그대로 남아 다시 켜면 원문이 되살아난다.
 *
 * heading/objectives 는 캔버스 인라인 편집 대상이다(#1) — editMode 에서만 data-part 좌표가 실린다.
 */
const STD_HEADING_DEFAULT = '학습 목표';

function renderStdBox(obj, ctx) {
  const codes = Array.isArray(obj.codes) ? obj.codes : [];
  const objectives = Array.isArray(obj.objectives) ? obj.objectives : [];

  if (objectives.length > 0) {
    const heading = typeof obj.heading === 'string' && obj.heading.trim() ? obj.heading : STD_HEADING_DEFAULT;
    const goalLis = objectives.map((goal, i) =>
      `      <li class="wg-part"${partAttr(ctx, 'objectives', i)}>${escapeHtml(goal)}</li>`).join('\n');
    const goalBox = `<div class="std-box">
    <div class="std-head">▣ <span class="wg-part std-head-text"${partAttr(ctx, 'heading')}>${escapeHtml(heading)}</span></div>
    <ul>
${goalLis}
    </ul>
  </div>`;
    // 참조할 코드가 없으면 켜져 있어도 빈 박스를 내지 않는다(제목만 있는 빈 테두리가 인쇄된다).
    if (obj.showStandards !== true || codes.length === 0) return goalBox;
    const refLis = renderStandardCodeList(codes, ctx);
    return `${goalBox}
  <div class="std-box std-ref">
    <div class="std-head">▣ 근거 성취기준 (2022 개정 교육과정)</div>
    <ul>
${refLis}
    </ul>
  </div>`;
  }

  const lis = renderStandardCodeList(codes, ctx);
  return `<div class="std-box">
    <div class="std-head">▣ 관련 성취기준 (2022 개정 교육과정)</div>
    <ul>
${lis}
    </ul>
  </div>`;
}

/**
 * 강조상자(callout, M4) — 팁·주의·핵심정리 박스. body/titleHtml 은 richtext.html 과 동형(입력에서
 * 살균, 렌더는 이스케이프 없이 방출). title 평문은 escapeHtml. variant 는 클래스로 방출해
 * blocks.css `.callout-<variant>` 가 색/아이콘을 받는다(편집==인쇄 동일 선언). 폭·정렬(SIZE_FIELDS)은
 * flow 래퍼(renderFlowObject)가 처리하므로 여기서 만지지 않는다.
 */
/** variant 기본 라벨(제목 미지정 시 헤더밴드에 표시). */
const CALLOUT_LABELS = { tip: '도움말', warning: '주의', note: '참고', summary: '핵심 정리' };

function renderCallout(obj) {
  // variant 를 닫힌 집합으로 접는다(알 수 없는 값이 callout-<임의> 같은 존재하지 않는 클래스로 새어
  // 스타일 없는 박스가 되는 것을 막는다 — blocks.css 는 4종 variant 클래스만 안다).
  const variant = CALLOUT_VARIANTS.includes(obj.variant) ? obj.variant : 'note';
  // 헤더밴드 라벨 = titleHtml(살균) > title(평문 이스케이프) > variant 기본 라벨. 상단 색 밴드는
  // .std-box/.strip 과 동형(이 활동지의 고유 디자인 — 왼쪽 세로띠 같은 제네릭 룩을 쓰지 않는다).
  const head = (typeof obj.titleHtml === 'string' && obj.titleHtml)
    ? obj.titleHtml
    : (typeof obj.title === 'string' && obj.title
      ? escapeHtml(obj.title)
      : escapeHtml(CALLOUT_LABELS[variant] || '참고'));
  const body = typeof obj.body === 'string' ? obj.body : '';
  return `<div class="callout callout-${escapeHtml(variant)}">
    <div class="callout-head">${head}</div>
    <div class="callout-body">${body}</div>
  </div>`;
}
