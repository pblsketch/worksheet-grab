import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';
import { AI_SCHEMA_VERSION } from '../../src/usecases/aiBridge.js';

// E5 파일 큐 IO: 원자 교체·상태 소유권·취소 우선·prune.

function req(id, over = {}) {
  return {
    schemaVersion: AI_SCHEMA_VERSION, id, docName: '문서', action: 'rewrite',
    block: { bp: 0, bi: 1, bt: 'question', html: '<div class="q">문항</div>' }, status: 'pending', ...over,
  };
}

async function fresh() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-aibridge-'));
  return { repo: new FsAiBridgeRepository({ baseDir: base }), base };
}

test('요청/응답 왕복 + 상태 표현(응답 존재 = answered)', async () => {
  const { repo } = await fresh();
  await repo.putRequest(req('req-a'));
  assert.equal(await repo.getStatus('req-a'), 'pending');
  assert.equal((await repo.listPending()).length, 1);

  await repo.putResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'req-a', html: '<p>재작성본</p>' });
  assert.equal(await repo.getStatus('req-a'), 'answered');
  assert.equal((await repo.listPending()).length, 0, 'answered 는 pending 목록에서 제외');

  await repo.setStatus('req-a', 'applied');
  assert.equal(await repo.getStatus('req-a'), 'applied');
});

test('취소 우선(레이스): cancelled 후 응답 파일이 생겨도 상태는 cancelled', async () => {
  const { repo } = await fresh();
  await repo.putRequest(req('req-b'));
  await repo.setStatus('req-b', 'cancelled');
  await repo.putResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'req-b', html: '<p>늦은 응답</p>' });
  assert.equal(await repo.getStatus('req-b'), 'cancelled', 'getStatus 우선순위로 취소 승리');
  await assert.rejects(() => repo.setStatus('req-b', 'applied'), /상태 전이 불가/, 'terminal 강제');
});

test('원자 교체: tmp 잔존 없음 · 손상 파일은 스킵', async () => {
  const { repo, base } = await fresh();
  await repo.putRequest(req('req-c'));
  const files = await readdir(join(base, '.ai-bridge', 'requests'));
  assert.deepEqual(files, ['req-c.json'], 'tmp 는 rename 으로 소멸');

  await writeFile(join(base, '.ai-bridge', 'requests', 'req-broken.json'), '{ 손상', 'utf8');
  const pending = await repo.listPending();
  assert.deepEqual(pending.map((r) => r.id), ['req-c'], '손상 요청은 목록에서 스킵');
  assert.equal(await repo.readRequest('req-broken'), null);
});

test('prune: terminal(applied·cancelled) 요청·응답 정리', async () => {
  const { repo, base } = await fresh();
  await repo.putRequest(req('req-d'));
  await repo.putResponse({ schemaVersion: AI_SCHEMA_VERSION, id: 'req-d', html: '<p>x</p>' });
  await repo.setStatus('req-d', 'applied');
  await repo.putRequest(req('req-e')); // pending — 정리 대상 아님
  const removed = await repo.prune();
  assert.deepEqual(removed, ['req-d']);
  assert.ok(!existsSync(join(base, '.ai-bridge', 'requests', 'req-d.json')));
  assert.ok(!existsSync(join(base, '.ai-bridge', 'responses', 'req-d.json')));
  assert.equal(await repo.getStatus('req-e'), 'pending');
});

test('경로 이탈 차단', async () => {
  const { repo } = await fresh();
  await assert.rejects(() => repo.readRequest('..\\..\\evil'), /경로 이탈/);
});
