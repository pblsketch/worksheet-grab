import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_TYPES, deriveBuiltins, mergeLibrary, slugify, normalizePresetName,
  emptyIndex, validateIndex, PRESET_SCHEMA_VERSION,
} from '../../src/usecases/presets.js';
import { PresetLibrary } from '../../src/usecases/PresetLibrary.js';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';

// E4 순수 정책: slug·병합·숨김·shadow·빌트인 파생(파일 부재 개별 스킵).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('slugify: 한글 보존·중복 -2 접미', () => {
  assert.equal(slugify('나의 발문 블록'), '나의-발문-블록');
  assert.equal(slugify('나의 발문 블록', ['나의-발문-블록']), '나의-발문-블록-2');
  assert.equal(slugify('나의 발문 블록', ['나의-발문-블록', '나의-발문-블록-2']), '나의-발문-블록-3');
  assert.equal(slugify('!!!'), 'preset', '전부 비허용 문자면 기본 id');
  assert.throws(() => normalizePresetName('  '), /이름이 비어/);
});

test('deriveBuiltins: exemplar 주입으로 파생, html 없는 타입은 개별 스킵', () => {
  const vocab = { types: { subq: { file: 'core/subq.html', desc: '소질문' }, rubric: { file: 'core/rubric.html', desc: '루브릭' } } };
  const { builtins, skipped } = deriveBuiltins(vocab, { subq: '<p class="subq">발문</p>' });
  assert.deepEqual(builtins.map((b) => b.id), ['builtin-subq']);
  assert.equal(builtins[0].source, 'builtin');
  assert.ok(skipped.includes('rubric'), 'html 미주입 → 스킵');
  assert.ok(skipped.includes('answer-line'), 'vocab 부재 → 스킵');
});

test('mergeLibrary: 사용자 상단 + 빌트인 − 숨김 − 동일 id shadow', () => {
  const builtins = [{ id: 'builtin-subq' }, { id: 'builtin-rubric' }];
  const userPresets = [{ id: 'my-block' }, { id: 'builtin-rubric', source: 'user' }]; // 동명 shadow
  const merged = mergeLibrary({ builtins, userPresets, hiddenBuiltins: ['builtin-subq'] });
  assert.deepEqual(merged.map((p) => p.id), ['my-block', 'builtin-rubric']);
  assert.equal(merged[1].source, 'user', '사용자 shadow 가 빌트인을 가림');
});

test('validateIndex: 버전·중복 id·형태 검증', () => {
  assert.equal(validateIndex(emptyIndex()), true);
  assert.equal(validateIndex(null), false);
  assert.equal(validateIndex({ version: 99, userPresets: [], hiddenBuiltins: [] }), false);
  assert.equal(validateIndex({ version: PRESET_SCHEMA_VERSION, userPresets: [{ id: 'a', name: 'a', html: '<p>' }, { id: 'a', name: 'b', html: '<p>' }], hiddenBuiltins: [] }), false, '중복 id');
});

test('PresetLibrary.list: 실제 vocabulary+core exemplar 로 빌트인 전 매핑 파생', async () => {
  const mem = { index: emptyIndex() };
  const presetRepository = {
    async readIndex() { return { index: structuredClone(mem.index), warning: null }; },
    async writeIndex(i) { mem.index = i; },
  };
  const lib = new PresetLibrary({ presetRepository, blockRepository: new FsBlockRepository({ root: ROOT }) });
  const { presets, skipped } = await lib.list();
  assert.deepEqual(skipped, [], '실제 레포에선 매핑 전부 파생');
  for (const { type } of BUILTIN_TYPES) {
    const b = presets.find((p) => p.id === `builtin-${type}`);
    assert.ok(b, `빌트인 존재: ${type}`);
    assert.ok(b.html.length > 0);
  }
});

test('PresetLibrary: save→delete(사용자 제거)·delete(빌트인 숨김)→restore 왕복', async () => {
  const mem = { index: emptyIndex() };
  const presetRepository = {
    async readIndex() { return { index: structuredClone(mem.index), warning: null }; },
    async writeIndex(i) { mem.index = i; },
  };
  const lib = new PresetLibrary({ presetRepository, blockRepository: new FsBlockRepository({ root: ROOT }) });
  const saved = await lib.save({ name: '나의 블록', type: 'question', html: '<div class="q">문항</div>', now: new Date('2026-07-21T03:00:00.000Z') });
  assert.equal(saved.id, '나의-블록');
  assert.equal((await lib.list()).presets[0].id, '나의-블록', '최근 저장 상단');

  assert.deepEqual(await lib.delete('나의-블록'), { action: 'removed', id: '나의-블록' });
  assert.deepEqual(await lib.delete('builtin-subq'), { action: 'hidden', id: 'builtin-subq' });
  assert.ok(!(await lib.list()).presets.some((p) => p.id === 'builtin-subq'), '숨김 반영');
  assert.deepEqual(await lib.restore('builtin-subq'), { action: 'restored', id: 'builtin-subq' });
  assert.ok((await lib.list()).presets.some((p) => p.id === 'builtin-subq'), '복원 반영');
  await assert.rejects(() => lib.delete('없는-프리셋'), /찾을 수 없습니다/);
});
