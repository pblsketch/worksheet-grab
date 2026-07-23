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

// US-E1 실물 검증(실 Chrome, testSeed 게이트 서버): 좌측 페이지 썸네일 패널.
// 썸네일은 iframe 을 transform 으로 축소한 것이라 "그려졌는가"가 아니라
// "쪽 수와 일치하는가 · 클릭이 그 쪽으로 옮기는가 · 편집이 반영되는가"를 단정한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000, windowSize = null) {
  const chrome = resolveChromePath(null);
  // 생성한 쪽이 지운다 — 안 지우면 스위트 반복 실행에 임시 폴더가 수천 개 쌓여
  // 디스크가 차고 렌더 테스트가 통째로 멎는다(실측 7,000개).
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-thumb-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=20000',
    // 창 크기를 안 주면 헤드리스 기본이 800×600 이라 좌우 패널(176+264)을 빼면 캔버스가
    // 360px — A4 794px 가 당연히 안 들어간다. 3단 배치 판정은 실제 데스크톱 폭에서 해야 한다.
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-thumb-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const manifest = await blockRepository.readManifest('sci');
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .execute({ name: '문서', manifest, now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('US-E1: 썸네일 개수·번호가 쪽 수와 일치하고 클릭이 그 쪽으로 이동한다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=thumbs`);
    assert.equal(ds(dom, 'seed-done'), 'thumbs');

    const sheets = Number(ds(dom, 'thumb-sheets'));
    assert.ok(sheets >= 2, `다쪽 문서여야 이동을 검증할 수 있다(쪽 ${sheets})`);
    assert.equal(Number(ds(dom, 'thumb-count')), sheets, '썸네일 수 = .sheet 수');
    assert.equal(ds(dom, 'thumb-labels'), Array.from({ length: sheets }, (_, i) => i + 1).join(','),
      '썸네일에 1..N 쪽 번호 표시');

    // 마지막 쪽 클릭 → 캔버스가 실제로 내려가고 그 쪽이 활성
    assert.equal(ds(dom, 'thumb-scrollable'), 'true', '다쪽 문서라 캔버스가 스크롤 가능해야 이동을 볼 수 있다');
    assert.ok(Number(ds(dom, 'thumb-jump-scroll')) > 100,
      `클릭 후 캔버스가 스크롤됨(scrollTop ${ds(dom, 'thumb-jump-scroll')})`);
    assert.equal(ds(dom, 'thumb-jump-active'), String(sheets - 1), '이동한 쪽이 활성');
    // 맨 위로 되돌리면 1쪽이 활성(스크롤 동기화)
    assert.equal(ds(dom, 'thumb-top-active'), '0', '스크롤 상단 = 1쪽 활성');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E1: 편집한 쪽의 썸네일만 갱신된다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=thumbs`);
    assert.equal(ds(dom, 'seed-done'), 'thumbs');
    assert.equal(ds(dom, 'thumb-edit-synced'), 'true', '편집 내용이 해당 쪽 썸네일에 반영');
    assert.equal(ds(dom, 'thumb-other-page-untouched'), 'true', '안 건드린 쪽은 재렌더하지 않음(시트 단위 diff)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E1: 학생용 전환 시 썸네일도 학생용 문서가 된다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=thumbs-student`);
    assert.equal(ds(dom, 'seed-done'), 'thumbs-student');
    assert.equal(ds(dom, 'thumb-student-mode'), 'true', '썸네일 srcdoc 이 data-mode="student"');
    assert.ok(Number(ds(dom, 'thumb-student-count')) >= 2, '학생용에서도 쪽 수만큼 썸네일 유지');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E2: 3단 배치 치수 · 선택 반응 인스펙터 · 좌측 탭 · 접기', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=inspector`, 60000, '1920,1080');
    assert.equal(ds(dom, 'seed-done'), 'inspector');

    // 3단 그리드 + A4 가 가로 스크롤 없이 들어간다
    assert.match(ds(dom, 'insp-cols'), /^\d+(\.\d+)?px \d+(\.\d+)?px \d+(\.\d+)?px$/, `3단 그리드(${ds(dom, 'insp-cols')})`);
    assert.equal(ds(dom, 'insp-no-hscroll'), 'true', '캔버스 가로 스크롤 없음');
    assert.ok(Number(ds(dom, 'insp-canvas-w')) > Number(ds(dom, 'insp-sheet-w')),
      `캔버스(${ds(dom, 'insp-canvas-w')}px)가 A4(${ds(dom, 'insp-sheet-w')}px)보다 넓다`);

    // 선택에 반응해 섹션이 바뀐다
    assert.equal(ds(dom, 'insp-default'), 'document', '기본은 문서 섹션');
    // 셀 단위로 잡는다(표가 아니라). 셀 배경을 따로 칠할 수 있어야 하고, 표 전체는
    // Esc 로 한 겹 올라가서 잡는다 — 개체 편집 도입 때 의도적으로 세분한 동작이다.
    assert.equal(ds(dom, 'insp-table'), 'cell', '표 안에 커서 → 셀 섹션');
    assert.equal(ds(dom, 'insp-back'), 'document', '표 밖으로 나가면 문서 섹션 복귀');
    assert.equal(ds(dom, 'insp-image'), 'image', '이미지 선택 → 이미지 섹션');

    // 프리셋은 좌측 탭 — 캔버스를 덮지 않는다
    assert.equal(ds(dom, 'insp-left-tab'), 'presets', '프리셋 탭 활성');
    assert.ok(Number(ds(dom, 'insp-preset-items')) > 0, '프리셋 목록이 탭 안에 렌더');
    assert.equal(ds(dom, 'insp-canvas-with-presets'), ds(dom, 'insp-canvas-w'),
      '프리셋을 열어도 캔버스 폭이 그대로(오버레이가 덮지 않음)');

    // 접기 → 캔버스가 넓어지고, 펼치면 되돌아온다
    assert.equal(ds(dom, 'insp-collapsed-grew'), 'true',
      `접으면 캔버스가 넓어짐(${ds(dom, 'insp-canvas-w')} → ${ds(dom, 'insp-collapsed-w')})`);
    assert.equal(ds(dom, 'insp-restored-w'), ds(dom, 'insp-canvas-w'), '펼치면 원래 폭 복귀');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
