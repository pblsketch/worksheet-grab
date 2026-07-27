import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';

// US-18(S4.3) 재작성 — 좌측 페이지 썸네일 탭(개체 트리 기반). 구판(US-E1, HTML manifest 시절)은
// DOM 스크래핑만으로 썸네일을 그렸지만, 신 UI 셸은 leftPanel.js 의 renderThumbs()가 teacher
// iframe 의 라이브 DOM(= 개체 트리 렌더 결과)을 그대로 축소해 쓴다 — 여기서 검증하는 것은
// "썸네일 수가 페이지 수(개체 트리 pages[].length)와 항상 일치하는가"(트리 동기화)와
// "페이지 추가/복제/삭제(leftPanel 우클릭 메뉴·+새 페이지) 후에도 그 동기화가 유지되는가"다.
// editor.js:runSeed('thumbs-tree') 가 결정적으로 재현한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000, windowSize = '1440,960') {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-thumb-chrome-'));
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
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-500)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

function thumbsFixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '썸네일 트리 동기화 테스트',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [],
    pages: [
      { flow: [{ id: 'p0-t', type: 'title', placement: 'flow', text: '1쪽 제목' }], float: [] },
      { flow: [{ id: 'p1-t', type: 'title', placement: 'flow', text: '2쪽 제목' }], float: [] },
    ],
  };
}

async function startEditServer() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-thumb-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .checkpoint({ name: '문서', document: thumbsFixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('US-18 좌측 페이지 탭: 썸네일 트리 동기화 · 페이지 추가/복제/삭제', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=thumbs-tree`);
    assert.equal(ds(dom, 'seed-done'), 'thumbs-tree', '시드 스크립트가 끝까지 실행됨');

    // 초기: 썸네일 수 = 페이지 수(2쪽 픽스처)
    assert.equal(ds(dom, 'page-count-initial'), '2');
    assert.equal(ds(dom, 'thumb-count-initial'), '2');

    // +새 페이지 → 페이지·썸네일 동시 +1
    assert.equal(ds(dom, 'page-count-after-add'), '3');
    assert.equal(ds(dom, 'thumb-count-after-add'), '3');

    // 0쪽 복제 → 페이지·썸네일 동시 +1
    assert.equal(ds(dom, 'page-count-after-dup'), '4');
    assert.equal(ds(dom, 'thumb-count-after-dup'), '4');

    // 마지막 쪽 삭제 → 페이지·썸네일 동시 -1
    assert.equal(ds(dom, 'page-count-after-delete'), '3');
    assert.equal(ds(dom, 'thumb-count-after-delete'), '3');

    // 편집한 쪽의 썸네일 iframe srcdoc 에 편집 내용이 반영(트리 기반 재생성)
    assert.equal(ds(dom, 'thumb-sync-ok'), 'true', '편집한 개체가 속한 쪽의 썸네일에 새 내용이 반영됨');

    // 클릭(scrollToPage) 이 캔버스를 그 쪽으로 스크롤
    assert.equal(ds(dom, 'scroll-to-first-ok'), 'true');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('Phase 2 페이지 관리: ID 선택·role·키보드/포인터 재배치·구조 undo/redo', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=page-management`);
    assert.equal(ds(dom, 'seed-done'), 'page-management');

    assert.match(ds(dom, 'pm-selected-id'), /^page-/);
    assert.equal(ds(dom, 'pm-aria-current'), 'page');
    assert.equal(ds(dom, 'pm-tab-index'), '0');
    assert.equal(ds(dom, 'pm-has-menu-button'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-menu-count'), '6');
    assert.equal(ds(dom, 'pm-keyboard-menu-focus'), '앞으로 이동');
    assert.equal(ds(dom, 'pm-keyboard-menu-in-viewport'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-menu-nav-focus'), '복제');
    assert.equal(ds(dom, 'pm-keyboard-menu-closed'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-menu-return-focus'), ds(dom, 'pm-selected-id'));
    assert.equal(ds(dom, 'pm-keyboard-menu-activated'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-menu-page-delta'), '1');

    assert.equal(ds(dom, 'pm-role-after'), 'reading');
    assert.equal(ds(dom, 'pm-role-undo'), '');
    assert.equal(ds(dom, 'pm-role-undo-active'), ds(dom, 'pm-selected-id'));
    assert.equal(ds(dom, 'pm-role-redo'), 'reading');
    assert.equal(ds(dom, 'pm-inactive-keyboard-active-retained'), 'true');
    assert.equal(ds(dom, 'pm-inactive-keyboard-focus-retained'), 'true');

    const selectedId = ds(dom, 'pm-selected-id');
    assert.equal(ds(dom, 'pm-keyboard-order').split(',')[0], selectedId);
    assert.equal(ds(dom, 'pm-keyboard-active'), selectedId);
    assert.equal(ds(dom, 'pm-keyboard-focus'), selectedId);
    assert.equal(ds(dom, 'pm-keyboard-scroll-matches'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-undo-order').split(',')[1], selectedId);
    assert.equal(ds(dom, 'pm-keyboard-undo-scroll-matches'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-redo-scroll-matches'), 'true');
    assert.equal(ds(dom, 'pm-keyboard-boundary-prevented'), 'true');
    assert.equal(ds(dom, 'pm-pointer-cancel-restored'), 'true');
    assert.equal(ds(dom, 'pm-pointer-down-prevented'), 'true');
    assert.equal(ds(dom, 'pm-pointer-order').split(',').at(-1), selectedId);
    assert.equal(ds(dom, 'pm-pointer-active'), selectedId);
    assert.equal(ds(dom, 'pm-pointer-scroll-matches'), 'true');
    assert.notEqual(ds(dom, 'pm-manual-scroll-active'), selectedId);

    assert.equal(ds(dom, 'pm-add-id-unique'), 'true');
    assert.equal(ds(dom, 'pm-add-active'), ds(dom, 'pm-add-redo-active'));
    assert.equal(ds(dom, 'pm-add-sheets'), '3');
    assert.equal(ds(dom, 'pm-add-undo-count'), '2');
    assert.equal(ds(dom, 'pm-add-undo-sheets'), '2');

    assert.notEqual(ds(dom, 'pm-delete-active'), ds(dom, 'pm-add-active'));
    assert.equal(ds(dom, 'pm-delete-undo-active'), ds(dom, 'pm-add-active'));
    assert.equal(ds(dom, 'pm-delete-undo-sheets'), '3');
    assert.equal(ds(dom, 'pm-delete-redo-count'), '2');
    assert.equal(ds(dom, 'pm-delete-redo-sheets'), '2');
    assert.equal(ds(dom, 'pm-saved-ids'), ds(dom, 'pm-pointer-order'));
    assert.equal(ds(dom, 'pm-saved-reading-role'), 'true');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
