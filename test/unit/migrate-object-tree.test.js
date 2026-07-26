import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateManifestToObjectTree, computeObjectizationStats, stripTags } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { ValidateObjectTree } from '../../src/usecases/ValidateObjectTree.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';

// S1.3 수용 기준(06_plan_final.md 138~144행): ko.json(국어 5p)·sci.json(옴의법칙 3p) 마이그레이션 후
// ValidateObjectTree PASS, 텍스트 손실 0(정규화 문자열 포함), 개체화율 게이트(비-richtext 비율 ≥70%,
// 하드 플로어 50% 미만이면 무조건 FAIL) 를 단정한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GATE_TARGET = 0.70;
const GATE_HARD_FLOOR = 0.50;

// deps.blockRepository 는 entry.file 블록(비순수 의존, S1.3 계약)을 위한 것이다. ko.json/sci.json 은
// entry.file 사용례가 0건(REPORT.md §3)이라 이 스위트에서는 호출되지 않지만, 마이그레이터가 async +
// BlockRepository 의존 계약을 실제로 지키는지(주입 없이도 폭발하지 않는지) 함께 실증한다.
const blockRepository = new FsBlockRepository({ root: ROOT });

function loadManifest(name) {
  return JSON.parse(readFileSync(join(ROOT, 'manifests', name), 'utf8'));
}

/** 테스트 자체의 독립 텍스트 수집(마이그레이터 내부 collectText 재사용 금지 — 별개 경로로 검증). */
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

function normalize(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** 원본 manifest.pages[].entry.html 의 정규화 텍스트가 전부 산출 문서 어딘가에 포함되는지 확인. */
function findMissingText(manifest, document) {
  const producedText = normalize(collectAllText(document).join(' '));
  const missing = [];
  for (const page of manifest.pages) {
    for (const entry of page) {
      if (typeof entry.html !== 'string') continue; // gen 전용 엔트리(std-box)는 원문을 저장하지 않음(원칙 3)
      const sourceText = normalize(stripTags(entry.html));
      if (sourceText && !producedText.includes(sourceText)) {
        missing.push({ type: entry.type, preview: sourceText.slice(0, 80) });
      }
    }
  }
  return missing;
}

for (const fixture of [
  { name: 'ko.json', label: '국어 PoC(5p)' },
  { name: 'sci.json', label: '과학 PoC(3p, 옴의법칙)' },
]) {
  test(`${fixture.label} — 마이그레이션 후 ValidateObjectTree PASS`, async () => {
    const manifest = loadManifest(fixture.name);
    const document = await migrateManifestToObjectTree(manifest, { blockRepository });
    assert.equal(document.pagination, 'paginated');
    assert.equal(document.pages.length, manifest.pages.length, '구 manifest 의 페이지 경계를 그대로 승계해야 함');
    assert.equal(new Set(document.pages.map((page) => page.id)).size, document.pages.length, '페이지 ID가 모두 고유해야 함');
    assert.ok(document.pages.every((page) => /^page-/.test(page.id)), '모든 페이지에 영구 ID가 있어야 함');

    const { ok, findings } = new ValidateObjectTree().execute(document);
    assert.equal(ok, true, `ValidateObjectTree FAIL: ${JSON.stringify(findings)}`);
  });

  test(`${fixture.label} — 텍스트 손실 0(원본 블록 HTML 텍스트가 산출 개체 어딘가에 전부 포함)`, async () => {
    const manifest = loadManifest(fixture.name);
    const document = await migrateManifestToObjectTree(manifest, { blockRepository });
    const missing = findMissingText(manifest, document);
    assert.deepEqual(missing, [], `텍스트 손실 발견: ${JSON.stringify(missing)}`);
  });

  test(`${fixture.label} — 입력 manifest 를 변형하지 않음(읽기 전용 계약)`, async () => {
    const manifest = loadManifest(fixture.name);
    const before = JSON.stringify(manifest);
    await migrateManifestToObjectTree(manifest, { blockRepository });
    assert.equal(JSON.stringify(manifest), before, '마이그레이션이 입력 manifest 를 변형함(깊은 복사 위반)');
  });

  test(`${fixture.label} — 개체화율 게이트: 비-richtext 비율 ≥ ${GATE_TARGET * 100}%(하드 플로어 ${GATE_HARD_FLOOR * 100}%)`, async () => {
    const manifest = loadManifest(fixture.name);
    const document = await migrateManifestToObjectTree(manifest, { blockRepository });
    const stats = computeObjectizationStats(document);

    // 하드 플로어(R2-2): 50% 미만이면 무조건 FAIL — 게이트 완화(70%->실측치) 금지, todo/skip 협의 대상.
    assert.ok(
      stats.rate >= GATE_HARD_FLOOR,
      `개체화율 하드 플로어 미달(${(stats.rate * 100).toFixed(1)}% < 50%): ${JSON.stringify(stats)}`,
    );
    assert.ok(
      stats.rate >= GATE_TARGET,
      `개체화율 목표(70%) 미달(${(stats.rate * 100).toFixed(1)}%) — 스파이크 실측 63.04%(REPORT.md §3)에서 ` +
      `answerKey 병합 + subq/resource-box 추가 인식기로 끌어올린 실측치. 미달 시 계획서 R2-2 규정대로 ` +
      `70% 단정을 todo/skip 처리하고 사용자 승인 자료로 보고해야 함: ${JSON.stringify(stats)}`,
    );
  });
}

test('BlockRepository 미주입 + entry.file 존재 시 명시적으로 던짐(비순수 의존 계약, 순수 함수 아님을 실증)', async () => {
  const manifest = { id: 'stub', standards: [], pages: [[{ type: 'content', file: 'no-such-block.html' }]] };
  await assert.rejects(
    () => migrateManifestToObjectTree(manifest, {}),
    /blockRepository/,
  );
});

test('entry.file 블록은 BlockRepository 를 통해 로드되어 분류됨(async 비순수 의존 실증)', async () => {
  // blocks/ 디렉토리에 실제로 존재하는 블록 파일 하나를 골라 entry.file 경로로 마이그레이션한다.
  const blocks = await blockRepository.listBlocks();
  if (blocks.length === 0) return; // 블록 라이브러리가 비어 있으면(레포 구성에 따라) 스킵
  const file = blocks[0];
  const manifest = { id: 'stub-file', standards: [], pages: [[{ type: 'content', file }]] };
  const document = await migrateManifestToObjectTree(manifest, { blockRepository });
  const raw = await blockRepository.loadBlockHtml(file);
  const missing = findMissingText(
    { pages: [[{ type: 'content', html: raw }]] },
    document,
  );
  assert.deepEqual(missing, [], `entry.file 블록 텍스트 손실: ${JSON.stringify(missing)}`);
});
