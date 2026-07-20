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

const KATEX_HEAD = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" crossorigin>
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
   * @returns {Promise<{html:string, worksheet:Worksheet}>}
   */
  async execute(manifest) {
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

    const html = await this.#serialize(worksheet, manifest);
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

  #renderStandardLabel(standards) {
    const lis = standards
      .map((s) => `      <li><b>${s.bracketedCode()}</b> ${escapeHtml(s.text)}</li>`)
      .join('\n');
    return `<div class="std-box">
    <div class="std-head">▣ 관련 성취기준 (2022 개정 교육과정)</div>
    <ul>
${lis}
    </ul>
  </div>`;
  }

  async #serialize(worksheet, manifest) {
    let paper = await this.repo.readAsset('paper.css');
    // manifest.paper(1급 속성) → @page 숫자 리터럴 + --sheet-* 변수를 paper.css 바로 뒤에
    // 인라인해 캐스케이드로 덮어쓴다. 미지정이면 스니펫 없음 = 현행 산출 그대로(하위호환).
    const paperOverride = paperCss(resolvePaper(manifest.paper));
    if (paperOverride) paper = `${paper}\n${paperOverride}`;
    const blocksCss = await this.repo.readAsset('blocks.css');
    const themeCss = await this.repo.loadThemeCss(worksheet.themeName);
    const lang = manifest.lang || 'ko';
    const dataSubject = manifest.dataSubject || worksheet.subject;
    const katex = worksheet.head.katex ? '\n' + KATEX_HEAD : '';

    const pagesHtml = worksheet.pages.map((blocks, idx) => {
      const pageNo = idx + 1;
      const body = blocks.map((b) => b.toHtml()).join('\n\n  ');
      const foot = worksheet.runFoot;
      const rightPrefix = foot.rightPrefix ?? foot.right ?? '';
      return `<section class="sheet">
  <span class="mode-badge"></span>
  <div class="run-head">${escapeHtml(worksheet.runHead)}</div>

  ${body}

  <div class="run-foot"><span>${escapeHtml(foot.left || '')}</span><span>${escapeHtml(rightPrefix)}　${pageNo}</span></div>
</section>`;
    }).join('\n\n');

    return `<!DOCTYPE html>
<html lang="${lang}" data-mode="MODE_TOKEN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(worksheet.docTitle)}</title>
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">${katex}
<style>
${paper}

${blocksCss}

/* ===== 교과 테마 토큰 (themes/${worksheet.themeName}.css) ===== */
${themeCss}
</style>
</head>
<body data-mode="MODE_TOKEN" data-subject="${escapeHtml(dataSubject)}">

${pagesHtml}

</body>
</html>
`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
