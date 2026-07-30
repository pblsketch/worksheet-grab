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

test('P1 수용: 12종 조직자를 다중페이지 매니페스트로 렌더 시 각 조직자 인쇄물 존재 + 편집=인쇄 쪽수(실물 Chrome)',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const v = await repo.readVocabulary();
    const organizers = [
      'kwl', 'frayer', 'w5h1', 'bme', 'exit321', 'mainidea',
      'notetaking', 'hamburger', 'perspectives', 'prediction', 'glowgrow', 'stoplight',
    ];
    // 조직자를 페이지당 2개로 나눠 배치(A4 넘침 방지) — 넘치면 인쇄 쪽수>편집 쪽수 로 잡힌다.
    const entry = (t) => ({ type: t, file: v.types[t].file });
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: '시각 조직자 렌더 점검', standards: [],
      pages: [
        [{ type: 'header', file: v.types['header'].file }, entry('kwl'), entry('frayer')],
        [entry('w5h1'), entry('bme')],
        [entry('exit321'), entry('mainidea')],
        [entry('notetaking'), entry('hamburger')],
        [entry('perspectives'), entry('prediction')],
        [entry('glowgrow'), entry('stoplight')],
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

test('P1 Track B: 그림형(SVG) 조직자 7종이 실물 Chrome 으로 SVG 렌더 + 편집=인쇄 쪽수',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const v = await repo.readVocabulary();
    const diagrams = ['venn', 'conceptmap', 'fishbone', 'plotdiagram', 'hierarchy', 'flowchart', 'hexagon'];
    const entry = (t) => ({ type: t, file: v.types[t].file });
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: '그림형 조직자 렌더 점검', standards: [],
      pages: [
        [{ type: 'header', file: v.types['header'].file }, entry('venn'), entry('conceptmap')],
        [entry('fishbone'), entry('plotdiagram')],
        [entry('hierarchy'), entry('flowchart')],
        [entry('hexagon')],
      ],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: { async resolve(c) { return { code: c, text: `원문(${c})` }; } } });
    const { html, worksheet } = await asm.execute(manifest);
    for (const t of diagrams) {
      assert.match(html, new RegExp(`class="[^"]*\\b${v.types[t].cssClass}\\b`), `${t} HTML 존재`);
    }
    assert.match(html, /<svg/, 'SVG 방출');
    const dir = await autoTmpDir('wsg-diag-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const inPath = join(dir, 'diag.html');
    const outPath = join(dir, 'diag.pdf');
    await writeFile(inPath, html.replace(/MODE_TOKEN/g, 'teacher'), 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.equal(pages, worksheet.pageCount(), `인쇄 쪽수(${pages}) == 편집 쪽수(${worksheet.pageCount()}) — SVG 넘침 없음`);
  });

test('P1 배치3: 독서·문학 조직자 4종(에세이 섹션 스택 포함) 실물 Chrome 렌더 + 편집=인쇄 쪽수',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const v = await repo.readVocabulary();
    const entry = (t) => ({ type: t, file: v.types[t].file });
    const manifest = {
      subject: 'x', theme: 'ko', docTitle: '독서·문학 조직자 렌더 점검', standards: [],
      pages: [
        [{ type: 'header', file: v.types['header'].file }, entry('bookreview')],
        [entry('character'), entry('quotejournal')],
        [entry('essayplan')],
      ],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: { async resolve(c) { return { code: c, text: `원문(${c})` }; } } });
    const { html, worksheet } = await asm.execute(manifest);
    for (const t of ['bookreview', 'character', 'quotejournal', 'essayplan']) {
      assert.match(html, new RegExp(`class="[^"]*\\b${v.types[t].cssClass}\\b`), `${t} HTML 존재`);
    }
    assert.match(html, /class="ep-sec keep"/, '에세이 섹션별 keep');
    const dir = await autoTmpDir('wsg-lit-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const inPath = join(dir, 'lit.html');
    const outPath = join(dir, 'lit.pdf');
    await writeFile(inPath, html.replace(/MODE_TOKEN/g, 'teacher'), 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.equal(pages, worksheet.pageCount(), `인쇄 쪽수(${pages}) == 편집 쪽수(${worksheet.pageCount()}) — 에세이 스택 넘침 없음`);
  });

test('파라메트릭: 3원 벤 + 5칸·6칸 개념지도가 실물 Chrome 으로 렌더 + 편집=인쇄 쪽수(넘침 없음)',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: '파라메트릭 조직자 렌더 점검', standards: [],
      pages: [
        [{ type: 'venn', params: { circles: 3 } }, { type: 'conceptmap', params: { nodes: 5 } }],
        [{ type: 'conceptmap', params: { nodes: 6 } }],
      ],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: { async resolve(c) { return { code: c, text: `원문(${c})` }; } } });
    const { html, worksheet } = await asm.execute(manifest);
    assert.equal((html.match(/<circle/g) || []).length, 3, '3원 벤');
    assert.equal((html.match(/class="cm-node"/g) || []).length, 11, '5칸+6칸=11 노드');
    const dir = await autoTmpDir('wsg-param-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const inPath = join(dir, 'param.html');
    const outPath = join(dir, 'param.pdf');
    await writeFile(inPath, html.replace(/MODE_TOKEN/g, 'teacher'), 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.equal(pages, worksheet.pageCount(), `인쇄 쪽수(${pages}) == 편집 쪽수(${worksheet.pageCount()}) — 파라메트릭 SVG 넘침 없음`);
  });

test('가로 자동맞춤: compose --archetype landscape-organizer → 가로 A4, 페이지당 조직자 하나 자동 맞춤(잘림 0)',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const curriculum = new GepaiCurriculum({});
    const compose = new ComposeWorksheet({ blockRepository: repo, curriculum });
    const { manifest } = await compose.execute({
      grade: '중2', subject: '과학', topic: '광합성', archetype: 'landscape-organizer', codes: ['[9과12-01]'],
    });
    assert.equal(manifest.paper?.orientation, 'landscape', '가로 용지');
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum });
    const { html, worksheet } = await asm.execute(manifest);
    assert.match(html, /<svg/, 'SVG 조직자 렌더');

    const dir = await autoTmpDir('wsg-lsorg-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const inPath = join(dir, 'lsorg.html');
    const outPath = join(dir, 'lsorg.pdf');
    await writeFile(inPath, html.replace(/MODE_TOKEN/g, 'teacher'), 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.equal(pages, worksheet.pageCount(), `인쇄 쪽수(${pages}) == 편집 쪽수(${worksheet.pageCount()}) — 가로 조직자 잘림·넘침 0`);
  });

test('파라메트릭 확장: 피시본6·흐름도6·위계5·헥사곤7 실물 Chrome 렌더 + 편집=인쇄 쪽수',
  { skip: !READY, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: '파라메트릭 확장 렌더 점검', standards: [],
      pages: [
        [{ type: 'fishbone', params: { branches: 6 } }, { type: 'flowchart', params: { steps: 6 } }],
        [{ type: 'hierarchy', params: { children: 5 } }, { type: 'hexagon', params: { count: 7 } }],
      ],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: { async resolve(c) { return { code: c, text: `원문(${c})` }; } } });
    const { html, worksheet } = await asm.execute(manifest);
    assert.equal((html.match(/class="fb-branch"/g) || []).length, 6, '피시본 6가지');
    assert.equal((html.match(/class="hx"/g) || []).length, 7, '헥사곤 7개');
    const dir = await autoTmpDir('wsg-pext-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const inPath = join(dir, 'pext.html');
    const outPath = join(dir, 'pext.pdf');
    await writeFile(inPath, html.replace(/MODE_TOKEN/g, 'teacher'), 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const pages = await countPdfPages(outPath);
    assert.equal(pages, worksheet.pageCount(), `인쇄 쪽수(${pages}) == 편집 쪽수(${worksheet.pageCount()}) — 확장 SVG 넘침 없음`);
  });

test('교사 예시(#4): 저작된 프레이어(.answer) 학생·교사 2벌이 실물 Chrome 으로 1쪽 인쇄(편집=인쇄, 넘침 0)',
  { skip: !READY, timeout: 120000 }, async () => {
    // designer AI 가 브리프대로 정답 칸을 .answer 로 저작한 프레이어(엔진 구조 불변, 예시 내용만 저작).
    const authoredFrayer = `<table class="frayer keep">
    <caption>개념: 광합성</caption>
    <tr><th>정의</th><th>특징</th></tr>
    <tr><td class="fq"><span class="answer">빛에너지로 양분을 만드는 과정</span></td><td class="fq"><span class="answer">엽록체에서 일어난다</span></td></tr>
    <tr><th>예</th><th>예가 아닌 것</th></tr>
    <tr><td class="fq"><span class="answer">식물의 잎</span></td><td class="fq"><span class="answer">세포호흡</span></td></tr>
  </table>`;
    const repo = new FsBlockRepository({ root: ROOT });
    const v = await repo.readVocabulary();
    const manifest = {
      subject: 'x', theme: 'sci', docTitle: '프레이어 교사 예시', standards: [],
      pages: [[{ type: 'header', file: v.types['header'].file }, { type: 'frayer', html: authoredFrayer }]],
    };
    const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: { async resolve(c) { return { code: c, text: `원문(${c})` }; } } });
    const { html } = await asm.execute(manifest);

    const { student, teacher } = new BuildVariants().execute(html);
    // 교사용 HTML 엔 모범 예시가, 학생용 HTML 엔 정답이 물리 제거됐음을 렌더 직전에 재확인(누출 게이트).
    assert.match(teacher, /빛에너지로 양분을 만드는 과정/, '교사용에 모범 예시 존재');
    assert.ok(!student.includes('빛에너지로 양분을 만드는 과정'), '학생용 정답 물리 제거');

    const dir = await autoTmpDir('wsg-frayans-');
    const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
    const declared = manifest.pages.length;
    for (const [mode, doc] of [['student', student], ['teacher', teacher]]) {
      const inPath = join(dir, `frayans-${mode}.html`);
      const outPath = join(dir, `frayans-${mode}.pdf`);
      await writeFile(inPath, doc, 'utf8');
      await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
      const pages = await countPdfPages(outPath);
      assert.equal(pages, declared, `${mode}: 인쇄 쪽수(${pages}) == 편집 쪽수(${declared}) — 교사 예시 프레이어 넘침·잘림 없음`);
    }
  });
