import { DEFAULT_VIRTUAL_TIME_BUDGET } from './RenderPdf.js';

// RenderImage — HTML 파일을 PNG(미리보기·카드)로 렌더한다. Renderer 포트에만 의존.
// 유스케이스는 Chrome 을 직접 부르지 않는다 → Renderer 목으로 단위 테스트 가능(M6 옵션 export).
export class RenderImage {
  /** @param {{renderer: import('./ports.js').Renderer}} deps */
  constructor({ renderer }) {
    if (!renderer || typeof renderer.renderToPng !== 'function') {
      throw new TypeError('RenderImage 는 renderToPng 가능한 Renderer 포트가 필요합니다.');
    }
    this.renderer = renderer;
  }

  /**
   * @param {{inputPath:string, outputPath:string, virtualTimeBudget?:number, width?:number, height?:number, scale?:number}} args
   * @returns {Promise<{outputPath:string}>}
   */
  async execute({ inputPath, outputPath, virtualTimeBudget = DEFAULT_VIRTUAL_TIME_BUDGET, width, height, scale }) {
    if (!inputPath) throw new TypeError('inputPath 는 필수입니다.');
    if (!outputPath) throw new TypeError('outputPath 는 필수입니다.');
    await this.renderer.renderToPng(inputPath, outputPath, { virtualTimeBudget, width, height, scale });
    return { outputPath };
  }
}
