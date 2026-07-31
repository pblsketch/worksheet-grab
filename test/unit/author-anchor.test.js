import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAuthorAnchor } from '../../src/editor/authorAnchor.js';

// B1 — "새 섹션 AI 저작" 앵커 산출(순수). 삽입 위치는 교사 클릭이 정한다 → Chrome 없이 유닛 고정.

const flowPage = () => ({
  id: 'p1',
  flow: [
    { id: 't1', type: 'title', placement: 'flow' },
    { id: 'q1', type: 'question', placement: 'flow' },
  ],
  float: [{ id: 'f1', type: 'answer-area', placement: 'float' }],
});

test('선택이 이 페이지 flow 개체면 그 뒤(afterId)', () => {
  assert.deepEqual(computeAuthorAnchor(flowPage(), { id: 't1', placement: 'flow' }), { afterId: 't1' });
  assert.deepEqual(computeAuthorAnchor(flowPage(), { id: 'q1', placement: 'flow' }), { afterId: 'q1' });
});

test('선택 없음 → 페이지 마지막 flow 개체 뒤(페이지 말미)', () => {
  assert.deepEqual(computeAuthorAnchor(flowPage(), null), { afterId: 'q1' });
});

test('float 선택은 앵커가 될 수 없다 → 페이지 말미로 흘린다(insert-section 은 float 앵커 불가)', () => {
  assert.deepEqual(computeAuthorAnchor(flowPage(), { id: 'f1', placement: 'float' }), { afterId: 'q1' });
});

test('다른 페이지 개체 선택 → 이 페이지 말미(방어: 대상 페이지 기준)', () => {
  assert.deepEqual(computeAuthorAnchor(flowPage(), { id: '다른페이지q', placement: 'flow' }), { afterId: 'q1' });
});

test('빈 페이지 + 문서에 앞선 flow 개체 있음 → 문서 마지막 flow 개체 뒤(안정 앵커, reflow 가 빈 페이지를 지워도 스테일 없음)', () => {
  assert.deepEqual(computeAuthorAnchor({ id: 'p9', flow: [], float: [] }, null, 'q4'), { afterId: 'q4' });
  // float 만 있고 flow 가 비어도 동일 — insert-section 은 flow 로 들어가므로.
  assert.deepEqual(computeAuthorAnchor({ id: 'p9', flow: [], float: [{ id: 'f9', placement: 'float' }] }, { id: 'f9', placement: 'float' }, 'q4'), { afterId: 'q4' });
});

test('완전 빈 문서(빈 페이지 + 앞선 flow 개체 없음) → pageId 앵커(유일 페이지라 reflow 가 못 지움)', () => {
  assert.deepEqual(computeAuthorAnchor({ id: 'p9', flow: [], float: [] }, null, null), { pageId: 'p9' });
  assert.deepEqual(computeAuthorAnchor({ id: 'p9', flow: [], float: [] }, null), { pageId: 'p9' });
});

test('page 가 없거나 id 없는 빈 페이지 → null(호출부가 차단 사유 처리)', () => {
  assert.equal(computeAuthorAnchor(null, null), null);
  assert.equal(computeAuthorAnchor(undefined, null), null);
  assert.equal(computeAuthorAnchor({ flow: [] }, null, null), null);
});
