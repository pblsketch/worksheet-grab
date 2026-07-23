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

// S4.1(M4a — 개체 우선 조작 코어) 실물 검증(실 Chrome, testSeed 게이트 서버, 직렬 단독 실행).
// 클릭=선택·더블클릭=그 개체만 편집(문서 전체 아님)·Esc 사다리(편집종료→선택복귀→선택해제)·
// 다중선택(Shift)·float 미선택 pointer-events 정책(z-order 완화, 스파이크 §4-5)·드래그 후
// click 1회 삼키기·undo/redo·체크포인트 저장 왕복(rev 증가)을 editor.js:runSeed('core-ops')
// 가 실 DOM 이벤트(click()/dispatchEvent)로 재현하고 dataset 에 기록한 결과를 단정한다.
// 실제 마우스(CDP Input)로만 잡히는 드래그의 경계 버그는 scratchpad/ralph-reports/us16-evidence/
// 의 별도 검증 스크립트 소관(MEMORY: synthetic-events-hide-drag-bugs) — 이 파일은 상태기계 자체의
// 회귀 방어다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000, windowSize = '1280,900') {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-select-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=20000',
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
      if (!out.includes('<body')) rejectPromise(new Error(`dump-dom 실패: ${errOut.slice(-800)}`));
      else resolvePromise(out);
    });
  });
}

const ds = (dom, key) => {
  const m = new RegExp(`data-${key}="([^"]*)"`).exec(dom);
  return m ? m[1] : null;
};

/** ValidateObjectTree/RenderObjectTree 스키마를 만족하는 최소 개체 트리 픽스처.
 *  title(t1)·std-box(s1, 편집 불가)·question(q1, qnum 배지 포함)·richtext(r1)·float answer-area(f1). */
function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'S4.1 선택 코어 테스트',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '원제목' },
        { id: 's1', type: 'std-box', placement: 'flow', codes: ['9과15-01'] },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '원래 질문', qnum: 1 },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>richtext 내용</p>' },
      ],
      float: [
        { id: 'f1', type: 'answer-area', placement: 'float', style: 'box', label: '메모', rect: { xMm: 100, yMm: 150, wMm: 50, hMm: 25 } },
      ],
    }],
  };
}

async function startEditServer() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-select-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '선택코어문서', document: fixtureDocument(), now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '선택코어문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, workspace };
}

test('S4.1 개체 우선 조작 코어: 선택·편집·Esc·다중선택·float 정책·드래그삼키기·undo/redo·체크포인트 저장', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=core-ops`);
    assert.equal(ds(dom, 'seed-done'), 'core-ops', '시드 스크립트가 끝까지 실행됨');
    assert.equal(ds(dom, 'ready'), 'true');

    // 클릭 = 선택
    assert.equal(ds(dom, 'sel1-type'), 'title');
    assert.equal(ds(dom, 'sel1-has'), 'true');
    // 다른 개체 클릭 → 단일 선택 전환
    assert.equal(ds(dom, 'sel-switched'), 'true');
    // Shift 클릭 → 다중 선택(누적, 최소 요건)
    assert.equal(ds(dom, 'multi-count'), '2');
    // 빈 캔버스 클릭 → 전체 해제
    assert.equal(ds(dom, 'cleared-count'), '0');

    // 더블클릭 = 그 개체만 편집(문서 전체 contenteditable 금지 원칙 1)
    assert.equal(ds(dom, 'editing-id'), 't1');
    assert.equal(ds(dom, 'title-ce'), 'true');
    assert.equal(ds(dom, 'others-ce'), '1', '동시에 contenteditable 인 요소는 그 개체 하나뿐');
    // 타이핑 → obj 필드 즉시 동기화(개체↔DOM data-oid 동기화)
    assert.equal(ds(dom, 'title-text-synced'), '수정된 제목');

    // Esc(1회) = 편집 종료 → 선택 복귀(완전 해제 아님)
    assert.equal(ds(dom, 'esc-editing-after'), '(none)');
    assert.equal(ds(dom, 'esc-selected-after'), 't1');
    assert.equal(ds(dom, 'title-ce-after-esc'), '(none)');
    // Esc(2회) = 선택 해제
    assert.equal(ds(dom, 'esc2-selected-count'), '0');

    // 편집 불가 타입(std-box) 더블클릭 → 선택만, 편집 진입 없음
    assert.equal(ds(dom, 'std-editing-id'), '(none)');
    assert.equal(ds(dom, 'std-selected'), 'true');
    // 학습목표 표기 전환(2026-07-23): 인스펙터에 objectives 편집 필드가 뜨고 codes 는 읽기 전용
    assert.equal(ds(dom, 'std-insp-objectives-field'), 'true', 'std-box 인스펙터에 학습 목표 편집 필드가 있어야 함');
    assert.equal(ds(dom, 'std-insp-codes-readonly'), 'true', 'std-box 인스펙터의 성취기준 코드 필드는 읽기 전용이어야 함');

    // question 편집 — qnum 배지가 prompt 에 섞이지 않는다(stripSelector)
    assert.ok(ds(dom, 'q-prompt-synced').includes('(수정)'), 'question.prompt 가 편집 내용 반영');
    assert.equal(ds(dom, 'qnum-stripped'), 'true', 'qnum 배지 텍스트는 prompt 에서 제외됨');

    // float 미선택 pointer-events:none → 선택 시 auto(z-order 클릭 가로채기 완화, 스파이크 §4-5)
    assert.equal(ds(dom, 'float-pe-unselected'), 'none');
    assert.equal(ds(dom, 'float-pe-selected'), 'auto');

    // float 드래그(합성 PointerEvent) — rect.xMm/yMm 이동
    const dx = Number(ds(dom, 'float-moved-x'));
    const dy = Number(ds(dom, 'float-moved-y'));
    assert.ok(dx >= 8 && dx <= 13, `float x 이동량이 기대 범위 밖: ${dx}`);
    assert.ok(dy >= 6 && dy <= 10, `float y 이동량이 기대 범위 밖: ${dy}`);
    // 드래그 직후 click 1회 삼키기(공통조상 오인 방지) — 그 다음 클릭은 정상 해제(1회성)
    assert.equal(ds(dom, 'after-swallow-selected'), 'true', '드래그 직후 1회는 삼켜져 선택 유지');
    assert.equal(ds(dom, 'after-second-click-count'), '0', '그 다음 클릭은 정상적으로 선택 해제');

    // undo(2회) → 두 커밋(제목 편집→질문 편집) 모두 원복
    assert.equal(ds(dom, 'after-undo-orig-match'), 'true', 'undo 로 제목이 원문 복귀');
    assert.equal(ds(dom, 'after-undo-question-orig-match'), 'true', 'undo 로 질문이 원문 복귀');
    // redo(2회) → 편집 내용 재적용
    assert.equal(ds(dom, 'after-redo-title'), '수정된 제목');
    assert.ok(ds(dom, 'after-redo-question').includes('(수정)'));

    // 체크포인트 저장 — 명시 저장 1회 = rev +1(디스크는 이 호출에서만 접촉)
    assert.equal(ds(dom, 'rev-before-save'), '1');
    assert.equal(ds(dom, 'rev-after-save'), '2');
    assert.equal(ds(dom, 'save-ok'), 'true');

    // 서버 측에서도 저장 결과가 실제로 반영됐는지(디스크 왕복) 별도 확인.
    const shellRes = await fetch(`${url}/shell.json`);
    const shell = await shellRes.json();
    assert.equal(shell.meta.revision, 2);
    const savedTitle = shell.document.pages[0].flow.find((o) => o.id === 't1');
    assert.equal(savedTitle.text, '수정된 제목', '/save 왕복이 개체 트리에 편집을 반영');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
