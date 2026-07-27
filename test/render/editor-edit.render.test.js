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

// US-20(S4.5) 재작성 — E3(§6) 편집 실물 검증, 개체 모델.
//
// 구 테스트의 5개 하위 검증 중:
//  ① "M1 editMode 래퍼 .sheet 치수 == E2 등가"는 구 아키텍처(문서 전체 contenteditable 래퍼)
//     전용 개념이라 신 UI(개체 트리 iframe 렌더)에는 대응 개념이 없다 — 대신 A4 치수 실측은
//     editor-export.render.test.js 가 이미 커버한다(중복 방지, 삭제 아님을 여기 기록).
//  ⑤ "대량 답란 → 넘침 배지"는 신 UI 에서 아키텍처가 바뀌었다 — 넘침을 배지로 경고하는 대신
//     S4.2 리플로우가 넘친 개체를 자동으로 다음 페이지로 옮긴다(editor-reflow.render.test.js 가
//     그 동작을 실 Chrome 으로 단정). "실시간 예고"라는 문제의식 자체가 "자동 해결"로 대체된
//     설계 변경이라 배지 UI 자체가 더 이상 존재하지 않는다(us20.md 기록).
// 나머지(②③④, 시드 격리)는 개체 모델 동형으로 재작성했다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const ANS_MARK = 'EDIT_ANSWER_고유텍스트';

function dumpDom(url, timeoutMs = 60000) {
  const chrome = resolveChromePath(null);
  const chromeTmp = makeTmpDirSync('wsg-edit-chrome-');
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

/** minFont(6pt) 픽스처를 포함 — richtext 개체는 자유 HTML 이라 인라인 style 로도 표현 가능. */
function fixtureDocument({ smallFont = false } = {}) {
  const r1Html = smallFont
    ? `<p>${ANS_MARK}</p><p style="font-size:6pt">아주 작은 안내문</p>`
    : `<p>${ANS_MARK}</p>`;
  return {
    pagination: 'paginated',
    docTitle: 'E3 편집 실물 테스트',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'r1', type: 'richtext', placement: 'flow', html: r1Html },
        { id: 'aa1', type: 'answer-area', placement: 'flow', style: 'line', lines: 3 },
        { id: 'pas1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' },
      ],
      float: [],
    }],
  };
}

async function startEditServer(doc = fixtureDocument()) {
  const ws = await makeTmpDir('wsg-edit-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: doc, now: new Date('2026-07-23T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: true });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('§6②: 정답 마킹→저장 → 학생용 파생·워크스페이스 양쪽에서 물리 부재', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=answer-mark-save`);
    assert.equal(ds(dom, 'seed-done'), 'answer-mark-save');
    assert.equal(ds(dom, 'marked-answer'), 'true');
    assert.equal(ds(dom, 'saved-unsafe'), 'false', '정상 마킹 저장은 unsafe 아님');
    const teacher = await readFile(join(ws.dir, '문서', 'worksheet-teacher.html'), 'utf8');
    const student = await readFile(join(ws.dir, '문서', 'worksheet-student.html'), 'utf8');
    assert.ok(teacher.includes(ANS_MARK), 'teacher 는 정답 마킹 개체 보존');
    assert.ok(!student.includes(ANS_MARK), 'student 파생에서 물리 제거');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('§6③: 답란 줄 수 변경(구 "5줄 삽입" 동형)→저장 → manifest 반영', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=lines-save`);
    assert.equal(ds(dom, 'seed-done'), 'lines-save');
    assert.equal(ds(dom, 'lines-after'), '8', '3 → 8 (+5, 구 "답란 5줄" 과 동일 증가량)');
    assert.equal(ds(dom, 'saved-ok'), 'true');
    const manifest = JSON.parse(await readFile(join(ws.dir, '문서', 'worksheet.manifest.json'), 'utf8'));
    const aa1 = manifest.pages[0].flow.find((o) => o.id === 'aa1');
    assert.equal(aa1.lines, 8, '저장 manifest 에 줄 수 반영');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('§6④: 6pt 작은 글씨 → 저장 시 라이브 검수(runReview) min-font 경고 반영', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer(fixtureDocument({ smallFont: true }));
  try {
    const dom = await dumpDom(`${url}/?seed=min-font-check`);
    assert.equal(ds(dom, 'seed-done'), 'min-font-check');
    assert.equal(ds(dom, 'review-status-val'), 'warn', '8pt 미만은 저장 시점 검수에서 경고');
    assert.match(dom, /\[min-font\]/, '검수 상세 목록(#insp-review-list)에 min-font 항목');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('저작권 지문 3층 정책(2026-07-23 2차 델타): passage-slot 더블클릭 편집(교사 입력)→저장 왕복, AI 는 명시 요청 시 대상', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const { server, url, ws } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=passage-edit-save`);
    assert.equal(ds(dom, 'seed-done'), 'passage-edit-save');
    // 편집 전: slotLabel 플레이스홀더(.slot) 상태에서 시작.
    assert.equal(ds(dom, 'passage-has-slot-before'), 'true', '편집 전에는 슬롯 플레이스홀더만 있어야 함');
    // 더블클릭 = 그 개체(passage-slot)만 편집 진입(selection.js EDIT_FIELD 등재 검증).
    assert.equal(ds(dom, 'passage-editing-id'), 'pas1');
    // 진입 시 안내 문구가 지워져 빈 칸에서 시작(안내 문구가 본문에 섞이지 않음).
    assert.equal(ds(dom, 'passage-cleared-on-enter'), 'true');
    // 타이핑 → obj.bodyHtml 즉시 동기화.
    assert.equal(ds(dom, 'passage-body-synced'), '이것은 교사가 직접 입력한 지문 본문입니다.');
    // 재렌더 후: 본문이 있으므로 .passage-body 로 전환, .slot 플레이스홀더는 사라짐.
    assert.equal(ds(dom, 'passage-has-body-after-reflow'), 'true');
    assert.equal(ds(dom, 'passage-has-slot-after-reflow'), 'false');
    // 저장 왕복(rev 증가).
    assert.equal(ds(dom, 'passage-rev-before-save'), '1');
    assert.equal(ds(dom, 'passage-rev-after-save'), '2');
    assert.equal(ds(dom, 'passage-save-ok'), 'true');

    // 서버 저장본에도 교사 입력 본문이 반영되어야 한다.
    const shellRes = await fetch(`${url}/shell.json`);
    const shell = await shellRes.json();
    const savedPassage = shell.document.pages[0].flow.find((o) => o.id === 'pas1');
    assert.equal(savedPassage.bodyHtml, '이것은 교사가 직접 입력한 지문 본문입니다.', '저장본에 교사 입력 지문 본문이 반영되어야 함');

    // 3층 정책(2026-07-23 2차 델타): passage-slot 은 AI 가드에서 해제되어 명시 요청 시 200 이어야 한다
    // (std-box 만 §7 원칙 3으로 잔류 — 그 무회귀는 ai-bridge.test.js/editor-server.test.js 가 단정).
    const aiRes = await fetch(`${url}/ai/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rewrite', objects: [{ id: 'pas1', type: 'passage-slot', placement: 'flow', slotLabel: '［지문 삽입 슬롯］' }] }),
    });
    assert.equal(aiRes.status, 200, 'passage-slot 은 명시 요청 시 AI 요청 대상이어야 함(가드 해제, 2차 델타)');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});

test('시드 격리: testSeed 미기동 서버에선 ?seed= 가 무시된다(실데이터 보호)', { skip: !HAS_CHROME, timeout: 60000 }, async () => {
  const ws = await makeTmpDir('wsg-edit-noseed-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-21T01:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null }); // testSeed 미지정
  const addr = await listenEditorServer(server);
  try {
    const dom = await dumpDom(`http://127.0.0.1:${addr.port}/?seed=lines-save`);
    assert.equal(ds(dom, 'seed-done'), null, '시드 미실행');
    const meta = JSON.parse(await readFile(join(ws.dir, '문서', '.worksheet-grab', 'meta.json'), 'utf8'));
    assert.equal(meta.revision, 1, '자동 저장 미발생(rev 불변)');
  } finally {
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});
