import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

// US-20(S4.5) §산출 3 — 마이그레이션 UX 종단(A1 지연 마이그레이션).
//
// worksheets/데모활동지(구 HTML manifest 픽스처, entry.html 전량 인라인 — 실사용 문서) 를
// 복사해 새 워크스페이스에 심는다 → 에디터로 열기(GET /shell.json 이 지연 마이그레이션으로
// 개체 트리 승격, 원본은 읽기 전용 보존) → 승격된 제목 개체를 실제로 편집 → 저장(checkpoint,
// 새 스키마 커밋) → 재조회(paginated 경계 유지) → 라운드트립 무손실(성취기준 원문·편집한
// 텍스트 모두 보존)을 실 Chrome 으로 단정한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_MANIFEST = resolve(ROOT, 'worksheets', '데모활동지', 'worksheet.manifest.json');
const HAS_CHROME = chromeAvailable();
// worksheets/ 는 .gitignore 대상(로컬 실 교사 문서)이라 새 클론·CI 에는 없다. 없을 때 ENOENT 로
// **실패**하면 "코드가 깨졌다"로 오독된다 — Chrome 부재와 같은 층위의 환경 조건이므로 skip 한다.
// 합성 픽스처로 대체하지 않는 이유는 이 테스트가 '실사용 구 manifest' 의 승격을 보는 것이기 때문이다.
const HAS_FIXTURE = existsSync(FIXTURE_MANIFEST);
const SKIP_REASON = !HAS_CHROME ? 'Chrome 없음'
  : !HAS_FIXTURE ? '로컬 실문서 없음: worksheets/데모활동지 (.gitignore 대상)' : false;

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-migration-chrome-');
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

test('마이그레이션 UX 종단: 구 HTML manifest 열기(지연 마이그레이션)→편집→저장→재열기 무손실 왕복',
  { skip: SKIP_REASON, timeout: 90000 }, async () => {
    const legacyManifest = JSON.parse(await readFile(FIXTURE_MANIFEST, 'utf8'));
    assert.equal(legacyManifest.pagination, undefined, '픽스처 전제: 구 HTML manifest(pagination 필드 없음)');
    const standardText = legacyManifest.standardsText['[9과14-02]'];

    const ws = await makeTmpDir('wsg-migration-render-');
    const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
    const blockRepository = new FsBlockRepository({ root: ROOT });
    await new SaveDocument({ workspace, blockRepository, curriculum: null })
      .execute({ name: '마이그레이션문서', manifest: legacyManifest, now: new Date('2026-07-23T00:00:00.000Z') });

    const server = createEditorServer({
      root: ROOT, docName: '마이그레이션문서', workspace, blockRepository, curriculum: null, testSeed: true,
    });
    const addr = await listenEditorServer(server);
    const url = `http://127.0.0.1:${addr.port}`;
    try {
      // 열기(GET /shell.json) — 지연 마이그레이션, 원본은 읽기 전용 보존.
      const shellBefore = await (await fetch(`${url}/shell.json`)).json();
      assert.equal(shellBefore.migrated, true, '구 HTML manifest 문서는 열 때 개체 트리로 승격 서빙');
      assert.equal(shellBefore.document.pagination, 'paginated');
      const onDiskBefore = await workspace.readManifest('마이그레이션문서');
      assert.equal(onDiskBefore.pagination, undefined, '읽기만으로는 디스크 원본이 아직 마이그레이션되지 않는다(비파괴)');

      // 편집(실 Chrome, mig-0-0 = 첫 페이지 첫 엔트리인 header → title 로 승격된 개체)→저장.
      const dom = await dumpDom(`${url}/?seed=migration-edit`);
      assert.equal(ds(dom, 'seed-done'), 'migration-edit');
      assert.equal(ds(dom, 'migrated-flag'), 'true');
      assert.equal(ds(dom, 'saved-ok'), 'true');
      assert.equal(ds(dom, 'saved-pagination'), 'paginated');

      // 재열기 — 첫 저장에서 새 스키마 커밋(paginated 경계 유지), 원본 manifest 는 이제 대체됨.
      const shellAfter = await (await fetch(`${url}/shell.json`)).json();
      assert.equal(shellAfter.migrated, false, '이미 개체 트리로 커밋된 문서는 재열기 시 마이그레이션 재실행 없음');
      assert.equal(shellAfter.document.pagination, 'paginated', 'paginated 경계 유지');
      const editedTitle = shellAfter.document.pages[0].flow.find((o) => o.id === 'mig-0-0');
      assert.equal(editedTitle.text, '편집된 제목(마이그레이션 후)', '편집한 텍스트가 저장·재조회에 왕복');

      // 무손실 검증: 성취기준 원문(std-box)·나머지 원본 개체들의 텍스트가 전부 살아있다(A1 무손실).
      assert.ok(shellAfter.teacherHtml.includes(standardText), '성취기준 원문이 마이그레이션·편집 후에도 보존');
      const onDiskAfter = await workspace.readManifest('마이그레이션문서');
      assert.equal(onDiskAfter.pagination, 'paginated', '디스크 원본이 첫 저장에서 새 스키마로 승격 커밋');
      assert.ok(Array.isArray(onDiskAfter.pages[0].flow), '디스크 원본이 개체 트리 구조로 교체됨');
    } finally {
      await new Promise((r) => server.close(r));
      ws.cleanup();
    }
  });
