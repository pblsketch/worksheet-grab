import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { makeTmpDir, makeTmpDirSync } from '../helpers/tmp.js';

// US-20(S4.5) 재작성 — E6 에디터 UI 실물 검증(개체 모델). 앱 바 버튼 배선·문서설정 용지
// 프리셋 선택기·[A5] 비-dirty save-first 무왕복 + 용지 변경→전체 재페이지네이션. PDF/PNG
// 실측은 export.render.test.js 소관(무변경).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 45000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-e6-chrome-');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${chromeTmp.dir}`, '--virtual-time-budget=10000', '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); chromeTmp.cleanup(); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      chromeTmp.cleanup();
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-800)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'E6 내보내기 UI 테스트',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{ flow: [{ id: 't1', type: 'title', placement: 'flow', text: '제목' }], float: [] }],
  };
}

async function startDoc(docName) {
  const ws = await makeTmpDir('wsg-e6-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: docName, document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('E6 실측: export-ui 시드 — 앱 바 버튼·용지 프리셋 선택기(6종)·[A5] dirty-gate 무왕복', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startDoc('e6UI문서');
  try {
    const dom = await dumpDom(`${url}/?seed=export-ui`);
    assert.equal(ds(dom, 'seed-done'), 'export-ui');
    assert.equal(ds(dom, 'e6-buttons'), 'true', '미리보기·PDF 내보내기 버튼 배선');
    assert.equal(ds(dom, 'paper-options'), '6', '프리셋 5종 + 사용자 지정');
    assert.equal(ds(dom, 'paper-preset-value'), 'a4-portrait', 'matchPreset 역판정(현행 A4 기본)');
    assert.equal(ds(dom, 'save-first-noop'), 'true', '[A5] 비-dirty 상태의 재선택(no-op)은 /save 를 부르지 않는다');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('E6 실측: 용지 변경 → 셸 재로드 = 전체 재페이지네이션(A4 210mm → A3 가로 420mm)', { skip: !HAS_CHROME, timeout: 90000 }, async () => {
  const { server, url, ws } = await startDoc('e6용지문서');
  try {
    const beforeShell = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(beforeShell.document.paper, null, 'A4 기본은 paper 오버라이드 미주입(§ paperCss 계약)');

    const changed = await (await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: { size: 'A3', orientation: 'landscape' } }),
    })).json();
    assert.equal(changed.noop, false);
    assert.equal(changed.meta.revision, 2, 'SaveDocument.checkpoint 경유(히스토리 스냅샷)');

    // 서버 측 재조회(= 클라이언트 location.reload() 와 동일한 재페이지네이션 경로) —
    // A3 가로: paperDims({size:'A3',orientation:'landscape'}) = {w:420,h:297}(장·단변 swap).
    const afterShell = await (await fetch(`${url}/shell.json`)).json();
    assert.equal(afterShell.document.paper.size, 'A3');
    assert.equal(afterShell.document.paper.orientation, 'landscape');
    assert.ok(afterShell.teacherHtml.includes('--sheet-w: 420mm'), 'A3 가로 재페이지네이션이 teacherHtml paper-css 오버라이드에 반영');
    assert.ok(afterShell.teacherHtml.includes('--sheet-h: 297mm'));

    // 실 Chrome dump-dom 으로 픽셀 폭까지 실측(96dpi: 420mm ≈ 1587.4px).
    const dom = await dumpDom(`${url}/`);
    const m = /--sheet-w:\s*420mm/.test(dom);
    assert.ok(m, 'teacher iframe 이 A3 가로 CSS 변수를 실제로 로드');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});
