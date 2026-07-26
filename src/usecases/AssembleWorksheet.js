import { Worksheet, Block, Standard } from '../domain/index.js';
import { resolvePaper, paperCss } from './paper.js';

// AssembleWorksheet — 매니페스트 + 블록 라이브러리 + 테마 + 성취기준(CSV) → 활동지 HTML.
// 겸 Presenter: 도메인 Worksheet 를 HTML(MODE_TOKEN 포함) 로 직렬화한다.
// 포트(BlockRepository, CurriculumProvider)에만 의존. Chrome 무지.

// 교과 특수 블록 타입(해당 교과에서만). 범용 표(memo/comparison/label-value)는
// Phase 3 에서 코어로 재분류(교과 무관·var(--*)만) — 여기서 제외. 단일 진실원천은 blocks/vocabulary.json.
const SUBJECT_PACK_TYPES = new Set([
  'passage', 'pro-con', 'variable-table', 'data-table',
  'svg-graph', 'formula', 'hypothesis-box',
  'map', 'timeline', 'vocab', 'dialogue',
]);

export const KATEX_HEAD = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js" crossorigin></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" crossorigin
  onload="renderMathInElement(document.body,{delimiters:[{left:'$',right:'$',display:false},{left:'$$',right:'$$',display:true}]});"></script>`;

export class AssembleWorksheet {
  /** @param {{blockRepository, curriculum}} deps */
  constructor({ blockRepository, curriculum }) {
    if (!blockRepository) throw new TypeError('AssembleWorksheet 는 BlockRepository 가 필요합니다.');
    this.repo = blockRepository;
    this.curriculum = curriculum ?? null;
  }

  /**
   * @param {object} manifest 파싱된 매니페스트
   * @param {{editMode?:boolean}} opts editMode: 에디터(E3) 전용 — 각 블록을 경계 래퍼로
   *   감싸 DOM↔manifest 역동기화를 가능하게 한다. 기본 false = 현행 산출 바이트 불변.
   *   래퍼는 저장 시 clean 재조립으로 자연 소멸하므로 인쇄물/워크스페이스 HTML 에 남지 않는다.
   * @returns {Promise<{html:string, worksheet:Worksheet}>}
   */
  async execute(manifest, { editMode = false } = {}) {
    const standards = await this.#resolveStandards(manifest);

    // 페이지별 블록 로드/생성 → 도메인 Block[][]
    const pages = [];
    for (const pageEntries of manifest.pages) {
      const blocks = [];
      for (const entry of pageEntries) {
        const html = await this.#entryHtml(entry, standards);
        const type = entry.type || 'content';
        blocks.push(new Block({
          id: entry.file || `gen:${type}`,
          type,
          category: SUBJECT_PACK_TYPES.has(type) ? 'subjectPack' : 'core',
          subject: manifest.subject,
          content: html,
        }));
      }
      pages.push(blocks);
    }

    const worksheet = new Worksheet({
      subject: manifest.subject,
      themeName: manifest.theme,
      docTitle: manifest.docTitle || '',
      standards,
      pages,
      head: manifest.head || { katex: false },
      runHead: manifest.runHead || '',
      runFoot: manifest.runFoot || { left: '', rightPrefix: '' },
    });

    const html = await this.#serialize(worksheet, manifest, editMode);
    return { html, worksheet };
  }

  async #resolveStandards(manifest) {
    const codes = manifest.standards || [];
    const fallback = manifest.standardsText || {};
    const out = [];
    for (const rawCode of codes) {
      const code = String(rawCode);
      let text = null;
      if (this.curriculum) {
        try {
          const r = await this.curriculum.resolve(code);
          if (r && r.text) text = r.text;
        } catch { /* MCP/CSV 실패 → 폴백 */ }
      }
      if (!text) text = fallback[code] || fallback[code.replace(/^\[|\]$/g, '')] || null;
      if (!text) {
        // 원문을 구할 수 없으면 창작하지 않고 명시적으로 실패시킨다.
        throw new Error(`성취기준 ${code} 의 원문을 CSV/MCP/폴백 어디에서도 찾지 못했습니다(창작 금지).`);
      }
      out.push(new Standard({ code, text, subject: manifest.subject }));
    }
    return out;
  }

  async #entryHtml(entry, standards) {
    if (entry.gen === 'standard-label' || entry.type === 'standard-label') {
      return this.#renderStandardLabel(standards);
    }
    if (typeof entry.html === 'string') return entry.html; // 인라인 블록(템플릿 슬롯 치환 결과)
    if (!entry.file) throw new Error(`블록 엔트리에 file/html/gen 이 없습니다: ${JSON.stringify(entry)}`);
    return this.repo.loadBlockHtml(entry.file);
  }

  // 학습목표 표기 전환(2026-07-23): 이 경로(결정적 엔진, gen:'standard-label')는 AI 저작이 아니라
  // 성취기준 CSV/MCP 원문을 그대로 조립하므로 새 학습목표 문장을 스스로 지을 수 없다 — 대신 기계
  // 변환으로 표기만 개선한다. 학생/교사 공통 박스 제목은 "학습 목표"로 바꾸고, 목록에는 코드를 뗀
  // 성취기준 문장만 실어 문장 자체가 목표 서술문처럼 읽히게 한다. 코드+원문 병기("근거 성취기준")는
  // 별도 박스에 담아 교사용에서만 보이게 한다(`.std-ref`, assets/blocks.css [data-mode] 분기 —
  // 성취기준은 비밀이 아니므로 물리 제거가 아니라 CSS 표시 제어로 충분하다).
  #renderStandardLabel(standards) {
    const goalLis = standards
      .map((s) => `      <li>${escapeHtml(s.text)}</li>`)
      .join('\n');
    const refLis = standards
      .map((s) => `      <li><b>${s.bracketedCode()}</b> ${escapeHtml(s.text)}</li>`)
      .join('\n');
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

  async #serialize(worksheet, manifest, editMode = false) {
    let paper = await this.repo.readAsset('paper.css');
    // manifest.paper(1급 속성) → @page 숫자 리터럴 + --sheet-* 변수를 paper.css 바로 뒤에
    // 인라인해 캐스케이드로 덮어쓴다. 미지정이면 스니펫 없음 = 현행 산출 그대로(하위호환).
    const resolvedPaper = resolvePaper(manifest.paper);
    const paperOverride = paperCss(resolvedPaper);
    if (paperOverride) paper = `${paper}\n${paperOverride}`;
    // columns>1 일 때만 페이지 본문을 .sheet-body 로 감싼다(다단 흐름 소비). columns<=1
    // 은 래퍼 미방출 = 현행 산출 바이트 불변. 크롬(run-head/foot/mode-badge)은 래퍼 밖.
    const columns = resolvedPaper?.columns ?? 1;
    const blocksCss = await this.repo.readAsset('blocks.css');
    const themeCss = await this.repo.loadThemeCss(worksheet.themeName);
    const lang = manifest.lang || 'ko';
    const dataSubject = manifest.dataSubject || worksheet.subject;

    const pagesHtml = worksheet.pages.map((blocks, idx) => {
      const pageNo = idx + 1;
      // editMode: 블록 경계 래퍼(display:contents — editor.css) — DOM 순회로 pages[p][b] 복원.
      const body = blocks.map((b, bIdx) => (editMode
        ? `<div class="wg-block" data-bp="${idx}" data-bi="${bIdx}" data-bt="${escapeHtml(b.type)}">${b.toHtml()}</div>`
        : b.toHtml()
      )).join('\n\n  ');
      const bodyOut = wrapSheetBody(body, columns);
      const foot = worksheet.runFoot;
      const rightPrefix = foot.rightPrefix ?? foot.right ?? '';
      return buildSheetSection({
        pageNo, runHead: worksheet.runHead, bodyOut, footLeft: foot.left, footRightPrefix: rightPrefix,
      });
    }).join('\n\n');

    return buildDocumentHtml({
      lang,
      docTitle: worksheet.docTitle,
      katexEnabled: !!worksheet.head.katex,
      paperCss: paper,
      blocksCss,
      themeCss,
      themeName: worksheet.themeName,
      dataSubject,
      pagesHtml,
    });
  }
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── S2.1(M2) 공유 추출 — head/섹션 조립의 순수 조각. AssembleWorksheet(manifest 경로)와
// RenderObjectTree(개체 트리 경로, C1)가 이 조각들을 공유해 문서 골격 중복을 피한다.
// 이 함수들은 기존 AssembleWorksheet 산출 바이트를 불변으로 유지하도록 원본 템플릿을
// 그대로 파라미터화한 것뿐이다(동작 변경 없음).

/** columns<=1 은 bodyHtml 그대로(바이트 불변), columns>1 만 .sheet-body 래퍼로 감싼다. */
export function wrapSheetBody(bodyHtml, columns) {
  return columns > 1 ? `<div class="sheet-body">\n  ${bodyHtml}\n  </div>` : bodyHtml;
}

/** 페이지 1장(`<section class="sheet">`) — run-head/run-foot/mode-badge 크롬 + bodyOut. */
export function buildSheetSection({ pageNo, pageId = null, runHead, bodyOut, footLeft, footRightPrefix }) {
  const pageIdAttr = typeof pageId === 'string' && pageId
    ? ` data-page-id="${escapeHtml(pageId).replaceAll('"', '&quot;').replaceAll("'", '&#39;')}"`
    : '';
  return `<section class="sheet"${pageIdAttr}>
  <span class="mode-badge"></span>
  <div class="run-head">${escapeHtml(runHead)}</div>

  ${bodyOut}

  <div class="run-foot"><span>${escapeHtml(footLeft || '')}</span><span>${escapeHtml(footRightPrefix ?? '')}　${pageNo}</span></div>
</section>`;
}

/** 문서 전체(`<!DOCTYPE html>`…`</html>`) — head(폰트/KaTeX/CSS) + body(data-mode="MODE_TOKEN" + pagesHtml). */
export function buildDocumentHtml({
  lang, docTitle, katexEnabled, paperCss: paperCssText, blocksCss, themeCss, themeName, dataSubject, pagesHtml,
}) {
  const katex = katexEnabled ? '\n' + KATEX_HEAD : '';
  return `<!DOCTYPE html>
<html lang="${lang}" data-mode="MODE_TOKEN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(docTitle)}</title>
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">${katex}
<style>
${paperCssText}

${blocksCss}

/* ===== 교과 테마 토큰 (themes/${themeName}.css) ===== */
${themeCss}
</style>
</head>
<body data-mode="MODE_TOKEN" data-subject="${escapeHtml(dataSubject)}">

${pagesHtml}

</body>
</html>
`;
}
