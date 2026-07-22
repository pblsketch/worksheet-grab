import { countPdfPages } from './pdfInfo.js';

// WorkbookExport — 자료집 합본 HTML(WorkbookAssemble 산출) → PDF 2벌. 렌더는 renderPdf
// 시임(주입)으로 위임해 유스케이스는 Chrome·FS 무지 유지(목 렌더러로 게이트 로직 단위 테스트).
//
// 게이트(합의 계획 §3·C4): 표지+목차 프리픽스만 별도 렌더해 pdfInfo.countPdfPages 로 실측
// (추정 상수 금지), 본 PDF 물리 쪽수 == 프리픽스실측 + ΣmemberSections 를 fail-closed 로
// 단언한다. 불일치면 멤버별 단독 프로브를 교차 렌더해 넘친 멤버를 지목한다.

/**
 * 페이지 수 기반 렌더 예산(합의 계획 §2f). 계수는 근사 시작값이며 상한 clamp 로 폭주를 막는다:
 *   virtualTimeBudget = clamp(15000 + 250·totalPages, 15000, 60000)
 *   timeoutMs         = clamp(60000 + 1000·totalPages, 60000, 300000)
 * @param {number} totalPages
 * @returns {{virtualTimeBudget:number, timeoutMs:number}}
 */
export function renderBudget(totalPages) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const p = Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 0;
  return {
    virtualTimeBudget: clamp(15000 + 250 * p, 15000, 60000),
    timeoutMs: clamp(60000 + 1000 * p, 60000, 300000),
  };
}

export class WorkbookExport {
  /**
   * @param {{renderPdf:(args:{html:string, outputPath?:string, budget:object, label:string})=>Promise<string>,
   *   countPdfPages?:(path:string)=>Promise<number>, onProgress?:(ev:object)=>void}} deps
   * renderPdf: html 을 (임시)파일로 써서 렌더하고 산출 PDF 경로를 반환하는 IO 시임(어댑터 주입).
   */
  constructor({ renderPdf, countPdfPages: countFn = countPdfPages, onProgress = null }) {
    if (typeof renderPdf !== 'function') throw new TypeError('WorkbookExport 는 renderPdf 함수가 필요합니다.');
    this.renderPdf = renderPdf;
    this.countPdfPages = countFn;
    this.onProgress = onProgress ?? (() => {});
  }

  /**
   * @param {{assembled:object, outputs:{teacherPdfPath:string, studentPdfPath:string}}} args
   *   assembled = WorkbookAssemble.execute 산출({teacher, student, unsafeMembers, ...}).
   * @returns {Promise<{rendered:Array, unsafeMembers:string[]}>}
   */
  async execute({ assembled, outputs }) {
    const rendered = [];
    // teacher 항상.
    rendered.push(await this.#renderVariant('teacher', assembled.teacher, outputs.teacherPdfPath));
    // student 는 unsafe 멤버 없을 때만(WorkbookAssemble 이 이미 null 로 강등).
    if (assembled.student) {
      rendered.push(await this.#renderVariant('student', assembled.student, outputs.studentPdfPath));
    }
    return { rendered, unsafeMembers: assembled.unsafeMembers ?? [] };
  }

  async #renderVariant(variant, built, outputPath) {
    const sigma = built.sectionCounts.reduce((a, b) => a + b, 0);

    // C4: 표지+목차 프리픽스 실측(추정 금지).
    const prefixPath = await this.renderPdf({ html: built.prefixHtml, budget: renderBudget(2), label: `${variant}-prefix` });
    const coverToc = await this.countPdfPages(prefixPath);
    const totalPages = coverToc + sigma;
    const budget = renderBudget(totalPages);
    this.onProgress({ phase: 'render', variant, coverToc, sigma, totalPages, budget });

    // 본 렌더.
    const pdfPath = await this.renderPdf({ html: built.html, outputPath, budget, label: variant });
    const actual = await this.countPdfPages(pdfPath);

    if (actual !== totalPages) {
      const overflow = await this.#pinpoint(built, variant);
      throw new Error(
        `자료집(${variant}) 쪽수 불일치(fail-closed): 기대 ${totalPages}(표지목차 ${coverToc} + 본문 ${sigma}) ≠ 실측 ${actual}. `
        + `넘친 멤버: ${overflow.length ? overflow.join(', ') : '특정 불가(전역 리플로우 의심)'}.`,
      );
    }
    this.onProgress({ phase: 'done', variant, pages: actual });
    return { variant, path: pdfPath, pages: actual, coverToc, sigma };
  }

  /** 멤버별 단독 프로브를 교차 렌더해 sectionCount 초과(넘침) 멤버를 지목한다. */
  async #pinpoint(built, variant) {
    const overflow = [];
    for (const probe of built.memberProbes ?? []) {
      const path = await this.renderPdf({ html: probe.html, budget: renderBudget(probe.sectionCount), label: `${variant}-probe-${probe.docName}` });
      const pages = await this.countPdfPages(path);
      if (pages !== probe.sectionCount) overflow.push(`${probe.docName}(기대 ${probe.sectionCount}·실측 ${pages})`);
    }
    return overflow;
  }
}
