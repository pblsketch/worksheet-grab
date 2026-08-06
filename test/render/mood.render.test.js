import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { GepaiCurriculum } from '../../src/adapters/GepaiCurriculum.js';
import { ChromeRenderer } from '../../src/adapters/ChromeRenderer.js';
import { migrateManifestToObjectTree } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { RenderObjectTree, deriveRenderMeta } from '../../src/usecases/RenderObjectTree.js';
import { loadRenderAssets } from '../../src/usecases/renderAssets.js';
import { RenderPdf } from '../../src/usecases/RenderPdf.js';
import { countPdfPages, chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';

// P2-c 무드 레이아웃 변형 렌더 게이트 — 레이아웃 변형을 가진 무드(exam=밑줄 헤더, angular=좌측 강조바)가
// 실 Chrome 에서 렌더·페이지네이션되는지 확인한다(최고 위험 영역: 레이아웃 변형이 인쇄를 깨지 않는가).
// 편집==인쇄 parity 는 메커니즘으로 보장된다(reflow.js 가 teacher <style> = 무드 포함을 측정에 이식).
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

// 각 변형의 "헤더 시그니처" — .std-head 를 무엇으로 바꾸는지(밑줄 vs 좌측 강조바)로 변형을 식별한다.
const VARIANTS = [
  { mood: 'exam', label: '밑줄 헤더', headSig: /\.std-box \.std-head\s*\{[^}]*border-bottom/ },
  { mood: 'soft', label: '둥근 밴드 헤더', headSig: /\.std-box \.std-head\s*\{[^}]*border-radius/ },
  { mood: 'angular', label: '좌측 강조바 헤더', headSig: /\.std-box \.std-head\s*\{[^}]*border-left/ },
];

/** AssembleWorksheet#resolveStandards 와 동형(호출부 자산 호이스팅 — RenderObjectTree 는 순수 함수). */
async function resolveStandards(manifest, curriculum) {
  const codes = manifest.standards || [];
  const fallback = manifest.standardsText || {};
  const out = [];
  for (const rawCode of codes) {
    const code = String(rawCode);
    let text = null;
    if (curriculum) {
      try { const r = await curriculum.resolve(code); if (r && r.text) text = r.text; } catch { /* 폴백 */ }
    }
    if (!text) text = fallback[code] || fallback[code.replace(/^\[|\]$/g, '')] || null;
    if (text) out.push({ code, text });
  }
  return out;
}

for (const { mood, label, headSig } of VARIANTS) {
  test(`P2-c 무드 레이아웃 변형: ${mood}(${label}) 개체트리 문서가 실 Chrome 에서 유효 PDF 로 렌더된다`, { skip: !HAS_CHROME, timeout: 120000 }, async () => {
    const repo = new FsBlockRepository({ root: ROOT });
    const curriculum = new GepaiCurriculum({});
    const manifest = await repo.readManifest('sci');

    const document = await migrateManifestToObjectTree(manifest, { blockRepository: repo });
    document.themeName = manifest.theme;
    document.mood = mood; // 무드 지정 — loadRenderAssets 가 레이아웃 변형을 포함한 무드 CSS 를 실어 준다.

    const assets = await loadRenderAssets(repo, document);
    const standards = await resolveStandards(manifest, curriculum);
    const meta = { ...deriveRenderMeta(document), standards };
    const { html } = new RenderObjectTree().execute(document, assets, meta);

    // 무드 레이어 + 헤더 레이아웃 변형이 문서 <style> 에 실제로 방출됐는가.
    assert.match(html, new RegExp(`무드 오버라이드 \\(themes/moods/${mood}\\.css\\)`), `${mood} 무드 레이어가 <style> 에 주입되어야 한다`);
    assert.match(html, headSig, `${label} 레이아웃 규칙(.std-head)이 방출되어야 한다`);

    const dir = await autoTmpDir('wsg-mood-');
    const inPath = join(dir, `${mood}.html`);
    const outPath = join(dir, `${mood}.pdf`);
    await writeFile(inPath, html, 'utf8');
    try {
      await new RenderPdf({ renderer: new ChromeRenderer({}) })
        .execute({ inputPath: inPath, outputPath: outPath, virtualTimeBudget: 15000 });
      const pages = await countPdfPages(outPath);
      assert.ok(pages >= 1, `${mood} 무드 문서가 유효한 PDF 로 렌더되어야 함(레이아웃 변형이 인쇄를 안 깸, 실측 ${pages}쪽)`);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    }
  });
}
