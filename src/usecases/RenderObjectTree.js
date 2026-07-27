import { escapeHtml, wrapSheetBody, buildSheetSection, buildDocumentHtml } from './AssembleWorksheet.js';
import { resolvePaper, paperCss as paperCssOverride } from './paper.js';

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

function renderFlowObject(obj, ctx) {
  const inner = renderAnswerWrap(obj, renderByType(obj, ctx));
  if (!ctx.editMode) return inner;
  // editMode 개체 경계 래퍼 — data-oid 기반(D-A/HANDOFF §6, AssembleWorksheet 의 wg-block 관례와 동형).
  return `<div class="wg-obj" data-oid="${escapeHtml(String(obj.id))}" data-ot="${escapeHtml(obj.type)}">${inner}</div>`;
}

function renderFloatObject(obj, ctx) {
  const inner = renderAnswerWrap(obj, renderByType(obj, ctx));
  const rect = obj.rect || {};
  const style = `position:absolute; left:${mm(rect.xMm)}; top:${mm(rect.yMm)}; width:${mm(rect.wMm)}; height:${mm(rect.hMm)};`;
  const oidAttrs = ctx.editMode
    ? ` data-oid="${escapeHtml(String(obj.id))}" data-ot="${escapeHtml(obj.type)}"`
    : '';
  return `  <div class="wg-float" style="${style}"${oidAttrs}>${inner}</div>`;
}

function mm(n) {
  return `${Number(n)}mm`;
}

// ── 타입별 렌더 함수(닫힌 카탈로그 10종, HANDOFF §1) — loadBlockHtml(불투명 HTML) 대체 ──

function renderByType(obj, ctx) {
  switch (obj.type) {
    case 'title': return renderTitle(obj);
    case 'passage-slot': return renderPassageSlot(obj);
    case 'question': return renderQuestion(obj, ctx);
    case 'table': return renderTable(obj, ctx);
    case 'image-slot': return renderImageSlot(obj);
    case 'answer-area': return renderAnswerArea(obj);
    case 'divider': return renderDivider();
    case 'shape': return renderShape(obj);
    case 'richtext': return renderRichtext(obj);
    case 'std-box': return renderStdBox(obj, ctx);
    default:
      throw new Error(`RenderObjectTree: 닫힌 카탈로그(10종) 밖의 타입입니다: ${obj?.type}`);
  }
}

function renderTitle(obj) {
  const level = obj.level === 2 ? 2 : 1;
  const tag = level === 1 ? 'h1' : 'h2';
  const meta = obj.meta || {};
  const pill = meta.pill ? `<span class="pill">${escapeHtml(meta.pill)}</span>\n    ` : '';
  const page = meta.page ? `<span class="corner-ref">${escapeHtml(meta.page)}</span>\n    ` : '';
  const source = meta.source ? `\n    <div class="title-src">${escapeHtml(meta.source)}</div>` : '';
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
function renderPassageSlot(obj) {
  const titleHtml = obj.title ? `<h3>${escapeHtml(obj.title)}</h3>\n  ` : '';
  const hasBody = typeof obj.bodyHtml === 'string' && obj.bodyHtml.trim() !== '';
  const bodyOrSlot = hasBody
    ? `<div class="passage-body">${obj.bodyHtml}</div>`
    : `<div class="slot">${escapeHtml(obj.slotLabel)}</div>`;
  const source = obj.source ? `\n  <div class="src">출처: ${escapeHtml(obj.source)}</div>` : '';
  return `<div class="passage">
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
        return `<tr><td class="q-match-l">${l}</td><td class="q-match-mid">·&nbsp;&nbsp;&nbsp;·</td><td class="q-match-r">${r}</td></tr>`;
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
      // editMode 에서만 셀 좌표를 실어 편집기(tableEdit.js)가 DOM↔rows[] 를 정확히 매핑한다(#10).
      const coord = ctx.editMode ? ` data-r="${r}" data-c="${c}"` : '';
      return `<${tag}${colspan}${rowspan}${coord}>${escapeHtml(cell?.text ?? '')}</${tag}>`;
    }).join('');
    return `    <tr>${cells}</tr>`;
  }).join('\n');
  const caption = obj.caption ? `\n    <caption>${escapeHtml(obj.caption)}</caption>` : '';
  // 표 테두리 서식(#5 2차) — blocks.css `.obj-table` 가 --wg-tb-color/--wg-tb-width 변수로 셀 테두리를 그린다.
  const tbColor = typeof obj.borderColor === 'string' && obj.borderColor ? ` --wg-tb-color:${escapeHtml(obj.borderColor)};` : '';
  const tbWidth = Number.isFinite(obj.borderWidth) && obj.borderWidth > 0 ? ` --wg-tb-width:${obj.borderWidth}px;` : '';
  const styleAttr = `break-inside:avoid;${tbColor}${tbWidth}`;
  return `<table class="obj-table keep" style="${styleAttr}">${caption}${colgroup}
${trs}
  </table>`;
}

function renderImageSlot(obj) {
  if (obj.src) {
    const caption = obj.caption ? `<figcaption>${escapeHtml(obj.caption)}</figcaption>` : '';
    return `<figure class="image-slot"><img src="${escapeHtml(obj.src)}" alt="${escapeHtml(obj.alt || '')}">${caption}</figure>`;
  }
  return '<div class="image-slot placeholder">［이미지 삽입 자리］</div>';
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
 * "학습 목표" 박스를 렌더하고, 그 아래 교사 전용 "근거 성취기준"(코드+원문)을 data-mode CSS
 * 메커니즘(assets/blocks.css `.std-ref`)으로만 숨긴다(정답과 달리 비밀이 아니므로 물리 제거 불필요).
 * objectives 가 없으면(하위호환) 현행 성취기준 박스를 그대로 렌더한다 — 기존 문서 무회귀.
 */
function renderStdBox(obj, ctx) {
  const codes = Array.isArray(obj.codes) ? obj.codes : [];
  const objectives = Array.isArray(obj.objectives) ? obj.objectives : [];

  if (objectives.length > 0) {
    const goalLis = objectives.map((goal) => `      <li>${escapeHtml(goal)}</li>`).join('\n');
    const refLis = renderStandardCodeList(codes, ctx);
    return `<div class="std-box">
    <div class="std-head">▣ 학습 목표</div>
    <ul>
${goalLis}
    </ul>
  </div>
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
