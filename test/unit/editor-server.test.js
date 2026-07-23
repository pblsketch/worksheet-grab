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

test('S4.0 POST /save: 개체 트리 직송 → SaveDocument.checkpoint 경유·rev 증가·잘못된 본문 400·타 경로 405', async () => {
  const { server, url, workspace } = await startServer();
  try {
    // /shell.json 이 구 manifest 를 지연 마이그레이션해 서빙한 개체 트리를 그대로 편집→직송한다.
    const { document } = await (await fetch(`${url}/shell.json`)).json();
    const edited = structuredClone(document);
    edited.pages[0].flow.push({ id: 'e2e-added', type: 'divider', placement: 'flow' });
    const res = await fetch(`${url}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: edited }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unsafe, false);
    assert.equal(body.meta.revision, 2, 'SaveDocument.checkpoint 경유(리비전·히스토리) — 구 manifest 저장(rev1) 이후 첫 checkpoint');
    const saved = await workspace.readManifest('문서');
    assert.equal(saved.pagination, 'paginated', '개체 트리 스키마로 커밋');
    assert.ok(saved.pages[0].flow.some((o) => o.id === 'e2e-added'), '워크스페이스 반영');

    const bad = await fetch(`${url}/save`, { method: 'POST', body: '잘못된 JSON' });
    assert.equal(bad.status, 400);
    const noDoc = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(noDoc.status, 400, 'document 필드 부재 400');
    const invalid = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: { pagination: 'nope', pages: [] } }),
    });
    assert.equal(invalid.status, 400, 'ValidateObjectTree 스키마 검증 실패 400');
    assert.equal((await fetch(`${url}/shell.json`, { method: 'POST' })).status, 405, '저장 외 POST 는 405');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0 /ai/*: 개체 ID 에코 요청 생성(docName 서버 주입)→answered→applied 왕복 + 제외 타입 400 + 취소 terminal', async () => {
  const { server, url, workspace } = await startServer();
  try {
    const { FsAiBridgeRepository } = await import('../../src/adapters/FsAiBridgeRepository.js');
    const bridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

    // 제외 타입(§7 개체 타입 가드, 원칙 3 — 성취기준만 잔류) → 400
    const stdRes = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'o-x', type: 'std-box' }] }),
    });
    assert.equal(stdRes.status, 400, 'std-box 는 AI 대상 아님(원칙 3, 무회귀)');

    // 3층 정책(2026-07-23 2차 델타): passage-slot 은 가드 해제 — 명시 요청 시 AI 대상 200.
    const passageRes = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'o-pas', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' }] }),
    });
    assert.equal(passageRes.status, 200, 'passage-slot 은 더 이상 AI 대상 제외가 아니어야 함(가드 해제)');

    // 정상 요청(개체 전체 필드 그대로, worksheet-designer 계약) → pending, docName 은 서버 주입
    const create = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rewrite',
        objects: [{ id: 'o-q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '문항' }],
        docName: '위조시도',
      }),
    });
    assert.equal(create.status, 200);
    const { id } = await create.json();
    const savedReq = await bridge.readRequest(id);
    assert.equal(savedReq.docName, '문서', '서버 고정 docName');
    assert.deepEqual(savedReq.objects, [{ id: 'o-q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '문항' }]);
    assert.deepEqual(await (await fetch(`${url}/ai/${id}`)).json(), { status: 'pending' });

    // 모의 구독 AI 응답(개체 ID 에코 [{id,object}]) → answered + response 동봉
    await bridge.putResponse({
      schemaVersion: 3, id,
      objects: [{ id: 'o-q1', object: { id: 'o-q1', type: 'question', qtype: 'essay', prompt: '재작성된 문항' } }],
    });
    const answered = await (await fetch(`${url}/ai/${id}`)).json();
    assert.equal(answered.status, 'answered');
    assert.deepEqual(answered.response.objects, [{ id: 'o-q1', object: { id: 'o-q1', type: 'question', qtype: 'essay', prompt: '재작성된 문항' } }]);

    // 적용 기록 → 즉시 정리(스테일 방지)
    assert.equal((await fetch(`${url}/ai/${id}/applied`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${url}/ai/${id}`)).status, 404, 'applied 후 prune');

    // 취소 terminal
    const c = await (await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'fill-example', objects: [{ id: 'o-r1', type: 'richtext', html: '<p>본문</p>' }] }),
    })).json();
    // (richtext 는 html 필드가 스키마상 본문 필드다 — 개체 전체 필드 그대로 에코 관례와 정합)
    assert.equal((await fetch(`${url}/ai/${c.id}/cancel`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${url}/ai/${c.id}/applied`, { method: 'POST' })).status, 400, 'cancelled → applied 전이 불가');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0 /ai/requests: v3 objects[] 저장(schemaVersion:3) + 집합 내 제외 타입 1개 → 전체 400', async () => {
  const { server, url, workspace } = await startServer();
  try {
    const { FsAiBridgeRepository } = await import('../../src/adapters/FsAiBridgeRepository.js');
    const bridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

    // 다중 개체 요청(개체 전체 필드 그대로) → 200, 요청 파일은 v3(objects[2], 개체 ID 에코) 로 저장
    const create = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [
        { id: 'o-t1', type: 'title', placement: 'flow', text: 'A' },
        { id: 'o-q2', type: 'question', placement: 'flow', qtype: 'essay', prompt: 'B' },
      ] }),
    });
    assert.equal(create.status, 200);
    const { id } = await create.json();
    const saved = await bridge.readRequest(id);
    assert.equal(saved.schemaVersion, 3, '신규 요청은 v3 로 기록');
    assert.equal(saved.objects.length, 2, 'objects[] 보존');
    assert.equal(saved.docName, '문서', '서버 고정 docName');

    // 집합 중 제외 타입(std-box, 원칙 3 — 무회귀) 포함 → 전체 400(부분 요청 금지, §7)
    const badRes = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [
        { id: 'o-ok', type: 'question', placement: 'flow', qtype: 'essay', prompt: '정상' },
        { id: 'o-bad', type: 'std-box' },
      ] }),
    });
    assert.equal(badRes.status, 400, '집합에 std-box 포함 → 전체 거부');
    assert.equal((await bridge.listPending()).length, 1, '거부분은 큐 미잔존 — 정상 v3 요청 1건만');

    // 3층 정책(2026-07-23 2차 델타): 집합에 passage-slot 이 섞여도 더 이상 거부 대상이 아니다.
    const passageMixRes = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [
        { id: 'o-ok2', type: 'question', placement: 'flow', qtype: 'essay', prompt: '정상2' },
        { id: 'o-pas', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
      ] }),
    });
    assert.equal(passageMixRes.status, 200, '집합에 passage-slot 이 섞여도 더 이상 400 이 아니어야 함(가드 해제)');

    // v3 응답(objects[{id,object}]) 왕복
    await bridge.putResponse({ schemaVersion: 3, id, objects: [
      { id: 'o-t1', object: { id: 'o-t1', type: 'title', text: 'A2' } },
      { id: 'o-q2', object: { id: 'o-q2', type: 'question', qtype: 'essay', prompt: 'B2' } },
    ] });
    const answered = await (await fetch(`${url}/ai/${id}`)).json();
    assert.equal(answered.status, 'answered');
    assert.equal(answered.response.objects.length, 2, 'v3 응답 objects 동봉');
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
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'o-r9', type: 'richtext', html: '<p>A</p>' }] }),
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
  const { server, url } = await startServer({ renderer });
  try {
    // 정상: teacher 먼저 2벌
    const ok = await (await fetch(`${url}/export`, { method: 'POST' })).json();
    assert.deepEqual(ok.rendered.map((x) => x.variant), ['teacher', 'student']);
    assert.equal(ok.unsafe, false);
    assert.ok(renderer.calls.pdf[0].outputPath.endsWith('worksheet-teacher.pdf'));
    assert.ok(existsSync(renderer.calls.pdf[1].outputPath), '워크스페이스 PDF 슬롯 생성');

    // 누출 저장(S4.0 개체 직송) → unsafe → student 차단·사유 문구. 마이그레이션된 문서의 기존
    // .answer 개체(sci.json 원본에서 승계)와 같은 정답 텍스트를 마크 밖 평문으로 중복 삽입한다.
    const { document } = await (await fetch(`${url}/shell.json`)).json();
    const leaky = structuredClone(document);
    leaky.pages[0].flow.push({
      id: 'leak-1', type: 'richtext', placement: 'flow',
      html: '<p>유출: 전압이 커질수록 전류의 세기도 일정한 비율로 커질 것이다. (전압 ∝ 전류)</p>',
    });
    const saved = await (await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: leaky }),
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
  const { server, url } = await startServer({ renderer });
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

    // 누출 저장(S4.0 개체 직송) → student 미리보기 409(교사용은 여전히 가능)
    const { document } = await (await fetch(`${url}/shell.json`)).json();
    const leaky = structuredClone(document);
    leaky.pages[0].flow.push({
      id: 'leak-1', type: 'richtext', placement: 'flow',
      html: '<p>유출: 전압이 커질수록 전류의 세기도 일정한 비율로 커질 것이다. (전압 ∝ 전류)</p>',
    });
    await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: leaky }),
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
