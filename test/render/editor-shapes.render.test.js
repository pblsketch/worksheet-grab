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

// US-20(S4.5) 재작성 — US-E3 도형(shape) 개체 실물 검증.
//
// 구 테스트의 "블록 앵커 + 상대 오프셋" 배치 모델은 폐기됐다 — 신 모델은 도형을 float 개체
// (rect mm 절대좌표, 페이지 직속)로 표현한다(D-A). 배치 모델이 바뀌었을 뿐 "서식이 실제 렌더에
// 반영되고, 드래그가 1:1이고, 되돌리기 단계가 분리되고, 저장 왕복에서 살아남는다"는 검증 의도는
// 그대로 재현했다. 선 종류(파선 등 dash)는 신 스키마(TYPE_SPECS.shape: strokeColor·fillColor 만)
// 에 대응 필드가 없어 검증 대상에서 뺐다(기능 공백, us20.md 기록).
//
// 실 Chrome 렌더로 도형 strokeColor/fillColor 가 blocks.css `.wg-shape > *` 규칙에 항상
// 덮어써져(#333/none 고정) 반영되지 않는 버그를 발견해 RenderObjectTree.js 를 최소 수정했다
// (us20.md "발견한 버그" 참조) — 이 테스트가 그 회귀를 방어한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-shape-chrome-');
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
    docTitle: 'US-E3 도형 테스트',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [{ id: 't1', type: 'title', placement: 'flow', text: '제목' }],
      float: [{
        id: 'sh1', type: 'shape', placement: 'float', shapeKind: 'circle',
        strokeColor: '#d1495b', fillColor: '#ffffff', rect: { xMm: 60, yMm: 60, wMm: 40, hMm: 20 },
      }],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-shape-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('US-E3: 도형(float) 서식 변경이 실제 렌더에 반영되고 되돌리기 단계가 분리된다', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=shapes-workflow`);
    assert.equal(ds(dom, 'seed-done'), 'shapes-workflow');
    assert.equal(ds(dom, 'shape-kind'), 'circle');
    assert.ok(Math.abs(Number(ds(dom, 'shape-width-px')) - 151) <= 3, `가로 40mm ≈ 151px(±3) 실측 ${ds(dom, 'shape-width-px')}`);

    assert.equal(ds(dom, 'shape-stroke-after'), 'rgb(26, 127, 55)', '선 색 변경이 실제 렌더(computed style)에 반영');
    assert.equal(ds(dom, 'shape-fill-after'), 'rgb(253, 230, 138)', '채우기 변경도 반영');

    // 되돌리기 1회 = 마지막 커밋(채우기)만 취소, 이전 커밋(선 색)은 유지(단계 분리).
    assert.equal(ds(dom, 'shape-undo-fill'), 'rgb(255, 255, 255)', '되돌리기로 채우기 원복(원본 #ffffff)');
    assert.equal(ds(dom, 'shape-undo-stroke-kept'), 'rgb(26, 127, 55)', '선 색 변경은 유지(단계 분리)');

    // 드래그 1:1(좌표계 혼용 회귀 방어)
    assert.equal(ds(dom, 'shape-drag-delta-mm'), ds(dom, 'shape-drag-expect-mm'),
      `드래그 이동량이 포인터 이동량과 일치(실측 ${ds(dom, 'shape-drag-delta-mm')}mm / 기대 ${ds(dom, 'shape-drag-expect-mm')}mm)`);

    assert.equal(ds(dom, 'shape-saved'), 'true');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('US-E3: 저장 왕복에서 도형이 manifest·student·teacher HTML 에 살아남는다', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=shapes-workflow`);
    assert.equal(ds(dom, 'shape-saved'), 'true');

    // 시드는 선 색 변경→채우기 변경→되돌리기 1회(채우기만 취소) 순으로 끝난다 — 저장본은
    // 선 색 변경(유지)·채우기 원복(#ffffff) 상태여야 한다(위 테스트의 undo 단계 분리와 정합).
    const manifest = JSON.parse(await readFile(join(ws.dir, '문서', 'worksheet.manifest.json'), 'utf8'));
    const sh1 = manifest.pages[0].float.find((o) => o.id === 'sh1');
    assert.ok(sh1, '저장 manifest 에 도형 개체 존재(정답 아님 — 물리 제거 대상 아님)');
    assert.equal(sh1.strokeColor, '#1a7f37');
    assert.equal(sh1.fillColor, '#ffffff');

    const teacher = await readFile(join(ws.dir, '문서', 'worksheet-teacher.html'), 'utf8');
    const student = await readFile(join(ws.dir, '문서', 'worksheet-student.html'), 'utf8');
    for (const [name, html] of [['teacher', teacher], ['student', student]]) {
      assert.match(html, /class="wg-shape"/, `${name}.html 에 도형`);
      assert.match(html, /--wg-stroke:\s*#1a7f37/, `${name}.html 에 변경된 선 색 반영`);
    }
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});
