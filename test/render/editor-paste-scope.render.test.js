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

// 붙여넣기 정규화의 **사정거리**(계획 2단계 ①).
//
// 편집 세션 소유자가 셋이다 — selection(`editingId`) · tableEdit(`editingCell`) · partEdit(`editingEl`).
// paste 리스너는 selection 것만 봤으므로, 표 셀·조각을 편집하는 동안의 붙여넣기는 정규화를
// **통째로 건너뛰고** 브라우저 기본 삽입이 들어갔다(Word/HWP 의 style·class·표 마크업 그대로).
// 그 오염은 모델에는 안 남지만(둘 다 textContent 로 되읽는다) **화면 DOM 에는 남고**, 리플로우는
// 그 DOM 을 재서 페이지를 배정한다.
//
// ⚠ 이 테스트가 증명하지 않는 것: "수정 전에 오염이 실제로 들어온다". 합성 paste 는 브라우저
//   기본 삽입을 일으키지 않아 그 오염을 재현할 수 없다(실 클립보드 도구 부재 — 계획 v3 의 미해결).
//   대신 판별력 있는 두 가지를 잰다: ⓐ **정규화 배선이 걸렸는가**(defaultPrevented) ⓑ **정규화된
//   내용이 실제로 삽입되고 모델까지 반영되는가**(재렌더 뒤 생존). 수정 전에는 리스너가 조기
//   반환하므로 둘 다 관측되지 않는다.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HAS_CHROME = chromeAvailable();
const IFR = `document.querySelector('#stage iframe')`;
const CV = `${IFR}.contentDocument`;

/** Word 에서 온 것 같은 오염 마크업 — 속성·표 구조가 전부 들어 있다. */
const DIRTY_HTML = '<span style="font-family:굴림;font-size:14pt" class="MsoNormal">붙인값</span>'
  + '<table class="MsoTableGrid"><tr><td>칸</td></tr></table>';

function fixtureDocument() {
  return {
    pagination: 'paginated',
    docTitle: '붙여넣기 사정거리',
    subject: 'science', dataSubject: 'science', themeName: 'sci', lang: 'ko', paper: null,
    standards: [],
    pages: [{
      flow: [
        { id: 's1', type: 'std-box', placement: 'flow', objectives: ['광합성 조건을 설명할 수 있다.'] },
        { id: 'b1', type: 'table', placement: 'flow', splittable: true, rows: [[{ text: '준비물' }, { text: '검정말' }]] },
        { id: 'r1', type: 'richtext', placement: 'flow', html: '<p>본문 문단</p>' },
      ],
      float: [],
    }],
  };
}

async function boot(prefix) {
  const base = await autoTmpDir('wsg-pastescope-render-');
  const workspace = new FsWorkspaceRepository({ baseDir: base });
  const blockRepository = new FsBlockRepository({ root: ROOT });
  const saver = new SaveDocument({ workspace, blockRepository, curriculum: null });
  await saver.checkpoint({ name: '문서', document: fixtureDocument(), now: new Date('2026-07-29T00:00:00.000Z') });
  const server = createEditorServer({ root: ROOT, docName: '문서', workspace, blockRepository, curriculum: null, testSeed: false });
  const addr = await listenEditorServer(server);
  const s = await openCdpSession(`http://127.0.0.1:${addr.port}/`, { prefix });
  await s.waitFor(`document.body.dataset.ready === 'true'`, { message: '편집기 부팅' });
  await s.waitFor(`${CV}.querySelectorAll('[data-oid]').length === 3`, { message: '개체 렌더' });
  return { server, s };
}

const teardown = async (server, s) => {
  await new Promise((r) => server.close(r));
  await s.close();
};

/** 캔버스 안 선택자의 뷰포트 중심(줌 보정) — 실마우스에 넘길 값. */
const centerOf = (selector) => `(() => {
  const f = ${IFR}; const d = f.contentDocument;
  const fr = f.getBoundingClientRect(); const scale = fr.width / f.offsetWidth;
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(fr.left + (r.left + r.width / 2) * scale), y: Math.round(fr.top + (r.top + r.height / 2) * scale) });
})()`;

/**
 * 편집 중인 노드에 붙여넣기를 **한 번** 보낸다.
 * 합성이지만 clipboardData 는 진짜 DataTransfer 라, 편집기 리스너가 실제 클립보드와 같은 경로로
 * 읽는다. 삽입은 리스너의 execCommand 가 하므로 결과를 그대로 실측할 수 있다.
 */
const dispatchPaste = (selector, html) => `(() => {
  const d = ${CV};
  const el = d.querySelector(${JSON.stringify(selector)});
  if (!el) return JSON.stringify({ error: '대상 없음' });
  const dt = new DataTransfer();
  dt.setData('text/html', ${JSON.stringify(html)});
  dt.setData('text/plain', '붙인값');
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(ev);
  return JSON.stringify({ defaultPrevented: ev.defaultPrevented, html: el.innerHTML, text: el.textContent });
})()`;

const dblclick = async (s, selector) => {
  const pt = JSON.parse(await s.evaluate(centerOf(selector)));
  assert.ok(pt, `${selector} 좌표를 못 구했다`);
  await s.click(pt.x, pt.y);
  await s.click(pt.x, pt.y, { clickCount: 2 });
};

test('표 셀 편집 중 붙여넣기가 정규화를 탄다 (계획 2단계 ①-a)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('paste-cell-');
  try {
    await dblclick(s, 'td[data-r="0"][data-c="0"]');
    assert.equal(await s.evaluate(`!!${CV}.querySelector('td.wg-cell-editing')`), true, '셀 편집에 진입해야 한다');

    const out = JSON.parse(await s.evaluate(dispatchPaste('td[data-r="0"][data-c="0"]', DIRTY_HTML)));
    assert.equal(out.defaultPrevented, true, '정규화 리스너가 기본 붙여넣기를 막아야 한다(수정 전엔 조기 반환해 막지 않는다)');
    assert.match(out.text, /붙인값/, '정규화된 내용이 실제로 셀에 들어가야 한다');
    assert.ok(!/style=/.test(out.html), `표현 속성이 셀에 남았다: ${out.html}`);
    assert.ok(!/class="Mso/.test(out.html), `외부 class 가 셀에 남았다: ${out.html}`);
    assert.ok(!/<table/i.test(out.html), `표 마크업이 셀 안에 중첩됐다: ${out.html}`);
  } finally {
    await teardown(server, s);
  }
});

test('셀에 붙여넣은 값이 모델까지 반영돼 재렌더 뒤에도 남는다 (계획 2단계 ①-b)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('paste-cell-survive-');
  try {
    await dblclick(s, 'td[data-r="0"][data-c="0"]');
    JSON.parse(await s.evaluate(dispatchPaste('td[data-r="0"][data-c="0"]', DIRTY_HTML)));
    await s.press('Escape');

    // 모델 기반 재렌더를 강제한다 — 개체 복사·붙여넣기(Ctrl+C/V)는 applyDocOp 을 지나
    // reloadTeacherFrame 으로 <body> 를 통째로 다시 그린다. 화면에 남으려면 모델에 있어야 한다.
    const pt = JSON.parse(await s.evaluate(centerOf('[data-oid="r1"]')));
    await s.click(pt.x, pt.y);
    await s.press('c', { ctrl: true });
    await s.press('v', { ctrl: true });
    await s.waitFor(`${CV}.querySelectorAll('[data-oid]').length === 4`, { message: '개체 복제(재렌더)' });

    const cellText = await s.evaluate(`${CV}.querySelector('td[data-r="0"][data-c="0"]').textContent`);
    assert.match(cellText, /붙인값/, '재렌더 뒤에도 남으려면 붙여넣기가 모델(rows[r][c].text)까지 반영돼야 한다');
    const cellHtml = await s.evaluate(`${CV}.querySelector('td[data-r="0"][data-c="0"]').innerHTML`);
    assert.ok(!/style=|<table/i.test(cellHtml), `재렌더 뒤 셀이 오염됐다: ${cellHtml}`);
  } finally {
    await teardown(server, s);
  }
});

test('조각(.wg-part) 편집 중 붙여넣기도 정규화를 탄다 (계획 2단계 ①-a)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('paste-part-');
  try {
    await dblclick(s, '.wg-part[data-part]');
    assert.equal(await s.evaluate(`!!${CV}.querySelector('.wg-part-editing')`), true, '조각 편집에 진입해야 한다');

    const out = JSON.parse(await s.evaluate(dispatchPaste('.wg-part-editing', DIRTY_HTML)));
    assert.equal(out.defaultPrevented, true, '정규화 리스너가 기본 붙여넣기를 막아야 한다');
    assert.match(out.text, /붙인값/, '정규화된 내용이 실제로 조각에 들어가야 한다');
    assert.ok(!/style=|class="Mso|<table/i.test(out.html), `조각이 오염됐다: ${out.html}`);
  } finally {
    await teardown(server, s);
  }
});

test('대조군 — 개체 본문(richtext) 붙여넣기 정규화는 종전 그대로 걸린다', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('paste-obj-');
  try {
    await dblclick(s, '[data-oid="r1"]');
    const out = JSON.parse(await s.evaluate(dispatchPaste('[data-oid="r1"]', DIRTY_HTML)));
    assert.equal(out.defaultPrevented, true, '개체 본문 편집의 정규화는 원래부터 걸려 있었다');
    assert.match(out.text, /붙인값/);
    // 외부에서 온 마크업은 확실히 사라진다(정규화가 한 일).
    assert.ok(!/class="Mso|<table/i.test(out.html), `외부 마크업이 남았다: ${out.html}`);
  } finally {
    await teardown(server, s);
  }
});

// 아래는 **이번 수정과 무관한 별개 결함**(대장 D14)이다. 가드를 넓히기 전에도 똑같이 재현되며,
// 프로브(scratchpad/probe22)로 실체를 확정했다: Chrome 의 insertHTML 이 `<p>` **안에** `<br>` 이 든
// HTML 을 넣으면 문단을 쪼개면서(뒷부분이 `</p>` 밖으로 나간다) 앞부분에 `font-size` 를
// 인라인화한다. `<p>` 밖 삽입·표 셀·조각에서는 일어나지 않는다.
// todo 로 둔다 — 숨기지 않고 실행해 실패를 기록하되, 이 스위트를 빨갛게 만들지는 않는다.
test('[미해결 D14] 여러 줄 붙여넣기가 문단을 깨고 style 을 인라인화한다', { skip: !HAS_CHROME && 'Chrome 없음', todo: '대장 D14 — insertHTML 재오염' }, async () => {
  const { server, s } = await boot('paste-restyle-');
  try {
    await dblclick(s, '[data-oid="r1"]');
    const out = JSON.parse(await s.evaluate(dispatchPaste('[data-oid="r1"]', DIRTY_HTML)));
    assert.ok(!/style=/.test(out.html), `정규화 산출을 브라우저가 다시 오염시켰다: ${out.html}`);
  } finally {
    await teardown(server, s);
  }
});

test('편집 중이 아니면 개입하지 않는다(브라우저 기본 동작 우선)', { skip: !HAS_CHROME && 'Chrome 없음' }, async () => {
  const { server, s } = await boot('paste-idle-');
  try {
    const out = JSON.parse(await s.evaluate(dispatchPaste('td[data-r="0"][data-c="0"]', DIRTY_HTML)));
    assert.equal(out.defaultPrevented, false, '편집 중이 아닌 셀에는 개입하면 안 된다');
    assert.ok(!/붙인값/.test(out.text), '편집 중이 아니면 아무것도 넣지 않는다');
  } finally {
    await teardown(server, s);
  }
});
