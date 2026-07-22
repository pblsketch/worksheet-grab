import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { ChromeRenderer, resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { BuildVariants } from '../../src/usecases/BuildVariants.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { countPdfPages, pdfPageSizePt, chromeAvailable } from '../helpers/pdf.js';

// F2 다단(columns) 실물 검증 — 인쇄가 진실의 원천(정적 CSS 검사로 대체하지 않는다).
//  (a) column-fill:auto 로 부분 페이지 콘텐츠가 좌열에 순차 정착(좌우 balance 반토막 아님).
//  (b) 페이지드 컬럼 흐름에서 블록 x좌표가 좌/우 두 군집으로 분포(column-count=2 실현).
//  (c) PDF MediaBox A4 불변·authored 페이지수 = 인쇄 페이지수.
//  (d) 왕복 게이트: 실 Chrome serializeSheets→resync 가 .sheet-body 투명 통과로 구조 보존.
// 계측은 dump-dom + getBoundingClientRect(editor-*.render.test.js 패턴 재사용).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const A4_PT = { w: 595.3, h: 841.9 };
const PT_TOL = 3;

// 화면(연속 매체)에선 column-fill:auto + 높이 auto 가 좌열 단일 흐름이 된다(=화면은 근사).
// 인쇄 페이지드 흐름을 화면에서 충실히 재현하려면 .sheet-body 를 페이지 콘텐츠 박스
// 높이로 제약한다(A4 세로 padding 12/10 → 297-22mm). 실측 x군집이 실인쇄와 일치한다.
const PAGED_PROXY = '.sheet-body{ height: calc(var(--sheet-h, 297mm) - 22mm); }';

const MEASURE = `<script>
window.addEventListener('load', function(){
  var els = document.querySelectorAll('.sheet-body > *');
  var out = [];
  for (var i=0;i<els.length;i++){ var r=els[i].getBoundingClientRect(); out.push({x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width)}); }
  document.body.dataset.blockRects = JSON.stringify(out);
});
</script>`;

function block(i, tall) {
  const text = tall
    ? ('다단 렌더 블록 ' + i + ' — 열 분포 계측용 텍스트를 채웁니다. ').repeat(2)
    : ('블록 ' + i);
  return { type: 'content', html: `<div style="border:1px solid #333;padding:6px;margin:0 0 8px">${text}</div>` };
}

function manifest({ columns, pages }) {
  return {
    id: 'cols', subject: 'science', dataSubject: 'science', theme: 'sci', lang: 'ko',
    docTitle: '다단 렌더 검증', head: { katex: false },
    runHead: '다단 검증', runFoot: { left: '다단', rightPrefix: '' },
    standards: [], standardsText: {},
    paper: { size: 'A4', orientation: 'portrait', columns },
    pages,
  };
}

async function buildVariant(m, variant) {
  const repo = new FsBlockRepository({ root: ROOT });
  const asm = new AssembleWorksheet({ blockRepository: repo, curriculum: new GepaiCurriculum({}) });
  const { html } = await asm.execute(m);
  const built = new BuildVariants().execute(html);
  return variant === 'student' ? built.student : built.teacher;
}

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-cols-chrome-'))}`,
    '--virtual-time-budget=8000', '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-500)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

function parseRects(dom) {
  const raw = ds(dom, 'block-rects');
  if (raw == null) throw new Error('block-rects 미측정');
  return JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

async function measure(m, variant, extraStyle = '') {
  const html = await buildVariant(m, variant);
  const inject = (extraStyle ? `<style>${extraStyle}</style>` : '') + MEASURE;
  const dir = await mkdtemp(join(tmpdir(), 'wsg-cols-'));
  const p = join(dir, `${variant}.html`);
  await writeFile(p, html.replace('</body>', `${inject}\n</body>`), 'utf8');
  return parseRects(await dumpDom(pathToFileURL(p).href));
}

async function renderPdf(m, variant) {
  const html = await buildVariant(m, variant);
  const dir = await mkdtemp(join(tmpdir(), 'wsg-cols-pdf-'));
  const inP = join(dir, `${variant}.html`);
  const outP = join(dir, `${variant}.pdf`);
  await writeFile(inP, html, 'utf8');
  await new RenderPdf({ renderer: new ChromeRenderer({}) })
    .execute({ inputPath: inP, outputPath: outP, virtualTimeBudget: 15000 });
  return { size: await pdfPageSizePt(outP), pages: await countPdfPages(outP) };
}

// ── (a) 단일/부분 페이지: column-fill:auto → 좌열 정착(실 CSS, 높이 제약 없음) ──
for (const variant of ['student', 'teacher']) {
  test(`(a) 부분 페이지 column-fill:auto — 모든 블록이 좌열 정착(${variant}, 좌우 반토막 아님)`,
    { skip: !HAS_CHROME, timeout: 120000 }, async () => {
      const rects = await measure(manifest({ columns: 2, pages: [[1, 2, 3, 4, 5].map((i) => block(i))] }), variant);
      assert.equal(rects.length, 5, '블록 5개 측정');
      const leftX = Math.min(...rects.map((r) => r.x));
      // column-fill:auto + 짧은 콘텐츠 → 전부 좌열(같은 x). balance 였다면 일부가 우열로 갈림.
      assert.ok(rects.every((r) => r.x <= leftX + 20), '전 블록 좌열 정착(우열 분산 없음)');
      // y 가 단조 증가(단일 열 수직 적층)
      const ys = rects.map((r) => r.y);
      assert.ok(ys.every((y, i) => i === 0 || y >= ys[i - 1] - 1), 'y 단조 증가(좌열 순차 적층)');
    });
}

// ── (b) 페이지드 컬럼 흐름: 블록 x가 좌/우 두 군집 ──
for (const variant of ['student', 'teacher']) {
  test(`(b) column-count=2 실현 — 블록 x좌표 좌/우 두 군집 분포(${variant})`,
    { skip: !HAS_CHROME, timeout: 120000 }, async () => {
      const blocks = Array.from({ length: 24 }, (_, i) => block(i, true));
      const rects = await measure(manifest({ columns: 2, pages: [blocks] }), variant, PAGED_PROXY);
      assert.equal(rects.length, 24, '블록 24개 측정');
      const leftX = Math.min(...rects.map((r) => r.x));
      const left = rects.filter((r) => r.x <= leftX + 100);
      const right = rects.filter((r) => r.x > leftX + 100);
      assert.ok(left.length > 0, '좌열에 블록 존재');
      assert.ok(right.length > 0, '우열에 블록 존재(2단 side-by-side 형성)');
      // 우열 군집의 x 는 좌열보다 대략 한 열폭+간격만큼 오른쪽(신문식 순차 채움).
      const rightX = Math.min(...right.map((r) => r.x));
      assert.ok(rightX - leftX > 150, `우열 x(${rightX}) 가 좌열 x(${leftX}) 보다 뚜렷이 우측`);
      // 좌열이 먼저 가득 채워진 뒤 우열로 넘어간다(column-fill:auto): 우열 첫 블록 y ≈ 상단.
      const rightTop = Math.min(...right.map((r) => r.y));
      const leftTop = Math.min(...left.map((r) => r.y));
      assert.ok(Math.abs(rightTop - leftTop) <= 60, '우열도 상단부터 시작(순차 채움)');
    });
}

// ── (c) PDF: MediaBox A4 불변 · authored 페이지수 = 인쇄 페이지수 ──
for (const variant of ['student', 'teacher']) {
  test(`(c) columns:2 PDF — MediaBox A4 불변·2페이지 일치(${variant})`,
    { skip: !HAS_CHROME, timeout: 120000 }, async () => {
      const pages = [
        Array.from({ length: 8 }, (_, i) => block(i, true)),
        Array.from({ length: 8 }, (_, i) => block(100 + i, true)),
      ];
      const { size, pages: n } = await renderPdf(manifest({ columns: 2, pages }), variant);
      assert.ok(Math.abs(size.w - A4_PT.w) <= PT_TOL && Math.abs(size.h - A4_PT.h) <= PT_TOL,
        `MediaBox ${size.w.toFixed(1)}×${size.h.toFixed(1)}pt = A4(595×842) 불변`);
      assert.equal(n, 2, 'authored 2페이지 = 인쇄 2페이지(다단이 페이지 수 왜곡 없음)');
    });
}

// ── (d) 왕복 게이트: 실 Chrome serializeSheets→resync 가 .sheet-body 투명 통과로 구조 보존 ──
test('(d) 다단 문서 왕복 — serializeSheets→resync structureWarning false·블록수 불변',
  { skip: !HAS_CHROME, timeout: 120000 }, async () => {
    const base = await mkdtemp(join(tmpdir(), 'wsg-cols-edit-'));
    const workspace = new FsWorkspaceRepository({ baseDir: base });
    const blockRepository = new FsBlockRepository({ root: ROOT });
    const m = await blockRepository.readManifest('sci');
    m.paper = { size: 'A4', orientation: 'portrait', columns: 2 };
    await new SaveDocument({ workspace, blockRepository, curriculum: null })
      .execute({ name: '문서', manifest: m, now: new Date('2026-07-21T01:00:00.000Z') });
    const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
    const addr = await listenEditorServer(server);
    try {
      const dom = await dumpDom(`http://127.0.0.1:${addr.port}/?seed=columns-roundtrip`);
      assert.equal(ds(dom, 'seed-done'), 'columns-roundtrip');
      assert.ok(Number(ds(dom, 'rt-sheet-body-count')) >= 1, 'teacher 캔버스에 .sheet-body(다단 DOM) 렌더');
      assert.equal(ds(dom, 'rt-structure-warning'), 'false', '.sheet-body 투명 통과 — leftover 오포집 없음');
      assert.equal(ds(dom, 'rt-blocks'), ds(dom, 'rt-base-blocks'), '왕복 블록 수 불변');
      assert.equal(ds(dom, 'rt-sheet-body-count'), ds(dom, 'rt-pages'), '페이지당 .sheet-body 1개');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
