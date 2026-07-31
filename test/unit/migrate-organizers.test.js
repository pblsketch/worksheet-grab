import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateManifestToObjectTree, computeObjectizationStats, TABLE_ORGANIZER_TYPES } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';

// #2 P1b — compose 로 만든 조직자 활동지를 편집기에서 열 때(마이그레이션)의 대칭:
//  - 깔끔한 표형 조직자(빈 것)는 편집 가능한 table 개체로 승격(삽입과 대칭)
//  - 정답(.answer) 있는 조직자는 richtext 로 남겨 셀 정답 보존(#4 fail-closed)
//  - 색이 의미인 신호등·특수 레이아웃·그림형(SVG)은 richtext 로 원본 보존(색·구조 손실 방지)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const blockRepository = new FsBlockRepository({ root: ROOT });

async function loadObjectFactory() {
  const src = await readFile(resolve(ROOT, 'src/editor/objectFactory.js'), 'utf8');
  const rewritten = src.replace(/from '\/src\//g, `from '${pathToFileURL(resolve(ROOT, 'src')).href}/`);
  return import(`data:text/javascript,${encodeURIComponent(rewritten)}`);
}

async function migrateEntry(entry) {
  const doc = await migrateManifestToObjectTree({ standards: [], pages: [[entry]] }, { blockRepository });
  return doc.pages[0].flow[0];
}

test('P1b: 깔끔한 표형 조직자(빈 것)는 편집 가능한 table 개체로 승격', async () => {
  for (const key of ['kwl', 'w5h1', 'bme', 'perspectives', 'character', 'quotejournal', 'bookreview', 'prediction', 'glowgrow']) {
    const obj = await migrateEntry({ type: key, file: `core/${key}.html` });
    assert.equal(obj.type, 'table', `${key}: table 개체로 승격(편집 가능)`);
    assert.ok(Array.isArray(obj.rows) && obj.rows.length >= 1, `${key}: rows 보존`);
  }
});

test('P1b: 프레이어는 caption(개념) 을 보존한 table 개체로 승격', async () => {
  const obj = await migrateEntry({ type: 'frayer', file: 'core/frayer.html' });
  assert.equal(obj.type, 'table', '프레이어 table 승격');
  assert.match(obj.caption || '', /개념/, '개념 caption 보존');
});

test('P1b: 정답(.answer) 있는 조직자는 richtext 로 남아 셀 정답을 보존(table 로 변환하지 않음)', async () => {
  const authoredFrayer = '<table class="frayer keep"><caption>개념: 광합성</caption><tr><th>정의</th><th>특징</th></tr><tr><td class="fq"><span class="answer">빛으로 양분 생성</span></td><td class="fq"></td></tr></table>';
  const obj = await migrateEntry({ type: 'frayer', html: authoredFrayer });
  assert.equal(obj.type, 'richtext', '정답 있는 조직자는 richtext(셀 .answer 보존)');
  assert.match(obj.html, /class="answer"/, '.answer 마크업 보존(BuildVariants 가 학생 빌드에서 물리 제거)');
  assert.notEqual(obj.answer, true, '개체 전체 answer:true 아님(구조는 남기고 셀 정답만 grep 제거)');
});

test('P1b: 색/특수 레이아웃·그림형은 richtext 로 원본 보존(신호등 색·SVG 손실 방지)', async () => {
  for (const key of ['stoplight', 'exit321', 'hamburger', 'mainidea', 'notetaking', 'venn', 'conceptmap', 'essayplan']) {
    const obj = await migrateEntry({ type: key, file: `core/${key}.html` });
    assert.equal(obj.type, 'richtext', `${key}: richtext 로 원본 보존(table 변환 제외)`);
  }
});

test('P1b: TABLE_ORGANIZER_TYPES 가 objectFactory ORGANIZER_INSERTS 키와 일치(드리프트 감시)', async () => {
  const { ORGANIZER_INSERTS } = await loadObjectFactory();
  const insertKeys = ORGANIZER_INSERTS.map((o) => o.key).sort();
  assert.deepEqual([...TABLE_ORGANIZER_TYPES].sort(), insertKeys,
    '마이그레이션 승격 대상 == 삽입 표형 조직자 — 어긋나면 한쪽만 고친 것');
});

test('P1b: 조직자 활동지 마이그레이션 개체화율 향상(표형이 table 로 승격 — richtext 0)', async () => {
  const manifest = { standards: [], pages: [[
    { type: 'kwl', file: 'core/kwl.html' },
    { type: 'w5h1', file: 'core/w5h1.html' },
    { type: 'perspectives', file: 'core/perspectives.html' },
  ]] };
  const doc = await migrateManifestToObjectTree(manifest, { blockRepository });
  const stats = computeObjectizationStats(doc);
  assert.equal(stats.rate, 1, '깔끔한 표형 3종 전부 table 승격(richtext 0)');
});
