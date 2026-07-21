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

// E3 실물 검증(실 Chrome, testSeed 게이트 서버): §6 수용의 자동화 가능분 —
// ② 정답 마킹→student 물리 제거, ③ 답란 5줄, ④ 폰트 축소 즉시 경고, ⑤ 넘침 배지,
// + M1 editMode 래퍼의 .sheet 높이 E2 등가. ①(자유 타이핑)은 Playwright 관찰 소관.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-edit-chrome-'))}`,
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-edit-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, base, workspace };
}

test('M1 실측: editMode 래퍼 캔버스의 .sheet 치수가 E2(비래퍼)와 등가(±1px)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/`);
    const w = parseFloat(ds(dom, 'sheet-w'));
    const h = parseFloat(ds(dom, 'sheet-h'));
    assert.ok(Math.abs(w - 793.7) <= 1, `래퍼 상태 폭 ${w}px = E2 등가(display:contents 투명)`);
    assert.ok(Math.abs(h - 1122.5) <= 1, `래퍼 상태 높이 ${h}px = E2 등가(넘침 예측 정확도 근간)`);
    assert.equal(ds(dom, 'overflow-badges'), '0', 'sci 기본 문서는 넘침 없음');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('§6 ②: 시드 정답 마킹→저장 → student 파생·워크스페이스 양쪽에서 물리 부재', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=answer-mark`);
    assert.equal(ds(dom, 'seed-done'), 'answer-mark');
    assert.equal(ds(dom, 'student-has-answer'), 'false', '즉석 student 파생에서 마킹 텍스트 물리 제거');
    assert.equal(ds(dom, 'saved-unsafe'), 'false', '정상 마킹 저장은 unsafe 아님');
    const student = await readFile(join(base, '문서', 'worksheet-student.html'), 'utf8');
    const meta = JSON.parse(await readFile(join(base, '문서', '.worksheet-grab/meta.json'), 'utf8'));
    assert.equal(meta.revision, 2, '저장이 SaveDocument 경유(rev·히스토리)');
    // 시드가 마킹한 텍스트(첫 긴 블록의 첫 텍스트)는 저장된 student 에도 없어야 한다.
    const manifest = JSON.parse(await readFile(join(base, '문서', 'worksheet.manifest.json'), 'utf8'));
    const flatHtml = manifest.pages.flat().map((b) => b.html ?? '').join('\n');
    const marked = /<span class="answer">([^<]{10,})<\/span>/.exec(flatHtml);
    assert.ok(marked, '저장 manifest 에 세션 마크가 .answer 로 반영(태깅은 저장 시 제거)');
    assert.ok(!flatHtml.includes('data-wg-mark'), '세션 태깅은 저장 시 제거(manifest 무오염)');
    assert.ok(!student.includes(marked[1]), '워크스페이스 student.html 물리 부재');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('§6 ③: 시드 답란 삽입→저장 → 5줄 반영', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=ans-line`);
    assert.equal(ds(dom, 'seed-done'), 'ans-line');
    assert.ok(Number(ds(dom, 'ans-lines')) >= 5, `블록 내 답란 ${ds(dom, 'ans-lines')}줄(삽입 5 포함)`);
    const manifest = JSON.parse(await readFile(join(base, '문서', 'worksheet.manifest.json'), 'utf8'));
    const firstPage = JSON.stringify(manifest.pages[0]);
    assert.ok((firstPage.match(/ans-line/g) || []).length >= 5, '저장 manifest 에 답란 5줄 반영');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('§6 ④: 시드 6pt 축소 → 라이브 검수 바 min-font 즉시 경고', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=shrink-font`);
    assert.equal(ds(dom, 'seed-done'), 'shrink-font');
    assert.equal(ds(dom, 'warn-min-font'), 'true', '8pt 미만 즉시 경고(저장 전 라이브)');
    assert.match(dom, /data-rule="min-font"/, '검수 바에 min-font 항목');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('§6 ⑤: 시드 대량 답란 → 페이지 바닥 초과 빨강 배지', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=overflow`);
    assert.equal(ds(dom, 'seed-done'), 'overflow');
    assert.ok(Number(ds(dom, 'overflow-badges')) >= 1, `넘침 배지 ${ds(dom, 'overflow-badges')}개(§3.4 실시간 예고)`);
    assert.ok(dom.includes('overflow-badge'), '부모 오버레이 배지 DOM 존재');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('시드 격리: testSeed 미기동 서버에선 ?seed= 가 무시된다(실데이터 보호)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'wsg-edit-noseed-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null });
  const addr = await listenEditorServer(server);
  try {
    const dom = await dumpDom(`http://127.0.0.1:${addr.port}/?seed=ans-line`);
    assert.equal(ds(dom, 'seed-done'), null, '시드 미실행');
    const meta = JSON.parse(await readFile(join(base, '문서', '.worksheet-grab/meta.json'), 'utf8'));
    assert.equal(meta.revision, 1, '자동 저장 미발생(rev 불변)');
    assert.ok(existsSync(join(base, '문서', 'worksheet-student.html')));
  } finally {
    await new Promise((r) => server.close(r));
  }
});
