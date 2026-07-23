import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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

// US-E3 실물 검증(실 Chrome, testSeed 게이트 서버): 도형 레이어.
// 배치 모델이 "블록 앵커 + 상대 오프셋"이라는 점을 실제로 단정한다 — 도형이 커서 블록
// 안에 들어가고, 서식이 계산 스타일로 반영되고, 드래그가 1:1 이고(좌표계 혼용 회귀 방어),
// 저장 왕복에서 manifest·student 양쪽에 살아남는다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  // 생성한 쪽이 지운다 — 안 지우면 스위트 반복 실행에 임시 폴더가 수천 개 쌓여
  // 디스크가 차고 렌더 테스트가 통째로 멎는다(실측 7,000개).
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-shape-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=20000',
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-shape-render-'));
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

test('US-E3: 도형이 커서 블록에 앵커되고 서식이 실제 렌더에 반영된다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=shapes`);
    assert.equal(ds(dom, 'seed-done'), 'shapes');
    assert.equal(ds(dom, 'shape-kind'), 'circle', '선택한 종류로 삽입');
    assert.equal(ds(dom, 'shape-anchored'), 'true', '.wg-shape-layer 가 .wg-block 의 자식(블록 앵커)');
    assert.equal(ds(dom, 'shape-in-cursor-block'), 'true', '커서가 있던 블록에 들어간다');
    // 인라인 문자열이 아니라 계산 스타일 — CSS 변수 배선이 실제로 먹는지 확인
    assert.equal(ds(dom, 'shape-stroke'), 'rgb(209, 73, 91)', '선 색이 렌더에 반영');
    assert.equal(ds(dom, 'shape-dash'), '6px, 4px', '선 종류(파선)가 렌더에 반영');
    assert.ok(Math.abs(Number(ds(dom, 'shape-width-px')) - 151) <= 2,
      `가로 40mm = 151px(±2) 실측 ${ds(dom, 'shape-width-px')}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E3: 도형 변경이 되돌려지고 드래그가 1:1 이다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=shapes`);
    assert.equal(ds(dom, 'seed-done'), 'shapes');
    // 되돌리기는 명령 1단위 — 폭만 취소되고 선 색은 남는다
    assert.equal(ds(dom, 'shape-undo-width'), '24mm', '되돌리기로 폭 원복');
    assert.equal(ds(dom, 'shape-undo-stroke'), 'rgb(209, 73, 91)', '앞선 서식 변경은 유지(단계 분리)');
    // 좌표계 혼용 회귀 방어: iframe(pointerdown)과 부모(pointermove)의 client 원점이 달라
    // 섞으면 잡는 순간 iframe 오프셋만큼 튀었다(실측 left 8mm → 265mm).
    assert.equal(ds(dom, 'shape-drag-delta-mm'), ds(dom, 'shape-drag-expect-mm'),
      `드래그 이동량이 포인터 이동량과 일치(실측 ${ds(dom, 'shape-drag-delta-mm')}mm / 기대 ${ds(dom, 'shape-drag-expect-mm')}mm)`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E3: 저장 왕복에서 도형이 manifest·student·PDF 에 살아남는다', { skip: !HAS_CHROME, timeout: 180000 }, async () => {
  const { server, url, base } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=shapes`);
    assert.equal(ds(dom, 'shape-saved'), 'true', '저장 성공');
    assert.equal(ds(dom, 'shape-in-manifest'), 'true', 'manifest 에 도형 마크업 편입');
    assert.equal(ds(dom, 'shape-in-student'), 'true', 'student 파생에도 도형 유지(정답이 아니므로 제거 대상 아님)');

    // 워크스페이스 산출물에도 실려야 인쇄까지 간다
    const teacher = await readFile(join(base, '문서', 'worksheet-teacher.html'), 'utf8');
    const student = await readFile(join(base, '문서', 'worksheet-student.html'), 'utf8');
    for (const [name, html] of [['teacher', teacher], ['student', student]]) {
      assert.match(html, /class="wg-shape"/, `${name}.html 에 도형`);
      assert.match(html, /\.wg-shape-layer\s*\{/, `${name}.html 에 도형 CSS(blocks.css 경유 — 없으면 인쇄에서 사라진다)`);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});
