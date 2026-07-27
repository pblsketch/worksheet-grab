import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { makeTmpDir, makeTmpDirSync } from '../helpers/tmp.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// US-20(S4.5) 재작성 — G002(통합 실행취소) 개체 모델 동형.
//
// 구 테스트는 브라우저 기본 undo 밖의 DOM 직접 조작(⭐정답 표시·✏️답란 삽입)이 되돌리기
// 대상에 들어오는지, 타이핑과 명령이 교차해도 역순으로 풀리는지를 검증했다. 신 모델의 undo/redo
// 는 개체 트리 스냅샷 스택(history.js)이며, 조작 단위는 "명령(즉시 커밋)"과 "타이핑(500ms 유휴
// 커밋)" 2종이다 — 같은 검증 의도를 그대로 개체 모델로 옮긴다:
//  ① 정답 표시(answer:true 토글) = 명령 1단위, 되돌리기/다시하기 대상.
//  ② 답란 줄 수 변경(구 "답란 5줄 삽입"의 개체 모델 동형, answer-area.lines) = 명령 1단위.
//  ③ 타이핑 뒤 명령이 이어지면(유휴 커밋 뒤) 되돌리기 1회는 명령만, 2회째가 타이핑까지 취소.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-undo-chrome-');
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${chromeTmp.dir}`, '--virtual-time-budget=20000', '--dump-dom', url,
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
    docTitle: 'G002 통합 실행취소 테스트',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>정답 마킹 대상 문단</p>' },
        { id: 'r2', type: 'richtext', placement: 'flow', html: '<p>원문</p>' },
        { id: 'aa1', type: 'answer-area', placement: 'flow', style: 'line', lines: 3 },
      ],
      float: [],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-undo-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('G002 ①: 정답 표시(answer:true)가 되돌리기/다시하기 대상에 들어온다', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=undo-answer-toggle`);
    assert.equal(ds(dom, 'seed-done'), 'undo-answer-toggle');
    assert.equal(ds(dom, 'undo-marks-base'), '0');
    assert.equal(ds(dom, 'undo-marks-after'), '1', '정답 표시로 answer:true');
    assert.equal(ds(dom, 'undo-marks-undone'), '0', '되돌리기로 원상 복귀');
    assert.equal(ds(dom, 'undo-marks-redone'), '1', '다시하기로 재적용');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('G002 ②: 답란 줄 수 변경(구 "답란 5줄 삽입" 동형)이 되돌리기 대상에 들어온다', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=undo-lines`);
    assert.equal(ds(dom, 'seed-done'), 'undo-lines');
    assert.equal(ds(dom, 'undo-lines-base'), '3');
    assert.equal(ds(dom, 'undo-lines-after'), '8', '3 → 8 (+5)');
    assert.equal(ds(dom, 'undo-lines-undone'), '3', '되돌리기로 원복');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('G002 ③: 타이핑과 명령이 교차해도 친 역순으로 풀린다', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=undo-interleave`);
    assert.equal(ds(dom, 'seed-done'), 'undo-interleave');
    assert.equal(ds(dom, 'il-typed-and-marked'), 'true', '픽스처 전제: 타이핑+정답 마킹 모두 반영됨');
    assert.equal(ds(dom, 'il-after-first-typed'), 'true', '1차 되돌리기: 명령(정답 마킹)만 취소·타이핑 보존');
    assert.equal(ds(dom, 'il-after-first-answer'), 'false');
    assert.equal(ds(dom, 'il-after-second-typed'), 'false', '2차 되돌리기: 타이핑까지 취소');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});
