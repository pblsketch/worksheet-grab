import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { FsWorkbookRepository } from '../../src/adapters/FsWorkbookRepository.js';

// FsWorkbookRepository — 자료집 장부 파일 IO 단위 테스트(경로 이탈 방지·round-trip·목록).

async function fresh() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-wbrepo-'));
  return { base, repo: new FsWorkbookRepository({ baseDir: base }) };
}

test('create → readWorkbook round-trip(검증 통과 정규형)', async () => {
  const { repo } = await fresh();
  await repo.create('과학집', { title: '과학 자료집', members: [{ docName: '문서A', order: 0 }] });
  assert.ok(repo.exists('과학집'));
  const wb = await repo.readWorkbook('과학집');
  assert.equal(wb.title, '과학 자료집');
  assert.equal(wb.paper, 'a4');
  assert.equal(wb.members[0].docName, '문서A');
  assert.equal(wb.members[0].status, 'pending');
});

test('writeWorkbook: 잘못된 스키마는 기록 전 거부(fail-closed)', async () => {
  const { repo } = await fresh();
  await assert.rejects(() => repo.writeWorkbook('bad', { title: '', members: [] }), /title/);
  assert.ok(!repo.exists('bad'));
});

test('경로 이탈 차단 — 문서명 정규화로 baseDir 밖 이탈 불가', async () => {
  const { base, repo } = await fresh();
  // traversal 이름은 normalizeDocName 이 살균한다: 결과 dir 은 baseDir 안에 갇힌다.
  const l = repo.layout('..\\..\\evil');
  assert.ok(l.dir.startsWith(base + sep), 'dir 은 baseDir 안이어야 한다');
  assert.ok(!l.name.includes('..'));
  assert.ok(!l.name.includes(sep));
  // traversal-only 이름(정규화 후 빈 문자)은 거부.
  assert.throws(() => repo.layout('..'), /비어/);
});

test('list: 자료집 목록(이름 정렬, workbook 또는 null)', async () => {
  const { base, repo } = await fresh();
  await repo.create('b집', { title: 'B', members: [] });
  await repo.create('a집', { title: 'A', members: [] });
  const items = await repo.list();
  assert.deepEqual(items.map((x) => x.name), ['a집', 'b집']);
  assert.equal(items[0].workbook.title, 'A');
  assert.ok(base.startsWith(tmpdir()));
});

test('readWorkbook: 파손 JSON 은 list 에서 workbook=null', async () => {
  const { base, repo } = await fresh();
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(base, '깨진집'), { recursive: true });
  await writeFile(join(base, '깨진집', 'workbook.json'), '{ not json', 'utf8');
  const items = await repo.list();
  const broken = items.find((x) => x.name === '깨진집');
  assert.equal(broken.workbook, null);
  assert.ok(existsSync(join(base, '깨진집')));
});
