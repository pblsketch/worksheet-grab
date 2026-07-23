import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { migrateManifestToObjectTree } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';
import { RenderObjectTree } from '../../src/usecases/RenderObjectTree.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';

// S2.1 수용 기준(06_plan_final.md 152행): ko.json·sci.json 을 마이그레이션 → render-core(순수) 렌더 →
// Chrome 실측 — 페이지수 일치(국어 5·과학 3)·주요 컴포넌트 존재. AssembleWorksheet(manifest 경로)는
// 별개로 존치되며 이 스위트는 개체 트리 경로(RenderObjectTree)만 실측한다.
//
// 국어(ko) 페이지수 5는 저작권 지문 2층 정책(2026-07-23) 이후에도 유지된다: 이전에는 renderPassageSlot
// 이 bodyHtml 을 아예 무시해 마이그레이션된 실제 지문 본문(ko.json 의 passage-slot 이 이미 보유하고
// 있던 텍스트)이 렌더에 전혀 나타나지 않는 결함이 있었다 — 교사가 예전에 채워 둔 지문이 새 에디터에서는
// 보이지 않았던 셈이다. bodyHtml 유무로 본문/플레이스홀더를 분기하도록 고치면서 그 지문 본문이 처음
// 실제로 렌더된다(페이지 여백 안에서 흡수되어 5쪽은 그대로 유지).
//
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

/** AssembleWorksheet#resolveStandards 와 동형(호출부 자산 호이스팅 — RenderObjectTree 는 순수 함수). */
async function resolveStandards(manifest, curriculum) {
  const codes = manifest.standards || [];
  const fallback = manifest.standardsText || {};
  const out = [];
  for (const rawCode of codes) {
    const code = String(rawCode);
    let text = null;
    if (curriculum) {
      try {
        const r = await curriculum.resolve(code);
        if (r && r.text) text = r.text;
      } catch { /* MCP/CSV 실패 → 폴백 */ }
    }
    if (!text) text = fallback[code] || fallback[code.replace(/^\[|\]$/g, '')] || null;
    if (text) out.push({ code, text });
  }
  return out;
}

/** manifest → 마이그레이션(개체 트리) → RenderObjectTree(순수) → Chrome 실측 PDF 페이지 수. */
async function renderMigratedPages(manifestName) {
  const repo = new FsBlockRepository({ root: ROOT });
  const curriculum = new GepaiCurriculum({});
  const manifest = await repo.readManifest(manifestName);

  const document = await migrateManifestToObjectTree(manifest, { blockRepository: repo });
  const { ok, findings } = new ValidateObjectTree().execute(document);
  assert.equal(ok, true, `마이그레이션 산출이 ValidateObjectTree PASS 해야 함: ${JSON.stringify(findings)}`);

  // 자산 I/O 호이스팅(호출부 책임) — RenderObjectTree 는 FS/CSV/MCP 무지(순수 함수).
  const [paperCss, blocksCss, themeCss, standards] = await Promise.all([
    repo.readAsset('paper.css'),
    repo.readAsset('blocks.css'),
    repo.loadThemeCss(manifest.theme),
    resolveStandards(manifest, curriculum),
  ]);

  const { html } = new RenderObjectTree().execute(
    document,
    { paperCss, blocksCss, themeCss },
    {
      lang: manifest.lang, docTitle: manifest.docTitle, dataSubject: manifest.dataSubject,
      themeName: manifest.theme, runHead: manifest.runHead, runFoot: manifest.runFoot,
      katex: !!manifest.head?.katex, paper: manifest.paper, standards,
    },
  );

  const dir = await mkdtemp(join(tmpdir(), 'wsg-oc-'));
  const inPath = join(dir, `${manifestName}-oc.html`);
  const outPath = join(dir, `${manifestName}-oc.pdf`);
  await writeFile(inPath, html, 'utf8');

  const renderer = new ChromeRenderer({});
  await new RenderPdf({ renderer }).execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
  return { pages: await countPdfPages(outPath), html };
}

test('render-core 수용: 마이그레이션된 국어(ko) 문서 = 5쪽(저작권 지문 2층 정책 — 지문 본문이 처음 렌더됨)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { pages, html } = await renderMigratedPages('ko');
  assert.equal(pages, 5, `render-core 국어 PDF 는 5쪽이어야 함(실측 ${pages})`);
  assert.match(html, /class="passage-body"/, '마이그레이션된 지문 본문이 플레이스홀더 대신 실제로 렌더되어야 함');
  assert.ok(html.includes('생성형 인공지능은 언어 생산 과정에서'), '지문 본문 텍스트가 방출되어야 함');
});

test('render-core 수용: 마이그레이션된 과학(sci) 문서 = 3쪽', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { pages } = await renderMigratedPages('sci');
  assert.equal(pages, 3, `render-core 과학 PDF 는 3쪽이어야 함(실측 ${pages})`);
});

test('render-core 수용: 주요 컴포넌트 존재(std-box 성취기준·페이지 컨테이너·표)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { html } = await renderMigratedPages('sci');
  assert.ok(html.includes('<!DOCTYPE html>'), '완전한 A4 문서');
  assert.match(html, /<section class="sheet">/, 'paper-css .sheet 페이지 컨테이너 존재');
  assert.match(html, /class="std-box"/, '성취기준 std-box 존재');
  assert.ok(html.includes('전기 회로에서 전류를 모형으로 설명하고'), '성취기준 원문이 std-box 에 주입됨(원칙 3)');
  assert.match(html, /<table/, '표(옴의 법칙 데이터 표) 존재');
});
