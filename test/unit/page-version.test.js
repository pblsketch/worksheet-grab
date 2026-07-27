import test from 'node:test';
import assert from 'node:assert/strict';
import { computePageVersion } from '../../src/domain/schema/PageIdentity.js';

// Phase 4 US-P4-5 — 덮어쓰기 방지의 기반이 되는 페이지 지문(pageVersion).
// 요구: (a) 같은 내용이면 같은 값(안정성) (b) 개체 필드가 하나라도 바뀌면 다른 값(민감도)
// (c) 내용은 그대로고 순서만 바뀌어도 다른 값 (d) 키 삽입 순서에는 둔감(같은 내용 = 같은 값).

const page = () => ({
  id: 'page-1',
  flow: [
    { id: 'q1', type: 'question', qtype: 'short-answer', prompt: '전압이란?' },
    { id: 'q2', type: 'question', qtype: 'essay', prompt: '전류를 설명하시오.' },
  ],
  float: [{ id: 'f1', type: 'answer-area', lines: 5, rect: { xMm: 10, yMm: 20, wMm: 50, hMm: 30 } }],
});

test('안정성: 같은 내용이면 같은 값 — 호출 반복·별개 객체 모두', () => {
  assert.equal(computePageVersion(page()), computePageVersion(page()));
  const p = page();
  assert.equal(computePageVersion(p), computePageVersion(p));
});

test('안정성: 키 삽입 순서가 달라도 같은 값(내용 동일)', () => {
  const a = { id: 'page-1', flow: [{ id: 'q1', type: 'question', prompt: '가' }], float: [] };
  const b = { float: [], flow: [{ prompt: '가', type: 'question', id: 'q1' }], id: 'page-1' };
  assert.equal(computePageVersion(a), computePageVersion(b));
});

test('민감도: 개체 필드가 하나만 바뀌어도 다른 값', () => {
  const base = computePageVersion(page());
  const edited = page();
  edited.flow[0].prompt = '전압이란 무엇인가?';
  assert.notEqual(computePageVersion(edited), base);

  const oneChar = page();
  oneChar.flow[1].prompt = `${oneChar.flow[1].prompt} `;
  assert.notEqual(computePageVersion(oneChar), base, '공백 한 칸 차이도 감지');

  const floatMoved = page();
  floatMoved.float[0].rect.xMm = 11;
  assert.notEqual(computePageVersion(floatMoved), base, 'float 좌표 변화도 감지');

  const roleAdded = page();
  roleAdded.role = 'reading';
  assert.notEqual(computePageVersion(roleAdded), base, '페이지 수준 필드 변화도 감지');
});

test('민감도: 순서만 바뀌어도 다른 값(내용 집합은 동일)', () => {
  const reordered = page();
  reordered.flow.reverse();
  assert.notEqual(computePageVersion(reordered), computePageVersion(page()));
});

test('민감도: 개체 추가·삭제 감지', () => {
  const base = computePageVersion(page());
  const added = page();
  added.flow.push({ id: 'q3', type: 'question', qtype: 'essay', prompt: '추가' });
  assert.notEqual(computePageVersion(added), base);

  const removed = page();
  removed.flow.pop();
  assert.notEqual(computePageVersion(removed), base);
});

test('undefined 필드는 무시된다 — 없는 것과 같은 값(순수 함수 안정성)', () => {
  const withUndef = page();
  withUndef.flow[0].role = undefined;
  assert.equal(computePageVersion(withUndef), computePageVersion(page()));
});

test('null·빈 페이지도 크래시 없이 결정적 값', () => {
  assert.equal(computePageVersion(null), computePageVersion(null));
  assert.equal(computePageVersion({ id: 'p', flow: [], float: [] }), computePageVersion({ id: 'p', flow: [], float: [] }));
  assert.notEqual(computePageVersion(null), computePageVersion({ id: 'p', flow: [], float: [] }));
  assert.match(computePageVersion(page()), /^pv1-[0-9a-f]{16}$/);
});
