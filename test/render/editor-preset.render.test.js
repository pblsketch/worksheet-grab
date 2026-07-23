import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { makeTmpDir, makeTmpDirSync } from '../helpers/tmp.js';

// US-20(S4.5) 재작성 — E4 사용자 프리셋("내 블록") 실물 검증, 개체 모델.
// 우클릭 "내 블록으로 저장"(canvasInline.js) → GET /presets 등재(편집 아티팩트 정제 포함) →
// 좌 3탭 "내 블록"에서 삽입 → 저장 시 manifest 반영. 서버 계약(PresetLibrary/FsPresetRepository)
// 은 무변경 — 클라이언트 진입점만 새 UI 셸(우클릭 메뉴 + 좌 탭)로 재배선됐다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-preset-chrome-');
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
    docTitle: 'E4 내 블록 테스트',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [{ id: 'r1', type: 'richtext', placement: 'flow', html: '<p>프리셋 원본 문단</p>' }],
      float: [],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-preset-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('E4: 우클릭 "내 블록으로 저장" → 라이브러리 등장(정제 포함) → 삽입 → 저장 시 manifest 반영',
  { skip: !HAS_CHROME, timeout: 60000 }, async () => {
    const { server, url, ws } = await startEditServer();
    try {
      const dom = await dumpDom(`${url}/?seed=preset-workflow`);
      assert.equal(ds(dom, 'seed-done'), 'preset-workflow');
      assert.equal(ds(dom, 'preset-saved'), 'true', '저장 직후 GET /presets 목록에 등장');
      assert.equal(ds(dom, 'preset-clean'), 'true', 'contenteditable·data-oid 편집 아티팩트 부재');
      assert.equal(ds(dom, 'preset-inserted'), 'true', '내 블록 탭 삽입이 개체 트리에 반영');
      assert.equal(ds(dom, 'preset-save-doc-ok'), 'true');

      // GET /presets 는 빌트인 예시 + 사용자 저장분을 함께 낸다(PresetLibrary.list) — 사용자
      // 저장분(source:'user')만 걸러 확인한다.
      const presetsRes = await fetch(`${url}/presets`);
      const presetsBody = await presetsRes.json();
      const userPresets = (presetsBody.presets || []).filter((p) => p.source === 'user');
      assert.equal(userPresets.length, 1, '사용자 저장 프리셋 1건');
      assert.match(userPresets[0].html, /프리셋 원본 문단/, '원본 텍스트 보존');

      const manifest = JSON.parse(await readFile(join(ws.dir, '문서', 'worksheet.manifest.json'), 'utf8'));
      const inserted = manifest.pages[0].flow.filter((o) => o.type === 'richtext');
      assert.ok(inserted.some((o) => o.html.includes('프리셋 원본 문단')), '삽입된 프리셋 블록이 manifest 에 반영');
      assert.ok(inserted.length >= 2, '원본 + 삽입본 2개 이상');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });
