import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { autoTmpDir } from '../helpers/tmp.js';

// E1 IO 어댑터 (temp dir).

async function freshRepo() {
  const base = await autoTmpDir('wsg-ws-');
  return { ws: new FsWorkspaceRepository({ baseDir: base }), base };
}

const MANIFEST = { id: 'x', subject: 'science', docTitle: '테스트', pages: [[{ type: 'content', html: '<p>본문</p>' }]] };

test('createDoc: §5 트리(assets/.worksheet-grab/history) 생성 + docExists', async () => {
  const { ws } = await freshRepo();
  assert.equal(ws.docExists('문서'), false);
  const l = await ws.createDoc('문서');
  assert.ok(existsSync(l.assetsDir) && existsSync(l.metaDir) && existsSync(l.historyDir));
  assert.equal(ws.docExists('문서'), true);
});

test('manifest/meta 왕복 동일 · meta 부재는 null', async () => {
  const { ws } = await freshRepo();
  await ws.createDoc('문서');
  await ws.writeManifest('문서', MANIFEST);
  assert.deepEqual(await ws.readManifest('문서'), MANIFEST);
  assert.equal(await ws.readMeta('문서'), null, 'meta 없으면 null(미완성 감지용)');
  const meta = { schemaVersion: 1, revision: 1, unsafe: false };
  await ws.writeMeta('문서', meta);
  assert.deepEqual(await ws.readMeta('문서'), meta);
});

test('writeVariantHtml: student 는 옵셔널 · removeStudentHtml 로 보류 잔존 제거', async () => {
  const { ws } = await freshRepo();
  const l = await ws.createDoc('문서');
  await ws.writeVariantHtml('문서', { student: '<s>', teacher: '<t>' });
  assert.ok(existsSync(l.studentPath) && existsSync(l.teacherPath));
  await ws.removeStudentHtml('문서');
  assert.ok(!existsSync(l.studentPath), '보류 시 이전 student 잔존 제거');
  await ws.writeVariantHtml('문서', { teacher: '<t2>' });
  assert.ok(!existsSync(l.studentPath), 'student 미전달이면 안 씀');
});

test('스냅샷 쓰기·목록(정렬)·일련번호/파일명 로드', async () => {
  const { ws } = await freshRepo();
  await ws.createDoc('문서');
  await ws.writeSnapshot('문서', '0002-b.manifest.json', { v: 2 });
  await ws.writeSnapshot('문서', '0001-a.manifest.json', { v: 1 });
  assert.deepEqual(await ws.listSnapshots('문서'), ['0001-a.manifest.json', '0002-b.manifest.json']);
  assert.deepEqual(await ws.readSnapshot('문서', '0001'), { v: 1 });
  assert.deepEqual(await ws.readSnapshot('문서', '1'), { v: 1 }, '패딩 없는 일련번호 허용');
  assert.deepEqual(await ws.readSnapshot('문서', '0002-b.manifest.json'), { v: 2 });
  await assert.rejects(() => ws.readSnapshot('문서', '0009'), /스냅샷을 찾을 수 없습니다/);
});

test('listDocuments: meta 유무 포함 정렬 목록', async () => {
  const { ws, base } = await freshRepo();
  await ws.createDoc('나문서');
  await ws.writeMeta('나문서', { revision: 1 });
  await mkdir(join(base, '가문서'));
  const docs = await ws.listDocuments();
  assert.deepEqual(docs.map((d) => d.name), ['가문서', '나문서']);
  assert.equal(docs[0].meta, null, '미완성(meta 없음) 문서 감지');
  assert.equal(docs[1].meta.revision, 1);
});

test('경로 이탈 차단', async () => {
  const { ws } = await freshRepo();
  // normalizeDocName 이 구분자·점을 제거해 이탈 자체가 불가능함을 확인.
  const l = ws.layout('../탈출');
  assert.ok(l.dir.startsWith(ws.baseDir), '정규화 후 base 내부에 갇힘');
  assert.throws(() => ws.layout('..'), /문서명이 비어/);
});
