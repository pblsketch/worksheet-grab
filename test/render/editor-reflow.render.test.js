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

// US-17(S4.2, M4a) — 편집기 내장 브라우저 paginator 실측(06_plan_final.md 217~221행, 과제 지시
// §목표 1~4). editor.js:runSeed('reflow-grow') 가 실 DOM 이벤트(dblclick/innerHTML 편집/input)로
// richtext 개체를 크게 키워 넘침을 유발 → 트리 pages[] 귀속이 실제로 바뀌는지(다음 페이지 이동),
// 다시 줄여 앞 페이지로 당겨지는지(삭제와 동형 효과), float 좌표는 불변인지, 표는 분할되지
// 않는지, 저장 후 /shell.json 재조회로 paginated 경계가 유지되는지를 단정한다.
//
// 직렬 1파일 단독 실행 전제(MEMORY: 렌더 테스트는 직렬만 신뢰 — Chrome 동시 1개, wsg-* 정리).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 90000, windowSize = '1280,1600') {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-reflow-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=60000',
    ...(windowSize ? [`--window-size=${windowSize}`] : []),
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
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-1200)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

/** ValidateObjectTree/RenderObjectTree 스키마를 만족하는 리플로우 픽스처 — 한 페이지에 다 들어가는
 *  분량으로 시작해(title·짧은 richtext 2개·작은 표·float), rt-grow 만 키우면 넘치도록 구성한다. */
function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'S4.2 리플로우 테스트',
    subject: 'korean',
    dataSubject: 'korean',
    themeName: 'ko',
    lang: 'ko',
    paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '리플로우 테스트 제목' },
        { id: 'rt-grow', type: 'richtext', placement: 'flow', html: '<p>짧은 문단(성장 전)</p>' },
        { id: 'rt-after', type: 'richtext', placement: 'flow', html: '<p>뒤따르는 문단 — 넘침 시 다음 페이지로 밀려야 함</p>' },
        {
          id: 'tbl1', type: 'table', placement: 'flow', splittable: false,
          rows: [[{ text: 'a' }, { text: 'b' }], [{ text: 'c' }, { text: 'd' }], [{ text: 'e' }, { text: 'f' }]],
        },
      ],
      float: [
        { id: 'f1', type: 'answer-area', placement: 'float', style: 'box', label: '메모', rect: { xMm: 100, yMm: 230, wMm: 50, hMm: 25 } },
      ],
    }],
  };
}

async function startEditServer(docName) {
  const base = await mkdtemp(join(tmpdir(), 'wsg-reflow-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: docName, document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName, workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, workspace };
}

test('S4.2 편집기 리플로우: 개체 성장→넘침 이동, 축소→앞 페이지 복귀, float 불변, 표 미분할', { skip: !HAS_CHROME, timeout: 150000 }, async () => {
  const docName = '리플로우문서';
  const { server, url } = await startEditServer(docName);
  try {
    const dom = await dumpDom(`${url}/?seed=reflow-grow`);
    assert.equal(ds(dom, 'seed-done'), 'reflow-grow', '시드 스크립트가 끝까지 실행됨');
    assert.equal(ds(dom, 'ready'), 'true');

    // 성장 전: 전부 한 페이지(page 0)에 들어가야 픽스처 설계 전제가 성립.
    assert.equal(ds(dom, 'rg-page-count-before'), '1', '성장 전에는 전부 1페이지에 들어감(픽스처 전제)');
    assert.equal(ds(dom, 'rg-grow-page-before'), '0');
    assert.equal(ds(dom, 'rg-after-page-before'), '0');
    assert.equal(ds(dom, 'rg-table-page-before'), '0');
    assert.equal(ds(dom, 'rg-float-page-before'), '0');

    // 성장 후: 페이지 수 증가 + rt-after(및 표)가 다음 페이지로 이동(넘침 자동 이동, 과제 지시 §목표 1).
    const pageCountAfterGrow = Number(ds(dom, 'rg-page-count-after-grow'));
    assert.ok(pageCountAfterGrow >= 2, `리플로우 후 페이지 수가 늘어야 함(실측 ${pageCountAfterGrow})`);
    const afterPageAfterGrow = Number(ds(dom, 'rg-after-page-after-grow'));
    assert.ok(afterPageAfterGrow > 0, 'rt-after 가 넘침으로 다음 페이지로 이동해야 함');
    const tablePageAfterGrow = Number(ds(dom, 'rg-table-page-after-grow'));
    assert.ok(tablePageAfterGrow > 0, '표도 넘침으로 다음 페이지로 이동해야 함(통째 이동)');

    // float 은 리플로우에서 제외 — 좌표 불변, 페이지 귀속도 원래 페이지가 살아있는 한 그대로.
    assert.equal(ds(dom, 'rg-float-rect-unchanged-after-grow'), 'true', '리플로우 후에도 float rect(좌표) 는 불변이어야 함');
    assert.equal(ds(dom, 'rg-float-page-after-grow'), '0', '원래 페이지(0)가 여전히 존재하므로 float 귀속도 그대로 유지되어야 함');

    // 표 미분할: 행 수는 원본 그대로(분할 없음, R7).
    assert.equal(ds(dom, 'rg-table-rows-after-grow'), '3', '표는 분할 없이 원본 행 수(3) 그대로 유지되어야 함');

    // 축소(=삭제와 동형 효과): rt-after 가 다시 원래 페이지(0)로 당겨져야 함.
    const pageCountAfterShrink = Number(ds(dom, 'rg-page-count-after-shrink'));
    assert.equal(ds(dom, 'rg-after-page-after-shrink'), '0', '축소 후 rt-after 가 원래 페이지로 당겨져야 함(삭제와 동형 효과)');
    assert.equal(ds(dom, 'rg-table-page-after-shrink'), '0', '축소 후 표도 원래 페이지로 당겨져야 함');
    assert.ok(pageCountAfterShrink <= pageCountAfterGrow, '축소 후 페이지 수가 늘어난 상태로 남아있으면 안 됨');
    assert.equal(ds(dom, 'rg-float-rect-unchanged-after-shrink'), 'true', '축소 후에도 float rect 는 불변이어야 함');
    assert.equal(ds(dom, 'rg-table-rows-after-shrink'), '3', '축소 후에도 표 행 수는 원본(3) 그대로');
    assert.equal(ds(dom, 'rg-table-rows-original'), '3');

    // 체크포인트 저장 — rev 증가(디스크 접촉은 이 호출뿐, S2.4 계약 무회귀).
    assert.equal(ds(dom, 'rg-rev-before-save'), '1');
    assert.equal(ds(dom, 'rg-rev-after-save'), '2');
    assert.equal(ds(dom, 'rg-save-ok'), 'true');

    // 저장 후 /shell.json 재조회 — paginated 경계(1페이지, rt-after 가 page 0)가 유지되어야 한다
    // (과제 지시 §산출 2 "저장 후 /shell.json 재조회 시 paginated 경계 유지").
    const shellRes = await fetch(`${url}/shell.json`);
    const shell = await shellRes.json();
    assert.equal(shell.document.pagination, 'paginated');
    assert.equal(shell.document.pages.length, 1, '저장된 문서의 페이지 경계가 축소 후 리플로우 결과(1페이지)로 영속되어야 함');
    const growObj = shell.document.pages[0].flow.find((o) => o.id === 'rt-grow');
    assert.ok(growObj, '축소된 rt-grow 개체가 page 0 에 존재해야 함');
    assert.ok(growObj.html.includes('다시 짧아진'), '저장본에 축소된 텍스트가 반영되어야 함');
    const savedFloat = shell.document.pages[0].float.find((o) => o.id === 'f1');
    assert.equal(savedFloat.rect.xMm, 100, '저장본에서도 float 좌표가 원본과 동일해야 함(불변)');
    assert.equal(savedFloat.rect.yMm, 230);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
