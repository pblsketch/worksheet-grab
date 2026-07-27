import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateManifestToObjectTree, computeObjectizationStats, stripTags } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';

// S1.3 마이그레이션 감사(06_plan_final.md 143행): 워크스페이스 실 문서 4건을 마이그레이션해
// richtext 비율 리포트(콘솔+scratchpad/ralph-reports/migrate-audit.json) + 라운드트립(산출 개체 트리의
// 텍스트 ≈ 원본 렌더 텍스트) + ValidateObjectTree PASS 를 확인한다.
//
// 이 감사 문서 4건은 개체화율 70% 게이트 대상이 **아니다**(ko.json/sci.json PoC 만 게이트 — migrate-object
// -tree.test.js). 여기서는 리포트만 남긴다(제약: worksheets/ 는 읽기 전용 입력, 수정 금지).
//
// 라운드트립 정의(≈, 근사): AssembleWorksheet 로 원본 manifest 를 렌더한 <body> 텍스트의 토큰 집합 대비
// 마이그레이션 산출 개체 트리가 담고 있는 텍스트의 토큰 커버리지. 100% 가 아닌 것은 설계상 의도된
// 두 종류의 제외 때문이다: (1) run-head/run-foot/mode-badge 등 페이지 크롬(개체 트리가 모델링하지
// 않는 문서 틀), (2) std-box 는 원문을 저장하지 않고 codes 참조만 저장한다(원칙 3 — 성취기준 원문은
// 렌더 시점에 주입되며 개체 트리 자체에는 없는 것이 정상, docs/HANDOFF-object-schema.md §6). 실측
// 커버리지가 90% 이상이면 이 두 제외를 넘어선 예기치 못한 손실이 없다고 판단한다(임계치는 4문서 실측
// 93.8~98.1% 에 안전마진을 둔 값).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ROUNDTRIP_COVERAGE_MIN = 0.90;
const REPORT_PATH = join(ROOT, 'scratchpad', 'ralph-reports', 'migrate-audit.json');

const AUDIT_DOCS = ['데모활동지', '문학의가치-UDL', '편집테스트', '개체편집테스트'];

const blockRepository = new FsBlockRepository({ root: ROOT });
const assembler = new AssembleWorksheet({ blockRepository });

function loadManifest(name) {
  return JSON.parse(readFileSync(join(ROOT, 'worksheets', name, 'worksheet.manifest.json'), 'utf8'));
}

function normalize(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 테스트 자체의 독립 텍스트 수집(마이그레이터 내부 collectText 재사용 금지). */
function collectAllText(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push(stripTags(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAllText(v, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) collectAllText(v, out);
  }
  return out;
}

function bodyOf(html) {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return m ? m[1] : html;
}

function tokenSet(text) {
  return new Set(normalize(text).split(/\s+/).filter((t) => t.length >= 2));
}

/** 렌더된 원본 <body> 토큰 대비 마이그레이션 산출 트리 토큰의 커버리지(≈ 라운드트립 근사치). */
function roundtripCoverage(renderedText, migratedText) {
  const renderedTokens = tokenSet(renderedText);
  const migratedTokens = tokenSet(migratedText);
  const missing = [...renderedTokens].filter((t) => !migratedTokens.has(t));
  const coverage = renderedTokens.size ? 1 - missing.length / renderedTokens.size : 1;
  return { coverage, missing, totalTokens: renderedTokens.size };
}

// 전 문서를 한 번에 마이그레이션해 리포트로 집계(모듈 로드 시 1회 — 렌더 테스트가 아니라 순수 HTML
// 문자열 조립(AssembleWorksheet)이므로 비용이 낮다. Chrome 은 관여하지 않는다).
const auditResults = [];
for (const name of AUDIT_DOCS) {
  const manifest = loadManifest(name);
  const document = await migrateManifestToObjectTree(manifest, { blockRepository });
  const { ok, findings } = new ValidateObjectTree().execute(document);
  const stats = computeObjectizationStats(document);
  const { html } = await assembler.execute(manifest, {});
  const renderedText = normalize(stripTags(bodyOf(html)));
  const migratedText = normalize(collectAllText(document).join(' '));
  const roundtrip = roundtripCoverage(renderedText, migratedText);
  auditResults.push({ name, ok, findings, stats, roundtrip });
}

for (const result of auditResults) {
  test(`감사 — ${result.name}: 마이그레이션 후 ValidateObjectTree PASS`, () => {
    assert.equal(result.ok, true, `ValidateObjectTree FAIL: ${JSON.stringify(result.findings)}`);
  });

  test(`감사 — ${result.name}: 라운드트립 커버리지 ≥ ${ROUNDTRIP_COVERAGE_MIN * 100}%(원본 렌더 텍스트 ≈ 산출 개체 트리 텍스트)`, () => {
    assert.ok(
      result.roundtrip.coverage >= ROUNDTRIP_COVERAGE_MIN,
      `라운드트립 커버리지 미달(${(result.roundtrip.coverage * 100).toFixed(1)}%): ` +
      `누락 토큰 샘플 ${JSON.stringify(result.roundtrip.missing.slice(0, 20))}`,
    );
  });
}

test('감사 리포트 저장 — scratchpad/ralph-reports/migrate-audit.json', () => {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    gate: { target: 0.70, hardFloor: 0.50, note: '이 리포트의 4문서는 게이트 대상 아님(PoC 게이트는 migrate-object-tree.test.js)' },
    roundtripCoverageMin: ROUNDTRIP_COVERAGE_MIN,
    documents: auditResults.map((r) => ({
      name: r.name,
      validateObjectTree: r.ok,
      objectization: r.stats,
      roundtripCoverage: r.roundtrip.coverage,
      roundtripMissingTokenSample: r.roundtrip.missing.slice(0, 20),
    })),
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');

  console.log('[migrate-audit] richtext 비율 리포트:');
  for (const r of auditResults) {
    console.log(
      `  - ${r.name}: 비-richtext ${r.stats.nonRichtext}/${r.stats.total} (${(r.stats.rate * 100).toFixed(1)}%), ` +
      `라운드트립 ${(r.roundtrip.coverage * 100).toFixed(1)}%, ValidateObjectTree ${r.ok ? 'PASS' : 'FAIL'}`,
    );
  }

  assert.ok(auditResults.every((r) => r.ok), '리포트 대상 문서 중 ValidateObjectTree FAIL 이 있음');
});
