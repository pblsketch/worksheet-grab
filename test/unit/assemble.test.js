import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// 커리큘럼 포트 목: 코드→원문(주입 경로 검증). 실제 CSV/MCP 없이도 동작.
const mockCurriculum = {
  async resolve(code) { return { code, text: `원문(${code})`, subject: 'test' }; },
};

async function assemble(name) {
  const repo = new FsBlockRepository({ root: ROOT });
  const manifest = await repo.readManifest(name);
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: mockCurriculum });
  return asm.execute(manifest);
}

test('수용기준 5: 재조립 국어는 5쪽 구성을 유지한다', async () => {
  const { worksheet } = await assemble('ko');
  assert.equal(worksheet.pageCount(), 5);
});

test('수용기준 5: 재조립 과학은 3쪽 구성을 유지한다', async () => {
  const { worksheet } = await assemble('sci');
  assert.equal(worksheet.pageCount(), 3);
});

test('수용기준 5: 재조립 국어에 주요 컴포넌트 존재', async () => {
  const { html } = await assemble('ko');
  for (const cls of ['std-box', 'passage', 'pc', 'memo', 'rubric', 'lv-table']) {
    assert.match(html, new RegExp(`class="[^"]*\\b${cls}\\b`), `국어에 .${cls} 컴포넌트 필요`);
  }
});

test('수용기준 5: 재조립 과학에 주요 컴포넌트 존재(변인표·데이터표·SVG·수식)', async () => {
  const { html } = await assemble('sci');
  for (const cls of ['std-box', 'vartable', 'data', 'graphwrap', 'formula', 'rubric']) {
    assert.match(html, new RegExp(`class="[^"]*\\b${cls}\\b`), `과학에 .${cls} 컴포넌트 필요`);
  }
  assert.match(html, /<svg/, 'SVG 그래프 존재');
  assert.match(html, /katex/, 'KaTeX 로더 존재');
});

test('성취기준 원문은 커리큘럼 포트로 주입된다(CSV/MCP 조회, 창작 금지)', async () => {
  const { html, worksheet } = await assemble('ko');
  assert.ok(worksheet.standards.length >= 1);
  assert.match(html, /원문\(\[12독작01-01\]\)/, '표준 라벨이 주입된 원문을 사용');
  assert.match(html, /data-mode="MODE_TOKEN"/, '조립 산출은 MODE_TOKEN 을 유지(2벌 치환 전)');
});

test('파라메트릭 시각 조직자에 저작 라벨이 반영된다', async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: mockCurriculum });
  const { html } = await asm.execute({
    subject: 'science',
    theme: 'sci',
    pages: [[{
      type: 'venn',
      params: { circles: 3 },
      labels: { a: '고체', b: '액체', c: '기체', common: '입자로 이루어진 물질' },
    }]],
  });

  for (const label of ['고체', '액체', '기체', '입자로 이루어진 물질']) {
    assert.match(html, new RegExp(label), `조직자 라벨 반영: ${label}`);
  }
});
