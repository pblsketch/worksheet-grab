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

      return buildSheetSection({ pageNo, runHead, bodyOut: bodyWithFloat, footLeft, footRightPrefix });
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
    case 'question': return renderQuestion(obj);
    case 'table': return renderTable(obj);
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
  return `<div class="title-wrap">
    ${pill}${page}<div class="title-box"><${tag}>${escapeHtml(obj.text)}</${tag}></div>${source}
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

function renderQuestion(obj) {
  const qnum = obj.qnum != null ? `<span class="qnum">${escapeHtml(String(obj.qnum))}</span>` : '';
  const parts = [`<div class="q">${qnum}${escapeHtml(obj.prompt)}</div>`];
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const lis = obj.choices.map((c) => `<li>${escapeHtml(String(c))}</li>`).join('');
    parts.push(`<ol class="choices">${lis}</ol>`);
  }
  if (obj.answerKey) {
    // answerKey.html 은 마이그레이션이 보존한 원본 마크업(무손실) — 그대로 방출, escape 하지 않는다.
    const akHtml = typeof obj.answerKey.html === 'string' ? obj.answerKey.html : escapeHtml(String(obj.answerKey.text ?? ''));
    parts.push(`<div class="answer">${akHtml}</div>`);
  }
  return `<div class="qbox" data-qtype="${escapeHtml(obj.qtype)}">
  ${parts.join('\n  ')}
</div>`;
}

/** 표 = break-inside:avoid(분할 금지, splittable:false 불변식과 짝을 이루는 인쇄 안전 CSS). */
function renderTable(obj) {
  const rows = Array.isArray(obj.rows) ? obj.rows : [];
  const trs = rows.map((row) => {
    const cells = (Array.isArray(row) ? row : []).map((cell) => {
      const tag = cell?.header ? 'th' : 'td';
      const colspan = cell?.colspan ? ` colspan="${Number(cell.colspan)}"` : '';
      return `<${tag}${colspan}>${escapeHtml(cell?.text ?? '')}</${tag}>`;
    }).join('');
    return `    <tr>${cells}</tr>`;
  }).join('\n');
  const caption = obj.caption ? `\n    <caption>${escapeHtml(obj.caption)}</caption>` : '';
  return `<table class="obj-table keep" style="break-inside:avoid;">${caption}
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
function renderShape(obj) {
  const strokeColor = obj.strokeColor || '#333';
  const fillColor = obj.fillColor || 'none';
  const style = ` style="--wg-stroke:${escapeHtml(strokeColor)}; --wg-fill:${escapeHtml(fillColor)};"`;
  return `<div class="wg-shape" data-shape="${escapeHtml(obj.shapeKind)}"${style}><svg width="100%" height="100%"></svg></div>`;
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
