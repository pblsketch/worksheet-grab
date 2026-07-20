// RenderPdf — HTML 파일을 PDF 로 렌더한다. Renderer 포트에만 의존.
// 유스케이스는 Chrome 을 직접 부르지 않는다 → Renderer 목으로 단위 테스트 가능(수용기준 6).
export const DEFAULT_VIRTUAL_TIME_BUDGET = 15000; // HANDOFF 6장: 짧으면 웹폰트·KaTeX·SVG 깨짐

export class RenderPdf {
  /** @param {{renderer: import('./ports.js').Renderer}} deps */
  constructor({ renderer }) {
    if (!renderer || typeof renderer.renderToPdf !== 'function') {
      throw new TypeError('RenderPdf 는 Renderer 포트가 필요합니다.');
    }
    this.renderer = renderer;
  }

  /**
   * @param {{inputPath:string, outputPath:string, virtualTimeBudget?:number}} args
   * @returns {Promise<{outputPath:string}>}
   */
  async execute({ inputPath, outputPath, virtualTimeBudget = DEFAULT_VIRTUAL_TIME_BUDGET }) {
    if (!inputPath) throw new TypeError('inputPath 는 필수입니다.');
    if (!outputPath) throw new TypeError('outputPath 는 필수입니다.');
    await this.renderer.renderToPdf(inputPath, outputPath, { virtualTimeBudget });
    return { outputPath };
  }
}
