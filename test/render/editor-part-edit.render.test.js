import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { resolveChromePath } from '../../src/adapters/ChromeRenderer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir, makeTmpDirSync } from '../helpers/tmp.js';

// 2026-07-28 UX 배치 실물 검증(실 Chrome, editor-select.render.test.js 하네스와 동형).
//   #1  학습목표 문장·박스 제목을 **본문에서** 더블클릭 편집 / 근거 성취기준은 켤 때만 표시
//   #1b 제목 배지·모서리 표기, 지문 제목·출처도 같은 방식으로 본문 편집
//   #2  이미지 자리가 실제 박스(점선 테두리+아이콘)로 그려진다 — 맨 글자가 아니다
//   #3  지문 박스 테두리 색이 CSS 변수를 타고 실 렌더에 반영된다
//   #4  연결점이 가운데 뭉치지 않고 각자 항목 쪽 끝에 붙는다(실측 간격 비교)
//   #5  문항 항목(연결 쌍) 개수를 인스펙터에서 늘릴 수 있다
//
// 합성 이벤트로 충분한 부분과 실 렌더가 필요한 부분이 섞여 있어 한 시드로 묶었다 — 간격·높이·
// 계산된 테두리색은 **레이아웃이 실제로 서야** 잴 수 있어 단위 테스트로 대체할 수 없다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const profile = makeTmpDirSync('wsg-partedit-chrome-');
  const userDataDir = profile.dir;
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, '--virtual-time-budget=25000', '--window-size=1280,900',
    '--dump-dom', url,
  ];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); rejectPromise(new Error(`dump-dom 타임아웃: ${url}`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); profile.cleanup(); rejectPromise(e); });
    child.on('close', () => {
      clearTimeout(timer);
      profile.cleanup();
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
    docTitle: '부분 편집 UX 테스트',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      id: 'pg-1',
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '전기 회로', meta: { pill: '중1 · 2차시', page: 'p.24~27' } },
        {
          id: 's1', type: 'std-box', placement: 'flow', codes: ['9과15-01'],
          objectives: ['전류와 전압의 관계를 설명할 수 있다.', '옴의 법칙으로 저항을 구할 수 있다.'],
        },
        { id: 'p1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］', title: '지문 (가)', source: '중학교 과학 1' },
        { id: 'i1', type: 'image-slot', placement: 'flow' },
        {
          id: 'q1', type: 'question', placement: 'flow', qtype: 'matching', qnum: 1,
          prompt: '왼쪽과 알맞은 것을 연결하시오.', left: ['전류', '전압'], right: ['A', 'V'],
        },
      ],
      float: [],
    }],
  };
}

async function startEditServer() {
  const base = await autoTmpDir('wsg-partedit-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '부분편집문서', document: fixtureDocument(), now: new Date('2026-07-28T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '부분편집문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('본문 인라인 편집·성취기준 선택 표시·지문 서식·연결점 간격·항목 증감(실 Chrome)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=part-edit-ux`);
    assert.equal(ds(dom, 'seed-error'), null, `시드 오류: ${ds(dom, 'seed-error')}`);
    assert.equal(ds(dom, 'seed-done'), 'part-edit-ux', '시드 스크립트가 끝까지 실행됨');

    // ── #1 학습목표 문장·박스 제목을 본문에서 직접 편집 ──
    assert.equal(ds(dom, 'pe-objective0'), '본문에서 고친 목표', '본문에서 고친 학습목표가 개체에 반영되어야 함');
    assert.equal(ds(dom, 'pe-objective-other'), '옴의 법칙으로 저항을 구할 수 있다.', '다른 줄은 건드리지 않아야 함');
    assert.equal(ds(dom, 'pe-enter-closed'), 'true', 'Enter 는 편집을 끝낸다');
    assert.equal(ds(dom, 'pe-objective-no-newline'), 'true', '조각 값에 개행이 섞이면 안 된다');
    assert.equal(ds(dom, 'pe-heading'), '오늘의 목표', '"학습 목표" 제목 자체도 본문에서 고칠 수 있어야 함');

    // ── #1b 제목 배지·모서리 표기, 지문 제목·출처 ──
    assert.equal(ds(dom, 'pe-pill'), '중2 · 3차시');
    assert.equal(ds(dom, 'pe-page-cleared'), 'true', '조각을 비우면 필드가 지워져 다음 렌더에서 사라진다');
    assert.equal(ds(dom, 'pe-passage-title'), '지문 (다)');
    assert.equal(ds(dom, 'pe-passage-source'), '중학교 사회 2', '"출처: " 접두가 값에 섞이면 안 된다');

    // ── #1 근거 성취기준: 기본 숨김 → 체크 시 표시(codes 는 보존) ──
    assert.equal(ds(dom, 'pe-std-ref-default'), '0', '기본값에서는 근거 성취기준 박스가 없어야 함');
    assert.equal(ds(dom, 'pe-std-checkbox-exists'), 'true');
    assert.equal(ds(dom, 'pe-std-checkbox-default'), 'true', '체크박스 기본은 꺼짐');
    assert.equal(ds(dom, 'pe-std-ref-on'), '1', '켜면 근거 성취기준 박스가 나타나야 함');
    assert.equal(ds(dom, 'pe-std-codes-kept'), '1', '표시를 껐다 켜도 codes 는 보존');

    // ── #3 지문 박스 서식 ──
    assert.equal(ds(dom, 'pe-passage-style-fields'), 'true', '지문 인스펙터에 색·두께 입력이 있어야 함');
    assert.equal(ds(dom, 'pe-passage-border-var'), '#2563eb');
    assert.equal(ds(dom, 'pe-passage-border-computed'), 'rgb(37, 99, 235)', '지정색이 실제 계산 테두리색으로 반영되어야 함');

    // ── #4 연결점 간격: 두 점 사이가 각 점-항목 거리보다 훨씬 멀어야 한다 ──
    const between = Number(ds(dom, 'pe-dot-gap-between'));
    const toLeft = Number(ds(dom, 'pe-dot-to-left-item'));
    const toRight = Number(ds(dom, 'pe-dot-to-right-item'));
    assert.ok(Number.isFinite(between) && between > 0, `점 간격 실측 실패: ${between}`);
    assert.ok(toLeft <= 6, `왼쪽 점이 왼쪽 항목에 붙어야 한다(실측 ${toLeft}px)`);
    assert.ok(toRight <= 6, `오른쪽 점이 오른쪽 항목에 붙어야 한다(실측 ${toRight}px)`);
    assert.ok(between > toLeft * 4 && between > toRight * 4,
      `두 점이 가운데 뭉쳐 있다 — 점 사이 ${between}px vs 항목까지 ${toLeft}/${toRight}px`);

    // ── #5 문항 항목 증감 ──
    assert.equal(ds(dom, 'pe-add-item-exists'), 'true', '연결형 인스펙터에 항목 추가 버튼이 있어야 함');
    assert.equal(ds(dom, 'pe-match-pairs'), '3/3', '연결 쌍이 좌우 함께 늘어야 함');
    assert.equal(ds(dom, 'pe-match-rows'), '3', '늘어난 쌍이 실제 렌더에도 반영되어야 함');

    // ── #2 이미지 자리가 실제 박스로 그려진다 ──
    assert.equal(ds(dom, 'pe-image-border-style'), 'dashed', '이미지 자리는 점선 박스여야 함');
    assert.equal(ds(dom, 'pe-image-has-icon'), 'true', '자리임을 알리는 아이콘이 있어야 함');
    const phHeight = Number(ds(dom, 'pe-image-height'));
    assert.ok(phHeight >= 100, `이미지 자리가 한 줄 글자로만 보인다(실측 높이 ${phHeight}px)`);
  } finally {
    server.close();
  }
});
