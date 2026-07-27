import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';

// S4.3(신 UI 셸, US-18) 추가분: 앱 바·컨텍스트 툴바 상태 교체·좌 3탭·인스펙터 반응·슬래시 카탈로그
// 제한을 실 Chrome(--dump-dom, testSeed 게이트 서버)으로 검증한다. 위 S4.0 스위트(HTTP 계약)와
// 달리 여기부터는 UI 셸 자체를 실 브라우저 DOM 으로 단정 — editor-select.render.test.js 의
// dumpDom/ds 관례를 그대로 재사용한다(직렬 단독 실행).

// S4.0(M4a 초입, C-6/GAP-5): EditorHttpServer 계약 이관 — /shell.json 개체 트리 왕복(신규 문서 +
// 구 manifest 지연 마이그레이션), /save 개체 직송(SaveDocument.checkpoint), resync.js 소멸, /ai
// 개체 ID 에코(std-box·passage-slot 타입 가드). 이 시점의 계약은 HTTP JSON 뿐이라 실 Chrome 픽셀
// 계측은 필요 없다(캔버스 UI 셸의 실 마우스·실측 검증은 S4.1~S4.3 소관 — 계획서 06_plan_final.md
// 207~226행). 직렬 단독 실행(Chrome 0 — memory: render-tests-serial-only 는 이 파일엔 미해당).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// sci.json 원본에 실린 실제 정답 문구의 부분열(전체 문장은 다른 테스트 픽스처마다 표기가 갈린다 —
// editor-server.test.js 의 누출 픽스처와 동일 substring 관례를 따른다).
const LEGACY_ANSWER_SNIPPET = '전압이 커질수록 전류의 세기도';
const ANSWER = '전압과 전류의 관계를 설명할 수 있다(테스트 정답)';

async function startWorkspace() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-editor-shell-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  return { workspace, blockRepository };
}

async function startServer({ workspace, blockRepository, docName }) {
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

/** ValidateObjectTree/RenderObjectTree 스키마를 만족하는 최소 개체 트리 문서(닫힌 카탈로그 실사용). */
function freshDocument() {
  return {
    pagination: 'paginated',
    docTitle: '개체 트리 테스트 문서',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      flow: [
        { id: 'o1', type: 'title', placement: 'flow', text: '제목' },
        { id: 'o2', type: 'std-box', placement: 'flow', codes: ['9과15-01'] },
        { id: 'o3', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
        {
          id: 'o4', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압과 전류의 관계를 설명하시오.',
          answerKey: { text: ANSWER, html: `<div class="answer">${ANSWER}</div>` },
        },
      ],
      float: [],
    }],
  };
}

test('S4.0 /shell.json: 신규 개체 트리 문서 왕복(migrated:false, resync 없이 checkpoint 직결)', async () => {
  const { workspace, blockRepository } = await startWorkspace();
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '신규문서', document: freshDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const { server, url } = await startServer({ workspace, blockRepository, docName: '신규문서' });
  try {
    const res = await fetch(`${url}/shell.json`);
    assert.equal(res.status, 200);
    const shell = await res.json();

    assert.equal(shell.migrated, false, '이미 개체 트리인 문서는 마이그레이션 미실행');
    assert.equal(shell.document.pagination, 'paginated');
    assert.match(shell.document.pages[0].id, /^page-/);
    assert.ok(shell.teacherHtml.includes(`data-page-id="${shell.document.pages[0].id}"`), 'Page Shell에 페이지 ID 방출');
    assert.deepEqual(shell.document.pages[0].flow.map((o) => o.id), ['o1', 'o2', 'o3', 'o4'], '개체 ID 왕복 보존');
    assert.ok(shell.teacherHtml.includes('전압과 전류의 관계를 설명할 수 있다.'), 'std-box 성취기준 원문 렌더');
    assert.ok(shell.teacherHtml.includes(ANSWER), 'teacher 는 정답 보존');
    assert.ok(!shell.studentHtml.includes(ANSWER), 'student 는 정답 물리 부재');
    assert.deepEqual([...shell.excludedAiTypes].sort(), ['std-box'], '개체 타입 가드(§7, 원칙 3) — passage-slot 은 3층 정책(2026-07-23 2차 델타)으로 해제');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0 /shell.json: 구 manifest 지연 마이그레이션(A1) — 원본은 읽기 전용 보존', async () => {
  const { workspace, blockRepository } = await startWorkspace();
  const legacyManifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '구문서', manifest: legacyManifest, now: new Date('2026-07-23T00:00:00.000Z') });
  const { server, url } = await startServer({ workspace, blockRepository, docName: '구문서' });
  try {
    const res = await fetch(`${url}/shell.json`);
    assert.equal(res.status, 200);
    const shell = await res.json();

    assert.equal(shell.migrated, true, '구 HTML manifest 문서는 지연 마이그레이션 승격');
    assert.equal(shell.document.pagination, 'paginated');
    assert.equal(shell.document.pages.length, legacyManifest.pages.length, '페이지 경계 승계');
    assert.equal(new Set(shell.document.pages.map((page) => page.id)).size, shell.document.pages.length, '지연 마이그레이션 페이지 ID 고유');
    assert.ok(shell.document.pages.every((page) => shell.teacherHtml.includes(`data-page-id="${page.id}"`)), '모든 Page Shell에 ID 방출');
    assert.ok(shell.teacherHtml.includes(LEGACY_ANSWER_SNIPPET), 'teacher 는 정답 보존(마이그레이션 무손실)');
    assert.ok(!shell.studentHtml.includes(LEGACY_ANSWER_SNIPPET), 'student 는 정답 물리 부재');

    // 읽기 전용 보존: GET 만으로는 디스크의 구 manifest 가 손대지 않는다(첫 checkpoint 에서만 커밋).
    const onDisk = await workspace.readManifest('구문서');
    assert.ok(Array.isArray(onDisk.pages[0]), '디스크 원본은 여전히 구 manifest 배열 구조');
    assert.equal(onDisk.pagination, undefined, '디스크 원본에 pagination 필드가 아직 없음(미마이그레이션)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0 /save: 개체 트리 직송 → SaveDocument.checkpoint 커밋(rev 증가) + 스키마 검증 400', async () => {
  const { workspace, blockRepository } = await startWorkspace();
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '저장문서', document: freshDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const { server, url } = await startServer({ workspace, blockRepository, docName: '저장문서' });
  try {
    const got = await (await fetch(`${url}/shell.json`)).json();
    const mutated = structuredClone(got.document);
    mutated.pages[0].flow.push({ id: 'o5', type: 'divider', placement: 'flow' });

    const saveRes = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: mutated }),
    });
    assert.equal(saveRes.status, 200);
    const body = await saveRes.json();
    assert.equal(body.meta.revision, 2, 'checkpoint 커밋마다 rev 증가(체크포인트 1건 = rev 1건)');
    assert.equal(body.document.pages[0].id, got.document.pages[0].id, '저장 응답이 정규화된 문서를 전파');

    const onDisk = await workspace.readManifest('저장문서');
    assert.equal(onDisk.pagination, 'paginated');
    assert.equal(onDisk.pages[0].id, got.document.pages[0].id, '저장 시 페이지 ID 유지');
    assert.deepEqual(onDisk.pages[0].flow.map((o) => o.id), ['o1', 'o2', 'o3', 'o4', 'o5'], '워크스페이스에 직송 반영');
    const reopened = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(reopened.document.pages[0].id, got.document.pages[0].id, '저장·재열기 후 페이지 ID 유지');

    // ValidateObjectTree 스키마 검증 실패 → 400(잘못된 pagination 상태)
    const bad = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: { pagination: 'nope', pages: [] } }),
    });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /검증/);

    const missingId = structuredClone(mutated);
    delete missingId.pages[0].id;
    const missingIdRes = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: missingId }),
    });
    assert.equal(missingIdRes.status, 400, '저장 요청의 누락 ID를 조용히 수리하지 않음');

    const duplicateId = structuredClone(mutated);
    duplicateId.pages.push({ id: duplicateId.pages[0].id, flow: [], float: [] });
    const duplicateIdRes = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: duplicateId }),
    });
    assert.equal(duplicateIdRes.status, 400, '저장 요청의 중복 ID를 조용히 수리하지 않음');

    // document 필드 부재 → 400
    assert.equal((await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })).status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0 /save: 구 manifest 세션도 최초 저장에서 새 스키마로 커밋(첫 checkpoint 승격)', async () => {
  const { workspace, blockRepository } = await startWorkspace();
  const legacyManifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '구문서저장', manifest: legacyManifest, now: new Date('2026-07-23T00:00:00.000Z') });
  const { server, url } = await startServer({ workspace, blockRepository, docName: '구문서저장' });
  try {
    const got = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(got.migrated, true);
    const saveRes = await fetch(`${url}/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: got.document }),
    });
    assert.equal(saveRes.status, 200);
    assert.equal((await saveRes.json()).meta.revision, 2, '구 manifest 저장(rev 1) 이후 첫 checkpoint(rev 2)');

    const onDisk = await workspace.readManifest('구문서저장');
    assert.equal(onDisk.pagination, 'paginated', '최초 저장에서 개체 트리 스키마로 승격 커밋');
    assert.deepEqual(onDisk.pages.map((page) => page.id), got.document.pages.map((page) => page.id), '최초 저장에서 페이지 ID 고정');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0: resync.js 소멸 — 파일 부재·import 실패·정적 라우트 200 아님', async () => {
  assert.equal(existsSync(resolve(ROOT, 'src/editor/resync.js')), false, 'resync.js 파일 자체가 없다');
  await assert.rejects(() => import('../../src/editor/resync.js'), '역동기화 모듈 import 실패(모듈 부재)');

  const { workspace, blockRepository } = await startWorkspace();
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '라우트문서', document: freshDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const { server, url } = await startServer({ workspace, blockRepository, docName: '라우트문서' });
  try {
    const res = await fetch(`${url}/editor/resync.js`);
    assert.notEqual(res.status, 200, '/editor/resync.js 정적 서빙 불가(파일 부재)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('S4.0 /ai/requests: 개체 ID 에코 — std-box 400, passage-slot 200(3층 정책), 정상 개체 200 + 회신 [{id,object}]', async () => {
  const { workspace, blockRepository } = await startWorkspace();
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: 'AI문서', document: freshDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const { server, url } = await startServer({ workspace, blockRepository, docName: 'AI문서' });
  try {
    const bridge = new FsAiBridgeRepository({ baseDir: workspace.baseDir });

    // 성취기준 원문 슬롯(std-box, 원칙 3 — 무회귀) 단독 요청 → 400
    const stdRes = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'o2', type: 'std-box', codes: ['9과15-01'] }] }),
    });
    assert.equal(stdRes.status, 400, 'std-box 는 AI 대상 아님');

    // 3층 정책(2026-07-23 2차 델타): 저작권 지문 슬롯(passage-slot) 은 더 이상 400 이 아니다.
    const passageRes = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'o3', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' }] }),
    });
    assert.equal(passageRes.status, 200, 'passage-slot 은 명시 요청 시 AI 대상이어야 함(가드 해제)');

    // 집합 중 하나라도 제외 타입(std-box) 포함 → 전체 400(부분 요청 금지, §7)
    const mixed = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rewrite',
        objects: [{ id: 'o1', type: 'title', text: '제목' }, { id: 'o2', type: 'std-box' }],
      }),
    });
    assert.equal(mixed.status, 400);

    // 정상 개체(id+type+…현재 개체 필드 전체 에코, worksheet-designer 계약) → 200,
    // docName 서버 고정, objects[] 파일 큐에 개체 전체 필드 그대로 저장(html 요약 아님).
    const create = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rewrite',
        objects: [{ id: 'o4', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압과 전류의 관계를 설명하시오.' }],
        docName: '위조시도',
      }),
    });
    assert.equal(create.status, 200);
    const { id } = await create.json();
    const savedReq = await bridge.readRequest(id);
    assert.equal(savedReq.docName, 'AI문서', '서버 고정 docName');
    assert.deepEqual(savedReq.objects,
      [{ id: 'o4', type: 'question', placement: 'flow', qtype: 'essay', prompt: '전압과 전류의 관계를 설명하시오.' }],
      '개체 전체 필드가 손실 없이 그대로 저장');

    // 구독 AI 응답(개체 ID 에코 [{id,object}]) → answered
    await bridge.putResponse({
      schemaVersion: 3, id,
      objects: [{ id: 'o4', object: { id: 'o4', type: 'question', qtype: 'essay', prompt: '수정된 질문' } }],
    });
    const answered = await (await fetch(`${url}/ai/${id}`)).json();
    assert.equal(answered.status, 'answered');
    assert.deepEqual(answered.response.objects, [{ id: 'o4', object: { id: 'o4', type: 'question', qtype: 'essay', prompt: '수정된 질문' } }]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ══════════════════════════ S4.3 신 UI 셸(US-18) — 실 Chrome ══════════════════════════

const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000, windowSize = '1440,960') {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-shellui-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=20000',
    ...(windowSize ? [`--window-size=${windowSize}`] : []),
    '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-800)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

/** title·richtext·table·std-box 를 갖춘 최소 개체 트리 — 신 UI 셸 조작 대상. */
function shellUiFixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'S4.3 UI 셸 테스트',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      flow: [
        { id: 'ui-t1', type: 'title', placement: 'flow', text: '제목' },
        { id: 'ui-s1', type: 'std-box', placement: 'flow', codes: ['9과15-01'] },
        { id: 'ui-tb1', type: 'table', placement: 'flow', splittable: false, rows: [[{ text: 'a', header: true }, { text: 'b', header: true }], [{ text: '1' }, { text: '2' }]] },
        { id: 'ui-r1', type: 'richtext', placement: 'flow', html: '<p>richtext 내용</p>' },
      ],
      float: [],
    }],
  };
}

async function startShellUiServer(docName) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-shellui-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: docName, document: shellUiFixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName, workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('US-18 신 UI 셸: 앱 바·컨텍스트 툴바 상태 교체·좌 3탭·인스펙터 반응·슬래시 카탈로그 제한', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startShellUiServer('셸UI문서');
  try {
    const dom = await dumpDom(`${url}/?seed=shell-ui`);
    assert.equal(ds(dom, 'seed-done'), 'shell-ui', '시드 스크립트가 끝까지 실행됨');
    assert.equal(ds(dom, 'ready'), 'true');

    // 앱 바: 제목·검수 칩·미리보기·내보내기·저장 존재
    assert.equal(ds(dom, 'has-title'), 'true');
    assert.equal(ds(dom, 'has-review'), 'true');
    assert.equal(ds(dom, 'has-preview'), 'true');
    assert.equal(ds(dom, 'has-export'), 'true');
    assert.equal(ds(dom, 'has-save'), 'true');

    // 제목 인라인 편집 → 트리 meta 반영
    assert.equal(ds(dom, 'title-synced'), '수정된 문서 제목');
    assert.equal(ds(dom, 'title-changed'), 'true');

    // 검수 상태 칩(ValidateWorksheet 요약)
    assert.ok(['ok', 'warn', 'error'].includes(ds(dom, 'review-status')), `검수 상태 칩 값: ${ds(dom, 'review-status')}`);

    // 컨텍스트 툴바: 선택 없음 = empty(빠른 삽입)
    assert.equal(ds(dom, 'tb-empty'), 'empty');

    // 좌측 3탭 + 삽입 탭 전환
    assert.equal(ds(dom, 'tabs-count'), '4', '좌측 패널 탭 4개(페이지·레이어·삽입·내 블록)');
    assert.equal(ds(dom, 'left-tab-after-click'), 'insert');
    assert.equal(ds(dom, 'insert-panel-visible'), 'true');

    // 삽입 카탈로그 클릭 → 구조 삽입(history op) → 자동 선택 → 툴바/인스펙터 object 모드
    assert.equal(ds(dom, 'count-increased'), 'true', '삽입 카탈로그 클릭이 개체 트리에 새 개체를 추가');
    assert.equal(ds(dom, 'insp-after-insert'), 'object');
    assert.equal(ds(dom, 'tb-after-insert'), 'object');

    // 선택 상태별 툴바/인스펙터 교체
    assert.equal(ds(dom, 'tb-on-title-select'), 'object', 'title 선택 → 일반 개체 툴바');
    assert.equal(ds(dom, 'insp-on-title-select'), 'object');
    assert.equal(ds(dom, 'tb-on-table-select'), 'table', '표 선택 → 표 전용 툴바');
    assert.equal(ds(dom, 'has-add-row-btn'), 'true');
    assert.equal(ds(dom, 'tb-on-multi'), 'multi', '다중 선택 → multi 툴바');
    assert.equal(ds(dom, 'insp-on-multi'), 'multi');

    // 선택 해제 → 인스펙터 문서 설정/검수 상세로 복귀
    assert.equal(ds(dom, 'insp-on-clear'), 'document');
    assert.equal(ds(dom, 'review-list-present'), 'true');

    // 슬래시 메뉴 — 닫힌 카탈로그만. 콘텐츠 10종(question 은 qtype 7종으로 펼쳐져 +6) +
    // 레이아웃 2종(빈 공간·페이지 나누기, 2026-07-28 신설) = 18항목.
    assert.equal(ds(dom, 'slash-open-captured'), 'true', '`/` 입력 시 슬래시 메뉴가 열림');
    assert.equal(ds(dom, 'slash-item-count'), '18', '슬래시 메뉴는 닫힌 카탈로그(12종 · question 은 qtype 7종 전개 = 18)만 노출');
    assert.equal(ds(dom, 'slash-insert-increased'), 'true', '슬래시 메뉴 항목 클릭이 개체를 삽입');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
