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

// 개체 편집 실물 검증(실 Chrome, testSeed 게이트 서버).
//
// 배경: "AI 초안에서 텍스트만 고칠 수 있고 표·그림·선은 못 고친다"가 이 제품의 핵심
// 불만이었다. 원인은 편집 엔진이 아니라 개체를 선택할 수단이 없던 것이고, 여기서
// 그 선택·편집·구조 조작이 실제로 동작하는지를 단정한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  // 생성한 쪽이 지운다 — 안 지우면 스위트 반복 실행에 임시 폴더가 수천 개 쌓여
  // 디스크가 차고 렌더 테스트가 통째로 멎는다(실측 7,000개).
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-obj-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, '--virtual-time-budget=20000', '--window-size=1920,1080',
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
  const base = await mkdtemp(join(tmpdir(), 'wsg-obj-render-'));
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

test('개체 선택: 표·그림·상자가 클릭으로 잡히고 Esc 로 바깥까지 닿는다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=objects`);
    assert.equal(ds(dom, 'seed-done'), 'objects');
    assert.equal(ds(dom, 'obj-table'), 'cell', '표 셀 선택');
    assert.equal(ds(dom, 'obj-svg'), 'svg', '그림 선택');
    assert.equal(ds(dom, 'obj-box'), 'box', '테두리 상자 선택');
    // 표를 골랐으면 표를 다룰 조작이 떠야 한다(빈 패널이면 고른 의미가 없다).
    const labels = ds(dom, 'obj-table-labels') ?? '';
    for (const need of ['선 색', '선 두께', '선 종류']) {
      assert.ok(labels.includes(need), `표 인스펙터에 "${need}" (실제: ${labels})`);
    }
    // Esc 사다리 — 안쪽에서 바깥으로 올라간다. 없으면 감싼 상자에 닿을 방법이 없다.
    const ladder = ds(dom, 'obj-esc-ladder') ?? '';
    const [inner, outer] = ladder.split('→');
    assert.ok(inner && outer && inner !== outer, `Esc 로 다른(바깥) 개체로 이동: ${ladder}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('개체 편집: 표·그림·밑줄 서식이 실제 렌더에 반영되고 되돌려진다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=object-edit`);
    assert.equal(ds(dom, 'seed-done'), 'object-edit');
    assert.equal(ds(dom, 'obj-table-border'), 'rgb(192, 57, 43)|3px', '표 테두리가 계산 스타일에 반영');
    assert.equal(ds(dom, 'obj-svg-stroke'), 'rgb(26, 127, 55)', '그림 선 색이 내부 요소에 반영');
    // 한 변만 그려진 밑줄에 사면 테두리를 두르면 밑줄이 상자로 변한다 — 그 변만 건드려야 한다.
    assert.equal(ds(dom, 'obj-line-bottom'), 'rgb(37, 99, 235)', '밑줄 색 변경');
    assert.equal(ds(dom, 'obj-line-top-style'), 'none', '윗변은 그대로 없음(밑줄이 상자로 변하지 않음)');
    assert.equal(ds(dom, 'obj-line-undone'), 'true', 'Ctrl+Z 로 되돌아감');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('자유 배치 텍스트 상자: 선택·스타일 왕복·편집 토글·빈 상자 자동삭제·저장 왕복', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=textbox`);
    assert.equal(ds(dom, 'seed-done'), 'textbox');

    // 삽입한 상자가 클릭 분류에서 textbox 로 잡히고 인스펙터가 그에 반응한다.
    assert.equal(ds(dom, 'tb-kind'), 'textbox', '텍스트 상자로 선택됨');
    assert.equal(ds(dom, 'tb-inspector'), '텍스트 상자', '인스펙터가 텍스트 상자 섹션');
    assert.equal(ds(dom, 'tb-movable'), 'true', '이동 가능 개체로 등록');

    // 위치(mm)·폭·글자 크기(pt)·색·정렬이 그대로 읽힌다.
    assert.equal(ds(dom, 'tb-style'), '33.3|12.7|60|14|#c0392b|center', '스타일 round-trip');

    // 편집 모드에서만 안쪽이 contenteditable=true 가 된다.
    assert.equal(ds(dom, 'tb-edit-on'), 'true', '편집 진입 시 캐럿 허용');
    assert.equal(ds(dom, 'tb-editing'), '1', '편집 상태 플래그');
    assert.equal(ds(dom, 'tb-edit-off'), 'false', '편집 종료 시 개체 모드로');
    assert.equal(ds(dom, 'tb-kept-non-empty'), 'true', '내용 있는 상자는 종료해도 남는다');

    // 빈 상자는 편집을 닫으면 통째로 사라진다(슬라이드 관례).
    assert.equal(ds(dom, 'tb-empty-removed'), 'true', '빈 상자 자동 삭제');

    // 저장 직렬화: 상자는 실리고, 편집 세션 표식(contenteditable/draggable)은 빠진다.
    assert.equal(ds(dom, 'tb-serialized-has-box'), 'true', '저장본에 상자 포함');
    assert.equal(ds(dom, 'tb-serialized-clean'), 'true', '편집 아티팩트 제거');
    assert.equal(ds(dom, 'tb-serialized-text'), 'true', '입력 텍스트 보존');
    assert.equal(ds(dom, 'tb-in-student'), 'true', '학생용 파생에도 상자 생존(인쇄 도달)');

    // AI 초안 텍스트 → 자유 이동 상자 변환(promote-on-demand): 새 상자 생성·텍스트 이관·원본 제거·선택.
    assert.equal(ds(dom, 'tb-promoted-new-box'), 'true', '변환으로 새 상자 1개 생성');
    assert.equal(ds(dom, 'tb-promoted-text'), 'true', '원본 텍스트가 상자로 이관됨');
    assert.equal(ds(dom, 'tb-promoted-orig-gone'), 'true', '원본 문단은 흐름에서 제거됨');
    assert.equal(ds(dom, 'tb-promoted-kind'), 'textbox', '변환 직후 그 상자가 선택됨');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('표 구조 편집: 머리 중복·폭 붕괴·무반응 조작이 재발하지 않는다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=table-ops`);
    assert.equal(ds(dom, 'seed-done'), 'table-ops');

    // A: 머리행에서 행을 추가해도 머리는 하나 — 예전엔 th 행이 복제돼 머리가 여러 개였다.
    assert.equal(ds(dom, 'tbl-header-rows'), '1', '머리행은 하나만');
    const shape = ds(dom, 'tbl-shape') ?? '';
    assert.ok(/^THTHTH\//.test(shape), `첫 행만 th (실제: ${shape})`);
    assert.ok(!shape.split('/').slice(1).some((r) => r.includes('TH')), `새 행은 전부 td (실제: ${shape})`);

    // B: 열을 늘려도 폭 합은 100% — 예전엔 th 의 width:34% 가 복제돼 168% 가 됐다.
    assert.equal(ds(dom, 'tbl-width-sum'), '100', '열 추가 후 폭 합 100%');

    // D: .vartable 은 th 가 없고 첫 열이 머리 — 머리 배경이 첫 열에만 걸려야 한다.
    assert.equal(ds(dom, 'tbl-var-header-row'), 'false', 'vartable 은 머리행 없음');
    assert.equal(ds(dom, 'tbl-var-header-col'), 'true', 'vartable 은 첫 열이 머리');
    assert.equal(ds(dom, 'tbl-var-col1'), 'rgb(255, 232, 179)', '머리열에 배경 적용');
    assert.equal(ds(dom, 'tbl-var-col2'), 'rgba(0, 0, 0, 0)', '나머지 열은 그대로');

    // E: 데이터 행이 하나 남으면 거부 — 조용히 무시하면 사용자는 버그로 읽는다.
    assert.equal(ds(dom, 'tbl-delete-refused'), 'true', '마지막 데이터 행 삭제는 거부');
    assert.ok(Number(ds(dom, 'tbl-rows-left')) >= 2, `머리행 + 데이터 1행은 남는다(실제 ${ds(dom, 'tbl-rows-left')})`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('눈금자·격자·중앙 스냅 + 여백선을 꺼도 선택 핸들은 남는다', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=rulers`);
    assert.equal(ds(dom, 'seed-done'), 'rulers');

    const sheets = Number(ds(dom, 'rul-sheets'));
    assert.equal(Number(ds(dom, 'rul-rulers')), sheets * 2, '쪽마다 가로·세로 자');
    assert.ok(Number(ds(dom, 'rul-ticks')) > 50, `눈금이 실제로 그려짐(${ds(dom, 'rul-ticks')}개)`);
    assert.equal(Number(ds(dom, 'rul-grid')), sheets, '쪽마다 격자');

    // 회귀: 여백선 버튼이 오버레이를 통째로 숨겨서 끄면 선택 핸들까지 사라졌다.
    assert.equal(ds(dom, 'rul-margin-guides'), '0', '여백선 OFF 면 여백선은 사라진다');
    assert.equal(ds(dom, 'rul-handles-after-off'), ds(dom, 'rul-handles-on'),
      '여백선을 꺼도 선택 핸들은 그대로');

    // 중앙 스냅: 중심 근처에서 놓으면 정확히 중앙에 붙고 안내선은 사라진다.
    assert.ok((ds(dom, 'rul-snap-guides') ?? '').includes('x'), '드래그 중 세로 중앙 안내선 표시');
    assert.ok(Number(ds(dom, 'rul-snap-off-px')) <= 1.5,
      `놓으면 중앙에 붙는다(중심 오차 ${ds(dom, 'rul-snap-off-px')}px)`);
    assert.equal(ds(dom, 'rul-guides-cleared'), 'true', '손을 떼면 안내선 정리');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
