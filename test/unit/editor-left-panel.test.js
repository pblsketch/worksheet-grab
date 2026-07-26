import test from 'node:test';
import assert from 'node:assert/strict';

import { settlePageReorder } from '../../src/editor/pageReorder.js';

test('페이지 reorder no-op은 미리보기 순서를 되돌린다', async () => {
  let rolledBack = 0;
  let succeeded = 0;

  const result = await settlePageReorder(
    async () => null,
    {
      onSuccess: () => { succeeded += 1; },
      onRollback: () => { rolledBack += 1; },
    },
  );

  assert.equal(result, null);
  assert.equal(rolledBack, 1);
  assert.equal(succeeded, 0);
});

test('페이지 reorder 실패는 롤백하고 오류를 호출자에게 보고한다', async () => {
  const failure = new Error('reorder failed');
  let rolledBack = 0;
  let reported = null;

  const result = await settlePageReorder(
    async () => { throw failure; },
    {
      onRollback: () => { rolledBack += 1; },
      onError: (error) => { reported = error; },
    },
  );

  assert.equal(result, null);
  assert.equal(rolledBack, 1);
  assert.equal(reported, failure);
});

test('페이지 reorder 성공은 결과를 전달하고 롤백하지 않는다', async () => {
  const expected = { activePageId: 'page-2' };
  let received = null;
  let rolledBack = 0;

  const result = await settlePageReorder(
    async () => expected,
    {
      onSuccess: (value) => { received = value; },
      onRollback: () => { rolledBack += 1; },
    },
  );

  assert.equal(result, expected);
  assert.equal(received, expected);
  assert.equal(rolledBack, 0);
});
