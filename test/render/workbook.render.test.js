import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { WorkbookAssemble } from '../../src/usecases/WorkbookAssemble.js';
import { WorkbookExport } from '../../src/usecases/WorkbookExport.js';
import { collectTextInside } from '../../src/usecases/html-scan.js';
import { ANSWER_CLASSES } from '../../src/usecases/BuildVariants.js';
import { run } from '../../src/cli/index.js';
import { countPdfPages, pdfPageSizePt, chromeAvailable } from '../helpers/pdf.js';

// T6 — 자료집(합본) 실물 검증(실 Chrome, 합의 계획 §4 Phase 2·§3 게이트 표).
// WorkbookAssemble(순수 조립 + IO) + WorkbookExport(C4 countPdfPages fail-closed) 를
// 실 ChromeRenderer 로 직접 구동한다(CLI 블랙박스로는 조립 HTML 문자열을 못 보므로
// run-foot 연속성·목차 시작쪽·student 정답부재 단언은 usecase 레벨에서, unsafe 종료코드는
// CLI 레벨(workbook export)에서 검증 — export.render.test.js 의 실측 관례를 따른다.
//
// 실행은 반드시 직렬로: node --test --test-concurrency=1 test/render/workbook.render.test.js
// (병렬 시 Chrome 경합 플레이크 — 이 저장소 실측 관례)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';
// 1×1 최소 유효 PNG(base64) — editor-server.test.js 의 업로드 픽스처와 동일 바이트.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function fixtureManifest({ theme, subject, pages, katex = false }) {
  return {
    id: theme, subject, dataSubject: subject, theme, lang: 'ko',
    docTitle: `${theme} 멤버`, head: { katex }, runHead: '',
    runFoot: { left: '', rightPrefix: theme },
    standards: [], standardsText: {},
    pages,
  };
}

async function makeWorkspace(prefix) {
  const base = await mkdtemp(join(tmpdir(), prefix));
  return { base, workspace: new FsWorkspaceRepository({ baseDir: base }), blockRepository: new FsBlockRepository({ root: ROOT }) };
}

function saveDoc(workspace, blockRepository, name, manifest) {
  return new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name, manifest, now: new Date('2026-07-22T01:00:00.000Z') });
}

/** WorkbookExport.renderPdf 시임 — HTML 을 tmpDir 에 쓰고 실 ChromeRenderer 로 렌더. */
function renderPdfFactory(tmpDir, renderer) {
  return async ({ html, outputPath, budget, label }) => {
    const htmlPath = join(tmpDir, `${label}.html`);
    await writeFile(htmlPath, html, 'utf8');
    const pdfPath = outputPath || join(tmpDir, `${label}.pdf`);
    await renderer.renderToPdf(htmlPath, pdfPath, { virtualTimeBudget: budget.virtualTimeBudget, timeoutMs: budget.timeoutMs });
    return pdfPath;
  };
}

// ── ①②③④⑤: 정상 3멤버(테마 상이·자산·KaTeX) ──────────────────────────

test('T6 3멤버 합본(sci/ko/social·자산·KaTeX): 쪽수 실측·연속쪽번호·목차시작쪽·MediaBox·student 정답부재',
  { skip: !HAS_CHROME, timeout: 300000 }, async () => {
    const { base, workspace, blockRepository } = await makeWorkspace('wsg-wbrender-normal-');
    const tmpDir = await mkdtemp(join(tmpdir(), 'wsg-wbrender-normal-out-'));
    try {
      // 멤버1: sci, KaTeX, 정답 마크 포함(student 정답부재 검증용), 2쪽.
      await saveDoc(workspace, blockRepository, '과학멤버', fixtureManifest({
        theme: 'sci', subject: 'science', katex: true,
        pages: [
          [
            { type: 'header', html: '<div class="title-wrap"><h1>과학 멤버</h1></div>' },
            { type: 'formula', html: '<div class="formula">$ E = mc^2 $</div>' },
            { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
          ],
          [{ type: 'content', html: '<p>과학 멤버 둘째 쪽</p>' }],
        ],
      }));
      // 멤버2: ko, 이미지 자산 포함(assets/photo.png), 2쪽.
      await saveDoc(workspace, blockRepository, '국어멤버', fixtureManifest({
        theme: 'ko', subject: 'korean',
        pages: [
          [{ type: 'content', html: '<img src="assets/photo.png" style="width:30mm">' }],
          [{ type: 'content', html: '<p>국어 멤버 둘째 쪽</p>' }],
        ],
      }));
      const assetsDir = workspace.layout('국어멤버').assetsDir;
      await mkdir(assetsDir, { recursive: true });
      await writeFile(join(assetsDir, 'photo.png'), PNG_1x1);
      // 멤버3: social, 3쪽.
      await saveDoc(workspace, blockRepository, '사회멤버', fixtureManifest({
        theme: 'social', subject: 'social',
        pages: [
          [{ type: 'content', html: '<p>사회 멤버 1쪽</p>' }],
          [{ type: 'content', html: '<p>사회 멤버 2쪽</p>' }],
          [{ type: 'content', html: '<p>사회 멤버 3쪽</p>' }],
        ],
      }));

      const workbook = {
        title: '통합 자료집 렌더실측', paper: 'a4',
        members: [
          { docName: '과학멤버', order: 0, tocTitle: '과학멤버' },
          { docName: '국어멤버', order: 1, tocTitle: '국어멤버' },
          { docName: '사회멤버', order: 2, tocTitle: '사회멤버' },
        ],
      };

      const assembler = new WorkbookAssemble({
        workspace, blockRepository, readTextFile: (p) => readFile(p, 'utf8'), fileExists: existsSync,
      });
      const assembled = await assembler.execute({ workbook });
      assert.deepEqual(assembled.sectionCounts, [2, 2, 3], '전제: 섹션 수 = manifest.pages 수');
      assert.deepEqual(assembled.unsafeMembers, []);
      assert.ok(assembled.student, '누출 멤버 없음 — student 합본 산출');
      assert.match(assembled.teacher.html, /auto-render\.min\.js/, 'KaTeX 멤버 union — head 에 1회 포함');

      // ② run-foot 연속 쪽번호 == [1..ΣSections](7)
      const IS = '　'; // U+3000
      const runFootNums = (html) => [...html.matchAll(new RegExp(`${IS}(\\d+)</span></div>`, 'g'))].map((m) => Number(m[1]));
      assert.deepEqual(runFootNums(assembled.teacher.html), [1, 2, 3, 4, 5, 6, 7]);
      assert.deepEqual(runFootNums(assembled.student.html), [1, 2, 3, 4, 5, 6, 7]);

      // ③ 목차 계산 시작쪽(본문상대 1, 3, 5) 존재
      assert.deepEqual(assembled.teacher.startPages, [1, 3, 5]);
      for (const [title, start] of [['과학멤버', 1], ['국어멤버', 3], ['사회멤버', 5]]) {
        assert.match(
          assembled.teacher.html,
          new RegExp(`${title}</span>[^<]*<span class="wb-toc-page">${start}</span>`),
          `목차: ${title} 시작쪽 ${start}`,
        );
      }

      // ⑤ student 합본 정답 부재 — htmlScan.collectTextInside 로만 판정(클래스 문자열 grep 금지:
      // BuildVariants 가 빈 래퍼(<span class="answer"></span>)를 남겨 클래스 토큰 자체는 잔존한다).
      assert.deepEqual(collectTextInside(assembled.student.html, ANSWER_CLASSES), []);
      assert.ok(!assembled.student.html.includes(ANSWER), 'student 에 정답 원문 부재(보조 확인)');
      assert.ok(assembled.teacher.html.includes(ANSWER), 'teacher 는 정답 유지(정상 대조)');

      // ①④ 실 Chrome 렌더 → PDF 물리 쪽수·MediaBox 실측
      const renderer = new ChromeRenderer({});
      const exporter = new WorkbookExport({ renderPdf: renderPdfFactory(tmpDir, renderer) });
      const outputs = {
        teacherPdfPath: join(tmpDir, 'workbook-teacher.pdf'),
        studentPdfPath: join(tmpDir, 'workbook-student.pdf'),
      };
      const result = await exporter.execute({ assembled, outputs });
      assert.deepEqual(result.rendered.map((r) => r.variant), ['teacher', 'student']);

      for (const r of result.rendered) {
        assert.equal(r.sigma, 7, `${r.variant}: Σ멤버섹션 == 7`);
        const gotPages = await countPdfPages(outputs[`${r.variant}PdfPath`]);
        assert.equal(gotPages, r.coverToc + r.sigma, `${r.variant}: 실측 쪽수(${gotPages}) == 표지목차실측(${r.coverToc}) + Σ섹션(${r.sigma})`);
        const { w, h } = await pdfPageSizePt(outputs[`${r.variant}PdfPath`]);
        assert.ok(Math.abs(w - 595.3) <= 1 && Math.abs(h - 841.9) <= 1, `${r.variant} MediaBox A4 실측 ${w.toFixed(1)}×${h.toFixed(1)}pt`);
      }
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

// ── ⑥: 오버플로 멤버 지목(fail-closed) ─────────────────────────────────

test('T6 오버플로 멤버 지목: 물리 쪽수 불일치 → fail-closed + 넘친 멤버 pinpoint',
  { skip: !HAS_CHROME, timeout: 300000 }, async () => {
    const { base, workspace, blockRepository } = await makeWorkspace('wsg-wbrender-overflow-');
    const tmpDir = await mkdtemp(join(tmpdir(), 'wsg-wbrender-overflow-out-'));
    try {
      await saveDoc(workspace, blockRepository, '정상멤버', fixtureManifest({
        theme: 'sci', subject: 'science', pages: [[{ type: 'content', html: '<p>정상 1쪽</p>' }]],
      }));
      // 오버플로 멤버: manifest 상 1쪽(1섹션)이지만 과다 콘텐츠로 물리 인쇄가 1쪽을 넘게
      // 강제한다(preview-page.render.test.js 오버플로 픽스처와 동일 기법).
      const overflowBlocks = Array.from({ length: 60 }, (_, i) => ({
        type: 'content',
        html: `<p>오버플로 확인용 더미 문단 ${i} — 인쇄 흐름을 강제로 한 쪽 넘게 채우기 위한 반복 텍스트입니다.</p>`,
      }));
      await saveDoc(workspace, blockRepository, '오버플로멤버', fixtureManifest({
        theme: 'ko', subject: 'korean', pages: [overflowBlocks],
      }));

      const workbook = {
        title: '오버플로 자료집', paper: 'a4',
        members: [{ docName: '정상멤버', order: 0 }, { docName: '오버플로멤버', order: 1 }],
      };
      const assembler = new WorkbookAssemble({
        workspace, blockRepository, readTextFile: (p) => readFile(p, 'utf8'), fileExists: existsSync,
      });
      const assembled = await assembler.execute({ workbook });
      assert.deepEqual(assembled.sectionCounts, [1, 1], '전제: 두 멤버 모두 구조상 1섹션');

      const renderer = new ChromeRenderer({});
      const exporter = new WorkbookExport({ renderPdf: renderPdfFactory(tmpDir, renderer) });
      const outputs = { teacherPdfPath: join(tmpDir, 'ov-teacher.pdf'), studentPdfPath: join(tmpDir, 'ov-student.pdf') };
      await assert.rejects(
        () => exporter.execute({ assembled, outputs }),
        (e) => {
          assert.match(e.message, /쪽수 불일치/);
          assert.match(e.message, /오버플로멤버\(기대 1·실측 \d+\)/, '넘친 멤버 지목');
          assert.ok(!/정상멤버\(/.test(e.message), '정상 멤버는 지목 목록에서 제외');
          return true;
        },
      );
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

// ── ⑦: unsafe 멤버 — CLI 종단(실 Chrome, 종료코드까지) ──────────────────

test('T6 unsafe 멤버(CLI 종단): student 미산출·teacher 산출·종료코드 1',
  { skip: !HAS_CHROME, timeout: 300000 }, async () => {
    const { base: wsBase, workspace, blockRepository } = await makeWorkspace('wsg-wbrender-unsafe-ws-');
    const wbBase = await mkdtemp(join(tmpdir(), 'wsg-wbrender-unsafe-wb-'));
    try {
      await saveDoc(workspace, blockRepository, '안전멤버', fixtureManifest({
        theme: 'sci', subject: 'science', pages: [[{ type: 'content', html: '<p>안전 1쪽</p>' }]],
      }));
      const savedLeaky = await saveDoc(workspace, blockRepository, '누출멤버', fixtureManifest({
        theme: 'ko', subject: 'korean',
        pages: [[
          { type: 'content', html: `<div class="answer">${ANSWER}</div>` },
          { type: 'content', html: `<p>참고: ${ANSWER}</p>` },
        ]],
      }));
      assert.equal(savedLeaky.unsafe, true, '픽스처 전제: 누출 저장');

      const logs = [];
      const logf = (s) => logs.push(String(s));
      await run(['workbook', 'create', '집', '--workbooks-dir', wbBase], { root: ROOT, log: logf, err: logf });
      await run(['workbook', 'add', '집', '안전멤버', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: logf, err: logf });
      await run(['workbook', 'add', '집', '누출멤버', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: logf, err: logf });

      const code = await run(['workbook', 'export', '집', '--workbooks-dir', wbBase, '--workspaces-dir', wsBase], { root: ROOT, log: logf, err: logf });
      assert.equal(code, 1, 'unsafe 멤버 존재 → 비영 종료');
      const teacherPdf = join(wbBase, '집', 'workbook-teacher.pdf');
      const studentPdf = join(wbBase, '집', 'workbook-student.pdf');
      assert.ok(existsSync(teacherPdf), 'teacher 는 unsafe 여도 산출');
      assert.ok(!existsSync(studentPdf), 'student 는 미산출');
      assert.ok(logs.some((l) => l.includes('누출멤버')), '누출 멤버 지목 로그');
      assert.ok((await countPdfPages(teacherPdf)) >= 1, 'teacher PDF 페이지 존재 실측');
    } finally {
      await rm(wsBase, { recursive: true, force: true });
      await rm(wbBase, { recursive: true, force: true });
    }
  });
