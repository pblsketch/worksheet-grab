import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../../src/editor/history.js';

// 타이핑과 구조 명령이 한 undo 단계로 합쳐지던 결함(2026-07-28 — Codex 교차 점검 C4).
//
// 타이핑은 유휴 500ms 로 묶여 확정된다. 그 안에 명령(복제·삭제·속성 변경)이 들어오면 applyDocOp 의
// commit() 이 **타이핑과 명령을 한 상태로** 찍어, Ctrl+Z 한 번에 직전에 친 글자까지 사라졌다.
// history.js 는 import 가 없어 node 에서 그대로 부를 수 있다(브라우저 모듈이지만 DOM 은 주입받는다).

/** capture() 가 보는 최소 환경 — core(문서 보관)와 iframe 문서(body.innerHTML) 스텁. */
function makeHarness() {
  const frame = { body: { innerHTML: '<p></p>' } };
  let document = { docTitle: '', pages: [] };
  const core = { getDocument: () => document, setDocument: (d) => { document = d; } };
  const history = createHistory({
    core, getDoc: () => frame, captureUiState: () => null, restoreUiState: () => {}, onRestore: () => {},
  });
  history.reset();
  return {
    history, frame, core,
    /** 사용자가 글자를 친 상태를 흉내 — selection.js 는 입력마다 core 를 즉시 갱신한다. */
    type(text) {
      document = { ...document, docTitle: document.docTitle + text };
      frame.body.innerHTML = `<p>${document.docTitle}</p>`;
      history.noteInput();
    },
    /** 구조 명령(개체 추가)을 흉내 — applyDocOp 과 같은 순서로 부른다. */
    command() {
      history.flushTyping();
      document = { ...document, pages: [...document.pages, { id: `p${document.pages.length + 1}` }] };
      frame.body.innerHTML += '<div></div>';
      history.commit();
    },
  };
}

test('타이핑 직후의 명령은 타이핑을 자기 단계로 삼키지 않는다', () => {
  const h = makeHarness();
  h.type('A');
  // canUndo() 는 대기 중인 타이핑도 true 로 본다(되돌리기 버튼을 켜 두려고) — 확정 여부는 스택으로 잰다.
  assert.deepEqual(h.history.depth(), { index: 0, length: 1 }, '전제: 타이핑은 아직 단계로 확정되지 않았다');

  h.command();
  h.history.undo();
  assert.equal(h.core.getDocument().pages.length, 0, '명령이 취소돼야 한다');
  assert.equal(h.core.getDocument().docTitle, 'A', '직전에 친 글자는 남아 있어야 한다(합쳐지면 여기서 빈 문자열)');

  h.history.undo();
  assert.equal(h.core.getDocument().docTitle, '', '한 번 더 되돌리면 타이핑도 취소된다');
});

test('되돌린 만큼 다시 실행할 수 있다', () => {
  const h = makeHarness();
  h.type('A');
  h.command();
  h.history.undo();
  h.history.undo();
  h.history.redo();
  assert.equal(h.core.getDocument().docTitle, 'A');
  h.history.redo();
  assert.equal(h.core.getDocument().pages.length, 1);
});

test('대기 중인 타이핑이 없으면 flushTyping 은 빈 단계를 만들지 않는다', () => {
  const h = makeHarness();
  h.command();          // 타이핑 없이 명령만
  h.history.flushTyping();
  h.history.flushTyping();
  h.history.undo();
  assert.equal(h.core.getDocument().pages.length, 0, '한 번의 undo 로 명령 이전으로 돌아가야 한다');
  assert.equal(h.history.canUndo(), false, '그 이전에는 아무 단계도 없어야 한다');
});

test('연속 타이핑은 여전히 한 단계로 묶인다(코얼레싱 회귀)', () => {
  const h = makeHarness();
  h.type('A');
  h.type('B');
  h.type('C');
  h.command();
  h.history.undo();
  assert.equal(h.core.getDocument().docTitle, 'ABC', '명령만 취소');
  h.history.undo();
  assert.equal(h.core.getDocument().docTitle, '', '연속 타이핑 3회는 한 단계 — 한 번의 undo 로 모두 사라진다');
});
