import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachComposition,
  isComposing,
  onCompositionEnd,
  releaseComposition,
  resetCompositionForTest,
} from '../../src/editor/composition.js';

// composition.js 는 의존성 0(문서를 인자로 받는 순수 배선)이라 node 에서 직접 import 된다.
// 최소 fake document — addEventListener 로 등록된 핸들러를 직접 발화시킨다.
function fakeDoc() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    fire(type) {
      for (const fn of handlers.get(type) || []) fn();
    },
    handlerCount(type) {
      return (handlers.get(type) || []).length;
    },
  };
}

test('조합 시작이면 isComposing 이 참, 확정이면 거짓', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);

  assert.equal(isComposing(), false, '초기 상태는 비조합');
  doc.fire('compositionstart');
  assert.equal(isComposing(), true, '조합 중에는 리플로우가 막혀야 한다');
  doc.fire('compositionend');
  assert.equal(isComposing(), false, '확정 후에는 리플로우가 재개돼야 한다');
});

test('조합 확정 시 등록된 구독자가 호출된다', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);

  const calls = [];
  onCompositionEnd(() => calls.push('a'));
  onCompositionEnd(() => calls.push('b'));

  doc.fire('compositionstart');
  assert.deepEqual(calls, [], '조합 중에는 호출되지 않는다');

  doc.fire('compositionend');
  assert.deepEqual(calls, ['a', 'b'], '확정 시 등록 순서대로 모두 호출된다');
});

test('구독 해제 함수는 이후 확정에서 호출을 막는다', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);

  let count = 0;
  const off = onCompositionEnd(() => { count += 1; });
  doc.fire('compositionend');
  assert.equal(count, 1);

  off();
  doc.fire('compositionend');
  assert.equal(count, 1, '해제 후에는 더 호출되지 않는다');
});

test('같은 document 에 두 번 배선해도 리스너가 중복되지 않는다', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);
  attachComposition(doc); // 재로드는 <body> innerHTML 치환이라 document 정체성이 유지된다

  assert.equal(doc.handlerCount('compositionstart'), 1);
  assert.equal(doc.handlerCount('compositionend'), 1);

  let count = 0;
  onCompositionEnd(() => { count += 1; });
  doc.fire('compositionend');
  assert.equal(count, 1, '중복 배선이면 확정 1회에 2번 호출됐을 것');
});

test('releaseComposition 은 굳은 조합 상태를 풀고 구독자를 깨운다(리플로우 영구정지 방지)', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);

  let resumed = 0;
  onCompositionEnd(() => { resumed += 1; });

  doc.fire('compositionstart');
  assert.equal(isComposing(), true);

  // <body> 치환으로 조합 노드가 사라져 compositionend 가 오지 않는 상황을 흉내낸다.
  releaseComposition();
  assert.equal(isComposing(), false, '강제 해제 후에는 리플로우가 다시 가능해야 한다');
  assert.equal(resumed, 1, '미뤄둔 리플로우를 재개할 구독자가 깨어난다');
});

test('releaseComposition 은 조합 중이 아니면 아무 일도 하지 않는다(구독자 중복 호출 방지)', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);

  let calls = 0;
  onCompositionEnd(() => { calls += 1; });

  releaseComposition();
  releaseComposition();
  assert.equal(calls, 0, '조합이 없었으면 구독자를 부르지 않는다');

  doc.fire('compositionstart');
  releaseComposition();
  releaseComposition();
  assert.equal(calls, 1, '해제는 한 번만 통지된다');
});

test('doc 이 없으면 조용히 무시한다(배선 시점 방어)', () => {
  resetCompositionForTest();
  assert.doesNotThrow(() => attachComposition(null));
  assert.equal(isComposing(), false);
});

test('한 구독자가 실패해도 나머지 구독자는 호출된다', () => {
  resetCompositionForTest();
  const doc = fakeDoc();
  attachComposition(doc);

  const called = [];
  onCompositionEnd(() => { throw new Error('구독자 실패'); });
  onCompositionEnd(() => called.push('reflow-resume'));

  // 뒤에 등록된 구독자가 미뤄둔 리플로우 재개를 담당한다(editor.js) — 앞 구독자의 예외로
  // 건너뛰어지면 리플로우가 영영 멈추므로, 실패는 격리하고 나머지는 반드시 돌려야 한다.
  assert.doesNotThrow(() => doc.fire('compositionend'));
  assert.deepEqual(called, ['reflow-resume']);
});
