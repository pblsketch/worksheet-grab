import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignFlowToPages, pageCapacityFns, computeAvailableHeightPx } from '../../src/usecases/PaginateObjectTree.js';

// P3-b 페이지네이션: 페이지별 가용높이(positional). 가로 페이지는 용량이 작아 세로 페이지보다
// 적게 담긴다. 편집기 reflow 와 엔진이 pageCapacityFns 를 공유해 하드 동치를 유지한다.

const items = (n, h) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, heightPx: h }));

test('assignFlowToPages: 숫자 availableHeightPx 는 종전과 완전히 동일(하위호환)', () => {
  const r = assignFlowToPages(items(6, 300), 1000, { columns: 1 });
  // 300*3=900≤1000, 4번째 1200>1000 → 페이지 나눔. 6개면 [0,0,0,1,1,1].
  assert.deepEqual(r.pageOfIndex, [0, 0, 0, 1, 1, 1]);
  assert.equal(r.pageCount, 2);
});

test('assignFlowToPages: 함수형 용량 — page0 큰 용량, page1 작은 용량이면 나중 페이지가 먼저 찬다', () => {
  // page0=1000(세 개), page1=600(두 개) → [0,0,0,1,1,2].
  const capOf = (i) => (i === 0 ? 1000 : 600);
  const r = assignFlowToPages(items(6, 300), capOf, { columns: 1 });
  assert.deepEqual(r.pageOfIndex, [0, 0, 0, 1, 1, 2]);
  assert.equal(r.pageCount, 3);
});

test('assignFlowToPages: 함수형 columns 도 페이지별로 조회된다', () => {
  // page0 단단(1열), page1 2단. 용량은 균일 600, 높이 300 → page0 2개(첫열만), page1 4개(2열×2).
  const capOf = () => 600;
  const colsOf = (i) => (i === 0 ? 1 : 2);
  const r = assignFlowToPages(items(6, 300), capOf, { columns: colsOf });
  // page0: o0,o1(600) → o2 넘침 page1. page1(2단,열당 600): o2,o3(열0) o4,o5(열1). => [0,0,1,1,1,1]
  assert.deepEqual(r.pageOfIndex, [0, 0, 1, 1, 1, 1]);
});

test('pageCapacityFns: 가로 페이지 가용높이 < 세로 페이지(핵심 — 가로가 먼저 찬다)', () => {
  const srcPages = [{ paper: null }, { paper: { orientation: 'landscape' } }];
  const { capacityForPage, columnsForPage } = pageCapacityFns(srcPages, { size: 'A4', orientation: 'portrait' });
  const portrait = capacityForPage(0);
  const landscape = capacityForPage(1);
  assert.ok(portrait > landscape, `세로(${portrait.toFixed(0)}) > 가로(${landscape.toFixed(0)}) 이어야 함`);
  // 문서 A4 세로 가용높이와 동일해야(0쪽 override 없음)
  assert.equal(portrait, computeAvailableHeightPx({ size: 'A4', orientation: 'portrait' }));
  assert.equal(landscape, computeAvailableHeightPx({ size: 'A4', orientation: 'landscape' }));
  assert.equal(columnsForPage(0), 1);
  assert.equal(columnsForPage(1), 1);
});

test('pageCapacityFns: srcPages 범위 밖 인덱스는 문서 paper 로 폴백', () => {
  const srcPages = [{ paper: { orientation: 'landscape' } }];
  const { capacityForPage } = pageCapacityFns(srcPages, { size: 'A4', orientation: 'portrait' });
  // index 1(범위 밖) → 문서 A4 세로 용량
  assert.equal(capacityForPage(1), computeAvailableHeightPx({ size: 'A4', orientation: 'portrait' }));
});

test('pageCapacityFns: 문서·페이지 모두 미지정이면 A4 세로 기본(무회귀)', () => {
  const { capacityForPage, columnsForPage } = pageCapacityFns([{}, {}], null);
  assert.equal(capacityForPage(0), computeAvailableHeightPx(null));
  assert.equal(columnsForPage(0), 1);
});

test('통합: 세로 문서 + 가로 페이지 복합세트 — 가로 페이지가 세로보다 적게 담긴다', () => {
  const srcPages = [{ paper: null }, { paper: { orientation: 'landscape' } }];
  const { capacityForPage, columnsForPage } = pageCapacityFns(srcPages, { size: 'A4', orientation: 'portrait' });
  // 각 개체 400px. 세로 용량≈1015 → 2개(800)+3번째 넘침. 가로 용량≈618 → 1개(400)+2번째(800)넘침.
  const r = assignFlowToPages(items(5, 400), capacityForPage, { columns: columnsForPage });
  // page0(세로 1015): o0,o1(800) → o2(1200>1015) page1. page1(가로 618): o2(400) → o3(800>618) page2(문서 세로 1015): o3,o4.
  assert.deepEqual(r.pageOfIndex, [0, 0, 1, 2, 2]);
});
