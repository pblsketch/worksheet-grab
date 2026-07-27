import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../../src/editor/history.js';

function makeHarness() {
  let documentState = {
    pages: [
      { id: 'page-a', role: 'cover', flow: [], float: [] },
      { id: 'page-b', flow: [], float: [] },
    ],
  };
  let activePageId = 'page-a';
  const body = { innerHTML: '<section class="sheet" data-page-id="page-a"></section><section class="sheet" data-page-id="page-b"></section>' };
  const restores = [];
  const core = {
    getDocument: () => documentState,
    setDocument: (next) => { documentState = next; },
  };
  const history = createHistory({
    core,
    getDoc: () => ({ body }),
    captureUiState: () => ({ activePageId }),
    restoreUiState: (state) => { activePageId = state?.activePageId ?? null; },
    onRestore: (context) => restores.push(context),
  });
  return {
    history,
    body,
    getDocument: () => documentState,
    setDocument: (next) => { documentState = next; },
    getActivePageId: () => activePageId,
    setActivePageId: (next) => { activePageId = next; },
    restores,
  };
}

test('history는 role-only 변경과 빈 페이지 reorder를 별도 단계로 기록한다', () => {
  const h = makeHarness();
  h.history.reset();

  h.setDocument({
    ...h.getDocument(),
    pages: h.getDocument().pages.map((page) => page.id === 'page-b' ? { ...page, role: 'reading' } : page),
  });
  h.history.commit();

  h.setDocument({ ...h.getDocument(), pages: [...h.getDocument().pages].reverse() });
  h.body.innerHTML = '<section class="sheet" data-page-id="page-b"></section><section class="sheet" data-page-id="page-a"></section>';
  h.history.commit();

  assert.deepEqual(h.history.depth(), { index: 2, length: 3 });
  assert.equal(h.history.undo(), true);
  assert.deepEqual(h.getDocument().pages.map((page) => page.id), ['page-a', 'page-b']);
  assert.equal(h.getDocument().pages[1].role, 'reading');
  assert.equal(h.history.undo(), true);
  assert.equal(h.getDocument().pages[1].role, undefined);
});

// 리플로우는 flow 높이 실측에서 나오는 **파생값**이라 되돌리기 단위가 아니다. 이 세 테스트가
// 그 계약을 고정한다 — 실 키보드 Ctrl+Z 로 삭제를 되돌리지 못하던 버그의 원인이 여기였다.
function seedTwoObjects(h) {
  h.setDocument({ pages: [{ id: 'page-a', flow: [{ id: 'o1' }, { id: 'o2' }], float: [] }] });
  h.body.innerHTML = '<div data-oid="o1"></div><div data-oid="o2"></div>';
  h.history.reset();
}
/** 사용자 조작(개체 삭제) — applyDocOp 이 commit 하는 자리. */
function deleteO2(h) {
  h.setDocument({ pages: [{ id: 'page-a', flow: [{ id: 'o1' }], float: [] }] });
  h.body.innerHTML = '<div data-oid="o1"></div>';
  h.history.commit();
}
/** 파생 재계산(리플로우) — 문서·DOM 을 또 한 번 바꾼다. */
function reflow(h) {
  h.setDocument({ pages: [{ id: 'page-a', flow: [{ id: 'o1' }], float: [], reflowed: true }] });
  h.body.innerHTML = '<div data-oid="o1"></div><!--reflowed-->';
}

test('리플로우 확정(amend)은 단계를 늘리지 않아 삭제가 Ctrl+Z 한 번에 되돌아간다', () => {
  const h = makeHarness();
  seedTwoObjects(h);
  deleteO2(h);
  assert.deepEqual(h.history.depth(), { index: 1, length: 2 });

  reflow(h);
  h.history.amend();
  assert.deepEqual(h.history.depth(), { index: 1, length: 2 }, 'amend 는 새 단계를 만들지 않는다');

  assert.equal(h.history.undo(), true);
  assert.deepEqual(h.getDocument().pages[0].flow.map((o) => o.id), ['o1', 'o2'], '삭제 이전으로 복원');
  assert.match(h.body.innerHTML, /o2/, '화면에도 개체가 돌아온다');
});

test('리플로우를 commit 으로 확정하면 undo 가 리플로우 단계에 갇힌다(회귀 형태 고정)', () => {
  const h = makeHarness();
  seedTwoObjects(h);
  deleteO2(h);

  reflow(h);
  h.history.commit(); // ← 버그 재현: 파생 재계산이 자기 단계를 갖는다
  assert.deepEqual(h.history.depth(), { index: 2, length: 3 });

  // 첫 undo 는 '삭제 이전'이 아니라 '삭제됨(리플로우 전)'까지만 간다 — o2 는 여전히 없다.
  // 실제 편집기에서는 이 상태에서 onRestore 가 리플로우를 다시 예약·commit 해 index 가 도로
  // 밀리면서 몇 번을 눌러도 화면이 그대로였다.
  assert.equal(h.history.undo(), true);
  assert.deepEqual(h.getDocument().pages[0].flow.map((o) => o.id), ['o1']);
});

test('amend 는 미확정 타이핑을 덮어쓰지 않고 그 타이핑을 한 단계로 확정한다', () => {
  const h = makeHarness();
  seedTwoObjects(h);

  h.history.noteInput(); // 타이핑 진행 중(유휴 코얼레싱 대기)
  h.setDocument({ pages: [{ id: 'page-a', flow: [{ id: 'o1', text: '타이핑' }, { id: 'o2' }], float: [] }] });
  h.body.innerHTML = '<div data-oid="o1">타이핑</div><div data-oid="o2"></div>';

  h.history.amend(); // 타이핑 도중 리플로우가 끼어든 상황
  assert.deepEqual(h.history.depth(), { index: 1, length: 2 }, '타이핑이 자기 단계를 갖는다(덮어쓰기 금지)');

  assert.equal(h.history.undo(), true);
  assert.equal(h.getDocument().pages[0].flow[0].text, undefined, '타이핑 이전으로 복원');
});

test('history는 add/delete 구조와 activePageId를 undo/redo에서 함께 복원한다', () => {
  const h = makeHarness();
  h.history.reset();

  h.setDocument({ ...h.getDocument(), pages: [h.getDocument().pages[1]] });
  h.body.innerHTML = '<section class="sheet" data-page-id="page-b"></section>';
  h.setActivePageId('page-b');
  h.history.commit();

  assert.equal(h.history.undo(), true);
  assert.deepEqual(h.getDocument().pages.map((page) => page.id), ['page-a', 'page-b']);
  assert.match(h.body.innerHTML, /page-a/);
  assert.equal(h.getActivePageId(), 'page-a');
  assert.equal(h.restores.at(-1).pageStructureChanged, true);

  assert.equal(h.history.redo(), true);
  assert.deepEqual(h.getDocument().pages.map((page) => page.id), ['page-b']);
  assert.doesNotMatch(h.body.innerHTML, /page-a/);
  assert.equal(h.getActivePageId(), 'page-b');
});
