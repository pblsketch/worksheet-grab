import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum, DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { ComposeWorksheet } from '../../src/usecases/ComposeWorksheet.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

// P1 수용(인쇄=최종 판정): 시각 조직자(Track A)가 실물 Chrome 으로 잘림·넘침 없이 인쇄된다.
// 편집 쪽수(manifest.pages.length) == 인쇄 PDF 쪽수를 기계로 확인한다(R2-1 불변식).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);

test('P1 수용: compose --archetype kwl-inquiry → 조직자 포함 A4 student+teacher PDF (실물 Chrome, 편집=인쇄 쪽수)',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const curriculum = new GepaiCurriculum({}); // MCP off = CSV 경로
    const compose = new ComposeWorksheet({ blockRepository: repo, curriculum });
    const { manifest } = await compose.execute({
      grade: '중2', subject: '과학', topic: '광합성', archetype: 'kwl-inquiry', codes: ['[9과12-01]'],
    });

    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
    const { html } = await asm.execute(manifest);
    assert.match(html, /class="[^"]*\bkwl\b/, 'KWL 조직자 렌더');
    assert.match(html, /class="[^"]*\bkeep\b/, '조직자 keep(page-break-inside:avoid) 방출');

    const { student, teacher } = new BuildVariants().execute(html);
    const dir = await autoTmpDir('wsg-org-');
    const renderer = new ChromeRenderer({});
    const rp = new RenderPdf({ renderer });
    const declared = manifest.pages.length;

    for (const [mode, doc] of [['student', student], ['teacher', teacher]]) {
      const inPath = join(dir, `org-${mode}.html`);
      const outPath = join(dir, `org-${mode}.pdf`);
      await writeFile(inPath, doc, 'utf8');
      await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
      const pages = await countPdfPages(outPath);
      assert.equal(pages, declared, `${mode}: 인쇄 쪽수(${pages}) == 편집 쪽수(${declared}) — 조직자 넘침·잘림 없음`);
    }
  });

test('P1 수용: 6종 조직자를 한 페이지 매니페스트로 렌더 시 각 조직자가 인쇄물에 존재(실물 Chrome)',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const v = await repo.readVocabulary();
    const organizers = ['kwl', 'frayer', 'w5h1', 'bme', 'exit321', 'mainidea'];
    // 조직자를 2쪽에 나눠 배치(한 쪽에 다 넣으면 A4 초과) — 헤더 + 3개씩.
    const entry = (t) => ({ type: t, file: v.types[t].file });
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: '시각 조직자 렌더 점검', standards: [],
      pages: [
        [{ type: 'header', file: v.types['header'].file }, entry('kwl'), entry('frayer'), entry('w5h1')],
        [entry('bme'), entry('exit321'), entry('mainidea')],
      ],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: { async resolve(c) { return { code: c, text: `원문(${c})` }; } } });
    const { html, worksheet } = await asm.execute(manifest);
    for (const t of organizers) {
      assert.match(html, new RegExp(`class="[^"]*\\b${v.types[t].cssClass}\\b`), `${t} HTML 존재`);
    }
    const dir = await autoTmpDir('wsg-org6-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const inPath = join(dir, 'org6.html');
    const outPath = join(dir, 'org6.pdf');
    await writeFile(inPath, html.replace(/MODE_TOKEN/g, 'teacher'), 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.equal(pages, worksheet.pageCount(), `인쇄 쪽수(${pages}) == 편집 쪽수(${worksheet.pageCount()})`);
  });
