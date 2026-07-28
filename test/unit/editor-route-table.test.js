import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { PASS, dispatch, readBinaryBody } from '../../src/adapters/editor-routes/httpKit.js';
import { autoTmpDir } from '../helpers/tmp.js';

// Phase 5 — 라우트 테이블 계약. EditorHttpServer 의 라우트가 주제별 모듈 + 선언적 테이블로
// 나뉘면서, 구 선형 `if` 사슬이 암묵적으로 갖고 있던 **폴백 순서**가 계약이 되었다:
//   ① 선언 순서대로 method+path/prefix 첫 매칭 라우트 실행
//   ② 핸들러가 PASS 를 반환하면 매칭 계속(접두는 맞지만 세부 형태가 다른 요청이 흘러내리던 동작)
//   ③ 아무도 처리 안 함 → GET 이 아니면 405, GET 이면 404
// 이 파일이 그 계약의 명세다. editor-server.test.js 는 각 라우트의 정상 동작을 다루고,
// 여기서는 "매칭되지 않는 조합"이 어떤 상태코드로 떨어지는지를 고정한다(리팩터링 전 서버와
// 동일한 표를 실측해 만들었다).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('httpKit.dispatch: 선언 순서·PASS 흘려보내기·prefix rest 전달', async () => {
  const calls = [];
  const routes = [
    { method: 'POST', path: '/a', handler: () => { calls.push('exact-a'); return 'handled'; } },
    { method: 'POST', prefix: '/p/', handler: ({ rest }) => { calls.push(`prefix-first:${rest}`); return rest === 'yes' ? 'handled' : PASS; } },
    { method: 'POST', prefix: '/p/', handler: ({ rest }) => { calls.push(`prefix-second:${rest}`); return 'handled'; } },
    { method: 'GET', path: '/a', handler: () => { calls.push('get-a'); return 'handled'; } },
  ];
  const run = (method, path) => dispatch(routes, { req: { method }, res: {}, path });

  assert.equal(await run('POST', '/a'), true);
  assert.deepEqual(calls, ['exact-a'], '정확 경로 첫 매칭만 실행');

  calls.length = 0;
  assert.equal(await run('POST', '/p/yes'), true);
  assert.deepEqual(calls, ['prefix-first:yes'], 'PASS 아니면 거기서 멈춘다');

  calls.length = 0;
  assert.equal(await run('POST', '/p/no'), true);
  assert.deepEqual(calls, ['prefix-first:no', 'prefix-second:no'], 'PASS 면 다음 라우트로 흘러내린다');

  calls.length = 0;
  assert.equal(await run('DELETE', '/a'), false, '메서드 불일치는 미처리(호출부가 405/404 결정)');
  assert.equal(await run('POST', '/none'), false, '미매칭 경로는 미처리');
  assert.deepEqual(calls, []);
});

test('readBinaryBody: 상한 누락은 fail-closed 거부(무제한 업로드 봉쇄)', async () => {
  // 구 EditorHttpServer 는 `cap = MAX_IMAGE_BYTES` 기본값을 갖고 있었다. httpKit 으로 떼어내며
  // 기본값이 사라졌는데, cap 이 undefined 면 `size > undefined` 가 항상 false 라 상한이 통째로
  // 증발한다(무제한 업로드). 현재 호출부는 상한을 명시하지만, 빠뜨린 호출을 조용히 통과시키지
  // 않는다는 성질 자체를 여기서 고정한다.
  const fakeReq = () => {
    const handlers = {};
    return { on(ev, fn) { handlers[ev] = fn; return this; }, destroy() { this.destroyed = true; }, handlers, destroyed: false };
  };
  for (const badCap of [undefined, null, 0, -1, NaN, 'many']) {
    const req = fakeReq();
    await assert.rejects(() => readBinaryBody(req, badCap), /상한\(cap\)이 필요합니다/, `cap=${String(badCap)} 는 거부`);
    assert.equal(req.destroyed, true, `cap=${String(badCap)} 는 스트림을 끊는다`);
  }
  // 정상 상한: 초과분은 거부, 이하는 그대로 통과.
  const over = fakeReq();
  const overP = assert.rejects(() => readBinaryBody(over, 4), /업로드가 너무 큽니다/);
  over.handlers.data(Buffer.from('12345'));
  await overP;

  const ok = fakeReq();
  const okP = readBinaryBody(ok, 16);
  ok.handlers.data(Buffer.from('abc'));
  ok.handlers.end();
  assert.equal((await okP).toString('utf8'), 'abc');
});

test('EditorHttpServer 폴백 계약: 미처리 non-GET → 405, 미처리 GET → 404', async () => {
  const base = await autoTmpDir('wsg-routetable-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-27T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  const url = `http://127.0.0.1:${addr.port}`;

  try {
    // 접두는 맞지만 세부 형태가 다른 POST — 구 사슬에서 그냥 흘러내려 405 가 되던 자리.
    for (const path of ['/presets/foo', '/ai/foo', '/assets/x.png', '/nope']) {
      assert.equal((await fetch(url + path, { method: 'POST' })).status, 405, `POST ${path} → 405`);
    }
    // GET 전용 자원에 대한 다른 메서드도 405(404 아님).
    for (const [method, path] of [['DELETE', '/presets'], ['DELETE', '/ai/foo'], ['PUT', '/save'], ['DELETE', '/assets/x.png']]) {
      assert.equal((await fetch(url + path, { method })).status, 405, `${method} ${path} → 405`);
    }
    // 미매칭 GET 은 404. /ai/* 는 JSON 404(요청 없음), 나머지는 text/plain 404.
    assert.equal((await fetch(`${url}/presets/foo`)).status, 404);
    assert.equal((await fetch(`${url}/save`)).status, 404, 'GET /save 는 라우트 없음 → 404');
    assert.equal((await fetch(`${url}/assets`)).status, 404, 'GET /assets(업로드 전용 경로) → 404');
    const aiMiss = await fetch(`${url}/ai/nope`);
    assert.equal(aiMiss.status, 404);
    assert.match(aiMiss.headers.get('content-type'), /application\/json/, '/ai/* 미존재는 JSON 404(브리지 계약)');
    const plainMiss = await fetch(`${url}/nope`);
    assert.match(plainMiss.headers.get('content-type'), /text\/plain/);

    // 405 본문은 구 서버 문구 그대로.
    assert.equal(await (await fetch(`${url}/nope`, { method: 'POST' })).text(), 'GET only');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('정적 서빙 최소권한: /src 는 화이트리스트만·/editor 는 MIME 표에 있는 확장자만', async () => {
  const base = await autoTmpDir('wsg-routestatic-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-27T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  const url = `http://127.0.0.1:${addr.port}`;

  try {
    // Phase 5 분리 모듈이 실제로 서빙되는지(빈 화면 회귀 방어 — /editor/* 를 못 찾으면 편집기가 안 뜬다).
    for (const name of ['editor.js', 'saveController.js', 'exportController.js', 'reviewChip.js', 'banner.js', 'shortcuts.js', 'editorStyle.js']) {
      const r = await fetch(`${url}/editor/${name}`);
      assert.equal(r.status, 200, `/editor/${name} 서빙`);
      assert.match(r.headers.get('content-type'), /text\/javascript/);
    }
    assert.equal((await fetch(`${url}/editor/editor.html`)).status, 200);
    assert.equal((await fetch(`${url}/editor/nope.txt`)).status, 404, 'MIME 표 밖 확장자 404');
    assert.equal((await fetch(`${url}/editor/%2e%2e/cli/index.js`)).status, 404, '경로 이탈 404');

    // 검수 체인 밖 서버 코드는 /src 로 새 나가지 않는다.
    assert.equal((await fetch(`${url}/src/usecases/RenderObjectTree.js`)).status, 200);
    assert.equal((await fetch(`${url}/src/usecases/renderAssets.js`)).status, 404, '화이트리스트 밖(FS 읽는 모듈) 404');
    assert.equal((await fetch(`${url}/src/adapters/editor-routes/documentRoutes.js`)).status, 404, '서버 라우트 모듈 404');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
