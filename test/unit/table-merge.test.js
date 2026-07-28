import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCells } from '../../src/editor/tableEdit.js';

// 셀 병합/분할 규칙(2026-07-28 — Codex 교차 점검 C7).
//
// 표의 불변식 하나만 지키면 된다: **각 행이 덮는 열의 합 == 표의 열 수.**
// 병합된 칸은 colspan 만큼, 숨은 칸(merged)은 0 을 덮는다. 이게 깨지면 렌더가 행마다 다른 열 수를
// 그려 표가 어긋난다(교사 눈에는 칸 하나가 사라진 것처럼 보인다).

/** 한 행이 실제로 덮는 열 수. merged 칸은 다른 칸에 흡수됐으므로 0. */
const coveredCols = (row) => row.reduce((n, cell) => n + (cell.merged ? 0 : (cell.colspan || 1)), 0);

/** r×c 표(각 칸 텍스트는 A1·B1… 형태). */
function grid(rowCount, colCount) {
  return Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => ({ text: `${String.fromCharCode(65 + c)}${r + 1}` })));
}

test('오른쪽 병합: 이웃 한 칸을 흡수해 colspan 2', () => {
  const rows = mergeCells(grid(1, 3), { r: 0, c: 0 }, 'right');
  assert.equal(rows[0][0].colspan, 2);
  assert.equal(rows[0][1].merged, true);
  assert.equal(coveredCols(rows[0]), 3, '행이 덮는 열 수는 그대로 3이어야 한다');
});

test('이미 병합된 칸을 흡수하면 그 칸의 span 을 통째로 가져온다(C7)', () => {
  // B+C 를 먼저 병합(B.colspan=2, C.merged) → 그 다음 A 를 오른쪽 병합.
  const once = mergeCells(grid(1, 3), { r: 0, c: 1 }, 'right');
  assert.equal(once[0][1].colspan, 2);
  assert.equal(once[0][2].merged, true);

  const twice = mergeCells(once, { r: 0, c: 0 }, 'right');
  assert.ok(twice, '병합이 성립해야 한다');
  assert.equal(coveredCols(twice[0]), 3,
    `행이 덮는 열 수가 표의 열 수와 같아야 한다 — 실제 ${coveredCols(twice[0])}, rows=${JSON.stringify(twice[0])}`);
  assert.equal(twice[0][0].colspan, 3, 'A 가 B(2칸)를 흡수했으므로 3칸이어야 한다');
  assert.equal(twice[0][1].merged, true);
  assert.equal(twice[0][2].merged, true);
});

test('흡수된 칸은 자기 span 을 남기지 않는다(숨은 칸의 span 은 렌더를 어긋나게 한다)', () => {
  const once = mergeCells(grid(1, 3), { r: 0, c: 1 }, 'right');
  const twice = mergeCells(once, { r: 0, c: 0 }, 'right');
  assert.equal(twice[0][1].colspan, undefined, `흡수된 B 는 colspan 을 버려야 한다 — ${JSON.stringify(twice[0][1])}`);
});

test('아래 병합도 같다 — 이미 rowspan 을 가진 칸을 흡수하면 합산한다', () => {
  const once = mergeCells(grid(3, 1), { r: 1, c: 0 }, 'down'); // B+C 세로 병합
  assert.equal(once[1][0].rowspan, 2);
  const twice = mergeCells(once, { r: 0, c: 0 }, 'down');
  assert.equal(twice[0][0].rowspan, 3, 'A 가 2행짜리를 흡수했으므로 3행이어야 한다');
  assert.equal(twice[1][0].rowspan, undefined, '흡수된 칸은 rowspan 을 버린다');
});

test('축이 어긋나는 병합은 거절한다(가로로 흡수할 칸이 세로로 걸쳐 있으면 구조가 깨진다)', () => {
  const g = grid(2, 3);
  const withRowspan = mergeCells(g, { r: 0, c: 1 }, 'down'); // B1 이 2행을 덮는다
  assert.equal(withRowspan[0][1].rowspan, 2);
  const bad = mergeCells(withRowspan, { r: 0, c: 0 }, 'right'); // A1 이 B1 을 가로로 먹으려 한다
  assert.equal(bad, null, '거절해야 한다(조용히 어긋난 표를 만들지 않는다)');
});

test('분할: 병합 이전 상태로 되돌린다', () => {
  const once = mergeCells(grid(1, 3), { r: 0, c: 1 }, 'right');
  const twice = mergeCells(once, { r: 0, c: 0 }, 'right');
  const split = mergeCells(twice, { r: 0, c: 0 }, 'split');
  assert.equal(coveredCols(split[0]), 3);
  assert.equal(split[0][0].colspan, undefined);
  assert.ok(!split[0][1].merged, 'B 가 다시 보여야 한다');
  assert.ok(!split[0][2].merged, 'C 도 다시 보여야 한다');
});

test('경계: 마지막 칸은 오른쪽으로 병합할 수 없고 원본을 변이하지 않는다', () => {
  const g = grid(1, 2);
  const snapshot = JSON.stringify(g);
  assert.equal(mergeCells(g, { r: 0, c: 1 }, 'right'), null);
  assert.equal(JSON.stringify(g), snapshot, '실패해도 원본은 그대로여야 한다');
});

test('경계: 숨은 칸을 기준으로는 병합하지 않는다', () => {
  const once = mergeCells(grid(1, 3), { r: 0, c: 0 }, 'right');
  assert.equal(mergeCells(once, { r: 0, c: 1 }, 'right'), null, '숨은 칸이 기준이면 무동작');
});
