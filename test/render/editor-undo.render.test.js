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

// G002 실물 검증(실 Chrome, testSeed 게이트 서버): 통합 실행취소 스택.
// 브라우저 기본 undo 밖에 있던 DOM 직접 조작 — ⭐정답 표시·✏️답란 삽입 — 이
// 되돌리기/다시하기 대상에 들어왔는지, 그리고 타이핑과 명령이 교차해도 사용자가
// 친 역순으로 풀리는지를 실제 브라우저에서 단정한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  // 생성한 쪽이 지운다 — 안 지우면 스위트 반복 실행에 임시 폴더가 수천 개 쌓여
  // 디스크가 차고 렌더 테스트가 통째로 멎는다(실측 7,000개).
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-undo-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=15000',
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

async function startEditServer() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-undo-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('G002: ⭐정답 표시가 되돌리기/다시하기 대상에 들어온다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=undo-answer-mark`);
    assert.equal(ds(dom, 'seed-done'), 'undo-answer-mark');
    const base = Number(ds(dom, 'undo-marks-base'));
    assert.equal(Number(ds(dom, 'undo-marks-after')), base + 1, '정답 표시로 마크 +1');
    assert.equal(Number(ds(dom, 'undo-marks-undone')), base, '되돌리기로 원상 복귀(회귀 지점)');
    assert.equal(Number(ds(dom, 'undo-marks-redone')), base + 1, '다시하기로 재적용');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('G002: ✏️답란 삽입이 되돌리기 대상에 들어온다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=undo-ans-line`);
    assert.equal(ds(dom, 'seed-done'), 'undo-ans-line');
    const base = Number(ds(dom, 'undo-lines-base'));
    assert.equal(Number(ds(dom, 'undo-lines-after')), base + 5, '답란 5줄 삽입');
    assert.equal(Number(ds(dom, 'undo-lines-undone')), base, '되돌리기로 5줄 제거');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('G002: 타이핑과 명령이 교차해도 친 역순으로 풀린다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=undo-interleave`);
    assert.equal(ds(dom, 'seed-done'), 'undo-interleave');
    // 타이핑 → 정답 표시 순으로 했으므로, 1회 되돌리면 마크만 풀리고 타이핑은 남아야 한다.
    assert.equal(ds(dom, 'undo-il-after-first'), 'typed-kept', '1차 되돌리기: 명령만 취소·타이핑 보존');
    assert.equal(ds(dom, 'undo-il-after-second'), 'typed-gone', '2차 되돌리기: 타이핑까지 취소');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
