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

// flow 개체 ⠿ 손잡이 실입력 회귀(2026-07-28 — DECISION-object-resize §7 선행 결함 1).
//
// 고치기 전 실측(scratchpad/probe-flow-body-drag.mjs 2.3 이 "깨진 동작"으로 고정해 두었던 것):
//   ① 손잡이 4개가 전부 같은 y(top=23)에 쌓였다 — 개체는 82/116/132/166 인데. attach() 가
//      레이아웃 확정 전에 한 번 장식하고 다시 그리지 않아서다.
//   ② 좌표를 고쳐도 ⠿ 중심에서 elementFromPoint 가 `+`(.wg-flow-insert)를 돌려줬다 —
//      둘 다 left:-22px 이고 컨트롤 높이(18px)가 개체 높이(20px)와 맞먹어 세로로 갈라 놓을
//      공간이 없었다. divider(2px)는 완전히 겹쳤다.
// 두 결함 다 **실마우스로만** 드러난다 — dispatchEvent 는 hit-test 를 건너뛰므로 합성 이벤트
// 테스트는 겹쳐 있어도 통과한다(MEMORY: synthetic-events-hide-drag-bugs).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;

/** 손잡이·+ 버튼의 배치와 그 지점의 최상위 요소를 한 번에 읽는다(모델이 아니라 화면). */
const HANDLE_REPORT = `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect();
  const scale = fr.width / f.offsetWidth;
  return JSON.stringify([...d.querySelectorAll('.wg-flow-handle')].map((h) => {
    const oid = h.dataset.forOid;
    const hr = h.getBoundingClientRect();
    const plus = d.querySelector('.wg-flow-insert[data-for-oid="' + oid + '"]');
    const pr = plus ? plus.getBoundingClientRect() : null;
    const objEl = d.querySelector('.wg-obj[data-oid="' + oid + '"]');
    const or = objEl ? objEl.getBoundingClientRect() : null;
    const cx = hr.left + hr.width / 2;
    const cy = hr.top + hr.height / 2;
    const hit = d.elementFromPoint(cx, cy);
    return {
      oid,
      objTop: or ? Math.round(or.top) : null,
      handleTop: Math.round(hr.top),
      hit: hit ? String(hit.className || hit.tagName) : null,
      plusCx: pr ? Math.round(fr.left + (pr.left + pr.width / 2) * scale) : null,
      plusCy: pr ? Math.round(fr.top + (pr.top + pr.height / 2) * scale) : null,
      vx: Math.round(fr.left + cx * scale),
      vy: Math.round(fr.top + cy * scale),
    };
  }));
})()`;

const FLOW_ORDER = `[...${IFR}.contentDocument.querySelectorAll('.wg-obj[data-oid]')].map((e) => e.dataset.oid).join(',')`;

/** 조작 칩(⠿·+)의 계산된 opacity 를 개체별로 읽는다 — "보이는가"는 클래스가 아니라 이걸로 판정한다. */
const CHIP_OPACITY = `(() => {
  const d = ${IFR}.contentDocument; const v = d.defaultView;
  const out = {};
  for (const el of d.querySelectorAll('.wg-flow-handle, .wg-flow-insert')) {
    const kind = el.classList.contains('wg-flow-handle') ? 'handle' : 'plus';
    out[el.dataset.forOid + ':' + kind] = Number(v.getComputedStyle(el).opacity);
  }
  return JSON.stringify(out);
})()`;

/** 뷰포트 좌표(줌 스케일 보정) — 실마우스에 넘길 값. */
const viewportCenterOf = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const el = d.querySelector(${JSON.stringify(selector)});
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(fr.left + (r.left + r.width / 2) * scale), y: Math.round(fr.top + (r.top + r.height / 2) * scale) });
})()`;

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '손잡이 실입력',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 'a1', type: 'richtext', placement: 'flow', html: '<p>첫째 문단</p>' },
        // divider 는 높이 2px — 종전 세로 배치로는 ⠿ 와 + 가 100% 겹치던 최악의 케이스.
        { id: 'a2', type: 'divider', placement: 'flow' },
        { id: 'a3', type: 'richtext', placement: 'flow', html: '<p>셋째 문단</p>' },
        { id: 'a4', type: 'richtext', placement: 'flow', html: '<p>넷째 문단</p>' },
      ],
      float: [],
    }],
  };
}

async function startEditServer() {
  const base = await autoTmpDir('wsg-flowhandle-render-');
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

test('⠿ 손잡이: 최초 장식부터 개체별 제자리에 놓이고 + 에 덮이지 않는다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-flowhandle-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelectorAll('.wg-flow-handle').length === 4`, { message: '손잡이 렌더' });

    // 선택을 건드리지 않은 **최초 상태**에서 읽는다 — 종전 결함은 재장식 한 번이면 가려졌다.
    const rows = JSON.parse(await s.evaluate(HANDLE_REPORT));
    assert.equal(rows.length, 4);

    const tops = new Set(rows.map((r) => r.handleTop));
    assert.equal(tops.size, 4, `손잡이가 개체마다 다른 y 에 있어야 한다(쌓임 회귀) — ${JSON.stringify(rows.map((r) => r.handleTop))}`);
    for (const r of rows) {
      assert.equal(r.handleTop, r.objTop, `${r.oid}: 손잡이 y 가 개체 상단과 같아야 한다`);
      assert.equal(r.hit, 'wg-flow-handle', `${r.oid}: 손잡이 중심의 최상위가 손잡이여야 한다(+ 가 덮으면 끌 수 없다)`);
    }
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});

test('⠿ 손잡이: 실마우스로 끌면 flow 순서가 바뀐다(재장식 없이 최초 상태에서)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-flowhandle-drag-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelectorAll('.wg-flow-handle').length === 4`, { message: '손잡이 렌더' });

    const before = await s.evaluate(FLOW_ORDER);
    assert.equal(before, 'a1,a2,a3,a4');

    const rows = JSON.parse(await s.evaluate(HANDLE_REPORT));
    const src = rows.find((r) => r.oid === 'a3');
    const dst = rows.find((r) => r.oid === 'a1');
    await s.drag(src.vx, src.vy, dst.vx, dst.vy - 30, { steps: 14 });

    const after = await s.evaluate(FLOW_ORDER);
    assert.notEqual(after, before, `⠿ 드래그가 순서를 바꿔야 한다 — ${after}`);
    assert.ok(after.startsWith('a3'), `a3 가 맨 앞으로 와야 한다 — ${after}`);
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});

test('조작 칩: 평소엔 안 보이고 가리킨 개체의 것만 드러난다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-flowhandle-hover-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelectorAll('.wg-flow-handle').length === 4`, { message: '칩 렌더' });

    // ① 아무 데도 안 가리킨 상태 — 여백이 비어 있어야 한다(상시 노출이 사용자 불만의 실체였다).
    const atRest = JSON.parse(await s.evaluate(CHIP_OPACITY));
    assert.equal(Object.keys(atRest).length, 8, '개체 4개 × (⠿·+) = 8개 칩');
    for (const [key, op] of Object.entries(atRest)) {
      assert.equal(op, 0, `${key}: 가리키기 전에는 보이지 않아야 한다 — ${op}`);
    }

    // ② a3 를 가리키면 a3 것만 드러난다.
    const a3 = JSON.parse(await s.evaluate(viewportCenterOf('.wg-obj[data-oid="a3"]')));
    await s.hover(a3.x, a3.y);
    const hovered = JSON.parse(await s.evaluate(CHIP_OPACITY));
    assert.ok(hovered['a3:handle'] > 0, `가리킨 개체의 ⠿ 는 보여야 한다 — ${hovered['a3:handle']}`);
    assert.ok(hovered['a3:plus'] > 0, `가리킨 개체의 + 도 보여야 한다 — ${hovered['a3:plus']}`);
    for (const oid of ['a1', 'a2', 'a4']) {
      assert.equal(hovered[`${oid}:handle`], 0, `${oid}: 가리키지 않은 개체의 칩은 숨어 있어야 한다`);
      assert.equal(hovered[`${oid}:plus`], 0, `${oid}: 가리키지 않은 개체의 + 도 숨어 있어야 한다`);
    }

    // ③ 개체를 벗어나 칩 위로 옮겨도 유지된다 — 여기서 꺼지면 손잡이에 다가가는 도중 사라져 못 잡는다.
    const chip = JSON.parse(await s.evaluate(viewportCenterOf('.wg-flow-handle[data-for-oid="a3"]')));
    await s.hover(chip.x, chip.y);
    const onChip = JSON.parse(await s.evaluate(CHIP_OPACITY));
    assert.ok(onChip['a3:handle'] > 0, `칩 위로 옮기면 유지되어야 한다 — ${onChip['a3:handle']}`);
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});

test('+ 삽입 버튼: 가로로 비켜 놓아도 여전히 눌리고 삽입 메뉴가 열린다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-flowhandle-plus-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelectorAll('.wg-flow-insert').length === 4`, { message: '+ 렌더' });

    const rows = JSON.parse(await s.evaluate(HANDLE_REPORT));
    const target = rows.find((r) => r.oid === 'a1');
    assert.ok(target.plusCx !== null, '+ 버튼 좌표를 읽을 수 있어야 한다');

    await s.click(target.plusCx, target.plusCy);
    await s.waitFor(`document.body.dataset.slashOpen === 'true'`, { message: '삽입 메뉴 열림' });
    const count = await s.evaluate(`document.body.dataset.slashCount`);
    assert.ok(Number(count) > 0, `삽입 메뉴 항목이 있어야 한다 — ${count}`);
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});
