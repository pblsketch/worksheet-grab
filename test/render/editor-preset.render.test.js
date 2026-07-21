import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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

// E4 실물 검증(실 Chrome, testSeed 게이트): §6 수용 자동화분 —
// 프리셋 저장→라이브러리 등장(정제 포함), 삽입→저장→manifest 반영.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-preset-chrome-'))}`,
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-preset-render-'));
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

test('E4 시드: 커서 블록 저장 → 라이브러리 등장 + 편집 아티팩트 정제', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=save-preset`);
    assert.equal(ds(dom, 'seed-done'), 'save-preset');
    assert.equal(ds(dom, 'preset-saved'), 'true', '저장 직후 GET /presets 목록에 등장');
    assert.equal(ds(dom, 'preset-clean'), 'true', 'data-wg-mark·contenteditable 아티팩트 부재');
    const index = JSON.parse(await readFile(join(base, '.presets', 'presets.json'), 'utf8'));
    assert.equal(index.userPresets[0].id, '시드-프리셋');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E4 시드: 라이브러리 첫 항목 삽입 → 저장 → manifest 블록 +1 반영', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=insert-preset`);
    assert.equal(ds(dom, 'seed-done'), 'insert-preset');
    assert.equal(ds(dom, 'preset-inserted'), 'true', '삽입 블록이 역동기화로 manifest 에 편입');
    const manifest = JSON.parse(await readFile(join(base, '문서', 'worksheet.manifest.json'), 'utf8'));
    const insertedType = ds(dom, 'inserted-type');
    assert.ok(manifest.pages.flat().some((b) => b.type === insertedType),
      `저장 manifest 에 프리셋 타입(${insertedType}) 블록 존재`);
    const meta = JSON.parse(await readFile(join(base, '문서', '.worksheet-grab/meta.json'), 'utf8'));
    assert.equal(meta.revision, 2, '문서 저장은 SaveDocument 경유');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
