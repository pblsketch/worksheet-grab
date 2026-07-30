import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageScopeTargets } from '../../src/editor/pageScope.js';

// M2(여러 페이지 골라 잡기) — 페이지-scope 대상 수집이 여러 페이지를 합치고, 제외 타입을 빼고,
// id 중복을 제거하는지 순수 판정으로 고정한다. 실포인터/썸네일 UI 는 render 스위트 소관.

const q = (id) => ({ id, type: 'question', prompt: id });
const std = (id) => ({ id, type: 'std-box', codes: [] });

test('여러 페이지의 flow+float 를 순서대로 합친다', () => {
  const pages = [
    { flow: [q('p1a'), q('p1b')], float: [{ id: 'p1f', type: 'richtext' }] },
    { flow: [q('p2a')], float: [] },
  ];
  const ids = pageScopeTargets(pages).map((t) => t.id);
  assert.deepEqual(ids, ['p1a', 'p1b', 'p1f', 'p2a'], '2개 페이지의 flow+float 가 모두, 등장 순서대로');
});

test('제외 타입(std-box=성취기준)은 페이지 전체 수집에서도 빠진다(원칙 3)', () => {
  const pages = [{ flow: [q('a'), std('s1'), q('b')], float: [] }];
  const ids = pageScopeTargets(pages, ['std-box']).map((t) => t.id);
  assert.deepEqual(ids, ['a', 'b'], 'std-box 는 조용히 제외');
});

test('id 중복 제거(첫 등장만)·불량 입력 안전', () => {
  const pages = [
    { flow: [q('x')], float: [] },
    { flow: [q('x'), q('y')], float: [] }, // x 중복
    null,                                   // 불량 페이지 skip
    { flow: [{ type: 'question' }], float: [] }, // id 없는 개체 skip
  ];
  const ids = pageScopeTargets(pages, ['std-box']).map((t) => t.id);
  assert.deepEqual(ids, ['x', 'y'], '중복 x 는 하나, id 없는 것은 제외');
  assert.deepEqual(pageScopeTargets([]), [], '빈 배열 안전');
  assert.deepEqual(pageScopeTargets(undefined), [], 'undefined 안전');
});

test('반환 항목은 {id, obj} 형태(ai.js 대상 계약과 동형)', () => {
  const obj = q('only');
  const [t] = pageScopeTargets([{ flow: [obj], float: [] }]);
  assert.equal(t.id, 'only');
  assert.equal(t.obj, obj, '원본 개체 참조를 그대로 싣는다');
});
