import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { autoTmpDir } from '../helpers/tmp.js';
import { openCdpSession } from '../helpers/cdp.js';

// 문서 제목 커밋 경로(계획 3단계 ⑨ = R5 · 대장 C17/D16).
//
// `commitTitle` 은 문서 변경의 단일 관문(`applyDocOp`)을 거치지 않고 `core.setDocument` 를 직접
// 불렀다. 그래서 두 가지가 깨져 있었다:
//   ⑧ 앱바 제목이 모델을 따라가지 않는다 — undo 로 제목이 되돌아가도 앱바는 새 제목을 그대로 단다.
//   C17 관문이 하는 `flushTyping()` 을 안 탄다 — D10 과 **같은 결함**이 이 경로에 살아 있어서,
//      제목을 확정하기 직전 500ms 안에 친 글자가 Ctrl+Z 한 번에 함께 사라진다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;
const CV = `${IFR}.contentDocument`;
const TITLE_EL = `document.getElementById('doc-title')`;

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '원래 제목',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [{ id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문</p>' }],
      float: [],
    }],
  };
}

async function boot(prefix) {
  const base = await autoTmpDir('wsg-doctitle-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-29T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false });
  const addr = await listenEditorServer(server);
  const s = await openCdpSession(`http://127.0.0.1:${addr.port}/`, { prefix });
  await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
  await s.waitFor(`${CV}.querySelectorAll('[data-oid]').length === 1`, { message: '개체 렌더' });
  return { server, s };
}

const teardown = async (server, s) => {
  await new Promise((r) => server.close(r));
  await s.close();
};

const hostCenter = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
})()`;

const canvasCenter = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(fr.left + (r.left + r.width / 2) * scale), y: Math.round(fr.top + (r.top + r.height / 2) * scale) });
})()`;

const clickAt = async (s, expr) => {
  const pt = JSON.parse(await s.evaluate(expr));
  assert.ok(pt, '좌표를 못 구했다');
  await s.click(pt.x, pt.y);
  return pt;
};

/** 앱바 제목을 실입력으로 고쳐 확정한다(클릭 → 전체 선택 → 타이핑 → Enter). */
async function retitle(s, text) {
  await clickAt(s, hostCenter('#doc-title'));
  await s.waitFor(`${TITLE_EL}.getAttribute('contenteditable') === 'true'`, { message: '제목 편집 진입' });
  await s.press('a', { ctrl: true });
  await s.insertText(text);
  await s.press('Enter');
}

test('제목 undo 뒤 앱바가 모델을 따라간다 (계획 3단계 ⑧)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('title-undo-');
  try {
    await retitle(s, '바뀐 제목');
    assert.equal(await s.evaluate(`${TITLE_EL}.textContent`), '바뀐 제목', '전제: 커밋되면 앱바에 반영된다');

    await s.press('z', { ctrl: true });
    await s.waitFor(`${TITLE_EL}.textContent !== '바뀐 제목'`, { message: '제목 undo 반영', timeoutMs: 5000 })
      .catch(() => {});

    const shown = await s.evaluate(`${TITLE_EL}.textContent`);
    assert.equal(shown, '원래 제목', '되돌린 뒤 앱바 제목이 모델과 어긋났다(파생 뷰 미갱신)');
  } finally {
    await teardown(server, s);
  }
});

test('제목 커밋 직전에 친 글자가 같은 undo 단계에 삼켜지지 않는다 (계획 3단계 ⑨ = D10 동형)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('title-flush-');
  try {
    // 본문에 글자를 친다 — 타이핑은 유휴 500ms(history.TYPING_IDLE_MS)로 묶여 확정되므로 아직 대기다.
    const pt = JSON.parse(await s.evaluate(canvasCenter('[data-oid="r1"]')));
    await s.click(pt.x, pt.y);
    await s.click(pt.x, pt.y, { clickCount: 2 });
    await s.insertText('추가글자');
    assert.match(await s.evaluate(`${CV}.querySelector('[data-oid="r1"]').textContent`), /추가글자/, '전제: 글자가 들어갔다');

    // ⚠ 제목 커밋만 **한 번의 evaluate 로 압축**한다. 실마우스로 클릭→전체선택→타이핑→Enter 를
    //    하면 CDP 왕복(settleMs 160ms × 4~5회)이 500ms 창을 넘겨 경합이 재현되지 않는다(실측:
    //    그 형태로는 변이 실험이 결함을 못 잡았다). click()/blur() 는 합성 dispatch 가 아니라
    //    브라우저의 진짜 클릭·포커스 경로라, 건너뛰는 것은 좌표 히트테스트뿐이다 — 그 배선은
    //    위 ⑧ 테스트가 실마우스로 이미 덮는다.
    await s.evaluate(`(() => {
      const el = ${TITLE_EL};
      el.click();
      el.textContent = '바뀐 제목';
      el.blur();
      return true;
    })()`);
    await s.waitFor(`${TITLE_EL}.textContent === '바뀐 제목'`, { message: '제목 커밋 반영', timeoutMs: 5000 });

    // Ctrl+Z 한 번 — 제목만 되돌아가야 하고, 방금 친 글자는 남아야 한다.
    await s.press('z', { ctrl: true });

    const body = await s.evaluate(`${CV}.querySelector('[data-oid="r1"]').textContent`);
    const title = await s.evaluate(`${TITLE_EL}.textContent`);
    assert.equal(title, '원래 제목', '되돌리기 1회는 제목을 되돌린다');
    assert.match(body, /추가글자/, '제목 커밋이 직전 타이핑을 자기 undo 단계에 삼켰다(flushTyping 누락)');
  } finally {
    await teardown(server, s);
  }
});
