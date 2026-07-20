import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum, DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { GenerateWorksheet } from '../../src/usecases/GenerateWorksheet.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);

// M2 수용: generate 중2과학 광합성 → CSV(MCP off) 로 유효 A4 student+teacher PDF, 헤더 성취기준 원문.
test('M2 수용: generate 중2과학 광합성 → 유효 A4 student+teacher PDF (MCP off/CSV)', { skip: !READY, timeout: 120000 }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const curriculum = new GepaiCurriculum({}); // mcpClient 없음 = MCP off, CSV 경로
  const gen = new GenerateWorksheet({ blockRepository: repo, curriculum });
  const { html, standards } = await gen.execute({ grade: '중2', subject: '과학', topic: '광합성' });

  // 헤더에 올바른 성취기준 원문
  assert.ok(standards.some((s) => s.code === '[9과12-01]'), '광합성 성취기준 조회');
  assert.match(html, /광합성 과정을 이해하고/, '헤더 원문 주입');

  const { student, teacher } = new BuildVariants().execute(html);
  const dir = await mkdtemp(join(tmpdir(), 'wsg-gen-'));
  const renderer = new ChromeRenderer({});
  const rp = new RenderPdf({ renderer });

  for (const [mode, doc] of [['student', student], ['teacher', teacher]]) {
    const inPath = join(dir, `gen-${mode}.html`);
    const outPath = join(dir, `gen-${mode}.pdf`);
    await writeFile(inPath, doc, 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.ok(pages >= 1, `${mode} PDF 는 최소 1쪽 이상의 유효 A4 (실측 ${pages})`);
    assert.equal(pages, 3, `${mode} 는 과학 템플릿 3쪽`);
  }
});
