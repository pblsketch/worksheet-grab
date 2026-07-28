import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExportController } from '../../src/editor/exportController.js';

// 저장 실패 시 진행 차단(2026-07-29 — 계획 0단계, Codex 지적 C2).
//
// 서버는 **저장본**을 렌더한다. 그래서 미리보기·PDF 는 dirty 면 먼저 저장한다. 그런데 그 저장이
// 실패해도(디스크·서버 문제) 종전엔 그냥 진행해서 **마지막으로 성공한 저장본**이 렌더됐다 —
// 교사 화면과 산출물이 조용히 달라진다. 같은 자리의 옳은 형태가 이미 저장소에 있다:
// `editor.js:397` `if (isDirty() && !(await save())) return;`
// `save()` 는 실패 시 null 을 돌려준다(saveController.js).

/** 최소 DOM 스텁 — 모듈은 주입받은 노드만 만진다(전역 document 미사용). */
function harness({ saveResult }) {
  const calls = { fetch: [], banners: [] };
  const cls = () => { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), has: (c) => s.has(c) }; };
  const node = () => ({
    classList: cls(), dataset: {}, textContent: '', disabled: false, style: {},
    children: [], addEventListener() {}, appendChild(c) { this.children.push(c); },
    replaceChildren() { this.children = []; },
    get ownerDocument() { return { createElement: () => node() }; },
  });
  const ctl = createExportController({
    isDirty: () => true,
    save: async () => saveResult,
    showBanner: (kind, msg) => calls.banners.push({ kind, msg }),
    getMode: () => 'teacher',
    previewButton: node(),
    previewModal: node(),
    previewImg: node(),
    previewStatus: node(),
    previewCloseButton: node(),
    exportButton: node(),
    exportResultHost: node(),
  });
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.fetch.push(String(url)); return { ok: true, json: async () => ({}), blob: async () => ({}) }; };
  return { ctl, calls, restore: () => { globalThis.fetch = prev; } };
}

test('미리보기: 저장이 실패하면 렌더를 요청하지 않는다', async () => {
  const h = harness({ saveResult: null }); // save() 실패
  try {
    await h.ctl.openPreview();
    assert.deepEqual(h.calls.fetch, [], `저장 실패 후에는 /preview.png 를 부르면 안 된다 — 실제 ${JSON.stringify(h.calls.fetch)}`);
  } finally { h.restore(); }
});

test('내보내기: 저장이 실패하면 PDF 를 만들지 않고 사유를 알린다', async () => {
  const h = harness({ saveResult: null });
  try {
    await h.ctl.doExport();
    assert.deepEqual(h.calls.fetch, [], `저장 실패 후에는 /export 를 부르면 안 된다 — 실제 ${JSON.stringify(h.calls.fetch)}`);
    assert.ok(h.calls.banners.some((b) => b.kind === 'error'), `실패를 알려야 한다 — ${JSON.stringify(h.calls.banners)}`);
  } finally { h.restore(); }
});

test('회귀: 저장이 성공하면 종전대로 진행한다', async () => {
  const h = harness({ saveResult: { meta: { revision: 3 } } });
  try {
    await h.ctl.doExport();
    assert.ok(h.calls.fetch.some((u) => u.includes('/export')), '성공 경로는 그대로여야 한다');
  } finally { h.restore(); }
});
