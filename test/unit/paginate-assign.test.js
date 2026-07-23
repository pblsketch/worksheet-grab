import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignFlowToPages, computeAvailableHeightPx, MM_TO_PX, DEFAULT_TOLERANCE_PX,
} from '../../src/usecases/PaginateObjectTree.js';
import { resolvePaper, paperDims, paperMargins } from '../../src/usecases/paper.js';

// S2.5 순수 계산부 수용 기준(과제 지시 §산출 1): 높이 배열 입력→페이지 배정, 넘침 이동,
// 표(높이 큰 개체) 통째 이동, 허용오차(±2px) 내 경계 판정 안정성. Chrome/FS 무접촉(순수 함수만).

test('computeAvailableHeightPx: A4 기본(미지정) = (297-12-10)mm * MM_TO_PX', () => {
  const resolved = resolvePaper({});
  const { h } = paperDims(resolved);
  const m = paperMargins(resolved);
  const expected = (h - m.top - m.bottom) * MM_TO_PX;
  assert.equal(computeAvailableHeightPx(null), expected);
  assert.equal(computeAvailableHeightPx(undefined), expected);
});

test('computeAvailableHeightPx: A3 가로 등 커스텀 paper 도 paper.js 파생과 일치', () => {
  const paper = { size: 'A3', orientation: 'landscape' };
  const resolved = resolvePaper(paper);
  const { h } = paperDims(resolved);
  const m = paperMargins(resolved);
  const expected = (h - m.top - m.bottom) * MM_TO_PX;
  assert.equal(computeAvailableHeightPx(paper), expected);
});

test('기본 배치: 전부 가용 높이 이내 -> 전 개체가 page 0', () => {
  const items = [
    { id: 'a', heightPx: 100 },
    { id: 'b', heightPx: 200 },
    { id: 'c', heightPx: 300 },
  ];
  const { pageOfId, pageOfIndex, pageCount } = assignFlowToPages(items, 1000);
  assert.equal(pageCount, 1);
  assert.deepEqual(pageOfIndex, [0, 0, 0]);
  assert.deepEqual(pageOfId, { a: 0, b: 0, c: 0 });
});

test('넘침 개체는 다음 페이지로 통째 이동(분할 없음)', () => {
  // 가용 300px: a(150)+b(140)=290 OK, +c(50) 하면 340 > 300+tolerance -> c 는 다음 페이지로 이동.
  const items = [
    { id: 'a', heightPx: 150 },
    { id: 'b', heightPx: 140 },
    { id: 'c', heightPx: 50 },
    { id: 'd', heightPx: 60 },
  ];
  const { pageOfId, pageOfIndex, pageCount } = assignFlowToPages(items, 300);
  assert.equal(pageCount, 2);
  assert.deepEqual(pageOfIndex, [0, 0, 1, 1]);
  assert.deepEqual(pageOfId, { a: 0, b: 0, c: 1, d: 1 });
});

test('표(개체 혼자 가용 높이 초과): 분할 없이 그 개체만 담은 페이지로 통째 배치', () => {
  // 큰 표(1500px) 혼자서도 가용 800px 을 초과 -> 분할하지 않고 새 페이지에 그대로 배치,
  // 다음 개체는 그 페이지가 이미 넘쳐 있으므로 또 다른 새 페이지로 밀린다.
  const items = [
    { id: 'lead', heightPx: 200 },
    { id: 'bigTable', heightPx: 1500 },
    { id: 'after', heightPx: 100 },
  ];
  const { pageOfId, pageCount } = assignFlowToPages(items, 800);
  assert.equal(pageOfId.lead, 0, 'lead 는 1페이지');
  assert.equal(pageOfId.bigTable, 1, '큰 표는 분할 없이 자기 혼자 새 페이지에 배치');
  assert.equal(pageOfId.after, 2, '표 다음 개체는 표가 이미 그 페이지를 넘겨 다음 페이지로');
  assert.equal(pageCount, 3);
});

test('허용오차(±2px) 경계 안정성: 정확히 tolerance 이내면 같은 페이지, 초과하면 다음 페이지', () => {
  const available = 500;
  // cursor(300) + h 가 tolerance 경계(500+2=502)에 걸치는 두 케이스를 비교.
  const withinTolerance = assignFlowToPages(
    [{ id: 'a', heightPx: 300 }, { id: 'b', heightPx: 202 }], // 300+202=502 == available+tolerance(정확히 경계)
    available,
  );
  assert.equal(withinTolerance.pageOfId.b, 0, '허용오차 경계값 이내는 같은 페이지에 유지되어야 함(안정성)');

  const overTolerance = assignFlowToPages(
    [{ id: 'a', heightPx: 300 }, { id: 'b', heightPx: 202.5 }], // 502.5 > 502 -> 다음 페이지
    available,
  );
  assert.equal(overTolerance.pageOfId.b, 1, '허용오차를 벗어나면 다음 페이지로 이동해야 함');
});

test('허용오차 커스텀 값(tolerancePx) 적용', () => {
  const items = [{ id: 'a', heightPx: 100 }, { id: 'b', heightPx: 15 }];
  // available=100, tolerance=0(기본은 DEFAULT_TOLERANCE_PX=2) -> b(15) 는 즉시 다음 페이지.
  const strict = assignFlowToPages(items, 100, { tolerancePx: 0 });
  assert.equal(strict.pageOfId.b, 1);
  // tolerance=20 이면 100+15=115 <= 100+20 -> 같은 페이지 유지.
  const lenient = assignFlowToPages(items, 100, { tolerancePx: 20 });
  assert.equal(lenient.pageOfId.b, 0);
});

test('DEFAULT_TOLERANCE_PX 는 2', () => {
  assert.equal(DEFAULT_TOLERANCE_PX, 2);
});

test('빈 items -> pageCount 1(빈 페이지 1개), pageOfIndex 빈 배열', () => {
  const { pageOfIndex, pageCount, pageOfId } = assignFlowToPages([], 500);
  assert.deepEqual(pageOfIndex, []);
  assert.deepEqual(pageOfId, {});
  assert.equal(pageCount, 1);
});

test('개체 순서 보존: 같은 페이지 내 개체는 입력 순서 그대로(재정렬 없음)', () => {
  const items = [
    { id: 'x1', heightPx: 50 }, { id: 'x2', heightPx: 50 }, { id: 'x3', heightPx: 50 },
  ];
  const { pageOfIndex } = assignFlowToPages(items, 1000);
  assert.deepEqual(pageOfIndex, [0, 0, 0]);
});

test('음수/비수치 heightPx 는 0으로 취급(방어적 폴백)', () => {
  const items = [{ id: 'a', heightPx: -50 }, { id: 'b', heightPx: NaN }, { id: 'c', heightPx: 10 }];
  const { pageOfId, pageCount } = assignFlowToPages(items, 100);
  assert.equal(pageCount, 1);
  assert.deepEqual(pageOfId, { a: 0, b: 0, c: 0 });
});

test('입력 검증: items 가 array 아니면 던짐', () => {
  assert.throws(() => assignFlowToPages(null, 500), /items/);
  assert.throws(() => assignFlowToPages({}, 500), /items/);
});

test('입력 검증: availableHeightPx 가 양수 아니면 던짐', () => {
  assert.throws(() => assignFlowToPages([], 0), /availableHeightPx/);
  assert.throws(() => assignFlowToPages([], -10), /availableHeightPx/);
  assert.throws(() => assignFlowToPages([], NaN), /availableHeightPx/);
});
