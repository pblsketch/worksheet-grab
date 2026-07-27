import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsBlockRepository } from '../../src/adapters/FsBlockRepository.js';
import { FsWorkspaceRepository } from '../../src/adapters/FsWorkspaceRepository.js';
import { SaveDocument } from '../../src/usecases/SaveDocument.js';
import { createEditorServer, listenEditorServer } from '../../src/adapters/EditorHttpServer.js';
import { chromeAvailable } from '../helpers/pdf.js';
import { makeTmpDir } from '../helpers/tmp.js';
import { openCdpSession } from '../helpers/cdp.js';

// 단축키 **실입력** 회귀 — 진짜 마우스·키보드로 `키 입력 → shortcuts.onKeydown → applyDocOp →
// 화면 반영` 전 구간을 확인한다.
//
// 왜 별도 파일인가: 이 리포의 편집기 렌더 테스트는 testSeed(합성 이벤트·내부 API 직접 호출)로
// 검증한다. 그건 계산은 잡지만 **배선을 건너뛴다.** 실제로 "삭제 후 Ctrl+Z 가 복원하지 않는"
// 버그가 오래 살아남았는데, testSeed 가 `history.undo()` 를 직접 부르고 단정도 DOM 이 아니라
// 모델을 읽어서 스위트가 전부 통과하고 있었다(2026-07-28 수정: 리플로우가 히스토리에 자기
// 단계를 쌓던 것 → history.amend). 그 공백을 영구 가드로 옮긴 것이 이 파일이다.
//
// 그래서 여기서는 두 가지를 의도적으로 고집한다:
//   ① 서버를 `testSeed:false` 로 띄운다 — 시드 훅 없이 실사용자가 쓰는 편집기 그대로.
//   ② 단정은 **화면(DOM)** 으로 한다 — 모델만 보면 "고쳤는데 화면은 그대로"를 놓친다.
//
// Chrome 1회 기동을 서브테스트가 공유한다(기동 비용이 검증보다 비싸다). 직렬 실행 전제
// (`--test-concurrency=1`)는 렌더 스위트 공통 규약이다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

const IFRAME_DOC = `document.querySelector('#stage iframe').contentDocument`;
const OBJ_COUNT = `${IFRAME_DOC}.querySelectorAll('[data-oid]').length`;
const SELECTED_COUNT = `${IFRAME_DOC}.querySelectorAll('.wg-selected').length`;
const EDITING_COUNT = `${IFRAME_DOC}.querySelectorAll('[contenteditable="true"]').length`;
const hasOid = (oid) => `!!${IFRAME_DOC}.querySelector('[data-oid=${JSON.stringify(oid)}]')`;

/** 개체 중심의 **뷰포트 좌표**(iframe 위치 + 캔버스 줌 변형까지 반영) — 실마우스는 화면 좌표로 쏜다. */
const centerOf = (oid) => `(() => {
  const f = document.querySelector('#stage iframe');
  const fr = f.getBoundingClientRect();
  const scale = fr.width / f.offsetWidth;
  const el = f.contentDocument.querySelector('[data-oid=${JSON.stringify(oid)}]');
  if (!el) return null;
  const er = el.getBoundingClientRect();
  return { x: fr.left + (er.left + er.width / 2) * scale, y: fr.top + (er.top + er.height / 2) * scale };
})()`;

/** 자유 배치 개체의 left(mm) — 넛지는 재로드 없이 라이브 DOM 좌표만 갱신하므로 style 을 직접 읽는다. */
const floatLeftMm = (oid) => `parseFloat(${IFRAME_DOC}.querySelector('[data-oid=${JSON.stringify(oid)}]').style.left)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '단축키 실입력 회귀',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>첫째 문단</p>' },
        { id: 'r2', type: 'richtext', placement: 'flow', html: '<p>둘째 문단</p>' },
        { id: 'r3', type: 'richtext', placement: 'flow', html: '<p>셋째 문단</p>' },
      ],
      float: [
        { id: 'f1', type: 'answer-area', placement: 'float', style: 'box', label: '메모', rect: { xMm: 100, yMm: 150, wMm: 50, hMm: 25 } },
      ],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-shortcuts-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-28T00:00:00.000Z') });
  // testSeed:false — 시드 훅 없이 실제 편집기. 이 파일의 존재 이유다.
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('단축키 실입력 회귀: 실제 키보드·마우스로 편집기 배선 종단 확인', { skip: !HAS_CHROME, timeout: 240000 }, async (t) => {
  const { server, url, ws } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-shortcuts-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${OBJ_COUNT} > 0`, { message: 'teacher iframe 개체 렌더(빈 화면 회귀 방어)' });
    const baseline = await s.evaluate(OBJ_COUNT);
    assert.equal(baseline, 4, '픽스처 전제: flow 3 + float 1');

    await t.test('실마우스 클릭 → 선택, Esc → 해제', async () => {
      const c = await s.evaluate(centerOf('r2'));
      assert.ok(c, 'r2 가 화면에 있어야 한다');
      await s.click(c.x, c.y);
      assert.equal(await s.evaluate(SELECTED_COUNT), 1, '클릭한 개체가 선택된다');
      await s.press('Escape');
      assert.equal(await s.evaluate(SELECTED_COUNT), 0, 'Esc 로 선택 해제');
    });

    await t.test('방향키 넛지: 1mm, Shift+방향키 10mm (자유 배치 개체)', async () => {
      const c = await s.evaluate(centerOf('f1'));
      await s.click(c.x, c.y);
      assert.equal(await s.evaluate(SELECTED_COUNT), 1, '자유 배치 개체 선택');
      const before = await s.evaluate(floatLeftMm('f1'));

      await s.press('ArrowRight');
      assert.equal(await s.evaluate(floatLeftMm('f1')), before + 1, '방향키 1회 = 1mm');

      await s.press('ArrowRight', { shift: true });
      assert.equal(await s.evaluate(floatLeftMm('f1')), before + 11, 'Shift+방향키 = 10mm');

      // 원위치로 되돌려 이후 검증이 좌표에 의존하지 않게 한다.
      await s.press('ArrowLeft', { shift: true });
      await s.press('ArrowLeft');
      assert.equal(await s.evaluate(floatLeftMm('f1')), before, '넛지 왕복 원위치');
      await s.press('Escape');
    });

    await t.test('Ctrl+C / Ctrl+V → 개체 +1, Ctrl+Z → 원복, Ctrl+Y → 재적용', async () => {
      const c = await s.evaluate(centerOf('r2'));
      await s.click(c.x, c.y);
      await s.press('c', { ctrl: true });
      await s.press('v', { ctrl: true });
      await s.waitFor(`${OBJ_COUNT} === ${baseline + 1}`, { message: '붙여넣기로 개체 +1' });

      await s.press('z', { ctrl: true });
      await s.waitFor(`${OBJ_COUNT} === ${baseline}`, { message: 'Ctrl+Z 로 붙여넣기 원복' });

      await s.press('y', { ctrl: true });
      await s.waitFor(`${OBJ_COUNT} === ${baseline + 1}`, { message: 'Ctrl+Y 로 다시 실행' });

      await s.press('z', { ctrl: true }); // 다음 서브테스트를 위해 기준 상태로 되돌린다
      await s.waitFor(`${OBJ_COUNT} === ${baseline}`, { message: '기준 상태 복귀' });
    });

    // ★ 이 서브테스트가 2026-07-28 버그의 영구 가드다. 당시 실 Ctrl+Z 는 8번을 눌러도
    //   화면이 1바이트도 바뀌지 않았다(리플로우가 매 undo 마다 자기 단계를 다시 쌓았다).
    await t.test('Delete → 개체 -1, Ctrl+Z → 지운 개체가 화면에 복귀', async () => {
      const c = await s.evaluate(centerOf('r3'));
      await s.click(c.x, c.y);
      await s.press('Delete');
      await s.waitFor(`${OBJ_COUNT} === ${baseline - 1}`, { message: 'Delete 로 개체 -1' });
      assert.equal(await s.evaluate(hasOid('r3')), false, '지운 개체가 화면에서 사라진다');

      await s.press('z', { ctrl: true });
      await s.waitFor(`${OBJ_COUNT} === ${baseline}`, { message: '삭제 후 Ctrl+Z 1회로 복원(리플로우가 undo 를 가두지 않는다)' });
      assert.equal(await s.evaluate(hasOid('r3')), true, '지운 그 개체가 화면에 돌아온다');
    });

    await t.test('텍스트 편집 중에는 개체 단축키가 개입하지 않는다(Delete·Ctrl+V)', async () => {
      const c = await s.evaluate(centerOf('r1'));
      await s.click(c.x, c.y);
      await s.click(c.x, c.y, { clickCount: 2 }); // 더블클릭 = 편집 진입
      await s.waitFor(`${EDITING_COUNT} >= 1`, { message: '더블클릭으로 텍스트 편집 진입' });

      // 편집 중 Delete 는 글자를 지우는 것이지 개체를 지우는 것이 아니다.
      await s.press('Delete');
      // 클립보드에는 앞 서브테스트에서 복사한 개체가 남아 있다 — 편집 중이면 붙여넣기가
      // 개체를 만들지 않고 브라우저 기본 텍스트 붙여넣기로 흘러야 한다.
      await s.press('v', { ctrl: true });
      await sleep(1200); // "아무 일도 안 일어남"은 폴링으로 못 잡는다 — 가라앉힌 뒤 단정한다.
      assert.equal(await s.evaluate(OBJ_COUNT), baseline, '편집 중 Delete·Ctrl+V 는 개체 수를 바꾸지 않는다');

      // Esc 는 2단계여야 한다: 1회 = 편집 종료(선택은 유지), 2회 = 선택 해제.
      // Esc 를 부모/iframe 양쪽에서 처리하면 두 단계가 한 번에 일어나 이 단정이 깨진다.
      await s.press('Escape');
      await s.waitFor(`${EDITING_COUNT} === 0`, { message: 'Esc 1회 = 편집 종료' });
      assert.equal(await s.evaluate(SELECTED_COUNT), 1, 'Esc 1회로는 선택이 풀리지 않는다(2단계)');
      await s.press('Escape');
      assert.equal(await s.evaluate(SELECTED_COUNT), 0, 'Esc 2회째에 선택 해제');
    });

    await t.test('Ctrl+S → 저장 커밋(리비전 증가 + 배너)', async () => {
      const revBefore = await s.evaluate(`document.getElementById('doc-rev').textContent`);
      await s.press('s', { ctrl: true });
      await s.waitFor(`!!document.body.dataset.savedRevision`, { message: 'Ctrl+S 저장 커밋' });
      const revAfter = await s.evaluate(`document.getElementById('doc-rev').textContent`);
      assert.notEqual(revAfter, revBefore, `리비전 표시 갱신(${revBefore} → ${revAfter})`);
      const banner = await s.evaluate(`(() => {
        const b = document.getElementById('save-banner');
        return { hidden: b.classList.contains('hidden'), text: b.textContent };
      })()`);
      assert.equal(banner.hidden, false, '저장 배너 노출');
      assert.match(banner.text, /저장/, `배너 문구: ${banner.text}`);
    });

    await t.test('실입력 전 과정에서 콘솔 에러 0', () => {
      assert.deepEqual(s.consoleErrors, [], `콘솔 에러: ${s.consoleErrors.join(' | ')}`);
    });
  } finally {
    await s.close();
    await new Promise((r) => server.close(r));
    ws.cleanup();
  }
});
