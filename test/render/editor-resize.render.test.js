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

// 개체 크기 조정 **실입력** 검증(2026-07-28 — docs/DECISION-object-resize.md).
//
// 왜 실마우스인가: 이 리포에서 드래그는 합성 이벤트로 검증되지 않는다. `dispatchEvent` 는 hit-test 와
// `pointer-events` 를 건너뛰므로, 손잡이가 다른 요소에 덮여 있거나 포인터 캡처가 끊겨도 통과한다 —
// 직전 세션에서 그 방식으로만 잡힌 버그가 2건이다. 그래서 여기서는
//   ① 서버를 `testSeed:false` 로 띄우고(시드 훅 없는 실제 편집기)
//   ② 진짜 마우스로 손잡이를 끌고
//   ③ 단정은 **모델과 화면 양쪽**으로 한다(모델만 보면 "고쳤는데 화면은 그대로"를 놓친다).
//
// 줌은 100%(기본) 전제 — centerOf/handleAt 이 스테이지 scale 을 보정하지만, 보정 자체가 검증 대상은
// 아니므로 변수를 늘리지 않는다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();

const IFRAME_DOC = `document.querySelector('#stage iframe').contentDocument`;
const OBJ_COUNT = `${IFRAME_DOC}.querySelectorAll('[data-oid]').length`;
const SIZE_HANDLES = `${IFRAME_DOC}.querySelectorAll('.wg-size-handle').length`;

/** 뷰포트 좌표 변환(editor-shortcuts.render.test.js 의 centerOf 와 같은 스케일 보정). */
const viewportOf = (selector) => `(() => {
  const f = document.querySelector('#stage iframe');
  const fr = f.getBoundingClientRect();
  const scale = fr.width / f.offsetWidth;
  const el = f.contentDocument.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const er = el.getBoundingClientRect();
  return { x: fr.left + (er.left + er.width / 2) * scale, y: fr.top + (er.top + er.height / 2) * scale };
})()`;

const centerOf = (oid) => viewportOf(`[data-oid=${JSON.stringify(oid)}]`);
const handleAt = (dir) => viewportOf(`.wg-size-handle.wg-sh-${dir}`);

/** 화면에 실제로 적용된 폭(%) — 렌더가 인라인으로 낸 style 을 읽는다(모델이 아니라 화면). */
const renderedWidthPct = (oid) => `(() => {
  const el = ${IFRAME_DOC}.querySelector('[data-oid=${JSON.stringify(oid)}]');
  const m = /width:\\s*([0-9.]+)%/.exec(el?.getAttribute('style') || '');
  return m ? parseFloat(m[1]) : null;
})()`;

/** 저장된 문서의 필드(모델) — /shell.json 재조회. */
async function docField(url, oid, field) {
  const res = await fetch(`${url}/shell.json`);
  const shell = await res.json();
  for (const p of shell.document.pages) {
    const o = p.flow.find((x) => x.id === oid);
    if (o) return o[field];
  }
  return undefined;
}

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '크기 조정 실입력',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>첫째 문단 — 크기 조정 대상이 아닌 개체입니다.</p>' },
        {
          id: 'tb1', type: 'table', placement: 'flow', splittable: false,
          rows: [[{ text: '항목' }, { text: '내용' }], [{ text: '가' }, { text: '나' }]],
        },
        { id: 'sp1', type: 'spacer', placement: 'flow', heightMm: 10 },
      ],
      float: [],
    }],
  };
}

async function startEditServer() {
  const ws = await makeTmpDir('wsg-resize-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: ws.dir });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-28T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}`, ws };
}

test('개체 크기 조정 실입력: 진짜 마우스로 손잡이를 끌어 폭이 바뀐다', { skip: !HAS_CHROME, timeout: 240000 }, async (t) => {
  const { server, url, ws } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-resize-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${OBJ_COUNT} > 0`, { message: 'teacher iframe 개체 렌더(빈 화면 회귀 방어)' });

    await t.test('선택 전에는 크기 손잡이가 없다', async () => {
      assert.equal(await s.evaluate(SIZE_HANDLES), 0, '아무것도 선택하지 않았으면 손잡이가 없어야 함');
    });

    await t.test('표를 선택하면 손잡이 3개(e·s·se)가 뜬다', async () => {
      const c = await s.evaluate(centerOf('tb1'));
      assert.ok(c, '표가 화면에 있어야 한다');
      await s.click(c.x, c.y);
      // flow 는 좌표가 없어 오른쪽·아래·모서리만 의미가 있다(자유 개체의 8방향과 다른 점).
      await s.waitFor(`${SIZE_HANDLES} === 3`, { message: '선택 시 크기 손잡이 3개' });
      for (const dir of ['e', 's', 'se']) {
        assert.ok(await s.evaluate(handleAt(dir)), `${dir} 손잡이가 화면에 있어야 함`);
      }
    });

    await t.test('크기를 받지 않는 타입(spacer)에는 손잡이가 뜨지 않는다', async () => {
      const c = await s.evaluate(centerOf('sp1'));
      if (c) {
        await s.click(c.x, c.y);
        assert.equal(await s.evaluate(SIZE_HANDLES), 0, 'spacer 는 heightMm 를 이미 가지므로 크기 손잡이 대상이 아니다');
      }
    });

    await t.test('e 손잡이를 왼쪽으로 끌면 폭이 줄고 모델·화면 모두에 반영된다', async () => {
      const c = await s.evaluate(centerOf('tb1'));
      await s.click(c.x, c.y);
      await s.waitFor(`${SIZE_HANDLES} === 3`, { message: '표 재선택' });

      const before = await docField(url, 'tb1', 'widthPct');
      assert.equal(before, undefined, '전제: 아직 폭 지정 없음');

      const h = await s.evaluate(handleAt('e'));
      assert.ok(h, 'e 손잡이 좌표');
      // 왼쪽으로 180px — 실제 사용자처럼 여러 스텝으로 나눠 끈다.
      await s.drag(h.x, h.y, h.x - 180, h.y);

      // 저장을 명시적으로 시킨다. 편집 결과는 저장 전까지 **메모리에만** 있고 /shell.json 은 디스크를
      // 읽는다 — 이 단계를 빼면 "드래그가 동작하는데 실패"로 오진한다(실제로 그렇게 한 번 오진했다).
      // 덤으로 드래그 → 저장 경로까지 한 번에 확인된다.
      await s.press('s', { ctrl: true });
      await s.waitFor(`(async () => {
        const r = await fetch('/shell.json'); const j = await r.json();
        for (const p of j.document.pages) { const o = p.flow.find(x => x.id === 'tb1'); if (o) return typeof o.widthPct === 'number'; }
        return false;
      })()`, { message: '드래그 결과가 저장되어야 함' });

      // 모델: 저장된 문서에 폭이 실렸는가(클램프 범위 안)
      const after = await s.evaluate(`(async () => {
        const r = await fetch('/shell.json'); const j = await r.json();
        for (const p of j.document.pages) { const o = p.flow.find(x => x.id === 'tb1'); if (o) return o.widthPct ?? null; }
        return null;
      })()`);
      assert.ok(typeof after === 'number', `드래그 후 widthPct 가 실려야 함(실측: ${after})`);
      assert.ok(after < 100, `폭이 줄어야 함(실측 ${after}%)`);
      assert.ok(after >= 5, `클램프 하한을 지켜야 함(실측 ${after}%)`);

      // 화면: 렌더가 인라인 style 로 실제 반영했는가(모델만 보면 "고쳤는데 화면은 그대로"를 놓친다)
      await s.waitFor(`${renderedWidthPct('tb1')} !== null`, { message: '화면에 폭 선언 반영' });
      const shown = await s.evaluate(renderedWidthPct('tb1'));
      assert.ok(Math.abs(shown - after) < 0.51, `화면(${shown}%)과 모델(${after}%)이 같아야 함`);
    });

    await t.test('콘솔 오류 없음(ESM 그래프 404·백지 회귀 방어)', async () => {
      // 새 import(/src/domain/schema/index.js)가 browserGraph 화이트리스트 밖이면 404 → 편집기 백지.
      const errors = s.consoleErrors.filter((e) => !/favicon/i.test(e));
      assert.deepEqual(errors, [], `콘솔 오류: ${errors.join(' | ')}`);
    });
  } finally {
    await s.close();
    await new Promise((r) => server.close(r));
    await ws.cleanup();
  }
});
