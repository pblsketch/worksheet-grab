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

// 회전 개체 리사이즈 축 보정(2026-07-28 — DECISION-object-resize §7 잔여 항목).
//
// 손잡이는 `.wg-float` 의 자식이라 transform:rotate() 를 함께 받아 **화면 위치는 원래 맞았다**.
// 틀렸던 것은 계산이다 — 화면 델타를 그대로 wMm/hMm 에 더하면 돌린 개체에서 폭과 높이가 뒤섞이고,
// 잡지 않은 반대편 변이 화면에서 밀려난다.
//
// 여기서 단정하는 성질은 각도와 무관하게 말이 되는 것 하나다: **반대편 변은 제자리에 있어야 한다.**
// (오른쪽을 끌면 왼쪽 변은 화면에서 움직이지 않는다.) 'w' 손잡이는 서쪽 변 한가운데에 붙으므로
// 그 화면 좌표를 그대로 지표로 쓴다.
//
// 실마우스가 필요하다 — 합성 이벤트는 hit-test 를 건너뛰어 손잡이 위치 문제를 통과시킨다
// (MEMORY: synthetic-events-hide-drag-bugs).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;

function fixtureDocument(angle) {
  return {
    pagination: 'paginated',
    docTitle: '회전 리사이즈',
    subject: 'korean', dataSubject: 'korean', themeName: 'ko', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [{ id: 'a1', type: 'richtext', placement: 'flow', html: '<p>본문</p>' }],
      float: [{
        id: 'fl1', type: 'answer-area', placement: 'float', style: 'box', label: '메모',
        angle, rect: { xMm: 70, yMm: 120, wMm: 60, hMm: 40 },
      }],
    }],
  };
}

const centerOf = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: fr.left + (r.left + r.width / 2) * scale, y: fr.top + (r.top + r.height / 2) * scale });
})()`;

const RECT = `(() => {
  const el = ${IFR}.contentDocument.querySelector('.wg-float[data-oid="fl1"]');
  return JSON.stringify({ left: el.style.left, top: el.style.top, w: el.style.width, h: el.style.height });
})()`;

const mm = (v) => Number(String(v).replace('mm', ''));

async function startEditServer(angle) {
  const base = await autoTmpDir('wsg-floatrot-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(angle), now: new Date('2026-07-28T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

/** 개체를 선택해 리사이즈 손잡이를 띄우고, 지정한 손잡이를 끌어 전후를 잰다. */
async function dragHandle(s, dir, dx, dy) {
  const body = JSON.parse(await s.evaluate(centerOf('.wg-float[data-oid="fl1"]')));
  await s.click(Math.round(body.x), Math.round(body.y));
  await s.waitFor(`${IFR}.contentDocument.querySelectorAll('.wg-float[data-oid="fl1"] > .wg-resize-handle').length === 8`,
    { message: '리사이즈 손잡이' });

  const westBefore = JSON.parse(await s.evaluate(centerOf('.wg-float[data-oid="fl1"] > .wg-rh-w')));
  const rectBefore = JSON.parse(await s.evaluate(RECT));
  const grip = JSON.parse(await s.evaluate(centerOf(`.wg-float[data-oid="fl1"] > .wg-rh-${dir}`)));

  await s.drag(Math.round(grip.x), Math.round(grip.y), Math.round(grip.x + dx), Math.round(grip.y + dy), { steps: 14 });

  const westAfter = JSON.parse(await s.evaluate(centerOf('.wg-float[data-oid="fl1"] > .wg-rh-w')));
  const rectAfter = JSON.parse(await s.evaluate(RECT));
  return { westBefore, westAfter, rectBefore, rectAfter };
}

const dragEastHandle = (s, dx, dy) => dragHandle(s, 'e', dx, dy);

test('회전 개체 리사이즈: 동쪽을 끌어도 서쪽 변이 화면에서 제자리에 있다(45°)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer(45);
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-floatrot-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelector('.wg-float[data-oid="fl1"]') !== null`, { message: 'float 렌더' });

    // 45° 개체의 로컬 +x 는 화면에서 (+1,+1)/√2 방향 — 그쪽으로 끌면 "폭만" 늘어야 한다.
    const r = await dragEastHandle(s, 42, 42);

    const drift = Math.hypot(r.westAfter.x - r.westBefore.x, r.westAfter.y - r.westBefore.y);
    assert.ok(drift < 6,
      `서쪽 변이 밀리면 안 된다 — ${drift.toFixed(1)}px 이동 (before ${JSON.stringify(r.westBefore)} after ${JSON.stringify(r.westAfter)})`);

    assert.ok(mm(r.rectAfter.w) > mm(r.rectBefore.w) + 5,
      `폭이 늘어야 한다 — ${r.rectBefore.w} → ${r.rectAfter.w}`);
    assert.ok(Math.abs(mm(r.rectAfter.h) - mm(r.rectBefore.h)) < 3,
      `로컬 +x 로 끌었으니 높이는 거의 그대로여야 한다 — ${r.rectBefore.h} → ${r.rectAfter.h}`);
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});

test('회전 개체 리사이즈: 모서리를 로컬 +x 방향으로 끌면 폭만 는다(축이 뒤섞이지 않는다)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer(45);
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-floatrot-se-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelector('.wg-float[data-oid="fl1"]') !== null`, { message: 'float 렌더' });

    // se 손잡이는 폭·높이를 **둘 다** 잡는다(sx=1, sy=1). 45° 개체의 로컬 +x 는 화면 (+1,+1) 방향이라
    // 그쪽으로 끌면 로컬 세로 성분이 0 이다 — 축 변환이 맞으면 **높이는 그대로**여야 한다.
    // 화면 델타를 그대로 쓰면(축 변환 없음) 폭과 높이가 같이 늘어나 이 단정이 깨진다.
    const r = await dragHandle(s, 'se', 42, 42);

    assert.ok(mm(r.rectAfter.w) > mm(r.rectBefore.w) + 5,
      `폭은 늘어야 한다 — ${r.rectBefore.w} → ${r.rectAfter.w}`);
    assert.ok(Math.abs(mm(r.rectAfter.h) - mm(r.rectBefore.h)) < 3,
      `높이는 그대로여야 한다(축이 뒤섞이면 같이 는다) — ${r.rectBefore.h} → ${r.rectAfter.h}`);
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});

test('회전 0 개체 리사이즈: 종전 동작 그대로(회전 보정이 기존 경로를 건드리지 않았다)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, url } = await startEditServer(0);
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-floatrot0-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${IFR}.contentDocument.querySelector('.wg-float[data-oid="fl1"]') !== null`, { message: 'float 렌더' });

    const r = await dragEastHandle(s, 60, 0);

    // 회전이 없으면 x/y 는 아예 안 바뀌고 폭만 는다 — 종전 식의 성질 그대로.
    assert.equal(r.rectAfter.left, r.rectBefore.left, '좌상단 x 불변');
    assert.equal(r.rectAfter.top, r.rectBefore.top, '좌상단 y 불변');
    assert.equal(r.rectAfter.h, r.rectBefore.h, '높이 불변');
    assert.ok(mm(r.rectAfter.w) > mm(r.rectBefore.w) + 5, `폭이 늘어야 한다 — ${r.rectBefore.w} → ${r.rectAfter.w}`);

    const drift = Math.hypot(r.westAfter.x - r.westBefore.x, r.westAfter.y - r.westBefore.y);
    assert.ok(drift < 6, `서쪽 변 제자리 — ${drift.toFixed(1)}px`);
  } finally {
    await new Promise((r) => server.close(r));
    await s.close();
  }
});
