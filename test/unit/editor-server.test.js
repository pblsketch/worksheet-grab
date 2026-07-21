import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';

// E2 HTTP 어댑터(인프로세스, 포트0, Chrome 불필요).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DOMAIN_FILES = ['BlockContent', 'Block', 'Standard', 'Theme', 'Variant', 'Worksheet'];

async function startServer(opts = {}) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-editorsrv-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci'); // katex:true → teacherHtml 에 <script> 포함
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, ...opts,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, addr, workspace, manifest };
}

test('EditorHttpServer: 라우트·화이트리스트·트래버설·바인딩·close', async () => {
  const { server, url, addr } = await startServer();
  try {
    assert.equal(addr.address, '127.0.0.1', '루프백만 바인딩');

    // GET / — 정적 셸(데이터 인라인 주입 없음)
    const home = await fetch(`${url}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    const homeBody = await home.text();
    assert.ok(homeBody.includes('/editor/editor.js'), '클라이언트 모듈 참조');
    assert.ok(!homeBody.includes('data-mode="teacher"'), '셸 데이터 인라인 주입 없음(KaTeX </script> 붕괴 회피)');

    // GET /shell.json — KaTeX <script> 포함 문서로도 JSON 파싱 무붕괴
    const shellRes = await fetch(`${url}/shell.json`);
    assert.equal(shellRes.status, 200);
    assert.match(shellRes.headers.get('content-type'), /application\/json/);
    const shell = await shellRes.json();
    assert.ok(shell.teacherHtml.includes('<script'), 'KaTeX 로더 포함 확인(주입 함정 재현 조건)');
    assert.ok(shell.teacherHtml.includes('전압이 커질수록 전류의 세기도'), 'teacher 정답');
    assert.ok(!shell.studentHtml.includes('전압이 커질수록 전류의 세기도'), 'student 정답 물리 부재');
    assert.deepEqual(shell.canvasMeta.dims, { width: 794, height: 1123 });
    assert.ok(Array.isArray(shell.validationSeed.knownSubjectHexes) && shell.validationSeed.knownSubjectHexes.length > 0,
      '테마 팔레트 시드 주입');

    // /src 화이트리스트: 검수 체인 + 배럴 재수출 domain 6개 전부 200
    const vw = await fetch(`${url}/src/usecases/ValidateWorksheet.js`);
    assert.equal(vw.status, 200);
    assert.match(vw.headers.get('content-type'), /text\/javascript/);
    for (const name of DOMAIN_FILES) {
      const r = await fetch(`${url}/src/domain/${name}.js`);
      assert.equal(r.status, 200, `배럴 재수출 대상 서빙: domain/${name}.js`);
    }

    // 화이트리스트 외·트래버설 차단
    assert.equal((await fetch(`${url}/src/adapters/FsBlockRepository.js`)).status, 404, '그래프 밖 서버 코드는 404');
    assert.equal((await fetch(`${url}/src/cli/index.js`)).status, 404);
    assert.equal((await fetch(`${url}/src/%2e%2e/package.json`)).status, 404, '.. 트래버설 거부');
    assert.equal((await fetch(`${url}/editor/%2e%2e/cli/index.js`)).status, 404);
    assert.equal((await fetch(`${url}/nope`)).status, 404);

    // /editor 정적 자산
    const css = await fetch(`${url}/editor/editor.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    // testSeed 미기동 시 shell.json 에 필드 부재(프로덕션 시드 훅 차단)
    assert.ok(!('testSeed' in shell), 'testSeed 기본 미노출');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E3 POST /save: SaveDocument 경유 저장·rev 증가·잘못된 본문 400·타 경로 405', async () => {
  const { server, url, workspace, manifest } = await startServer();
  try {
    const edited = structuredClone(manifest);
    edited.pages[0].push({ type: 'content', html: '<p>편집으로 추가된 문단</p>' });
    const res = await fetch(`${url}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: edited, structureWarning: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unsafe, false);
    assert.equal(body.meta.revision, 2, 'SaveDocument 경유(리비전·히스토리)');
    assert.equal(body.structureWarning, false);
    const saved = await workspace.readManifest('문서');
    assert.ok(JSON.stringify(saved.pages).includes('편집으로 추가된 문단'), '워크스페이스 반영');

    const bad = await fetch(`${url}/save`, { method: 'POST', body: '잘못된 JSON' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${url}/shell.json`, { method: 'POST' })).status, 405, '저장 외 POST 는 405');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E3 testSeed 게이트: 옵션 기동 시에만 shell.json 에 노출', async () => {
  const { server, url } = await startServer({ testSeed: true });
  try {
    const shell = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(shell.testSeed, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
