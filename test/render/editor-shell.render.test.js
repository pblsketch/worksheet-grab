import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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

// E2 실물 검증(실 Chrome): 에디터 셸을 실제 브라우저로 로드해 계측 훅(body dataset)으로
// 페이지 박스 px·모드·여백선 개수·검수 바 상태를 실측한다. mm→px 는 CSS 96dpi 고정.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const ANSWER = '광합성은 빛에너지를 화학에너지로 전환하는 생명 활동 과정이다';

function dumpDom(url, timeoutMs = 45000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-editor-chrome-'))}`,
    '--virtual-time-budget=10000',
    '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-500)}`));
      else resolvePromise(out);
    });
  });
}

function bodyDataset(dom, key) {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
}

async function startDoc(docName, manifestMutate) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-editor-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest(docName.startsWith('a3') ? '_e0-a3-landscape' : 'sci');
  if (manifestMutate) manifestMutate(manifest);
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: docName, manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('E2 실측: A4 페이지 박스 폭 793.7px(±1)·높이 하한·여백선·검수 바 동작', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startDoc('기본문서');
  try {
    const dom = await dumpDom(`${url}/`);
    const w = parseFloat(bodyDataset(dom, 'sheet-w'));
    const h = parseFloat(bodyDataset(dom, 'sheet-h'));
    assert.ok(Math.abs(w - 793.7) <= 1, `A4 폭 실측 ${w}px (기대 793.7±1 — CSS 96dpi 고정)`);
    assert.ok(h >= 1121.5, `A4 높이 실측 ${h}px (min-height 1122.5 하한, 콘텐츠 넘침 허용)`);
    assert.equal(bodyDataset(dom, 'mode'), 'teacher', '기본 모드 교사용');
    assert.ok(Number(bodyDataset(dom, 'guides')) >= 3, `여백선 오버레이 페이지 수만큼(실측 ${bodyDataset(dom, 'guides')})`);
    assert.match(dom, /review-status (ok|warning|error)/, '검수 바가 실행되어 상태 클래스 부여');
    assert.ok(dom.includes('margin-guide'), '부모 오버레이 여백선 DOM 존재');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E2 실측: #student 시작 — 학생 모드 전환(물리 2벌 스왑 경로)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startDoc('학생시작문서');
  try {
    const dom = await dumpDom(`${url}/#student`);
    assert.equal(bodyDataset(dom, 'mode'), 'student');
    assert.match(dom, /review-status (ok|warning|error)/, '학생 모드에서도 검수 바 갱신');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E2 실측: A3 가로 페이지 박스 폭 1587.4px(±1)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startDoc('a3문서');
  try {
    const dom = await dumpDom(`${url}/`);
    const w = parseFloat(bodyDataset(dom, 'sheet-w'));
    assert.ok(Math.abs(w - 1587.4) <= 1, `A3 가로 폭 실측 ${w}px (기대 1587.4±1)`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E2 실측: 누출 픽스처 — 검수 바 answer-leak error 배지', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startDoc('누출문서', (m) => {
    m.pages[0].push({ type: 'content', html: `<div class="answer">${ANSWER}</div>` });
    m.pages[0].push({ type: 'content', html: `<p>참고: ${ANSWER}</p>` });
  });
  try {
    const dom = await dumpDom(`${url}/`);
    assert.match(dom, /review-status error/, '누출 시 error 상태');
    assert.ok(/class="error"[^>]*data-rule="answer-leak"|data-rule="answer-leak"[^>]*class="error"|<li class="error" data-rule="answer-leak">/.test(dom),
      'answer-leak error 배지 항목 존재');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
