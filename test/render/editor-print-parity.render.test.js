import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { ChromeRenderer, resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { ChromePaginationMeasurer } from '../../src/adapters/PaginationMeasurer.js';
import { PaginateObjectTree } from '../../src/usecases/PaginateObjectTree.js';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';

// US-17(S4.2, M4a) — "편집==인쇄 하드 동치" 3자 대조(과제 지시 §산출 3, R2-1). 같은 flow 개체
// 목록을 세 경로로 각각 페이지네이션하고 비교한다:
//   ①편집기 리플로우(reflow.js, 브라우저 자체 측정) — /shell.json 재조회로 pageOfId 도출
//   ②PaginateObjectTree(Chrome 어댑터 측정, S2.5/US-09) — pageOfId 직접 산출
//   ③실제 Chrome print-to-pdf 페이지 수(①의 저장본을 렌더 → PDF)
// "하드 동치"는 바이트 동일이 아니라 개체→페이지 귀속(pageOfId)이 완전히 같다는 뜻(R2-1).
//
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개, wsg-* 정리).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const TIMEOUT = 180000;

function dumpDom(url, timeoutMs = 90000, windowSize = '1280,1600') {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-parity-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=60000',
    ...(windowSize ? [`--window-size=${windowSize}`] : []),
    '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-1200)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

async function loadAssets(repo, themeName = 'ko') {
  const [paperCss, blocksCss, themeCss] = await Promise.all([
    repo.readAsset('paper.css'),
    repo.readAsset('blocks.css'),
    repo.loadThemeCss(themeName),
  ]);
  return { paperCss, blocksCss, themeCss };
}

/** 합성 넘침 픽스처 — A4 한 페이지 가용 높이를 확실히 넘기는 richtext 다량(paginate.render.test.js 와 동형). */
function buildOverflowItems(n = 45) {
  return Array.from({ length: n }, (_, i) => ({
    id: `pv-${i}`,
    type: 'richtext',
    placement: 'flow',
    html: `<p>3자 하드 동치 픽스처 문단 ${i} — 편집기 리플로우·Chrome 페이지네이션·인쇄 PDF 세 ` +
      `경로의 개체→페이지 귀속이 완전히 같은지 검증하기 위한 한국어 본문입니다.</p>`,
  }));
}

/** 표 포함 픽스처 — 채움 문단이 표를 다음 페이지로 밀어내는 시나리오(paginate.render.test.js 와 동형). */
function buildTableItems(fillerCount = 10, rows = 25) {
  const filler = Array.from({ length: fillerCount }, (_, i) => ({
    id: `pv-filler-${i}`, type: 'richtext', placement: 'flow',
    html: `<p>표 앞 채움 문단 ${i} — 표가 남은 공간에 다 들어가지 않아 통째로 다음 페이지로 이동하는지 확인하기 위한 지면 채우기 본문입니다.</p>`,
  }));
  const tableRows = Array.from({ length: rows }, (_, i) => [{ text: `행 ${i + 1}` }, { text: `값 ${i + 1}` }]);
  return [
    { id: 'pv-lead-title', type: 'title', placement: 'flow', text: '3자 하드 동치 — 표 포함 픽스처' },
    ...filler,
    { id: 'pv-big-table', type: 'table', placement: 'flow', splittable: false, rows: tableRows },
    { id: 'pv-after-note', type: 'richtext', placement: 'flow', html: '<p>표 다음 안내문입니다.</p>' },
  ];
}

/** ②PaginateObjectTree(Chrome 어댑터 측정) 경로 — 순수 scaffold→paginated. */
async function computeChromePagination(items, assets, meta) {
  const measurer = new ChromePaginationMeasurer({});
  const scaffold = { pagination: 'scaffold', pages: [{ flow: items, float: [] }] };
  const { document, pageOfId } = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, meta);
  return { pageOfId, pageCount: document.pages.length, document };
}

/**
 * ①편집기 리플로우 경로 — items 전부를 "아직 리플로우되지 않은" 단일 페이지 문서로 저장한 뒤
 * (마이그레이션 직후처럼) EditorHttpServer 를 띄워 ?seed=reflow-once 로 편집기 자신의 브라우저
 * paginator(reflow.js) 를 1회 실행·저장하고, /shell.json 재조회로 실제 귀속을 읽어낸다.
 */
async function computeEditorPagination(items, docName, meta) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-parity-ws-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  const singlePageDoc = {
    pagination: 'paginated',
    docTitle: meta.docTitle || '',
    subject: meta.dataSubject || '',
    dataSubject: meta.dataSubject || '',
    themeName: meta.themeName || '',
    lang: meta.lang || 'ko',
    paper: meta.paper ?? null,
    standards: [],
    pages: [{ flow: items, float: [] }],
  };
  await saver.checkpoint({ name: docName, document: singlePageDoc, now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  const url = `http://127.0.0.1:${addr.port}`;
  try {
    const dom = await dumpDom(`${url}/?seed=reflow-once`);
    assert.equal(ds(dom, 'seed-done'), 'reflow-once', '리플로우 1회 시드가 끝까지 실행됨');
    assert.equal(ds(dom, 'ro-save-ok'), 'true', '편집기 리플로우 저장이 성공해야 함(정답 누출 없음)');

    const shellRes = await fetch(`${url}/shell.json`);
    const shell = await shellRes.json();
    const pageOfId = {};
    shell.document.pages.forEach((p, idx) => { for (const o of p.flow) pageOfId[o.id] = idx; });
    return { pageOfId, pageCount: shell.document.pages.length, document: shell.document };
  } finally {
    await new Promise((r) => server.close(r));
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

/** ③인쇄 PDF 페이지 수 — 저장된 paginated 문서를 그대로 렌더 → print-to-pdf 실측. */
async function countPrintedPages(document, assets, meta, label) {
  const { html } = new RenderObjectTree().execute(document, assets, meta);
  const dir = await mkdtemp(join(tmpdir(), 'wsg-parity-print-'));
  const inPath = join(dir, `${label}.html`);
  const outPath = join(dir, `${label}.pdf`);
  await writeFile(inPath, html, 'utf8');
  const renderer = new ChromeRenderer({});
  try {
    await new RenderPdf({ renderer }).execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    return await countPdfPages(outPath);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

test('3자 하드 동치 — 합성 넘침 픽스처: 편집기 리플로우 == PaginateObjectTree(Chrome) == 인쇄 PDF', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const items = buildOverflowItems(45);
  const meta = { docTitle: '3자 하드동치 — 합성 넘침', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null };

  const chromeResult = await computeChromePagination(items, assets, meta);
  assert.ok(chromeResult.pageCount >= 2, `픽스처가 여러 페이지를 만들어야 검증 의미가 있음(실측 ${chromeResult.pageCount})`);

  const editorResult = await computeEditorPagination(items, '3자동치-넘침', meta);

  assert.deepEqual(editorResult.pageOfId, chromeResult.pageOfId,
    '편집기 리플로우 귀속이 Chrome PaginateObjectTree 귀속과 완전히 같아야 함(하드 동치, R2-1)');
  assert.equal(editorResult.pageCount, chromeResult.pageCount, '페이지 수도 동일해야 함');

  const printedPages = await countPrintedPages(editorResult.document, assets, meta, 'parity-overflow');
  assert.equal(printedPages, editorResult.pageCount, '인쇄 PDF 페이지 수가 편집기 리플로우 페이지 수와 동치여야 함');
  assert.equal(printedPages, chromeResult.pageCount, '인쇄 PDF 페이지 수가 Chrome 페이지네이션 페이지 수와도 동치여야 함');
});

test('3자 하드 동치 — 표 포함 픽스처(통째 이동): 편집기 리플로우 == PaginateObjectTree(Chrome) == 인쇄 PDF', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const items = buildTableItems(10, 25);
  const meta = { docTitle: '3자 하드동치 — 표 포함', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null };

  const chromeResult = await computeChromePagination(items, assets, meta);
  assert.ok(chromeResult.pageCount >= 2, '채움 문단이 표를 다음 페이지로 밀어내야 검증 의미가 있음');

  const editorResult = await computeEditorPagination(items, '3자동치-표', meta);

  assert.deepEqual(editorResult.pageOfId, chromeResult.pageOfId,
    '편집기 리플로우 귀속이 Chrome PaginateObjectTree 귀속과 완전히 같아야 함(하드 동치, R2-1)');
  assert.equal(editorResult.pageCount, chromeResult.pageCount);

  // 표 미분할 무회귀: 편집기 저장본에서도 표가 정확히 한 페이지에만, 행 수 그대로 존재해야 한다.
  const pagesWithTable = editorResult.document.pages.filter((p) => p.flow.some((o) => o.id === 'pv-big-table'));
  assert.equal(pagesWithTable.length, 1, '편집기 리플로우 결과에서도 표는 정확히 한 페이지에만 존재해야 함');
  assert.equal(pagesWithTable[0].flow.find((o) => o.id === 'pv-big-table').rows.length, 25, '표 행 수는 분할 없이 원본 그대로');

  const printedPages = await countPrintedPages(editorResult.document, assets, meta, 'parity-table');
  assert.equal(printedPages, editorResult.pageCount, '인쇄 PDF 페이지 수가 편집기 리플로우 페이지 수와 동치여야 함');
  assert.equal(printedPages, chromeResult.pageCount, '인쇄 PDF 페이지 수가 Chrome 페이지네이션 페이지 수와도 동치여야 함');
});
