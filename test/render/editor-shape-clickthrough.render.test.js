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

// 도형 클릭 가로채기(HANDOFF-object-schema §8 의 미해결 항목, 2026-07-28 해소).
//
// 증상: 도형이 본문 위를 덮으면 아래 flow 개체를 클릭할 수 없었다. 마크업이
// div.wg-shape > svg > (rect|ellipse|line) 인데 div 와 svg 루트가 블록 박스라 rect 전면에서
// 이벤트를 먹는다 — fill:none 인 테두리 도형의 **빈 속**을 눌러도 도형이 선택됐다(실측).
//
// 해소: 박스 두 겹을 pointer-events:none 으로 통과시키고 실제 그려진 요소만
// visiblePainted 로 남긴다. 그러면 "채운 도형은 자기가 잡고, 테두리 도형은 선만 잡는다"가
// 별도 분기 없이 성립한다 — 도형은 배경으로 깔라고 있는 타입이라는 성격(겹침 advisory 제외)과도
// 맞는다.
//
// **실마우스로만 드러난다**: dispatchEvent 는 hit-test 를 건너뛰므로 합성 이벤트로는 덮여 있어도
// 통과한다(MEMORY: synthetic-events-hide-drag-bugs).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '도형 클릭 통과',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'f1', type: 'richtext', placement: 'flow', html: '<p>테두리 도형에 덮인 문단</p>' },
        { id: 'f2', type: 'richtext', placement: 'flow', html: '<p>채운 도형에 덮인 문단</p>' },
      ],
      float: [
        { id: 'sh-open', type: 'shape', placement: 'float', shapeKind: 'rect', fillColor: 'none',
          rect: { xMm: 15, yMm: 15, wMm: 120, hMm: 14 } },
        { id: 'sh-fill', type: 'shape', placement: 'float', shapeKind: 'rect', fillColor: '#ffe08a',
          rect: { xMm: 15, yMm: 24, wMm: 120, hMm: 18 } },
      ],
    }],
  };
}

/** flow 개체와 도형이 실제로 겹치는 지점(뷰포트 좌표). 픽스처 좌표를 눈대중으로 믿지 않는다. */
const overlapPoint = (flowId, shapeId) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const a = d.querySelector('.wg-obj[data-oid="${flowId}"]').getBoundingClientRect();
  const b = d.querySelector('.wg-float[data-oid="${shapeId}"]').getBoundingClientRect();
  const overlaps = Math.min(a.right, b.right) > Math.max(a.left, b.left)
    && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  const x = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
  const y = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  return JSON.stringify({ overlaps, x: Math.round(fr.left + x * scale), y: Math.round(fr.top + y * scale) });
})()`;

const centerOf = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const r = d.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return JSON.stringify({ x: Math.round(fr.left + (r.left + r.width / 2) * scale), y: Math.round(fr.top + (r.top + r.height / 2) * scale) });
})()`;

const SELECTED = `([...${IFR}.contentDocument.querySelectorAll('.wg-selected[data-oid]')].map((e) => e.dataset.oid).join(',') || '(none)')`;

async function startEditServer() {
  const base = await autoTmpDir('wsg-shapeclick-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-28T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

test('도형 클릭 통과: 테두리 도형의 빈 속은 아래 본문이 눌리고, 채운 도형은 자기가 눌린다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-shapeclick-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelectorAll('.wg-shape').length === 2`, { message: '도형 렌더' });

    // ① fill:none — 빈 속을 누르면 아래 flow 개체가 잡혀야 한다.
    const openPt = JSON.parse(await s.evaluate(overlapPoint('f1', 'sh-open')));
    assert.equal(openPt.overlaps, true, '픽스처 전제: 테두리 도형이 f1 을 덮는다');
    await s.click(openPt.x, openPt.y);
    assert.equal(await s.evaluate(SELECTED), 'f1',
      '테두리 도형의 빈 속 클릭은 아래 문단으로 통과해야 한다');

    // ② 채운 도형 — 불투명하니 자기가 잡혀야 한다(통과시키면 도형을 못 고른다).
    const fillPt = JSON.parse(await s.evaluate(overlapPoint('f2', 'sh-fill')));
    assert.equal(fillPt.overlaps, true, '픽스처 전제: 채운 도형이 f2 를 덮는다');
    await s.click(fillPt.x, fillPt.y);
    assert.equal(await s.evaluate(SELECTED), 'sh-fill',
      '채운 도형은 자기가 잡혀야 한다');
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});

test('도형 클릭 통과: 테두리 도형도 손잡이로는 여전히 선택된다(고립되지 않는다)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-shapeclick-handle-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelector('.wg-float[data-oid="sh-open"] > .wg-float-handle') !== null`,
      { message: '도형 손잡이' });

    // 몸통이 통과되도록 바뀌었으니, 조작 진입점이 남아 있는지가 관건이다.
    const chip = JSON.parse(await s.evaluate(centerOf('.wg-float[data-oid="sh-open"] > .wg-float-handle')));
    await s.hover(chip.x, chip.y);
    await s.click(chip.x, chip.y);
    assert.equal(await s.evaluate(SELECTED), 'sh-open',
      '손잡이 클릭으로 테두리 도형을 선택할 수 있어야 한다');
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});
