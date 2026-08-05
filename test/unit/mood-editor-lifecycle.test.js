import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { autoTmpDir } from '../helpers/tmp.js';

// P2-b2 게이트 — 무드의 "문서 생명주기": 저작된 manifest.mood 가 편집기 서버를 거쳐
//   (1) buildLegacyDocument 로 document.mood 로 승계(carry)되고,
//   (2) POST /save(SaveDocument.checkpoint) 왕복에서도 보존(persist)되는지를 실 서버로 검증한다.
// editor-server.test.js 의 /save 왕복 패턴을 그대로 미러링(인프로세스·포트0·Chrome 불필요).
// 이 테스트가 곧 "document.mood 가 ValidateObjectTree(/save 검증)를 통과한다"의 증명이기도 하다
// (paper/themeName 처럼 문서 메타 필드라 통과 — 실패하면 POST /save 가 400 을 던진다).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function startServer(mood) {
  const base = await autoTmpDir('wsg-moodlife-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  // sci(레거시 manifest — pagination 없음)에 무드를 얹어 저작본을 만든다. SaveDocument.execute 는
  // manifest 경로(AssembleWorksheet, P2-a)라 여기서 이미 무드가 fail-closed 로 검증·렌더된다.
  const manifest = { ...(await blockRepository.readManifest('sci')), ...(mood ? { mood } : {}) };
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, workspace };
}

test('P2-b2 carry: 저작된 manifest.mood 가 GET /shell.json 에서 document.mood 로 승계된다', async () => {
  const { server, url } = await startServer('exam');
  try {
    const { document } = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(document.mood, 'exam', 'buildLegacyDocument 가 manifest.mood 를 document.mood 로 승계해야 한다');
    assert.equal(document.pagination, 'paginated', '레거시 manifest 가 개체 트리로 승격된 상태');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('P2-b2 persist: POST /save(checkpoint) 왕복 후에도 document.mood 가 보존된다', async () => {
  const { server, url, workspace } = await startServer('exam');
  try {
    const { document } = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(document.mood, 'exam');

    // 클라이언트가 편집 후 그대로 직송(무드 필드 포함) — checkpoint 경유.
    const edited = structuredClone(document);
    edited.pages[0].flow.push({ id: 'mood-e2e', type: 'divider', placement: 'flow' });
    const res = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: edited }),
    });
    assert.equal(res.status, 200, 'mood 필드가 있는 문서도 ValidateObjectTree(/save)를 통과해야 한다');

    // (a) 워크스페이스 저장본(whole-document writeManifest)에 무드 보존.
    const saved = await workspace.readManifest('문서');
    assert.equal(saved.pagination, 'paginated', '개체 트리 스키마로 커밋');
    assert.equal(saved.mood, 'exam', 'checkpoint 가 document.mood 를 왕복 보존해야 한다');

    // (b) 재로드(GET /shell.json)에서도 그대로 — 이제 개체 트리 저장본이라 그대로 서빙된다.
    const reload = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(reload.document.mood, 'exam', '재로드 시에도 무드가 유지되어야 한다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('P2-b2 무회귀: 무드 미저작 문서는 document.mood 필드 자체가 없다(비침습 carry)', async () => {
  const { server, url } = await startServer(null);
  try {
    const { document } = await (await fetch(`${url}/shell.json`)).json();
    assert.ok(!('mood' in document), '무드 미지정이면 document 에 mood 필드가 추가되지 않아야 한다(형태 무회귀)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
