import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { ChromePaginationMeasurer } from '../../src/adapters/PaginationMeasurer.js';
import { migrateManifestToObjectTree } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { PaginateObjectTree } from '../../src/usecases/PaginateObjectTree.js';
import { checkExportGate } from '../../src/domain/schema/index.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';

// S2.5 수용 기준(06_plan_final.md 167~172행, 과제 지시 §산출 2): 결정성(개체→페이지 귀속 동일,
// 바이트 비교 아님, R2-1) · 게이팅(document.fonts.ready + KaTeX 완료 대기 실증) · 넘침 개체 다음
// 페이지 이동 · 표 미분할 · 인쇄 동치(다수 픽스처: ko scaffold화·합성 넘침·표 포함) ·
// ExportDocument scaffold 거부 계약과 정합(paginated 산출물이 export 게이트 통과).
//
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개, wsg-* 정리).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const TIMEOUT = 180000;

async function loadAssets(repo, themeName = 'ko') {
  const [paperCss, blocksCss, themeCss] = await Promise.all([
    repo.readAsset('paper.css'),
    repo.readAsset('blocks.css'),
    repo.loadThemeCss(themeName),
  ]);
  return { paperCss, blocksCss, themeCss };
}

/** ko.json 마이그레이션(paginated, 5쪽) → pages[] 를 단일 flow 로 평탄화한 scaffold 문서(과제 지시 §산출 2 픽스처1). */
async function buildKoScaffold(repo) {
  const manifest = await repo.readManifest('ko');
  const migrated = await migrateManifestToObjectTree(manifest, { blockRepository: repo });
  const flow = [];
  const float = [];
  for (const p of migrated.pages) {
    flow.push(...p.flow);
    float.push(...p.float);
  }
  return { pagination: 'scaffold', pages: [{ flow, float }] };
}

/** 합성 넘침 픽스처(과제 지시 §산출 2 픽스처2) — A4 한 페이지 가용 높이를 확실히 넘기는 richtext 다량. */
function buildOverflowScaffold(n = 60) {
  const flow = [];
  for (let i = 0; i < n; i++) {
    flow.push({
      id: `ov-${i}`,
      type: 'richtext',
      placement: 'flow',
      html: `<p>합성 넘침 픽스처 문단 ${i} — 페이지네이션 패스가 실측 높이를 기준으로 개체를 통째로 ` +
        `다음 페이지로 이동시키는지 검증하기 위한 한국어 본문입니다. 분할 금지 원칙(R7)을 확인합니다.</p>`,
    });
  }
  return { pagination: 'scaffold', pages: [{ flow, float: [] }] };
}

/**
 * 표 포함 픽스처(과제 지시 §산출 2 픽스처3) — 표 혼자서도 페이지 가용 높이를 넘는 행 수.
 * fillerCount>0 이면 표 앞에 채움 문단을 둬 "표가 남은 공간에 다 안 들어가 통째로 다음 페이지로
 * 이동" 시나리오를 만든다(표 자체는 한 물리 페이지 안에 온전히 들어가는 크기로 유지 — 표 자신이
 * 물리 페이지 높이보다 커지면 인쇄 자체가 그 표를 여러 물리 페이지로 강제 분할하는 것은 개체
 * 분할이 아니라 "한 개체가 인쇄 가능한 물리 높이를 넘는" 별개의 물리적 한계이므로, 인쇄 동치
 * 픽스처는 그 한계를 피해 구성한다 — 표 미분할 자체(귀속이 한 페이지에만 온전히 잡히는지)는
 * 별도의 구조적 단정 테스트가 150행짜리 극단 픽스처로 이미 검증한다).
 */
function buildTableScaffold(rows = 150, fillerCount = 0) {
  const filler = Array.from({ length: fillerCount }, (_, i) => ({
    id: `filler-${i}`,
    type: 'richtext',
    placement: 'flow',
    html: `<p>표 앞 채움 문단 ${i} — 표가 남은 공간에 다 들어가지 않아 통째로 다음 페이지로 이동하는지 확인하기 위한 지면 채우기 본문입니다.</p>`,
  }));
  const tableRows = Array.from({ length: rows }, (_, i) => [{ text: `행 ${i + 1}` }, { text: `값 ${i + 1}` }]);
  const flow = [
    { id: 'lead-title', type: 'title', placement: 'flow', text: '표 포함 픽스처' },
    ...filler,
    { id: 'big-table', type: 'table', placement: 'flow', splittable: false, rows: tableRows },
    { id: 'after-note', type: 'richtext', placement: 'flow', html: '<p>표 다음 안내문입니다.</p>' },
  ];
  return { pagination: 'scaffold', pages: [{ flow, float: [] }] };
}

/** KaTeX 게이팅 실증 픽스처 — meta.katex:true 로 렌더되어야 auto-render 스크립트가 문서에 실린다. */
function buildKatexScaffold() {
  const flow = [{ id: 'k1', type: 'richtext', placement: 'flow', html: '<p>공식: $E=mc^2$ 입니다.</p>' }];
  return { pagination: 'scaffold', pages: [{ flow, float: [] }] };
}

function flatFlowIds(scaffold) {
  return scaffold.pages.flatMap((p) => p.flow.map((o) => o.id));
}

function outputFlowIds(paginatedDoc) {
  return paginatedDoc.pages.flatMap((p) => p.flow.map((o) => o.id));
}

/** paginated 문서를 실제 렌더 → Chrome print-to-pdf → 실측 페이지 수가 pages[] 길이와 하드 동치. */
async function assertPrintEquivalence(t, { paginatedDoc, assets, meta, label }) {
  const { html } = new RenderObjectTree().execute(paginatedDoc, assets, meta);
  const dir = await mkdtemp(join(tmpdir(), 'wsg-paginate-print-'));
  const inPath = join(dir, `${label}.html`);
  const outPath = join(dir, `${label}.pdf`);
  await writeFile(inPath, html, 'utf8');
  const renderer = new ChromeRenderer({});
  try {
    await new RenderPdf({ renderer }).execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
    const printedPages = await countPdfPages(outPath);
    assert.equal(printedPages, paginatedDoc.pages.length,
      `[${label}] 인쇄 페이지 수(${printedPages})가 페이지네이션 귀속 페이지 수(${paginatedDoc.pages.length})와 동치여야 함(하드 동치)`);
  } finally {
    // 측정용 임시 파일 누적 금지(MEMORY: render-temp-disk-exhaustion) — 검증 후 즉시 정리.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

test('결정성(R2-1): 같은 scaffold 문서를 2회 페이지네이션 → 개체→페이지 귀속 완전 동일', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const scaffold = buildOverflowScaffold(40);
  const measurer = new ChromePaginationMeasurer({});
  const paginator = new PaginateObjectTree({ measurer });

  const run1 = await paginator.execute(scaffold, assets, {});
  const run2 = await paginator.execute(scaffold, assets, {});

  // 결정성 정의(R2-1): 바이트 동일이 아니라 "개체→페이지 귀속" 동일 — pageOfId 맵을 직접 비교.
  assert.deepEqual(run1.pageOfId, run2.pageOfId, '2회 페이지네이션의 개체→페이지 귀속이 완전히 동일해야 함');
  assert.equal(run1.document.pages.length, run2.document.pages.length, '페이지 수도 동일해야 함');
});

test('게이팅(R2-1): KaTeX 포함 문서는 document.fonts.ready + auto-render 완료를 실제로 대기', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const measurer = new ChromePaginationMeasurer({});
  const paginator = new PaginateObjectTree({ measurer });

  const withKatex = await paginator.execute(buildKatexScaffold(), assets, { katex: true });
  assert.equal(withKatex.gating.hadKatex, true, 'KaTeX 스크립트가 문서에 포함되어야 함(meta.katex:true)');
  assert.equal(withKatex.gating.fontsReady, true, 'document.fonts.ready 대기 플래그');
  assert.equal(withKatex.gating.katexReady, true, 'auto-render 완료(renderMathInElement 등록) 대기 플래그');

  const withoutKatex = await paginator.execute(buildOverflowScaffold(3), assets, { katex: false });
  assert.equal(withoutKatex.gating.hadKatex, false, 'katex:false 문서는 auto-render 스크립트가 없어야 함');
  assert.equal(withoutKatex.gating.fontsReady, true, 'KaTeX 없어도 fonts.ready 게이트는 항상 통과해야 함');
  assert.equal(withoutKatex.gating.katexReady, true, 'KaTeX 부재 시 게이트는 자명하게 통과(차단 없음)');
});

test('넘침 개체 다음 페이지 이동 + 순서 보존(분할 없음, R7)', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const scaffold = buildOverflowScaffold(60);
  const measurer = new ChromePaginationMeasurer({});
  const { document } = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, {});

  assert.ok(document.pages.length >= 2, `60개 문단은 A4 1쪽을 넘겨야 함(실측 ${document.pages.length}쪽)`);

  // 순서 보존: 출력 pages[] 를 순서대로 이어붙이면 입력 flow 순서와 정확히 일치해야 한다
  // (분할 없이 통째 이동만 하므로 재정렬/중복/누락이 없어야 함).
  assert.deepEqual(outputFlowIds(document), flatFlowIds(scaffold), '출력 개체 순서가 입력 순서와 일치해야 함(재정렬/누락 없음)');

  // 각 페이지 내부에서도 개체가 정확히 하나의 페이지에만 속함(분할 없음의 구조적 증거).
  const seen = new Set();
  for (const page of document.pages) {
    for (const obj of page.flow) {
      assert.ok(!seen.has(obj.id), `개체 ${obj.id} 가 두 페이지에 걸쳐 나타나면 안 됨(분할 금지)`);
      seen.add(obj.id);
    }
  }
});

test('표 미분할: 큰 표는 정확히 한 페이지에만 통째로 배치(행 수 불변)', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const scaffold = buildTableScaffold(150);
  const measurer = new ChromePaginationMeasurer({});
  const { document } = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, {});

  const pagesWithTable = document.pages.filter((p) => p.flow.some((o) => o.id === 'big-table'));
  assert.equal(pagesWithTable.length, 1, '표는 정확히 한 페이지에만 존재해야 함(분할 없음)');
  const tableObj = pagesWithTable[0].flow.find((o) => o.id === 'big-table');
  assert.equal(tableObj.rows.length, 150, '표 rows 는 분할 없이 원본 그대로(150행) 유지되어야 함');
  assert.equal(tableObj.splittable, false, 'splittable:false 불변식 유지');
});

test('인쇄 동치 3종 픽스처: ko scaffold화 · 합성 넘침 · 표 포함 — 페이지네이션 귀속 == 실측 PDF 페이지 수', { skip: !HAS_CHROME, timeout: TIMEOUT }, async (t) => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const measurer = new ChromePaginationMeasurer({});
  const paginator = new PaginateObjectTree({ measurer });

  await t.test('ko 마이그레이션 scaffold화', async () => {
    const scaffold = await buildKoScaffold(repo);
    const { document } = await paginator.execute(scaffold, assets, { docTitle: 'ko scaffold화' });
    assert.equal(document.pagination, 'paginated');
    await assertPrintEquivalence(t, { paginatedDoc: document, assets, meta: { docTitle: 'ko scaffold화' }, label: 'ko-scaffold' });
  });

  await t.test('합성 넘침 픽스처', async () => {
    const scaffold = buildOverflowScaffold(50);
    const { document } = await paginator.execute(scaffold, assets, { docTitle: '합성 넘침' });
    await assertPrintEquivalence(t, { paginatedDoc: document, assets, meta: { docTitle: '합성 넘침' }, label: 'overflow' });
  });

  await t.test('표 포함 픽스처', async () => {
    // 표 자체는 한 물리 페이지 안에 온전히 들어가되(25행), 앞선 채움 문단(10개)이 남은 공간을
    // 소진해 표가 통째로 다음 페이지로 이동하도록 구성(위 buildTableScaffold 주석 참조).
    const scaffold = buildTableScaffold(25, 10);
    const { document } = await paginator.execute(scaffold, assets, { docTitle: '표 포함' });
    assert.ok(document.pages.length >= 2, '채움 문단이 표를 다음 페이지로 밀어내야 함');
    await assertPrintEquivalence(t, { paginatedDoc: document, assets, meta: { docTitle: '표 포함' }, label: 'table' });
  });
});

test('ExportDocument scaffold 거부 계약과 정합: paginated 산출물은 export 게이트 통과, scaffold 입력은 거부', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const scaffold = buildOverflowScaffold(10);
  const measurer = new ChromePaginationMeasurer({});
  const { document } = await new PaginateObjectTree({ measurer }).execute(scaffold, assets, {});

  const scaffoldGate = checkExportGate(scaffold);
  assert.equal(scaffoldGate.exportable, false, 'scaffold 입력은 export 거부(D-A/R2-4)');
  assert.equal(scaffoldGate.reason, 'scaffold-not-exportable');

  const paginatedGate = checkExportGate(document);
  assert.equal(paginatedGate.exportable, true, 'PaginateObjectTree 산출물(paginated)은 export 허용');
  assert.equal(paginatedGate.reason, null);

  const { ok, findings } = new ValidateObjectTree().execute(document);
  assert.equal(ok, true, `PaginateObjectTree 산출물이 ValidateObjectTree PASS 해야 함: ${JSON.stringify(findings)}`);
});

test('입력 불변형: PaginateObjectTree 는 입력 scaffold 문서를 변형하지 않는다', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const scaffold = buildOverflowScaffold(5);
  const before = JSON.stringify(scaffold);
  const measurer = new ChromePaginationMeasurer({});
  await new PaginateObjectTree({ measurer }).execute(scaffold, assets, {});
  assert.equal(JSON.stringify(scaffold), before, 'PaginateObjectTree 가 입력 문서를 변형함(읽기 전용 계약 위반)');
});

test('입력 검증: pagination:"scaffold" 아닌 문서는 명시적으로 거부', { skip: !HAS_CHROME, timeout: TIMEOUT }, async () => {
  const repo = new FsBlockRepository({ root: ROOT });
  const assets = await loadAssets(repo);
  const measurer = new ChromePaginationMeasurer({});
  const paginator = new PaginateObjectTree({ measurer });
  await assert.rejects(
    () => paginator.execute({ pagination: 'paginated', pages: [] }, assets, {}),
    /scaffold/,
  );
});
