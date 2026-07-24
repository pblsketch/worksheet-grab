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

// editor-v4 UX 개선 배치(2026-07-24) 실물 검증 — editor-select.render.test.js 하네스와 동형
// (실 Chrome, testSeed 게이트 서버, 직렬 단독 실행). 각 시드는 editor.js:runSeed() 가 실 DOM
// 이벤트로 재현하고 body.dataset 에 기록한 결과를 ds() 로 단정한다.
//   US-E1 student-fresh : 학생용 미리보기가 교사 편집을 반영(stale 제거)
//   US-E2 nudge         : 자유 개체 방향키 미세 이동(1mm)·Shift 큰 이동(10mm)·undo·flow 무영향
//   US-E3 copy-paste    : 개체 복사(Ctrl+C)·붙여넣기(Ctrl+V) — +1·새 id·원본 보존·앵커·undo
//   US-E4 affordance    : 교사 친화 배치 용어·색상 라벨·편집 발견성 힌트(비편집 타입엔 없음)
//   zoom                : 확대(>100%) 시 좌우·상하 잘림 제거 — 스케일된 콘텐츠가 스크롤로 접근됨
//   format-text         : 문항/제목 인라인 서식(굵게) — promptHtml 저장·렌더·저장왕복·하위호환

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

function dumpDom(url, timeoutMs = 60000, windowSize = '1280,900') {
  const chrome = resolveChromePath(null);
  const userDataDir = mkdtempSync(join(tmpdir(), 'wsg-ux-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`,
    '--virtual-time-budget=25000',
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

/** ValidateObjectTree/RenderObjectTree 스키마를 만족하는 최소 개체 트리 픽스처(UX 배치 공용).
 *  t1(제목)·s1(std-box, 편집 불가)·q1(문항)·r1(richtext)·rt-ans(정답 richtext)·f1(float 답란). */
function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: 'UX 개선 배치 테스트',
    subject: 'science',
    dataSubject: 'science',
    themeName: 'sci',
    lang: 'ko',
    paper: null,
    standards: [{ code: '9과15-01', text: '전압과 전류의 관계를 설명할 수 있다.' }],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '원제목' },
        { id: 's1', type: 'std-box', placement: 'flow', codes: ['9과15-01'], objectives: ['옴의 법칙을 설명할 수 있다.'] },
        { id: 'q1', type: 'question', placement: 'flow', qtype: 'essay', prompt: '원래 질문', qnum: 1 },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>richtext 내용</p>' },
        { id: 'rt-ans', type: 'richtext', placement: 'flow', answer: true, html: '<p>정답전용텍스트</p>' },
      ],
      float: [
        { id: 'f1', type: 'answer-area', placement: 'float', style: 'box', label: '메모', rect: { xMm: 100, yMm: 150, wMm: 50, hMm: 25 } },
      ],
    }],
  };
}

async function startEditServer() {
  const base = await mkdtemp(join(tmpdir(), 'wsg-ux-render-'));
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: 'UX배치문서', document: fixtureDocument(), now: new Date('2026-07-24T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: 'UX배치문서', workspace, blockRepository, curriculum: null, testSeed: true,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, workspace };
}

test('US-E1 학생용 미리보기 최신화: 교사 편집 후 학생용 전환 시 편집 반영·비편집·정답 숨김', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=student-fresh`);
    assert.equal(ds(dom, 'seed-done'), 'student-fresh', '시드 스크립트가 끝까지 실행됨');
    assert.equal(ds(dom, 'ready'), 'true');

    // 편집 직후 학생용은 stale 로 표시되고, 전환 완료 후엔 최신화되어 해제된다.
    assert.equal(ds(dom, 'student-stale-before-switch'), 'true', '편집 후 학생용은 stale');
    assert.equal(ds(dom, 'student-stale-after-switch'), 'false', '전환 후 학생용 최신화되어 stale 해제');

    // 핵심: 학생용 프레임이 교사 편집(제목)을 반영한다(stale 스냅샷 아님).
    assert.equal(ds(dom, 'student-has-edit'), 'true', '학생용 미리보기가 편집된 제목을 반영해야 함');
    // 학생용은 비편집(편집 래퍼 부재) + 정답 개체 물리 제거.
    assert.equal(ds(dom, 'student-no-edit-wrappers'), 'true', '학생용은 data-oid 편집 래퍼가 없어야 함');
    assert.equal(ds(dom, 'student-answer-hidden'), 'true', '학생용에는 정답 개체가 물리적으로 제거되어야 함');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E2 방향키 넛지: 자유 개체 1mm/Shift10mm 이동·타축 불변·undo 원복·flow 무영향', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=nudge`);
    assert.equal(ds(dom, 'seed-done'), 'nudge', '시드 스크립트가 끝까지 실행됨');
    assert.equal(ds(dom, 'nudge-selected'), 'true', 'float 개체가 선택됨');

    assert.equal(ds(dom, 'nudge-right-dx'), '1', 'ArrowRight = +1mm');
    assert.equal(ds(dom, 'nudge-right-y-unchanged'), 'true', 'ArrowRight 는 y 를 바꾸지 않음');
    assert.equal(ds(dom, 'nudge-shift-down-dy'), '10', 'Shift+ArrowDown = +10mm');
    assert.equal(ds(dom, 'nudge-undone'), 'true', 'undo 2회로 원위치 복원');
    assert.equal(ds(dom, 'nudge-flow-no-rect'), 'true', 'flow 개체는 방향키에 반응하지 않음(rect 없음)');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E3 개체 복사·붙여넣기: Ctrl+C/Ctrl+V — 개체 +1·새 id·필드 복제·원본 보존·앵커·undo', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=copy-paste`);
    assert.equal(ds(dom, 'seed-done'), 'copy-paste', '시드 스크립트가 끝까지 실행됨');

    assert.equal(ds(dom, 'cp-clipboard-count'), '1', 'Ctrl+C 로 개체 1개 복사됨');
    assert.equal(ds(dom, 'cp-count-increased'), 'true', '붙여넣기로 개체 수 +1');
    assert.equal(ds(dom, 'cp-new-selected'), 'true', '새 개체가 자동 선택(원본과 다른 id)');
    assert.equal(ds(dom, 'cp-new-is-question'), 'true', '붙여넣은 개체 타입 = question(복제)');
    assert.equal(ds(dom, 'cp-new-prompt-matches'), 'true', '붙여넣은 개체의 발문이 원본과 동일(복제)');
    assert.equal(ds(dom, 'cp-original-preserved'), 'true', '원본 q1 이 그대로 보존됨');
    assert.equal(ds(dom, 'cp-pasted-after-anchor'), 'true', '붙여넣기는 현재 선택(t1) 바로 뒤에 삽입');
    assert.equal(ds(dom, 'cp-undone'), 'true', 'undo 로 붙여넣기 원복');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('US-E4 교사 친화 표현 + 편집 발견성: 배치 용어·색상 라벨·편집 힌트(비편집 타입 제외)', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=affordance`);
    assert.equal(ds(dom, 'seed-done'), 'affordance', '시드 스크립트가 끝까지 실행됨');

    // 교사 친화 표현: 배치 전환 버튼·인스펙터에 '기본 개체'/'자유 개체' 원시 용어가 없다.
    assert.equal(ds(dom, 'aff-flowfloat-no-raw-term'), 'true', '툴바 배치 전환 버튼에 원시 용어 없음');
    assert.equal(ds(dom, 'aff-insp-no-raw-term'), 'true', '인스펙터 배치 라벨에 원시 용어 없음');
    assert.equal(ds(dom, 'aff-insp-has-friendly'), 'true', '인스펙터에 친화 표현(본문 배치) 노출');

    // 색상 컨트롤 식별 라벨.
    assert.equal(ds(dom, 'aff-color-has-title'), 'true', '글자색 컨트롤에 식별용 title 존재');

    // 편집 발견성: 편집 가능 개체엔 힌트, 비편집(std-box)엔 없음.
    assert.equal(ds(dom, 'aff-edit-hint-on-editable'), 'true', '편집 가능 개체 선택 시 편집 힌트 노출');
    assert.equal(ds(dom, 'aff-no-hint-on-std-box'), 'true', 'std-box(비편집)에는 편집 힌트 없음');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('확대 잘림 수정: 150% 확대 시 스케일된 콘텐츠가 스크롤로 접근되고 100% 복귀 시 여백 해제', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=zoom`);
    assert.equal(ds(dom, 'seed-done'), 'zoom', '시드 스크립트가 끝까지 실행됨');

    assert.equal(ds(dom, 'zoom-label'), '150%', '확대가 150% 로 반영');
    // 핵심: 스케일된 콘텐츠 전체가 스크롤 영역 안에 들어와 좌우·상하가 잘리지 않는다.
    assert.equal(ds(dom, 'zoom-scroll-width-ok'), 'true', '150% 에서 스크롤 폭이 스케일된 콘텐츠를 담음(좌우 잘림 없음)');
    assert.equal(ds(dom, 'zoom-scroll-height-ok'), 'true', '150% 에서 스크롤 높이가 스케일된 콘텐츠를 담음(상하 잘림 없음)');
    assert.equal(ds(dom, 'zoom-origin-at150-left'), 'true', '확대 시 origin 좌상단 기준(넘침을 스크롤 가능 방향으로)');
    assert.equal(ds(dom, 'zoom-margin-reserved'), 'true', '확대 시 스케일 초과분 여백 예약');

    // 100% 복귀 시 여백 해제 + 가운데 정렬 origin 복귀.
    assert.equal(ds(dom, 'zoom-label-back'), '100%', '축소가 100% 로 복귀');
    assert.equal(ds(dom, 'zoom-origin-back-center'), 'true', '100% 복귀 시 가운데 정렬 origin');
    assert.equal(ds(dom, 'zoom-margin-cleared'), 'true', '100% 복귀 시 예약 여백 해제');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('문항/제목 인라인 서식: 굵게 적용 → promptHtml 저장·렌더 반영·저장 왕복·하위호환', { skip: !HAS_CHROME, timeout: 120000 }, async () => {
  const { server, url } = await startEditServer();
  try {
    const dom = await dumpDom(`${url}/?seed=format-text`);
    assert.equal(ds(dom, 'seed-done'), 'format-text', '시드 스크립트가 끝까지 실행됨');

    assert.equal(ds(dom, 'ft-bold-enabled'), 'true', '문항 편집 중 굵게 버튼이 활성화됨');
    assert.equal(ds(dom, 'ft-prompt-html-has-markup'), 'true', '굵게 적용 시 promptHtml 에 서식 태그 저장');
    assert.equal(ds(dom, 'ft-plain-prompt-preserved'), 'true', '평문 prompt 는 태그 없이 병행 보존(누출 스캔·diff용)');
    assert.equal(ds(dom, 'ft-rendered-markup'), 'true', '재렌더 시 발문에 서식 요소가 반영됨');
    assert.equal(ds(dom, 'ft-plain-title-no-html'), 'true', '평문만 편집한 제목엔 textHtml 이 생기지 않음(하위호환)');
    assert.equal(ds(dom, 'ft-save-ok'), 'true', '저장 성공(unsafe 아님)');
    assert.equal(ds(dom, 'ft-saved-prompt-html-persisted'), 'true', '저장 왕복 후 서버 저장본에 promptHtml 지속');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
