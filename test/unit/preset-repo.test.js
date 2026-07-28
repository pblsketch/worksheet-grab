import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { FsPresetRepository } from '../../src/adapters/FsPresetRepository.js';
import { emptyIndex } from '../../src/usecases/presets.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E4 저장소: 원자 교체·백업 보존·정합 실패 폴백(자산 손상 폭발 반경 방어).

async function freshRepo() {
  const base = await autoTmpDir('wsg-preset-');
  return { repo: new FsPresetRepository({ baseDir: base }), base };
}

function indexWith(id) {
  const idx = emptyIndex();
  idx.userPresets.push({ id, name: id, type: 'content', html: '<p>x</p>', desc: '', source: 'user', createdAt: null });
  return idx;
}

test('최초 읽기: 파일 없음 → 빈 인덱스·경고 없음', async () => {
  const { repo } = await freshRepo();
  const { index, warning } = await repo.readIndex();
  assert.deepEqual(index, emptyIndex());
  assert.equal(warning, null);
});

test('쓰기 왕복 + 재쓰기 시 직전본 .bak 보존', async () => {
  const { repo } = await freshRepo();
  await repo.writeIndex(indexWith('v1'));
  assert.deepEqual((await repo.readIndex()).index.userPresets[0].id, 'v1');
  await repo.writeIndex(indexWith('v2'));
  assert.equal((await repo.readIndex()).index.userPresets[0].id, 'v2');
  const bak = JSON.parse(await readFile(repo.bakPath, 'utf8'));
  assert.equal(bak.userPresets[0].id, 'v1', '직전본이 백업으로 보존');
  assert.ok(!existsSync(repo.tmpPath), 'tmp 는 rename 으로 소멸(원자 교체)');
});

test('본 인덱스 손상 → .bak 폴백 + 경고', async () => {
  const { repo } = await freshRepo();
  await repo.writeIndex(indexWith('v1'));
  await repo.writeIndex(indexWith('v2'));
  await writeFile(repo.indexPath, '{ 손상된 JSON', 'utf8');
  const { index, warning } = await repo.readIndex();
  assert.equal(index.userPresets[0].id, 'v1', '백업본 복구');
  assert.match(warning, /백업본으로 복구/);
});

test('본·백업 모두 손상 → 빈 인덱스 + 경고(작업 계속 가능)', async () => {
  const { repo } = await freshRepo();
  await repo.writeIndex(indexWith('v1'));
  await writeFile(repo.indexPath, 'x', 'utf8');
  if (existsSync(repo.bakPath)) await writeFile(repo.bakPath, 'y', 'utf8');
  const { index, warning } = await repo.readIndex();
  assert.deepEqual(index, emptyIndex());
  assert.match(warning, /빈 목록/);
});
