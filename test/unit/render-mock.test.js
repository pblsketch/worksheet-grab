import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RenderPdf, DEFAULT_VIRTUAL_TIME_BUDGET } from '../../src/usecases/RenderPdf.js';

// 수용기준 6: 도메인/유스케이스는 Chrome 없이 단위 테스트(Renderer 목).
class MockRenderer {
  constructor() { this.calls = []; }
  async renderToPdf(inputPath, outputPath, options) {
    this.calls.push({ inputPath, outputPath, options });
    return { outputPath };
  }
}

test('RenderPdf 는 Renderer 포트를 호출한다(Chrome 불필요)', async () => {
  const mock = new MockRenderer();
  const useCase = new RenderPdf({ renderer: mock });
  const res = await useCase.execute({ inputPath: 'a.html', outputPath: 'a.pdf' });
  assert.equal(res.outputPath, 'a.pdf');
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].inputPath, 'a.html');
  assert.equal(mock.calls[0].options.virtualTimeBudget, DEFAULT_VIRTUAL_TIME_BUDGET);
});

test('virtual-time-budget 을 넘기면 그대로 전달된다', async () => {
  const mock = new MockRenderer();
  await new RenderPdf({ renderer: mock }).execute({ inputPath: 'a.html', outputPath: 'a.pdf', virtualTimeBudget: 15000 });
  assert.equal(mock.calls[0].options.virtualTimeBudget, 15000);
});

test('Renderer 포트가 없으면 생성 실패', () => {
  assert.throws(() => new RenderPdf({ renderer: {} }), /Renderer 포트/);
});
