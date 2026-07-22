import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

test('E5 /ai/*: 요청 생성(docName 서버 주입)→answered→applied 왕복 + 제외 타입 400 + 취소 terminal', async () => {
  const { server, url, workspace } = await startServer();
  try {
    const { FsAiBridgeRepository } = await import('../../src/adapters/FsAiBridgeRepository.js');
    const { AI_SCHEMA_VERSION } = await import('../../src/usecases/aiBridge.js');
    const bridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

    // 제외 타입(§7·§10 타입 가드) → 400
    for (const bt of ['passage', 'standard-label']) {
      const res = await fetch(`${url}/ai/requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rewrite', block: { bt, html: '<p>x</p>' } }),
      });
      assert.equal(res.status, 400, `${bt} 는 AI 대상 아님`);
    }

    // 정상 요청 → pending, docName 은 서버 주입
    const create = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', block: { bp: 0, bi: 3, bt: 'question', html: '<div class="q">문항</div>' }, docName: '위조시도' }),
    });
    assert.equal(create.status, 200);
    const { id } = await create.json();
    assert.equal((await bridge.readRequest(id)).docName, '문서', '서버 고정 docName');
    assert.deepEqual(await (await fetch(`${url}/ai/${id}`)).json(), { status: 'pending' });

    // 모의 구독 AI 응답(v1 하위호환) → answered + response 동봉
    await bridge.putResponse({ schemaVersion: 1, id, html: '<div class="q">재작성</div>' });
    const answered = await (await fetch(`${url}/ai/${id}`)).json();
    assert.equal(answered.status, 'answered');
    assert.equal(answered.response.html, '<div class="q">재작성</div>');

    // 적용 기록 → 즉시 정리(스테일 방지)
    assert.equal((await fetch(`${url}/ai/${id}/applied`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${url}/ai/${id}`)).status, 404, 'applied 후 prune');

    // 취소 terminal
    const c = await (await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fill-example', block: { bt: 'content', html: '<p>본문</p>' } }),
    })).json();
    assert.equal((await fetch(`${url}/ai/${c.id}/cancel`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${url}/ai/${c.id}/applied`, { method: 'POST' })).status, 400, 'cancelled → applied 전이 불가');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('F4 /ai/requests: v2 blocks[] 저장(schemaVersion:2) + 집합 내 제외 타입 1개 → 전체 400', async () => {
  const { server, url, workspace } = await startServer();
  try {
    const { FsAiBridgeRepository } = await import('../../src/adapters/FsAiBridgeRepository.js');
    const bridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

    // 다중 블록 v2 요청 → 200, 요청 파일은 v2(blocks[2]) 로 저장
    const create = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', blocks: [
        { bp: 0, bi: 3, bt: 'subq', html: '<p class="subq">A</p>' },
        { bp: 0, bi: 5, bt: 'question', html: '<div class="q">B</div>' },
      ] }),
    });
    assert.equal(create.status, 200);
    const { id } = await create.json();
    const saved = await bridge.readRequest(id);
    assert.equal(saved.schemaVersion, 2, '신규 요청은 v2 로 기록');
    assert.equal(saved.blocks.length, 2, 'blocks[] 보존');
    assert.equal(saved.docName, '문서', '서버 고정 docName');

    // 집합 중 하나라도 제외 타입(passage/standard-label) → 전체 400(부분 요청 금지, §7·§10)
    for (const badBt of ['passage', 'standard-label']) {
      const res = await fetch(`${url}/ai/requests`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rewrite', blocks: [
          { bt: 'question', html: '<div class="q">정상</div>' },
          { bt: badBt, html: '<p>제외</p>' },
        ] }),
      });
      assert.equal(res.status, 400, `집합에 ${badBt} 포함 → 전체 거부`);
    }
    assert.equal((await bridge.listPending()).length, 1, '거부분은 큐 미잔존 — 정상 v2 요청 1건만');

    // v2 응답(blocks[{slot,html}]) 왕복
    await bridge.putResponse({ schemaVersion: 2, id, blocks: [
      { slot: 0, html: '<p class="subq">A2</p>' }, { slot: 1, html: '<div class="q">B2</div>' },
    ] });
    const answered = await (await fetch(`${url}/ai/${id}`)).json();
    assert.equal(answered.status, 'answered');
    assert.equal(answered.response.blocks.length, 2, 'v2 응답 blocks 동봉');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('F1 POST /assets: 업로드→GET 서빙·바이트 왕복·트래버설 404·비허용 400·동명 접미사', async () => {
  const { server, url } = await startServer();
  try {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64');

    // 정상 업로드(한글 파일명 보존)
    const up = await fetch(`${url}/assets?name=${encodeURIComponent('그림.png')}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
    });
    assert.equal(up.status, 200);
    assert.equal((await up.json()).path, 'assets/그림.png', '경로 파생·파일명 보존');

    // GET 서빙: image MIME·바이트 왕복 동일
    const get = await fetch(`${url}/assets/${encodeURIComponent('그림.png')}`);
    assert.equal(get.status, 200);
    assert.match(get.headers.get('content-type'), /image\/png/);
    assert.ok(Buffer.from(await get.arrayBuffer()).equals(png), '자산 바이트 왕복 동일');

    // GET 트래버설(../..) → 404 (assetsDir 밖 봉쇄)
    assert.equal((await fetch(`${url}/assets/%2e%2e%2f%2e%2e%2fpackage.json`)).status, 404, '.. 트래버설 거부');
    assert.equal((await fetch(`${url}/assets/none.png`)).status, 404, '부재 파일 404');

    // 비허용 확장자(svg) → 400
    const svg = await fetch(`${url}/assets?name=x.svg`, {
      method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: Buffer.from('<svg/>'),
    });
    assert.equal(svg.status, 400, 'SVG 업로드 거부');
    // 확장자 없음 → 400
    assert.equal((await fetch(`${url}/assets?name=x`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: png,
    })).status, 400);

    // 동명 재업로드 → 접미사(-1)
    const up2 = await (await fetch(`${url}/assets?name=${encodeURIComponent('그림.png')}`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: png,
    })).json();
    assert.equal(up2.path, 'assets/그림-1.png', '동명 충돌 접미사');

    // Codex QA: 확장자는 png 인데 내용이 이미지가 아님(4바이트 가짜) → 400(매직바이트 대조)
    const fake = await fetch(`${url}/assets?name=fake.png`, {
      method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    assert.equal(fake.status, 400, '가짜 png(매직 시그니처 불일치) 거부');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('team-fix ⑥: answered 요청도 cancel 로 terminal 전환(전 슬롯 소실 정리 경로)', async () => {
  const { server, url, workspace } = await startServer();
  try {
    const { FsAiBridgeRepository } = await import('../../src/adapters/FsAiBridgeRepository.js');
    const bridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });
    const { id } = await (await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', blocks: [{ bt: 'content', html: '<p>A</p>' }] }),
    })).json();
    await bridge.putResponse({ schemaVersion: 1, id, html: '<p>재작성</p>' });
    assert.equal(await bridge.getStatus(id), 'answered');
    // 대상 블록이 모두 삭제된 경우 에디터가 answered 요청을 cancel 로 terminal 전환(스테일 방지)
    assert.equal((await fetch(`${url}/ai/${id}/cancel`, { method: 'POST' })).status, 200);
    assert.equal(await bridge.getStatus(id), 'cancelled', 'answered→cancelled terminal');
    assert.equal((await fetch(`${url}/ai/${id}/applied`, { method: 'POST' })).status, 400, 'terminal 이후 applied 불가');
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

// ===== E6: export·preview·paper (목 renderer — Chrome 0) =====

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function e6MockRenderer() {
  const calls = { pdf: [], png: [] };
  return {
    calls,
    async renderToPdf(inputPath, outputPath, opts) {
      calls.pdf.push({ inputPath, outputPath, opts });
      await writeFile(outputPath, '%PDF-mock');
    },
    async renderToPng(inputPath, outputPath, opts) {
      calls.png.push({ inputPath, outputPath, opts });
      await writeFile(outputPath, PNG_MAGIC);
    },
  };
}

test('E6 POST /export: 저장본 2벌 PDF·unsafe 시 student 차단(fail-closed)·busy 409', async () => {
  const renderer = e6MockRenderer();
  const { server, url, manifest } = await startServer({ renderer });
  try {
    // 정상: teacher 먼저 2벌
    const ok = await (await fetch(`${url}/export`, { method: 'POST' })).json();
    assert.deepEqual(ok.rendered.map((x) => x.variant), ['teacher', 'student']);
    assert.equal(ok.unsafe, false);
    assert.ok(renderer.calls.pdf[0].outputPath.endsWith('worksheet-teacher.pdf'));
    assert.ok(existsSync(renderer.calls.pdf[1].outputPath), '워크스페이스 PDF 슬롯 생성');

    // 누출 저장 → unsafe → student 차단·사유 문구
    const leaky = structuredClone(manifest);
    leaky.pages[0].push({ type: 'content', html: '<p>유출: 전압이 커질수록 전류의 세기도 일정한 비율로 커질 것이다. (전압 ∝ 전류)</p>' });
    const saved = await (await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: leaky }),
    })).json();
    assert.equal(saved.unsafe, true, '픽스처 전제: 누출 저장');
    const blocked = await (await fetch(`${url}/export`, { method: 'POST' })).json();
    assert.equal(blocked.unsafe, true);
    assert.equal(blocked.skipped.student, 'unsafe');
    assert.match(blocked.reason, /학생용 PDF 를 차단/);
    assert.deepEqual(blocked.rendered.map((x) => x.variant), ['teacher'], 'teacher 는 보존');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E6 GET /preview.png: scale:2 핀·paperToPx 치수·unsafe student 409', async () => {
  const renderer = e6MockRenderer();
  const { server, url, manifest } = await startServer({ renderer });
  try {
    const res = await fetch(`${url}/preview.png?mode=teacher&t=1`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.subarray(0, 8).equals(PNG_MAGIC), 'PNG 바이트 스트림');
    const opts = renderer.calls.png[0].opts;
    assert.equal(opts.scale, 2, '[A1] scale 핀 고정');
    assert.deepEqual({ width: opts.width, height: opts.height }, { width: 794, height: 1123 }, 'A4 paperToPx');
    assert.equal((await fetch(`${url}/preview.png?mode=nope`)).status, 400);

    // 누출 저장 → student 미리보기 409(교사용은 여전히 가능)
    const leaky = structuredClone(manifest);
    leaky.pages[0].push({ type: 'content', html: '<p>유출: 전압이 커질수록 전류의 세기도 일정한 비율로 커질 것이다. (전압 ∝ 전류)</p>' });
    await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: leaky }),
    });
    const blocked = await fetch(`${url}/preview.png?mode=student`);
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).message, /학생용 PDF 를 차단/);
    assert.equal((await fetch(`${url}/preview.png?mode=teacher`)).status, 200, 'teacher 는 항상 가능');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E6 POST /paper: 검증 400·no-op 가드·SaveDocument 경유 재저장', async () => {
  const { server, url, workspace } = await startServer({ renderer: e6MockRenderer() });
  try {
    // 잘못된 용지 → 400
    const bad = await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: { size: 'LETTER' } }),
    });
    assert.equal(bad.status, 400);

    // 현재(미지정 = A4 기본)와 동일 → no-op(리비전 불증가)
    const noop = await (await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: null }),
    })).json();
    assert.equal(noop.noop, true);

    // A3 가로로 변경 → SaveDocument 경유(rev 2)·manifest.paper 반영
    const changed = await (await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: { size: 'A3', orientation: 'landscape' } }),
    })).json();
    assert.equal(changed.noop, false);
    assert.equal(changed.meta.revision, 2);
    const saved = await workspace.readManifest('문서');
    assert.deepEqual(saved.paper, { size: 'A3', orientation: 'landscape' });

    // 같은 값 재선택 → no-op
    const again = await (await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: { size: 'A3', orientation: 'landscape' } }),
    })).json();
    assert.equal(again.noop, true);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E6 in-flight 가드: 렌더 진행 중 중복 요청 409 busy', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const renderer = {
    async renderToPdf(inputPath, outputPath) { await gate; await writeFile(outputPath, '%PDF-mock'); },
    async renderToPng() { throw new Error('unused'); },
  };
  const { server, url } = await startServer({ renderer });
  try {
    const first = fetch(`${url}/export`, { method: 'POST' }); // gate 에 매달림
    await new Promise((r) => setTimeout(r, 50));
    const second = await fetch(`${url}/export`, { method: 'POST' });
    assert.equal(second.status, 409, '동시 렌더 1개 제한');
    assert.equal((await second.json()).error, 'busy');
    const preview = await fetch(`${url}/preview.png?mode=teacher`);
    assert.equal(preview.status, 409, 'preview 도 같은 가드 공유');
    release();
    assert.equal((await first).status, 200, '선행 요청은 정상 완료');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
