import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
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
import { autoTmpDir, makeTmpDirSync } from '../helpers/tmp.js';

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

// 2026-07-29: 여기 있던 PAGED_PROXY 를 없앴다.
//
// 종전에는 이 테스트가 `.sheet-body{ height: calc(var(--sheet-h) - 22mm) }` 를 **스스로 주입해**
// 2단을 재현했다. 그 주입이 배포 CSS 의 공백을 가리고 있었다 — 실제 산출물에는 열 높이 제약이
// 없어서 `column-fill:auto` 가 열을 나누지 못했고(컨테이너 높이가 정해져야 나눈다), `.sheet` 가
// min-height 라 그냥 늘어났다. 실측: sheetH 2247px(A4 는 1123px) · x 군집 1개 = 사실상 단단.
// 이제 paper.js 가 columns>1 에서만 `--sheet-colh` 를 방출하고 paper.css 가 그걸 소비하므로,
// 주입 없이도 열이 형성된다 — 이 테스트가 비로소 **진짜 산출물**을 검증한다.

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
  // 생성한 쪽이 지운다 — 안 지우면 스위트 반복 실행에 임시 폴더가 수천 개 쌓여
  // 디스크가 차고 렌더 테스트가 통째로 멎는다(실측 7,000개).
  const profile = makeTmpDirSync('wsg-cols-chrome-');
  const userDataDir = profile.dir;
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=8000', '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); profile.cleanup(); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      profile.cleanup();
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
  const dir = await autoTmpDir('wsg-cols-');
  const p = join(dir, `${variant}.html`);
  await writeFile(p, html.replace('</body>', `${inject}\n</body>`), 'utf8');
  return parseRects(await dumpDom(pathToFileURL(p).href));
}

async function renderPdf(m, variant) {
  const html = await buildVariant(m, variant);
  const dir = await autoTmpDir('wsg-cols-pdf-');
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
      const rects = await measure(manifest({ columns: 2, pages: [blocks] }), variant);
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

// ── (d) 왕복 게이트: 개체 트리 왕복(US-20/S4.5 재작성) ──
// 구 테스트는 DOM 역동기화(serializeSheets→resync, 이제 소멸된 resync.js)가 .sheet-body
// 다단 래퍼를 무해하게 투과하는지를 검증했다. 신 계약은 애초에 DOM 역동기화가 없다 — 편집기는
// 개체 트리를 그대로 들고 있다가 /save 로 직송한다(EditorHttpServer.js). 같은 검증 의도
// ("다단 문서를 편집기에서 열고 저장해도 구조·개체 수가 보존된다")를 개체 트리 왕복으로
// 재구성했다: columns:2 개체 트리 문서를 열어(.sheet-body 다단 래퍼 렌더 확인) 무변경
// /save 왕복 후 개체 수·페이지 경계가 그대로인지 실 Chrome 으로 단정한다.
test('(d) 다단 문서 왕복 — 개체 트리 무변경 /save 후 구조·개체 수 보존(.sheet-body 렌더 포함)',
  { skip: !HAS_CHROME, timeout: 120000 }, async () => {
    const base = await autoTmpDir('wsg-cols-edit-');
    const workspace = new FsWorkspaceRepository({ baseDir: base });
    const blockRepository = new FsBlockRepository({ root: ROOT });
    const document = {
      pagination: 'paginated',
      docTitle: '다단 왕복 테스트',
      subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko',
      paper: { size: 'A4', orientation: 'portrait', columns: 2 },
      standards: [],
      pages: [
        { flow: Array.from({ length: 6 }, (_, i) => ({ id: `p0-${i}`, type: 'richtext', placement: 'flow', html: `<p>블록 ${i}</p>` })), float: [] },
        { flow: Array.from({ length: 4 }, (_, i) => ({ id: `p1-${i}`, type: 'richtext', placement: 'flow', html: `<p>블록 ${i}</p>` })), float: [] },
      ],
    };
    await new SaveDocument({ workspace, blockRepository, curriculum: null })
      .checkpoint({ name: '문서', document, now: new Date('2026-07-21T01:00:00.000Z') });
    const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
    const addr = await listenEditorServer(server);
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      // teacher iframe 은 srcdoc 속성으로 실려 dump-dom 출력에 HTML 이스케이프된 채 나온다
      // (class="sheet-body" → class=&quot;sheet-body&quot;) — 이스케이프 여부와 무관하게
      // "sheet-body" 토큰 등장 횟수로 다단 래퍼 렌더를 확인한다.
      const dom = await dumpDom(`${url}/`);
      const sheetBodyCount = (dom.match(/sheet-body/g) || []).length;
      assert.ok(sheetBodyCount >= 2, `페이지당 .sheet-body(다단 래퍼) 1개씩 실 렌더(실측 토큰 ${sheetBodyCount}회)`);

      const before = await (await fetch(`${url}/shell.json`)).json();
      const beforeCount = before.document.pages.flatMap((p) => [...p.flow, ...p.float]).length;
      assert.equal(beforeCount, 10, '픽스처 전제: 개체 10개');

      // 무변경 /save 왕복(편집기가 실제로 보내는 것과 동일한 페이로드 형태).
      const saveRes = await fetch(`${url}/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: before.document }),
      });
      assert.equal(saveRes.status, 200);

      const after = await (await fetch(`${url}/shell.json`)).json();
      const afterCount = after.document.pages.flatMap((p) => [...p.flow, ...p.float]).length;
      assert.equal(afterCount, beforeCount, '왕복 개체 수 불변');
      assert.equal(after.document.pages.length, 2, '왕복 페이지 경계 불변');
      assert.equal(after.document.paper.columns, 2, '다단 설정 보존');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
