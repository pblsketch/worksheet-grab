import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignFlowToPages, computeAvailableHeightPx, paperColumns, MM_TO_PX, DEFAULT_TOLERANCE_PX, PAGE_BOUNDARY_BUFFER_PX,
} from '../../src/usecases/PaginateObjectTree.js';
import { resolvePaper, paperDims, paperMargins } from '../../src/usecases/paper.js';

// S2.5 순수 계산부 수용 기준(과제 지시 §산출 1): 높이 배열 입력→페이지 배정, 넘침 이동,
// 표(높이 큰 개체) 통째 이동, 허용오차(±2px) 내 경계 판정 안정성. Chrome/FS 무접촉(순수 함수만).
// 가용 높이는 (용지 - 상하 여백) 에서 페이지 경계 마진 누출 안전 버퍼(PAGE_BOUNDARY_BUFFER_PX)를
// 뺀 값이다 — 실제 인쇄에서 각 페이지 첫 개체의 상단 마진이 상쇄되지 않아 밀도 높은 콘텐츠가 A4 를
// 미세 초과해 물리 페이지가 쪼개지는 하드 동치 붕괴를 막는다(PaginateObjectTree 주석 참조).

test('computeAvailableHeightPx: A4 기본(미지정) = (297-12-10)mm * MM_TO_PX − 경계 버퍼', () => {
  const resolved = resolvePaper({});
  const { h } = paperDims(resolved);
  const m = paperMargins(resolved);
  const expected = (h - m.top - m.bottom) * MM_TO_PX - PAGE_BOUNDARY_BUFFER_PX;
  assert.equal(computeAvailableHeightPx(null), expected);
  assert.equal(computeAvailableHeightPx(undefined), expected);
});

test('computeAvailableHeightPx: A3 가로 등 커스텀 paper 도 paper.js 파생 − 경계 버퍼와 일치', () => {
  const paper = { size: 'A3', orientation: 'landscape' };
  const resolved = resolvePaper(paper);
  const { h } = paperDims(resolved);
  const m = paperMargins(resolved);
  const expected = (h - m.top - m.bottom) * MM_TO_PX - PAGE_BOUNDARY_BUFFER_PX;
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

// ── page-break: "여기서 끊어라"를 표현하는 유일한 어휘(2026-07-28 신설) ──────────
// 그리디 패킹만 있으면 교사가 개체를 다른 쪽으로 끌어다 놔도 다음 리플로우가 앞 페이지의 남은
// 자리로 도로 당겨 올린다. 페이지 '용량'을 늘리는 기능이 아니라 **끊는 위치**를 정하는 표식이다.

test('page-break: 자리가 남아도 그 지점에서 페이지를 끊는다', () => {
  const items = [
    { id: 'a', heightPx: 100 },
    { id: 'pb', heightPx: 0, breakBefore: true },
    { id: 'b', heightPx: 100 },
  ];
  const { pageOfId, pageOfIndex, pageCount } = assignFlowToPages(items, 1000);
  assert.equal(pageCount, 2, '가용 높이가 남아도 강제 개행');
  assert.deepEqual(pageOfIndex, [0, 1, 1]);
  assert.deepEqual(pageOfId, { a: 0, pb: 1, b: 1 });
});

test('page-break: 높이를 차지하지 않는다(뒤 개체 용량에 영향 없음)', () => {
  // 가용 300: 개행 뒤 b(150)+c(140)=290 이 한 페이지에 들어가야 한다 — 표식이 높이를 먹으면 갈린다.
  const items = [
    { id: 'a', heightPx: 50 },
    { id: 'pb', heightPx: 0, breakBefore: true },
    { id: 'b', heightPx: 150 },
    { id: 'c', heightPx: 140 },
  ];
  const { pageOfIndex, pageCount } = assignFlowToPages(items, 300);
  assert.equal(pageCount, 2);
  assert.deepEqual(pageOfIndex, [0, 1, 1, 1]);
});

test('page-break: 이미 새 페이지 첫 자리면 빈 페이지를 만들지 않는다', () => {
  // 연속 개행·문서 맨 앞 개행이 빈 페이지를 낳으면 인쇄에 백지가 섞인다.
  const head = assignFlowToPages([
    { id: 'pb', heightPx: 0, breakBefore: true },
    { id: 'a', heightPx: 100 },
  ], 1000);
  assert.equal(head.pageCount, 1, '문서 맨 앞 개행은 빈 1쪽을 만들지 않는다');
  assert.deepEqual(head.pageOfIndex, [0, 0]);

  const twice = assignFlowToPages([
    { id: 'a', heightPx: 100 },
    { id: 'pb1', heightPx: 0, breakBefore: true },
    { id: 'pb2', heightPx: 0, breakBefore: true },
    { id: 'b', heightPx: 100 },
  ], 1000);
  assert.equal(twice.pageCount, 2, '연속 개행은 한 번만 끊는다');
  assert.deepEqual(twice.pageOfIndex, [0, 1, 1, 1]);
});

test('page-break: 용량을 늘리지는 않는다 — 넘치는 분량은 여전히 뒤로 밀린다', () => {
  // 가용 300, 개행 뒤 b(200)+c(200)=400 -> c 는 또 다음 페이지로. "꽉 찬 쪽에 더 넣기"는 불가능.
  const items = [
    { id: 'a', heightPx: 50 },
    { id: 'pb', heightPx: 0, breakBefore: true },
    { id: 'b', heightPx: 200 },
    { id: 'c', heightPx: 200 },
  ];
  const { pageOfIndex, pageCount } = assignFlowToPages(items, 300);
  assert.equal(pageCount, 3);
  assert.deepEqual(pageOfIndex, [0, 1, 1, 2]);
});

test('breakBefore 없는 items 는 종전과 완전히 동일(하위호환)', () => {
  const items = [{ id: 'a', heightPx: 150 }, { id: 'b', heightPx: 140 }, { id: 'c', heightPx: 50 }];
  const before = assignFlowToPages(items, 300);
  const withFalse = assignFlowToPages(items.map((i) => ({ ...i, breakBefore: false })), 300);
  assert.deepEqual(withFalse, before);
});

// ── 다단(columns) 열 인식 패킹 (2026-07-28) ──────────────────────────────────
//
// paper.css 가 `column-fill:auto` + 자식 `break-inside:avoid` 라 브라우저는 좌열을 끝까지 채우고
// 다음 열로 넘어가며 블록을 쪼개지 않는다. 열 단위 그리디 패킹이 그 동작과 1:1 대응이다.
// 열 넘김은 CSS 가 하고 **페이지 경계는 여전히 assignFlowToPages 혼자 정한다**(D-A 무접촉).

const H = (n, h) => ({ id: `i${n}`, heightPx: h });

test('assignFlowToPages(columns:2): 한 열이 차면 다음 열, 열이 다 차야 다음 페이지', () => {
  // 열 높이 100, 개체 60 → 한 열에 하나씩만 들어간다(60+60=120 > 100+2).
  const items = [H(1, 60), H(2, 60), H(3, 60), H(4, 60), H(5, 60)];
  const { pageOfIndex, pageCount } = assignFlowToPages(items, 100, { columns: 2 });
  assert.deepEqual(pageOfIndex, [0, 0, 1, 1, 2], '2개씩 한 페이지(열 2개)');
  assert.equal(pageCount, 3);
});

test('assignFlowToPages: columns 를 안 주면 종전과 완전히 같다(단단 회귀 0)', () => {
  const items = [H(1, 60), H(2, 60), H(3, 60), H(4, 60), H(5, 60)];
  const base = assignFlowToPages(items, 100);
  assert.deepEqual(base.pageOfIndex, [0, 1, 2, 3, 4], '단단이면 개체마다 한 페이지');
  // 1 · 0 · 음수 · 소수 · 문자열 · null — 전부 단단으로 떨어져야 한다.
  for (const columns of [1, 0, -3, 1.9, 'two', null, undefined, NaN]) {
    assert.deepEqual(
      assignFlowToPages(items, 100, { columns }).pageOfIndex, base.pageOfIndex,
      `columns=${String(columns)} 은 단단과 같아야 한다`,
    );
  }
});

test('assignFlowToPages(columns:2): 열 하나에 여러 개가 들어가면 그대로 쌓인다', () => {
  // 열 높이 100, 개체 30 → 한 열에 3개(90), 4번째부터 다음 열.
  const items = Array.from({ length: 7 }, (_, i) => H(i + 1, 30));
  const { pageOfIndex, pageCount } = assignFlowToPages(items, 100, { columns: 2 });
  assert.deepEqual(pageOfIndex, [0, 0, 0, 0, 0, 0, 1], '3개×2열 = 6개가 1쪽, 7번째가 2쪽');
  assert.equal(pageCount, 2);
});

test('assignFlowToPages(columns:2): page-break 는 열이 아니라 **페이지**를 끊는다', () => {
  const items = [H(1, 30), { id: 'pb', heightPx: 0, breakBefore: true }, H(2, 30)];
  const { pageOfId } = assignFlowToPages(items, 100, { columns: 2 });
  assert.equal(pageOfId.i1, 0);
  assert.equal(pageOfId.pb, 1, '첫 열에 여유가 남아도 페이지를 끊는다');
  assert.equal(pageOfId.i2, 1);
});

test('assignFlowToPages(columns:2): 페이지 첫 열 맨 위의 page-break 는 빈 페이지를 만들지 않는다', () => {
  const items = [{ id: 'pb', heightPx: 0, breakBefore: true }, H(1, 30)];
  const { pageOfId, pageCount } = assignFlowToPages(items, 100, { columns: 2 });
  assert.equal(pageOfId.pb, 0);
  assert.equal(pageOfId.i1, 0);
  assert.equal(pageCount, 1);
});

test('assignFlowToPages(columns:2): 열보다 큰 개체도 쪼개지 않고 그 열에 그대로 싣는다(R7)', () => {
  const items = [H(1, 250), H(2, 30)];
  const { pageOfIndex } = assignFlowToPages(items, 100, { columns: 2 });
  assert.deepEqual(pageOfIndex, [0, 0], '큰 개체는 1열에, 다음 개체는 2열에 — 페이지는 그대로');
});

test('paperColumns: 열 수 해석은 한 곳에서만 — 미지정·불량은 단단', () => {
  assert.equal(paperColumns(null), 1);
  assert.equal(paperColumns(undefined), 1);
  assert.equal(paperColumns({ size: 'A4' }), 1);
  assert.equal(paperColumns({ size: 'A4', columns: 1 }), 1);
  assert.equal(paperColumns({ size: 'A4', columns: 2 }), 2);
  assert.equal(paperColumns({ size: 'A4', columns: 3 }), 3);
});

test('assignFlowToPages(columns:2): 뒷 열 맨 위의 page-break 도 페이지를 끊는다', () => {
  // 열 커서가 0 인데 열 인덱스가 0 이 아닌 상태를 만든다: 열보다 큰 개체(250)가 1열을 넘겨
  // 놓으면 뒤따르는 높이 0 개체가 2열 맨 위로 밀린다(cursor 0 · column 1).
  // 이때 page-break 를 만나면 "이미 페이지 첫 자리"로 오인해 넘어가지 않으면 안 된다 —
  // 교사가 끊으라고 한 지점이 조용히 무시된다.
  const items = [
    { id: 'big', heightPx: 250 },
    { id: 'z', heightPx: 0 },
    { id: 'pb', heightPx: 0, breakBefore: true },
    { id: 'after', heightPx: 30 },
  ];
  const { pageOfId, pageCount } = assignFlowToPages(items, 100, { columns: 2 });
  assert.equal(pageOfId.big, 0);
  assert.equal(pageOfId.z, 0, '2열로 밀렸지만 아직 같은 페이지');
  assert.equal(pageOfId.pb, 1, '2열 맨 위여도 page-break 는 페이지를 끊는다');
  assert.equal(pageOfId.after, 1);
  assert.equal(pageCount, 2);
});
