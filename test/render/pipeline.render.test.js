import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { GepaiCurriculum, DEFAULT_CSV_PATH } from '../../src/adapters/GepaiCurriculum.js';
import { ChromePaginationMeasurer } from '../../src/adapters/PaginationMeasurer.js';
import { RunPipeline } from '../../src/usecases/RunPipeline.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { ExportDocument } from '../../src/usecases/ExportDocument.js';
import { PaginateObjectTree } from '../../src/usecases/PaginateObjectTree.js';
import { PaginateAndExport } from '../../src/usecases/PaginateAndExport.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { run } from '../../src/cli/index.js';
import { autoTmpDir } from '../helpers/tmp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const READY = chromeAvailable() && existsSync(DEFAULT_CSV_PATH);
const HAS_CHROME = chromeAvailable();
const TIMEOUT = 180000;

// M3 수용: 교사의 한 문장(학년교과+주제) → 검수 게이트 통과 후 활동지 산출.
test('M3 수용: pipeline 한 문장 → 검수 PASS → student/teacher A4 PDF (MCP off/CSV)', { skip: !READY, timeout: 120000 }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const curriculum = new GepaiCurriculum({}); // MCP off, CSV 경로
  const r = await new RunPipeline({ blockRepository: repo, curriculum })
    .execute({ grade: '중2', subject: '과학', topic: '광합성' });

  assert.equal(r.gate, true, '검수 게이트 PASS 여야 렌더 진행(fail-closed)');
  assert.ok(r.standards.some((s) => s.code === '[9과12-01]'), '성취기준 조회');

  const dir = await autoTmpDir('wsg-pipe-');
  const rp = new RenderPdf({ renderer: new ChromeRenderer({}) });
  for (const [mode, doc] of [['student', r.student], ['teacher', r.teacher]]) {
    const inPath = join(dir, `p-${mode}.html`);
    const outPath = join(dir, `p-${mode}.pdf`);
    await writeFile(inPath, doc, 'utf8');
    await rp.execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    assert.equal(await countPdfPages(outPath), 3, `${mode} A4 PDF 3쪽`);
  }
});

// 회귀(QA): CLI 기본 렌더 경로 — base 가 if(!useDoc) 블록 스코프에 갇혀
// ReferenceError 로 전멸하던 버그. usecase 직접 호출이 아닌 run() 종단으로 계측한다.
test('M3 회귀: CLI pipeline 기본 렌더 경로가 student/teacher PDF 를 산출(exit 0)', { skip: !READY, timeout: 120000 }, async () => {
  const dir = await autoTmpDir('wsg-pipe-cli-');
  const lines = [];
  const code = await run(['pipeline', '중2과학', '광합성', '--out', dir], {
    root: ROOT, log: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)),
  });
  assert.equal(code, 0, `exit 0 이어야 한다:\n${lines.join('\n')}`);
  for (const mode of ['student', 'teacher']) {
    const pdf = join(dir, `science-광합성-${mode}.pdf`);
    assert.ok(existsSync(pdf), `${mode} PDF 산출: ${pdf}`);
    assert.equal(await countPdfPages(pdf), 3, `${mode} A4 PDF 3쪽`);
  }
});

// ── S3.5(US-14) — 생성 파이프라인 페이지네이션 패스 + ExportDocument↔checkExportGate 배선 ──
// 06_plan_final.md 194~199행(D-A/R2-1/R2-4). "Chrome 없이 단위" 원칙의 명시적 예외: 이 구간은
// PaginateObjectTree(Chrome 측정 패스)·ExportDocument(Chrome print-to-pdf)를 실제로 구동한다.
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개, wsg-* 정리).

/** 합성 넘침 스캐폴드(개체 트리, pagination:'scaffold') — A4 1쪽 가용 높이를 확실히 넘기는 richtext 다량.
 *  paginate.render.test.js 의 buildOverflowScaffold 와 동형 픽스처(같은 결정성 테스트 패턴, R2-1 재사용). */
function buildScaffoldDoc(n = 50) {
  const flow = [];
  for (let i = 0; i < n; i++) {
    flow.push({
      id: `ov-${i}`,
      type: 'richtext',
      placement: 'flow',
      html: `<p>US-14 파이프라인 페이지네이션 패스 픽스처 문단 ${i} — 생성 경계와 재페이지네이션 ` +
        `경계가 동일한지, 인쇄 실측 페이지 수와 귀속 페이지 수가 동치인지 검증하는 한국어 본문입니다.</p>`,
    });
  }
  return {
    docTitle: 'US-14 파이프라인 픽스처', subject: 'science', dataSubject: 'science',
    themeName: '', lang: 'ko', runHead: 'US-14', runFoot: { left: 'US-14', rightPrefix: '' },
    standards: [], paper: null,
    pagination: 'scaffold',
    pages: [{ flow, float: [] }],
  };
}

async function loadAssets(repo, themeName = 'ko') {
  const [paperCss, blocksCss, themeCss] = await Promise.all([
    repo.readAsset('paper.css'),
    repo.readAsset('blocks.css'),
    repo.loadThemeCss(themeName),
  ]);
  return { paperCss, blocksCss, themeCss };
}

test('US-14: scaffold 문서 직접 export → 거부(checkExportGate 사유, fail-closed)', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const wsDir = await autoTmpDir('wsg-us14-gate-');
  try {
    const repo = new FsBlockRepository({ root: ROOT });
    const workspace = new FsWorkspaceRepository({ baseDir: wsDir });
    const saver = new SaveDocument({ workspace, blockRepository: repo, curriculum: null });
    await saver.checkpoint({ name: '문서', document: buildScaffoldDoc(5) });

    const renderer = new ChromeRenderer({});
    const exporter = new ExportDocument({ workspace, renderer, fileExists: existsSync, removeFile: rm });
    await assert.rejects(
      () => exporter.execute({ name: '문서' }),
      /scaffold-not-exportable|Chrome 측정 페이지네이션 패스/,
      'scaffold 문서는 checkExportGate 사유로 export 가 거부되어야 함',
    );
  } finally {
    await rm(wsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
});

test('US-14: scaffold → 페이지네이션 패스(PaginateAndExport) → paginated → export 성공(2벌 PDF)', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const wsDir = await autoTmpDir('wsg-us14-export-');
  try {
    const repo = new FsBlockRepository({ root: ROOT });
    const workspace = new FsWorkspaceRepository({ baseDir: wsDir });
    const measurer = new ChromePaginationMeasurer({});
    const renderer = new ChromeRenderer({});
    const pipeline = new PaginateAndExport({ workspace, blockRepository: repo, measurer, renderer, fileExists: existsSync, removeFile: rm });

    const scaffold = buildScaffoldDoc(50);
    const result = await pipeline.execute({ name: '문서', document: scaffold, virtualTimeBudget: 15000 });

    assert.equal(result.unsafe, false);
    assert.deepEqual(result.rendered.map((x) => x.variant), ['teacher', 'student'], 'scaffold 승격 후 2벌 PDF 산출');
    assert.ok(result.pageCount >= 2, `50문단은 A4 1쪽을 넘겨야 함(실측 ${result.pageCount}쪽)`);

    const layout = workspace.layout('문서');
    for (const p of [layout.teacherPdfPath, layout.studentPdfPath]) {
      assert.ok(existsSync(p), `PDF 산출: ${p}`);
    }

    // 저장된 문서는 paginated 로 승격되어 있어야 재 export 도 거부 없이 통과한다(계약 확인).
    const savedManifest = await workspace.readManifest('문서');
    assert.equal(savedManifest.pagination, 'paginated', 'checkpoint 저장분은 paginated 로 승격되어야 함');
  } finally {
    await rm(wsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
});

test('US-14: 생성 경계 == 재페이지네이션 경계 — 같은 scaffold 를 독립 2회 페이지네이션 → 개체→페이지 귀속 동일(R2-1)', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const scaffold = buildScaffoldDoc(50);
  const measurer = new ChromePaginationMeasurer({});

  // US-09(paginate.render.test.js) 결정성 테스트와 동일 패턴: 독립된 PaginateObjectTree 인스턴스로
  // 완전히 별개의 Chrome 프로세스 2회 실행 — "생성 1회"와 "재페이지네이션 1회"를 시뮬레이션한다.
  const run1 = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, {});
  const run2 = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, {});

  assert.deepEqual(run1.pageOfId, run2.pageOfId, '생성 경계와 재페이지네이션 경계의 개체→페이지 귀속이 완전히 동일해야 함');
  assert.equal(run1.document.pages.length, run2.document.pages.length, '페이지 수도 동일해야 함');
});

test('US-14: 인쇄 동치 — paginated 귀속 페이지수 == print-to-pdf 실측 페이지수', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const wsDir = await autoTmpDir('wsg-us14-printeq-');
  try {
    const repo = new FsBlockRepository({ root: ROOT });
    const workspace = new FsWorkspaceRepository({ baseDir: wsDir });
    const measurer = new ChromePaginationMeasurer({});
    const renderer = new ChromeRenderer({});
    const pipeline = new PaginateAndExport({ workspace, blockRepository: repo, measurer, renderer, fileExists: existsSync, removeFile: rm });

    const scaffold = buildScaffoldDoc(50);
    const result = await pipeline.execute({ name: '문서', virtualTimeBudget: 15000, document: scaffold });

    const layout = workspace.layout('문서');
    const printedPages = await countPdfPages(layout.teacherPdfPath);
    assert.equal(printedPages, result.pageCount,
      `인쇄 실측 페이지 수(${printedPages})가 페이지네이션 귀속 페이지 수(${result.pageCount})와 동치여야 함(하드 동치)`);
  } finally {
    await rm(wsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
});
