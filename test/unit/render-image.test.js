import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderImage } from '../../src/usecases/RenderImage.js';

// 목 렌더러: Chrome 없이 renderToPng 호출을 포착.
class MockRenderer {
  constructor() { this.pngCalls = []; }
  async renderToPdf() { return { outputPath: 'x.pdf' }; }
  async renderToPng(inputPath, outputPath, options) {
    this.pngCalls.push({ inputPath, outputPath, options });
    return { outputPath };
  }
}

test('US-M6-1: RenderImage 가 renderToPng 를 경로·옵션과 함께 호출(Chrome 무관)', async () => {
  const renderer = new MockRenderer();
  const ri = new RenderImage({ renderer });
  const { outputPath } = await ri.execute({ inputPath: 'in.html', outputPath: 'out.png', virtualTimeBudget: 15000 });

  assert.equal(outputPath, 'out.png');
  assert.equal(renderer.pngCalls.length, 1, 'renderToPng 1회 호출');
  assert.equal(renderer.pngCalls[0].inputPath, 'in.html');
  assert.equal(renderer.pngCalls[0].outputPath, 'out.png');
  assert.equal(renderer.pngCalls[0].options.virtualTimeBudget, 15000);
});

test('US-M6-1: renderToPng 불가 렌더러는 명확히 거부', () => {
  assert.throws(() => new RenderImage({ renderer: { renderToPdf() {} } }), /renderToPng/);
});

test('US-M6-1: inputPath/outputPath 누락 시 오류', async () => {
  const ri = new RenderImage({ renderer: new MockRenderer() });
  await assert.rejects(() => ri.execute({ outputPath: 'o.png' }), /inputPath/);
  await assert.rejects(() => ri.execute({ inputPath: 'i.html' }), /outputPath/);
});
