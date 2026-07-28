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
        // meta.pill = 제목 배지(.pill) — 자기 배경 위에 흰 글자를 얹는 유일한 편집 조각이라
        // "편집 표식이 배경을 덮어쓰면 글자가 사라진다"를 잴 수 있는 대상이다.
        { id: 't1', type: 'title', placement: 'flow', text: '탐구 활동', meta: { pill: '탐구 실험', page: '중학교 과학' } },
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

test('조각 편집 표식이 그 조각의 글자색·배경을 바꾸지 않는다(배지가 안 보이던 결함)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  // 고치기 전: 더블클릭하면 .wg-part-editing 이 배지의 청록 배경을 반투명 노랑으로 덮어썼는데
  // 글자색은 흰색 그대로라 **흰 바탕에 흰 글자**가 됐다(실측 background rgb(0,131,143) → rgba(...)).
  const { server, s } = await boot('wsg-editguard-badge-chrome-');
  try {
    await s.waitFor(`${countOf('[data-ot="title"] .pill')} === 1`, { message: '배지 렌더' });
    const styleOf = `(() => {
      const el = ${CV}.querySelector('[data-ot="title"] .pill');
      const cs = ${CV}.defaultView.getComputedStyle(el);
      return JSON.stringify({ color: cs.color, background: cs.backgroundColor, ce: el.getAttribute('contenteditable') });
    })()`;
    const before = JSON.parse(await s.evaluate(styleOf));
    assert.equal(before.background, 'rgb(0, 131, 143)', `전제: 배지는 색 배경을 갖는다 — ${JSON.stringify(before)}`);

    const p = JSON.parse(await s.evaluate(viewportCenterOf('[data-ot="title"] .pill')));
    await s.click(p.x, p.y);
    await s.click(p.x, p.y, { clickCount: 2 });
    await s.waitFor(`${countOf('[contenteditable="true"]')} === 1`, { message: '배지 편집 진입' });

    const after = JSON.parse(await s.evaluate(styleOf));
    assert.equal(after.ce, 'true', '배지가 편집 상태여야 한다');
    assert.equal(after.background, before.background, `편집 표식이 배경을 덮으면 안 된다 — ${JSON.stringify(after)}`);
    assert.equal(after.color, before.color, `글자색도 그대로여야 한다 — ${JSON.stringify(after)}`);
  } finally {
    await teardown(server, s);
  }
});

test('세로로 늘리면 보이는 테두리 상자도 함께 늘어난다(영역만 늘던 결함)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  // 고치기 전: 래퍼만 93→112px 로 커지고 .title-box 는 93px 그대로였다 — 교사 눈에는 여백만 생겼다.
  // 제목은 .wg-obj > .title-wrap > .title-box 로 한 겹 더 들어가는 유일한 타입이라 이걸로 잰다.
  const { server, s } = await boot('wsg-editguard-stretch-chrome-');
  try {
    const heights = `(() => {
      const w = ${CV}.querySelector('[data-oid="t1"]');
      const box = w.querySelector('.title-box');
      const h = (el) => Math.round(el.getBoundingClientRect().height);
      return JSON.stringify({ wrapper: h(w), box: h(box), minh: w.getAttribute('data-minh') });
    })()`;
    const obj = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="t1"]')));
    await s.click(obj.x, obj.y);
    await s.waitFor(`${countOf('.wg-size-handle')} === 3`, { message: '크기 손잡이 렌더' });
    const before = JSON.parse(await s.evaluate(heights));
    assert.equal(before.minh, null, '전제: 아직 최소높이가 없다');

    const sh = JSON.parse(await s.evaluate(viewportCenterOf('.wg-size-handle.wg-sh-s')));
    await s.drag(sh.x, sh.y, sh.x, sh.y + 90, { steps: 14 });
    await s.waitFor(`${CV}.querySelector('[data-oid="t1"]').getAttribute('data-minh') === '1'`, { message: '최소높이 반영' });

    const after = JSON.parse(await s.evaluate(heights));
    assert.ok(after.wrapper > before.wrapper, `래퍼가 늘어야 한다 — ${before.wrapper}→${after.wrapper}`);
    assert.ok(after.box > before.box,
      `실제 테두리 상자(.title-box)도 늘어야 한다 — ${before.box}→${after.box} (래퍼 ${before.wrapper}→${after.wrapper})`);
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

test("'내 블록으로 저장'에 편집 손잡이가 딸려 들어가지 않는다(인쇄물 오염)", { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  // 고치기 전: 저장된 프리셋 html 이 `<div class="wg-float-handle">⠿</div>` 로 시작했고
  // 리사이즈 손잡이 8개까지 담겼다. 그 프리셋은 삽입될 때 richtext.html 이 되므로 ⠿ 와 파란
  // 사각형이 **학생 배포본에 인쇄**된다. 제거 규칙이 selection.js 안에만 있고 프리셋 경로가
  // 날 innerHTML 을 보내던 것이 원인 — 관문을 하나로 모았고, 그 사실을 여기서 고정한다.
  const { server, url } = await startEditServer(fixtureWithFloats());
  const s = await openCdpSession(`${url}/`, { prefix: 'wsg-editguard-preset-chrome-' });
  try {
    await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
    await s.waitFor(`${countOf('.wg-float[data-oid="fl1"]')} === 1`, { message: '자유 개체 렌더' });

    // 선택해서 리사이즈 손잡이 8개까지 붙인 **최악 조건**에서 저장한다.
    const p = JSON.parse(await s.evaluate(viewportCenterOf('.wg-float[data-oid="fl1"]')));
    await s.click(p.x, p.y);
    await s.waitFor(`${countOf('.wg-float[data-oid="fl1"] > .wg-resize-handle')} === 8`, { message: '리사이즈 손잡이' });
    assert.equal(await s.evaluate(countOf('.wg-float[data-oid="fl1"] > .wg-float-handle')), 1, '전제: ⠿ 손잡이가 래퍼 자식이다');

    await s.rightClick(p.x, p.y);
    await s.waitFor(`!!document.getElementById('canvas-ctx-menu')`, { message: '우클릭 메뉴' });
    const item = `(() => {
      const b = [...document.querySelectorAll('#canvas-ctx-menu button')].find((x) => /내 블록으로 저장/.test(x.textContent));
      const r = b.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`;
    const it = JSON.parse(await s.evaluate(item));
    await s.click(it.x, it.y);
    await s.waitFor(`/내 블록에 저장/.test(document.getElementById('save-banner').textContent)`, { message: '저장 완료 배너' });

    const saved = JSON.parse(await s.evaluate(`(async () => {
      const list = await (await fetch('/presets')).json();
      const items = Array.isArray(list) ? list : (list.presets || list.items || []);
      const mine = items.filter((x) => /answer-area/.test(x.name || ''));
      const p = mine[mine.length - 1];
      return JSON.stringify({ found: !!p, html: p ? p.html : '' });
    })()`));
    assert.ok(saved.found, '프리셋이 저장돼 있어야 한다');
    assert.doesNotMatch(saved.html, /wg-float-handle/, `⠿ 손잡이가 콘텐츠로 굳으면 안 된다 — ${saved.html.slice(0, 160)}`);
    assert.doesNotMatch(saved.html, /wg-resize-handle/, `리사이즈 손잡이도 마찬가지 — ${saved.html.slice(0, 160)}`);
    assert.ok(saved.html.trim().length > 0, '내용까지 통째로 지우면 안 된다');
  } finally {
    await teardown(server, s);
  }
});

test('모드 왕복 뒤 버튼·body.dataset·보이는 프레임이 서로 일치한다(불변식 점검)', { skip: !HAS_CHROME, timeout: 240000 }, async () => {
  // ⚠ 이 테스트는 **경합을 재현하지 못한다.** 변이 실험으로 확인했다 — `setMode` 의 세대 가드
  //   두 줄을 지워도 초록이었다. CDP 클릭 사이 간격(160ms)이 학생 프레임 재렌더 창보다 짧게
  //   맞아떨어지지 않아, 두 번째 클릭이 느린 구간 **안에** 떨어지지 않는다.
  //   따라서 이것은 회귀 방어가 아니라 **불변식 스모크**다(버튼·dataset·프레임 삼자 일치).
  //   세대 가드의 정당성은 코드 근거에 있다(editor.js setMode 주석).
  //   결정적 재현에는 서버 응답을 늦추는 테스트 훅이 필요하다 — 계획 문서에 후속으로 적었다.
  const { server, s } = await boot('wsg-editguard-mode-chrome-');
  try {
    // 편집을 한 번 만들어 studentStale 을 켠다 — 그래야 학생 전환이 재렌더(느린 구간)를 탄다.
    const r = JSON.parse(await s.evaluate(viewportCenterOf('[data-oid="r1"]')));
    await s.click(r.x, r.y);
    await s.click(r.x, r.y, { clickCount: 2 });
    await s.waitFor(`${countOf('[contenteditable="true"]')} === 1`, { message: '편집 진입' });
    await s.insertText('가');
    await s.press('Escape');

    const btn = (id) => `(() => { const b = document.getElementById(${JSON.stringify(id)}); const q = b.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }); })()`;
    const stu = JSON.parse(await s.evaluate(btn('btn-student')));
    const tea = JSON.parse(await s.evaluate(btn('btn-teacher')));

    await s.click(stu.x, stu.y);   // 느린 재렌더 시작
    await s.click(tea.x, tea.y);   // 그 도중에 되돌린다

    // 첫 호출이 끝나고도 남을 만큼 기다린 뒤 불변식을 본다.
    const state = `JSON.stringify({
      btn: document.getElementById('btn-teacher').classList.contains('active') ? 'teacher' : 'student',
      dataset: document.body.dataset.mode,
      visible: [...document.querySelectorAll('#stage iframe')].findIndex((f) => f.offsetParent !== null),
      teacherIdx: 0,
    })`;
    await s.waitFor(`${state} && true`, { message: '상태 읽기' });
    await new Promise((res) => setTimeout(res, 4000));
    const after = JSON.parse(await s.evaluate(state));
    assert.equal(after.btn, 'teacher', '마지막 의도는 교사용이다');
    assert.equal(after.dataset, 'teacher', `body.dataset.mode 가 버튼과 같아야 한다 — ${JSON.stringify(after)}`);
    assert.equal(after.visible, after.teacherIdx, `보이는 프레임이 교사 프레임이어야 한다 — ${JSON.stringify(after)}`);
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
