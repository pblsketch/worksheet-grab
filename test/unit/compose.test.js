import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { AssembleWorksheet } from '../../src/usecases/AssembleWorksheet.js';
import { ArchetypeLibrary } from '../../src/usecases/ArchetypeLibrary.js';
import { ComposeWorksheet } from '../../src/usecases/ComposeWorksheet.js';

// Phase 4 — 동적 조립 배선(compose). 요청+성취기준+아키타입 → 저작 대기 스캐폴드.
// 수용: 같은 교과 다른 두 주제가 구조적으로 다른(주제 적합) 활동지로 나온다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = () => new FsBlockRepository({ root: ROOT });

// 성취기준 포트 목: 실제 CSV/MCP 없이도 compose 로직을 검증.
const mockCurriculum = {
  async resolve(code) { return { code, text: `원문(${code})`, subject: '과학', school: '중학교' }; },
  async search({ keyword }) { return [{ code: '[9과00-00]', text: `원문(${keyword})`, subject: '과학', school: '중학교' }]; },
};

async function makeLib() {
  const r = repo();
  const [a, v] = await Promise.all([r.readArchetypes(), r.readVocabulary()]);
  return new ArchetypeLibrary({ archetypes: a, vocabulary: v });
}

test('suggestArchetype: 실험 주제 → 실험탐구, 분류 주제 → 개념구조화(서로 다름)', async () => {
  const lib = await makeLib();
  const exp = lib.suggestArchetype('science', '광합성 실험 탐구');
  const con = lib.suggestArchetype('science', '생물 분류');
  assert.equal(exp.id, 'experimental-inquiry');
  assert.equal(con.id, 'concept-structuring');
  assert.notEqual(exp.id, con.id, '주제에 따라 다른 아키타입');
});

test('suggestArchetype 는 항상 해당 교과에 적용 가능한 아키타입을 반환', async () => {
  const lib = await makeLib();
  for (const subject of ['science', 'korean', 'social', 'english']) {
    for (const topic of ['광합성', '토론', '읽기', '분류', '프로젝트', '아무거나']) {
      const { id } = lib.suggestArchetype(subject, topic);
      assert.ok(lib.subjectsFor(id).includes(subject), `${subject}/${topic}: ${id} 적용 가능`);
    }
  }
});

test('수용: 같은 교과 다른 두 주제 → 구조적으로 다른 스캐폴드', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
  const a = await compose.execute({ grade: '중2', subject: '과학', topic: '광합성 실험', codes: ['[9과12-01]'] });
  const b = await compose.execute({ grade: '중2', subject: '과학', topic: '생물 분류', codes: ['[9과02-04]'] });

  assert.equal(a.archetype, 'experimental-inquiry');
  assert.equal(b.archetype, 'concept-structuring');
  assert.notEqual(a.manifest.pages.length, b.manifest.pages.length, '페이지 수가 다름(구조 상이)');

  const typesOf = (m) => new Set(m.pages.flat().map((e) => e.type));
  // 실험탐구에만 실험 전용 블록, 개념구조화에는 없음(강제되지 않음)
  assert.ok(typesOf(a.manifest).has('variable-table'), '실험탐구: 변인표 있음');
  assert.ok(typesOf(a.manifest).has('svg-graph'), '실험탐구: 그래프 있음');
  assert.ok(!typesOf(b.manifest).has('variable-table'), '개념구조화: 변인표 강제되지 않음');
  assert.ok(!typesOf(b.manifest).has('svg-graph'), '개념구조화: 그래프 강제되지 않음');
  assert.ok(typesOf(b.manifest).has('comparison-table'), '개념구조화: 비교표 있음');
});

test('스캐폴드: 헤더는 주제로 결정적 채움, 성취기준은 gen, docTitle=주제', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
  const { manifest } = await compose.execute({ grade: '중2', subject: '과학', topic: '광합성', codes: ['[9과12-01]'] });
  assert.equal(manifest.docTitle, '광합성');
  const header = manifest.pages[0][0];
  assert.equal(header.type, 'header');
  assert.match(header.html, /광합성/, '헤더에 주제 반영');
  assert.ok(manifest.pages[0].some((e) => e.gen === 'standard-label'), '성취기준 gen 엔트리');
  assert.equal(manifest.standardsText['[9과12-01]'], '원문([9과12-01])', '성취기준 원문 주입(창작 아님)');
});

test('아키타입 명시 override 와 부적합 아키타입 거부', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
  const { archetype, archetypeReason } = await compose.execute({
    grade: '중2', subject: '과학', topic: '광합성', archetype: 'concept-structuring', codes: ['[9과02-04]'],
  });
  assert.equal(archetype, 'concept-structuring');
  assert.match(archetypeReason, /지정/);
  // reading-comprehension 은 과학에 적용 불가 → 거부
  await assert.rejects(
    compose.execute({ grade: '중2', subject: '과학', topic: '광합성', archetype: 'reading-comprehension', codes: ['[9과12-01]'] }),
    /적용되지 않습니다/,
  );
});

test('스캐폴드가 렌더 가능한 A4 로 조립된다(자리표시)', async () => {
  const compose = new ComposeWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
  const { manifest } = await compose.execute({ grade: '중2', subject: '과학', topic: '생물 분류', codes: ['[9과02-04]'] });
  const asm = new AssembleWorksheet({ blockRepository: repo(), curriculum: mockCurriculum });
  const { html, worksheet } = await asm.execute(manifest);
  assert.equal(worksheet.pageCount(), manifest.pages.length);
  assert.match(html, /class="std-box"/, '성취기준 라벨 렌더');
  assert.match(html, /data-mode="MODE_TOKEN"/, '2벌 분기 전 토큰 유지');
});
