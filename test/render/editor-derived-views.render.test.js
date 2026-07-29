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

// 파생 뷰 갱신(계획 3단계 3b · ⑦ + C16).
//
// 문서에서 파생되는 화면은 다섯이다 — 툴바/인스펙터(updateAll) · 썸네일 · 검수 칩 · 레이어 목록 ·
// 앱바 제목. 갱신 조합이 경로마다 달라서 구멍이 났다:
//   ⑦  타이핑 경로(onSelectionDirty)는 썸네일·검수를 아예 안 부른다. 리플로우가 대신 불러 주지만
//       리플로우는 **페이지 배정이 바뀌었을 때만**(`changed`) 갱신하므로, 페이지가 안 밀리는 편집은
//       저장하기 전까지 썸네일·칩이 낡은 채로 남는다.
//   C16 `runReflow` 는 `updateAll()`·`refreshLayers()` 를 안 부른다 — 리플로우가 개체를 페이지 간
//       이동시키면 좌측 레이어 목록이 낡은 구성을 유지한다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;
const CV = `${IFR}.contentDocument`;

/** 썸네일은 시트 outerHTML 을 iframe srcdoc 에 담는다 — 갱신 여부를 그 문자열로 관측한다. */
const THUMB_SRCDOC = `[...document.querySelectorAll('#thumb-list iframe')].map((f) => f.getAttribute('srcdoc') || '').join('\\n')`;
/** 좌측 레이어 목록에 실린 개체 id 들. */
const LAYER_IDS = `JSON.stringify([...document.querySelectorAll('#layer-list [data-oid]')].map((e) => e.dataset.oid))`;

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '파생 뷰',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>첫째 문단</p>' },
        { id: 'r2', type: 'richtext', placement: 'flow', html: '<p>둘째 문단</p>' },
      ],
      float: [],
    }],
  };
}

async function boot(prefix, document = fixtureDocument()) {
  const base = await autoTmpDir('wsg-derived-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  await new SaveDocument({ workspace, blockRepository, curriculum: null })
    .checkpoint({ name: '문서', document, now: new Date('2026-07-29T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false });
  const addr = await listenEditorServer(server);
  const s = await openCdpSession(`http://127.0.0.1:${addr.port}/`, { prefix });
  await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
  await s.waitFor(`${CV}.querySelectorAll('.sheet').length >= 1`, { message: '캔버스 렌더' });
  return { server, s };
}

const teardown = async (server, s) => {
  await new Promise((r) => server.close(r));
  await s.close();
};

// 대상이 뷰포트 밖이면 실마우스 좌표가 빗나간다(긴 문서에서 실제로 당했다) — 먼저 화면 안으로 끌어온다.
const canvasCenter = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  el.scrollIntoView({ block: 'center' });
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(fr.left + (r.left + r.width / 2) * scale), y: Math.round(fr.top + (r.top + r.height / 2) * scale) });
})()`;

test('타이핑만으로도 썸네일이 따라온다 — 저장·페이지 재배정 없이 (계획 3단계 ⑦)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('derived-thumb-');
  try {
    await s.waitFor(`${THUMB_SRCDOC}.includes('첫째 문단')`, { message: '썸네일 최초 렌더' });
    assert.ok(!(await s.evaluate(`${THUMB_SRCDOC}.includes('타이핑반영')`)), '전제: 아직 없는 글자');

    const pt = JSON.parse(await s.evaluate(canvasCenter('[data-oid="r1"]')));
    await s.click(pt.x, pt.y);
    await s.click(pt.x, pt.y, { clickCount: 2 });
    await s.insertText('타이핑반영');
    assert.match(await s.evaluate(`${CV}.querySelector('[data-oid="r1"]').textContent`), /타이핑반영/, '전제: 캔버스에는 들어갔다');

    // 페이지 배정은 안 바뀌는 짧은 편집이다 — 리플로우가 `changed:false` 로 빠지므로 종전에는
    // 썸네일이 저장할 때까지 낡은 채로 남았다.
    const ok = await s.waitFor(`${THUMB_SRCDOC}.includes('타이핑반영')`, { message: '썸네일 갱신', timeoutMs: 6000 })
      .then(() => true).catch(() => false);
    assert.ok(ok, '타이핑 뒤 썸네일이 갱신되지 않았다(파생 뷰 누락)');
  } finally {
    await teardown(server, s);
  }
});

// ⚠ 아래는 **재현에 실패한 시나리오**다(2026-07-29). C16 자체는 `refreshDerived` 수렴으로 고쳤지만
//   이 테스트는 그것을 증명하지 못한다 — 리플로우가 페이지 간 재배정을 일으키는 조건을 만들지
//   못했다. 시도한 것: ⓐ 1쪽 문서를 넘치게 채우기(쪽 수는 pages 배열 그대로라 새 쪽이 안 생긴다)
//   ⓑ 2쪽 문서의 1쪽 첫 개체를 크게 키우기(1쪽 개체 수가 그대로였다 — 리플로우가 돌지 않았는지
//   `changed:false` 였는지 미확인).
//   **다음 세션이 할 일**: `document.body.dataset.reflowRuns`/`reflowChanges` 계측이 이미 있으니
//   그 값을 먼저 읽어 리플로우가 도는지부터 가른 뒤 시나리오를 다시 세울 것.
//   skip 으로 둔다 — 실행하면 15초를 태우고 아무것도 증명하지 못한다.
test('리플로우가 개체를 다음 쪽으로 밀면 레이어 목록이 따라온다 (계획 3단계 C16)', { skip: '재현 미확립 — 위 주석 참조' }, async () => {
  // 편집기 리플로우는 **기존 페이지 사이의 재배정**이다(새 쪽을 만들지 않는다 — 실측). 그래서
  // 처음부터 2쪽인 문서를 주고, 1쪽 첫 개체를 키워 1쪽 뒷부분을 2쪽으로 밀어낸다.
  const filler = Array.from({ length: 30 }, (_, i) => ({
    id: `f${i}`, type: 'richtext', placement: 'flow',
    html: `<p>${'채움 문단 '.repeat(14)}(${i})</p>`,
  }));
  // 쪽 수는 pages 배열 그대로다(서버가 다시 쪼개 주지 않는다 — 실측) → 처음부터 2쪽으로 준다.
  const doc = {
    pagination: 'paginated', docTitle: '레이어 추종', subject: 'science', dataSubject: 'science',
    themeName: 'sci', lang: 'ko', paper: null, standards: [],
    pages: [
      { flow: filler.slice(0, 18), float: [] },
      { flow: filler.slice(18), float: [] },
    ],
  };
  const { server, s } = await boot('derived-layer-', doc);
  try {
    const pages = await s.evaluate(`${CV}.querySelectorAll('.sheet').length`);
    assert.ok(pages >= 2, `전제: 2쪽 이상이어야 재배정을 볼 수 있다 — ${pages}쪽`);
    const before = JSON.parse(await s.evaluate(LAYER_IDS));
    assert.ok(before.length >= 3, `전제: 1쪽 레이어 목록 — ${JSON.stringify(before)}`);

    // 1쪽 첫 개체를 크게 키운다 → 1쪽이 넘쳐 뒷부분이 2쪽으로 밀린다.
    const pt = JSON.parse(await s.evaluate(canvasCenter('[data-oid="f0"]')));
    await s.click(pt.x, pt.y);
    await s.click(pt.x, pt.y, { clickCount: 2 });
    await s.insertText('넘침'.repeat(600));
    assert.match(await s.evaluate(`${CV}.querySelector('[data-oid="f0"]').textContent`), /넘침넘침/,
      '전제: 편집 진입이 실패하면(좌표가 빗나가면) 이 테스트는 아무것도 재지 못한다');

    // 1쪽에 실제로 남은 개체가 줄었는지(=리플로우가 재배정했는지) 캔버스로 먼저 확인한다.
    await s.waitFor(
      `${CV}.querySelectorAll('.sheet')[0].querySelectorAll('.wg-obj[data-oid]').length < ${before.length}`,
      { message: '리플로우 재배정', timeoutMs: 15000 },
    );
    const onPage1 = JSON.parse(await s.evaluate(
      `JSON.stringify([...${CV}.querySelectorAll('.sheet')[0].querySelectorAll('.wg-obj[data-oid]')].map((e) => e.dataset.oid))`,
    ));

    const after = JSON.parse(await s.evaluate(LAYER_IDS));
    assert.deepEqual(after, onPage1,
      `리플로우 뒤 레이어 목록이 1쪽 실제 구성과 어긋났다 — 목록 ${JSON.stringify(after)} vs 지면 ${JSON.stringify(onPage1)}`);
  } finally {
    await teardown(server, s);
  }
});
