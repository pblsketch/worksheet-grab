import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateManifestToObjectTree, computeObjectizationStats, TABLE_ORGANIZER_TYPES } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { validateObjectShape } from '../../src/domain/schema/index.js';

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

// ── #2 P3: 그림형(파라메트릭) 조직자 → 편집 가능 organizer 승격(마이그레이션 대칭) ──
// 표형(P1b)이 table 로 승격되듯, 파라메트릭 그림형은 organizer 로 승격돼 개수·라벨을 편집기에서
// 고칠 수 있다. 엔진(OrganizerGen)이 같은 SVG 를 재생성하므로 무손실이다. 정적 블록/저작 html 그림형은
// 라벨 텍스트 손실을 막기 위해 richtext 로 원본을 그대로 보존한다(P1b 의 보수성과 동형).

test('P3: 파라메트릭 그림형 조직자는 편집 가능 organizer 로 승격(kind·params 보존)', async () => {
  const cases = [
    ['venn', { circles: 3 }], ['conceptmap', { nodes: 5 }], ['fishbone', { branches: 6 }],
    ['flowchart', { steps: 5 }], ['hierarchy', { children: 4 }], ['hexagon', { count: 7 }],
  ];
  for (const [kind, params] of cases) {
    const obj = await migrateEntry({ type: kind, params });
    assert.equal(obj.type, 'organizer', `${kind}: organizer 승격`);
    assert.equal(obj.kind, kind, `${kind}: kind 보존`);
    assert.deepEqual(obj.params, params, `${kind}: params 보존`);
    assert.equal(obj.placement, 'flow');
    assert.equal(obj.rect, undefined, `${kind}: flow 는 좌표 없음(원칙 3)`);
    assert.ok(validateObjectShape(obj).ok, `${kind}: 스키마 유효`);
  }
});

test('P3: 파라메트릭 그림형의 labels(슬롯 키)도 승계된다', async () => {
  const obj = await migrateEntry({ type: 'venn', params: { circles: 2 }, labels: { left: '식물', right: '동물', common: '공통점' } });
  assert.equal(obj.type, 'organizer');
  assert.deepEqual(obj.labels, { left: '식물', right: '동물', common: '공통점' });
  assert.ok(validateObjectShape(obj).ok);
});

test('P3: 정적 블록 그림형(params 없음)은 richtext 로 원본 보존(무손실 — 라벨 손실 방지)', async () => {
  const obj = await migrateEntry({ type: 'venn', file: 'core/venn.html' });
  assert.equal(obj.type, 'richtext', '블록 file 그림형은 richtext(정적 원본 보존)');
});

test('P3: params + 저작 html 이 함께면 무손실 안전망이 richtext 로 되돌린다(저작 라벨 보존)', async () => {
  const authored = '<div class="venn keep"><svg viewBox="0 0 440 240"><text>세포호흡</text><text>광합성</text></svg></div>';
  const obj = await migrateEntry({ type: 'venn', params: { circles: 2 }, html: authored });
  assert.equal(obj.type, 'richtext', '저작 텍스트가 organizer 데이터에 안 담기면 richtext 로 보존');
  assert.match(obj.html, /세포호흡/, '저작 라벨 보존');
});

test('P3: 파라메트릭 그림형 승격으로 개체화율이 오른다(richtext 0)', async () => {
  const manifest = { standards: [], pages: [[
    { type: 'venn', params: { circles: 2 } },
    { type: 'fishbone', params: { branches: 3 } },
  ]] };
  const doc = await migrateManifestToObjectTree(manifest, { blockRepository });
  const stats = computeObjectizationStats(doc);
  assert.equal(stats.rate, 1, '파라메트릭 그림형 2종 전부 organizer 승격(richtext 0)');
});
