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
    schemaVersion: 1, id, docName: '문서', action: 'rewrite',
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

  await repo.putResponse({ schemaVersion: 1, id: 'req-a', html: '<p>재작성본</p>' });
  assert.equal(await repo.getStatus('req-a'), 'answered');
  assert.equal((await repo.listPending()).length, 0, 'answered 는 pending 목록에서 제외');

  await repo.setStatus('req-a', 'applied');
  assert.equal(await repo.getStatus('req-a'), 'applied');
});

test('취소 우선(레이스): cancelled 후 응답 파일이 생겨도 상태는 cancelled', async () => {
  const { repo } = await fresh();
  await repo.putRequest(req('req-b'));
  await repo.setStatus('req-b', 'cancelled');
  await repo.putResponse({ schemaVersion: 1, id: 'req-b', html: '<p>늦은 응답</p>' });
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
  await repo.putResponse({ schemaVersion: 1, id: 'req-d', html: '<p>x</p>' });
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

test('F4: v1 in-flight 요청 + v2 요청/응답 파일 공존·왕복(관용 스키마)', async () => {
  const { repo } = await fresh();
  await repo.putRequest(req('req-v1')); // schemaVersion:1 (디스크 in-flight)
  // v2(blocks[])도 디스크 in-flight 잔존분이라 schemaVersion 은 형태와 짝이 되도록 리터럴 2 로
  // 고정한다(AI_SCHEMA_VERSION 은 S4.0 에서 3=objects[] 로 승격됐다 — 신규 쓰기 상수를 이 v2 고정
  // shape 픽스처에 쓰면 형태-버전 불일치로 validateRequest 가 거부한다).
  await repo.putRequest({
    schemaVersion: 2, id: 'req-v2', docName: '문서', action: 'rewrite',
    blocks: [
      { bp: 0, bi: 1, bt: 'question', html: '<div class="q">A</div>' },
      { bp: 0, bi: 2, bt: 'subq', html: '<p class="subq">B</p>' },
    ], status: 'pending',
  });
  assert.equal((await repo.listAll()).length, 2, 'v1·v2 요청 공존');
  assert.equal((await repo.readRequest('req-v1')).schemaVersion, 1, 'v1 in-flight 유효');
  assert.equal((await repo.readRequest('req-v2')).blocks.length, 2, 'v2 blocks 보존');

  await repo.putResponse({ schemaVersion: 2, id: 'req-v2', blocks: [{ slot: 0, html: '<p>a</p>' }, { slot: 1, html: '<p>b</p>' }] });
  assert.equal(await repo.getStatus('req-v2'), 'answered');
  assert.equal((await repo.readResponse('req-v2')).blocks.length, 2, 'v2 응답 왕복');
});

test('S4.0: v3 요청/응답(objects[], 개체 ID 에코) 왕복', async () => {
  const { repo } = await fresh();
  // v3 고정 shape 라 리터럴 3 으로 태깅한다(AI_SCHEMA_VERSION 은 Phase 4 에서 4=ops[] 로 승격 —
  // 신규 쓰기 상수를 이 v3 픽스처에 쓰면 형태-버전 불일치로 거부된다. v1/v2 픽스처와 동일 근거).
  await repo.putRequest({
    schemaVersion: 3, id: 'req-v3', docName: '문서', action: 'rewrite',
    objects: [{ id: 'o1', type: 'title', html: '<h1>A</h1>' }], status: 'pending',
  });
  assert.equal((await repo.readRequest('req-v3')).objects.length, 1, 'v3 objects 보존');
  await repo.putResponse({
    schemaVersion: 3, id: 'req-v3',
    objects: [{ id: 'o1', object: { id: 'o1', type: 'title', text: 'A2' } }],
  });
  assert.equal(await repo.getStatus('req-v3'), 'answered');
  assert.equal((await repo.readResponse('req-v3')).objects.length, 1, 'v3 응답 objects 왕복');
});
