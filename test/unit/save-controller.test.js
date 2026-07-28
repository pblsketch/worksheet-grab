import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveController } from '../../src/editor/saveController.js';

// saveController 는 import 가 없는 순수 팩토리라 node 에서 그대로 부를 수 있다(브라우저 모듈이지만
// /src 절대 import 를 쓰지 않는다 — MEMORY: editor-browser-module-unit-test 의 우회가 필요 없는 경우).
//
// 여기서 고정하는 것은 **저장 왕복 중 들어온 편집을 잃지 않는가**(2026-07-28, Codex 교차 점검 P0).
// 고치기 전: 요청 시점 문서를 서버가 되돌려 주면 무조건 setDocument 로 덮고 dirty 를 내렸다 —
// 응답을 기다리는 동안 교사가 입력한 내용이 응답 도착 순간 사라지고, dirty 가 false 라 다음
// 자동저장도 그 유실을 되돌리지 못했다.

/** 최소 DOM 스텁 — 모듈은 주입받은 노드만 만진다(전역 document 미사용). */
function stubs() {
  const banners = [];
  return {
    revEl: { textContent: '' },
    bodyEl: { dataset: {} },
    showBanner: (kind, msg) => banners.push({ kind, msg }),
    banners,
  };
}

/** 응답을 테스트가 직접 풀어 주는 가짜 fetch — 왕복 중간에 편집을 끼워 넣기 위해. */
function deferredFetch(response) {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    await gate;
    return { ok: true, json: async () => response };
  };
  return { fetchImpl, release: () => release(), calls };
}

function withFetch(fetchImpl, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = prev; });
}

test('저장 왕복 중 들어온 편집을 응답이 덮어쓰지 않는다', async () => {
  const s = stubs();
  let live = { docTitle: 'A', pages: [] };
  // 서버는 요청 시점(A)을 정규화해 되돌려 준다 — 그 사이 화면은 B 가 되어 있다.
  const { fetchImpl, release, calls } = deferredFetch({ document: { docTitle: 'A', pages: [], normalized: true }, meta: { revision: 7 } });

  await withFetch(fetchImpl, async () => {
    const ctl = createSaveController({
      getDocument: () => live,
      setDocument: (d) => { live = d; },
      showBanner: s.showBanner, revEl: s.revEl, bodyEl: s.bodyEl,
      initialRevision: 6, autosaveMs: 10_000,
    });

    const pending = ctl.save();
    live = { docTitle: 'B', pages: [] };  // 저장 응답을 기다리는 동안의 편집
    ctl.markDirty();
    release();
    await pending;

    assert.equal(live.docTitle, 'B', '응답이 도착해도 그 사이의 편집(B)이 살아 있어야 한다');
    assert.equal(ctl.isDirty(), true, '아직 저장되지 않은 편집이 있으므로 dirty 여야 한다');
    assert.equal(ctl.getRevision(), 7, '서버가 확정한 리비전은 그대로 반영한다');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].document.docTitle, 'A', '요청 본문은 요청 시점 문서였다');
  });
});

test('왕복 중 편집이 없으면 종전대로 서버 문서를 채택하고 dirty 를 내린다', async () => {
  const s = stubs();
  let live = { docTitle: 'A', pages: [] };
  const { fetchImpl, release } = deferredFetch({ document: { docTitle: 'A', pages: [], normalized: true }, meta: { revision: 7 } });

  await withFetch(fetchImpl, async () => {
    const ctl = createSaveController({
      getDocument: () => live,
      setDocument: (d) => { live = d; },
      showBanner: s.showBanner, revEl: s.revEl, bodyEl: s.bodyEl,
      initialRevision: 6, autosaveMs: 10_000,
    });
    ctl.markDirty();
    const pending = ctl.save();
    release();
    await pending;

    assert.equal(live.normalized, true, '편집이 없었으면 서버 정규화 문서를 채택한다');
    assert.equal(ctl.isDirty(), false, '저장이 끝났으므로 dirty 가 내려간다');
    assert.equal(s.revEl.textContent, 'rev 7');
    assert.equal(s.bodyEl.dataset.savedRevision, '7');
  });
});

test('저장 실패는 null 을 돌려주고 dirty 를 유지한다', async () => {
  const s = stubs();
  const live = { docTitle: 'A', pages: [] };
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({ error: '디스크 가득' }) });

  await withFetch(fetchImpl, async () => {
    const ctl = createSaveController({
      getDocument: () => live, setDocument: () => {},
      showBanner: s.showBanner, revEl: s.revEl, bodyEl: s.bodyEl,
      initialRevision: 6, autosaveMs: 10_000,
    });
    ctl.markDirty();
    const result = await ctl.save();
    assert.equal(result, null);
    assert.equal(ctl.isDirty(), true, '실패했으면 저장되지 않은 상태로 남아야 한다');
    assert.match(s.banners.at(-1).msg, /디스크 가득/);
  });
});
