import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { autoTmpDir } from '../helpers/tmp.js';

// P2-b3(서버) 게이트 — POST /mood 라우트(무드 변경의 단일 서버 게이트, /theme 동형)와
// GET /shell.json 의 availableMoods 노출을 실 편집기 서버로 검증한다. 인프로세스·포트0·Chrome 불필요.
//   set/persist · no-op · 미지 무드 400(fail-closed) · 해제(빈값 → document.mood 제거) · 카탈로그 노출.
// 클라이언트 리플로우(무드는 레이아웃 변경)는 P2-b3(브라우저) 소관이며 여기서는 서버 계약만 고정한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function startServer() {
  const base = await autoTmpDir('wsg-moodroute-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci'); // 레거시 manifest, 무드 미지정
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

const postMood = (url, mood) => fetch(`${url}/mood`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mood }),
});
const getDoc = async (url) => (await (await fetch(`${url}/shell.json`)).json()).document;

test('P2-b3 서버: GET /shell.json 이 availableMoods(닫힌 카탈로그)를 노출', async () => {
  const { server, url } = await startServer();
  try {
    const shell = await (await fetch(`${url}/shell.json`)).json();
    // themes/moods/*.css 단일 원천 노출 — 무드 팩 확장에 견고하도록 정확집합이 아니라 포함으로 검사.
    for (const m of ['exam', 'soft', 'angular', 'wide', 'calm']) {
      assert.ok(shell.availableMoods.includes(m), `availableMoods 에 '${m}' 노출(발견: ${shell.availableMoods.join(', ')})`);
    }
    assert.ok(!('mood' in (await getDoc(url))), '초기(무드 미지정) 문서에는 mood 필드가 없다');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('P2-b3 서버: POST /mood 로 무드 설정 → 저장·재로드에 반영(단일 게이트)', async () => {
  const { server, url } = await startServer();
  try {
    const res = await postMood(url, 'exam');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).noop, false, '실제 변경');
    assert.equal((await getDoc(url)).mood, 'exam', 'POST /mood 후 document.mood 반영');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('P2-b3 서버: 같은 무드 재선택은 no-op(불필요한 리비전 방지)', async () => {
  const { server, url } = await startServer();
  try {
    await postMood(url, 'soft');
    const again = await postMood(url, 'soft');
    assert.equal(again.status, 200);
    assert.equal((await again.json()).noop, true, '동일 무드 재선택은 noop');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('P2-b3 서버: 미지 무드는 400(fail-closed, 닫힌 카탈로그 밖 차단)', async () => {
  const { server, url } = await startServer();
  try {
    const res = await postMood(url, 'no-such-mood');
    assert.equal(res.status, 400, '카탈로그 밖 무드는 거부');
    assert.match((await res.json()).error, /알 수 없는 무드/);
    assert.ok(!('mood' in (await getDoc(url))), '거부 후에도 문서는 무드 없이 그대로');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('P2-b3 서버: 빈 값은 무드 해제(document.mood 제거 — 기본 복귀)', async () => {
  const { server, url } = await startServer();
  try {
    await postMood(url, 'angular');
    assert.equal((await getDoc(url)).mood, 'angular');

    const clear = await postMood(url, '');
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).noop, false, '해제도 실제 변경');
    assert.ok(!('mood' in (await getDoc(url))), '빈 값이면 document.mood 필드가 제거되어야 한다(기본 복귀)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
