import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';

// F1 이미지 UX 실물 검증(실 Chrome, testSeed 게이트 서버):
//  ① PNG 업로드→커서 삽입→저장 → GET /assets 200·manifest 반영·mm 폭 반영·student 존재.
//  ② 업로드 이미지 ⭐정답 마킹→저장 → student 파생·워크스페이스 양쪽에서 물리 부재(누출 안전).
// 시드/계측 패턴은 editor-edit.render.test.js 재사용.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-img-chrome-'))}`,
    '--virtual-time-budget=15000', '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let errOut = '';
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

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

async function startEditServer() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-img-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, base };
}

test('F1 ①: 시드 image-insert — 업로드→삽입→저장 → GET 200·manifest img·40mm·student 존재', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=image-insert`);
    assert.equal(ds(dom, 'seed-done'), 'image-insert');
    assert.equal(ds(dom, 'asset-get'), '200', 'GET /assets 200(자산 서빙)');
    assert.match(ds(dom, 'asset-path'), /^assets\/.+\.png$/, '경로 파생(assets/<name>.png)');
    assert.equal(ds(dom, 'manifest-has-img'), 'true', '저장 manifest 에 img 반영');
    assert.equal(ds(dom, 'manifest-has-width'), 'true', 'mm 리사이즈 폭(40mm) 반영');
    assert.equal(ds(dom, 'student-has-img'), 'true', '비마킹 이미지는 student 파생에도 존재');
    assert.equal(ds(dom, 'saved-unsafe'), 'false');

    // 워크스페이스 자산 파일 실재 + 저장 manifest 파일 반영
    assert.ok(existsSync(join(base, '문서', 'assets', '시드샷.png')), 'assetsDir 에 파일 원자 기록');
    const manifest = JSON.parse(await readFile(join(base, '문서', 'worksheet.manifest.json'), 'utf8'));
    const flat = JSON.stringify(manifest.pages);
    assert.ok(flat.includes('assets/시드샷.png'), 'manifest 에 자산 경로 참조');
    assert.ok(flat.includes('40mm'), 'manifest 에 mm 폭 보존');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('F1 ②: 시드 image-answer — img ⭐마킹→저장 → student 물리 부재·teacher manifest 잔존', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=image-answer`);
    assert.equal(ds(dom, 'seed-done'), 'image-answer');
    assert.equal(ds(dom, 'img-wrapped-answer'), 'true', 'img 가 span.answer 로 감싸짐(요소 선택 마킹)');
    assert.equal(ds(dom, 'student-has-ans-img'), 'false', '정답 마킹 이미지는 student 파생 물리 제거');
    assert.equal(ds(dom, 'teacher-has-ans-img'), 'true', 'teacher manifest 에는 잔존');
    assert.equal(ds(dom, 'saved-unsafe'), 'false', '이미지 마킹은 정답 텍스트 누출 아님');

    // 워크스페이스 student.html 에도 자산 경로 물리 부재(BuildVariants 물리 제거)
    const student = await readFile(join(base, '문서', 'worksheet-student.html'), 'utf8');
    assert.ok(!student.includes('assets/정답샷.png'), 'student.html 자산 물리 부재');
    const teacher = await readFile(join(base, '문서', 'worksheet-teacher.html'), 'utf8');
    assert.ok(teacher.includes('assets/정답샷.png'), 'teacher.html 에는 이미지 잔존(정답 포함본)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
