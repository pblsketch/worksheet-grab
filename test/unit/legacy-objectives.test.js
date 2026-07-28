import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AssembleWorksheet, normalizeObjectives } from '../../src/usecases/AssembleWorksheet.js';
import { migrateManifestToObjectTree } from '../../src/usecases/MigrateManifestToObjectTree.js';
import { ArchetypeLibrary } from '../../src/usecases/ArchetypeLibrary.js';
import { Worksheet, Block } from '../../src/domain/index.js';

// 레거시 결정적 엔진(AssembleWorksheet, gen:'standard-label')의 학습목표 **저작** 지원(2026-07-28).
//
// 이 경로가 목표를 못 지었던 것은 원칙 3 때문이 아니라 엔진이 성취기준 원문만 조립했기 때문이다
// (원칙 3은 "성취기준 원문" 창작만 금지하고 학습목표는 그 대상 밖이다). 그래서 원문 조회 규칙
// (#resolveStandards — CSV/MCP/폴백만, 없으면 throw)은 그대로 두고, 저작 문장을 실을 통로
// (manifest.objectives)만 열었다. 아래 테스트가 지키는 것은 두 가지다.
//   (a) 저작 문장이 있으면 그대로 렌더되고 표시 설정(제목·근거 성취기준)이 먹는다.
//   (b) 저작 문장이 없으면 **종전 산출과 바이트 동일**하다(하위호환 — 기존 문서 무회귀).

const repoMock = {
  readAsset: async () => '/* asset */',
  loadThemeCss: async () => '/* theme */',
  loadBlockHtml: async () => '<p>block</p>',
};

function manifestWith(extra = {}) {
  return {
    subject: 'science',
    theme: 'sci',
    docTitle: '전기 회로',
    standards: ['[9과15-01]'],
    standardsText: { '[9과15-01]': '전압과 전류의 관계를 설명할 수 있다.' },
    pages: [[{ type: 'standard-label', gen: 'standard-label' }]],
    ...extra,
  };
}

async function stdLabelHtml(extra = {}) {
  const asm = new AssembleWorksheet({ blockRepository: repoMock, curriculum: null });
  const { html } = await asm.execute(manifestWith(extra));
  return /<div class="std-box">[\s\S]*?<\/ul>\s*<\/div>(\s*<div class="std-box std-ref">[\s\S]*?<\/ul>\s*<\/div>)?/.exec(html)[0];
}

// ── (b) 하위호환: 저작 문장이 없으면 종전 산출 그대로 ──

test('objectives 미저작이면 종전 기계 변환 산출(코드 뗀 성취기준 문장 + 근거 성취기준)이 그대로', async () => {
  const out = await stdLabelHtml();
  assert.equal(out, [
    '<div class="std-box">',
    '    <div class="std-head">▣ 학습 목표</div>',
    '    <ul>',
    '      <li>전압과 전류의 관계를 설명할 수 있다.</li>',
    '    </ul>',
    '  </div>',
    '  <div class="std-box std-ref">',
    '    <div class="std-head">▣ 근거 성취기준 (2022 개정 교육과정)</div>',
    '    <ul>',
    '      <li><b>[9과15-01]</b> 전압과 전류의 관계를 설명할 수 있다.</li>',
    '    </ul>',
    '  </div>',
  ].join('\n'));
});

test('빈 문자열·공백만 있는 objectives 는 미저작으로 보고 하위호환 경로로 떨어진다', async () => {
  const out = await stdLabelHtml({ objectives: ['', '   ', null] });
  assert.ok(out.includes('class="std-box std-ref"'), '미저작 취급이면 근거 성취기준이 함께 나온다');
  assert.ok(out.includes('▣ 학습 목표'));
});

// ── (a) 저작 경로 ──

test('objectives 를 저작하면 그 문장이 학습목표로 렌더된다(성취기준 기계 변환 대체)', async () => {
  const out = await stdLabelHtml({
    objectives: ['광합성에 필요한 요소를 말할 수 있다.', '광합성 산물을 설명할 수 있다.'],
  });
  assert.ok(out.includes('<li>광합성에 필요한 요소를 말할 수 있다.</li>'));
  assert.ok(out.includes('<li>광합성 산물을 설명할 수 있다.</li>'));
  assert.ok(!out.includes('전압과 전류의 관계를 설명할 수 있다.'),
    '저작 문장이 있으면 성취기준 문장을 목표 자리에 쓰지 않는다');
});

test('저작 시 근거 성취기준은 기본 미표기 — showStandards:true 일 때만 함께 낸다', async () => {
  const off = await stdLabelHtml({ objectives: ['목표 하나'] });
  assert.ok(!off.includes('std-ref'), '기본은 학습목표만(개체 트리 std-box.showStandards 와 같은 기본값)');

  const on = await stdLabelHtml({ objectives: ['목표 하나'], showStandards: true });
  assert.ok(on.includes('class="std-box std-ref"'));
  assert.ok(on.includes('<b>[9과15-01]</b>'), '코드+원문이 근거 박스에 실린다');
});

test('showStandards 를 켜도 성취기준이 없으면 빈 근거 박스를 내지 않는다', async () => {
  const out = await stdLabelHtml({ standards: [], standardsText: {}, objectives: ['목표 하나'], showStandards: true });
  assert.ok(!out.includes('std-ref'));
});

test('objectivesHeading 으로 박스 제목을 바꾼다(미지정·공백이면 기본 "학습 목표")', async () => {
  assert.ok((await stdLabelHtml({ objectives: ['x'], objectivesHeading: '오늘의 목표' })).includes('▣ 오늘의 목표'));
  assert.ok((await stdLabelHtml({ objectives: ['x'], objectivesHeading: '   ' })).includes('▣ 학습 목표'));
});

test('저작 문장·제목은 이스케이프된다(HTML 주입 차단)', async () => {
  const out = await stdLabelHtml({
    objectives: ['<script>alert(1)</script> 설명할 수 있다.'],
    objectivesHeading: '<b>목표</b>',
  });
  assert.ok(!out.includes('<script>'), '저작 문장은 이스케이프되어야 한다');
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(out.includes('▣ &lt;b&gt;목표&lt;/b&gt;'));
});

test('원문 조회 규칙은 그대로 — 목표를 저작해도 미해결 성취기준 코드는 여전히 실패시킨다(원칙 3)', async () => {
  const asm = new AssembleWorksheet({ blockRepository: repoMock, curriculum: null });
  await assert.rejects(
    () => asm.execute(manifestWith({ standardsText: {}, objectives: ['목표 하나'] })),
    /원문을 CSV\/MCP\/폴백 어디에서도 찾지 못했습니다/,
    '학습목표 저작은 성취기준 원문 창작 금지를 완화하지 않는다',
  );
});

// ── 도메인 모델: 학습목표는 Standard 가 아니라 저작 문자열 ──

test('Worksheet.objectives 는 문자열 배열로 보관된다(Standard 인스턴스 요구 없음)', () => {
  const page = [new Block({ id: 'b', type: 'content', category: 'core', subject: 'science', content: '<p>x</p>' })];
  const w = new Worksheet({ subject: 'science', themeName: 'sci', pages: [page], objectives: ['목표 하나'] });
  assert.deepEqual(w.objectives, ['목표 하나']);
  const w2 = new Worksheet({ subject: 'science', themeName: 'sci', pages: [page] });
  assert.deepEqual(w2.objectives, [], '미지정이면 빈 배열(하위호환)');
});

test('Worksheet.objectives 에 문자열이 아닌 값이 오면 거부', () => {
  const page = [new Block({ id: 'b', type: 'content', category: 'core', subject: 'science', content: '<p>x</p>' })];
  assert.throws(
    () => new Worksheet({ subject: 'science', themeName: 'sci', pages: [page], objectives: [{ text: '목표' }] }),
    /objectives 는 문자열 배열/,
  );
});

test('AssembleWorksheet 가 저작 문장을 Worksheet 로도 넘긴다', async () => {
  const asm = new AssembleWorksheet({ blockRepository: repoMock, curriculum: null });
  const { worksheet } = await asm.execute(manifestWith({ objectives: ['목표 하나', ' '] }));
  assert.deepEqual(worksheet.objectives, ['목표 하나'], '공백 항목은 걸러진다');
});

// ── 마이그레이션: 편집기로 열 때 저작 목표가 사라지지 않아야 한다 ──

test('마이그레이션: manifest.objectives 가 std-box.objectives 로 승계된다(편집기 진입 시 유실 금지)', async () => {
  const tree = await migrateManifestToObjectTree(manifestWith({
    objectives: ['목표 하나', '목표 둘'], objectivesHeading: '오늘의 목표', showStandards: true,
  }));
  const std = tree.pages[0].flow.find((o) => o.type === 'std-box');
  assert.ok(std, 'standard-label 은 std-box 로 승격된다');
  assert.deepEqual(std.objectives, ['목표 하나', '목표 둘']);
  assert.equal(std.heading, '오늘의 목표');
  assert.equal(std.showStandards, true);
  assert.deepEqual(std.codes, ['[9과15-01]'], 'codes 참조는 그대로 보존(원칙 3)');
});

test('마이그레이션: objectives 미저작이면 std-box 는 codes 만(종전 그대로)', async () => {
  const tree = await migrateManifestToObjectTree(manifestWith());
  const std = tree.pages[0].flow.find((o) => o.type === 'std-box');
  assert.deepEqual(Object.keys(std).sort(), ['codes', 'id', 'placement', 'type']);
});

// ── 스캐폴드 생성부: 미저작이면 키 자체를 만들지 않는다(하위호환) ──

test('toSkeletonManifest: objectives 미지정이면 키를 만들지 않고, 지정하면 함께 싣는다', async () => {
  const { FsBlockRepository } = await import('../../src/adapters/FsBlockRepository.js');
  const repo = new FsBlockRepository({ root: process.cwd() });
  const [archetypes, vocabulary] = await Promise.all([repo.readArchetypes(), repo.readVocabulary()]);
  const lib = new ArchetypeLibrary({ archetypes, vocabulary });
  const id = Object.keys(archetypes.archetypes ?? archetypes)[0];
  const subject = lib.subjectsFor(id)[0];

  const plain = lib.toSkeletonManifest(id, subject, { docTitle: 'T' });
  assert.ok(!('objectives' in plain), '미지정이면 스캐폴드 산출이 종전과 동일해야 한다');

  const authored = lib.toSkeletonManifest(id, subject, {
    docTitle: 'T', objectives: ['목표 하나', ''], objectivesHeading: '오늘의 목표', showStandards: true,
  });
  assert.deepEqual(authored.objectives, ['목표 하나']);
  assert.equal(authored.objectivesHeading, '오늘의 목표');
  assert.equal(authored.showStandards, true);
});

test('normalizeObjectives: 배열 아님·공백 항목 처리', () => {
  assert.deepEqual(normalizeObjectives(undefined), []);
  assert.deepEqual(normalizeObjectives('문자열'), []);
  assert.deepEqual(normalizeObjectives([' a ', '', null, 'b']), ['a', 'b']);
});
