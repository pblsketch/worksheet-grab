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

// E6 에디터 UI 실물 검증(실 Chrome dump-dom): 포맷 프리셋 선택기·E6 버튼 배선·
// A5 dirty-gate 계측(export-ui 시드) + 용지 변경(§3.3) 후 셸 재로드 = 전체
// 재페이지네이션(sheet 폭 실측 변화). PDF/PNG 실측은 export.render.test.js 소관.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 45000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-e6-chrome-'))}`,
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

async function startDoc(docName) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-e6-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: docName, manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName, workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('E6 실측: export-ui 시드 — 버튼·프리셋 선택기(5+고급)·A5 dirty-gate 무왕복', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startDoc('e6UI문서');
  try {
    const dom = await dumpDom(`${url}/?seed=export-ui`);
    assert.equal(bodyDataset(dom, 'seed-done'), 'export-ui');
    assert.equal(bodyDataset(dom, 'e6-buttons'), 'true', '정밀 미리보기·PDF 내보내기 버튼 배선');
    assert.equal(bodyDataset(dom, 'paper-options'), '6', '프리셋 5종 + 고급');
    assert.equal(bodyDataset(dom, 'paper-preset-value'), 'a4-portrait', 'matchPreset 역판정(현행 A4 기본)');
    assert.equal(bodyDataset(dom, 'save-first-noop'), 'true', '[A5] 비-dirty saveFirst = /save 무왕복·리비전 불변');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E6 실측: 용지 변경 → 셸 재로드 = 전체 재페이지네이션(A4 794px → A3 가로 1587px)', { skip: !HAS_CHROME, timeout: 180000 }, async () => {
  const { server, url } = await startDoc('e6용지문서');
  try {
    const before = await dumpDom(`${url}/`);
    assert.ok(Math.abs(parseFloat(bodyDataset(before, 'sheet-w')) - 793.7) <= 1, 'A4 기준 폭');
    assert.equal(bodyDataset(before, 'paper-preset'), 'a4-portrait');

    // 용지 변경은 manifest 레벨 변이 — 서버 /paper(SaveDocument 경유) 후 재로드가 곧
    // 클라이언트 location.reload() 경로와 동일한 재페이지네이션이다.
    const changed = await (await fetch(`${url}/paper`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paper: { size: 'A3', orientation: 'landscape' } }),
    })).json();
    assert.equal(changed.noop, false);
    assert.equal(changed.meta.revision, 2, 'SaveDocument 경유(히스토리 스냅샷)');

    const after = await dumpDom(`${url}/`);
    assert.ok(Math.abs(parseFloat(bodyDataset(after, 'sheet-w')) - 1587.4) <= 1,
      `A3 가로 재페이지네이션 실측 ${bodyDataset(after, 'sheet-w')}px`);
    assert.equal(bodyDataset(after, 'paper-preset'), 'a3-fold', '선택기 역판정 갱신');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
