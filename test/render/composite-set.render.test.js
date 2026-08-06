import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { ChromePaginationMeasurer } from '../../src/adapters/PaginationMeasurer.js';
import { PaginateObjectTree } from '../../src/usecases/PaginateObjectTree.js';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

// P3-b 복합 세트(페이지별 방향 혼합) — 이질 용지 하드 동치 + 페이지별 MediaBox 실측.
//   AC-P3-2: 복합 세트 PDF 가 페이지별 MediaBox 방향 혼합으로 생성(pt 실측).
//   AC-P3-3: 편집==인쇄 하드 동치가 이질 용지에서도 성립 — 엔진(Chrome 측정) 예측 페이지수 ==
//            실제 인쇄 PDF 페이지수(넘침 없음). 가로 페이지의 작은 가용높이가 반영되는지 검증.
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const TIMEOUT = 180000;

async function loadAssets(repo, themeName = 'ko') {
  const [paperCss, blocksCss, themeCss] = await Promise.all([
    repo.readAsset('paper.css'), repo.readAsset('blocks.css'), repo.loadThemeCss(themeName),
  ]);
  return { paperCss, blocksCss, themeCss };
}

async function allMediaBoxes(pdfPath) {
  const s = (await readFile(pdfPath)).toString('latin1');
  return [...s.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => ({ w: +m[3] - +m[1], h: +m[4] - +m[2] }));
}

const para = (id, i) => ({
  id, type: 'richtext', placement: 'flow',
  html: `<p>복합 세트 하드 동치 픽스처 문단 ${i} — 세로 페이지와 가로 페이지의 가용 높이가 다르므로 ` +
    `페이지별 용량이 페이지네이션에 정확히 반영되는지, 그리고 실제 인쇄가 그 예측과 어긋나지 않는지 ` +
    `검증하기 위한 한국어 본문입니다.</p>`,
});

/** 세로 문서 + 가로 override 페이지 복합 세트 scaffold. 가로 버킷은 page-break 로 시작해 가로 페이지에 안착. */
function buildCompositeScaffold() {
  const p0 = [{ id: 'c-title', type: 'title', placement: 'flow', text: '복합 세트 — 1쪽 세로 / 2쪽 가로' }];
  for (let i = 0; i < 8; i++) p0.push(para(`c-p0-${i}`, i));
  const p1 = [{ id: 'c-pb', type: 'page-break', placement: 'flow' }];
  for (let i = 0; i < 14; i++) p1.push(para(`c-p1-${i}`, i));
  return {
    pagination: 'scaffold',
    pages: [
      { flow: p0, float: [] },
      { paper: { orientation: 'landscape' }, flow: p1, float: [] },
    ],
  };
}

async function renderToPdf(document, assets, meta, label) {
  const { html } = new RenderObjectTree().execute(document, assets, meta);
  const { student } = new BuildVariants().execute(html);
  const dir = await autoTmpDir('wsg-composite-');
  const inPath = join(dir, `${label}.html`);
  const outPath = join(dir, `${label}.pdf`);
  await writeFile(inPath, student, 'utf8');
  try {
    await new RenderPdf({ renderer: new ChromeRenderer({}) }).execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    return { pages: await countPdfPages(outPath), boxes: await allMediaBoxes(outPath) };
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

test('복합 세트: 엔진(Chrome 측정) 예측 페이지수 == 인쇄 PDF 페이지수 + 페이지별 MediaBox 방향 혼합', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const meta = { docTitle: '복합 세트 파리티', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: { size: 'A4', orientation: 'portrait' } };

  // ② PaginateObjectTree(Chrome 측정) — scaffold → paginated + 예측 페이지수.
  const measurer = new ChromePaginationMeasurer({});
  const { document: paginated } = await new PaginateObjectTree({ measurer }).execute(buildCompositeScaffold(), assets, meta);
  const predicted = paginated.pages.length;
  assert.ok(predicted >= 2, `복합 세트가 여러 페이지를 만들어야 검증 의미가 있음(예측 ${predicted})`);

  // ③ 실제 인쇄 — 예측한 paginated 문서를 렌더 → PDF 페이지수·MediaBox 실측.
  const { pages: printed, boxes } = await renderToPdf(paginated, assets, meta, 'composite');

  // AC-P3-3: 이질 용지에서도 하드 동치 — 예측 == 인쇄(넘침 없음).
  assert.equal(printed, predicted, `인쇄 PDF 페이지수(${printed}) == 엔진 예측(${predicted}) — 이질 용지 하드 동치`);
  assert.equal(boxes.length, predicted, 'MediaBox 개수 == 페이지수');

  // AC-P3-2: 페이지별 방향 혼합 — 세로 박스(H>W, ~595x842)와 가로 박스(W>H)가 둘 다 존재.
  const portrait = boxes.find((b) => b.h > b.w && Math.abs(b.w - 595) < 8 && Math.abs(b.h - 842) < 8);
  const landscape = boxes.find((b) => b.w > b.h);
  assert.ok(portrait, `세로 MediaBox(A4 595x842)가 있어야 함: ${JSON.stringify(boxes)}`);
  assert.ok(landscape, `가로 MediaBox(W>H)가 있어야 함: ${JSON.stringify(boxes)}`);
  // 가로 페이지는 A4 가로(841.9x595.3pt)여야 함.
  assert.ok(Math.abs(landscape.w - 842) < 8 && Math.abs(landscape.h - 595) < 8,
    `가로 페이지는 A4 가로(842x595pt)여야 함: ${JSON.stringify(landscape)}`);
});

test('무회귀: page.paper 없는 세로 단일 문서는 모든 페이지 세로 MediaBox(595x842)', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const meta = { docTitle: '단일 세로', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null };
  const flow = [{ id: 's-title', type: 'title', placement: 'flow', text: '단일 세로 문서' }];
  for (let i = 0; i < 20; i++) flow.push(para(`s-${i}`, i));
  const scaffold = { pagination: 'scaffold', pages: [{ flow, float: [] }] };

  const measurer = new ChromePaginationMeasurer({});
  const { document: paginated } = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, meta);
  const { pages: printed, boxes } = await renderToPdf(paginated, assets, meta, 'plain');
  assert.equal(printed, paginated.pages.length, '예측 == 인쇄(무회귀)');
  for (const b of boxes) {
    assert.ok(Math.abs(b.w - 595) < 6 && Math.abs(b.h - 842) < 6, `모든 페이지 A4 세로여야 함: ${JSON.stringify(b)}`);
  }
});
