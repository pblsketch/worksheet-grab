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

// 편집 가드·선택 유지 실입력 회귀(2026-07-28 — Codex 교차 점검 + 실 Chrome 프로브에서 나온 4건).
//
// 고치기 전 실측(scratchpad/probe08 이 "깨진 동작"으로 찍어 두었던 것):
//   D1 표 셀을 더블클릭해 편집 중 Backspace 1회 → **표가 통째로 사라졌다**(표 4→3).
//      학습목표 문장(.wg-part)도 같다 — std-box 1→0. 글자 하나 지우려던 키가 개체를 지웠다.
//   D2 크기 손잡이(se)를 끌면 크기는 바뀌지만 **선택이 해제**됐다(.wg-selected 0, 손잡이 0).
//      마퀴 판정이 오버레이 손잡이를 "빈 배경"으로 보고 같이 돌아, 드롭에서 선택을 빈 집합으로 덮었다.
//   D3 드래그 뒤 **다음 클릭 한 번이 통째로 먹혔다**(한 번 더 눌러야 선택이 바뀌었다).
//      드래그 종료 시 arm 한 swallowNextClick 을 소비할 click 이 끝내 오지 않아서다.
//   D4 flow 전용 타입(제목·학습목표 박스)에도 '자유 배치로 전환'이 활성 버튼으로 나오고,
//      눌러도 아무 일이 없었다(무동작).
//
// 넷 다 **실마우스·실키보드로만** 드러난다 — 합성 이벤트는 hit-test 와 포커스 경로를 건너뛰고,
// testSeed 는 내부 함수를 직접 불러 배선을 통과해 버린다(MEMORY: synthetic-events-hide-drag-bugs).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;
const CV = `${IFR}.contentDocument`;

const SELECTED = `JSON.stringify([...${CV}.querySelectorAll('.wg-selected')].map((e) => e.dataset.oid))`;
const countOf = (sel) => `${CV}.querySelectorAll(${JSON.stringify(sel)}).length`;

/** 뷰포트 좌표(줌 스케일 보정) — 실마우스에 넘길 값. */
const viewportCenterOf = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(fr.left + (r.left + r.width / 2) * scale), y: Math.round(fr.top + (r.top + r.height / 2) * scale) });
})()`;

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '편집 가드',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 't1', type: 'title', placement: 'flow', text: '탐구 활동' },
        { id: 's1', type: 'std-box', placement: 'flow', objectives: ['광합성 조건을 설명할 수 있다.'] },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문 문단</p>' },
        { id: 'b1', type: 'table', placement: 'flow', splittable: true, rows: [[{ text: '준비물' }, { text: '검정말' }]] },
        { id: 'r2', type: 'richtext', placement: 'flow', html: '<p>둘째 문단</p>' },
        { id: 'r3', type: 'richtext', placement: 'flow', html: '<p>셋째 문단</p>' },
      ],
      float: [],
    }],
  };
}

/** 자유 개체 2개 — 마퀴(빈 배경 드래그) 다중선택이 살아 있는지 확인하는 대조군. */
function fixtureWithFloats() {
  return {
    pagination: 'paginated',
    docTitle: '마퀴 대조군',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [{ id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문 문단</p>' }],
      float: [
        { id: 'fl1', type: 'answer-area', placement: 'float', style: 'box', label: '가', rect: { xMm: 25, yMm: 140, wMm: 40, hMm: 20 } },
        { id: 'fl2', type: 'answer-area', placement: 'float', style: 'box', label: '나', rect: { xMm: 90, yMm: 140, wMm: 40, hMm: 20 } },
      ],
    }],
  };
}

async function startEditServer(document = fixtureDocument()) {
  const base = await autoTmpDir('wsg-editguard-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document, now: new Date('2026-07-28T00:00:00.000Z') });
  const server = createEditorServer({
    root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false,
  });
  const addr = await listenEditorServer(server);
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

async function boot(prefix) {
  const { server, url } = await startEditServer();
  const s = await openCdpSession(`${url}/`, { prefix });
  await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
  await s.waitFor(`${countOf('[data-oid]')} === 6`, { message: '개체 렌더' });
  return { server, s };
}

const teardown = async (server, s) => {
  await new Promise((r) => server.close(r));
  await s.close();
};

test('편집 중 Backspace 는 글자만 지운다 — 표 셀도 조각도 개체를 삭제하지 않는다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, s } = await boot('wsg-editguard-del-chrome-');
  try {
    // ① 표 셀 — 더블클릭으로 셀 편집에 들어간 뒤 Backspace.
    const cell = JSON.parse(await s.evaluate(viewportCenterOf('[data-ot="table"] td')));
    await s.click(cell.x, cell.y);
    await s.click(cell.x, cell.y, { clickCount: 2 });
    await s.waitFor(`${countOf('[contenteditable="true"]')} === 1`, { message: '셀 편집 진입' });
    const before = await s.evaluate(`${CV}.querySelector('[data-ot="table"] td').textContent`);
    await s.press('Backspace');
    assert.equal(await s.evaluate(countOf('[data-ot="table"]')), 1, '표가 살아 있어야 한다(개체 삭제 회귀)');
    const after = await s.evaluate(`${CV}.querySelector('[data-ot="table"] td').textContent`);
    assert.ok(after.length < before.length, `셀 글자가 지워져야 한다 — "${before}" → "${after}"`);

    // ② 학습목표 문장 조각(.wg-part) — tableEdit 과 다른 모듈(partEdit)이라 따로 고정한다.
    await s.press('Escape');
    await s.press('Escape');
    const part = JSON.parse(await s.evaluate(viewportCenterOf('[data-ot="std-box"] .wg-part')));
    await s.click(part.x, part.y);
    await s.click(part.x, part.y, { clickCount: 2 });
    await s.waitFor(`${countOf('[contenteditable="true"]')} === 1`, { message: '조각 편집 진입' });
    await s.press('Backspace');
    assert.equal(await s.evaluate(countOf('[data-ot="std-box"]')), 1, '학습목표 박스가 살아 있어야 한다');
    assert.equal(await s.evaluate(countOf('[data-oid]')), 6, '개체 수가 그대로여야 한다');
  } finally {
    await teardown(server, s);
  }
});

test('편집이 아닌 선택 상태의 Delete 는 여전히 개체를 지우고 되돌릴 수 있다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, s } = await boot('wsg-editguard-delok-chrome-');
  try {
    const obj = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r3"]')));
    await s.click(obj.x, obj.y);
    assert.equal(await s.evaluate(SELECTED), '["r3"]');
    await s.press('Delete');
    await s.waitFor(`${countOf('[data-oid]')} === 5`, { message: '삭제 반영' });
    await s.press('z', { ctrl: true });
    await s.waitFor(`${countOf('[data-oid]')} === 6`, { message: 'undo 복원' });
  } finally {
    await teardown(server, s);
  }
});

test('크기 손잡이를 끌어도 선택이 유지돼 연속으로 조정할 수 있다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, s } = await boot('wsg-editguard-resize-chrome-');
  try {
    const obj = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r1"]')));
    await s.click(obj.x, obj.y);
    assert.equal(await s.evaluate(SELECTED), '["r1"]');
    await s.waitFor(`${countOf('.wg-size-handle')} === 3`, { message: '크기 손잡이 렌더' });

    const styleOf = `(${CV}.querySelector('[data-oid="r1"]').getAttribute('style') || '')`;
    const se1 = JSON.parse(await s.evaluate(viewportCenterOf('.wg-size-handle.wg-sh-se')));
    await s.drag(se1.x, se1.y, se1.x - 150, se1.y + 30, { steps: 14 });
    await s.waitFor(`${styleOf}.includes('width')`, { message: '폭 반영' });
    assert.equal(await s.evaluate(SELECTED), '["r1"]', '크기조정 뒤에도 선택이 남아야 한다');
    assert.equal(await s.evaluate(countOf('.wg-size-handle')), 3, '손잡이도 남아야 한다');
    const firstWidth = await s.evaluate(styleOf);

    // 두 번째 조정이 **재선택 없이** 바로 되는지 — 선택이 풀리면 여기서 손잡이를 못 찾는다.
    const se2 = JSON.parse(await s.evaluate(viewportCenterOf('.wg-size-handle.wg-sh-se')));
    await s.drag(se2.x, se2.y, se2.x - 80, se2.y, { steps: 12 });
    await s.waitFor(`${styleOf} !== ${JSON.stringify(firstWidth)}`, { message: '두 번째 폭 반영' });
    assert.equal(await s.evaluate(SELECTED), '["r1"]', '연속 조정 뒤에도 선택이 남아야 한다');
  } finally {
    await teardown(server, s);
  }
});

test('드래그 직후의 첫 클릭이 먹히지 않는다 — 본체 드래그·크기조정 둘 다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, s } = await boot('wsg-editguard-click-chrome-');
  try {
    // ① 본체 드래그로 재정렬한 뒤, 다른 개체를 **한 번** 클릭한다.
    const src = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r2"]')));
    const dst = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r1"]')));
    await s.click(src.x, src.y);
    await s.drag(src.x, src.y, dst.x, dst.y - 20, { steps: 14 });
    const other = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r3"]')));
    await s.click(other.x, other.y);
    assert.equal(await s.evaluate(SELECTED), '["r3"]', '본체 드래그 직후 첫 클릭으로 선택이 바뀌어야 한다');

    // ② 크기조정 드래그 뒤에도 같다(이쪽은 click 이 아예 발생하지 않는 경로).
    const target = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r1"]')));
    await s.click(target.x, target.y);
    await s.waitFor(`${countOf('.wg-size-handle')} === 3`, { message: '크기 손잡이 렌더' });
    const se = JSON.parse(await s.evaluate(viewportCenterOf('.wg-size-handle.wg-sh-se')));
    await s.drag(se.x, se.y, se.x - 90, se.y, { steps: 12 });
    const back = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r3"]')));
    await s.click(back.x, back.y);
    assert.equal(await s.evaluate(SELECTED), '["r3"]', '크기조정 직후 첫 클릭으로 선택이 바뀌어야 한다');
  } finally {
    await teardown(server, s);
  }
});

test('대조군: 빈 배경 마퀴 드래그는 그대로 자유 개체를 다중선택한다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  // D2 수정은 pointerdown 이 `.wg-flow-overlay` 안이면 양보하게 만들었다. 오버레이는 시트 전체를
  // 덮지만 `pointer-events:none` 이라 **자식(손잡이) 위에서만** 대상이 된다 — 빈 배경 드래그는
  // 영향을 받지 않아야 한다. 그 "받지 않음"을 논증이 아니라 실입력으로 고정한다.
  const { server, url } = await startEditServer(fixtureWithFloats());
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-editguard-marquee-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${countOf('.wg-float[data-oid]')} === 2`, { message: '자유 개체 렌더' });

    const box = `(() => {
      const f = ${IFR}; const d = f.contentDocument;
      const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
      const a = d.querySelector('.wg-float[data-oid="fl1"]').getBoundingClientRect();
      const b = d.querySelector('.wg-float[data-oid="fl2"]').getBoundingClientRect();
      const vp = (x, y) => ({ x: Math.round(fr.left + x * scale), y: Math.round(fr.top + y * scale) });
      return JSON.stringify({ from: vp(a.left - 18, a.top - 18), to: vp(b.right + 18, b.bottom + 18) });
    })()`;
    const { from, to } = JSON.parse(await s.evaluate(box));

    // 시작점이 정말 빈 배경인지 먼저 확인한다 — 개체 위였다면 이 테스트는 마퀴를 재지 못한다.
    const hitStart = await s.evaluate(`(() => {
      const f = ${IFR}; const d = f.contentDocument;
      const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
      const el = d.elementFromPoint((${from.x} - fr.left) / scale, (${from.y} - fr.top) / scale);
      return el ? String(el.className || el.tagName) : 'null';
    })()`);
    assert.ok(!/wg-obj|wg-float/.test(hitStart), `마퀴 시작점은 빈 배경이어야 한다 — 실제: ${hitStart}`);

    await s.drag(from.x, from.y, to.x, to.y, { steps: 16 });
    const selected = JSON.parse(await s.evaluate(SELECTED)).sort();
    assert.deepEqual(selected, ['fl1', 'fl2'], `마퀴가 두 자유 개체를 다중선택해야 한다 — ${JSON.stringify(selected)}`);
  } finally {
    await teardown(server, s);
  }
});

test('배치 전환은 두 배치를 다 지원하는 타입에만 제안된다', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  const { server, s } = await boot('wsg-editguard-placement-chrome-');
  try {
    const buttons = `JSON.stringify({ insp: !!document.getElementById('insp-flowfloat-toggle'), tb: !!document.getElementById('tb-flowfloat') })`;
    const selectAndRead = async (oid) => {
      const p = JSON.parse(await s.evaluate(viewportCenterOf(`[data-oid="${oid}"]`)));
      await s.click(p.x, p.y);
      await s.waitFor(`${SELECTED} === ${JSON.stringify(JSON.stringify([oid]))}`, { message: `${oid} 선택` });
      return JSON.parse(await s.evaluate(buttons));
    };

    assert.deepEqual(await selectAndRead('t1'), { insp: false, tb: false }, '제목은 flow 전용 — 전환 버튼이 없어야 한다');
    assert.deepEqual(await selectAndRead('s1'), { insp: false, tb: false }, '학습목표 박스도 flow 전용');
    assert.deepEqual(await selectAndRead('r1'), { insp: true, tb: true }, '자유 텍스트는 둘 다 가능 — 버튼이 있어야 한다');

    // 회귀: 가능한 타입에서는 전환이 실제로 일어난다(버튼을 없애는 것이 아니라 고르는 것이다).
    const btn = `(() => { const b = document.getElementById('insp-flowfloat-toggle'); const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`;
    const p = JSON.parse(await s.evaluate(btn));
    await s.click(p.x, p.y);
    await s.waitFor(`${countOf('.wg-float[data-oid="r1"]')} === 1`, { message: 'float 승격' });
  } finally {
    await teardown(server, s);
  }
});
