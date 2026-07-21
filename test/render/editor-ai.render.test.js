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
import { FsAiBridgeRepository } from '../../src/adapters/FsAiBridgeRepository.js';
import { AI_SCHEMA_VERSION } from '../../src/usecases/aiBridge.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';

// E5 실물 검증(실 Chrome, testSeed 게이트): 요청 발신·타입 가드·응답 적용·저장 왕복.
// 모의 구독 AI = 테스트가 브리지에 응답 파일을 직접 기록(무API 대칭 — 실제 AI 는
// ai respond CLI 로 같은 파일을 쓴다).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wsg-ai-chrome-'))}`,
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-ai-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, base, bridge: new FsAiBridgeRepository({ baseDir: base }) };
}

test('E5 시드: 요청 발신 → 마커 스탬프·서버 pending 기록', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=ai-request`);
    assert.equal(ds(dom, 'seed-done'), 'ai-request');
    const id = ds(dom, 'ai-request-id');
    assert.ok(id && id.startsWith('req-'), '요청 id 발급');
    assert.equal(ds(dom, 'ai-marker-set'), 'true', '대상 블록 data-ai-req 스탬프');
    assert.equal(ds(dom, 'ai-server-status'), 'pending');
    assert.equal((await bridge.listPending()).length, 1, '브리지 큐에 요청 잔존(구독 AI 가 pending 으로 수신)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E5 시드: 제외 타입(standard-label) 가드 — 버튼 disabled·요청 차단', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, bridge } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=ai-guard`);
    assert.equal(ds(dom, 'ai-guard-blocked'), 'true', '클라이언트 가드 거부');
    assert.equal(ds(dom, 'ai-guard-button-disabled'), 'true', '커서 위치 기반 버튼 비활성');
    assert.equal((await bridge.listPending()).length, 0, '요청 미생성(§7·§10 보존)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('E5 시드: 응답 폴링→DOMParser 정제→적용→저장 왕복(XSS·마커 무오염 포함)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url, base, bridge } = await startEditServer();
  try {
    // 모의 구독 AI: 요청을 서버 API 로 만들고(id 확보) 응답 파일을 기록(ai respond 동형)
    const create = await fetch(`${url}/ai/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', block: { bt: 'subq', html: '<p class="subq">원문</p>' } }),
    });
    const { id } = await create.json();
    await bridge.putResponse({
      schemaVersion: AI_SCHEMA_VERSION, id,
      html: '<p class="subq"><span class="qnum">1</span>AI 가 재작성한 발문입니다.</p>'
        + '<script>window.hacked=1</script><img src="x" onerror="window.hacked=2">',
    });

    const dom = await dumpDom(`${url}/?seed=ai-apply&req=${id}`);
    assert.equal(ds(dom, 'ai-applied'), 'true', '폴링→적용→저장 왕복');
    assert.equal(ds(dom, 'ai-xss-clean'), 'true', 'DOMParser 정제 — script·onerror 미주입');
    assert.equal(ds(dom, 'ai-marker-clean'), 'true', '적용 후 data-ai-req 무잔존');
    assert.equal(ds(dom, 'saved-unsafe'), 'false');

    const manifest = JSON.parse(await readFile(join(base, '문서', 'worksheet.manifest.json'), 'utf8'));
    const flat = manifest.pages.flat().map((b) => b.html ?? '').join('\n');
    assert.ok(flat.includes('AI 가 재작성한 발문입니다'), '저장 manifest 에 AI 재작성 반영');
    assert.ok(!/(data-ai-req|<script|onerror=)/.test(flat), '산출 manifest 무오염');
    assert.equal(await bridge.getStatus(id), null, 'applied 후 prune(스테일 없음)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
