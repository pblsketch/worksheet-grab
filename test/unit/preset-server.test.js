import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';

// E4 서버 API: 프리셋 CRUD(자산 — SaveDocument 게이트 미경유) + 교차 문서 재사용 e2e.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

async function startDocServer(base, docName) {
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: docName, manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, workspace };
}

test('프리셋 CRUD 왕복: 저장(.answer 허용)·목록·삭제·빌트인 숨김·복원·400', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-psrv-'));
  const { server, url } = await startDocServer(base, '문서');
  try {
    // 저장 — 정답 포함 프리셋 허용(§3.2 자산, 게이트 미경유)
    const saveRes = await fetch(`${url}/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '정답 상용구', type: 'content', html: `<div class="answer">${ANSWER}</div>` }),
    });
    assert.equal(saveRes.status, 200);
    const saved = await saveRes.json();
    assert.equal(saved.id, '정답-상용구');
    assert.ok(existsSync(join(base, '.presets', 'presets.json')), '.presets 인덱스 생성');

    // 문서 rev 불변(자산 ≠ 문서)
    const meta = JSON.parse(await readFile(join(base, '문서', '.worksheet-grab/meta.json'), 'utf8'));
    assert.equal(meta.revision, 1, '프리셋 저장은 SaveDocument 미경유');

    // 목록: 사용자 상단 + 빌트인 6종
    const list1 = await (await fetch(`${url}/presets`)).json();
    assert.equal(list1.presets[0].id, '정답-상용구');
    assert.ok(list1.presets.some((p) => p.id === 'builtin-subq'));
    assert.deepEqual(list1.skipped, []);

    // 삭제(사용자) · 숨김(빌트인) · 복원
    assert.equal((await fetch(`${url}/presets/정답-상용구`, { method: 'DELETE' })).status, 200);
    const hide = await (await fetch(`${url}/presets/builtin-subq`, { method: 'DELETE' })).json();
    assert.equal(hide.action, 'hidden');
    const list2 = await (await fetch(`${url}/presets`)).json();
    assert.ok(!list2.presets.some((p) => p.id === 'builtin-subq'), '숨김 반영');
    assert.equal((await fetch(`${url}/presets/restore/builtin-subq`, { method: 'POST' })).status, 200);
    const list3 = await (await fetch(`${url}/presets`)).json();
    assert.ok(list3.presets.some((p) => p.id === 'builtin-subq'), '복원 반영');

    // 오류 계약
    assert.equal((await fetch(`${url}/presets`, { method: 'POST', body: 'x' })).status, 400);
    assert.equal((await fetch(`${url}/presets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })).status, 400, 'html 누락');
    assert.equal((await fetch(`${url}/presets/없는-프리셋`, { method: 'DELETE' })).status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('§6 수용 e2e: 문서 A 에서 저장한 프리셋을 문서 B 에서 재사용(같은 워크스페이스)', async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-psrv-x-'));
  const a = await startDocServer(base, '문서A');
  const b = await startDocServer(base, '문서B');
  try {
    // A 에서 커스텀 블록 저장
    await fetch(`${a.url}/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '나의 안내문', type: 'directive', html: '<div class="direct">모둠별로 토의해 보자.</div>' }),
    });
    // B 라이브러리에 등장(교차 문서 공유)
    const listB = await (await fetch(`${b.url}/presets`)).json();
    const preset = listB.presets.find((p) => p.id === '나의-안내문');
    assert.ok(preset, '다른 문서 서버에서 재사용 가능');

    // B 문서에 삽입 저장(클라이언트 삽입 시뮬레이션: S4.0 개체 트리 직송 — B 는 구 manifest 세션이라
    // /shell.json 이 지연 마이그레이션해 서빙한 document 를 그대로 편집해 되돌린다). 프리셋의 임의
    // 블록 타입(directive 등)은 ObjectCatalog 10종 밖이라 richtext 탈출구 개체로 삽입한다.
    const shellB = await (await fetch(`${b.url}/shell.json`)).json();
    const document = shellB.document;
    document.pages[0].flow.push({ id: 'preset-1', type: 'richtext', placement: 'flow', html: preset.html, sourceType: preset.type });
    const saveRes = await fetch(`${b.url}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document }),
    });
    assert.equal((await saveRes.json()).meta.revision, 2);
    const savedManifest = JSON.parse(await readFile(join(base, '문서B', 'worksheet.manifest.json'), 'utf8'));
    assert.ok(savedManifest.pages[0].flow.some((o) => (o.html ?? '').includes('모둠별로 토의해 보자')),
      'B 개체 트리에 프리셋 개체 잔존(§6 수용)');
  } finally {
    await new Promise((r) => a.server.close(r));
    await new Promise((r) => b.server.close(r));
  }
});
